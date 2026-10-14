import { convertIcc, colorBase } from "./color";
import * as UTIF from "utif";
import type { Photo } from "../model";
import { RawSession } from "./raw-session";
import { PhotoError, photoFailure } from "./image-errors";
import formats from "../../electron/media-formats.json";
export const RAW_EXTENSIONS = formats.raw;
export const supportedPhoto = (name: string) =>
  [...formats.raw, ...formats.photo, ...formats.nativePhoto].includes(
    name.split(".").pop()?.toLowerCase() || "",
  );
export const nativePhoto = (name: string) =>
  formats.nativePhoto.includes(name.split(".").pop()?.toLowerCase() || "");
export const isRaw = (name: string) =>
  RAW_EXTENSIONS.includes(name.split(".").pop()?.toLowerCase() || "");
export type Raster = {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint16Array;
  bitDepth: number;
  camera?: Photo["camera"];
  color?: Photo["color"];
  capturedAt?: number;
};
const cache = new Map<string, Raster>();
let cacheBytes = 0;
let cacheLimit = 512 * 1024 * 1024;
export function setRasterCacheLimit(bytes: number) {
  cacheLimit = bytes;
}
export function clearRasterCache() {
  cache.clear();
  cacheBytes = 0;
}
export function cachedRaster(key: string) {
  const r = cache.get(key);
  if (r) {
    cache.delete(key);
    cache.set(key, r);
  }
  return r;
}
function remember(key: string, r: Raster) {
  if (!key || r.data.byteLength > cacheLimit) return;
  const old = cache.get(key);
  if (old) cacheBytes -= old.data.byteLength;
  cache.delete(key);
  while (cacheBytes + r.data.byteLength > cacheLimit && cache.size) {
    const id = cache.keys().next().value!;
    cacheBytes -= cache.get(id)!.data.byteLength;
    cache.delete(id);
  }
  cache.set(key, r);
  cacheBytes += r.data.byteLength;
}
export function makeCanvas(
  width: number,
  height: number,
): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined")
    return new OffscreenCanvas(width, height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
/** Les compressions TIFF que UTIF décode vraiment (UTIF.js, decode._decompress). */
const COMPRESSIONS_TIFF = new Set([1, 3, 4, 5, 6, 7, 8, 32767, 32773, 32809]);
/**
 * 16 bits vers 8 bits, dans un tableau réservé d'avance.
 *
 * `Uint8ClampedArray.from(tableau, fonction)` faisait tomber la fenêtre sur un
 * RAW en pleine résolution (cent vingt millions de valeurs, export « Résolution
 * d'origine » ou loupe à 100 %) et tenait le fil principal 0,3 s à chaque
 * réglage d'un RAW. La boucle fait le même calcul en 14 ms à 1 600 px.
 *
 * Même arrondi que `Math.round(n / 257)` : n / 257 ne tombe jamais sur une
 * demie, et le tableau borné arrondit au plus proche.
 */
export function vers8Bits(data: Uint16Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] / 257;
  return out;
}
/**
 * Les réglages LibRaw du rendu de Juno : balance du boîtier, sRGB, courbe
 * sRGB, sans éclaircissement automatique. Le développement complet et le
 * développement réduit les partagent, sinon la mesure faite sur l'un ne
 * vaudrait pas pour l'autre.
 */
const RENDU_LIBRAW = {
  useCameraWb: true,
  useAutoWb: false,
  outputColor: 1,
  noAutoBright: true,
  gamm: [1 / 2.4, 12.92],
};
/** Le développement réduit : demi-taille, sans dématriçage, en 8 bits. */
const RENDU_REDUIT = {
  ...RENDU_LIBRAW,
  outputBps: 8,
  halfSize: true,
  userQual: 0,
};
/**
 * L'image que LibRaw vient de développer, ramenée à `max` pixels de grand
 * côté, en RVBA 8 bits. Échantillonnage bilinéaire, comme `resizeRaster`,
 * mais lu directement dans le RVB de LibRaw : la demi-taille d'un boîtier de
 * 45 Mpx pèse déjà trente méga-octets, inutile d'en faire une copie RVBA.
 */
