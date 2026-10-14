import type { Caption, TranscriptSegment } from "./types";
/** Keep measured timings only when the corrected words have a one-to-one mapping. */
export function correctTranscript(
  segment: TranscriptSegment,
  text: string,
): TranscriptSegment {
  const value = text.trim();
  if (value === segment.text) return segment;
  const words = value.split(/\s+/).filter(Boolean);
  return {
    ...segment,
    text: value,
    words:
      words.length === segment.words?.length
        ? segment.words.map((w, i) => ({
            start: w.start,
            end: w.end,
            text: words[i],
            ...(words[i] === w.text && w.confidence !== undefined
              ? { confidence: w.confidence }
              : {}),
          }))
        : undefined,
  };
}
export function correctCaptionWord(
  c: Caption,
  index: number,
  text: string,
): Caption {
  const word = c.words?.[index],
    value = text.trim();
  if (!word || !value || /\s/.test(value)) return c;
  const delta = value.length - (word.to - word.from);
  return {
    ...c,
    text: c.text.slice(0, word.from) + value + c.text.slice(word.to),
    words: c.words!.map((w, i) =>
      i < index
        ? w
        : i === index
          ? { ...w, to: w.to + delta, confidence: undefined }
          : { ...w, from: w.from + delta, to: w.to + delta },
    ),
  };
}
export function captionIssues(c: Caption, fps: { n: number; d: number }) {
  const issues: string[] = [],
    duration = (c.duration * fps.d) / fps.n;
  if (c.text.replace(/\s/g, "").length / Math.max(0.01, duration) > 22)
    issues.push("Lecture rapide : allongez ou raccourcissez le texte.");
  if (c.text.split("\n").some((line) => line.length > 42))
    issues.push("Ligne longue : vérifiez le cadrage, surtout en vertical.");
  if (c.words?.some((w) => w.confidence !== undefined && w.confidence < 0.65))
    issues.push("Certains mots sont incertains : écoutez et relisez.");
  return issues;
}
