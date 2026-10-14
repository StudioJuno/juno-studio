import type { Adjustments, Analysis, Photo } from "../model";
import { measureLook, type LookStats } from "./look";
import { applyXmpProfile, type XmpProfile } from "./xmp";
/**
 * The first pass Juno proposes on an album: neutralise the colour cast, place
 * the exposure, keep a whole scene consistent, and lean on what the
 * photographer corrected before. Everything here is local and reversible.
 */
export type ToneStats = {
  /** Average red, green and blue of the frame, 0 to 1, skin weighted. */
  cast: { r: number; g: number; b: number };
  brightness: number;
  clipped: number;
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/**
 * Colour cast, measured on mid tones and weighted towards skin. A dress or a
 * lawn filling the frame would drag a plain grey world average off course.
 */
export function measureCast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): ToneStats {
  let r = 0,
    g = 0,
    b = 0,
    weight = 0,
    total = 0,
    clip = 0;
  const pixels = width * height;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4,
      red = data[i],
      green = data[i + 1],
      blue = data[i + 2];
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    total += luma;
    if (luma > 249) clip++;
    // Mid tones only: blown highlights and blocked shadows carry no colour.
    if (luma < 25 || luma > 240) continue;
    // Skin sits in a narrow band; weight it so faces drive the white balance.
    const skin =
      red > green && green > blue && red - blue > 12 && red - blue < 120
        ? 3
        : 1;
    r += red * skin;
    g += green * skin;
    b += blue * skin;
    weight += skin;
  }
  const scale = weight > 0 ? weight * 255 : 1;
  return {
    cast:
      weight > 0
        ? { r: r / scale, g: g / scale, b: b / scale }
        : { r: 0.5, g: 0.5, b: 0.5 },
    brightness: total / Math.max(1, pixels) / 255,
    clipped: clip / Math.max(1, pixels),
  };
}
/**
 * Warmth and tint that cancel the measured cast, in Juno units. Bounded: an
 * automatic pass corrects a drift, it never reinvents the light of a scene.
 */
export function whiteBalance(stats: ToneStats | undefined) {
  if (!stats) return { warmth: 0, tint: 0 };
  const { r, g, b } = stats.cast;
  const mean = (r + g + b) / 3;
  if (mean <= 0.001) return { warmth: 0, tint: 0 };
  // Positive warmth adds red and removes blue, so the correction is the
  // opposite of the excess measured between the two channels.
  const warmth = clamp((-(r - b) / mean) * 55, -35, 35),
    tint = clamp(((g - mean) / mean) * 55, -25, 25);
  // Normalise negative zero: it would surface as "-0" in the interface.
  return {
    warmth: Math.round(warmth * 10) / 10 + 0,
    tint: Math.round(tint * 10) / 10 + 0,
  };
}
/** Exposure, shadows and highlights from what the frame actually shows. */
export function baseTone(a: Analysis): Partial<Adjustments> {
  const exposure = clamp(Math.log2(0.46 / Math.max(0.05, a.brightness)), -1, 1);
  return {
    exposure: Math.round(exposure * 100) / 100,
    highlights: a.clipped > 0.025 ? -20 : -8,
    shadows: a.brightness < 0.35 ? 18 : 7,
  };
}
/** Fields the automatic pass is allowed to touch, and their bounds. */
export const AUTO_FIELDS = {
  exposure: [-4, 4],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  warmth: [-100, 100],
  tint: [-100, 100],
  saturation: [-100, 100],
} as const;
export type AutoField = keyof typeof AUTO_FIELDS;
export type StyleProfile = Partial<Record<AutoField, number>> & {
  samples?: number;
};
/**
 * Ce qu'une proposition portait du style appris, réglage par réglage : les
 * écarts que applyProfile lui a ajoutés. Vide quand le profil ne s'appliquait
 * pas encore.
 */
