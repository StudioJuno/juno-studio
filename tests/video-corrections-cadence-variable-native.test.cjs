// Moniteur et film livré sur des rushes à cadence variable (29/09/2026,
// troisième passe), vérifiés sur de vrais fichiers : l'aperçu que lit le
// moniteur (engine.proxy), le film que rend l'export (render.cjs), et l'image
// que Chromium montre à l'arrêt, celle dont l'intervalle contient l'instant
// demandé, en microsecondes (instants des images arrondis, instant demandé
// tronqué, mesuré dans Electron).
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
const EDIT = front("src/video/edit.ts"),
  INDEX = front("src/video/frame-index.ts");
/** Rush « compteur » : l'image i porte i + 1 en binaire sur 9 bandes. */
const W = 72,
  Hh = 36,
  BITS = 9,
  BAND = W / BITS;
/**
 * Un rush H.264 en .mov, base de temps 1/600 comme un iPhone, dont l'image i
 * commence à `ticks[i]` / 600 s.
 */
async function vfr(e, root, name, ticks) {
  const raw = path.join(root, name + ".gray"),
    n = ticks.length,
    buf = Buffer.alloc(W * Hh * n);
  for (let i = 0; i < n; i++)
    for (let k = 0; k < BITS; k++)
      if (((i + 1) >> k) & 1)
        for (let y = 0; y < Hh; y++)
          buf.fill(255, i * W * Hh + y * W + k * BAND, i * W * Hh + y * W + (k + 1) * BAND);
  await fs.writeFile(raw, buf);
  // Pas le plus fréquent, plus un échelon à chaque écart différent.
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
    // Entrée à 600 i/s : la base de temps des filtres vaut la graduation, et
    // setpts pose chaque instant sans le tronquer.
    "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", W + "x" + Hh, "-r", "600", "-i", raw,
    "-vf", `setpts=(${expr})/(600*TB),scale=144:72:flags=neighbor,format=yuv420p`,
    "-fps_mode", "passthrough", "-c:v", "h264_videotoolbox", "-b:v", "4M",
    "-video_track_timescale", "600", file,
  ]);
  return file;
}
/** Les instants des images d'un fichier, en microsecondes arrondies. */
function micros(file) {
  const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v", "-show_entries", "stream=time_base,avg_frame_rate:packet=pts", "-of", "json", file]);
  const j = JSON.parse(r.stdout),
    [n, d] = j.streams[0].time_base.split("/").map(Number),
    [fn, fd] = j.streams[0].avg_frame_rate.split("/").map(Number);
  return {
    us: j.packets.map((p) => Math.round((p.pts * n * 1e6) / d)).sort((a, b) => a - b),
    exact: j.packets.map((p) => (p.pts * n * 1e6) / d).sort((a, b) => a - b),
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
/** Des images toutes les 20 graduations de 1/600 s (30 i/s), sauf `holes`. */
const skipped = (n, holes) => {
  const out = [];
  for (let i = 0; out.length < n; i++) if (!holes.includes(i)) out.push(i * 20);
  return out;
};
// Écarts d'un enregistrement d'écran : irréguliers, jamais sur une grille.
const SCREEN = (() => {
  const gaps = [70, 10, 10, 10, 10, 10, 10, 10, 13, 7, 10, 30, 10, 10, 11, 9, 50, 10, 10, 10],
    out = [0];
  for (let i = 1; i < 300; i++) out.push(out[i - 1] + gaps[i % gaps.length]);
  return out;
})();
test(
  "cadence variable : l'aperçu garde les instants du rush, et le moniteur montre à chaque image l'image du film livré, coupes et ralentis compris",
  { skip, timeout: 600000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-cadence-variable-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      const cases = [
        // Rush d'iPhone : une image sautée après l'image 10.
        { name: "iphone", ticks: skipped(300, [11]), seqs: [{ n: 30000, d: 1001 }, { n: 30, d: 1 }, { n: 25, d: 1 }] },
        // Plusieurs images sautées, dont des trous de 3, 4 et 6 images sous
        // les coupes : l'export, qui ne relisait qu'une image moyenne en
        // arrière, ouvrait le plan sur l'image d'après le trou.
        { name: "sauts", ticks: skipped(300, [5, 20, 21, 36, 37, 38, 60, 61, 62, 63, 100, 110, 111, 112, 113, 114, 115]), seqs: [{ n: 30000, d: 1001 }, { n: 25, d: 1 }] },
        // Enregistrement d'écran : aucune grille du tout. 180 images : le
        // setpts de FFmpeg n'accepte pas plus d'une centaine d'échelons.
        { name: "ecran", ticks: SCREEN.slice(0, 180), seqs: [{ n: 60000, d: 1001 }, { n: 30000, d: 1001 }] },
      ];
      for (const c of cases) {
        const source = await vfr(e, root, c.name, c.ticks),
          { us: sourceUs, exact: sourceExact, fps } = micros(source);
        assert.deepEqual(sourceUs, c.ticks.map((t) => Math.round((t * 1e6) / 600)), `${c.name} : instants du rush`);
        const asset = {
          id: "a",
          name: c.name + ".mov",
          kind: "video",
          duration: (c.ticks[c.ticks.length - 1] + 20) / 600,
          fps,
          inputSpace: "rec709",
          audioChannels: 0,
        };
        // L'aperçu que lit le moniteur : mêmes images, mêmes instants.
        const proxy = path.join(root, c.name + "-apercu.mp4");
        await e.proxy(source, asset, proxy);
        const proxyExact = micros(proxy).exact;
        assert.deepEqual(micros(proxy).us, sourceUs, `${c.name} : instants de l'aperçu`);
        // Ces instants, le moniteur les lit dans l'index de l'aperçu.
        const times = INDEX.fileTimes(new Uint8Array(fss.readFileSync(proxy)));
        assert.deepEqual(times, sourceUs, `${c.name} : index de l'aperçu`);
        for (const seq of c.seqs)
          for (const speed of [1, 2, 0.5, 0.25]) {
            let s = { ...M.sequence(), width: 144, height: 72, fps: seq, clips: [] };
            s = EDIT.addClip(s, asset, 0);
            const count = Math.min(150, Math.floor(s.clips[0].duration / speed) - 2);
            s.clips[0] = { ...s.clips[0], speed, duration: count };
            for (const at of [37, 111]) {
              const clip = s.clips.find((x) => x.start < at && x.start + x.duration > at);
              if (clip) s = EDIT.split(s, clip.id, at);
            }
            const out = path.join(root, `film-${c.name}.mov`);
            await R.renderSegment(
              {
                engine: e,
                sequence: s,
                assets: new Map([["a", asset]]),
                registry: { a: { source } },
                cache: root,
                start: 0,
                count,
              },
              out,
            );
            const film = read(out),
              label = `${c.name}, séquence ${(seq.n / seq.d).toFixed(3)} i/s, vitesse ${speed}`;
            assert.equal(film.length, count, label);
            for (let f = 0; f < count; f++) {
              const clip = s.clips.find((x) => x.start <= f && x.start + x.duration > f);
              // Le film : la dernière image du rush commencée au plus une
              // milliseconde de montage après l'instant voulu, comptée comme
              // FFmpeg la compte (render.cjs, `retime`), trous compris.
              let want = -1;
              for (let k = 0; k < sourceUs.length; k++) {
                const q = Math.trunc((sourceUs[k] - clip.inUs) / clip.speed - 1000);
                if (Math.ceil((q * seq.n) / (seq.d * 1e6)) <= f - clip.start) want = k;
              }
              assert.equal(film[f], want, `${label}, image ${f} du film`);
              // Sans index : l'instant voulu plus la marge.
              assert.equal(shown(proxyExact, EDIT.monitorTime(clip, asset, s, f)), film[f], `${label}, image ${f} au moniteur, sans index`);
              // Avec l'index : le milieu de l'image du film.
              const at = EDIT.monitorFrameTime(times, clip, s, f) * 1e6,
                k = proxyExact.findLastIndex((x) => x <= at);
              assert.equal(k, film[f], `${label}, image ${f} au moniteur`);
              const next = proxyExact[k + 1] ?? proxyExact[k] + 40000;
              assert(at - proxyExact[k] > 0.4 * (next - proxyExact[k]) && next - at > 0.4 * (next - proxyExact[k]), `${label}, image ${f} : ${at}`);
            }
          }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "le début de l'image à l'écran se lit dans les paquets, et seulement quand la cadence n'est pas régulière",
  { skip, timeout: 120000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-image-ecran-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      // Trou de l'image 110 à l'image 115 : l'image 109 reste à l'écran de
      // 3,633 s à 3,867 s.
      const source = await vfr(e, root, "trou", skipped(200, [110, 111, 112, 113, 114, 115]));
      const track = await e.videoTrack(source);
      assert.equal(track.regular, false);
      assert.equal(await e.videoTick(source), 1 / 600);
      // Le -ss de l'export se pose sur trois graduations de 1/600 s : 5 ms,
      // une microseconde entière.
      assert(Math.abs((await e.seekGrain(source)) - 0.005) < 1e-12);
      for (const t of [3.64, 3.7, 3.8, 3.8666])
        assert(Math.abs((await e.frameStart(source, t)) - 109 / 30) < 1e-6, "instant " + t);
      assert(Math.abs((await e.frameStart(source, 3.8667)) - 116 / 30) < 1e-6);
      assert(Math.abs((await e.frameStart(source, 1.01)) - 1) < 1e-6);
      // Cadence régulière : une image en arrière suffit, rien n'est lu.
      const raw = path.join(root, "reg.gray");
      await fs.writeFile(raw, Buffer.alloc(W * Hh * 50));
      const regular = path.join(root, "reg.mov");
      await e.ff(["-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", W + "x" + Hh, "-r", "25", "-i", raw, "-c:v", "prores_ks", regular]);
      const { regular: steady, timeBase } = await e.videoTrack(regular),
        grain = await e.seekGrain(regular),
        ticks = (grain * timeBase.d) / timeBase.n;
      assert.equal(steady, true);
      assert.equal(await e.frameStart(regular, 1.01), undefined);
      assert(Math.abs(grain * 1e6 - Math.round(grain * 1e6)) < 1e-6, "pas en microsecondes entières : " + grain);
      assert(ticks >= 1 && Math.abs(ticks - Math.round(ticks)) < 1e-6, "pas en graduations entières : " + ticks);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
