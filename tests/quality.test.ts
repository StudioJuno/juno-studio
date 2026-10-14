import { it, expect } from "vitest";
import {
  ANALYSIS_WIDTH,
  comparableSharpness,
  contextScore,
  decisiveSharpness,
  regionSharpness,
  subjectRead,
  verdictFor,
} from "../src/modules/quality";
import { groupSuggestions } from "../src/modules/culling";
import { grouperRafales, noterRafale } from "../src/modules/rafales";
import type { Analysis, Photo } from "../src/model";
/** Les notes d'une rafale, comme le tri les calcule. */
const burstScores = (analyses: Analysis[], priority: string[] = []) =>
  noterRafale(analyses, priority).map((n) => n.total);
const base: Analysis = {
  brightness: 0.48,
  sharpness: 1200,
  sharpnessWidth: ANALYSIS_WIDTH,
  clipped: 0.01,
  dhash: "0".repeat(64),
  advice: "normal",
  reasons: [],
};
const face = (
  over: Partial<Analysis["faces"] extends infer _ ? any : never> = {},
) => ({
  region: { x: 0.4, y: 0.3, w: 0.2, h: 0.2 },
  weight: 0.04,
  sharpness: 900,
  eyesClosed: 0.05,
  smile: 0.4,
  turned: 0.1,
  ...over,
});
const withFace = (a: Partial<Analysis>, faces: any[]): Analysis => ({
  ...base,
  ...a,
  faces: {
    count: faces.length,
    closedEyes: 0,
    blink: 0,
    reads: faces,
    version: "t",
  },
});
it("sharpness is only comparable when measured finely enough", () => {
  expect(comparableSharpness(base)).toBe(true);
  expect(comparableSharpness({ ...base, sharpnessWidth: 128 })).toBe(false);
  expect(comparableSharpness({ ...base, sharpnessWidth: undefined })).toBe(
    false,
  );
  expect(comparableSharpness(undefined)).toBe(false);
  // A photo narrower than the target is already measured as finely as it can
  // be: demanding 1024 px would re-analyse it on every single pass.
  expect(comparableSharpness({ ...base, sharpnessWidth: 683 }, 683)).toBe(true);
  expect(comparableSharpness({ ...base, sharpnessWidth: 400 }, 683)).toBe(
    false,
  );
});
it("region sharpness reads the region, not the whole frame", () => {
  const w = 40,
    h = 40,
    gray = new Float32Array(w * h);
  // Left half is flat, right half alternates: only the right half has detail.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      gray[y * w + x] = x < 20 ? 128 : x % 2 ? 0 : 255;
  const left = regionSharpness(gray, w, h, { x: 0, y: 0, w: 0.45, h: 1 }),
    right = regionSharpness(gray, w, h, { x: 0.55, y: 0, w: 0.45, h: 1 });
  expect(left).toBeLessThan(1);
  expect(right).toBeGreaterThan(1000);
  // Without a region the whole frame is measured, so the flat half dilutes it.
  expect(regionSharpness(gray, w, h)).toBeLessThan(right);
});
it("the subject is the largest face, whatever the order", () => {
  const small = face({ weight: 0.01 }),
    big = face({ weight: 0.2 });
  expect(subjectRead([small, big])).toBe(big);
  expect(subjectRead([])).toBeUndefined();
  expect(subjectRead(undefined)).toBeUndefined();
});
it("the subject's sharpness decides, not the background", () => {
  // A frame sharp overall but with a blurred subject must lose.
  const blurredSubject = withFace({ sharpness: 4000 }, [
      face({ sharpness: 20 }),
    ]),
    sharpSubject = withFace({ sharpness: 400 }, [face({ sharpness: 900 })]);
  expect(decisiveSharpness(blurredSubject)).toBe(20);
  expect(decisiveSharpness(sharpSubject)).toBe(900);
  const [a, b] = burstScores([blurredSubject, sharpSubject]);
  expect(b).toBeGreaterThan(a);
});
it("closed eyes on the subject cost more than on a distant guest", () => {
  const subjectBlinks = withFace({}, [face({ weight: 0.25, eyesClosed: 0.9 })]),
    guestBlinks = withFace({}, [
      face({ weight: 0.25, eyesClosed: 0.02 }),
      face({ weight: 0.01, eyesClosed: 0.95 }),
    ]);
  expect(contextScore(subjectBlinks)).toBeLessThan(
    contextScore(guestBlinks) - 10,
  );
});
it("a smile helps and a turned head costs, without ever deciding alone", () => {
  const smiling = withFace({}, [face({ smile: 0.9, turned: 0 })]),
    profile = withFace({}, [face({ smile: 0, turned: 1 })]);
  expect(contextScore(smiling)).toBeGreaterThan(contextScore(profile));
  // Sharpness still dominates: a sharp profile beats a blurred smile.
  const [blurredSmile, sharpProfile] = burstScores([
    withFace({}, [face({ smile: 0.9, sharpness: 50 })]),
    withFace({}, [face({ smile: 0, turned: 1, sharpness: 900 })]),
  ]);
  expect(sharpProfile).toBeGreaterThan(blurredSmile);
});
it("two sharp frames still separate, where a log scale would saturate", () => {
  const a = withFace({}, [face({ sharpness: 1300 })]),
    b = withFace({}, [face({ sharpness: 650 })]);
  const [first, second] = burstScores([a, b]);
  // Twice as sharp is a full point ahead, as much as a blink costs.
  expect(first).toBeGreaterThan(second + 0.9);
});
it("a badly exposed frame is penalised, a deliberately dark one is not", () => {
  expect(contextScore({ ...base, brightness: 0.03 })).toBeLessThan(-20);
  expect(contextScore({ ...base, brightness: 0.2 })).toBe(contextScore(base));
  expect(contextScore({ ...base, clipped: 0.3 })).toBeLessThan(
    contextScore(base),
  );
});
it("an old analysis without per-face reads is still judged on its eye count", () => {
  // Catalogues analysed before 0.9.0 carry closedEyes but no reads.
  const legacy: Analysis = {
    ...base,
    faces: {
      count: 1,
      closedEyes: 1,
      blink: 0.9,
      version: "mediapipe-face-v2",
    },
  };
  const open: Analysis = {
    ...base,
    faces: { count: 1, closedEyes: 0, blink: 0, version: "mediapipe-face-v2" },
  };
  expect(contextScore(legacy)).toBeLessThan(contextScore(open) - 20);
  const [a, b] = burstScores([legacy, open]);
  expect(b).toBeGreaterThan(a);
  expect(verdictFor(legacy)).toMatch(/Yeux fermés/);
});
it("each photo gets a sentence naming the deciding cause", () => {
  expect(verdictFor(withFace({}, [face({ eyesClosed: 0.9 })]))).toMatch(
    /Yeux fermés/,
  );
  expect(verdictFor({ ...base, brightness: 0.02 })).toMatch(/presque noire/);
  expect(verdictFor({ ...base, brightness: 0.99 })).toMatch(/brûlée/);
  expect(verdictFor(withFace({}, [face({ sharpness: 2 })]))).toMatch(/flou/);
  expect(verdictFor(withFace({}, [face({ turned: 0.9 })]))).toMatch(/profil/);
  expect(verdictFor(withFace({}, [face({ smile: 0.8 })]))).toMatch(/souriant/);
  expect(verdictFor(base)).toMatch(/nette/);
});
const photo = (
  id: string,
  capturedAt: number,
  dhash: string,
  analysis: Partial<Analysis> = {},
): Photo =>
  ({
    id,
    projectId: "p",
    name: id,
    source: "",
    thumbnail: "",
    width: 6000,
    height: 4000,
    size: 1,
    hash: id,
    status: "pending",
    capturedAt,
    created: capturedAt,
    adjustments: {} as any,
    analysis: { ...base, dhash, ...analysis },
  }) as unknown as Photo;
