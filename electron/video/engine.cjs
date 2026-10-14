const fs = require("node:fs/promises"),
  fss = require("node:fs"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  { createHash, randomUUID } = require("node:crypto");
const { fpsValue } = require("./model.cjs");
/**
 * Les démultiplexeurs FFmpeg dont les instants peuvent sauter
 * (AVFMT_TS_DISCONT) : MPEG-TS, MPEG-PS, Ogg... FFmpeg y compte le temps
 * d'une entrée depuis le premier des flux qu'elle sert, et un -ss y atterrit
 * sur la première image clé qui le suit (moteur, `videoTrack`, `seekPoint`).
 */
const SPLICED = [
  "mpegts",
  "mpegtsraw",
  "mpeg",
  "ogg",
  "live_flv",
  "dhav",
  "ty",
  "hls",
  "dvdvideo",
  "rcwt",
];
/**
 * La piste son d'un média : la première piste son UTILISABLE, c'est-à-dire
 * qui a des canaux, une fréquence et un format d'échantillons connus, ce
 * dernier n'existant que si FFmpeg sait la décoder. C'est la même partout :
 * ce que décrit `probe` (`audioChannels`), ce que sert l'aperçu (`proxy`), ce
 * que prend le rendu (render.cjs, `buildSegment`), l'onde (`waveform`), et le
 * zéro du moniteur (`videoTrack`, `audioLead`).
 *
 * C'était la première piste son, quelle qu'elle soit. Un MPEG-TS de la TNT ou
 * du satellite déclare souvent une première piste vide (0 canal, aucun
 * paquet) : son aperçu échouait (« Neither number of channels nor channel
 * layout specified ») et le média ne s'importait plus ; importé avant, il
 * gardait un film muet sous un moniteur qui avait du son. Une piste qu'aucun
 * décodeur ne lit (son spatial APAC d'un iPhone, AC-4, MPEG-H) faisait de
 * même échouer l'aperçu (30/09/2026).
 */
function soundOf(streams) {
  return (streams || []).find(
    (s) =>
      s.codec_type === "audio" &&
      Number(s.channels) > 0 &&
      Number(s.sample_rate) > 0 &&
      !!s.codec_name &&
      !!s.sample_fmt &&
      s.sample_fmt !== "unknown" &&
      s.sample_fmt !== "none",
  );
}
/**
 * La règle qui a choisi la piste son d'un aperçu, inscrite avec la version du
 * fichier au catalogue (index.cjs, `healProxies`). Un aperçu sans cette
 * marque a été fabriqué avant, sans « -map » : FFmpeg y servait la piste
 * qu'il choisit seul.
 */
const SOUND_RULE = "premiere-utilisable";
/**
 * La version de FFmpeg qu'embarquaient toutes les versions de l'app qui
 * fabriquaient les aperçus sans « -map » (1.0 à 1.2.x) : « 9.0.2 » sur macOS,
 * « n9.0.2-3-g… » sur Windows. Seule elle refait leur choix de piste son
 * (`legacySound`).
 */
const LEGACY_FFMPEG = /^ffmpeg version n?9\.0\.2(?![\d.])/;
class Engine {
  constructor({ nativeRoot, colorRoot, onProgress }) {
    this.root = nativeRoot;
    this.colorRoot = colorRoot;
    this.children = new Set();
    this.current = null;
    this.onProgress = onProgress;
    this.ffmpeg = path.join(
      nativeRoot,
      "ffmpeg" + (process.platform === "win32" ? ".exe" : ""),
    );
    this.ffprobe = path.join(
      nativeRoot,
      "ffprobe" + (process.platform === "win32" ? ".exe" : ""),
    );
    this.whisper = path.join(
      nativeRoot,
      "whisper-cli" + (process.platform === "win32" ? ".exe" : ""),
    );
    const models = path.join(path.dirname(nativeRoot), "models");
    this.whisperModel = path.join(
      models,
      fss.existsSync(path.join(models, "ggml-small.bin"))
        ? "ggml-small.bin"
        : "ggml-base.bin",
    );
    this.status = {
      available: false,
      version: "",
      encoder: "",
      platform: process.platform + "-" + process.arch,
      spaces: [],
      transcription: false,
      exports: [],
      encoders: {},
    };
  }
  async init() {
    this.status.transcription =
      fss.existsSync(this.whisper) && fss.existsSync(this.whisperModel);
    if (this.status.transcription) {
      try {
        await this.run(this.whisper, ["--help"], { timeout: 10000 });
      } catch (e) {
        this.status.transcription = false;
        this.status.transcriptionError = e.message;
      }
    }
    try {
      this.status.spaces = JSON.parse(
        await fs.readFile(path.join(this.colorRoot, "manifest.json"), "utf8"),
      ).spaces;
    } catch {}
    try {
      const v = await this.run(this.ffmpeg, ["-hide_banner", "-version"]);
      this.status.version = v.stdout.split("\n")[0];
      const enc = (await this.run(this.ffmpeg, ["-hide_banner", "-encoders"]))
        .stdout;
      const candidates =
        process.platform === "darwin"
          ? ["h264_videotoolbox"]
          : ["libopenh264", "h264_mf", "h264_nvenc", "h264_qsv"];
      this.status.encoder = "";
      for (const candidate of candidates.filter((c) =>
        new RegExp("\\b" + c + "\\b").test(enc),
      )) {
        this.status.encoder = candidate;
        try {
          await this.ff(
            [
              "-f",
              "lavfi",
              "-i",
              "color=black:s=128x72:r=25:d=0.04",
              "-frames:v",
              "1",
              ...this.encode(),
              "-f",
              "null",
              "-",
            ],
            { timeout: 15000 },
          );
          break;
        } catch {
          this.status.encoder = "";
        }
      }
      this.status.available = Boolean(this.status.encoder);
      this.status.encoders.h264 = this.status.encoder;
      const profiles = [
        {
          id: "h264",
          label: "MP4 · H.264 · livraison",
          extension: "mp4",
          candidates: [this.status.encoder],
        },
        {
          id: "hevc",
          label: "MP4 · H.265 / HEVC · 10 bits",
          extension: "mp4",
          candidates:
            process.platform === "darwin"
              ? ["hevc_videotoolbox"]
              : ["hevc_nvenc", "hevc_qsv", "hevc_amf", "libx265"],
        },
        {
          id: "prores",
          label: "MOV · ProRes 422 HQ · master 10 bits",
          extension: "mov",
          candidates: ["prores_ks"],
        },
        {
          id: "dnxhr",
          label: "MOV · DNxHR HQX · master 10 bits",
          extension: "mov",
          candidates: ["dnxhd"],
        },
      ];
      for (const profile of profiles) {
        let available = false,
          error = "Encodeur absent de cette installation";
        for (const candidate of profile.candidates.filter(
          (c) => c && new RegExp("\\b" + c + "\\b").test(enc),
        )) {
          this.status.encoders[profile.id] = candidate;
          try {
            await this.ff(
              [
                "-f",
                "lavfi",
                "-i",
                "color=black:s=256x144:r=25:d=0.08",
                "-frames:v",
                "2",
                ...this.encode({ codec: profile.id }),
                "-f",
                "null",
                "-",
              ],
              { timeout: 15000 },
            );
            available = true;
            error = "";
            break;
          } catch (e) {
            error = e.message;
          }
        }
        if (!available) delete this.status.encoders[profile.id];
        const { candidates, ...description } = profile;
        this.status.exports.push({ ...description, available, error });
      }
    } catch (e) {
      this.status.error = e.message;
    }
    return this.status;
  }
  /**
   * Lance un programme et attend sa fin.
   *
   * `stall` (millisecondes) arrête un FFmpeg qui ne progresse plus : lancé
   * avec « -progress pipe:1 » (`ff`, `analyse`), il écrit deux fois par
   * seconde où il en est, même bloqué. Seuls comptent le nombre d'images
   * sorties, l'instant atteint et la taille écrite : un rendu lent qui sort
   * une image de temps en temps n'est jamais coupé, un rendu figé l'est au
   * bout de `stall`, quelle que soit la durée totale. Un export sur un MPEG-PS
   * restait ainsi bloqué sans fin, FFmpeg à 0 % du processeur (29/09/2026).
   * La sortie standard n'est alors pas conservée.
   *
   * Le temps ne compte que tant que FFmpeg donne son suivi, et avant son
   * premier bloc. Bloqué, il le donne toujours (sa boucle principale l'écrit
   * à chaque demi-seconde, fftools, `transcode`). Il cesse de le donner une
   * fois toutes ses images écrites : il termine alors le fichier, et
   * « +faststart » en recopie tout le contenu, en place, sans aucun suivi
   * jusqu'au bloc final. Ce silence-là ne compte plus, quel que soit le
   * disque. Il se voyait à la taille et à la date du fichier de sortie, mais
   * un disque exFAT (FSKit, macOS 26) n'en montre aucun changement pendant
   * une réécriture en place : l'assemblage final d'un film de 18 à 30 Go vers
   * un disque USB était coupé à la toute fin, à chaque reprise (30/09/2026).
   */
  run(
    binary,
    args,
    {
      signal,
      progress = false,
      maxOutput = 8 * 1024 * 1024,
      timeout = 0,
      onStderr,
      stall = 0,
    } = {},
  ) {
    return new Promise((resolve, reject) => {
      let stdout = "",
        stderr = "",
        settled = false,
        stalled = false;
      const child = spawn(binary, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.children.add(child);
      const stop = () => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 1800).unref();
      };
      if (signal) {
        if (signal.aborted) stop();
        else signal.addEventListener("abort", stop, { once: true });
      }
      const timer = timeout ? setTimeout(stop, timeout) : null;
      // Suivi de la progression : dernier état vu, et depuis combien de temps
      // il n'a pas bougé (`idle`). Chaque tour de garde n'y ajoute qu'au plus
      // deux tours : un ordinateur mis en veille pendant l'export ne le fait
      // pas passer pour figé au réveil. `heard` : l'arrivée du dernier bloc
      // de suivi ; passé `quiet` sans bloc, FFmpeg termine son fichier et le
      // temps ne compte plus. `quiet` reste sous la moitié du délai : même
      // quand le dernier bloc n'a rien changé, l'écriture finale n'atteint
      // jamais le délai.
      let pending = "",
        state = "",
        idle = 0,
        last = Date.now(),
        heard = 0;
      const block = {},
        every = Math.min(1000, Math.max(20, Math.round(stall / 5))),
        quiet = Math.min(2000, stall / 2),
        watch =
          stall > 0
            ? setInterval(() => {
                const now = Date.now();
                if (!heard || now - heard <= quiet)
                  idle += Math.min(Math.max(0, now - last), 2 * every);
                last = now;
                if (!settled && !stalled && idle > stall) {
                  stalled = true;
                  stop();
                }
              }, every)
            : null;
      child.stdout.on("data", (b) => {
        if (watch) {
          pending += b.toString();
          const lines = pending.split("\n");
          pending = lines.pop().slice(-4096);
          for (const raw of lines) {
            const line = raw.trim(),
              m = /^(frame|out_time_us|total_size)=(.*)$/.exec(line);
            if (m) block[m[1]] = m[2];
            else if (line.startsWith("progress=")) {
              const now = JSON.stringify(block);
              heard = Date.now();
              if (now !== state) {
                state = now;
                idle = 0;
              }
            }
          }
          return;
        }
        stdout += b.toString();
        if (stdout.length > maxOutput) {
          stop();
          stdout = stdout.slice(-maxOutput);
        }
        if (progress) this.onProgress?.(stdout.slice(-4096));
      });
      child.stderr.on("data", (b) => {
        stderr = (stderr + b.toString()).slice(-24000);
        onStderr?.(b.toString());
      });
      const finish = (error, code) => {
        if (settled) return;
        settled = true;
        this.children.delete(child);
        if (timer) clearTimeout(timer);
        if (watch) clearInterval(watch);
        signal?.removeEventListener("abort", stop);
        if (signal?.aborted)
          reject(
            Object.assign(Error("Traitement interrompu"), {
              name: "AbortError",
            }),
          );
        else if (stalled)
          reject(
            Object.assign(
              Error(
                `Le moteur vidéo n’avançait plus depuis ${stallText(stall)} : il a été arrêté plutôt que d’attendre sans fin.`,
              ),
              { code: "JUNO_STALL", stall },
            ),
          );
        else if (error) reject(error);
        else if (code !== 0)
          reject(
            Error(
              stderr.trim().split("\n").slice(-12).join("\n") ||
                "Le moteur vidéo a échoué",
            ),
          );
        else resolve({ stdout, stderr });
      };
      child.on("error", (e) => finish(e));
      child.on("close", (code) => finish(null, code));
    });
  }
  ff(args, options = {}) {
    return this.run(
      this.ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        // Le suivi que lit le garde-fou de `run` (`stall`).
        ...(options.stall > 0 ? ["-progress", "pipe:1"] : []),
        "-loglevel",
        "error",
        "-threads",
        "2",
        "-filter_threads",
        "2",
        "-filter_complex_threads",
        "2",
        ...args.flatMap((a, i) =>
          a === "-i" ? ["-protocol_whitelist", "file,pipe", a] : [a],
        ),
      ],
      options,
    );
  }
  async probe(file) {
    const { stdout } = await this.run(
      this.ffprobe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-show_format",
        "-show_streams",
        "-show_stream_groups",
        "-of",
        "json",
        file,
      ],
      { timeout: 45000 },
    );
    const p = JSON.parse(stdout),
      tileGrid = p.stream_groups?.find((g) => g.type === "Tile Grid")
        ?.components?.[0],
      v = p.streams.find(
        (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
      ),
      // La piste son de l'app (`soundOf`) : un fichier dont aucune piste son
      // n'est utilisable est traité comme muet.
      a = soundOf(p.streams);
    if (!v && !a) throw Error("Aucune piste vidéo ou audio lisible");
    const stat = await fs.stat(file),
      ext = path.extname(file).toLowerCase(),
      still = require("../media-formats.json"),
      kind =
        [...still.photo, ...still.nativePhoto].includes(ext.slice(1)) ||
        (!a &&
          (!Number(p.format.duration) || Number(v?.nb_frames) === 1) &&
          [
            "image2",
            "gif",
            "apng",
            "ico",
            "jpeg_pipe",
            "png_pipe",
            "webp_pipe",
            "bmp_pipe",
            "tiff_pipe",
            "avif",
          ].some((f) => (p.format.format_name || "").split(",").includes(f)))
          ? "image"
          : v
            ? "video"
            : "audio";
    const rational = (x) => {
      const [n, d] = (x || "25/1").split("/").map(Number);
      return n > 0 && d > 0 ? { n, d } : { n: 25, d: 1 };
    };
    const fps = rational(v?.avg_frame_rate || v?.r_frame_rate),
      container = Number(p.format.duration || v?.duration || a?.duration || 0),
      frames = Number(v?.nb_frames),
      origin = Number(p.format.start_time) || 0;
    let picture =
      Number(v?.duration) || (frames > 0 ? (frames * fps.d) / fps.n : 0);
    // Un Matroska (.mkv, .webm) n'annonce ni la durée ni le nombre d'images
    // de sa piste image : la durée retombait sur celle du conteneur, son
    // compris, et le plan posé en entier gagnait au film une image finale
    // noire là où le moniteur garde la dernière image (29/09/2026). La fin
    // de l'image se lit alors dans l'étiquette DURATION de la piste, sinon
    // dans ses derniers paquets. Les autres formats n'en lisent pas plus.
    if (kind === "video" && !(picture > 0))
      picture = await this.pictureEnd(file, v, origin, container, fps);
    // Une vidéo dure ce que dure son image. Le conteneur prend la plus longue
    // piste : un son qui déborde de 30 ms faisait poser une image de trop,
    // noire, au bout de chaque plan posé en entier.
    const duration =
      kind === "video" && Number.isFinite(picture) && picture > 0
        ? Math.min(picture, container || picture)
        : container;
    if (
      kind !== "image" &&
      (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
    )
      throw Error("Durée du média inconnue ou supérieure à 24 h");
    const meta = {
      kind,
      size: stat.size,
      duration: kind === "image" ? 5 : duration,
      width: tileGrid?.width || v?.width || 0,
      height: tileGrid?.height || v?.height || 0,
      tileGrid: !!tileGrid,
      fps,
      codec: v?.codec_name || a?.codec_name || "",
      pixelFormat: v?.pix_fmt || "",
      bits:
        Number(v?.bits_per_raw_sample) ||
        (/(?:16|48|64)/.test(v?.pix_fmt)
          ? 16
          : /10/.test(v?.pix_fmt)
            ? 10
            : /12/.test(v?.pix_fmt)
              ? 12
              : /14/.test(v?.pix_fmt)
                ? 14
                : 8),
      audioChannels: a?.channels || 0,
      sampleRate: Number(a?.sample_rate) || 0,
      color: {
        primaries: v?.color_primaries || "unknown",
        transfer: v?.color_transfer || "unknown",
        matrix: v?.color_space || "unknown",
        range: v?.color_range || "unknown",
      },
      timecode: v?.tags?.timecode || p.format.tags?.timecode || "",
      // L'heure de tournage, pour ranger les rushes dans l'ordre de la
      // journée (dérushage, pré-montage).
      recorded: recordedAt(p.format.tags, v?.tags),
      camera: cameraOf(p.format, p.streams, file),
      rotation: Number(
        v?.side_data_list?.find((s) => s.rotation !== undefined)?.rotation || 0,
      ),
    };
    // Les durées du conteneur et du son servent aux contrôles (reconnexion,
    // voix améliorée) sans entrer dans la fiche du média : non énumérables,
    // elles ne sont ni recopiées par « ...meta » ni enregistrées. Un son
    // Matroska n'annonce pas non plus sa durée : son étiquette, sinon celle
    // du conteneur, que le média prenait avant d'être borné à son image.
    Object.defineProperties(meta, {
      containerDuration: { value: container, enumerable: false },
      audioDuration: {
        value:
          Number(a?.duration) ||
          (clockTag(a?.tags) > 0 ? clockTag(a.tags) - origin : 0) ||
          (a ? container : 0),
        enumerable: false,
      },
    });
    return meta;
  }
  /**
   * La fin de la dernière image d'une piste qui n'annonce ni sa durée ni son
   * nombre d'images, en secondes depuis le début du fichier ; zéro si elle
   * reste inconnue (la durée du conteneur s'applique alors, comme avant).
   *
   * L'étiquette DURATION d'une piste Matroska vaut la fin de sa dernière
   * image pour FFmpeg (OBS, remux), sa longueur pour mkvmerge : la première
   * lecture n'est jamais plus longue que l'image, elle est retenue. Sans
   * étiquette (enregistrement interrompu, MediaRecorder), les paquets de la
   * dernière seconde et demie, sans rien décoder, et tout le fichier si
   * l'image s'arrête avant.
   */
  async pictureEnd(file, v, origin, container, fps) {
    const tag = clockTag(v.tags);
    if (tag > 0 && tag - origin > 0) return tag - origin;
    const period = fps.d / fps.n,
      tail = async (from) => {
        const { stdout } = await this.run(
          this.ffprobe,
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            ...(from > 0 ? ["-read_intervals", from.toFixed(6) + "%"] : []),
            "-select_streams",
            String(v.index),
            "-show_entries",
            "packet=pts_time,duration_time",
            "-of",
            "json",
            file,
          ],
          { timeout: 45000 },
        );
        let end = 0;
        for (const p of JSON.parse(stdout).packets || []) {
          const x = Number(p.pts_time),
            d = Number(p.duration_time);
          if (Number.isFinite(x)) end = Math.max(end, x + (d > 0 ? d : period));
        }
        return end > 0 ? end - origin : 0;
      };
    try {
      const from = container > 1.5 ? origin + container - 1.5 : 0;
      return (await tail(from)) || (from > 0 ? await tail(0) : 0);
    } catch {
      return 0;
    }
  }
  /**
   * La piste image d'un fichier telle que FFmpeg la lit : son numéro, sa
   * graduation (base de temps, en secondes), l'instant où commence le fichier,
   * la durée d'une image moyenne (`period`, celle du média à l'import) et la
   * plus longue durée à l'écran d'une image (`gap`, la dernière comprise)
   * quand la table d'échantillons d'un QuickTime / MP4 le donne sans rien
   * lire des images. `regular` : aucune image ne reste plus d'une image
   * moyenne à l'écran. `leading` : la table montre des images de tête (GOP
   * ouvert). Lue une fois par fichier ; `undefined` si elle est illisible.
   *
   * La régularité se jugeait sur la cadence annoncée égale à la cadence
   * moyenne. Le démultiplexeur Matroska (.mkv, .webm) donne toujours la même
   * valeur aux deux, et un rush dont les trous sont compensés plus loin les
   * égale aussi : un plan coupé dans un trou s'ouvrait au film sur l'image
   * d'après le trou (29/09/2026). Hors d'une table d'échantillons, rien ne
   * dit la régularité sans lire toutes les images : `gap` reste inconnu, et
   * `frameStart` lit les paquets.
   *
   * MPEG-TS (.mts, .m2ts, .ts : AVCHD des caméscopes) et MPEG-PS (.mpg,
   * .vob) : FFmpeg compte le temps d'une entrée depuis le premier des flux
   * qu'elle sert, pas depuis le début du fichier, tant que le -ss ne le
   * dépasse pas (fftools, `correct_input_start_times`). L'aperçu du moniteur
   * sert l'image et le son : son zéro (`start`) est le premier des deux. Le
   * rendu, qui ne lit que l'image, voyait son zéro au début de l'image :
   * quand elle commence après le son, tout plan lu sans -ss sortait décalé
   * d'une image sur le moniteur (29/09/2026). `lead` : le début de l'image
   * après ce zéro ; `shift` : ce zéro après le début du fichier, d'où FFmpeg
   * compte un -ss. Tous deux nuls ailleurs.
   *
   * Le son de l'aperçu et du rendu est la piste son de l'app (`soundOf`), que
   * l'un et l'autre nomment explicitement. Le zéro se calcule sur l'image et
   * cette piste seulement, comme FFmpeg, qui ignore les flux qu'il ne lit pas
   * (fftools, `correct_input_start_times`). Il se calculait sur toutes les
   * pistes son, alors que l'aperçu n'en sert qu'une : un MPEG-TS dont une
   * autre piste commençait plus tôt sortait décalé d'environ six images sur
   * chaque plan (29/09/2026).
   * `audioLead` : le début de cette piste après le zéro. Un plan son lu seul
   * (sa piste image n'est pas servie) y trouve son zéro FFmpeg tant que le
   * -ss ne le dépasse pas (render.cjs, `buildSegment`). Nul hors MPEG-TS / PS.
   */
  async videoTrack(file) {
    const stat = await fs.stat(file),
      key = [file, stat.size, stat.mtimeMs].join("|");
    this.tracks ||= new Map();
    if (!this.tracks.has(key)) {
      const { stdout } = await this.run(
        this.ffprobe,
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-show_entries",
          "format=start_time,format_name:stream=index,codec_type,codec_name,width,height,channels,sample_rate,sample_fmt,time_base,r_frame_rate,avg_frame_rate,start_time,duration:stream_disposition=attached_pic:stream_side_data=rotation,displaymatrix",
          "-of",
          "json",
          file,
        ],
        { timeout: 45000 },
      );
      const probe = JSON.parse(stdout),
        streams = probe.streams || [],
        v = streams.find(
          (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
        ),
        [n, d] = String(v?.time_base || "")
          .split("/")
          .map(Number),
        // La cadence du média telle que `probe` la retient à l'import : celle
        // dont le rendu remonte une image (render.cjs, `buildSegment`).
        [fn, fd] = String(v?.avg_frame_rate || v?.r_frame_rate || "")
          .split("/")
          .map(Number),
        period = fn > 0 && fd > 0 ? fd / fn : 1 / 25,
        family = String(probe.format?.format_name || "").split(","),
        discont = family.some((f) => SPLICED.includes(f)),
        origin = Number(probe.format?.start_time) || 0,
        began = (s) => Number(s?.start_time),
        sound = soundOf(streams),
        zero = discont
          ? Math.min(...[v, sound].map(began).filter(Number.isFinite))
          : origin,
        start = Number.isFinite(zero) ? Math.max(origin, zero) : origin,
        table =
          v && family.includes("mov")
            ? await sampleTable(file, v.index, Number(v.duration)).catch(
                () => undefined,
              )
            : undefined,
        gap = table?.gap;
      this.tracks.set(
        key,
        v && {
          index: v.index,
          // La définition de l'image au début du fichier, et sa rotation
          // (render.cjs, `buildSegment`).
          width: Number(v.width) || 0,
          height: Number(v.height) || 0,
          rotation: Number(
            v.side_data_list?.find((x) => x.rotation !== undefined)?.rotation ||
              0,
          ),
          // Sa matrice d'affichage, telle que la pose le conteneur
          // (`pictureShape`).
          matrix: displayMatrix(
            v.side_data_list?.find((x) => x.displaymatrix !== undefined)
              ?.displaymatrix,
          ),
          tick: n > 0 && d > 0 ? n / d : 0,
          timeBase: n > 0 && d > 0 ? { n, d } : undefined,
          start,
          period,
          gap,
          regular: gap !== undefined && gap <= period + 1e-9,
          leading: !!table?.leading,
          discont,
          lead:
            discont && Number.isFinite(began(v))
              ? Math.max(0, began(v) - start)
              : 0,
          audioLead:
            discont && Number.isFinite(began(sound))
              ? Math.max(0, began(sound) - start)
              : 0,
          shift: start - origin,
          // QuickTime / MP4, Matroska et MPEG-TS déclarent leurs pistes et
          // leurs bases de temps dans l'en-tête : les paquets se lisent sans
          // l'analyse des flux, qui coûtait les trois quarts d'une lecture
          // (42 ms contre 11 sur un .mkv 1080p). Mêmes paquets image, vérifié
          // image par image sur des .mts, .m2ts et .ts H.264, HEVC et MPEG-2.
          declared:
            family.includes("mov") ||
            family.includes("matroska") ||
            family.includes("mpegts"),
        },
      );
      while (this.tracks.size > 200)
        this.tracks.delete(this.tracks.keys().next().value);
    }
    return this.tracks.get(key);
  }
  /**
   * L'image que le graphe d'un plan reçoit de la piste image d'un fichier
   * (`videoTrack`, `index`), lue sur sa première image, décodée par FFmpeg
   * comme au rendu. Le rendu la fige à cette définition (render.cjs,
   * `buildSegment`) : FFmpeg ne reconstruit plus le graphe quand elle change
   * en cours de fichier.
   * - `width`, `height` : sa définition une fois fait le recadrage que porte
   *   le conteneur (atome « clap » d'un QuickTime ou d'un MP4, « PixelCrop »
   *   d'un Matroska), que FFmpeg fait seul, avant tout filtre du plan. Elle
   *   se lisait sur la description du flux, avant ce recadrage : l'image
   *   recadrée était étirée à la taille d'origine, et le film n'était plus
   *   l'image du moniteur (MOV 640x360 recadré à 560x360 : 1,778 au film,
   *   1,556 au moniteur, 30/09/2026).
   * - `turn` : les filtres qui la redressent, ceux que FFmpeg pose seul d'après
   *   la matrice d'affichage du conteneur (fftools,
   *   `configure_input_video_filter`, FFmpeg 9.0.2), vide pour une image
   *   droite ; `own` : le rendu les pose lui-même, après l'avoir figée, et
   *   FFmpeg ne redresse plus rien (« -noautorotate »). Posés par FFmpeg, ils
   *   venaient avant elle et ne suivaient pas un changement de définition :
   *   le rush tourné d'un téléphone dont la définition change en cours de
   *   fichier figeait le segment, à chaque reprise (30/09/2026).
   *
   * `null` quand l'app ne sait pas reproduire ce que fait FFmpeg (rotation
   * portée par les images seules, message SEI d'un H.264 ou d'un HEVC, ou
   * contraire à celle du conteneur) ou que la première image ne se lit pas :
   * le plan garde alors le chemin d'avant, image par image identique.
   */
  async pictureShape(file) {
    const track = await this.videoTrack(file);
    if (!track) return null;
    const stat = await fs.stat(file),
      key = [file, stat.size, stat.mtimeMs].join("|");
    this.shapes ||= new Map();
    if (!this.shapes.has(key)) {
      let shape = null;
      const first = async (upright) =>
        (
          await this.run(
            this.ffmpeg,
            [
              "-hide_banner",
              "-nostdin",
              "-nostats",
              "-loglevel",
              "info",
              "-threads",
              "2",
              ...(upright ? [] : ["-noautorotate"]),
              "-protocol_whitelist",
              "file,pipe",
              "-i",
              file,
              "-map",
              "0:" + track.index,
              "-frames:v",
              "1",
              "-vf",
              "showinfo",
              "-f",
              "null",
              "-",
            ],
            { timeout: 45000 },
          )
        ).stderr;
      try {
        shape = readShape(await first(false), track.matrix);
        // Rotation portée par les images seules (message SEI d'un H.264 ou
        // d'un HEVC) : FFmpeg la fait seul, et le plan est figé après elle, à
        // la définition de l'image redressée. Figé à celle d'avant, il était
        // étiré ; laissé libre, un segment de plusieurs plans se figeait.
        if (shape === CARRIED) {
          const upright = readShape(await first(true), undefined);
          // Redressée, l'image ne porte plus de matrice.
          shape =
            typeof upright === "object" && upright && !upright.own
              ? { ...upright, turn: [], own: false }
              : null;
        }
        // Le format où l'image est redressée : celui du décodeur quand les
        // filtres de redressement l'acceptent, sinon celui que négocie la
        // suite du plan, comme quand FFmpeg les posait seul (`turnAccepts`).
        if (shape?.turn.length) {
          const pixel = (await this.pixelFormats()).get(shape.format);
          if (!pixel) shape = null;
          else shape.native = shape.turn.every((f) => turnAccepts(f, pixel));
        }
      } catch {
        shape = null;
      }
      this.shapes.set(key, shape);
      while (this.shapes.size > 200)
        this.shapes.delete(this.shapes.keys().next().value);
    }
    return this.shapes.get(key);
  }
  /**
   * Les formats d'image que connaît FFmpeg, par nom : sous-échantillonnage
   * de la chrominance et drapeaux (`ffprobe -show_pixel_formats`). Lus une
   * fois.
   */
  async pixelFormats() {
    this.formats ||= this.run(
      this.ffprobe,
      ["-v", "error", "-show_pixel_formats", "-of", "json"],
      { timeout: 45000 },
    ).then(
      ({ stdout }) =>
        new Map(
          (JSON.parse(stdout).pixel_formats || []).map((f) => [f.name, f]),
        ),
      (e) => {
        this.formats = undefined;
        throw e;
      },
    );
    return this.formats;
  }
  /**
   * La graduation de la piste image d'un fichier, en secondes (sa base de
   * temps), ou zéro si elle est illisible. Le rendu y cale ses -ss : FFmpeg
   * arrondit le décalage d'un -ss à cette graduation, jusqu'à 20 ms sur une
   * base de 1/25 (render.cjs, `readWindow`). Lue une fois par fichier.
   */
  async videoTick(file) {
    return (await this.videoTrack(file))?.tick || 0;
  }
  /**
   * Le pas où poser un -ss dans ce fichier, en secondes : la plus petite
   * suite de graduations de sa piste image qui tombe sur une microseconde
   * entière (3 graduations de 1/600 s, soit 5 ms ; 8 de 1/12800 s). Posé
   * sur une graduation seule, un -ss laissait l'instant de chaque image
   * arrondi à la microseconde autrement que ne le compte le navigateur, et
   * une image qui commence à la microseconde de la marge de l'export passait
   * au film ou non selon le point de lecture (render.cjs, `readWindow`).
   * Une graduation seule quand ce pas dépasserait 0,1 s.
   */
  async seekGrain(file) {
    const track = await this.videoTrack(file);
    if (!track?.timeBase) return track?.tick || 0;
    const { n, d } = track.timeBase,
      gcd = (a, b) => (b ? gcd(b, a % b) : a),
      grain = ((d / gcd(d, n * 1e6)) * n) / d;
    return grain <= 0.1 ? grain : track.tick;
  }
  /**
   * L'instant, compté depuis le zéro du moniteur (`videoTrack`, `start`), où
   * commence l'image à l'écran à `t` secondes : la dernière image de la piste
   * commencée à cet instant. Lu dans les paquets autour de `t`, sans rien
   * décoder ; `undefined` quand rien n'est à lire ou que le fichier est
   * illisible. Voir `seekPoint`.
   */
  async frameStart(file, t, period) {
    return (await this.seekPoint(file, t, period))?.shown;
  }
  /**
   * Où le rendu peut poser le -ss d'un plan dont l'image à l'écran à `t`
   * secondes doit sortir au film, compté depuis le zéro du moniteur :
   * - `shown` : l'instant où cette image commence (voir `frameStart`).
   *
   *   Sur un rush à cadence variable, cette image a pu commencer bien plus
   *   d'une image moyenne avant `t` : images sautées d'un iPhone, écran
   *   immobile d'un enregistrement d'écran, dernière image figée. Le rendu,
   *   qui ne relisait qu'une image moyenne en arrière, la perdait, et le plan
   *   s'ouvrait sur l'image d'après (render.cjs, `buildSegment`). Quand la
   *   table d'échantillons garantit qu'aucune image ne dure plus de `period`
   *   (par défaut, une image moyenne), elle commence moins de `period` avant :
   *   rien à lire. Partout ailleurs, et en Matroska toujours, les paquets
   *   sont lus.
   * - `key` : le -ss doit rester avant cet instant, pour que FFmpeg commence
   *   à décoder à une image clé d'où cette image se décode. En MPEG-TS et
   *   MPEG-PS, FFmpeg atterrit sur la première image clé qui suit le -ss :
   *   un plan ouvert au milieu d'un GOP restait figé sur l'image clé suivante.
   *   En QuickTime / MP4 à GOP ouvert, il atterrit sur l'image clé dont
   *   l'image cherchée est une image de tête, et la jette : le plan s'ouvrait
   *   sur l'image clé (29/09/2026). `key` est alors le début de décodage (dts)
   *   de l'image clé à dépasser vers l'arrière : la dernière montrée au plus
   *   tard avec l'image cherchée en MPEG-TS / PS, celle dont elle est l'image
   *   de tête en QuickTime / MP4. Inutile ailleurs : `undefined`.
   * - `lead` et `shift` : ceux de `videoTrack`.
   */
  async seekPoint(file, t, period) {
    const track = await this.videoTrack(file);
    if (!track || !(t >= 0)) return undefined;
    const point = { lead: track.lead || 0, shift: track.shift || 0 };
    if (
      track.gap !== undefined &&
      track.gap <= (period > 0 ? period : track.period) + 1e-9 &&
      !track.leading &&
      !track.discont
    )
      return point;
    const at = track.start + t;
    // La lecture part d'une image clé d'avant, qui ne peut pas être plus
    // tardive que l'image cherchée : celle-ci est toujours lue, sauf en
    // MPEG-TS / PS où FFmpeg atterrit après le point demandé. On remonte
    // alors plus loin tant que l'image clé qui la précède n'est pas lue.
    // Une seconde après, pour les images réordonnées (images B).
    for (const back of track.discont ? [1.2, 5, 20, 80] : [0.5]) {
      const from = Math.max(0, at - back),
        stdout = await this.run(
          this.ffprobe,
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            ...(track.declared ? ["-nofind_stream_info"] : []),
            "-read_intervals",
            `${from.toFixed(6)}%${(at + 1).toFixed(6)}`,
            "-select_streams",
            String(track.index),
            "-show_entries",
            "packet=pts_time,dts_time,flags",
            "-of",
            "json",
            file,
          ],
          { timeout: 45000 },
        ).then(
          (r) => r.stdout,
          () => undefined,
        );
      // ffprobe ne lit pas un MPEG-PS (.mpg, .vob) par intervalles : FFmpeg
      // y cherche, et recopie les paquets sans les décoder.
      const packets = stdout
        ? (JSON.parse(stdout).packets || []).map((p) => ({
            pts: Number(p.pts_time),
            dts: Number(p.dts_time),
            key: String(p.flags || "").includes("K"),
          }))
        : track.discont
          ? await this.copiedPackets(file, track, from, at + 1).catch(
              () => undefined,
            )
          : undefined;
      // Illisible : le zéro et le début de l'image restent justes.
      if (!packets) return point;
      // L'image à l'écran à `at`, et sa place dans l'ordre de décodage.
      let shown = -1;
      packets.forEach((p, i) => {
        if (
          Number.isFinite(p.pts) &&
          p.pts <= at + 1e-6 &&
          !(shown >= 0 && packets[shown].pts >= p.pts)
        )
          shown = i;
      });
      if (shown < 0) {
        if (from > track.start) continue;
        return point;
      }
      const image = packets[shown],
        begin = (p) => (Number.isFinite(p.dts) ? p.dts : p.pts);
      let clean, last;
      for (let i = 0; i <= shown; i++)
        if (packets[i].key) {
          last = packets[i];
          if (packets[i].pts <= image.pts + 1e-6) clean = packets[i];
        }
      const key = track.discont
        ? clean && begin(clean)
        : last && last.pts > image.pts + 1e-6
          ? begin(last)
          : undefined;
      if (track.discont && key === undefined && from > track.start) continue;
      return {
        ...point,
        shown: image.pts - track.start,
        key: Number.isFinite(key) ? key - track.start : undefined,
      };
    }
    return point;
  }
  /**
   * Les paquets de la piste image de `from` à `to` (instants du fichier, en
   * secondes), lus par FFmpeg lui-même : un -ss, puis une copie sans décodage
   * vers le format « framecrc », qui donne pour chaque paquet ses instants de
   * décodage et d'affichage et s'il est une image clé. Pour les fichiers que
   * ffprobe ne sait pas lire par intervalles (MPEG-PS).
   */
  async copiedPackets(file, track, from, to) {
    const origin = track.start - (track.shift || 0),
      { stdout } = await this.run(
        this.ffmpeg,
        [
          "-hide_banner",
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-copyts",
          ...(from > origin ? ["-ss", (from - origin).toFixed(6)] : []),
          "-i",
          file,
          "-map",
          "0:" + track.index,
          "-c",
          "copy",
          "-copyinkf",
          "-to",
          to.toFixed(6),
          "-f",
          "framecrc",
          "-",
        ],
        { timeout: 45000 },
      );
    const [, n, d] = /^#tb 0: (\d+)\/(\d+)/m.exec(stdout) || [];
    if (!(n > 0 && d > 0)) return undefined;
    return stdout
      .split("\n")
      .filter((line) => /^\d+,/.test(line))
      .map((line) => {
        const f = line.split(",").map((x) => x.trim()),
          flags = /^F=0x([0-9a-f]+)$/i.exec(f[6] || "");
        return {
          dts: (Number(f[1]) * n) / d,
          pts: (Number(f[2]) * n) / d,
          key: !flags || (parseInt(flags[1], 16) & 1) === 1,
        };
      });
  }
  /**
   * Ce qu'il faut ajouter au -ss d'une entrée de ce fichier, en secondes :
   * FFmpeg le compte depuis le début du fichier, le moniteur depuis son zéro
   * (`videoTrack`, `shift`). Zéro hors MPEG-TS / PS.
   */
  async seekShift(file) {
    return (await this.videoTrack(file))?.shift || 0;
  }
  /**
   * Où commence le son du média après le zéro du moniteur, en secondes
   * (`videoTrack`, `audioLead`) : là où FFmpeg compte le temps d'une entrée
   * qui ne sert que le son, lue sans -ss ou avec un -ss qui tombe avant.
   * Zéro hors MPEG-TS / PS.
   */
  async audioLead(file) {
    return (await this.videoTrack(file))?.audioLead || 0;
  }
  /**
   * Les pistes son d'un fichier, dans l'ordre, et la piste son de l'app
   * (`soundOf`) : `index`, son numéro de flux, que nomment « -map 0:n » et,
   * dans un graphe de filtres, « [entrée:n] » ; `usable`, le nombre de
   * pistes son utilisables. `null` quand aucune ne l'est. Lue une fois par
   * version du fichier.
   */
  async soundTrack(file) {
    const stat = await fs.stat(file),
      key = [file, stat.size, stat.mtimeMs].join("|");
    this.sounds ||= new Map();
    if (!this.sounds.has(key)) {
      const { stdout } = await this.run(
          this.ffprobe,
          [
            "-v",
            "error",
            "-protocol_whitelist",
            "file,pipe",
            "-show_entries",
            "stream=index,codec_type,codec_name,channels,sample_rate,sample_fmt",
            "-of",
            "json",
            file,
          ],
          { timeout: 45000 },
        ),
        streams = JSON.parse(stdout).streams || [],
        sounds = streams.filter((s) => s.codec_type === "audio"),
        chosen = soundOf(streams);
      this.sounds.set(
        key,
        chosen
          ? {
              index: chosen.index,
              channels: Number(chosen.channels),
              sampleRate: Number(chosen.sample_rate),
              count: sounds.length,
              usable: sounds.filter((s) => soundOf([s])).length,
            }
          : null,
      );
      while (this.sounds.size > 200)
        this.sounds.delete(this.sounds.keys().next().value);
    }
    return this.sounds.get(key);
  }
  /**
   * Ce qui désigne la piste son de l'app dans une commande FFmpeg dont ce
   * fichier est l'entrée `input` : « -map input:n ». Vide quand le fichier
   * n'a aucune piste son utilisable.
   */
  async soundMap(file, input = 0) {
    const sound = await this.soundTrack(file);
    return sound ? ["-map", input + ":" + sound.index] : [];
  }
  /**
   * L'aperçu d'un média fabriqué avant le 30/09/2026 est-il à refaire ?
   *
   * Sans « -map », FFmpeg servait à l'aperçu la piste son qu'il choisit seul
   * (`legacySound`). Avec une seule piste son utilisable, il ne pouvait
   * servir qu'elle : une piste inutilisable n'a aucun paquet (vide) ou
   * faisait échouer l'aperçu (indécodable), et le média n'était alors pas
   * importé. Avec plusieurs, son choix se rejoue. La piste de l'app, et
   * l'aperçu est gardé sans rien écouter, sauf sur un MPEG-TS ou un MPEG-PS
   * dont l'image ne commence pas au zéro du moniteur (`proxyStarts`), ou
   * quand il n'a aucun son (silence numérique, sous `HUSH`) : rien n'y dit
   * ce qu'il sert. Une autre, et il est refait, à moins que son son prouve
   * qu'il sert déjà celle de l'app et pas l'autre (`proxyHears`, `other`) :
   * un aperçu refait depuis dont la marque manque (fichier recopié sous une
   * autre date) n'est pas refait pour rien. Quand le choix ne se rejoue pas
   * (un autre FFmpeg que celui des versions qui fabriquaient ces aperçus, un
   * échec), l'aperçu est seulement écouté (`proxyHears`). La revue coûte 20
   * à 110 ms par média quand l'aperçu est gardé (rush de 10 min compris), 0,1
   * à 0,5 s quand il est refait, et le rush n'est jamais lu en entier.
   * Tout refaire coûtait un aperçu par média à deux pistes (un mariage entier
   * en .mts), pour des aperçus déjà justes (30/09/2026). `proxy` : l'aperçu
   * en place ; sans lui, tout média à plusieurs pistes utilisables est à
   * refaire.
   *
   * Il était jugé sur son son seul, aux trois passages où il en avait le
   * plus : sur un rush dont la piste de l'app mêle deux micros-cravates (A,
   * puis B de 9,5 à 37,5 s) et dont l'aperçu servait la piste de A seul,
   * « par défaut », les trois passages tombaient pendant que A parlait, là où
   * les deux pistes se ressemblent. L'aperçu faux était jugé juste, marqué,
   * et plus jamais revu : le moniteur taisait B, que le film fait entendre
   * (30/09/2026).
   *
   * L'aperçu est aussi refait quand la fiche du média ne décrit pas cette
   * piste (`asset.audioChannels`, lue sur la première piste son avant le
   * 30/09/2026) : un MPEG-TS à première piste vide avait un moniteur sonore et
   * un film muet. La tâche relit alors la fiche et l'onde (index.cjs,
   * `doProxy`).
   */
  async proxyStale(file, asset = {}, proxy, { signal } = {}) {
    const sound = await this.soundTrack(file);
    if ((Number(asset.audioChannels) || 0) !== (sound?.channels || 0))
      return true;
    if ((sound?.usable || 0) < 2) return false;
    if (!proxy) return true;
    const served = await this.legacySound(file, { signal });
    if (!(await this.proxyStarts(file, proxy, { signal }))) return true;
    if (served !== sound.index)
      return !(await this.proxyHears(file, proxy, asset, sound, {
        signal,
        other: served,
      }));
    try {
      // La lecture s'arrête au premier son.
      const loud = (x) => x >= HUSH * HUSH;
      return !(
        await this.soundLevels(proxy, "0:a:0", { signal, until: loud })
      ).some(loud);
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      return true;
    }
  }
  /**
   * La piste son que sert un aperçu fabriqué sans « -map » (Juno Studio 1.0
   * à 1.2.x) : son numéro de flux, ou `undefined` quand rien ne permet de le
   * dire.
   *
   * FFmpeg la choisit seul (fftools, `map_auto_audio`) : la plus forte note,
   * qui vaut ses canaux, plus 5 000 000 si elle est « par défaut », plus
   * 100 000 000 si FFmpeg a lu un de ses paquets en ouvrant le fichier ; à
   * égalité, la première. Ce dernier terme ne se lit dans aucune description
   * du fichier : une piste qui commence 8 s après les autres n'est pas lue à
   * l'ouverture, et c'est une autre qui est servie, même moins riche en
   * canaux et pas « par défaut ». Il ne dépend pourtant que du fichier et de
   * FFmpeg : le même FFmpeg, ouvrant le même fichier avec les mêmes options
   * d'entrée que l'aperçu d'alors (`ff`, `proxy`), refait le même choix, et
   * l'imprime (« Stream mapping »). Il ne lit pour cela que ce que lit
   * l'ouverture (0,1 à 6 Mo au début du fichier, deux ou trois
   * déplacements) : 10 à 50 ms, sur un rush de 10 min comme sur un de 12 s.
   *
   * Vérifié contre les aperçus du vrai moteur et du vrai FFmpeg de la 1.2.0,
   * sur 51 combinaisons (ordre, canaux, « par défaut », piste vide, piste qui
   * commence tard ; MOV, MP4, MKV, MPEG-TS, M2TS, AVI, NUT, son seul) : le
   * choix rejoué est celui qu'a servi l'aperçu, 51 fois sur 51 ; la note sans
   * son dernier terme se trompait sur les 9 où une piste commence tard.
   *
   * Toutes les versions qui fabriquaient ces aperçus embarquaient FFmpeg
   * 9.0.2 (`LEGACY_FFMPEG`) : avec un autre, l'ouverture pourrait lire
   * d'autres paquets, et rien n'est dit.
   */
  async legacySound(file, { signal } = {}) {
    if (!LEGACY_FFMPEG.test(this.status.version || "")) return undefined;
    try {
      const { stderr } = await this.run(
          this.ffmpeg,
          [
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "info",
            "-threads",
            "2",
            "-filter_threads",
            "2",
            "-filter_complex_threads",
            "2",
            "-protocol_whitelist",
            "file,pipe",
            "-i",
            file,
            // Seul le son est servi : le choix de FFmpeg n'en dépend pas, et
            // rien ne se décode.
            "-vn",
            "-sn",
            "-dn",
            "-c",
            "copy",
            "-t",
            "0",
            "-f",
            "null",
            "-",
          ],
          { timeout: 45000, signal },
        ),
        served = [
          ...stderr.matchAll(/Stream #0:(\d+)\s*(?:\([^)]*\)\s*)?->\s*#0:\d+/g),
        ].map((m) => Number(m[1]));
      return served.length === 1 ? served[0] : undefined;
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      return undefined;
    }
  }
  /**
   * L'image de l'aperçu `proxy` commence-t-elle là où le moniteur l'attend ?
   *
   * Sur un MPEG-TS ou un MPEG-PS, l'aperçu garde le zéro de l'image et de la
   * piste qu'il sert : son image doit commencer là où celle du rush commence
   * après le zéro du moniteur (`videoTrack`, `lead`), à une demi-image près,
   * sinon il est décalé. Toujours vrai ailleurs ; un doute vaut non.
   */
  async proxyStarts(file, proxy, { signal } = {}) {
    try {
      const track = await this.videoTrack(file).catch(() => undefined);
      if (!track?.discont) return true;
      const shown = await this.run(
          this.ffprobe,
          [
            "-v",
            "error",
            "-select_streams",
            "V:0",
            "-show_entries",
            "stream=start_time",
            "-of",
            "json",
            proxy,
          ],
          { timeout: 45000, signal },
        ),
        begins = Number(JSON.parse(shown.stdout).streams?.[0]?.start_time);
      // Un aperçu fabriqué par la 1.2.x sans « -enc_time_base » a ses
      // instants recalés sur la cadence : son image commence jusqu'à une
      // demi-image autour du zéro, sur tous ses aperçus, et ce n'est pas un
      // défaut de piste. Une autre piste servie décale bien plus : 0,2 s
      // pour une piste qui commence 0,2 s avant l'image.
      return (
        Number.isFinite(begins) &&
        Math.abs(begins - track.lead) <= track.period / 2 + 0.002
      );
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      return false;
    }
  }
  /**
   * L'aperçu `proxy` fait-il entendre ce que fera entendre le film ? Sert
   * quand la piste qu'il sert ne se rejoue pas (`legacySound`), ou quand
   * elle n'est pas celle de l'app (`other`, son numéro de flux) : l'aperçu
   * ne passe alors que s'il prouve qu'il ne sert pas cette autre piste, sur
   * une fenêtre au moins où il est la piste de l'app et nettement pas
   * l'autre (`otherSound`). Là où les deux pistes se ressemblent, rien n'est
   * prouvé, et l'aperçu est refait.
   *
   * Son son est comparé à celui de la piste de l'app (`sound`) sur des
   * fenêtres d'une seconde réparties sur tout le média, de 12 à 24 selon sa
   * durée (lues par -ss : le rush n'est jamais lu en entier), et sur les
   * passages de deux secondes où l'aperçu a le plus de son (`loudPassages`,
   * trois au plus). Là où l'aperçu a du son, il doit être celui de la piste :
   * même forme d'onde, au décalage près, et même niveau (`sameSound`). Là où
   * il se tait, la piste doit pouvoir se taire aussi : si elle a du son à
   * tout décalage possible, l'aperçu en sert une autre. Une seule fenêtre qui
   * ne correspond pas, et l'aperçu est refait. Il l'est aussi quand rien ne
   * permet de conclure (moins de deux fenêtres sonores qui correspondent sur
   * un média de plus de 6 s, aucune sinon) et au moindre doute (fichier
   * illisible).
   *
   * Les passages forts seuls ne suffisaient pas : sur le rush aux deux
   * micros-cravates (`proxyStale`), ils tombaient tous là où les deux pistes
   * se ressemblent. Pris au quart, à la moitié et aux trois quarts du média
   * non plus : un silence des deux côtés y valait accord, et un rush dont les
   * trois tombaient dans des pauses de la parole gardait l'aperçu du
   * micro-cravate au lieu du micro caméra (30/09/2026). Un fond de salle
   * suffit à conclure : même à -80 dB, la corrélation distingue le micro qui
   * l'a enregistré d'un autre.
   */
  async proxyHears(file, proxy, asset, sound, { signal, other } = {}) {
    try {
      // Un instant de l'aperçu et le même instant de la piste de l'app, lue
      // seule, peuvent ne pas porter le même nombre : FFmpeg compte le temps
      // d'une entrée depuis le début du fichier ou depuis le premier des flux
      // qu'il lit, selon le -ss (voir `videoTrack`). L'écart ne dépasse
      // jamais celui des débuts des flux du fichier : la recherche du son
      // s'élargit d'autant, jusqu'à 5 s (un son qui commence 1,5 s après
      // l'image sortait sinon de la marge).
      const streams =
          JSON.parse(
            (
              await this.run(
                this.ffprobe,
                [
                  "-v",
                  "error",
                  "-show_entries",
                  "stream=codec_type,start_time",
                  "-of",
                  "json",
                  file,
                ],
                { timeout: 45000, signal },
              )
            ).stdout,
          ).streams || [],
        starts = streams
          .filter((x) => ["video", "audio"].includes(x.codec_type))
          .map((x) => Number(x.start_time))
          .filter(Number.isFinite),
        spread = starts.length ? Math.max(...starts) - Math.min(...starts) : 0;
      const duration = Number(asset.duration) || 0,
        length = Math.min(2, Math.max(0.5, duration - 0.2)),
        short = Math.min(1, length),
        margin = 1 + Math.min(5, spread),
        count = Math.min(24, Math.max(12, Math.round(duration / 2))),
        range = Math.max(0, duration - short - 0.1),
        windows = [
          ...(
            await this.loudPassages(
              proxy,
              length,
              Math.max(0, duration - length - 0.1),
              { signal },
            )
          ).map((from) => [from, length]),
          ...Array.from({ length: count }, (_, i) => [
            (range * i) / (count - 1),
            short,
          ]),
        ];
      // Le passage d'une piste du fichier qui couvre la fenêtre de l'aperçu,
      // avec la marge. Près du début du fichier, la marge d'avant manque :
      // du silence la remplace, pour que la recherche couvre aussi un son de
      // l'aperçu un peu en avance (délai de l'encodeur AAC, 21 ms).
      const around = async (index, from, span) => {
        const start = Math.max(0, from - margin),
          read = await this.samples(
            file,
            "0:" + index,
            start,
            span + (from - start) + margin,
            { signal },
          ),
          pad = Math.round(Math.max(0, margin - from) * 16000),
          padded = new Float32Array(pad + read.length);
        padded.set(read, pad);
        return padded;
      };
      let agreed = 0,
        proven = other === undefined;
      for (const [from, span] of windows) {
        const heard = await this.samples(proxy, "0:a:0", from, span, {
            signal,
          }),
          wanted = await around(sound.index, from, span);
        if (loudness(heard) >= SILENT) {
          if (!sameSound(heard, wanted)) return false;
          agreed++;
          if (!proven)
            proven = otherSound(heard, await around(other, from, span));
        } else if (heard.length >= 1600 && !canBeSilent(wanted, heard.length))
          return false;
      }
      return proven && agreed >= (duration > 6 ? 2 : 1);
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      return false;
    }
  }
  /**
   * Le son d'un flux de `file` (`map`) entre `from` et `from + length`
   * secondes : mis en stéréo comme dans un aperçu, puis en mono, filtré sous
   * 3 kHz et ramené à 16 kHz, en flottants.
   */
  async samples(file, map, from, length, { signal } = {}) {
    const child = spawn(
      this.ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        ...(from > 0 ? ["-ss", from.toFixed(6)] : []),
        "-t",
        length.toFixed(6),
        "-i",
        file,
        "-map",
        map,
        "-af",
        "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1,lowpass=f=3000,lowpass=f=3000,aresample=16000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.children.add(child);
    const chunks = [],
      stop = () => child.kill("SIGTERM"),
      timer = setTimeout(stop, 60000);
    let stderr = "";
    signal?.addEventListener("abort", stop, { once: true });
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on("data", (b) => chunks.push(b));
        child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-2000)));
        child.on("error", reject);
        child.on("close", (code) =>
          signal?.aborted
            ? reject(Object.assign(Error("Interrompu"), { name: "AbortError" }))
            : code === 0
              ? resolve()
              : reject(Error(stderr || "Son illisible")),
        );
      });
      const b = Buffer.concat(chunks),
        out = new Float32Array(Math.floor(b.length / 4));
      for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
      return out;
    } finally {
      clearTimeout(timer);
      this.children.delete(child);
      signal?.removeEventListener("abort", stop);
    }
  }
  /**
   * Les passages de `length` secondes où le premier son de `file` (un
   * aperçu) est le plus fort, du plus fort au moins fort : trois au plus,
   * disjoints, commençant entre 0 et `last` secondes, et jamais muets
   * (au-dessus de `SILENT`). Voir `proxyHears`.
   */
  async loudPassages(file, length, last, { signal } = {}) {
    const step = 0.25,
      energy = await this.soundLevels(file, "0:a:0", { step, signal }),
      width = Math.max(1, Math.round(length / step)),
      prefix = new Float64Array(energy.length + 1);
    for (let i = 0; i < energy.length; i++)
      prefix[i + 1] = prefix[i] + energy[i];
    const mean = (i) =>
        (prefix[Math.min(energy.length, i + width)] - prefix[i]) / width,
      starts = [];
    for (let i = 0; i < energy.length && i * step <= last + 1e-9; i++)
      starts.push(i);
    starts.sort((a, b) => mean(b) - mean(a) || a - b);
    const picked = [];
    for (const i of starts) {
      if (picked.length === 3 || mean(i) < SILENT * SILENT) break;
      if (picked.every((j) => Math.abs(i - j) >= width)) picked.push(i);
    }
    return picked.map((i) => i * step);
  }
  /**
   * Le niveau d'un flux de `file` (`map`) sur tout le fichier, par tranches
   * de `step` secondes : la moyenne des carrés de ses échantillons, traités
   * comme dans `samples`. La tranche `k` couvre les instants de `k * step` à
   * `(k + 1) * step` tels que les compte un « -ss » : un son qui commence
   * après l'image est précédé d'autant de silence. Lire un aperçu de 10 min
   * (270 Mo) prend une demi-seconde. `until` : la lecture s'arrête à la
   * première tranche qui le vérifie, rendue la dernière.
   */
  async soundLevels(file, map, { step = 0.25, signal, until } = {}) {
    const rate = 8000,
      per = Math.max(1, Math.round(step * rate)),
      child = spawn(
        this.ffmpeg,
        [
          "-hide_banner",
          "-nostdin",
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-i",
          file,
          "-map",
          map,
          "-af",
          `aresample=48000:async=1:first_pts=0,aformat=sample_fmts=fltp:channel_layouts=stereo,pan=mono|c0=0.5*c0+0.5*c1,lowpass=f=3000,lowpass=f=3000,aresample=${rate}`,
          "-f",
          "f32le",
          "pipe:1",
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
    this.children.add(child);
    const bins = [],
      stop = () => child.kill("SIGTERM"),
      timer = setTimeout(stop, 300000);
    let sum = 0,
      count = 0,
      tail = Buffer.alloc(0),
      stderr = "",
      enough = false;
    signal?.addEventListener("abort", stop, { once: true });
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          if (enough) return;
          const b = tail.length ? Buffer.concat([tail, chunk]) : chunk;
          let i = 0;
          for (; i + 4 <= b.length; i += 4) {
            const v = b.readFloatLE(i);
            if (Number.isFinite(v)) sum += v * v;
            if (++count === per) {
              bins.push(sum / per);
              sum = 0;
              count = 0;
              if (until?.(bins[bins.length - 1])) {
                enough = true;
                stop();
                return;
              }
            }
          }
          tail = b.subarray(i);
        });
        child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-2000)));
        child.on("error", reject);
        child.on("close", (code) =>
          signal?.aborted
            ? reject(Object.assign(Error("Interrompu"), { name: "AbortError" }))
            : code === 0 || enough
              ? resolve()
              : reject(Error(stderr || "Son illisible")),
        );
      });
      if (count && !enough) bins.push(sum / count);
      return bins;
    } finally {
      clearTimeout(timer);
      this.children.delete(child);
      signal?.removeEventListener("abort", stop);
    }
  }
  async compositeImage(file, meta, target, { signal } = {}) {
    if (!meta.width || !meta.height || meta.width * meta.height > 100000000)
      throw Error("Image invalide ou supérieure à 100 mégapixels");
    if (/f32|f16/.test(meta.pixelFormat) || /\.(exr|hdr)$/i.test(file))
      throw Error(
        "Image HDR ou flottante : un développement préservant la plage dynamique est requis. L’original est conservé.",
      );
    const temp = target + "." + randomUUID() + ".tif";
    try {
      // Automatic selection assembles HEIF tile groups; mapping 0:v:0 selects only one tile.
      await this.ff(
        [
          "-y",
          "-i",
          file,
          "-frames:v",
          "1",
          "-pix_fmt",
          "rgba64le",
          "-c:v",
          "tiff",
          "-compression_algo",
          "deflate",
          temp,
        ],
        { signal, timeout: 120000 },
      );
      const decoded = await this.probe(temp);
      if (
        !(
          (decoded.width === meta.width && decoded.height === meta.height) ||
          (decoded.width === meta.height && decoded.height === meta.width)
        )
      )
        throw Error(
          "Le décodeur n’a pas restitué les dimensions complètes de l’image",
        );
      await fs.rename(temp, target);
      return target;
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  }
  async imageSource(file, meta, cache, { signal } = {}) {
    const extra = require("../media-formats.json").nativePhoto;
    const ext = path.extname(file).slice(1).toLowerCase(),
      direct = ["jpg", "jpeg", "jpe", "png", "tif", "tiff", "webp", "bmp"];
    if (
      meta.kind !== "image" ||
      (!meta.tileGrid && !extra.includes(ext) && direct.includes(ext))
    )
      return file;
    return this.compositeImage(
      file,
      meta,
      path.join(cache, "image-source.tif"),
      { signal },
    );
  }
  /**
   * Lance FFmpeg pour mesurer, pas pour produire, et renvoie tout le rapport.
   *
   * Deux raisons d'exister à côté de `ff` : les filtres d'analyse
   * (silencedetect, loudnorm, ebur128) écrivent au niveau « info », que `ff`
   * masque avec « -loglevel error » ; et `run` ne conserve que les derniers
   * 24 000 caractères de la sortie d'erreur, ce qui tronquerait l'analyse d'un
   * long discours au beau milieu. Ici la sortie est accumulée entièrement,
   * sous un plafond explicite.
   */
  async analyse(
    args,
    { signal, limit = 8 << 20, timeout = 0, stall = 0 } = {},
  ) {
    let text = "",
      full = true;
    await this.run(
      this.ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        ...(stall > 0 ? ["-progress", "pipe:1"] : []),
        "-loglevel",
        "info",
        "-threads",
        "2",
        "-filter_threads",
        "2",
        ...args.flatMap((a) =>
          a === "-i" ? ["-protocol_whitelist", "file,pipe", a] : [a],
        ),
        "-f",
        "null",
        "-",
      ],
      {
        signal,
        timeout,
        stall,
        onStderr: (chunk) => {
          if (text.length >= limit) {
            full = false;
            return;
          }
          text += chunk;
        },
      },
    );
    return { text, full };
  }
  bitrate({ width = 1920, height = 1080, fps = { n: 25, d: 1 } } = {}) {
    return (
      Math.round(
        Math.max(
          8000,
          Math.min(
            180000,
            16000 *
              Math.pow((width * height) / (1920 * 1080), 0.85) *
              Math.pow(fpsValue(fps) / 25, 0.7),
          ),
        ),
      ) * 1000
    );
  }
  encode({
    quality = "proxy",
    codec = "h264",
    width = 1920,
    height = 1080,
    fps = { n: 25, d: 1 },
  } = {}) {
    if (codec === "dnxhr")
      return [
        "-c:v",
        "dnxhd",
        "-profile:v",
        "dnxhr_hqx",
        "-pix_fmt",
        "yuv422p10le",
      ];
    if (codec === "prores")
      return [
        "-c:v",
        "prores_ks",
        "-profile:v",
        "3",
        "-pix_fmt",
        "yuv422p10le",
      ];
    if (codec === "hevc") {
      const encoder = this.status.encoders.hevc;
      if (!encoder)
        throw Error("Encodeur H.265 / HEVC indisponible sur cette machine");
      return [
        "-c:v",
        encoder,
        ...(encoder === "hevc_videotoolbox" ? ["-allow_sw", "1"] : []),
        "-pix_fmt",
        "p010le",
        "-profile:v",
        "main10",
        "-b:v",
        String(Math.round(this.bitrate({ width, height, fps }) * 0.7)),
        "-tag:v",
        "hvc1",
      ];
    }
    if (codec !== "h264") throw Error("Format d’export inconnu : " + codec);
    const enc = this.status.encoder;
    if (!enc) throw Error("Encodeur H.264 indisponible");
    return [
      "-c:v",
      enc,
      ...(enc === "h264_videotoolbox" ? ["-allow_sw", "1"] : []),
      "-b:v",
      quality === "proxy"
        ? "3500k"
        : String(this.bitrate({ width, height, fps })),
      "-pix_fmt",
      "yuv420p",
      "-bsf:v",
      "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
    ];
  }
  inputFilter(space) {
    if (!space || space === "rec709") return "";
    if (!this.status.spaces.some((s) => s.id === space))
      throw Error("Profil vidéo inconnu");
    return `lut3d=file='${escapeFilter(path.join(this.colorRoot, space + ".cube"))}':interp=tetrahedral,`;
  }
  async tagH264(file, { signal, stall } = {}) {
    const tagged = file + "." + randomUUID() + ".tagged.mp4";
    try {
      await this.ff(
        [
          "-y",
          "-i",
          file,
          "-map",
          "0",
          "-c",
          "copy",
          "-bsf:v",
          "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0",
          "-color_primaries",
          "bt709",
          "-color_trc",
          "bt709",
          "-colorspace",
          "bt709",
          "-movflags",
          "+faststart+write_colr",
          tagged,
        ],
        { signal, stall },
      );
      await fs.rename(tagged, file);
    } finally {
      await fs.unlink(tagged).catch(() => {});
    }
  }
  async proxy(file, asset, target, { signal } = {}) {
    const temp = target + "." + randomUUID() + ".mp4";
    try {
      if (asset.kind === "audio") {
        const sound = await this.soundMap(file);
        if (!sound.length) throw Error("Aucune piste son lisible");
        await this.ff(
          [
            "-y",
            "-i",
            file,
            ...sound,
            "-ac",
            "2",
            "-ar",
            "48000",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            temp,
          ],
          { signal },
        );
      } else {
        await this.ff(
          [
            "-y",
            ...(asset.kind === "image" ? ["-loop", "1"] : []),
            "-i",
            file,
            // Le son de l'app (`soundOf`), nommé, et l'image que décrit
            // `probe` (la première qui n'est pas une vignette) : sans
            // « -map », FFmpeg servait la piste son qu'il choisit seul, et le
            // zéro du moniteur en dépend (`videoTrack`). Un aperçu fabriqué
            // avant est refait au démarrage quand ce choix a pu différer
            // (`proxyStale`, index.cjs, `healProxies`).
            ...(asset.kind === "video"
              ? ["-map", "0:V:0", ...(await this.soundMap(file))]
              : []),
            "-vf",
            `${this.inputFilter(asset.inputSpace)}scale=960:540:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`,
            "-t",
            String(asset.kind === "image" ? 1 : asset.duration),
            // Les images de l'aperçu gardent les instants exacts de la
            // source. Par défaut, FFmpeg les recale sur la cadence annoncée du
            // fichier : jusqu'à une demi-image d'écart sur un rush à cadence
            // variable (iPhone, enregistrement d'écran), 0,8 ms sur un 29,97
            // en base 1/600. Le moniteur lit l'aperçu et l'export la source :
            // l'un montrait alors une autre image que l'autre (29/09/2026).
            ...(asset.kind === "video" ? ["-enc_time_base:v", "demux"] : []),
            ...this.encode(),
            "-c:a",
            "aac",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart+write_colr",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
            temp,
          ],
          { signal },
        );
      }
      if (asset.kind !== "audio") await this.tagH264(temp, { signal });
      await fs.rename(temp, target);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  }
  /**
   * La vignette d'un média, prise un peu après le début.
   *
   * Une photo n'a rien après l'instant zéro, ni une vidéo d'une seule image :
   * un -ss n'y laissait passer aucune image, l'encodeur échouait faute d'image
   * et le média entier était refusé à l'import. Ceux-là sont pris à zéro, et
   * une vidéo trop courte pour la position visée est reprise à zéro aussi.
   */
  async thumbnail(file, asset, target, { signal } = {}) {
    if (asset.kind === "audio") return;
    const rate = asset.fps ? fpsValue(asset.fps) : 25,
      wanted = asset.kind === "image" ? 0 : Math.min(0.5, asset.duration / 3),
      seek = wanted > 0 && wanted < asset.duration - 1 / rate ? wanted : 0;
    const shot = (at) =>
      this.ff(
        [
          "-y",
          ...(at > 0 ? ["-ss", String(at)] : []),
          "-i",
          file,
          "-vf",
          `${this.inputFilter(asset.inputSpace)}scale=320:180:force_original_aspect_ratio=decrease`,
          "-frames:v",
          "1",
          "-update",
          "1",
          target,
        ],
        { signal },
      );
    await fs.unlink(target).catch(() => {});
    if (seek > 0)
      await shot(seek).catch((e) => {
        if (signal?.aborted) throw e;
      });
    if (!fss.existsSync(target)) await shot(0);
    if (!fss.existsSync(target))
      throw Error("Aucune image lisible pour la vignette");
  }
  async colorStats(file, asset, cache, { signal } = {}) {
    const { statistics } = require("./autocolor.cjs"),
      buffers = [],
      target = path.join(cache, "measure-" + randomUUID() + ".rgb"),
      count = asset.kind === "image" ? 1 : 12;
    try {
      for (let i = 0; i < count; i++) {
        const at =
          asset.kind === "image"
            ? 0
            : Math.min(
                asset.duration - 0.01,
                ((i + 0.5) / count) * asset.duration,
              );
        await this.ff(
          [
            "-y",
            "-ss",
            String(Math.max(0, at)),
            "-i",
            file,
            "-an",
            "-frames:v",
            "1",
            "-vf",
            "scale=64:36,format=rgb24",
            "-f",
            "rawvideo",
            target,
          ],
          { signal },
        );
        buffers.push(await fs.readFile(target));
      }
      return statistics(buffers);
    } finally {
      await fs.unlink(target).catch(() => {});
    }
  }
  async waveform(
    file,
    duration,
    { signal, hz = 0, maxSeconds = duration } = {},
  ) {
    const length = Math.min(duration, maxSeconds),
      sound = await this.soundMap(file);
    if (!sound.length) throw Error("Aucune piste son lisible");
    const child = spawn(
      this.ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        file,
        "-t",
        String(length),
        // La piste son de l'app (`soundOf`).
        ...sound,
        "-ac",
        "1",
        "-ar",
        "8000",
        "-f",
        "f32le",
        "pipe:1",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.children.add(child);
    const bins = Array(hz ? Math.ceil(length * hz) : 1200).fill(0),
      per = hz
        ? Math.round(8000 / hz)
        : Math.max(1, Math.ceil((length * 8000) / bins.length));
    let samples = 0,
      tail = Buffer.alloc(0),
      stderr = "";
    const stop = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", stop, { once: true });
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          const b = Buffer.concat([tail, chunk]);
          let i = 0;
          for (; i + 4 <= b.length; i += 4) {
            const n = b.readFloatLE(i),
              at = Math.floor(samples++ / per);
            if (at < bins.length && Number.isFinite(n))
              bins[at] = hz
                ? bins[at] + (n * n) / per
                : Math.max(bins[at], Math.abs(n));
          }
          tail = b.subarray(i);
        });
        child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-2000)));
        child.on("error", reject);
        child.on("close", (code) =>
          signal?.aborted
            ? reject(Object.assign(Error("Interrompu"), { name: "AbortError" }))
            : code === 0
              ? resolve()
              : reject(Error(stderr)),
        );
      });
      return hz
        ? bins.map((x) => Math.sqrt(x))
        : bins.map((x) => Math.round(x * 1000) / 1000);
    } finally {
      this.children.delete(child);
      signal?.removeEventListener("abort", stop);
    }
  }
  stop() {
    for (const child of this.children) child.kill("SIGTERM");
  }
}
/**
 * Ce que la table d'échantillons de la piste `index` d'un QuickTime / MP4 dit
 * de ses images, sans rien lire des images :
 * - `gap` : la plus longue durée à l'écran d'une image, en secondes. Entre
 *   deux images, l'écart de leurs débuts (stts, décalages ctts des images B
 *   compris) ; pour la dernière, la fin de la piste (`duration`, en secondes,
 *   telle que FFmpeg la lit) moins son début. La dernière image n'était pas
 *   comptée : un rush régulier qui finit sur une image figée passait pour
 *   régulier, et un plan ouvert dans cette image sortait noir au film
 *   (29/09/2026).
 * - `leading` : une image clé a des images de tête, décodées après elle mais
 *   montrées avant (GOP ouvert, images RASL du HEVC). FFmpeg peut y atterrir
 *   pour un -ss posé sur l'une d'elles, et la jette : le plan s'ouvrait sur
 *   l'image clé.
 * `undefined` quand la table ne dit pas tout : pas un QuickTime / MP4
 * lisible, piste autre qu'image, fichier fragmenté, liste de montage en
 * plusieurs morceaux ou à vitesse changée, table démesurée, fin de piste
 * inconnue.
 */
