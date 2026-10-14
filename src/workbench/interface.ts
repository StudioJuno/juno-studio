// Petites règles de l'espace photo, sorties d'App.tsx pour être vérifiées sans
// lancer l'application.
import type { Job } from "../modules/jobs";

/**
 * Étoiles au clavier : c'est la touche qui compte, pas le caractère produit.
 * Sur un clavier AZERTY, la rangée du haut donne « à & é " ' ( » sans Maj ;
 * lire le caractère obligeait à tenir Maj pour noter une photo.
 */
export function etoilesDeTouche(e: {
  key: string;
  code: string;
}): number | undefined {
  const touche = /^(?:Digit|Numpad)([0-5])$/.exec(e.code);
  if (touche) return Number(touche[1]);
  return /^[0-5]$/.test(e.key) ? Number(e.key) : undefined;
}

/**
 * Original ou retouche. Sur un Mac AZERTY, « \ » ne s'obtient qu'avec ⌥⇧ : on
 * l'accepte donc avec Option, et Y (comme dans Lightroom) le remplace sans
 * aucun modificateur.
 */
export function basculeOriginal(e: {
  key: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): boolean {
  if (e.metaKey || e.ctrlKey) return false;
  return e.key === "\\" || (!e.altKey && e.key.toLowerCase() === "y");
}

/**
 * La date du jour sur cet ordinateur. `toISOString()` donne la date en UTC :
 * un projet créé à 0 h 30 à Paris, au retour d'un mariage, recevait celle de
 * la veille.
 */
export function dateDuJour(d = new Date()): string {
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Ce qui part à l'import, au moment où on le lance : rien n'est encore ajouté. */
export function annonceImport(photos: number, medias: number): string {
  const envoyes = [
    photos ? `${photos} fichier(s) photo` : "",
    medias ? `${medias} vidéo(s) ou son(s)` : "",
  ]
    .filter(Boolean)
    .join(" et ");
  return `${envoyes} envoyé(s) à l’import. ${
    photos
      ? "Le bilan s’affichera à la fin de la tâche ; suivi dans Activité."
      : "Suivi dans les tâches de l’espace vidéo."
  }`;
}

/**
 * Le bilan réel d'un import photo, une fois la tâche finie : les doublons
 * ignorés et les échecs ne sont pas des photos ajoutées. Rien tant que la
 * tâche n'est pas finie (une pause peut reprendre).
 */
export function bilanImport(
  job: Pick<
    Job,
    "state" | "cursor" | "skipped" | "errorCount" | "projectName"
  >,
): string | undefined {
  if (!["done", "failed", "cancelled"].includes(job.state)) return undefined;
  const ajoutees = Math.max(
    0,
    job.cursor - (job.skipped || 0) - (job.errorCount || 0),
  );
  const parts = [`${ajoutees} photo(s) ajoutée(s)`];
  if (job.skipped) parts.push(`${job.skipped} doublon(s) ignoré(s)`);
  if (job.errorCount)
    parts.push(`${job.errorCount} fichier(s) à reprendre dans Activité`);
  const debut =
    job.state === "done"
      ? "Import terminé"
      : job.state === "cancelled"
        ? "Import annulé"
        : "Import interrompu";
  return `${debut} dans « ${job.projectName} » : ${parts.join(", ")}.`;
}

/** Où était la photo active, dans quel filtre. */
export type PlaceActive = { cle: string; id: string; index: number };

/**
 * La photo à montrer. Si la photo active vient de sortir du filtre (écartée
 * sous « Gardées », par exemple), on prend sa voisine, à la place qu'elle
 * occupait, et non la première du filtre. Un autre filtre repart du début.
 */
export function photoAMontrer<T extends { id: string }>(
  filtrees: T[],
  toutes: T[],
  activeId: string,
  cle: string,
  place: PlaceActive | undefined,
): { photo: T | undefined; index: number; voisine: boolean } {
  const index = filtrees.findIndex((p) => p.id === activeId);
  if (index >= 0) return { photo: filtrees[index], index, voisine: false };
  if (filtrees.length && place && place.cle === cle && place.id === activeId) {
    const i = Math.min(place.index, filtrees.length - 1);
    return { photo: filtrees[i], index: i, voisine: true };
  }
  if (filtrees.length) return { photo: filtrees[0], index: 0, voisine: false };
  return {
    photo: toutes.find((p) => p.id === activeId) || toutes[0],
    index: -1,
    voisine: false,
  };
}
