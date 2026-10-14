const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  L = require("../electron/video/loudness.cjs");
const makeEngine = () =>
  new Engine({
    nativeRoot: path.resolve("native", process.platform + "-" + process.arch),
    colorRoot: path.resolve("public/video-color"),
  });
/**
 * Le niveau efficace d'une tranche, lu par astats.
 * `isole` permet de ne mesurer qu'une bande de fréquences : dans un mixage,
 * c'est le seul moyen de peser la musique sans peser la voix.
 */
async function rms(engine, file, from, length, isole) {
  const { text } = await engine.analyse([
    "-ss",
    String(from),
    "-t",
    String(length),
    "-i",
    file,
    "-af",
    (isole ? isole + "," : "") + "astats",
  ]);
  const m = text.match(/RMS level dB:\s*(-?\d+(?:\.\d+)?)/);
  assert.ok(m, "astats n'a rien mesuré");
  return Number(m[1]);
}
test(
  "l'enveloppe d'atténuation baisse la musique exactement de ce qu'elle annonce",
  { timeout: 180000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-duck-")),
      engine = makeEngine();
    try {
      await engine.init();
      const source = path.join(root, "ton.wav");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=6:sample_rate=48000",
        source,
      ]);
      // Parole de 2 s à 4 s, la musique doit descendre de 75 %.
      const expr = L.duckExpression([{ start: 2, end: 4 }], {
        depth: 0.75,
        attack: 0.25,
        release: 0.5,
        hold: 0,
      });
      const ducked = path.join(root, "attenue.wav");
      await engine.ff([
        "-y",
        "-i",
        source,
        "-af",
        `volume='${expr}':eval=frame`,
        ducked,
      ]);
      const avant = await rms(engine, ducked, 0.5, 0.3),
        pendant = await rms(engine, ducked, 2.6, 0.3),
        apres = await rms(engine, ducked, 5.2, 0.3);
      // 1 - 0,75 = 0,25, soit 20*log10(0,25) = -12,04 dB. Rien d'autre.
      assert.ok(
        Math.abs(avant - pendant - 12.04) < 0.3,
        `atténuation mesurée : ${(avant - pendant).toFixed(2)} dB`,
      );
      // Hors de la parole, la musique est intacte des deux côtés.
      assert.ok(Math.abs(avant - apres) < 0.05);
      // La rampe existe vraiment : à mi-attaque le niveau est intermédiaire.
      const rampe = await rms(engine, ducked, 1.8, 0.15);
      assert.ok(rampe < avant - 0.2 && rampe > pendant + 1);
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "silencedetect est lu exactement là où le silence a été fabriqué",
  { timeout: 180000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-silence-")),
      engine = makeEngine();
    try {
      await engine.init();
      const file = path.join(root, "discours.wav");
      // 1 s de voix, 2 s de blanc, 1,5 s de voix : les bornes sont connues.
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=1",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=44100:cl=mono:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=660:duration=1.5",
        "-filter_complex",
        "[0:a][1:a][2:a]concat=n=3:v=0:a=1[a]",
        "-map",
        "[a]",
        file,
      ]);
      const { text, full } = await engine.analyse([
        "-i",
        file,
        "-af",
        "silencedetect=noise=-40dB:d=0.4",
      ]);
      assert.equal(full, true);
      const silences = L.parseSilence(text, 4.5);
      assert.equal(silences.length, 1);
      assert.ok(Math.abs(silences[0].start - 1) < 0.05);
      assert.ok(Math.abs(silences[0].end - 3) < 0.05);
      const speech = L.speechFrom(silences, 4.5);
      assert.equal(speech.length, 2);
      assert.ok(Math.abs(speech[0].end - 1) < 0.05);
      assert.ok(Math.abs(speech[1].start - 3) < 0.05);
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "la normalisation en deux passes atteint la cible en LUFS",
  { timeout: 180000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-lufs-")),
      engine = makeEngine();
    try {
      await engine.init();
      const source = path.join(root, "faible.wav");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=12:sample_rate=48000",
        "-af",
        "volume=-9dB",
        source,
      ]);
      const mesure = await engine.analyse([
        "-i",
        source,
        "-af",
        L.normaliseFilter("reseaux") + ":print_format=json",
      ]);
      const lu = L.measuredValues(mesure.text);
      assert.ok(lu, "la première passe n'a rien mesuré");
      assert.ok(lu.input_i < -25, "niveau de départ : " + lu.input_i);
      const cible = path.join(root, "livrable.wav");
      await engine.ff([
        "-y",
        "-i",
        source,
        "-af",
        L.normaliseFilter("reseaux", mesure.text),
        cible,
      ]);
      const controle = await engine.analyse([
        "-i",
        cible,
        "-af",
        "ebur128=framelog=quiet",
      ]);
      const lufs = Number(
        controle.text.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)?.pop()
          ?.match(/(-?\d+(?:\.\d+)?)/)[1],
      );
      // La cible réseaux sociaux est -14 LUFS, la tolérance d'usage 0,5.
      assert.ok(
        Math.abs(lufs + 14) < 0.5,
        "niveau livré : " + lufs + " LUFS au lieu de -14",
      );
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
const M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs");
test(
  "dans un vrai rendu, la musique baisse sous la voix et remonte après",
  { timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-mix-")),
      engine = makeEngine();
    try {
      await engine.init();
      // La musique : un ton continu de 8 s, niveau constant, facile à mesurer.
      const musique = path.join(root, "musique.mkv");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x36:r=25:d=8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=220:duration=8:sample_rate=48000",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        "-shortest",
        musique,
      ]);
      // La voix : silence, puis 3 s de parole de 3 s à 6 s, puis silence.
      const voix = path.join(root, "voix.mkv");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=64x36:r=25:d=8",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=900:duration=8:sample_rate=48000",
        "-af",
        "volume='between(t,3,6)':eval=frame",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        "-shortest",
        voix,
      ]);
      const s = M.sequence();
      s.width = 64;
      s.height = 36;
      const aMusique = {
          id: "m",
          kind: "video",
          duration: 8,
          inputSpace: "rec709",
          audioChannels: 2,
        },
        aVoix = {
          id: "v",
          kind: "video",
          duration: 8,
          inputSpace: "rec709",
          audioChannels: 2,
          // L'analyse a trouvé du silence avant 3 s et après 6 s.
          analysis: {
            scenes: [],
            silences: [
              { start: 0, end: 3 },
              { start: 6, end: 8 },
            ],
          },
        };
      const clipMusique = {
          ...M.clip(aMusique, s, 0),
          duration: 200,
          audioRole: "music",
        },
        clipVoix = {
          ...M.clip(aVoix, s, 0),
          duration: 200,
          track: 1,
          audioRole: "voice",
        };
      const options = {
        engine,
        assets: new Map([
          ["m", aMusique],
          ["v", aVoix],
        ]),
        registry: { m: { source: musique }, v: { source: voix } },
        cache: root,
        start: 0,
        count: 200,
      };
      // Les deux plans sont audibles, comme dans un vrai montage. La musique
      // est à 220 Hz et la voix à 900 Hz : un passe-bas isole la musique.
      const MUSIQUE_SEULE = "lowpass=f=400:poles=2,lowpass=f=400:poles=2";
      const plat = path.join(root, "plat.mov"),
        attenue = path.join(root, "attenue.mov");
      await R.renderSegment(
        { ...options, sequence: { ...s, clips: [clipMusique, clipVoix] } },
        plat,
      );
      await R.renderSegment(
        {
          ...options,
          sequence: {
            ...s,
            clips: [clipMusique, clipVoix],
            ducking: { enabled: true, depth: 0.7, attack: 0.25, release: 0.5, hold: 0 },
          },
        },
        attenue,
      );
      const avantPlat = await rms(engine, plat, 1, 1, MUSIQUE_SEULE),
        pendantPlat = await rms(engine, plat, 4, 1, MUSIQUE_SEULE);
      // Sans atténuation, la musique ne bouge pas d'un décibel.
      assert.ok(
        Math.abs(avantPlat - pendantPlat) < 0.2,
        `témoin instable : ${avantPlat} puis ${pendantPlat}`,
      );
      const avant = await rms(engine, attenue, 1, 1, MUSIQUE_SEULE),
        pendant = await rms(engine, attenue, 4, 1, MUSIQUE_SEULE),
        apres = await rms(engine, attenue, 7, 1, MUSIQUE_SEULE);
      // 1 - 0,7 = 0,3, soit -10,46 dB.
      assert.ok(
        Math.abs(avant - pendant - 10.46) < 0.6,
        `atténuation dans le rendu : ${(avant - pendant).toFixed(2)} dB`,
      );
      assert.ok(
        Math.abs(avant - apres) < 0.2,
        "la musique n'est pas remontée après la voix",
      );
      // Et le niveau hors parole est bien celui du montage sans atténuation.
      assert.ok(Math.abs(avant - avantPlat) < 0.2);
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
test(
  "un film assemblé est livré au niveau demandé, segments compris",
  { timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-livraison-")),
      engine = makeEngine();
    try {
      await engine.init();
      // Deux segments de niveaux différents : le niveau intégré d'un film
      // n'est pas la moyenne des niveaux de ses morceaux.
      const segments = [];
      for (const [i, dB] of [-20, -6].entries()) {
        const file = path.join(root, "seg" + i + ".mov");
        await engine.ff([
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=64x36:r=25:d=6",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:duration=6:sample_rate=48000",
          "-af",
          "volume=" + dB + "dB",
          "-c:v",
          "libaom-av1",
          "-cpu-used",
          "8",
          "-c:a",
          "pcm_s24le",
          "-shortest",
          file,
        ]).catch(async () => {
          await engine.ff([
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=64x36:r=25:d=6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=6:sample_rate=48000",
            "-af",
            "volume=" + dB + "dB",
            "-c:v",
            "ffv1",
            "-c:a",
            "pcm_s24le",
            "-shortest",
            file,
          ]);
        });
        segments.push(file);
      }
      const s = M.sequence();
      s.width = 64;
      s.height = 36;
      const sortie = path.join(root, "film.mov");
      await R.finishRender(
        engine,
        s,
        segments,
        sortie,
        "prores",
        undefined,
        true,
        [6, 6],
        { loudness: "television" },
      );
      const controle = await engine.analyse([
        "-i",
        sortie,
        "-af",
        "ebur128=framelog=quiet",
      ]);
      const lufs = Number(
        controle.text
          .match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)
          ?.pop()
          ?.match(/(-?\d+(?:\.\d+)?)/)[1],
      );
      // La cible télévision est -23 LUFS (EBU R128).
      assert.ok(
        Math.abs(lufs + 23) < 1,
        "niveau livré : " + lufs + " LUFS au lieu de -23",
      );
      // Et le fichier reste à 48 kHz : loudnorm mesure à 192 kHz en interne.
      const info = await engine.probe(sortie);
      assert.ok(
        JSON.stringify(info).includes("48000"),
        "la cadence d'échantillonnage a dérivé",
      );
    } finally {
      engine.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
