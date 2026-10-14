// Film livré contre moniteur, quatrième passe (29/09/2026), sur de vrais
// fichiers et de vrais rendus FFmpeg :
// - un rush à trous en Matroska (.mkv, .webm), ou un .mov dont les trous sont
//   compensés plus loin, passait pour régulier : une coupe tombée dans un
//   trou ouvrait le plan du film sur l'image d'après le trou ;
// - un .mkv n'annonce pas la durée de son image : le média prenait celle du
//   conteneur, son compris, et le plan posé en entier gagnait au film une
//   image finale noire.
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
  R = require("../electron/video/render.cjs");
const nativeRoot = path.join(__dirname, "../native", process.platform + "-" + process.arch),
  colorRoot = path.join(__dirname, "../public/video-color"),
  exe = process.platform === "win32" ? ".exe" : "",
  ffmpeg = path.join(nativeRoot, "ffmpeg" + exe),
  ffprobe = path.join(nativeRoot, "ffprobe" + exe),
  // Les rushes à trous sont encodés par VideoToolbox.
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
/**
 * Un rush H.264 en .mov, base de temps 1/600 comme un iPhone, dont l'image i
 * commence à `ticks[i]` / 600 s, avec un son de `sound` secondes s'il y a
 * lieu.
 */
async function vfr(e, root, name, ticks, sound = 0) {
  const raw = path.join(root, name + ".gray"),
    n = ticks.length;
  await fs.writeFile(raw, counterFrames(n));
  const steps = {};
  for (let k = 1; k < n; k++) steps[ticks[k] - ticks[k - 1]] = (steps[ticks[k] - ticks[k - 1]] || 0) + 1;
  const base = Number(Object.entries(steps).sort((a, b) => b[1] - a[1])[0][0]);
  let expr = `${ticks[0]}+${base}*N`;
  for (let k = 1; k < n; k++) {
    const d = ticks[k] - ticks[k - 1] - base;
    if (d) expr += `${d > 0 ? "+" : "-"}gte(N\\,${k})*${Math.abs(d)}`;
  }
  const file = path.join(root, name + ".mov");
  await e.ff([
    "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", W + "x" + Hh, "-r", "600", "-i", raw,
    ...(sound ? ["-f", "lavfi", "-i", `sine=f=440:r=48000:d=${sound}`] : []),
    "-vf", `setpts=(${expr})/(600*TB),scale=144:72:flags=neighbor,format=yuv420p`,
    "-fps_mode", "passthrough", "-c:v", "h264_videotoolbox", "-b:v", "4M",
    ...(sound ? ["-c:a", "aac"] : []),
    "-video_track_timescale", "600", file,
  ]);
  return file;
}
/**
 * Un rush à trous compensés par des images en plus : la dernière image dure
 * une image entière (une image de plus, retirée au remux), si bien que la
 * cadence moyenne égale la cadence annoncée, 30 i/s, comme sur un vrai
 * fichier. Seule la table d'échantillons montre les trous.
 */
