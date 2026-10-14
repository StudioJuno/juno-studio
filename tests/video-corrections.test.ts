// Corrections du studio vidéo (audit du 29/09/2026) : ce que le montage
// produit doit toujours pouvoir s'enregistrer, et rester à l'image près.
import { it, expect } from "vitest";
import { createRequire } from "node:module";
import {
  addClip,
  BASE_GRADE,
  closeGap,
  fitTransitions,
  removeSilence,
  sourceMicros,
  split,
  trackFor,
  trim,
  TRANSITION_MAX,
} from "../src/video/edit";
import { adoptTracked, maskPixels } from "../src/video/masks";
import { changeDefinition } from "../src/video/transform";
import { clipCaptions } from "../src/video/caption-timing";
import type { Asset, Clip, Sequence } from "../src/video/types";
const native = createRequire(import.meta.url);
const M = native("../electron/video/model.cjs"),
  T = native("../electron/video/transitions.cjs"),
  MASKS = native("../electron/video/masks.cjs");
const sequence = (o: Partial<Sequence> = {}): Sequence => ({
  id: "s",
  name: "test",
  width: 1920,
  height: 1080,
  fps: { n: 25, d: 1 },
  masterGain: 1,
  clips: [],
  titles: [],
  captions: [],
  markers: [],
  created: 1,
  ...o,
});
const asset = (o: Partial<Asset> = {}): Asset =>
  ({
    id: "a",
    name: "rush.mov",
    kind: "video",
    size: 1,
    duration: 3,
    width: 1920,
    height: 1080,
    fps: { n: 25, d: 1 },
    audioChannels: 0,
    ...o,
  }) as Asset;
const valid = (s: Sequence, assets: Asset[]) =>
  M.validateSequence(s, new Map(assets.map((a) => [a.id, a])));
