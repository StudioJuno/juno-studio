import { it, expect } from "vitest";
import fs from "node:fs";
import { vers8Bits } from "../src/modules/raster";
import {
  autoTone,
  baseTone,
  ecartDuRendu,
  mesureDuRendu,
  renduDe,
  sceneSettings,
  VERSION_RENDU,
  whiteBalance,
} from "../src/modules/auto-tone";
import { applyLocalEdits } from "../src/modules/local-edits";
import { processRaster } from "../src/modules/pipeline";
import { effectiveCrop } from "../src/modules/geometry";
import { transform } from "../src/pixels";
import { parseXmp } from "../src/modules/xmp";
import { raisonDetourage, type SubjectMask } from "../src/modules/subject";
import { DEFAULT, type Analysis, type LocalEdit } from "../src/model";

/**
 * Les défauts de la retouche et de l'export relevés le 29/09/2026, un test
 * par correction. Les parcours dans la vraie application (RAW réels, export,
 * détourage) sont dans le dossier de preuves de la livraison.
 */

it("16 bits vers 8 bits : le même arrondi que Math.round(n / 257), sans Array.from", () => {
  const tout = new Uint16Array(65536).map((_, i) => i);
  const huit = vers8Bits(tout);
  for (let n = 0; n < 65536; n++) expect(huit[n]).toBe(Math.round(n / 257));
  // Un RAW de 30 Mpx en RVBA : la conversion qui plantait la fenêtre.
  const grand = new Uint16Array(6742 * 4498 * 4).fill(40000);
  const debut = performance.now();
  const r = vers8Bits(grand);
  expect(r.length).toBe(grand.length);
  expect(r[r.length - 1]).toBe(156);
  expect(performance.now() - debut).toBeLessThan(5000);
});

const analyse = (over: Partial<Analysis> = {}): Analysis => ({
  brightness: 0.8,
  sharpness: 500,
  clipped: 0.2,
  dhash: "0".repeat(64),
  advice: "normal",
  reasons: [],
  cast: { r: 0.55, g: 0.5, b: 0.42 },
  ...over,
});
const rendu = (brightness: number, cast = { r: 0.5, g: 0.5, b: 0.47 }) => ({
  version: VERSION_RENDU,
  brightness,
  clipped: 0.02,
  cast,
});

it("un RAW : l'exposition vise le rendu de Juno, pas l'aperçu du boîtier", () => {
  // Chiffres mesurés sur 4R7A1611.CR3 : aperçu 0,798, rendu LibRaw 0,563.
  const a = analyse({ brightness: 0.798, clipped: 0.205 });
  const avant = autoTone(a, { cast: a.cast!, brightness: a.brightness, clipped: a.clipped });
  expect(avant.exposure).toBeCloseTo(-0.79, 2);
  const avecRendu = { ...a, rendu: rendu(0.563) } as Analysis;
  const apres = autoTone(avecRendu, { cast: a.cast!, brightness: a.brightness, clipped: a.clipped });
  // log2(0,46 / 0,798) − log2(0,563 / 0,798) = log2(0,46 / 0,563)
  expect(apres.exposure).toBeCloseTo(Math.log2(0.46 / 0.563), 1);
  // Hautes lumières et ombres : décidées comme sur le JPEG du boîtier.
  expect(apres.highlights).toBe(baseTone(a).highlights);
  expect(apres.shadows).toBe(baseTone(a).shadows);
  // La dominante se lit sur le rendu, là où la chaleur s'applique.
  expect(apres.warmth).toBe(whiteBalance({ cast: rendu(0.563).cast, brightness: 0.563, clipped: 0.02 }).warmth);
});

it("un RAW volontairement sombre retrouve le rendu du boîtier au lieu de celui de LibRaw", () => {
  const nuit = { ...analyse({ brightness: 0.1, clipped: 0 }), rendu: rendu(0.05) } as Analysis;
  expect(autoTone(nuit).exposure).toBeCloseTo(1, 2);
  // Sans mesure du rendu (JPEG, TIFF), rien ne change.
  expect(autoTone(analyse({ brightness: 0.1 })).exposure).toBeUndefined();
});