async function sampleTable(file, index, duration) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    // Les boîtes de premier niveau, jusqu'au « moov », sans lire les images.
    let at = 0,
      moov;
    for (let i = 0; i < 4096 && at + 8 <= size; i++) {
      const head = Buffer.alloc(16),
        { bytesRead } = await handle.read(head, 0, 16, at);
      let length = head.readUInt32BE(0),
        skip = 8;
      if (length === 1) {
        if (bytesRead < 16) return undefined;
        length = Number(head.readBigUInt64BE(8));
        skip = 16;
      } else if (length === 0) length = size - at;
      const type = head.toString("latin1", 4, 8);
      if (!/^[\x20-\x7e]{4}$/.test(type) || length < skip || at + length > size)
        return undefined;
      if (type === "moov") {
        moov = { at: at + skip, length: length - skip };
        break;
      }
      at += length;
    }
    if (!moov || moov.length > 256 << 20) return undefined;
    const b = Buffer.alloc(moov.length);
    await handle.read(b, 0, moov.length, moov.at);
    const children = (from, to) => {
      const out = [];
      while (from + 8 <= to) {
        let length = b.readUInt32BE(from),
          skip = 8;
        if (length === 1) {
          length = Number(b.readBigUInt64BE(from + 8));
          skip = 16;
        } else if (length === 0) length = to - from;
        if (length < skip || from + length > to) throw Error("Boîte tronquée");
        out.push({
          type: b.toString("latin1", from + 4, from + 8),
          start: from + skip,
          end: from + length,
        });
        from += length;
      }
      return out;
    };
    const child = (box, type) =>
      box && children(box.start, box.end).find((c) => c.type === type);
    const top = children(0, b.length);
    if (top.some((c) => c.type === "mvex")) return undefined;
    const trak = top.filter((c) => c.type === "trak")[index],
      mdia = child(trak, "mdia"),
      hdlr = child(mdia, "hdlr"),
      mdhd = child(mdia, "mdhd"),
      stbl = child(child(mdia, "minf"), "stbl"),
      stts = child(stbl, "stts"),
      ctts = child(stbl, "ctts"),
      stss = child(stbl, "stss"),
      elst = child(child(trak, "edts"), "elst");
    if (!hdlr || !mdhd || !stts) return undefined;
    if (b.toString("latin1", hdlr.start + 8, hdlr.start + 12) !== "vide")
      return undefined;
    const scale = b.readUInt32BE(mdhd.start + (b[mdhd.start] === 1 ? 20 : 12));
    if (!(scale > 0) || !(duration > 0)) return undefined;
    // Une liste de montage en plusieurs morceaux recoud la piste : ses
    // instants ne sont plus ceux de la table. Un morceau seul dit où la
    // piste commence (`origin`).
    let origin;
    if (elst) {
      const wide = b[elst.start] === 1,
        count = b.readUInt32BE(elst.start + 4),
        step = wide ? 20 : 12;
      let used = 0;
      for (let k = 0; k < count; k++) {
        const e = elst.start + 8 + k * step;
        if (e + step > elst.end) return undefined;
        const media = wide
            ? Number(b.readBigInt64BE(e + 8))
            : b.readInt32BE(e + 4),
          rate = b.readInt32BE(e + (wide ? 16 : 8));
        if (media === -1) continue;
        if (++used > 1 || rate !== 0x10000) return undefined;
        origin = media;
      }
    }
    const entries = b.readUInt32BE(stts.start + 4),
      runs = [];
    let total = 0;
    for (let k = 0; k < entries; k++) {
      const e = stts.start + 8 + k * 8;
      if (e + 8 > stts.end) return undefined;
      const count = b.readUInt32BE(e),
        delta = b.readUInt32BE(e + 4);
      if (delta > 0x7fffffff) return undefined;
      runs.push([count, delta]);
      total += count;
    }
    if (!total || total > 20e6) return undefined;
    // Le début de chaque image, dans l'ordre de décodage.
    const times = new Float64Array(total);
    let i = 0,
      dts = 0;
    for (const [count, delta] of runs)
      for (let k = 0; k < count; k++, i++) {
        times[i] = dts;
        dts += delta;
      }
    if (ctts) {
      const cttsCount = b.readUInt32BE(ctts.start + 4);
      i = 0;
      for (let k = 0; k < cttsCount && i < total; k++) {
        const e = ctts.start + 8 + k * 8;
        if (e + 8 > ctts.end) return undefined;
        const count = b.readUInt32BE(e),
          offset = b.readInt32BE(e + 4);
        for (let j = 0; j < count && i < total; j++, i++) times[i] += offset;
      }
    }
    // Images de tête : après une image clé dans l'ordre de décodage, avant
    // elle à l'écran. Sans table des images clés, toutes le sont.
    let leading = false;
    if (ctts && stss) {
      const count = b.readUInt32BE(stss.start + 4);
      if (stss.start + 8 + count * 4 > stss.end) return undefined;
      const sync = [];
      for (let k = 0; k < count; k++)
        sync.push(b.readUInt32BE(stss.start + 8 + k * 4) - 1);
      sync.sort((x, y) => x - y);
      for (let k = 0; k < sync.length && !leading; k++) {
        const key = sync[k],
          next = Math.min(total, k + 1 < sync.length ? sync[k + 1] : total);
        for (let j = key + 1; j < next; j++)
          if (times[j] < times[key]) {
            leading = true;
            break;
          }
      }
    }
    const shown = Float64Array.from(times).sort();
    let widest = 0;
    for (let k = 1; k < total; k++)
      widest = Math.max(widest, shown[k] - shown[k - 1]);
    // La dernière image reste à l'écran jusqu'à la fin de la piste, comptée
    // depuis son début (le morceau de la liste de montage, sinon la
    // première image), en graduations entières : la durée lue par ffprobe
    // n'a que six décimales.
    const first = origin ?? shown[0],
      tail = Math.round(duration * scale) - (shown[total - 1] - first);
    widest = Math.max(
      widest,
      tail,
      ctts ? 0 : runs.filter(([count]) => count > 0).pop()[1],
    );
    return { gap: widest / scale, leading };
  } finally {
    await handle.close();
  }
}
/**
 * Une étiquette DURATION de Matroska (« 00:00:10.269000000 »), en secondes ;
 * zéro si elle est absente ou illisible.
 */
