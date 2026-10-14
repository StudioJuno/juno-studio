import { learnFromXmp, parseXmp, type XmpProfile } from "./xmp";
/**
 * Le style appris depuis un dossier Lightroom, rangé sur cet ordinateur.
 * Rien n'est envoyé nulle part, et rien n'est écrit dans le dossier lu.
 */
const KEY = "juno-xmp-profile";
export type StoredXmpProfile = XmpProfile & {
  /** Le nom du dossier d'où vient ce style, pour pouvoir le dire. */
  source: string;
  learnedAt: number;
};
export function readXmpProfile(): StoredXmpProfile | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as StoredXmpProfile;
    // Un stockage local peut être corrompu à la main : on ne fait confiance
    // qu'à ce qui a la bonne forme, et on oublie le reste sans rien casser.
    // Un tableau est un objet pour JavaScript : il faut l'écarter à la main,
    // sinon un stockage abîmé passe pour un style vide mais valide.
    const forme = (o: unknown) =>
      Boolean(o) && typeof o === "object" && !Array.isArray(o);
    if (
      !forme(p) ||
      typeof p.samples !== "number" ||
      !Number.isFinite(p.samples) ||
      !forme(p.signature) ||
      !forme(p.bias)
    )
      return undefined;
    for (const bloc of [p.signature, p.bias])
      for (const value of Object.values(bloc))
        if (typeof value !== "number" || !Number.isFinite(value))
          return undefined;
    return p;
  } catch {
    return undefined;
  }
}
export function writeXmpProfile(profile: StoredXmpProfile) {
  // Voir writeLook : un style perdu en silence est pire qu'un refus annoncé.
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    throw Error(
      "Le style appris n’a pas pu être enregistré : la réserve locale de Juno est pleine. Videz l’historique d’un projet, puis recommencez.",
    );
  }
}
export function forgetXmpProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
/** Lire un dossier déjà ouvert par le processus principal. */
export function learnFromFolder(folder: {
  nom: string;
  fichiers: string[];
}): StoredXmpProfile {
  const lus = folder.fichiers
    .map((t) => parseXmp(t))
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  return {
    ...learnFromXmp(lus),
    source: folder.nom,
    learnedAt: Date.now(),
  };
}
/** Ce qu'on peut dire à Johan du style retenu, en une phrase. */
export function describeProfile(p?: StoredXmpProfile): string {
  if (!p) return "Aucun style appris depuis Lightroom pour l’instant.";
  const noms: Record<string, string> = {
    exposure: "exposition",
    contrast: "contraste",
    highlights: "hautes lumières",
    shadows: "ombres",
    whites: "blancs",
    blacks: "noirs",
    vibrance: "vibrance",
    saturation: "saturation",
    clarity: "clarté",
  };
  const parts = [
    ...Object.entries(p.signature),
    ...Object.entries(p.bias),
  ].map(
    ([k, v]) =>
      `${noms[k] ?? k} ${(v as number) > 0 ? "+" : ""}${Math.round((v as number) * 100) / 100}`,
  );
  if (!parts.length)
    return `${p.samples} retouches lues dans « ${p.source} », mais aucune régularité assez nette pour en tirer un style.`;
  return `Style appris sur ${p.samples} retouches de « ${p.source} » : ${parts.join(", ")}.`;
}
