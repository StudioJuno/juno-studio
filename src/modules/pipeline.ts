import { advancedColor, advancedDetails } from "./advanced-color";
import { transform } from "../pixels";
import { applyLocalEdits } from "./local-edits";
import { angleOf, effectiveCrop, pixelSource } from "./geometry";
import { resizeRaster, type Raster } from "./raster";
import type { Adjustments } from "../model";
import type { MasquesSujet } from "./subject";
export function processRaster(
  original: Raster,
  a: Adjustments,
  max = 1600,
  subject?: MasquesSujet,
): Raster {
  const crop = effectiveCrop(a, original.width, original.height);

  const raster = resizeRaster(
    original,
    max ? Math.ceil(max / Math.max(0.1, Math.min(crop.w, crop.h))) : 0,
  );
  transform(raster.data, raster.width, raster.height, a);
  advancedColor(raster.data, a);
  advancedDetails(raster.data, raster.width, raster.height, a);
  applyLocalEdits(raster.data, raster.width, raster.height, a.localEdits, subject);
  // Redressé : une seule passe inverse, pixel de sortie → point de la source,
  // en bilinéaire. Les retouches locales, faites avant, restent à leur place.
  if (angleOf(a)) return resizeRaster(redresser(raster, a), max);
  const sx = Math.round(crop.x * raster.width),
    sy = Math.round(crop.y * raster.height),
    sw = Math.max(
      1,
      Math.min(raster.width - sx, Math.round(crop.w * raster.width)),
    ),
    sh = Math.max(
      1,
      Math.min(raster.height - sy, Math.round(crop.h * raster.height)),
    ),
    rotation = ((a.rotation % 360) + 360) % 360;
  const swap = rotation === 90 || rotation === 270,
    w = swap ? sh : sw,
    h = swap ? sw : sh;
  const data =
    raster.data instanceof Uint16Array
      ? new Uint16Array(w * h * 4)
      : new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      let dx = x,
        dy = y;
      if (rotation === 90) {
        dx = sh - 1 - y;
        dy = x;
      } else if (rotation === 180) {
        dx = sw - 1 - x;
        dy = sh - 1 - y;
      } else if (rotation === 270) {
        dx = y;
        dy = sw - 1 - x;
      }
      const from = ((sy + y) * raster.width + sx + x) * 4,
        to = (dy * w + dx) * 4;
      for (let ch = 0; ch < 4; ch++) data[to + ch] = raster.data[from + ch];
    }
  return resizeRaster({ ...raster, width: w, height: h, data }, max);
}

/**
 * Redresser, recadrer et tourner en une seule lecture.
 *
 * Le même échantillonnage bilinéaire que `resizeRaster`, et le même type de
 * tampon que la source : un TIFF 16 bits reste en 16 bits.
 */
function redresser(raster: Raster, a: Adjustments): Raster {
  const W = raster.width,
    H = raster.height,
    m = pixelSource(a, W, H),
    src = raster.data,
    w = m.largeur,
    h = m.hauteur;
  const data =
    src instanceof Uint16Array ? new Uint16Array(w * h * 4) : new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let [fx, fy] = m.lire(x, y);
      fx = Math.min(W - 1, Math.max(0, fx));
      fy = Math.min(H - 1, Math.max(0, fy));
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        x1 = Math.min(W - 1, x0 + 1),
        y1 = Math.min(H - 1, y0 + 1),
        tx = fx - x0,
        ty = fy - y0,
        o = (y * w + x) * 4,
        a0 = (y0 * W + x0) * 4,
        a1 = (y0 * W + x1) * 4,
        b0 = (y1 * W + x0) * 4,
        b1 = (y1 * W + x1) * 4;
      for (let c = 0; c < 4; c++)
        data[o + c] = Math.round(
          (src[a0 + c] * (1 - tx) + src[a1 + c] * tx) * (1 - ty) +
            (src[b0 + c] * (1 - tx) + src[b1 + c] * tx) * ty,
        );
    }
  return { ...raster, width: w, height: h, data };
}
