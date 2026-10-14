// Film livré, dixième passe (30/09/2026), sur de vrais fichiers et de la
// vraie parole (synthèse vocale de macOS) :
// - un ancien aperçu (1.0 à 1.2.x, sans « -map ») n'était comparé à la piste
//   de l'app qu'aux trois passages où il avait le plus de son. Sur un rush
//   dont la piste de l'app mêle deux micros-cravates (A, puis B, le témoin,
//   de 9,5 à 37,5 s) et dont l'aperçu servait la piste de A seul, « par
//   défaut », les trois passages tombaient pendant que A parlait, là où les
//   deux pistes se ressemblent : l'aperçu faux était jugé juste, marqué, et
//   plus jamais revu. Le moniteur taisait le témoin, que le film fait
//   entendre. La piste que servait FFmpeg se rejoue désormais (même FFmpeg,
//   mêmes options d'entrée), et l'écoute seule, quand elle ne se rejoue pas,
//   compare des fenêtres réparties sur tout le média.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { Engine, sameSound } = require("../electron/video/engine.cjs");
const nativeRoot = path.join(__dirname, "../native", process.platform + "-" + process.arch),
  colorRoot = path.join(__dirname, "../public/video-color"),
  exe = process.platform === "win32" ? ".exe" : "",
  ffmpeg = path.join(nativeRoot, "ffmpeg" + exe),
  ffprobe = path.join(nativeRoot, "ffprobe" + exe),
  skip = !fss.existsSync(ffmpeg) || process.platform !== "darwin",
  // La parole vient de la synthèse vocale de macOS (« say »).
  mute = skip || spawnSync("say", ["-v", "?"]).status !== 0;
