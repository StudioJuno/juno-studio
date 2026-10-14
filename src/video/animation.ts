import type { Clip } from "./types";
export type AnimatedField = "x" | "y" | "gain";
export type Keyframe = {
  frame: number;
  value: number;
  easing: "linear" | "smooth" | "hold";
};
export type Animation = Partial<Record<AnimatedField, Keyframe[]>>;
export const ANIMATION_FIELDS: Record<
  AnimatedField,
  { name: string; min: number; max: number }
> = {
  x: { name: "Position horizontale", min: -2, max: 2 },
  y: { name: "Position verticale", min: -2, max: 2 },
  gain: { name: "Volume", min: 0, max: 4 },
};
export function valueAt(
  keys: Keyframe[] | undefined,
  frame: number,
  fallback: number,
): number {
  if (!keys?.length) return fallback;
  if (frame <= keys[0].frame) return keys[0].value;
  for (let i = 1; i < keys.length; i++)
    if (frame < keys[i].frame) {
      const a = keys[i - 1],
        b = keys[i];
      let t = (frame - a.frame) / (b.frame - a.frame);
      if (a.easing === "hold") t = 0;
      else if (a.easing === "smooth") t = t * t * (3 - 2 * t);
      return a.value + (b.value - a.value) * t;
    }
  return keys[keys.length - 1].value;
}
export function animatedClip(c: Clip, frame: number): Clip {
  if (!c.animation) return c;
  return {
    ...c,
    ...Object.fromEntries(
      (Object.keys(ANIMATION_FIELDS) as AnimatedField[]).map((k) => [
        k,
        valueAt(c.animation?.[k], frame - c.start, c[k]),
      ]),
    ),
  };
}
export function addKey(
  c: Clip,
  field: AnimatedField,
  frame: number,
  value: number,
  easing: Keyframe["easing"] = "linear",
): Clip {
  const range = ANIMATION_FIELDS[field];
  if (
    !range ||
    !Number.isFinite(value) ||
    value < range.min ||
    value > range.max ||
    !Number.isInteger(frame) ||
    frame < 0 ||
    frame >= c.duration
  )
    throw Error(
      "Placez le curseur dans le plan et indiquez une valeur valide.",
    );
  const keys = [
    ...(c.animation?.[field] || []).filter((k) => k.frame !== frame),
    { frame, value, easing },
  ].sort((a, b) => a.frame - b.frame);
  if (keys.length > 32)
    throw Error("Maximum de 32 images clés par propriété et par plan.");
  return { ...c, animation: { ...c.animation, [field]: keys } };
}
/** Retain outside anchors: a trim must preserve the existing interpolation. */
export function retimeAnimation(
  animation: Animation | undefined,
  offset = 0,
  ratio = 1,
): Animation | undefined {
  if (!animation) return undefined;
  return Object.fromEntries(
    Object.entries(animation).map(([field, keys]) => [
      field,
      [
        ...new Map(
          keys!.map((k) => {
            const frame = Math.round((k.frame - offset) * ratio);
            return [frame, { ...k, frame }] as const;
          }),
        ).values(),
      ].sort((a, b) => a.frame - b.frame),
    ]),
  );
}
