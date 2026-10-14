// Le style appris des corrections, relu le 29/09/2026 : il n'apprenait rien
// dans la vraie application, divergeait une fois branché, et ne s'oubliait
// nulle part. Un test par défaut, plus le parcours complet sur plusieurs albums.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import {
  AUTO_FIELDS,
  applyProfile,
  autoTone,
  learnProfile,
  PROFILE_MIN_SAMPLES,
  profilPorte,
  sceneSettings,
  type AutoField,
  type StyleProfile,
} from "../src/modules/auto-tone";
import {
  correctionOf,
  describeLearned,
  forgetProfile,
  learnWhenLeaving,
  readProfile,
  writeProfile,
} from "../src/modules/style-profile";
import { learnFromXmp, parseXmp, type XmpProfile } from "../src/modules/xmp";
import { validateCatalog } from "../src/modules/catalog-validation";
import { PhotoWriter } from "../src/modules/photo-writer";
import { photoTransaction, restoreCommand } from "../src/assistant/journal";
import { database, getPhoto, modifyPhoto, putPhoto } from "../src/db";
import { DEFAULT, editPhoto, type Analysis, type Photo } from "../src/model";

// Le profil vit dans le stockage de la fenêtre ; les tests tournent sans navigateur.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};

// Une photo un peu chaude, comme les JPEG du parcours dans l'application :
// la balance des blancs de Juno y propose une chaleur d'environ −2,4.
const a = {
  brightness: 0.4,
  clipped: 0,
  cast: { r: 0.511, g: 0.5, b: 0.489 },
  sharpness: 1,
  sharpnessWidth: 320,
  dhash: "",
  advice: "normal",
  reasons: [],
} as Analysis;
const stats = { cast: a.cast!, brightness: a.brightness, clipped: a.clipped };
// Un style Lightroom : contraste toujours à +8, saturation à −10.
const xmp = learnFromXmp(
  Array.from({ length: 40 }, (_, i) =>
    parseXmp(
      `<x crs:Exposure2012="${i % 2 ? "+0.20" : "-0.10"}" crs:Contrast2012="+8" crs:Saturation="-10"/>`,
    )!,
  ),
);
// L'habitude du photographe : il règle toujours ces valeurs, photo par photo.
const HABITUDE = { warmth: 10, contrast: 15, saturation: 0 };

let n = 0;
const fiche = (projectId: string, extra: Partial<Photo> = {}): Photo =>
  ({
    id: `p${++n}-${Math.random().toString(36).slice(2)}`,
    projectId,
    name: `STYLE_${n}.jpg`,
    source: "idb",
    thumbnail: "",
    width: 900,
    height: 600,
    size: 1,
    hash: "c".repeat(64),
    status: "pending",
    stars: 0,
    protected: false,
    chapter: "",
    adjustments: { ...DEFAULT },
    history: [],
    created: n,
    revision: 0,
    ...extra,
  }) as Photo;

/**
 * La passe d'album de jobs.ts sur `count` photos : proposition (balance,
 * style Lightroom, style appris posé en dernier), harmonisation de la scène,
 * puis la proposition enregistrée avec le style qu'elle porte.
 */
function passe(count: number, profile?: StyleProfile, lr?: XmpProfile) {
  const vise = sceneSettings(
    Array.from({ length: count }, () => autoTone(a, stats, profile, lr)),
  );
  return vise.map((v) =>
    fiche("album", {
      adjustments: { ...DEFAULT, ...v },
      proposal: { ...v },
      proposalProfile: profilPorte(profile),
      proposalLearned: false,
    }),
  );
}
/** Un catalogue en mémoire, pour learnWhenLeaving sans IndexedDB. */
function memoire(photos: Photo[]) {
  const par = new Map(photos.map((p) => [p.id, p]));
  return {
    flush: async () => {},
    read: async (id: string) => par.get(id),
    modify: async (id: string, update: (p: Photo) => Photo) => {
      const next = update(par.get(id)!);
      par.set(id, next);
      return next;
    },
  };
}
/** Le photographe corrige chaque photo vers son habitude, puis la quitte. */
async function corriger(photos: Photo[]) {
  const corrigees = photos.map((p) => editPhoto(p, HABITUDE, "g"));
  const cat = memoire(corrigees);
  for (const p of corrigees) await learnWhenLeaving(p.id, cat);
}

