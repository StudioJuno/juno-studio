import type { Adjustments } from "../model";
/**
 * Apprendre un style depuis les photos livrées, et non depuis les réglages.
 *
 * Un dossier Lightroom donne les réglages appliqués ; un portfolio ne donne
 * que le résultat. On ne peut donc pas en déduire quelle correction a été
 * faite, mais on peut mesurer **à quoi ressemble** le rendu voulu : où tombent
 * les noirs, combien les ombres sont relevées, quel contraste, quelle
 * saturation, quelle dominante.
 *
 * C'est une cible, pas une recette. Juno mesure la photo à traiter, mesure
 * l'écart avec la cible, et corrige dans ce sens. Le gain est vérifiable :
 * il suffit de remesurer le résultat.
 *
 * Avantage décisif pour la diffusion : cela ne demande aucun fichier
 * Lightroom. N'importe quel photographe peut poser ses photos livrées.
 */
export type LookStats = {
  /** Luminance au 1er centile : là où tombent les noirs. */
  black: number;
  /** Au 10e centile : le relèvement des ombres. */
  shadow: number;
  /** Médiane : la place générale de l'image. */
  mid: number;
  /** Au 90e centile : les hautes lumières. */
  highlight: number;
  /** Au 99e centile : le point blanc. */
  white: number;
  /** L'écart entre le 90e et le 10e centile. */
  contrast: number;
  /** Chroma moyenne des tons moyens, de 0 à 1. */
  saturation: number;
  /** Rouge contre bleu dans les tons moyens, de -1 à 1. */
  warmth: number;
  /** Vert contre l'axe rouge-bleu : le magenta est négatif. */
  tint: number;
};
const LUMA = (r: number, g: number, b: number) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/**
 * Mesurer le rendu d'une image.
 *
 * Les tons moyens seuls portent la couleur : un ciel brûlé n'a pas de teinte
 * et une ombre bouchée non plus. La dominante et la saturation ne sont donc
 * mesurées qu'entre le huitième et les sept huitièmes de l'échelle.
 */
export function measureLook(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): LookStats {
  const pixels = width * height;
  if (!pixels || data.length < pixels * 3)
    throw Error("Image trop petite pour être mesurée");
  const step = data.length >= pixels * 4 ? 4 : 3;
  // Un histogramme de 256 cases suffit : on ne cherche pas mieux que le
  // centile, et compter est bien plus rapide que trier des millions de valeurs.
  const hist = new Uint32Array(256);
  let rSum = 0,
    gSum = 0,
    bSum = 0,
    chroma = 0,
    mids = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * step,
      r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const l = LUMA(r, g, b);
    hist[Math.min(255, Math.max(0, Math.round(l * 255)))]++;
    if (l > 0.125 && l < 0.875) {
      rSum += r;
      gSum += g;
      bSum += b;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      chroma += max ? (max - min) / max : 0;
      mids++;
    }
  }
  const centile = (q: number) => {
    const cible = q * pixels;
    let vu = 0;
    for (let v = 0; v < 256; v++) {
      vu += hist[v];
      if (vu >= cible) return v / 255;
    }
    return 1;
  };
  const r = mids ? rSum / mids : 0,
    g = mids ? gSum / mids : 0,
    b = mids ? bSum / mids : 0;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  const p10 = centile(0.1),
    p90 = centile(0.9);
  return {
    black: round(centile(0.01)),
    shadow: round(p10),
    mid: round(centile(0.5)),
    highlight: round(p90),
    white: round(centile(0.99)),
    contrast: round(p90 - p10),
    saturation: round(mids ? chroma / mids : 0),
    warmth: round(r + b ? (r - b) / (r + b) : 0),
    tint: round(r + g + b ? (g - (r + b) / 2) / ((r + g + b) / 3) : 0),
  };
}
export const LOOK_FIELDS: (keyof LookStats)[] = [
  "black",
  "shadow",
  "mid",
  "highlight",
  "white",
  "contrast",
  "saturation",
  "warmth",
  "tint",
];
export type ReferenceLook = {
  samples: number;
  median: LookStats;
  /** L'écart entre les neuvième et premier déciles, par mesure. */
  spread: LookStats;
  /** D'où viennent ces photos, pour pouvoir le dire. */
  source: string;
};
/** Il faut au moins ce nombre de photos livrées pour lire un rendu. */
export const MIN_LOOK_SAMPLES = 40;
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  if (!s.length) return 0;
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const pct = (v: number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length
    ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
    : 0;
};
/**
 * Le rendu de référence d'un photographe : la médiane de ses photos livrées.
 *
 * La médiane et non la moyenne, pour la même raison qu'ailleurs : une photo
 * volontairement très sombre ou une contre-jour ne doit pas emporter la cible.
 */
