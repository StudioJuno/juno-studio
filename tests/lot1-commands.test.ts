import { it, expect } from "vitest";
import { parsePrompt } from "../src/assistant/commands";
import { applyVideoActions } from "../src/assistant/video-actions";
import type { Asset, Clip, Sequence } from "../src/video/types";
const seq = (clips: Clip[]): Sequence =>
  ({
    id: "s",
    name: "s",
    fps: { n: 25, d: 1 },
    width: 1920,
    height: 1080,
    clips,
    titles: [],
    captions: [],
    markers: [],
    masterGain: 1,
    created: 0,
  }) as unknown as Sequence;
const clip = (over: Partial<Clip> = {}): Clip =>
  ({
    id: "c1",
    assetId: "a",
    start: 0,
    duration: 500,
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
    grade: {},
    ...over,
  }) as unknown as Clip;
const asset: Asset = {
  id: "a",
  name: "m.mov",
  kind: "video",
  duration: 20,
  audioChannels: 2,
  analysis: { scenes: [], silences: [{ start: 4, end: 8 }] },
} as unknown as Asset;
const actions = (phrase: string) =>
  parsePrompt(phrase, "video").actions.filter((a) => a.kind.startsWith("video."));
it("les six fonctions du lot sont reconnues en français", () => {
  expect(actions("débruite ce plan")[0]).toEqual({
    kind: "video.denoise",
    level: "medium",
  });
  expect(actions("débruite fort")[0]).toMatchObject({ level: "strong" });
  expect(actions("stabilise ce plan à 80")[0]).toEqual({
    kind: "video.stabilise",
    strength: 0.8,
  });
  // « fondu » seul reste le fondu d'entrée du plan, comme avant.
  expect(actions("mets un fondu de 2 secondes")[0]).toMatchObject({
    kind: "video.fade",
  });
  expect(actions("mets un fondu enchaine de 2 secondes")[0]).toEqual({
    kind: "video.transition",
    transition: "dissolve",
    seconds: 2,
  });
  expect(actions("mets un volet")[0]).toMatchObject({ transition: "wipeleft" });
  expect(actions("ralenti fluide")[0]).toEqual({
    kind: "video.smoothslow",
    on: true,
  });
  expect(actions("baisse la musique sous la voix")[0]).toMatchObject({
    kind: "video.ducking",
    on: true,
  });
  expect(actions("retire les blancs")[0]).toMatchObject({
    kind: "video.silence",
  });
});
it("une transition demandée est réellement posée sur le plan", () => {
  const s = seq([clip()]);
  const out = applyVideoActions(
    s,
    actions("mets un cercle de 1 seconde"),
    ["c1"],
    0,
    [asset],
  );
  expect(out.clips[0].transition).toEqual({
    kind: "circleopen",
    duration: 25,
  });
});
it("une transition plus longue que le plan est refusée, pas tronquée", () => {
  const s = seq([clip({ duration: 10 })]);
  expect(() =>
    applyVideoActions(
      s,
      actions("mets une transition de 3 secondes"),
      ["c1"],
      0,
      [asset],
    ),
  ).toThrow(/plus longtemps que le plan/);
});
it("un ralenti fluide est refusé sur un plan qui ne ralentit pas", () => {
  const s = seq([clip({ speed: 1 })]);
  expect(() =>
    applyVideoActions(s, actions("ralenti fluide"), ["c1"], 0, [asset]),
  ).toThrow(/ralenti sous 1/);
  const lent = seq([clip({ speed: 0.5 })]);
  expect(
    applyVideoActions(lent, actions("ralenti fluide"), ["c1"], 0, [asset])
      .clips[0].smoothSlow,
  ).toBe(true);
});
it("ces retouches sont refusées sur une piste son", () => {
  const s = seq([clip({ track: 10, component: "audio" })]);
  for (const phrase of ["débruite", "stabilise", "mets une transition"])
    expect(() =>
      applyVideoActions(s, actions(phrase), ["c1"], 0, [asset]),
    ).toThrow(/plan vidéo/);
});
it("l'atténuation refuse de s'activer sans un seul plan de voix", () => {
  const s = seq([clip({ track: 10, component: "audio", audioRole: "music" })]);
  expect(() =>
    applyVideoActions(s, actions("baisse la musique"), ["c1"], 0, [asset]),
  ).toThrow(/Voix/);
  const avecVoix = seq([
    clip({ track: 10, component: "audio", audioRole: "music" }),
    clip({ id: "c2", track: 11, component: "audio", audioRole: "voice" }),
  ]);
  const out = applyVideoActions(avecVoix, actions("baisse la musique"), ["c1"], 0, [
    asset,
  ]);
  expect(out.ducking?.enabled).toBe(true);
});
it("retirer les blancs sans analyse le dit au lieu de ne rien faire", () => {
  const s = seq([clip({ track: 10, component: "audio" })]);
  const sansAnalyse = { ...asset, analysis: undefined } as unknown as Asset;
  expect(() =>
    applyVideoActions(s, actions("retire les blancs"), ["c1"], 0, [
      sansAnalyse,
    ]),
  ).toThrow(/Analysez le média/);
});
