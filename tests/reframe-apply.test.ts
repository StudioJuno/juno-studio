import { it, expect } from "vitest";
import { appliquerCadrage, imagesCles } from "../src/video/reframe-apply";
import { cadrerPlan } from "../src/video/reframe";
import type { Clip } from "../src/video/types";
const PLAN = {
  id: "c1", assetId: "a1", start: 0, duration: 125, inUs: 2_000_000, track: 0,
  speed: 1, gain: 1, muted: false, opacity: 1, scale: 1, x: 0, y: 0,
  rotation: 0, fadeIn: 0, fadeOut: 0,
} as Clip;
const LARGE = { w: 1920, h: 1080 }, VERTICAL = { w: 1080, h: 1920 };
it("un cadre fixe ne laisse aucune image clé derrière lui", () => {
  const immobile = Array.from({ length: 6 }, (_, i) => ({
    seconde: i * 0.5, visages: [{ x: 0.46, y: 0.3, w: 0.1, h: 0.18 }],
  }));
  const c = appliquerCadrage(PLAN, cadrerPlan(immobile, LARGE, VERTICAL), 25);
  expect(c.animation).toBeUndefined();
  expect(c.scale).toBeGreaterThan(1);
});
it("les images clés restent dans le plan, croissantes et dans les bornes", () => {
  const traverse = Array.from({ length: 8 }, (_, i) => ({
    seconde: i * 0.6, visages: [{ x: 0.08 + i * 0.09, y: 0.3, w: 0.1, h: 0.18 }],
  }));
  const r = cadrerPlan(traverse, LARGE, VERTICAL);
  const c = appliquerCadrage(PLAN, r, 25);
  const cles = c.animation!.x!;
  expect(cles.length).toBeGreaterThan(1);
  expect(cles.length).toBeLessThanOrEqual(32);
  for (let i = 1; i < cles.length; i++)
    expect(cles[i].frame).toBeGreaterThan(cles[i - 1].frame);
  for (const k of [...cles, ...c.animation!.y!]) {
    expect(Number.isSafeInteger(k.frame)).toBe(true);
    expect(k.frame).toBeGreaterThanOrEqual(0);
    expect(k.frame).toBeLessThanOrEqual(PLAN.duration - 1);
    expect(Math.abs(k.value)).toBeLessThanOrEqual(2);
  }
});
it("un plan ralenti étire les images clés, un plan accéléré les resserre", () => {
  // Les secondes du relevé sont comptées dans le média ; un plan à 0,5× dure
  // deux fois plus longtemps à l'écran, ses images clés doivent suivre.
  const suivi = [0, 1, 2].map((s) => ({ seconde: s, x: 0.1 * s, y: 0 }));
  const lent = imagesCles(suivi, { duration: 400, speed: 0.5 }, 25)!;
  const rapide = imagesCles(suivi, { duration: 400, speed: 2 }, 25)!;
  expect(lent.x.map((k) => k.frame)).toEqual([0, 50, 100]);
  expect(rapide.x.map((k) => k.frame)).toEqual([0, 13, 25]);
});
it("deux relevés sur la même image ne produisent qu'une clé", () => {
  // Le modèle exige des images clés strictement croissantes : deux relevés
  // très rapprochés tombent sur la même image et le feraient refuser.
  const colles = [0, 0.001, 0.002, 0.5].map((s) => ({ seconde: s, x: s, y: 0 }));
  const k = imagesCles(colles, { duration: 100, speed: 1 }, 25)!;
  expect(k.x.map((c) => c.frame)).toEqual([0, 13]);
});
it("le recadrage n'efface pas les autres animations du plan", () => {
  const avec = { ...PLAN, animation: { gain: [{ frame: 0, value: 1, easing: "linear" as const }] } };
  const traverse = Array.from({ length: 8 }, (_, i) => ({
    seconde: i * 0.6, visages: [{ x: 0.08 + i * 0.09, y: 0.3, w: 0.1, h: 0.18 }],
  }));
  const c = appliquerCadrage(avec, cadrerPlan(traverse, LARGE, VERTICAL), 25);
  expect(c.animation!.gain).toHaveLength(1);
  expect(c.animation!.x).toBeDefined();
});
it("repasser en cadre fixe retire les images clés de position", () => {
  const avec = {
    ...PLAN,
    animation: {
      x: [{ frame: 0, value: 1, easing: "linear" as const }],
      gain: [{ frame: 0, value: 1, easing: "linear" as const }],
    },
  };
  const immobile = Array.from({ length: 6 }, (_, i) => ({
    seconde: i * 0.5, visages: [{ x: 0.46, y: 0.3, w: 0.1, h: 0.18 }],
  }));
  const c = appliquerCadrage(avec, cadrerPlan(immobile, LARGE, VERTICAL), 25);
  expect(c.animation!.x).toBeUndefined();
  expect(c.animation!.gain).toHaveLength(1);
});
