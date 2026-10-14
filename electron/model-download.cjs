/**
 * Télécharger un modèle, et ne jamais garder un fichier qu'on n'a pas vérifié.
 *
 * Le modèle de langue pèse 2,3 Go, soit 70 % de l'application, alors qu'il ne
 * sert que lorsque le lecteur de consignes ne comprend pas une phrase. Il ne
 * fait donc plus partie de l'installation : on le télécharge à la demande.
 *
 * Trois règles tiennent ce module :
 * - on écrit dans un fichier `.partiel`, et on ne le renomme qu'une fois
 *   l'empreinte vérifiée : un fichier tronqué ou altéré ne prend jamais la
 *   place du vrai ;
 * - une coupure reprend là où elle s'est arrêtée, au lieu de recommencer
 *   2,3 Go depuis le début ;
 * - on vérifie l'espace libre avant de commencer, plutôt que d'échouer à 90 %.
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Readable, Transform } = require("node:stream");
/** Ce qu'il faut de place en plus du fichier : le système en a besoin aussi. */
const MARGE = 1 << 30;
async function empreinte(fichier, signal) {
  const hash = createHash("sha256");
  await pipeline(fs.createReadStream(fichier), hash, { signal });
  return hash.digest("hex");
}
async function tailleDe(fichier) {
  try {
    return (await fsp.stat(fichier)).size;
  } catch {
    return 0;
  }
}
/**
 * @param {object} o
 * @param {string} o.url
 * @param {string} o.destination
 * @param {string} o.sha256      empreinte attendue, en hexadécimal
 * @param {number} o.taille      taille attendue, en octets
 * @param {(fait:number,total:number)=>void} [o.avancement]
 * @param {AbortSignal} [o.signal]
 * @param {typeof fetch} [o.fetch] pour les tests
 * @param {(dossier:string)=>Promise<number>} [o.espaceLibre] pour les tests
 */
async function telecharger(o) {
  const partiel = o.destination + ".partiel";
  await fsp.mkdir(path.dirname(o.destination), { recursive: true });
  // Déjà là et intact : rien à faire.
  if ((await tailleDe(o.destination)) === o.taille) {
    if ((await empreinte(o.destination, o.signal)) === o.sha256)
      return { deja: true };
    await fsp.rm(o.destination, { force: true });
  }
  let deja = await tailleDe(partiel);
  // Un partiel plus gros que le fichier attendu ne peut pas être une reprise.
  if (deja > o.taille) {
    await fsp.rm(partiel, { force: true });
    deja = 0;
  }
  const libre = await (o.espaceLibre || espaceLibre)(path.dirname(o.destination));
  if (libre < o.taille - deja + MARGE)
    throw Error(
      `Il faut ${Math.ceil((o.taille - deja + MARGE) / 1e9)} Go libres sur ce disque pour installer l’IA locale ; il en reste ${Math.floor(libre / 1e9)}.`,
    );
  if (deja < o.taille) {
    const reponse = await (o.fetch || fetch)(o.url, {
      headers: deja ? { Range: `bytes=${deja}-` } : {},
      signal: o.signal,
      redirect: "follow",
    });
    // Un serveur qui ignore la reprise renvoie tout le fichier : on repart de
    // zéro au lieu de coller le fichier entier derrière le début déjà reçu.
    if (deja && reponse.status === 200) {
      await fsp.rm(partiel, { force: true });
      deja = 0;
    } else if (!(reponse.status === 200 || reponse.status === 206))
      throw Error(`Le serveur a refusé le téléchargement (${reponse.status}).`);
    if (!reponse.body) throw Error("Réponse vide du serveur.");
    let recu = deja;
    o.avancement?.(recu, o.taille);
    const compteur = new Transform({
      transform(morceau, _e, suite) {
        recu += morceau.length;
        // Plus gros qu'annoncé : ce n'est pas le fichier attendu.
        if (recu > o.taille) return suite(Error("Le fichier reçu est plus gros que prévu."));
        o.avancement?.(recu, o.taille);
        suite(null, morceau);
      },
    });
    await pipeline(
      Readable.fromWeb(reponse.body),
      compteur,
      fs.createWriteStream(partiel, { flags: deja ? "a" : "w" }),
      { signal: o.signal },
    );
  }
  const recue = await tailleDe(partiel);
  if (recue !== o.taille)
    throw Error(
      `Téléchargement incomplet (${Math.round((recue / o.taille) * 100)} %). Relancez l’installation : elle reprendra là où elle s’est arrêtée.`,
    );
  const vue = await empreinte(partiel, o.signal);
  if (vue !== o.sha256) {
    // Un fichier altéré ne se répare pas en reprenant : on le jette.
    await fsp.rm(partiel, { force: true });
    throw Error(
      "Le fichier téléchargé ne correspond pas à l’original publié. Il a été supprimé ; relancez l’installation.",
    );
  }
  await fsp.rename(partiel, o.destination);
  return { deja: false };
}
async function espaceLibre(dossier) {
  const s = await fsp.statfs(dossier);
  return Number(s.bavail) * Number(s.bsize);
}
module.exports = { telecharger, empreinte, MARGE };
