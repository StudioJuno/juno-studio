const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  D = require("../electron/video/derush.cjs");
const makeEngine = () =>
  new Engine({
    nativeRoot: path.resolve("native", process.platform + "-" + process.arch),
    colorRoot: path.resolve("public/video-color"),
  });

/**
 * Le contrat du dérushage, sur la vraie chaîne : un rush fabriqué d'une
 * seule prise (une mire filmée avec un léger balancement de la main et un
 * bruit de capteur, sans aucune coupe), son aperçu fait par le moteur de
 * l'app, la lecture par tranches, puis les règles. Sept défauts aux instants
 * connus ; les flous arrivent en 0,4 s, comme une mise au point qui décroche.
 * L'image figée n'est pas cherchée : sur l'aperçu, elle ne se distingue pas
 * d'un plan sur pied d'un objet immobile (derush.cjs) ; elle ne doit rien
 * masquer.
 */
const DEFAUTS = [
  { nom: "bougé", de: 3, a: 5, etat: "masque", raison: "bouge" },
  { nom: "panoramique", de: 6.5, a: 8.5, etat: "bon" },
  { nom: "flou fort", de: 10, a: 12, etat: "masque", raison: "flou" },
  { nom: "noir", de: 13.5, a: 15, etat: "masque", raison: "noir" },
  // Pas cherchée (derush.cjs, `immobileEcart`) : elle ne doit rien masquer.
  { nom: "image figée", de: 16, a: 18, etat: "bon" },
  { nom: "surexposé", de: 19, a: 21, etat: "verifier", raison: "surexpose" },
  { nom: "flou léger", de: 23, a: 25, etat: "verifier", raison: "flou-leger" },
];
const DUREE = 27;

async function fabriquer(engine, dossier, defauts) {
  const image = path.join(dossier, "mire.png"),
    rush = path.join(dossier, defauts ? "rush.mp4" : "rush-propre.mp4");
  await engine.ff(["-y", "-f", "lavfi", "-i", "testsrc2=s=1152x648:r=25", "-frames:v", "1", image]);
  const main = "1.0*sin(2*PI*0.7*t)+0.6*sin(2*PI*1.3*t+1)",
    rampe = (a, b) => `clip((T-${a})/0.4\\,0\\,1)*clip((${b}-T)/0.4\\,0\\,1)`,
    x = defauts
      ? `40+clip((t-6.5)*60\\,0\\,120)+${main}+between(t\\,3\\,5)*10*(2*random(0)-1)`
      : `40+${main}`,
    y = defauts ? `54+${main}+between(t\\,3\\,5)*10*(2*random(1)-1)` : `54+${main}`,
    flous = defauts
      ? `[a][b5]blend=all_expr='A+(B-A)*${rampe(10, 12)}'[ab];[ab][c2]blend=all_expr='A+(B-A)*${rampe(23, 25)}'`
      : `[a][b5]blend=all_expr='A'[ab];[ab][c2]blend=all_expr='A'`,
    expo = defauts
      ? "lutyuv=y='16+(val-16)*0.04':u=128:v=128:enable='between(t,13.5,15)',lutyuv=y='clip(16+(val-16)*3+60,16,235)':enable='between(t,19,21)'"
      : "null",
    fige = defauts ? "[n1][n2]freezeframes=first=400:last=450:replace=400" : "[n1][n2]freezeframes=first=1:last=0:replace=0";
  await engine.ff([
    "-y",
    "-loop", "1",
    "-framerate", "25",
    "-i", image,
    "-t", String(DUREE),
    "-filter_complex",
    // En niveaux vidéo (16 à 235), comme une caméra : la mire PNG est en
    // pleine échelle, et l'aperçu ramènerait son blanc écrêté à 218.
    `[0:v]scale=out_range=tv,format=yuv420p,crop=w=960:h=540:x='${x}':y='${y}',setsar=1,split=3[a][b][c];` +
      `[b]gblur=sigma=5[b5];[c]gblur=sigma=1.5[c2];` +
      `${flous},${expo},noise=c0s=3:c0f=t+u:c1s=2:c1f=t+u:c2s=2:c2f=t+u,split[n1][n2];` +
      `${fige},format=yuv420p[v]`,
    "-map", "[v]",
    "-r", "25",
    "-c:v", "h264_videotoolbox",
    "-allow_sw", "1",
    "-b:v", "12M",
    "-g", "25",
    "-color_primaries", "bt709",
    "-color_trc", "bt709",
    "-colorspace", "bt709",
    "-color_range", "tv",
    rush,
  ]);
  const meta = await engine.probe(rush),
    asset = { ...meta, inputSpace: "rec709" },
    apercu = path.join(dossier, defauts ? "apercu.mp4" : "apercu-propre.mp4");
  await engine.proxy(rush, asset, apercu);
  const st = await fs.stat(apercu);
  return { asset, apercu, marque: [st.size, Math.round(st.mtimeMs)].join("|") };
}

