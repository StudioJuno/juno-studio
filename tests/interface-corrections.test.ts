// Corrections de l'audit de l'interface (29/09/2026). Chaque bloc reprend un
// défaut confirmé ; le parcours dans la vraie application complète ceux qui
// ne se voient qu'à l'écran.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { PhotoWriter, type WriteState } from "../src/modules/photo-writer";
import { DEFAULT, editPhoto, type Photo } from "../src/model";
import { database, getPhoto, modifyPhoto, putPhoto } from "../src/db";
import { photoHistory, restoreCommand } from "../src/assistant/journal";
import {
  annonceImport,
  basculeOriginal,
  bilanImport,
  dateDuJour,
  etoilesDeTouche,
  photoAMontrer,
} from "../src/workbench/interface";
import viteConfig from "../vite.config";

const photo = (id: string, projectId = "interface"): Photo => ({
  id,
  projectId,
  name: id + ".jpg",
  source: "idb",
  thumbnail: "",
  width: 100,
  height: 100,
  size: 1,
  hash: "b".repeat(64),
  status: "pending",
  stars: 0,
  protected: false,
  chapter: "Prises de vue",
  adjustments: { ...DEFAULT },
  history: [],
  created: 1,
});

describe("1. une écriture ratée ne bloque plus la séance", () => {
  it("la reprise échoue encore sur une fiche disparue : l'abandon retire l'entrée fautive et enregistre les suivantes dans leur ordre", async () => {
    await putPhoto(photo("vivante-1"));
    await putPhoto(photo("vivante-2"));
    // La fiche de « disparue » n'existe pas : modifyPhoto lève « Photo introuvable ».
    const states: WriteState[] = [];
    const writer = new PhotoWriter(
      (s) => states.push(s),
      () => {},
    );
    const premiere = writer.write("disparue", (p) => ({ ...p, status: "keep" }));
    await expect(premiere).rejects.toThrow("Photo introuvable");
    // La séance continue : ces changements attendent derrière l'échec.
    const suite = [
      writer.write("vivante-1", (p) => ({ ...p, status: "keep" })),
      writer.write("vivante-1", (p) => ({ ...p, stars: 4 })),
      writer.write("vivante-2", (p) => editPhoto(p, { exposure: 0.5 })),
    ];
    await Promise.allSettled(suite);
    expect(states.at(-1)).toMatchObject({
      pending: 4,
      error: "Photo introuvable.",
      blockedId: "disparue",
    });
    expect((await getPhoto("vivante-1"))?.status).toBe("pending");
    // Réessayer ne suffit pas : la fiche n'existe toujours pas.
    await expect(writer.retry()).rejects.toThrow("Photo introuvable");
    expect(states.at(-1)?.blockedId).toBe("disparue");
    // La sortie : abandonner l'entrée fautive, et elle seule.
    await writer.abandon();
    expect(states.at(-1)).toEqual({ pending: 0, error: "" });
    const v1 = await getPhoto("vivante-1"),
      v2 = await getPhoto("vivante-2");
    expect(v1?.status).toBe("keep");
    expect(v1?.stars).toBe(4);
    expect(v2?.adjustments.exposure).toBe(0.5);
    expect(await getPhoto("disparue")).toBeUndefined();
  });
  it("sans échec, abandonner ne retire rien", async () => {
    await putPhoto(photo("sans-echec"));
    const writer = new PhotoWriter(
      () => {},
      () => {},
    );
    await writer.write("sans-echec", (p) => ({ ...p, stars: 2 }));
    await writer.abandon();
    expect((await getPhoto("sans-echec"))?.stars).toBe(2);
  });
  it("la fenêtre prévient au lieu de refuser la fermeture en silence", () => {
    const main = readFileSync(
      new URL("../electron/main.cjs", import.meta.url),
      "utf8",
    );
    expect(main).toMatch(/on\("will-prevent-unload"/);
    expect(main).toContain("Quitter quand même");
    expect(main).toMatch(/if \(choix === 1\) event\.preventDefault\(\)/);
  });
});

describe("2. la photo active sous un filtre", () => {
  const ids = (...n: number[]) => n.map((i) => ({ id: "IMG_" + i }));
  it("une photo qui sort du filtre laisse la place à sa voisine, pas à la première", () => {
    const gardees = ids(1, 3, 5, 7, 8, 10),
      toutes = ids(...Array.from({ length: 16 }, (_, i) => i + 1));
    const avant = photoAMontrer(gardees, toutes, "IMG_7", "gardées", undefined);
    expect(avant).toMatchObject({ index: 3, voisine: false });
    // IMG_7 est écartée : elle quitte « Gardées ».
    const apres = photoAMontrer(ids(1, 3, 5, 8, 10), toutes, "IMG_7", "gardées", {
      cle: "gardées",
      id: "IMG_7",
      index: 3,
    });
    expect(apres).toEqual({ photo: { id: "IMG_8" }, index: 3, voisine: true });
    // La dernière du filtre qui sort : on recule sur la précédente.
    expect(
      photoAMontrer(ids(1, 3), toutes, "IMG_5", "gardées", {
        cle: "gardées",
        id: "IMG_5",
        index: 2,
      }).photo,
    ).toEqual({ id: "IMG_3" });
  });
  it("un autre filtre repart du début, comme avant", () => {
    expect(
      photoAMontrer(ids(2, 4), ids(1, 2, 3, 4), "IMG_3", "écartées", {
        cle: "gardées",
        id: "IMG_3",
        index: 1,
      }),
    ).toEqual({ photo: { id: "IMG_2" }, index: 0, voisine: false });
    expect(photoAMontrer([], ids(1, 2), "IMG_2", "vide", undefined).photo).toEqual({
      id: "IMG_2",
    });
  });
  it("la bande de l'atelier et Médias ne s'appuient plus sur la liste entière", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/items\s*\.slice\(/);
    expect(app).not.toMatch(/items\.findIndex\(\(p\) => p\.id === current\.id\)/);
    expect(app).toMatch(/onPhoto=\{\(?id\)?\s*=>\s*\{\s*showPhoto\(id\)/);
  });
});

describe("3. changer de projet remet la vue à zéro", () => {
  it("⌘K, le tiroir et les retours clients passent par la même ouverture", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const ouverture = app.slice(
      app.indexOf("function openProject("),
      app.indexOf("function showPhoto("),
    );
    for (const remise of [
      'setFilter("all")',
      'setChapter("Tout le projet")',
      'setSearch("")',
      "setMeaning(null)",
      "setAnalysisResult(null)",
    ])
      expect(ouverture).toContain(remise);
    expect(app).toMatch(/run: \(\) => openProject\(p\.id\)/);
    // Plus aucun changement de projet ne contourne openProject, hors chargement.
    expect(app.match(/setProjectId\(/g)?.length).toBe(4);
  });
});

describe("4. un geste au curseur ne s'approprie pas le tri qui suit", () => {
  it("annuler le « Réglage manuel » ne retire ni le tri ni les étoiles", async () => {
    const p = photo("geste");
    await putPhoto(p);
    await modifyPhoto(p.id, (x) => editPhoto(x, { exposure: 0.4 }, "glisse"));
    await modifyPhoto(p.id, (x) => editPhoto(x, { exposure: 0.83 }, "glisse"));
    // Garder puis 3 étoiles : la photo porte encore l'editGroup du geste.
    await modifyPhoto(p.id, (x) => ({ ...x, status: "keep" }));
    await modifyPhoto(p.id, (x) => ({ ...x, stars: 3 }));
    expect((await getPhoto(p.id))?.editGroup).toBe("glisse");
    const geste = `gesture:${p.id}:glisse`;
    const changes = await (
      await database
    ).getAllFromIndex("commandChanges", "commandId", geste);
    expect(changes.flatMap((c) => c.fields.map((f: { path: string }) => f.path))).toEqual([
      "adjustments.exposure",
    ]);
    expect(
      (await photoHistory(p.projectId)).filter((r) => r.label.includes("geste.jpg")),
    ).toHaveLength(3);
    await restoreCommand(geste);
    const apres = await getPhoto(p.id);
    expect(apres?.adjustments.exposure).toBe(0);
    expect(apres?.status).toBe("keep");
    expect(apres?.stars).toBe(3);
  });
  it("un geste continu reste une seule entrée", async () => {
    const p = photo("geste-seul");
    await putPhoto(p);
    for (let i = 1; i < 6; i++)
      await modifyPhoto(p.id, (x) => editPhoto(x, { contrast: i }, "g"));
    const entrees = (await photoHistory(p.projectId)).filter((r) =>
      r.label.includes("geste-seul.jpg"),
    );
    expect(entrees.map((r) => r.id)).toEqual([`gesture:${p.id}:g`]);
  });
});

describe("5. clavier AZERTY", () => {
  it("les étoiles se lisent sur la touche, avec ou sans Maj", () => {
    // Rangée du haut d'un Mac AZERTY, sans Maj : à & é " ' (
    expect(etoilesDeTouche({ key: '"', code: "Digit3" })).toBe(3);
    expect(etoilesDeTouche({ key: "(", code: "Digit5" })).toBe(5);
    expect(etoilesDeTouche({ key: "à", code: "Digit0" })).toBe(0);
    expect(etoilesDeTouche({ key: "3", code: "Digit3" })).toBe(3);
    expect(etoilesDeTouche({ key: "4", code: "Numpad4" })).toBe(4);
    expect(etoilesDeTouche({ key: "§", code: "Digit6" })).toBeUndefined();
    expect(etoilesDeTouche({ key: "p", code: "KeyP" })).toBeUndefined();
    // Évènement sans code (clavier virtuel) : le caractère suffit.
    expect(etoilesDeTouche({ key: "2", code: "" })).toBe(2);
  });
  it("« \\ » avec ⌥⇧, ou Y sans modificateur, bascule l'original", () => {
    const touche = (key: string, mods: Partial<Record<"altKey" | "metaKey" | "ctrlKey", boolean>> = {}) =>
      basculeOriginal({ key, altKey: false, metaKey: false, ctrlKey: false, ...mods });
    expect(touche("\\", { altKey: true })).toBe(true);
    expect(touche("\\")).toBe(true);
    expect(touche("y")).toBe(true);
    expect(touche("Y")).toBe(true);
    expect(touche("y", { altKey: true })).toBe(false);
    expect(touche("\\", { metaKey: true })).toBe(false);
    expect(touche("x")).toBe(false);
  });
});

describe("8. la notification d'import dit ce qui s'est passé", () => {
  it("au lancement, rien n'est annoncé comme ajouté", () => {
    const debut = annonceImport(16, 0);
    expect(debut).toContain("16 fichier(s) photo envoyé(s) à l’import");
    expect(debut).not.toMatch(/ajouté/);
    expect(annonceImport(3, 2)).toContain("3 fichier(s) photo et 2 vidéo(s) ou son(s)");
    expect(annonceImport(0, 2)).toContain("espace vidéo");
  });
  it("en fin de tâche, les doublons et les échecs sont comptés à part", () => {
    const job = {
      state: "done" as const,
      cursor: 16,
      skipped: 16,
      errorCount: 0,
      projectName: "Mariage Alice",
    };
    expect(bilanImport(job)).toBe(
      "Import terminé dans « Mariage Alice » : 0 photo(s) ajoutée(s), 16 doublon(s) ignoré(s).",
    );
    expect(bilanImport({ ...job, skipped: 3, errorCount: 2 })).toBe(
      "Import terminé dans « Mariage Alice » : 11 photo(s) ajoutée(s), 3 doublon(s) ignoré(s), 2 fichier(s) à reprendre dans Activité.",
    );
    expect(bilanImport({ ...job, state: "running" })).toBeUndefined();
    expect(bilanImport({ ...job, state: "paused" })).toBeUndefined();
    expect(bilanImport({ ...job, state: "cancelled", cursor: 4, skipped: 0 })).toMatch(
      /^Import annulé .* 4 photo\(s\) ajoutée\(s\)\.$/,
    );
  });
});

describe("9. la version affichée est la vraie", () => {
  it("Vite injecte la version de package.json", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect((viteConfig as { define?: Record<string, string> }).define?.__JUNO_VERSION__).toBe(
      JSON.stringify(pkg.version),
    );
  });
  it("les Paramètres ne portent plus de version écrite à la main", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).not.toMatch(/Juno Studio \d+\.\d+\.\d+/);
    expect(app).toContain("Juno Studio{VERSION_JUNO && ` ${VERSION_JUNO}`}");
  });
});