/**
 * La caméra d'un rush, d'après ses étiquettes puis le nom que donnent les
 * caméras à leurs fichiers : « Sony », « Canon », « DJI », « GoPro »,
 * « iPhone », « Téléphone »… ; `undefined` sans indice. Sert à filtrer et à
 * classer les rushes (dérushage), jamais à les traiter autrement.
 */
function cameraOf(format, streams, file) {
  const tags = { ...(format?.tags || {}) };
  for (const s of streams || []) Object.assign(tags, s.tags || {});
  const lire = (cle) =>
    String(
      Object.entries(tags).find(([k]) => k.toLowerCase() === cle)?.[1] || "",
    ).trim();
  const marque = lire("com.apple.quicktime.make") || lire("make"),
    modele = lire("com.apple.quicktime.model") || lire("model");
  if (/apple/i.test(marque) || /^iphone/i.test(modele))
    return modele || "iPhone";
  // Le modèle répète souvent la marque (« Canon » + « Canon EOS R5 ») ; pas
  // d'expression construite sur l'étiquette, que le fichier choisit (« Foo
  // (Bar » ferait échouer la lecture du média).
  if (marque)
    return (
      modele.toLowerCase().startsWith(marque.toLowerCase())
        ? modele
        : marque + " " + modele
    ).trim();
  const indices = [
      lire("major_brand"),
      lire("compatible_brands"),
      lire("encoder"),
      lire("handler_name"),
    ].join(" "),
    nom = path.basename(file || "");
  if (/xavc|sony/i.test(indices) || /^(C\d{4}|MAH\d|MAQ\d)/i.test(nom))
    return "Sony";
  if (/canon/i.test(indices) || /^(MVI_|A\d{3}C\d{3}_)/i.test(nom))
    return "Canon";
  if (/dji/i.test(indices) || /^DJI_/i.test(nom)) return "DJI";
  if (/gopro/i.test(indices) || /^(GX|GH|GOPR)\d/i.test(nom)) return "GoPro";
  if (/^(IMG_\d+\.mov|VID_\d|PXL_\d)/i.test(nom)) return "Téléphone";
  if (/^P\d{7}\./i.test(nom)) return "Panasonic";
  return undefined;
}
/**
 * L'heure de tournage d'un fichier, en millisecondes, ou `undefined`. Un
 * iPhone l'écrit avec son fuseau (com.apple.quicktime.creationdate) ; les
 * caméras, dans creation_time, souvent à l'heure locale marquée UTC : juste
 * pour ranger les rushes d'une même caméra, pas pour comparer deux caméras
 * à la minute près. Les dates vides des conteneurs (1904, 1970) ne comptent
 * pas.
 */
