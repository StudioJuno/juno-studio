// Film livré contre moniteur, cinquième passe (29/09/2026), sur de vrais
// fichiers et de vrais rendus FFmpeg :
// - un rush régulier dont la dernière image reste à l'écran (fin figée)
//   passait pour régulier : un plan ouvert dans cette image sortait noir ;
// - MPEG-TS (AVCHD des caméscopes) et MPEG-PS (.vob, .mpg) : un plan ouvert
//   au milieu d'un GOP restait figé sur l'image clé suivante, et un plan lu
//   depuis le début du fichier était décalé quand l'image commence après le
//   son ;
// - HEVC à images B en GOP ouvert : un plan ouvert sur une image de tête
//   (RASL) s'ouvrait sur l'image clé ;
// - le suivi de masque lisait ses images sans aucune de ces remontées.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { buildSync } = require("esbuild");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs"),
  TRACK = require("../electron/video/track.cjs");
const nativeRoot = path.join(__dirname, "../native", process.platform + "-" + process.arch),
  colorRoot = path.join(__dirname, "../public/video-color"),
  exe = process.platform === "win32" ? ".exe" : "",
  ffmpeg = path.join(nativeRoot, "ffmpeg" + exe),
  ffprobe = path.join(nativeRoot, "ffprobe" + exe),
  // Les rushes sont encodés par VideoToolbox.
  skip = !fss.existsSync(ffmpeg) || process.platform !== "darwin";
