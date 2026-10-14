// Corrections du studio vidéo (audit du 29/09/2026), vérifiées sur de vrais
// rendus FFmpeg : chaque image est relue, pas seulement la durée du fichier.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { Engine } = require("../electron/video/engine.cjs"),
  { registerVideo } = require("../electron/video/index.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs"),
  CLEAN = require("../electron/video/cleanup.cjs"),
  LUT = require("../electron/video/lut.cjs");
const nativeRoot = path.join(
    __dirname,
    "../native",
    process.platform + "-" + process.arch,
  ),
  colorRoot = path.join(__dirname, "../public/video-color"),
  ffmpeg = path.join(nativeRoot, "ffmpeg" + (process.platform === "win32" ? ".exe" : "")),
  skip = !fss.existsSync(ffmpeg),
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
const engine = () => new Engine({ nativeRoot, colorRoot });
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
    ...extra,
    "-vf", "scale=144:72:flags=neighbor,format=yuv422p10le",
    "-c:v", "prores_ks", "-profile:v", "3", file,
  ]);
  return file;
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
const baseClip = (o) => ({
  id: "c" + Math.random().toString(36).slice(2),
  assetId: "a",
  start: 0,
  duration: 25,
  inUs: 0,
  track: 0,
  speed: 1,
  gain: 1,
  muted: false,
  opacity: 1,
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
  fadeIn: 0,
  fadeOut: 0,
  grade: { ...M.GRADE },
  component: "video",
  ...o,
});
test("la lecture d'un média commence avant le point d'entrée, et jamais par un -ss dans les premiers instants", () => {
  // Point arrondi une fraction de microseconde après l'image : on lit 1 ms avant.
  assert.deepEqual(R.readWindow(1.2345670), {
    seek: 1.233567,
    video: 0,
    audio: 1.2345670 - 1.233567,
  });
  // Près du début, aucun -ss : l'excédent est retiré dans les filtres.
  const near = R.readWindow(0.04);
  assert.equal(near.seek, 0);
  assert(Math.abs(near.video - 0.039) < 1e-9 && near.audio === 0.04);
  assert.deepEqual(R.readWindow(0), { seek: 0, video: 0, audio: 0 });
  // Le préchauffage des filtres temporels est lu pour l'image, pas pour le son.
  const warm = R.readWindow(5, 0.24);
  assert(Math.abs(warm.audio - 0.241) < 1e-9 && warm.video === 0);
  // Une image du rush de plus est lue : celle à l'écran au point d'entrée
  // a pu commencer avant lui.
  const frame = R.readWindow(5, 0, 0.04);
  assert(Math.abs(frame.seek - 4.959) < 1e-9 && Math.abs(frame.audio - 0.041) < 1e-9);
  // Les images passent en microsecondes, puis chacune tombe sur l'instant où
  // elle est à l'écran.
  assert.match(R.retime(0.5, 2, "25/1"), /^settb=AVTB,setpts=\(PTS-0\.50000000\/TB\)\/2\.00000000-0\.001\/TB,fps=25\/1:round=up:start_time=0:eof_action=pass$/);
});
test("à vitesse normale le son ne traverse aucun atempo, et chaque étage est compensé", () => {
  assert.equal(R.atempo(1), "");
  assert.equal(R.atempo(2), "adelay=1024S:all=1,atempo=2.00000000");
  assert.equal(
    R.atempo(4),
    "adelay=1024S:all=1,atempo=2,adelay=1024S:all=1,atempo=2.00000000",
  );
  assert.equal(
    R.atempo(0.25),
    "adelay=1024S:all=1,atempo=0.5,adelay=1024S:all=1,atempo=0.50000000",
  );
  assert.equal(R.atempo(1.5), "adelay=1024S:all=1,atempo=1.50000000");
  assert.equal(R.atempo(2, 96000), "adelay=2048S:all=1,atempo=2.00000000");
});
test("la stabilisation donne toujours un rayon que deshake accepte", () => {
  for (let i = 1; i <= 100; i++) {
    const [f] = CLEAN.sourceFilters({ stabilise: i / 100 });
    const rx = Number(/rx=(\d+)/.exec(f)[1]);
    assert.equal(rx % 16, 0, "stabilisation " + i / 100 + " : rx=" + rx);
    assert(rx >= 16 && rx <= 64);
  }
});
test("une LUT .cube qui écrit son domaine en LUT_3D_INPUT_RANGE est acceptée", () => {
  const lines = ['TITLE "Resolve"', "LUT_3D_INPUT_RANGE 0.0 2.0", "LUT_3D_SIZE 2"];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lines.push(`${r} ${g} ${b}`);
  const cube = LUT.parseCube(lines.join("\n"));
  assert.deepEqual(cube.min, [0, 0, 0]);
  assert.deepEqual(cube.max, [2, 2, 2]);
  // Le domaine est appliqué : 1,0 est au milieu d'un domaine de 0 à 2.
  assert.deepEqual(LUT.sample(cube, [1, 1, 1]).map((v) => Math.round(v * 100)), [50, 50, 50]);
  assert.throws(() => LUT.parseCube("LUT_3D_INPUT_RANGE 0 1 2\nLUT_3D_SIZE 2"), /Domaine/);
  assert.throws(() => LUT.parseCube("LUT_1D_SIZE 32"), /cube/);
});
test(
  "l'export est exact à l'image près en 29,97 : coupes, plan posé au milieu, frontière de segment et titres",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-exact-")),
      e = engine();
    try {
      await e.init();
      const fps = { n: 30000, d: 1001 },
        source = await counter(e, root, "c2997", 120, "30000/1001");
      // Le compteur occupe 144 x 72 au milieu d'une image de 144 x 88 : la
      // bande du bas ne montre que les titres.
      const s = { ...M.sequence(), width: 144, height: 88, fps };
      // Coupes toutes les 37 images, points d'entrée arrondis au plus près
      // comme dans les montages enregistrés avant la correction.
      const cuts = [0, 37, 74, 111];
      s.clips = cuts.slice(0, -1).map((c, i) =>
        baseClip({
          start: c,
          duration: cuts[i + 1] - c,
          inUs: Math.round(((c * fps.d) / fps.n) * 1e6),
        }),
      );
      // Un plan isolé posé à l'image 115, à cheval sur la frontière 120.
      s.clips.push(baseClip({ start: 115, duration: 12, inUs: 0 }));
      const white = path.join(root, "titre.png");
      await e.ff(["-y", "-f", "lavfi", "-i", "color=c=white:s=144x6:d=1", "-frames:v", "1", white]);
      const overlays = [29, 58, 97].map((start) => ({
        file: white,
        start,
        duration: 6,
        placement: { x: 72, y: 84, width: 144, height: 6, motion: {} },
      }));
      const common = {
        engine: e,
        sequence: s,
        assets: new Map([["a", { id: "a", kind: "video", duration: 120 / 29.97, inputSpace: "rec709", audioChannels: 0 }]]),
        registry: { a: { source } },
        cache: root,
        overlays,
      };
      const parts = [];
      for (const [start, count] of [[0, 120], [120, 7]]) {
        const out = path.join(root, `seg-${start}.mov`);
        await R.renderSegment({ ...common, start, count }, out);
        parts.push(...read(out));
        if (start === 0) {
          // Les titres se lisent en bas de l'image, sous le compteur.
          const r = spawnSync(ffmpeg, ["-v", "error", "-i", out, "-vf", "crop=144:4:0:82,scale=1:1:flags=area,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
          const lit = [...r.stdout].map((v, i) => (v > 128 ? i : -1)).filter((i) => i >= 0);
          assert.deepEqual(lit, [29, 30, 31, 32, 33, 34, 58, 59, 60, 61, 62, 63, 97, 98, 99, 100, 101, 102]);
        }
      }
      const want = [
        ...Array.from({ length: 111 }, (_, i) => i),
        ...Array(4).fill(-1),
        ...Array.from({ length: 12 }, (_, i) => i),
      ];
      assert.deepEqual(parts, want);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "un rush 25 i/s repris jusqu'au bout dans une séquence 29,97 ne finit pas sur une image noire",
  { skip, timeout: 120000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-mixte-")),
      e = engine();
    try {
      await e.init();
      const source = await counter(e, root, "c25", 50, "25"),
        fps = { n: 30000, d: 1001 },
        s = { ...M.sequence(), width: 144, height: 72, fps };
      // Le plan reprend le rush à l'image 15 de la séquence (0,5005 s, entre
      // deux images du rush) jusqu'au bout : ses 45 images commencent toutes
      // avant la fin du rush, la dernière comprise.
      const inUs = Math.floor(((15 * fps.d) / fps.n) * 1e6),
        duration = M.frameAt(2 - inUs / 1e6, fps);
      s.clips = [baseClip({ duration, inUs })];
      const out = path.join(root, "mixte.mov");
      await R.renderSegment(
        {
          engine: e,
          sequence: s,
          assets: new Map([["a", { id: "a", kind: "video", duration: 2, inputSpace: "rec709", audioChannels: 0 }]]),
          registry: { a: { source } },
          cache: root,
          start: 0,
          count: duration,
        },
        out,
      );
      const got = read(out);
      assert.equal(got.length, 45);
      assert(!got.includes(-1), "image noire : " + got.indexOf(-1));
      // Chaque image montre celle du rush à l'écran à son instant : au point
      // d'entrée, c'est l'image 12 (0,48 s), pas la suivante.
      const onScreen = got.map((_, k) => Math.floor((inUs / 1e6 + (k * fps.d) / fps.n) * 25 + 1e-6));
      assert.deepEqual(got, onScreen);
      assert.equal(got.at(-1), 49);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "un masque tombe à l'export là où le moniteur le montre, même sur un plan zoomé, déplacé ou vertical",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-mask-place-")),
      e = engine();
    try {
      await e.init();
      const gris = path.join(root, "gris.mov"),
        vertical = path.join(root, "vertical.mov"),
        shape = path.join(root, "forme.png");
      await e.ff(["-y", "-f", "lavfi", "-i", "color=c=gray:s=320x180:r=25:d=1", "-c:v", "prores_ks", gris]);
      await e.ff(["-y", "-f", "lavfi", "-i", "color=c=gray:s=180x320:r=25:d=1", "-c:v", "prores_ks", vertical]);
      await e.ff(["-y", "-f", "lavfi", "-i", "color=c=white:s=64x36:d=1", "-frames:v", "1", shape]);
      const s = { ...M.sequence(), width: 320, height: 180 };
      const mask = { id: "m", effect: "solid", shape: "rectangle", width: 0.2, height: 0.2, strength: 1, feather: 0, color: "#ff0000", keys: [{ frame: 0, x: 0.25, y: 0.25 }] };
      const redBox = (file) => {
        const r = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-frames:v", "1", "-vf", "format=rgb24", "-f", "rawvideo", "-"], { maxBuffer: 1 << 24 });
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let y = 0; y < 180; y++)
          for (let x = 0; x < 320; x++) {
            const i = (y * 320 + x) * 3;
            if (r.stdout[i] > 170 && r.stdout[i + 1] < 90 && r.stdout[i + 2] < 90) {
              x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
            }
          }
        return [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, x1 - x0 + 1, y1 - y0 + 1];
      };
      for (const [label, file, o] of [
        ["échelle 1", gris, {}],
        ["zoom ×2", gris, { scale: 2 }],
        ["déplacé", gris, { x: 0.25, y: -0.1 }],
        ["vertical", vertical, {}],
        ["tourné", gris, { rotation: 30, scale: 1.4 }],
      ]) {
        const out = path.join(root, "export-" + label + ".mov");
        await R.renderSegment(
          {
            engine: e,
            sequence: { ...s, clips: [baseClip({ duration: 5, masks: [mask], ...o })] },
            assets: new Map([["a", { id: "a", kind: "video", duration: 1, inputSpace: "rec709", audioChannels: 0 }]]),
            registry: { a: { source: file } },
            cache: root,
            maskFiles: { m: shape },
            start: 0,
            count: 5,
          },
          out,
        );
        assert.deepEqual(redBox(out), [80, 45, 64, 36], label);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "le son exporté reste calé sur l'image, à vitesse normale comme accélérée",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-sync-")),
      e = engine();
    try {
      await e.init();
      // Un clic au début de l'image 25 (1 s), en AAC dans un MP4 : le cas où
      // FFmpeg perdait le décalage d'amorce.
      const file = path.join(root, "clic.mp4");
      await e.ff([
        "-y", "-f", "lavfi", "-i", "color=c=black:s=64x36:r=25:d=3",
        "-f", "lavfi", "-i", "aevalsrc='if(between(t,1,1.004),0.8*sin(2*PI*1000*t),0)':s=48000:d=3",
        ...e.encode(), "-c:a", "aac", "-shortest", file,
      ]);
      const onset = (out) => {
        const r = spawnSync(ffmpeg, ["-v", "error", "-i", out, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], { maxBuffer: 1 << 26 });
        for (let i = 0; i < r.stdout.length / 4; i++) if (Math.abs(r.stdout.readFloatLE(i * 4)) > 0.05) return i / 48000;
        return NaN;
      };
      const s = { ...M.sequence(), width: 64, height: 36 };
      const asset = { id: "a", kind: "video", duration: 3, inputSpace: "rec709", audioChannels: 1 };
      // À vitesse 2, atempo place un son très bref à quelques millisecondes
      // près ; l'erreur corrigée valait 21 à 32 ms, toujours en avance.
      for (const [speed, inUs, expected, tolerance] of [
        [1, 0, 1, 0.002],
        [1, 500000, 0.5, 0.002],
        [2, 0, 0.5, 0.01],
      ]) {
        const out = path.join(root, `s${speed}-${inUs}.mov`);
        await R.renderSegment(
          {
            engine: e,
            sequence: { ...s, clips: [baseClip({ component: "audio", track: 10, duration: 40, speed, inUs })] },
            assets: new Map([["a", asset]]),
            registry: { a: { source: file } },
            cache: root,
            start: 0,
            count: 40,
          },
          out,
        );
        const got = onset(out);
        assert(Math.abs(got - expected) < tolerance, `vitesse ${speed}, entrée ${inUs / 1e6} s : clic à ${got.toFixed(4)} s au lieu de ${expected} s`);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "un film normalisé au niveau « Réseaux sociaux » n'annonce pas un son plus long que l'image",
  { skip, timeout: 180000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-niveau-")),
      e = engine();
    try {
      await e.init();
      const file = path.join(root, "rush.mov");
      await e.ff([
        "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:r=30000/1001:d=4",
        "-f", "lavfi", "-i", "sine=f=440:r=48000:d=4",
        "-c:v", "prores_ks", "-c:a", "pcm_s16le", file,
      ]);
      const fps = { n: 30000, d: 1001 },
        s = { ...M.sequence(), width: 160, height: 90, fps };
      s.clips = [
        baseClip({ duration: 100 }),
        baseClip({ component: "audio", track: 10, duration: 100 }),
      ];
      const segment = path.join(root, "segment.mov"),
        film = path.join(root, "film.mp4");
      await R.renderSegment(
        {
          engine: e,
          sequence: s,
          assets: new Map([["a", { id: "a", kind: "video", duration: 4, inputSpace: "rec709", audioChannels: 1 }]]),
          registry: { a: { source: file } },
          cache: root,
          start: 0,
          count: 100,
          deliveryCodec: "h264",
        },
        segment,
      );
      await R.finishRender(e, s, [segment], film, "h264", undefined, true, [M.seconds(100, fps)], { loudness: "reseaux" });
      const r = spawnSync(path.join(nativeRoot, "ffprobe"), ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", film]);
      const streams = JSON.parse(r.stdout.toString()).streams,
        image = Number(streams.find((x) => x.codec_type === "video").duration),
        son = Number(streams.find((x) => x.codec_type === "audio").duration);
      assert(Math.abs(image - M.seconds(100, fps)) < 0.001, "image : " + image);
      assert(Math.abs(son - image) < 0.025, `son annoncé ${son} s pour une image de ${image} s`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "une photo ou une vidéo d'une image a sa vignette, et une vidéo dure ce que dure son image",
  { skip, timeout: 120000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-thumb-")),
      e = engine();
    try {
      await e.init();
      const jpg = path.join(root, "photo.jpg"),
        png = path.join(root, "photo.png"),
        one = path.join(root, "une-image.mp4"),
        long = path.join(root, "son-long.mov");
      await e.ff(["-y", "-f", "lavfi", "-i", "testsrc=s=600x400:d=1", "-frames:v", "1", jpg]);
      await e.ff(["-y", "-f", "lavfi", "-i", "testsrc=s=600x400:d=1", "-frames:v", "1", png]);
      await e.ff(["-y", "-f", "lavfi", "-i", "testsrc=s=320x180:r=25:d=1", "-frames:v", "1", ...e.encode(), one]);
      await e.ff([
        "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:r=50:d=4",
        "-f", "lavfi", "-i", "sine=f=440:r=48000:d=4.03",
        "-c:v", "prores_ks", "-c:a", "pcm_s16le", long,
      ]);
      for (const file of [jpg, png, one]) {
        const meta = await e.probe(file),
          asset = { ...meta, inputSpace: meta.kind === "image" ? "srgb" : "rec709" },
          thumb = path.join(root, path.basename(file) + ".thumb.jpg");
        await e.thumbnail(file, asset, thumb);
        assert((await fs.stat(thumb)).size > 1000, path.basename(file));
      }
      const meta = await e.probe(long);
      assert.equal(meta.kind, "video");
      assert.equal(meta.duration, 4);
      assert.equal(M.frameAt(meta.duration, { n: 25, d: 1 }), 100);
      // Les durées annexes servent aux contrôles sans entrer dans la fiche.
      assert(Math.abs(meta.containerDuration - 4.03) < 0.001);
      assert(Math.abs(meta.audioDuration - 4.03) < 0.001);
      assert(!Object.keys({ ...meta }).includes("containerDuration"));
      assert(!JSON.stringify(meta).includes("audioDuration"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "copie .junofilm, multicaméra sans micro et ménage des exports, sur le vrai module",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-video-fix-")),
      api = {};
    let picked = [],
      saved = "";
    const setup = () =>
      registerVideo({
        handle: (name, fn) => (api[name] = fn),
        app: { getPath: () => root, getVersion: () => "0.0.0-test", on: () => {} },
        dialog: {
          showOpenDialog: async () => ({ canceled: false, filePaths: picked }),
          showSaveDialog: async () => ({ canceled: false, filePath: saved }),
        },
        protocol: { handle: () => {} },
        getWindow: () => undefined,
        nativeRoot,
        colorRoot,
      });
    const waitJob = async (id) => {
      for (let i = 0; i < 1800; i++) {
        const j = api["video-list"]().jobs.find((j) => j.id === id);
        if (["done", "failed", "cancelled", "interrupted"].includes(j?.state)) return j;
        await pause(100);
      }
      throw Error("Tâche trop longue " + id);
    };
    try {
      let module = await setup();
      const e = module.engine;
      const cam = path.join(root, "cam.mov"),
        muet = path.join(root, "muet.mov");
      await e.ff([
        "-y", "-f", "lavfi", "-i", "testsrc=s=160x90:r=25:d=4",
        "-f", "lavfi", "-i", "aevalsrc='if(lt(mod(t,1),0.01),0.8*sin(2*PI*800*t),0)':s=48000:d=4",
        "-c:v", "prores_ks", "-c:a", "pcm_s16le", cam,
      ]);
      await e.ff(["-y", "-f", "lavfi", "-i", "testsrc=s=160x90:r=25:d=4", "-c:v", "prores_ks", muet]);
      const p = await api["video-create"]({ name: "Corrections" });
      picked = [cam, muet];
      const imported = await waitJob((await api["video-import"](p.id)).id);
      assert.equal(imported.state, "done");
      let q = api["video-project"](p.id);
      const a = q.assets.find((x) => x.name === "cam.mov"),
        b = q.assets.find((x) => x.name === "muet.mov");
      // Multicaméra : la caméra sans micro reste à vérifier, la synchro aboutit.
      const group = { id: "g1", name: "Cérémonie", referenceAssetId: a.id, angles: [{ assetId: a.id, offset: 0 }, { assetId: b.id, offset: 1.5 }], switches: [] };
      const sync = await waitJob((await api["video-multicam"]({ projectId: p.id, group, action: "audio" })).job.id);
      assert.equal(sync.state, "done", sync.error);
      const synced = api["video-project"](p.id).multicam.find((g) => g.id === sync.result);
      assert.deepEqual(
        synced.angles.map((x) => [x.assetId, x.offset, x.sync]),
        [[a.id, 0, undefined], [b.id, 1.5, "à vérifier"]],
      );
      // Voix améliorée et masque suivi dans une copie .junofilm.
      const voice = await waitJob((await api["video-audio-process"]({ projectId: p.id, assetId: a.id, settings: { strength: 0 } })).id);
      assert.equal(voice.state, "done", voice.error);
      q = api["video-project"](p.id);
      const v = q.assets.find((x) => x.audioProcessing);
      assert.equal(v.audioProcessing.sourceAssetId, a.id);
      assert(!v.name.includes("\u2014"));
      const s = { ...q.sequences[0] };
      s.clips = [
        baseClip({ assetId: b.id, duration: 50, masks: [{ id: "m1", effect: "blur", shape: "ellipse", width: 0.2, height: 0.2, strength: 0.5, feather: 0.2, keys: [{ frame: 0, x: 0.5, y: 0.5 }], tracked: { asset: b.id, from: 0, to: 49 } }] }),
        baseClip({ assetId: v.id, component: "audio", track: 10, duration: 50, originalAssetId: a.id }),
      ];
      await api["video-sequence"]({ projectId: p.id, sequence: s, expectedVersion: s.version || 1 });
      saved = path.join(root, "copie.junofilm");
      assert.equal(await api["video-backup"](p.id), true);
      picked = [saved];
      const copy = await api["video-restore"]();
      const names = new Map(copy.assets.map((x) => [x.id, x.name]));
      const [image, son] = copy.sequences[0].clips;
      assert.equal(names.get(image.masks[0].tracked.asset), "muet.mov");
      assert.equal(names.get(son.originalAssetId), "cam.mov");
      assert.equal(names.get(copy.assets.find((x) => x.audioProcessing).audioProcessing.sourceAssetId), "cam.mov");
      assert(!q.assets.some((x) => x.id === image.masks[0].tracked.asset));
      // Ménage : un export annulé ne laisse ni segments ni fichier partiel.
      const renders = path.join(root, "Video Studio", "renders");
      const long = { ...q.sequences[0], id: "longue", name: "Longue", version: undefined, width: 640, height: 360, clips: [0, 100, 200].map((start) => baseClip({ assetId: b.id, start, duration: 100, denoise: "strong" })) };
      await api["video-sequence"]({ projectId: p.id, sequence: long, expectedVersion: 0 });
      await api["video-space"]({ projectId: p.id, assetId: b.id, inputSpace: "rec709" }).then((j) => waitJob(j.id));
      await api["video-space"]({ projectId: p.id, assetId: a.id, inputSpace: "rec709" }).then((j) => waitJob(j.id));
      saved = path.join(root, "livraison.mov");
      const job = await api["video-export"]({ projectId: p.id, sequence: long, codec: "prores", overlays: [], maskImages: {} });
      for (let i = 0; i < 600 && !(api["video-list"]().jobs.find((j) => j.id === job.id).cursor >= 1); i++) await pause(100);
      assert(fss.existsSync(path.join(renders, job.id)));
      await api["video-job"]({ id: job.id, action: "cancel" });
      for (let i = 0; i < 100 && fss.existsSync(path.join(renders, job.id)); i++) await pause(100);
      assert(!fss.existsSync(path.join(renders, job.id)), "segments d'un export annulé restés sur le disque");
      assert(!fss.existsSync(saved + ".partial.mov"));
      // Au démarrage suivant, les dossiers de rendu sans tâche disparaissent.
      const orphan = path.join(renders, "tache-disparue");
      await fs.mkdir(orphan, { recursive: true });
      await fs.writeFile(path.join(orphan, "0000000.mov"), "x");
      module.engine.stop();
      module = await setup();
      await module.purged;
      assert(!fss.existsSync(orphan));
      module.engine.stop();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
