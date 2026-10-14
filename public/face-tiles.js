/**
 * Trouver les petits visages en relisant l'image par morceaux.
 *
 * Le détecteur embarqué (MediaPipe, modèle « courte portée ») est fait pour
 * des visages qui occupent une bonne part de l'image. Mesuré le 27/09/2026 sur
 * un plan 16/9 où la mariée tient le tiers droit : image entière, aucun visage ;
 * moitié droite seule, le visage est trouvé. Or un album de mariage est fait de
 * plans moyens, de plans larges et de photos de groupe.
 *
 * La parade : relire l'image par morceaux qui se chevauchent. Dans un morceau,
 * le même visage occupe une plus grande part du cadre et redevient visible.
 * Le chevauchement garantit qu'un visage posé sur une couture tient entier
 * dans l'un d'eux ; les doublons sont fusionnés ensuite.
 *
 * Ce fichier est un script ordinaire et non un module : le travailleur de
 * vision le charge avec `importScripts`. C'est la seule copie de cette
 * géométrie ; les tests la lisent telle quelle.
 */
(function (racine) {
  /**
   * Les morceaux à lire, de l'image entière aux plus fins, en proportions.
   *
   * L'image entière reste lue en premier : un gros plan découpé couperait le
   * visage en morceaux qu'aucun ne reconnaît. Les morceaux sont à peu près
   * carrés, la forme sur laquelle le détecteur a été entraîné.
   */
  function tuiles(largeur, hauteur, chevauchement) {
    if (chevauchement === undefined) chevauchement = 0.25;
    const out = [{ x: 0, y: 0, w: 1, h: 1 }];
    const grilles =
      largeur >= hauteur
        ? [
            [2, 1],
            [3, 2],
          ]
        : [
            [1, 2],
            [2, 3],
          ];
    for (const [colonnes, lignes] of grilles)
      out.push(...grille(colonnes, lignes, chevauchement));
    return out;
  }
  function grille(colonnes, lignes, chevauchement) {
    const out = [];
    // Chaque morceau déborde sur ses voisins d'une part `chevauchement` de sa taille.
    const w = 1 / (colonnes - (colonnes - 1) * chevauchement),
      h = 1 / (lignes - (lignes - 1) * chevauchement);
    const pasX = colonnes > 1 ? (1 - w) / (colonnes - 1) : 0,
      pasY = lignes > 1 ? (1 - h) / (lignes - 1) : 0;
    for (let j = 0; j < lignes; j++)
      for (let i = 0; i < colonnes; i++)
        out.push({
          x: i * pasX,
          y: j * pasY,
          w: Math.min(1, w),
          h: Math.min(1, h),
        });
    return out;
  }
  /** Ramener un point ou une boîte d'un morceau au repère de l'image entière. */
  function versImage(b, t) {
    const out = { x: t.x + b.x * t.w, y: t.y + b.y * t.h };
    if (b.w !== undefined) {
      out.w = b.w * t.w;
      out.h = b.h * t.h;
    }
    if (b.z !== undefined) out.z = b.z;
    return out;
  }
  /** Part commune de deux boîtes, rapportée à la plus petite. */
  function recouvrement(a, b) {
    const x0 = Math.max(a.x, b.x),
      y0 = Math.max(a.y, b.y),
      x1 = Math.min(a.x + a.w, b.x + b.w),
      y1 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const petite = Math.min(a.w * a.h, b.w * b.h);
    return petite > 0 ? inter / petite : 0;
  }
  /**
   * Garder chaque visage une seule fois.
   *
   * On compare à la plus petite des deux boîtes, pas à leur union : un visage
   * vu en entier dans un morceau et à moitié dans son voisin donne une petite
   * boîte contenue dans la grande, et c'est bien le même visage. On garde la
   * plus grande, qui est la lecture complète. `boite` dit où lire la boîte
   * d'un élément, pour fusionner des détections entières et pas seulement
   * des rectangles.
   */
  function fusionner(elements, seuil, boite) {
    if (seuil === undefined) seuil = 0.5;
    const lire = boite || ((e) => e);
    const aire = (e) => lire(e).w * lire(e).h;
    const tries = elements.slice().sort((a, b) => aire(b) - aire(a));
    const gardes = [];
    for (const e of tries)
      if (!gardes.some((g) => recouvrement(lire(g), lire(e)) >= seuil))
        gardes.push(e);
    return gardes;
  }
  const api = { tuiles, versImage, recouvrement, fusionner };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  racine.JunoFaceTiles = api;
})(typeof self !== "undefined" ? self : globalThis);
