/**
 * Détourer la personne qu'on désigne, et s'en servir pour une retouche.
 *
 * Le modèle est SlimSAM (Apache 2.0, 40 Mo). Le choix de désigner d'un clic
 * plutôt que de deviner vient d'une mesure : un modèle de portrait automatique
 * rend une silhouette trouée sur un couple et des taches informes sur un
 * groupe, parce qu'un album de mariage n'a pas « un sujet ».
 *
 * L'encodage de l'image coûte 1,8 seconde ; les clics suivants sur la même
 * photo ne coûtent presque rien. C'est ce qui rend l'outil utilisable.
 */
/**
 * La largeur à laquelle le détourage travaille.
 *
 * Le modèle ramène de toute façon l'image à mille vingt-quatre pixels. Lui en
 * donner six mille ne gagne rien en précision, coûte tout le redimensionnement
 * du masque, et faisait tomber l'application : un canevas de six mille par
 * quatre mille pèse quatre-vingt-seize méga-octets dans le travailleur.
 */
export const SUBJECT_WIDTH = 1024;
export type SubjectMask = {
  width: number;
  height: number;
  /** Une valeur de transparence par pixel, de 0 (fond) à 255 (sujet). */
  data: Uint8ClampedArray;
};
/**
 * Les masques d'un rendu : un seul pour tous les calques « Sujet détouré »,
 * ou le masque de chaque calque. Deux personnes détourées sur une photo sont
 * deux masques ; le premier servait aux deux (relecture du 29/09/2026).
 */
export type MasquesSujet =
  | SubjectMask
  | ((calque: { id: string }) => SubjectMask | undefined);
export function maskAt(
  mask: SubjectMask,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (!mask.width || !mask.height || !width || !height) return 0;
  const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / width));
  const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / height));
  return mask.data[my * mask.width + mx] / 255;
}
export const subjectStats = {
  calls: 0,
  done: 0,
  device: "",
  confiance: 0,
  lastError: "",
};
let worker: Worker | undefined;
let broken = false;
let failure: string | undefined;
let sequence = 0;
let dejaCharge = false;
const pending = new Map<
  string,
  {
    resolve: (m: SubjectMask & { confiance: number }) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export const subjectFailure = () => failure;
export const subjectAvailable = () => !broken;
/** Le premier appel charge le modèle ; les suivants ne font que calculer. */
const DELAI_PREMIER = 120000;
const DELAI = 30000;
/**
 * Demander le masque de ce qui se trouve sous les points désignés.
 *
 * `cle` identifie la photo : tant qu'elle ne change pas, l'image n'est pas
 * relue et seul le décodage a lieu. `bitmap` n'est donc nécessaire qu'au
 * premier clic sur une photo.
 */
export async function subjectAt(
  cle: string,
  points: [number, number][],
  bitmap?: ImageBitmap,
): Promise<SubjectMask & { confiance: number }> {
  subjectStats.calls++;
  if (broken) {
    bitmap?.close();
    throw Error(failure || "Détourage indisponible");
  }
  if (!points.length) {
    bitmap?.close();
    throw Error("Désignez au moins un point sur la personne.");
  }
  if (!worker) {
    worker = new Worker(new URL("./subject-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(data.id);
      dejaCharge = true;
      if (data.device) subjectStats.device = data.device;
      if (data.error) {
        subjectStats.lastError = String(data.error);
        entry.reject(Error(data.error));
      } else {
        subjectStats.done++;
        subjectStats.confiance = data.confiance;
        entry.resolve({
          width: data.width,
          height: data.height,
          data: new Uint8ClampedArray(data.masque),
          confiance: data.confiance,
        });
      }
    };
    worker.onerror = (event) => {
      broken = true;
      failure =
        "Le détourage n\u2019a pas démarré : " +
        ((event as ErrorEvent).message || "raison inconnue") +
        ".";
      for (const [id, entry] of [...pending.entries()]) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.reject(Error(failure));
      }
    };
  }
  const id = "m" + ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(
          Error(
            dejaCharge
              ? "Le détourage n\u2019a pas répondu à temps."
              : "Le modèle de détourage n\u2019a pas fini de charger.",
          ),
        );
      },
      dejaCharge ? DELAI : DELAI_PREMIER,
    );
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage(
      {
        id,
        base: new URL("./", document.baseURI).href,
        cle,
        points,
        bitmap,
      },
      bitmap ? [bitmap] : [],
    );
  });
}
/** La part de l'image que le sujet occupe : utile pour dire si ça a marché. */
export function subjectCoverage(mask: SubjectMask) {
  if (!mask.data.length) return 0;
  let somme = 0;
  for (const v of mask.data) somme += v;
  return Math.round((somme / (mask.data.length * 255)) * 1000) / 1000;
}
/**
 * Les masques déjà calculés, gardés en mémoire.
 *
 * Ce qui est enregistré dans le catalogue, c'est le **point désigné**, pas le
 * masque : quelques octets au lieu de sept cents kilo-octets par photo. Un
 * masque absent (redémarrage, cache plein) est recalculé depuis ce point par
 * `masquesSujet` (image.ts), sur la même image que le détourage d'origine.
 */
