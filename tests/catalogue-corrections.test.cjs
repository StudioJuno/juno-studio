// Corrections de l'audit du catalogue (29/09/2026), côté processus principal.
// Chaque test rejoue un défaut confirmé sur les vrais gestionnaires ; les
// règles partagées avec la fenêtre sont dans tests/catalogue-corrections.test.ts.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { createHash } = require("node:crypto"),
  { DatabaseSync } = require("node:sqlite");
const { registerBackup } = require("../electron/backup.cjs");
const { registerExports } = require("../electron/export.cjs");
const { registerImports } = require("../electron/imports.cjs");
const { registerReview } = require("../electron/review.cjs");

const sha = (b) => createHash("sha256").update(b).digest("hex");
async function dossier(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-catalogue-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
/** Sauvegarde et exports branchés comme dans main.cjs, sur un profil jetable. */
async function atelier(t) {
  const root = await dossier(t),
    handlers = {},
    assets = {},
    origins = {};
  let choix = [];
  const handle = (nom, fn) => (handlers[nom] = fn),
    app = { getPath: () => root },
    dialog = {
      showOpenDialog: async (_fenetre, options) => ({
        canceled: false,
        filePaths: options?.properties?.includes("openDirectory")
          ? [root]
          : choix,
      }),
    };
  const exportDirs = await registerExports({
    handle,
    app,
    dialog,
    getWindow: () => null,
  });
  registerBackup({
    handle,
    app,
    dialog,
    getWindow: () => null,
    assets,
    persistAssets: async () => {},
    exportDirs,
    origins,
  });
  return {
    root,
    handlers,
    assets,
    origins,
    exportDirs,
    choisir: (fichiers) => (choix = [].concat(fichiers)),
  };
}
const projet = {
  id: "ancien",
  name: "Mariage Léa et Hugo",
  date: "2026-09-12",
  location: "Lyon",
  kind: "Mariage",
  demo: false,
  created: 1,
};
function fiche(i, original, extra = {}) {
  return {
    id: "p" + i,
    projectId: "ancien",
    name: "IMG_" + i + ".jpg",
    source: "juno://image/p" + i,
    thumbnail: "data:image/jpeg;base64,AA==",
    width: 6000,
    height: 4000,
    size: original.length,
    hash: sha(original),
    status: "keep",
    stars: 0,
    protected: false,
    chapter: "Cérémonie",
    adjustments: { exposure: 0.2 },
    history: [],
    created: 1,
    originalFile: String(i + 1).padStart(5, "0") + "_p" + i + ".jpg",
    ...extra,
  };
}
/** Écrit une sauvegarde comme App.backupProject : originaux, puis catalogue. */
async function sauvegarder(a, photos, originaux) {
  const token = await a.handlers["begin-export"](),
    dir = a.exportDirs.get(token);
  for (const [i, p] of photos.entries())
    await fs.writeFile(path.join(dir, p.originalFile), originaux[i]);
  const texte = JSON.stringify({
    schema: 2,
    created: new Date().toISOString(),
    project: projet,
    photos,
  });
  await a.handlers["write-export"](
    token,
    "juno-backup.json",
    new TextEncoder().encode(texte).buffer,
  );
  const manifeste = path.join(dir, "juno-backup.json");
  a.choisir(manifeste);
  return { dir, manifeste, octets: Buffer.byteLength(texte) };
}
const copiesRestaurees = async (root) =>
  fs.readdir(path.join(root, "restored-originals")).catch(() => []);

test("défaut 2 : un album de 2 000 photos analysées (plus de 128 Mo) se restaure", async (t) => {
  const a = await atelier(t);
  // Le poids réel d'une fiche préparée : une vignette de 60 ko et le résumé
  // de sens de 768 nombres, qu'un Float32Array devient en JSON.
  const vignette = "data:image/jpeg;base64," + "A".repeat(60000),
    sens = Object.fromEntries(
      Array.from({ length: 768 }, (_, i) => [i, Math.fround(Math.sin(i) / 7)]),
    );
  const originaux = [],
    photos = [];
  for (let i = 0; i < 2000; i++) {
    originaux.push(Buffer.from("original " + i));
    photos.push(
      fiche(i, originaux[i], { thumbnail: vignette, semantic: sens }),
    );
  }
  const { octets } = await sauvegarder(a, photos, originaux);
  assert.ok(octets > 128 * 1024 * 1024, "la sauvegarde doit dépasser 128 Mo");
  const restauree = await a.handlers["restore-backup"]();
  assert.equal(restauree.photos.length, 2000);
  assert.equal(Object.keys(a.assets).length, 2000);
  // Le résumé de sens repasse en Float32Array avant d'aller vers la fenêtre.
  assert.ok(restauree.photos[0].semantic instanceof Float32Array);
  assert.equal(restauree.photos[0].semantic.length, 768);
});

test("défaut 1 : les champs texte d'une sauvegarde forgée sont retirés avant d'être montrés", async (t) => {
  const a = await atelier(t),
    original = Buffer.from("original forgé");
  const forgee = fiche(0, original, {
    chapter: { texte: "Cérémonie" },
    moment: 12,
    camera: { make: { texte: "Canon" }, model: "EOS R5", iso: "800" },
    proposal: { exposure: 0.3, contrast: "fort" },
    analysis: {
      brightness: 0.5,
      sharpness: 120,
      clipped: 0,
      dhash: "0".repeat(64),
      advice: "normal",
      reasons: [],
      verdict: { texte: "Nette" },
      groupId: ["rafale"],
      suggested: "oui",
      cast: { r: 1, g: "vert", b: 1 },
      faces: {
        count: 1,
        closedEyes: 0,
        blink: 0,
        version: "visages-3",
        reads: [{ weight: "lourd" }],
      },
    },
  });
  await sauvegarder(a, [forgee], [original]);
  const { photos } = await a.handlers["restore-backup"]();
  const p = photos[0];
  for (const cle of ["chapter", "moment"]) assert.equal(p[cle], undefined, cle);
  assert.deepEqual(p.camera, { model: "EOS R5" });
  assert.deepEqual(p.proposal, { exposure: 0.3 });
  for (const cle of ["verdict", "groupId", "suggested", "cast"])
    assert.equal(p.analysis[cle], undefined, cle);
  // La lecture de visage mal formée est retirée, et la version effacée pour
  // que la prochaine passe relise les visages.
  assert.equal(p.analysis.faces.reads.length, 0);
  assert.equal(p.analysis.faces.version, undefined);
  assert.equal(p.analysis.dhash, "0".repeat(64));
  assert.equal(p.name, "IMG_0.jpg");
});

test("défaut 7 : une sauvegarde que la fenêtre refuserait est refusée avant toute copie", async (t) => {
  const a = await atelier(t),
    originaux = [Buffer.from("un"), Buffer.from("deux")];
  const photos = [
    fiche(0, originaux[0]),
    // Une opacité de calque hors bornes : validateAdjustments la refuse.
    fiche(1, originaux[1], {
      adjustments: {
        localEdits: [
          {
            id: "c",
            name: "Pinceau",
            tool: "exposure",
            points: [{ x: 0.5, y: 0.5 }],
            radius: 0.1,
            amount: 1,
            opacity: 2,
            visible: true,
          },
        ],
      },
    }),
  ];
  await sauvegarder(a, photos, originaux);
  for (let essai = 0; essai < 2; essai++)
    await assert.rejects(
      a.handlers["restore-backup"](),
      /réglages invalides/,
    );
  assert.deepEqual(await copiesRestaurees(a.root), []);
  assert.deepEqual(a.assets, {});
});

test("défaut 0 : les calques que l'atelier crée se sauvegardent et se restaurent", async (t) => {
  const a = await atelier(t),
    original = Buffer.from("calques");
  const photo = fiche(0, original, {
    adjustments: {
      exposure: 0.5,
      localEdits: [
        // Écrit tel quel par « Détourer une personne » (EditorPreview).
        {
          id: "s",
          name: "Sujet détouré",
          tool: "subject",
          points: [{ x: 0.4, y: 0.6 }],
          radius: 0,
          amount: 0.3,
          opacity: 1,
          visible: true,
        },
        // Une force tapée au clavier au-delà de ±4.
        {
          id: "f",
          name: "Pinceau",
          tool: "exposure",
          points: [{ x: 1 + 2e-16, y: 0.2 }],
          radius: 0.05,
          amount: 5,
          opacity: 1,
          visible: true,
        },
      ],
    },
  });
  await sauvegarder(a, [photo], [original]);
  const { photos } = await a.handlers["restore-backup"]();
  assert.equal(photos[0].adjustments.localEdits.length, 2);
  assert.equal((await copiesRestaurees(a.root)).length, 1);
});

test("défaut 3 : sans lien dur (exFAT, FAT32), l'export et la sauvegarde s'écrivent sans rien écraser", async (t) => {
  const fsp = require("node:fs/promises"),
    lien = fsp.link;
  // exFAT et FAT32 répondent ENOTSUP à link(2), comme sur une clé USB.
  fsp.link = async () => {
    throw Object.assign(Error("ENOTSUP: operation not supported on socket, link"), {
      code: "ENOTSUP",
    });
  };
  t.after(() => (fsp.link = lien));
  const a = await atelier(t),
    token = await a.handlers["begin-export"](),
    dir = a.exportDirs.get(token),
    octets = (texte) => new TextEncoder().encode(texte).buffer;
  await a.handlers["write-export"](token, "photo.jpg", octets("rendu"));
  assert.equal(await fs.readFile(path.join(dir, "photo.jpg"), "utf8"), "rendu");
  // Une reprise identique passe, un contenu différent ne remplace jamais.
  await a.handlers["write-export"](token, "photo.jpg", octets("rendu"));
  await assert.rejects(
    a.handlers["write-export"](token, "photo.jpg", octets("autre")),
    /existe déjà/,
  );
  // Deux écritures concurrentes d'un même nom : une seule gagne, entière.
  const course = await Promise.allSettled([
    a.handlers["write-export"](token, "course.jpg", octets("premier")),
    a.handlers["write-export"](token, "course.jpg", octets("second")),
  ]);
  assert.deepEqual(
    course.map((r) => r.status).sort(),
    ["fulfilled", "rejected"],
  );
  const gagnant = course[0].status === "fulfilled" ? "premier" : "second";
  assert.equal(await fs.readFile(path.join(dir, "course.jpg"), "utf8"), gagnant);
  assert.deepEqual(
    (await fs.readdir(dir)).filter((n) => n.endsWith(".tmp")),
    [],
  );
  // La sauvegarde complète sur ce disque : catalogue écrit, puis restauré.
  const original = Buffer.from("original sur clé");
  await sauvegarder(a, [fiche(0, original)], [original]);
  assert.equal((await a.handlers["restore-backup"]()).photos.length, 1);
});

test("défaut 13 : « Relier des originaux » garde la copie vérifiée de Juno", async (t) => {
  const a = await atelier(t),
    octets = Buffer.from("original déjà gardé");
  const copie = path.join(a.root, "Originals", "p1.jpg"),
    carte = path.join(a.root, "carte", "IMG_0001.jpg");
  await fs.mkdir(path.dirname(copie), { recursive: true });
  await fs.mkdir(path.dirname(carte), { recursive: true });
  await fs.writeFile(copie, octets);
  await fs.writeFile(carte, octets);
  a.assets.p1 = copie;
  // Une photo dont l'original a disparu, elle, est bien reliée au fichier choisi.
  a.assets.p2 = path.join(a.root, "disque-débranché", "IMG_0002.jpg");
  const autre = path.join(a.root, "carte", "IMG_0002.jpg");
  await fs.writeFile(autre, "deuxième");
  a.choisir([carte, autre]);
  const reliees = await a.handlers["relink-originals"]([
    { id: "p1", hash: sha(octets) },
    { id: "p2", hash: sha(Buffer.from("deuxième")) },
  ]);
  assert.deepEqual(reliees.map((r) => r.id).sort(), ["p1", "p2"]);
  assert.equal(a.assets.p1, copie);
  assert.equal(a.origins.p1, carte);
  assert.equal(a.assets.p2, autre);
  // La carte retirée, la copie de Juno reste la source.
  await fs.rm(carte);
  assert.equal(await fs.readFile(a.assets.p1, "utf8"), "original déjà gardé");
});

test("défaut 8 : réimporter une carte ne recopie pas les originaux déjà gardés", async (t) => {
  const root = await dossier(t),
    carte = path.join(root, "carte");
  await fs.mkdir(carte);
  const photo = path.join(carte, "IMG_0001.CR3"),
    voisine = path.join(carte, "IMG_0002.CR3");
  await fs.writeFile(photo, "raw-0001");
  await fs.writeFile(voisine, "raw-0002"); // même taille, autre contenu
  const assets = { a: photo };
  const importer = () => {
    const h = {};
    registerImports({
      handle: (nom, fn) => (h[nom] = fn),
      app: { getPath: () => root },
      assets,
      persistAssets: async () => {},
    });
    return h;
  };
  let h = importer();
  const premier = await h["secure-import-source"]({ id: "a" });
  // Le même fichier, sélectionné une seconde fois : nouvelle entrée, même contenu.
  assets.b = photo;
  const second = await h["secure-import-source"]({ id: "b" });
  const originaux = path.join(root, "Originals");
  assert.deepEqual(await fs.readdir(originaux), ["a.cr3"]);
  assert.equal(assets.b, assets.a);
  assert.equal(second.hash, premier.hash);
  assert.equal(second.managed, true);
  // Une autre photo de même taille reçoit bien sa propre copie.
  assets.c = voisine;
  await h["secure-import-source"]({ id: "c" });
  assert.deepEqual((await fs.readdir(originaux)).sort(), ["a.cr3", "c.cr3"]);
  // Après un redémarrage, les copies existantes sont retrouvées.
  h = importer();
  assets.d = photo;
  await h["secure-import-source"]({ id: "d" });
  assert.equal(assets.d, assets.a);
  // Une copie altérée sur le disque n'est jamais reprise.
  await fs.writeFile(assets.a, "raw-XXXX");
  assets.e = photo;
  await h["secure-import-source"]({ id: "e" });
  assert.equal(assets.e, path.join(originaux, "e.cr3"));
  assert.equal(await fs.readFile(assets.e, "utf8"), "raw-0001");
  const info = await h["import-source-info"]("b");
  assert.equal(info.managed, true);
});

/** Le portail local comme dans main.cjs, avec les événements de l'application. */
async function portail(t, root) {
  const api = {},
    evenements = {};
  const app = {
    isPackaged: false,
    getPath: () => root,
    on: (nom, fn) => (evenements[nom] = evenements[nom] || []).push(fn),
  };
  if (!process.argv.includes("--juno-test-hidden"))
    process.argv.push("--juno-test-hidden");
  const module = await registerReview({
    handle: (nom, fn) => (api[nom] = fn),
    app,
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => {} },
  });
  t.after(() => module.close());
  return { api, evenements, module };
}

