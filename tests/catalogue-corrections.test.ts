// Corrections de l'audit du catalogue (29/09/2026), côté fenêtre. Les
// gestionnaires du processus principal sont rejoués dans
// tests/catalogue-corrections.test.cjs.
import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { DEFAULT, type Photo, type Project } from "../src/model";
import {
  validateAdjustments,
  validateCatalog,
} from "../src/modules/catalog-validation";
import { applyPhotoAction } from "../src/assistant/commands";
import { getPhoto, restoreProject } from "../src/db";
import { deplier, ficheDEquipe } from "../src/modules/TeamPanel";
import { ficheDeRelecture } from "../src/review/ReviewPanel";

const require = createRequire(import.meta.url);
const { verifierCatalogue } = require("../electron/backup.cjs") as {
  verifierCatalogue: (project: unknown, photos: unknown[]) => void;
};

const projet: Project = {
  id: "mariage",
  name: "Mariage Léa et Hugo",
  date: "2026-09-12",
  location: "Lyon",
  kind: "Mariage",
  demo: false,
  created: 1,
};
const photo = (id: string, extra: Partial<Photo> = {}): Photo => ({
  id,
  projectId: "mariage",
  name: id + ".jpg",
  source: "juno://image/" + id,
  thumbnail: "",
  width: 6000,
  height: 4000,
  size: 1,
  hash: "b".repeat(64),
  status: "keep",
  stars: 0,
  protected: false,
  chapter: "Cérémonie",
  adjustments: { ...DEFAULT },
  history: [],
  created: 1,
  ...extra,
});
/** Le calque que crée « Détourer une personne » (EditorPreview), à l'identique. */
const sujet = {
  id: "s",
  name: "Sujet détouré",
  tool: "subject" as const,
  points: [{ x: 0.4, y: 0.6 }],
  radius: 0,
  amount: 0.3,
  opacity: 1,
  visible: true,
};
const pinceau = (amount: number, x = 0.5) => ({
  id: "p" + amount,
  name: "Pinceau",
  tool: "exposure" as const,
  points: [{ x, y: 0.5 }],
  radius: 0.05,
  amount,
  opacity: 1,
  visible: true,
});

describe("défaut 0 : les calques que l'atelier crée ne bloquent plus la photo", () => {
  it("« Sujet détouré » (rayon nul) est accepté, et les curseurs de la photo restent utilisables", () => {
    const p = photo("detouree", {
      adjustments: { ...DEFAULT, localEdits: [sujet] },
    });
    expect(validateAdjustments(p.adjustments).localEdits?.[0].radius).toBe(0);
    // Le chemin de chaque curseur : le réglage complet est revalidé.
    const apres = applyPhotoAction(p, {
      kind: "photo.adjust",
      field: "exposure",
      value: 0.5,
      relative: false,
    });
    expect(apres.adjustments.exposure).toBe(0.5);
    const contraste = applyPhotoAction(apres, {
      kind: "photo.adjust",
      field: "contrast",
      value: 20,
      relative: false,
    });
    expect(contraste.adjustments.contrast).toBe(20);
    // Un pinceau garde son rayon minimal : seul le sujet détouré en est dispensé.
    expect(() =>
      validateAdjustments({
        ...DEFAULT,
        localEdits: [{ ...pinceau(1), radius: 0 }],
      }),
    ).toThrow("réglages invalides");
  });
  it("une force tapée au-delà de ±4 est gardée, bornée seulement là où l'image sature", () => {
    const a = validateAdjustments({
      ...DEFAULT,
      localEdits: [pinceau(5), pinceau(-7), pinceau(1e6)],
    });
    expect(a.localEdits!.map((e) => e.amount)).toEqual([5, -7, 16]);
    expect(() =>
      validateAdjustments({ ...DEFAULT, localEdits: [pinceau(NaN)] }),
    ).toThrow();
    const p = photo("forte", {
      adjustments: { ...DEFAULT, localEdits: [pinceau(5)] },
    });
    expect(
      applyPhotoAction(p, {
        kind: "photo.adjust",
        field: "exposure",
        value: 0.5,
        relative: false,
      }).adjustments.exposure,
    ).toBe(0.5);
  });
  it("un trait posé au bord d'une photo redressée (1 + 2e-16) est ramené dans le cadre", () => {
    const a = validateAdjustments({
      ...DEFAULT,
      localEdits: [pinceau(1, 1 + 2e-16)],
    });
    expect(a.localEdits![0].points[0].x).toBe(1);
    expect(() =>
      validateAdjustments({ ...DEFAULT, localEdits: [pinceau(1, 1.01)] }),
    ).toThrow();
  });
});