async function imageDeveloppee(raw: RawSession, max: number): Promise<Raster> {
  const img = await raw.imageData();
  if (!img?.width || !img.height) throw Error("Développement RAW vide.");
  const src: Uint8Array | Uint16Array =
    img.bits === 16 && !(img.data instanceof Uint16Array)
      ? new Uint16Array(img.data.buffer, img.data.byteOffset, img.data.byteLength / 2)
      : img.data;
  const echelle = 255 / (img.bits === 16 ? 65535 : 255),
    k = img.colors,
    W = img.width,
    H = img.height,
    ratio = Math.min(1, max / Math.max(W, H)),
    w = Math.max(1, Math.round(W * ratio)),
    h = Math.max(1, Math.round(H * ratio)),
    out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = ((x + 0.5) * W) / w - 0.5,
        sy = ((y + 0.5) * H) / h - 0.5,
        x0 = Math.max(0, Math.floor(sx)),
        y0 = Math.max(0, Math.floor(sy)),
        x1 = Math.min(W - 1, x0 + 1),
        y1 = Math.min(H - 1, y0 + 1),
        fx = Math.max(0, sx - x0),
        fy = Math.max(0, sy - y0),
        o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const ch = Math.min(c, k - 1);
        out[o + c] =
          ((src[(y0 * W + x0) * k + ch] * (1 - fx) + src[(y0 * W + x1) * k + ch] * fx) * (1 - fy) +
            (src[(y1 * W + x0) * k + ch] * (1 - fx) + src[(y1 * W + x1) * k + ch] * fx) * fy) *
          echelle;
      }
      out[o + 3] = 255;
    }
  return { width: w, height: h, data: out, bitDepth: 8 };
}
/**
 * Le développement réduit d'un RAW, avec les réglages du vrai rendu.
 *
 * C'est sur lui que la passe d'album mesure un RAW : l'aperçu intégré est le
 * rendu du boîtier, bien plus clair que celui de Juno (0,80 contre 0,56 de
 * luminosité sur un CR3 d'essai), et une exposition calculée sur l'un puis
 * posée sur l'autre assombrissait tout l'album. Une demi-seconde environ : pas
 * de dématriçage, mais le fichier est décompressé en entier.
 */
export async function decodeRawReduit(blob: Blob, max: number): Promise<Raster> {
  const raw = new RawSession(colorBase());
  try {
    await raw.open(new Uint8Array(await blob.arrayBuffer()), RENDU_REDUIT);
    return await imageDeveloppee(raw, max);
  } catch (e) {
    throw new PhotoError(photoFailure(e, "raw"));
  } finally {
    raw.dispose();
  }
}
/** Smallest embedded preview worth trusting for sorting a RAW. */
export const PREVIEW_MIN_WIDTH = 1024;
/**
 * Decode only what sorting needs. A modern RAW carries a full size JPEG
 * preview; reading it costs milliseconds where decoding the RAW costs seconds.
 * Falls back to the real decode when the preview is missing or too small.
 *
 * `reduit` : développer aussi le RAW en réduit (voir `decodeRawReduit`) dans
 * la même session, pour ne lire et n'ouvrir le fichier qu'une fois. Un échec
 * de ce développement ne coûte que la mesure du rendu, jamais l'aperçu.
 */
