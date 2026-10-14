const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const { lire } = require("../electron/xmp-sidecar.cjs");
const { registerLightroom, horodatage, dossierNeuf } = require("../electron/lightroom.cjs");
/**
 * Le « dossier prêt pour Lightroom », relu le 29/09/2026 : la case « Couleur »
 * y dépendait de la case « Étoiles », et deux préparations dans la même
 * minute tombaient sur le même nom de dossier (EEXIST brut).
 */
const sha = (b) => createHash("sha256").update(b).digest("hex");
async function banc() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-lr-dossier-"));
  const api = {},
    assets = {},
    origins = {};
  let choix = [];
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: choix }) };
  const app = { getPath: () => path.join(root, "userData") };
  await fs.mkdir(path.join(root, "userData", "Originals"), { recursive: true });
  registerLightroom({ handle: (n, f) => (api[n] = f), app, dialog, shell: { showItemInFolder() {} }, getWindow: () => undefined, assets, origins, persistOrigins: async () => {} });
  const cartes = path.join(root, "carte");
  await fs.mkdir(cartes);
  async function photo(nom, contenu, extra = {}) {
    const id = "p" + Math.random().toString(36).slice(2, 10);
    const original = path.join(cartes, nom),
      copie = path.join(root, "userData", "Originals", id + path.extname(nom));
    await fs.writeFile(original, contenu);
    await fs.writeFile(copie, contenu);
    assets[id] = copie;
    origins[id] = original;
    return { id, name: nom, hash: sha(contenu), size: Buffer.byteLength(contenu), stars: 0, status: "pending", protected: false, people: [], ...extra };
  }
  return { root, api, cartes, photo, choisir: (c) => (choix = c) };
}
test("mêmes cases, même résultat : « Couleur » cochée sans « Étoiles » écrit la couleur dans le dossier", async () => {
  const b = await banc();
  try {
    const a = await b.photo("A.CR3", "raw-a", { stars: 5, status: "keep" });
    const options = { etoiles: false, couleurs: true };
    // À côté de l'original.
    const plan = await b.api["lightroom-plan"]({ items: [a], options });
    await b.api["lightroom-write"](plan.token);
    const aCote = lire(await fs.readFile(path.join(b.cartes, "A.xmp"), "utf8"));
    // Dans le dossier prêt pour Lightroom.
    const dest = path.join(b.root, "livraison");
    await fs.mkdir(dest);
    b.choisir([dest]);
    const r = await b.api["lightroom-folder"]({ items: [a], options });
    const dansDossier = lire(await fs.readFile(path.join(r.dossier, "A.xmp"), "utf8"));
    assert.equal(aCote.rating, undefined);
    assert.ok(aCote.label, "la couleur est écrite à côté du RAW");
    assert.equal(dansDossier.rating, undefined);
    assert.equal(dansDossier.label, aCote.label);
    // Et « Couleur » décochée n'écrit toujours pas de couleur.
    const sans = await b.api["lightroom-folder"]({ items: [a], options: { couleurs: false } });
    const x = lire(await fs.readFile(path.join(sans.dossier, "A.xmp"), "utf8"));
    assert.equal(x.label, undefined);
    assert.equal(x.rating, 5);
  } finally {
    await fs.rm(b.root, { recursive: true, force: true });
  }
});
test("deux dossiers pour Lightroom dans la même minute : le second est suffixé", async () => {
  const b = await banc();
  try {
    const a = await b.photo("A.CR3", "raw-a", { stars: 3 });
    const dest = path.join(b.root, "livraison");
    await fs.mkdir(dest);
    b.choisir([dest]);
    const trois = [];
    for (let i = 0; i < 3; i++) trois.push(await b.api["lightroom-folder"]({ items: [a], options: {} }));
    assert.equal(new Set(trois.map((r) => r.dossier)).size, 3);
    assert.ok(trois.every((r) => r.copies === 1));
    for (const r of trois)
      assert.match(path.basename(r.dossier), /^Juno pour Lightroom \d{4}-\d{2}-\d{2}-\d{2}-\d{2}( \(\d\))?$/);
  } finally {
    await fs.rm(b.root, { recursive: true, force: true });
  }
});
test("un nom de dossier déjà pris reçoit (2), puis (3)", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "juno-lr-nom-"));
  try {
    const noms = [];
    for (let i = 0; i < 3; i++) noms.push(path.basename(await dossierNeuf(parent, "Juno pour Lightroom 2026-09-29-07-05")));
    assert.deepEqual(noms, ["Juno pour Lightroom 2026-09-29-07-05", "Juno pour Lightroom 2026-09-29-07-05 (2)", "Juno pour Lightroom 2026-09-29-07-05 (3)"]);
    // Une autre erreur que « déjà pris » n'est pas maquillée.
    await assert.rejects(dossierNeuf(path.join(parent, "absent", "plus-loin"), "X"), /ENOENT/);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});
test("l'horodatage suit l'heure locale", () => {
  const d = new Date(2026, 8, 29, 7, 5);
  assert.equal(horodatage(d), "2026-09-29-07-05");
});