it("une mesure du rendu d'une autre version, ou aberrante, est ignorée ou bornée", () => {
  const vieille = { ...analyse(), rendu: { ...rendu(0.5), version: VERSION_RENDU - 1 } } as Analysis;
  expect(renduDe(vieille)).toBeUndefined();
  expect(ecartDuRendu(vieille)).toBe(0);
  const noire = { ...analyse({ brightness: 0.5 }), rendu: rendu(0) } as Analysis;
  expect(ecartDuRendu(noire)).toBe(-2);
});

it("la mesure du rendu lit la luminosité, l'écrêtage, la dominante et le rendu", () => {
  const d = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 150;
    d[i + 1] = 120;
    d[i + 2] = 100;
    d[i + 3] = 255;
  }
  const m = mesureDuRendu(d, 64, 64);
  expect(m.version).toBe(VERSION_RENDU);
  expect(m.brightness).toBeCloseTo((0.2126 * 150 + 0.7152 * 120 + 0.0722 * 100) / 255, 3);
  expect(m.clipped).toBe(0);
  expect(m.cast.r).toBeGreaterThan(m.cast.b);
  expect(m.look?.mid).toBeGreaterThan(0);
});

it("une scène qui mêle RAW et JPEG s'harmonise sur l'exposition vue comme un JPEG", () => {
  // Trois photos de la même lumière : deux JPEG et un RAW que Juno développe
  // 0,8 IL plus sombre que son aperçu. Toutes visent la même image.
  const reglages = [{ exposure: 0.1 }, { exposure: 0.12 }, { exposure: 0.9 }];
  const ecarts = [0, 0, -0.8];
  const h = sceneSettings(reglages, 0.6, ecarts);
  // Le RAW garde son rattrapage : sans les écarts, il était tiré vers 0,12.
  // Vues comme des JPEG : 0,1 ; 0,12 ; 0,1. Médiane 0,1 : le RAW reste à 0,9.
  expect(h[2].exposure).toBeCloseTo(0.9, 2);
  expect(sceneSettings(reglages, 0.6)[2].exposure!).toBeLessThan(0.5);
});
/** Deux personnes : l'une à gauche, l'autre à droite. */
const moitie = (gauche: boolean): SubjectMask => {
  const data = new Uint8ClampedArray(8 * 8);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) data[y * 8 + x] = (x < 4) === gauche ? 255 : 0;
  return { width: 8, height: 8, data };
};
const sujet = (id: string, amount: number): LocalEdit => ({
  id,
  name: "Sujet détouré",
  tool: "subject",
  points: [{ x: 0.5, y: 0.5 }],
  radius: 0,
  amount,
  opacity: 1,
  visible: true,
});
it("deux calques « Sujet détouré » agissent chacun sur sa personne", () => {
  const d = new Uint8ClampedArray(8 * 8 * 4).fill(100);
  const masques = new Map([
    ["gauche", moitie(true)],
    ["droite", moitie(false)],
  ]);
  applyLocalEdits(d, 8, 8, [sujet("gauche", 1), sujet("droite", -1)], (e) => masques.get(e.id));
  // Gauche : un diaphragme de plus ; droite : un de moins.
  expect(d[0]).toBe(200);
  expect(d[(0 * 8 + 7) * 4]).toBe(50);
  // Un calque sans masque connu ne touche à rien.
  const e = new Uint8ClampedArray(8 * 8 * 4).fill(100);
  applyLocalEdits(e, 8, 8, [sujet("inconnu", 1)], (c) => masques.get(c.id));
  expect(e[0]).toBe(100);
});

