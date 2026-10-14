const { escapeFilter } = require("./engine.cjs");
function validate(input = {}) {
  const values = {
    strength: 0.7,
    highpass: 80,
    bass: 0,
    presence: 2,
    air: 0,
    compression: 2,
    ...input,
  };
  for (const [key, min, max] of [
    ["strength", 0, 1],
    ["highpass", 0, 200],
    ["bass", -12, 12],
    ["presence", -12, 12],
    ["air", -12, 12],
    ["compression", 1, 8],
  ])
    if (
      typeof values[key] !== "number" ||
      !Number.isFinite(values[key]) ||
      values[key] < min ||
      values[key] > max
    )
      throw Error("Réglage audio invalide : " + key);
  return Object.fromEntries(
    ["strength", "highpass", "bass", "presence", "air", "compression"].map(
      (k) => [k, values[k]],
    ),
  );
}
function filters(settings, model) {
  const s = validate(settings),
    f = ["aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"];
  if (s.highpass) f.push("highpass=f=" + s.highpass);
  if (s.strength)
    f.push("arnndn=m='" + escapeFilter(model) + "':mix=" + s.strength);
  for (const [key, hz] of [
    ["bass", 150],
    ["presence", 3000],
    ["air", 10000],
  ])
    if (s[key]) f.push(`equalizer=f=${hz}:t=q:w=1:g=${s[key]}`);
  if (s.compression > 1)
    f.push(
      `acompressor=threshold=0.125:ratio=${s.compression}:attack=10:release=150:makeup=1`,
    );
  f.push("alimiter=limit=0.95:level=0:latency=1");
  return f.join(",");
}
module.exports = { validate, filters };