const cache = new Map<string, SubjectMask & { confiance: number }>();
/** Au-delà, on oublie le moins récemment servi : c'est un cache, pas un stockage. */
const CACHE_MAX = 24;
const cleDe = (photoId: string, points: [number, number][]) =>
  photoId + "|" + points.map(([x, y]) => x.toFixed(4) + "," + y.toFixed(4)).join(";");
/** Le masque s'il a déjà été calculé, sans rien déclencher. */
export function cachedSubjectMask(
  photoId: string,
  points: [number, number][],
) {
  const cle = cleDe(photoId, points);
  const m = cache.get(cle);
  if (m) {
    cache.delete(cle);
    cache.set(cle, m);
  }
  return m;
}
/**
 * La photo dont le travailleur de détourage garde la lecture. Il ne réencode
 * l'image (1,8 s) que si on la lui renvoie : un second clic, ou le second
 * calque d'un export, n'a pas à la renvoyer.
 */
let imageLue: string | undefined;
/**
 * Les calculs en cours : un aperçu redemandé pendant qu'un masque se
 * recalcule attend ce calcul au lieu d'en lancer un second.
 */
const enCours = new Map<string, Promise<SubjectMask & { confiance: number }>>();
/** Le masque, calculé si besoin, puis gardé. */
export async function subjectMaskFor(
  photoId: string,
  points: [number, number][],
  bitmap?: () => Promise<ImageBitmap>,
) {
  const deja = cachedSubjectMask(photoId, points);
  if (deja) return deja;
  const cle = cleDe(photoId, points);
  let calcul = enCours.get(cle);
  if (!calcul) {
    calcul = calculerMasque(photoId, points, bitmap);
    enCours.set(cle, calcul);
    void calcul.finally(() => enCours.delete(cle)).catch(() => {});
  }
  return calcul;
}
/**
 * Un détourage à la fois. Le travailleur ne garde qu'une image lue : deux
 * demandes mêlées (un export qui recalcule le masque d'une photo pendant
 * qu'on en détoure une autre) pouvaient décoder l'une sur la lecture de
 * l'autre.
 */
let file: Promise<unknown> = Promise.resolve();
function calculerMasque(
  photoId: string,
  points: [number, number][],
  bitmap?: () => Promise<ImageBitmap>,
) {
  const suite = file.then(
    () => calculerMaintenant(photoId, points, bitmap),
    () => calculerMaintenant(photoId, points, bitmap),
  );
  file = suite.catch(() => {});
  return suite;
}
async function calculerMaintenant(
  photoId: string,
  points: [number, number][],
  bitmap?: () => Promise<ImageBitmap>,
) {
  const deja = cache.get(cleDe(photoId, points));
  if (deja) return deja;
  let masque: SubjectMask & { confiance: number };
  try {
    masque = await subjectAt(
      photoId,
      points,
      imageLue === photoId ? undefined : await bitmap?.(),
    );
  } catch (error) {
    // Le travailleur a lu une autre photo entre-temps : la lui redonner.
    if (imageLue !== photoId || !bitmap || !/Image à relire/.test(String((error as Error)?.message)))
      throw error;
    masque = await subjectAt(photoId, points, await bitmap());
  }
  imageLue = photoId;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(cleDe(photoId, points), masque);
  return masque;
}
export function forgetSubjectMasks() {
  cache.clear();
  imageLue = undefined;
}
/**
 * Une erreur du détourage, dite en français. Le navigateur et le modèle
 * répondent en anglais (« The source image could not be decoded. ») ; les
 * messages de Juno, eux, passent tels quels.
 */
export function raisonDetourage(error: unknown): string {
  if (failure) return failure;
  const brut = String((error as Error)?.message ?? error ?? "");
  if (/could not be decoded|InvalidStateError|EncodingError/i.test(brut))
    return "Juno n\u2019a pas pu lire cette photo pour la détourer.";
  if (
    /^(Le détourage|Le modèle de détourage|Détourage|Désignez|Rien de|100 calques|La retouche|Original|Cette copie|Le moteur|Le décodage|Espace|Le fichier|L\u2019accès)/.test(
      brut,
    )
  )
    return brut;
  return "Le détourage a échoué. Détail technique : " + brut.slice(0, 160);
}
