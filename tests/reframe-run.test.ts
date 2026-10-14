import { it, expect, vi } from "vitest";
vi.mock("../src/video/reframe-scan", () => ({ releverVisages: vi.fn() }));
import { modeDuPlan, bilan } from "../src/video/reframe-run";
import type { Clip } from "../src/video/types";
const plan = (reframe?: Clip["reframe"]) => ({ reframe }) as Clip;
it("un second « Recadrer » n'écrase pas le travail fait plan par plan", () => {
  // Le défaut : le bouton repassait tout sur le couple, y compris un plan
  // mis « sur tout le monde » ou retouché à la main.
  expect(modeDuPlan(plan())).toBe("couple");
  expect(modeDuPlan(plan("couple"))).toBe("couple");
  expect(modeDuPlan(plan("tous"))).toBe("tous");
  expect(modeDuPlan(plan("main"))).toBeNull();
});
const note = (mode: "tous" | "couple", tientTout = true) => ({
  clipId: "c", nom: "n", texte: "", tientTout, mode,
});
it("le bilan dit ce qui a été fait, sans mentir sur le mode", () => {
  expect(bilan([note("couple"), note("couple")])).toMatch(/2 plans recadrés sur le couple/);
  expect(bilan([note("tous")])).toMatch(/1 plan recadré sur tout le monde/);
  expect(bilan([note("tous"), note("couple")])).toMatch(/selon le choix de chaque plan/);
  expect(bilan([note("tous", false)])).toMatch(/ne tient pas entièrement/);
  expect(bilan([])).toMatch(/réglés à la main/);
});
