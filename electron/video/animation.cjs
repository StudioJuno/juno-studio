const ranges = { x: [-2, 2], y: [-2, 2], gain: [0, 4] };
function validateAnimation(animation) {
  if (animation === undefined) return;
  if (!animation || typeof animation !== "object" || Array.isArray(animation))
    throw Error("Animation invalide");
  for (const [field, keys] of Object.entries(animation)) {
    if (
      !Object.hasOwn(ranges, field) ||
      !Array.isArray(keys) ||
      keys.length > 32
    )
      throw Error("Images clés invalides");
    let last = -Infinity;
    for (const k of keys) {
      if (
        !Number.isSafeInteger(k.frame) ||
        Math.abs(k.frame) > 1e8 ||
        k.frame <= last ||
        typeof k.value !== "number" ||
        !Number.isFinite(k.value) ||
        k.value < ranges[field][0] ||
        k.value > ranges[field][1] ||
        !["linear", "smooth", "hold"].includes(k.easing)
      )
        throw Error("Image clé invalide");
      last = k.frame;
    }
  }
}
function expression(keys, clock, fallback) {
  if (!keys?.length) return String(fallback);
  let out = String(keys.at(-1).value);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i],
      b = keys[i + 1],
      t = `((${clock})-${a.frame})/${b.frame - a.frame}`,
      mix =
        a.easing === "hold"
          ? "0"
          : a.easing === "smooth"
            ? `(${t})*(${t})*(3-2*(${t}))`
            : t;
    out = `if(lt(${clock},${b.frame}),${a.value}+(${b.value - a.value})*(${mix}),${out})`;
  }
  return `if(lte(${clock},${keys[0].frame}),${keys[0].value},${out})`;
}
module.exports = { validateAnimation, expression };
