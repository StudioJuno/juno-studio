import { it, expect } from "vitest";
import { poidsVisages, contextScore, qualityScore } from "../src/modules/quality";
import type { Analysis, FaceRead } from "../src/model";
const visage = (w: number, yeux = 0, extra: Partial<FaceRead> = {}): FaceRead => ({
  region: { x: 0.4, y: 0.3, w, h: w * 1.4 },
  weight: w * w * 1.4,
  sharpness: 40,
  eyesClosed: yeux,
  smile: 0,
  turned: 0,
  ...extra,
});
const analyse = (reads: FaceRead[]): Analysis =>
  ({
    brightness: 0.5, sharpness: 60, clipped: 0, reasons: [], advice: "normal",
    faces: { count: reads.length, closedEyes: 0, blink: 0, reads, version: "v4" },
  }) as unknown as Analysis;
it("sur un plan moyen, un invité du fond qui cligne ne pèse pas comme la mariée", () => {
  // Le défaut : avec un plancher de 0,02 sur la part du cadre, ces deux
  // visages pesaient exactement pareil.
  const mariee = visage(0.08), invite = visage(0.02, 1);
  expect(mariee.weight).toBeLessThan(0.02);
  const invitecligne = contextScore(analyse([mariee, invite]));
  const marieecligne = contextScore(analyse([visage(0.08, 1), visage(0.02)]));
  expect(invitecligne).toBeGreaterThan(-3);
  expect(marieecligne).toBeLessThan(-25);
});
it("le poids ne dépend ni de la résolution ni du cadrage", () => {
  const proche = poidsVisages([visage(0.3), visage(0.15)]);
  const loin = poidsVisages([visage(0.06), visage(0.03)]);
  expect(proche[0]).toBeCloseTo(1, 9);
  expect(loin[0]).toBeCloseTo(1, 9);
  expect(proche[1]).toBeCloseTo(loin[1], 9);
  expect(proche[1]).toBeCloseTo(0.25, 9);
});
it("sur une photo de groupe, visages de même taille, chacun compte autant", () => {
  const groupe = [visage(0.05), visage(0.05), visage(0.048), visage(0.05, 1)];
  const p = poidsVisages(groupe);
  expect(Math.min(...p)).toBeGreaterThan(0.9);
  // Un clignement sur quatre visages égaux coûte un quart de la pénalité.
  expect(contextScore(analyse(groupe))).toBeCloseTo(-30 / 4, 0);
});
it("une personne suivie pèse autant que le visage principal, même petite", () => {
  const r = contextScore(
    analyse([visage(0.1), visage(0.02, 1, { personId: "mariee" })]),
    ["mariee"],
  );
  expect(r).toBeLessThan(-12);
});
it("un catalogue ancien sans région reste noté", () => {
  const ancien = { ...visage(0.1), region: undefined } as unknown as FaceRead;
  expect(Number.isFinite(qualityScore(analyse([ancien, visage(0.05, 1)])))).toBe(true);
});