describe("10. la date proposée pour un nouveau projet", () => {
  it("est la date locale, pas la date UTC", () => {
    const avant = process.env.TZ;
    process.env.TZ = "Europe/Paris";
    try {
      const minuitTrente = new Date(2026, 8, 29, 0, 30);
      expect(dateDuJour(minuitTrente)).toBe("2026-09-29");
      expect(dateDuJour(new Date(2026, 11, 15, 0, 40))).toBe("2026-12-15");
      // Ce que donnait l'ancien calcul si le fuseau est bien celui de Paris.
      if (minuitTrente.getTimezoneOffset() < 0)
        expect(minuitTrente.toISOString().slice(0, 10)).toBe("2026-09-28");
    } finally {
      if (avant === undefined) delete process.env.TZ;
      else process.env.TZ = avant;
    }
  });
  it("est recalculée à chaque ouverture de la fenêtre", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/if \(modal === "new"\) setNewDate\(dateDuJour\(\)\)/);
    expect(app).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});

describe("relecture des corrections (29/09/2026)", () => {
  it("une fiche disparue : tous ses changements partent ensemble, les autres restent", async () => {
    await putPhoto(photo("reste-1"));
    const states: WriteState[] = [];
    const writer = new PhotoWriter(
      (s) => states.push(s),
      () => {},
    );
    const envois = [
      writer.write("absente", (p) => ({ ...p, status: "keep" })),
      writer.write("absente", (p) => ({ ...p, stars: 3 })),
      writer.write("reste-1", (p) => ({ ...p, status: "keep" })),
    ];
    await Promise.allSettled(envois);
    expect(states.at(-1)).toMatchObject({ pending: 3, blockedId: "absente", blocked: 2 });
    // Un seul abandon suffit : plus de seconde confirmation pour la même fiche.
    await writer.abandon();
    expect(states.at(-1)).toEqual({ pending: 0, error: "" });
    expect((await getPhoto("reste-1"))?.status).toBe("keep");
  });
  it("l'historique dit ce qu'on annule : tri, étoiles ou réglage", async () => {
    const p = photo("etiquettes", "etiquettes");
    await putPhoto(p);
    await modifyPhoto(p.id, (x) => editPhoto(x, { exposure: 0.4 }));
    await modifyPhoto(p.id, (x) => ({ ...x, status: "keep" }));
    await modifyPhoto(p.id, (x) => ({ ...x, stars: 2 }));
    await modifyPhoto(p.id, (x) => ({ ...editPhoto(x, { contrast: 5 }), stars: 3 }));
    const noms = (await photoHistory(p.projectId)).map((r) => r.label).sort();
    expect(noms).toEqual([
      "Modification manuelle · etiquettes.jpg",
      "Réglage manuel · etiquettes.jpg",
      "Tri · etiquettes.jpg",
      "Étoiles · etiquettes.jpg",
    ]);
  });
});
