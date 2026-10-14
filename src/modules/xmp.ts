import type { Adjustments } from "../model";
/**
 * Lire les retouches Lightroom d'un dossier, pour en tirer un style.
 *
 * Un fichier XMP porte les réglages réellement appliqués à une photo, pas un
 * preset. Sur un album entier, ils disent ce que le photographe fait toujours
 * et ce qu'il ajuste image par image.
 *
 * Deux pièges commandent la conception de ce module.
 *
 * 1. Beaucoup de valeurs constantes ne sont pas des choix mais les réglages
 *    d'origine de Lightroom. « Sharpness 40 » est appliqué par Adobe à tout
 *    fichier brut : le lire comme une signature ferait apprendre le défaut
 *    d'Adobe au lieu du style du photographe.
 * 2. La balance des blancs est écrite en kelvins absolus, avec
 *    WhiteBalance="Custom". Sans la balance d'origine du boîtier, on ne peut
 *    pas en déduire le décalage appliqué. Elle n'est donc pas apprise : Juno
 *    la mesure sur l'image, ce qui est une base plus sûre.
 */
export type LightroomSettings = {
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  vibrance?: number;
  saturation?: number;
  clarity?: number;
  sharpening?: number;
  texture?: number;
  dehaze?: number;
  temperature?: number;
  tint?: number;
};
/** Nom Lightroom, nom Juno, et la valeur qu'Adobe pose sans qu'on y touche. */
const FIELDS: {
  xmp: string;
  key: keyof LightroomSettings;
  def: number;
  scale?: number;
}[] = [
  { xmp: "Exposure2012", key: "exposure", def: 0 },
  { xmp: "Contrast2012", key: "contrast", def: 0 },
  { xmp: "Highlights2012", key: "highlights", def: 0 },
  { xmp: "Shadows2012", key: "shadows", def: 0 },
  { xmp: "Whites2012", key: "whites", def: 0 },
  { xmp: "Blacks2012", key: "blacks", def: 0 },
  { xmp: "Vibrance", key: "vibrance", def: 0 },
  { xmp: "Saturation", key: "saturation", def: 0 },
  { xmp: "Clarity2012", key: "clarity", def: 0 },
  { xmp: "Texture", key: "texture", def: 0 },
  { xmp: "Dehaze", key: "dehaze", def: 0 },
  // Adobe applique 40 à tout fichier brut : ce n'est pas une décision.
  { xmp: "Sharpness", key: "sharpening", def: 40, scale: 100 / 150 },
  { xmp: "Temperature", key: "temperature", def: Number.NaN },
  // Lightroom va de -150 à +150 là où Juno va de -100 à +100.
  { xmp: "Tint", key: "tint", def: 0, scale: 2 / 3 },
];
/** Les champs que Juno sait reproduire, et qui se transposent tels quels. */
export const MAPPED: (keyof LightroomSettings & keyof Adjustments)[] = [
  "exposure",
  "contrast",
  "highlights",
  "shadows",
  "whites",
  "blacks",
  "vibrance",
  "saturation",
  "clarity",
];
/**
 * Ce que Lightroom sait faire et Juno pas encore, ou pas de la même manière.
 * C'est dit, plutôt que transposé approximativement sur un réglage voisin.
 *
 * La netteté est dans cette liste pour deux raisons : Lightroom la règle avec
 * quatre paramètres liés (quantité, rayon, détail, masquage) que Juno n'a pas,
 * et sa valeur d'origine sur un fichier brut est 40, posée par Adobe. Copier
 * le nombre donnerait une précision qui n'existe pas.
 */
export const UNMAPPED = [
  "texture",
  "dehaze",
  "temperature",
  "tint",
  "sharpening",
] as const;
export function parseXmp(text: string): LightroomSettings | undefined {
  const s = String(text);
  if (!s.includes("crs:")) return undefined;
  const out: LightroomSettings = {};
  let found = 0;
  for (const f of FIELDS) {
    // Lightroom et Camera Raw écrivent les valeurs positives avec leur signe
    // (Exposure2012="+0.30", Contrast2012="+8") : sans le « + », tout réglage
    // relevé était ignoré et le style appris ne gardait que les baisses.
    const m =
      s.match(new RegExp(`crs:${f.xmp}="([+-]?[0-9.]+)"`)) ??
      s.match(new RegExp(`crs:${f.xmp}>([+-]?[0-9.]+)<`));
    if (!m) continue;
    const value = Number(m[1]);
    if (!Number.isFinite(value)) continue;
    out[f.key] = f.scale ? value * f.scale : value;
    found++;
  }
  return found ? out : undefined;
}
const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]
    : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const percentile = (v: number[], q: number) => {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};