function recordedAt(...listes) {
  for (const cle of ["com.apple.quicktime.creationdate", "creation_time"])
    for (const tags of listes) {
      const texte = Object.entries(tags || {}).find(
          ([k]) => k.toLowerCase() === cle,
        )?.[1],
        t = Date.parse(String(texte || ""));
      if (
        Number.isFinite(t) &&
        t > Date.UTC(1990, 0, 1) &&
        t < Date.UTC(2100, 0, 1)
      )
        return t;
    }
  return undefined;
}
function clockTag(tags) {
  const text = Object.entries(tags || {}).find(
      ([k]) => k.toUpperCase() === "DURATION",
    )?.[1],
    m = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(String(text || "").trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
/** Transformée de Fourier rapide, en place (`re`, `im`, longueur 2^k). */
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j,
          b = a + len / 2,
          tr = re[b] * cr - im[b] * ci,
          ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}
/**
 * Le niveau sous lequel un passage de son est muet (-80 dB, moyenne
 * quadratique, filtré comme dans `samples`) : rien n'y distingue un micro
 * d'un autre. Un fond de salle, même à -80 dB, les distingue encore.
 */
const SILENT = 0.0001;
/**
 * Le niveau sous lequel un aperçu n'a aucun son (-120 dB, moyenne
 * quadratique) : du silence numérique, où rien ne dit quelle piste il sert
 * (`proxyStale`). Un fond de salle, même très faible, le dépasse de loin.
 */
const HUSH = 0.000001;
/** Le niveau d'un passage de son (moyenne quadratique). */
function loudness(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return x.length ? Math.sqrt(s / x.length) : 0;
}
/**
 * `wanted` (un passage de la piste de l'app, avec une marge de part et
 * d'autre) peut-il se taire (sous `SILENT`) sur `n` échantillons d'affilée, à
 * un décalage au moins ? Sinon, un aperçu muet sur ce passage n'est pas cette
 * piste (`proxyHears`).
 */
function canBeSilent(wanted, n) {
  const m = wanted.length;
  if (m < n) return true;
  const prefix = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) prefix[i + 1] = prefix[i] + wanted[i] * wanted[i];
  for (let k = 0; k + n <= m; k++)
    if (prefix[k + n] - prefix[k] < SILENT * SILENT * n) return true;
  return false;
}
/**
 * `heard` (un passage du son d'un aperçu) est-il le son `wanted` (le même
 * passage de la piste de l'app, avec une marge de part et d'autre), au
 * décalage près ? Même forme d'onde (corrélation normalisée d'au moins 0,9
 * en valeur absolue, au meilleur décalage : une piste en opposition de phase
 * s'entend de même, seule) et même niveau (à 1,5 dB près). Un passage muet
 * de l'aperçu (sous `SILENT`) ne prouve rien : deux micros différents se
 * taisent ensemble dans une pause. Il répond non ; il répondait oui quand la
 * piste de l'app se taisait aussi (30/09/2026). Voir `proxyHears`.
 */
