import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  comparableSharpness,
  jugementNettete,
  regionSharpness,
  verdictFor,
  NETTETE_DOUTE,
  NETTETE_FLOU,
} from "../src/modules/quality";
import { groupSuggestions, withFaces, VERSION_VISAGES } from "../src/modules/culling";
import { validateCatalog } from "../src/modules/catalog-validation";
import { DEFAULT, type Analysis, type FaceRead, type Photo } from "../src/model";
/** Le script tel que le travailleur de vision le charge avec importScripts. */
const N = (() => {
  const module = { exports: {} as Record<string, unknown> };
  new Function("module", "self", readFileSync("public/face-sharpness.js", "utf8"))(module, {});
  return module.exports as {
    mesurer(g: ArrayLike<number>, w: number, h: number, b: { x: number; y: number; w: number; h: number }, cote: number, source?: number): number | undefined;
    SOURCE_MIN: number;
  };
})();
/** Une photo de 6 720 px réduite à 1 024, comme les CR3 de l'album de mesure. */
const SOURCE = 6720;
const mesurer = (g: ArrayLike<number>, b: { x: number; y: number; w: number; h: number }, cote = W, source = SOURCE) =>
  N.mesurer(g, W, H, b, cote, source);
const W = 1024,
  H = 683;
/**
 * Un « visage » de synthèse : dans la bande des yeux, une texture fine au
 * pixel près, comme des cils et des paupières ; ailleurs, une peau unie. Des
 * rayures larges ne conviennent pas : leurs bords restent raides sous un flou
 * qui efface déjà des cils.
 */
