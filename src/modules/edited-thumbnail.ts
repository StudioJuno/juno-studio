import { getThumbnail } from "../db";
import type { Adjustments, Photo } from "../model";
import { processImage, type Priority } from "./image-client";
import { rasterCanvas, type Raster } from "./raster";
import { ecartDuRendu } from "./auto-tone";
const originals = new Map<string, Promise<Blob>>();
const rendered = new Map<string, string>();
/**
 * La vignette d'un RAW part de son aperçu intégré, le rendu du boîtier, plus
 * clair que le développement de Juno. Une fois cet écart mesuré (passe
 * d'album), il est compensé : sans cela, la vignette d'une photo réglée pour
 * l'export paraissait surexposée (0,55 à 0,73 de luminosité pour un export à
 * 0,44-0,48 sur sept CR3 ; 0,42 à 0,47 une fois compensée).
 */
const surApercu = (p: Photo, a: Adjustments): Adjustments => {
  const ecart = ecartDuRendu(p.analysis);
  return ecart ? { ...a, exposure: a.exposure + ecart } : a;
};
export const thumbnailKey = (p: Photo, a = p.adjustments) =>
  JSON.stringify([p.id, p.hash, p.source, a, ecartDuRendu(p.analysis)]);
export const cachedEditedThumbnail = (p: Photo) =>
  rendered.get(thumbnailKey(p));
export function rememberEditedThumbnail(
  p: Photo,
  a: Adjustments,
  canvas: HTMLCanvasElement,
) {
  const small = document.createElement("canvas");
  const ratio = Math.min(1, 480 / Math.max(canvas.width, canvas.height));
  small.width = Math.max(1, Math.round(canvas.width * ratio));
  small.height = Math.max(1, Math.round(canvas.height * ratio));
  small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
  const url = small.toDataURL("image/jpeg", 0.88),
    key = thumbnailKey(p, a);
  rendered.delete(key);
  rendered.set(key, url);
  while (rendered.size > 160) rendered.delete(rendered.keys().next().value!);
  return url;
}
async function thumbnailBlob(p: Photo) {
  const key = `${p.id}:${p.hash}:${p.source}`;
  let promise = originals.get(key);
  if (!promise) {
    promise = (async () => {
      const url = p.thumbnail || (await getThumbnail(p.id));
      if (!url.startsWith("data:image/")) throw Error("Aperçu indisponible");
      const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) =>
        c.charCodeAt(0),
      );
      return new Blob([bytes], { type: url.slice(5, url.indexOf(";")) });
    })();
    originals.set(key, promise);
    while (originals.size > 160)
      originals.delete(originals.keys().next().value!);
    void promise.catch(() => originals.delete(key));
  }
  return promise;
}
export async function renderEditedThumbnail(
  p: Photo,
  a = p.adjustments,
  signal?: AbortSignal,
  priority: Priority = "foreground",
) {
  const raster = await processImage<Raster>(
    {
      kind: "thumbnail",
      blob: await thumbnailBlob(p),
      name: "preview.jpg",
      key: `thumbnail:${p.id}:${p.hash}:${p.source}`,
      adjustments: surApercu(p, a),
      max: 480,
    },
    priority,
    signal,
  );
  const canvas = rasterCanvas(raster);
  rememberEditedThumbnail(p, a, canvas);
  return canvas;
}
