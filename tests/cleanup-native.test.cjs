const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs"),
  CLEAN = require("../electron/video/cleanup.cjs");
const makeEngine = () =>
  new Engine({
    nativeRoot: path.resolve("native", process.platform + "-" + process.arch),
    colorRoot: path.resolve("public/video-color"),
  });
/** L'écart entre deux vidéos, en dB. Plus c'est haut, plus elles sont proches. */
async function psnr(engine, a, b) {
  const { text } = await engine.analyse([
    "-i",
    a,
    "-i",
    b,
    "-lavfi",
    "psnr",
    "-an",
  ]);
  const m = text.match(/average:(\d+(?:\.\d+)?|inf)/);
  assert.ok(m, "psnr n'a rien mesuré : " + text.slice(-300));
  return m[1] === "inf" ? Infinity : Number(m[1]);
}
/** L'écart-type des pixels : une image bruitée en a beaucoup plus. */
async function spread(engine, file) {
  // signalstats pose la mesure en métadonnée : sans metadata=print, rien ne sort.
  const { text } = await engine.analyse([
    "-i",
    file,
    "-vf",
    "signalstats,metadata=print:key=lavfi.signalstats.YDIF",
    "-an",
  ]);
  const values = [...text.matchAll(/YDIF=(\d+(?:\.\d+)?)/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(values.length, "signalstats n'a rien mesuré");
  return values.reduce((s, v) => s + v, 0) / values.length;
}
test("le préchauffage est calculé, borné par ce que le média contient avant", () => {
  const fps = { n: 25, d: 1 };
  const temporel = { denoise: "medium", speed: 1 };
  // Loin dans le média : le préchauffage complet est possible.
  assert.deepEqual(CLEAN.lead(temporel, 30, fps), {
    frames: CLEAN.LEAD_FRAMES,
    seconds: CLEAN.LEAD_FRAMES / 25,
  });
  // Au tout début d'un fichier, il n'y a rien à lire avant.
  assert.deepEqual(CLEAN.lead(temporel, 0, fps), { frames: 0, seconds: 0 });
  // Près du début, le préchauffage est réduit à ce qui existe.
  assert.equal(CLEAN.lead(temporel, 0.08, fps).frames, 2);
  // Un filtre purement spatial n'a rien à précharger.
  assert.deepEqual(CLEAN.lead({ denoise: "light", speed: 1 }, 30, fps), {
    frames: 0,
    seconds: 0,
  });
  assert.deepEqual(CLEAN.lead({ speed: 1 }, 30, fps), { frames: 0, seconds: 0 });
  // Un plan ralenti consomme moins de source pour le même nombre d'images.
  assert.ok(CLEAN.lead({ denoise: "medium", speed: 0.5 }, 30, fps).seconds < 0.2);
});
test("les réglages hors catalogue sont refusés", () => {
  assert.throws(() => CLEAN.validate({ denoise: "extrême" }), /Débruitage/);
  assert.throws(() => CLEAN.validate({ stabilise: 2 }), /Stabilisation/);
  assert.throws(() => CLEAN.validate({ stabilise: "fort" }), /Stabilisation/);
  assert.throws(() => CLEAN.validate({ smoothSlow: 1 }), /Ralenti/);
  CLEAN.validate({});
  for (const k of CLEAN.DENOISE_KEYS) CLEAN.validate({ denoise: k });
});
test("un ralenti fluide n'est calculé que si le plan ralentit vraiment", () => {
  const fps = { n: 25, d: 1 };
  assert.equal(CLEAN.slowFilter({ smoothSlow: true, speed: 1 }, fps), null);
  assert.equal(CLEAN.slowFilter({ smoothSlow: false, speed: 0.25 }, fps), null);
  const f = CLEAN.slowFilter({ smoothSlow: true, speed: 0.25 }, fps);
  assert.ok(f.startsWith("minterpolate=fps=25"));
});
test(
  "le débruitage agit réellement sur les pixels rendus",
  { timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-clean-")),
      engine = makeEngine();
    try {
      await engine.init();
      const source = path.join(root, "bruit.mkv");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=320x180:r=25:d=2",
        "-vf",
        "noise=alls=24:allf=t+u,format=yuv444p10le",
        "-c:v",
        "ffv1",
        source,
      ]);
      const s = M.sequence();
      s.width = 320;
      s.height = 180;
      const asset = {
        id: "a",
        kind: "video",
        duration: 2,
        inputSpace: "rec709",
        audioChannels: 0,
      };
      const base = { ...M.clip(asset, s, 0), duration: 40 };
      const options = {
        engine,
        assets: new Map([["a", asset]]),
        registry: { a: { source } },
        cache: root,
        start: 0,
        count: 40,
      };
      const brut = path.join(root, "brut.mov"),
        propre = path.join(root, "propre.mov");
      await R.renderSegment(
        { ...options, sequence: { ...s, clips: [base] } },
        brut,
      );
      await R.renderSegment(
        {
          ...options,
          sequence: { ...s, clips: [{ ...base, denoise: "medium" }] },
        },
        propre,
      );
      const avant = await spread(engine, brut),
        apres = await spread(engine, propre);
      // Moins de différence d'une image à l'autre : c'est bien du bruit en moins.
      assert.ok(
        apres < avant * 0.8,
        `bruit avant ${avant.toFixed(2)}, après ${apres.toFixed(2)}`,
      );
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "un filtre temporel ne laisse pas de sursaut à la frontière de deux segments",
  { timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-lead-")),
      engine = makeEngine();
    try {
      await engine.init();
      const source = path.join(root, "bruit.mkv");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=320x180:r=25:d=3",
        "-vf",
        "noise=alls=24:allf=t+u,format=yuv444p10le",
        "-c:v",
        "ffv1",
        source,
      ]);
      const s = M.sequence();
      s.width = 320;
      s.height = 180;
      const asset = {
        id: "a",
        kind: "video",
        duration: 3,
        inputSpace: "rec709",
        audioChannels: 0,
      };
      const clip = { ...M.clip(asset, s, 0), duration: 50, denoise: "medium" };
      const sequence = { ...s, clips: [clip] };
      const options = {
        engine,
        sequence,
        assets: new Map([["a", asset]]),
        registry: { a: { source } },
        cache: root,
      };
      // La référence : tout d'une traite, sans aucune frontière.
      const entier = path.join(root, "entier.mov");
      await R.renderSegment({ ...options, start: 0, count: 50 }, entier);
      // Le second segment, rendu séparément comme le fait un vrai export.
      const second = path.join(root, "second.mov");
      await R.renderSegment({ ...options, start: 25, count: 25 }, second);
      // La même tranche, extraite de la référence.
      const tranche = path.join(root, "tranche.mov");
      await engine.ff([
        "-y",
        "-i",
        entier,
        "-vf",
        "trim=start_frame=25,setpts=PTS-STARTPTS",
        "-c:v",
        "ffv1",
        "-an",
        tranche,
      ]);
      const ecart = await psnr(engine, second, tranche);
      // Le préchauffage doit exister pour ce plan, sinon le test ne prouve rien.
      assert.ok(CLEAN.lead(clip, 1, s.fps).frames > 0);
      // 40 dB : les deux rendus sont visuellement identiques.
      assert.ok(ecart > 40, "écart à la frontière : " + ecart + " dB");
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "chaque niveau de débruitage rapproche vraiment de l'image propre",
  { timeout: 300000 },
  async () => {
    // Le piège attrapé ici : atadenoise avec ses réglages d'origine gagnait
    // 0,1 dB, soit rien. Un bouton qui ne fait rien est pire qu'absent.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-qualite-")),
      engine = makeEngine();
    try {
      await engine.init();
      const propre = path.join(root, "propre.mkv"),
        sale = path.join(root, "sale.mkv");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=640x360:r=25:d=1.6",
        "-c:v",
        "ffv1",
        propre,
      ]);
      await engine.ff([
        "-y",
        "-i",
        propre,
        "-vf",
        "noise=alls=24:allf=t+u",
        "-c:v",
        "ffv1",
        sale,
      ]);
      const depart = await psnr(engine, sale, propre);
      const gains = {};
      for (const niveau of ["light", "medium"]) {
        const sortie = path.join(root, niveau + ".mkv");
        await engine.ff([
          "-y",
          "-i",
          sale,
          "-vf",
          CLEAN.DENOISE[niveau].filter,
          "-c:v",
          "ffv1",
          "-an",
          sortie,
        ]);
        gains[niveau] = (await psnr(engine, sortie, propre)) - depart;
      }
      // Un niveau « léger » doit au moins gagner un demi-décibel.
      assert.ok(gains.light > 0.4, "léger : +" + gains.light.toFixed(2) + " dB");
      // Un niveau « moyen » doit gagner nettement plus que le léger.
      assert.ok(
        gains.medium > 3,
        "moyen : +" + gains.medium.toFixed(2) + " dB",
      );
      assert.ok(gains.medium > gains.light * 2);
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
