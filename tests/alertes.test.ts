import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzePixels } from "../src/pixels";
import { hautesLumieres, peuDeDetails, verdictFor } from "../src/modules/quality";
import { groupSuggestions } from "../src/modules/culling";
import { validateCatalog } from "../src/modules/catalog-validation";
import { DEFAULT, type Analysis, type FaceRead, type Photo } from "../src/model";

/**
 * Les alertes « à vérifier » réglées le 29/09/2026 sur l'album Audrey-Ann et
 * Clément (matin), vérifiées sur l'après-midi et à l'œil : 49 des 51 alertes
 * « Hautes lumières » des meilleures images étaient du ciel, « Peu de
 * détails » visait des gros plans nets sur fond flou, « Image très sombre »
 * des soirées normales.
 */
const N = (() => {
  const module = { exports: {} as Record<string, unknown> };
  new Function("module", "self", readFileSync("public/face-sharpness.js", "utf8"))(module, {});
  return module.exports as { ecrete(g: ArrayLike<number>, w: number, h: number, b: { x: number; y: number; w: number; h: number }): number | undefined };
})();

const image = (w: number, h: number, f: (x: number, y: number) => number) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = f(x, y);
      d.set([v, v, v, 255], (y * w + x) * 4);
    }
  return d;
};
const W = 1024,
  H = 683;

it("un gros plan net sur fond flou n'est plus « peu détaillé »", () => {
  // Un fond lisse, et une petite zone très texturée (des mains, une alliance).
  const net = analyzePixels(
    image(W, H, (x, y) => (x >= 420 && x < 480 && y >= 320 && y < 370 ? 120 + ((x + y) % 2 ? 10 : -10) : 120 + Math.sin(x / 90) * 20)),
    W,
    H,
  );
  expect(net.sharpness).toBeLessThan(150);
  expect(net.nettetePointe!).toBeGreaterThan(150);
  expect(net.reasons).not.toContain("Peu de détails : vérifier la netteté");
  // Tout flou : ni la moyenne ni la meilleure case ne passent.
  const flou = analyzePixels(image(W, H, (x) => 120 + Math.sin(x / 90) * 20), W, H);
  expect(flou.reasons).toContain("Peu de détails : vérifier la netteté");
  // Sans mesure par case (analyse ancienne), l'ancienne règle.
  expect(peuDeDetails(100, 1024)).toBe(true);
  expect(peuDeDetails(100, 1024, 400)).toBe(false);
});

it("une soirée sombre n'est plus signalée, une image presque noire l'est", () => {
  expect(analyzePixels(image(64, 48, () => 36), 64, 48).reasons).not.toContain("Image très sombre");
  expect(analyzePixels(image(64, 48, () => 12), 64, 48).reasons).toContain("Image très sombre");
});

