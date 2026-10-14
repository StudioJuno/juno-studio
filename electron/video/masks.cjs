const { expression } = require("./animation.cjs");
const even = (v, min, max) =>
  Math.max(min, Math.min(max, Math.round(v / 2) * 2));
/**
 * Taille du masque en pixels du repère où il est posé : celui de la séquence
 * au rendu, comme au moniteur (maskPixels côté interface).
 */
function geometry(mask, width, height) {
  return {
    width: even(mask.width * width, 8, width),
    height: even(mask.height * height, 8, height),
  };
}
function amount(mask, width, height) {
  const g = geometry(mask, width, height),
    small = Math.min(g.width, g.height),
    strength = Math.max(0, Math.min(1, mask.strength));
  return {
    ...g,
    // gblur and pixelize are the blur and mosaic available in this build.
    sigma: Math.max(0.5, Math.round(small * (0.02 + strength * 0.1) * 10) / 10),
    block: Math.max(
      2,
      Math.min(1024, Math.round((small * (0.04 + strength * 0.16)) / 2) * 2),
    ),
  };
}
function keys(mask, field) {
  return mask.keys.map((k) => ({
    frame: k.frame,
    value: k[field],
    easing: "linear",
  }));
}
/**
 * Builds the filters that hide one region of a clip. The chain crops the
 * region, treats it, restores the feathered alpha and lays it back in place,
 * so the rest of the frame keeps its original pixels.
 *
 * `offset` ramène le numéro d'image du flux traité à celui du plan, dont
 * partent les repères. `window`, en numéros d'image du flux, borne l'effet
 * aux images où le plan est à l'écran.
 */
function filters({
  mask,
  input,
  source,
  label,
  width,
  height,
  offset,
  window,
  rate,
}) {
  // L'horloge part du temps de l'image quand la cadence est connue : dans
  // cet FFmpeg, le « n » de overlay compte à partir de 1 et celui de crop à
  // partir de 0, si bien qu'un masque mobile était collé une image plus loin
  // que la zone traitée.
  const shift = offset < 0 ? `-${-offset}` : `+${offset}`,
    clock = rate ? `(round(t*(${rate}))${shift})` : `(n${shift})`,
    a = amount(mask, width, height),
    out = [];
  const axis = (field, size, span) =>
    `max(0,min(${span - size},(${expression(keys(mask, field), clock, 0.5)})*${span}-${size / 2}))`;
  const x = axis("x", a.width, width),
    y = axis("y", a.height, height);
  const keep = label + "k",
    zone = label + "z",
    treated = label + "t",
    alpha = label + "a",
    merged = label + "m";
  out.push(`[${source}]split=2[${keep}][${zone}]`);
  // In this FFmpeg, crop x and y are per-frame expressions without an eval option.
  let chain = `[${zone}]crop=${a.width}:${a.height}:x='${x}':y='${y}'`;
  if (mask.effect === "blur") chain += `,gblur=sigma=${a.sigma}:steps=3`;
  else if (mask.effect === "pixelate")
    chain += `,pixelize=w=${Math.min(a.block, a.width)}:h=${Math.min(a.block, a.height)}`;
  else
    chain += `,drawbox=x=0:y=0:w=iw:h=ih:color=0x${(mask.color || "#000000").slice(1)}@1:t=fill`;
  out.push(chain + `[${treated}]`);
  out.push(`[${input}:v]format=gray,scale=${a.width}:${a.height}[${alpha}]`);
  // shortest keeps the looping shape from outliving the treated region.
  out.push(`[${treated}][${alpha}]alphamerge=shortest=1[${merged}]`);
  const enable = window ? `:enable='between(n,${window[0]},${window[1]})'` : "";
  out.push(
    `[${keep}][${merged}]overlay=x='${x}':y='${y}':eval=frame:format=yuv444p10${enable}[${label}]`,
  );
  return out;
}
/** Every mask of a clip needs its rendered shape before an export starts. */
function require_(clip, maskFiles) {
  const list = (clip.masks || []).filter((m) => m.keys && m.keys.length);
  for (const m of list)
    if (!maskFiles || !maskFiles[m.id])
      throw Error("Forme de masque absente : relancez l’export depuis Juno.");
  return list;
}
module.exports = { geometry, amount, filters, require_ };