function sameSound(heard, wanted) {
  const match = soundMatch(heard, wanted);
  return !!match && match.peak >= 0.9 && match.gap <= 1.5;
}
/**
 * `heard` (un passage du son d'un aperçu) n'est-il nettement pas le son
 * `wanted` (le même passage d'une autre piste, avec sa marge) ? Forme d'onde
 * sans rapport (corrélation sous 0,5 à tout décalage) ou niveau tout autre
 * (plus de 6 dB d'écart). Loin des seuils de `sameSound` : l'aperçu qui sert
 * cette piste n'y tombe pas, même réencodé. Un passage muet de l'aperçu ne
 * prouve rien. Voir `proxyHears`.
 */
function otherSound(heard, wanted) {
  const match = soundMatch(heard, wanted);
  return !!match && (match.peak < 0.5 || match.gap > 6);
}
/**
 * Ce qui rapproche `heard` de `wanted` (voir `sameSound`) : `peak`, la
 * corrélation normalisée au meilleur décalage, en valeur absolue, et `gap`,
 * l'écart de niveau à ce décalage, en dB. `null` quand `heard` est muet
 * (sous `SILENT`) ou trop court.
 */
function soundMatch(heard, wanted) {
  const n = heard.length,
    m = wanted.length,
    QUIET = 0.001;
  if (n < 1600 || m < n) return null;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += heard[i] * heard[i];
  const prefix = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) prefix[i + 1] = prefix[i] + wanted[i] * wanted[i];
  const lags = m - n + 1,
    level = (k) => Math.sqrt(Math.max(0, prefix[k + n] - prefix[k]) / n),
    loud = Math.sqrt(energy / n),
    // Sous ce niveau, la piste de l'app est trop faible à ce décalage pour
    // être le son entendu : 40 dB sous lui, ou 6 dB sous -60 dB.
    floor = Math.min(QUIET / 2, loud / 100);
  if (loud < SILENT) return null;
  let size = 1;
  while (size < m + n) size <<= 1;
  const ar = new Float64Array(size),
    ai = new Float64Array(size),
    br = new Float64Array(size),
    bi = new Float64Array(size);
  ar.set(wanted);
  br.set(heard);
  fft(ar, ai);
  fft(br, bi);
  for (let i = 0; i < size; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i],
      im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r;
    ai[i] = im;
  }
  fft(ar, ai, true);
  const score = (k) => {
    const s = level(k);
    return s < floor ? 0 : Math.abs(ar[k]) / (n * loud * s);
  };
  let best = 0;
  for (let k = 1; k < lags; k++) if (score(k) > score(best)) best = k;
  let peak = score(best);
  // Entre deux échantillons, le sommet de la corrélation (parabole).
  if (best > 0 && best < lags - 1) {
    const y0 = score(best - 1),
      y2 = score(best + 1),
      bend = y0 - 2 * peak + y2;
    if (bend < 0) peak = Math.min(1, peak - (y0 - y2) ** 2 / (8 * bend));
  }
  const gap = Math.abs(20 * Math.log10(loud / Math.max(1e-9, level(best))));
  return { peak, gap };
}
/**
 * La matrice d'affichage d'un flux telle que l'écrit ffprobe (trois lignes
 * « 00000000:  a  b  c »), en neuf entiers ; `undefined` sans matrice.
 */
