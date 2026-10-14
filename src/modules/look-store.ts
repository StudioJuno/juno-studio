import {
  measureLook,
  referenceLook,
  MIN_LOOK_SAMPLES,
  type LookStats,
  type ReferenceLook,
} from "./look";
/** Le rendu de référence appris depuis des photos livrées, rangé localement. */
const KEY = "juno-look-profile";
export type StoredLook = ReferenceLook & { learnedAt: number };
export function readLook(): StoredLook | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as StoredLook;
    const forme = (o: unknown) =>
      Boolean(o) && typeof o === "object" && !Array.isArray(o);
    if (
      !forme(p) ||
      typeof p.samples !== "number" ||
      !Number.isFinite(p.samples) ||
      !forme(p.median) ||
      !forme(p.spread)
    )
      return undefined;
    for (const v of Object.values(p.median))
      if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
    return p;
  } catch {
    return undefined;
  }
}
export function writeLook(look: StoredLook) {
  // Une écriture refusée, c'est un rendu appris qu'on retrouve disparu au
  // prochain démarrage sans avoir rien vu. L'appelant affiche ce message.
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    throw Error(
      "Le rendu appris n’a pas pu être enregistré : la réserve locale de Juno est pleine. Videz l’historique d’un projet, puis recommencez.",
    );
  }
}
export function forgetLook() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
/**
 * Mesurer un lot de photos livrées.
 *
 * Electron rend ses images en BGRA : le rouge et le bleu sont inversés par
 * rapport à ce que le reste de Juno manipule. Les remettre en place ici plutôt
 * que dans la mesure évite d'avoir deux conventions dans le code.
 */
export function learnLookFromImages(
  folder: {
    nom: string;
    images: { width: number; height: number; bgra: Uint8Array | ArrayBuffer }[];
  },
): StoredLook {
  const stats: LookStats[] = [];
  for (const img of folder.images) {
    const src = new Uint8ClampedArray(
      img.bgra instanceof Uint8Array ? img.bgra : new Uint8Array(img.bgra),
    );
    if (src.length < img.width * img.height * 4) continue;
    const rgba = new Uint8ClampedArray(src.length);
    for (let i = 0; i < src.length; i += 4) {
      rgba[i] = src[i + 2];
      rgba[i + 1] = src[i + 1];
      rgba[i + 2] = src[i];
      rgba[i + 3] = src[i + 3];
    }
    try {
      stats.push(measureLook(rgba, img.width, img.height));
    } catch {}
  }
  return {
    ...referenceLook(stats, folder.nom),
    learnedAt: Date.now(),
  };
}
/** Ce qu'on peut dire de ce rendu, en français, sans jargon. */
export function describeLook(look?: StoredLook): string {
  if (!look) return "Aucun rendu appris depuis vos photos livrées.";
  if (look.samples < MIN_LOOK_SAMPLES)
    return `Seulement ${look.samples} photos lues dans « ${look.source} » : il en faut au moins ${MIN_LOOK_SAMPLES} pour lire un rendu.`;
  const m = look.median;
  const chaleur =
    m.warmth > 0.04
      ? "un rendu chaud"
      : m.warmth < -0.04
        ? "un rendu froid"
        : "une couleur neutre";
  const sat =
    m.saturation > 0.3
      ? "des couleurs soutenues"
      : m.saturation < 0.2
        ? "des couleurs douces"
        : "une saturation moyenne";
  return `Rendu appris sur ${look.samples} photos de « ${look.source} » : ${chaleur}, ${sat}.`;
}
/** Ce que ce rendu ne peut pas apprendre, et pourquoi. */
export const LOOK_LIMITS =
  "Des photos livrées disent la couleur voulue, pas la correction appliquée. Juno ne vise donc que la chaleur et la saturation : la luminosité d’un album dépend d’abord des scènes photographiées, et la viser dégradait le résultat.";
