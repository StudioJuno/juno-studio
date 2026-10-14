import { it, expect } from "vitest";
import {
  autoTone,
  learnProfile,
  PROFILE_MIN_SAMPLES,
  sceneSettings,
  sensible,
  type StyleProfile,
} from "../src/modules/auto-tone";
import { learnFromXmp, parseXmp } from "../src/modules/xmp";
import type { Analysis } from "../src/model";

/**
 * Deux défauts de la première passe de retouche relevés le 29/09/2026 :
 * - le style appris dérivait sans limite quand un style Lightroom imposait le
 *   contraste ou la saturation ;
 * - une photo « sensible » (sombre ou très claire) d'une scène de RAW était
 *   tirée vers la médiane de sa scène.
 */
const a = {
  brightness: 0.4,
  clipped: 0,
  cast: { r: 0.5, g: 0.5, b: 0.5 },
  sharpness: 1,
  sharpnessWidth: 320,
  dhash: "",
  advice: "normal",
  reasons: [],
} as Analysis;
const stats = { cast: a.cast!, brightness: a.brightness, clipped: a.clipped };
// Quarante retouches Lightroom : contraste toujours à +8, saturation à −10,
// exposition ajustée photo par photo. Le style Lightroom en fait une signature.
const xmp = learnFromXmp(
  Array.from({ length: 40 }, (_, i) =>
    parseXmp(
      `<x crs:Exposure2012="${i % 2 ? "+0.20" : "-0.10"}" crs:Contrast2012="+8" crs:Saturation="-10"/>`,
    )!,
  ),
);

it("le style appris reste borné quand un style Lightroom impose le contraste", () => {
  expect(xmp.signature).toMatchObject({ contrast: 8, saturation: -10 });
  let profil: StyleProfile = { samples: 0 };
  const contraste: number[] = [],
    saturation: number[] = [];
  for (let i = 0; i < 400; i++) {
    // La proposition de la passe d'album (jobs.ts, proposition()).
    const proposee = autoTone(a, stats, profil, xmp);
    contraste.push(proposee.contrast!);
    saturation.push(proposee.saturation!);
    // Le photographe remonte toujours le contraste à +15 et la saturation à 0.
    profil = learnProfile(
      [{ proposed: proposee, final: { ...proposee, contrast: 15, saturation: 0 } }],
      profil,
    );
  }
  // Avant : contraste appris à +8,8 après 51 corrections, +17,8 après 101,
  // +35,7 après 201, +71,3 après 400 (saturation +99,6), sans fin.
  // Le profil apprend l'écart au style Lightroom (+7, +10), pas plus.
  expect(profil.contrast!).toBeGreaterThan(6.5);
  expect(profil.contrast!).toBeLessThanOrEqual(7.01);
  expect(profil.saturation!).toBeGreaterThan(9.5);
  expect(profil.saturation!).toBeLessThanOrEqual(10.01);
  // Et la proposition rejoint l'habitude du photographe sans la dépasser.
  expect(contraste.at(-1)).toBeGreaterThan(14.5);
  expect(Math.max(...contraste)).toBeLessThanOrEqual(15.01);
  expect(saturation.at(-1)).toBeGreaterThan(-0.5);
  expect(Math.max(...saturation)).toBeLessThanOrEqual(0.01);
  // « Oublier ce style » (AlbumAction.tsx) : la proposition reste raisonnable
  // (avant : contraste +71, saturation +99,6), puis le profil rejoint
  // l'habitude entière.
  const sansLightroom = autoTone(a, stats, profil);
  expect(sansLightroom.contrast!).toBeGreaterThan(0);
  expect(sansLightroom.contrast!).toBeLessThanOrEqual(15);
  for (let i = 0; i < 400; i++) {
    const proposee = autoTone(a, stats, profil);
    profil = learnProfile([{ proposed: proposee, final: { ...proposee, contrast: 15 } }], profil);
  }
  expect(profil.contrast!).toBeGreaterThan(14.5);
  expect(profil.contrast!).toBeLessThanOrEqual(15.01);
});