function displayMatrix(text) {
  if (typeof text !== "string") return undefined;
  const values = text
    .split("\n")
    .map((line) => line.replace(/^\s*[0-9a-f]+:/i, "").trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/\s+/).map(Number));
  return values.length === 9 && values.every(Number.isInteger)
    ? values
    : undefined;
}
/** `av_display_rotation_get` (libavutil), en degrés ; NaN si dégénérée. */
function matrixRotation(m) {
  const fp = (x) => x / 65536,
    s0 = Math.hypot(fp(m[0]), fp(m[3])),
    s1 = Math.hypot(fp(m[1]), fp(m[4]));
  if (s0 === 0 || s1 === 0) return NaN;
  return -((Math.atan2(fp(m[1]) / s1, fp(m[0]) / s0) * 180) / Math.PI);
}
/**
 * Les filtres que FFmpeg 9.0.2 pose seul pour redresser une image selon sa
 * matrice d'affichage, dans le même ordre et avec les mêmes réglages
 * (fftools, `get_rotation` et `configure_input_video_filter`).
 */
function turnFilters(m) {
  // round() du C : la moitié s'arrondit en s'éloignant de zéro.
  const round = (x) => Math.sign(x) * Math.round(Math.abs(x));
  let theta = -round(matrixRotation(m));
  theta -= 360 * Math.floor(theta / 360 + 0.9 / 360);
  if (Math.abs(theta - 90) < 1)
    return ["transpose=" + (m[3] > 0 ? "cclock_flip" : "clock")];
  if (Math.abs(theta - 180) < 1)
    return [...(m[0] < 0 ? ["hflip"] : []), ...(m[4] < 0 ? ["vflip"] : [])];
  if (Math.abs(theta - 270) < 1)
    return ["transpose=" + (m[3] < 0 ? "clock_flip" : "cclock")];
  if (Math.abs(theta) > 1) return [`rotate=${theta.toFixed(6)}*PI/180`];
  if (Math.abs(theta) < 1) return m[4] < 0 ? ["vflip"] : [];
  // Matrice dégénérée : FFmpeg ne pose rien.
  return [];
}
/**
 * Les formats que les filtres de redressement acceptent, comme FFmpeg 9.0.2
 * les déclare (libavfilter, `query_formats` de « transpose », « hflip »,
 * « vflip », liste de « rotate ») : quand l'image décodée n'en est pas,
 * FFmpeg la convertissait avant de la redresser, au format que négocie la
 * suite du plan.
 */