export type FieldReading = {
  field: keyof LightroomSettings;
  median: number;
  p10: number;
  p90: number;
  spread: number;
  /** L'écart entre le neuvième et le premier décile, rapporté à l'amplitude. */
  variation: number;
  samples: number;
  /** Une valeur constante et différente du réglage d'origine de Lightroom. */
  signature: boolean;
};
/** En deçà de cette part d'amplitude, un réglage est tenu pour constant. */
export const SIGNATURE_VARIATION = 0.06;
/**
 * Au-delà de cette dispersion, la médiane n'apprend plus rien.
 *
 * Un réglage qui prend n'importe quelle valeur d'une photo à l'autre a bien
 * une médiane, mais elle ne décrit aucune habitude : c'est le milieu du
 * hasard. Sans cette borne, un dossier mélangeant plusieurs mariages très
 * différents produirait un « style » qui n'est celui de personne.
 */
export const BIAS_MAX_VARIATION = 0.25;
/** Il faut au moins ce nombre de photos pour croire à une régularité. */
export const MIN_SAMPLES = 30;
const AMPLITUDE: Partial<Record<keyof LightroomSettings, number>> = {
  exposure: 10,
  sharpening: 100,
};
export type XmpProfile = {
  samples: number;
  /** Ce que le photographe applique à toutes ses photos : c'est sa patte. */
  signature: Partial<Adjustments>;
  /**
   * Pour un réglage qui varie d'une image à l'autre, la valeur médiane reste
   * une information : elle dit dans quel sens il penche. Elle s'ajoute à ce que
   * Juno calcule, elle ne le remplace pas.
   */
  bias: Partial<Adjustments>;
  /** Ce qu'il ajuste image par image : Juno doit le calculer, pas le copier. */
  adaptive: FieldReading[];
  readings: FieldReading[];
  /** Ce qui a été lu mais que Juno ne sait pas reproduire. */
  ignored: string[];
};
/**
 * Tirer un style d'un ensemble de retouches réelles.
 *
 * Un réglage n'entre dans la signature que s'il est à la fois **constant** et
 * **différent du réglage d'origine de Lightroom**. Sans la seconde condition,
 * on apprendrait les défauts d'Adobe : la netteté à 40 est posée par Lightroom
 * sur tout fichier brut, pas choisie.
 */
