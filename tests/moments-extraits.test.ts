import { it, expect } from "vitest";
import { extraits, AVANT, APRES } from "../src/video/moments";
const m = (start: number, end: number) => ({ start, end, crete: -20, relief: 15 });
it("l'extrait commence avant le pic, pour montrer ce qui l'a provoqué", () => {
  const [e] = extraits([m(10, 12)], 60);
  expect(e.start).toBe(10 - AVANT);
  expect(e.end).toBe(12 + APRES);
});
it("un extrait ne déborde jamais du rush", () => {
  const r = extraits([m(1, 2), m(58.5, 59.8)], 60);
  expect(r[0].start).toBe(0);
  expect(r.at(-1)!.end).toBe(60);
});
it("deux extraits qui se chevauchent n'en font qu'un", () => {
  // Sans cela, la même seconde serait montée deux fois de suite.
  const r = extraits([m(10, 11), m(12, 13)], 60);
  expect(r).toEqual([{ start: 10 - AVANT, end: 13 + APRES }]);
});
it("des moments éloignés restent des plans distincts, dans l'ordre", () => {
  const r = extraits([m(40, 41), m(10, 11)], 60);
  expect(r).toHaveLength(2);
  expect(r[0].start).toBeLessThan(r[1].start);
});
it("rien à monter sans moment", () => {
  expect(extraits([], 60)).toEqual([]);
});