function visage(taille: number, contraste = 150, flou = 0) {
  const g = new Float32Array(W * H).fill(120);
  const x0 = 300,
    y0 = 150;
  let graine = 7;
  for (let y = 0; y < taille; y++)
    for (let x = 0; x < taille; x++) {
      const v = y / taille;
      graine = (graine * 1103515245 + 12345) >>> 0;
      g[(y0 + y) * W + x0 + x] = v > 0.2 && v < 0.55 ? 120 + ((graine >>> 24) / 255 - 0.5) * contraste : 150;
    }
  const boite = { x: x0, y: y0, w: taille, h: taille };
  return { g: flou ? flouter(g, flou) : g, boite };
}
/** Flou gaussien séparable, en pixels de l'image de 1 024 px. */
function flouter(g: Float32Array, sigma: number) {
  const r = Math.ceil(sigma * 3),
    k: number[] = [];
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  const t = new Float32Array(W * H),
    o = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += (k[i + r] / s) * g[y * W + Math.min(W - 1, Math.max(0, x + i))];
      t[y * W + x] = a;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += (k[i + r] / s) * t[Math.min(H - 1, Math.max(0, y + i)) * W + x];
      o[y * W + x] = a;
    }
  return o;
}
it("un visage net passe le seuil, le même visage flouté tombe dessous", () => {
  const net = visage(120),
    flou = visage(120, 150, 1.5);
  const vNet = mesurer(net.g, net.boite)!,
    vFlou = mesurer(flou.g, flou.boite)!;
  expect(vNet).toBeGreaterThanOrEqual(NETTETE_DOUTE);
  expect(vFlou).toBeLessThan(NETTETE_FLOU);
});
/** Des traits dont la taille suit celle du visage : c'est là que l'ancienne mesure déraillait. */
function traits(taille: number) {
  const g = new Float32Array(W * H).fill(150);
  for (let y = 0; y < taille; y++)
    for (let x = 0; x < taille; x++) {
      const v = y / taille;
      if (v > 0.2 && v < 0.55) g[(150 + y) * W + 300 + x] = Math.floor((x / taille) * 12) % 2 ? 60 : 200;
    }
  return { g, boite: { x: 300, y: 150, w: taille, h: taille } };
}
it("un petit visage net n'est pas jugé plus net qu'un grand : la taille ne compte plus", () => {
  const petit = traits(48),
    grand = traits(240);
  const a = mesurer(petit.g, petit.boite)!,
    b = mesurer(grand.g, grand.boite)!;
  expect(a).toBeGreaterThanOrEqual(NETTETE_DOUTE);
  expect(b).toBeGreaterThanOrEqual(NETTETE_DOUTE);
  expect(Math.abs(a - b)).toBeLessThan(0.01);
  // L'ancienne mesure, sur les mêmes visages : plusieurs fois plus pour le petit.
  const ancien = (v: { g: Float32Array; boite: { x: number; y: number; w: number; h: number } }) =>
    regionSharpness(v.g, W, H, { x: v.boite.x / W, y: v.boite.y / H, w: v.boite.w / W, h: v.boite.h / H });
  expect(ancien(petit) / ancien(grand)).toBeGreaterThan(3);
});
it("le contraste ne change pas le verdict d'un visage net ; un flou peu contrasté est la limite connue", () => {
  const fort = visage(120, 200),
    faible = visage(120, 40);
  expect(Math.abs(mesurer(fort.g, fort.boite)! - mesurer(faible.g, faible.boite)!)).toBeLessThan(0.01);
  // Flou et bien contrasté : signalé. Flou et peu contrasté (lumière faible) :
  // le plancher d'étendue écarte ses bords doux, il peut passer pour net. Un
  // plancher plus bas dégrade la mesure sur les vrais visages (voir l'en-tête
  // de face-sharpness.js) : on l'assume, ce test le rend visible.
  const flouFort = visage(120, 200, 1.5),
    flouFaible = visage(120, 40, 1.5);
  expect(mesurer(flouFort.g, flouFort.boite)!).toBeLessThan(NETTETE_FLOU);
  expect(mesurer(flouFaible.g, flouFaible.boite)!).toBeGreaterThan(mesurer(flouFort.g, flouFort.boite)!);
});
it("hors de son domaine, la mesure se tait au lieu de condamner", () => {
  const v = visage(120);
  // La vignette de secours (480 px) : tous les visages y seraient « flous ».
  expect(mesurer(v.g, v.boite, 480)).toBeUndefined();
  // Une petite source réduite à 1 024 (aperçu Sony de 1 616 px) : des visages
  // nets y passeraient pour flous. Source inconnue : pareil.
  expect(mesurer(v.g, v.boite, W, 1616)).toBeUndefined();
  expect(mesurer(v.g, v.boite, W, N.SOURCE_MIN)).toBeDefined();
  expect(N.mesurer(v.g, W, H, v.boite, W)).toBeUndefined();
  // Une bande unie ou noire : non mesurable, pas « très floue ».
  expect(mesurer(new Float32Array(W * H).fill(10), v.boite)).toBeUndefined();
  expect(mesurer(v.g, { x: 10, y: 10, w: 0, h: 20 })).toBeUndefined();
});
const lecture = (nettete: number | undefined, w = 0.2, over: Partial<FaceRead> = {}): FaceRead => ({
  region: { x: 0.4, y: 0.3, w, h: w },
  weight: w * w,
  sharpness: 900,
  nettete,
  eyesClosed: 0.05,
  smile: 0.2,
  turned: 0.1,
  ...over,
});
it("trois verdicts : net, à vérifier, flou ; et rien quand la mesure manque", () => {
  expect(jugementNettete([lecture(0.29)])).toBe("net");
  expect(jugementNettete([lecture(NETTETE_DOUTE)])).toBe("net");
  expect(jugementNettete([lecture(NETTETE_FLOU)])).toBe("doute");
  expect(jugementNettete([lecture(NETTETE_FLOU - 0.0001)])).toBe("flou");
  expect(jugementNettete([lecture(0.265)])).toBe("doute");
  expect(jugementNettete([lecture(0.25)])).toBe("flou");
  expect(jugementNettete([lecture(undefined)])).toBeUndefined();
  expect(jugementNettete(undefined)).toBeUndefined();
});
it("un invité flou au premier plan ne condamne pas un sujet net derrière lui", () => {
  const invite = lecture(0.24, 0.3),
    sujet = lecture(0.29, 0.18);
  expect(jugementNettete([invite, sujet])).toBe("net");
  // Exactement moitié moins large : il sauve encore.
  expect(jugementNettete([invite, lecture(0.29, 0.15)])).toBe("net");
  // Un visage net minuscule au fond, en revanche, ne sauve rien ; un visage
  // « à vérifier » non plus.
  expect(jugementNettete([invite, lecture(0.29, 0.1)])).toBe("flou");
  expect(jugementNettete([invite, lecture(0.265, 0.3)])).toBe("flou");
  // Une personne désignée est jugée pour elle-même, quel que soit le reste.
  const mariee = { ...lecture(0.24, 0.12), personId: "mariee" };
  expect(jugementNettete([mariee, lecture(0.3, 0.3)], ["mariee"])).toBe("flou");
});
const base: Analysis = {
  brightness: 0.5,
  sharpness: 90,
  sharpnessWidth: 1024,
  clipped: 0,
  dhash: "0".repeat(64),
  advice: "review",
  reasons: ["Peu de détails : vérifier la netteté"],
};
const avec = (reads: FaceRead[]) => ({ count: reads.length, closedEyes: 0, blink: 0, reads });
it("un portrait net sur fond flou n'est plus mis à vérifier", () => {
  // 50 photos livrées de l'album de mesure l'étaient, à cause de la règle
  // « peu de détails » qui juge l'image entière.
  const a = withFaces(base, avec([lecture(0.29)]));
  expect(a.reasons).toEqual([]);
  expect(a.advice).toBe("normal");
  expect(a.verdict).toMatch(/Visage net/);
});
it("un visage flou met la photo à vérifier, et le dit", () => {
  const a = withFaces({ ...base, sharpness: 900, reasons: [], advice: "normal" }, avec([lecture(0.25)]));
  expect(a.advice).toBe("review");
  expect(a.reasons).toEqual(["Visage principal flou : vérifier la netteté"]);
  expect(a.verdict).toBe("Visage principal flou.");
  const d = withFaces({ ...base, sharpness: 900, reasons: [], advice: "normal" }, avec([lecture(0.266)]));
  expect(d.reasons).toEqual(["Netteté du visage à vérifier à 100 %"]);
  expect(d.verdict).toMatch(/à vérifier/);
  // Relancer l'analyse ne cumule pas les raisons.
  expect(withFaces(a, avec([lecture(0.25)])).reasons).toEqual(["Visage principal flou : vérifier la netteté"]);
  // Et si le visage est devenu net, la raison s'en va.
  // Sur une image entière pauvre en détails, « Peu de détails » revient avec
  // le flou : il n'est retiré que quand le visage est mesuré net.
  expect(withFaces({ ...base, reasons: [], advice: "normal" }, avec([lecture(0.25)])).reasons).toEqual([
    "Visage principal flou : vérifier la netteté",
    "Peu de détails : vérifier la netteté",
  ]);
  expect(withFaces(a, avec([lecture(0.3)])).reasons).toEqual([]);
});
it("une analyse d'avant la 1.2.1 garde l'ancien jugement", () => {
  // Sans `nettete`, l'ancienne mesure décide encore, et « peu de détails » reste.
  const a = withFaces(base, avec([lecture(undefined, 0.2, { sharpness: 5 })]));
  expect(a.verdict).toBe("Visage principal flou.");
  expect(a.reasons).toContain("Peu de détails : vérifier la netteté");
  // Visage non mesuré sur une image peu détaillée : le verdict ne dit plus
  // « Visage net » à côté de la raison « Peu de détails » (29/09/2026).
  expect(verdictFor({ ...base, faces: { ...avec([lecture(undefined)]), version: "v4" } })).toBe("Netteté du visage à vérifier.");
  expect(verdictFor({ ...base, sharpness: 900, faces: { ...avec([lecture(undefined)]), version: "v4" } })).toMatch(/Visage net/);
});
it("un visage flou que l'ancienne mesure condamne est aussi mis à vérifier", () => {
  // La netteté manque (petite source, bande sans bord) : le verdict retombe
  // sur l'ancienne mesure, et la raison doit dire la même chose.
  const a = withFaces({ ...base, sharpness: 900, reasons: [], advice: "normal" }, avec([lecture(undefined, 0.2, { sharpness: 5 })]));
  expect(a.verdict).toBe("Visage principal flou.");
  expect(a.reasons).toEqual(["Visage principal flou : vérifier la netteté"]);
  expect(a.advice).toBe("review");
});
it("une relecture réussie efface l'échec d'une passe précédente", () => {
  const echec = { ...base, sharpness: 900, reasons: ["Visages non vérifiés : Délai dépassé pour l’analyse des visages."], advice: "review" as const };
  const a = withFaces(echec, avec([lecture(0.29)]));
  expect(a.reasons).toEqual([]);
  expect(a.advice).toBe("normal");
});
it("des visages lus sur la vignette seront relus quand l'original reviendra", () => {
  expect(withFaces(base, { ...avec([lecture(undefined)]), vignette: true }).faces?.version).not.toBe(VERSION_VISAGES);
  expect(withFaces(base, avec([lecture(0.29)])).faces?.version).toBe(VERSION_VISAGES);
});
const photo = (id: string, a: Analysis): Photo =>
  ({ id, projectId: "p", name: id, width: 6000, height: 4000, capturedAt: 1000, created: 1, status: "pending", analysis: a }) as unknown as Photo;
