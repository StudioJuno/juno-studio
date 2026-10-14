import type { Caption, Sequence } from "./types";
import { frame } from "./edit";
export function parseSrt(text: string, sequence: Sequence): Caption[] {
  if (text.length > 5e6) throw Error("Fichier de sous-titres trop volumineux");
  const blocks = text
      .replace(/^\uFEFF/, "")
      .replace(/\r/g, "")
      .trim()
      .split(/\n\s*\n/),
    out: Caption[] = [];
  const stamp = (s: string) => {
    const m = /^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})$/.exec(s.trim());
    if (!m || Number(m[2]) > 59 || Number(m[3]) > 59)
      throw Error("Timecode SRT invalide");
    return (
      Number(m[1]) * 3600 +
      Number(m[2]) * 60 +
      Number(m[3]) +
      Number(m[4]) / 1000
    );
  };
  for (const b of blocks) {
    const lines = b.split("\n");
    if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
    const times = lines.shift()?.split(/\s*-->\s*/);
    if (!times || times.length !== 2) throw Error("Fichier SRT invalide");
    const start = frame(stamp(times[0]), sequence),
      end = frame(stamp(times[1]), sequence),
      caption = lines.join("\n").trim();
    if (end <= start || !caption || caption.length > 2000)
      throw Error("Durée ou texte de sous-titre invalide");
    out.push({
      id: crypto.randomUUID(),
      start,
      duration: end - start,
      text: caption,
    });
    if (out.length > 20000) throw Error("Trop de sous-titres");
  }
  return out.sort((a, b) => a.start - b.start);
}
