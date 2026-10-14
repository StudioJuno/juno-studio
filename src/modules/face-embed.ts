import type { CropRect } from "../model";
/**
 * Client for the face descriptor worker. Falls back silently to the geometric
 * signature when the network cannot load: recognition is an aid, never a
 * reason to fail an album pass.
 */
let worker: Worker | undefined;
let sequence = 0;
let broken = false;
let failure = "";
/** Why recognition is degraded, in the user's language, or an empty string. */
export function faceEmbeddingFailure() {
  return failure;
}
/** Counters that make a silent degradation visible during a test run. */
export const faceEmbeddingStats = {
  calls: 0,
  crops: 0,
  described: 0,
  lastError: "",
};
// Readable from a test run, so a degraded model is never invisible.
(
  globalThis as unknown as {
    junoFaceFailure?: () => string;
    junoFaceStats?: () => typeof faceEmbeddingStats;
  }
).junoFaceFailure = faceEmbeddingFailure;
(
  globalThis as unknown as { junoFaceStats?: () => typeof faceEmbeddingStats }
).junoFaceStats = () => faceEmbeddingStats;
const pending = new Map<
  number,
  {
    resolve: (v: (number[] | undefined)[]) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
export function faceEmbeddingAvailable() {
  return !broken;
}
/**
 * Which faces deserve a descriptor. A guest occupying one percent of the frame
 * will never identify the couple, and describing every face of a wedding costs
 * hours: keep the faces that can actually carry an identity.
 */
export const MIN_FACE_WEIGHT = 0.004;
export const MAX_FACES_PER_PHOTO = 4;
export function facesWorthDescribing<T extends { weight: number }>(reads: T[]) {
  return reads
    .map((read, index) => ({ read, index }))
    .filter(({ read }) => read.weight >= MIN_FACE_WEIGHT)
    .sort((a, b) => b.read.weight - a.read.weight)
    .slice(0, MAX_FACES_PER_PHOTO);
}
/** Crop each face out of the thumbnail, with a margin, as the network expects. */
export async function cropFaces(
  image: ImageBitmap,
  regions: CropRect[],
  margin = 0.25,
) {
  const crops: ImageBitmap[] = [];
  for (const r of regions) {
    const w = r.w * image.width,
      h = r.h * image.height;
    const x = Math.max(0, r.x * image.width - w * margin),
      y = Math.max(0, r.y * image.height - h * margin);
    const width = Math.min(image.width - x, w * (1 + margin * 2)),
      height = Math.min(image.height - y, h * (1 + margin * 2));
    if (width < 16 || height < 16) continue;
    crops.push(
      await createImageBitmap(
        image,
        Math.round(x),
        Math.round(y),
        Math.round(width),
        Math.round(height),
        {
          resizeWidth: 150,
          resizeHeight: 150,
          resizeQuality: "medium",
        },
      ),
    );
  }
  return crops;
}
export async function faceDescriptors(
  crops: ImageBitmap[],
): Promise<(number[] | undefined)[]> {
  faceEmbeddingStats.calls++;
  faceEmbeddingStats.crops += crops.length;
  if (!crops.length) return [];
  if (broken) {
    for (const c of crops) c.close();
    return crops.map(() => undefined);
  }
  if (!worker) {
    worker = new Worker(new URL("./face-embed-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(data.id);
      if (data.error) {
        faceEmbeddingStats.lastError = String(data.error);
        entry.reject(Error(data.error));
      } else {
        if (data.warning && !failure)
          failure =
            "Empreinte faciale dégradée : " +
            data.warning +
            ". Juno utilise la reconnaissance géométrique.";
        faceEmbeddingStats.described += (
          data.descriptors as (number[] | undefined)[]
        ).filter(Boolean).length;
        entry.resolve(data.descriptors);
      }
    };
    worker.onerror = (event) => {
      broken = true;
      failure =
        "Le modèle d’empreinte faciale n’a pas démarré : " +
        ((event as ErrorEvent).message || "raison inconnue") +
        ". Juno retombe sur la reconnaissance géométrique.";
      for (const [id, entry] of [...pending.entries()]) {
        clearTimeout(entry.timer);
        pending.delete(id);
        entry.reject(Error("Le modèle d’empreinte faciale n’a pas démarré."));
      }
      worker?.terminate();
      worker = undefined;
    };
  }
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A model that never answers is a model that is not there.
      broken = true;
      failure =
        "Le modèle d’empreinte faciale ne répond pas. Juno retombe sur la reconnaissance géométrique.";
      worker?.terminate();
      worker = undefined;
      reject(Error("Délai dépassé pour l’empreinte faciale."));
    }, 120000);
    pending.set(id, { resolve, reject, timer });
    worker!.postMessage(
      { id, base: new URL("./", document.baseURI).href, crops },
      crops as unknown as Transferable[],
    );
  });
}
