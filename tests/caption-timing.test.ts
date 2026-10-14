import { it, expect } from "vitest";
import { clipCaptions } from "../src/video/caption-timing";
import { captionRuns } from "../src/video/title-render";
import type { Sequence, Clip, Caption } from "../src/video/types";
const s = {
  width: 1920,
  height: 1080,
  fps: { n: 25, d: 1 },
  captionStyle: { wordMode: "highlight", effect: "pop" },
} as Sequence;
const c: Caption = {
  id: "caption",
  text: "Bonjour Juno",
  start: 50,
  duration: 50,
  words: [
    { start: 5, end: 15, from: 0, to: 7 },
    { start: 20, end: 40, from: 8, to: 12 },
  ],
};
it("keeps pauses unhighlighted and the original animation clock throughout word runs", () => {
  const runs = captionRuns(c, s);
  expect(runs.map((r) => [r.start, r.duration, !!r.highlight])).toEqual([
    [50, 5, false],
    [55, 10, true],
    [65, 5, false],
    [70, 20, true],
    [90, 10, false],
  ]);
  expect(runs.every((r) => r.motionOrigin === 50)).toBe(true);
  expect(runs[1].motion).toEqual(runs[3].motion);
  expect(runs[3].highlight).toEqual({ from: 8, to: 12, color: "#ffe45c" });
});
it("one-word mode leaves pauses transparent and old SRT captions remain readable", () => {
  const runs = captionRuns({ ...c, style: { wordMode: "single" } }, s);
  expect(runs.map((r) => r.text)).toEqual(["Bonjour", "Juno"]);
  expect(runs.map((r) => r.start)).toEqual([55, 70]);
  expect(captionRuns({ ...c, words: undefined }, s)).toHaveLength(1);
  expect(captionRuns({ ...c, words: undefined }, s)[0].text).toBe(c.text);
});
it("maps measured words through source trims and playback speed without inventing timing", () => {
  const clip = {
    id: "clip",
    start: 100,
    duration: 25,
    inUs: 1000000,
    speed: 2,
  } as Clip;
  const captions = clipCaptions(
    [
      {
        start: 0,
        end: 4,
        text: "Un deux trois",
        words: [
          { text: "Un", start: 0, end: 0.5 },
          { text: "deux", start: 1.2, end: 2 },
          { text: "trois", start: 2.5, end: 4 },
        ],
      },
    ],
    clip,
    s,
  );
  expect(captions[0].start).toBe(100);
  expect(captions[0].duration).toBe(25);
  expect(captions[0].words).toEqual([
    { start: 2, end: 13, from: 3, to: 7 },
    { start: 19, end: 25, from: 8, to: 13 },
  ]);
  expect(
    clipCaptions([{ start: 1, end: 2, text: "Sans repères" }], clip, s)[0]
      .words,
  ).toBeUndefined();
});
it("bounds intervals after fractional-frame rounding", () => {
  const captions = clipCaptions(
    [
      {
        start: 0,
        end: 0.15,
        text: "a b c",
        words: [
          { text: "a", start: 0, end: 0.01 },
          { text: "b", start: 0.01, end: 0.05 },
          { text: "c", start: 0.05, end: 0.15 },
        ],
      },
    ],
    { id: "c", start: 0, duration: 100, inUs: 0, speed: 1 } as Clip,
    { ...s, fps: { n: 30000, d: 1001 } },
  );
  let last = 0;
  for (const w of captions[0].words!) {
    expect(w.start).toBeGreaterThanOrEqual(last);
    expect(w.end).toBeGreaterThan(w.start);
    expect(w.end).toBeLessThanOrEqual(captions[0].duration);
    last = w.end;
  }
});
