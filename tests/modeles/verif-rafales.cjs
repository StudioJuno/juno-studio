// Le tri reconnaît-il une rafale, et n'en garde-t-il qu'une image, la plus
// nette ? Parcours réel : importer la rafale fabriquée par test-modeles.mjs
// (quatre vues à 150 ms d'écart, une seule nette), une façade 0,6 s après et
// le portrait 4 s plus tard ; lancer « Préparer l'album » ; lire le catalogue.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { sortie: out, lancer } = require("./commun.cjs");
const PHOTOS = process.env.JUNO_PHOTOS;
const RAFALE = ["rafale-1.jpg", "rafale-2.jpg", "rafale-3.jpg", "rafale-4.jpg"];
const NOMS = [...RAFALE, "facade.jpg", "plus-tard.jpg"];
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "juno-rafales-"));
  const app = await lancer(profile);
  const page = await app.firstWindow();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  const rapport = { erreurs, etapes: {} };
  const lire = () => page.evaluate(async (noms) => {
    const db = await new Promise((r, j) => { const q = indexedDB.open("juno-studio-v1"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const tout = await new Promise((r) => { const q = db.transaction("photos", "readonly").objectStore("photos").getAll(); q.onsuccess = () => r(q.result); });
    return tout.filter((p) => noms.includes(p.name)).map((p) => ({
      nom: p.name, statut: p.status, instant: p.analysis?.empreinte?.instant, version: p.analysis?.empreinte?.version,
      groupe: p.analysis?.groupId, proposee: p.analysis?.suggested, verdict: p.analysis?.verdict,
      raisons: p.analysis?.reasons, retouchee: !!p.proposal,
    }));
  }, NOMS).catch(() => []);
  try {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.getByRole("combobox", { name: "Thème de Juno" }).waitFor({ timeout: 90000 });
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f }); }, NOMS.map((n) => path.join(PHOTOS, n)));
    await page.getByRole("button", { name: /^Importer/ }).first().click();
    for (let i = 0; i < 120 && (await lire()).length < NOMS.length; i++) await page.waitForTimeout(1000);
    rapport.etapes.importe = (await lire()).length === NOMS.length;
    await page.getByRole("button", { name: "Fermer l’activité" }).click().catch(() => {});
    await page.getByRole("button", { name: /Préparer l’album/ }).first().click();
    for (let i = 0; i < 600; i++) {
      await page.waitForTimeout(1000);
      const p = await lire();
      // La passe d'album retouche chaque photo : quand toutes le sont, elle a fini.
      if (p.length === NOMS.length && p.every((x) => x.retouchee)) {
        // Laisser la passe finir d'écrire les raisons de la dernière photo.
        await page.waitForTimeout(3000);
        rapport.photos = await lire();
        break;
      }
    }
    rapport.photos = rapport.photos || (await lire());
    await page.screenshot({ path: out + "/rafales.png" });
  } catch (e) { rapport.echec = String(e.message || e).slice(0, 400); }
  finally {
    await fs.writeFile(out + "/verif-rafales.json", JSON.stringify(rapport, null, 2));
    console.log(JSON.stringify(rapport, null, 2));
    const manques = [];
    const par = new Map((rapport.photos || []).map((p) => [p.nom, p]));
    if (par.size !== NOMS.length) manques.push(`${par.size} photo(s) lue(s) sur ${NOMS.length}`);
    else {
      for (const p of par.values()) if (p.version !== "rafale-v1") manques.push(`${p.nom} : empreinte ${p.version}`);
      // L'heure au millième, lue dans l'EXIF : 150 ms entre deux vues.
      const t = RAFALE.map((n) => par.get(n).instant);
      if (!t.every((x, i) => i === 0 || x - t[i - 1] === 150)) manques.push("heures au millième : " + t.join(", "));
      const groupes = new Set(RAFALE.map((n) => par.get(n).groupe));
      if (groupes.size !== 1) manques.push(`la rafale est coupée en ${groupes.size} groupes`);
      if (groupes.has(par.get("facade.jpg").groupe)) manques.push("la façade est mise dans la rafale");
      if (groupes.has(par.get("plus-tard.jpg").groupe)) manques.push("la photo prise 4 s plus tard est mise dans la rafale");
      const proposees = RAFALE.filter((n) => par.get(n).proposee);
      if (proposees.join() !== "rafale-3.jpg") manques.push("proposée(s) dans la rafale : " + (proposees.join(", ") || "aucune"));
      if (!/^Meilleure de la rafale \(4 images\)/.test(par.get("rafale-3.jpg").verdict || "")) manques.push("verdict de la meilleure : " + par.get("rafale-3.jpg").verdict);
      // La meilleure n'est pas la première de la rafale : elle ne doit pas porter la raison des autres.
      if ((par.get("rafale-3.jpg").raisons || []).some((r) => /Autre image de la rafale/.test(r))) manques.push("la meilleure porte la raison de variante");
      const gardees = RAFALE.filter((n) => par.get(n).statut === "keep");
      if (gardees.join() !== "rafale-3.jpg") manques.push("gardée(s) dans la rafale : " + (gardees.join(", ") || "aucune"));
      for (const n of RAFALE.filter((n) => n !== "rafale-3.jpg")) {
        const p = par.get(n);
        if (!/Une autre image de la rafale est préférée/.test(p.verdict || "")) manques.push(`${n} : verdict ${p.verdict}`);
        if (!(p.raisons || []).some((r) => /Autre image de la rafale/.test(r))) manques.push(`${n} : raison de variante absente`);
      }
    }
    if (erreurs.length) manques.push("erreurs : " + erreurs[0]);
    if (manques.length) { console.error("RAFALES KO : " + manques.join(" ; ")); process.exitCode = 1; }
    else console.log("RAFALES OK");
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
