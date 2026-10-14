// Débruitage, stabilisation et ralentis fluides, par plan.
//
// Le catalogue ci-dessous n'est pas un choix d'auteur : il vient de mesures
// faites le 23 septembre 2026 sur cette machine. Chaque filtre a été appliqué
// à une source propre bruitée, puis comparé à l'original.
//
//   filtre                    qualité rendue    vitesse 1080p
//   (départ bruité)           31,4 dB           111 i/s sans filtre
//   removegrain=11            32,3 dB  (+0,9)   125 i/s
//   atadenoise par défaut     31,4 dB  (+0,1)    64 i/s   <- inutile
//   atadenoise réglé          36,7 dB  (+5,4)    66 i/s
//   fftdnoiz=sigma=3          34,2 dB  (+2,8)    58 i/s   <- dominé
//   nlmeans=s=6:p=7:r=15      41,2 dB  (+9,8)   1,2 i/s
//
// Deux enseignements y sont figés. atadenoise avec ses réglages d'origine ne
// retire rien du tout : livré tel quel, le bouton aurait été décoratif.
// Et fftdnoiz est battu par atadenoise sur la qualité comme sur la vitesse,
// donc il n'est pas proposé.
const DENOISE = {
  none: { filter: null, temporal: false, rate: 1 },
  // Spatial pur : aucun état d'une image à l'autre, donc rien à préchauffer.
  light: { filter: "removegrain=11", temporal: false, rate: 1 },
  // Moyenne temporelle adaptative, seuils ouverts : sans cela elle ne fait rien.
  medium: {
    filter:
      "atadenoise=0a=0.1:0b=0.1:1a=0.1:1b=0.1:2a=0.1:2b=0.1:s=9",
    temporal: true,
    rate: 0.59,
  },
  // La meilleure qualité disponible, et quatre-vingt-dix fois plus lente.
  strong: { filter: "nlmeans=s=6.0:p=7:r=15", temporal: false, rate: 0.011 },
};
const DENOISE_KEYS = Object.keys(DENOISE);
/** Le nombre d'images à décoder avant le segment pour qu'un filtre se cale. */
const LEAD_FRAMES = 6;
function validate(clip) {
  if (clip.denoise !== undefined && !DENOISE_KEYS.includes(clip.denoise))
    throw Error("Débruitage inconnu");
  if (clip.stabilise !== undefined) {
    const v = clip.stabilise;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1)
      throw Error("Stabilisation invalide");
  }
  if (clip.smoothSlow !== undefined && typeof clip.smoothSlow !== "boolean")
    throw Error("Ralenti fluide invalide");
}
/**
 * Les filtres à poser juste après le décodage, avant tout changement de
 * vitesse : un débruiteur temporel doit voir les images telles qu'elles ont
 * été tournées, pas étirées.
 */
function sourceFilters(clip) {
  const out = [];
  const denoise = DENOISE[clip.denoise || "none"];
  if (denoise?.filter) out.push(denoise.filter);
  if (clip.stabilise) {
    // deshake recadre pour compenser : plus la correction est forte, plus le
    // bord perdu est large. Le rayon suit l'intensité demandée, par paliers
    // de 16 : deshake refuse tout autre rayon, et 30, 60 ou 90 % faisaient
    // échouer l'export.
    const edge = 16 * Math.min(4, Math.max(1, Math.round((8 + clip.stabilise * 56) / 16)));
    out.push(`deshake=rx=${edge}:ry=${edge}:edge=1:blocksize=8:contrast=125`);
  }
  return out;
}
/**
 * Les images intermédiaires d'un ralenti, calculées seulement quand le plan
 * ralentit vraiment. Au-dessus de 1, un ralenti n'a pas de sens.
 */
function slowFilter(clip, fps) {
  if (!clip.smoothSlow || !(clip.speed < 0.95)) return null;
  const rate = fps.n / fps.d;
  return `minterpolate=fps=${fmtRate(rate)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`;
}
const fmtRate = (r) => (Number.isInteger(r) ? String(r) : r.toFixed(4));
/** Un plan a-t-il besoin d'images avant lui pour que ses filtres se calent ? */
function needsLead(clip) {
  const denoise = DENOISE[clip.denoise || "none"];
  return Boolean(denoise?.temporal || clip.stabilise || clip.smoothSlow);
}
/**
 * Le préchauffage réellement possible pour ce plan à cet endroit du montage.
 *
 * Sans lui, un filtre temporel repartirait de zéro à chaque segment de rendu
 * et laisserait un sursaut toutes les dix secondes. Il est borné par ce que le
 * média contient avant : au tout début d'un fichier, il n'y a rien à lire.
 */
function lead(clip, sourceSeconds, fps) {
  if (!needsLead(clip)) return { frames: 0, seconds: 0 };
  const rate = fps.n / fps.d,
    speed = clip.speed || 1;
  const wanted = (LEAD_FRAMES * speed) / rate;
  const available = Math.max(0, Math.min(wanted, sourceSeconds));
  const frames = Math.floor((available * rate) / speed);
  if (frames < 1) return { frames: 0, seconds: 0 };
  return { frames, seconds: (frames * speed) / rate };
}
/** Le facteur de ralentissement du rendu qu'entraînent les choix d'un plan. */
function costFactor(clip) {
  let rate = DENOISE[clip.denoise || "none"]?.rate ?? 1;
  // deshake : 39 i/s contre 89 sans filtre. minterpolate : 5,5 contre 89.
  if (clip.stabilise) rate *= 0.44;
  if (clip.smoothSlow && clip.speed < 0.95) rate *= 0.062;
  return rate;
}
module.exports = {
  DENOISE,
  DENOISE_KEYS,
  LEAD_FRAMES,
  validate,
  sourceFilters,
  slowFilter,
  needsLead,
  lead,
  costFactor,
};
