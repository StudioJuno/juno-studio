import { motionPreset } from "./motion";
import type { Title, Caption, Depth, Sequence } from "./types";
/** Mixes a hex colour towards black or white; used for the lit relief sides. */
export function shade(hex: string, factor: number) {
  const value = /^#([0-9a-fA-F]{6})$/.exec(hex)?.[1];
  if (!value) return hex;
  const channel = (i: number) => {
    const base = parseInt(value.slice(i * 2, i * 2 + 2), 16);
    const mixed =
      factor >= 1 ? base * (2 - factor) + 255 * (factor - 1) : base * factor;
    return Math.max(0, Math.min(255, Math.round(mixed)))
      .toString(16)
      .padStart(2, "0");
  };
  return "#" + channel(0) + channel(1) + channel(2);
}
export const DEPTH_LIMIT = 200;
/** Extrusion steps: one per pixel of depth, bounded so a 4K title stays fast. */
export function depthSteps(depth: Depth | undefined, size: number) {
  if (!depth || !(depth.extrude > 0)) return 0;
  return Math.max(1, Math.min(DEPTH_LIMIT, Math.round(depth.extrude * size)));
}
export function captionTitle(t: Caption, s: Sequence): Title {
  return {
    ...t,
    size: Math.round(s.width * 0.03),
    y: 0.87,
    color: "#ffffff",
    backgroundColor: "#000000",
    backgroundOpacity: 0.68,
    padding: Math.round(s.width * 0.015),
    ...s.captionStyle,
    ...t.style,
    motion: motionPreset(
      t.style?.effect ?? s.captionStyle?.effect ?? "none",
      t.duration,
      s.fps.n / s.fps.d,
    ),
  };
}
/** The same rasterizer feeds the monitor and lossless export overlays. */
export function drawTitle(
  canvas: HTMLCanvasElement,
  t: Title,
  s: Pick<Sequence, "width" | "height">,
) {
  canvas.width = s.width;
  canvas.height = s.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("Rendu du titre indisponible");
  const size = t.size,
    lineHeight = size * (t.lineHeight ?? 1.2),
    max = s.width * (t.width ?? 0.86);
  ctx.font = `${t.italic ? "italic " : ""}${t.fontWeight ?? 600} ${size}px "${t.fontFamily ?? "Arial"}", ${t.fontFamily === "Georgia" ? "serif" : t.fontFamily === "monospace" ? "monospace" : "sans-serif"}`;
  const lines: string[] = [];
  for (const paragraph of (t.uppercase
    ? t.text.toLocaleUpperCase()
    : t.text
  ).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const trial = line ? line + " " + word : word;
      if (line && ctx.measureText(trial).width > max) {
        lines.push(line);
        line = word;
      } else line = trial;
      // Split long words as well, preserving every character.
      if (ctx.measureText(line).width > max) {
        let part = "";
        for (const char of line) {
          if (part && ctx.measureText(part + char).width > max) {
            lines.push(part);
            part = char;
          } else part += char;
        }
        line = part;
      }
    }
    lines.push(line);
  }
  const widest = Math.max(0, ...lines.map((l) => ctx.measureText(l).width)),
    pad = t.padding ?? size * 0.35;
  const align = t.align ?? "center",
    left = align === "left" ? 0 : align === "right" ? -widest : -widest / 2;
  ctx.translate((t.x ?? 0.5) * s.width, t.y * s.height);
  ctx.rotate(((t.rotation ?? 0) * Math.PI) / 180);
  ctx.globalAlpha = t.opacity ?? 1;
  const paintGraphic = (fill?: string) => {
    const g = t.graphic;
    if (!g) return;
    const w = g.width * s.width,
      h = g.height * s.height;
    ctx.save();
    ctx.fillStyle = fill ?? g.fill;
    ctx.beginPath();
    if (g.kind === "circle") ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (g.kind === "arrow") {
      ctx.moveTo(-w / 2, -h * 0.18);
      ctx.lineTo(w * 0.12, -h * 0.18);
      ctx.lineTo(w * 0.12, -h / 2);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w * 0.12, h / 2);
      ctx.lineTo(w * 0.12, h * 0.18);
      ctx.lineTo(-w / 2, h * 0.18);
      ctx.closePath();
    } else
      ctx.rect(-w / 2, -h / 2, g.kind === "bar" ? w * (g.value ?? 0.75) : w, h);
    if (g.kind === "bar" && !fill) {
      ctx.save();
      ctx.globalAlpha *= 0.18;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.fill();
    ctx.restore();
  };
  // Relief: copies of the same drawing, offset and shaded, behind the face.
  const steps = depthSteps(t.depth, size);
  if (steps) {
    const depth = t.depth!,
      radians = ((depth.angle ?? 45) * Math.PI) / 180,
      dx = Math.cos(radians),
      dy = Math.sin(radians),
      light = Math.max(0, Math.min(1, depth.light ?? 0.4)),
      base = depth.color ?? shade(t.graphic ? t.graphic.fill : t.color, 0.55);
    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    for (let i = steps; i >= 1; i--) {
      const far = i / steps,
        tone = shade(base, 1 - light * far * 0.8);
      ctx.save();
      ctx.translate(dx * i, dy * i);
      paintGraphic(tone);
      if ((t.backgroundOpacity ?? 0) > 0) {
        ctx.save();
        ctx.globalAlpha *= t.backgroundOpacity!;
        ctx.fillStyle = tone;
        ctx.fillRect(
          left - pad,
          (-lines.length * lineHeight) / 2 - pad,
          widest + 2 * pad,
          lines.length * lineHeight + 2 * pad,
        );
        ctx.restore();
      }
      ctx.fillStyle = tone;
      lines.forEach((line, index) =>
        ctx.fillText(line, 0, (index - (lines.length - 1) / 2) * lineHeight),
      );
      ctx.restore();
    }
    ctx.restore();
  }
  paintGraphic();

  if ((t.backgroundOpacity ?? 0) > 0) {
    ctx.save();
    ctx.globalAlpha *= t.backgroundOpacity!;
    ctx.fillStyle = t.backgroundColor ?? "#000000";
    ctx.fillRect(
      left - pad,
      (-lines.length * lineHeight) / 2 - pad,
      widest + 2 * pad,
      lines.length * lineHeight + 2 * pad,
    );
    ctx.restore();
  }
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = t.color;
  if (t.shadow) {
    ctx.shadowColor = "rgba(0,0,0,.75)";
    ctx.shadowBlur = size * 0.12;
    ctx.shadowOffsetY = size * 0.05;
  }
  ctx.lineJoin = "round";
  ctx.strokeStyle = t.strokeColor ?? "#000000";
  ctx.lineWidth = (t.strokeWidth ?? 0) * 2;
  const original = t.text,
    shown = t.uppercase ? original.toLocaleUpperCase() : original;
  let textOffset = 0;
  const highlightFrom = t.highlight
    ? t.uppercase
      ? original.slice(0, t.highlight.from).toLocaleUpperCase().length
      : t.highlight.from
    : -1;
  const highlightTo = t.highlight
    ? t.uppercase
      ? original.slice(0, t.highlight.to).toLocaleUpperCase().length
      : t.highlight.to
    : -1;
  lines.forEach((line, i) => {
    const y = (i - (lines.length - 1) / 2) * lineHeight;
    if (t.strokeWidth) ctx.strokeText(line, 0, y);
    ctx.fillStyle = t.color;
    ctx.fillText(line, 0, y);
    // Layout collapsed whitespace; advance through the source without losing word offsets.
    const lineStart = shown.indexOf(line, textOffset);
    if (lineStart >= 0 && t.highlight) {
      const from = Math.max(0, highlightFrom - lineStart),
        to = Math.min(line.length, highlightTo - lineStart);
      if (to > from) {
        const width = ctx.measureText(line).width,
          left = align === "left" ? 0 : align === "right" ? -width : -width / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          left + ctx.measureText(line.slice(0, from)).width,
          y - size * 1.5,
          ctx.measureText(line.slice(from, to)).width + 1,
          size * 3,
        );
        ctx.clip();
        ctx.shadowColor = "transparent";
        ctx.fillStyle = t.highlight.color;
        ctx.fillText(line, 0, y);
        ctx.restore();
      }
      textOffset = lineStart + line.length;
    }
  });
}

