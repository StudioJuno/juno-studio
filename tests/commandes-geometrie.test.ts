import { it, expect } from "vitest";
import {
  parsePrompt,
  applyPhotoAction,
  cadreAuFormat,
  Refus,
} from "../src/assistant/commands";
import { DEFAULT, type Photo } from "../src/model";
import { VERSION_NIVEAU } from "../src/modules/level";
const photo = (w = 6000, h = 4000, rotation = 0): Photo =>
  ({
    id: "p", projectId: "x", name: "p.jpg", source: "", thumbnail: "",
    width: w, height: h, size: 1, hash: "h", status: "pending", stars: 0,
    protected: false, chapter: "", history: [],
    adjustments: { ...DEFAULT, rotation },
  }) as unknown as Photo;
const actions = (t: string) => parsePrompt(t, "photo").actions;
/** Le rapport tel qu'on voit la photo, rotation comprise. */
function rapportVu(p: Photo) {
  const c = p.adjustments.cropRect!;
  const w = c.w * p.width, h = c.h * p.height;
  return p.adjustments.rotation % 180 ? h / w : w / h;
}
it("aucune des 33 tournures mesurées ne réveille plus le modèle de langue", () => {
  // Mesuré le 26/09/2026 : 30 comprises, 3 refusées, toutes géométriques.
  // Une consigne comprise mais impossible lève un Refus, que le pilote rend
  // tel quel ; seule une erreur ordinaire part vers le modèle de 2,3 Go.
  const corpus = [
    "augmente l'exposition de 0.3", "baisse les hautes lumieres de 20",
    "monte les ombres de 15", "reduit la saturation de 10", "mets le contraste a 12",
    "clarte 8", "vibrance 15", "temperature 5", "chaleur -8", "teinte 4", "noirs -10",
    "blancs 12", "nettete 20", "debruitage 25", "reduction du bruit 30",
    "luminosite 0.2", "exposition -0.5", "regle la clarte a 6", "fixe la nettete a 15",
    "abaisse les blancs de 8", "descends les noirs de 5", "remonte l'exposition de 0.4",
    "diminue la vibrance de 10", "augmente la nettete de 25", "mets la teinte a -3",
    "baisse la chaleur de 12", "monte le contraste de 8", "reduit les hautes lumieres de 15",
    "ombres 20", "saturation -12", "recadre en 16/9", "pivote de 90", "redresse de 2",
  ];
  const versLeModele: string[] = [];
  for (const p of corpus) {
    try { parsePrompt(p, "photo"); }
    catch (e) { if (!(e instanceof Refus)) versLeModele.push(p); }
  }
  expect(versLeModele).toEqual([]);
});
it("les rotations se lisent dans le sens des aiguilles d'une montre", () => {
  expect(actions("pivote de 90")).toEqual([{ kind: "photo.rotate", degrees: 90 }]);
  expect(actions("pivote de 90°")).toEqual([{ kind: "photo.rotate", degrees: 90 }]);
  expect(actions("tourne a droite")).toEqual([{ kind: "photo.rotate", degrees: 90 }]);
  expect(actions("tourne à gauche")).toEqual([{ kind: "photo.rotate", degrees: 270 }]);
  expect(actions("pivote de -90")).toEqual([{ kind: "photo.rotate", degrees: 270 }]);
  expect(actions("fais pivoter la photo de 180 degrés")).toEqual([{ kind: "photo.rotate", degrees: 180 }]);
  expect(actions("tourne d'un quart de tour à droite")).toEqual([{ kind: "photo.rotate", degrees: 90 }]);
  expect(actions("tourne d'un quart de tour à gauche")).toEqual([{ kind: "photo.rotate", degrees: 270 }]);
  expect(actions("tourne d'un demi tour")).toEqual([{ kind: "photo.rotate", degrees: 180 }]);
  // L'orthographe juste prend un trait d'union : elle doit passer aussi.
  expect(actions("tourne d'un demi-tour")).toEqual([{ kind: "photo.rotate", degrees: 180 }]);
});
it("au-delà de 45°, un angle qui n'est pas un quart de tour est refusé clairement", () => {
  for (const t of ["pivote de 60", "pivote de 100", "tourne de 360", "tourne la photo"])
    expect(() => actions(t), t).toThrow(Refus);
});
it("quelques degrés, c'est un redressement qui s'ajoute au précédent", () => {
  expect(actions("pivote de 2")).toEqual([{ kind: "photo.straighten", degrees: 2, relative: true }]);
  expect(actions("tourne de 1,5 degré à gauche")).toEqual([
    { kind: "photo.straighten", degrees: -1.5, relative: true },
  ]);
  expect(actions("redresse de 2 degrés")).toEqual([{ kind: "photo.straighten", degrees: 2, relative: true }]);
  expect(actions("redresse la photo de 0,8° à gauche")).toEqual([
    { kind: "photo.straighten", degrees: -0.8, relative: true },
  ]);
  expect(actions("redressement 1.2")).toEqual([
    { kind: "photo.adjust", field: "straighten", value: 1.2, relative: false },
  ]);
  expect(() => actions("redresse de 50 degrés")).toThrow(Refus);
});
it("« redresse » tout court pose l'angle mesuré sur les lignes", () => {
  for (const t of ["redresse", "redresse la photo", "redresse l'horizon", "remets droit", "redresse les photos"])
    expect(actions(t), t).toEqual([{ kind: "photo.autostraighten" }]);
  expect(() => actions("redresse un peu")).toThrow(Refus);
});
const mesure = (tier: "auto" | "suggest" | "level" | "abstain", angle: number | null) =>
  ({ ...photo(), analysis: { level: { tier, angle, reason: "", version: VERSION_NIVEAU } } }) as unknown as Photo;
