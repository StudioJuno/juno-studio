const { clamp } = require("./model.cjs");
function statistics(buffers) {
  const lumas = [],
    neutral = [0, 0, 0];
  let n = 0,
    clipped = 0,
    total = 0;
  for (const b of buffers)
    for (let i = 0; i + 2 < b.length; i += 3) {
      const rgb = [b[i] / 255, b[i + 1] / 255, b[i + 2] / 255],
        l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
      total++;
      if (Math.max(...rgb) > 0.985) clipped++;
      if (l > 0.015 && l < 0.985) lumas.push(l);
      if (l > 0.15 && l < 0.85 && Math.max(...rgb) - Math.min(...rgb) < 0.18) {
        rgb.forEach((v, j) => (neutral[j] += v));
        n++;
      }
    }
  lumas.sort((a, b) => a - b);
  return {
    median: lumas[Math.floor(lumas.length * 0.5)] || 0,
    high: lumas[Math.floor(lumas.length * 0.98)] || 0,
    neutral: n ? neutral.map((v) => v / n) : null,
    neutralSamples: n,
    clipped: total ? clipped / total : 0,
    samples: total,
  };
}
function recommend(stats, reference, strength = 0.65) {
  if (stats.median <= 0.015 || stats.samples < 100)
    return { exposure: 0, warmth: 0, tint: 0 };
  let exposure = 2.4 * Math.log2((reference?.median || 0.42) / stats.median);
  if (stats.high > 0.01)
    exposure = Math.min(exposure, 2.4 * Math.log2(0.98 / stats.high));
  exposure = clamp(exposure, -1.5, 1.5) * strength;
  const balance = (s) => {
      if (!s?.neutral || s.neutralSamples < 100) return [0, 0];
      const [r, g, b] = s.neutral;
      return [
        (b - r) / Math.max(0.01, b + r),
        1 - (r + b) / Math.max(0.01, 2 * g),
      ];
    },
    a = balance(stats),
    b = balance(reference);
  return {
    exposure,
    warmth: clamp(a[0] - b[0], -0.12, 0.12) * strength,
    tint: clamp(a[1] - b[1], -0.12, 0.12) * strength,
  };
}
module.exports = { statistics, recommend };