describe("défaut 2 : l'apprentissage vise l'habitude, pas « profil actuel + correction »", () => {
  it("la sonde : six albums de 200 photos, corrigés photo par photo, ne font plus diverger le profil", () => {
    // La sonde de l'agent précédent (style-appris-perime.test.ts), avec le
    // style que portait la passe : avant, [50, −100, 100, −100, 100, −100].
    let profil: StyleProfile = { samples: 12, warmth: 0 };
    const trace: number[] = [];
    for (let album = 0; album < 6; album++) {
      const porte = profilPorte(profil);
      const proposee = applyProfile({ warmth: 0, exposure: 0 }, profil);
      for (let i = 0; i < 200; i++)
        profil = learnProfile(
          [{ proposed: proposee, final: { ...proposee, warmth: 10 }, carried: porte }],
          profil,
        );
      trace.push(profil.warmth!);
    }
    expect(Math.max(...trace.map(Math.abs))).toBeLessThanOrEqual(10.01);
    expect(trace.at(-1)).toBeGreaterThan(9.99);
  });

  for (const lr of [undefined, xmp])
    it(`100 photos corrigées, puis une nouvelle passe rejoint l'habitude sans la dépasser, ${lr ? "avec" : "sans"} style Lightroom, sur six albums`, async () => {
      forgetProfile();
      const base = autoTone(a, stats, undefined, lr);
      expect(base.warmth).toBeCloseTo(-2.42, 1);
      expect(base.contrast ?? 0).toBe(lr ? 8 : 0);
      const trace: Partial<Record<AutoField, number>>[] = [];
      for (let album = 0; album < 6; album++) {
        await corriger(passe(100, readProfile(), lr));
        const [proposee] = passe(1, readProfile(), lr);
        trace.push({
          warmth: proposee.proposal!.warmth ?? 0,
          contrast: proposee.proposal!.contrast ?? 0,
          saturation: proposee.proposal!.saturation ?? 0,
        });
      }
      // Dès le deuxième album, la proposition est l'habitude : il n'y a plus
      // rien à corriger, donc plus rien à apprendre, et le profil ne bouge plus.
      expect(readProfile()!.samples).toBe(100);
      for (const t of trace)
        for (const [f, voulu] of Object.entries(HABITUDE) as [AutoField, number][]) {
          // À 1 près, et jamais au-delà (au centième près des arrondis).
          expect(Math.abs(t[f]! - voulu)).toBeLessThanOrEqual(1);
          expect(t[f]!).toBeLessThanOrEqual(voulu + 0.01);
        }
      // Le style appris est l'écart à la proposition sans lui : +12,4 de
      // chaleur, et +7 / +10 au-dessus du style Lightroom (sinon +15 / 0).
      const p = readProfile()!;
      expect(p.warmth).toBeCloseTo(12.42, 1);
      expect(p.contrast).toBeCloseTo(lr ? 7 : 15, 1);
      expect(p.saturation).toBeCloseTo(lr ? 10 : 0, 1);
    });

  it("un album passé avec un ancien profil n'est pas compté deux fois quand on le corrige après un autre", async () => {
    forgetProfile();
    // Deux albums préparés avant toute correction : ils ne portent rien.
    const premier = passe(60),
      second = passe(60);
    await corriger(premier);
    // Le profil a mûri entre-temps ; le second album porte toujours l'ancien.
    expect(readProfile()!.warmth).toBeCloseTo(12.42, 1);
    await corriger(second);
    const p = readProfile()!;
    expect(p.warmth).toBeCloseTo(12.42, 1);
    expect(p.contrast).toBeCloseTo(15, 1);
    // Avant : chaque photo du second album rajoutait sa correction entière.
  });

  it("le changement d'habitude est suivi, sans dépasser la nouvelle valeur", async () => {
    forgetProfile();
    await corriger(passe(100));
    const chaleurs: number[] = [];
    for (let album = 0; album < 4; album++) {
      const photos = passe(100, readProfile()).map((p) =>
        editPhoto(p, { ...HABITUDE, warmth: 25 }, "g"),
      );
      const cat = memoire(photos);
      for (const p of photos) await learnWhenLeaving(p.id, cat);
      chaleurs.push(passe(1, readProfile())[0].proposal!.warmth!);
    }
    expect(Math.max(...chaleurs)).toBeLessThanOrEqual(25.01);
    expect(chaleurs.at(-1)!).toBeGreaterThan(24);
  });

  it("une proposition antérieure au champ proposalProfile compte comme n'en portant aucun", () => {
    const ancienne = {
      proposal: { warmth: -2.4 },
      adjustments: { ...DEFAULT, warmth: 10 },
    } as unknown as Photo;
    expect(correctionOf(ancienne)?.carried).toEqual({});
    // Même avec un profil déjà mûr : la cible est l'habitude (+12,4), pas
    // l'habitude plus le profil (+24,8).
    const mur = { samples: 200, warmth: 12.4 };
    const c = correctionOf(ancienne)!;
    expect(learnProfile([c], mur).warmth).toBeCloseTo(12.4, 1);
  });

  it("le profil reste dans les bornes des réglages, même pour une habitude extrême", () => {
    let profil: StyleProfile | undefined;
    for (let album = 0; album < 5; album++) {
      const porte = profilPorte(profil);
      const proposee = applyProfile({ warmth: 30, saturation: 0 }, profil);
      for (let i = 0; i < 100; i++)
        profil = learnProfile(
          [{ proposed: proposee, final: { warmth: 100, saturation: -100 }, carried: porte }],
          profil,
        );
    }
    for (const f of Object.keys(AUTO_FIELDS) as AutoField[]) {
      const [min, max] = AUTO_FIELDS[f];
      expect(profil![f] ?? 0).toBeGreaterThanOrEqual(min);
      expect(profil![f] ?? 0).toBeLessThanOrEqual(max);
    }
    expect(applyProfile({ warmth: 30 }, profil).warmth).toBe(100);
  });
});

