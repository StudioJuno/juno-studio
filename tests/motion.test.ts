import { it, expect } from "vitest";
import { motionAt, motionKey, motionPreset } from "../src/video/motion";
import { captionPreset } from "../src/video/caption-presets";
import { titleSizeLimit } from "../src/video/transform";
import { captionTitle } from "../src/video/title-render";
import type { Sequence } from "../src/video/types";
it("motion interpolates and rejects out-of-clip keys without mutation", () => {
  const first = motionKey(undefined, "scale", 0, 1, 50, "linear"),
    second = motionKey(first, "scale", 40, 2, 50);
  expect(motionAt(second, 20).scale).toBe(1.5);
  expect(first.scale).toHaveLength(1);
  expect(() => motionKey(second, "scale", 50, 2, 50)).toThrow();
  expect(() => motionKey(second, "opacity", 0, 2, 50)).toThrow();
});
it("short subtitles have bounded effect keys and one-frame captions stay visible", () => {
  for (const duration of [1, 2, 5, 100])
    for (const name of ["pop", "fade", "rise", "slide"]) {
      const m = motionPreset(name, duration, 25);
      for (const keys of Object.values(m))
        for (const k of keys!) expect(k.frame).toBeLessThan(duration);
      if (duration === 1) expect(motionAt(m, 0).opacity).toBe(1);
    }
});
it("social caption styling survives per-caption overrides and adjusts to sequence resolution", () => {
  const s = {
    width: 1080,
    height: 1920,
    fps: { n: 25, d: 1 },
    captionStyle: { ...captionPreset("yellow", 1080), effect: "pop" },
  } as Sequence;
  const t = captionTitle(
    {
      id: "a",
      text: "Bonjour",
      start: 50,
      duration: 30,
      style: { color: "#00ff00" },
    },
    s,
  );
  expect(t.color).toBe("#00ff00");
  expect(t.uppercase).toBe(true);
  expect(t.y).toBe(0.74);
  expect(t.motion?.scale?.[0].value).toBe(0.65);
  // The preset follows the delivery format and stays under the sequence cap.
  expect(captionPreset("social", 1920, 1080).size).toBe(90);
  expect(captionPreset("social", 3840, 2160).size).toBe(180);
  expect(captionPreset("social", 8192, 4320).size).toBeLessThanOrEqual(
    titleSizeLimit(4320),
  );
  expect(captionPreset("classic", 640, 64).size).toBeLessThanOrEqual(
    titleSizeLimit(64),
  );
});