test("défaut 15 : quitter l'application rend le verrou du stockage de relecture", async (t) => {
  const root = await dossier(t),
    p = await portail(t, root),
    base = path.join(root, "review", "service", "review.sqlite");
  const bail = () => {
    const db = new DatabaseSync(base);
    try {
      return db.prepare("SELECT pid FROM runtime_lease").all().map((r) => r.pid);
    } finally {
      db.close();
    }
  };
  assert.deepEqual(bail(), [process.pid]);
  for (const fn of p.evenements["will-quit"]) fn();
  assert.deepEqual(bail(), []);
  // Au lancement suivant, le portail démarre même si ce numéro de
  // processus est repris par un processus vivant (ici, celui du test).
  const relance = await portail(t, root);
  assert.equal((await relance.api["review-status"]()).available, true);
});

test("défaut 6 : une sélection de 1 500 photos aux fiches complètes est acceptée", async (t) => {
  const root = await dossier(t),
    { api } = await portail(t, root);
  const sens = new Float32Array(768).map((_, i) => Math.sin(i));
  const photos = Array.from({ length: 1500 }, (_, i) => ({
    id: "photo-" + i,
    projectId: "projet",
    name: "IMG_" + i + ".jpg",
    source: "juno://image/photo-" + i,
    hash: "c".repeat(64),
    revision: 3,
    width: 6000,
    height: 4000,
    adjustments: { exposure: 0.4 },
    status: "keep",
    // Ce que la fiche transporte sans que la relecture s'en serve.
    semantic: Array.from(sens),
    analysis: { verdict: "Nette", empreinte: { g: "A".repeat(4000) } },
    future: [{ exposure: 0.1 }],
    thumbnail: "data:image/jpeg;base64," + "A".repeat(20000),
  }));
  const job = await api["review-begin"]({
    projectId: "projet",
    title: "Sélection",
    kind: "photo",
    photos,
    clientName: "Léa",
  });
  assert.equal(job.total, 1500);
  const { photos: figees } = await api["review-preparation"]({ id: job.id });
  assert.equal(figees.length, 1500);
  const p = figees.find((x) => x.id === "photo-7");
  assert.equal(p.semantic, undefined);
  assert.equal(p.analysis, undefined);
  assert.equal(p.status, undefined);
  assert.deepEqual(
    [p.name, p.source, p.hash, p.revision, p.width, p.adjustments.exposure],
    ["IMG_7.jpg", "juno://image/photo-7", "c".repeat(64), 3, 6000, 0.4],
  );
});
