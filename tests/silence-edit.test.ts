import { it, expect } from "vitest";
import { silenceCuts, removeSilence, length } from "../src/video/edit";
import type { Asset, Clip, Sequence } from "../src/video/types";
const FPS = { n: 25, d: 1 };
const asset = (silences: { start: number; end: number }[]): Asset =>
  ({
    id: "a",
    name: "discours.mov",
    kind: "video",
    duration: 20,
    audioChannels: 2,
    analysis: { scenes: [], silences },
  }) as unknown as Asset;
const clip = (over: Partial<Clip> = {}): Clip =>
  ({
    id: "c1",
    assetId: "a",
    start: 0,
    duration: 500,
    inUs: 0,
    track: 10,
    speed: 1,
    gain: 1,
    muted: false,
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    fadeIn: 0,
    fadeOut: 0,
    audioRole: "voice",
    grade: {},
    ...over,
  }) as unknown as Clip;
const seq = (clips: Clip[]): Sequence =>
  ({
    id: "s",
    name: "s",
    fps: FPS,
    width: 1920,
    height: 1080,
    clips,
    titles: [],
    captions: [],
    markers: [],
    masterGain: 1,
    created: 0,
  }) as unknown as Sequence;
it("un silence est raccourci d'une marge de chaque côté", () => {
  // Silence de 5 s à 9 s, marge 0,15 s : on ne coupe que de 5,15 à 8,85.
  const cuts = silenceCuts(seq([clip()]), clip(), asset([{ start: 5, end: 9 }]));
  expect(cuts).toHaveLength(1);
  expect(cuts[0].start).toBe(129); // 5,15 s à 25 i/s
  expect(cuts[0].duration).toBe(Math.round(8.85 * 25) - 129);
});
it("un silence trop court pour valoir une coupe est ignoré", () => {
  const s = seq([clip()]);
  // 0,8 s de silence moins deux marges de 0,15 = 0,5 s, sous le seuil de 0,6.
  expect(silenceCuts(s, clip(), asset([{ start: 5, end: 5.8 }]))).toEqual([]);
  // Le seuil est réglable.
  expect(
    silenceCuts(s, clip(), asset([{ start: 5, end: 5.8 }]), {
      minSilence: 0.4,
    }),
  ).toHaveLength(1);
});
it("un média jamais analysé ne propose aucune coupe", () => {
  const s = seq([clip()]);
  expect(silenceCuts(s, clip(), undefined)).toEqual([]);
  expect(silenceCuts(s, clip(), asset([]))).toEqual([]);
});
it("un plan ralenti voit ses silences étirés d'autant", () => {
  const c = clip({ speed: 0.5, duration: 900 });
  const cuts = silenceCuts(seq([c]), c, asset([{ start: 5, end: 9 }]));
  // À demi-vitesse, 3,7 s de source occupent 7,4 s de montage.
  expect(cuts[0].duration).toBe(Math.round(3.7 * 2 * 25));
});
it("le point d'entrée décale les coupes, il ne les invente pas", () => {
  const c = clip({ inUs: 4e6, duration: 300 });
  const cuts = silenceCuts(seq([c]), c, asset([{ start: 5, end: 9 }]));
  // Le silence commence 1,15 s après le début du plan, pas 5,15 s.
  expect(cuts[0].start).toBe(Math.round(1.15 * 25));
  // Un silence situé avant le point d'entrée ne concerne pas ce plan.
  expect(silenceCuts(seq([c]), c, asset([{ start: 0, end: 3 }]))).toEqual([]);
});
it("retirer les silences raccourcit le montage d'exactement ce qui est coupé", () => {
  const c = clip();
  const s = seq([c]);
  const avant = length(s);
  const r = removeSilence(s, "c1", [
    asset([
      { start: 4, end: 7 },
      { start: 12, end: 16 },
    ]),
  ]);
  expect(r.cuts).toBe(2);
  expect(r.removed).toBeGreaterThan(0);
  expect(length(r.sequence)).toBe(avant - r.removed);
  // Le plan est découpé, et aucun trou ne reste entre les morceaux.
  const pieces = r.sequence.clips
    .filter((x) => x.track === 10)
    .sort((a, b) => a.start - b.start);
  expect(pieces.length).toBe(3);
  for (let i = 1; i < pieces.length; i++)
    expect(pieces[i].start).toBe(pieces[i - 1].start + pieces[i - 1].duration);
});
it("ce qui suit sur la piste est décalé, pas laissé en place", () => {
  const parole = clip(),
    suite = clip({ id: "c2", start: 500, duration: 100 });
  const r = removeSilence(seq([parole, suite]), "c1", [
    asset([{ start: 4, end: 7 }]),
  ]);
  const apres = r.sequence.clips.find((c) => c.id === "c2")!;
  expect(apres.start).toBe(500 - r.removed);
});
it("un plan sur une piste verrouillée n'est pas touché", () => {
  const s = { ...seq([clip()]), tracks: { 10: { locked: true } } } as Sequence;
  const r = removeSilence(s, "c1", [asset([{ start: 4, end: 7 }])]);
  expect(r.cuts).toBe(0);
  expect(r.sequence).toBe(s);
});
it("l'image liée au son suit la coupe", () => {
  const son = clip({ linkId: "av-1" }),
    image = clip({ id: "c1v", track: 0, linkId: "av-1" });
  const r = removeSilence(seq([son, image]), "c1", [
    asset([{ start: 4, end: 7 }]),
  ]);
  const morceauxSon = r.sequence.clips.filter((c) => c.track === 10),
    morceauxImage = r.sequence.clips.filter((c) => c.track === 0);
  // Les deux pistes sont découpées au même endroit et restent alignées.
  expect(morceauxSon.length).toBe(2);
  expect(morceauxImage.length).toBe(2);
  expect(morceauxImage.map((c) => c.start).sort((a, b) => a - b)).toEqual(
    morceauxSon.map((c) => c.start).sort((a, b) => a - b),
  );
});
