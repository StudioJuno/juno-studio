const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/moments.cjs");
const makeEngine = () =>
  new Engine({
    nativeRoot: path.resolve("native", process.platform + "-" + process.arch),
    colorRoot: path.resolve("public/video-color"),
  });
/**
 * Fabriquer un son, le mesurer avec le vrai ebur128 embarqué, et en tirer les
 * moments. Le test passe par la même chaîne que l'analyse de l'application.
 */
async function moments(engine, dossier, nom, filtre, duree = 14) {
  const fichier = path.join(dossier, nom + ".wav");
  await engine.run(engine.ffmpeg, [
    "-y", "-v", "error", "-f", "lavfi",
    "-i", `anoisesrc=d=${duree}:c=pink:a=0.02:r=48000`,
    "-af", filtre, "-ac", "2", fichier,
  ]);
  const { text } = await engine.analyse([
    "-i", fichier, "-vn", "-af", "silencedetect=n=-35dB:d=0.6,ebur128=peak=none",
  ]);
  const serie = text.split("\n").map(M.lireLigne).filter(Boolean);
  assert.ok(serie.length > duree * 8, "ebur128 n'a presque rien relevé");
  return M.momentsForts(serie);
}
test("les deux formes de ligne d'ebur128 sont lues", () => {
  assert.deepEqual(
    M.lireLigne("[Parsed_ebur128_1 @ 0x1] t: 0.0999792  TARGET:-23 LUFS    M:-120.7 S:-120.7"),
    { t: 0.0999792, m: -120.7 },
  );
  assert.deepEqual(
    M.lireLigne("[Parsed_ebur128_1 @ 0x1] t: 4.899979   TARGET:-23 LUFS    M: -48.5 S: -48.6"),
    { t: 4.899979, m: -48.5 },
  );
  assert.equal(M.lireLigne("[Parsed_silencedetect_0 @ 0x1] silence_end: 5.01"), null);
});
test(
  "des applaudissements après un moment calme sont trouvés, au bon endroit",
  { timeout: 180000 },
  async () => {
    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "juno-moments-"));
    try {
      const r = await moments(makeEngine(), dossier, "applaudissements",
        "volume='if(between(t,5,7.5),18,1)':eval=frame");
      assert.equal(r.length, 1, JSON.stringify(r));
      // ebur128 mesure sur 400 ms : on tolère ce décalage aux deux bouts.
      assert.ok(Math.abs(r[0].start - 5) < 0.6, "début " + r[0].start);
      assert.ok(Math.abs(r[0].end - 7.5) < 0.6, "fin " + r[0].end);
      assert.ok(r[0].relief > 15, "relief " + r[0].relief);
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  },
);
test(
  "une musique forte d'un bout à l'autre n'est pas un moment fort",
  { timeout: 180000 },
  async () => {
    // Le cas du set du DJ : fort, mais sans rien qui dépasse son contexte.
    // Chercher le passage le plus fort l'aurait désigné à chaque fois.
    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "juno-moments-"));
    try {
      const r = await moments(makeEngine(), dossier, "dj", "volume=18");
      assert.deepEqual(r, []);
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  },
);
test(
  "un cri au milieu d'une musique forte ressort quand même",
  { timeout: 180000 },
  async () => {
    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "juno-moments-"));
    try {
      const r = await moments(makeEngine(), dossier, "cri",
        "volume='if(between(t,6,8),6,1)*6':eval=frame");
      assert.equal(r.length, 1, JSON.stringify(r));
      assert.ok(Math.abs(r[0].start - 6) < 0.6, "début " + r[0].start);
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  },
);
test(
  "deux salves rapprochées ne font qu'un moment, un claquement n'en fait aucun",
  { timeout: 180000 },
  async () => {
    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "juno-moments-"));
    try {
      const engine = makeEngine();
      const salves = await moments(engine, dossier, "salves",
        "volume='if(between(t,4,5.5)+between(t,6.3,7.8),18,1)':eval=frame");
      assert.equal(salves.length, 1, JSON.stringify(salves));
      const claquement = await moments(engine, dossier, "claquement",
        "volume='if(between(t,5,5.15),18,1)':eval=frame");
      assert.deepEqual(claquement, []);
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  },
);
test("du silence ne produit aucun moment", () => {
  const serie = Array.from({ length: 200 }, (_, i) => ({ t: i / 10, m: -120.7 }));
  assert.deepEqual(M.momentsForts(serie), []);
  assert.deepEqual(M.momentsForts([]), []);
});
test("au-delà du maximum, on garde les plus marqués, dans l'ordre du rush", () => {
  // Une longue soirée : vingt pics de relief croissant sur un fond calme.
  const serie = [];
  for (let s = 0; s < 400; s += 0.1) {
    const pic = Math.floor(s / 20);
    const dans = s % 20 > 10 && s % 20 < 12;
    serie.push({ t: s, m: dans ? -40 + pic * 0.5 : -60 });
  }
  const r = M.momentsForts(serie, { maximum: 5 });
  assert.equal(r.length, 5);
  for (let i = 1; i < r.length; i++) assert.ok(r[i].start > r[i - 1].start);
  // Les cinq gardés sont les cinq derniers, les plus forts.
  assert.ok(r[0].start > 290, "premier gardé " + r[0].start);
});