/** Opaque extent of a drawn element, in sequence pixels. */
function opaqueBox(
  pixels: Uint8ClampedArray,
  s: Pick<Sequence, "width" | "height">,
) {
  let left = s.width,
    top = s.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++)
      if (pixels[(y * s.width + x) * 4 + 3]) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < 0) return { left: 0, top: 0, right: 0, bottom: 0, empty: true };
  return { left, top, right, bottom, empty: false };
}
/** The preview handles need the visible box, never the animation tile. */
export function titleBounds(t: Title, s: Pick<Sequence, "width" | "height">) {
  const full = document.createElement("canvas");
  drawTitle(full, t, s);
  const box = opaqueBox(
    full.getContext("2d")!.getImageData(0, 0, s.width, s.height).data,
    s,
  );
  const width = Math.max(2, box.right - box.left + 1),
    height = Math.max(2, box.bottom - box.top + 1);
  return {
    x: box.left + width / 2,
    y: box.top + height / 2,
    width,
    height,
    empty: box.empty,
  };
}

export function rasterTitle(t: Title, s: Pick<Sequence, "width" | "height">) {
  const full = document.createElement("canvas");
  drawTitle(full, t, s);
  const ctx = full.getContext("2d")!,
    pixels = ctx.getImageData(0, 0, s.width, s.height).data;
  if (!t.motion || !Object.values(t.motion).some((k) => k?.length)) {
    const { left, top, right, bottom } = opaqueBox(pixels, s);
    const width = Math.max(2, right - left + 1),
      height = Math.max(2, bottom - top + 1),
      tile = document.createElement("canvas");
    tile.width = width;
    tile.height = height;
    tile.getContext("2d")!.drawImage(full, -left, -top);
    return {
      canvas: tile,
      placement: {
        x: left + width / 2,
        y: top + height / 2,
        width,
        height,
        motion: {},
      },
    };
  }
  const px = (t.x ?? 0.5) * s.width,
    py = t.y * s.height;
  let extent = 1;
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++)
      if (pixels[(y * s.width + x) * 4 + 3])
        extent = Math.max(extent, Math.abs(x - px) + 2, Math.abs(y - py) + 2);
  const side = Math.ceil(extent) * 2;
  if (side > 8192 || side * side > 32000000)
    throw Error(
      "Élément animé trop grand. Réduisez la taille ou rapprochez le texte de son point central.",
    );
  const tile = document.createElement("canvas");
  tile.width = side;
  tile.height = side;
  tile.getContext("2d")!.drawImage(full, side / 2 - px, side / 2 - py);
  return {
    canvas: tile,
    placement: { x: px, y: py, width: side, height: side, motion: t.motion },
  };
}

/** Disjoint runs retain the original animation clock across word boundaries. */
export function captionRuns(c: Caption, s: Sequence): Title[] {
  const base = captionTitle(c, s),
    mode = c.style?.wordMode ?? s.captionStyle?.wordMode ?? "none";
  if (mode === "none" || !c.words?.length) return [base];
  const runs: Title[] = [];
  let at = 0;
  const push = (
    from: number,
    to: number,
    word?: NonNullable<Caption["words"]>[number],
  ) => {
    if (to <= from || (mode === "single" && !word)) return;
    runs.push({
      ...base,
      id: c.id + "-" + from,
      start: c.start + from,
      duration: to - from,
      motionOrigin: c.start,
      ...(word
        ? mode === "single"
          ? { text: c.text.slice(word.from, word.to) }
          : {
              highlight: {
                from: word.from,
                to: word.to,
                color:
                  c.style?.highlightColor ??
                  s.captionStyle?.highlightColor ??
                  "#ffe45c",
              },
            }
        : {}),
      ...(mode === "single" && !word ? { text: "" } : {}),
    });
  };
  for (const w of c.words) {
    push(at, w.start);
    push(w.start, w.end, w);
    at = w.end;
  }
  push(at, c.duration);
  return runs;
}
