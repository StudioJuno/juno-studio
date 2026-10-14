import type { Photo } from "../model";

export type CommandRecord = {
  id: string;
  projectId: string;
  label: string;
  source: "manual" | "text" | "voice" | "recipe";
  created: number;
  updated: number;
  count: number;
  state: "done" | "undone" | "partial";
  group?: string;
  jobId?: string;
  undone?: number;
};
export type FieldChange = { path: string; before: unknown; after: unknown };
export type PhotoChange = {
  commandId: string;
  id: string;
  fields: FieldChange[];
  undone?: boolean;
};
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>;
  const keys = Object.keys(aa).filter((k) => aa[k] !== undefined);
  return (
    keys.length === Object.keys(bb).filter((k) => bb[k] !== undefined).length &&
    keys.every((k) => Object.hasOwn(bb, k) && same(aa[k], bb[k]))
  );
}
const fields = [
  "status",
  "stars",
  "protected",
  "chapter",
  "originalRecovery",
  "versions",
] as const;
/**
 * La proposition d'une passe d'album, le style appris qu'elle portait et son
 * drapeau d'apprentissage.
 *
 * Ils suivent la passe qui les a posés : annuler la passe les retire aussi.
 * Restés en place, la photo revenue à ses anciens réglages paraissait
 * corrigée à la main, et Juno apprenait l'inverse de sa proposition à chaque
 * photo parcourue ensuite. Rétablir la passe les remet tels qu'ils étaient au
 * moment de l'annuler (voir `restoreCommand`) : une correction déjà apprise
 * ne l'est pas deux fois.
 *
 * Ce n'est pas une retouche : le drapeau change quand Juno apprend, sans que
 * le photographe touche la photo. Il ne compte donc ni comme conflit à
 * l'annulation, ni comme « Réglage manuel » quand il est posé seul.
 */
export const SUIVI = ["proposal", "proposalProfile", "proposalLearned"] as const;
export const estSuivi = (path: string) =>
  (SUIVI as readonly string[]).includes(path);
/**
 * Store changed properties only: never thumbnails, originals or repeated undo
 * stacks. `suivi` ajoute la proposition d'album, que seul le journal des
 * commandes enregistre.
 */
export function photoChanges(
  before: Photo,
  after: Photo,
  suivi = false,
): FieldChange[] {
  const result: FieldChange[] = [];
  for (const key of new Set([
    ...Object.keys(before.adjustments || {}),
    ...Object.keys(after.adjustments || {}),
  ])) {
    const a = (before.adjustments as unknown as Record<string, unknown>)[key];
    const b = (after.adjustments as unknown as Record<string, unknown>)[key];
    if (!same(a, b))
      result.push({ path: "adjustments." + key, before: a, after: b });
  }
  for (const key of suivi ? [...fields, ...SUIVI] : fields)
    if (!same(before[key], after[key]))
      result.push({ path: key, before: before[key], after: after[key] });
  return result;
}
export function readField(photo: Photo, path: string): unknown {
  if (path.startsWith("adjustments."))
    return (photo.adjustments as unknown as Record<string, unknown>)[
      path.slice(12)
    ];
  return (photo as unknown as Record<string, unknown>)[path];
}
export function restoreFields(
  photo: Photo,
  changes: FieldChange[],
  redo: boolean,
): Photo {
  const next = {
    ...photo,
    adjustments: { ...photo.adjustments },
    editGroup: undefined,
  };
  if (changes.some((c) => c.path.startsWith("adjustments."))) {
    next.history = [...(photo.history || []), photo.adjustments].slice(-40);
    next.future = [];
  }
  for (const change of changes) {
    const target = change.path.startsWith("adjustments.")
      ? next.adjustments
      : next;
    const key = change.path.startsWith("adjustments.")
      ? change.path.slice(12)
      : change.path;
    const value = redo ? change.after : change.before;
    const record = target as unknown as Record<string, unknown>;
    if (value === undefined) delete record[key];
    else record[key] = structuredClone(value);
  }
  return next;
}
