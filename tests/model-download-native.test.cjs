const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  http = require("node:http"),
  { createHash, randomBytes } = require("node:crypto");
const D = require("../electron/model-download.cjs");
const CONTENU = randomBytes(300_000);
const SHA = createHash("sha256").update(CONTENU).digest("hex");
const ASSEZ = async () => 1e15;
/**
 * Un serveur local qui sert CONTENU, avec ou sans reprise, et qui peut couper
 * la connexion en cours de route pour simuler un réseau qui lâche.
 */
async function serveur({ reprise = true, coupeA = 0, corps = CONTENU } = {}) {
  const vus = [];
  const s = http.createServer((req, res) => {
    vus.push(req.headers.range || "");
    const m = reprise && /bytes=(\d+)-/.exec(req.headers.range || "");
    const debut = m ? Number(m[1]) : 0;
    const morceau = corps.subarray(debut);
    res.writeHead(m ? 206 : 200, { "Content-Length": morceau.length });
    if (coupeA && !m) {
      // Laisser le début arriver avant de couper : un réseau qui lâche le fait
      // en cours de route, pas avant le premier octet.
      res.write(morceau.subarray(0, coupeA));
      return setTimeout(() => res.destroy(), 150);
    }
    res.end(morceau);
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${s.address().port}/m.gguf`, vus, fermer: () => new Promise((r) => s.close(r)) };
}
async function dossier() {
  return fs.mkdtemp(path.join(os.tmpdir(), "juno-dl-"));
}
const existe = (f) => fs.access(f).then(() => true, () => false);
test("un téléchargement complet et intact est mis en place", async () => {
  const srv = await serveur(), d = await dossier(), dest = path.join(d, "m.gguf");
  try {
    const etapes = [];
    await D.telecharger({ url: srv.url, destination: dest, sha256: SHA, taille: CONTENU.length,
      espaceLibre: ASSEZ, avancement: (f) => etapes.push(f) });
    assert.deepEqual(await fs.readFile(dest), CONTENU);
    assert.equal(await existe(dest + ".partiel"), false);
    assert.equal(etapes.at(-1), CONTENU.length);
  } finally { await srv.fermer(); await fs.rm(d, { recursive: true, force: true }); }
});
test("un fichier altéré n'est jamais mis en place, et il est jeté", async () => {
  const altere = Buffer.from(CONTENU); altere[1234] ^= 0xff;
  const srv = await serveur({ corps: altere }), d = await dossier(), dest = path.join(d, "m.gguf");
  try {
    await assert.rejects(
      D.telecharger({ url: srv.url, destination: dest, sha256: SHA, taille: CONTENU.length, espaceLibre: ASSEZ }),
      /ne correspond pas/,
    );
    assert.equal(await existe(dest), false);
    assert.equal(await existe(dest + ".partiel"), false);
  } finally { await srv.fermer(); await fs.rm(d, { recursive: true, force: true }); }
});
test("une coupure garde ce qui est reçu, et la relance reprend au lieu de recommencer", async () => {
  const d = await dossier(), dest = path.join(d, "m.gguf");
  const coupe = await serveur({ coupeA: 120_000 });
  try {
    await assert.rejects(
      D.telecharger({ url: coupe.url, destination: dest, sha256: SHA, taille: CONTENU.length, espaceLibre: ASSEZ }),
    );
    const garde = (await fs.stat(dest + ".partiel")).size;
    assert.ok(garde > 0 && garde < CONTENU.length, "partiel gardé : " + garde);
  } finally { await coupe.fermer(); }
  const srv = await serveur();
  try {
    const garde = (await fs.stat(dest + ".partiel")).size;
    await D.telecharger({ url: srv.url, destination: dest, sha256: SHA, taille: CONTENU.length, espaceLibre: ASSEZ });
    assert.deepEqual(await fs.readFile(dest), CONTENU);
    // La relance a demandé la suite, pas le fichier entier.
    assert.equal(srv.vus[0], `bytes=${garde}-`);
  } finally { await srv.fermer(); await fs.rm(d, { recursive: true, force: true }); }
});
test("un serveur qui ignore la reprise ne produit pas un fichier doublé", async () => {
  // Il renvoie tout le fichier : le coller derrière le début déjà reçu
  // donnerait un fichier trop long, et donc faux.
  const d = await dossier(), dest = path.join(d, "m.gguf");
  await fs.writeFile(dest + ".partiel", CONTENU.subarray(0, 50_000));
  const srv = await serveur({ reprise: false });
  try {
    await D.telecharger({ url: srv.url, destination: dest, sha256: SHA, taille: CONTENU.length, espaceLibre: ASSEZ });
    assert.deepEqual(await fs.readFile(dest), CONTENU);
  } finally { await srv.fermer(); await fs.rm(d, { recursive: true, force: true }); }
});
test("sans place sur le disque, on le dit avant de télécharger quoi que ce soit", async () => {
  const srv = await serveur(), d = await dossier(), dest = path.join(d, "m.gguf");
  try {
    await assert.rejects(
      D.telecharger({ url: srv.url, destination: dest, sha256: SHA, taille: CONTENU.length,
        espaceLibre: async () => 10 }),
      /Go libres/,
    );
    assert.equal(srv.vus.length, 0, "le serveur a été appelé quand même");
  } finally { await srv.fermer(); await fs.rm(d, { recursive: true, force: true }); }
});
test("un modèle déjà présent et intact n'est pas retéléchargé", async () => {
  const srv = await serveur(), d = await dossier(), dest = path.join(d, "m.gguf");
  await fs.writeFile(dest, CONTENU);
  try {
    const r = await D.telecharger({ url: srv.url, destination: dest, sha256: SHA, taille: CONTENU.length, espaceLibre: ASSEZ });
    assert.equal(r.deja, true);
    assert.equal(srv.vus.length, 0);
  } finally { await srv.fermer(); await fs.rm(d, { recursive: true, force: true }); }
});
test("un fichier plus gros qu'annoncé est refusé", async () => {
  const srv = await serveur({ corps: Buffer.concat([CONTENU, Buffer.alloc(10)]) });
  const d = await dossier(), dest = path.join(d, "m.gguf");
  try {
    await assert.rejects(
      D.telecharger({ url: srv.url, destination: dest, sha256: SHA, taille: CONTENU.length, espaceLibre: ASSEZ }),
      /plus gros/,
    );
    assert.equal(await existe(dest), false);
  } finally { await srv.fermer(); await fs.rm(d, { recursive: true, force: true }); }
});
