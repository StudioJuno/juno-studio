import { it, expect, beforeEach } from "vitest";
import {
  readXmpProfile,
  writeXmpProfile,
  forgetXmpProfile,
  learnFromFolder,
  describeProfile,
} from "../src/modules/xmp-store";
import { applyXmpProfile, MIN_SAMPLES } from "../src/modules/xmp";
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});
const attributs = (o: Record<string, number | string>) =>
  Object.entries(o)
    .map(([k, v]) => `crs:${k}="${v}"`)
    .join(" ");
const dossier = (n: number) => ({
  nom: "Audrey-Ann et Clément",
  fichiers: Array.from({ length: n }, (_, i) =>
    attributs({
      Shadows2012: 21,
      Clarity2012: -5,
      Vibrance: 2,
      Blacks2012: -12,
      Exposure2012: -0.33 + ((i % 10) - 5) / 10,
      Whites2012: 0,
      Temperature: 5400,
    }),
  ),
});
it("un dossier Lightroom donne un style, avec sa provenance", () => {
  const p = learnFromFolder(dossier(100));
  expect(p.samples).toBe(100);
  expect(p.source).toBe("Audrey-Ann et Clément");
  // La signature est bien lue, même si tout n'en est pas transposé.
  expect(p.signature.shadows).toBe(21);
  expect(p.signature.clarity).toBe(-5);
  expect(describeProfile(p)).toContain("Audrey-Ann et Clément");
  expect(describeProfile(p)).toContain("ombres +21");
});
it("le style relu est identique à celui qui a été rangé", () => {
  const p = learnFromFolder(dossier(100));
  writeXmpProfile(p);
  expect(readXmpProfile()).toEqual(p);
  forgetXmpProfile();
  expect(readXmpProfile()).toBeUndefined();
});
it("un stockage local abîmé est oublié, jamais appliqué", () => {
  // Ce fichier est modifiable à la main : on ne fait confiance qu'à sa forme.
  for (const mauvais of [
    "pas du json",
    "null",
    '{"samples":"beaucoup"}',
    '{"samples":100}',
    '{"samples":100,"signature":{"shadows":"vingt"}}',
    '{"samples":100,"signature":[]}',
    '{"samples":100,"signature":{},"bias":[]}',
    '{"samples":100,"signature":{},"bias":{"shadows":null}}',
  ]) {
    store.set("juno-xmp-profile", mauvais);
    expect(readXmpProfile()).toBeUndefined();
  }
});
it("un style appris sur trop peu de photos ne change rien", () => {
  const maigre = learnFromFolder(dossier(MIN_SAMPLES - 1));
  const depart = { exposure: -0.2, shadows: 7 };
  expect(applyXmpProfile(depart, maigre)).toEqual(depart);
  expect(applyXmpProfile(depart, undefined)).toEqual(depart);
});
it("le style remplace ce qui est constant et laisse ce que Juno mesure", () => {
  const p = learnFromFolder(dossier(200));
  const propose = { exposure: -0.11, highlights: -8, shadows: 7, warmth: 3 };
  const sorti = applyXmpProfile(propose, p);
  // Les ombres sont invariables chez le photographe, mais Juno les calcule :
  // mesuré, transposer le nombre éloignait le résultat du rendu livré, parce
  // que « Ombres » n'est pas le même algorithme dans les deux logiciels.
  expect(sorti.shadows).toBe(7);
  // Les noirs ne sont pas calculés par Juno : la médiane vaut mieux que zéro.
  expect(sorti.blacks).toBe(-12);
  // L'exposition et les hautes lumières dépendent de CETTE image : intactes.
  expect(sorti.exposure).toBe(-0.11);
  expect(sorti.highlights).toBe(-8);
  // La balance des blancs mesurée sur l'image n'est jamais écrasée.
  expect(sorti.warmth).toBe(3);
});
it("un dossier sans aucune régularité ne fabrique pas de style", () => {
  const bruit = {
    nom: "mélange",
    fichiers: Array.from({ length: 200 }, (_, i) =>
      attributs({ Shadows2012: (i * 37) % 100, Clarity2012: ((i * 53) % 100) - 50 }),
    ),
  };
  const p = learnFromFolder(bruit);
  expect(p.signature).toEqual({});
  expect(describeProfile(p)).toContain("aucune régularité");
});
