// Corrections du studio vidéo après relecture (29/09/2026), vérifiées sur de
// vrais rendus FFmpeg : à chaque image, le moniteur vise l'image que le film
// livré montre. Le code du moniteur (src/video) est relu tel quel, par esbuild.
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
  { recordSequence, restoreSequence } = require("../electron/video/commands.cjs");
const nativeRoot = path.join(__dirname, "../native", process.platform + "-" + process.arch),
  colorRoot = path.join(__dirname, "../public/video-color"),
  ffmpeg = path.join(nativeRoot, "ffmpeg" + (process.platform === "win32" ? ".exe" : "")),
  skip = !fss.existsSync(ffmpeg);
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
const EDIT = front("src/video/edit.ts"),
  INDEX = front("src/video/frame-index.ts"),
  HISTORY = front("src/video/history.ts");
/** Rush « compteur » : l'image i porte i + 1 en binaire sur 9 bandes. */
const W = 72,
  Hh = 36,
  BITS = 9,
  BAND = W / BITS;
async function counter(e, root, name, frames, rate, extra = []) {
  const raw = path.join(root, name + ".gray"),
    buf = Buffer.alloc(W * Hh * frames);
  for (let i = 0; i < frames; i++)
    for (let k = 0; k < BITS; k++)
      if (((i + 1) >> k) & 1)
        for (let y = 0; y < Hh; y++)
          buf.fill(255, i * W * Hh + y * W + k * BAND, i * W * Hh + y * W + (k + 1) * BAND);
  await fs.writeFile(raw, buf);
  const file = path.join(root, name + ".mov");
  await e.ff([
    "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", W + "x" + Hh, "-r", rate, "-i", raw,
    "-vf", "scale=144:72:flags=neighbor,format=yuv422p10le",
    "-c:v", "prores_ks", "-profile:v", "3", ...extra, file,
  ]);
  return file;
}
/** Les instants des images d'un fichier, en microsecondes exactes. */
function micros(file) {
  const r = spawnSync(path.join(nativeRoot, "ffprobe" + (process.platform === "win32" ? ".exe" : "")), ["-v", "error", "-select_streams", "v", "-show_entries", "stream=time_base:packet=pts", "-of", "json", file]);
  const j = JSON.parse(r.stdout),
    [n, d] = j.streams[0].time_base.split("/").map(Number);
  return j.packets.map((p) => (p.pts * n * 1e6) / d).sort((a, b) => a - b);
}
/**
 * L'image que Chromium montre à l'arrêt à l'instant `t` : celle dont
 * l'intervalle contient `t`. Il ne tranche qu'à une microseconde près autour
 * du début d'une image (mesuré dans Electron : montrée de 1,5 µs avant son
 * début à 1 µs après) : hors de ces marges, la réponse est un texte.
 */
