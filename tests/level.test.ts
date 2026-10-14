import { it, expect } from "vitest";
import {
  correctionDe,
  decider,
  luminanceReduite,
  mesurerNiveau,
  VERSION_NIVEAU,
} from "../src/modules/level";
import { processRaster } from "../src/modules/pipeline";
import { DEFAULT } from "../src/model";
import type { Raster } from "../src/modules/raster";
const RAD = Math.PI / 180;
/**
 * Une scène de lignes droites (murs, fenêtres), puis photographiée penchée de
 * `delta` degrés dans le sens horaire. Lissée par suréchantillonnage, comme
 * une vraie photo.
 */
function scene(
  delta: number,
  W = 960,
  H = 640,
  dessin: (x: number, y: number) => number = grille,
) {
  const c = Math.cos(delta * RAD),
    s = Math.sin(delta * RAD),
    out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let v = 0;
      // 4 × 4 échantillons : avec 2 × 2, les bords sont en escalier, bien
      // plus qu'aucun objectif, et les lignes se cassent en morceaux.
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++) {
          // La photo est la scène tournée de delta : on revient à la scène.
          const px = x + (i + 0.5) / 4 - W / 2,
            py = y + (j + 0.5) / 4 - H / 2;
          v += dessin(c * px + s * py, -s * px + c * py);
        }
      out[y * W + x] = v / 16;
    }
  return { gris: out, w: W, h: H };
}
/** Des verticales et des horizontales régulières, comme une façade. */
function grille(x: number, y: number) {
  const pres = (v: number, pas: number) => Math.abs(((v % pas) + pas) % pas - pas / 2) < 2;
  return pres(x, 90) || pres(y, 70) ? 200 : 70;
}
/** Un seul horizon, sans aucune verticale : la mer, un champ. */
function horizonSeul(_x: number, y: number) {
  return y < 40 ? 190 : 60;
}
/** Une image en RGBA pour le moteur de rendu. */
function rvba(g: { gris: Float32Array; w: number; h: number }): Raster {
  const d = new Uint8ClampedArray(g.w * g.h * 4);
  for (let i = 0; i < g.w * g.h; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g.gris[i];
    d[i * 4 + 3] = 255;
  }
  return { width: g.w, height: g.h, data: d } as unknown as Raster;
}
it("mesure l'inclinaison d'une façade, dans le bon sens, à un dixième de degré", () => {
  for (const delta of [-3.2, -1, 0.6, 2, 4.5]) {
    const g = scene(delta);
    const n = mesurerNiveau(g.gris, g.w, g.h);
    expect(n.tier, `${delta}° : ${n.reason}`).toBe("auto");
    expect(n.angle!, `${delta}°`).toBeCloseTo(delta, 1);
  }
});
it("une photo redressée avec la correction proposée ressort droite", () => {
  // Le test qui relie la mesure au rendu : un signe inversé quelque part
  // doublerait l'inclinaison au lieu de l'annuler.
  const g = scene(2.4);
  const n = mesurerNiveau(g.gris, g.w, g.h);
  const straighten = correctionDe({ ...n, version: VERSION_NIVEAU }, ["auto"])!;
  expect(straighten).toBeCloseTo(-2.4, 1);
  const r = processRaster(rvba(g), { ...DEFAULT, straighten }, 0);
  const l = luminanceReduite(r.data, r.width, r.height);
  const apres = mesurerNiveau(l.gris, l.w, l.h);
  expect(apres.tier, apres.reason).toBe("level");
});
it("une façade droite est reconnue comme droite", () => {
  const g = scene(0);
  expect(mesurerNiveau(g.gris, g.w, g.h)).toMatchObject({ tier: "level", angle: 0 });
});
it("sans lignes, Juno s'abstient plutôt que de deviner", () => {
  const W = 800,
    H = 533,
    bruit = new Float32Array(W * H);
  let graine = 7;
  for (let i = 0; i < bruit.length; i++) {
    graine = (graine * 1103515245 + 12345) >>> 0;
    bruit[i] = 90 + (graine >>> 24) / 8;
  }
  expect(mesurerNiveau(bruit, W, H).tier).toBe("abstain");
  expect(mesurerNiveau(new Float32Array(W * H).fill(128), W, H).tier).toBe("abstain");
});
it("au-delà de 5°, on propose ; au-delà de 10°, l'inclinaison est tenue pour voulue", () => {
  const moyen = scene(7);
  const n = mesurerNiveau(moyen.gris, moyen.w, moyen.h);
  expect(n.tier).toBe("suggest");
  expect(n.angle!).toBeCloseTo(7, 1);
  const fort = scene(14);
  expect(mesurerNiveau(fort.gris, fort.w, fort.h)).toMatchObject({ tier: "abstain", angle: null });
});
it("un horizon seul se pose jusqu'à 2°, et se propose au-delà", () => {
  const faible = scene(1.2, 960, 640, horizonSeul);
  const a = mesurerNiveau(faible.gris, faible.w, faible.h);
  expect(a.tier, a.reason).toBe("auto");
  expect(a.angle!).toBeCloseTo(1.2, 1);
  // Un bord de toit ou d'auvent passe pour un horizon : au-delà de 2°, sans
  // verticale pour confirmer, on ne pose rien seul.
  const fort = scene(3.5, 960, 640, horizonSeul);
  expect(mesurerNiveau(fort.gris, fort.w, fort.h).tier).toBe("suggest");
});
it("verticales et horizon en désaccord : on propose sans poser", () => {
  const V = { delta: 1.5, dist: Infinity, n: 6, support: 2, rms: 0.1 };
  const Hz = { delta: -0.5, span: 0.9, cover: 0.6, res: 0.5 };
  expect(decider(V, Hz, 0.05)).toMatchObject({ tier: "suggest", angle: -0.5 });
  expect(decider(V, { ...Hz, delta: 1.3 }, 0.05).tier).toBe("auto");
  // Des verticales instables (un seul pilier fait l'angle) ne suffisent pas.
  expect(decider(V, null, 0.4).tier).toBe("suggest");
  expect(decider(null, null, Infinity).tier).toBe("abstain");
});
it("la correction ne s'applique qu'aux paliers demandés, et à la bonne version", () => {
  const l = { tier: "suggest" as const, angle: 1.234, reason: "", version: VERSION_NIVEAU };
  expect(correctionDe(l, ["auto"])).toBeUndefined();
  expect(correctionDe(l, ["auto", "suggest"])).toBe(-1.23);
  expect(correctionDe({ ...l, version: "ancienne" }, ["suggest"])).toBeUndefined();
  expect(correctionDe({ ...l, tier: "level", angle: 0 }, ["level"])).toBe(0);
  expect(correctionDe({ ...l, tier: "abstain", angle: null }, ["abstain"])).toBeUndefined();
  expect(correctionDe(undefined, ["auto"])).toBeUndefined();
});
it("la réduction moyenne chaque bloc, en 8 comme en 16 bits", () => {
  // 4 × 2 pixels, réduits d'un facteur 2 : deux blocs de 2 × 2.
  const px = (v: number) => [v, v, v, 255];
  const huit = Uint8ClampedArray.from([
    ...px(0), ...px(100), ...px(200), ...px(200),
    ...px(100), ...px(200), ...px(200), ...px(200),
  ]);
  const r = luminanceReduite(huit, 4, 2, 2);
  expect([r.w, r.h]).toEqual([2, 1]);
  expect(r.gris[0]).toBeCloseTo(100, 3);
  expect(r.gris[1]).toBeCloseTo(200, 3);
  const seize = Uint16Array.from(huit, (v, i) => (i % 4 === 3 ? 65535 : v * 257));
  const s = luminanceReduite(seize, 4, 2, 2, true);
  expect(s.gris[0]).toBeCloseTo(100, 3);
});