/** Une fiche forgée : chaque champ affiché porte un objet au lieu d'un texte. */
const forgee = () =>
  photo("forgee", {
    chapter: { texte: "Cérémonie" } as never,
    moment: 12 as never,
    camera: { make: { texte: "Canon" }, model: "EOS R5" } as never,
    proposal: { exposure: 0.3, contrast: "fort" } as never,
    analysis: {
      brightness: 0.5,
      sharpness: 120,
      clipped: 0,
      dhash: "0".repeat(64),
      advice: "normal",
      reasons: ["Nette"],
      verdict: { texte: "Nette" } as never,
      groupId: ["rafale"] as never,
      suggested: "oui" as never,
      faces: {
        count: 1,
        closedEyes: 0,
        blink: 0,
        version: "visages-3",
        reads: [{ weight: "lourd" }] as never,
      },
    },
  });

describe("défaut 1 : une sauvegarde forgée ne fait plus planter le studio", () => {
  it("les champs descriptifs du mauvais type sont retirés, le reste de la fiche gardé", () => {
    const [p] = validateCatalog(projet, [forgee()]).photos;
    expect(p.chapter).toBeUndefined();
    expect(p.moment).toBeUndefined();
    expect(p.camera).toEqual({ model: "EOS R5" });
    expect(p.proposal).toEqual({ exposure: 0.3 });
    expect(p.analysis?.verdict).toBeUndefined();
    expect(p.analysis?.groupId).toBeUndefined();
    expect(p.analysis?.suggested).toBeUndefined();
    expect(p.analysis?.faces?.reads).toEqual([]);
    // Sans version, la prochaine passe relit les visages.
    expect(p.analysis?.faces?.version).toBeUndefined();
    expect(p.analysis?.reasons).toEqual(["Nette"]);
    expect(p.name).toBe("forgee.jpg");
  });
  it("le catalogue enregistré ne garde que des textes là où l'écran affiche du texte", async () => {
    await restoreProject({ ...projet, id: "forge-restaure" }, [
      { ...forgee(), id: "forgee-2", projectId: "forge-restaure" },
    ]);
    const lu = await getPhoto("forgee-2");
    expect(lu?.analysis?.verdict).toBeUndefined();
    expect(lu?.chapter).toBeUndefined();
  });
  it("la copie d'équipe récupérée est relue avant d'être montrée", () => {
    const source = readFileSync(
      new URL("../src/modules/TeamPanel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(/const propres = validateCatalog\(p, ps\)\.photos;/);
    expect(source).toMatch(/onRestore\(p, propres\)/);
  });
});

describe("défauts 1 et 7 : le processus principal juge la sauvegarde comme la fenêtre", () => {
  // Chaque cas : une fiche, et ce que la fenêtre en dit.
  const cas: [string, Photo][] = [
    ["fiche saine", photo("a")],
    ["fiche forgée (textes)", forgee()],
    ["sujet détouré", photo("b", { adjustments: { ...DEFAULT, localEdits: [sujet] } })],
    ["force 5", photo("c", { adjustments: { ...DEFAULT, localEdits: [pinceau(5)] } })],
    ["opacité 2", photo("d", { adjustments: { ...DEFAULT, localEdits: [{ ...pinceau(1), opacity: 2 }] } })],
    ["rotation 45", photo("e", { adjustments: { ...DEFAULT, rotation: 45 } })],
    ["historique invalide", photo("f", { history: [{ ...DEFAULT, exposure: 9 }] })],
    ["version sans identifiant", photo("g", { versions: [{ name: "V1", created: 1, adjustments: DEFAULT } as never] })],
    ["dhash invalide", photo("h", { analysis: { ...forgee().analysis!, dhash: "2" } })],
    ["netteté de visage hors bornes", photo("i", { analysis: { ...forgee().analysis!, faces: { count: 1, closedEyes: 0, blink: 0, version: "v", reads: [{ nettete: 3 }] as never } } })],
    ["statut inconnu", photo("j", { status: "peut-être" as never })],
    ["vignette qui n'est pas une image", photo("k", { thumbnail: "javascript:alert(1)" })],
  ];
  it.each(cas)("%s", (_nom, p) => {
    let fenetre = "acceptée",
      principal = "acceptée";
    try {
      validateCatalog(projet, [p]);
    } catch (e) {
      fenetre = (e as Error).message;
    }
    try {
      verifierCatalogue(projet, [p]);
    } catch (e) {
      principal = (e as Error).message;
    }
    expect(principal).toBe(fenetre);
  });
});

/** Une fiche préparée par la passe d'album, avec ce qui pèse vraiment. */
function fichePreparee(i: number): Photo {
  const semantic = new Float32Array(768).map((_, k) => Math.sin(i + k) / 7);
  return photo("photo-" + i, {
    thumbnail: "data:image/jpeg;base64," + "A".repeat(40000),
    semantic,
    future: Array.from({ length: 10 }, () => ({ ...DEFAULT, exposure: 0.3 })),
    originalRecovery: { ...DEFAULT },
    history: Array.from({ length: 40 }, () => ({ ...DEFAULT })),
    analysis: {
      brightness: 0.5,
      sharpness: 120,
      clipped: 0,
      dhash: "0".repeat(64),
      advice: "normal",
      reasons: [],
      verdict: "Nette, yeux ouverts",
      // Un visage lu, comme sur une vraie fiche : 6,6 ko de signature et
      // de descripteur, qui restent partagés pour reconnaître les personnes.
      faces: {
        count: 1,
        closedEyes: 0,
        blink: 0,
        version: "visages-3",
        reads: [
          {
            region: { x: 0.51, y: 0.25, w: 0.24, h: 0.17 },
            weight: 0.04,
            sharpness: 595.2,
            nettete: 0.26,
            eyesClosed: 0.43,
            smile: 0.84,
            turned: 0.58,
            signature: Array.from({ length: 190 }, (_, k) => Math.cos(i + k)),
            descriptor: Array.from({ length: 128 }, (_, k) => Math.sin(i * k) / 10),
            personId: "person-1",
          },
        ],
      },
      empreinte: {
        version: "e1",
        gw: 32,
        gh: 24,
        g: "A".repeat(1024),
        hist: Array(64).fill(0.01),
        hog: Array(128).fill(0.01),
      } as never,
    },
  });
}

describe("défaut 5 : le partage d'équipe d'un album analysé", () => {
  it("ne transporte ni le résumé de sens, ni la pile de rétablissement, ni l'empreinte", () => {
    const f = ficheDEquipe(fichePreparee(1), new Map());
    for (const cle of [
      "semantic",
      "future",
      "originalRecovery",
      "thumbnail",
      "source",
    ])
      expect(f).not.toHaveProperty(cle, expect.anything());
    expect(f.analysis?.empreinte).toBeUndefined();
    expect(f.history).toEqual([]);
    expect(f.analysis?.verdict).toBe("Nette, yeux ouverts");
  });
  it("900 photos analysées, un visage chacune, tiennent dans le catalogue partagé de 8 Mo", () => {
    // Avant : environ 320 photos, le résumé de sens pesant 20,8 ko chacune.
    const photos = Array.from({ length: 900 }, (_, i) => fichePreparee(i));
    const payload = {
      schema: 2,
      project: {},
      photos: photos.map((p) => ficheDEquipe(p, new Map())),
    };
    expect(JSON.stringify(payload).length).toBeLessThan(8 * 1024 * 1024);
    // La copie récupérée par un collègue reste un catalogue valide.
    const recue = JSON.parse(JSON.stringify(payload)).photos.map(
      (p: Photo) => ({ ...p, projectId: "mariage", source: "idb", thumbnail: "" }),
    );
    expect(validateCatalog(projet, recue).photos).toHaveLength(900);
  });
});

describe("relecture du défaut 5 (29/09/2026)", () => {
  it("les lectures de visage partent allégées : un mariage de 5 000 photos tient dans 8 Mo", () => {
    const f = ficheDEquipe(fichePreparee(1), new Map());
    const lu = f.analysis!.faces!.reads![0];
    // Le descripteur suffit à reconnaître : la signature ne part pas avec lui.
    expect(lu.signature).toBeUndefined();
    // Compacté à l'envoi, rendu en nombres à la réception, au dix-millième près.
    const rendu = deplier(lu.descriptor)!;
    const avant = fichePreparee(1).analysis!.faces!.reads![0].descriptor!;
    expect(rendu).toHaveLength(128);
    expect(Math.max(...rendu.map((x, k) => Math.abs(x - avant[k])))).toBeLessThan(1e-4);
    expect(deplier("i16:%%%")).toBeUndefined();
    expect(deplier([0.1, 0.2])).toEqual([0.1, 0.2]);
    const photos = Array.from({ length: 5000 }, (_, i) => fichePreparee(i));
    const payload = { schema: 2, project: {}, photos: photos.map((p) => ficheDEquipe(p, new Map())) };
    expect(JSON.stringify(payload).length).toBeLessThan(8 * 1024 * 1024);
  });
});

describe("défaut 6 : la publication client d'une grande sélection", () => {
  it("n'envoie que ce que la préparation relit", () => {
    const f = ficheDeRelecture(fichePreparee(2));
    expect(Object.keys(f).sort()).toEqual(
      [
        "adjustments",
        "hash",
        "height",
        "id",
        "name",
        "previewOnly",
        "projectId",
        "revision",
        "source",
        "width",
      ].sort(),
    );
  });
  it("10 000 photos restent sous le plafond de 32 Mo de la préparation", () => {
    const une = fichePreparee(3);
    const selection = Array.from({ length: 10000 }, (_, i) =>
      ficheDeRelecture({ ...une, id: "photo-" + i }),
    );
    expect(JSON.stringify(selection).length).toBeLessThan(32 * 1024 * 1024);
  });
});

describe("défaut 4 : « Rouvrir le studio » recharge vraiment la page", () => {
  it("la garde de navigation laisse passer le rechargement de la page du studio, et elle seule", () => {
    const main = readFileSync(
      new URL("../electron/main.cjs", import.meta.url),
      "utf8",
    );
    const garde = main.match(
      /win\.webContents\.on\("will-navigate", \(e, adresse\) => \{([\s\S]*?)\n    \}\);/,
    );
    expect(garde).not.toBeNull();
    // La garde rejouée avec l'adresse de la page, comme Electron l'appelle.
    const localPage = "file:///Applications/Juno%20Studio.app/dist/index.html";
    const juger = new Function(
      "e",
      "adresse",
      "localPage",
      garde![1],
    ) as (e: unknown, adresse: string, localPage: string) => void;
    const essai = (url: string) => {
      let refusee = false;
      juger({ url, preventDefault: () => (refusee = true) }, url, localPage);
      return refusee;
    };
    expect(essai(localPage)).toBe(false);
    expect(essai(localPage + "#photo")).toBe(false);
    expect(essai("https://exemple.com/")).toBe(true);
    expect(essai("file:///etc/passwd")).toBe(true);
    expect(essai(localPage.replace("index.html", "autre.html"))).toBe(true);
  });
});
