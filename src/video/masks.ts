import type { Clip, Mask, MaskKey, Sequence } from "./types";
export const MASK_EFFECTS: { id: Mask["effect"]; name: string }[] = [
  { id: "blur", name: "Flou" },
  { id: "pixelate", name: "Pixelisation" },
  { id: "solid", name: "Cache plein" },
];
export const MASK_SHAPES: { id: Mask["shape"]; name: string }[] = [
  { id: "ellipse", name: "Ovale" },
  { id: "rectangle", name: "Rectangle" },
];
export const MASK_LIMIT = 6;
export const MASK_KEY_LIMIT = 2000;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** A mask holds its own key list; a lost position must never be invented. */
export function maskAt(mask: Mask, frame: number): MaskKey {
  const keys = mask.keys;
  if (!keys.length) return { frame, x: 0.5, y: 0.5 };
  if (frame <= keys[0].frame) return { ...keys[0], frame };
  for (let i = 1; i < keys.length; i++)
    if (frame < keys[i].frame) {
      const a = keys[i - 1],
        b = keys[i],
        t = (frame - a.frame) / (b.frame - a.frame);
      return {
        frame,
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      };
    }
  return { ...keys[keys.length - 1], frame };
}
export function newMask(effect: Mask["effect"] = "blur"): Mask {
  return {
    id: crypto.randomUUID(),
    effect,
    shape: "ellipse",
    width: 0.18,
    height: 0.24,
    strength: 0.6,
    feather: 0.25,
    color: "#000000",
    keys: [{ frame: 0, x: 0.5, y: 0.5 }],
  };
}
/** One position per frame: a new key replaces the key already on that frame. */
export function setMaskKey(mask: Mask, frame: number, x: number, y: number) {
  if (!Number.isInteger(frame) || frame < 0)
    throw Error("Placez le curseur dans le plan pour poser un repère.");
  const keys = [
    ...mask.keys.filter((k) => k.frame !== frame),
    { frame, x: clamp(x, -1, 2), y: clamp(y, -1, 2) },
  ].sort((a, b) => a.frame - b.frame);
  if (keys.length > MASK_KEY_LIMIT)
    throw Error(`Maximum de ${MASK_KEY_LIMIT} repères par masque.`);
  return { ...mask, keys };
}
export function removeMaskKey(mask: Mask, frame: number) {
  const keys = mask.keys.filter((k) => k.frame !== frame);
  return keys.length ? { ...mask, keys } : mask;
}
/** Trimming a clip must keep the interpolation the editor already saw. */
export function retimeMask(
  mask: Mask,
  offset = 0,
  ratio = 1,
  duration?: number,
): Mask {
  const moved = [
    ...new Map(
      // Keep frames outside the clip for now: they carry the interpolation.
      mask.keys.map((k) => {
        const frame = Math.round((k.frame - offset) * ratio);
        return [frame, { ...k, frame }] as const;
      }),
    ).values(),
  ].sort((a, b) => a.frame - b.frame);
  const last = duration === undefined ? Infinity : Math.max(0, duration - 1);
  const shifted = { ...mask, keys: moved };
  // Cutting a clip must keep the position the editor saw at the new edges,
  // so each border gets the interpolated key instead of a neighbour's value.
  const keys = moved.filter((k) => k.frame >= 0 && k.frame <= last);
  if (moved.some((k) => k.frame < 0)) keys.unshift(maskAt(shifted, 0));
  if (last !== Infinity && moved.some((k) => k.frame > last))
    keys.push(maskAt(shifted, last));
  if (!keys.length) keys.push(maskAt(shifted, Math.min(0, last)));
  return {
    ...mask,
    keys: [...new Map(keys.map((k) => [k.frame, k] as const)).values()].sort(
      (a, b) => a.frame - b.frame,
    ),
  };
}
export function retimeMasks(
  clip: Pick<Clip, "masks">,
  offset = 0,
  ratio = 1,
  duration?: number,
) {
  if (!clip.masks?.length) return clip.masks;
  return clip.masks.map((m) => retimeMask(m, offset, ratio, duration));
}
/** Even pixel sizes keep FFmpeg crop and scale filters exact. */
export function maskPixels(mask: Mask, s: Pick<Sequence, "width" | "height">) {
  const width = Math.max(
      8,
      Math.min(s.width, Math.round((mask.width * s.width) / 2) * 2),
    ),
    height = Math.max(
      8,
      Math.min(s.height, Math.round((mask.height * s.height) / 2) * 2),
    );
  return { width, height };
}
/** Blur radius and pixel block, derived once so preview and export agree. */
export function maskAmount(mask: Mask, s: Pick<Sequence, "width" | "height">) {
  const { width, height } = maskPixels(mask, s),
    small = Math.min(width, height),
    strength = clamp(mask.strength, 0, 1);
  // Same formula as electron/video/masks.cjs, so monitor and export agree.
  return {
    width,
    height,
    sigma: Math.max(0.5, Math.round(small * (0.02 + strength * 0.1) * 10) / 10),
    block: Math.max(
      2,
      Math.min(1024, Math.round((small * (0.04 + strength * 0.16)) / 2) * 2),
    ),
  };
}
/** Grayscale alpha of the shape, with a feathered edge, as a canvas. */
export function maskCanvas(
  mask: Mask,
  s: Pick<Sequence, "width" | "height">,
): HTMLCanvasElement {
  const { width, height } = maskPixels(mask, s),
    canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Rendu du masque indisponible");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);
  // A blurred solid shape gives the same soft edge to both forms and corners.
  const feather = clamp(mask.feather, 0, 0.5),
    radius = Math.round((Math.min(width, height) * feather) / 2),
    inset = radius;
  ctx.filter = radius > 0 ? `blur(${radius / 2}px)` : "none";
  ctx.fillStyle = "#ffffff";
  if (mask.shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      width / 2,
      height / 2,
      Math.max(1, width / 2 - inset),
      Math.max(1, height / 2 - inset),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  } else
    ctx.fillRect(
      inset,
      inset,
      Math.max(1, width - inset * 2),
      Math.max(1, height - inset * 2),
    );
  ctx.filter = "none";
  return canvas;
}
/** Top-left corner in sequence pixels, as FFmpeg crop and overlay need it. */
export function maskCorner(
  mask: Mask,
  key: MaskKey,
  s: Pick<Sequence, "width" | "height">,
) {
  const { width, height } = maskPixels(mask, s);
  return {
    x: Math.round(key.x * s.width - width / 2),
    y: Math.round(key.y * s.height - height / 2),
  };
}
/**
 * Reporte sur le montage ouvert les masques que le suivi a remplis entre-temps.
 *
 * Le suivi écrit ses repères sur la séquence enregistrée et en change la
 * version. Une retouche faite pendant qu'il tournait partait donc sur une
 * version périmée, et l'enregistrement la refusait. Seuls les masques suivis
 * sont repris, et seulement s'ils existent encore dans le montage ouvert :
 * tout le reste garde la retouche. Renvoie null quand rien n'est à reprendre,
 * c'est-à-dire quand le conflit ne vient pas du suivi.
 */
export function adoptTracked(
  local: Sequence,
  stored: Sequence,
): Sequence | null {
  let adopted = false;
  const clips = local.clips.map((c) => {
    const saved = stored.clips.find((x) => x.id === c.id);
    if (!c.masks?.length || !saved?.masks?.length) return c;
    let touched = false;
    const masks = c.masks.map((m) => {
      const done = saved.masks!.find((x) => x.id === m.id);
      if (
        !done?.tracked ||
        JSON.stringify(done.tracked) === JSON.stringify(m.tracked)
      )
        return m;
      touched = true;
      const last = Math.max(0, c.duration - 1);
      // Les repères suivent le plan enregistré : ceux qui débordent d'un plan
      // raccourci entre-temps sont ramenés à son bord.
      const keys = retimeMask(done, 0, 1, c.duration).keys.filter(
        (k) => k.frame <= last,
      );
      return { ...m, keys, tracked: done.tracked };
    });
    if (!touched) return c;
    adopted = true;
    return { ...c, masks };
  });
  return adopted ? { ...local, clips } : null;
}
