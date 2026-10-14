// Analyse de la parole et enveloppe d'atténuation de la musique.
//
// Pourquoi pas sidechaincompress : le rendu se fait par segments de 250 images.
// Un compresseur repart de zéro à chaque frontière, donc la musique remonterait
// brièvement toutes les dix secondes pendant un discours. Une enveloppe calculée
// à partir du temps absolu donne exactement le même effet et reste continue,
// quelle que soit la découpe en segments.
const fmt = (n) => Number(n).toFixed(6);
/** Les intervalles de silence rapportés par le filtre silencedetect. */
function parseSilence(text, duration) {
  const out = [];
  let open = null;
  for (const m of String(text).matchAll(
    /silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g,
  )) {
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    if (m[1] === "start") open = Math.max(0, value);
    else if (open !== null) {
      if (value > open) out.push({ start: open, end: value });
      open = null;
    }
  }
  // Un silence encore ouvert court jusqu'à la fin du média.
  if (open !== null && Number.isFinite(duration) && duration > open)
    out.push({ start: open, end: duration });
  return out;
}
/** Ce qui n'est pas silence est parole : l'inverse des intervalles. */
function speechFrom(silences, duration) {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const sorted = [...silences]
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const s of sorted) {
    if (s.start > cursor) out.push({ start: cursor, end: Math.min(s.start, duration) });
    cursor = Math.max(cursor, s.end);
    if (cursor >= duration) break;
  }
  if (cursor < duration) out.push({ start: cursor, end: duration });
  return out.filter((s) => s.end > s.start);
}
/** Fusionne des intervalles qui se touchent ou se chevauchent. */
function mergeIntervals(list, gap = 0) {
  const sorted = [...list]
    .filter((s) => Number.isFinite(s.start) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= gap) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}
/**
 * Place les intervalles d'un média sur la ligne de temps du montage.
 * Le point d'entrée et la vitesse du plan sont pris en compte : un plan ralenti
 * étire aussi ses silences.
 */
function toTimeline(intervals, clip, fps) {
  const rate = fps.n / fps.d,
    inSec = clip.inUs / 1e6,
    speed = clip.speed || 1;
  const clipStart = clip.start / rate,
    clipEnd = (clip.start + clip.duration) / rate;
  const out = [];
  for (const s of intervals) {
    const a = clipStart + (s.start - inSec) / speed,
      b = clipStart + (s.end - inSec) / speed;
    const start = Math.max(a, clipStart),
      end = Math.min(b, clipEnd);
    if (end > start) out.push({ start, end });
  }
  return out;
}
/**
 * Les moments où l'on parle, en secondes de montage, pour toute la séquence.
 *
 * Un plan marqué « voix » dont le média n'a pas encore été analysé compte
 * pour de la parole sur toute sa durée : mieux vaut atténuer un peu trop que
 * laisser la musique couvrir un discours. L'analyse affine ensuite.
 */
function sequenceSpeech(sequence, assets) {
  const out = [];
  for (const c of sequence.clips) {
    if (c.audioRole !== "voice" || c.muted) continue;
    if (sequence.tracks?.[c.track]?.muted) continue;
    // Une voix inaudible n'a rien à couvrir : elle n'atténue pas la musique.
    const audible =
      (c.gain ?? 1) > 0 || c.animation?.gain?.some((k) => k.value > 0);
    if (!audible) continue;
    const asset = assets.get?.(c.assetId) ?? assets[c.assetId];
    const rate = sequence.fps.n / sequence.fps.d;
    const whole = {
      start: c.start / rate,
      end: (c.start + c.duration) / rate,
    };
    const silences = asset?.analysis?.silences;
    if (!Array.isArray(silences) || !asset?.duration) {
      out.push(whole);
      continue;
    }
    const speech = speechFrom(silences, asset.duration);
    if (!speech.length) continue;
    out.push(...toTimeline(speech, c, sequence.fps));
  }
  // Deux respirations très proches ne valent pas la peine d'être séparées.
  return mergeIntervals(out, 0.2);
}
const DUCK = { depth: 0.65, attack: 0.25, release: 0.6, hold: 0.35 };
function validateDuck(input = {}) {
  const v = { ...DUCK, ...input };
  for (const [key, min, max] of [
    ["depth", 0, 1],
    ["attack", 0.01, 2],
    ["release", 0.05, 5],
    ["hold", 0, 3],
  ])
    if (typeof v[key] !== "number" || !Number.isFinite(v[key]) || v[key] < min || v[key] > max)
      throw Error("Réglage d'atténuation invalide : " + key);
  return { depth: v.depth, attack: v.attack, release: v.release, hold: v.hold };
}
/**
 * L'expression de volume à appliquer à la musique, en fonction du temps absolu.
 * `window` limite l'expression aux intervalles qui touchent le segment rendu :
 * sans cela un discours d'une heure produirait une expression illisible.
 */
