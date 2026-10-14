import { it, expect } from "vitest";
import { pushHistory } from "../src/video/history";
import type { Sequence } from "../src/video/types";
it("bounds undo memory when a timeline contains 20000 clips", () => {
  const stack: Sequence[] = [];
  const s = {
    clips: Array.from({ length: 20000 }, (_, i) => ({ id: String(i) })),
    titles: [],
    captions: [],
  } as unknown as Sequence;
  for (let i = 0; i < 50; i++) pushHistory(stack, s);
  expect(stack.length).toBeLessThanOrEqual(4);
  s.clips[0].id = "changed";
  expect(stack.at(-1)!.clips[0].id).toBe("0");
});
