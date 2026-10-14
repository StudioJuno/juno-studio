import { it, expect } from "vitest";
import {
  addClip,
  expandAV,
  split,
  trim,
  moveClip,
  remove,
  unlink,
  audioAudible,
} from "../src/video/edit";
import type { Sequence, Asset } from "../src/video/types";
const s = (): Sequence => ({
  id: "s",
  name: "Film",
  width: 1920,
  height: 1080,
  fps: { n: 25, d: 1 },
  masterGain: 1,
  clips: [],
  titles: [],
  captions: [],
  markers: [],
  created: 1,
});
const asset = {
  id: "a",
  kind: "video",
  duration: 10,
  audioChannels: 2,
} as Asset;
it("imports separate linked picture/sound and migration is idempotent", () => {
  const n = addClip(s(), asset);
  expect(n.clips.map((c) => c.component)).toEqual(["video", "audio"]);
  expect(n.clips.map((c) => c.track)).toEqual([0, 10]);
  expect(n.clips[0].linkId).toBe(n.clips[1].linkId);
  expect(expandAV(n, [asset])).toBe(n);
});
it("split, movement and deletion preserve linked synchronization", () => {
  const n = addClip(s(), asset);
  const cut = split(n, n.clips[0].id, 100);
  expect(cut.clips.map((c) => c.duration)).toEqual([100, 150, 100, 150]);
  const right = cut.clips[1];
  expect(right.linkId).toBe(cut.clips[3].linkId);
  expect(right.linkId).not.toBe(cut.clips[0].linkId);
  const moved = moveClip(cut, right.id, 130);
  expect(moved.clips[3].start).toBe(130);
  expect(remove(moved, right.id).clips).toHaveLength(2);
  expect(n.clips[0].duration).toBe(250);
});
it("linked trim uses the strictest source boundary", () => {
  const n = addClip(s(), asset, 50);
  n.clips[0].inUs = 2e6;
  n.clips[1].inUs = 1e6;
  const t = trim(n, n.clips[0].id, "start", 0);
  expect(t.clips.map((c) => c.start)).toEqual([25, 25]);
  expect(t.clips.map((c) => c.inUs)).toEqual([1e6, 0]);
  expect(t.clips.map((c) => c.duration)).toEqual([275, 275]);
});
it("locking either track protects both components; unlink permits independent edits", () => {
  const n = addClip(s(), asset);
  n.tracks = { "10": { locked: true } };
  expect(moveClip(n, n.clips[0].id, 20)).toBe(n);
  expect(split(n, n.clips[0].id, 50)).toBe(n);
  expect(remove(n, n.clips[0].id)).toBe(n);
  const u = unlink(n, n.clips[0].id);
  expect(moveClip(u, u.clips[0].id, 20).clips.map((c) => c.start)).toEqual([
    20, 0,
  ]);
});
it("track mute and solo cannot accidentally play video-component sound", () => {
  const n = addClip(s(), asset);
  expect(audioAudible(n, n.clips[0])).toBe(false);
  expect(audioAudible(n, n.clips[1])).toBe(true);
  n.tracks = { "11": { solo: true } };
  expect(audioAudible(n, n.clips[1])).toBe(false);
  n.tracks["10"] = { solo: true };
  expect(audioAudible(n, n.clips[1])).toBe(true);
  n.tracks["10"].muted = true;
  expect(audioAudible(n, n.clips[1])).toBe(false);
});