export type ProfilPorte = Partial<Record<AutoField, number>>;
/**
 * Le style appris tel qu'une passe le pose sur ses propositions (voir
 * applyProfile) : rien tant qu'il n'a pas vu assez de corrections. La passe
 * d'album l'enregistre avec chaque proposition (`Photo.proposalProfile`).
 */
export function profilPorte(profile?: StyleProfile): ProfilPorte {
  if (!profile || (profile.samples ?? 0) < PROFILE_MIN_SAMPLES) return {};
  const porte: ProfilPorte = {};
  for (const field of Object.keys(AUTO_FIELDS) as AutoField[]) {
    const value = profile[field];
    if (typeof value === "number" && Number.isFinite(value) && value)
      porte[field] = value;
  }
  return porte;
}
/**
 * One correction: what Juno proposed, what the photographer kept, and the
 * learned style the proposal carried. Une photo d'album porte le profil du
 * moment de sa passe (voir correctionOf), jamais forcément celui d'aujourd'hui :
 * `carried` est donc obligatoire. Un appel qui l'omettrait quand même (un
 * ancien banc d'essai) est lu comme une proposition calculée à l'instant, qui
 * porte le profil `previous` s'il s'appliquait déjà.
 */
export type Correction = {
  proposed: Partial<Adjustments>;
  final: Partial<Adjustments>;
  carried: ProfilPorte;
  /** Les réglages que cette photo n'enseigne pas (l'exposition d'une photo sensible). */
  ignore?: AutoField[];
};
/**
 * What the photographer changed after the automatic pass. This is the whole
 * learning: no model, no training, just the habit read on each corrected
 * photo, applied to the next album.
 *
 * Ce que le photographe veut sur une photo, c'est le style que portait sa
 * proposition plus ce qu'il y a corrigé. Le profil vise cette habitude
 * elle-même, jamais « profil actuel + correction » : toutes les photos d'un
 * album portent le profil du moment de leur passe, pas celui d'aujourd'hui.
 * Appris photo par photo, « profil actuel + correction » rajoutait la même
 * correction à chaque photo : au-delà de l'habitude dès 40 photos, puis des
 * allers-retours jusqu'aux bornes ±100 (relecture du 29/09/2026).
 *
 * Le profil est la moyenne des habitudes lues sur les premières photos, puis
 * une moyenne glissante (une photo pèse 1/40) : il rejoint l'habitude dès
 * qu'elle est constante, ne la dépasse jamais (c'est toujours un mélange de
 * l'ancien profil et d'habitudes lues), suit un changement de style sur une
 * centaine de photos et reste dans les bornes des réglages.
 */
export function learnProfile(
  corrections: Correction[],
  previous?: StyleProfile,
): StyleProfile {
  const vues = previous?.samples ?? 0,
    count = corrections.length;
  const profile: StyleProfile = { samples: vues };
  const actuel = profilPorte(previous);
  // Moyenne tant que le profil a vu moins de 40 photos, puis 1/40 par photo.
  const weight = count
    ? Math.min(1, Math.max(count / (vues + count), Math.min(0.5, count / 40)))
    : 0;
  for (const field of Object.keys(AUTO_FIELDS) as AutoField[]) {
    const [min, max] = AUTO_FIELDS[field];
    const voulus = corrections
      .filter((c) => !c.ignore?.includes(field))
      .map(
        (c) =>
          ((c.carried ?? actuel)[field] ?? 0) +
          (c.final[field] ?? 0) -
          (c.proposed[field] ?? 0),
      )
      .filter((v) => Number.isFinite(v))
      .map((v) => clamp(v, min, max));
    if (!voulus.length) {
      if (previous?.[field] !== undefined) profile[field] = previous[field];
      continue;
    }
    voulus.sort((a, b) => a - b);
    // Median, not mean: one photo retouched oddly in a batch must not move
    // the profile.
    const median = voulus[Math.floor(voulus.length / 2)];
    const before = previous?.[field] ?? 0;
    // Au dix-millième : une photo ne pèse que 1/40, et un arrondi au
    // centième bloquait le profil à 0,2 de l'habitude (0,2 IL d'exposition).
    profile[field] =
      Math.round(clamp(before + (median - before) * weight, min, max) * 1e4) /
        1e4 +
      0;
  }
  profile.samples = vues + count;
  return profile;
}
/** Only a profile built on enough corrections is allowed to steer a pass. */
export const PROFILE_MIN_SAMPLES = 12;
/**
 * Ajoute le style appris à une proposition. Ce qu'il ajoute est exactement
 * profilPorte(profile), que la passe d'album enregistre avec la proposition :
 * learnProfile en a besoin pour lire l'habitude du photographe.
 */