async function compensated(e, root, name, ticks) {
  const longer = await vfr(e, root, name + "-long", [...ticks, ticks[ticks.length - 1] + 20]),
    file = path.join(root, name + ".mov");
  await e.ff(["-y", "-i", longer, "-map", "0", "-c", "copy", "-frames:v", String(ticks.length), "-video_track_timescale", "600", file]);
  const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v", "-show_entries", "stream=r_frame_rate,avg_frame_rate", "-of", "csv=p=0", file]);
  assert.equal(r.stdout.toString().trim(), "30/1,30/1", "cadence annoncée et cadence moyenne égales");
  return file;
}
/** Le même rush, remuxé sans réencodage dans un autre conteneur. */
async function remux(e, file, target, extra = []) {
  await e.ff(["-y", "-i", file, "-map", "0", "-c", "copy", ...extra, target]);
  return target;
}
/** Les instants des images d'un fichier, en microsecondes, et sa cadence moyenne. */
function micros(file) {
  const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v", "-show_entries", "stream=time_base,avg_frame_rate:packet=pts", "-of", "json", file]);
  const j = JSON.parse(r.stdout),
    [n, d] = j.streams[0].time_base.split("/").map(Number),
    [fn, fd] = j.streams[0].avg_frame_rate.split("/").map(Number);
  return {
    us: j.packets.map((p) => Math.round((p.pts * n * 1e6) / d)).sort((a, b) => a - b),
    fps: { n: fn, d: fd },
  };
}
/** Le numéro porté par chaque image d'un fichier : -1 pour une image noire. */
function read(file) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-fps_mode", "passthrough", "-vf", `scale=${W}:${Hh}:flags=area,format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  const out = [];
  for (let off = 0; off + W * Hh <= r.stdout.length; off += W * Hh) {
    let v = 0;
    for (let k = 0; k < BITS; k++)
      if (r.stdout[off + (Hh >> 1) * W + Math.round((k + 0.5) * BAND)] > 128) v |= 1 << k;
    out.push(v - 1);
  }
  return out;
}
/** Des images toutes les 20 graduations de 1/600 s (30 i/s), sauf `holes`, plus `extras` à mi-chemin. */
function grid(n, holes, extras = []) {
  const out = [];
  for (let i = 0; out.length < n; i++) {
    if (!holes.includes(i)) out.push(i * 20);
    if (extras.includes(i) && out.length < n) out.push(i * 20 + 10);
  }
  return out;
}
// Trous sous les coupes à 37 et 111 d'une séquence en 29,97, aux trois
// vitesses (x1 : 37, 111 ; x2 : 74, 222 ; x0,5 : 18, 55).
const HOLES = [5, 17, 18, 19, 35, 36, 37, 38, 55, 56, 72, 73, 74, 75, 90, 108, 109, 110, 111, 112, 150, 151, 200, 201, 202, 203, 204, 205, 220, 221, 222, 223];
const NTSC = { n: 30000, d: 1001 };
/**
 * Rend `s` de `start` à `start + count` et compare chaque image du film à
 * celle que le moniteur montre : la dernière image du rush commencée au plus
 * une milliseconde de montage après l'instant voulu, comptée comme FFmpeg la
 * compte (render.cjs, `retime`), trous compris.
 */