/** Un module du front (TypeScript), empaqueté en CommonJS pour Node. */
function front(file) {
  const out = buildSync({
    entryPoints: [path.join(__dirname, "..", file)],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const module = { exports: {} };
  new Function("module", "exports", "require", out.outputFiles[0].text)(module, module.exports, require);
  return module.exports;
}
const EDIT = front("src/video/edit.ts");
const NTSC = { n: 30000, d: 1001 };
/** Rush « compteur » : l'image i porte i + 1 en binaire sur 9 bandes. */
const W = 72,
  Hh = 36,
  BITS = 9,
  BAND = W / BITS;
function counterFrames(n) {
  const buf = Buffer.alloc(W * Hh * n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < BITS; k++)
      if (((i + 1) >> k) & 1)
        for (let y = 0; y < Hh; y++)
          buf.fill(255, i * W * Hh + y * W + k * BAND, i * W * Hh + y * W + (k + 1) * BAND);
  return buf;
}
/** L'expression setpts qui pose l'image N à `ticks[N]` graduations. */
function stamps(ticks) {
  const steps = {};
  for (let k = 1; k < ticks.length; k++) steps[ticks[k] - ticks[k - 1]] = (steps[ticks[k] - ticks[k - 1]] || 0) + 1;
  const base = Number(Object.entries(steps).sort((a, b) => b[1] - a[1])[0]?.[0] || 1);
  let expr = `${ticks[0]}+${base}*N`;
  for (let k = 1; k < ticks.length; k++) {
    const d = ticks[k] - ticks[k - 1] - base;
    if (d) expr += `${d > 0 ? "+" : "-"}gte(N\\,${k})*${Math.abs(d)}`;
  }
  return expr;
}
/**
 * Un rush en .mov (ou .mp4), base de temps 1/`scale`, dont l'image i commence
 * à `ticks[i]` graduations. `last` : durée de la dernière image (par défaut,
 * l'écart des deux dernières), posée par une image de plus retirée au remux,
 * comme la table d'un vrai fichier la garde. `frames` : les images (par
 * défaut, le compteur).
 */
async function movie(e, root, name, ticks, { scale = 600, last, ext = ".mov", codec = ["-c:v", "h264_videotoolbox", "-b:v", "4M"], frames, size = [W, Hh], out = [144, 72] } = {}) {
  const all = [...ticks, ticks[ticks.length - 1] + (last || ticks[ticks.length - 1] - ticks[ticks.length - 2])],
    raw = path.join(root, name + ".gray");
  await fs.writeFile(raw, frames ? frames(all.length) : counterFrames(all.length));
  const first = path.join(root, name + "-long" + ext);
  await e.ff([
    "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", size.join("x"), "-r", String(scale), "-i", raw,
    "-vf", `setpts=(${stamps(all)})/(${scale}*TB),scale=${out.join(":")}:flags=neighbor,format=yuv420p`,
    "-fps_mode", "passthrough", ...codec, "-video_track_timescale", String(scale), first,
  ]);
  const file = path.join(root, name + ext);
  await e.ff(["-y", "-i", first, "-map", "0", "-c", "copy", "-frames:v", String(ticks.length), "-video_track_timescale", String(scale), file]);
  return file;
}
/**
 * Les instants des images d'un fichier, en microsecondes, comptés depuis le
 * zéro du moniteur : le début du fichier, ou en MPEG-TS / PS le premier de
 * l'image et du son, que sert l'aperçu (moteur, `videoTrack`). Lus sur les
 * images décodées : un paquet MPEG-PS n'a pas toujours d'instant.
 */
function micros(file) {
  const j = JSON.parse(spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=start_time,format_name:stream=index,codec_type,start_time,time_base", "-of", "json", file]).stdout),
    v = j.streams.find((s) => s.codec_type === "video"),
    starts = j.streams.filter((s) => s.codec_type === "video" || s.codec_type === "audio").map((s) => Number(s.start_time)).filter(Number.isFinite),
    zero = /mpegts|mpeg$/.test(j.format.format_name) ? Math.min(...starts) : Number(j.format.start_time) || 0,
    p = JSON.parse(spawnSync(ffprobe, ["-v", "error", "-select_streams", String(v.index), "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", file], { maxBuffer: 1 << 26 }).stdout);
  return p.frames.map((x) => Math.round((Number(x.best_effort_timestamp_time) - zero) * 1e6)).sort((a, b) => a - b);
}
/** Le numéro porté par chaque image d'un fichier : -1 pour une image noire. */
function read(file) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-fps_mode", "passthrough", "-vf", `scale=${W}:${Hh}:flags=area,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  const out = [];
  for (let off = 0; off + W * Hh <= r.stdout.length; off += W * Hh) {
    let v = 0,
      lit = 0;
    for (let k = 0; k < BITS; k++) {
      const px = r.stdout[off + (Hh >> 1) * W + Math.round((k + 0.5) * BAND)];
      if (px > 128) v |= 1 << k;
      lit = Math.max(lit, px);
    }
    out.push(lit < 40 ? -1 : v - 1);
  }
  return out;
}
/**
 * L'image que le moniteur montre à l'image `f` d'un plan : la dernière image
 * du rush commencée au plus une milliseconde de montage après l'instant voulu,
 * comptée comme FFmpeg la compte (render.cjs, `retime`) ; avant la première,
 * la première, que le moniteur montre déjà.
 */
function shownAt(us, clip, f, fps) {
  let want = 0;
  for (let k = 0; k < us.length; k++) {
    const q = Math.trunc((us[k] - clip.inUs) / clip.speed - 1000);
    if (Math.ceil((q * fps.n) / (fps.d * 1e6)) <= f - clip.start) want = k;
  }
  return want;
}
/**
 * Rend `s` de `start` à `start + count` et renvoie les images du film qui ne
 * sont pas celles du moniteur.
 */
async function differences(e, root, s, asset, source, us, label, start = 0, count = M.duration(s)) {
  const out = path.join(root, "film.mov");
  await R.renderSegment(
    { engine: e, sequence: s, assets: new Map([[asset.id, asset]]), registry: { [asset.id]: { source } }, cache: root, start, count },
    out,
  );
  const film = read(out),
    wrong = [];
  assert.equal(film.length, count, label);
  for (let i = 0; i < count; i++) {
    const f = start + i,
      clip = s.clips.find((x) => x.start <= f && x.start + x.duration > f && x.component !== "audio"),
      want = shownAt(us, clip, f, s.fps);
    if (film[i] !== want) wrong.push(`${label}, image ${f} : ${film[i]} au lieu de ${want}`);
  }
  return wrong;
}
async function check(...args) {
  assert.deepEqual(await differences(...args), [], args[6]);
}
/** Une séquence d'un seul plan de `asset`, ouvert à `inUs`, long de `count` images. */
function single(asset, inUs, count, { fps = NTSC, speed = 1, width = 144, height = 72 } = {}) {
  let s = { ...M.sequence(), width, height, fps, clips: [] };
  s = EDIT.addClip(s, asset, 0);
  s.clips = s.clips.map((c) => ({ ...c, inUs: Math.round(inUs), duration: count, speed }));
  return s;
}
async function media(e, file) {
  return { id: "a", name: path.basename(file), ...(await e.probe(file)), inputSpace: "rec709" };
}
const grid = (n, step = 20, from = 0) => Array.from({ length: n }, (_, i) => from + i * step);
test(
  "dernière image figée : la table d'échantillons compte la durée de la dernière image, et un plan ouvert dans cette image montre l'image, pas du noir",
  { skip, timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-fin-figee-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      // 60 images à 30 i/s, la dernière reste deux secondes à l'écran
      // (enregistrement d'écran arrêté sur une image fixe).
      for (const ext of [".mov", ".mp4"]) {
        const source = await movie(e, root, "figee", grid(60), { last: 1200, ext }),
          us = micros(source),
          asset = await media(e, source);
        assert.equal(us.length, 60);
        assert(Math.abs(asset.duration - (59 * 20 + 1200) / 600) < 0.002, String(asset.duration));
        // Plans ouverts dans la dernière image, loin de son début.
        for (const inS of [2.3, 2.9, 3.6]) await check(e, root, single(asset, inS * 1e6, 6), asset, source, us, `${ext}, plan à ${inS} s`);
        // Le plan posé en entier, et le segment qui commence dans la dernière image.
        let whole = { ...M.sequence(), width: 144, height: 72, fps: NTSC, clips: [] };
        whole = EDIT.addClip(whole, asset, 0);
        await check(e, root, whole, asset, source, us, `${ext}, segment dans la dernière image`, 80, M.duration(whole) - 80);
        // La table le dit : la dernière image reste deux secondes à l'écran.
        const track = await e.videoTrack(source);
        assert(Math.abs(track.gap - 2) < 1e-6, "écart " + track.gap);
        assert.equal(track.regular, false);
      }
      // Un rush régulier jusqu'au bout reste régulier : rien n'est lu.
      const steady = await movie(e, root, "regulier", grid(60)),
        track = await e.videoTrack(steady);
      assert(Math.abs(track.gap - 1 / 30) < 1e-9, "écart " + track.gap);
      assert.equal(track.regular, true);
      assert.equal(await e.frameStart(steady, 1.9), undefined);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
/**
 * La remontée du rendu avant la passe du 29/09/2026 : une image moyenne si
 * la cadence annoncée égale la cadence moyenne, sinon jusqu'au début de
 * l'image à l'écran lue dans les paquets.
 */
function oldFrame(file, t, period, cache) {
  if (!cache.has(file)) {
    const j = JSON.parse(spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=start_time:stream=r_frame_rate,avg_frame_rate:packet=pts_time", "-of", "json", file], { maxBuffer: 1 << 26 }).stdout),
      st = j.streams[0];
    cache.set(file, {
      regular: !!st.r_frame_rate && st.r_frame_rate !== "0/0" && st.r_frame_rate === st.avg_frame_rate,
      start: Number(j.format.start_time) || 0,
      pts: j.packets.map((p) => Number(p.pts_time)).filter(Number.isFinite),
    });
  }
  const c = cache.get(file);
  if (c.regular) return period;
  const at = c.start + t + 0.001;
  let shown;
  for (const x of c.pts) if (x <= at + 1e-6 && !(shown >= x)) shown = x;
  return shown === undefined ? period : Math.max(period, t - (shown - c.start));
}
/** Le -ss que le rendu pose pour l'image d'un plan ouvert à `inUs` (zéro : aucun). */
async function renderSeek(e, root, asset, source, inUs) {
  const b = await R.buildSegment({
      engine: e,
      sequence: single(asset, inUs, 1),
      assets: new Map([[asset.id, asset]]),
      registry: { [asset.id]: { source } },
      cache: root,
      start: 0,
      count: 1,
    }),
    i = b.inputs.indexOf("-ss");
  return i < 0 ? 0 : Number(b.inputs[i + 1]);
}
test(
  "la remontée du rendu n'est jamais plus courte qu'avant la passe du 29/09/2026 : rushes réguliers, à trous, à dernière ou première image longue, à liste de montage",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-remontee-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      const regular = await movie(e, root, "regulier", grid(90)),
        ntsc = await movie(e, root, "ntsc", grid(90, 1001), { scale: 30000 }),
        holes = await movie(e, root, "trous", [...grid(30), ...grid(30, 20, 700), ...grid(30, 20, 1400)]),
        lastLong = await movie(e, root, "derniere", grid(90), { last: 900 }),
        firstLong = await movie(e, root, "premiere", [0, ...grid(89, 20, 600)]),
        // Liste de montage : un remux qui commence après le début garde
        // l'image clé d'avant et masque le début par la liste.
        edited = path.join(root, "montage.mov");
      await e.ff(["-y", "-ss", "0.52", "-i", ntsc, "-c", "copy", edited]);
      const hevc = await movie(e, root, "hevc", grid(90, 1001), { scale: 30000, codec: ["-c:v", "hevc_videotoolbox", "-b:v", "3M", "-tag:v", "hvc1", "-bf", "2"] });
      const cache = new Map(),
        worse = [];
      let checked = 0;
      for (const file of [regular, ntsc, holes, lastLong, firstLong, edited, hevc]) {
        const asset = await media(e, file),
          period = asset.fps.d / asset.fps.n,
          tick = await e.seekGrain(file);
        for (let x = 0; x < asset.duration - 0.01; x += period * 0.53) {
          const inUs = Math.round(x * 1e6),
            t = inUs / 1e6,
            shown = await e.frameStart(file, t + 0.001, period),
            now = Number.isFinite(shown) ? Math.max(period, t - shown) : period,
            before = oldFrame(file, t, period, cache),
            seekNow = await renderSeek(e, root, asset, file, inUs),
            seekBefore = R.readWindow(t, 0, before, tick).seek;
          checked++;
          if (now < before - 1e-6 || seekNow > seekBefore + 1e-6)
            worse.push(`${path.basename(file)} à ${t.toFixed(4)} s : remontée ${now.toFixed(4)} contre ${before.toFixed(4)}, -ss ${seekNow.toFixed(4)} contre ${seekBefore.toFixed(4)}`);
        }
      }
      assert(checked > 1000, String(checked));
      assert.deepEqual(worse.slice(0, 10), []);
      // La dernière image longue et la première : la table le dit.
      assert.equal((await e.videoTrack(lastLong)).regular, false);
      assert.equal((await e.videoTrack(firstLong)).regular, false);
      assert.equal((await e.videoTrack(regular)).regular, true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
/**
 * Un rush MPEG-TS comme un caméscope AVCHD : H.264 à GOP de 12 images,
 * 29,97 i/s, son AC-3, et l'image qui commence `delay` secondes après le son.
 */
async function avchd(e, root, name, n, { delay = 0.1, ext = ".mts", codec = ["-c:v", "h264_videotoolbox", "-b:v", "3M", "-g", "12"] } = {}) {
  const raw = path.join(root, name + ".gray"),
    picture = path.join(root, name + "-image.mov"),
    file = path.join(root, name + ext);
  await fs.writeFile(raw, counterFrames(n));
  await e.ff(["-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", W + "x" + Hh, "-r", "30000/1001", "-i", raw, "-vf", "scale=144:72:flags=neighbor,format=yuv420p", ...codec, picture]);
  // Le décalage se pose au remux : à l'encodage, FFmpeg ramène l'image à zéro.
  await e.ff([
    "-y", ...(delay ? ["-itsoffset", String(delay)] : []), "-i", picture,
    "-f", "lavfi", "-i", `sine=f=440:r=48000:d=${(n * 1001) / 30000 + 0.3}`,
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "ac3",
    ...(ext === ".m2ts" ? ["-mpegts_m2ts_mode", "1"] : []), "-f", { ".vob": "vob", ".mpg": "mpeg" }[ext] || "mpegts", file,
  ]);
  return file;
}
test(
  "MPEG-TS (AVCHD) et MPEG-PS : un plan ou un segment ouvert au milieu d'un GOP s'ouvre sur l'image du moniteur, et un plan lu depuis le début du fichier n'est pas décalé quand l'image commence après le son",
  { skip, timeout: 600000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-ts-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      const cases = [
        ["AVCHD .mts", await avchd(e, root, "avchd", 150)],
        ["AVCHD .m2ts", await avchd(e, root, "avchd2", 150, { ext: ".m2ts", delay: 0.05 })],
        ["MPEG-2 à images B, .ts", await avchd(e, root, "mpeg2", 150, { ext: ".ts", codec: ["-c:v", "mpeg2video", "-b:v", "4M", "-bf", "2", "-g", "15"] })],
        // MPEG-PS (DVD, caméscopes à disque) : ffprobe ne le lit pas par
        // intervalles, FFmpeg donne ses paquets.
        ["MPEG-PS .vob", await avchd(e, root, "dvd", 150, { ext: ".vob", codec: ["-c:v", "mpeg2video", "-b:v", "4M", "-bf", "2", "-g", "15"] })],
      ];
      for (const [name, source] of cases) {
        const us = micros(source),
          asset = await media(e, source);
        assert.equal(us.length, 150, name);
        // L'image commence après le son : le zéro du moniteur est le son.
        assert(us[0] > 40000, `${name} : première image à ${us[0]} µs`);
        // Plans ouverts tout près du début (sans -ss) : image décalée ; au
        // milieu d'un GOP (-ss) : image clé suivante figée. Toutes les
        // fautes sont relevées avant de conclure.
        const wrong = [];
        for (const k of [0, 1, 5, 17, 40, 58, 77, 101]) {
          const s = single(asset, EDIT.sourceMicros(k, single(asset, 0, 1)), 8);
          wrong.push(...(await differences(e, root, s, asset, source, us, `${name}, plan à l'image ${k}`)));
        }
        // Un plan à x2 et un à x0,5.
        wrong.push(...(await differences(e, root, single(asset, EDIT.sourceMicros(41, single(asset, 0, 1)), 8, { speed: 2 }), asset, source, us, `${name}, x2`)));
        wrong.push(...(await differences(e, root, single(asset, EDIT.sourceMicros(63, single(asset, 0, 1)), 8, { speed: 0.5 }), asset, source, us, `${name}, x0,5`)));
        // Le plan entier, et un segment qui commence au milieu d'un GOP.
        let whole = { ...M.sequence(), width: 144, height: 72, fps: NTSC, clips: [] };
        whole = EDIT.addClip(whole, asset, 0);
        wrong.push(...(await differences(e, root, whole, asset, source, us, `${name}, plan entier`, 0, 40)));
        wrong.push(...(await differences(e, root, whole, asset, source, us, `${name}, segment à l'image 70`, 70, 12)));
        assert.deepEqual(wrong, [], name);
        const track = await e.videoTrack(source);
        assert.equal(track.discont, true, name);
        assert(Math.abs(track.lead - us[0] / 1e6) < 1e-4, `${name} : ${track.lead}`);
      }
      // Les paquets image se lisent sans l'analyse des flux : les mêmes.
      const [, source] = cases[0],
        args = (extra) => ["-v", "error", ...extra, "-read_intervals", "2%4", "-select_streams", "0", "-show_entries", "packet=pts_time,dts_time,flags", "-of", "csv=p=0", source];
      assert.equal(
        spawnSync(ffprobe, args(["-nofind_stream_info"])).stdout.toString(),
        spawnSync(ffprobe, args([])).stdout.toString(),
      );
      assert.equal((await e.videoTrack(source)).declared, true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "HEVC à images B en GOP ouvert : un plan ouvert sur une image de tête s'ouvre sur elle, pas sur l'image clé, et un .mov sans image de tête ne lit toujours aucun paquet",
  { skip, timeout: 600000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-rasl-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      const hevc = ["-c:v", "hevc_videotoolbox", "-b:v", "3M", "-tag:v", "hvc1", "-bf", "2"];
      for (const ext of [".mov", ".mp4"]) {
        const source = await movie(e, root, "hevc", grid(120, 1001), { scale: 30000, codec: hevc, ext }),
          us = micros(source),
          asset = await media(e, source),
          track = await e.videoTrack(source);
        // Les images de tête : décodées après une image clé, montrées avant.
        const p = JSON.parse(spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "json", source]).stdout).packets,
          leading = [];
        let key;
        for (const x of p) {
          if (x.flags.includes("K")) key = Number(x.pts_time);
          else if (key !== undefined && Number(x.pts_time) < key - 1e-6)
            leading.push(us.indexOf(Math.round(Number(x.pts_time) * 1e6)));
        }
        assert(leading.length >= 6, `${ext} : ${leading.length} images de tête`);
        for (const k of leading.filter((k) => k > 0 && k < 100).slice(0, 10)) {
          const s = single(asset, us[k] + 1000, 4);
          await check(e, root, s, asset, source, us, `${ext}, plan ouvert sur l'image de tête ${k}`);
        }
        // Un segment qui commence sur une image de tête.
        let whole = { ...M.sequence(), width: 144, height: 72, fps: NTSC, clips: [] };
        whole = EDIT.addClip(whole, asset, 0);
        const k = leading.find((x) => x > 30);
        await check(e, root, whole, asset, source, us, `${ext}, segment à l'image de tête ${k}`, k, 6);
        assert.equal(track.leading, true, `${ext} : images de tête dans la table`);
      }
      // Sans images B, rien n'est lu : le coût d'un .mov régulier ne bouge pas.
      const plain = await movie(e, root, "h264", grid(120, 1001), { scale: 30000 }),
        run = e.run.bind(e);
      await e.videoTrack(plain);
      let reads = 0;
      e.run = (bin, args, o) => (args.includes("-read_intervals") && reads++, run(bin, args, o));
      for (const t of [0.5, 1.2, 2.9]) assert.equal(await e.frameStart(plain, t, 1001 / 30000), undefined);
      assert.equal(reads, 0);
      e.run = run;
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "une image qui commence pile au bout de la marge d'une milliseconde, au milieu d'un plan, dans un segment qui ne commence pas au point d'entrée : le film montre ce que montre le moniteur, débruitage et vitesses comprises",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-borne-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      // Base 1/600 comme un iPhone, 30 i/s, sauf l'image 370 posée à la
      // graduation 7408 : 12,3466667 s, soit une milliseconde exactement
      // après l'image 190 d'un plan ouvert à 6,006 s dans une séquence 29,97.
      const ticks = grid(420);
      ticks[370] = 7408;
      const source = await movie(e, root, "borne", ticks),
        us = micros(source),
        asset = await media(e, source);
      assert.equal(us[370], 12346667);
      const wrong = [];
      for (const [speed, denoise, starts] of [
        [1, undefined, [70, 150]],
        [1, "medium", [70, 150]],
        [1.5, undefined, [40, 90]],
        [0.5, "medium", [60, 150]],
      ]) {
        // Le plan va jusqu'au bout du rush (14 s).
        const duration = Math.min(240, Math.floor(((14 - 6.006) * 29.97) / speed) - 1);
        let s = { ...M.sequence(), width: 144, height: 72, fps: NTSC, clips: [] };
        s = EDIT.addClip(s, asset, 0);
        s.clips = s.clips.map((c) => ({ ...c, inUs: 6006000, duration, speed, ...(denoise ? { denoise } : {}) }));
        for (const start of starts)
          wrong.push(...(await differences(e, root, s, asset, source, us, `x${speed}${denoise ? ", débruitage" : ""}, segment à ${start}`, start, Math.min(150, duration - start))));
      }
      assert.deepEqual(wrong, []);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
/**
 * Un carré texturé qui avance de 4 pixels par image du rush (jusqu'à l'image
 * 40), sur un fond gris de 192 x 108 : sa position dit quelle image du rush
 * le suivi a lue. Quatre pixels du rush en font dix à l'analyse (480 de
 * large) : un pas entier, que le suivi retrouve sans dériver.
 */
const SW = 192,
  SH = 108,
  squareAt = (i) => 4 + 4 * Math.min(i, 40);
function squares(n) {
  const buf = Buffer.alloc(SW * SH * n, 90);
  for (let i = 0; i < n; i++)
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++)
        buf[i * SW * SH + (46 + y) * SW + squareAt(i) + x] = (x >> 2) % 2 === (y >> 2) % 2 ? 240 : 10;
  return buf;
}
test(
  "le suivi de masque lit les images du film : sur un rush à trous et en MPEG-TS au milieu d'un GOP, la trajectoire part de l'image que montre le moniteur",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-suivi-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      // Trou après l'image 29 : elle reste à l'écran de la graduation 29 à 34.
      const holes = await movie(e, root, "suivi-trous", [...grid(30), ...grid(50, 20, 680)], { frames: squares, size: [SW, SH], out: [SW, SH] }),
        raw = path.join(root, "carres.gray"),
        ts = path.join(root, "suivi.mts");
      await fs.writeFile(raw, squares(90));
      await e.ff(["-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", SW + "x" + SH, "-r", "30000/1001", "-i", raw, "-vf", "format=yuv420p", "-c:v", "h264_videotoolbox", "-b:v", "4M", "-g", "12", "-f", "mpegts", ts]);
      for (const [name, source, inUs] of [
        ["rush à trous", holes, (31.5 * 1e6) / 30],
        ["MPEG-TS", ts, (20.5 * 1001e6) / 30000],
      ]) {
        const us = micros(source),
          asset = await media(e, source),
          sequence = { ...M.sequence(), width: SW, height: SH, fps: NTSC },
          clip = { id: "c", start: 0, duration: 12, inUs: Math.round(inUs), speed: 1, scale: 1, x: 0, y: 0, rotation: 0 },
          j0 = shownAt(us, clip, 0, NTSC),
          at = (j) => (squareAt(j) + 8) / SW,
          result = await TRACK.trackMask({
            engine: e,
            source,
            clip,
            mask: { keys: [{ frame: 0, x: at(j0), y: 0.5 }], width: 0.12, height: 0.2 },
            sequence,
            sourceFrame: asset.fps.d / asset.fps.n,
          });
        const wrong = [];
        for (const k of result.keys) {
          const want = at(shownAt(us, clip, k.frame, NTSC)) - at(j0),
            got = k.x - result.keys[0].x;
          if (Math.abs(got - want) > 1.5 / SW) wrong.push(`image ${k.frame} : ${(got * SW).toFixed(1)} px au lieu de ${(want * SW).toFixed(1)}`);
        }
        assert(result.keys.length >= 2, name);
        assert.deepEqual(wrong, [], name);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