function parts(plages, de, a) {
  const sortie = {};
  for (const p of plages) {
    const x = Math.max(de, p.debut),
      y = Math.min(a, p.fin);
    if (y > x) sortie[p.etat] = (sortie[p.etat] || 0) + (y - x) / (a - de);
  }
  return sortie;
}

test(
  "les défauts d'un rush d'une seule prise sont retrouvés, et rien sur son jumeau propre",
  { timeout: 600000, skip: process.platform !== "darwin" && "encodeur de la mire : VideoToolbox" },
  async () => {
    const engine = makeEngine();
    await engine.init();
    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "juno-derush-"));
    try {
      const essai = await fabriquer(engine, dossier, true);
      // Tranches de 10 s : trois tranches, et deux raccords à vérifier.
      const releves = await D.mesurer(engine, essai.apercu, path.join(dossier, "cache"), {
        duree: essai.asset.duration,
        marque: essai.marque,
        tranche: 10,
      });
      // Les mesures se suivent sans trou ni doublon aux raccords.
      const pas = releves.qualite.slice(1).map((e, i) => e.t - releves.qualite[i].t);
      assert.ok(Math.max(...pas) < 0.2 && Math.min(...pas) > 0.13, "pas " + Math.min(...pas) + " à " + Math.max(...pas));
      const pasM = releves.mouvement.slice(1).map((e, i) => e.t - releves.mouvement[i].t);
      assert.ok(Math.max(...pasM) < 0.1 && Math.min(...pasM) > 0.07, "pas du mouvement " + Math.max(...pasM));
      const r = D.decouper(releves);
      const bilan = DEFAUTS.map((d) => ({ ...d, parts: parts(r.plages, d.de + 0.3, d.a - 0.3) }));
      for (const d of bilan) {
        assert.ok((d.parts[d.etat] || 0) >= 0.9, `${d.nom} : ${JSON.stringify(d.parts)} · ${JSON.stringify(r.plages)}`);
        if (d.raison)
          assert.ok(
            r.plages.some((p) => p.etat === d.etat && p.raisons.includes(d.raison) && p.debut < d.a && p.fin > d.de),
            `${d.nom} : raison « ${d.raison} » absente`,
          );
      }
      // Les défauts sont placés à une demi-seconde près : ce qui les entoure
      // reste bon.
      for (const [de, a] of [
        [0.5, 2.5],
        [5.6, 9.4],
        [21.6, 22.4],
      ])
        assert.ok((parts(r.plages, de, a).bon || 0) >= 0.99, `bon de ${de} à ${a} : ${JSON.stringify(r.plages)}`);
      assert.equal(r.plages[0].debut, 0);
      assert.equal(r.plages.at(-1).fin, Math.round(essai.asset.duration * 1000) / 1000);

      // Le même rush lu d'une traite donne les mêmes passages.
      const dOneTrait = path.join(dossier, "cache-entier");
      const entier = D.decouper(
        await D.mesurer(engine, essai.apercu, dOneTrait, { duree: essai.asset.duration, marque: essai.marque, tranche: 1000 }),
      );
      assert.equal(entier.plages.length, r.plages.length, JSON.stringify(entier.plages));
      entier.plages.forEach((p, i) => {
        assert.equal(p.etat, r.plages[i].etat);
        assert.ok(Math.abs(p.debut - r.plages[i].debut) <= 0.2, `raccord : ${p.debut} contre ${r.plages[i].debut}`);
      });

      const propre = await fabriquer(engine, dossier, false);
      const rp = D.decouper(
        await D.mesurer(engine, propre.apercu, path.join(dossier, "cache-propre"), {
          duree: propre.asset.duration,
          marque: propre.marque,
        }),
      );
      assert.deepEqual(
        rp.plages.map((p) => p.etat),
        ["bon"],
        "le jumeau propre : " + JSON.stringify(rp.plages),
      );
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  },
);