export function applyProfile(
  settings: Partial<Adjustments>,
  profile?: StyleProfile,
): Partial<Adjustments> {
  if (!profile || (profile.samples ?? 0) < PROFILE_MIN_SAMPLES) return settings;
  const out = { ...settings };
  const porte = profilPorte(profile);
  for (const field of Object.keys(porte) as AutoField[]) {
    const delta = porte[field]!;
    const [min, max] = AUTO_FIELDS[field];
    out[field] =
      Math.round(clamp((out[field] ?? 0) + delta, min, max) * 100) / 100;
  }
  return out;
}
/**
 * Scenes: consecutive photos shot in the same light. Two hundred frames of a
 * drinks reception should not drift in eight directions, so they share the
 * median correction of their scene.
 */
export function sceneGroups(photos: Photo[], gapMs = 240000) {
  const ordered = [...photos]
    .filter((p) => p.analysis)
    .sort(
      (a, b) =>
        (a.capturedAt || a.created || 0) - (b.capturedAt || b.created || 0),
    );
  const scenes: string[][] = [];
  let run: Photo[] = [];
  for (const photo of ordered) {
    const previous = run[run.length - 1];
    const apart =
      previous &&
      previous.capturedAt &&
      photo.capturedAt &&
      Math.abs(photo.capturedAt - previous.capturedAt) > gapMs;
    // A jump in light is a new scene even without a gap in time.
    const lit =
      previous &&
      Math.abs(
        (previous.analysis?.brightness ?? 0) -
          (photo.analysis?.brightness ?? 0),
      ) > 0.22;
    if (previous && !apart && !lit) run.push(photo);
    else {
      if (run.length) scenes.push(run.map((p) => p.id));
      run = [photo];
    }
  }
  if (run.length) scenes.push(run.map((p) => p.id));
  return scenes;
}
/**
 * Une photo volontairement sombre ou très claire, jugée sur son aperçu, donc
 * comme le photographe l'a vue au boîtier : elle garde son exposition.
 */
export function sensible(a?: Pick<Analysis, "brightness">) {
  return !!a && (a.brightness < 0.13 || a.brightness > 0.86);
}
/**
 * The median of a scene, so one odd frame cannot pull its neighbours.
 *
 * `ecarts` : pour chaque photo, l'écart entre le rendu du boîtier et celui de
 * Juno (voir ecartDuRendu). L'exposition d'un RAW le porte : la moyenner telle
 * quelle avec celle d'un JPEG, ou d'un autre boîtier, tirait chaque photo vers
 * un réglage qui n'avait pas le même sens. On harmonise donc l'exposition
 * « comme sur le JPEG du boîtier », puis on rend à chaque photo son écart.
 *
 * `conservees` : les photos sensibles (voir `sensible`). Leur exposition ne
 * vote pas et ne bouge pas. Un JPEG sensible n'en a pas, mais un RAW sensible
 * en porte une, le rattrapage de son écart : elle était tirée vers la médiane
 * de la scène (+1,03 IL au lieu de +0,66 pour un aperçu à 0,12), alors que
 * la raison affichée dit « exposition conservée » (relecture du 29/09/2026).
 */