it("une coupe en 29,97 ne place jamais le point source après l'instant de l'image", () => {
  const s = sequence({ fps: { n: 30000, d: 1001 } });
  for (let f = 1; f < 2000; f++) {
    const exact = ((f * 1001) / 30000) * 1e6;
    const us = sourceMicros(f, s);
    expect(us).toBeLessThanOrEqual(exact + 1e-6);
    expect(exact - us).toBeLessThan(1);
  }
  // L'image 37 : 1 234 566,67 µs. L'ancien arrondi donnait 1 234 567, trop tard.
  const a = asset({ duration: 20 });
  let t = addClip(s, a, 0);
  t = split(t, t.clips[0].id, 37);
  expect(t.clips[1].inUs).toBe(1234566);
});
it("la transition d'entrée suit la coupe et le rognage au lieu de bloquer l'enregistrement", () => {
  const a = asset();
  const base = addClip(sequence(), a, 0);
  const c = base.clips[0];
  const s = {
    ...base,
    clips: [{ ...c, transition: { kind: "fadeblack", duration: 25 } }],
  };
  // Coupe à l'image 10 : la moitié gauche garde une transition de 10 images,
  // la droite n'en a plus (pas de fondu au milieu d'une prise continue).
  const cut = split(s, c.id, 10);
  expect(cut.clips.map((x) => x.transition?.duration ?? null)).toEqual([
    10,
    null,
  ]);
  expect(() => valid(cut, [a])).not.toThrow();
  // Coupe tardive : la gauche garde sa transition entière.
  const late = split(s, c.id, 60);
  expect(late.clips.map((x) => x.transition?.duration ?? null)).toEqual([
    25,
    null,
  ]);
  expect(() => valid(late, [a])).not.toThrow();
  // Rognage de fin à 20 images, puis de début jusqu'à ne garder que 5 images.
  const short = trim(s, c.id, "end", 20);
  expect(short.clips[0].transition?.duration).toBe(20);
  expect(() => valid(short, [a])).not.toThrow();
  const head = trim(short, c.id, "start", 15);
  expect(head.clips[0].duration).toBe(5);
  expect(head.clips[0].transition?.duration).toBe(5);
  expect(() => valid(head, [a])).not.toThrow();
});
it("un changement de vitesse ou de cadence ne laisse aucune transition plus longue que son plan", () => {
  const a = asset({ duration: 10 });
  const base = addClip(sequence(), a, 0);
  const c = base.clips[0];
  // Ce que fait la vitesse ×4 : la durée est divisée, la transition non.
  const fast = {
    ...base,
    clips: [
      {
        ...c,
        speed: 4,
        duration: 60,
        transition: { kind: "fade", duration: 200 },
      },
    ],
  };
  expect(() => valid(fast, [a])).toThrow(/transition/);
  const fitted = fitTransitions(fast);
  expect(fitted.clips[0].transition?.duration).toBe(60);
  expect(() => valid(fitted, [a])).not.toThrow();
  // Rien à reprendre : la même séquence revient, sans copie.
  expect(fitTransitions(fitted)).toBe(fitted);
  expect(TRANSITION_MAX).toBe(T.MAX_FRAMES);
});
it("un son lâché sur V1 va sur A1, une vidéo lâchée sur une piste son va sur la piste image", () => {
  const son = asset({ id: "w", kind: "audio", duration: 2, audioChannels: 2 });
  expect(trackFor(son, 0)).toBe(10);
  expect(trackFor(son, 1)).toBe(11);
  expect(trackFor(son, 12)).toBe(12);
  const s8 = addClip(sequence(), son, 0, 0);
  expect(s8.clips.map((c) => [c.track, c.component])).toEqual([[10, "audio"]]);
  expect(() => valid(s8, [son])).not.toThrow();
  // Une vidéo avec son lâchée sur A2 : l'image va sur V2, son son sur A2.
  const film = asset({ id: "v", audioChannels: 2 });
  const s = addClip(sequence(), film, 0, 11);
  expect(s.clips.map((c) => [c.track, c.component])).toEqual([
    [1, "video"],
    [11, "audio"],
  ]);
  expect(() => valid(s, [film])).not.toThrow();
  const photo = asset({ id: "p", kind: "image" });
  expect(addClip(sequence(), photo, 0, 10).clips[0].track).toBe(0);
});
it("passer une séquence 4K en Full HD ou en carré garde les titres enregistrables", () => {
  const s = sequence({
    width: 3840,
    height: 2160,
    titles: [
      {
        id: "t",
        text: "Save the date",
        start: 0,
        duration: 50,
        size: 700,
        y: 0.5,
        color: "#ffffff",
        strokeWidth: 20,
        padding: 120,
      },
    ],
    captions: [
      {
        id: "c",
        text: "Bonjour",
        start: 0,
        duration: 25,
        style: { size: 600 },
      },
    ],
    captionStyle: { size: 900 },
  });
  expect(() => valid(s, [])).not.toThrow();
  expect(() => valid({ ...s, width: 1920, height: 1080 }, [])).toThrow(
    /Taille titre/,
  );
  const hd = changeDefinition(s, 1920, 1080);
  expect(hd.titles[0].size).toBe(350);
  expect(hd.titles[0].strokeWidth).toBe(10);
  expect(hd.titles[0].padding).toBe(60);
  expect(hd.captions[0].style?.size).toBe(300);
  expect(hd.captionStyle?.size).toBe(450);
  expect(() => valid(hd, [])).not.toThrow();
  const carre = changeDefinition(s, 1080, 1080);
  expect(carre.titles[0].size).toBe(350);
  expect(() => valid(carre, [])).not.toThrow();
  // Le plafond de la nouvelle hauteur reste respecté même depuis la 6K.
  const six = changeDefinition({ ...s, width: 6144, height: 3456 }, 1920, 1080);
  expect(six.titles[0].size).toBeLessThanOrEqual(540);
  expect(changeDefinition(s, 3840, 2160)).toBe(s);
});
it("retirer les blancs décale sous-titres, titres et marqueurs avec le discours", () => {
  const voice = asset({
    id: "v",
    duration: 14,
    audioChannels: 2,
    analysis: {
      scenes: [],
      silences: [{ start: 4, end: 9 }],
      brightness: 0,
      clipped: 0,
    },
  });
  let s = addClip(sequence(), voice, 0);
  const clip = s.clips.find((c) => c.component === "video")!;
  const segments = [
    {
      start: 0.5,
      end: 3.8,
      text: "Première phrase.",
      words: [
        { start: 0.5, end: 1.5, text: "Première" },
        { start: 1.6, end: 3.8, text: "phrase." },
      ],
    },
    { start: 9.2, end: 12.5, text: "Deuxième phrase." },
  ];
  s = {
    ...s,
    captions: clipCaptions(segments, clip, s),
    titles: [
      { id: "t", text: "Fin", start: 240, duration: 50, size: 60, y: 0.5, color: "#ffffff" },
      { id: "u", text: "Pendant le blanc", start: 130, duration: 40, size: 60, y: 0.5, color: "#ffffff" },
    ],
    markers: [
      { id: "m", frame: 250, text: "fin de la deuxième phrase" },
      { id: "n", frame: 150, text: "dans le blanc" },
    ],
  };
  const r = removeSilence(s, clip.id, [voice]);
  expect(r.cuts).toBe(1);
  const gap = r.removed;
  expect(gap).toBeGreaterThan(100);
  const second = r.sequence.clips
    .filter((c) => c.component === "video")
    .sort((a, b) => a.start - b.start)[1];
  // Le sous-titre commence là où la deuxième phrase s'entend désormais.
  const heard = Math.round(second.start + (9.2 - second.inUs / 1e6) * 25);
  const [first, deux] = r.sequence.captions;
  expect(first.start).toBe(s.captions[0].start);
  expect(first.words).toEqual(s.captions[0].words);
  expect(Math.abs(deux.start - heard)).toBeLessThanOrEqual(1);
  expect(deux.duration).toBe(s.captions[1].duration);
  // Rien ne dépasse plus la fin du montage.
  const end = Math.max(...r.sequence.clips.map((c) => c.start + c.duration));
  expect(deux.start + deux.duration).toBeLessThanOrEqual(end);
  // Le blanc retiré va de l'image 104 à l'image 221 (4,15 s à 8,85 s, marge
  // comprise). Le marqueur qui y tombait est ramené au bord, le titre qui y
  // était en entier disparaît, celui d'après avance d'autant.
  expect(gap).toBe(117);
  expect(r.sequence.markers.map((m) => m.frame)).toEqual([250 - gap, 104]);
  expect(r.sequence.titles.map((t) => [t.id, t.start])).toEqual([
    ["t", 240 - gap],
  ]);
  expect(() => valid(r.sequence, [voice])).not.toThrow();
});
it("refermer un trou raccourcit ce qui le chevauche et retire ce qu'il contient", () => {
  const s = sequence({
    titles: [
      { id: "a", text: "avant", start: 0, duration: 10, size: 60, y: 0.5, color: "#ffffff" },
      { id: "b", text: "à cheval", start: 15, duration: 20, size: 60, y: 0.5, color: "#ffffff" },
      { id: "c", text: "dedans", start: 22, duration: 5, size: 60, y: 0.5, color: "#ffffff" },
    ],
    captions: [
      {
        id: "d",
        text: "un deux trois",
        start: 18,
        duration: 20,
        words: [
          { start: 0, end: 2, from: 0, to: 2 },
          { start: 3, end: 8, from: 3, to: 7 },
          { start: 14, end: 20, from: 8, to: 13 },
        ],
      },
    ],
    markers: [
      { id: "m", frame: 25, text: "dans le trou" },
      { id: "n", frame: 40, text: "après" },
    ],
  });
  const t = closeGap(s, 20, 10);
  expect(t.titles.map((x) => [x.id, x.start, x.duration])).toEqual([
    ["a", 0, 10],
    ["b", 15, 10],
  ]);
  // Le sous-titre perd les dix images du trou, et son deuxième mot, qui y était.
  expect(t.captions[0]).toMatchObject({ start: 18, duration: 10 });
  expect(t.captions[0].words).toEqual([
    { start: 0, end: 2, from: 0, to: 2 },
    { start: 4, end: 10, from: 8, to: 13 },
  ]);
  expect(t.markers.map((m) => m.frame)).toEqual([20, 30]);
  expect(() => valid(t, [])).not.toThrow();
});
it("un suivi terminé pendant une retouche rejoint la retouche au lieu de la faire refuser", () => {
  const mask = {
    id: "m",
    effect: "blur" as const,
    shape: "ellipse" as const,
    width: 0.2,
    height: 0.2,
    strength: 0.5,
    feather: 0.2,
    keys: [{ frame: 0, x: 0.5, y: 0.5 }],
  };
  const clip: Clip = {
    id: "c",
    assetId: "a",
    start: 0,
    duration: 50,
    inUs: 0,
    track: 0,
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
    grade: { ...BASE_GRADE },
    masks: [mask],
  };
  const stored = sequence({
    version: 3,
    clips: [
      {
        ...clip,
        masks: [
          {
            ...mask,
            keys: [
              { frame: 0, x: 0.5, y: 0.5 },
              { frame: 49, x: 0.7, y: 0.4 },
            ],
            tracked: { asset: "a", from: 0, to: 49 },
          },
        ],
      },
    ],
  });
  // La retouche faite pendant le suivi : opacité et rognage à 30 images.
  const local = sequence({
    version: 2,
    clips: [{ ...clip, opacity: 0.5, duration: 30 }],
  });
  const merged = adoptTracked(local, stored)!;
  expect(merged.clips[0].opacity).toBe(0.5);
  expect(merged.clips[0].duration).toBe(30);
  expect(merged.clips[0].masks?.[0].tracked).toEqual({ asset: "a", from: 0, to: 49 });
  const keys = merged.clips[0].masks![0].keys;
  expect(keys.at(-1)!.frame).toBe(29);
  expect(keys.at(-1)!.x).toBeCloseTo(0.5 + (0.2 * 29) / 49, 6);
  expect(() => valid(merged, [asset()])).not.toThrow();
  // Un conflit qui ne vient pas du suivi n'est pas maquillé.
  expect(adoptTracked(merged, stored)).toBeNull();
  expect(adoptTracked(local, sequence({ clips: [clip] }))).toBeNull();
});
it("le moniteur et l'export mesurent un masque dans le même repère", () => {
  const s = sequence({ width: 640, height: 360 });
  for (const [w, h] of [
    [0.2, 0.2],
    [0.013, 0.9],
    [1, 1],
  ]) {
    const m = { width: w, height: h };
    expect(MASKS.geometry(m, s.width, s.height)).toEqual(
      maskPixels(m as never, s),
    );
  }
});