it("a long burst is cut in slices of 2.5 s, as Aftershoot does", () => {
  // Forty frames at ten per second. Aftershoot cuts such a run into slices
  // (1.4 s at the median) and keeps one frame per slice; so does Juno.
  const run = Array.from({ length: 40 }, (_, i) =>
    photo("b" + i, 1000 + i * 100, "0".repeat(64)),
  );
  const groups = grouperRafales(run);
  expect(groups.map((g) => g.length)).toEqual([26, 14]);
});
it("a different scene opens a new group", () => {
  const groups = grouperRafales([
    photo("a", 1000, "0".repeat(64)),
    photo("b", 1200, "0".repeat(64)),
    photo("c", 1400, "1".repeat(64)),
    photo("d", 99000, "1".repeat(64)),
  ]);
  expect(groups.map((g) => g.length)).toEqual([2, 1, 1]);
});
it("the suggestion of a burst is the sharpest subject, and says why", () => {
  const photos = [
    photo("dull", 1000, "0".repeat(64)),
    photo("sharp", 1100, "0".repeat(64)),
  ];
  photos[0].analysis!.faces = {
    count: 1,
    closedEyes: 0,
    blink: 0,
    reads: [face({ sharpness: 80 })],
    version: "t",
  };
  photos[1].analysis!.faces = {
    count: 1,
    closedEyes: 0,
    blink: 0,
    reads: [face({ sharpness: 1400 })],
    version: "t",
  };
  const ranked = groupSuggestions(photos);
  const winner = ranked.find((p) => p.analysis?.suggested);
  expect(winner?.id).toBe("sharp");
  expect(winner?.analysis?.verdict).toMatch(/Meilleure de la rafale \(2 images\)/);
  const loser = ranked.find((p) => p.id === "dull");
  expect(loser?.analysis?.verdict).toMatch(
    /Une autre image de la rafale est préférée : plus nette\./,
  );
  // Both frames belong to the same group.
  expect(ranked[0].analysis?.groupId).toBe(ranked[1].analysis?.groupId);
});
it("a protected photo is never demoted by the score", () => {
  const photos = [
    photo("protected", 1000, "0".repeat(64)),
    photo("better", 1100, "0".repeat(64)),
  ];
  (photos[0] as any).protected = true;
  photos[0].analysis!.faces = {
    count: 1,
    closedEyes: 0,
    blink: 0,
    reads: [face({ sharpness: 10 })],
    version: "t",
  };
  photos[1].analysis!.faces = {
    count: 1,
    closedEyes: 0,
    blink: 0,
    reads: [face({ sharpness: 2000 })],
    version: "t",
  };
  expect(groupSuggestions(photos).find((p) => p.analysis?.suggested)?.id).toBe(
    "protected",
  );
});
import { laneCount } from "../src/modules/image-client";
import { visionLaneCount } from "../src/modules/culling";
it("worker pools scale with the machine and always leave room to work", () => {
  // One lane on a small machine, never more than the cap on a big one.
  expect(laneCount(2)).toBe(1);
  expect(laneCount(4)).toBe(2);
  expect(laneCount(10)).toBe(4);
  expect(laneCount(64)).toBe(4);
  expect(visionLaneCount(2)).toBe(1);
  expect(visionLaneCount(10)).toBe(3);
  expect(visionLaneCount(64)).toBe(3);
  // The two pools together must not claim every core.
  for (const cores of [2, 4, 8, 10, 12, 16])
    expect(laneCount(cores) + visionLaneCount(cores)).toBeLessThanOrEqual(
      Math.max(2, cores - 1),
    );
});
it("a named person outweighs a bigger stranger in the frame", () => {
  const priority = ["bride"];
  // The bride is small in frame and sharp; a guest fills it and is blurred.
  const a = withFace({}, [
    { ...face({ weight: 0.03, sharpness: 1400 }), personId: "bride" },
    face({ weight: 0.4, sharpness: 60 }),
  ]);
  const b = withFace({}, [
    { ...face({ weight: 0.03, sharpness: 90 }), personId: "bride" },
    face({ weight: 0.4, sharpness: 1400 }),
  ]);
  // Without priority the largest face decides and b wins on sharpness.
  expect(decisiveSharpness(b)).toBeGreaterThan(decisiveSharpness(a));
  // With the bride named, the reading flips to her.
  expect(decisiveSharpness(a, priority)).toBe(1400);
  expect(decisiveSharpness(b, priority)).toBe(90);
  const [first, second] = burstScores([a, b], priority);
  expect(first).toBeGreaterThan(second);
});
it("closed eyes on a named person cost even when the face is small", () => {
  const priority = ["bride"];
  const blinking = withFace({}, [
    { ...face({ weight: 0.02, eyesClosed: 0.95 }), personId: "bride" },
  ]);
  const open = withFace({}, [
    { ...face({ weight: 0.02, eyesClosed: 0 }), personId: "bride" },
  ]);
  expect(contextScore(blinking, priority)).toBeLessThan(
    contextScore(open, priority) - 15,
  );
});
it("a frame without the followed people says so and loses ground", () => {
  const priority = ["bride"];
  const without = withFace({}, [face({ weight: 0.3 })]);
  const with_ = withFace({}, [{ ...face({ weight: 0.3 }), personId: "bride" }]);
  expect(verdictFor(without, priority)).toMatch(/ne sont pas sur cette image/);
  expect(contextScore(without, priority)).toBeLessThan(
    contextScore(with_, priority),
  );
  // Without any named person the sentence stays about the picture itself.
  expect(verdictFor(without)).not.toMatch(/ne sont pas/);
});
import { parsePrompt } from "../src/assistant/commands";
import { applyVideoActions } from "../src/assistant/video-actions";
import type { Sequence as Seq, Asset, VideoAction } from "../src/video/types";
it("the pilot understands the 0.8.0 and 0.9.0 features it could not name", () => {
  const read = (text: string) =>
    parsePrompt(text, "video", "current").actions[0]?.kind;
  expect(read("Floute la zone")).toBe("video.mask");
  expect(read("Pixelise la zone")).toBe("video.mask");
  expect(read("Cache la zone")).toBe("video.mask");
  expect(read("Suis le sujet")).toBe("video.track");
  expect(read("Mets du relief de 30")).toBe("video.depth");
  const blurred = parsePrompt("Pixelise la zone", "video", "current")
    .actions[0] as VideoAction;
  expect(blurred).toMatchObject({ kind: "video.mask", effect: "pixelate" });
});
const clip = (over = {}) => ({
  id: "c1",
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
  ...over,
});
const sequence = (over = {}): Seq =>
  ({
    id: "s",
    name: "s",
    fps: { n: 25, d: 1 },
    width: 1920,
    height: 1080,
    clips: [clip()],
    titles: [],
    captions: [],
    markers: [],
    masterGain: 1,
    created: 0,
    ...over,
  }) as Seq;