function sh(bin, args) {
  const r = spawnSync(bin, args, { maxBuffer: 1 << 28 });
  if (r.status) throw Error(args.join(" ").slice(0, 300) + "\n" + String(r.stderr).slice(-600));
  return r.stdout;
}
/** La piste son que FFmpeg sert seul, sans « -map », telle qu'il l'imprime. */
function automatic(file) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-v", "info", "-i", file, "-c", "copy", "-t", "0", "-f", "null", "-"]),
    kinds = new Map(JSON.parse(sh(ffprobe, ["-v", "error", "-show_entries", "stream=index,codec_type", "-of", "json", file])).streams.map((s) => [s.index, s.codec_type]));
  return [...String(r.stderr).matchAll(/Stream #0:(\d+) -> #0:\d+/g)].map((m) => Number(m[1])).find((i) => kinds.get(i) === "audio") ?? null;
}
/**
 * L'aperçu tel que le fabriquait la 1.2.0 (moteur, `proxy`), par `ff`, qui
 * pose les mêmes options d'entrée : sans « -map », FFmpeg choisit seul sa
 * piste son.
 */
async function oldProxy(engine, file, target, asset) {
  if (asset.kind === "audio") await engine.ff(["-y", "-i", file, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", target]);
  else await engine.ff(["-y", "-i", file, "-vf", "scale=160:90:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1", "-t", String(asset.duration), ...engine.encode(), "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k", "-movflags", "+faststart", target]);
}
/** Niveau (dB, moyenne quadratique) d'un flux entre deux instants. */
function level(file, map, from, length) {
  const b = sh(ffmpeg, ["-v", "error", "-ss", String(from), "-t", String(length), "-i", file, "-map", map, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
  let s = 0;
  for (let i = 0; i < b.length; i += 4) s += b.readFloatLE(i) ** 2;
  return 10 * Math.log10(s / Math.max(1, b.length / 4) + 1e-30);
}
/** La fréquence (parmi `tones`) qui domine un flux entre deux instants. */
function tone(file, tones, from, length) {
  const b = sh(ffmpeg, ["-v", "error", "-ss", String(from), "-t", String(length), "-i", file, "-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]),
    power = tones.map((f) => {
      const c = 2 * Math.cos((2 * Math.PI * f) / 16000);
      let s1 = 0,
        s2 = 0;
      for (let i = 0; i < b.length; i += 4) {
        const s = b.readFloatLE(i) + c * s1 - s2;
        s2 = s1;
        s1 = s;
      }
      return s1 * s1 + s2 * s2 - c * s1 * s2;
    }),
    best = power.indexOf(Math.max(...power));
  assert(power.every((p, i) => i === best || p * 100 < power[best]), "une seule piste s'entend : " + power);
  return best;
}
const DURATION = 48;

test(
  "ancien aperçu d'un rush à deux micros-cravates (piste de l'app : A puis B, le témoin, de 9,5 à 37,5 s ; aperçu : A seul, « par défaut ») : refait, alors que ses trois passages les plus forts tombent pendant que A parle, où les deux pistes se ressemblent ; le même rush dont l'aperçu servait déjà le mélange est gardé ; décidé sans écouter quand le choix de FFmpeg se rejoue, et de même à l'écoute seule (autre FFmpeg) ; un aperçu refait n'est jamais revu",
  { skip: mute, timeout: 420000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-melange-")),
      engine = new Engine({ nativeRoot, colorRoot }),
      // Un autre FFmpeg que celui des versions qui fabriquaient ces aperçus :
      // leur choix ne se rejoue pas, l'aperçu est seulement écouté.
      listening = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      await listening.init();
      listening.status.version = "ffmpeg version 10.0";
      const say = (text, file) => sh("say", ["-v", "Thomas", "-o", file, "--data-format=BEI16@48000", text]),
        a = path.join(root, "a.aiff"),
        b = path.join(root, "b.aiff"),
        A = path.join(root, "a.wav"),
        B = path.join(root, "b.wav");
      say("Mesdames et messieurs, bienvenue à tous. [[slnc 700]] Nous sommes réunis aujourd'hui pour célébrer l'union de Claire et de Julien.", a);
      say("Je suis le témoin de Julien, et je le connais depuis l'école primaire. [[slnc 600]] Il a toujours été le plus drôle de la bande.", b);
      // A parle de 0 à 9 s et de 38 à 47 s ; B de 9,5 à 37,5 s.
      sh(ffmpeg, ["-v", "error", "-y", "-i", a, "-filter_complex", `[0:a]aresample=48000,atrim=0:9,asplit[x][y];[y]adelay=38000:all=1[z];[x][z]amix=inputs=2:normalize=0:duration=longest,apad=whole_dur=${DURATION}`, "-c:a", "pcm_s24le", "-t", String(DURATION), A]);
      sh(ffmpeg, ["-v", "error", "-y", "-stream_loop", "-1", "-i", b, "-filter_complex", `[0:a]aresample=48000,atrim=0:28,asetpts=N/SR/TB,adelay=9500:all=1,apad=whole_dur=${DURATION}`, "-c:a", "pcm_s24le", "-t", String(DURATION), B]);
      assert(level(A, "0:a:0", 10, 27) < -120 && level(B, "0:a:0", 0, 9) < -120 && level(B, "0:a:0", 38, 10) < -120, "chacun se tait quand l'autre parle");
      assert(level(A, "0:a:0", 0, 9) > -40 && level(B, "0:a:0", 10, 27) > -40, "la parole est là");
      const room = (seed) => ["-f", "lavfi", "-i", `anoisesrc=d=${DURATION}:c=pink:r=48000:a=0.0005:seed=${seed}`],
        // Piste 1 (celle de l'app) : le mélange des deux cravates ; piste 2 : A seul.
        GRAPH = "[1:a]volume=-8dB[a0];[a0][3:a]amix=inputs=2:normalize=0,asplit[a1][a2];[2:a]volume=-8dB[b0];[b0][4:a]amix=inputs=2:normalize=0[b1];[a1][b1]amix=inputs=2:normalize=0,pan=stereo|c0=c0|c1=c0[t1];[a2]pan=stereo|c0=c0|c1=c0[t2]",
        mov = (name, first) => {
          const file = path.join(root, name);
          sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=160x90:r=25:d=${DURATION}`, "-i", A, "-i", B, ...room(7), ...room(8), "-filter_complex", GRAPH, "-map", "0:v", "-map", "[t1]", "-map", "[t2]", "-c:v", "mpeg4", "-c:a", "pcm_s16le", "-disposition:a:0", first ? "default" : "0", "-disposition:a:1", first ? "0" : "default", "-t", String(DURATION), file]);
          return file;
        },
        cases = [
          ["melange.mov", true, mov("melange.mov", false)],
          ["melange-juste.mov", false, mov("melange-juste.mov", true)],
        ],
        costs = [];
      for (const [name, stale, file] of cases) {
        const sound = await engine.soundTrack(file),
          asset = { id: name, name, ...(await engine.probe(file)), inputSpace: "rec709" },
          old = path.join(root, name + ".apercu.mp4");
        assert.equal(sound.usable, 2, name);
        assert.equal(sound.index, 1, name);
        assert.equal(automatic(file), stale ? 2 : 1, name + " : la piste que FFmpeg servait seul");
        await oldProxy(engine, file, old, asset);
        let t0 = Date.now();
        assert.equal(await engine.proxyStale(file, asset, old), stale, `${name} : ${stale ? "l'aperçu servait A seul, il doit être refait" : "l'aperçu servait déjà le mélange, il est gardé"}`);
        costs.push(`${name} ${Date.now() - t0} ms`);
        t0 = Date.now();
        assert.equal(await listening.proxyStale(file, asset, old), stale, name + " : à l'écoute seule");
        costs.push(`${name} à l'écoute ${Date.now() - t0} ms`);
        // Le choix se rejoue avec le FFmpeg des versions qui fabriquaient
        // ces aperçus, jamais avec un autre.
        assert.equal(await engine.legacySound(file), automatic(file), name);
        assert.equal(await listening.legacySound(file), undefined, name);
        // Refait par la version actuelle, l'aperçu n'est jamais revu, qu'il
        // serve ou non la piste que FFmpeg aurait choisie seul.
        const fresh = path.join(root, name + ".refait.mp4");
        await engine.proxy(file, asset, fresh);
        assert.equal(await engine.proxyStale(file, asset, fresh), false, name + " : l'aperçu refait");
        assert.equal(await listening.proxyStale(file, asset, fresh), false, name + " : l'aperçu refait, à l'écoute seule");
      }
      t.diagnostic("coût de la revue par média : " + costs.join(", "));
      // Pourquoi l'aperçu faux passait : ses passages les plus forts tombent
      // tous pendant que A parle, et y sont bien la piste de l'app ; pendant
      // que B parle, il ne l'est pas.
      const [, , file] = cases[0],
        wrong = path.join(root, "melange.mov.apercu.mp4"),
        at = await engine.loudPassages(wrong, 2, DURATION - 2.1),
        window = async (from) => {
          const read = await engine.samples(file, "0:1", Math.max(0, from - 1), 4),
            wanted = new Float32Array(Math.round(Math.max(0, 1 - from) * 16000) + read.length);
          wanted.set(read, wanted.length - read.length);
          return sameSound(await engine.samples(wrong, "0:a:0", from, 2), wanted);
        };
      assert.equal(at.length, 3);
      assert(at.every((x) => x < 9 || x > 37), "passages de A : " + at);
      for (const x of at) assert(await window(x), "au passage " + x + " s, l'aperçu faux fait entendre la piste de l'app");
      assert.equal(await window(20), false, "pendant que B parle, il ne la fait pas entendre");
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "la piste que servait FFmpeg seul, rejouée par le même FFmpeg avec les options d'entrée de la 1.2.x, est celle qu'a servie l'ancien aperçu sur toutes les combinaisons qui décident de son choix (ordre, canaux, « par défaut », piste vide, piste qui commence 8 s après les autres ; MOV, MP4, MKV, MPEG-TS, AVI, son seul) : l'aperçu est refait si et seulement si ce n'est pas la piste de l'app, et un aperçu refait n'est jamais revu",
  { skip, timeout: 420000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-choix-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const D = 12,
        TONES = [400, 700, 1000, 1300],
        T = (ch, codec, o = {}) => ({ ch, codec, ...o }),
        combos = [
          ["mov-1-2-auto.mov", "mov", [T(1, "pcm_s16le"), T(2, "pcm_s16le")]],
          ["mov-1-2-def2.mov", "mov", [T(1, "pcm_s16le", { def: false }), T(2, "pcm_s16le", { def: true })]],
          ["mov-2-6-def12.mov", "mov", [T(2, "pcm_s16le", { def: true }), T(6, "pcm_s16le", { def: true })]],
          ["mov-4-mono.mov", "mov", [T(1, "pcm_s24le"), T(1, "pcm_s24le"), T(1, "pcm_s24le"), T(1, "pcm_s24le")]],
          ["mov-2tard-1.mov", "mov", [T(2, "pcm_s16le", { late: 8 }), T(1, "pcm_s16le")]],
          ["mov-1-2tard-def2.mov", "mov", [T(1, "pcm_s16le", { def: false }), T(2, "pcm_s16le", { def: true, late: 8 })]],
          ["mp4-2tard-2.mp4", "mp4", [T(2, "aac", { late: 8 }), T(2, "aac")]],
          ["mp4-1-2-def2.mp4", "mp4", [T(1, "aac", { def: false }), T(2, "aac", { def: true })]],
          ["mkv-2-6-aucune.mkv", "matroska", [T(2, "flac", { def: false }), T(6, "flac", { def: false })]],
          ["mkv-2tard-1.mkv", "matroska", [T(2, "aac", { late: 8 }), T(1, "aac")]],
          ["mkv-2-2tard-def2.mkv", "matroska", [T(2, "pcm_s16le", { def: false }), T(2, "pcm_s16le", { def: true, late: 8 })]],
          ["ts-2-6.ts", "mpegts", [T(2, "ac3"), T(6, "ac3")]],
          ["ts-6-2.mts", "mpegts", [T(6, "ac3"), T(2, "ac3")]],
          ["ts-vide-2-6.ts", "mpegts", [T(2, "ac3", { empty: true }), T(2, "ac3"), T(6, "ac3")]],
          ["ts-1-2tard3.ts", "mpegts", [T(1, "ac3"), T(2, "ac3", { late: 3 })]],
          ["avi-1-2.avi", "avi", [T(1, "pcm_s16le"), T(2, "pcm_s16le")]],
          ["son-1-2-def2.mka", "matroska", [T(1, "flac", { def: false }), T(2, "flac", { def: true })], true],
        ];
      let wrong = 0,
        unforeseen = 0;
      const costs = [];
      for (const [name, format, tracks, audioOnly] of combos) {
        const file = path.join(root, name),
          args = ["-v", "error", "-y"];
        if (!audioOnly) args.push("-f", "lavfi", "-i", `testsrc2=s=160x90:r=25:d=${D}`);
        tracks.forEach((x, k) => {
          if (x.late) args.push("-itsoffset", String(x.late));
          args.push("-f", "lavfi", "-i", `sine=f=${TONES[k]}:r=48000:d=${D - (x.late || 0)}`);
        });
        if (!audioOnly) args.push("-map", "0:v", "-c:v", format === "mpegts" ? "mpeg2video" : "mpeg4", "-b:v", "1M");
        tracks.forEach((x, k) => {
          args.push("-map", `${k + (audioOnly ? 0 : 1)}:a`, `-c:a:${k}`, x.codec, `-ac:a:${k}`, String(x.ch));
          if (x.def !== undefined) args.push(`-disposition:a:${k}`, x.def ? "default" : "0");
          if (x.empty) args.push(`-bsf:a:${k}`, "noise=drop=1");
        });
        sh(ffmpeg, [...args, "-t", String(D), "-f", format, file]);
        const asset = { id: name, name, ...(await engine.probe(file)), inputSpace: "rec709" },
          sound = await engine.soundTrack(file),
          audio = JSON.parse(sh(ffprobe, ["-v", "error", "-show_entries", "stream=index,codec_type,channels:stream_disposition=default", "-of", "json", file])).streams.filter((s) => s.codec_type === "audio"),
          old = file + ".apercu.mp4";
        assert.equal(asset.kind, audioOnly ? "audio" : "video", name);
        await oldProxy(engine, file, old, asset);
        // La piste qu'a vraiment servie l'ancien aperçu : sa fréquence, là
        // où toutes les pistes sonnent.
        const served = audio[tone(old, TONES.slice(0, tracks.length), 9.5, 2)].index;
        assert.equal(await engine.legacySound(file), served, name + " : le choix rejoué");
        assert.equal(automatic(file), served, name);
        // La note sans le terme des paquets lus à l'ouverture (canaux, puis
        // « par défaut ») ne prévoit pas les pistes qui commencent tard.
        let naive = null;
        for (const s of audio) if (Number(s.channels) > 0 && (naive === null || Number(s.channels) + 5e6 * s.disposition.default > Number(naive.channels) + 5e6 * naive.disposition.default)) naive = s;
        if (naive.index !== served) unforeseen++;
        const t0 = Date.now(),
          stale = await engine.proxyStale(file, asset, old);
        costs.push(`${name} ${Date.now() - t0} ms`);
        if (sound.usable < 2) assert.equal(served, sound.index, name + " : une seule piste utilisable, FFmpeg ne pouvait servir qu'elle");
        assert.equal(stale, served !== sound.index, `${name} : FFmpeg servait ${served}, l'app prend ${sound.index}`);
        if (stale) wrong++;
        const fresh = file + ".refait.mp4";
        await engine.proxy(file, asset, fresh);
        assert.equal(await engine.proxyStale(file, asset, fresh), false, name + " : l'aperçu refait");
      }
      t.diagnostic("coût de la revue par média : " + costs.join(", "));
      assert(wrong >= 8, "aperçus faux : " + wrong);
      assert(unforeseen >= 3, "choix que la note sans paquets ne prévoit pas : " + unforeseen);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);
