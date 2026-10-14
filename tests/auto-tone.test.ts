import { it, expect, beforeEach } from "vitest";
import {
  autoTone,
  applyProfile,
  baseTone,
  learnProfile,
  measureCast,
  PROFILE_MIN_SAMPLES,
  sceneGroups,
  sceneSettings,
  whiteBalance,
} from "../src/modules/auto-tone";
import {
  correctionOf,
  forgetProfile,
  profileStatus,
  readProfile,
  rememberCorrection,
} from "../src/modules/style-profile";
import type { Analysis, Photo } from "../src/model";
// The profile lives in the renderer's storage; tests run without a browser.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
const frame = (r: number, g: number, b: number, w = 8, h = 8) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    data[p * 4] = r;
    data[p * 4 + 1] = g;
    data[p * 4 + 2] = b;
    data[p * 4 + 3] = 255;
  }
  return { data, w, h };
};
it("a neutral frame asks for no white balance at all", () => {
  const { data, w, h } = frame(128, 128, 128);
  const balance = whiteBalance(measureCast(data, w, h));
  expect(balance.warmth).toBe(0);
  expect(balance.tint).toBe(0);
});
it("a blue cast is warmed up and an orange cast is cooled down", () => {
  const blue = whiteBalance(
    measureCast(
      ...(Object.values(frame(100, 120, 170)) as [any, number, number]),
    ),
  );
  expect(blue.warmth).toBeGreaterThan(5);
  const orange = whiteBalance(
    measureCast(
      ...(Object.values(frame(180, 130, 90)) as [any, number, number]),
    ),
  );
  expect(orange.warmth).toBeLessThan(-5);
});
it("the correction stays bounded, whatever the cast", () => {
  const extreme = whiteBalance(
    measureCast(
      ...(Object.values(frame(250, 40, 30)) as [any, number, number]),
    ),
  );
  expect(Math.abs(extreme.warmth)).toBeLessThanOrEqual(35);
  expect(Math.abs(extreme.tint)).toBeLessThanOrEqual(25);
  expect(whiteBalance(undefined)).toEqual({ warmth: 0, tint: 0 });
});
it("blown and blocked pixels never vote on the colour of a scene", () => {
  const w = 10,
    h = 10,
    data = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    // Half pure white, half a neutral mid grey: only the grey should count.
    const white = p % 2 === 0;
    data[p * 4] = white ? 255 : 128;
    data[p * 4 + 1] = white ? 255 : 128;
    data[p * 4 + 2] = white ? 255 : 128;
    data[p * 4 + 3] = 255;
  }
  const stats = measureCast(data, w, h);
  expect(stats.cast.r).toBeCloseTo(0.502, 2);
  expect(whiteBalance(stats).warmth).toBe(0);
});
const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  brightness: 0.46,
  sharpness: 900,
  sharpnessWidth: 1024,
  clipped: 0.01,
  dhash: "0".repeat(64),
  advice: "normal",
  reasons: [],
  ...over,
});
it("a dark frame is lifted, a very dark one is left alone", () => {
  expect(baseTone(analysis({ brightness: 0.2 })).exposure).toBeGreaterThan(0.5);
  // Below the sensitive threshold autoTone keeps the exposure untouched.
  expect(autoTone(analysis({ brightness: 0.05 })).exposure).toBeUndefined();
  expect(autoTone(analysis({ brightness: 0.95 })).exposure).toBeUndefined();
  // But its colour cast is still corrected, because a cast is never a choice.
  const cast = autoTone(analysis({ brightness: 0.05 }), {
    cast: { r: 0.35, g: 0.42, b: 0.6 },
    brightness: 0.05,
    clipped: 0,
  });
  expect(cast.warmth).toBeGreaterThan(0);
});
it("a profile only steers once it has seen enough corrections", () => {
  const settings = { exposure: 0, warmth: 0 };
  expect(applyProfile(settings, { exposure: 0.5, samples: 3 })).toEqual(
    settings,
  );
  const steered = applyProfile(settings, {
    exposure: 0.5,
    samples: PROFILE_MIN_SAMPLES,
  });
  expect(steered.exposure).toBe(0.5);
});
it("learning takes the median, so one odd album cannot capture the style", () => {
  const corrections = [
    { proposed: { exposure: 0 }, final: { exposure: 0.2 } },
    { proposed: { exposure: 0 }, final: { exposure: 0.25 } },
    { proposed: { exposure: 0 }, final: { exposure: 0.2 } },
    { proposed: { exposure: 0 }, final: { exposure: 4 } },
  ];
  const profile = learnProfile(corrections);
  // La médiane des quatre (0,25), pas la moyenne (1,16) que tirerait la
  // photo à +4. La borne d'origine (< 0,1) ne mesurait que la lenteur de
  // l'apprentissage : quatre photos ne pesaient que 0,1, si bien que cent
  // corrections laissaient le profil loin de l'habitude. Un profil vide prend
  // désormais la médiane lue (voir learnProfile, relecture du 29/09/2026).
  expect(profile.exposure).toBeGreaterThanOrEqual(0.2);
  expect(profile.exposure).toBeLessThanOrEqual(0.25);
  expect(profile.samples).toBe(4);
});
/**
 * La vraie boucle : la proposition porte le profil (applyProfile), le
 * photographe corrige toujours vers la même habitude. Le profil doit tendre
 * vers cette habitude, pas vers sa moitié (+4,9 pour +10 de chaleur avant la
 * relecture du 29/09/2026), sans la dépasser.
 */
