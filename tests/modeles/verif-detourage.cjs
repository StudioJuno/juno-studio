// Le parcours réel : importer une photo, ouvrir l'éditeur, choisir l'outil
// de détourage, cliquer sur la personne, et vérifier que la retouche est là.
const fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const { racine: root, sortie: out, lancer } = require("./commun.cjs");
const PHOTOS = process.env.JUNO_PHOTOS;
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "juno-det-"));
  const fichiers = (await fs.readdir(PHOTOS)).filter(f=>f.endsWith(".jpg")).sort().slice(0,3).map(f=>path.join(PHOTOS,f));
  const app = await lancer(profile);
  const page = await app.firstWindow();
  const erreurs = [];
  page.on("pageerror", e => erreurs.push(e.message));
  page.on("console", m => { if (m.type()==="error") erreurs.push(m.text().slice(0,180)); });
  const rapport = { erreurs, etapes: {} };
  try {
    await page.setViewportSize({ width: 1500, height: 1000 });
    await page.getByRole("combobox", { name: "Thème de Juno" }).waitFor({ timeout: 90000 });
    await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled:false, filePaths:f }); }, fichiers);
    await page.getByRole("button", { name: /^Importer/ }).first().click();
    for (let i=0;i<90;i++) {
      const n = await page.evaluate(async () => { try {
        const db = await new Promise((r,j)=>{const q=indexedDB.open("juno-studio-v1");q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
        return await new Promise(r=>{const q=db.transaction("photos","readonly").objectStore("photos").count();q.onsuccess=()=>r(q.result);});
      } catch { return 0; } }).catch(()=>0);
      rapport.importees = n; if (n >= fichiers.length) break;
      await page.waitForTimeout(1000);
    }
    // Ouvrir l'éditeur sur la première photo.
    await page.locator(".vf-media, figure, [data-photo-id]").first().click().catch(()=>{});
    await page.getByRole("button", { name: "Retoucher", exact: true }).click();
    await page.waitForTimeout(3000);
    // Aller sur la photo qui contient une personne : la dernière de la bande.
    const vignettes = page.locator(".filmstrip img, .filmstrip button, [class*=strip] img");
    const n = await vignettes.count().catch(() => 0);
    rapport.vignettes = n;
    if (n) { await vignettes.nth(n - 1).click().catch(() => {}); }
    else { for (let i = 0; i < 2; i++) { await page.keyboard.press("ArrowRight"); await page.waitForTimeout(500); } }
    // L'outil se réinitialise en changeant de photo : le rendu doit finir.
    await page.waitForTimeout(6000);
    rapport.photoOuverte = await page.locator("header, .editor-head, [class*=name]").first().innerText().catch(()=>"");
    await page.screenshot({ path: out + "/editeur.png" });
    // Témoin : un pinceau dont on sait qu'il fonctionne. S'il ne crée rien
    // non plus, c'est le clic simulé qui est en cause, pas le détourage.
    const selecteur = page.getByRole("combobox").filter({
      has: page.getByRole("option", { name: /Détourer une personne/ }),
    }).first();
    await selecteur.selectOption({ label: "Pinceau · lumière" }).catch(() => {});
    await page.waitForTimeout(1500);
    const c0 = await page.evaluate(() => {
      const r = [...document.querySelectorAll("canvas")]
        .map((c) => c.getBoundingClientRect())
        .filter((x) => x.width > 100)
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    });
    if (c0) {
      await page.mouse.move(c0.x + c0.width * 0.4, c0.y + c0.height * 0.4);
      await page.mouse.down();
      await page.mouse.move(c0.x + c0.width * 0.6, c0.y + c0.height * 0.6, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(2500);
    }
    rapport.temoinPinceau = await page.evaluate(async () => { try {
      const db = await new Promise((r,j)=>{const q=indexedDB.open("juno-studio-v1");q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
      const all = await new Promise(r=>{const q=db.transaction("photos","readonly").objectStore("photos").getAll();q.onsuccess=()=>r(q.result);});
      return all.reduce((n,p)=>n+(p.adjustments?.localEdits?.length||0),0);
    } catch { return -1; } }).catch(()=>-1);
    const outilPresent = await page.getByRole("option", { name: /Détourer une personne/ }).count();
    rapport.etapes.outilPresent = outilPresent > 0;
    if (outilPresent) {
      await page.getByRole("combobox").filter({ has: page.getByRole("option", { name: /Détourer une personne/ }) })
        .first().selectOption({ label: "Détourer une personne" });
      await page.waitForTimeout(800);
      rapport.consigne = await page.locator(".tool-hint").innerText().catch(()=>"");
      // Cliquer au milieu de la photo affichée.
      // Relever ce que le DOM contient réellement, pour viser juste.
      rapport.dom = await page.evaluate(() => {
        const stage = document.querySelector(".canvas-stage");
        return {
          stage: !!stage,
          canvases: [...document.querySelectorAll("canvas")].map((c) => {
            const r = c.getBoundingClientRect();
            return { classe: c.className, w: Math.round(r.width), h: Math.round(r.height),
              pe: getComputedStyle(c).pointerEvents };
          }),
        };
      });
      // Le plus grand canvas est l'aperçu : c'est sur lui que point() mesure.
      const stage = page.locator("canvas").first();
      const box = await page.evaluate(() => {
        const cs = [...document.querySelectorAll("canvas")]
          .map((c) => c.getBoundingClientRect())
          .filter((r) => r.width > 100)
          .sort((a, b) => b.width * b.height - a.width * a.height);
        const r = cs[0];
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      });
      void stage;
      if (box) {
        // Cliquer l'élément lui-même : Playwright le remonte à l'écran et
        // vise dans son repère, ce qu'un clic en coordonnées d'écran rate
        // dès que la page a défilé.
        await page.locator("canvas").first().click({
          position: { x: box.width / 2, y: box.height * 0.45 },
          timeout: 15000,
        }).catch((e) => { rapport.clicEchoue = String(e.message).slice(0, 160); });
        // Le message part dans un bandeau qui s'efface tout seul : le
        // relever en continu, sinon on ne voit jamais pourquoi ça a échoué.

    const lirePixels = () => page.evaluate(() => {
      const c = [...document.querySelectorAll("canvas")]
        .filter((x) => x.width > 100 && !x.className.includes("overlay"))
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!c) return null;
      const t = document.createElement("canvas");
      t.width = c.width; t.height = c.height;
      t.getContext("2d").drawImage(c, 0, 0);
      const d = t.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const moyenne = (x0, y0, x1, y1) => {
        let s = 0, n = 0;
        for (let y = Math.round(y0 * c.height); y < Math.round(y1 * c.height); y++)
          for (let x = Math.round(x0 * c.width); x < Math.round(x1 * c.width); x++) {
            const k = (y * c.width + x) * 4;
            s += (d[k] + d[k + 1] + d[k + 2]) / 3; n++;
          }
        return n ? s / n : 0;
      };
      // Le centre tombe sur la personne, les deux bandes latérales sur le mur.
      return {
        sujet: moyenne(0.4, 0.35, 0.6, 0.6),
        fondGauche: moyenne(0.02, 0.05, 0.12, 0.3),
        fondDroit: moyenne(0.88, 0.05, 0.98, 0.3),
      };
    }).catch(() => null);
        rapport.avant = await lirePixels();
        rapport.bandeaux = [];
        const guet = setInterval(async () => {
          const t = await page.locator(".toast").innerText().catch(() => "");
          if (t && !rapport.bandeaux.includes(t)) rapport.bandeaux.push(t);
        }, 300);
        // Le premier clic charge le modèle : laisser le temps.
        for (let i=0;i<60;i++) {
          const n = await page.evaluate(async () => { try {
            const db = await new Promise((r,j)=>{const q=indexedDB.open("juno-studio-v1");q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
            const all = await new Promise(r=>{const q=db.transaction("photos","readonly").objectStore("photos").getAll();q.onsuccess=()=>r(q.result);});
            return all.filter(p=>p.adjustments?.localEdits?.some(e=>e.tool==="subject")).length;
          } catch { return 0; } }).catch(()=>0);
          rapport.retouchesSujet = n; if (n > 0) break;
          await page.waitForTimeout(2000);
        }
        clearInterval(guet);
        // Laisser le rendu pleine qualité reprendre la main avant de mesurer.
        await page.waitForTimeout(8000);
        rapport.apres = await lirePixels();
      }
      rapport.message = await page.locator(".tool-hint, [role=status], .toast, [class*=error]").allInnerTexts().catch(()=>[]);
    }
    await page.screenshot({ path: out + "/apres-clic.png" });
  } catch (e) { rapport.echec = String(e.message||e).slice(0,400); }
  finally {
    await fs.writeFile(out+"/verif-detourage.json", JSON.stringify(rapport,null,2));
    console.log(JSON.stringify(rapport,null,2));
    // Le contrôle qui compte : la personne s'éclaircit, le fond ne bouge pas.
    // Sans lui, ce script rapporte une panne sans jamais la signaler.
    const a = rapport.avant, b = rapport.apres;
    const manques = [];
    if (!rapport.etapes.outilPresent) manques.push("outil absent de la liste");
    if (!(rapport.retouchesSujet > 0)) manques.push("aucun calque de détourage créé");
    if (!a || !b) manques.push("pixels non mesurés");
    else {
      if (!(b.sujet - a.sujet > 5)) manques.push("la personne ne s'éclaircit pas");
      for (const cote of ["fondGauche", "fondDroit"])
        if (Math.abs(b[cote] - a[cote]) > 1)
          manques.push("le fond a bougé (" + cote + ")");
    }
    if (rapport.erreurs.length) manques.push("erreurs: " + rapport.erreurs[0]);
    if (manques.length) { console.error("DÉTOURAGE KO : " + manques.join(" ; ")); process.exitCode = 1; }
    else console.log("DÉTOURAGE OK");
    await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
    await fs.rm(profile,{recursive:true,force:true,maxRetries:5});
  }
})().catch(e=>{console.error(e.message||e);process.exitCode=1;});
