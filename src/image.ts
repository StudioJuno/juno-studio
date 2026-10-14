import { processImage, type Priority } from "./modules/image-client";
import {
  raisonDetourage,
  subjectMaskFor,
  SUBJECT_WIDTH,
  type SubjectMask,
} from "./modules/subject";
import { tagSrgb } from "./modules/color";
import { getOriginal } from "./db";
import { analyzePixels, transform } from "./pixels";
import {
  DEFAULT,
  type Photo,
  type Adjustments,
  type Analysis,
  type LocalEdit,
} from "./model";
import {
  nativePhoto,
  decodeRaster,
  isRaw,
  resizeRaster,
  rasterCanvas,
  vers8Bits,
  type Raster,
} from "./modules/raster";
import { PhotoError } from "./modules/image-errors";
import {
  renduDe,
  VERSION_RENDU,
  type AnalyseAvecRendu,
  type MesureRendu,
} from "./modules/auto-tone";
import {
  applyLocalEdits,
  encodeTiff16,
} from "./modules/local-edits";
export async function sourceBlob(p: Photo): Promise<Blob> {
  if (p.previewOnly)
    throw Error(
      "Cette copie ne contient que les aperçus. Reliez les originaux pour retoucher ou exporter.",
    );
  if (p.source === "idb") return getOriginal(p.id);
  if (
    nativePhoto(p.name) &&
    p.source.startsWith("juno://") &&
    window.juno?.photoRaster
  )
    return new Blob(
      [await window.juno.photoRaster(new URL(p.source).pathname.slice(1))],
      { type: "image/tiff" },
    );
  const r = await fetch(p.source);
  if (!r.ok)
    throw new Error(
      "Original indisponible. Vérifiez que votre disque est connecté.",
    );
  return r.blob();
}
/**
 * Inspecter une photo du catalogue. Un HEIC est décodé depuis sa conversion
 * TIFF, qui n'a plus d'EXIF : sans l'original à côté, il n'avait ni heure ni
 * rafale (relecture du 28/09/2026).
 */
export async function inspectPhoto(
  p: Photo,
  priority: Priority = "background",
  key = "",
  vision = false,
  /** Mesurer aussi le rendu de Juno d'un RAW (voir `avecRendu`). */
  rendu = false,
) {
  return inspect(await sourceBlob(p), p.name, priority, key, vision, await originalExif(p), rendu);
}
/**
 * Un RAW dont la passe d'album doit encore mesurer le rendu. Les autres
 * formats sont analysés sur les pixels mêmes que Juno retouche : rien à faire.
 */
export function besoinRendu(p: Photo) {
  return isRaw(p.name) && !p.previewOnly && !renduDe(p.analysis);
}
/** Le rendu de Juno d'un RAW : un développement réduit, sans l'analyse entière. */
export async function mesurerRendu(
  p: Photo,
  priority: Priority = "background",
): Promise<MesureRendu> {
  return processImage<MesureRendu>(
    { kind: "rendu", blob: await sourceBlob(p), name: p.name },
    priority,
  );
}
/**
 * L'analyse complétée de la mesure du rendu, pour un RAW qui ne l'a pas :
 * prise du préchargement s'il l'a faite, sinon mesurée ici. Un échec ne coûte
 * que la justesse de l'exposition automatique, jamais la photo.
 */
export async function avecRendu<A extends Analysis>(
  p: Photo,
  a: A,
  ready?: { analysis?: Analysis; rendu?: MesureRendu },
): Promise<A & AnalyseAvecRendu> {
  if (!isRaw(p.name) || p.previewOnly || renduDe(a)) return a;
  try {
    const rendu =
      renduDe(ready?.analysis) ??
      (ready?.rendu?.version === VERSION_RENDU ? ready.rendu : undefined) ??
      (await mesurerRendu(p));
    return { ...a, rendu };
  } catch {
    return a;
  }
}
/**
 * L'analyse sur laquelle le bouton « Auto » règle une photo. Pour un RAW, elle
 * porte le rendu de Juno, comme pour la passe d'album : celui du catalogue
 * s'il est à jour, sinon mesuré ici en priorité, puisque le photographe
 * attend. `mesure` n'est rendue que neuve, pour que l'éditeur la garde au
 * catalogue. Un échec est une erreur, pas un repli sur l'aperçu intégré :
 * réglé sur lui, le RAW sortirait plus sombre (0,296 au lieu de 0,439 sur un
 * CR3, relecture du 29/09/2026).
 */
