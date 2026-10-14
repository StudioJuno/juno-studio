import { it, expect } from "vitest";
import {
  measureLook,
  referenceLook,
  lookGap,
  lookDistance,
  aimForLook,
  MIN_LOOK_SAMPLES,
  type LookStats,
} from "../src/modules/look";
/** Une image unie, en RGBA, de la couleur demandée. */
const unie = (r: number, g: number, b: number, w = 32, h = 32) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = r;
    d[i * 4 + 1] = g;
    d[i * 4 + 2] = b;
    d[i * 4 + 3] = 255;
  }
  return { d, w, h };
};
/** Un dégradé du noir au blanc : ses centiles sont connus d'avance. */
const degrade = (w = 100, h = 10) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round((x / (w - 1)) * 255),
        i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  return { d, w, h };
};
it("un gris moyen est lu comme tel, sans dominante", () => {
  const { d, w, h } = unie(128, 128, 128);
  const s = measureLook(d, w, h);
  expect(s.mid).toBeCloseTo(0.502, 2);
  expect(s.black).toBeCloseTo(0.502, 2);
  expect(s.contrast).toBeCloseTo(0, 3);
  expect(s.saturation).toBeCloseTo(0, 3);
  expect(s.warmth).toBeCloseTo(0, 3);
  expect(s.tint).toBeCloseTo(0, 3);
});
it("une dominante chaude est mesurée dans le bon sens", () => {
  const chaud = measureLook(...Object.values(unie(170, 128, 90)) as [Uint8ClampedArray, number, number]);
  const froid = measureLook(...Object.values(unie(90, 128, 170)) as [Uint8ClampedArray, number, number]);
  expect(chaud.warmth).toBeGreaterThan(0.2);
  expect(froid.warmth).toBeLessThan(-0.2);
  // Le magenta baisse le vert : la teinte devient négative.
  const magenta = measureLook(...Object.values(unie(150, 110, 150)) as [Uint8ClampedArray, number, number]);
  expect(magenta.tint).toBeLessThan(0);
});
it("un dégradé donne les centiles attendus", () => {
  const { d, w, h } = degrade();
  const s = measureLook(d, w, h);
  expect(s.mid).toBeCloseTo(0.5, 1);
  expect(s.black).toBeLessThan(0.05);
  expect(s.white).toBeGreaterThan(0.95);
  expect(s.contrast).toBeCloseTo(0.8, 1);
});
it("une image trop petite est refusée plutôt que mal mesurée", () => {
  expect(() => measureLook(new Uint8ClampedArray(4), 10, 10)).toThrow(/trop petite/);
  expect(() => measureLook(new Uint8ClampedArray(0), 0, 0)).toThrow();
});
it("les pixels sans canal alpha sont lus aussi", () => {
  // FFmpeg sort du rgb24 : trois octets par pixel, pas quatre.
  const w = 16, h = 16, d = new Uint8Array(w * h * 3).fill(128);
  expect(measureLook(d, w, h).mid).toBeCloseTo(0.502, 2);
});
const echantillon = (mid: number): LookStats => ({
  black: 0.05,
  shadow: 0.11,
  mid,
  highlight: 0.79,
  white: 0.93,
  contrast: 0.65,
  saturation: 0.26,
  warmth: 0.09,
  tint: 0.003,
});
it("le rendu de référence est une médiane, pas une moyenne", () => {
  // Une photo volontairement très claire ne doit pas emporter la cible.
  const normales = Array.from({ length: 60 }, (_, i) => echantillon(0.44 + (i % 5) / 200));
  const avecAberrante = [...normales, echantillon(0.99), echantillon(0.98)];
  expect(referenceLook(avecAberrante).median.mid).toBeCloseTo(
    referenceLook(normales).median.mid,
    2,
  );
  expect(referenceLook(normales).samples).toBe(60);
});
it("la dispersion dit si un style existe vraiment", () => {
  const serre = referenceLook(Array.from({ length: 60 }, () => echantillon(0.44)));
  const disperse = referenceLook(
    Array.from({ length: 60 }, (_, i) => echantillon(0.2 + (i % 50) / 60)),
  );
  expect(serre.spread.mid).toBeCloseTo(0, 2);
  expect(disperse.spread.mid).toBeGreaterThan(0.4);
});
it("sans assez de photos livrées, rien n'est visé", () => {
  const maigre = referenceLook(
    Array.from({ length: MIN_LOOK_SAMPLES - 1 }, () => echantillon(0.44)),
  );
  expect(aimForLook(echantillon(0.9), maigre)).toEqual({});
  expect(aimForLook(echantillon(0.9), undefined)).toEqual({});
});
it("la luminosité d'un portfolio n'est jamais visée", () => {
  // Mesuré sur 50 RAW : viser la tonalité dégradait le résultat, parce que la
  // luminosité d'un album mélange le style et les scènes photographiées.
  const ref = referenceLook(Array.from({ length: 60 }, () => echantillon(0.44)));
  for (const clair of [0.2, 0.8]) {
    const vise = aimForLook(echantillon(clair), ref);
    expect(vise).not.toHaveProperty("exposure");
    expect(vise).not.toHaveProperty("blacks");
    expect(vise).not.toHaveProperty("shadows");
    expect(vise).not.toHaveProperty("contrast");
  }
  expect(aimForLook(echantillon(0.44), ref)).toEqual({});
});
it("une image trop froide est réchauffée, et l'inverse", () => {
  const ref = referenceLook(Array.from({ length: 60 }, () => echantillon(0.44)));
  const froide = aimForLook({ ...echantillon(0.44), warmth: 0.007 }, ref);
  // La référence est à 0,09 : il manque 0,083, soit 23 crans, amortis à 16.
  expect(froide.warmth!).toBeGreaterThan(12);
  expect(froide.warmth!).toBeLessThan(20);
  const chaude = aimForLook({ ...echantillon(0.44), warmth: 0.3 }, ref);
  expect(chaude.warmth!).toBeLessThan(0);
  // La correction reste bornée, même sur un écart absurde.
  expect(aimForLook({ ...echantillon(0.44), warmth: -1 }, ref).warmth!).toBeLessThanOrEqual(40);
});
it("une image moins saturée que la référence est remontée", () => {
  const ref = referenceLook(Array.from({ length: 60 }, () => echantillon(0.44)));
  const terne = aimForLook({ ...echantillon(0.44), saturation: 0.181 }, ref);
  expect(terne.saturation!).toBeGreaterThan(20);
  expect(terne.saturation!).toBeLessThanOrEqual(40);
});
it("l'écart au rendu de référence est nul quand il n'y en a pas", () => {
  const s = echantillon(0.44);
  expect(lookDistance(s, s)).toBe(0);
  expect(lookGap(s, s).mid).toBe(0);
  expect(lookDistance(echantillon(0.6), s)).toBeGreaterThan(0.15);
});
import { combineLook } from "../src/modules/look";
it("une visée s'ajoute aux réglages, elle ne les remplace jamais", () => {
  // Le défaut qui a été mesuré : en remplaçant la balance des blancs déjà
  // calculée, la correction dépassait la cible du double exactement.
  const base = { warmth: -8, saturation: 0, exposure: -0.2 };
  const combine = combineLook(base, { warmth: 23, saturation: 37 });
  expect(combine.warmth).toBe(15);
  expect(combine.saturation).toBe(37);
  // Ce qui n'est pas visé n'est pas touché.
  expect(combine.exposure).toBe(-0.2);
  // L'addition reste dans les bornes du réglage.
  expect(combineLook({ warmth: 95 }, { warmth: 40 }).warmth).toBe(100);
  expect(combineLook({}, {}).warmth).toBeUndefined();
});