export async function decodeRawPreview(
  blob: Blob,
  minWidth = PREVIEW_MIN_WIDTH,
  reduit = 0,
): Promise<(Raster & { reduit?: Raster }) | undefined> {
  const raw = new RawSession(colorBase());
  try {
    await raw.open(new Uint8Array(await blob.arrayBuffer()), RENDU_REDUIT);
    const meta = await raw.metadata().catch(() => ({}) as any);
    const thumb = await raw.thumbnailData();
    if (!thumb?.data?.length || thumb.format !== "jpeg") return undefined;
    const bitmap = await createImageBitmap(
      new Blob([thumb.data], { type: "image/jpeg" }),
    );
    if (bitmap.width < minWidth) {
      bitmap.close();
      return undefined;
    }
    let developpe: Raster | undefined;
    if (reduit)
      try {
        developpe = await imageDeveloppee(raw, reduit);
      } catch {
        developpe = undefined;
      }
    const c = makeCanvas(bitmap.width, bitmap.height),
      context = c.getContext("2d", {
        colorSpace: "srgb",
      }) as OffscreenCanvasRenderingContext2D;
    context.drawImage(bitmap, 0, 0);
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return {
      width: image.width,
      height: image.height,
      data: image.data,
      bitDepth: 8,
      reduit: developpe,
      color: { space: "sRGB", source: "raw", profile: "RAW · aperçu intégré" },
      capturedAt: meta?.timestamp
        ? new Date(meta.timestamp).getTime()
        : undefined,
      camera: {
        make: meta?.camera_make,
        model: meta?.camera_model,
        iso: meta?.iso_speed,
        aperture: meta?.aperture,
        shutter: meta?.shutter,
      },
    };
  } catch {
    // A preview is an optimisation: never fail an import because of it.
    return undefined;
  } finally {
    raw.dispose();
  }
}
export async function decodeRaster(
  blob: Blob,
  name = "",
  cacheKey = "",
): Promise<Raster> {
  const hit = cacheKey ? cachedRaster(cacheKey) : undefined;
  if (hit) return hit;
  let r: Raster;
  if (isRaw(name)) {
    // Release the previous full-resolution image before the next WASM allocation.
    clearRasterCache();
    const raw = new RawSession(colorBase());
    try {
      await raw.open(new Uint8Array(await blob.arrayBuffer()), {
        ...RENDU_LIBRAW,
        outputBps: 16,
        halfSize: false,
        userQual: 3,
      });
      const meta = await raw.metadata(),
        img = await raw.imageData();
      if (!img?.width || !img.height || img.width * img.height > 100000000)
        throw Error(
          "Dimensions RAW invalides ou supérieures à 100 mégapixels.",
        );
      const peak = img.bits === 16 ? 65535 : 255,
        out =
          img.bits === 16
            ? new Uint16Array(img.width * img.height * 4)
            : new Uint8ClampedArray(img.width * img.height * 4);
      const src =
        img.bits === 16 && !(img.data instanceof Uint16Array)
          ? new Uint16Array(
              img.data.buffer,
              img.data.byteOffset,
              img.data.byteLength / 2,
            )
          : img.data;
      for (let p = 0; p < img.width * img.height; p++) {
        for (let c = 0; c < 3; c++)
          out[p * 4 + c] = src[p * img.colors + Math.min(c, img.colors - 1)];
        out[p * 4 + 3] = peak;
      }
      r = {
        width: img.width,
        height: img.height,
        data: out,
        bitDepth: img.bits,
        color: { space: "sRGB", source: "raw", profile: "RAW · sRGB" },
        capturedAt: meta.timestamp
          ? new Date(meta.timestamp).getTime()
          : undefined,
        camera: {
          make: meta.camera_make,
          model: meta.camera_model,
          iso: meta.iso_speed,
          aperture: meta.aperture,
          shutter: meta.shutter,
        },
      };
    } catch (e) {
      throw new PhotoError(photoFailure(e, "raw"));
    } finally {
      raw.dispose();
    }
  } else if (/\.tiff?$/i.test(name) || blob.type === "image/tiff") {
    const buffer = await blob.arrayBuffer(),
      ifds = UTIF.decode(buffer),
      ifd = ifds[0] as UTIF.IFD & {
        t256?: number[];
        t257?: number[];
        t258?: number[];
        t262?: number[];
        t274?: number[];
        t277?: number[];
        t284?: number[];
        t339?: number[];
        t34675?: number[];
      };
    if (!ifd) throw Error("TIFF vide.");
    if (Number(ifd.t256?.[0]) * Number(ifd.t257?.[0]) > 100000000)
      throw Error("TIFF supérieur à 100 mégapixels.");
    if ((ifd.t339?.[0] || 1) !== 1 || ifd.t258?.some((n) => n > 16))
      throw Error(
        "TIFF signé ou flottant 32 bits : convertissez une copie en TIFF RGB 16 bits. L’original est conservé.",
      );
    // FFmpeg écrit le deflate sous le code 32946 (l'ancien code Adobe) : c'est
    // le même flux zlib que le code 8, mais UTIF ne connaît que 8 et rendait
    // une image NOIRE sans erreur. Tous les HEIC, PSD, JPEG XL… passent par
    // cette conversion (relecture du 29/09/2026). Une compression inconnue
    // doit échouer franchement plutôt que rendre du noir.
    const t259 = (ifd as { t259?: number[] }).t259;
    if (t259?.[0] === 32946) t259[0] = 8;
    if (t259?.[0] !== undefined && !COMPRESSIONS_TIFF.has(t259[0]))
      throw Error(
        `Compression TIFF ${t259[0]} non prise en charge : convertissez une copie en TIFF non compressé ou LZW. L’original est conservé.`,
      );
    UTIF.decodeImage(buffer, ifd);
    const channels = Number(ifd.t277?.[0] || 3),
      sixteen =
        ifd.t258?.every((n: number) => n === 16) &&
        [0, 1, 2].includes(ifd.t262?.[0] ?? 2) &&
        (ifd.t284?.[0] || 1) === 1 &&
        (ifd.t339?.[0] || 1) === 1;
    if (sixteen) {
      const out = new Uint16Array(ifd.width * ifd.height * 4),
        bytes = ifd.data,
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        little = new Uint8Array(buffer)[0] === 73;
      const gray = ifd.t262?.[0] === 0 || ifd.t262?.[0] === 1;
      const samples = gray ? Number(ifd.t277?.[0] || 1) : channels;
      for (let p = 0; p < ifd.width * ifd.height; p++) {
        for (let c = 0; c < 3; c++) {
          const value = view.getUint16(
            (p * samples + (gray ? 0 : c)) * 2,
            little,
          );
          out[p * 4 + c] = ifd.t262?.[0] === 0 ? 65535 - value : value;
        }
        out[p * 4 + 3] =
          samples === (gray ? 2 : 4)
            ? view.getUint16((p * samples + samples - 1) * 2, little)
            : 65535;
      }
      r = { width: ifd.width, height: ifd.height, data: out, bitDepth: 16 };
    } else {
      if (ifd.t258?.some((n) => n > 8))
        throw Error(
          "Organisation TIFF 16 bits non prise en charge. Convertissez une copie en TIFF RGB entrelacé.",
        );
      r = {
        width: ifd.width,
        height: ifd.height,
        data: new Uint8ClampedArray(UTIF.toRGBA8(ifd)),
        bitDepth: 8,
      };
    }
    if (ifd.t34675?.length) {
      if (ifd.t262?.[0] !== 2)
        throw Error(
          "TIFF avec profil ICC non RGB : conversion préalable requise.",
        );
      await convertIcc(r, new Uint8Array(ifd.t34675));
    } else
      r.color = {
        space: "sRGB",
        source: "assumed",
        profile: "sRGB présumé · TIFF sans profil",
      };
    const orientation = Number(ifd.t274?.[0] || 1);
    if (orientation !== 1) r = orientRaster(r, orientation);
  } else {
    let b: ImageBitmap;
    try {
      b = await createImageBitmap(blob, { imageOrientation: "from-image" });
    } catch {
      throw Error("Format image illisible ou non pris en charge.");
    }
    if (b.width * b.height > 100000000) {
      b.close();
      throw Error("Image supérieure à 100 mégapixels.");
    }
    const canvas = makeCanvas(b.width, b.height);
    canvas.width = b.width;
    canvas.height = b.height;
    const ctx = canvas.getContext("2d", {
      willReadFrequently: true,
      colorSpace: "srgb",
    }) as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(b, 0, 0);
    b.close();
    r = {
      width: canvas.width,
      height: canvas.height,
      data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      bitDepth: 8,
    };
    canvas.width = 1;
    canvas.height = 1;
  }
  if (!r.color)
    r.color = {
      space: "sRGB",
      source: "assumed",
      profile: "Décodage géré par le navigateur · sRGB",
    };
  if (!Number.isFinite(r.capturedAt)) delete r.capturedAt;
  remember(cacheKey, r);
  return r;
}
function orientRaster(r: Raster, o: number): Raster {
  const swap = o >= 5,
    w = swap ? r.height : r.width,
    h = swap ? r.width : r.height,
    out =
      r.data instanceof Uint16Array
        ? new Uint16Array(r.data.length)
        : new Uint8ClampedArray(r.data.length);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      let dx = x,
        dy = y;
      if (o === 2) dx = r.width - 1 - x;
      if (o === 3) {
        dx = r.width - 1 - x;
        dy = r.height - 1 - y;
      }
      if (o === 4) dy = r.height - 1 - y;
      if (o === 5) {
        dx = y;
        dy = x;
      }
      if (o === 6) {
        dx = r.height - 1 - y;
        dy = x;
      }
      if (o === 7) {
        dx = r.height - 1 - y;
        dy = r.width - 1 - x;
      }
      if (o === 8) {
        dx = y;
        dy = r.width - 1 - x;
      }
      for (let c = 0; c < 4; c++)
        out[(dy * w + dx) * 4 + c] = r.data[(y * r.width + x) * 4 + c];
    }
  return { ...r, width: w, height: h, data: out };
}
export function resizeRaster(r: Raster, max = 0): Raster {
  if (!max || Math.max(r.width, r.height) <= max)
    return { ...r, data: r.data.slice() };
  const ratio = max / Math.max(r.width, r.height),
    w = Math.max(1, Math.round(r.width * ratio)),
    h = Math.max(1, Math.round(r.height * ratio)),
    out =
      r.data instanceof Uint16Array
        ? new Uint16Array(w * h * 4)
        : new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = ((x + 0.5) * r.width) / w - 0.5,
        sy = ((y + 0.5) * r.height) / h - 0.5,
        x0 = Math.max(0, Math.floor(sx)),
        y0 = Math.max(0, Math.floor(sy)),
        x1 = Math.min(r.width - 1, x0 + 1),
        y1 = Math.min(r.height - 1, y0 + 1),
        fx = Math.max(0, sx - x0),
        fy = Math.max(0, sy - y0);
      for (let c = 0; c < 4; c++)
        out[(y * w + x) * 4 + c] = Math.round(
          (r.data[(y0 * r.width + x0) * 4 + c] * (1 - fx) +
            r.data[(y0 * r.width + x1) * 4 + c] * fx) *
            (1 - fy) +
            (r.data[(y1 * r.width + x0) * 4 + c] * (1 - fx) +
              r.data[(y1 * r.width + x1) * 4 + c] * fx) *
              fy,
        );
    }
  return { ...r, width: w, height: h, data: out };
}
export function rasterCanvas(r: Raster): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = r.width;
  c.height = r.height;
  const data =
    r.data instanceof Uint16Array
      ? vers8Bits(r.data)
      : new Uint8ClampedArray(r.data);
  c.getContext("2d")!.putImageData(
    new ImageData(data, r.width, r.height),
    0,
    0,
  );
  return c;
}
