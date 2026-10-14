import { valueAt, type Keyframe } from "./animation";
export type MotionField = "x" | "y" | "scale" | "rotation" | "opacity";
export type Motion = Partial<Record<MotionField, Keyframe[]>>;
export const MOTION_FIELDS: Record<
  MotionField,
  { label: string; min: number; max: number; fallback: number }
> = {
  x: { label: "Déplacement X", min: -2, max: 2, fallback: 0 },
  y: { label: "Déplacement Y", min: -2, max: 2, fallback: 0 },
  scale: { label: "Échelle", min: 0.1, max: 3, fallback: 1 },
  rotation: { label: "Rotation", min: -360, max: 360, fallback: 0 },
  opacity: { label: "Opacité", min: 0, max: 1, fallback: 1 },
};
export function motionAt(m: Motion | undefined, frame: number) {
  return Object.fromEntries(
    Object.entries(MOTION_FIELDS).map(([key, range]) => [
      key,
      valueAt(m?.[key as MotionField], frame, range.fallback),
    ]),
  ) as Record<MotionField, number>;
}
export function motionKey(
  m: Motion | undefined,
  field: MotionField,
  frame: number,
  value: number,
  duration: number,
  easing: Keyframe["easing"] = "smooth",
): Motion {
  const range = MOTION_FIELDS[field];
  if (
    !range ||
    !Number.isFinite(value) ||
    value < range.min ||
    value > range.max ||
    !Number.isInteger(frame) ||
    frame < 0 ||
    frame >= duration
  )
    throw Error(
      "Placez le curseur dans cet élément et choisissez une valeur valide.",
    );
  const keys = [
    ...(m?.[field] ?? []).filter((k) => k.frame !== frame),
    { frame, value, easing },
  ].sort((a, b) => a.frame - b.frame);
  if (keys.length > 32) throw Error("Maximum de 32 images clés par propriété.");
  return { ...m, [field]: keys };
}
export function motionPreset(
  name: string,
  duration: number,
  rate: number,
): Motion {
  const end = Math.min(duration - 1, Math.max(1, Math.round(rate * 0.4))),
    k = (value: number, frame: number): Keyframe => ({
      frame,
      value,
      easing: "smooth",
    });
  if (duration < 2) return {};
  const a = (value: number, frame: number): Keyframe => ({
    frame,
    value,
    easing: "linear",
  });
  if (name === "fade")
    return {
      opacity: [
        a(0, 0),
        a(1, end),
        ...(duration > end * 2 + 1
          ? [a(1, duration - 1 - end), a(0, duration - 1)]
          : []),
      ],
    };
  if (name === "rise")
    return { y: [k(0.12, 0), k(0, end)], opacity: [a(0, 0), a(1, end)] };
  if (name === "pop")
    return {
      scale: [k(0.65, 0), k(1, end)],
      opacity: [a(0, 0), a(1, Math.max(1, Math.floor(end / 2)))],
    };
  if (name === "slide")
    return { x: [k(-0.3, 0), k(0, end)], opacity: [a(0, 0), a(1, end)] };
  return {};
}
/** Bounded lane allocation keeps overlapping graphics independently selectable. */
export function graphicLanes(titles: import("./types").Title[]) {
  const lanes: import("./types").Title[][] = [],
    ends: number[] = [];
  for (const t of [...titles].sort((a, b) => a.start - b.start)) {
    let i = ends.findIndex((end) => end <= t.start);
    if (i < 0) i = Math.min(lanes.length, 19);
    (lanes[i] ??= []).push(t);
    ends[i] = Math.max(ends[i] ?? 0, t.start + t.duration);
  }
  return lanes;
}
