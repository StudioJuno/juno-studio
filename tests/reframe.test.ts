import { it, expect } from "vitest";
import {
  ajuster,
  cadrer,
  cadrerPlan,
  lisser,
  retenus,
  union,
  zone,
  zoomQuiRemplit,
  type Visage,
} from "../src/video/reframe";
const LARGE = { w: 1920, h: 1080 };
const VERTICAL = { w: 1080, h: 1920 };
/**
 * Ce que le cadre laisse voir de la source.
 *
 * Écrit à partir du filtre de `render.cjs` et non de `reframe.ts` : sinon le
 * test ne ferait que répéter la formule qu'il est censé vérifier. Le rendu met
 * le plan à l'échelle dans une boîte de `W*scale` sur `H*scale` à rapport
 * conservé, puis le pose au centre décalé de `x*W` et `y*H`.
 */
function vu(
  cadre: { scale: number; x: number; y: number },
  source: { w: number; h: number },
  cible: { w: number; h: number },
) {
  const m = Math.min(
    (cible.w * cadre.scale) / source.w,
    (cible.h * cadre.scale) / source.h,
  );
  const rw = source.w * m,
    rh = source.h * m;
  const gauche = (cible.w - rw) / 2 + cadre.x * cible.w,
    haut = (cible.h - rh) / 2 + cadre.y * cible.h;
  return {
    x0: -gauche / rw,
    x1: (cible.w - gauche) / rw,
    y0: -haut / rh,
    y1: (cible.h - haut) / rh,
  };
}
// Le cadre peut border le visage à la virgule près : comparer sans tolérance
// ferait échouer un cadrage juste sur un dix-millième de milliardième.
const EPS = 1e-9;
const contient = (v: ReturnType<typeof vu>, f: Visage) =>
  f.x >= v.x0 - EPS &&
  f.y >= v.y0 - EPS &&
  f.x + f.w <= v.x1 + EPS &&
  f.y + f.h <= v.y1 + EPS;
const sansBande = (v: ReturnType<typeof vu>) =>
  v.x0 >= -1e-6 && v.y0 >= -1e-6 && v.x1 <= 1 + 1e-6 && v.y1 <= 1 + 1e-6;
