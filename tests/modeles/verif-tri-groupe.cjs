// Le tri photo voit-il les visages d'une photo de groupe ? Avant la 1.1.0, il
// les cherchait sur une vignette de 480 px et n'en trouvait presque aucun.
// Parcours réel : importer une photo de groupe et un portrait, lancer
// « Préparer l'album », lire l'analyse enregistrée dans le catalogue.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { sortie: out, lancer } = require("./commun.cjs");
const PHOTOS = process.env.JUNO_PHOTOS;
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "juno-tri-"));
  const fichiers = ["groupe.jpg", "portrait.jpg"].map((f) => path.join(PHOTOS, f));
  const app = await lancer(profile);
  const page = await app.firstWindow();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  const rapport = { erreurs, etapes: {} };
  const lire = () => page.evaluate(async () => {
    const db = await new Promise((r, j) => { const q = indexedDB.open("juno-studio-v1"); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); });
    const tout = await new Promise((r) => { const q = db.transaction("photos", "readonly").objectStore("photos").getAll(); q.onsuccess = () => r(q.result); });
    return tout.filter((p) => ["groupe.jpg", "portrait.jpg"].includes(p.name)).map((p) => ({
      nom: p.name, version: p.analysis?.faces?.version, visages: p.analysis?.faces?.count,
      yeuxFermes: p.analysis?.faces?.closedEyes, verdict: p.analysis?.verdict,
      // La netteté indépendante de la taille (1.2.1), du plus grand visage au plus petit.
      nettete: (p.analysis?.faces?.reads || []).slice().sort((a, b) => b.region.w - a.region.w).map((r) => r.nettete ?? null),
      raisons: p.analysis?.reasons,
    }));
  }).catch(() => []);
  try {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.getByRole("combobox", { name: "Thème de Juno" }).waitFor({ timeout: 90000 });
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f }); }, fichiers);
    await page.getByRole("button", { name: /^Importer/ }).first().click();
    for (let i = 0; i < 120 && (await lire()).length < 2; i++) await page.waitForTimeout(1000);
    rapport.etapes.importe = (await lire()).length === 2;
    await page.getByRole("button", { name: "Fermer l’activité" }).click().catch(() => {});
    await page.getByRole("button", { name: /Préparer l’album/ }).first().click();
    for (let i = 0; i < 600; i++) {
      await page.waitForTimeout(1000);
      const p = await lire();
      if (p.length === 2 && p.every((x) => x.version)) { rapport.photos = p; break; }
    }
    rapport.photos = rapport.photos || (await lire());
    await page.screenshot({ path: out + "/tri-groupe.png" });
  } catch (e) { rapport.echec = String(e.message || e).slice(0, 400); }
  finally {
    await fs.writeFile(out + "/verif-tri-groupe.json", JSON.stringify(rapport, null, 2));
    console.log(JSON.stringify(rapport, null, 2));
    const g = rapport.photos?.find((p) => p.nom === "groupe.jpg"), po = rapport.photos?.find((p) => p.nom === "portrait.jpg");
    const manques = [];
    if (!g || !po) manques.push("analyse absente");
    else {
      if (g.version !== "mediapipe-face-v5") manques.push("version d'analyse " + g.version);
      if (!(g.visages >= 4)) manques.push(`photo de groupe : ${g.visages} visage(s) trouvé(s) sur 5`);
      if (!(po.visages >= 1)) manques.push("le portrait n'a pas de visage");
      if (po.yeuxFermes) manques.push("yeux fermés signalés sur un portrait aux yeux ouverts");
      if (/Visage principal flou/.test(po.verdict || "")) manques.push("portrait net jugé flou : " + po.verdict);
      else if (/peut-être flou/.test(po.verdict || "")) manques.push("portrait net jugé douteux : " + po.verdict);
      // Sans ce contrôle, si la nouvelle mesure ne tournait plus (script absent,
      // mauvaise taille d'image), l'ancienne déciderait et le contrat resterait vert.
      // Les deux photos d'essai font au moins 3 000 px : la mesure doit exister.
      if (typeof po.nettete?.[0] !== "number") manques.push("netteté du portrait non mesurée");
      else if (po.nettete[0] < 0.27) manques.push(`netteté du portrait ${po.nettete[0].toFixed(3)} sous le seuil de 0,27`);
      if ((g.nettete || []).filter((v) => typeof v === "number").length < 4)
        manques.push(`netteté mesurée sur ${(g.nettete || []).filter((v) => typeof v === "number").length} visage(s) du groupe sur 5`);
    }
    if (erreurs.length) manques.push("erreurs : " + erreurs[0]);
    if (manques.length) { console.error("TRI KO : " + manques.join(" ; ")); process.exitCode = 1; }
    else console.log("TRI OK");
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
