import { it, expect } from "vitest";
import {
  maskAt,
  maskCorner,
  maskPixels,
  maskAmount,
  removeMaskKey,
  retimeMask,
  retimeMasks,
  setMaskKey,
} from "../src/video/masks";
import { split, trim } from "../src/video/edit";
import type { Clip, Mask, Sequence } from "../src/video/types";
const mask: Mask = {
  id: "m",
  effect: "blur",
  shape: "ellipse",
  width: 0.2,
  height: 0.3,
  strength: 0.5,
  feather: 0.2,
  keys: [
    { frame: 0, x: 0.2, y: 0.5 },
    { frame: 20, x: 0.6, y: 0.5 },
  ],
};
it("a mask interpolates between its keys and holds the ends", () => {
  expect(maskAt(mask, 10).x).toBeCloseTo(0.4);
  expect(maskAt(mask, 0).x).toBe(0.2);
  expect(maskAt(mask, -5).x).toBe(0.2);
  expect(maskAt(mask, 50).x).toBe(0.6);
  expect(maskAt({ ...mask, keys: [] }, 3)).toEqual({
    frame: 3,
    x: 0.5,
    y: 0.5,
  });
});
it("posing a key replaces the one on that frame and rejects an impossible one", () => {
  const next = setMaskKey(mask, 10, 0.3, 0.7);
  expect(next.keys).toHaveLength(3);
  expect(next.keys[1]).toEqual({ frame: 10, x: 0.3, y: 0.7 });
  expect(setMaskKey(next, 10, 0.9, 0.9).keys).toHaveLength(3);
  expect(mask.keys).toHaveLength(2);
  expect(() => setMaskKey(mask, -1, 0.5, 0.5)).toThrow();
  expect(() => setMaskKey(mask, 1.5, 0.5, 0.5)).toThrow();
  // Keys stay ordered whatever the order they were posed in.
  const scattered = setMaskKey(setMaskKey(mask, 15, 0.5, 0.5), 5, 0.4, 0.4);
  expect(scattered.keys.map((k) => k.frame)).toEqual([0, 5, 15, 20]);
});
it("a mask never loses its last key", () => {
  expect(removeMaskKey(mask, 0).keys).toHaveLength(1);
  const single = { ...mask, keys: [mask.keys[0]] };
  expect(removeMaskKey(single, 0).keys).toHaveLength(1);
});
it("retiming follows a trim, a speed change and never leaves the clip", () => {
  expect(retimeMask(mask, 10).keys.map((k) => k.frame)).toEqual([0, 10]);
  expect(retimeMask(mask, 0, 2).keys.map((k) => k.frame)).toEqual([0, 40]);
  // A cut keeps the position seen at the new edge instead of a neighbour's.
  const shortened = retimeMask(mask, 0, 1, 10);
  expect(shortened.keys.map((k) => k.frame)).toEqual([0, 9]);
  expect(shortened.keys[1].x).toBeCloseTo(0.38);
  expect(retimeMask(mask, 10).keys[0].x).toBeCloseTo(0.4);
  const late = { ...mask, keys: [{ frame: 40, x: 0.9, y: 0.1 }] };
  const rescued = retimeMask(late, 0, 1, 10);
  expect(rescued.keys).toHaveLength(1);
  expect(rescued.keys[0].frame).toBe(9);
  expect(rescued.keys[0].x).toBe(0.9);
  expect(retimeMasks({ masks: undefined })).toBeUndefined();
});
it("geometry and corners stay even and inside the frame", () => {
  const s = { width: 1920, height: 1080 };
  expect(maskPixels(mask, s)).toEqual({ width: 384, height: 324 });
  expect(maskPixels({ ...mask, width: 0.0001, height: 3 }, s)).toEqual({
    width: 8,
    height: 1080,
  });
  expect(maskCorner(mask, { frame: 0, x: 0.5, y: 0.5 }, s)).toEqual({
    x: 768,
    y: 378,
  });
  const strong = maskAmount({ ...mask, strength: 1 }, s),
    weak = maskAmount({ ...mask, strength: 0 }, s);
  expect(strong.sigma).toBeGreaterThan(weak.sigma);
  expect(strong.block).toBeGreaterThan(weak.block);
});
const sequence: Sequence = {
  id: "s",
  name: "s",
  fps: { n: 25, d: 1 },
  width: 1920,
  height: 1080,
  clips: [],
  titles: [],
  captions: [],
  markers: [],
  masterGain: 1,
  created: 0,
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
  masks: [mask],
  grade: {
    exposure: 0,
    contrast: 1,
    saturation: 1,
    warmth: 0,
    tint: 0,
    fade: 0,
    style: "original",
    intensity: 1,
  },
};
it("cutting a clip keeps each half's mask inside its own duration", () => {
  const s = { ...sequence, clips: [clip] },
    cut = split(s, "c", 10);
  expect(cut.clips).toHaveLength(2);
  const [left, right] = cut.clips;
  for (const half of cut.clips)
    for (const m of half.masks!)
      for (const k of m.keys) expect(k.frame).toBeLessThan(half.duration);
  expect(left.masks![0].keys.map((k) => k.frame)).toEqual([0, 9]);
  expect(right.masks![0].keys.map((k) => k.frame)).toEqual([0, 10]);
  // Both halves keep the position the editor saw at the cut.
  expect(left.masks![0].keys[1].x).toBeCloseTo(0.38);
  expect(right.masks![0].keys[0].x).toBeCloseTo(0.4);
  expect(right.masks![0].keys[1].x).toBeCloseTo(0.6);
});
it("trimming a clip keeps its mask valid", () => {
  const s = { ...sequence, clips: [clip] },
    shortened = trim(s, "c", "end", 12);
  const only = shortened.clips[0];
  for (const m of only.masks!)
    for (const k of m.keys) expect(k.frame).toBeLessThan(only.duration);
});