it("un plan large dans une séquence verticale ne laisse aucune bande noire", () => {
  // Le défaut d'origine : `force_original_aspect_ratio=decrease` encadrait le
  // plan de noir et laissait les mariés minuscules.
  const visage: Visage = { x: 0.45, y: 0.3, w: 0.1, h: 0.18 };
  const cadre = cadrer([visage], LARGE, VERTICAL);
  const v = vu(cadre, LARGE, VERTICAL);
  expect(sansBande(v)).toBe(true);
  expect(contient(v, visage)).toBe(true);
  expect(cadre.scale).toBeGreaterThanOrEqual(zoomQuiRemplit(LARGE, VERTICAL));
});
it("un visage collé au bord reste entier, sans montrer du vide", () => {
  for (const visage of [
    { x: 0.02, y: 0.3, w: 0.1, h: 0.18 },
    { x: 0.88, y: 0.3, w: 0.1, h: 0.18 },
    { x: 0.45, y: 0.02, w: 0.1, h: 0.18 },
    { x: 0.45, y: 0.78, w: 0.1, h: 0.18 },
  ]) {
    const cadre = cadrer([visage], LARGE, VERTICAL);
    const v = vu(cadre, LARGE, VERTICAL);
    expect(sansBande(v), JSON.stringify(visage)).toBe(true);
    expect(contient(v, visage), JSON.stringify(visage)).toBe(true);
  }
});
it("en mode « tous », personne n'est coupé quand c'est géométriquement possible", () => {
  const visages: Visage[] = [
    { x: 0.4, y: 0.35, w: 0.06, h: 0.11 },
    { x: 0.52, y: 0.33, w: 0.065, h: 0.12 },
    { x: 0.47, y: 0.42, w: 0.05, h: 0.09 },
  ];
  const r = cadrerPlan([{ seconde: 0, visages }], LARGE, VERTICAL, "tous");
  expect(r.tientTout).toBe(true);
  const v = vu(r, LARGE, VERTICAL);
  for (const f of visages) expect(contient(v, f), JSON.stringify(f)).toBe(true);
});
it("un groupe trop étalé ne tient pas dans le vertical, et Juno le dit", () => {
  // Un 16/9 recadré en 9/16 ne laisse voir que 31 % de la largeur. Des invités
  // répartis sur toute la scène ne peuvent pas y tenir : le prétendre serait
  // mentir, et le cadre choisi n'en serait pas meilleur.
  const etales: Visage[] = [
    { x: 0.1, y: 0.35, w: 0.08, h: 0.14 },
    { x: 0.78, y: 0.32, w: 0.09, h: 0.15 },
    { x: 0.45, y: 0.4, w: 0.07, h: 0.12 },
  ];
  const r = cadrerPlan([{ seconde: 0, visages: etales }], LARGE, VERTICAL, "tous");
  expect(r.tientTout).toBe(false);
  expect(r.note).toMatch(/trop étroit/);
  expect(sansBande(vu(r, LARGE, VERTICAL))).toBe(true);
});
it("la marge se mesure sur un visage, pas sur l'écart entre les gens", () => {
  // Deux mariés éloignés n'ont pas besoin d'une marge proportionnelle à leur
  // distance : sur l'union, le cadre retombait sur le plan large.
  const proches: Visage[] = [
    { x: 0.46, y: 0.33, w: 0.05, h: 0.09 },
    { x: 0.52, y: 0.33, w: 0.05, h: 0.09 },
  ];
  const ecartes: Visage[] = [
    { x: 0.38, y: 0.33, w: 0.05, h: 0.09 },
    { x: 0.58, y: 0.33, w: 0.05, h: 0.09 },
  ];
  const zp = zone(proches)!,
    ze = zone(ecartes)!;
  expect(ze.w - union(ecartes)!.w).toBeCloseTo(zp.w - union(proches)!.w, 6);
});
it("en mode « couple », les deux plus grands sont gardés et le cadre se resserre", () => {
  const maries: Visage[] = [
    { x: 0.42, y: 0.3, w: 0.11, h: 0.19 },
    { x: 0.55, y: 0.31, w: 0.1, h: 0.18 },
  ];
  const invites: Visage[] = [
    { x: 0.05, y: 0.42, w: 0.04, h: 0.07 },
    { x: 0.92, y: 0.43, w: 0.035, h: 0.06 },
  ];
  const tous = [...maries, ...invites];
  expect(retenus(tous, "couple")).toHaveLength(2);
  const couple = cadrer(tous, LARGE, VERTICAL, "couple");
  const large = cadrer(tous, LARGE, VERTICAL, "tous");
  // Garder tout le monde oblige à reculer ; le couple seul permet de serrer.
  expect(couple.scale).toBeGreaterThan(large.scale);
  const v = vu(couple, LARGE, VERTICAL);
  for (const f of maries) expect(contient(v, f)).toBe(true);
  expect(sansBande(v)).toBe(true);
});
it("sans visage, le cadre est centré et remplit tout juste", () => {
  const cadre = cadrer([], LARGE, VERTICAL);
  expect(cadre.scale).toBeCloseTo(zoomQuiRemplit(LARGE, VERTICAL), 6);
  expect(cadre.x).toBeCloseTo(0, 6);
  expect(cadre.y).toBeCloseTo(0, 6);
  expect(sansBande(vu(cadre, LARGE, VERTICAL))).toBe(true);
});
it("un plan déjà au bon format n'est pas zoomé", () => {
  expect(zoomQuiRemplit(VERTICAL, VERTICAL)).toBeCloseTo(1, 6);
  expect(zoomQuiRemplit(LARGE, { w: 3840, h: 2160 })).toBeCloseTo(1, 6);
});
it("un sujet immobile donne un cadre fixe, un sujet qui traverse un cadre qui suit", () => {
  const immobile = Array.from({ length: 8 }, (_, i) => ({
    seconde: i * 0.5,
    visages: [{ x: 0.46, y: 0.3, w: 0.1, h: 0.18 }],
  }));
  expect(cadrerPlan(immobile, LARGE, VERTICAL).suivi).toBeUndefined();
  const traverse = Array.from({ length: 8 }, (_, i) => ({
    seconde: i * 0.5,
    visages: [{ x: 0.08 + i * 0.09, y: 0.3, w: 0.1, h: 0.18 }],
  }));
  const r = cadrerPlan(traverse, LARGE, VERTICAL);
  expect(r.suivi).toBeDefined();
  expect(r.suivi!).toHaveLength(8);
  expect(r.note).toMatch(/suit/);
});
it("le cadre qui suit garde le visage à chaque image", () => {
  const traverse = Array.from({ length: 10 }, (_, i) => ({
    seconde: i * 0.4,
    visages: [{ x: 0.06 + i * 0.08, y: 0.28 + i * 0.01, w: 0.1, h: 0.18 }],
  }));
  const r = cadrerPlan(traverse, LARGE, VERTICAL);
  for (const [i, pas] of (r.suivi || []).entries()) {
    const v = vu({ scale: r.scale, x: pas.x, y: pas.y }, LARGE, VERTICAL);
    expect(sansBande(v), `image ${i}`).toBe(true);
    expect(contient(v, traverse[i].visages[0]), `image ${i}`).toBe(true);
  }
});
it("le zoom d'un plan ne respire pas d'une image à l'autre", () => {
  // Un zoom recalculé image par image se verrait comme un pompage.
  const varie = [
    { seconde: 0, visages: [{ x: 0.45, y: 0.3, w: 0.06, h: 0.1 }] },
    { seconde: 1, visages: [{ x: 0.4, y: 0.25, w: 0.2, h: 0.34 }] },
    { seconde: 2, visages: [{ x: 0.44, y: 0.29, w: 0.09, h: 0.15 }] },
  ];
  const r = cadrerPlan(varie, LARGE, VERTICAL);
  for (const e of varie) {
    const v = vu({ scale: r.scale, x: r.x, y: r.y }, LARGE, VERTICAL);
    expect(sansBande(v)).toBe(true);
    expect(v.x1 - v.x0).toBeGreaterThan(0);
  }
  // Le plan le plus serré possible reste celui du visage le plus large.
  expect(r.scale).toBeLessThanOrEqual(
    cadrer(varie[1].visages, LARGE, VERTICAL).scale + 1e-9,
  );
});
it("aucun visage sur tout le plan : centré, et on le dit", () => {
  const r = cadrerPlan(
    [0, 1, 2].map((s) => ({ seconde: s, visages: [] })),
    LARGE,
    VERTICAL,
  );
  expect(r.suivi).toBeUndefined();
  expect(r.note).toMatch(/Aucun visage/);
  expect(r.scale).toBeCloseTo(zoomQuiRemplit(LARGE, VERTICAL), 6);
});
it("le lissage garde autant de valeurs et calme les à-coups", () => {
  const brut = [0, 1, 0, 1, 0, 1, 0];
  const doux = lisser(brut, 5);
  expect(doux).toHaveLength(brut.length);
  const ecart = (v: number[]) => Math.max(...v) - Math.min(...v);
  expect(ecart(doux)).toBeLessThan(ecart(brut));
  expect(lisser([4], 5)).toEqual([4]);
  expect(lisser([1, 2], 1)).toEqual([1, 2]);
});
it("l'union de boîtes les contient toutes", () => {
  const u = union([
    { x: 0.1, y: 0.2, w: 0.1, h: 0.1 },
    { x: 0.5, y: 0.05, w: 0.2, h: 0.3 },
  ])!;
  expect(u).toEqual({ x: 0.1, y: 0.05, w: 0.6, h: 0.3 });
  expect(union([])).toBeUndefined();
});
it("le cadrage reste dans ce que le modèle accepte", () => {
  // Au-delà, `electron/video/model.cjs` refuse d'enregistrer le plan : une
  // séquence impossible à sauvegarder serait pire qu'un cadrage large.
  const extremes: Visage[][] = [
    [{ x: 0.49, y: 0.49, w: 0.004, h: 0.006 }],
    [{ x: 0, y: 0, w: 0.002, h: 0.003 }],
    [{ x: 0.998, y: 0.996, w: 0.002, h: 0.004 }],
  ];
  for (const visages of extremes)
    for (const cible of [VERTICAL, { w: 1080, h: 1080 }, { w: 3840, h: 1600 }]) {
      const c = cadrer(visages, LARGE, cible);
      expect(c.scale, JSON.stringify({ visages, cible })).toBeLessThanOrEqual(5);
      expect(c.scale).toBeGreaterThanOrEqual(0.05);
      expect(Math.abs(c.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.y)).toBeLessThanOrEqual(2);
    }
});
it("un plan qui suit ne dépasse jamais 32 images clés", () => {
  // La limite du modèle. Le relevé en produit huit, mais la règle doit tenir
  // même si on relève plus finement un jour.
  const longs = Array.from({ length: 40 }, (_, i) => ({
    seconde: i * 0.2,
    visages: [{ x: 0.05 + i * 0.02, y: 0.3, w: 0.08, h: 0.14 }],
  }));
  const r = cadrerPlan(longs, LARGE, VERTICAL);
  expect((r.suivi || []).length).toBeLessThanOrEqual(32);
});
