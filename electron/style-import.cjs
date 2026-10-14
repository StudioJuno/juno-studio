// Lire les retouches Lightroom d'un dossier, pour en tirer le style du
// photographe. Rien n'est écrit : le dossier est ouvert en lecture seule.
const fs = require("node:fs/promises");
const path = require("node:path");
const { nativeImage } = require("electron");
/** Au-delà, un dossier n'est plus un album mais une bibliothèque entière. */
const MAX_FICHIERS = 20000;
/** Un XMP Lightroom dépasse rarement 100 ko ; au-delà, ce n'en est pas un. */
const MAX_OCTETS = 512 * 1024;
/**
 * Ne renvoyer que les attributs de réglage, pas le fichier entier.
 *
 * Un XMP pèse une dizaine de kilo-octets dont l'essentiel est du balisage.
 * Sur sept cent cinquante fichiers cela ferait plusieurs méga-octets envoyés
 * à l'interface pour rien. Les attributs suffisent à la lecture, qui reste
 * faite par un seul analyseur, côté interface.
 */
function reglages(texte) {
  const trouves = String(texte).match(/crs:[A-Za-z0-9]+="[^"]{0,80}"/g);
  return trouves?.length ? trouves.join(" ") : null;
}
/** Les formats qu'un photographe livre à ses clients. */
const LIVRABLES = /\.(jpe?g|png|webp|tiff?)$/i;
/**
 * La largeur à laquelle les photos livrées sont mesurées.
 *
 * Cent soixante pixels suffisent : on cherche des centiles et des moyennes de
 * couleur, pas du détail. Une photo de deux mille pixels transmise telle
 * quelle à l'interface coûterait vingt méga-octets pour rien, et la mesure
 * serait identique.
 */
const LARGEUR_MESURE = 160;
/** Au-delà, on a de quoi lire un style sans lire tout le disque. */
const MAX_LIVRABLES = 400;
function registerStyleImport({ handle, dialog, getWindow }) {
  handle("look-pick-folder", async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: "Choisir un dossier de photos que vous avez livrées",
      message:
        "Juno mesure le rendu de ces photos pour en apprendre votre style. Rien n'est modifié.",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return lireLivrables(r.filePaths[0]);
  });
  handle("look-read-folder", async (dossier) => {
    if (typeof dossier !== "string" || !path.isAbsolute(dossier))
      throw Error("Dossier invalide");
    return lireLivrables(dossier);
  });
  async function lireLivrables(dossier) {
    const entrees = await fs.readdir(dossier, { withFileTypes: true });
    const noms = entrees
      .filter((e) => e.isFile() && LIVRABLES.test(e.name))
      .map((e) => e.name)
      .sort();
    // Un échantillon régulier couvre toute la journée ; les quatre cents
    // premiers ne montreraient que le matin.
    const pas = Math.max(1, Math.floor(noms.length / MAX_LIVRABLES));
    const choix = noms.filter((_, i) => i % pas === 0).slice(0, MAX_LIVRABLES);
    const images = [];
    let illisibles = 0;
    for (const nom of choix) {
      try {
        const img = nativeImage.createFromPath(path.join(dossier, nom));
        if (img.isEmpty()) {
          illisibles++;
          continue;
        }
        const petite = img.resize({ width: LARGEUR_MESURE, quality: "good" });
        const { width, height } = petite.getSize();
        if (!width || !height) {
          illisibles++;
          continue;
        }
        // toBitmap rend du BGRA : l'interface remettra le rouge à sa place.
        images.push({ width, height, bgra: petite.toBitmap() });
      } catch {
        illisibles++;
      }
    }
    return {
      dossier,
      nom: path.basename(dossier),
      trouves: noms.length,
      illisibles,
      images,
    };
  }
  handle("style-pick-folder", async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: "Choisir un dossier retouché dans Lightroom",
      message:
        "Juno lit les fichiers .xmp pour apprendre votre style. Rien n'est modifié.",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths.length) return null;
    return lireDossier(r.filePaths[0]);
  });
  handle("style-read-folder", async (dossier) => {
    if (typeof dossier !== "string" || !path.isAbsolute(dossier))
      throw Error("Dossier invalide");
    return lireDossier(dossier);
  });
  async function lireDossier(dossier) {
    const entrees = await fs.readdir(dossier, { withFileTypes: true });
    const xmps = entrees
      .filter((e) => e.isFile() && /\.xmp$/i.test(e.name))
      .map((e) => e.name)
      .slice(0, MAX_FICHIERS);
    const fichiers = [];
    let illisibles = 0;
    for (const nom of xmps) {
      const complet = path.join(dossier, nom);
      try {
        const s = await fs.stat(complet);
        if (s.size > MAX_OCTETS) {
          illisibles++;
          continue;
        }
        const extrait = reglages(await fs.readFile(complet, "utf8"));
        if (extrait) fichiers.push(extrait);
        else illisibles++;
      } catch {
        illisibles++;
      }
    }
    return {
      dossier,
      nom: path.basename(dossier),
      trouves: xmps.length,
      illisibles,
      fichiers,
    };
  }
  return { reglages };
}
module.exports = {
  registerStyleImport,
  reglages,
  MAX_FICHIERS,
  MAX_OCTETS,
  LARGEUR_MESURE,
  MAX_LIVRABLES,
  LIVRABLES,
};