it("asking to blur adds a real mask, and tracking refuses without one", () => {
  const s = sequence();
  const out = applyVideoActions(
    s,
    [{ kind: "video.mask", effect: "blur" }],
    ["c1"],
    10,
    [] as Asset[],
  );
  expect(out.clips[0].masks).toHaveLength(1);
  expect(out.clips[0].masks![0].effect).toBe("blur");
  expect(out.clips[0].masks![0].keys[0].frame).toBe(10);
  // The original sequence is untouched.
  expect(s.clips[0].masks).toBeUndefined();
  expect(() =>
    applyVideoActions(s, [{ kind: "video.track" }], ["c1"], 10, [] as Asset[]),
  ).toThrow(/masque/);
  // A sound track carries no picture to mask.
  const audio = sequence({ clips: [clip({ track: 10, component: "audio" })] });
  expect(() =>
    applyVideoActions(
      audio,
      [{ kind: "video.mask", effect: "blur" }],
      ["c1"],
      10,
      [] as Asset[],
    ),
  ).toThrow(/plan vidéo/);
});
it("asking for relief sets it on the graphic under the cursor", () => {
  const s = sequence({
    titles: [
      {
        id: "t",
        text: "Juno",
        start: 0,
        duration: 50,
        size: 72,
        y: 0.5,
        color: "#ffffff",
      },
      {
        id: "late",
        text: "Plus tard",
        start: 200,
        duration: 50,
        size: 72,
        y: 0.5,
        color: "#ffffff",
      },
    ],
  });
  const out = applyVideoActions(
    s,
    [{ kind: "video.depth", extrude: 0.3 }],
    ["c1"],
    10,
    [] as Asset[],
  );
  expect(out.titles[0].depth).toMatchObject({ extrude: 0.3 });
  // A title that is not on screen at the cursor is left alone.
  expect(out.titles[1].depth).toBeUndefined();
  expect(() =>
    applyVideoActions(
      sequence(),
      [{ kind: "video.depth", extrude: 0.3 }],
      ["c1"],
      10,
      [] as Asset[],
    ),
  ).toThrow(/titre ou un élément graphique/);
});
it("a burst is measured from its first frame, and time alone never groups", () => {
  // Frames 1.2 s apart: the third is 2.4 s after the first, still in; the
  // fourth, 3.6 s after it, starts a new burst even though each step is short.
  const run = [0, 1200, 2400, 3600].map((t, i) =>
    photo("c" + i, t, "0".repeat(64)),
  );
  expect(grouperRafales(run).map((g) => g.length)).toEqual([3, 1]);
  // Time alone never groups: the frames must still look alike.
  const different = [
    photo("a", 0, "0".repeat(64)),
    photo("b", 400, "1".repeat(64)),
  ];
  expect(grouperRafales(different).map((g) => g.length)).toEqual([1, 1]);
});