export function sceneSettings(
  settings: Partial<Adjustments>[],
  blend = 0.6,
  ecarts: number[] = [],
  conservees: boolean[] = [],
): Partial<Adjustments>[] {
  if (settings.length < 3) return settings;
  const vue = (s: Partial<Adjustments>, i: number, field: AutoField) =>
    field !== "exposure"
      ? s[field]
      : typeof s.exposure === "number" && !conservees[i]
        ? s.exposure + (ecarts[i] ?? 0)
        : undefined;
  const median: Partial<Adjustments> = {};
  for (const field of Object.keys(AUTO_FIELDS) as AutoField[]) {
    const values = settings
      .map((s, i) => vue(s, i, field))
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    if (values.length) median[field] = values[Math.floor(values.length / 2)];
  }
  return settings.map((own, i) => {
    const out = { ...own };
    for (const field of Object.keys(AUTO_FIELDS) as AutoField[]) {
      const m = median[field],
        v = vue(own, i, field);
      if (m === undefined || typeof v !== "number") continue;
      const retour = field === "exposure" ? (ecarts[i] ?? 0) : 0;
      const [min, max] = AUTO_FIELDS[field];
      out[field] =
        Math.round(clamp(v + (m - v) * blend - retour, min, max) * 100) / 100;
    }
    return out;
  });
}
/**
 * Le rendu de Juno d'un RAW, mesuré sur un développement réduit.
 *
 * L'analyse d'un RAW est faite sur son aperçu intégré, c'est-à-dire le rendu
 * du boîtier : il sert au tri, qui juge une scène comme le photographe l'a
 * vue. Mais Juno développe le RAW lui-même, bien plus sombre (0,56 contre
 * 0,80 de luminosité, 0,24 contre 0,42 sur deux CR3 d'essai), et c'est sur ce
 * développement que la retouche s'applique. La passe d'album mesurait tout sur
 * l'aperçu : l'exposition visait 0,46 sur le rendu du boîtier et l'export
 * sortait vers 0,29 (relecture du 29/09/2026).
 *
 * Changer la version fait remesurer les RAW à la prochaine passe.
 */
export const VERSION_RENDU = 1;
export type MesureRendu = ToneStats & { version: number; look?: LookStats };
/**
 * Une analyse qui porte la mesure du rendu. Le champ vit à côté de l'analyse
 * sans en faire partie du type : il n'a de sens que pour un RAW, et seules la
 * passe d'album et l'équilibrage le lisent.
 */
export type AnalyseAvecRendu = Analysis & { rendu?: MesureRendu };
export function renduDe(a?: Analysis): MesureRendu | undefined {
  const r = (a as AnalyseAvecRendu | undefined)?.rendu;
  return r?.version === VERSION_RENDU &&
    Number.isFinite(r.brightness) &&
    Number.isFinite(r.clipped) &&
    r.cast
    ? r
    : undefined;
}
/** Mesurer le rendu : les mêmes lectures que l'analyse, sur l'image rendue. */
export function mesureDuRendu(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): MesureRendu {
  const s = measureCast(data, width, height);
  let look: LookStats | undefined;
  try {
    look = measureLook(data, width, height);
  } catch {
    look = undefined;
  }
  return { version: VERSION_RENDU, ...s, ...(look ? { look } : {}) };
}
/**
 * L'écart, en diaphragmes, entre le rendu du boîtier et celui de Juno : négatif
 * quand Juno développe plus sombre. Borné à deux diaphragmes, pour qu'un
 * aperçu aberrant ne pousse pas la photo n'importe où ; zéro sans mesure.
 */
export function ecartDuRendu(a?: Analysis): number {
  const r = renduDe(a);
  if (!a || !r) return 0;
  return clamp(
    Math.log2(Math.max(0.02, r.brightness) / Math.max(0.02, a.brightness)),
    -2,
    2,
  );
}
/**
 * L'exposition visée, ramenée sur le développement de Juno : pour un RAW, on
 * retire l'écart entre le rendu du boîtier et le sien (voir ecartDuRendu).
 * Sans mesure du rendu (JPEG, TIFF), rien ne change.
 */
