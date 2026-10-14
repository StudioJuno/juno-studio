/**
 * Trouver les moments forts d'un rush à l'oreille.
 *
 * Sur un mariage, ce qui ressort du son est ce qu'on cherche : applaudissements,
 * cris, rires, entrée des mariés, moment où la musique part. La mesure existe
 * déjà (ebur128, sonie instantanée toutes les 100 ms) ; il s'agit seulement de
 * la relire autrement.
 *
 * Un moment se juge contre son propre contexte, pas en sonie absolue. Chercher
 * le passage le plus fort d'un rush de soirée désigne le set du DJ à chaque
 * fois ; ce qui compte, c'est ce qui dépasse nettement ce qui l'entoure, comme
 * des applaudissements après un discours calme.
 */
/** Au-dessous, c'est le plancher numérique d'ebur128 : du silence, pas un son. */
const PLANCHER = -70;
const REGLAGES = {
  /** De combien un passage doit dépasser son contexte, en LU. */
  relief: 8,
  /** Durée minimale d'un moment : en dessous, c'est un claquement. */
  duree: 0.8,
  /** Deux moments plus proches que ça n'en font qu'un. */
  fusion: 1.5,
  /** La demi-largeur du contexte auquel on compare, en secondes. */
  contexte: 15,
  /** Combien en garder au plus. */
  maximum: 12,
};
/**
 * Lire une ligne d'ebur128.
 *
 * La forme varie selon la valeur : `M:-120.7` sans espace, `M: -48.6` avec.
 */
function lireLigne(ligne) {
  const m = /\bt:\s*([0-9.]+)[\s\S]*?\bM:\s*(-?[0-9.]+)/.exec(ligne);
  if (!m) return null;
  const t = Number(m[1]),
    v = Number(m[2]);
  return Number.isFinite(t) && Number.isFinite(v) ? { t, m: v } : null;
}
function mediane(v) {
  if (!v.length) return PLANCHER;
  const t = [...v].sort((a, b) => a - b),
    k = Math.floor(t.length / 2);
  return t.length % 2 ? t[k] : (t[k - 1] + t[k]) / 2;
}
/**
 * Le niveau de fond autour de chaque instant.
 *
 * Calculé seconde par seconde puis médian sur une fenêtre glissante : une
 * médiane ignore le pic lui-même, là où une moyenne serait tirée vers le haut
 * par les applaudissements qu'on cherche à repérer.
 */
function fond(serie, contexte) {
  const parSeconde = new Map();
  for (const p of serie) {
    if (p.m <= PLANCHER) continue;
    const s = Math.floor(p.t);
    if (!parSeconde.has(s)) parSeconde.set(s, []);
    parSeconde.get(s).push(p.m);
  }
  const secondes = [...parSeconde.keys()].sort((a, b) => a - b);
  const niveau = new Map(secondes.map((s) => [s, mediane(parSeconde.get(s))]));
  const cache = new Map();
  return (t) => {
    const s = Math.floor(t);
    if (cache.has(s)) return cache.get(s);
    const autour = [];
    for (let k = s - contexte; k <= s + contexte; k++)
      if (niveau.has(k)) autour.push(niveau.get(k));
    const v = mediane(autour);
    cache.set(s, v);
    return v;
  };
}
/**
 * @param serie  les relevés `{ t, m }` d'ebur128, dans l'ordre
 * @returns les moments, dans l'ordre du rush : `{ start, end, crete, relief }`
 */
function momentsForts(serie, options = {}) {
  const r = { ...REGLAGES, ...options };
  if (serie.length < 3) return [];
  const niveauDeFond = fond(serie, r.contexte);
  // Les passages qui dépassent leur contexte.
  const passages = [];
  let courant = null;
  for (const p of serie) {
    const base = niveauDeFond(p.t),
      depasse = p.m > PLANCHER && p.m - base >= r.relief;
    if (depasse) {
      if (!courant) courant = { start: p.t, end: p.t, crete: p.m, relief: p.m - base };
      courant.end = p.t;
      if (p.m > courant.crete) courant.crete = p.m;
      courant.relief = Math.max(courant.relief, p.m - base);
    } else if (courant) {
      passages.push(courant);
      courant = null;
    }
  }
  if (courant) passages.push(courant);
  // Recoller ceux qu'un court creux sépare : une salve d'applaudissements
  // n'est pas trois moments.
  const recolles = [];
  for (const p of passages) {
    const d = recolles.at(-1);
    if (d && p.start - d.end < r.fusion) {
      d.end = p.end;
      d.crete = Math.max(d.crete, p.crete);
      d.relief = Math.max(d.relief, p.relief);
    } else recolles.push({ ...p });
  }
  // ebur128 mesure sur 400 ms : le relevé à `t` décrit ce qui précède. On
  // recule donc le début d'autant pour ne pas arriver en retard sur le moment.
  const retenus = recolles
    .map((p) => ({ ...p, start: Math.max(0, p.start - 0.4) }))
    .filter((p) => p.end - p.start >= r.duree)
    .sort((a, b) => b.relief - a.relief)
    .slice(0, r.maximum)
    .sort((a, b) => a.start - b.start);
  const arrondi = (v) => Math.round(v * 100) / 100;
  return retenus.map((p) => ({
    start: arrondi(p.start),
    end: arrondi(p.end),
    crete: arrondi(p.crete),
    relief: arrondi(p.relief),
  }));
}
module.exports = { lireLigne, momentsForts, REGLAGES, PLANCHER };
