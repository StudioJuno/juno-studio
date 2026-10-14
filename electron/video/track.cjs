const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  { randomUUID } = require("node:crypto");
const { expression } = require("./animation.cjs");
const { sourceWindow, retime } = require("./render.cjs");
const ANALYSIS_WIDTH = 480;
/**
 * Template tracking on a reduced grayscale copy of the clip. Each frame is
 * searched around the previous position for the best normalised correlation
 * with the template taken on the first frame, refreshed while confidence
 * stays high. Fast, offline, and honest about drifting.
 */
function correlate(frame, template, w, h, tw, th, ox, oy) {
  let sum = 0,
    sumT = 0,
    sumTT = 0,
    sumF = 0,
    sumFF = 0,
    n = 0;
  for (let y = 0; y < th; y++) {
    const fy = oy + y;
    if (fy < 0 || fy >= h) return -1;
    for (let x = 0; x < tw; x++) {
      const fx = ox + x;
      if (fx < 0 || fx >= w) return -1;
      const f = frame[fy * w + fx],
        t = template[y * tw + x];
      sum += f * t;
      sumT += t;
      sumTT += t * t;
      sumF += f;
      sumFF += f * f;
      n++;
    }
  }
  if (!n) return -1;
  const num = sum - (sumF * sumT) / n,
    den = Math.sqrt(
      Math.max(1e-6, (sumFF - (sumF * sumF) / n) * (sumTT - (sumT * sumT) / n)),
    );
  return num / den;
}
function cut(frame, w, h, tw, th, ox, oy) {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const fy = Math.min(h - 1, Math.max(0, oy + y)),
        fx = Math.min(w - 1, Math.max(0, ox + x));
      out[y * tw + x] = frame[fy * w + fx];
    }
  return out;
}
/** Douglas-Peucker on the path keeps the timeline readable and FFmpeg fast. */
function simplify(points, tolerance, limit) {
  const keep = (from, to, flags) => {
    let worst = 0,
      index = -1;
    const a = points[from],
      b = points[to],
      span = b.frame - a.frame || 1;
    for (let i = from + 1; i < to; i++) {
      const p = points[i],
        t = (p.frame - a.frame) / span,
        d = Math.hypot(
          p.x - (a.x + (b.x - a.x) * t),
          p.y - (a.y + (b.y - a.y) * t),
        );
      if (d > worst) {
        worst = d;
        index = i;
      }
    }
    if (index > 0 && worst > tolerance) {
      flags[index] = true;
      keep(from, index, flags);
      keep(index, to, flags);
    }
  };
  if (points.length <= 2) return points.slice();
  let tol = tolerance;
  for (let attempt = 0; attempt < 24; attempt++) {
    const flags = new Array(points.length).fill(false);
    flags[0] = flags[points.length - 1] = true;
    keep(0, points.length - 1, flags);
    const out = points.filter((_, i) => flags[i]);
    if (out.length <= limit) return out;
    tol *= 1.6;
  }
  return [points[0], points[points.length - 1]];
}
async function trackMask({
  engine,
  source,
  clip,
  mask,
  sequence,
  keyLimit = 240,
  signal,
  onProgress,
  sourceFrame = 1 / 24,
}) {
  const width = ANALYSIS_WIDTH,
    height = Math.max(
      2,
      Math.round((width * sequence.height) / sequence.width / 2) * 2,
    );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-track-")),
    raw = path.join(root, randomUUID() + ".gray");
  try {
    // Les images suivies sont celles du film : lues comme le rendu les lit
    // (render.cjs, `sourceWindow`). Une image du rush en arrière ne suffit
    // pas sur un rush qui saute des images, ni un -ss posé dans un GOP de
    // MPEG-TS ou sur une image de tête : le suivi partait de l'image d'après
    // le trou, ou de l'image clé figée, et le masque glissait d'une image ou
    // plus sur le film (29/09/2026).
    const rate = sequence.fps.n + "/" + sequence.fps.d,
      startSeconds = clip.inUs / 1e6,
      length = (clip.duration * sequence.fps.d) / sequence.fps.n,
      read = await sourceWindow(engine, source, {
        source: startSeconds,
        speed: clip.speed ?? 1,
        period: sourceFrame,
      });
    // Le plan est suivi tel qu'il apparaît dans la séquence : mis à
    // l'échelle, placé et tourné comme au rendu. Les repères trouvés sont
    // ainsi directement des fractions de la séquence, le repère des masques
    // au moniteur comme à l'export.
    const clipW = Math.max(2, Math.round((width * (clip.scale ?? 1)) / 2) * 2),
      clipH = Math.max(2, Math.round((height * (clip.scale ?? 1)) / 2) * 2),
      // Horloge en images du plan, tirée du temps : le « n » de overlay
      // compte à partir de 1 dans cet FFmpeg.
      clock = `round(t*(${rate}))`,
      x = expression(clip.animation?.x, clock, clip.x ?? 0),
      y = expression(clip.animation?.y, clock, clip.y ?? 0),
      turn = clip.rotation
        ? `,rotate=${((clip.rotation * Math.PI) / 180).toFixed(8)}:c=black:ow=rotw(iw):oh=roth(ih)`
        : "",
      skip = read.video > 1e-6 ? `trim=start=${read.video.toFixed(6)},` : "";
    await engine.ff(
      [
        "-y",
        ...(read.ss > 0 ? ["-ss", read.ss.toFixed(8)] : []),
        "-t",
        (startSeconds - read.seek + length * clip.speed + 0.2).toFixed(6),
        "-i",
        source,
        "-filter_complex",
        `[0:v]${skip}${retime(startSeconds - read.zero, clip.speed, rate)},scale=${clipW}:${clipH}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1${turn}[plan];` +
          `color=c=black:s=${width}x${height}:r=${rate}[fond];` +
          `[fond][plan]overlay=x='(W-w)/2+(${x})*W':y='(H-h)/2+(${y})*H':eval=frame:shortest=1,format=gray[suivi]`,
        "-map",
        "[suivi]",
        "-frames:v",
        String(clip.duration),
        "-f",
        "rawvideo",
        raw,
      ],
      { signal },
    );
    const bytes = await fs.readFile(raw),
      size = width * height,
      frames = Math.floor(bytes.length / size);
    if (frames < 2) throw Error("Ce plan est trop court pour un suivi.");
    const first = mask.keys[0] ?? { frame: 0, x: 0.5, y: 0.5 },
      base = Math.max(0, Math.min(frames - 1, first.frame));
    const tw = Math.max(
        8,
        Math.min(width, Math.round(mask.width * width * 0.9)),
      ),
      th = Math.max(
        8,
        Math.min(height, Math.round(mask.height * height * 0.9)),
      );
    const frameAt = (i) => {
      const view = bytes.subarray(i * size, (i + 1) * size),
        out = new Float32Array(size);
      for (let p = 0; p < size; p++) out[p] = view[p];
      return out;
    };
    let template = cut(
      frameAt(base),
      width,
      height,
      tw,
      th,
      Math.round(first.x * width - tw / 2),
      Math.round(first.y * height - th / 2),
    );
    const search = Math.max(6, Math.round(Math.max(tw, th) * 0.6));
    const points = [],
      walk = async (from, to, step) => {
        let cx = Math.round(first.x * width - tw / 2),
          cy = Math.round(first.y * height - th / 2),
          live = template;
        for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
          signal?.throwIfAborted();
          const frame = frameAt(i);
          let best = -2,
            bx = cx,
            by = cy;
          for (let dy = -search; dy <= search; dy += 2)
            for (let dx = -search; dx <= search; dx += 2) {
              const score = correlate(
                frame,
                live,
                width,
                height,
                tw,
                th,
                cx + dx,
                cy + dy,
              );
              if (score > best) {
                best = score;
                bx = cx + dx;
                by = cy + dy;
              }
            }
          // One refinement pass at single-pixel precision.
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const score = correlate(
                frame,
                live,
                width,
                height,
                tw,
                th,
                bx + dx,
                by + dy,
              );
              if (score > best) {
                best = score;
                bx += dx;
                by += dy;
              }
            }
          cx = bx;
          cy = by;
          points.push({
            frame: i,
            x: (cx + tw / 2) / width,
            y: (cy + th / 2) / height,
            score: best,
          });
          // Refresh the template only while the match stays convincing.
          if (best > 0.82) live = cut(frame, width, height, tw, th, cx, cy);
          onProgress?.(points.length);
        }
      };
    await walk(base, frames - 1, 1);
    if (base > 0) await walk(base - 1, 0, -1);
    points.sort((a, b) => a.frame - b.frame);
    const scores = points.map((p) => p.score).sort((a, b) => a - b),
      median = scores[Math.floor(scores.length / 2)] ?? 0;
    const path_ = simplify(points, 0.0015, keyLimit).map((p) => ({
      frame: p.frame,
      x: Math.round(Math.min(2, Math.max(-1, p.x)) * 1e4) / 1e4,
      y: Math.round(Math.min(2, Math.max(-1, p.y)) * 1e4) / 1e4,
    }));
    return {
      keys: path_,
      confidence: Math.round(Math.max(0, median) * 100) / 100,
      frames: points.length,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
module.exports = { trackMask, simplify, correlate, ANALYSIS_WIDTH };
