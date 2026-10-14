import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
/**
 * Le script tel que le travailleur de vision le charge avec importScripts :
 * c'est la seule copie de cette géométrie, et on teste celle-là.
 */
type Boite = { x: number; y: number; w: number; h: number };
const T = (() => {
  const module = { exports: {} as Record<string, unknown> };
  new Function("module", "self", readFileSync("public/face-tiles.js", "utf8"))(module, {});
  return module.exports as {
    tuiles(w: number, h: number, c?: number): Boite[];
    versImage(b: Partial<Boite> & { x: number; y: number }, t: Boite): Boite;
    recouvrement(a: Boite, b: Boite): number;
    fusionner<E>(e: E[], seuil?: number, boite?: (e: E) => Boite): E[];
  };
})();
const { tuiles, versImage, recouvrement, fusionner } = T;
it("l'image entière est toujours lue en premier", () => {
  // Un gros plan découpé en tuiles serait coupé en morceaux méconnaissables.
  expect(tuiles(1920, 1080)[0]).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  expect(tuiles(1080, 1920)[0]).toEqual({ x: 0, y: 0, w: 1, h: 1 });
});
it("les tuiles couvrent toute l'image, sans en sortir", () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [4000, 3000]]) {
    const ts = tuiles(w, h).slice(1);
    for (const t of ts) {
      expect(t.x).toBeGreaterThanOrEqual(-1e-9);
      expect(t.y).toBeGreaterThanOrEqual(-1e-9);
      expect(t.x + t.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(t.y + t.h).toBeLessThanOrEqual(1 + 1e-9);
    }
    // Chaque point de l'image tombe dans au moins une tuile de chaque grille.
    for (let gx = 0.01; gx < 1; gx += 0.07)
      for (let gy = 0.01; gy < 1; gy += 0.07)
        expect(
          ts.some((t) => gx >= t.x && gx <= t.x + t.w && gy >= t.y && gy <= t.y + t.h),
          `${w}x${h} (${gx},${gy})`,
        ).toBe(true);
  }
});
it("un visage posé sur une couture tient entier dans une tuile", () => {
  // C'est la raison du chevauchement : sans lui, un visage au milieu du cadre
  // serait coupé en deux et aucune tuile ne le reconnaîtrait.
  const couture = { x: 0.46, y: 0.3, w: 0.08, h: 0.14 };
  const entiere = tuiles(1920, 1080)
    .slice(1)
    .some(
      (t) =>
        couture.x >= t.x &&
        couture.y >= t.y &&
        couture.x + couture.w <= t.x + t.w &&
        couture.y + couture.h <= t.y + t.h,
    );
  expect(entiere).toBe(true);
});
it("une boîte trouvée dans une tuile revient au bon endroit de l'image", () => {
  const t = { x: 0.5, y: 0, w: 0.5, h: 1 };
  expect(versImage({ x: 0.5, y: 0.2, w: 0.2, h: 0.1 }, t)).toEqual({
    x: 0.75, y: 0.2, w: 0.1, h: 0.1,
  });
});
it("le même visage trouvé deux fois n'est gardé qu'une fois, en entier", () => {
  const entier = { x: 0.7, y: 0.2, w: 0.1, h: 0.18 };
  const moitie = { x: 0.7, y: 0.2, w: 0.05, h: 0.18 };
  const decale = { x: 0.702, y: 0.201, w: 0.098, h: 0.179 };
  const r = fusionner([moitie, entier, decale]);
  expect(r).toHaveLength(1);
  expect(r[0]).toEqual(entier);
});
it("deux mariés côte à côte restent deux visages", () => {
  const a = { x: 0.4, y: 0.3, w: 0.08, h: 0.14 },
    b = { x: 0.49, y: 0.3, w: 0.08, h: 0.14 };
  expect(recouvrement(a, b)).toBe(0);
  expect(fusionner([a, b])).toHaveLength(2);
});

it("fusionne des détections entières, pas seulement des rectangles", () => {
  // Le travailleur fusionne des visages complets (repères, expressions) :
  // il faut garder l'objet entier de la lecture la plus complète.
  const entier = { nom: "entier", boite: { x: 0.7, y: 0.2, w: 0.1, h: 0.18 } };
  const moitie = { nom: "moitié", boite: { x: 0.7, y: 0.2, w: 0.05, h: 0.18 } };
  const r = fusionner([moitie, entier], 0.5, (d) => d.boite);
  expect(r).toEqual([entier]);
});
it("un point ramené d'un morceau garde sa profondeur", () => {
  const p = versImage({ x: 0.5, y: 0.5, z: -0.03 } as never, { x: 0.5, y: 0, w: 0.5, h: 1 });
  expect(p).toEqual({ x: 0.75, y: 0.5, z: -0.03 });
});
