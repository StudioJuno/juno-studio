// Le redressement, sur la vraie application : l'inclinaison mesurée à
// l'import, posée par « Préparer l'album » quand les lignes sont sûres,
// proposée sinon, et le bouton « Redresser » de l'éditeur.
//
// JUNO_PHOTOS : le dossier des photos. JUNO_ATTENDU : un fichier JSON
// { "nom.jpg": { "tier": "auto", "angle": 2 } } ; sans lui, les trois façades
// fabriquées par test-modeles.mjs. JUNO_TOLERANCE : l'écart d'angle admis.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { sortie: out, lancer } = require("./commun.cjs");
const PHOTOS = process.env.JUNO_PHOTOS;
const TOLERANCE = Number(process.env.JUNO_TOLERANCE || 0.2);
(async () => {
  const attendu = process.env.JUNO_ATTENDU
    ? JSON.parse(await fs.readFile(process.env.JUNO_ATTENDU, "utf8"))
    : {
        "facade-2.jpg": { tier: "auto", angle: 2 },
        "facade-0.jpg": { tier: "level", angle: 0 },
        "facade-7.jpg": { tier: "suggest", angle: 7 },
      };
  const noms = Object.keys(attendu);
  const fichiers = noms.map((n) => path.join(PHOTOS, n));
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "juno-niveau-"));
  const app = await lancer(profile);
  const page = await app.firstWindow();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  const rapport = { erreurs, etapes: {}, photos: {}, bandeaux: [] };
  // Seulement nos photos : un profil neuf contient aussi le projet de démonstration.
  const lire = () => page.evaluate(async (noms) => {
    const db = await new Promise((r, j) => { const q = indexedDB.open("juno-studio-v1"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const tout = await new Promise((r) => { const q = db.transaction("photos", "readonly").objectStore("photos").getAll(); q.onsuccess = () => r(q.result); });
    return tout.filter((p) => noms.includes(p.name))
      .map((p) => ({ nom: p.name, level: p.analysis?.level, straighten: p.adjustments?.straighten, retouchee: !!p.proposal }));
  }, noms).catch(() => []);
  const photo = async (nom) => (await lire()).find((p) => p.nom === nom);
  const guet = setInterval(async () => {
    const t = await page.locator(".toast").innerText().catch(() => "");
    if (t && !rapport.bandeaux.includes(t)) rapport.bandeaux.push(t);
  }, 250);
  /**
   * Les coins de l'aperçu. Un coin laissé vide par le redressement sort
   * transparent : on le lit à 0, et tout pixel opaque au-dessus, même noir.
   */
  const coins = () => page.evaluate(() => {
    const c = [...document.querySelectorAll("canvas")]
      .filter((x) => x.width > 100 && !x.className.includes("overlay"))
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!c) return null;
    const t = document.createElement("canvas");
    t.width = c.width; t.height = c.height;
    const g = t.getContext("2d"); g.drawImage(c, 0, 0);
    const lum = (fx, fy) => { const d = g.getImageData(Math.round(fx * (c.width - 1)), Math.round(fy * (c.height - 1)), 1, 1).data; return d[3] < 250 ? 0 : Math.max(4, (d[0] + d[1] + d[2]) / 3); };
    return Math.min(lum(0.005, 0.005), lum(0.995, 0.005), lum(0.005, 0.995), lum(0.995, 0.995));
  }).catch(() => null);
  const ouvrir = async (nom) => {
    await page.getByRole("button", { name: "Ouvrir " + nom, exact: true }).click();
    await page.waitForTimeout(2500);
  };
  try {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.getByRole("combobox", { name: "Thème de Juno" }).waitFor({ timeout: 90000 });
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f }); }, fichiers);
    await page.getByRole("button", { name: /^Importer/ }).first().click();
    for (let i = 0; i < 300; i++) {
      const p = await lire();
      if (p.length === noms.length && p.every((x) => x.level)) break;
      await page.waitForTimeout(1000);
    }
    // 1. La mesure faite à l'import.
    for (const p of await lire()) rapport.photos[p.nom] = { mesure: p.level };
    rapport.etapes.mesuree = noms.every((n) => rapport.photos[n]?.mesure?.version);
    // 2. La passe d'album : seul le palier sûr est posé.
    await page.getByRole("button", { name: "Fermer l’activité" }).click().catch(() => {});
    await page.getByRole("button", { name: /Préparer l’album/ }).first().click();
    for (let i = 0; i < 900; i++) {
      await page.waitForTimeout(1000);
      if ((await lire()).filter((p) => p.retouchee).length === noms.length) break;
    }
    for (const p of await lire()) rapport.photos[p.nom].apresAlbum = p.straighten ?? null;
    // 3. L'éditeur.
    await page.getByRole("button", { name: "Fermer l’activité" }).click().catch(() => {});
    await page.getByRole("button", { name: "Retoucher", exact: true }).click();
    await page.waitForTimeout(2000);
    const proposee = noms.find((n) => rapport.photos[n]?.mesure?.tier === "suggest");
    if (proposee) {
      await ouvrir(proposee);
      const chip = page.locator(".level-suggestion");
      rapport.etapes.propositionAffichee = await chip.innerText().catch(() => "");
      await page.screenshot({ path: out + "/redressement-proposition.png" });
      await chip.click().catch(() => {});
      await page.waitForTimeout(6000);
      rapport.photos[proposee].apresProposition = (await photo(proposee))?.straighten ?? null;
      rapport.etapes.curseur = await page.getByRole("textbox", { name: "Redressement : valeur" }).inputValue().catch(() => "");
      rapport.etapes.coinsProposition = await coins();
      await page.screenshot({ path: out + "/redressement-applique.png" });
    }
    for (const n of noms.filter((n) => ["level", "abstain"].includes(rapport.photos[n]?.mesure?.tier)).slice(0, 2)) {
      await ouvrir(n);
      // Attendre que le bandeau précédent s'efface : deux photos sans lignes
      // affichent le même message, qu'on ne distinguerait pas sinon.
      await page.locator(".toast").waitFor({ state: "detached", timeout: 9000 }).catch(() => {});
      await page.getByRole("button", { name: "Redresser", exact: true }).click();
      rapport.photos[n].bouton = await page.locator(".toast").innerText({ timeout: 4000 }).catch(() => "");
    }
    const sure = noms.find((n) => rapport.photos[n]?.mesure?.tier === "auto");
    if (sure) {
      await ouvrir(sure);
      await page.waitForTimeout(5000);
      rapport.etapes.coinsAuto = await coins();
      await page.screenshot({ path: out + "/redressement-auto.png" });
    }
  } catch (e) { rapport.echec = String(e.message || e).slice(0, 400); }
  finally {
    clearInterval(guet);
    await fs.writeFile(out + "/verif-redressement.json", JSON.stringify(rapport, null, 2));
    console.log(JSON.stringify(rapport, null, 2));
    const manques = [];
    const correction = (m) => Math.round(-m.angle * 100) / 100;
    for (const [nom, a] of Object.entries(attendu)) {
      const r = rapport.photos[nom], m = r?.mesure;
      if (!m) { manques.push(nom + " : pas de mesure"); continue; }
      if (m.tier !== a.tier) manques.push(`${nom} : palier ${m.tier}, attendu ${a.tier}`);
      if (a.angle !== undefined && m.angle !== null && Math.abs(m.angle - a.angle) > TOLERANCE)
        manques.push(`${nom} : ${m.angle.toFixed(2)}°, attendu ${a.angle}°`);
      // La passe d'album ne pose que le palier sûr.
      if (m.tier === "auto" && r.apresAlbum !== correction(m)) manques.push(`${nom} : l'album a posé ${r.apresAlbum}, attendu ${correction(m)}`);
      if (m.tier !== "auto" && r.apresAlbum) manques.push(`${nom} : l'album a redressé une photo du palier ${m.tier}`);
      if (m.tier === "suggest" && "apresProposition" in r && r.apresProposition !== correction(m))
        manques.push(`${nom} : la proposition a posé ${r.apresProposition}`);
      if (m.tier === "level" && "bouton" in r && !/déjà droite/.test(r.bouton)) manques.push(`${nom} : bouton → « ${r.bouton} »`);
      if (m.tier === "abstain" && "bouton" in r && !/Pas assez de lignes/.test(r.bouton)) manques.push(`${nom} : bouton → « ${r.bouton} »`);
    }
    if (Object.values(rapport.photos).some((p) => p.mesure?.tier === "suggest") && !/Redresser de/.test(rapport.etapes.propositionAffichee || ""))
      manques.push("la proposition n'est pas affichée");
    for (const k of ["coinsProposition", "coinsAuto"])
      if (k in rapport.etapes && !(rapport.etapes[k] > 3)) manques.push(`coin noir dans l'aperçu (${k} : ${rapport.etapes[k]})`);
    if (rapport.echec) manques.push(rapport.echec);
    if (erreurs.length) manques.push("erreurs : " + erreurs[0]);
    if (manques.length) { console.error("REDRESSEMENT KO : " + manques.join(" ; ")); process.exitCode = 1; }
    else console.log("REDRESSEMENT OK");
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
