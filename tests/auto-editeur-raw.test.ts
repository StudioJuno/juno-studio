import { it, expect, vi } from "vitest";

/**
 * Le bouton « Auto » de l'éditeur sur un RAW (relecture du 29/09/2026) : après
 * une passe d'album juste (export à 0,439 sur 4R7A1611.CR3), un clic sur Auto
 * donnait −0,79 IL et un export à 0,296, parce qu'il mesurait encore l'aperçu
 * intégré. Il vise maintenant le même rendu que la passe : celui du catalogue,
 * ou mesuré à la demande.
 */
const etat = vi.hoisted(() => ({ demandes: [] as { kind: string; priority: string }[], panne: false }));
vi.mock("../src/modules/image-client", async () => {
  const { VERSION_RENDU } = await import("../src/modules/auto-tone");
  return {
    processImage: vi.fn(async (req: { kind: string }, priority: string) => {
      etat.demandes.push({ kind: req.kind, priority });
      if (etat.panne) throw Error("Original indisponible. Vérifiez que votre disque est connecté.");
      // Le développement réduit de LibRaw, mesuré sur ce CR3.
      return { version: VERSION_RENDU, brightness: 0.563, clipped: 0.026, cast: { r: 0.5, g: 0.47, b: 0.42 } };
    }),
  };
});
vi.mock("../src/db", () => ({ getOriginal: vi.fn(async () => new Blob(["cr3"])) }));
import { analysePourAuto } from "../src/image";
import { autoSettings, type Analysis, type Photo } from "../src/model";
import { autoTone, VERSION_RENDU } from "../src/modules/auto-tone";

// 4R7A1611.CR3 : aperçu intégré 0,798, développement de Juno 0,563.
const analyse = (over: Record<string, unknown> = {}) =>
  ({
    brightness: 0.798,
    clipped: 0.205,
    sharpness: 800,
    sharpnessWidth: 1024,
    dhash: "0".repeat(64),
    advice: "normal",
    reasons: [],
    cast: { r: 0.72, g: 0.65, b: 0.56 },
    ...over,
  }) as Analysis;
const rendu = { version: VERSION_RENDU, brightness: 0.563, clipped: 0.026, cast: { r: 0.5, g: 0.47, b: 0.42 } };
const photo = (nom: string, a: Analysis): Photo =>
  ({ id: nom, projectId: "p", name: nom, source: "idb", analysis: a, adjustments: {} }) as unknown as Photo;
const stats = (a: Analysis) => ({ cast: a.cast!, brightness: a.brightness, clipped: a.clipped });

it("Auto règle un RAW mesuré sur le rendu de Juno, comme la passe d'album", () => {
  const a = analyse({ rendu });
  const auto = autoSettings(a);
  // Avant : log2(0,46 / 0,798) = −0,79 IL, sur un développement bien plus sombre.
  expect(auto.exposure).toBeCloseTo(Math.log2(0.46 / 0.563), 2);
  expect(auto.exposure).toBe(autoTone(a, stats(a)).exposure);
  // La luminosité attendue de l'export, rendu × 2^exposition, vise 0,46.
  expect(0.563 * 2 ** auto.exposure!).toBeCloseTo(0.46, 2);
  // Hautes lumières et ombres : décidées sur l'aperçu, comme la passe.
  expect(auto.highlights).toBe(-20);
  expect(auto.shadows).toBe(7);
  // Un JPEG, ou un RAW sans mesure : le calcul d'avant.
  expect(autoSettings(analyse()).exposure).toBeCloseTo(Math.log2(0.46 / 0.798), 2);
});

it("un RAW sans mesure du rendu est développé à la demande, en priorité, une seule fois", async () => {
  etat.demandes = [];
  const brut = photo("4R7A1611.CR3", analyse());
  const lue = await analysePourAuto(brut);
  expect(etat.demandes).toEqual([{ kind: "rendu", priority: "foreground" }]);
  // La mesure revient pour être gardée au catalogue.
  expect(lue?.mesure?.brightness).toBe(0.563);
  expect(autoSettings(lue!.analysis).exposure).toBeCloseTo(Math.log2(0.46 / 0.563), 2);
  // Déjà mesuré (par la passe d'album ou un premier clic) : rien à refaire.
  etat.demandes = [];
  const deja = await analysePourAuto(photo("4R7A1611.CR3", analyse({ rendu })));
  expect(etat.demandes).toEqual([]);
  expect(deja?.mesure).toBeUndefined();
  expect(autoSettings(deja!.analysis).exposure).toBe(autoSettings(lue!.analysis).exposure);
  // Un JPEG est analysé sur les pixels mêmes que Juno retouche.
  const jpeg = await analysePourAuto(photo("A.jpg", analyse({ brightness: 0.5 })));
  expect(etat.demandes).toEqual([]);
  expect(autoSettings(jpeg!.analysis).exposure).toBeCloseTo(Math.log2(0.46 / 0.5), 2);
  // Une copie sans originaux n'a que l'aperçu : rien à développer.
  const apercus = { ...photo("B.CR3", analyse()), previewOnly: true } as Photo;
  expect((await analysePourAuto(apercus))?.mesure).toBeUndefined();
  expect(etat.demandes).toEqual([]);
});

it("un RAW impossible à développer n'est pas réglé sur son aperçu intégré", async () => {
  etat.panne = true;
  await expect(analysePourAuto(photo("4R7A1611.CR3", analyse()))).rejects.toThrow(/disque est connecté/);
  etat.panne = false;
  // Sans analyse, il n'y a rien à régler.
  expect(await analysePourAuto({ ...photo("C.CR3", analyse()), analysis: undefined } as Photo)).toBeUndefined();
});
