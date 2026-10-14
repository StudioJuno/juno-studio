// Le parcours réel : importer un plan 16/9 où la mariée est à droite, monter
// une séquence verticale, cliquer « Recadrer », puis livrer et mesurer les
// bandes noires sur l'image livrée.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { execFileSync } = require("node:child_process");
const { racine: root, sortie: out, lancer } = require("./commun.cjs");
const FILM = process.env.JUNO_FILM;
const SORTIE = path.join(os.tmpdir(), "juno-recadrage-" + Date.now() + ".mp4");
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "juno-rec-"));
  const app = await lancer(profile);
  const page = await app.firstWindow();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(e.message));
  const journal = [];
  page.on("console", (m) => {
    if (m.type() === "error") erreurs.push(m.text().slice(0, 200));
    if (m.text().includes("[juno-diag]")) journal.push(m.text().slice(0, 300));
  });
  const rapport = { erreurs, journal, etapes: {} };
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.getByRole("combobox", { name: "Thème de Juno" }).waitFor({ timeout: 90000 });
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, FILM);
    await app.evaluate(({ dialog }, d) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: d });
    }, SORTIE);
    await page.getByRole("button", { name: "Montage", exact: true }).click();
    await page.waitForTimeout(2500);
    rapport.etapes.montage = true;
    // 1. Importer le plan 16/9.
    await page.getByRole("button", { name: /^Importer/ }).first().click();
    await page.waitForTimeout(6000);
    rapport.apresImport = await page.evaluate(async () => {
      const l = await window.juno.video.list();
      return { projets: l.projects?.length, jobs: (l.jobs || []).map((j) => ({
        kind: j.kind, state: j.state, stage: j.stage, error: j.error })) };
    }).catch((e) => String(e));
    // Le panneau d'activité s'ouvre par-dessus la bibliothèque.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Bibliothèque", exact: true }).click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: out + "/01b-apres-import.png" });
    rapport.ecran = (await page.locator("body").innerText()).slice(0, 900);
    rapport.boutonsAjouter = await page
      .getByRole("button", { name: /^Ajouter / })
      .allInnerTexts()
      .catch(() => []);
    rapport.mediasVisibles = await page.locator(".vf-media").count().catch(() => -1);
    const ajouter = page.getByRole("button", { name: /^Ajouter mariee-droite/ });
    await ajouter.waitFor({ timeout: 180000 });
    rapport.etapes.importe = true;
    // 2. Le poser sur la timeline.
    await ajouter.click();
    await page.waitForTimeout(2500);
    const lire = () => page.evaluate(async () => {
      const l = await window.juno.video.list();
      const p = await window.juno.video.project(l.projects[0].id);
      const s = p.sequences.at(-1);
      return { projectId: p.id, sequenceId: s.id, w: s.width, h: s.height,
        clips: s.clips.map((c) => ({ id: c.id, scale: c.scale, x: c.x, y: c.y,
          reframe: c.reframe, cles: (c.animation?.x || []).length })),
        asset: p.assets.map((a) => ({ id: a.id, w: a.width, h: a.height, kind: a.kind })) };
    });
    // Livrer la séquence courante et attendre le fichier.
    const livrer = async (chemin) => {
      await app.evaluate(({ dialog }, d) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: d });
      }, chemin);
      return page.evaluate(async () => {
        const l = await window.juno.video.list();
        const p = await window.juno.video.project(l.projects[0].id);
        const s = p.sequences.at(-1);
        await window.juno.video.export({ projectId: p.id, sequence: s, codec: "h264" });
        for (let i = 0; i < 600; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const j = (await window.juno.video.list()).jobs.filter((j) => j.kind === "export").at(-1);
          if (j?.state === "done") return { ok: true };
          if (j?.state === "failed") return { ok: false, erreur: j.error };
        }
        return { ok: false, erreur: "délai" };
      });
    };
    rapport.avantVertical = await lire();
    // 3. Basculer en vertical.
    await page.getByRole("button", { name: "Version verticale" }).click();
    await page.waitForTimeout(3000);
    rapport.avant = await lire();
    await page.screenshot({ path: out + "/02-vertical-avant.png" });
    // L'export exige un profil couleur confirmé.
    rapport.profil = await page.evaluate(async () => {
      const l = await window.juno.video.list();
      const p = await window.juno.video.project(l.projects[0].id);
      const a = p.assets[0];
      await window.juno.video.space({ projectId: p.id, assetId: a.id, inputSpace: a.inputSpace });
      for (let i = 0; i < 240; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const q = await window.juno.video.project(p.id);
        if (q.assets[0].spaceConfirmed) return { ok: true, espace: a.inputSpace };
      }
      return { ok: false };
    });
    rapport.livraisonAvant = await livrer(SORTIE.replace(".mp4", "-avant.mp4"));
    // 4. Recadrer.
    const bouton = page.getByRole("button", { name: /^Recadrer/ });
    rapport.etapes.boutonActif = await bouton.isEnabled();
    // Le bandeau s'efface tout seul : le relever en continu.
    rapport.bandeaux = [];
    const guet = setInterval(async () => {
      const t = await page.locator(".toast").innerText().catch(() => "");
      if (t && !rapport.bandeaux.includes(t)) rapport.bandeaux.push(t);
      const b = await bouton.innerText().catch(() => "");
      if (b && !rapport.bandeaux.includes("bouton: " + b)) rapport.bandeaux.push("bouton: " + b);
    }, 400);
    const t0 = Date.now();
    await bouton.click();
    for (let i = 0; i < 240; i++) {
      await page.waitForTimeout(1000);
      const etat = await lire();
      if (etat.clips.some((c) => c.reframe)) { rapport.apres = etat; break; }
    }
    rapport.dureeRecadrage_s = Math.round((Date.now() - t0) / 100) / 10;
    await page.waitForTimeout(1500);
    clearInterval(guet);
    rapport.apres = rapport.apres || (await lire());
    rapport.bandeau = await page.locator(".toast").innerText().catch(() => "");
    await page.screenshot({ path: out + "/03-vertical-apres.png" });
    rapport.livraisonApres = await livrer(SORTIE.replace(".mp4", "-apres.mp4"));
    // Seconde phase : une retouche à la main ne doit plus être écrasée par un
    // second clic sur « Recadrer ». C'était le cas : tout repassait sur le couple.
    // L'export ouvre le panneau d'activité par-dessus l'inspecteur, et Échap
    // ne le ferme pas.
    await page.getByRole("button", { name: "Fermer l’activité" }).click().catch(() => {});
    await page.waitForTimeout(600);
    await page.locator(".vf-clip:not(.audio)").first().click().catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: out + "/04-retouche-main.png" });
    const echelle = page.getByLabel("Échelle : valeur");
    if (await echelle.isVisible().catch(() => false)) {
      await echelle.fill("4.2");
      await echelle.press("Enter");
      await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
      await page.waitForTimeout(1500);
      rapport.retouche = (await lire()).clips[0];
      // Tous les plans réglés à la main : le bouton n'a plus rien à faire et
      // se désactive. S'il reste actif, son clic ne doit rien défaire.
      rapport.boutonApresRetouche = (await bouton.isEnabled()) ? "actif" : "inactif";
      if (rapport.boutonApresRetouche === "actif") {
        await bouton.click();
        await page.waitForTimeout(4000);
      }
      rapport.apresSecondClic = (await lire()).clips[0];
    } else rapport.retouche = "champ Échelle introuvable";
  } catch (e) { rapport.echec = String(e.message || e).slice(0, 400); }
  finally {
    const FF = path.join(root, "native/darwin-x64/ffmpeg");
    const mesurer = async (fichier, image) => {
      try {
        await fs.access(fichier);
        execFileSync(FF, ["-y", "-v", "error", "-ss", "2", "-i", fichier, "-frames:v", "1", image]);
        // Luminance moyenne de bandes fines au bord : une bande noire de
        // mise au format tombe près de 16 (noir vidéo) ou 0.
        const bande = (x, y, w, h) => Number(execFileSync(FF, ["-v", "error", "-i", image, "-vf",
          `crop=${w}:${h}:${x}:${y},scale=1:1,format=gray`, "-f", "rawvideo", "-"])[0]);
        const dims = execFileSync(FF.replace("ffmpeg", "ffprobe"), ["-v", "error", "-select_streams", "v:0",
          "-show_entries", "stream=width,height", "-of", "csv=p=0", fichier]).toString().trim().split(",").map(Number);
        const [W, H] = dims, e = Math.round(H * 0.06);
        return { taille: `${W}x${H}`, haut: bande(0, 0, W, e), bas: bande(0, H - e, W, e),
          gauche: bande(0, 0, Math.round(W * 0.06), H), droite: bande(W - Math.round(W * 0.06), 0, Math.round(W * 0.06), H),
          centre: bande(Math.round(W * 0.3), Math.round(H * 0.3), Math.round(W * 0.4), Math.round(H * 0.4)) };
      } catch (err) { return { erreur: String(err.message || err).slice(0, 200) }; }
    };
    rapport.mesureAvant = await mesurer(SORTIE.replace(".mp4", "-avant.mp4"), out + "/livre-avant.png");
    rapport.mesureApres = await mesurer(SORTIE.replace(".mp4", "-apres.mp4"), out + "/livre-apres.png");
    await fs.writeFile(out + "/verif-recadrage.json", JSON.stringify(rapport, null, 2));
    // Ce qui doit tenir, sinon le script sort en erreur au lieu de rapporter
    // une panne sans la signaler.
    const a = rapport.mesureAvant || {}, b = rapport.mesureApres || {};
    const clip = rapport.apres?.clips?.[0] || {};
    const manques = [];
    if (!clip.reframe) manques.push("aucun cadrage posé sur le plan");
    if (!(clip.scale > 1.5)) manques.push("le plan n'a pas été zoomé");
    if (!(clip.x < -0.3)) manques.push("le cadre n'est pas allé chercher la mariée à droite");
    if (!(a.haut <= 20 && a.bas <= 20)) manques.push("le témoin « avant » n'a pas de bandes noires : mesure douteuse");
    for (const bord of ["haut", "bas", "gauche", "droite"])
      if (!(b[bord] > 20)) manques.push("bande noire en " + bord + " après recadrage");
    if (!(b.centre > a.centre + 40)) manques.push("le centre du cadre ne montre pas la mariée");
    const r = rapport.retouche, r2 = rapport.apresSecondClic;
    if (typeof r !== "object" || r.reframe !== "main" || Math.abs(r.scale - 4.2) > 0.01)
      manques.push("une retouche à la main n'a pas passé le plan en « Réglé à la main » : " + JSON.stringify(r));
    else if (!r2 || Math.abs(r2.scale - 4.2) > 0.01 || r2.reframe !== "main")
      manques.push("un second « Recadrer » a écrasé la retouche : " + JSON.stringify(r2));
    const vraies = erreurs.filter((e) => !e.includes("XNNPACK"));
    if (vraies.length) manques.push("erreurs : " + vraies[0]);
    if (manques.length) { console.error("RECADRAGE KO : " + manques.join(" ; ")); process.exitCode = 1; }
    else console.log("RECADRAGE OK");
    console.log(JSON.stringify(rapport, null, 2));
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
})().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