export async function analysePourAuto(
  p: Photo,
): Promise<{ analysis: AnalyseAvecRendu; mesure?: MesureRendu } | undefined> {
  if (!p.analysis) return undefined;
  if (!besoinRendu(p)) return { analysis: p.analysis };
  const mesure = await mesurerRendu(p, "foreground");
  return { analysis: { ...p.analysis, rendu: mesure }, mesure };
}
/** L'original d'un format converti, pour son EXIF ; rien sinon. */
export async function originalExif(p: { name: string; source: string }) {
  if (!nativePhoto(p.name) || !p.source.startsWith("juno://")) return undefined;
  try {
    const r = await fetch(p.source);
    return r.ok ? await r.blob() : undefined;
  } catch {
    return undefined;
  }
}
export async function inspectionSource(
  item: { name: string; source: string; id: string },
  original: Blob,
) {
  if (nativePhoto(item.name)) {
    if (!item.source.startsWith("juno://") || !window.juno?.photoRaster)
      throw Error(
        "Le décodage de ce format nécessite l’application Juno installée.",
      );
    return new Blob([await window.juno.photoRaster(item.id)], {
      type: "image/tiff",
    });
  }
  return original;
}
export async function bitmap(blob: Blob) {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}
export async function inspect(
  blob: Blob,
  name = "",
  priority: Priority = "foreground",
  key = "",
  /** Rendre aussi l'image d'analyse de 1 024 px, pour chercher les visages. */
  vision = false,
  /**
   * L'original, quand `blob` en est une conversion (HEIC rendu en TIFF par
   * FFmpeg) : c'est lui qui porte l'EXIF, donc l'heure de prise de vue.
   */
  exif?: Blob,
  /** Mesurer aussi le rendu de Juno d'un RAW, dans la même lecture. */
  rendu = false,
) {
  const result = await processImage<any>(
    { kind: "inspect", blob, name, key, vision, exif, rendu },
    priority,
  );
  const bytes = new Uint8Array(await result.thumbnail.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    ...result,
    thumbnail: "data:image/jpeg;base64," + btoa(text),
  } as Pick<
    Photo,
    | "width"
    | "height"
    | "thumbnail"
    | "analysis"
    | "bitDepth"
    | "camera"
    | "color"
    | "capturedAt"
  > & {
    analysis: NonNullable<Photo["analysis"]>;
    vision?: ImageBitmap;
    /** Grand côté de l'image décodée d'où vient l'image d'analyse. */
    visionSource?: number;
  };
}
const blobs = new Map<string, Blob>();
const blobRequests = new Map<string, Promise<Blob>>();
let bytes = 0;
async function cachedBlob(p: Photo) {
  const key = p.id + ":" + p.hash + ":" + p.source;
  let b = blobs.get(key);
  if (b) {
    blobs.delete(key);
    blobs.set(key, b);
    return b;
  }
  let request = blobRequests.get(key);
  if (!request) {
    request = sourceBlob(p);
    blobRequests.set(key, request);
    void request.finally(() => blobRequests.delete(key)).catch(() => {});
  }
  b = await request;
  if (b.size < 128 * 1024 * 1024) {
    while (blobs.size && bytes + b.size > 128 * 1024 * 1024) {
      const first = blobs.keys().next().value!;
      bytes -= blobs.get(first)!.size;
      blobs.delete(first);
    }
    const old = blobs.get(key);
    if (old) bytes -= old.size;
    blobs.set(key, b);
    bytes += b.size;
  }
  return b;
}
/**
 * L'image sur laquelle le détourage travaille : la photo sans retouche,
 * décodée par le moteur de Juno. Le navigateur ne sait lire ni un RAW ni un
 * TIFF 16 bits (« The source image could not be decoded. ») ; le moteur, si,
 * et il a souvent déjà la photo ouverte en mémoire.
 */
export async function subjectBitmap(p: Photo, priority: Priority = "foreground") {
  const r = await renderRaster(p, DEFAULT, SUBJECT_WIDTH, priority);
  const data =
    r.data instanceof Uint16Array ? vers8Bits(r.data) : new Uint8ClampedArray(r.data);
  return createImageBitmap(new ImageData(data, r.width, r.height));
}
/** Les calques « Sujet détouré » qui agissent : visibles et désignés. */
export const calquesSujet = (edits?: LocalEdit[]) =>
  (edits || []).filter(
    (e) => e.tool === "subject" && e.visible && e.points?.length,
  );
export const pointsDe = (e: LocalEdit) =>
  e.points.map((q) => [q.x, q.y] as [number, number]);
