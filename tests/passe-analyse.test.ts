import "fake-indexeddb/auto";
import { it, expect, vi } from "vitest";

/**
 * La passe « Analyser seulement » de bout en bout, sur une base simulée et un
 * décodage simulé qui compte ses appels. Trois défauts trouvés en relecture le
 * 29/09/2026 : le préchargement jeté à chaque photo (chaque image décodée deux
 * fois), les HEIC analysés en noir jamais refaits, et le compte de photos de
 * chaque personne doublé à chaque passe.
 */
const etat = vi.hoisted(() => ({ appels: [] as string[] }));
vi.stubGlobal("window", { dispatchEvent() {} });
vi.stubGlobal("navigator", { hardwareConcurrency: 6 });
const memoire = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => memoire.get(k) ?? null,
  setItem: (k: string, v: string) => void memoire.set(k, v),
  removeItem: (k: string) => void memoire.delete(k),
});
const analyse = (nom: string) => ({
  brightness: 0.5,
  sharpness: 800,
  sharpnessWidth: 1024,
  clipped: 0,
  dhash: "0".repeat(64),
  advice: "normal" as const,
  reasons: [],
  level: { tier: "level" as const, angle: 0, reason: "", version: "lignes-v1" },
  empreinte: { version: "rafale-v1", instant: 1000 + Number(nom.replace(/\D/g, "") || 0) * 5000, gw: 1, gh: 1, g: "gA==", hist: Array(64).fill(1 / 64), hog: Array(128).fill(1 / 128) },
});
vi.mock("../src/image", () => {
  const inspecter = async (nom: string) => {
    etat.appels.push(nom);
    return { width: 100, height: 100, thumbnail: "data:image/jpeg;base64,AA==", analysis: analyse(nom) };
  };
  return {
    inspect: vi.fn(async (_b: Blob, nom: string) => inspecter(nom)),
    inspectPhoto: vi.fn(async (p: { name: string }) => inspecter(p.name)),
    inspectionSource: async (_i: unknown, b: Blob) => b,
    originalExif: async () => undefined,
    fingerprint: async (b: Blob) => "h-" + (await b.text()),
    sourceBlob: vi.fn(async () => new Blob(["x"])),
    exportPhoto: vi.fn(),
    download: vi.fn(),
  };
});
import { database, putProject, putPhotos, getPhotos, getThumbnail } from "../src/db";
import { enqueueJob } from "../src/modules/jobs";
import { readPeople } from "../src/modules/people-store";
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
const photo = (projet: string, i: number, over: Partial<Photo> = {}): Photo =>
  ({
    id: `${projet}-${i}`,
    projectId: projet,
    name: `IMG_${i}.CR3`,
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
    created: i,
    ...over,
  }) as Photo;

it("le préchargement sert : chaque photo n'est décodée qu'une fois", async () => {
  const projet = { id: "prechargement", name: "P", date: "", location: "", demo: false, created: 1 };
  await putProject(projet);
  // Photos jamais analysées : il faut les décoder, une fois chacune.
  await putPhotos(Array.from({ length: 6 }, (_, i) => photo(projet.id, i)));
  etat.appels = [];
  const id = await enqueueJob("analyze", projet as never, (await getPhotos(projet.id)).map((p) => ({ id: p.id, name: p.name })));
  const j = await attendre(id);
  expect(j.state).toBe("done");
  expect(etat.appels.length).toBe(6);
  expect(new Set(etat.appels).size).toBe(6);
});

it("un HEIC analysé en noir avant le correctif est entièrement refait", async () => {
  const projet = { id: "heic", name: "H", date: "", location: "", demo: false, created: 1 };
  await putProject(projet);
  const noire = {
    brightness: 0, sharpness: 0, sharpnessWidth: 1024, clipped: 0, dhash: "0".repeat(64),
    advice: "review" as const, reasons: ["Image très sombre"],
    level: { tier: "level" as const, angle: 0, reason: "", version: "lignes-v1" },
    empreinte: analyse("IMG_1").empreinte,
  };
  await putPhotos([photo(projet.id, 1, { name: "IMG_1.HEIC", analysis: noire, thumbnail: "data:image/jpeg;base64,noire" })]);
  etat.appels = [];
  const id = await enqueueJob("analyze", projet as never, [{ id: "heic-1", name: "IMG_1.HEIC" }]);
  await attendre(id);
  const [p] = await getPhotos(projet.id);
  expect(p.analysis!.brightness).toBe(0.5);
  expect(p.analysis!.reasons).not.toContain("Image très sombre");
  expect(await getThumbnail(p.id)).toBe("data:image/jpeg;base64,AA==");
  // Une vraie photo sombre d'un autre format n'est pas relue pour autant.
  await putPhotos([photo(projet.id, 2, { analysis: { ...noire }, name: "IMG_2.CR3" })]);
  etat.appels = [];
  await attendre(await enqueueJob("analyze", projet as never, [{ id: "heic-2", name: "IMG_2.CR3" }]));
  expect(etat.appels).toEqual([]);
});

it("une seconde passe ne double pas le compte de photos de chaque personne", async () => {
  const projet = { id: "personnes", name: "Q", date: "", location: "", demo: false, created: 1 };
  await putProject(projet);
  const descripteur = Array.from({ length: 128 }, (_, k) => Math.sin(k) / 8);
  const lue = (i: number) =>
    photo(projet.id, i, {
      analysis: {
        ...analyse(`IMG_${i}`),
        faces: {
          count: 1, closedEyes: 0, blink: 0, version: "mediapipe-face-v5",
          reads: [{ region: { x: 0.4, y: 0.3, w: 0.2, h: 0.2 }, weight: 0.04, sharpness: 900, nettete: 0.3, eyesClosed: 0, smile: 0.5, turned: 0, descriptor: descripteur }],
        },
      } as never,
    });
  await putPhotos([lue(1), lue(2), lue(3)]);
  const passe = async () =>
    attendre(await enqueueJob("analyze", projet as never, (await getPhotos(projet.id)).map((p) => ({ id: p.id, name: p.name }))));
  await passe();
  const apres1 = readPeople(projet.id);
  expect(apres1).toHaveLength(1);
  expect(apres1[0].samples).toBe(3);
  await passe();
  expect(readPeople(projet.id)[0].samples).toBe(3);
});