test(
  "une lecture interrompue reprend à la tranche suivante, et une nouvelle version de l'aperçu repart de zéro",
  { timeout: 300000 },
  async () => {
    const engine = makeEngine();
    await engine.init();
    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "juno-derush-reprise-"));
    try {
      const apercu = path.join(dossier, "apercu.mp4"),
        cache = path.join(dossier, "cache");
      await fs.mkdir(cache);
      await engine.ff([
        "-y", "-f", "lavfi", "-i", "testsrc2=s=960x540:r=25:d=12",
        ...engine.encode(), "-movflags", "+faststart", apercu,
      ]);
      // Compter les lectures FFmpeg.
      const lectures = [],
        ff = engine.ff.bind(engine);
      engine.ff = (args, o) => {
        if (args.some((a) => String(a).includes("blurdetect"))) lectures.push(args[args.indexOf("-ss") + 1] || "0");
        return ff(args, o);
      };
      const controleur = new AbortController();
      await assert.rejects(
        D.mesurer(engine, apercu, cache, {
          duree: 12,
          marque: "v1",
          tranche: 4,
          signal: controleur.signal,
          // Arrêt après la deuxième tranche, comme une tâche qui cède sa place.
          onTranche: (part) => {
            if (part > 0.6) controleur.abort("juno-cede-la-place");
          },
        }),
      );
      assert.equal(lectures.length, 2, "lectures avant l'arrêt : " + lectures);
      // Aucun fichier de travail ne traîne.
      assert.deepEqual((await fs.readdir(cache)).filter((n) => n.startsWith(".derush-")), []);
      const repris = await D.mesurer(engine, apercu, cache, { duree: 12, marque: "v1", tranche: 4 });
      assert.equal(lectures.length, 3, "la reprise relit seulement la dernière tranche : " + lectures);
      assert.ok(repris.qualite.length >= 70 && repris.qualite.length <= 74, "mesures " + repris.qualite.length);
      // Déjà lu : rien n'est relu.
      await D.mesurer(engine, apercu, cache, { duree: 12, marque: "v1", tranche: 4 });
      assert.equal(lectures.length, 3);
      // Un autre aperçu (profil couleur confirmé) : tout est relu.
      await D.mesurer(engine, apercu, cache, { duree: 12, marque: "v2", tranche: 4 });
      assert.equal(lectures.length, 6);
      // Les tranches de travail sont parties, le relevé complet reste.
      assert.deepEqual((await fs.readdir(cache)).sort(), [`derush-${D.VERSION_MESURE}.json`]);
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  },
);

test(
  "le mouvement reste calé sur l'image quand elle commence après le son, et un dossier avec apostrophe se lit",
  { timeout: 300000 },
  async () => {
    const engine = makeEngine();
    await engine.init();
    // Une apostrophe dans le chemin : un dossier « O'Brien » devenait
    // « OBrien » pour FFmpeg (relecture du 01/10/2026).
    const dossier = await fs.mkdtemp(path.join(os.tmpdir(), "juno-derush-O'Brien-"));
    try {
      const v = path.join(dossier, "v.mp4"),
        tard = path.join(dossier, "tard.mp4"),
        apercu = path.join(dossier, "apercu.mp4");
      // 6 s d'image, coupe franche à 3 s ; puis l'image décalée de 0,5 s
      // après le son, comme certains fichiers de caméra.
      await engine.ff([
        "-y", "-f", "lavfi", "-i", "testsrc2=s=960x540:r=25:d=6", "-f", "lavfi", "-i", "mandelbrot=s=960x540:r=25",
        "-filter_complex", "[0:v][1:v]overlay=enable='gte(t,3)':shortest=1,format=yuv420p[o]",
        "-map", "[o]", "-t", "6", ...engine.encode(), "-g", "25", v,
      ]);
      await engine.ff([
        "-y", "-itsoffset", "0.5", "-i", v, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=6.5",
        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", tard,
      ]);
      const meta = await engine.probe(tard);
      await engine.proxy(tard, { ...meta, inputSpace: "rec709" }, apercu);
      const cache = path.join(dossier, "cache");
      await fs.mkdir(cache);
      const r = await D.mesurer(engine, apercu, cache, { duree: meta.duration, marque: "x" });
      assert.ok(r.qualite.length > 20 && r.mouvement.length > 40, "relevés vides");
      const pic = r.qualite.reduce((b, e) => (e.ydif > b.ydif ? e : b));
      const c = D.coupes(r.qualite, r.mouvement, D.REGLAGES.prudent);
      const vues = r.qualite.filter((_, i) => c[i]).map((e) => e.t);
      // La coupe vue par la différence d'image l'est aussi par la
      // corrélation, au même instant.
      assert.ok(vues.some((t) => Math.abs(t - pic.t) < 0.2), `coupe à ${pic.t}, vues : ${vues}`);
    } finally {
      await fs.rm(dossier, { recursive: true, force: true });
    }
  },
);