function versLeRendu(exposure: number, a: Analysis) {
  const [min, max] = AUTO_FIELDS.exposure;
  return (
    Math.round(clamp(exposure - ecartDuRendu(a), min, max) * 100) / 100 + 0
  );
}
/**
 * Exposition, hautes lumières et ombres visées sur ce que Juno exporte : le
 * bouton « Auto » de l'éditeur, avec la même mesure que la passe d'album.
 *
 * « Auto » réglait un RAW sur son aperçu intégré : après une passe d'album
 * juste (export à 0,439 sur 4R7A1611.CR3), un clic donnait −0,79 IL et un
 * export à 0,296 (relecture du 29/09/2026).
 */
export function toneExporte(a: Analysis): Partial<Adjustments> {
  const tone = baseTone(a);
  return renduDe(a)
    ? { ...tone, exposure: versLeRendu(tone.exposure ?? 0, a) }
    : tone;
}
/**
 * The complete first pass for one photo, before the scene is harmonised.
 *
 * L'ordre compte. Le style Lightroom (`xmp`) remplace les réglages que Juno
 * ne calcule pas (contraste, saturation...), puis le style appris s'ajoute en
 * dernier, sur chaque réglage, comme learnProfile le suppose. Posé avant, il
 * était écrasé par le style Lightroom : le photographe corrigeait toujours le
 * même écart, et learnProfile l'ajoutait au profil à chaque photo. Pour une
 * habitude à +15 sur un style Lightroom à +8, le contraste appris valait +71
 * après 400 corrections et montait jusqu'à la borne, puis s'appliquait tel
 * quel une fois le style Lightroom oublié (relecture du 29/09/2026).
 */
export function autoTone(
  a: Analysis,
  stats?: ToneStats,
  profile?: StyleProfile,
  xmp?: XmpProfile,
): Partial<Adjustments> {
  // A deliberately dark or bright frame keeps its exposure; only its colour
  // cast is corrected, because a cast is never a choice. Le style appris s'y
  // ajoute comme ailleurs : une proposition qui ne le porterait pas ferait
  // dériver learnProfile.
  const tone = sensible(a) ? {} : baseTone(a);
  const rendu = renduDe(a);
  // Un RAW : Juno décide comme sur le JPEG du boîtier (intention de la scène,
  // hautes lumières, ombres), puis rattrape l'écart entre ce JPEG et son propre
  // développement. Mesuré sur sept CR3 : exports à 0,44-0,47 au lieu de
  // 0,27-0,34. Une photo volontairement sombre ou claire retrouve le rendu du
  // boîtier au lieu de garder celui, plus sombre, de LibRaw, et rien de plus :
  // sceneSettings ne la rapproche pas de sa scène. La dominante, elle, se lit
  // sur ce que Juno rend : c'est là que la chaleur s'applique.
  const base = rendu
    ? {
        ...tone,
        exposure: versLeRendu(tone.exposure ?? 0, a),
        ...whiteBalance(rendu),
      }
    : { ...tone, ...whiteBalance(stats) };
  // L'exposition d'une photo sensible est conservée : le style appris n'y
  // touche pas non plus. Sinon « exposition conservée » recevait +0,3 IL
  // appris sur les photos normales (relecture du 29/09/2026).
  return applyProfile(applyXmpProfile(base, xmp), sensible(a) ? sansExposition(profile) : profile);
}
/** Le style appris, sans son exposition. */
export function sansExposition<T extends StyleProfile | ProfilPorte | undefined>(p: T): T {
  if (!p || (p as ProfilPorte).exposure === undefined) return p;
  const { exposure: _, ...reste } = p as ProfilPorte & StyleProfile;
  return reste as T;
}
