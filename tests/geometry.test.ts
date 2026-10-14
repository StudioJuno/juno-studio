import { it, expect } from "vitest";
import {
  cadreInscrit,
  cadreAuFormat,
  displayToSource,
  effectiveCrop,
  pixelSource,
  redresseVersSource,
  sourceToDisplay,
  sourceVersRedresse,
} from "../src/modules/geometry";
import { DEFAULT, type Adjustments } from "../src/model";
const reglages = (x: Partial<Adjustments>): Adjustments => ({ ...DEFAULT, ...x });
const FORMATS: [number, number][] = [
  [6000, 4000],
  [4000, 6000],
  [3000, 3000],
  [1920, 1080],
];
const ANGLES = [-45, -10, -2.5, -0.5, 0.3, 1, 7, 45];
/** Les quatre coins d'un cadre, ramenés dans la source. */
const coins = (r: { x: number; y: number; w: number; h: number }, t: number, W: number, H: number) =>
  [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ].map(([x, y]) => redresseVersSource({ x, y }, t, W, H));
it("le cadre inscrit ne laisse aucun coin vide, et garde le format de la photo", () => {
  for (const [W, H] of FORMATS)
    for (const t of ANGLES) {
      const c = cadreInscrit(W, H, t);
      for (const p of coins(c, t, W, H)) {
        expect(p.x, `${W}x${H} ${t}°`).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeLessThanOrEqual(1 + 1e-9);
        expect(p.y).toBeLessThanOrEqual(1 + 1e-9);
      }
      expect((c.w * W) / (c.h * H)).toBeCloseTo(W / H, 9);
    }
});
it("le cadre inscrit est le plus grand possible : un coin touche le bord", () => {
  for (const [W, H] of FORMATS)
    for (const t of ANGLES) {
      const c = cadreInscrit(W, H, t);
      const bord = Math.min(
        ...coins(c, t, W, H).flatMap((p) => [p.x, p.y, 1 - p.x, 1 - p.y]),
      );
      expect(bord, `${W}x${H} ${t}°`).toBeCloseTo(0, 9);
    }
});
it("on retrouve le facteur classique 1 / (cos t + (L/S)·sin t)", () => {
  const t = 2,
    r = (t * Math.PI) / 180;
  expect(cadreInscrit(6000, 4000, t).w).toBeCloseTo(1 / (Math.cos(r) + 1.5 * Math.sin(r)), 12);
  expect(cadreInscrit(4000, 6000, t).h).toBeCloseTo(1 / (Math.cos(r) + 1.5 * Math.sin(r)), 12);
});
it("sans angle, rien ne change : même cadre qu'avant", () => {
  expect(effectiveCrop(reglages({}), 6000, 4000)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  expect(effectiveCrop(reglages({ crop: 20 }), 6000, 4000)).toEqual({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 });
  const r = { x: 0.05, y: 0.1, w: 0.6, h: 0.7 };
  expect(effectiveCrop(reglages({ cropRect: r }), 6000, 4000)).toEqual(r);
});
it("un cadre enregistré qui déborde après redressement est ramené sans coin vide", () => {
  const r = { x: 0, y: 0, w: 0.7, h: 0.7 };
  for (const t of [3, -8, 20]) {
    const c = effectiveCrop(reglages({ cropRect: r, straighten: t }), 6000, 4000);
    for (const p of coins(c, t, 6000, 4000)) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(p.x).toBeLessThanOrEqual(1 + 1e-9);
      expect(p.y).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Le format choisi est conservé.
    expect(c.w / c.h).toBeCloseTo(1, 9);
  }
});
it("les allers-retours écran ↔ source se referment, quart de tour et angle compris", () => {
  for (const [W, H] of FORMATS)
    for (const rotation of [0, 90, 180, 270])
      for (const straighten of [0, -3.2, 12])
        for (const crop of [0, 15]) {
          const a = reglages({ rotation, straighten, crop });
          for (const p of [
            { x: 0.2, y: 0.3 },
            { x: 0.5, y: 0.5 },
            { x: 0.93, y: 0.07 },
          ]) {
            const s = displayToSource(p, a, W, H),
              q = sourceToDisplay(s, a, W, H);
            expect(q.x, JSON.stringify({ W, H, rotation, straighten, crop, p })).toBeCloseTo(p.x, 9);
            expect(q.y).toBeCloseTo(p.y, 9);
          }
        }
});
it("le redressement tourne dans le bon sens : positif = horaire à l'écran", () => {
  // Un point à droite du centre descend quand on tourne dans le sens horaire
  // (y vers le bas).
  const f = sourceVersRedresse({ x: 0.9, y: 0.5 }, 10, 1000, 1000);
  expect(f.y).toBeGreaterThan(0.5);
  expect(redresseVersSource(f, 10, 1000, 1000).x).toBeCloseTo(0.9, 12);
});
it("un format demandé reste exact à l'écran, même redressé et tourné", () => {
  for (const [W, H] of FORMATS)
    for (const rotation of [0, 90])
      for (const t of [0, 4])
        for (const ratio of [16 / 9, 4 / 5, 1]) {
          const c = cadreAuFormat(W, H, rotation, ratio, t);
          const w = c.w * W,
            h = c.h * H;
          expect(rotation % 180 ? h / w : w / h).toBeCloseTo(ratio, 9);
          for (const p of coins(c, t, W, H)) {
            expect(p.x).toBeGreaterThanOrEqual(-1e-9);
            expect(p.x).toBeLessThanOrEqual(1 + 1e-9);
          }
        }
});
it("le rendu lit toujours à l'intérieur de la source", () => {
  for (const [W, H] of [
    [600, 400],
    [400, 600],
  ])
    for (const rotation of [0, 90, 180, 270])
      for (const straighten of [-7, 0.8, 30]) {
        const m = pixelSource(reglages({ rotation, straighten }), W, H);
        for (const [dx, dy] of [
          [0, 0],
          [m.largeur - 1, 0],
          [0, m.hauteur - 1],
          [m.largeur - 1, m.hauteur - 1],
        ]) {
          const [x, y] = m.lire(dx, dy);
          // Le centre du pixel de bord peut dépasser d'un demi-pixel au plus.
          expect(x).toBeGreaterThanOrEqual(-0.51);
          expect(y).toBeGreaterThanOrEqual(-0.51);
          expect(x).toBeLessThanOrEqual(W - 0.49);
          expect(y).toBeLessThanOrEqual(H - 0.49);
        }
      }
});
