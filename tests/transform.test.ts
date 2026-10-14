import { it, expect } from "vitest";
import {
  dragAngle,
  dragFactor,
  rotateTitle,
  scaleTitle,
  titleSizeLimit,
  wrapDegrees,
} from "../src/video/transform";
import type { Title } from "../src/video/types";
const text: Title = {
  id: "t",
  text: "Juno",
  start: 0,
  duration: 50,
  size: 72,
  y: 0.5,
  color: "#ffffff",
};
const shape: Title = {
  ...text,
  id: "g",
  text: "",
  graphic: { kind: "rectangle", width: 0.3, height: 0.15, fill: "#315b43" },
};
it("the size cap follows the delivery format and never falls below the old one", () => {
  expect(titleSizeLimit(1080)).toBe(540);
  expect(titleSizeLimit(2160)).toBe(1080);
  expect(titleSizeLimit(64)).toBe(240);
  expect(titleSizeLimit(20000)).toBe(4096);
});
it("scaling text stays inside the sequence bounds and never mutates the source", () => {
  expect(scaleTitle(text, 2, 1080).size).toBe(144);
  expect(scaleTitle(text, 0.01, 1080).size).toBe(12);
  expect(scaleTitle(text, 1000, 1080).size).toBe(540);
  expect(scaleTitle(text, 1000, 2160).size).toBe(1080);
  expect(text.size).toBe(72);
  for (const factor of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    expect(scaleTitle(text, factor, 1080)).toBe(text);
});
it("scaling a shape keeps both sides proportional inside the frame", () => {
  const bigger = scaleTitle(shape, 2, 1080);
  expect(bigger.graphic).toEqual({ ...shape.graphic, width: 0.6, height: 0.3 });
  expect(shape.graphic!.width).toBe(0.3);
  const clamped = scaleTitle(shape, 100, 1080);
  expect(clamped.graphic!.width).toBe(1);
  expect(clamped.graphic!.height).toBe(1);
  expect(scaleTitle(shape, 0.0001, 1080).graphic!.height).toBe(0.01);
  expect(scaleTitle(shape, 2, 1080).size).toBe(shape.size);
});
it("rotation is bounded, rounded and wraps instead of sticking to the limit", () => {
  expect(rotateTitle(text, 45.04).rotation).toBe(45);
  expect(rotateTitle(text, 400).rotation).toBe(180);
  expect(rotateTitle(text, -400).rotation).toBe(-180);
  expect(rotateTitle(text, Number.NaN)).toBe(text);
  expect(wrapDegrees(190)).toBe(-170);
  expect(wrapDegrees(-190)).toBe(170);
  expect(wrapDegrees(540)).toBe(180);
  expect(rotateTitle(text, wrapDegrees(170 + 20)).rotation).toBe(-170);
});
it("a drag measures its own factor and angle around the anchor", () => {
  const anchor = { x: 100, y: 100 };
  expect(dragFactor({ x: 200, y: 100 }, { x: 300, y: 100 }, anchor)).toBe(2);
  expect(dragFactor({ x: 200, y: 100 }, { x: 150, y: 100 }, anchor)).toBe(0.5);
  // A grab too close to the anchor must not explode the element.
  expect(dragFactor({ x: 101, y: 100 }, { x: 900, y: 100 }, anchor)).toBe(1);
  expect(dragFactor({ x: 200, y: 100 }, { x: 100, y: 100 }, anchor)).toBe(
    1 / 64,
  );
  expect(dragAngle({ x: 200, y: 100 }, { x: 100, y: 200 }, anchor)).toBe(90);
  expect(dragAngle({ x: 200, y: 100 }, { x: 100, y: 0 }, anchor)).toBe(-90);
  expect(
    Math.abs(dragAngle({ x: 200, y: 100 }, { x: 0, y: 100 }, anchor)),
  ).toBe(180);
});
it("a scale drag applies the whole factor once instead of compounding steps", () => {
  const anchor = { x: 0, y: 0 },
    from = { x: 100, y: 0 };
  let live = text;
  for (const x of [120, 160, 200])
    live = scaleTitle(text, dragFactor(from, { x, y: 0 }, anchor), 1080);
  expect(live.size).toBe(144);
});
