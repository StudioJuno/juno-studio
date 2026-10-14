// Sur le paquet livré : l'IA locale n'est plus embarquée. Le pilote doit la
// proposer, la télécharger depuis l'adresse figée, la vérifier, puis comprendre
// une formulation libre que le lecteur de consignes refuse.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { sortie: out, lancer } = require("./commun.cjs");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "juno-ia-"));
  const app = await lancer(profile);
  const page = await app.firstWindow();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  const rapport = { erreurs, etapes: {} };
  try {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.getByRole("combobox", { name: "Thème de Juno" }).waitFor({ timeout: 90000 });
    rapport.avant = await page.evaluate(() => window.juno.planner.status());
    // Ouvrir le pilote et son aide.
    await page.getByRole("button", { name: /Demander à Juno/ }).click();
    await page.getByText("Exemples et fonctionnement").click();
    const installer = page.getByRole("button", { name: "Installer l’IA locale" });
    rapport.etapes.proposee = await installer.isVisible().catch(() => false);
    rapport.texteAide = await page.locator(".pilot-model").innerText().catch(() => "");
    await page.screenshot({ path: out + "/ia-01-proposee.png" });
    // Installer pour de bon.
    const t0 = Date.now();
    await installer.click();
    await page.waitForTimeout(4000);
    rapport.pendant = await page.locator(".pilot-model").innerText().catch(() => "");
    await page.screenshot({ path: out + "/ia-02-telechargement.png" });
    let s;
    for (let i = 0; i < 1800; i++) {
      await page.waitForTimeout(1000);
      s = await page.evaluate(() => window.juno.planner.status());
      if (s.source === "telecharge" || s.installation?.erreur) break;
    }
    rapport.apres = s;
    rapport.dureeTelechargement_s = Math.round((Date.now() - t0) / 1000);
    await page.screenshot({ path: out + "/ia-03-installee.png" });
    // Une formulation libre, que le lecteur seul refuse.
    if (s?.source === "telecharge") {
      const champ = page.getByLabel("Votre consigne à Juno");
      await champ.fill("rends-la un peu plus chaude, façon coucher de soleil");
      await champ.press("Enter");
      const t1 = Date.now();
      for (let i = 0; i < 120; i++) {
        await page.waitForTimeout(1000);
        const m = await page.locator(".pilot-panel").innerText().catch(() => "");
        if (/Proposition préparée|Précisez|Chaleur|chaleur à/i.test(m) && !/prépare les commandes/.test(m)) {
          rapport.reponse = m.slice(0, 900);
          break;
        }
      }
      rapport.dureeReponse_s = Math.round((Date.now() - t1) / 1000);
      await page.screenshot({ path: out + "/ia-04-reponse.png" });
    }
  } catch (e) { rapport.echec = String(e.message || e).slice(0, 400); }
  finally {
    await fs.writeFile(out + "/verif-installation-ia.json", JSON.stringify(rapport, null, 2));
    console.log(JSON.stringify(rapport, null, 2));
    const manques = [];
    if (rapport.avant?.available) manques.push("le modèle était déjà là : ce n'est pas le paquet allégé");
    if (!rapport.etapes.proposee) manques.push("l'installation n'est pas proposée");
    if (rapport.apres?.source !== "telecharge") manques.push("installation non aboutie : " + (rapport.apres?.installation?.erreur || "?"));
    if (!rapport.reponse) manques.push("aucune réponse du modèle à une formulation libre");
    if (erreurs.length) manques.push("erreurs : " + erreurs[0]);
    if (manques.length) { console.error("INSTALLATION IA KO : " + manques.join(" ; ")); process.exitCode = 1; }
    else console.log("INSTALLATION IA OK");
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