describe("défaut 1 : Juno apprend en quittant une photo, sur son état enregistré", () => {
  async function ouverte(projectId: string) {
    const [p] = passe(1);
    const photo = { ...p, id: crypto.randomUUID(), projectId };
    await putPhoto(photo);
    return (await getPhoto(photo.id))!;
  }
  const catalogue = (writer: PhotoWriter) => ({
    flush: () => writer.flush(),
    read: getPhoto,
    modify: modifyPhoto,
  });

  it("des réglages déjà enregistrés sont appris, une seule fois", async () => {
    forgetProfile();
    const writer = new PhotoWriter(() => {}, () => {});
    const photo = await ouverte("quitter");
    for (const [k, v] of Object.entries(HABITUDE))
      await writer.write(photo.id, (p) => editPhoto(p, { [k]: v }, "g"));
    await writer.flush();
    // L'ancien effet d'App.tsx : la photo telle qu'à son ouverture, plus les
    // écritures encore en file (aucune). Il ne voyait rien à apprendre.
    expect(correctionOf(writer.project(photo))).toBeUndefined();
    const appris = await learnWhenLeaving(photo.id, catalogue(writer));
    expect(appris?.samples).toBe(1);
    expect(appris?.warmth).toBeCloseTo(12.42, 1);
    expect(appris?.contrast).toBe(15);
    expect((await getPhoto(photo.id))!.proposalLearned).toBe(true);
    // Quitter à nouveau la photo n'apprend rien de plus.
    expect(await learnWhenLeaving(photo.id, catalogue(writer))).toBeUndefined();
    expect(readProfile()!.samples).toBe(1);
  });

  it("des réglages encore en file au moment de quitter sont attendus, puis appris", async () => {
    forgetProfile();
    const writer = new PhotoWriter(() => {}, () => {});
    const photo = await ouverte("quitter");
    for (const [k, v] of Object.entries(HABITUDE))
      void writer.write(photo.id, (p) => editPhoto(p, { [k]: v }, "g"));
    const appris = await learnWhenLeaving(photo.id, catalogue(writer));
    expect(appris?.contrast).toBe(15);
    expect(appris?.saturation).toBe(0);
  });

  it("deux départs simultanés de la même photo ne comptent qu'une correction", async () => {
    forgetProfile();
    const writer = new PhotoWriter(() => {}, () => {});
    const photo = await ouverte("quitter");
    await writer.write(photo.id, (p) => editPhoto(p, HABITUDE, "g"));
    await Promise.all([
      learnWhenLeaving(photo.id, catalogue(writer)),
      learnWhenLeaving(photo.id, catalogue(writer)),
    ]);
    expect(readProfile()!.samples).toBe(1);
  });

  it("une photo laissée telle quelle n'est ni apprise ni réécrite", async () => {
    forgetProfile();
    const writer = new PhotoWriter(() => {}, () => {});
    const photo = await ouverte("quitter");
    expect(await learnWhenLeaving(photo.id, catalogue(writer))).toBeUndefined();
    const apres = (await getPhoto(photo.id))!;
    // Sa révision ne bouge pas : une passe d'album en cours ne la croit pas
    // modifiée.
    expect(apres.revision).toBe(photo.revision);
    expect(apres.proposalLearned).toBe(false);
    expect(readProfile()).toBeUndefined();
  });

  it("une écriture en échec n'apprend rien : la photo le sera au prochain départ", async () => {
    forgetProfile();
    let panne = true;
    const writer = new PhotoWriter(
      () => {},
      () => {},
      (id, update) => (panne ? Promise.reject(Error("Disque plein.")) : modifyPhoto(id, update)),
    );
    const photo = await ouverte("quitter");
    await writer.write(photo.id, (p) => editPhoto(p, HABITUDE, "g")).catch(() => {});
    expect(await learnWhenLeaving(photo.id, catalogue(writer))).toBeUndefined();
    expect((await getPhoto(photo.id))!.proposalLearned).toBe(false);
    panne = false;
    await writer.retry();
    expect((await learnWhenLeaving(photo.id, catalogue(writer)))?.samples).toBe(1);
  });

  it("l'effet d'App.tsx ne garde plus la photo de l'ouverture, et passe par learnWhenLeaving", async () => {
    const fs = await import("node:fs/promises");
    const app = await fs.readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
    const debut = app.indexOf("const leaving = useRef");
    const effet = app.slice(debut, app.indexOf("}, [current?.id]);", debut));
    expect(debut).toBeGreaterThan(0);
    expect(effet).toMatch(/useRef<string \| undefined>/);
    expect(effet).toMatch(/leaving\.current = current\?\.id;/);
    expect(effet).toMatch(/learnWhenLeaving\(previous, \{/);
    expect(effet).toMatch(/read: getPhoto/);
    expect(effet).not.toMatch(/writer\.current\?\.project\(previous\)/);
  });
});

describe("la proposition garde le style qu'elle portait", () => {
  it("la passe d'album de jobs.ts enregistre profilPorte avec la proposition", async () => {
    const fs = await import("node:fs/promises");
    const jobs = await fs.readFile(new URL("../src/modules/jobs.ts", import.meta.url), "utf8");
    // Sans l'exposition pour une photo sensible (voir autoTone).
    expect(jobs).toMatch(/proposalProfile: sensitive\s*\?\s*sansExposition\(profilPorte\(job\.options\.styleProfile\)\)\s*:\s*profilPorte\(job\.options\.styleProfile\),/);
  });

  it("profilPorte est exactement ce que applyProfile ajoute", () => {
    expect(profilPorte({ samples: PROFILE_MIN_SAMPLES - 1, warmth: 9 })).toEqual({});
    const profil = { samples: PROFILE_MIN_SAMPLES, warmth: 9, contrast: 0, tint: -3 };
    expect(profilPorte(profil)).toEqual({ warmth: 9, tint: -3 });
    const base = { warmth: 1, tint: 2, exposure: 0.3 };
    const porte = profilPorte(profil);
    const ajoute = applyProfile(base, profil);
    for (const f of ["warmth", "tint", "exposure"] as AutoField[])
      expect(ajoute[f]! - (base[f] ?? 0)).toBeCloseTo(porte[f] ?? 0, 5);
  });

  it("le catalogue ne garde que des réglages appris, bornés", () => {
    const projet = { id: "cat", name: "Essai", date: "2026-09-29", location: "", created: 1 } as any;
    const [p] = validateCatalog(projet, [
      fiche("cat", {
        proposal: { warmth: 10 },
        proposalProfile: { warmth: 12.5, contrast: 500, tint: "x", intrus: 3 } as any,
      }),
    ]).photos;
    expect(p.proposalProfile).toEqual({ warmth: 12.5 });
    const [q] = validateCatalog(projet, [fiche("cat", { proposalProfile: "rien" as any })]).photos;
    expect(q.proposalProfile).toBeUndefined();
  });

  it("annuler la passe retire aussi le style porté, la rétablir le remet", async () => {
    const projectId = crypto.randomUUID(),
      cmd = "cmd-" + projectId,
      job = "job-" + projectId;
    const p = fiche(projectId);
    await putPhoto(p);
    const porte = { warmth: 12.4, contrast: 15 };
    await photoTransaction(
      { id: cmd, projectId, ids: [p.id], label: "Album · première retouche Juno", source: "recipe", append: true, jobId: job, expected: { [p.id]: 0 } },
      (l) => ({
        ...editPhoto(l, { warmth: 10, style: "signature", intensity: 100 }, cmd),
        proposal: { warmth: 10 },
        proposalProfile: porte,
        proposalLearned: false,
      }),
    );
    await (await database).put("jobs", { id: job, state: "done" });
    await restoreCommand(cmd);
    expect((await getPhoto(p.id))!.proposalProfile).toBeUndefined();
    await restoreCommand(cmd, true);
    expect((await getPhoto(p.id))!.proposalProfile).toEqual(porte);
  });
});

describe("défaut 3 : les Paramètres disent ce qui est appris, et l'oubli le remet à zéro", () => {
  it("le résumé donne les réglages et le nombre de photos", async () => {
    forgetProfile();
    expect(describeLearned()).toMatch(/rien appris/);
    await corriger(passe(5));
    expect(describeLearned()).toMatch(/5 photos corrigées/);
    expect(describeLearned()).toMatch(/à partir de 12 photos/);
    await corriger(passe(95));
    const texte = describeLearned();
    expect(texte).toMatch(/Appris sur 100 photos corrigées/);
    expect(texte).toMatch(/Chaleur \+12,4/);
    expect(texte).toMatch(/Contraste \+15/);
    expect(texte).not.toMatch(/Saturation/);
    expect(texte).not.toMatch(/\u2014/);
    writeProfile({ samples: 30, exposure: -0.35, warmth: 0 });
    expect(describeLearned()).toMatch(/Exposition −0,35 IL/);
    writeProfile({ samples: 30, warmth: 0.02 });
    expect(describeLearned()).toMatch(/il n’y ajoute rien/);
  });

  it("oublier remet la proposition suivante à celle d'un profil vide", async () => {
    forgetProfile();
    const vide = passe(1)[0].proposal!;
    await corriger(passe(100));
    expect(passe(1, readProfile())[0].proposal!.warmth).toBeCloseTo(10, 0);
    forgetProfile();
    expect(readProfile()).toBeUndefined();
    const apres = passe(1, readProfile())[0];
    expect(apres.proposal).toEqual(vide);
    expect(apres.proposalProfile).toEqual({});
  });

  it("le bouton des Paramètres existe, avec sa confirmation", async () => {
    const fs = await import("node:fs/promises");
    const app = await fs.readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).toMatch(/Oublier ce que Juno a appris de mes\s+corrections/);
    expect(app).toMatch(/Oui, tout oublier/);
    expect(app).toMatch(/forgetProfile\(\);/);
    expect(app).toMatch(/describeLearned\(readProfile\(\)\)/);
  });
});

describe("photo sensible et style appris (relecture du 29/09/2026)", () => {
  it("une photo très sombre ne reçoit pas l'exposition apprise, et n'enseigne pas la sienne", async () => {
    const { autoTone, learnProfile } = await import("../src/modules/auto-tone");
    const { correctionOf } = await import("../src/modules/style-profile");
    const profil = { samples: 40, exposure: 0.3, contrast: 10 };
    const sombre = { brightness: 0.05, sharpness: 500, clipped: 0, dhash: "0".repeat(64), advice: "normal" as const, reasons: [] };
    const normale = { ...sombre, brightness: 0.45 };
    const a = autoTone(sombre, undefined, profil as never);
    expect(a.exposure ?? 0).toBe(0);
    expect(a.contrast).toBe(10);
    expect(autoTone(normale, undefined, profil as never).exposure).not.toBe(0);
    // Laissée telle quelle par le photographe : aucune leçon d'exposition.
    const photo = (analysis: typeof sombre, final: Record<string, number>) =>
      ({ proposal: { exposure: 0, contrast: 10 }, proposalProfile: { contrast: 10 }, proposalLearned: false, adjustments: final, analysis }) as never;
    expect(correctionOf(photo(sombre, { exposure: 0, contrast: 10 }))).toBeUndefined();
    const c = correctionOf(photo(sombre, { exposure: 0, contrast: 20 }))!;
    expect(c.ignore).toEqual(["exposure"]);
    const appris = learnProfile([c], profil as never);
    expect(appris.exposure).toBe(0.3);
  });
});
