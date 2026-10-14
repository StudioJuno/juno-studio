// L'envoi du tri à Lightroom, sur la vraie application : importer des RAW,
// les noter au clavier, ouvrir « Exporter ▾ », envoyer, lire les .xmp écrits
// à côté des fichiers, puis annuler l'envoi.
//
// JUNO_RAWS : un dossier de fichiers RAW. Ils sont COPIÉS dans un dossier
// jetable avant l'import : ce contrat écrit des .xmp à côté des originaux, il
// ne doit jamais tourner sur les vrais dossiers d'un photographe.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { sortie: out, lancer } = require("./commun.cjs");
const { lire } = require("../../electron/xmp-sidecar.cjs");
const SOURCE = process.env.JUNO_RAWS;
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "juno-lr-profil-"));
  const carte = await fs.mkdtemp(path.join(os.tmpdir(), "juno-lr-carte-"));
  const raws = (await fs.readdir(SOURCE)).filter((f) => /\.(cr3|cr2|nef|arw|raf)$/i.test(f)).sort().slice(0, 3);
  for (const f of raws) await fs.copyFile(path.join(SOURCE, f), path.join(carte, f));
  // Le troisième a déjà un .xmp noté par Aftershoot, avec des réglages.
  const aft = await fs.readFile(path.join(__dirname, "..", "fixtures", "xmp", "aftershoot-note.xmp"), "utf8");
  const xmpDe = (f) => path.join(carte, path.basename(f, path.extname(f)) + ".xmp");
  await fs.writeFile(xmpDe(raws[2]), aft);
  const app = await lancer(profile);
  const page = await app.firstWindow();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  const rapport = { erreurs, etapes: {} };
  const compter = () => page.evaluate(async (noms) => {
    const db = await new Promise((r, j) => { const q = indexedDB.open("juno-studio-v1"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const tout = await new Promise((r) => { const q = db.transaction("photos", "readonly").objectStore("photos").getAll(); q.onsuccess = () => r(q.result); });
    return tout.filter((p) => noms.includes(p.name)).map((p) => ({ nom: p.name, etoiles: p.stars, statut: p.status }));
  }, raws).catch(() => []);
  try {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.getByRole("combobox", { name: "Thème de Juno" }).waitFor({ timeout: 90000 });
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f }); }, raws.map((f) => path.join(carte, f)));
    await page.getByRole("button", { name: /^Importer/ }).first().click();
    for (let i = 0; i < 180 && (await compter()).length < raws.length; i++) await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Fermer l’activité" }).click().catch(() => {});
    // Noter au clavier dans l'éditeur, comme le fait un photographe.
    await page.getByRole("button", { name: "Retoucher", exact: true }).click();
    await page.waitForTimeout(1500);
    const notes = { [raws[0]]: ["5", "p"], [raws[1]]: ["2", "x"], [raws[2]]: ["4", "p"] };
    for (const f of raws) {
      await page.getByRole("button", { name: "Ouvrir " + f, exact: true }).click();
      await page.waitForTimeout(800);
      await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
      for (const k of notes[f]) await page.keyboard.press(k);
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(1500);
    rapport.notes = await compter();
    // Le menu « Exporter ▾ ».
    await page.getByRole("button", { name: /^Exporter/ }).first().click();
    await page.getByRole("menuitem", { name: /Envoyer le tri à Lightroom/ }).click();
    await page.locator(".lightroom-etat").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    rapport.bilan = await page.locator(".lightroom-bilan").innerText();
    await page.screenshot({ path: out + "/lightroom-bilan.png" });
    await page.getByRole("button", { name: /^Envoyer à Lightroom/ }).click();
    await page.getByText(/prêtes pour Lightroom/).first().waitFor({ timeout: 30000 });
    rapport.resultat = await page.locator(".modal-intro").first().innerText();
    await page.screenshot({ path: out + "/lightroom-envoye.png" });
    rapport.xmp = {};
    for (const f of raws) {
      const t = await fs.readFile(xmpDe(f), "utf8").catch(() => null);
      rapport.xmp[f] = t ? { ...lire(t), crsIntact: t.includes('crs:CropAngle="-1.2"') } : null;
    }
    rapport.originauxIntacts = [];
    for (const f of raws)
      rapport.originauxIntacts.push(Buffer.compare(await fs.readFile(path.join(carte, f)), await fs.readFile(path.join(SOURCE, f))) === 0);
    await page.getByRole("button", { name: /Annuler l’envoi/ }).click();
    await page.waitForTimeout(2500);
    rapport.apresAnnulation = {};
    for (const f of raws) rapport.apresAnnulation[f] = await fs.readFile(xmpDe(f), "utf8").then((t) => (t === aft ? "comme avant" : "modifié"), () => "absent");
  } catch (e) { rapport.echec = String(e.message || e).slice(0, 400); }
  finally {
    await fs.writeFile(out + "/verif-lightroom.json", JSON.stringify(rapport, null, 2));
    console.log(JSON.stringify(rapport, null, 2));
    const m = [];
    const x = rapport.xmp || {};
    const [a, b, c] = raws.map((f) => x[f]);
    if (!a || a.rating !== 5 || a.label !== "Vert" || !a.keywords.includes("Juno|Tri|Gardée")) m.push("5 étoiles gardée : " + JSON.stringify(a));
    if (!b || b.rating !== undefined || !b.keywords.includes("Juno|Tri|Écartée")) m.push("écartée : " + JSON.stringify(b));
    // La note d'Aftershoot (5, Vert) est gardée, les réglages aussi.
    if (!c || c.rating !== 5 || c.label !== "Vert" || !c.crsIntact || !c.keywords.includes("Juno|Tri|Gardée")) m.push("sidecar Aftershoot : " + JSON.stringify(c));
    if (!(rapport.originauxIntacts || []).every(Boolean)) m.push("un original a changé");
    const ap = rapport.apresAnnulation || {};
    if (ap[raws[0]] !== "absent" || ap[raws[1]] !== "absent" || ap[raws[2]] !== "comme avant") m.push("annulation : " + JSON.stringify(ap));
    if (rapport.echec) m.push(rapport.echec);
    if (erreurs.length) m.push("erreurs : " + erreurs[0]);
    if (m.length) { console.error("LIGHTROOM KO : " + m.join(" ; ")); process.exitCode = 1; }
    else console.log("LIGHTROOM OK");
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
    await fs.rm(carte, { recursive: true, force: true, maxRetries: 5 });
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
