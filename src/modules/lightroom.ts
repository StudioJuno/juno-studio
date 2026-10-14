/**
 * Envoyer le tri à Lightroom Classic : ce que l'interface transmet pour chaque
 * photo, et ce qu'elle reçoit en retour. L'écriture des fichiers .xmp se fait
 * dans `electron/lightroom.cjs`.
 */
import type { Photo } from "../model";
export type LightroomOptions = {
  etoiles?: boolean;
  couleurs?: boolean;
  tri?: boolean;
  personnes?: boolean;
  /** Désactivé par défaut : l'import pose toutes les photos sur le premier chapitre. */
  chapitres?: boolean;
  /** Remplacer une note posée ailleurs (Aftershoot, Lightroom) au lieu de la garder. */
  remplacer?: boolean;
};
export type LightroomItem = {
  id: string;
  name: string;
  hash: string;
  size: number;
  stars: number;
  status: Photo["status"];
  protected: boolean;
  people: string[];
  chapter?: string;
};
export type LightroomEtat =
  | "nouveau"
  | "complete"
  | "conflit"
  | "non-concerne"
  | "introuvable"
  | "absent"
  | "disque-absent"
  | "different"
  | "refuse"
  | "erreur";
export type LightroomPlan = {
  token: string;
  libelles: string[];
  compte: Partial<Record<LightroomEtat, number>>;
  disques: string[];
  lignes: {
    id: string;
    name: string;
    etat: LightroomEtat;
    raison?: string;
    disque?: string;
    conflit?: { note?: number; couleur?: string };
  }[];
};
export type LightroomBilan = {
  token: string;
  ecrits: number;
  inchanges: number;
  conserves: number;
  echecs: { id: string; name: string; raison: string }[];
  dossiers: string[];
};
export type LightroomAPI = {
  plan: (input: { items: LightroomItem[]; options: LightroomOptions }) => Promise<LightroomPlan>;
  write: (token: string) => Promise<LightroomBilan>;
  undo: (token: string) => Promise<{ rendus: number; gardes: number }>;
  locate: (items: LightroomItem[]) => Promise<{ trouves: number; cherches: number } | null>;
  folder: (input: {
    items: LightroomItem[];
    options: LightroomOptions;
  }) => Promise<{ dossier: string; copies: number; echecs: { id: string; name: string; raison: string }[] } | null>;
  reveal: (file: string) => Promise<boolean>;
};
/**
 * Ce qu'on envoie d'une photo. Les photos générées ou sans original n'ont
 * rien à envoyer : elles n'existent pas dans Lightroom.
 */
export function lightroomItems(photos: Photo[], nomDe: (personId: string) => string | undefined): LightroomItem[] {
  return photos
    .filter((p) => !p.generated && !p.parentId && !p.previewOnly && p.hash)
    .map((p) => ({
      id: p.id,
      name: p.name,
      hash: p.hash,
      size: p.size || 0,
      stars: p.stars || 0,
      status: p.status,
      protected: !!p.protected,
      // Seulement les personnes que le photographe a nommées.
      people: [
        ...new Set(
          (p.analysis?.faces?.reads || [])
            .map((r) => (r.personId ? nomDe(r.personId) : undefined))
            .filter((n): n is string => !!n),
        ),
      ],
      chapter: p.chapter,
    }));
}
/** Une phrase par état, pour le bilan affiché avant l'envoi. */
export const PHRASES: Record<LightroomEtat, (n: number) => string> = {
  nouveau: (n) => `${n} nouveau(x) fichier(s) .xmp à côté du RAW`,
  complete: (n) => `${n} fichier(s) .xmp existant(s) complété(s), retouches conservées`,
  conflit: (n) => `${n} photo(s) déjà notée(s) ailleurs`,
  "non-concerne": (n) => `${n} photo(s) sans fichier annexe (JPEG, PNG, TIFF, DNG), non concernée(s)`,
  introuvable: (n) => `${n} original(aux) dont Juno ne connaît pas l’emplacement`,
  absent: (n) => `${n} original(aux) déplacé(s) ou supprimé(s)`,
  "disque-absent": (n) => `${n} photo(s) sur un disque débranché`,
  different: (n) => `${n} fichier(s) qui ne correspondent plus à l’original importé`,
  refuse: (n) => `${n} fichier(s) .xmp non reconnu(s), laissé(s) intact(s)`,
  erreur: (n) => `${n} photo(s) en erreur`,
};