it("le redressement automatique suit la mesure, et laisse la photo sans lignes intacte", () => {
  expect(applyPhotoAction(mesure("auto", 1.8), { kind: "photo.autostraighten" }).adjustments.straighten).toBe(-1.8);
  // Demandé explicitement, la proposition est posée aussi.
  expect(applyPhotoAction(mesure("suggest", -3.25), { kind: "photo.autostraighten" }).adjustments.straighten).toBe(3.25);
  const sans = mesure("abstain", null);
  expect(applyPhotoAction(sans, { kind: "photo.autostraighten" })).toBe(sans);
  // « Déjà droite » efface un redressement précédent.
  const penchee = { ...mesure("level", 0), adjustments: { ...DEFAULT, straighten: 2 } } as Photo;
  expect(applyPhotoAction(penchee, { kind: "photo.autostraighten" }).adjustments.straighten).toBeUndefined();
});
it("les redressements relatifs se cumulent, et un angle nul s'efface", () => {
  let p = applyPhotoAction(photo(), { kind: "photo.straighten", degrees: 1.5, relative: true });
  p = applyPhotoAction(p, { kind: "photo.straighten", degrees: -0.5, relative: true });
  expect(p.adjustments.straighten).toBe(1);
  p = applyPhotoAction(p, { kind: "photo.adjust", field: "straighten", value: 0, relative: false });
  expect(p.adjustments.straighten).toBeUndefined();
  expect(() => applyPhotoAction(p, { kind: "photo.straighten", degrees: 44, relative: true })).not.toThrow();
  expect(() =>
    applyPhotoAction(
      { ...p, adjustments: { ...p.adjustments, straighten: 44 } },
      { kind: "photo.straighten", degrees: 2, relative: true },
    ),
  ).toThrow(/hors limites/);
});
it("un format demandé sur une photo redressée ne laisse aucun coin vide", () => {
  const p = applyPhotoAction(
    { ...photo(), adjustments: { ...DEFAULT, straighten: 3 } } as Photo,
    { kind: "photo.aspect", ratio: 16 / 9 },
  );
  expect(rapportVu(p)).toBeCloseTo(16 / 9, 6);
  // Plus petit que sans redressement : le cadre tient dans l'image tournée.
  expect(p.adjustments.cropRect!.w).toBeLessThan(1);
  expect(p.adjustments.cropRect!.h).toBeLessThan(0.95);
});
it("les formats se lisent sous toutes leurs écritures", () => {
  expect(actions("recadre en 16/9")[0]).toEqual({ kind: "photo.aspect", ratio: 16 / 9 });
  expect(actions("recadre au format 4:5")[0]).toEqual({ kind: "photo.aspect", ratio: 0.8 });
  expect(actions("recadre en 3x2")[0]).toEqual({ kind: "photo.aspect", ratio: 1.5 });
  expect(actions("recadre au carré")[0]).toEqual({ kind: "photo.aspect", ratio: 1 });
  expect(actions("enlève le recadrage")[0]).toEqual({ kind: "photo.aspect", ratio: 0 });
  expect(() => actions("recadre en 20/1")).toThrow(Refus);
});
it("un format appliqué donne bien ce rapport à l'écran", () => {
  for (const [w, h] of [[6000, 4000], [4000, 6000], [3000, 3000]])
    for (const ratio of [16 / 9, 4 / 5, 1, 3 / 2]) {
      const p = applyPhotoAction(photo(w, h), { kind: "photo.aspect", ratio });
      expect(rapportVu(p), `${w}x${h} → ${ratio}`).toBeCloseTo(ratio, 6);
      const c = p.adjustments.cropRect!;
      expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
      // Le plus grand cadre possible : un côté touche toujours le bord.
      expect(Math.max(c.w, c.h)).toBeCloseTo(1, 9);
    }
});
it("sur une photo tournée, un 16/9 reste un 16/9 à l'écran", () => {
  // Le piège : le cadre s'écrit dans la source, avant la rotation. Sans en
  // tenir compte, un 16/9 demandé sur une photo tournée sortirait en 9/16.
  for (const rotation of [90, 270]) {
    const p = applyPhotoAction(photo(6000, 4000, rotation), { kind: "photo.aspect", ratio: 16 / 9 });
    expect(rapportVu(p)).toBeCloseTo(16 / 9, 6);
  }
});
it("les rotations se cumulent et reviennent à zéro", () => {
  let p = photo();
  p = applyPhotoAction(p, { kind: "photo.rotate", degrees: 90 });
  p = applyPhotoAction(p, { kind: "photo.rotate", degrees: 90 });
  expect(p.adjustments.rotation).toBe(180);
  p = applyPhotoAction(p, { kind: "photo.rotate", degrees: 180 });
  expect(p.adjustments.rotation).toBe(0);
});
it("enlever le recadrage rend la photo entière", () => {
  let p = applyPhotoAction(photo(), { kind: "photo.aspect", ratio: 1 });
  expect(p.adjustments.cropRect).toBeDefined();
  p = applyPhotoAction(p, { kind: "photo.aspect", ratio: 0 });
  expect(p.adjustments.cropRect).toBeUndefined();
});
it("une consigne vraiment inconnue part toujours vers le modèle", () => {
  // Le refus ne doit pas avaler ce que le modèle sait mieux comprendre.
  let err: unknown;
  try { actions("rends la plus belle"); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(Refus);
});
it("cadreAuFormat reste centré", () => {
  const c = cadreAuFormat(6000, 4000, 0, 1);
  expect(c.x).toBeCloseTo((1 - c.w) / 2, 9);
  expect(c.y).toBeCloseTo((1 - c.h) / 2, 9);
});
