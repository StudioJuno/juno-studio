import "fake-indexeddb/auto";
import { it, expect, vi } from "vitest";

/**
 * La passe d'album et l'export, de bout en bout sur une base simulée, pour
 * deux défauts relevés le 29/09/2026 :
 * - « Préparer l'album » assombrissait les RAW : l'exposition était calculée
 *   sur l'aperçu intégré (rendu du boîtier), puis posée sur le développement
 *   de Juno, bien plus sombre ;
 * - un export arrêté par un disque plein sautait, à la reprise, la photo qui
 *   avait échoué.
 * Les luminosités sont celles de trois vrais CR3 (aperçu intégré contre
 * développement LibRaw).
 */
const etat = vi.hoisted(() => ({
  mesures: [] as string[],
  inspections: [] as string[],
  ecritures: [] as string[],
  panne: true,
}));
const APERCU: Record<string, number> = { "A.CR3": 0.798, "B.CR3": 0.419, "C.CR3": 0.575, "D.jpg": 0.5 };
const RENDU: Record<string, number> = { "A.CR3": 0.563, "B.CR3": 0.241, "C.CR3": 0.381 };
vi.stubGlobal("navigator", { hardwareConcurrency: 6 });
const memoire = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => void memoire.set(k, v),
  removeItem: (k: string) => void memoire.delete(k),
});
vi.stubGlobal("window", {
  dispatchEvent() {},
  juno: {
    writeExport: vi.fn(async (_dossier: string, nom: string) => {
      if (etat.panne && /\.jpg$/.test(nom)) {
        etat.panne = false;
        throw Object.assign(Error("ENOSPC: no space left on device, write"), { code: "ENOSPC" });
      }
      etat.ecritures.push(nom);
    }),
    finishExport: vi.fn(async () => {}),
  },
});
vi.mock("../src/image", async () => {
  const { VERSION_RENDU } = await import("../src/modules/auto-tone");
  const raw = (nom: string) => /\.cr3$/i.test(nom);
  const mesure = (nom: string) => ({
    version: VERSION_RENDU,
    brightness: RENDU[nom],
    clipped: 0.01,
    cast: { r: 0.5, g: 0.5, b: 0.48 },
  });
  const mesurerRendu = vi.fn(async (p: { name: string }) => {
    etat.mesures.push(p.name);
    return mesure(p.name);
  });
  return {
    inspect: vi.fn(),
    inspectPhoto: vi.fn(async (p: { name: string }) => {
      etat.inspections.push(p.name);
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
    // La même règle que image.ts : le préchargement d'abord, sinon une mesure.
    avecRendu: async (p: { name: string }, a: { rendu?: unknown }, ready?: { rendu?: unknown }) =>
      !raw(p.name) || a.rendu ? a : { ...a, rendu: ready?.rendu ?? (await mesurerRendu(p)) },
  };
});
import { database, putProject, putPhotos, getPhotos } from "../src/db";
import { controlJob, enqueueJob } from "../src/modules/jobs";
import { VERSION_NIVEAU } from "../src/modules/level";
import { VERSION_EMPREINTE } from "../src/modules/rafales";
import { DEFAULT, type Photo } from "../src/model";

const attendre = async (id: string, etats = ["done", "failed", "paused"]) => {
  const fin = Date.now() + 10000;
  while (Date.now() < fin) {
    const j = await (await database).get("jobs", id);
    if (etats.includes(j?.state)) return j;
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
      clipped: 0.01,
      dhash: "0".repeat(64),
      advice: "normal",
      reasons: [],
      cast: { r: 0.55, g: 0.5, b: 0.42 },
      level: { tier: "level", angle: 0, reason: "", version: VERSION_NIVEAU },
      empreinte: { version: VERSION_EMPREINTE, instant: 1_000_000 + i * 60_000, gw: 1, gh: 1, g: "gA==", hist: Array(64).fill(1 / 64), hog: Array(128).fill(1 / 128) },
    },
  }) as unknown as Photo;

it("« Préparer l'album » expose un RAW sur le rendu de Juno, pas sur son aperçu intégré", async () => {
  const projet = { id: "album-raw", name: "Album", date: "", location: "", demo: false, created: 1 };
  await putProject(projet);
  await putPhotos(["A.CR3", "B.CR3", "C.CR3", "D.jpg"].map((n, i) => photo(projet.id, n, i)));
  const id = await enqueueJob(
    "album",
    projet as never,
    (await getPhotos(projet.id)).map((p) => ({ id: p.id })),
    { style: "original", faces: false, semantic: false },
  );
  const j = await attendre(id);
  expect(j.state).toBe("done");
  const photos = Object.fromEntries((await getPhotos(projet.id)).map((p) => [p.name, p]));
  // Un développement réduit par RAW, fait une seule fois, rien pour le JPEG.
  expect(etat.mesures.sort()).toEqual(["A.CR3", "B.CR3", "C.CR3"]);
  expect(etat.inspections).toEqual([]);
  expect((photos["A.CR3"].analysis as { rendu?: { brightness: number } }).rendu?.brightness).toBe(0.563);
  expect((photos["D.jpg"].analysis as { rendu?: unknown }).rendu).toBeUndefined();
  // Avant la correction : −0,79 / +0,14 / −0,32 IL, exports à 0,29-0,30.
  // Le rendu appelle au contraire −0,29 / +0,93 / +0,27 (log2(0,46 / rendu)).
  const e = (n: string) => photos[n].adjustments.exposure;
  expect(e("A.CR3")).toBeGreaterThan(-0.45);
  expect(e("B.CR3")).toBeGreaterThan(0.5);
  expect(e("C.CR3")).toBeGreaterThan(0.1);
  // La luminosité attendue de l'export, rendu × 2^exposition, tombe près de 0,46.
  for (const n of ["A.CR3", "B.CR3", "C.CR3"]) {
    const l = RENDU[n] * 2 ** e(n);
    expect(l).toBeGreaterThan(0.38);
    expect(l).toBeLessThan(0.56);
  }
  // Le JPEG garde sa mesure : son analyse est faite sur les pixels exportés.
  expect(e("D.jpg")).toBeCloseTo(Math.log2(0.46 / 0.5), 0);
  // Une seconde passe ne remesure rien.
  etat.mesures = [];
  await attendre(
    await enqueueJob("album", projet as never, (await getPhotos(projet.id)).map((p) => ({ id: p.id })), {
      style: "original",
      faces: false,
      semantic: false,
    }),
  );
  expect(etat.mesures).toEqual([]);
});

it("un export arrêté par un disque plein reprend à la photo qui a échoué", async () => {
  const projet = { id: "export-plein", name: "Export", date: "", location: "", demo: false, created: 1 };
  await putProject(projet);
  await putPhotos(["A.CR3", "B.CR3"].map((n, i) => photo(projet.id, n, 10 + i)));
  etat.panne = true;
  etat.ecritures = [];
  const id = await enqueueJob("export", projet as never, await getPhotos(projet.id), {
    folder: "jeton",
    format: "jpeg",
    size: 0,
    quality: 0.9,
  });
  let j = await attendre(id, ["paused", "done", "failed"]);
  expect(j.state).toBe("paused");
  // Rien n'est compté en échec : la photo sera refaite.
  expect(j.cursor).toBe(0);
  expect(j.errorCount).toBe(0);
  expect(j.errors[0].message).toMatch(/l’export/);
  expect(j.errors[0].message).not.toMatch(/importation/);
  await controlJob(id, "resume");
  j = await attendre(id, ["done", "failed"]);
  expect(j.state).toBe("done");
  expect(etat.ecritures).toEqual(["0001_A_Juno.jpg", "0002_B_Juno.jpg", "juno-reglages.json"]);
  expect(j.errorCount).toBe(0);
  expect(j.errors).toEqual([]);
});
