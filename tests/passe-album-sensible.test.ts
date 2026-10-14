import "fake-indexeddb/auto";
import { it, expect, vi, beforeEach } from "vitest";

/**
 * La vraie passe d'album (jobs.ts) sur une base simulée, comme
 * passe-album-raw.test.ts, pour deux défauts relevés le 29/09/2026 :
 * - une photo « sensible » (aperçu < 0,13 ou > 0,86) d'une scène de RAW était
 *   tirée vers la médiane de sa scène, alors que la raison affichée dit
 *   « exposition conservée » et que la même photo en JPEG n'était pas touchée ;
 * - le style appris était posé avant le style Lightroom, qui l'écrasait.
 */
const APERCU: Record<string, number> = {
  "A.CR3": 0.3, "B.CR3": 0.3, "C.CR3": 0.12,
  "A.jpg": 0.3, "B.jpg": 0.3, "C.jpg": 0.12,
  "D.CR3": 0.75, "E.CR3": 0.75, "F.CR3": 0.9,
};
const RENDU: Record<string, number> = { "A.CR3": 0.19, "B.CR3": 0.19, "C.CR3": 0.076, "D.CR3": 0.5, "E.CR3": 0.5, "F.CR3": 0.6 };
vi.stubGlobal("navigator", { hardwareConcurrency: 6 });
const memoire = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => void memoire.set(k, v),
  removeItem: (k: string) => void memoire.delete(k),
});
vi.stubGlobal("window", { dispatchEvent() {}, juno: { writeExport: vi.fn(async () => {}), finishExport: vi.fn(async () => {}) } });
vi.mock("../src/image", async () => {
  const { VERSION_RENDU } = await import("../src/modules/auto-tone");
  const raw = (nom: string) => /\.cr3$/i.test(nom);
  const mesurerRendu = vi.fn(async (p: { name: string }) => ({
    version: VERSION_RENDU,
    brightness: RENDU[p.name],
    clipped: 0,
    cast: { r: 0.5, g: 0.5, b: 0.5 },
  }));
  return {
    inspect: vi.fn(),
    inspectPhoto: vi.fn(async () => {
      throw Error("aucune relecture attendue");
    }),
    inspectionSource: async (_i: unknown, b: Blob) => b,
    originalExif: async () => undefined,
    fingerprint: async (b: Blob) => "h-" + (await b.text()),
    sourceBlob: vi.fn(async () => new Blob(["x"])),
    exportPhoto: vi.fn(async () => new Blob(["jpeg"])),
    download: vi.fn(),
    mesurerRendu,
    besoinRendu: (p: { name: string; analysis?: { rendu?: unknown } }) => raw(p.name) && !p.analysis?.rendu,
    avecRendu: async (p: { name: string }, a: { rendu?: unknown }, ready?: { rendu?: unknown }) =>
      !raw(p.name) || a.rendu ? a : { ...a, rendu: ready?.rendu ?? (await mesurerRendu(p)) },
  };
});
import { database, putProject, putPhotos, getPhotos } from "../src/db";
import { enqueueJob } from "../src/modules/jobs";
import { VERSION_NIVEAU } from "../src/modules/level";
import { VERSION_EMPREINTE } from "../src/modules/rafales";
import { writeXmpProfile, learnFromFolder } from "../src/modules/xmp-store";
import { DEFAULT, type Photo } from "../src/model";

