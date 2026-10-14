import type { CaptionStyle, Sequence, Title } from "./types";
/** Text size follows the delivery format: a 240 px cap starves 4K and 6K sequences. */
export function titleSizeLimit(height: number) {
  return Math.max(240, Math.round(Math.min(8192, Math.max(1, height)) / 2));
}
export function scaleTitle(t: Title, factor: number, height: number): Title {
  if (!Number.isFinite(factor) || factor <= 0) return t;
  if (t.graphic) {
    const width = Math.min(1, Math.max(0.01, t.graphic.width * factor)),
      graphicHeight = Math.min(1, Math.max(0.01, t.graphic.height * factor));
    return { ...t, graphic: { ...t.graphic, width, height: graphicHeight } };
  }
  const size = Math.round(
    Math.min(titleSizeLimit(height), Math.max(12, t.size * factor)),
  );
  return { ...t, size };
}
/**
 * Change la définition d'une séquence en gardant ses textes à la même
 * proportion de l'image.
 *
 * La taille d'un titre est en pixels et son plafond suit la hauteur : passer
 * de 4K à Full HD laissait un titre de 700 px au-dessus du plafond de 540, et
 * plus rien ne s'enregistrait. Les tailles suivent le plus petit côté de
 * l'image, qui garde son rapport d'un format à l'autre (4K vers vertical
 * Full HD : moitié).
 */
export function changeDefinition(
  s: Sequence,
  width: number,
  height: number,
): Sequence {
  if (width === s.width && height === s.height) return s;
  const factor =
      Math.min(width, height) / Math.max(1, Math.min(s.width, s.height)),
    limit = titleSizeLimit(height);
  const bound = (v: number, min: number, max: number) =>
    Math.round(Math.min(max, Math.max(min, v * factor)));
  function restyle<T extends CaptionStyle>(t: T): T {
    const next = { ...t };
    if (t.size !== undefined) next.size = bound(t.size, 12, limit);
    if (t.strokeWidth !== undefined)
      next.strokeWidth = bound(t.strokeWidth, 0, 24);
    if (t.padding !== undefined) next.padding = bound(t.padding, 0, 200);
    return next;
  }
  return {
    ...s,
    width,
    height,
    titles: s.titles.map((t) => restyle(t)),
    captions: s.captions.map((c) =>
      c.style ? { ...c, style: restyle(c.style) } : c,
    ),
    ...(s.captionStyle ? { captionStyle: restyle(s.captionStyle) } : {}),
  };
}
export function rotateTitle(t: Title, degrees: number): Title {
  if (!Number.isFinite(degrees)) return t;
  return {
    ...t,
    rotation: Math.round(Math.min(180, Math.max(-180, degrees)) * 10) / 10,
  };
}
/** A drag reports its own factor so the committed value never compounds rounding. */
export function dragFactor(
  from: { x: number; y: number },
  to: { x: number; y: number },
  anchor: { x: number; y: number },
) {
  const before = Math.hypot(from.x - anchor.x, from.y - anchor.y),
    after = Math.hypot(to.x - anchor.x, to.y - anchor.y);
  if (before < 4) return 1;
  return Math.min(64, Math.max(1 / 64, after / before));
}
export function dragAngle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  anchor: { x: number; y: number },
) {
  const before = Math.atan2(from.y - anchor.y, from.x - anchor.x),
    after = Math.atan2(to.y - anchor.y, to.x - anchor.x);
  let delta = ((after - before) * 180) / Math.PI;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}
/** Keep a rotation readable after several turns instead of sticking to the bound. */
export function wrapDegrees(value: number) {
  let v = value;
  while (v > 180) v -= 360;
  while (v < -180) v += 360;
  return v;
}