/**
 * Le masque de chaque calque « Sujet détouré » visible, recalculé depuis le
 * point enregistré s'il n'est plus en mémoire.
 *
 * Un aperçu se passe d'un masque impossible à recalculer (`echec` le dit) ;
 * un export, lui, refuse de partir : livrer la photo sans la retouche que
 * l'aperçu montrait serait un résultat faux, sans un mot.
 */
export async function masquesSujet(
  p: Photo,
  edits: LocalEdit[] | undefined,
  { exiger = false, priority = "foreground" as Priority, echec }: {
    exiger?: boolean;
    priority?: Priority;
    echec?: (message: string) => void;
  } = {},
): Promise<Record<string, SubjectMask>> {
  const out: Record<string, SubjectMask> = {};
  for (const e of calquesSujet(edits)) {
    try {
      const m = await subjectMaskFor(p.id, pointsDe(e), () =>
        subjectBitmap(p, priority),
      );
      out[e.id] = { width: m.width, height: m.height, data: m.data };
    } catch (error) {
      const raison = raisonDetourage(error).replace(/[\s.]*$/, ".");
      if (exiger)
        throw new PhotoError({
          code: "SUBJECT_MASK",
          stage: "subject",
          message: `La retouche « ${e.name} » n\u2019a pas pu être recalculée : ${raison} La photo n\u2019est pas exportée sans elle.`,
          technical: String((error as Error)?.message ?? error),
          retryable: true,
        });
      echec?.(`La retouche « ${e.name} » n\u2019est pas affichée : ${raison}`);
    }
  }
  return out;
}
export async function renderRaster(
  p: Photo,
  a: Adjustments = p.adjustments,
  max = 1600,
  priority: Priority = "foreground",
  signal?: AbortSignal,
  /** Appelé si un masque de détourage ne peut pas être recalculé. */
  echecSujet?: (message: string) => void,
): Promise<Raster> {
  return processImage<Raster>(
    {
      kind: "render",
      blob: await cachedBlob(p),
      name: p.name,
      key: p.id + ":" + p.hash + ":" + p.source,
      adjustments: a,
      max,
      // Les masques de détourage accompagnent chaque demande : le travailleur
      // ne les garde plus (voir image-worker.ts).
      subjectMasks: await masquesSujet(p, a.localEdits, {
        priority,
        echec: echecSujet,
      }),
    },
    priority,
    signal,
  );
}
export async function renderPhoto(
  p: Photo,
  a: Adjustments = p.adjustments,
  max = 1600,
  signal?: AbortSignal,
  echecSujet?: (message: string) => void,
): Promise<HTMLCanvasElement> {
  return rasterCanvas(
    await renderRaster(p, a, max, "foreground", signal, echecSujet),
  );
}
export async function renderTiff(
  p: Photo,
  max = 0,
  priority: Priority = "foreground",
) {
  const data = await processImage<ArrayBuffer>(
    {
      kind: "tiff",
      blob: await cachedBlob(p),
      name: p.name,
      key: p.id + ":" + p.hash + ":" + p.source,
      adjustments: p.adjustments,
      max,
      subjectMasks: await masquesSujet(p, p.adjustments.localEdits, {
        exiger: true,
        priority,
      }),
    },
    priority,
  );
  return new Blob([data], { type: "image/tiff" });
}
/**
 * Le fichier livré : l'export, et les rendus du portail client, qui passent
 * par ici eux aussi (review/prepare.ts). Le détourage y est appliqué comme
 * dans l'aperçu, ou l'export est refusé.
 */
export async function exportPhoto(
  p: Photo,
  format: string,
  max: number,
  quality: number,
) {
  if (format === "tiff") return renderTiff(p, max, "background");
  return processImage<Blob>(
    {
      kind: "encode",
      blob: await cachedBlob(p),
      name: p.name,
      key: p.id + ":" + p.hash + ":" + p.source,
      adjustments: p.adjustments,
      max,
      format,
      quality,
      subjectMasks: await masquesSujet(p, p.adjustments.localEdits, {
        exiger: true,
        priority: "background",
      }),
    },
    "background",
  );
}
export async function prefetchPhoto(p: Photo) {
  if (p.previewOnly) return;
  try {
    // Read ahead without evicting the open photo’s decoded RAW from the worker.
    await cachedBlob(p);
  } catch {}
}
export function toBlob(
  c: HTMLCanvasElement,
  type = "image/jpeg",
  quality = 0.94,
): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob(
      (b) => (b ? res(b) : rej(new Error("Échec de l’encodage."))),
      type,
      quality,
    ),
  );
}
export async function fingerprint(b: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await b.arrayBuffer()),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export async function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function originalAdjustments() {
  return { ...DEFAULT };
}
