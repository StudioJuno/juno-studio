const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { registerVideo } = require("../electron/video/index.cjs"),
  D = require("../electron/video/derush.cjs");
const nativeRoot = path.join(__dirname, "../native", process.platform + "-" + process.arch),
  colorRoot = path.join(__dirname, "../public/video-color"),
  pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Le dérushage dans la file de tâches de l'app : il part seul, en fond,
 * après l'import ; il cède sa place à une tâche demandée et reprend ; il
 * refait un rush dont l'aperçu a changé sans toucher aux décisions de
 * l'utilisateur ; il ne repart pas pour un rush déjà dérushé.
 */
test(
  "le dérushage part après l'import, cède sa place, et garde les décisions quand l'aperçu change",
  {
    skip: !fss.existsSync(path.join(nativeRoot, "ffmpeg" + (process.platform === "win32" ? ".exe" : ""))),
    timeout: 300000,
  },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-derush-tache-")),
      api = {},
      events = {};
    let picked = [];
    try {
      const { engine, store } = await registerVideo({
        handle: (name, fn) => (api[name] = fn),
        app: { getPath: () => root, getVersion: () => "0.0.0-test", on: (name, fn) => (events[name] = fn) },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: picked }) },
        protocol: { handle: () => {} },
        getWindow: () => undefined,
        nativeRoot,
        colorRoot,
        autoDerush: true,
      });
      assert(engine.status.available, JSON.stringify(engine.status));
      // Un rush de 40 s, noir de 12 à 15 s.
      const file = path.join(root, "rush.mp4");
      await engine.ff([
        "-y",
        "-f", "lavfi", "-i", "testsrc2=s=640x360:r=25:d=40",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=40",
        "-vf", "lutyuv=y='16+(val-16)*0.03':u=128:v=128:enable='between(t,12,15)',noise=c0s=3:c0f=t+u",
        ...engine.encode(),
        "-c:a", "aac", "-shortest", file,
      ]);
      await engine.tagH264(file);
      const p = await api["video-create"]({ name: "Dérushage" });
      picked = [file];
      const importe = await api["video-import"](p.id);
      const tache = async (condition) => {
        for (let i = 0; i < 1200; i++) {
          const j = api["video-list"]().jobs.find(condition);
          if (j && ["done", "failed", "cancelled"].includes(j.state)) {
            if (j.state !== "done") throw Error(j.kind + " : " + j.state + " " + (j.error || ""));
            return j;
          }
          await pause(100);
        }
        throw Error("Tâche jamais finie");
      };
      await tache((j) => j.id === importe.id);
      // Le dérushage part seul, en fond.
      let derush;
      for (let i = 0; i < 100 && !derush; i++) {
        derush = store.data.jobs.find((j) => j.kind === "derush");
        if (!derush) await pause(50);
      }
      assert.ok(derush, "aucun dérushage après l'import");
      assert.equal(derush.payload.background, true);
      // Une tâche demandée arrive : le dérushage lui cède la place.
      const asset = api["video-project"](p.id).assets[0];
      const analyse = await api["video-analyze"]({ projectId: p.id, ids: [asset.id] });
      for (let i = 0; i < 200; i++) {
        const etat = api["video-list"]().jobs.find((j) => j.id === analyse.id).state;
        if (etat !== "queued") break;
        await pause(20);
      }
      // Pendant que la tâche demandée tourne, le dérushage attend.
      assert.notEqual(api["video-list"]().jobs.find((j) => j.id === derush.id).state, "running");
      await tache((j) => j.id === analyse.id);
      await tache((j) => j.id === derush.id);
      let a = api["video-project"](p.id).assets[0];
      assert.ok(a.derush, "pas de résultat sur le média");
      assert.equal(a.derush.mesure, D.VERSION_MESURE);
      assert.equal(a.derush.regles, D.VERSION_REGLES);
      assert.ok(a.analysis, "l'analyse demandée n'a pas eu lieu");
      const noir = a.derush.plages.find((x) => x.raisons.includes("noir"));
      assert.ok(noir && noir.etat === "masque", JSON.stringify(a.derush.plages));
      assert.ok(Math.abs(noir.debut - 12) < 0.35 && Math.abs(noir.fin - 15) < 0.35, JSON.stringify(noir));
      assert.equal(a.derush.plages[0].debut, 0);
      assert.equal(a.derush.plages.at(-1).fin, Math.round(a.duration * 1000) / 1000);
      // Les relevés restent dans le cache du média, pas dans le catalogue.
      assert.ok(fss.existsSync(path.join(store.root, "cache", a.id, `derush-${D.VERSION_MESURE}.json`)));
      assert.ok(JSON.stringify(a.derush).length < 4000);

      // Déjà dérushé : une nouvelle demande ne relit rien.
      const lectures = [],
        ff = engine.ff.bind(engine);
      engine.ff = (args, o) => {
        if (args.some((x) => String(x).includes("blurdetect"))) lectures.push(1);
        return ff(args, o);
      };
      const encore = await api["video-derush"]({ projectId: p.id });
      await tache((j) => j.id === encore.id);
      assert.equal(lectures.length, 0);

      // L'utilisateur garde un passage masqué ; puis l'aperçu est refait
      // (profil couleur actualisé) : le rush est relu, la décision reste.
      await api["video-derush-decision"]({ projectId: p.id, assetId: a.id, debut: 12, fin: 14, etat: "bon" });
      // Une décision en recouvre une autre ; `null` rend la main à l'analyse.
      await api["video-derush-decision"]({ projectId: p.id, assetId: a.id, debut: 13.5, fin: 20, etat: null });
      await assert.rejects(api["video-derush-decision"]({ projectId: p.id, assetId: a.id, debut: 2, fin: 1, etat: "bon" }));
      await assert.rejects(api["video-derush-decision"]({ projectId: p.id, assetId: a.id, debut: 1, fin: 2, etat: "jeter" }));
      assert.deepEqual(api["video-project"](p.id).assets[0].derush.decisions, [{ debut: 12, fin: 13.5, etat: "bon" }]);
      const avant = a.derush.marque;
      const couleur = await api["video-space"]({ projectId: p.id, assetId: a.id, inputSpace: "rec709" });
      await tache((j) => j.id === couleur.id);
      let relu;
      for (let i = 0; i < 100 && !relu; i++) {
        relu = store.data.jobs.find((j) => j.kind === "derush" && j.id !== derush.id && j.id !== encore.id);
        if (!relu) await pause(50);
      }
      assert.ok(relu, "l'aperçu refait n'a pas relancé le dérushage");
      await tache((j) => j.id === relu.id);
      a = api["video-project"](p.id).assets[0];
      assert.notEqual(a.derush.marque, avant);
      assert.equal(lectures.length, 1);
      assert.deepEqual(a.derush.decisions, [{ debut: 12, fin: 13.5, etat: "bon" }]);
    } finally {
      events["will-quit"]?.();
      events["before-quit"]?.();
      await pause(200);
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "un aperçu illisible ne bloque pas les autres rushes, et un dérushage annulé ne repart pas pour eux",
  {
    skip: !fss.existsSync(path.join(nativeRoot, "ffmpeg" + (process.platform === "win32" ? ".exe" : ""))),
    timeout: 300000,
  },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-derush-echec-")),
      api = {},
      events = {};
    let picked = [];
    try {
      const { engine, store } = await registerVideo({
        handle: (name, fn) => (api[name] = fn),
        app: { getPath: () => root, getVersion: () => "0.0.0-test", on: (name, fn) => (events[name] = fn) },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: picked }) },
        protocol: { handle: () => {} },
        getWindow: () => undefined,
        nativeRoot,
        colorRoot,
        autoDerush: true,
      });
      const fichier = async (nom, d = 8) => {
        const f = path.join(root, nom);
        await engine.ff(["-y", "-f", "lavfi", "-i", `testsrc2=s=640x360:r=25:d=${d}`, ...engine.encode(), f]);
        return f;
      };
      const finie = async (condition) => {
        for (let i = 0; i < 1200; i++) {
          const j = api["video-list"]().jobs.find(condition);
          if (j && ["done", "failed", "cancelled"].includes(j.state)) return j;
          await pause(100);
        }
        throw Error("Tâche jamais finie");
      };
      const p = await api["video-create"]({ name: "Échecs" });
      picked = [await fichier("a.mp4"), await fichier("b.mp4")];
      const importe = await api["video-import"](p.id);
      await finie((j) => j.id === importe.id);
      // L'aperçu de A devient illisible (disque abîmé, fichier tronqué).
      const [a, b] = api["video-project"](p.id).assets;
      await finie((j) => j.kind === "derush");
      await fs.writeFile(store.data.media[a.id].proxy, Buffer.alloc(4096, 7));
      const bMarque = api["video-project"](p.id).assets[1].derush.marque;
      const relance = await api["video-derush"]({ projectId: p.id });
      assert.equal(relance.state === "queued" || relance.state === "running", true);
      const fin = await finie((j) => j.id === relance.id);
      // La tâche finit ; A est noté en échec, B reste dérushé.
      assert.equal(fin.state, "done", fin.error);
      let q = api["video-project"](p.id);
      assert.ok(q.assets[0].derushEchec, "échec non noté");
      assert.equal(q.assets[1].derush.marque, bMarque);
      assert.ok(store.data.jobs.find((j) => j.id === relance.id).errors.some((e) => e.startsWith("a.mp4")));
      // Relancé, A n'est pas relu tant que son aperçu ne change pas.
      const lectures = [],
        ff = engine.ff.bind(engine);
      engine.ff = (args, o) => {
        if (args.some((x) => String(x).includes("blurdetect"))) lectures.push(1);
        return ff(args, o);
      };
      const encore = await api["video-derush"]({ projectId: p.id });
      await finie((j) => j.id === encore.id);
      assert.equal(lectures.length, 0, "un aperçu en échec a été relu");
      // Un dérushage annulé ne repart pas pour ses rushes quand on en
      // importe un autre : seul le nouveau est prévu.
      picked = [await fichier("c.mp4"), await fichier("d.mp4")];
      const second = await api["video-import"](p.id);
      await finie((j) => j.id === second.id);
      let prevu;
      for (let i = 0; i < 200 && !prevu; i++) {
        prevu = store.data.jobs.find((j) => j.kind === "derush" && ![relance.id, encore.id].includes(j.id) && !["done", "failed", "cancelled"].includes(j.state));
        if (!prevu) await pause(25);
      }
      assert.ok(prevu, "pas de dérushage après le second import");
      await api["video-job"]({ id: prevu.id, action: "cancel" });
      picked = [await fichier("e.mp4")];
      const troisieme = await api["video-import"](p.id);
      await finie((j) => j.id === troisieme.id);
      const e = api["video-project"](p.id).assets.find((x) => x.name === "e.mp4");
      let dernier;
      for (let i = 0; i < 200 && !dernier; i++) {
        dernier = store.data.jobs.find((j) => j.kind === "derush" && j.payload.ids.includes(e.id));
        if (!dernier) await pause(25);
      }
      assert.deepEqual(dernier?.payload.ids, [e.id]);
      assert.equal(dernier.payload.background, true);
    } finally {
      events["will-quit"]?.();
      events["before-quit"]?.();
      await pause(200);
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