const attendre = async (id: string) => {
  const fin = Date.now() + 10000;
  while (Date.now() < fin) {
    const j = await (await database).get("jobs", id);
    if (["done", "failed", "paused"].includes(j?.state)) return j;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("Délai dépassé");
};
const photo = (projet: string, nom: string, i: number): Photo =>
  ({
    id: `${projet}-${i}`,
    projectId: projet,
    name: nom,
    source: "idb",
    thumbnail: "",
    width: 100,
    height: 100,
    size: 1,
    hash: `${projet}-${i}`,
    status: "pending",
    stars: 0,
    protected: false,
    chapter: "",
    adjustments: DEFAULT,
    history: [],
    // Une même scène : trois photos à une minute d'écart.
    created: i,
    capturedAt: 1_000_000 + i * 60_000,
    analysis: {
      brightness: APERCU[nom],
      sharpness: 800,
      sharpnessWidth: 1024,
      clipped: 0,
      dhash: "0".repeat(64),
      advice: "normal",
      reasons: [],
      cast: { r: 0.5, g: 0.5, b: 0.5 },
      level: { tier: "level", angle: 0, reason: "", version: VERSION_NIVEAU },
      empreinte: { version: VERSION_EMPREINTE, instant: 1_000_000 + i * 60_000, gw: 1, gh: 1, g: "gA==", hist: Array(64).fill(1 / 64), hog: Array(128).fill(1 / 128) },
    },
  }) as unknown as Photo;
async function passe(id: string, noms: string[]) {
  await putProject({ id, name: id, date: "", location: "", demo: false, created: 1 } as never);
  await putPhotos(noms.map((n, i) => photo(id, n, i)));
  const j = await attendre(
    await enqueueJob("album", { id } as never, (await getPhotos(id)).map((p) => ({ id: p.id })), {
      style: "original",
      faces: false,
      semantic: false,
    }),
  );
  expect(j.state).toBe("done");
  return Object.fromEntries((await getPhotos(id)).map((p) => [p.name, p]));
}
const CONSERVEE = "Ambiance sombre ou très claire : exposition conservée.";
beforeEach(() => memoire.clear());

it("une photo sensible d'une scène de RAW garde son ambiance, comme en JPEG", async () => {
  const J = await passe("jpeg", ["A.jpg", "B.jpg", "C.jpg"]);
  const R = await passe("raw", ["A.CR3", "B.CR3", "C.CR3"]);
  // Le JPEG sombre : exposition intacte.
  expect(J["C.jpg"].adjustments.exposure).toBe(0);
  expect(J["C.jpg"].analysis!.reasons).toContain(CONSERVEE);
  // Le RAW sombre : seulement le rattrapage de l'écart entre l'aperçu et le
  // développement de Juno, pour ressortir comme dans l'aperçu. Avant : +1,03 IL,
  // tiré vers ses voisines, soit un export à 0,155 pour un aperçu à 0,12.
  const ecart = Math.log2(RENDU["C.CR3"] / APERCU["C.CR3"]);
  const c = R["C.CR3"].adjustments.exposure;
  expect(c).toBeCloseTo(-ecart, 2);
  expect(RENDU["C.CR3"] * 2 ** c).toBeCloseTo(APERCU["C.CR3"], 2);
  expect(R["C.CR3"].analysis!.reasons).toContain(CONSERVEE);
  // Ses voisines ne bougent pas : même visée qu'avant, en JPEG comme en RAW.
  expect(J["A.jpg"].adjustments.exposure).toBeCloseTo(Math.log2(0.46 / 0.3), 2);
  expect(R["A.CR3"].adjustments.exposure).toBeCloseTo(Math.log2(0.46 / 0.19), 1);
  // La proposition retenue pour apprendre le style est bien celle posée.
  expect(R["C.CR3"].proposal?.exposure).toBe(c);
});

it("une photo très claire d'une scène de RAW garde aussi son ambiance", async () => {
  const R = await passe("clair", ["D.CR3", "E.CR3", "F.CR3"]);
  const ecart = Math.log2(RENDU["F.CR3"] / APERCU["F.CR3"]);
  expect(R["F.CR3"].adjustments.exposure).toBeCloseTo(-ecart, 2);
  expect(R["F.CR3"].analysis!.reasons).toContain(CONSERVEE);
  expect(R["D.CR3"].adjustments.exposure).toBeCloseTo(Math.log2(0.46 / 0.5), 1);
});

it("la passe pose le style Lightroom puis le style appris, qui n'est plus écrasé", async () => {
  // Un style Lightroom : contraste toujours à +8, saturation à −10.
  writeXmpProfile(
    learnFromFolder({
      nom: "Lightroom",
      fichiers: Array.from({ length: 40 }, () => '<x crs:Contrast2012="+8" crs:Saturation="-10"/>'),
    }),
  );
  // Un style appris : le photographe remonte le contraste de 7 dans Juno.
  localStorage.setItem("juno-style-profile", JSON.stringify({ samples: 40, contrast: 7, saturation: 10 }));
  const J = await passe("styles", ["A.jpg", "B.jpg", "C.jpg"]);
  for (const nom of ["A.jpg", "B.jpg", "C.jpg"]) {
    // Avant : 8 et −10, le style appris était effacé et le reste jamais appris.
    expect(J[nom].adjustments.contrast).toBe(15);
    expect(J[nom].adjustments.saturation).toBe(0);
    expect(J[nom].proposal?.contrast).toBe(15);
  }
});
