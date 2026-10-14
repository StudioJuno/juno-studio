import { it, expect } from "vitest";
import { processRaster } from "../src/modules/pipeline";
import { sourceToDisplay, pixelSource } from "../src/modules/geometry";
import { DEFAULT, type Adjustments } from "../src/model";
import type { Raster } from "../src/modules/raster";
const reglages = (x: Partial<Adjustments>): Adjustments => ({ ...DEFAULT, ...x });
/** Une image grise avec un point blanc de 3 px à un endroit connu. */
function mire(W: number, H: number, px: number, py: number, seize = false): Raster {
  const data = seize ? new Uint16Array(W * H * 4) : new Uint8ClampedArray(W * H * 4);
  const gris = seize ? 20000 : 80,
    blanc = seize ? 65535 : 255;
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = gris;
    data[i * 4 + 3] = seize ? 65535 : 255;
  }
  for (let y = py - 1; y <= py + 1; y++)
    for (let x = px - 1; x <= px + 1; x++)
      for (let c = 0; c < 3; c++) data[(y * W + x) * 4 + c] = blanc;
  return { width: W, height: H, data } as unknown as Raster;
}
function plusClair(r: Raster) {
  let best = -1,
    at = [0, 0];
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const v = r.data[(y * r.width + x) * 4];
      if (v > best) {
        best = v;
        at = [x, y];
      }
    }
  return at;
}
it("un point de la source ressort là où la géométrie l'annonce, redressé et tourné", () => {
  const W = 300,
    H = 200,
    P = { x: 0.62, y: 0.41 };
  for (const rotation of [0, 90, 180, 270])
    for (const straighten of [0, 3, -11]) {
      const a = reglages({ rotation, straighten });
      const out = processRaster(mire(W, H, Math.round(P.x * W), Math.round(P.y * H)), a, 0);
      const attendu = sourceToDisplay({ x: (Math.round(P.x * W) + 0.5) / W, y: (Math.round(P.y * H) + 0.5) / H }, a, W, H);
      const [x, y] = plusClair(out);
      expect(Math.abs((x + 0.5) / out.width - attendu.x) * out.width, `${rotation}° ${straighten}°`).toBeLessThan(1.6);
      expect(Math.abs((y + 0.5) / out.height - attendu.y) * out.height).toBeLessThan(1.6);
    }
});
it("la taille de sortie est celle du cadre sans coins vides", () => {
  const a = reglages({ straighten: 5, rotation: 90 });
  const out = processRaster(mire(300, 200, 150, 100), a, 0);
  const m = pixelSource(a, 300, 200);
  expect([out.width, out.height]).toEqual([m.largeur, m.hauteur]);
  // Tourné d'un quart : le cadre d'une photo en paysage ressort en portrait.
  expect(out.height).toBeGreaterThan(out.width);
});
it("aucun bord noir : chaque pixel de sortie vient de l'image", () => {
  // Source entièrement grise, sans zéro : un pixel lu hors de l'image
  // ressortirait noir s'il n'était pas borné.
  for (const straighten of [-45, -3, 0.7, 20]) {
    const out = processRaster(mire(240, 160, 120, 80), reglages({ straighten }), 0);
    let min = Infinity;
    for (let i = 0; i < out.width * out.height; i++) min = Math.min(min, out.data[i * 4]);
    expect(min, `${straighten}°`).toBeGreaterThanOrEqual(70);
  }
});
it("un TIFF 16 bits reste en 16 bits une fois redressé", () => {
  const out = processRaster(mire(240, 160, 100, 70, true), reglages({ straighten: 2 }), 0);
  expect(out.data).toBeInstanceOf(Uint16Array);
  expect(Math.max(...Array.from(out.data.subarray(0, 4000)))).toBeGreaterThan(255);
});
it("sans angle, le cadre est recopié tel quel, au pixel près", () => {
  const src = mire(100, 80, 40, 30);
  const out = processRaster(src, reglages({ cropRect: { x: 0.2, y: 0.25, w: 0.5, h: 0.5 } }), 0);
  expect([out.width, out.height]).toEqual([50, 40]);
  // Le point (40, 30) de la source tombe en (20, 10) du cadre.
  expect(plusClair(out)).toEqual([19, 9]);
});
