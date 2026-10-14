import { it, expect } from "vitest";
import {
  parseXmp,
  learnFromXmp,
  MAPPED,
  UNMAPPED,
  MIN_SAMPLES,
  type LightroomSettings,
} from "../src/modules/xmp";
/** Un XMP réel de l'album de Johan, réduit à ce qui nous intéresse. */
const REEL = `<?xpacket begin="﻿"?><x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:Description crs:CustomTemperature="5321" crs:Temperature="5321"
  crs:CustomTint="19" crs:Tint="19" crs:WhiteBalance="Custom"
  crs:Blacks2012="-17" crs:Whites2012="0" crs:Exposure2012="-0.20040198"
  crs:Shadows2012="18" crs:Highlights2012="-5" crs:Contrast2012="5"
  crs:Saturation="0" crs:Vibrance="3" crs:Clarity2012="-5" crs:Texture="5"
  crs:Dehaze="0" crs:Sharpness="39" crs:SharpenRadius="1"/></x:xmpmeta>`;
it("un XMP réel est lu, chaque réglage à sa place", () => {
  const lu = parseXmp(REEL)!;
  expect(lu.exposure).toBeCloseTo(-0.2004, 4);
  expect(lu.shadows).toBe(18);
  expect(lu.blacks).toBe(-17);
  expect(lu.clarity).toBe(-5);
  expect(lu.vibrance).toBe(3);
  expect(lu.temperature).toBe(5321);
  // Lightroom va de -150 à +150, Juno de -100 à +100.
  expect(lu.tint).toBeCloseTo(19 * (2 / 3), 4);
  // Lightroom va de 0 à 150, Juno de 0 à 100.
  expect(lu.sharpening).toBeCloseTo(39 * (100 / 150), 4);
});
it("un fichier qui n'est pas un XMP Lightroom ne produit rien", () => {
  expect(parseXmp("")).toBeUndefined();
  expect(parseXmp("<html>bonjour</html>")).toBeUndefined();
  // Un XMP sans aucun réglage connu ne compte pas non plus.
  expect(parseXmp('<x crs:Autre="3"/>')).toBeUndefined();
  // Une valeur illisible est ignorée sans faire tomber la lecture.
  expect(parseXmp('<x crs:Shadows2012="beaucoup" crs:Contrast2012="4"/>')).toEqual(
    { contrast: 4 },
  );
});
/** Un album : une signature constante, deux réglages qui varient. */
const album = (n = 100): LightroomSettings[] =>
  Array.from({ length: n }, (_, i) => ({
    shadows: 21 + (i % 3) - 1,
    clarity: -5,
    contrast: 2,
    vibrance: 2,
    // Ceux-là bougent vraiment d'une image à l'autre.
    exposure: -0.33 + ((i % 20) - 10) / 12,
    highlights: -11 - (i % 30),
    // Jamais touchés : ce sont les réglages d'origine de Lightroom.
    whites: 0,
    saturation: 0,
    sharpening: 40 * (100 / 150),
    // La balance des blancs, telle que Lightroom l'écrit : en kelvins absolus.
    temperature: 5400 + (i % 40) * 20,
    tint: 18 * (2 / 3),
    texture: 4,
    dehaze: 0,
  }));
it("la signature ne retient que ce qui est constant ET choisi", () => {
  const p = learnFromXmp(album());
  expect(p.signature).toEqual({
    shadows: 21,
    clarity: -5,
    contrast: 2,
    vibrance: 2,
  });
  // Ce qui n'a jamais été touché n'entre ni dans la signature ni dans le biais.
  expect(p.signature).not.toHaveProperty("whites");
  expect(p.signature).not.toHaveProperty("saturation");
  expect(p.bias).not.toHaveProperty("whites");
});
it("un réglage qui varie donne un biais, pas une valeur fixe", () => {
  const p = learnFromXmp(album());
  expect(p.signature).not.toHaveProperty("exposure");
  expect(p.signature).not.toHaveProperty("highlights");
  expect(p.bias.exposure).toBeCloseTo(-0.33, 1);
  expect(p.bias.highlights).toBeLessThan(-10);
  expect(p.adaptive.map((r) => r.field)).toContain("exposure");
});
it("la netteté de Lightroom n'est jamais transposée", () => {
  // Quatre paramètres liés chez Adobe, un seul chez Juno, et 40 par défaut
  // sur tout fichier brut : le nombre n'a pas le même sens des deux côtés.
  const p = learnFromXmp(album());
  expect(p.signature).not.toHaveProperty("sharpening");
  expect(p.bias).not.toHaveProperty("sharpening");
  expect(p.ignored).toContain("sharpening");
  expect(UNMAPPED).toContain("sharpening");
  expect(MAPPED).not.toContain("sharpening" as never);
});
it("la balance des blancs n'est pas apprise, et c'est dit", () => {
  // Lightroom écrit des kelvins absolus : sans la balance d'origine du
  // boîtier, on ne sait pas quel décalage a été appliqué.
  const p = learnFromXmp(album());
  expect(p.signature).not.toHaveProperty("warmth");
  expect(p.ignored).toContain("temperature");
  expect(p.ignored).toContain("tint");
});
it("un album trop petit n'apprend rien du tout", () => {
  const p = learnFromXmp(album(MIN_SAMPLES - 1));
  expect(p.signature).toEqual({});
  expect(p.bias).toEqual({});
  expect(p.readings).toEqual([]);
  expect(learnFromXmp([]).signature).toEqual({});
});
it("une photo aberrante ne déplace pas la signature", () => {
  // La médiane, pas la moyenne : un seul fichier retouché n'importe comment
  // ne doit pas emporter le style de tout l'album.
  const normal = album(200);
  const avecFou = [
    ...normal,
    ...Array.from({ length: 3 }, () => ({
      shadows: 100,
      clarity: 90,
      contrast: 80,
      vibrance: 95,
    })),
  ];
  expect(learnFromXmp(avecFou).signature).toEqual(
    learnFromXmp(normal).signature,
  );
});
