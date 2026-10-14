const { expression } = require("./animation.cjs");
const ranges = {
  x: [-2, 2],
  y: [-2, 2],
  scale: [0.1, 3],
  rotation: [-360, 360],
  opacity: [0, 1],
};
function validateMotion(m) {
  if (m === undefined) return;
  if (!m || typeof m !== "object" || Array.isArray(m))
    throw Error("Animation graphique invalide");
  for (const [field, keys] of Object.entries(m)) {
    if (
      !Object.hasOwn(ranges, field) ||
      !Array.isArray(keys) ||
      keys.length > 32
    )
      throw Error("Images clés graphiques invalides");
    let last = -1;
    for (const k of keys) {
      if (
        !Number.isSafeInteger(k.frame) ||
        k.frame < 0 ||
        k.frame > 1e8 ||
        k.frame <= last ||
        typeof k.value !== "number" ||
        !Number.isFinite(k.value) ||
        k.value < ranges[field][0] ||
        k.value > ranges[field][1] ||
        !["linear", "smooth", "hold"].includes(k.easing)
      )
        throw Error("Image clé graphique invalide");
      last = k.frame;
    }
  }
}
function placement(p) {
  if (p === undefined) return;
  if (!p || typeof p !== "object") throw Error("Placement graphique invalide");
  for (const k of ["x", "y", "width", "height"])
    if (
      typeof p[k] !== "number" ||
      !Number.isFinite(p[k]) ||
      p[k] < 0 ||
      p[k] > 8192
    )
      throw Error("Dimension graphique invalide");
  if (p.width < 2 || p.height < 2) throw Error("Élément graphique vide");
  validateMotion(p.motion);
  if (!Object.values(p.motion ?? {}).some((keys) => keys?.length)) {
    if (p.width * p.height > 32000000)
      throw Error("Élément graphique trop grand pour le rendu");
    return Math.ceil(Math.max(p.width, p.height) / 2) * 2;
  }
  const scale = Math.max(1, ...(p.motion?.scale ?? []).map((k) => k.value));
  const side =
    Math.ceil(
      ((p.motion?.rotation?.some((k) => k.value !== 0)
        ? Math.hypot(p.width, p.height)
        : Math.max(p.width, p.height)) *
        scale) /
        2,
    ) * 2;
  if (side > 8192 || side * side > 32000000)
    throw Error(
      "Animation trop grande pour le rendu. Réduisez la taille ou l’échelle maximale.",
    );
  return side;
}
function filters(p, index, label, offset, rate) {
  const side = placement(p),
    m = p.motion || {},
    clock = (n) => `(${n}+${offset})`,
    scale = expression(m.scale, clock("n"), 1),
    angle = expression(m.rotation, `(t*(${rate})+${offset})`, 0),
    alpha = expression(m.opacity, clock("N"), 1);
  if (!Object.values(m).some((keys) => keys?.length))
    return `[${index}:v]format=yuva444p10le[${label}]`;
  let f = `[${index}:v]format=rgba`;
  if (m.scale?.some((k) => k.value !== 1))
    f += `,scale=w='max(2,trunc(${p.width}*(${scale})/2)*2)':h='max(2,trunc(${p.height}*(${scale})/2)*2)':eval=frame`;
  f += `,pad=${side}:${side}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame`;
  if (m.rotation?.some((k) => k.value !== 0))
    f += `,rotate=angle='(${angle})*PI/180':c=none:ow=iw:oh=ih`;
  const keys = m.opacity ?? [],
    constant = !keys.length || keys.every((k) => k.value === keys[0].value);
  const fade =
    (keys.length === 2 || keys.length === 4) &&
    keys.every((k) => k.easing === "linear") &&
    keys[0].value === 0 &&
    keys[1].value === 1 &&
    (keys.length === 2 || (keys[2].value === 1 && keys[3].value === 0));
  if (constant) {
    if (keys.length && keys[0].value !== 1)
      f += `,colorchannelmixer=aa=${keys[0].value}`;
  } else if (fade) {
    const [n, d] = rate.split("/").map(Number),
      fps = n / (d || 1),
      shift = offset / fps;
    // round() : setpts tronque, et un décalage de 36,9999 images en valait 36.
    f += `,setpts=round(PTS+${shift}/TB),fade=t=in:st=${keys[0].frame / fps}:d=${(keys[1].frame - keys[0].frame) / fps}:alpha=1`;
    if (keys.length === 4)
      f += `,fade=t=out:st=${keys[2].frame / fps}:d=${(keys[3].frame - keys[2].frame) / fps}:alpha=1`;
    f += `,setpts=round(PTS-${shift}/TB)`;
  } else f += `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${alpha})'`;
  return f + `,format=yuva444p10le[${label}]`;
}
module.exports = { validateMotion, placement, filters };