export function referenceLook(
  samples: LookStats[],
  source = "",
): ReferenceLook {
  const med = {} as LookStats,
    spread = {} as LookStats;
  for (const f of LOOK_FIELDS) {
    const values = samples
      .map((s) => s[f])
      .filter((v) => Number.isFinite(v));
    med[f] = Math.round(median(values) * 10000) / 10000;
    spread[f] =
      Math.round((pct(values, 0.9) - pct(values, 0.1)) * 10000) / 10000;
  }
  return { samples: samples.length, median: med, spread, source };
}
/**
 * De combien chaque mesure s'écarte de la cible. Positif : l'image est
 * au-dessus de la référence.
 */
export function lookGap(current: LookStats, reference: LookStats) {
  const gap = {} as LookStats;
  for (const f of LOOK_FIELDS)
    gap[f] = Math.round((current[f] - reference[f]) * 10000) / 10000;
  return gap;
}
/** Une note d'ensemble : la somme des écarts qui comptent pour l'œil. */
export function lookDistance(current: LookStats, reference: LookStats) {
  const g = lookGap(current, reference);
  return (
    Math.round(
      (Math.abs(g.black) +
        Math.abs(g.shadow) +
        Math.abs(g.mid) +
        Math.abs(g.highlight) +
        Math.abs(g.contrast) +
        Math.abs(g.saturation) +
        Math.abs(g.warmth)) *
        10000,
    ) / 10000
  );
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/**
 * Combien de crans de réglage déplacent la mesure d'une unité.
 *
 * Mesuré, pas estimé : un cran de « chaleur » déplace la mesure de 0,00356,
 * un cran de « saturation » de 0,00202, sur vingt photos livrées réelles.
 */
export const GAIN = { warmth: 281, saturation: 496 } as const;
/**
 * Un amortissement, pour ne pas dépasser la cible.
 *
 * La calibration ci-dessus est faite sur des photos déjà livrées ; appliquée
 * à une photo qui sort du boîtier, la même correction porte plus loin. Mesuré
 * sur cinquante RAW : un écart de 0,083 de chaleur se traduisait par un
 * déplacement de 0,118, soit un rapport de 1,42. D'où ce facteur.
 *
 * Un correcteur proportionnel se dose toujours en dessous de un : viser
 * exactement la cible d'un seul coup, c'est osciller autour.
 */
export const AMORTISSEMENT = 0.7;
/**
 * Viser le rendu de référence, sur les deux seules mesures que des photos
 * livrées savent enseigner.
 *
 * La tonalité n'est volontairement pas visée. La mesure l'a tranché : sur
 * cinquante RAW de Johan, la passe automatique de Juno tombe déjà à 0,000 de
 * sa médiane livrée, à 0,004 de ses noirs et à 0,022 de son contraste. Y
 * toucher a été essayé et **a dégradé le résultat**, parce qu'une photo claire
 * doit rester claire : la luminosité d'un portfolio mélange le style du
 * photographe et les scènes qu'il a photographiées.
 *
 * Restent deux écarts réels, que les fichiers Lightroom ne pouvaient pas
 * donner puisque la balance des blancs y est écrite en kelvins absolus :
 * Juno neutralise la dominante chaude que le photographe garde, et rend moins
 * saturé que lui.
 *
 * Ce que renvoie cette fonction est un **écart à ajouter**, jamais une valeur
 * à poser. La passe automatique a déjà neutralisé la dominante de l'image ;
 * remplacer sa correction au lieu de s'y ajouter double le mouvement et
 * dépasse la cible du double exactement. Utiliser `combineLook`.
 */
export function aimForLook(
  current: LookStats,
  reference?: ReferenceLook,
): Partial<Adjustments> {
  if (!reference || reference.samples < MIN_LOOK_SAMPLES) return {};
  const g = lookGap(current, reference.median);
  const out: Partial<Adjustments> = {};
  const warmth = clamp(-g.warmth * GAIN.warmth * AMORTISSEMENT, -40, 40);
  if (Math.abs(warmth) >= 1) out.warmth = Math.round(warmth);
  const saturation = clamp(
    -g.saturation * GAIN.saturation * AMORTISSEMENT,
    -40,
    40,
  );
  if (Math.abs(saturation) >= 1) out.saturation = Math.round(saturation);
  return out;
}
/**
 * Ajouter une visée de rendu à des réglages déjà calculés.
 *
 * L'addition est bornée aux limites de chaque réglage. Elle n'écrase jamais :
 * la balance des blancs mesurée sur l'image reste, la visée la décale.
 */
export function combineLook(
  base: Partial<Adjustments>,
  aim: Partial<Adjustments>,
): Partial<Adjustments> {
  const out = { ...base };
  for (const [field, value] of Object.entries(aim)) {
    const courant = (out as Record<string, number>)[field] ?? 0;
    (out as Record<string, number>)[field] = Math.round(
      clamp(courant + (value as number), -100, 100),
    );
  }
  return out;
}
