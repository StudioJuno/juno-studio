import { exportPhoto } from "../image";
const preparations = new Map<string, AbortController>();
export const isPreparing = (id: string) => preparations.has(id);
export function stopPreparation(id: string) {
  preparations.get(id)?.abort();
}
export async function preparePublication(id: string) {
  const api = window.juno?.review;
  if (!api) throw Error("Ouvrez l’application Juno pour publier.");
  if (preparations.has(id)) return;
  const controller = new AbortController();
  preparations.set(id, controller);
  window.dispatchEvent(new Event("juno-review-jobs"));
  try {
    const { job, photos } = await api.preparation({ id });
    if (job.kind === "video") {
      await api.stageVideo({ id });
      controller.signal.throwIfAborted();
      await api.start({ id });
      return;
    }
    for (const photo of photos) {
      controller.signal.throwIfAborted();
      try {
        if (photo.previewOnly)
          throw Error(
            "Original absent : retrouvez ce fichier dans le projet avant de préparer son rendu.",
          );
        const blob = await exportPhoto(photo, "jpeg", 2560, 0.92);
        controller.signal.throwIfAborted();
        const bitmap = await createImageBitmap(blob);
        try {
          const ratio = Math.min(
              1,
              480 / Math.max(bitmap.width, bitmap.height),
            ),
            canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
          canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
          canvas
            .getContext("2d")!
            .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const thumbnail = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (b) =>
                b
                  ? resolve(b)
                  : reject(Error("Miniature impossible à encoder.")),
              "image/jpeg",
              0.82,
            ),
          );
          controller.signal.throwIfAborted();
          await api.stagePhoto({
            jobId: id,
            photoId: photo.id,
            bytes: await blob.arrayBuffer(),
            thumbnail: await thumbnail.arrayBuffer(),
            width: bitmap.width,
            height: bitmap.height,
          });
        } finally {
          bitmap.close();
        }
      } catch (error) {
        if (controller.signal.aborted) throw error;
        await api.preparationError({
          jobId: id,
          photoId: photo.id,
          error: photo.name + " : " + (error as Error).message,
        });
      }
      window.dispatchEvent(new Event("juno-review-jobs"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    controller.signal.throwIfAborted();
    const remaining = await api.preparation({ id });
    if (
      !remaining.job.errors.length &&
      remaining.job.prepared === remaining.job.total
    )
      await api.start({ id });
  } finally {
    preparations.delete(id);
    window.dispatchEvent(new Event("juno-review-jobs"));
  }
}
