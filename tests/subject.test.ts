import { it, expect } from "vitest";
import { maskAt, subjectCoverage, type SubjectMask } from "../src/modules/subject";
import { applyLocalEdits } from "../src/modules/local-edits";
import type { LocalEdit } from "../src/model";
/** Un masque : sujet à gauche, fond à droite, avec une transition douce. */
const masque = (w = 8, h = 8): SubjectMask => {
  const data = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      data[y * w + x] = x < w / 2 ? 255 : x === w / 2 ? 128 : 0;
  return { width: w, height: h, data };
};
it("le masque se lit à l'échelle de l'image retouchée", () => {
  const m = masque(8, 8);
  // Le masque fait 8 px, l'image 800 : l'échelle est refaite à la lecture.
  expect(maskAt(m, 10, 10, 800, 800)).toBe(1);
  expect(maskAt(m, 790, 10, 800, 800)).toBe(0);
  // La transition n'est ni 0 ni 1 : c'est ce qui sauve les cheveux.
  expect(maskAt(m, 410, 10, 800, 800)).toBeCloseTo(128 / 255, 2);
  // Des dimensions absurdes ne font pas tomber la lecture.
  expect(maskAt(m, 0, 0, 0, 0)).toBe(0);
  expect(maskAt({ width: 0, height: 0, data: new Uint8ClampedArray() }, 0, 0, 10, 10)).toBe(0);
});
it("la part occupée par le sujet est mesurable", () => {
  expect(subjectCoverage(masque())).toBeCloseTo(0.53, 1);
  const vide = { width: 4, height: 4, data: new Uint8ClampedArray(16) };
  expect(subjectCoverage(vide)).toBe(0);
  expect(subjectCoverage({ width: 0, height: 0, data: new Uint8ClampedArray() })).toBe(0);
});
const edit = (over: Partial<LocalEdit> = {}): LocalEdit => ({
  id: "e",
  name: "Sujet détouré",
  tool: "subject",
  points: [],
  radius: 0,
  amount: 1,
  opacity: 1,
  visible: true,
  ...over,
});
/** Une image grise unie, en RGBA. */
const grise = (w = 8, h = 8, v = 100) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  return d;
};
it("la retouche éclaircit le sujet et laisse le fond intact", () => {
  const d = grise();
  applyLocalEdits(d, 8, 8, [edit({ amount: 1 })], masque());
  // À gauche, le sujet : un diaphragme de plus, donc le double.
  expect(d[0]).toBe(200);
  // À droite, le fond : rien n'a bougé.
  expect(d[(7 * 8 + 7) * 4]).toBe(100);
});
it("l'inversion agit sur le fond, pas sur le sujet", () => {
  const d = grise();
  applyLocalEdits(d, 8, 8, [edit({ amount: -1, invert: true })], masque());
  expect(d[0]).toBe(100);
  expect(d[(7 * 8 + 7) * 4]).toBe(50);
});
it("sans masque, une retouche de sujet ne fait rien", () => {
  // Le détourage n'a peut-être jamais été lancé sur cette photo.
  const d = grise();
  applyLocalEdits(d, 8, 8, [edit({ amount: 2 })]);
  expect([...d.slice(0, 3)]).toEqual([100, 100, 100]);
});
it("une retouche cachée, muette ou sans effet ne coûte rien", () => {
  for (const modif of [{ visible: false }, { opacity: 0 }, { amount: 0 }]) {
    const d = grise();
    applyLocalEdits(d, 8, 8, [edit(modif)], masque());
    expect(d[0]).toBe(100);
  }
});
it("l'opacité dose la retouche au lieu de la subir", () => {
  const d = grise();
  applyLocalEdits(d, 8, 8, [edit({ amount: 1, opacity: 0.5 })], masque());
  // Moitié de la correction sur un pixel plein sujet : 100 -> 150.
  expect(d[0]).toBe(150);
});
import { cachedSubjectMask, forgetSubjectMasks } from "../src/modules/subject";
it("le masque n'est cherché en mémoire que pour les mêmes points", () => {
  // Ce qui est enregistré dans le catalogue, c'est le point désigné :
  // deux points différents ne doivent jamais partager un masque.
  forgetSubjectMasks();
  expect(cachedSubjectMask("p1", [[0.5, 0.5]])).toBeUndefined();
  expect(cachedSubjectMask("p1", [])).toBeUndefined();
});
