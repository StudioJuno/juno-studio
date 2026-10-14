import { it, expect } from "vitest";
import { shade, depthSteps, DEPTH_LIMIT } from "../src/video/title-render";
it("shading moves a colour towards black or white and leaves bad input alone", () => {
  expect(shade("#808080", 0.5)).toBe("#404040");
  expect(shade("#808080", 1)).toBe("#808080");
  expect(shade("#808080", 1.5)).toBe("#c0c0c0");
  expect(shade("#000000", 0.2)).toBe("#000000");
  expect(shade("#ffffff", 2)).toBe("#ffffff");
  // Out-of-range factors must not produce a broken colour string.
  expect(shade("#336699", -1)).toBe("#000000");
  expect(shade("rgb(1,2,3)", 0.5)).toBe("rgb(1,2,3)");
  expect(shade("#ABCDEF", 0.5)).toBe("#566778");
});
it("relief steps follow the text size and stay bounded", () => {
  expect(depthSteps(undefined, 72)).toBe(0);
  expect(depthSteps({ extrude: 0, angle: 45, light: 0.4 }, 72)).toBe(0);
  expect(depthSteps({ extrude: 0.25, angle: 45, light: 0.4 }, 72)).toBe(18);
  expect(depthSteps({ extrude: 0.001, angle: 45, light: 0.4 }, 72)).toBe(1);
  // A 4K title with maximum depth must not ask for thousands of passes.
  expect(depthSteps({ extrude: 1, angle: 45, light: 0.4 }, 1080)).toBe(
    DEPTH_LIMIT,
  );
});
