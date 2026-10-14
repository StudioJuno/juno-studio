/**
 * Envoyer le tri de Juno à Lightroom Classic : un fichier .xmp à côté de
 * chaque RAW, qui porte les étoiles, la couleur et les mots-clés.
 *
 * Les règles, vérifiées sur Lightroom Classic 15.5 et les catalogues de Johan
 * (voir AUDIT-AFTERSHOOT.md) :
 * - le sidecar remplace l'extension (4R7A1346.CR3 → 4R7A1346.xmp) et ne sert
 *   qu'aux RAW et au HEIC ; un JPEG, un TIFF ou un DNG portent leurs
 *   métadonnées en eux, et Juno ne touche jamais à un original ;
 * - la couleur s'écrit par son nom dans la langue de Lightroom (« Vert »),
 *   un autre texte devient un libellé blanc ;
 * - une note -1 n'arrive pas « Rejetée » : l'écart passe par un mot-clé.
 *
 * Une note posée ailleurs (Aftershoot, Lightroom) n'est jamais écrasée sans
 * qu'on l'ait demandé : Juno retient ce qu'il a écrit la dernière fois, et
 * seul ce qui n'a pas bougé depuis est à lui.
 */
"use strict";
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { execFile } = require("node:child_process");
const { writeJsonAtomic } = require("./atomic.cjs");
const { fusionner, nouveau, lire, XmpNonReconnu, TAILLE_MAX } = require("./xmp-sidecar.cjs");
const formats = require("./media-formats.json");
/** Le DNG est un RAW pour Juno, mais Lightroom y écrit ses métadonnées en interne. */
const AVEC_SIDECAR = new Set([...formats.raw.filter((e) => e !== "dng"), "heic", "heif", "hif"]);
/** Les noms par défaut d'un Lightroom français, dans l'ordre de ses réglages label1 à label5. */
const LIBELLES_FR = ["Rouge", "Jaune", "Vert", "Bleu", "Violet"];
/** La convention d'Aftershoot que Johan suit : 5 Vert, 4 Bleu, 3 Jaune, 2 Rouge, 1 Violet. */
const INDICE_PAR_ETOILES = { 5: 2, 4: 3, 3: 1, 2: 0, 1: 4 };
const sha = (texte) => createHash("sha256").update(texte).digest("hex");
async function empreinte(file) {
  const h = createHash("sha256");
  for await (const b of fss.createReadStream(file)) h.update(b);
  return h.digest("hex");
}
const lstat = (f) => fs.lstat(f).catch((e) => (e.code === "ENOENT" ? null : Promise.reject(e)));
/** Les noms de libellés du jeu actif de Lightroom, sinon les noms français. */
function libellesLightroom() {
  if (process.platform !== "darwin") return Promise.resolve(LIBELLES_FR);
  const lireCle = (cle) =>
    new Promise((ok) =>
      execFile("defaults", ["read", "com.adobe.LightroomClassicCC7", cle], { timeout: 4000 }, (e, out) =>
        ok(e ? undefined : String(out).trim()),
      ),
    );
  return Promise.all([1, 2, 3, 4, 5].map((i) => lireCle("label" + i))).then((noms) =>
    noms.map((n, i) => (n && n.length <= 60 ? n : LIBELLES_FR[i])),
  );
}
/** Le sidecar d'un original : même nom, extension .xmp ; un sidecar existant garde sa casse. */
async function sidecarDe(original) {
  const dir = path.dirname(original),
    base = path.basename(original, path.extname(original));
  const voulu = (base + ".xmp").toLowerCase();
  const noms = await fs.readdir(dir).catch(() => []);
  const trouve = noms.find((n) => n.toLowerCase() === voulu);
  return path.join(dir, trouve || base + ".xmp");
}
/** Le nom du disque d'un chemin absent, pour le dire au photographe. */
const volume = (file) => (file.startsWith("/Volumes/") ? file.split("/")[2] : null);
/**
 * La note et la couleur à écrire, en fusion à trois : ce que Juno veut, ce
 * que le fichier porte, ce que Juno y avait écrit la dernière fois.
 * Rend `undefined` pour ne rien toucher, `null` pour retirer.
 */