function duckExpression(speech, options = {}, window, clock = "t") {
  const o = validateDuck(options);
  if (!o.depth) return null;
  const grown = mergeIntervals(
    speech.map((s) => ({
      start: s.start - o.attack,
      end: s.end + o.hold,
    })),
    o.attack + o.release,
  );
  const useful = window
    ? grown.filter(
        (s) => s.end + o.release > window.start && s.start < window.end,
      )
    : grown;
  if (!useful.length) return null;
  // `clock` porte le temps absolu du montage : dans le graphe de rendu, `t`
  // repart de zéro à chaque plan, l'enveloppe doit donc être décalée.
  const traps = useful.map(
    (s) =>
      `min(clip((${clock}-${fmt(s.start)})/${fmt(o.attack)}\\,0\\,1)\\,` +
      `clip((${fmt(s.end + o.release)}-${clock})/${fmt(o.release)}\\,0\\,1))`,
  );
  const duck = traps.reduce((acc, x) => (acc ? `max(${acc}\\,${x})` : x), "");
  return `1-${fmt(o.depth)}*(${duck})`;
}
/** Les cibles de livraison, en LUFS, telles qu'un diffuseur les demande. */
const TARGETS = {
  reseaux: { i: -14, tp: -1, lra: 11, label: "Réseaux sociaux" },
  television: { i: -23, tp: -1, lra: 7, label: "Télévision (EBU R128)" },
  cinema: { i: -27, tp: -2, lra: 20, label: "Cinéma" },
  podcast: { i: -16, tp: -1, lra: 11, label: "Podcast" },
};
function normaliseFilter(target, measured) {
  const t = TARGETS[target];
  if (!t) throw Error("Cible de niveau inconnue : " + target);
  const base = `loudnorm=I=${t.i}:TP=${t.tp}:LRA=${t.lra}`;
  if (!measured) return base;
  // La seconde passe part de la mesure : c'est elle qui rend le niveau exact.
  const m = measuredValues(measured);
  if (!m) return base;
  return (
    base +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
    `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
    `:offset=${m.target_offset}:linear=true:print_format=summary`
  );
}
/** La mesure de la première passe, refusée si elle contient un infini. */
function measuredValues(json) {
  const data = typeof json === "string" ? parseLoudnorm(json) : json;
  if (!data) return null;
  const keys = [
    "input_i",
    "input_tp",
    "input_lra",
    "input_thresh",
    "target_offset",
  ];
  const out = {};
  for (const k of keys) {
    const v = Number(data[k]);
    if (!Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}
/** loudnorm écrit son rapport JSON au milieu du journal de FFmpeg. */
function parseLoudnorm(text) {
  const s = String(text);
  const open = s.lastIndexOf("{"),
    close = s.lastIndexOf("}");
  if (open < 0 || close < open) return null;
  try {
    return JSON.parse(s.slice(open, close + 1));
  } catch {
    return null;
  }
}
module.exports = {
  sequenceSpeech,
  parseSilence,
  speechFrom,
  mergeIntervals,
  toTimeline,
  duckExpression,
  validateDuck,
  DUCK,
  TARGETS,
  normaliseFilter,
  measuredValues,
  parseLoudnorm,
};
