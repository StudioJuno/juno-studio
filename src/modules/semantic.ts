/**
 * Chercher ses photos en écrivant ce qu'on cherche.
 *
 * Chaque photo est résumée en un vecteur pendant la passe d'album ; une
 * recherche transforme la phrase en vecteur de la même façon, et les plus
 * proches sortent en premier. Tout se passe sur cet ordinateur.
 *
 * Ce que ce modèle sait faire, et ce qu'il ne sait pas : il encode le **sujet**
 * d'une photo. « Une mariée tenant un bouquet » le trouve du premier coup ;
 * « une porte en bois verte », détail du fond de la même photo, arrive
 * vingtième. C'est une limite de méthode, pas un défaut de réglage.
 */
export type SemanticStats = {
  calls: number;
  images: number;
  embedded: number;
  device?: string;
  lastError?: string;
};
export const semanticStats: SemanticStats = {
  calls: 0,
  images: 0,
  embedded: 0,
};
let worker: Worker | undefined;
let broken = false;
let failure: string | undefined;
let sequence = 0;
const pending = new Map<
  string,
  {
    resolve: (v: (number[] | null)[]) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
/** Ce qui empêche la recherche de fonctionner, à dire plutôt qu'à taire. */
export function semanticFailure() {
  return failure;
}
export function semanticAvailable() {
  return !broken;
}
/** Un lot d'images prend du temps : la limite suit leur nombre. */
const DELAI_PAR_IMAGE = 20000;
/**
 * Le tout premier appel charge 378 Mo de modèle depuis le disque.
 *
 * Lui appliquer le délai d'une image ordinaire faisait échouer la première
 * demande, et toutes les suivantes avec elle : l'album entier repartait sans
 * index, sans qu'aucune erreur ne l'explique.
 */
const DELAI_PREMIER_APPEL = 240000;
let dejaCharge = false;
function ensureWorker() {
  if (worker || broken) return worker;
  worker = new Worker(new URL("./semantic-worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(data.id);
    if (data.device) semanticStats.device = data.device;
    // Une réponse quelconque prouve que le modèle est en mémoire.
    dejaCharge = true;
    if (data.error) {
      semanticStats.lastError = String(data.error);
      entry.reject(Error(data.error));
    } else {
      semanticStats.embedded += (data.vecteurs as (number[] | null)[]).filter(
        Boolean,
      ).length;
      entry.resolve(data.vecteurs);
    }
  };
  worker.onerror = (event) => {
    broken = true;
    failure =
      "La recherche par le sens n’a pas démarré : " +
      ((event as ErrorEvent).message || "raison inconnue") +
      ". Les autres recherches continuent de fonctionner.";
    for (const [id, entry] of [...pending.entries()]) {
      clearTimeout(entry.timer);
      pending.delete(id);
      entry.reject(Error(failure));
    }
  };
  return worker;
}
function ask(
  payload: Record<string, unknown>,
  count: number,
  transfer: Transferable[] = [],
): Promise<(number[] | null)[]> {
  const w = ensureWorker();
  if (!w) return Promise.resolve(Array.from({ length: count }, () => null));
  const id = "s" + ++sequence;
  const delai = dejaCharge
    ? DELAI_PAR_IMAGE * Math.max(1, count)
    : DELAI_PREMIER_APPEL;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(
        Error(
          dejaCharge
            ? "La recherche par le sens n’a pas répondu à temps."
            : "Le modèle de recherche n’a pas fini de charger.",
        ),
      );
    }, delai);
    pending.set(id, { resolve, reject, timer });
    w.postMessage(
      { id, base: new URL("./", document.baseURI).href, ...payload },
      transfer,
    );
  });
}
/** Résumer des photos. Les images sont consommées par le travailleur. */
export async function embedImages(images: ImageBitmap[]) {
  semanticStats.calls++;
  semanticStats.images += images.length;
  if (!images.length) return [];
  if (broken) {
    for (const b of images) b.close();
    return images.map(() => null);
  }
  try {
    return await ask({ kind: "images", images }, images.length, images);
  } catch {
    return images.map(() => null);
  }
}
/** Résumer une ou plusieurs phrases de recherche. */
export async function embedTexts(textes: string[]) {
  if (!textes.length) return [];
  return ask({ kind: "texte", textes }, 1);
}
/** La proximité de deux vecteurs déjà normalisés. */
export function similarity(a: number[], b: number[]) {
  if (!a?.length || a.length !== b?.length) return -1;
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i] * b[i];
  return total;
}
export type Indexed = { id: string; vector: number[] };
/**
 * Classer des photos pour une recherche.
 *
 * `minimum` écarte ce qui n'a rien à voir : sans lui, une recherche renvoie
 * toujours l'album entier, du moins pire au pire, ce qui n'aide personne.
 */
export function rank(
  query: number[],
  indexed: Indexed[],
  { limit = 200, minimum = 0.02 } = {},
) {
  if (!query?.length) return [];
  return indexed
    .map((p) => ({ id: p.id, score: similarity(query, p.vector) }))
    .filter((r) => r.score >= minimum)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
/** Les moments d'un mariage, pour un classement proposé et jamais imposé. */
export const MOMENTS = [
  { id: "preparatifs", label: "Préparatifs", phrase: "les préparatifs des mariés, maquillage, coiffure, robe et costume" },
  { id: "ceremonie", label: "Cérémonie", phrase: "la cérémonie de mariage, les vœux, l'échange des alliances" },
  { id: "groupe", label: "Photos de groupe", phrase: "une photo de groupe posée avec les invités" },
  { id: "couple", label: "Couple", phrase: "le couple de mariés seuls, une séance photo à deux" },
  { id: "cocktail", label: "Vin d'honneur", phrase: "un cocktail en extérieur, des invités debout un verre à la main" },
  { id: "repas", label: "Repas", phrase: "le repas de mariage, des tables dressées, des convives attablés" },
  { id: "discours", label: "Discours", phrase: "un discours au micro pendant le repas" },
  { id: "gateau", label: "Gâteau", phrase: "la pièce montée ou le gâteau de mariage" },
  { id: "soiree", label: "Soirée", phrase: "la piste de danse en soirée, des gens qui dansent dans la nuit" },
] as const;
export type MomentId = (typeof MOMENTS)[number]["id"];
/**
 * À quel moment de la journée une photo appartient le plus.
 *
 * Rien n'est renvoyé quand aucun moment ne se détache : une photo de détail
 * n'appartient à aucun d'eux, et lui en coller un serait pire que rien.
 */
export function classifyMoment(
  vector: number[],
  momentVectors: Record<string, number[]>,
  { marge = 0.005 } = {},
): { moment: MomentId; score: number } | undefined {
  const scores = MOMENTS.map((m) => ({
    moment: m.id,
    score: similarity(vector, momentVectors[m.id] ?? []),
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scores.length < 2) return scores[0];
  return scores[0].score - scores[1].score >= marge ? scores[0] : undefined;
}
