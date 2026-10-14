// Le parcours réel : importer un rush où l'on applaudit à 8 s, lancer
// l'analyse, vérifier que le moment est trouvé, puis l'assembler et
// contrôler que le plan monté commence avant le pic.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { racine: root, sortie: out, lancer } = require("./commun.cjs");
const FILM = process.env.JUNO_FILM;
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "juno-mom-"));
  const app = await lancer(profile);
  const page = await app.firstWindow();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") erreurs.push(m.text().slice(0, 200)); });
  const rapport = { erreurs, etapes: {} };
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.getByRole("combobox", { name: "Thème de Juno" }).waitFor({ timeout: 90000 });
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, FILM);
    await page.getByRole("button", { name: "Montage", exact: true }).click();
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: /^Importer/ }).first().click();
    await page.waitForTimeout(6000);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Bibliothèque", exact: true }).click().catch(() => {});
    await page.getByRole("button", { name: /^Ajouter discours-applaudi/ }).waitFor({ timeout: 180000 });
    rapport.etapes.importe = true;
    const projet = () => page.evaluate(async () => {
      const l = await window.juno.video.list();
      return window.juno.video.project(l.projects[0].id);
    });
    // Lancer l'analyse depuis le vrai bouton.
    await page.getByRole("button", { name: /^Analyser scènes, silences/ }).click();
    for (let i = 0; i < 240; i++) {
      await page.waitForTimeout(500);
      const p = await projet();
      const a = p.assets.find((x) => x.name.startsWith("discours-applaudi"));
      if (a?.analysis) { rapport.analyse = a.analysis; rapport.duree = a.duration; break; }
    }
    rapport.etapes.analyse = !!rapport.analyse;
    await page.keyboard.press("Escape");
    // « Bibliothèque » est une bascule : ne l'ouvrir que si elle est fermée.
    await page.waitForTimeout(1000);
    if (!(await page.getByPlaceholder("Rechercher un média…").isVisible().catch(() => false)))
      await page.getByRole("button", { name: "Bibliothèque", exact: true }).click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out + "/01-bibliotheque.png" });
    const bouton = page.getByRole("button", { name: /moments? forts? · assembler/ });
    rapport.etapes.bouton = (await bouton.count()) > 0;
    if (rapport.etapes.bouton) {
      rapport.libelle = await bouton.first().innerText();
      await bouton.first().click();
      await page.waitForTimeout(3000);
      const p = await projet();
      const s = p.sequences.at(-1);
      rapport.plans = s.clips
        .filter((c) => c.component !== "audio" && c.track < 10)
        .map((c) => ({ debut: c.inUs / 1e6, duree: Math.round((c.duration / (s.fps.n / s.fps.d)) * 100) / 100 }));
    }
    await page.screenshot({ path: out + "/02-assemble.png" });
  } catch (e) { rapport.echec = String(e.message || e).slice(0, 400); }
  finally {
    await fs.writeFile(out + "/verif-moments.json", JSON.stringify(rapport, null, 2));
    console.log(JSON.stringify(rapport, null, 2));
    const m = rapport.analyse?.moments || [];
    const manques = [];
    if (m.length !== 1) manques.push(`${m.length} moment(s) trouvé(s) au lieu d'un`);
    else if (Math.abs(m[0].start - 8) > 0.6) manques.push("moment mal placé : " + m[0].start);
    if (!rapport.etapes.bouton) manques.push("bouton « moments forts » absent");
    const plan = rapport.plans?.[0];
    if (!plan) manques.push("aucun plan monté");
    else if (!(plan.debut < 8 - 1.5 && plan.debut > 8 - 4)) manques.push("le plan ne commence pas avant le pic : " + plan.debut);
    if (!(rapport.analyse?.silences?.length >= 0)) manques.push("les silences ont disparu de l'analyse");
    if (erreurs.filter((e) => !e.includes("XNNPACK")).length) manques.push("erreurs : " + erreurs[0]);
    if (manques.length) { console.error("MOMENTS KO : " + manques.join(" ; ")); process.exitCode = 1; }
    else console.log("MOMENTS OK");
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