it("la personne désignée décide des raisons comme du verdict", () => {
  // La mariée, floue et plus petite, derrière un invité net : sans priorité,
  // l'invité « sauve » la photo ; une fois la mariée désignée, la raison de
  // flou doit revenir avec le verdict, sinon l'album la gardait d'office.
  const reads = [{ ...lecture(0.24, 0.2), personId: "mariee" }, lecture(0.3, 0.3)];
  const lue = withFaces({ ...base, sharpness: 900, reasons: [], advice: "normal" }, avec(reads));
  expect(lue.advice).toBe("normal");
  const [p] = groupSuggestions([photo("a", lue)], ["mariee"]);
  expect(p.analysis!.verdict).toMatch(/Visage principal flou/);
  expect(p.analysis!.reasons).toContain("Visage principal flou : vérifier la netteté");
  expect(p.analysis!.advice).toBe("review");
  // Et l'inverse : un invité flou devant la mariée nette ne la condamne plus.
  const inverse = withFaces({ ...base, sharpness: 900, reasons: [], advice: "normal" }, avec([lecture(0.24, 0.4), { ...lecture(0.3, 0.15), personId: "mariee" }]));
  expect(inverse.advice).toBe("review");
  const [q] = groupSuggestions([photo("b", inverse)], ["mariee"]);
  expect(q.analysis!.verdict).toMatch(/Visage net/);
  expect(q.analysis!.advice).toBe("normal");
});
it("une photo verticale n'est plus redécodée à chaque passe", () => {
  // Analysée à 683 × 1 024 : sa largeur d'analyse est 683.
  const a = { ...base, sharpnessWidth: 683 };
  expect(comparableSharpness(a, 4480, 6720)).toBe(true);
  expect(comparableSharpness({ ...base, sharpnessWidth: 320 }, 4480, 6720)).toBe(false);
  expect(comparableSharpness({ ...base, sharpnessWidth: 1024 }, 6720, 4480)).toBe(true);
});
it("le catalogue accepte les vieilles lectures et refuse une netteté absurde", () => {
  const projet = { id: "p", name: "Projet", kind: "Mariage", date: "2026-09-19", location: "", created: 1, demo: false };
  const cat = (nettete: unknown) =>
    validateCatalog(projet as never, [
      {
        id: "x", projectId: "p", name: "x.jpg", source: "idb", thumbnail: "", width: 10, height: 10, size: 10,
        created: 1, status: "pending", stars: 0, adjustments: DEFAULT, history: [],
        analysis: { ...base, faces: { count: 1, closedEyes: 0, blink: 0, reads: [{ ...lecture(0.29), nettete }] } },
      },
    ] as never);
  expect(() => cat(undefined)).not.toThrow();
  expect(() => cat(0.29)).not.toThrow();
  expect(() => cat(2)).toThrow();
});