it("un photographe qui garde le style Lightroom n'apprend rien sur le contraste", () => {
  let profil: StyleProfile = { samples: PROFILE_MIN_SAMPLES * 10 };
  for (let i = 0; i < 200; i++) {
    const proposee = autoTone(a, stats, profil, xmp);
    // Il ne touche qu'à l'exposition.
    profil = learnProfile([{ proposed: proposee, final: { ...proposee, exposure: 0.4 } }], profil);
  }
  expect(profil.contrast ?? 0).toBe(0);
  expect(autoTone(a, stats, profil, xmp).contrast).toBe(8);
});

it("le style Lightroom ne remplace toujours pas ce que Juno mesure, et le style appris s'ajoute à tout", () => {
  const profil = { samples: 50, contrast: 5, exposure: 0.2, warmth: 4 };
  const p = autoTone(a, stats, profil, xmp);
  expect(p.contrast).toBe(13);
  expect(p.saturation).toBe(-10);
  // L'exposition reste mesurée sur l'image, style appris compris.
  expect(p.exposure).toBeCloseTo(Math.log2(0.46 / 0.4) + 0.2, 2);
  expect(p.warmth).toBe(4);
});

it("une photo sensible garde son exposition dans sa scène, RAW comme JPEG", () => {
  // Trois RAW d'une même scène : deux normales (aperçu 0,3, rendu 0,19) et
  // une volontairement sombre (aperçu 0,12, rendu 0,076).
  const raw = (apercu: number, rendu: number) =>
    ({ ...a, brightness: apercu, rendu: { version: 1, brightness: rendu, clipped: 0, cast: a.cast } }) as Analysis;
  const R = [raw(0.3, 0.19), raw(0.3, 0.19), raw(0.12, 0.076)];
  const ecarts = R.map((x) => Math.log2((x as { rendu: { brightness: number } }).rendu.brightness / x.brightness));
  expect(R.map(sensible)).toEqual([false, false, true]);
  const h = sceneSettings(
    R.map((x) => autoTone(x, stats)),
    undefined,
    ecarts,
    R.map(sensible),
  );
  // Seul le rattrapage de l'écart : elle ressort comme dans l'aperçu.
  // Avant : +1,03 IL, tirée vers la scène (0,15 au lieu de 0,12 à l'export).
  expect(h[2].exposure).toBeCloseTo(-ecarts[2], 2);
  expect(0.076 * 2 ** h[2].exposure!).toBeCloseTo(0.12, 2);
  // Les deux autres ne changent pas.
  expect(h[0].exposure).toBeCloseTo(Math.log2(0.46 / 0.19), 1);
  // Le même trio en JPEG : l'exposition de la sombre n'est pas touchée.
  const J = [0.3, 0.3, 0.12].map((b) => ({ ...a, brightness: b }) as Analysis);
  const hj = sceneSettings(J.map((x) => autoTone(x, stats)), undefined, [], J.map(sensible));
  expect(hj[2].exposure).toBeUndefined();
  // Très claire aussi : aperçu 0,9 parmi des photos à 0,75.
  const C = [raw(0.75, 0.5), raw(0.75, 0.5), raw(0.9, 0.6)];
  const ec = C.map((x) => Math.log2((x as { rendu: { brightness: number } }).rendu.brightness / x.brightness));
  const hc = sceneSettings(C.map((x) => autoTone(x, stats)), undefined, ec, C.map(sensible));
  expect(hc[2].exposure).toBeCloseTo(-ec[2], 2);
  // Sa couleur, elle, s'harmonise toujours avec la scène.
  const chaud = [{ warmth: 0 }, { warmth: 0 }, { warmth: 30, exposure: 0.5 }];
  const hw = sceneSettings(chaud, undefined, [], [false, false, true]);
  expect(hw[2].warmth!).toBeLessThan(30);
  expect(hw[2].exposure).toBe(0.5);
});
