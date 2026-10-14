import type { Adjustments, Point } from "../model";
export const COLOR_BANDS = [
  { id: "red", label: "Rouge", hue: 0, color: "#c8554b" },
  { id: "orange", label: "Orange", hue: 30, color: "#c8843c" },
  { id: "yellow", label: "Jaune", hue: 60, color: "#b0a02f" },
  { id: "green", label: "Vert", hue: 120, color: "#529365" },
  { id: "aqua", label: "Turquoise", hue: 180, color: "#468f93" },
  { id: "blue", label: "Bleu", hue: 240, color: "#527dc0" },
  { id: "purple", label: "Violet", hue: 270, color: "#8c68bd" },
  { id: "magenta", label: "Magenta", hue: 300, color: "#af5b98" },
] as const;
export type ColorBand = (typeof COLOR_BANDS)[number]["id"];
export type ColorMix = { hue: number; saturation: number; luminance: number };
export type Curves = Partial<Record<"rgb" | "red" | "green" | "blue", Point[]>>;
export const IDENTITY_CURVE: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export function curveValue(points: Point[], value: number) {
  const x = clamp(value);
  if (x <= points[0].x) return points[0].y;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1],
      next = points[i];
    if (x <= next.x)
      return (
        previous.y +
        ((next.y - previous.y) * (x - previous.x)) / (next.x - previous.x)
      );
  }
  return points[points.length - 1].y;
}
function curveTable(points?: Point[]) {
  if (!points?.length || points.every((p) => p.x === p.y)) return;
  return Float32Array.from({ length: 4097 }, (_, i) =>
    curveValue(points, i / 4096),
  );
}
function curve(table: Float32Array | undefined, value: number) {
  if (!table) return value;
  const x = clamp(value) * 4096,
    i = Math.floor(x);
  return table[i] + (table[Math.min(4096, i + 1)] - table[i]) * (x - i);
}
export function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min,
    l = (max + min) / 2;
  if (!delta) return [0, 0, l];
  const hue =
    max === r
      ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / delta + 2) * 60
        : ((r - g) / delta + 4) * 60;
  return [hue, delta / (1 - Math.abs(2 * l - 1)), l];
}
export function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 60,
    c = (1 - Math.abs(2 * l - 1)) * clamp(s),
    x = c * (1 - Math.abs((hue % 2) - 1)),
    m = l - c / 2;
  const p =
    hue < 1
      ? [c, x, 0]
      : hue < 2
        ? [x, c, 0]
        : hue < 3
          ? [0, c, x]
          : hue < 4
            ? [0, x, c]
            : hue < 5
              ? [x, 0, c]
              : [c, 0, x];
  return [p[0] + m, p[1] + m, p[2] + m];
}
export function advancedColor(
  data: Uint8ClampedArray | Uint16Array,
  a: Adjustments,
) {
  const whites = (a.whites || 0) / 100,
    blacks = (a.blacks || 0) / 100,
    vibrance = (a.vibrance || 0) / 100;
  const master = curveTable(a.curves?.rgb),
    red = curveTable(a.curves?.red),
    green = curveTable(a.curves?.green),
    blue = curveTable(a.curves?.blue);
  const bands = COLOR_BANDS.flatMap((b) => {
    const mix = a.colorMix?.[b.id];
    return mix && (mix.hue || mix.saturation || mix.luminance)
      ? [{ ...b, mix }]
      : [];
  });
  if (
    !whites &&
    !blacks &&
    !vibrance &&
    !master &&
    !red &&
    !green &&
    !blue &&
    !bands.length
  )
    return;
  const peak = data instanceof Uint16Array ? 65535 : 255;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / peak,
      g = data[i + 1] / peak,
      b = data[i + 2] / peak;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b,
      tone = whites * 0.35 * l ** 4 + blacks * 0.25 * (1 - l) ** 4;
    r = clamp(r + tone);
    g = clamp(g + tone);
    b = clamp(b + tone);
    if (vibrance || bands.length) {
      let [h, s, light] = rgbToHsl(r, g, b);
      const originalSaturation = s;
      s = clamp(s * (1 + vibrance * (1 - s)));
      let dh = 0,
        ds = 0,
        dl = 0;
      for (const band of bands) {
        const distance = Math.abs(h - band.hue),
          circular = Math.min(distance, 360 - distance);
        const weight = Math.max(0, 1 - circular / 45) ** 2;
        dh += band.mix.hue * 0.3 * weight;
        ds += (band.mix.saturation / 100) * weight;
        dl +=
          (band.mix.luminance / 100) *
          0.4 *
          weight *
          Math.min(1, originalSaturation * 4);
      }
      [r, g, b] = hslToRgb(h + dh, clamp(s * (1 + ds)), clamp(light + dl));
    }
    data[i] = clamp(curve(red, curve(master, r))) * peak;
    data[i + 1] = clamp(curve(green, curve(master, g))) * peak;
    data[i + 2] = clamp(curve(blue, curve(master, b))) * peak;
  }
}

/** Separable box filter: work is linear in pixels, independent of radius. */
function blur(
  data: Uint8ClampedArray | Uint16Array,
  w: number,
  h: number,
  radius: number,
) {
  const horizontal = new Float32Array(w * h * 3),
    out = new Float32Array(w * h * 3),
    size = 2 * radius + 1;
  for (let y = 0; y < h; y++)
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let x = -radius; x <= radius; x++)
        sum += data[(y * w + Math.max(0, Math.min(w - 1, x))) * 4 + c];
      for (let x = 0; x < w; x++) {
        horizontal[(y * w + x) * 3 + c] = sum / size;
        sum +=
          data[(y * w + Math.min(w - 1, x + radius + 1)) * 4 + c] -
          data[(y * w + Math.max(0, x - radius)) * 4 + c];
      }
    }
  for (let x = 0; x < w; x++)
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++)
        sum += horizontal[(Math.max(0, Math.min(h - 1, y)) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + c] = sum / size;
        sum +=
          horizontal[(Math.min(h - 1, y + radius + 1) * w + x) * 3 + c] -
          horizontal[(Math.max(0, y - radius) * w + x) * 3 + c];
      }
    }
  return out;
}
export function advancedDetails(
  data: Uint8ClampedArray | Uint16Array,
  w: number,
  h: number,
  a: Adjustments,
) {
  const sharp = (a.sharpening || 0) / 100,
    noise = (a.noiseReduction || 0) / 100,
    clarity = (a.clarity || 0) / 100;
  if (!sharp && !noise && !clarity) return;
  const peak = data instanceof Uint16Array ? 65535 : 255;
  if (sharp || noise) {
    const smooth = blur(
      data,
      w,
      h,
      Math.max(1, Math.round(Math.max(w, h) / 1600)),
    );
    for (let p = 0; p < w * h; p++)
      for (let c = 0; c < 3; c++) {
        const i = p * 4 + c,
          original = data[i],
          delta = original - smooth[p * 3 + c];
        const edgeProtection = 1 / (1 + (delta / peak / 0.045) ** 2);
        data[i] = Math.max(
          0,
          Math.min(
            peak,
            original - delta * noise * edgeProtection + delta * sharp * 1.5,
          ),
        );
      }
  }
  if (clarity) {
    const smooth = blur(
      data,
      w,
      h,
      Math.max(1, Math.round(Math.max(w, h) / 100)),
    );
    for (let p = 0; p < w * h; p++)
      for (let c = 0; c < 3; c++) {
        const i = p * 4 + c,
          v = data[i];
        data[i] = Math.max(
          0,
          Math.min(peak, v + (v - smooth[p * 3 + c]) * clarity * 0.8),
        );
      }
  }
}