function shown(exact, t) {
  const at = t * 1e6;
  let i = -1;
  for (let k = 0; k < exact.length; k++) if (exact[k] <= at) i = k;
  const start = i < 0 ? -Infinity : exact[i],
    next = i + 1 < exact.length ? exact[i + 1] : Infinity;
  return at - start > 1 && next - at >= 2 ? i : `${i} à ${(at - start).toFixed(2)} µs de son début, ${(next - at).toFixed(2)} µs de la suivante`;
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
test("la marge du moniteur est celle de l'export", () => {
  assert.match(R.retime(0, 1, "25/1"), new RegExp(`-${EDIT.EXPORT_SLACK}/TB,`));
});
test("le point de lecture de l'export tombe sur une graduation de la piste image", () => {
  // Base de 1/12800 : 3,662699 s tombait entre deux graduations, et FFmpeg
  // décalait toutes les images de 35 µs.
  const r = R.readWindow(3.703699, 0, 0.04, 1 / 12800);
  assert.equal(r.seek * 12800, 46882);
  assert(Math.abs(r.video - (3.662699 - 46882 / 12800)) < 1e-9);
  assert(Math.abs(r.audio - (3.703699 - 46882 / 12800)) < 1e-9);
  // Base de 1/25 : le point recule jusqu'à la graduation d'avant.
  const coarse = R.readWindow(5.01, 0, 0.04, 1 / 25);
  assert(Math.abs(coarse.seek - 4.96) < 1e-9 && Math.abs(coarse.video - 0.009) < 1e-9);
  // Sans base connue, ni près du début, rien ne change.
  assert.deepEqual(R.readWindow(3.703699, 0, 0.04), R.readWindow(3.703699, 0, 0.04, 0));
  assert.deepEqual(R.readWindow(0.1, 0, 0.04, 1 / 25).seek, 0);
});
test(
  "le moniteur montre, à chaque image, l'image que le film livré montre, lue dans l'aperçu qu'il lit : 25, 29,97, 23,976, 59,94, cadences mêlées, vitesse 1,5 et bases de temps grossières",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-moniteur-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      const cases = [
        { rush: { n: 25, d: 1 }, seq: { n: 25, d: 1 }, count: 150 },
        { rush: { n: 30000, d: 1001 }, seq: { n: 30000, d: 1001 }, count: 150 },
        { rush: { n: 24000, d: 1001 }, seq: { n: 24000, d: 1001 }, count: 150 },
        { rush: { n: 60000, d: 1001 }, seq: { n: 60000, d: 1001 }, count: 150 },
        // Aux images 193 et 199, l'image suivante du rush commence moins
        // d'une milliseconde après l'instant : l'export la prend déjà.
        { rush: { n: 25, d: 1 }, seq: { n: 30000, d: 1001 }, count: 210 },
        { rush: { n: 30000, d: 1001 }, seq: { n: 30000, d: 1001 }, count: 120, speed: 1.5 },
        // Bases de temps grossières : 1/600 (iPhone), 1/25. FFmpeg y arrondit
        // le décalage d'un -ss d'une demi-graduation.
        { rush: { n: 25, d: 1 }, seq: { n: 30000, d: 1001 }, count: 240, extra: ["-video_track_timescale", "600"] },
        { rush: { n: 25, d: 1 }, seq: { n: 30000, d: 1001 }, count: 240, extra: ["-video_track_timescale", "25"] },
        { rush: { n: 30, d: 1 }, seq: { n: 25, d: 1 }, count: 240, extra: ["-video_track_timescale", "600"] },
        // Un 29,97 que la base 1/600 ne sait pas écrire : ses images tombent
        // jusqu'à 0,8 ms à côté de la grille.
        { rush: { n: 30000, d: 1001 }, seq: { n: 30000, d: 1001 }, count: 240, extra: ["-video_track_timescale", "600"] },
      ];
      for (const [i, c] of cases.entries()) {
        const rate = c.rush.n / c.rush.d,
          frames = Math.ceil((c.count / (c.seq.n / c.seq.d)) * (c.speed || 1) * rate) + 2,
          source = await counter(e, root, "rush" + i, frames, c.rush.n + "/" + c.rush.d, c.extra);
        const asset = {
          id: "a",
          name: "rush.mov",
          kind: "video",
          duration: frames / rate,
          fps: c.rush,
          inputSpace: "rec709",
          audioChannels: 0,
        };
        // Le montage tel que l'interface le fait : plan posé, vitesse, coupes
        // à la touche S (point source arrondi vers le bas).
        let s = { ...M.sequence(), width: 144, height: 72, fps: c.seq, clips: [] };
        s = EDIT.addClip(s, asset, 0);
        s.clips[0] = { ...s.clips[0], speed: c.speed || 1, duration: c.count };
        for (const at of [37, 111]) {
          const clip = s.clips.find((x) => x.start < at && x.start + x.duration > at);
          s = EDIT.split(s, clip.id, at);
        }
        assert.deepEqual(s.clips.map((x) => x.start), [0, 37, 111]);
        const out = path.join(root, `film-${i}.mov`);
        await R.renderSegment(
          {
            engine: e,
            sequence: s,
            assets: new Map([["a", asset]]),
            registry: { a: { source } },
            cache: root,
            start: 0,
            count: c.count,
          },
          out,
        );
        const film = read(out);
        assert.equal(film.length, c.count);
        // L'aperçu que lit le moniteur, avec ses vrais instants.
        const proxy = path.join(root, `apercu-${i}.mp4`);
        await e.proxy(source, asset, proxy);
        const us = micros(proxy);
        assert.deepEqual(us.map(Math.round), micros(source).map(Math.round), "instants de l'aperçu");
        const times = INDEX.fileTimes(new Uint8Array(fss.readFileSync(proxy)));
        assert.deepEqual(times, us.map(Math.round), "index de l'aperçu");
        const label = (c.extra ? `base 1/${c.extra[1]}, ` : "") + `rush ${rate.toFixed(3)} i/s, séquence ${(c.seq.n / c.seq.d).toFixed(3)} i/s, vitesse ${c.speed || 1}`;
        for (let f = 0; f < c.count; f++) {
          const clip = s.clips.find((x) => x.start <= f && x.start + x.duration > f);
          assert.equal(shown(us, EDIT.monitorTime(clip, asset, s, f)), film[f], `${label}, image ${f}, sans index`);
          const at = EDIT.monitorFrameTime(times, clip, s, f) * 1e6;
          assert.equal(us.findLastIndex((x) => x <= at), film[f], `${label}, image ${f}`);
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test("une annulation refusée dit que rien n'a changé, et le pilote la rend comme une réponse", () => {
  const p = M.project("Commandes"),
    s = p.sequences[0],
    next = { ...s, masterGain: 0.5 };
  recordSequence(p, s, next, { id: "cmd", label: "Volume à -6 dB", source: "text" });
  p.sequences[0] = { ...next, masterGain: 0.6 };
  const before = JSON.stringify(p);
  let message = "";
  assert.throws(() => restoreSequence(p, "cmd", false, () => {}), (e) => ((message = e.message), true));
  assert.equal(
    message,
    "Rien n’a été annulé : le montage a été repris après « Volume à -6 dB ». Vos modifications sont conservées ; utilisez une version de secours pour revenir plus loin.",
  );
  assert.equal(JSON.stringify(p), before);
  assert(HISTORY.nothingRestored(message));
  // Rétablir par-dessus un montage repris depuis l'annulation.
  p.sequences[0] = next;
  restoreSequence(p, "cmd", false, () => {});
  p.sequences[0] = { ...p.sequences[0], masterGain: 0.7 };
  assert.throws(() => restoreSequence(p, "cmd", true, () => {}), (e) => ((message = e.message), true));
  assert.match(message, /^Rien n’a été rétabli : le montage a été repris après l’annulation de « Volume à -6 dB »/);
  assert(HISTORY.nothingRestored(message));
  assert.equal(p.commands[0].state, "undone");
});