function decider(voulu, actuel, base, remplacer) {
  if (voulu !== undefined) {
    if (actuel === undefined || actuel === voulu) return { valeur: voulu };
    if (base !== undefined && actuel === base) return { valeur: voulu };
    return remplacer ? { valeur: voulu, remplace: actuel } : { conflit: actuel };
  }
  // Juno ne veut plus rien : il ne retire que ce qu'il avait lui-même posé.
  if (actuel !== undefined && base !== undefined && actuel === base) return { valeur: null };
  return {};
}
function registerLightroom({ handle, app, dialog, shell, getWindow, assets, origins, persistOrigins }) {
  const racine = app.getPath("userData");
  const registre = path.join(racine, "lightroom.json"),
    sauvegardes = path.join(racine, "Lightroom");
  const geres = [path.join(racine, "Originals"), path.join(racine, "restored-originals")];
  let etat = { photos: {}, envois: {} };
  const charge = fs
    .readFile(registre, "utf8")
    .then((t) => {
      const d = JSON.parse(t);
      if (d && typeof d.photos === "object" && typeof d.envois === "object") etat = d;
    })
    .catch(() => {});
  let ecriture = Promise.resolve();
  const persiste = () => (ecriture = ecriture.catch(() => {}).then(() => writeJsonAtomic(registre, etat)));
  const plans = new Map();
  const valideId = (id) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,90}$/.test(id);
  const gere = (f) => geres.some((d) => f.startsWith(d + path.sep));
  /** Là où le photographe range son fichier, pas la copie de Juno. */
  const origineDe = (id) => origins[id] || (assets[id] && !gere(assets[id]) ? assets[id] : null);
  /** Ce que Juno écrit pour une photo, d'après ce que l'interface a envoyé. */
  function souhait(item, options, libelles) {
    const ecartee = item.status === "reject";
    const etoiles = !ecartee && Number.isInteger(item.stars) && item.stars >= 1 && item.stars <= 5 ? item.stars : undefined;
    const cles = [];
    if (options.tri !== false) {
      if (item.status === "keep") cles.push("Juno|Tri|Gardée");
      if (ecartee) cles.push("Juno|Tri|Écartée");
      if (item.protected) cles.push("Juno|Tri|Protégée");
    }
    if (options.personnes !== false)
      for (const n of (item.people || []).slice(0, 40))
        if (typeof n === "string" && n.trim() && !n.includes("|")) cles.push("Juno|Personnes|" + n.trim().slice(0, 80));
    if (options.chapitres && typeof item.chapter === "string" && item.chapter && !item.chapter.includes("|"))
      cles.push("Juno|Chapitres|" + item.chapter.slice(0, 80));
    return {
      rating: etoiles,
      label: etoiles === undefined ? undefined : libelles[INDICE_PAR_ETOILES[etoiles]],
      keywords: cles,
    };
  }
  async function preparer(item, options, libelles) {
    const nom = String(item.name || "");
    const ext = path.extname(nom).slice(1).toLowerCase();
    if (!AVEC_SIDECAR.has(ext)) return { etat: "non-concerne" };
    const original = origineDe(item.id);
    if (!original) return { etat: "introuvable" };
    const s = await lstat(original);
    if (!s) {
      const v = volume(original);
      const monte = v ? await lstat("/Volumes/" + v) : true;
      return { etat: monte ? "absent" : "disque-absent", disque: v || undefined, original };
    }
    if (!s.isFile() || (item.size > 0 && s.size !== item.size)) return { etat: "different", original };
    const sidecar = await sidecarDe(original);
    const si = await lstat(sidecar);
    if (si && (!si.isFile() || si.isSymbolicLink())) return { etat: "refuse", raison: "un lien ou un dossier porte le nom du .xmp", original, sidecar };
    const veut = souhait(item, options, libelles);
    const base = etat.photos[item.id]?.path === sidecar ? etat.photos[item.id] : undefined;
    let texte = null,
      actuel = { rating: undefined, label: undefined };
    if (si) {
      if (si.size > TAILLE_MAX) return { etat: "refuse", raison: "fichier .xmp trop volumineux", original, sidecar };
      texte = await fs.readFile(sidecar, "utf8");
      try {
        actuel = lire(texte);
      } catch (e) {
        if (e instanceof XmpNonReconnu) return { etat: "refuse", raison: "fichier .xmp non reconnu (" + e.message + ")", original, sidecar };
        throw e;
      }
    }
    // Une case décochée veut dire « ne pas y toucher », pas « retirer ».
    const note =
      options.etoiles === false
        ? {}
        : decider(veut.rating, Number.isFinite(actuel.rating) && actuel.rating > 0 ? actuel.rating : undefined, base?.rating, options.remplacer);
    const couleur =
      options.couleurs === false ? {} : decider(veut.label, actuel.label || undefined, base?.label, options.remplacer);
    return {
      etat: note.conflit !== undefined || couleur.conflit !== undefined ? "conflit" : texte === null ? "nouveau" : "complete",
      original,
      sidecar,
      avant: texte === null ? null : sha(texte),
      record: { rating: note.valeur, label: couleur.valeur, keywords: veut.keywords },
      conflit: note.conflit !== undefined || couleur.conflit !== undefined ? { note: note.conflit, couleur: couleur.conflit } : undefined,
      remplace: note.remplace !== undefined || couleur.remplace !== undefined,
    };
  }
  handle("lightroom-plan", async (input) => {
    await charge;
    const items = Array.isArray(input?.items) ? input.items : [];
    if (items.length > 50000 || items.some((i) => !valideId(i?.id))) throw Error("Sélection invalide.");
    const options = { ...(input.options || {}) };
    const libelles = await libellesLightroom();
    const lignes = [];
    for (const item of items) {
      try {
        lignes.push({ id: item.id, name: String(item.name || ""), ...(await preparer(item, options, libelles)) });
      } catch (e) {
        lignes.push({ id: item.id, name: String(item.name || ""), etat: "erreur", raison: e.message });
      }
    }
    const token = randomUUID();
    plans.set(token, { lignes, cree: Date.now() });
    for (const [t, p] of plans) if (Date.now() - p.cree > 3600e3) plans.delete(t);
    const compte = {};
    for (const l of lignes) compte[l.etat] = (compte[l.etat] || 0) + 1;
    return {
      token,
      libelles,
      compte,
      disques: [...new Set(lignes.filter((l) => l.disque).map((l) => l.disque))],
      lignes: lignes.map(({ id, name, etat: e, raison, conflit, disque }) => ({ id, name, etat: e, raison, conflit, disque })),
    };
  });
  /** Écrire à côté de l'original sans jamais laisser un fichier à moitié écrit. */
  async function ecrireAtomique(cible, texte, existe) {
    const dir = path.dirname(cible),
      temp = path.join(dir, "." + path.basename(cible) + ".juno-" + randomUUID() + ".tmp");
    const mode = existe ? (await fs.stat(cible)).mode & 0o777 : 0o644;
    try {
      const h = await fs.open(temp, "wx", mode);
      try {
        await h.writeFile(texte, "utf8");
        await h.sync();
      } finally {
        await h.close();
      }
      if (existe) await fs.rename(temp, cible);
      else
        try {
          await fs.link(temp, cible);
        } catch (e) {
          // Une carte en exFAT ne connaît pas les liens physiques.
          if (!["EPERM", "ENOTSUP", "EXDEV", "ENOSYS"].includes(e.code)) throw e;
          await fs.copyFile(temp, cible, fss.constants.COPYFILE_EXCL);
        }
      const d = await fs.open(dir, "r").catch(() => null);
      if (d) await d.sync().catch(() => {}).finally(() => d.close());
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
  }
  handle("lightroom-write", async (token) => {
    await charge;
    const plan = plans.get(token);
    if (!plan) throw Error("Préparez l’envoi à nouveau : cette préparation a expiré.");
    plans.delete(token);
    const dossier = path.join(sauvegardes, token);
    await fs.mkdir(dossier, { recursive: true, mode: 0o700 });
    const envoi = { at: Date.now(), items: [] },
      bilan = { ecrits: 0, inchanges: 0, conserves: 0, echecs: [] };
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    for (const l of plan.lignes) {
      if (!["nouveau", "complete", "conflit"].includes(l.etat)) continue;
      try {
        const s = await lstat(l.sidecar);
        if (s && (!s.isFile() || s.isSymbolicLink())) throw Error("un lien ou un dossier porte le nom du .xmp");
        const texte = s ? await fs.readFile(l.sidecar, "utf8") : null;
        if ((texte === null ? null : sha(texte)) !== l.avant) throw Error("le fichier .xmp a changé depuis la préparation");
        // Rien à changer : on ne touche même pas à la date, et un second
        // envoi identique laisse le fichier identique à l'octet près.
        if (texte !== null && fusionner(texte, l.record) === texte) {
          bilan.inchanges++;
          continue;
        }
        const record = { ...l.record, date };
        const sortie = texte === null ? nouveau(record) : fusionner(texte, record);
        let copie = null;
        if (texte !== null) {
          copie = path.join(dossier, l.id + ".xmp");
          await fs.writeFile(copie, texte, { mode: 0o600, flag: "wx" });
        }
        await ecrireAtomique(l.sidecar, sortie, texte !== null);
        // Juno ne retient que ce qu'il a lui-même écrit. Une note gardée
        // parce qu'elle venait d'ailleurs n'est pas à lui : la retenir, c'est
        // l'écraser au prochain envoi.
        const avant = etat.photos[l.id]?.path === l.sidecar ? etat.photos[l.id] : undefined;
        const retenu = (valeur, conflit, ancien) =>
          valeur === undefined ? (conflit === undefined ? ancien : undefined) : (valeur ?? undefined);
        envoi.items.push({ id: l.id, path: l.sidecar, copie, sha256: sha(sortie), base: etat.photos[l.id] || null });
        etat.photos[l.id] = {
          path: l.sidecar,
          sha256: sha(sortie),
          rating: retenu(l.record.rating, l.conflit?.note, avant?.rating),
          label: retenu(l.record.label, l.conflit?.couleur, avant?.label),
          at: envoi.at,
        };
        bilan.ecrits++;
        if (l.etat === "conflit") bilan.conserves++;
      } catch (e) {
        const lecture = ["EACCES", "EPERM", "EROFS"].includes(e.code);
        bilan.echecs.push({
          id: l.id,
          name: l.name,
          raison: lecture
            ? "dossier en lecture seule ou accès refusé par macOS"
            : e instanceof XmpNonReconnu
              ? "fichier .xmp non reconnu, laissé intact"
              : e.message,
        });
      }
    }
    etat.envois[token] = envoi;
    await persiste();
    return { token, ...bilan, dossiers: [...new Set(envoi.items.map((i) => path.dirname(i.path)))] };
  });
  handle("lightroom-undo", async (token) => {
    await charge;
    const envoi = etat.envois[token];
    if (!envoi) throw Error("Envoi introuvable.");
    let rendus = 0,
      gardes = 0;
    for (const it of [...envoi.items].reverse()) {
      const s = await lstat(it.path);
      const texte = s?.isFile() ? await fs.readFile(it.path, "utf8") : null;
      // Modifié depuis, dans Lightroom ou ailleurs : on n'y touche plus.
      if (texte === null || sha(texte) !== it.sha256) {
        gardes++;
        continue;
      }
      if (it.copie) await ecrireAtomique(it.path, await fs.readFile(it.copie, "utf8"), true);
      else await fs.unlink(it.path);
      if (it.base) etat.photos[it.id] = it.base;
      else delete etat.photos[it.id];
      rendus++;
    }
    delete etat.envois[token];
    await persiste();
    await fs.rm(path.join(sauvegardes, token), { recursive: true, force: true });
    return { rendus, gardes };
  });
  /**
   * Retrouver où le photographe range ses originaux : un dossier choisi,
   * parcouru, chaque fichier reconnu par sa taille puis son empreinte.
   */
  handle("lightroom-locate", async (items) => {
    if (!Array.isArray(items) || items.length > 50000) throw Error("Sélection invalide.");
    const r = await dialog.showOpenDialog(getWindow(), {
      title: "Choisir le dossier où sont rangés les originaux",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths?.[0]) return null;
    const cherches = items.filter((i) => valideId(i?.id) && /^[a-f0-9]{64}$/.test(i.hash) && i.size > 0);
    const parTaille = new Map();
    for (const i of cherches) parTaille.set(i.size, [...(parTaille.get(i.size) || []), i]);
    let vus = 0;
    const trouves = {};
    const parcourir = async (dir, profondeur) => {
      if (profondeur > 6 || vus > 200000) return;
      const entrees = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const e of entrees) {
        if (e.name.startsWith(".")) continue;
        const f = path.join(dir, e.name);
        if (e.isDirectory()) await parcourir(f, profondeur + 1);
        else if (e.isFile()) {
          vus++;
          const candidats = parTaille.get((await fs.stat(f).catch(() => ({ size: -1 }))).size);
          if (!candidats) continue;
          const h = await empreinte(f);
          for (const c of candidats) if (c.hash === h && !trouves[c.id]) trouves[c.id] = f;
        }
      }
    };
    await parcourir(r.filePaths[0], 0);
    Object.assign(origins, trouves);
    if (Object.keys(trouves).length) await persistOrigins();
    return { trouves: Object.keys(trouves).length, cherches: cherches.length };
  });
  /**
   * Le repli : un dossier neuf avec une copie vérifiée de chaque original et
   * son .xmp, à importer dans Lightroom. Marche sans l'original d'origine.
   */
  handle("lightroom-folder", async (input) => {
    const items = Array.isArray(input?.items) ? input.items : [];
    if (!items.length || items.length > 50000 || items.some((i) => !valideId(i?.id))) throw Error("Sélection invalide.");
    const r = await dialog.showOpenDialog(getWindow(), {
      title: "Choisir où préparer le dossier pour Lightroom",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths?.[0]) return null;
    const dossier = await dossierNeuf(r.filePaths[0], "Juno pour Lightroom " + horodatage(new Date()));
    const libelles = await libellesLightroom();
    const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const pris = new Set();
    let copies = 0;
    const echecs = [];
    for (const item of items) {
      try {
        const source = assets[item.id];
        const nom = path.basename(String(item.name || ""));
        const ext = path.extname(nom);
        if (!source || !nom || nom === "." || nom === "..") throw Error("original indisponible");
        // Deux photos du même nom : le même suffixe sur le RAW et son .xmp.
        let base = path.basename(nom, ext),
          n = 1;
        while (pris.has((base + ext).toLowerCase())) base = path.basename(nom, ext) + " (" + ++n + ")";
        pris.add((base + ext).toLowerCase());
        const cible = path.join(dossier, base + ext);
        await fs.copyFile(source, cible, fss.constants.COPYFILE_EXCL | fss.constants.COPYFILE_FICLONE);
        if (item.hash && (await empreinte(cible)) !== item.hash) {
          await fs.unlink(cible);
          throw Error("la copie ne correspond pas à l’original importé");
        }
        if (AVEC_SIDECAR.has(ext.slice(1).toLowerCase())) {
          const options = input.options || {},
            veut = souhait(item, options, libelles);
          // Les mêmes cases que l'envoi à côté des originaux (preparer) : la
          // couleur ne dépendait ici que de la case « Étoiles », et une case
          // « Couleur » cochée était ignorée sans un mot.
          const record = {
            rating: options.etoiles === false ? undefined : veut.rating,
            label: options.couleurs === false ? undefined : veut.label,
            keywords: veut.keywords,
            date,
          };
          await fs.writeFile(path.join(dossier, base + ".xmp"), nouveau(record), { flag: "wx" });
        }
        copies++;
      } catch (e) {
        echecs.push({ id: item.id, name: item.name, raison: e.message });
      }
    }
    return { dossier, copies, echecs };
  });
  handle("lightroom-reveal", async (file) => {
    if (typeof file !== "string" || !path.isAbsolute(file)) throw Error("Chemin invalide.");
    shell.showItemInFolder(file);
    return true;
  });
  return { preparer, souhait, decider };
}
/** L'heure locale à la minute, comme le photographe la lit : 2026-09-29-14-05. */
function horodatage(d) {
  const deux = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}-${deux(d.getHours())}-${deux(d.getMinutes())}`;
}
/**
 * Un dossier neuf, suffixé s'il existe déjà. Deux préparations dans la même
 * minute tombaient sur le même nom et la seconde échouait sur une erreur
 * système brute (EEXIST).
 */
async function dossierNeuf(parent, nom) {
  for (let n = 1; n <= 99; n++) {
    const dossier = path.join(parent, n === 1 ? nom : `${nom} (${n})`);
    try {
      await fs.mkdir(dossier);
      return dossier;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
  }
  throw Error(`Trop de dossiers « ${nom} » à cet endroit : choisissez un autre emplacement.`);
}
module.exports = { registerLightroom, decider, sidecarDe, dossierNeuf, horodatage, LIBELLES_FR, INDICE_PAR_ETOILES, AVEC_SIDECAR };
