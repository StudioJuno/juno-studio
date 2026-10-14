import type { Adjustments, Photo } from "../model";
import {
  AUTO_FIELDS,
  PROFILE_MIN_SAMPLES,
  learnProfile,
  sensible,
  type AutoField,
  type Correction,
  type StyleProfile,
} from "./auto-tone";
/**
 * The house style, learned from what the photographer corrects after each
 * automatic pass. Stored beside the catalogue, never sent anywhere.
 */
const KEY = "juno-style-profile";
export function readProfile(): StyleProfile | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as StyleProfile;
    if (!parsed || typeof parsed !== "object") return undefined;
    // Never trust a stored value blindly: a corrupt profile would silently
    // wreck every future album.
    const clean: StyleProfile = { samples: 0 };
    for (const field of Object.keys(AUTO_FIELDS) as AutoField[]) {
      const value = parsed[field];
      const [min, max] = AUTO_FIELDS[field];
      if (typeof value === "number" && Number.isFinite(value))
        clean[field] = Math.max(min, Math.min(max, value));
    }
    clean.samples =
      typeof parsed.samples === "number" && parsed.samples >= 0
        ? Math.min(100000, Math.floor(parsed.samples))
        : 0;
    return clean;
  } catch {
    return undefined;
  }
}
export function writeProfile(profile: StyleProfile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
  } catch {
    // A full disk must not break a retouch; the profile is an optimisation.
  }
}
export function forgetProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
/**
 * Record one correction: what Juno proposed, what the photographer kept, and
 * the learned style the proposal carried (voir learnProfile).
 */
export function rememberCorrection(
  proposed: Partial<Adjustments>,
  final: Partial<Adjustments>,
  carried: Correction["carried"],
) {
  const next = learnProfile([{ proposed, final, carried }], readProfile());
  writeProfile(next);
  return next;
}
/** Plain sentence for the interface: is the profile steering anything yet? */
export function profileStatus(profile = readProfile()) {
  const samples = profile?.samples ?? 0;
  if (samples >= PROFILE_MIN_SAMPLES)
    return `Juno suit votre style, appris sur ${samples} retouches.`;
  return `Juno apprend votre style : ${samples} retouches sur ${PROFILE_MIN_SAMPLES} avant qu’il s’applique.`;
}
const NOMS: Record<AutoField, string> = {
  exposure: "Exposition",
  contrast: "Contraste",
  highlights: "Hautes lumières",
  shadows: "Ombres",
  warmth: "Chaleur",
  tint: "Teinte",
  saturation: "Saturation",
};
const signe = (v: number, decimales: number) =>
  (v > 0 ? "+" : v < 0 ? "−" : "") +
  Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: decimales });
/**
 * Ce que Juno a appris des corrections, en clair, pour les Paramètres : les
 * réglages qu'il ajoute à chaque passe d'album et le nombre de photos lues.
 */
export function describeLearned(profile = readProfile()) {
  const samples = profile?.samples ?? 0;
  if (!profile || !samples)
    return "Juno n’a encore rien appris de vos corrections. Après une passe d’album, retouchez comme d’habitude : il retient ce que vous corrigez, photo par photo.";
  const reglages = (Object.keys(AUTO_FIELDS) as AutoField[])
    .map((f) => [f, profile[f] ?? 0] as const)
    .filter(([f, v]) => Math.abs(v) >= (f === "exposure" ? 0.01 : 0.1))
    .map(([f, v]) =>
      f === "exposure"
        ? `${NOMS[f]} ${signe(v, 2)} IL`
        : `${NOMS[f]} ${signe(v, 1)}`,
    );
  const photos = `${samples} photo${samples > 1 ? "s" : ""} corrigée${samples > 1 ? "s" : ""}`;
  const appris = reglages.length
    ? `Appris sur ${photos} après une passe d’album : ${reglages.join(", ")}.`
    : `Appris sur ${photos} après une passe d’album : vous gardez les propositions de Juno, il n’y ajoute rien.`;
  return samples >= PROFILE_MIN_SAMPLES
    ? `${appris} Chaque nouvelle passe ajoute ces écarts à ses propositions.`
    : `${appris} Ce style s’appliquera aux prochaines passes à partir de ${PROFILE_MIN_SAMPLES} photos corrigées.`;
}
/**
 * Fold one finished photo into the profile: the gap between what Juno proposed
 * and what the photographer kept, with the learned style the proposal carried.
 * Returns the correction when there is something to learn, so the caller can
 * mark the photo and never count it twice.
 *
 * Une proposition posée jusqu'à la 1.2.2 n'a pas de `proposalProfile` : le
 * style appris n'était alors jamais enregistré dans l'application, elle n'en
 * portait donc aucun.
 */
export function correctionOf(photo: Photo): Correction | undefined {
  const proposed = photo.proposal;
  if (!proposed || photo.proposalLearned) return undefined;
  const final = photo.adjustments as Partial<Adjustments>;
  // Une photo volontairement sombre ou claire garde son exposition : ce que
  // le photographe en fait (la laisser, ou la régler pour elle seule) n'est
  // pas une habitude. La compter tirait l'exposition apprise vers zéro.
  const ignore: AutoField[] = sensible(photo.analysis) ? ["exposure"] : [];
  const moved = (Object.keys(AUTO_FIELDS) as AutoField[]).some(
    (f) => !ignore.includes(f) && Math.abs((final[f] ?? 0) - (proposed[f] ?? 0)) > 0.01,
  );
  return moved
    ? { proposed, final, carried: photo.proposalProfile ?? {}, ...(ignore.length ? { ignore } : {}) }
    : undefined;
}
/**
 * Apprendre de la photo que le photographe vient de quitter, une seule fois,
 * sur son état ENREGISTRÉ le plus récent.
 *
 * App.tsx lisait la photo telle qu'elle était à son ouverture, et n'y
 * rejouait que les écritures encore en file : une fois les réglages
 * enregistrés, il ne voyait plus aucun écart et n'apprenait rien (100 photos
 * corrigées, style jamais écrit, relecture du 29/09/2026). On attend donc que
 * la file d'écriture soit vide, puis on relit le catalogue. Le drapeau
 * `proposalLearned` est posé dans la même transaction que la relecture qui
 * décide : quitter deux fois la même photo ne compte qu'une correction.
 * Rien d'appris (écriture en échec, photo disparue) : la photo le sera la
 * prochaine fois qu'on la quittera.
 */
export async function learnWhenLeaving(
  id: string,
  catalogue: {
    flush: () => Promise<void>;
    read: (id: string) => Promise<Photo | undefined>;
    modify: (id: string, update: (p: Photo) => Photo) => Promise<Photo>;
  },
) {
  try {
    await catalogue.flush();
    const saved = await catalogue.read(id);
    // Une photo sans rien à apprendre n'est pas réécrite : sa révision ne
    // bouge pas, et une passe d'album en cours ne la croit pas modifiée.
    if (!saved || !correctionOf(saved)) return undefined;
    let correction: Correction | undefined;
    await catalogue.modify(id, (latest) => {
      correction = correctionOf(latest);
      return correction ? { ...latest, proposalLearned: true } : latest;
    });
    if (!correction) return undefined;
    return rememberCorrection(
      correction.proposed,
      correction.final,
      correction.carried,
    );
  } catch {
    return undefined;
  }
}
