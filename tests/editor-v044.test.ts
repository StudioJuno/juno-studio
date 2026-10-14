import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import {
  DEFAULT,
  editPhoto,
  undoPhoto,
  redoPhoto,
  resetPhoto,
  replacePhotoAdjustments,
  recoverPhoto,
  type Photo,
} from "../src/model";
import { PhotoWriter } from "../src/modules/photo-writer";
import { parseSetting } from "../src/modules/NumericRange";
import { advancedColor, advancedDetails } from "../src/modules/advanced-color";
import { validateAdjustments } from "../src/modules/catalog-validation";
const photo = () =>
  ({
    id: "gesture",
    projectId: "p",
    name: "a.jpg",
    adjustments: { ...DEFAULT },
    history: [],
    revision: 0,
  }) as unknown as Photo;
it("a continuous slider gesture is one reversible change, even across writes", () => {
  let p = photo();
  for (let i = 1; i <= 300; i++)
    p = editPhoto(p, { contrast: i / 3 }, "one-gesture");
  expect(p.history).toHaveLength(1);
  expect(undoPhoto(p).adjustments.contrast).toBe(0);
  expect(redoPhoto(undoPhoto(p)).adjustments.contrast).toBe(100);
  p = editPhoto(p, { contrast: 30 }, "new-gesture");
  expect(p.history).toHaveLength(2);
});
it("coalesces pending drag writes without losing the final setting or its undo baseline", async () => {
  let stored = photo(),
    release!: () => void,
    calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = new PhotoWriter(
    () => {},
    () => {},
    async (_id, update) => {
      calls++;
      if (calls === 1) await gate;
      stored = { ...update(stored), revision: (stored.revision || 0) + 1 };
      return stored;
    },
  );
  const promises = Array.from({ length: 1000 }, (_, i) =>
    writer.write(
      "gesture",
      (p) => editPhoto(p, { exposure: i / 1000 }, "drag"),
      "drag",
    ),
  );
  expect(writer.project(stored).adjustments.exposure).toBe(0.999);
  expect(writer.project(stored).history).toHaveLength(1);
  release();
  await Promise.all(promises);
  await writer.flush();
  expect(calls).toBe(2);
  expect(stored.adjustments.exposure).toBe(0.999);
  expect(undoPhoto(stored).adjustments.exposure).toBe(0);
});
it("accepts French decimals, clamps bounds and rejects invalid/empty values", () => {
  expect(parseSetting("0,35", -4, 4, 0.01)).toBe(0.35);
  expect(parseSetting("200", -100, 100, 1)).toBe(100);
  expect(parseSetting("", -4, 4, 0.01)).toBeUndefined();
  expect(parseSetting("NaN", -4, 4, 0.01)).toBeUndefined();
  expect(parseSetting("3x", 0, 100, 1)).toBeUndefined();
});
it("advanced edits round-trip through backup validation and original recovery", () => {
  const p = editPhoto(photo(), {
    whites: 25,
    blacks: -12,
    vibrance: 20,
    clarity: 12,
    sharpening: 35,
    noiseReduction: 10,
    curves: {
      rgb: [
        { x: 0, y: 0.08 },
        { x: 1, y: 1 },
      ],
    },
    colorMix: { orange: { hue: 3, saturation: -12, luminance: 8 } },
  });
  expect(validateAdjustments(p.adjustments)).toEqual(p.adjustments);
  const reset = resetPhoto(p);
  expect(reset.adjustments.whites).toBe(0);
  expect(reset.adjustments.curves).toEqual({});
  expect(recoverPhoto(reset).adjustments).toMatchObject(p.adjustments);
  expect(() =>
    validateAdjustments({
      ...DEFAULT,
      curves: {
        rgb: [
          { x: 0, y: 0 },
          { x: 0, y: 0.3 },
          { x: 1, y: 1 },
        ],
      },
    }),
  ).toThrow();
});
it("curves change pixels in 16 bits while preserving alpha and neutral defaults", () => {
  const d = new Uint16Array([30000, 30001, 30002, 12345]);
  advancedColor(d, DEFAULT);
  expect([...d]).toEqual([30000, 30001, 30002, 12345]);
  advancedColor(d, {
    ...DEFAULT,
    curves: {
      rgb: [
        { x: 0, y: 0.1 },
        { x: 1, y: 1 },
      ],
    },
  });
  expect(d[0]).toBeGreaterThan(30000);
  expect(d[1]).toBeGreaterThan(d[0]);
  expect(d[3]).toBe(12345);
});
it("color mixer targets reds and preserves unrelated blues and neutral gray", () => {
  const d = new Uint8ClampedArray([
    200, 50, 50, 128, 50, 50, 200, 128, 100, 100, 100, 128,
  ]);
  advancedColor(d, {
    ...DEFAULT,
    colorMix: { red: { hue: 50, saturation: 0, luminance: 0 } },
  });
  expect(d[1]).toBeGreaterThan(50);
  expect([...d.slice(4)]).toEqual([50, 50, 200, 128, 100, 100, 100, 128]);
  expect(d[3]).toBe(128);
});
it("noise reduction lowers local variation without changing alpha or flat patches", () => {
  const d = new Uint8ClampedArray(20 * 20 * 4);
  for (let p = 0; p < 400; p++) {
    const n = 100 + (p % 2 ? 5 : -5);
    d.set([n, n, n, 150], p * 4);
  }
  const before = d.slice();
  advancedDetails(d, 20, 20, { ...DEFAULT, noiseReduction: 100 });
  const variance = (a: Uint8ClampedArray) =>
    Array.from({ length: 400 }, (_, i) => (a[i * 4] - 100) ** 2).reduce(
      (a, b) => a + b,
      0,
    );
  expect(variance(d)).toBeLessThan(variance(before));
  expect(d[3]).toBe(150);
  const flat = new Uint16Array(400).fill(30000);
  advancedDetails(flat, 10, 10, {
    ...DEFAULT,
    clarity: 100,
    sharpening: 100,
    noiseReduction: 100,
  });
  expect([...flat].every((v) => v === 30000)).toBe(true);
});

it("applying an old named version removes advanced fields and can be undone", () => {
  const p = editPhoto(photo(), {
    whites: 35,
    curves: {
      rgb: [
        { x: 0, y: 0.1 },
        { x: 1, y: 1 },
      ],
    },
  });
  const restored = replacePhotoAdjustments(p, DEFAULT);
  expect(restored.adjustments).toEqual(DEFAULT);
  expect(undoPhoto(restored).adjustments).toEqual(p.adjustments);
});
