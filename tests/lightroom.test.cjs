const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const { fusionner, nouveau, lire, XmpNonReconnu } = require("../electron/xmp-sidecar.cjs");
const { registerLightroom, decider } = require("../electron/lightroom.cjs");
const FIX = path.join(__dirname, "fixtures", "xmp");
const aftershoot = () => fs.readFile(path.join(FIX, "aftershoot-note.xmp"), "utf8");
const retouche = () => fs.readFile(path.join(FIX, "lightroom-retouche.xmp"), "utf8");
const sha = (b) => createHash("sha256").update(b).digest("hex");
test("fusion : seules les propriétés de Juno bougent, les retouches gardent leurs octets", async () => {
  const x = await aftershoot();
  const out = fusionner(x, { rating: 4, label: "Bleu", keywords: ["Juno|Tri|Gardée", "Juno|Personnes|Clément"], date: "2026-09-27T20:00:00Z" });
  assert.deepEqual(lire(out), { rating: 4, label: "Bleu", keywords: ["Juno|Tri|Gardée", "Juno|Personnes|Clément"] });
  // Tout ce qui est crs:, As:, le Look et la courbe : identiques à l'octet.
  for (const bloc of [x.slice(x.indexOf("   crs:Temperature"), x.indexOf("   As:AfsCropAngle")), x.slice(x.indexOf("   <crs:Look>"), x.indexOf("  </rdf:Description>"))])
    assert.ok(out.includes(bloc), bloc.slice(0, 40));
  assert.ok(out.startsWith('<?xpacket begin="﻿"'));
  // 2 espaces de noms, la date, et deux blocs de 6 lignes : rien d'autre.
  assert.equal(out.split("\n").length - x.split("\n").length, 15);
});
test("fusion : un second envoi identique ne change pas un octet", async () => {
  const r = { rating: 3, label: "Jaune", keywords: ["Juno|Tri|Gardée"], date: "2026-09-27T20:00:00Z" };
  const une = fusionner(await retouche(), r);
  assert.equal(fusionner(une, r), une);
  const neuf = nouveau(r);
  assert.equal(fusionner(neuf, r), neuf);
});
test("mots-clés : le sous-arbre Juno est remplacé, ceux du photographe restent", async () => {
  const x = await retouche();
  let out = fusionner(x, { keywords: ["Juno|Tri|Gardée", "Juno|Personnes|Audrey-Ann"] });
  assert.deepEqual(lire(out).keywords, ["Lieux|Paris", "Juno|Tri|Gardée", "Juno|Personnes|Audrey-Ann"]);
  assert.match(out, /<rdf:li>Mariage<\/rdf:li>[\s\S]*<rdf:li>Gardée<\/rdf:li>/);
  // Gardée devient Écartée : seules les entrées de Juno changent.
  out = fusionner(out, { keywords: ["Juno|Tri|Écartée"] });
  assert.deepEqual(lire(out).keywords, ["Lieux|Paris", "Juno|Tri|Écartée"]);
  assert.doesNotMatch(out, /Gardée|Audrey-Ann/);
  assert.match(out, /<rdf:li>Mariage<\/rdf:li>/);
  assert.match(out, /<rdf:li>Paris<\/rdf:li>/);
  // Le masque imbriqué n'a pas bougé.
  assert.ok(out.includes(x.slice(x.indexOf("   <crs:MaskGroupBasedCorrections>"), x.indexOf("  </rdf:Description>\n </rdf:RDF>"))));
});
test("retirer une note et une couleur, et échapper les noms", async () => {
  const out = fusionner(await aftershoot(), { rating: null, label: null, keywords: ["Juno|Personnes|Zoé & \"Max\" <3"] });
  const r = lire(out);
  assert.equal(r.rating, undefined);
  assert.equal(r.label, undefined);
  assert.deepEqual(r.keywords, ['Juno|Personnes|Zoé & "Max" <3']);
  assert.match(out, /Zoé &amp; &quot;Max&quot; &lt;3/);
  assert.match(out, /crs:Temperature="5400"/);
});
test("une structure douteuse est refusée plutôt qu'abîmée", async () => {
  const x = await aftershoot();
  const refus = [
    x.replace("<x:xmpmeta", '<!DOCTYPE x [<!ENTITY a "b">]><x:xmpmeta'),
    x.replace("  </rdf:Description>\n </rdf:RDF>", '  </rdf:Description>\n  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="2"/>\n </rdf:RDF>'),
    x.replace('   xmp:Label="Vert"', '   xmp:Label="Vert"\n    xmlns:dc="http://purl.org/dc/elements/1.1/"\n   dc:subject="Mariage"'),
    x.slice(0, 600),
  ];
  for (const t of refus) assert.throws(() => fusionner(t, { rating: 3, keywords: ["Juno|Tri|Gardée"] }), XmpNonReconnu);
});
test("fusion à trois : on ne remplace que ce que Juno avait écrit", () => {
  assert.deepEqual(decider(4, undefined, undefined, false), { valeur: 4 });
  assert.deepEqual(decider(4, 4, undefined, false), { valeur: 4 });
  assert.deepEqual(decider(4, 3, 3, false), { valeur: 4 });
  assert.deepEqual(decider(4, 5, undefined, false), { conflit: 5 });
  assert.deepEqual(decider(4, 5, 3, false), { conflit: 5 });
  assert.deepEqual(decider(4, 5, undefined, true), { valeur: 4, remplace: 5 });
  // Plus d'étoiles dans Juno : on retire la note seulement si c'était la nôtre.
  assert.deepEqual(decider(undefined, 3, 3, false), { valeur: null });
  assert.deepEqual(decider(undefined, 5, undefined, false), {});
});
async function banc() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-lr-"));
  const api = {},
    assets = {},
    origins = {};
  let choix = [];
  const dialog = { showOpenDialog: async () => ({ canceled: false, filePaths: choix }) };
  const shell = { showItemInFolder() {} };
  const app = { getPath: () => path.join(root, "userData") };
  await fs.mkdir(path.join(root, "userData", "Originals"), { recursive: true });
  registerLightroom({ handle: (n, f) => (api[n] = f), app, dialog, shell, getWindow: () => undefined, assets, origins, persistOrigins: async () => {} });
  const cartes = path.join(root, "carte");
  await fs.mkdir(cartes);
  /** Un « RAW » : l'original chez le photographe, et la copie de Juno. */
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
  return { root, api, assets, origins, cartes, photo, choisir: (c) => (choix = c) };
}
test("envoi : nouveau, complété, conflit gardé, non concerné, introuvable, puis annulation", async () => {
  const b = await banc();
  try {
    const neuf = await b.photo("4R7A0001.CR3", "raw-1", { stars: 5, status: "keep", people: ["Audrey-Ann"] });
    const note = await b.photo("4R7A0002.CR3", "raw-2", { stars: 4, status: "keep" });
    const retouchee = await b.photo("4R7A0003.cr3", "raw-3", { stars: 3 });
    const jpeg = await b.photo("4R7A0004.JPG", "jpg-4", { stars: 5 });
    const perdu = await b.photo("4R7A0005.CR3", "raw-5", { stars: 2 });
    delete b.origins[perdu.id];
    const aft = await aftershoot(),
      lrx = await retouche();
    // Un sidecar existant garde sa casse.
    await fs.writeFile(path.join(b.cartes, "4R7A0002.xmp"), aft);
    await fs.writeFile(path.join(b.cartes, "4R7A0003.XMP"), lrx);
    const items = [neuf, note, retouchee, jpeg, perdu];
    const plan = await b.api["lightroom-plan"]({ items, options: {} });
    const etat = Object.fromEntries(plan.lignes.map((l) => [l.name, l.etat]));
    assert.deepEqual(etat, { "4R7A0001.CR3": "nouveau", "4R7A0002.CR3": "conflit", "4R7A0003.cr3": "complete", "4R7A0004.JPG": "non-concerne", "4R7A0005.CR3": "introuvable" });
    assert.deepEqual(plan.lignes.find((l) => l.etat === "conflit").conflit, { note: 5, couleur: "Vert" });
    const bilan = await b.api["lightroom-write"](plan.token);
    assert.equal(bilan.ecrits, 3);
    assert.equal(bilan.conserves, 1);
    assert.deepEqual(bilan.echecs, []);
    const x1 = lire(await fs.readFile(path.join(b.cartes, "4R7A0001.xmp"), "utf8"));
    assert.equal(x1.rating, 5);
    // 5 étoiles : le troisième libellé du jeu actif, « Vert » dans un Lightroom français.
    assert.equal(x1.label, plan.libelles[2]);
    assert.deepEqual(x1.keywords, ["Juno|Tri|Gardée", "Juno|Personnes|Audrey-Ann"]);
    // La note d'Aftershoot est gardée, le tri de Juno ajouté, les réglages intacts.
    const x2t = await fs.readFile(path.join(b.cartes, "4R7A0002.xmp"), "utf8");
    assert.equal(lire(x2t).rating, 5);
    assert.equal(lire(x2t).label, "Vert");
    assert.deepEqual(lire(x2t).keywords, ["Juno|Tri|Gardée"]);
    assert.match(x2t, /crs:CropAngle="-1.2"/);
    const x3 = await fs.readFile(path.join(b.cartes, "4R7A0003.XMP"), "utf8");
    assert.equal(lire(x3).rating, 3);
    assert.deepEqual((await fs.readdir(b.cartes)).filter((f) => /xmp$/i.test(f)).sort(), ["4R7A0001.xmp", "4R7A0002.xmp", "4R7A0003.XMP"]);
    // Aucun fichier temporaire oublié, aucun original touché.
    assert.deepEqual((await fs.readdir(b.cartes)).filter((f) => f.startsWith(".")), []);
    assert.equal(await fs.readFile(path.join(b.cartes, "4R7A0001.CR3"), "utf8"), "raw-1");
    // Un second envoi identique ne change rien.
    const encore = await b.api["lightroom-write"]((await b.api["lightroom-plan"]({ items, options: {} })).token);
    assert.equal(encore.ecrits, 0);
    assert.equal(encore.inchanges, 3);
    // Annuler le premier envoi : tout revient, sauf ce qui a bougé depuis.
    await fs.appendFile(path.join(b.cartes, "4R7A0003.XMP"), "\n");
    const annul = await b.api["lightroom-undo"](bilan.token);
    assert.deepEqual(annul, { rendus: 2, gardes: 1 });
    await assert.rejects(fs.stat(path.join(b.cartes, "4R7A0001.xmp")), /ENOENT/);
    assert.equal(await fs.readFile(path.join(b.cartes, "4R7A0002.xmp"), "utf8"), aft);
  } finally {
    await fs.rm(b.root, { recursive: true, force: true });
  }
});
test("une note écrite par Juno se met à jour ; changée dans Lightroom, elle est gardée", async () => {
  const b = await banc();
  try {
    let p = await b.photo("A.CR3", "raw", { stars: 4 });
    const xmp = path.join(b.cartes, "A.xmp");
    const envoyer = async (opts = {}) => b.api["lightroom-write"]((await b.api["lightroom-plan"]({ items: [p], options: opts })).token);
    await envoyer();
    assert.equal(lire(await fs.readFile(xmp, "utf8")).rating, 4);
    p = { ...p, stars: 2 };
    await envoyer();
    assert.equal(lire(await fs.readFile(xmp, "utf8")).rating, 2, "la note posée par Juno suit Juno");
    // Le photographe change la note dans Lightroom.
    await fs.writeFile(xmp, (await fs.readFile(xmp, "utf8")).replace('xmp:Rating="2"', 'xmp:Rating="5"'));
    p = { ...p, stars: 3 };
    const plan = await b.api["lightroom-plan"]({ items: [p], options: {} });
    assert.equal(plan.lignes[0].etat, "conflit");
    await b.api["lightroom-write"](plan.token);
    assert.equal(lire(await fs.readFile(xmp, "utf8")).rating, 5, "la note de Lightroom est gardée");
    await envoyer({ remplacer: true });
    assert.equal(lire(await fs.readFile(xmp, "utf8")).rating, 3, "remplacée sur demande");
    // Une photo écartée perd la note de Juno et reçoit le mot-clé.
    p = { ...p, status: "reject" };
    await envoyer();
    const r = lire(await fs.readFile(xmp, "utf8"));
    assert.equal(r.rating, undefined);
    assert.deepEqual(r.keywords, ["Juno|Tri|Écartée"]);
    // Case « Étoiles » décochée : on ne touche pas à la note.
    p = { ...p, status: "keep", stars: 4 };
    await envoyer({ etoiles: false });
    assert.equal(lire(await fs.readFile(xmp, "utf8")).rating, undefined);
  } finally {
    await fs.rm(b.root, { recursive: true, force: true });
  }
});
test("fichier modifié entre la préparation et l'envoi, lien à la place du .xmp, dossier en lecture seule", async () => {
  const b = await banc();
  try {
    const a = await b.photo("A.CR3", "raw-a", { stars: 5 });
    await fs.writeFile(path.join(b.cartes, "A.xmp"), await retouche());
    let plan = await b.api["lightroom-plan"]({ items: [a], options: {} });
    await fs.appendFile(path.join(b.cartes, "A.xmp"), "\n");
    let bilan = await b.api["lightroom-write"](plan.token);
    assert.match(bilan.echecs[0].raison, /a changé depuis la préparation/);
    const l = await b.photo("L.CR3", "raw-l", { stars: 5 });
    await fs.symlink("/etc/hosts", path.join(b.cartes, "L.xmp"));
    plan = await b.api["lightroom-plan"]({ items: [l], options: {} });
    assert.equal(plan.lignes[0].etat, "refuse");
    const ro = await b.photo("R.CR3", "raw-r", { stars: 5 });
    await fs.chmod(b.cartes, 0o555);
    try {
      plan = await b.api["lightroom-plan"]({ items: [ro], options: {} });
      bilan = await b.api["lightroom-write"](plan.token);
      assert.match(bilan.echecs[0].raison, /lecture seule/);
    } finally {
      await fs.chmod(b.cartes, 0o755);
    }
  } finally {
    await fs.rm(b.root, { recursive: true, force: true });
  }
});
test("disque débranché, original déplacé, puis retrouvé par son empreinte", async () => {
  const b = await banc();
  try {
    const a = await b.photo("A.CR3", "raw-a", { stars: 5 });
    const c = await b.photo("C.CR3", "raw-c", { stars: 5 });
    b.origins[a.id] = "/Volumes/Juno-Carte-Absente-7f3/DCIM/A.CR3";
    await fs.rename(path.join(b.cartes, "C.CR3"), path.join(b.root, "C.CR3"));
    const plan = await b.api["lightroom-plan"]({ items: [a, c], options: {} });
    assert.deepEqual(plan.lignes.map((l) => l.etat), ["disque-absent", "absent"]);
    assert.deepEqual(plan.disques, ["Juno-Carte-Absente-7f3"]);
    // Le dossier rangé ailleurs : même nom, autre contenu pour l'un (piège).
    const range = path.join(b.root, "archives", "2026", "mariage");
    await fs.mkdir(range, { recursive: true });
    await fs.writeFile(path.join(range, "A.CR3"), "raw-a");
    await fs.writeFile(path.join(range, "C.CR3"), "raw-X");
    b.choisir([path.join(b.root, "archives")]);
    assert.deepEqual(await b.api["lightroom-locate"]([a, c]), { trouves: 1, cherches: 2 });
    assert.equal(b.origins[a.id], path.join(range, "A.CR3"));
  } finally {
    await fs.rm(b.root, { recursive: true, force: true });
  }
});
test("dossier prêt pour Lightroom : copies vérifiées, .xmp neufs, noms en double départagés", async () => {
  const b = await banc();
  try {
    const a = await b.photo("A.CR3", "raw-a", { stars: 5, status: "keep" });
    const a2 = await b.photo("B.CR3", "raw-b", { stars: 2 });
    a2.name = "A.CR3";
    const j = await b.photo("J.jpg", "jpg", { stars: 4 });
    const dest = path.join(b.root, "livraison");
    await fs.mkdir(dest);
    b.choisir([dest]);
    const r = await b.api["lightroom-folder"]({ items: [a, a2, j], options: {} });
    assert.equal(r.copies, 3);
    const f = (await fs.readdir(r.dossier)).sort();
    assert.deepEqual(f, ["A (2).CR3", "A (2).xmp", "A.CR3", "A.xmp", "J.jpg"]);
    assert.equal(lire(await fs.readFile(path.join(r.dossier, "A (2).xmp"), "utf8")).rating, 2);
    assert.equal(await fs.readFile(path.join(r.dossier, "A (2).CR3"), "utf8"), "raw-b");
  } finally {
    await fs.rm(b.root, { recursive: true, force: true });
  }
});