const ROTATE_FORMATS = new Set(
  "gbrp gbrap argb rgba abgr bgra 0rgb rgb0 0bgr bgr0 rgb24 bgr24 gray yuv410p yuv444p yuvj444p yuv420p yuvj420p yuva444p yuva420p yuv420p10le yuva420p10le yuv444p10le yuva444p10le yuv420p12le yuv444p12le yuv444p16le yuva444p16le yuv420p16le yuva420p16le yuv444p9le yuva444p9le yuv420p9le yuva420p9le".split(
    " ",
  ),
);
function turnAccepts(filter, pixel) {
  const flags = pixel.flags || {},
    square = (pixel.log2_chroma_w || 0) === (pixel.log2_chroma_h || 0);
  if (flags.hwaccel || flags.bitstream) return false;
  if (filter.startsWith("transpose")) return !flags.palette && square;
  if (filter === "hflip") return square || !!flags.planar;
  if (filter === "vflip") return true;
  return ROTATE_FORMATS.has(pixel.name);
}
/**
 * Ce que dit « showinfo » de la première image d'un flux décodée sans
 * redressement (`pictureShape`) : sa définition, et la rotation de la
 * matrice d'affichage qu'elle porte. `matrix` : celle du conteneur.
 */
function readShape(text, matrix) {
  const lines = String(text).split("\n"),
    at = lines.findIndex((l) => /\bn:\s*0\s.*\bs:\d+x\d+/.test(l));
  if (at < 0) return null;
  const [, w, h] = /\bs:(\d+)x(\d+)/.exec(lines[at]).map(Number),
    format = /\bfmt:([a-z0-9_]+)/.exec(lines[at])?.[1];
  let carried;
  for (const line of lines.slice(at + 1)) {
    if (/\bn:\s*\d+\s/.test(line)) break;
    const m = /displaymatrix: rotation of (\S+) degrees/.exec(line);
    if (m) carried = Number(m[1]);
  }
  if (!(w > 0 && h > 0) || !format) return null;
  // Aucune matrice sur l'image : FFmpeg ne redresse rien.
  if (carried === undefined)
    return { width: w, height: h, format, turn: [], own: false };
  // Celle du conteneur, que l'app sait reproduire ; toute autre (message SEI
  // du flux) est laissée à FFmpeg (`pictureShape`).
  if (!matrix) return CARRIED;
  const expected = matrixRotation(matrix);
  if (
    !(Number.isNaN(expected) && Number.isNaN(carried)) &&
    !(Math.abs(expected - carried) < 0.01)
  )
    return CARRIED;
  return { width: w, height: h, format, turn: turnFilters(matrix), own: true };
}
/** Une rotation que portent les images, et que l'app ne sait pas reproduire. */
const CARRIED = "rotation-portee-par-les-images";
/** Une durée de garde-fou lisible : « 5 min », « 45 s ». */
function stallText(ms) {
  return ms >= 60000
    ? `${Math.round(ms / 60000)} min`
    : `${Math.max(1, Math.round(ms / 1000))} s`;
}
/**
 * Un chemin dans une option de filtre entre apostrophes (`file='…'`). Une
 * apostrophe du chemin ferme la citation, s'échappe pour le graphe ET pour
 * l'option, puis la rouvre : « '\\'' » seul passait le graphe mais perdait
 * l'apostrophe à la lecture de l'option (un dossier « O'Brien » devenait
 * « OBrien », introuvable ; mesuré le 01/10/2026). Un chemin sans apostrophe
 * est inchangé.
 */
function escapeFilter(p) {
  return p
    .replaceAll("\\", "/")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'\\''");
}
module.exports = {
  Engine,
  recordedAt,
  cameraOf,
  escapeFilter,
  stallText,
  soundOf,
  SOUND_RULE,
  displayMatrix,
  turnFilters,
  sameSound,
};
