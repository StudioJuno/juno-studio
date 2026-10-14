const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs"),
  T = require("../electron/video/transitions.cjs");
const makeEngine = () =>
  new Engine({
    nativeRoot: path.resolve("native", process.platform + "-" + process.arch),
    colorRoot: path.resolve("public/video-color"),
  });
/** La luminance moyenne de chaque image d'un rendu. */
async function luma(engine, file) {
  const { text } = await engine.analyse([
    "-i",
    file,
    "-vf",
    "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-an",
  ]);
  return [...text.matchAll(/YAVG=(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}
test("le catalogue ne propose que des motifs réellement compilés", () => {
  // Ces noms partent tels quels dans FFmpeg : une faute de frappe ferait
  // échouer un export entier, à la fin, après des heures de rendu.
  assert.ok(T.CATALOGUE.length >= 20);
  for (const t of T.CATALOGUE) {
    assert.match(t.id, /^[a-z]+$/);
    assert.ok(t.label.length > 2);
  }
  assert.equal(new Set(T.CATALOGUE.map((t) => t.id)).size, T.CATALOGUE.length);
});
test("une transition impossible est refusée avant le rendu", () => {
  assert.throws(() => T.validate({ kind: "téléportation", duration: 10 }, 100), /inconnue/);
  assert.throws(() => T.validate({ kind: "fade", duration: 0 }, 100), /Durée/);
  assert.throws(() => T.validate({ kind: "fade", duration: 1.5 }, 100), /Durée/);
  // Une transition ne peut pas durer plus longtemps que le plan qu'elle ouvre.
  assert.throws(() => T.validate({ kind: "fade", duration: 200 }, 100), /Durée/);
  assert.throws(() => T.validate({ kind: "fade", duration: 300 }, 1000), /Durée/);
  assert.throws(() => T.validate("fade", 100), /invalide/);
  T.validate(undefined, 100);
  T.validate({ kind: "wipeleft", duration: 25 }, 100);
});
test("aucun motif n'est fabriqué quand la transition est déjà passée", () => {
  const base = {
    transition: { kind: "wipeleft", seconds: 1 },
    input: 0,
    source: "s",
    label: "l",
    width: 320,
    height: 180,
    rate: "25/1",
    lengthSeconds: 4,
  };
  // Le segment commence deux secondes après le début du plan : c'est fini.
  assert.equal(T.alphaFilters({ ...base, offsetSeconds: 2 }), null);
  assert.equal(T.alphaFilters({ ...base, transition: null, offsetSeconds: 0 }), null);
  const partiel = T.alphaFilters({ ...base, offsetSeconds: 0.4 });
  // En cours : le motif est produit, puis rogné de ce qui a déjà eu lieu.
  assert.ok(partiel.some((f) => f.includes("trim=start=0.400000")));
  const debut = T.alphaFilters({ ...base, offsetSeconds: 0 });
  assert.ok(!debut.some((f) => f.includes("trim=start=")));
});
test(
  "une transition se voit vraiment dans les pixels, et se termine",
  { timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-trans-")),
      engine = makeEngine();
    try {
      await engine.init();
      // Un plan noir dessous, un plan blanc dessus : la luminance dit tout.
      const noir = path.join(root, "noir.mkv"),
        blanc = path.join(root, "blanc.mkv");
      for (const [file, couleur] of [
        [noir, "black"],
        [blanc, "white"],
      ])
        await engine.ff([
          "-y",
          "-f",
          "lavfi",
          "-i",
          `color=c=${couleur}:s=320x180:r=25:d=3`,
          "-vf",
          "format=yuv444p10le",
          "-c:v",
          "ffv1",
          file,
        ]);
      const s = M.sequence();
      s.width = 320;
      s.height = 180;
      const aN = { id: "n", kind: "video", duration: 3, inputSpace: "rec709", audioChannels: 0 },
        aB = { id: "b", kind: "video", duration: 3, inputSpace: "rec709", audioChannels: 0 };
      const fond = { ...M.clip(aN, s, 0), duration: 50 },
        dessus = {
          ...M.clip(aB, s, 0),
          assetId: "b",
          track: 1,
          duration: 50,
          transition: { kind: "wipeleft", duration: 25 },
        };
      const options = {
        engine,
        assets: new Map([
          ["n", aN],
          ["b", aB],
        ]),
        registry: { n: { source: noir }, b: { source: blanc } },
        cache: root,
        start: 0,
        count: 50,
      };
      const avec = path.join(root, "avec.mov"),
        sans = path.join(root, "sans.mov");
      await R.renderSegment(
        { ...options, sequence: { ...s, clips: [fond, dessus] } },
        avec,
      );
      await R.renderSegment(
        {
          ...options,
          sequence: {
            ...s,
            clips: [fond, { ...dessus, transition: undefined }],
          },
        },
        sans,
      );
      const courbe = await luma(engine, avec),
        temoin = await luma(engine, sans);
      assert.equal(courbe.length, 50);
      // Sans transition, le blanc couvre tout dès la première image.
      assert.ok(temoin[0] > temoin[temoin.length - 1] * 0.98);
      // Avec un volet, la première image est presque noire et la dernière
      // presque blanche : le motif a bien balayé l'écran.
      assert.ok(courbe[0] < courbe[49] * 0.25, JSON.stringify(courbe.slice(0, 3)));
      // À la moitié de la transition, l'écran est à peu près à moitié couvert.
      const moitie = courbe[12] / courbe[49];
      assert.ok(moitie > 0.4 && moitie < 0.6, "à mi-parcours : " + moitie);
      // La dernière image de la transition est presque complète, sans l'être.
      assert.ok(courbe[24] < courbe[49] && courbe[24] > courbe[49] * 0.9);
      // Après la transition, le plan est pleinement visible, comme sans elle.
      // Exactement identique, pas « à peu près » : sans la normalisation de
      // l'alpha, ce plan restait 0,3 % plus sombre que son voisin pour
      // toujours, bien après la fin de la transition.
      assert.equal(courbe[49], temoin[49]);
      // Et la progression ne recule jamais.
      for (let i = 1; i < 25; i++)
        assert.ok(courbe[i] >= courbe[i - 1] - 1, "recul à l'image " + i);
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