it("le ciel blanc n'alerte plus, un visage brûlé si", () => {
  const visage = (over: Partial<FaceRead>): FaceRead => ({
    region: { x: 0.4, y: 0.4, w: 0.2, h: 0.3 },
    weight: 0.06,
    sharpness: 900,
    eyesClosed: 0,
    smile: 0.5,
    turned: 0,
    ...over,
  });
  const base: Analysis = { brightness: 0.6, sharpness: 900, sharpnessWidth: 1024, clipped: 0.3, dhash: "0".repeat(64), advice: "normal", reasons: [] };
  const avec = (reads: FaceRead[], over: Partial<Analysis> = {}): Analysis => ({ ...base, ...over, faces: { count: reads.length, closedEyes: 0, blink: 0, reads, version: "t" } });
  // 30 % de l'image en blanc pur (le ciel), visage intact : pas d'alerte.
  expect(hautesLumieres(avec([visage({ ecrete: 0.02 })]))).toBe(false);
  // Le cœur du visage brûlé : alerte.
  expect(hautesLumieres(avec([visage({ ecrete: 0.2 })]))).toBe(true);
  // Un petit visage au fond, brûlé, ne compte pas.
  expect(hautesLumieres(avec([visage({ ecrete: 0.01 }), visage({ region: { x: 0.1, y: 0.1, w: 0.05, h: 0.07 }, ecrete: 0.9 })]))).toBe(false);
  // Garde-fous sans visage : la moitié de l'image blanche, ou une image brûlée.
  expect(hautesLumieres({ ...base, clipped: 0.55 })).toBe(true);
  expect(hautesLumieres({ ...base, brightness: 0.95, clipped: 0 })).toBe(true);
  expect(hautesLumieres(base)).toBe(false);
  // Raison et verdict disent la même chose, analyses anciennes comprises.
  const photo = (a: Analysis) =>
    ({ id: "p", projectId: "p", name: "p.jpg", width: 10, height: 10, status: "pending", created: 1, adjustments: DEFAULT, analysis: a }) as unknown as Photo;
  const ancien = groupSuggestions([photo({ ...avec([visage({ ecrete: 0.02 })]), reasons: ["Image très sombre", "Hautes lumières à vérifier"], brightness: 0.12, advice: "review" })])[0];
  expect(ancien.analysis!.reasons).toEqual([]);
  expect(ancien.analysis!.verdict).not.toMatch(/lumières|sombre|noire/);
  const brule = groupSuggestions([photo(avec([visage({ ecrete: 0.3 })]))])[0];
  expect(brule.analysis!.reasons).toContain("Hautes lumières à vérifier");
  expect(verdictFor(brule.analysis!)).toBe("Hautes lumières à vérifier.");
});

it("la part brûlée se lit dans le cœur du visage, pas sur ses bords", () => {
  const w = 100,
    h = 100;
  // Un visage de 40 × 40 à (30, 30) : blanc pur sur son pourtour, gris au cœur.
  const gris = new Float32Array(w * h).fill(120);
  for (let y = 30; y < 70; y++) for (let x = 30; x < 70; x++) gris[y * w + x] = x < 36 || x >= 64 || y < 36 || y >= 64 ? 255 : 120;
  expect(N.ecrete(gris, w, h, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 })).toBe(0);
  for (let y = 36; y < 64; y++) for (let x = 36; x < 64; x++) gris[y * w + x] = 252;
  expect(N.ecrete(gris, w, h, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 })).toBe(1);
  expect(N.ecrete(gris, w, h, { x: 0.3, y: 0.3, w: 0, h: 0 })).toBeUndefined();
});

it("le catalogue accepte les nouvelles mesures et refuse des valeurs absurdes", () => {
  const projet = { id: "p", name: "Projet", kind: "Mariage", date: "2026-09-19", location: "", created: 1, demo: false };
  const cat = (analysis: unknown) =>
    validateCatalog(projet as never, [
      { id: "x", projectId: "p", name: "x.jpg", source: "idb", thumbnail: "", width: 10, height: 10, size: 10, created: 1, status: "pending", stars: 0, adjustments: DEFAULT, history: [], analysis },
    ] as never);
  const a = { brightness: 0.5, sharpness: 100, clipped: 0, dhash: "0".repeat(64), advice: "normal", reasons: [] };
  expect(() => cat({ ...a, nettetePointe: 812 })).not.toThrow();
  expect(() => cat({ ...a, nettetePointe: -1 })).toThrow();
  const lu = { region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, weight: 0.04, sharpness: 1, eyesClosed: 0, smile: 0, turned: 0 };
  expect(() => cat({ ...a, faces: { count: 1, closedEyes: 0, blink: 0, reads: [{ ...lu, ecrete: 0.2 }], version: "v" } })).not.toThrow();
  expect(() => cat({ ...a, faces: { count: 1, closedEyes: 0, blink: 0, reads: [{ ...lu, ecrete: 3 }], version: "v" } })).toThrow();
});