it("le style appris rejoint l'habitude du photographe, pas sa moitié", () => {
  let profil = learnProfile([]);
  const proposees: number[] = [];
  for (let album = 0; album < 40; album++) {
    const proposee = applyProfile({ warmth: 0, exposure: 0.2 }, profil);
    proposees.push(proposee.warmth!);
    // Dix photos corrigées par album, toutes à +10 de chaleur.
    const corrections = Array.from({ length: 10 }, () => ({
      proposed: proposee,
      final: { ...proposee, warmth: 10 },
    }));
    profil = learnProfile(corrections, profil);
  }
  expect(proposees.at(-1)).toBeGreaterThan(9.5);
  expect(Math.max(...proposees)).toBeLessThanOrEqual(10.01);
});
it("corriger un autre réglage n'efface pas ce qui a été appris", () => {
  let profil = { warmth: 10, samples: 200 };
  for (let i = 0; i < 100; i++) {
    const proposee = applyProfile({ warmth: 0, exposure: 0 }, profil);
    // Le photographe garde la chaleur proposée et ne touche qu'à l'exposition.
    profil = learnProfile(
      [{ proposed: proposee, final: { ...proposee, exposure: 0.3 } }],
      profil,
    ) as typeof profil;
  }
  expect(profil.warmth).toBe(10);
});
it("a profile keeps a field it saw nothing new about", () => {
  const first = learnProfile(
    [{ proposed: { warmth: 0 }, final: { warmth: 6 } }],
    undefined,
  );
  const second = learnProfile([], first);
  expect(second.warmth).toBe(first.warmth);
});
const photo = (id: string, capturedAt: number, brightness: number): Photo =>
  ({
    id,
    projectId: "p",
    name: id,
    capturedAt,
    created: capturedAt,
    analysis: analysis({ brightness }),
    adjustments: {},
  }) as unknown as Photo;
it("a scene breaks on a gap in time or a jump in light", () => {
  const scenes = sceneGroups([
    photo("a", 0, 0.5),
    photo("b", 60000, 0.52),
    photo("c", 120000, 0.51),
    // Ten minutes later: new scene.
    photo("d", 900000, 0.5),
    // Same moment but the light collapsed: new scene too.
    photo("e", 960000, 0.15),
  ]);
  expect(scenes.map((s) => s.length)).toEqual([3, 1, 1]);
});
it("a scene shares one look instead of drifting frame by frame", () => {
  const drifting = [
    { exposure: 0.1, warmth: 2 },
    { exposure: 0.15, warmth: 3 },
    { exposure: 1, warmth: 30 },
  ];
  const tuned = sceneSettings(drifting);
  // The outlier is pulled back towards its neighbours, not erased.
  expect(tuned[2].exposure!).toBeLessThan(drifting[2].exposure);
  expect(tuned[2].exposure!).toBeGreaterThan(drifting[1].exposure);
  expect(tuned[2].warmth!).toBeLessThan(drifting[2].warmth);
  // Two photos are not a scene: nothing is harmonised.
  expect(sceneSettings(drifting.slice(0, 2))).toEqual(drifting.slice(0, 2));
});
beforeEach(() => forgetProfile());
it("a correction is learned once, and only when something really moved", () => {
  const untouched = {
    proposal: { exposure: 0.2 },
    adjustments: { exposure: 0.2 },
  } as unknown as Photo;
  expect(correctionOf(untouched)).toBeUndefined();
  const corrected = {
    proposal: { exposure: 0.2 },
    adjustments: { exposure: 0.6 },
  } as unknown as Photo;
  expect(correctionOf(corrected)).toBeDefined();
  // Already folded in: never counted twice.
  expect(
    correctionOf({ ...corrected, proposalLearned: true } as Photo),
  ).toBeUndefined();
});
it("the stored profile survives a round trip and refuses corrupt values", () => {
  rememberCorrection({ exposure: 0 }, { exposure: 0.4 });
  expect(readProfile()?.samples).toBe(1);
  localStorage.setItem(
    "juno-style-profile",
    JSON.stringify({ exposure: 9e9, warmth: "x", samples: -5 }),
  );
  const cleaned = readProfile();
  expect(cleaned?.exposure).toBe(4);
  expect(cleaned?.warmth).toBeUndefined();
  expect(cleaned?.samples).toBe(0);
  localStorage.setItem("juno-style-profile", "{ broken");
  expect(readProfile()).toBeUndefined();
});
it("the interface says plainly where the learning stands", () => {
  expect(profileStatus({ samples: 2 })).toMatch(/apprend/);
  expect(profileStatus({ samples: PROFILE_MIN_SAMPLES })).toMatch(
    /suit votre style/,
  );
});
