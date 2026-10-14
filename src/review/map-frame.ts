import type { Sequence } from "../video/types";
/** A published time never silently becomes a different scene after a cut. */
export function mapReviewFrame(
  published: Sequence,
  current: Sequence,
  frame: number,
): number | null {
  const temporal = (s: Sequence) =>
    s.clips.map((c) => [
      c.id,
      c.assetId,
      c.start,
      c.duration,
      c.inUs,
      c.speed,
      c.track,
    ]);
  if (
    published.fps.n === current.fps.n &&
    published.fps.d === current.fps.d &&
    JSON.stringify(temporal(published)) === JSON.stringify(temporal(current))
  )
    return frame;
  const active = published.clips.filter(
    (c) => frame >= c.start && frame < c.start + c.duration,
  );
  if (active.length !== 1) return null;
  const old = active[0],
    sourceUs =
      old.inUs +
      (((frame - old.start) * published.fps.d) / published.fps.n) *
        1e6 *
        old.speed;
  const candidates = current.clips.filter(
    (c) =>
      c.assetId === old.assetId &&
      sourceUs >= c.inUs &&
      sourceUs <
        c.inUs + ((c.duration * current.fps.d) / current.fps.n) * 1e6 * c.speed,
  );
  const exact = candidates.filter((c) => c.id === old.id),
    matches = exact.length === 1 ? exact : candidates;
  if (matches.length !== 1) return null;
  const next = matches[0],
    mapped = Math.round(
      next.start +
        (((sourceUs - next.inUs) / 1e6 / next.speed) * current.fps.n) /
          current.fps.d,
    );
  return mapped >= next.start && mapped < next.start + next.duration
    ? mapped
    : null;
}
