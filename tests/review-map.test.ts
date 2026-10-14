import { describe, it, expect } from "vitest";
import { mapReviewFrame } from "../src/review/map-frame";
import type { Sequence, Clip } from "../src/video/types";
const clip = (changes: Partial<Clip> = {}) =>
  ({
    id: "a",
    assetId: "camera",
    start: 0,
    duration: 100,
    inUs: 0,
    speed: 1,
    track: 0,
    ...changes,
  }) as Clip;
const sequence = (clips: Clip[], fps = { n: 25, d: 1 }) =>
  ({ clips, fps }) as Sequence;
describe("published review frame mapping", () => {
  it("keeps a frame when only colour settings changed", () => {
    const before = sequence([clip()]);
    const after = sequence([clip({ gain: 0.5 })]);
    expect(mapReviewFrame(before, after, 35)).toBe(35);
  });
  it("maps source time after a trim and move", () => {
    expect(
      mapReviewFrame(
        sequence([clip()]),
        sequence([clip({ start: 50, inUs: 400000, duration: 80 })]),
        35,
      ),
    ).toBe(75);
  });
  it("accounts for source speed and rational project rate", () => {
    expect(
      mapReviewFrame(
        sequence([clip()], { n: 30000, d: 1001 }),
        sequence([clip({ start: 10, speed: 2 })], { n: 30000, d: 1001 }),
        40,
      ),
    ).toBe(30);
  });
  it("refuses ambiguous multicam, repeated footage and deleted passages", () => {
    expect(
      mapReviewFrame(
        sequence([clip(), clip({ id: "b", track: 1 })]),
        sequence([clip({ start: 10 })]),
        20,
      ),
    ).toBeNull();
    expect(
      mapReviewFrame(
        sequence([clip()]),
        sequence([clip({ id: "b" }), clip({ id: "c", start: 100 })]),
        20,
      ),
    ).toBeNull();
    expect(mapReviewFrame(sequence([clip()]), sequence([]), 20)).toBeNull();
  });
});