async function check(e, root, s, asset, source, us, label, start = 0, count = M.duration(s)) {
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
      clip = s.clips.find((x) => x.start <= f && x.start + x.duration > f);
    let want = -1;
    for (let k = 0; k < us.length; k++) {
      const q = Math.trunc((us[k] - clip.inUs) / clip.speed - 1000);
      if (Math.ceil((q * s.fps.n) / (s.fps.d * 1e6)) <= f - clip.start) want = k;
    }
    if (film[i] !== want) wrong.push(`image ${f} : ${film[i]} au lieu de ${want}`);
  }
  assert.deepEqual(wrong, [], label);
}
test(
  "Matroska et trous compensés : la piste n'est plus jugée régulière sur sa cadence annoncée, et le début de l'image à l'écran est lu",
  { skip, timeout: 120000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-piste-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      const holes = await vfr(e, root, "trous", grid(200, HOLES)),
        mkv = await remux(e, holes, path.join(root, "trous.mkv")),
        // Les trous sous les coupes sont compensés par des images en plus,
        // plus loin : cadence annoncée et cadence moyenne restent égales.
        balanced = await compensated(e, root, "compense", grid(300, [35, 36, 37, 38, 108, 109, 110, 111, 112], [150, 151, 152, 153, 154, 160, 161, 162, 163]));
      for (const [file, name] of [[mkv, "Matroska"], [balanced, "trous compensés"]]) {
        const track = await e.videoTrack(file);
        assert.equal(track.regular, false, name);
        // L'image 34 (grille 34) reste à l'écran jusqu'à la grille 39.
        const at = (37 * 1001) / 30000 + 0.001,
          shown = await e.frameStart(file, at);
        assert(Math.abs(shown - 34 / 30) < 0.001, `${name} : ${shown}`);
      }
      // Un .mov régulier se juge sur sa table d'échantillons : rien à lire.
      const raw = path.join(root, "reg.gray");
      await fs.writeFile(raw, counterFrames(60));
      const regular = path.join(root, "reg.mp4");
      await e.ff(["-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", W + "x" + Hh, "-r", "30000/1001", "-i", raw, "-vf", "format=yuv420p", "-c:v", "h264_videotoolbox", "-b:v", "2M", regular]);
      const steady = await e.videoTrack(regular);
      assert.equal(steady.regular, true);
      assert(Math.abs(steady.gap - 1001 / 30000) < 1e-9);
      assert.equal(await e.frameStart(regular, 1.01), undefined);
      // Mais pas pour une remontée plus courte que ses images.
      assert(Math.abs((await e.frameStart(regular, 1.01, 0.02)) - (30 * 1001) / 30000) < 0.001);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "rush à trous en .mkv, et .mov aux trous compensés : chaque plan du film s'ouvre sur l'image que montre le moniteur, à x1, x2 et x0,5, et un segment qui commence dans un trou aussi",
  { skip, timeout: 600000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-trous-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      const mov = await vfr(e, root, "trous", grid(300, HOLES)),
        cases = [
          ["Matroska", await remux(e, mov, path.join(root, "trous.mkv"))],
          ["trous compensés", await compensated(e, root, "compense", grid(300, [17, 18, 19, 35, 36, 37, 38, 55, 56, 72, 73, 74, 75, 108, 109, 110, 111, 112], [150, 151, 152, 153, 154, 155, 156, 157, 158, 160, 161, 162, 163, 164, 165, 166, 167, 168]))],
        ];
      for (const [name, source] of cases) {
        const { us } = micros(source),
          meta = await e.probe(source),
          asset = { id: "a", name: path.basename(source), ...meta, inputSpace: "rec709" };
        for (const speed of [1, 2, 0.5]) {
          let s = { ...M.sequence(), width: 144, height: 72, fps: NTSC, clips: [] };
          s = EDIT.addClip(s, asset, 0);
          const count = Math.min(150, Math.floor(s.clips[0].duration / speed) - 2);
          s.clips[0] = { ...s.clips[0], speed, duration: count };
          const whole = s;
          for (const at of [37, 111]) {
            const clip = s.clips.find((x) => x.start < at && x.start + x.duration > at);
            if (clip) s = EDIT.split(s, clip.id, at);
          }
          await check(e, root, s, asset, source, us, `${name}, vitesse ${speed}`);
          // Sans coupe, le segment suivant commence dans le trou.
          await check(e, root, whole, asset, source, us, `${name}, vitesse ${speed}, segment à 37`, 37, 20);
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "un .mkv dont le son déborde de l'image : le média dure ce que dure son image, et le plan posé en entier finit sur la dernière image, sans image noire",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-fin-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      // 120 images à 30 i/s (4 s), son de 4,2 s : il déborde de six images
      // de montage en 29,97.
      const mov = await vfr(e, root, "fin", grid(120, []), 4.2),
        tagged = await remux(e, mov, path.join(root, "fin.mkv")),
        // Écrit en flux, comme un enregistrement interrompu : ni étiquette
        // DURATION, ni rien d'autre que les paquets.
        streamed = path.join(root, "flux.mkv");
      await fs.writeFile(streamed, spawnSync(ffmpeg, ["-v", "error", "-i", mov, "-map", "0", "-c", "copy", "-f", "matroska", "-"], { maxBuffer: 1 << 28 }).stdout);
      // La durée que le .mov annonce pour son image, celle qu'il faut retrouver.
      const end = (await e.probe(mov)).duration;
      assert(end > 3.9 && end <= 4.0001, String(end));
      for (const [name, source] of [["étiquette DURATION", tagged], ["sans étiquette", streamed]]) {
        const meta = await e.probe(source);
        // Le conteneur compte le son ; écrit en flux, il n'annonce rien.
        assert(meta.containerDuration > end + 0.15 || (source === streamed && !meta.containerDuration), `${name} : conteneur ${meta.containerDuration}`);
        assert(Math.abs(meta.duration - end) < 0.002, `${name} : ${meta.duration} au lieu de ${end}`);
        // La durée du son sert au contrôle de la voix améliorée.
        assert(Math.abs(meta.audioDuration - meta.containerDuration) < 0.05, `${name} : son ${meta.audioDuration}`);
        const asset = { id: "a", name: path.basename(source), ...meta, inputSpace: "rec709" };
        let s = { ...M.sequence(), width: 144, height: 72, fps: NTSC, clips: [] };
        s = EDIT.addClip(s, asset, 0);
        assert.equal(M.duration(s), Math.round(end * (30000 / 1001)), name);
        // Toutes les images du plan, la dernière comprise, sont celles du
        // moniteur : aucune image noire au bout.
        await check(e, root, s, asset, source, micros(source).us, name);
      }
      // L'image s'arrête bien avant le son : les derniers paquets n'en ont
      // aucune, tout le fichier est lu.
      const early = await vfr(e, root, "court", grid(60, []), 5),
        short = path.join(root, "court.mkv");
      await fs.writeFile(short, spawnSync(ffmpeg, ["-v", "error", "-i", early, "-map", "0", "-c", "copy", "-f", "matroska", "-"], { maxBuffer: 1 << 28 }).stdout);
      const v = (await e.videoTrack(short)).index,
        stop = (await e.probe(early)).duration;
      assert(stop > 1.9 && stop <= 2.0001, String(stop));
      assert(Math.abs((await e.pictureEnd(short, { index: v, tags: {} }, 0, 5, { n: 30, d: 1 })) - stop) < 0.002);
      assert(Math.abs((await e.probe(short)).duration - stop) < 0.002);
      // Un seul passage de ffprobe à l'import d'un .mov ou d'un .mkv étiqueté ;
      // les paquets ne sont lus que sans étiquette.
      const run = e.run.bind(e);
      let runs = 0;
      e.run = (...args) => (runs++, run(...args));
      for (const [file, want] of [[mov, 1], [tagged, 1], [streamed, 2]]) {
        runs = 0;
        await e.probe(file);
        assert.equal(runs, want, path.basename(file));
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test("la remontée du rendu n'est jamais plus courte qu'une image, quoi que dise le début de l'image à l'écran", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-film-remontee-"));
  try {
    const source = path.join(root, "rush.mkv");
    await fs.writeFile(source, "");
    const asset = { id: "a", name: "rush.mkv", kind: "video", duration: 60, fps: { n: 25, d: 1 }, inputSpace: "rec709", audioChannels: 0 };
    let s = { ...M.sequence(), width: 144, height: 72, fps: { n: 25, d: 1 }, clips: [] };
    s = EDIT.addClip(s, asset, 0);
    s.clips[0] = { ...s.clips[0], inUs: 20e6 };
    const seek = async (frameStart) => {
      const calls = [],
        engine = {
          seekGrain: async () => 0.001,
          inputFilter: () => "",
          frameStart: async (file, t, period) => {
            calls.push(period);
            return frameStart(t);
          },
        },
        b = await R.buildSegment({ engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source } }, cache: root, start: 0, count: 25 });
      assert.deepEqual(calls, [0.04], "le rendu donne au moteur la durée d'une image");
      return Number(b.inputs[b.inputs.indexOf("-ss") + 1]);
    };
    const base = await seek(() => undefined);
    assert(Math.abs(base - (20 - 0.04 - 0.001)) < 0.0011, String(base));
    // Une image qui commence après le point d'entrée, ou juste avant.
    assert.equal(await seek((t) => t + 0.0004), base);
    assert.equal(await seek((t) => t - 0.01), base);
    // Une image commencée bien avant : la lecture remonte jusqu'à elle.
    assert(Math.abs((await seek((t) => t - 0.3)) - (20 - 0.3)) < 0.0021);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
