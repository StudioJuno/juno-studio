import { expect, it } from "vitest";
import {
  addKey,
  animatedClip,
  retimeAnimation,
  valueAt,
} from "../src/video/animation";
import { addClip, split, trim } from "../src/video/edit";
import { applyVideoActions } from "../src/assistant/video-actions";
import { parsePrompt } from "../src/assistant/commands";
import type { Asset, Sequence } from "../src/video/types";
const asset = { id: "a", kind: "video", duration: 10 } as Asset;
const base = {
  id: "s",
  name: "Animation",
  fps: { n: 25, d: 1 },
  width: 1920,
  height: 1080,
  clips: [],
  titles: [],
  captions: [],
  markers: [],
  masterGain: 1,
  created: 1,
} as Sequence;
it("uses smooth, hold and linear interpolation with bounded manual keys", () => {
  const c = addClip(base, asset).clips[0];
  let next = addKey(c, "x", 0, -0.5, "smooth");
  next = addKey(next, "x", 100, 0.5);
  expect(animatedClip(next, 50).x).toBeCloseTo(0);
  expect(animatedClip(next, 25).x).toBeCloseTo(-0.34375);
  expect(
    valueAt(
      [
        { frame: 0, value: 0, easing: "hold" },
        { frame: 20, value: 1, easing: "linear" },
      ],
      19,
      0,
    ),
  ).toBe(0);
  expect(() => addKey(c, "x", 250, 0)).toThrow();
  expect(() => addKey(c, "gain", 20, 10)).toThrow();
});
it("preserves motion through split, trim, speed changes and undo-compatible documents", () => {
  const s = addClip(base, asset),
    c = s.clips[0];
  s.clips[0] = addKey(addKey(c, "x", 0, -0.5), "x", 200, 0.5);
  const cut = split(s, c.id, 100),
    right = cut.clips[1];
  expect(animatedClip(right, 150).x).toBeCloseTo(
    animatedClip(s.clips[0], 150).x,
  );
  const trimmed = trim(s, c.id, "start", 50);
  expect(animatedClip(trimmed.clips[0], 100).x).toBeCloseTo(
    animatedClip(s.clips[0], 100).x,
  );
  const sped = applyVideoActions(
    s,
    [{ kind: "video.adjust", field: "speed", value: 2, relative: false }],
    [c.id],
    0,
    [asset],
  );
  expect(animatedClip(sped.clips[0], 50).x).toBeCloseTo(
    animatedClip(s.clips[0], 100).x,
  );
  expect(retimeAnimation(undefined)).toBeUndefined();
});
it("text animation creates ordinary editable keyframes and rejects an overlong movement atomically", () => {
  const s = addClip(base, asset);
  const action = parsePrompt(
    "Anime la position horizontale de -20 à 20 sur 2 secondes",
    "video",
  ).actions[0];
  expect(action.kind).toBe("video.animate");
  if (action.kind !== "video.animate") return;
  const next = applyVideoActions(s, [action], [s.clips[0].id], 25, [asset]);
  expect(next.clips[0].animation!.x).toEqual([
    { frame: 25, value: -0.2, easing: "smooth" },
    { frame: 75, value: 0.2, easing: "linear" },
  ]);
  expect(() =>
    applyVideoActions(s, [{ ...action, seconds: 20 }], [s.clips[0].id], 0, [
      asset,
    ]),
  ).toThrow();
  expect(s.clips[0].animation).toBeUndefined();
});
it("adjusting an animated gain edits the current key instead of an inaudible static setting", () => {
  const audio = {...asset,kind:"audio" as const,audioChannels:2};
  const s = addClip(base, audio),
    c = s.clips[0];
  s.clips[0] = addKey(addKey(c, "gain", 0, 0.25), "gain", 100, 1);
  const next = applyVideoActions(
    s,
    [{ kind: "video.adjust", field: "gain", value: -6, relative: false }],
    [c.id],
    50,
    [asset],
  );
  expect(next.clips[0].animation!.gain).toHaveLength(3);
  expect(animatedClip(next.clips[0], 50).gain).toBeCloseTo(
    Math.pow(10, -6 / 20),
  );
  expect(animatedClip(next.clips[0], 100).gain).toBe(1);
});
