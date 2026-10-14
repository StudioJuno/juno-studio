/** Preserve measured word intervals from Whisper; never interpolate missing timestamps. */
function parseWords(data, offset, duration) {
  const words = [];
  for (const segment of data.transcription ?? []) {
    const raw = String(segment.text ?? ""),
      text = raw.trim();
    if (!text || /^\[.*\]$/.test(text) || /^<\|.*\|>$/.test(text)) continue;
    let start = offset + Number(segment.offsets?.from) / 1000,
      end = offset + Number(segment.offsets?.to) / 1000;
    const tokens = (segment.tokens ?? []).filter(
      (t) =>
        !/^\[_|^<\|/.test(String(t.text)) &&
        Number.isFinite(t.offsets?.from) &&
        t.offsets.to > t.offsets.from,
    );
    const probabilities = tokens
      .map((t) => t.p)
      .filter(
        (p) => typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1,
      );
    const confidence = probabilities.length
      ? Math.min(...probabilities)
      : undefined;
    if (tokens.length) {
      start = Math.max(
        start,
        offset + Math.min(...tokens.map((t) => t.offsets.from)) / 1000,
      );
      end = Math.min(
        end,
        offset + Math.max(...tokens.map((t) => t.offsets.to)) / 1000,
      );
    }
    start = Math.max(0, start);
    end = Math.min(duration, end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      continue;
    const last = words.at(-1);
    if (last && !/^\s/.test(raw)) {
      if (confidence !== undefined)
        last.confidence = Math.min(last.confidence ?? 1, confidence);
      last.text += text;
      last.end = Math.max(last.end, end);
      continue;
    }
    if (last) start = Math.max(start, last.end);
    if (end <= start) continue;
    words.push({
      start,
      end,
      text,
      ...(confidence !== undefined ? { confidence } : {}),
    });
  }
  const segments = [];
  let group = [];
  const flush = () => {
    if (group.length)
      segments.push({
        start: group[0].start,
        end: group.at(-1).end,
        text: group.map((w) => w.text).join(" "),
        words: group,
      });
    group = [];
  };
  for (const w of words) {
    if (
      group.length &&
      (group.length >= 6 ||
        group.map((w) => w.text).join(" ").length + w.text.length > 42 ||
        w.start - group[0].start > 3 ||
        w.start - group.at(-1).end > 1)
    )
      flush();
    group.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return segments;
}
function validateWords(segment) {
  if (segment.words === undefined) return;
  if (!Array.isArray(segment.words) || segment.words.length > 200)
    throw Error("Repères de mots invalides");
  let previous = segment.start;
  for (const w of segment.words) {
    if (
      typeof w.text !== "string" ||
      !w.text.trim() ||
      w.text.length > 4000 ||
      typeof w.start !== "number" ||
      typeof w.end !== "number" ||
      !Number.isFinite(w.start) ||
      !Number.isFinite(w.end) ||
      w.start < previous ||
      w.end <= w.start ||
      w.end > segment.end + 0.000001
    )
      throw Error("Repère de mot invalide");
    if (
      w.confidence !== undefined &&
      (typeof w.confidence !== "number" ||
        !Number.isFinite(w.confidence) ||
        w.confidence < 0 ||
        w.confidence > 1)
    )
      throw Error("Confiance du mot invalide");
    previous = w.end;
  }
  if (segment.words.map((w) => w.text).join(" ") !== segment.text)
    throw Error("Les repères ne correspondent pas au texte");
}
module.exports = { parseWords, validateWords };
