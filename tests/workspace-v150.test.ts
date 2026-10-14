import { expect, it } from "vitest";
import { readLayout } from "../src/workbench/WorkspaceLayout";
import {
  correctTranscript,
  correctCaptionWord,
  captionIssues,
} from "../src/video/transcript-correction";
import { audioMix } from "../src/video/audio-mix";
import { createRequire } from "node:module";
import { BASE_GRADE } from "../src/video/edit";
const native = createRequire(import.meta.url)(
  "../electron/video/audio-mix.cjs",
);
it("restores malformed layouts and clamps panel dimensions", () => {
  expect(readLayout("{")).toEqual(readLayout(null));
  expect(
    readLayout('{"inspectorWidth":900,"libraryWidth":-100,"focus":"yes"}'),
  ).toMatchObject({ inspectorWidth: 480, libraryWidth: 240, focus: false });
});
it("word corrections keep measured times only with an exact word mapping", () => {
  const s = {
    start: 1,
    end: 3,
    text: "Bonjour Juno",
    words: [
      { start: 1, end: 1.5, text: "Bonjour", confidence: 0.95 },
      { start: 2, end: 3, text: "Juno", confidence: 0.4 },
    ],
  };
  expect(correctTranscript(s, "Bonjour Jules").words).toEqual([
    { start: 1, end: 1.5, text: "Bonjour", confidence: 0.95 },
    { start: 2, end: 3, text: "Jules" },
  ]);
  expect(correctTranscript(s, "Bonjour à Juno").words).toBeUndefined();
  const c = {
    id: "a",
    text: "Bonjour Juno !",
    start: 25,
    duration: 50,
    words: [
      { start: 0, end: 12, from: 0, to: 7 },
      { start: 20, end: 35, from: 8, to: 12 },
      { start: 36, end: 40, from: 13, to: 14 },
    ],
    size: 40,
    y: 0.8,
    color: "#fff",
  };
  expect(correctCaptionWord(c, 1, "Jules")).toMatchObject({
    text: "Bonjour Jules !",
    words: [
      { start: 0, end: 12, from: 0, to: 7 },
      { start: 20, end: 35, from: 8, to: 13 },
      { start: 36, end: 40, from: 14, to: 15 },
    ],
  });
  expect(correctCaptionWord(c, 1, "deux mots")).toBe(c);
  expect(
    captionIssues(
      { ...c, text: "A".repeat(70), duration: 12 },
      { n: 25, d: 1 },
    ),
  ).toHaveLength(2);
});
it("monitor and export use identical routing for solo, mute, buses, volume and stereo pan", () => {
  const s: import("../src/video/types").Sequence = {
    id: "s",
    name: "audio",
    width: 320,
    height: 180,
    fps: { n: 25, d: 1 },
    masterGain: 1,
    clips: [],
    titles: [],
    captions: [],
    markers: [],
    created: 1,
  };
  const c = {
    id: "a",
    assetId: "b",
    start: 0,
    duration: 50,
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
    grade: BASE_GRADE,
  };
  for (const solo of [false, true])
    for (const muted of [false, true])
      for (const pan of [-1, -0.5, 0, 0.5, 1]) {
        const seq = {
          ...s,
          tracks: {
            10: { bus: "voice" as const, gain: 0.5, pan },
            11: { solo },
          },
          buses: { voice: { gain: 0.5, solo, muted } },
        };
        expect(audioMix(seq, c)).toEqual(native.audioMix(seq, c));
      }
  expect(
    audioMix(
      {
        ...s,
        tracks: { 10: { bus: "music", gain: 0.5 } },
        buses: { music: { gain: 0.5, solo: true } },
      },
      c,
    ),
  ).toMatchObject({ gain: 0.25, audible: true });
});