it("« Recadrage centré » agit à l'intérieur du cadre libre", () => {
  const cadre = { x: 0.2, y: 0.2, w: 0.6, h: 0.5 };
  expect(effectiveCrop({ cropRect: cadre, crop: 0 }, 400, 300)).toEqual(cadre);
  const c = effectiveCrop({ cropRect: cadre, crop: 30 }, 400, 300);
  expect(c.w).toBeCloseTo(0.42, 6);
  expect(c.h).toBeCloseTo(0.35, 6);
  // Même centre, même format.
  expect(c.x + c.w / 2).toBeCloseTo(0.5, 6);
  expect(c.y + c.h / 2).toBeCloseTo(0.45, 6);
  // Et le rendu change bien : le cadre recadré est plus petit.
  const img = { width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4).fill(128), bitDepth: 8 };
  const sans = processRaster(img, { ...DEFAULT, cropRect: cadre }, 0);
  const avec = processRaster(img, { ...DEFAULT, cropRect: cadre, crop: 30 }, 0);
  expect(avec.width).toBeLessThan(sans.width);
});

const unie = () => ({
  width: 400,
  height: 300,
  data: new Uint8ClampedArray(400 * 300 * 4).fill(200),
  bitDepth: 8,
});
const colonne = (r: { width: number; height: number; data: ArrayLike<number> }, x: number) => {
  let s = 0;
  for (let y = 0; y < r.height; y++) s += r.data[(y * r.width + x) * 4];
  return s / r.height;
};
it("le vignettage se centre sur le cadre, pas sur la photo entière", () => {
  // Le cas de la relecture : cadre à gauche de la photo, vignettage 80.
  const r = processRaster(unie(), { ...DEFAULT, vignette: 80, cropRect: { x: 0, y: 0.25, w: 0.4, h: 0.5 } }, 0);
  const gauche = colonne(r, 0),
    droite = colonne(r, r.width - 1),
    centre = colonne(r, Math.floor(r.width / 2));
  expect(Math.abs(gauche - droite)).toBeLessThan(2);
  expect(centre).toBeGreaterThan(gauche + 10);
  // Avec un redressement aussi, les deux bords du cadre restent égaux.
  const redresse = processRaster(unie(), { ...DEFAULT, vignette: 80, straighten: 3, cropRect: { x: 0.1, y: 0.25, w: 0.4, h: 0.5 } }, 0);
  expect(Math.abs(colonne(redresse, 0) - colonne(redresse, redresse.width - 1))).toBeLessThan(3);
});
it("sans cadre, le vignettage est exactement l'ancien", () => {
  const d = new Uint8ClampedArray(40 * 30 * 4).fill(200);
  transform(d, 40, 30, { ...DEFAULT, vignette: 60 });
  for (let p = 0; p < 40 * 30; p++) {
    const x = (p % 40) / 40 - 0.5,
      y = Math.floor(p / 40) / 30 - 0.5,
      vin = 1 - 0.6 * Math.min(1, (x * x + y * y) * 1.7);
    expect(d[p * 4]).toBe(Math.round(Math.max(0, Math.min(1, (200 / 255) * vin)) * 255));
  }
});

it("les valeurs Lightroom écrites avec un « + » sont lues", () => {
  const xmp = fs.readFileSync(__dirname + "/fixtures/xmp/lightroom-retouche.xmp", "utf8");
  expect(parseXmp(xmp)?.exposure).toBeCloseTo(0.3, 5);
  const texte = (v: string) => `<x:xmpmeta><rdf:Description crs:Contrast2012="${v}" crs:Vibrance="+10"/></x:xmpmeta>`;
  expect(parseXmp(texte("+8"))?.contrast).toBe(8);
  expect(parseXmp(texte("-8"))?.contrast).toBe(-8);
  expect(parseXmp(texte("8"))?.contrast).toBe(8);
  expect(parseXmp(texte("+8"))?.vibrance).toBe(10);
  // La forme en élément aussi.
  expect(parseXmp("<crs:Exposure2012>+0.45</crs:Exposure2012>")?.exposure).toBeCloseTo(0.45, 5);
});

it("les erreurs du détourage sont dites en français", () => {
  expect(raisonDetourage(Error("The source image could not be decoded."))).toBe(
    "Juno n’a pas pu lire cette photo pour la détourer.",
  );
  expect(raisonDetourage(Error("Rien de reconnaissable à cet endroit."))).toBe("Rien de reconnaissable à cet endroit.");
  expect(raisonDetourage(Error("Session closed"))).toMatch(/^Le détourage a échoué\. Détail technique : Session closed/);
});