export function learnFromXmp(files: LightroomSettings[]): XmpProfile {
  const readings: FieldReading[] = [];
  const signature: Partial<Adjustments> = {};
  const bias: Partial<Adjustments> = {};
  const ignored: string[] = [];
  for (const f of FIELDS) {
    const values = files
      .map((x) => x[f.key])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (values.length < MIN_SAMPLES) continue;
    const amplitude = AMPLITUDE[f.key] ?? 200;
    const p10 = percentile(values, 0.1),
      p90 = percentile(values, 0.9);
    const med = median(values);
    const defaut = f.scale && Number.isFinite(f.def) ? f.def * f.scale : f.def;
    const constant = (p90 - p10) / amplitude <= SIGNATURE_VARIATION;
    // Une constante égale au réglage d'origine n'apprend rien sur personne.
    //
    // Le seuil vaut un quart de centième de l'amplitude, soit une demi-unité
    // sur une échelle de -100 à +100. Lightroom n'écrit que des entiers : une
    // médiane différente du réglage d'origine, même de un, est donc un geste
    // répété et non du bruit de mesure.
    const chosen =
      !Number.isFinite(defaut) || Math.abs(med - defaut) >= amplitude * 0.0025;
    const reading: FieldReading = {
      field: f.key,
      median: Math.round(med * 100) / 100,
      p10: Math.round(p10 * 100) / 100,
      p90: Math.round(p90 * 100) / 100,
      spread: Math.round((p90 - p10) * 100) / 100,
      variation: Math.round(((p90 - p10) / amplitude) * 1000) / 1000,
      samples: values.length,
      signature: constant && chosen,
    };
    readings.push(reading);
    if (!MAPPED.includes(f.key as never)) {
      ignored.push(f.key);
      continue;
    }
    if (reading.signature)
      (signature as Record<string, number>)[f.key] = reading.median;
    // Un réglage laissé à sa valeur d'origine n'apprend rien, et un réglage
    // trop dispersé non plus : dans les deux cas, pas de biais.
    else if (
      chosen &&
      reading.median !== 0 &&
      reading.variation <= BIAS_MAX_VARIATION
    )
      (bias as Record<string, number>)[f.key] = reading.median;
  }
  return {
    samples: files.length,
    signature,
    bias,
    adaptive: readings.filter(
      (r) => !r.signature && MAPPED.includes(r.field as never),
    ),
    readings,
    ignored,
  };
}
/**
 * Les réglages que Juno calcule lui-même à partir de l'image.
 *
 * Pour ceux-là, une valeur lue chez Lightroom ne remplace jamais une mesure
 * faite sur la photo, même quand le photographe la laisse constante.
 *
 * Deux raisons, et la seconde a été mesurée. D'abord une récupération de
 * hautes lumières dépend de ce qui est brûlé dans CETTE image. Ensuite, et
 * surtout, un réglage qui porte le même nom dans les deux logiciels n'y fait
 * pas la même chose : transposer « Ombres +21 » de Lightroom éloignait le
 * résultat du rendu réellement livré par Johan de 0,056, à lui seul, quand les
 * quatre autres réglages appris étaient neutres ou utiles.
 *
 * C'est le même piège que la netteté, ici appliqué partout.
 */
export const COMPUTED = new Set([
  "exposure",
  "highlights",
  "shadows",
  "warmth",
  "tint",
]);
/**
 * Poser le style appris sur ce que la passe automatique vient de proposer.
 *
 * Trois cas, et un seul principe : ne jamais remplacer une mesure par une
 * habitude, sauf quand l'habitude est invariable.
 *
 * - Un réglage que Juno ne calcule pas prend la valeur apprise : la médiane
 *   vaut mieux que zéro, et personne d'autre ne la fournit.
 * - Un réglage que Juno calcule lui est laissé, constant ou non chez le
 *   photographe, parce que le même nombre ne produit pas la même image dans
 *   les deux logiciels. Pour la couleur, c'est le rendu livré qui sert de
 *   cible (voir `look.ts`) ; pour la tonalité, la mesure de l'image suffit.
 */
export function applyXmpProfile(
  settings: Partial<Adjustments>,
  profile?: XmpProfile,
): Partial<Adjustments> {
  if (!profile || profile.samples < MIN_SAMPLES) return settings;
  const out = { ...settings };
  for (const bloc of [profile.signature, profile.bias])
    for (const [field, value] of Object.entries(bloc)) {
      if (COMPUTED.has(field)) continue;
      (out as Record<string, number>)[field] = value as number;
    }
  return out;
}
/** Ce que l'apprentissage a laissé de côté, et pourquoi, en français. */
export function explainProfile(profile: XmpProfile): string[] {
  const dit: string[] = [];
  const laisses = profile.adaptive
    .filter((r) => COMPUTED.has(r.field))
    .map((r) => r.field);
  if (laisses.length)
    dit.push(
      `${laisses.join(", ")} : vous les ajustez photo par photo, Juno continue donc de les mesurer sur l'image.`,
    );
  if (profile.ignored.includes("temperature") || profile.ignored.includes("tint"))
    dit.push(
      "La balance des blancs est écrite en kelvins absolus par Lightroom : sans la balance d'origine du boîtier, le décalage que vous avez appliqué est indéterminable. Juno la mesure sur l'image.",
    );
  if (profile.ignored.includes("sharpening"))
    dit.push(
      "La netteté de Lightroom se règle avec quatre paramètres liés, et vaut 40 d'origine sur tout fichier brut : le nombre n'aurait pas le même sens dans Juno.",
    );
  if (profile.ignored.includes("texture"))
    dit.push("Juno n'a pas encore l'équivalent du réglage Texture.");
  return dit;
}
