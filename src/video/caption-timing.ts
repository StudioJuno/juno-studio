import type { Caption, Clip, Sequence, TranscriptSegment } from "./types";
import { frame, seconds } from "./edit";
export function clipCaptions(
  segments: TranscriptSegment[],
  clip: Clip,
  s: Sequence,
): Caption[] {
  const begin = clip.inUs / 1e6,
    end = begin + seconds(clip.duration, s) * clip.speed;
  return segments
    .filter((t) => t.start < end && t.end > begin)
    .flatMap((t) => {
      const start =
          clip.start +
          frame((Math.max(begin, t.start) - begin) / clip.speed, s),
        finish = Math.min(
          clip.start + clip.duration,
          clip.start + frame((Math.min(end, t.end) - begin) / clip.speed, s),
        );
      if (finish <= start) return [];
      let offset = 0,
        previous = 0;
      const words = t.words?.flatMap((w) => {
        const from = t.text.indexOf(w.text, offset);
        if (from < 0) return [];
        offset = from + w.text.length;
        const left = Math.max(
            previous,
            0,
            clip.start + frame((w.start - begin) / clip.speed, s) - start,
          ),
          right = Math.min(
            finish - start,
            clip.start + frame((w.end - begin) / clip.speed, s) - start,
          );
        if (right <= left) return [];
        previous = right;
        return [
          {
            start: left,
            end: right,
            from,
            to: offset,
            ...(w.confidence !== undefined ? { confidence: w.confidence } : {}),
          },
        ];
      });
      return [
        {
          id: crypto.randomUUID(),
          text: t.text,
          start,
          duration: finish - start,
          ...(words?.length ? { words } : {}),
          autoSource: clip.id,
        },
      ];
    });
}
