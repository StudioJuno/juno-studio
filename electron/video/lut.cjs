const M = require("./model.cjs");
function parseCube(text) {
  let size = 0,
    min = [0, 0, 0],
    max = [1, 1, 1],
    values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line || line.startsWith("TITLE ")) continue;
    const parts = line.split(/\s+/),
      key = parts[0];
    if (key === "LUT_3D_SIZE") {
      size = Number(parts[1]);
      M.integer(size, 2, 64, "Taille de LUT");
      continue;
    }
    if (key === "DOMAIN_MIN" || key === "DOMAIN_MAX") {
      if (parts.length !== 4) throw Error("Domaine de LUT invalide");
      const v = parts.slice(1).map(Number);
      v.forEach((n) => M.number(n, -16, 16, "Domaine"));
      if (key === "DOMAIN_MIN") min = v;
      else max = v;
      continue;
    }
    // L'autre façon d'écrire le domaine (Resolve, Nuke) : un minimum et un
    // maximum communs aux trois couleurs. Lue comme une ligne de valeurs, elle
    // faisait refuser la LUT.
    if (key === "LUT_3D_INPUT_RANGE") {
      if (parts.length !== 3) throw Error("Domaine de LUT invalide");
      const [lo, hi] = parts.slice(1).map(Number);
      M.number(lo, -16, 16, "Domaine");
      M.number(hi, -16, 16, "Domaine");
      min = [lo, lo, lo];
      max = [hi, hi, hi];
      continue;
    }
    // Le domaine d'une LUT 1D n'a pas de sens sans elle : une LUT 1D reste
    // refusée par sa taille, juste en dessous.
    if (key === "LUT_1D_INPUT_RANGE") continue;
    if (parts.length !== 3 || parts.some((p) => !Number.isFinite(Number(p))))
      throw Error("Format .cube 3D requis (taille 2 à 64)");
    const v = parts.map(Number);
    v.forEach((n) => M.number(n, -16, 16, "Valeur de LUT"));
    values.push(...v);
    if (values.length > 64 ** 3 * 3) throw Error("LUT trop volumineuse");
  }
  if (
    !size ||
    values.length !== size ** 3 * 3 ||
    max.some((v, i) => v <= min[i])
  )
    throw Error("LUT incomplète ou domaine invalide");
  return { size, min, max, values };
}
function serialize(cube) {
  const lines = [
    "LUT_3D_SIZE " + cube.size,
    "DOMAIN_MIN " + cube.min.join(" "),
    "DOMAIN_MAX " + cube.max.join(" "),
  ];
  for (let i = 0; i < cube.values.length; i += 3)
    lines.push(cube.values.slice(i, i + 3).join(" "));
  return lines.join("\n") + "\n";
}
function sample(c, rgb) {
  const x = rgb.map(
      (v, i) =>
        M.clamp((v - c.min[i]) / (c.max[i] - c.min[i]), 0, 1) * (c.size - 1),
    ),
    lo = x.map(Math.floor),
    hi = lo.map((v) => Math.min(c.size - 1, v + 1)),
    f = x.map((v, i) => v - lo[i]),
    out = [0, 0, 0];
  for (let z = 0; z < 2; z++)
    for (let y = 0; y < 2; y++)
      for (let k = 0; k < 2; k++) {
        const at =
            (((z ? hi[2] : lo[2]) * c.size + (y ? hi[1] : lo[1])) * c.size +
              (k ? hi[0] : lo[0])) *
            3,
          w =
            (k ? f[0] : 1 - f[0]) *
            (y ? f[1] : 1 - f[1]) *
            (z ? f[2] : 1 - f[2]);
        for (let ch = 0; ch < 3; ch++) out[ch] += c.values[at + ch] * w;
      }
  return out;
}
module.exports = { parseCube, serialize, sample };
