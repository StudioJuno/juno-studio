import { it, expect, beforeEach } from "vitest";
import {
  readLook,
  writeLook,
  forgetLook,
  learnLookFromImages,
  describeLook,
} from "../src/modules/look-store";
import { aimForLook, MIN_LOOK_SAMPLES } from "../src/modules/look";
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
/** Une image livrée, telle qu'Electron la rend : en BGRA. */
const livree = (r: number, g: number, b: number, w = 24, h = 24) => {
  const bgra = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    bgra[i * 4] = b;
    bgra[i * 4 + 1] = g;
    bgra[i * 4 + 2] = r;
    bgra[i * 4 + 3] = 255;
  }
  return { width: w, height: h, bgra };
};
const dossier = (n: number, r = 170, g = 128, b = 100) => ({
  nom: "Mariages livrés",
  images: Array.from({ length: n }, () => livree(r, g, b)),
});
it("le rouge et le bleu sont remis à leur place", () => {
  // Electron rend du BGRA : lu tel quel, un rendu chaud passerait pour froid.
  const chaud = learnLookFromImages(dossier(60, 190, 130, 90));
  expect(chaud.median.warmth).toBeGreaterThan(0.2);
  const froid = learnLookFromImages(dossier(60, 90, 130, 190));
  expect(froid.median.warmth).toBeLessThan(-0.2);
});
it("le rendu appris se range et se relit à l'identique", () => {
  const l = learnLookFromImages(dossier(60));
  writeLook(l);
  expect(readLook()).toEqual(l);
  forgetLook();
  expect(readLook()).toBeUndefined();
});
it("un stockage abîmé est oublié, jamais appliqué", () => {
  for (const mauvais of [
    "pas du json",
    "null",
    '{"samples":60}',
    '{"samples":60,"median":[],"spread":{}}',
    '{"samples":60,"median":{"warmth":"chaud"},"spread":{}}',
  ]) {
    store.set("juno-look-profile", mauvais);
    expect(readLook()).toBeUndefined();
  }
});
it("trop peu de photos livrées : rien n'est visé, et c'est dit", () => {
  const maigre = learnLookFromImages(dossier(MIN_LOOK_SAMPLES - 1));
  expect(describeLook(maigre)).toContain("il en faut au moins");
  expect(aimForLook(maigre.median, maigre)).toEqual({});
});
it("le rendu est décrit en français, sans jargon", () => {
  const chaud = learnLookFromImages(dossier(60, 200, 140, 95));
  expect(describeLook(chaud)).toMatch(/rendu chaud/);
  expect(describeLook(chaud)).toContain("Mariages livrés");
  expect(describeLook(undefined)).toContain("Aucun rendu appris");
});
it("une image tronquée est ignorée sans faire tomber la lecture", () => {
  const casse = { width: 24, height: 24, bgra: new Uint8Array(8) };
  const melange = {
    nom: "mélange",
    images: [...dossier(60).images, casse],
  };
  expect(learnLookFromImages(melange).samples).toBe(60);
});
