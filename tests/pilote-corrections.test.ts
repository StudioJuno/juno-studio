// Les défauts du pilote relevés par l'audit du 29/09/2026, un test par défaut.
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyPhotoAction,
  cibleDite,
  parsePrompt,
  Refus,
  type Plan,
  type PhotoAction,
} from "../src/assistant/commands";
import {
  cibleInchangee,
  confirmationRequise,
  relireProposition,
} from "../src/assistant/intent-check";
import { applyVideoActions } from "../src/assistant/video-actions";
import {
  photoHistory,
  photoTransaction,
  restoreCommand,
} from "../src/assistant/journal";
import { EXEMPLES } from "../src/assistant/Pilot";
import { DEFAULT, editPhoto, type Photo } from "../src/model";
import { database, getPhoto, modifyPhoto, putPhoto } from "../src/db";
import { correctionOf } from "../src/modules/style-profile";
import type { Asset, Clip, Sequence } from "../src/video/types";

const require = createRequire(import.meta.url);
const photo = (adj: Partial<Photo["adjustments"]> = {}, projectId = "x"): Photo =>
  ({
    id: crypto.randomUUID(),
    projectId,
    name: "p.jpg",
    source: "immutable",
    thumbnail: "",
    width: 6000,
    height: 4000,
    hash: "h",
    status: "pending",
    stars: 0,
    protected: false,
    chapter: "",
    history: [],
    revision: 0,
    adjustments: { ...DEFAULT, ...adj },
  }) as unknown as Photo;
const appliquer = (phrase: string, p: Photo) =>
  (parsePrompt(phrase, "photo").actions as PhotoAction[]).reduce(
    (x, a) => applyPhotoAction(x, a, "g"),
    p,
  );
const seq = (clips: Clip[], extra: Partial<Sequence> = {}): Sequence =>
  ({
    id: "s",
    name: "s",
    fps: { n: 25, d: 1 },
    width: 1920,
    height: 1080,
    clips,
    titles: [],
    captions: [],
    markers: [],
    masterGain: 1,
    created: 0,
    ...extra,
  }) as unknown as Sequence;
const clip = (over: Partial<Clip> = {}): Clip =>
  ({
    id: "c1",
    assetId: "a",
    start: 0,
    duration: 500,
    inUs: 0,
    track: 0,
    speed: 1,
    gain: 1,
    muted: false,
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    fadeIn: 0,
    fadeOut: 0,
    grade: {},
    ...over,
  }) as unknown as Clip;
const media = (over: Partial<Asset> = {}) =>
  ({
    id: "a",
    name: "m.mov",
    kind: "video",
    duration: 60,
    audioChannels: 2,
    analysis: { scenes: [], silences: [{ start: 5, end: 7 }] },
    ...over,
  }) as unknown as Asset;
const va = (t: string, scope?: Plan["scope"]) =>
  parsePrompt(t, "video", scope).actions as never;
const verrouillee = (clips: Clip[] = [clip()]) =>
  seq(clips, { tracks: { 0: { locked: true } } } as never);
/** Les éléments de chaque portée, tels que les capture le pilote : la photo active seule, et n éléments ailleurs. */
const portees = (n: Partial<Record<Plan["scope"], number>>) =>
  Object.fromEntries(
    (["current", "selection", "album", "kept"] as const).map((s) => [
      s,
      Array.from({ length: n[s] ?? (s === "current" ? 1 : 0) }, (_, i) => `${s}-${i}`),
    ]),
  ) as Record<Plan["scope"], string[]>;

describe("sens des verbes de réglage", () => {
  it("monte, remonte, descends et abaisse ajoutent ou retirent, dans le bon sens", () => {
    expect(appliquer("descends le contraste de 10", photo({ contrast: 30 })).adjustments.contrast).toBe(20);
    expect(appliquer("monte les ombres de 15", photo({ shadows: 40 })).adjustments.shadows).toBe(55);
    expect(appliquer("abaisse la saturation de 20", photo()).adjustments.saturation).toBe(-20);
    expect(appliquer("remonte l'exposition de 0,4", photo({ exposure: 1 })).adjustments.exposure).toBeCloseTo(1.4);
    for (const verbe of ["augmente", "monte", "remonte"])
      expect(appliquer(`${verbe} la clarte de 5`, photo({ clarity: 10 })).adjustments.clarity, verbe).toBe(15);
    for (const verbe of ["baisse", "abaisse", "descends", "descend", "diminue", "reduis", "reduit"])
      expect(appliquer(`${verbe} la clarte de 5`, photo({ clarity: 10 })).adjustments.clarity, verbe).toBe(5);
  });
  it("les mêmes verbes valent en vidéo", () => {
    expect(va("monte le volume de 3 dB")[0]).toEqual({ kind: "video.adjust", field: "gain", value: 3, relative: true });
    expect(va("descends le volume de 3 dB")[0]).toEqual({ kind: "video.adjust", field: "gain", value: -3, relative: true });
  });
});

describe("« à N » vise une valeur, « de N » donne un écart", () => {
  it("en photo", () => {
    expect(appliquer("baisse l'exposition à 0,5", photo({ exposure: 2 })).adjustments.exposure).toBe(0.5);
    expect(appliquer("diminue la saturation à 0", photo({ saturation: 30 })).adjustments.saturation).toBe(0);
    expect(appliquer("augmente le contraste à 40", photo({ contrast: 10 })).adjustments.contrast).toBe(40);
    // Le verbe et la cible se contredisent : rien n'est modifié.
    expect(() => appliquer("baisse l'exposition à 0,5", photo({ exposure: 0.2 }))).toThrow(/la ferait monter/);
    expect(() => appliquer("augmente le contraste à 10", photo({ contrast: 30 }))).toThrow(/la ferait baisser/);
  });
  it("en vidéo", () => {
    expect(va("augmente le volume à -3 dB")[0]).toEqual({ kind: "video.adjust", field: "gain", value: -3, relative: false, sens: 1 });
    expect(va("baisse le volume à -6 dB")[0]).toMatchObject({ value: -6, relative: false, sens: -1 });
    const son = seq([clip({ id: "a1", track: 10, component: "audio", gain: 0.25 } as never)]);
    expect(applyVideoActions(son, va("augmente le volume à -3 dB"), ["a1"], 0, [media()]).clips[0].gain).toBeCloseTo(0.708, 3);
    const fort = seq([clip({ id: "a1", track: 10, component: "audio", gain: 1 } as never)]);
    expect(() => applyVideoActions(fort, va("augmente le volume à -3 dB"), ["a1"], 0, [media()])).toThrow(/la ferait baisser/);
  });
});

it("une consigne enchaînée reprend le verbe de la précédente", () => {
  expect(parsePrompt("baisse les ombres de 20 et hautes lumières de 10", "photo").actions).toEqual([
    { kind: "photo.adjust", field: "shadows", value: -20, relative: true },
    { kind: "photo.adjust", field: "highlights", value: -10, relative: true },
  ]);
  // Sans verbe au départ, rien à reprendre : les valeurs restent absolues.
  expect(parsePrompt("Exposition à 1 puis contraste 10", "photo").actions).toEqual([
    { kind: "photo.adjust", field: "exposure", value: 1, relative: false },
    { kind: "photo.adjust", field: "contrast", value: 10, relative: false },
  ]);
  expect(va("baisse le volume de 3 dB et opacité de 10")[1]).toEqual({
    kind: "video.adjust",
    field: "opacity",
    value: -10,
    relative: true,
  });
});

describe("« cette photo » et « ce plan » priment sur la portée du panneau", () => {
  it("la portée devient l'élément actif", () => {
    expect(parsePrompt("écarte cette photo", "photo", "album").scope).toBe("current");
    expect(parsePrompt("Exposition à 1 sur cette photo", "photo", "selection").scope).toBe("current");
    expect(parsePrompt("supprime ce plan", "video", "album").scope).toBe("current");
    expect(parsePrompt("débruite ce plan", "video", "album").scope).toBe("current");
    // Sans ces mots, la portée du panneau reste celle qui compte.
    expect(parsePrompt("écarte", "photo", "album").scope).toBe("album");
    expect(() => parsePrompt("écarte cette photo sur tout l'album", "photo")).toThrow(Refus);
  });
  it("« supprime ce plan » ne retire que le plan actif", () => {
    const s = seq([clip({ id: "c1" }), clip({ id: "c2", start: 500 })]);
    const plan = parsePrompt("supprime ce plan", "video", "album");
    const ids = { current: ["c1"], selection: ["c1"], album: ["c1", "c2"], kept: [] };
    expect(applyVideoActions(s, plan.actions as never, ids[plan.scope], 0, [media()]).clips.map((c) => c.id)).toEqual(["c2"]);
  });
  it("une action qui efface des décisions sur tout le projet demande une confirmation", () => {
    expect(confirmationRequise(parsePrompt("écarte", "photo", "album"), portees({ album: 312 }))).toMatch(/Cette commande vise tout le projet : écarter 312 photos/);
    expect(confirmationRequise(parsePrompt("reviens à l'original", "photo", "album"), portees({ album: 40 }))).toMatch(/à l’original/);
    expect(confirmationRequise(parsePrompt("mets 0 étoile", "photo", "album"), portees({ album: 40 }))).toMatch(/noter 40 photos/);
    const retrait = { ...parsePrompt("supprime ce plan", "video"), scope: "album" as const };
    expect(confirmationRequise(retrait, portees({ album: 12 }))).toMatch(/retirer 12 plans/);
    // Réglage réversible, élément actif, ou projet d'une seule photo : pas de confirmation.
    expect(confirmationRequise(parsePrompt("Exposition à 1", "photo", "album"), portees({ album: 312 }))).toBeUndefined();
    expect(confirmationRequise(parsePrompt("écarte", "photo", "current"), portees({ album: 312 }))).toBeUndefined();
    expect(confirmationRequise(parsePrompt("écarte", "photo", "album"), portees({ album: 1 }))).toBeUndefined();
  });
});

it("une proposition n'est appliquée qu'à la cible encore visible", () => {
  const photoA = { domain: "photo" as const, projectId: "p", ids: { current: ["a"], selection: [], album: ["a", "b"], kept: [] } };
  const photoB = { ...photoA, ids: { ...photoA.ids, current: ["b"] } };
  expect(cibleInchangee(photoA, { ...photoA }, "current")).toBe(true);
  expect(cibleInchangee(photoA, photoB, "current")).toBe(false);
  // Changer de photo active ne touche pas une proposition sur tout le projet.
  expect(cibleInchangee(photoA, photoB, "album")).toBe(true);
  expect(cibleInchangee(photoA, { ...photoA, projectId: "q" }, "album")).toBe(false);
  const video = { domain: "video" as const, projectId: "p", ids: { current: ["c1"], selection: ["c1"], album: ["c1"], kept: [] }, sequence: { id: "s" }, frame: 100 };
  expect(cibleInchangee(video, { ...video }, "current")).toBe(true);
  expect(cibleInchangee(video, { ...video, frame: 250 }, "current")).toBe(false);
  expect(cibleInchangee(video, { ...video, sequence: { id: "t" } }, "current")).toBe(false);
});

describe("durées", () => {
  it("« raccourcis de 2 s » retire 2 s, « raccourcis à 2 s » vise 2 s", () => {
    expect(va("raccourcis de 2 secondes")[0]).toEqual({ kind: "video.trim", seconds: 2, retire: true });
    expect(va("raccourcis à 2 secondes")[0]).toEqual({ kind: "video.trim", seconds: 2, raccourcit: true });
    expect(va("règle la durée à 30 secondes")[0]).toEqual({ kind: "video.trim", seconds: 30 });
    const s = seq([clip()]);
    expect(applyVideoActions(s, va("raccourcis de 2 secondes"), ["c1"], 0, [media()]).clips[0].duration).toBe(450);
    expect(applyVideoActions(s, va("raccourcis à 2 secondes"), ["c1"], 0, [media()]).clips[0].duration).toBe(50);
    expect(() => applyVideoActions(s, va("raccourcis à 30 secondes"), ["c1"], 0, [media()])).toThrow(/déjà plus court/);
    expect(() => applyVideoActions(s, va("raccourcis de 30 secondes"), ["c1"], 0, [media()])).toThrow(/moins que la durée/);
    expect(applyVideoActions(s, va("règle la durée à 30 secondes"), ["c1"], 0, [media()]).clips[0].duration).toBe(750);
  });
  it("une transition sans durée dure une seconde, et « 500 ms » est compris", () => {
    expect(va("mets une transition")[0]).toEqual({ kind: "video.transition", transition: "dissolve", seconds: 1 });
    expect(va("ajoute un fondu enchaîné de 500 ms")[0]).toMatchObject({ transition: "dissolve", seconds: 0.5 });
    // Un plan de 5 s reçoit désormais sa transition par défaut.
    const court = seq([clip({ duration: 125 })]);
    expect(applyVideoActions(court, va("mets un volet"), ["c1"], 0, [media()]).clips[0].transition).toEqual({ kind: "wipeleft", duration: 25 });
  });
  it("les blancs hors de 0,2 à 4 s sont refusés au lieu d'être bornés en silence", () => {
    expect(() => va("coupe les blancs de plus de 10 secondes")).toThrow(Refus);
    expect(va("supprime les silences de 1 seconde")[0]).toEqual({ kind: "video.silence", minSilence: 1 });
    expect(va("retire les blancs de 500 ms")[0]).toEqual({ kind: "video.silence", minSilence: 0.5 });
    expect(va("retire les blancs")[0]).toEqual({ kind: "video.silence", minSilence: 0.6 });
    // Un nombre sans unité n'est pas une durée : « des deux plans » ne règle rien.
    expect(va("retire les blancs des deux plans")[0]).toEqual({ kind: "video.silence", minSilence: 0.6 });
  });
});

describe("style de la passe d'album", () => {
  it("le style dicté est reconnu, un style inconnu est refusé", () => {
    expect(parsePrompt("Trie et retouche cet album avec le style noir et blanc", "photo").actions).toEqual([
      { kind: "album.process", style: "mono" },
    ]);
    expect(parsePrompt("Trie et retouche cet album avec le style film doux", "photo").actions).toEqual([
      { kind: "album.process", style: "film" },
    ]);
    expect(() => parsePrompt("Trie et retouche cet album avec le style pastel", "photo")).toThrow(Refus);
    expect(parsePrompt("applique le style noir et blanc", "photo").actions).toEqual([{ kind: "photo.style", style: "mono" }]);
  });
  it("sans style dit, celui choisi dans « Style de l’album » est repris", () => {
    expect(parsePrompt("Trie et retouche cet album", "photo", "current", "golden").actions).toEqual([
      { kind: "album.process", style: "golden" },
    ]);
  });
});

describe("journal des commandes photo", () => {
  /** L'écriture exacte de jobs.ts pour une photo de la passe d'album. */
  async function passe(projectId: string, commandId: string, jobId: string, p: Photo) {
    const vise = { exposure: 0.4, shadows: 12 };
    const latest = (await getPhoto(p.id))!;
    await photoTransaction(
      { id: commandId, projectId, ids: [p.id], label: "Album · première retouche Juno", source: "recipe", append: true, jobId, expected: { [p.id]: latest.revision || 0 } },
      (l) => ({ ...editPhoto(l, { ...vise, style: "signature", intensity: 100 }, commandId), proposal: { ...vise }, proposalLearned: false }),
    );
  }
  const tick = () => new Promise((r) => setTimeout(r, 4));
  it("annuler la passe retire aussi sa proposition : rien de faux à apprendre", async () => {
    const projectId = crypto.randomUUID(),
      p = photo({}, projectId);
    await putPhoto(p);
    await passe(projectId, "cmd-" + projectId, "job-" + projectId, p);
    await (await database).put("jobs", { id: "job-" + projectId, state: "done" });
    expect((await restoreCommand("cmd-" + projectId)).count).toBe(1);
    const apres = (await getPhoto(p.id))!;
    expect(apres.adjustments.exposure).toBe(0);
    expect(apres.proposal).toBeUndefined();
    expect(correctionOf(apres)).toBeUndefined();
    // Rétablie, la passe remet sa proposition.
    await restoreCommand("cmd-" + projectId, true);
    expect((await getPhoto(p.id))!.proposal).toEqual({ exposure: 0.4, shadows: 12 });
  });
  it("une photo déjà apprise s'annule sans conflit, et l'apprentissage n'entre pas au journal", async () => {
    const projectId = crypto.randomUUID(),
      p = photo({}, projectId);
    await putPhoto(p);
    await passe(projectId, "cmd-" + projectId, "job-" + projectId, p);
    await (await database).put("jobs", { id: "job-" + projectId, state: "done" });
    // Ce que fait App.tsx en quittant la photo : Juno apprend, sans retouche.
    await modifyPhoto(p.id, (l) => ({ ...l, proposalLearned: true }));
    expect((await photoHistory(projectId)).map((r) => r.label)).toEqual(["Album · première retouche Juno"]);
    const r = await restoreCommand("cmd-" + projectId);
    expect([r.count, r.conflicts]).toEqual([1, 0]);
    expect((await getPhoto(p.id))!.proposal).toBeUndefined();
  });
  it("rétablir la passe ne fait pas réapprendre une correction déjà apprise", async () => {
    const projectId = crypto.randomUUID(),
      p = photo({}, projectId),
      cmd = "cmd-" + projectId;
    await putPhoto(p);
    await passe(projectId, cmd, "job-" + projectId, p);
    await (await database).put("jobs", { id: "job-" + projectId, state: "done" });
    // Le photographe corrige la saturation, que la passe n'a pas touchée,
    // puis quitte la photo : App.tsx apprend et marque la photo.
    await modifyPhoto(p.id, (l) => ({ ...l, adjustments: { ...l.adjustments, saturation: 20 } }));
    expect(correctionOf((await getPhoto(p.id))!)).toBeDefined();
    await modifyPhoto(p.id, (l) => ({ ...l, proposalLearned: true }));
    await restoreCommand(cmd);
    expect((await getPhoto(p.id))!.proposal).toBeUndefined();
    await restoreCommand(cmd, true);
    const apres = (await getPhoto(p.id))!;
    expect(apres.proposal).toEqual({ exposure: 0.4, shadows: 12 });
    expect(apres.adjustments.exposure).toBe(0.4);
    expect(apres.proposalLearned).toBe(true);
    expect(correctionOf(apres)).toBeUndefined();
    // Un deuxième aller-retour garde la même mémoire.
    await restoreCommand(cmd);
    await restoreCommand(cmd, true);
    expect(correctionOf((await getPhoto(p.id))!)).toBeUndefined();
  });
  it("une photo pas encore apprise au moment d'annuler l'est une fois, après le rétablissement", async () => {
    const projectId = crypto.randomUUID(),
      p = photo({}, projectId),
      cmd = "cmd-" + projectId;
    await putPhoto(p);
    await passe(projectId, cmd, "job-" + projectId, p);
    await (await database).put("jobs", { id: "job-" + projectId, state: "done" });
    await restoreCommand(cmd);
    await restoreCommand(cmd, true);
    expect((await getPhoto(p.id))!.proposalLearned).toBe(false);
    await modifyPhoto(p.id, (l) => ({ ...l, adjustments: { ...l.adjustments, saturation: 20 } }));
    expect(correctionOf((await getPhoto(p.id))!)).toBeDefined();
  });
  it("« annule » vise la dernière commande tapée, pas une passe qui continue d'avancer", async () => {
    const projectId = crypto.randomUUID();
    const ps = [photo({}, projectId), photo({}, projectId), photo({}, projectId)];
    for (const p of ps) await putPhoto(p);
    const cmd = "cmd-" + projectId,
      job = "job-" + projectId;
    await (await database).put("jobs", { id: job, state: "running" });
    await passe(projectId, cmd, job, ps[0]);
    await tick();
    await photoTransaction(
      { id: "garde-" + projectId, projectId, ids: [ps[2].id], label: "Garde", source: "text" },
      (p) => ({ ...p, status: "keep" }),
    );
    await tick();
    await passe(projectId, cmd, job, ps[1]);
    await tick();
    await passe(projectId, cmd, job, ps[2]);
    await (await database).put("jobs", { id: job, state: "done" });
    // La règle de runPilot : la première entrée non annulée du journal.
    const vise = (await photoHistory(projectId)).find((r) => r.state !== "undone")!;
    expect(vise.label).toBe("Garde");
    await restoreCommand(vise.id);
    expect((await getPhoto(ps[2].id))!.status).toBe("pending");
    expect((await getPhoto(ps[2].id))!.adjustments.exposure).toBe(0.4);
  });
});

describe("pistes verrouillées", () => {
  it("aucune retouche du pilote ne passe, et le refus le dit", () => {
    for (const t of [
      "débruite fort",
      "stabilise à 80",
      "mets un cercle de 1 seconde",
      "floute la zone",
      "supprime ce plan",
      "coupe ici",
      "retire les blancs",
    ])
      expect(() => applyVideoActions(verrouillee(), va(t), ["c1"], 100, [media()]), t).toThrow(/Déverrouillez/);
  });
  it("le son lié verrouillé bloque aussi la suppression du plan image", () => {
    const s = seq(
      [clip({ id: "v1", linkId: "l" } as never), clip({ id: "a1", linkId: "l", track: 10, component: "audio" } as never)],
      { tracks: { 10: { locked: true } } } as never,
    );
    expect(() => applyVideoActions(s, va("supprime ce plan"), ["v1"], 0, [media()])).toThrow(/Déverrouillez/);
  });
});

it("la musique baisse en dB comme dans le panneau Son", () => {
  const six = va("baisse la musique de 6 dB")[0] as { depth: number };
  expect(-20 * Math.log10(1 - six.depth)).toBeCloseTo(6, 1);
  expect(va("baisse la musique de 50 %")[0]).toMatchObject({ depth: 0.5 });
  expect(va("baisse la musique sous la voix")[0]).toEqual({ kind: "video.ducking", on: true, depth: undefined });
  expect(() => va("baisse la musique de 40 dB")).toThrow(Refus);
  expect(() => va("baisse la musique de 20")).toThrow(Refus);
});

it("vocabulaire vidéo : ni l'horizon ni le son ne partent vers une retouche d'image", () => {
  for (const t of ["redresse l'horizon", "nettoie le son", "enlève le bruit de fond", "débruite la voix"])
    expect(() => va(t), t).toThrow(Refus);
  expect(va("débruite ce plan")[0]).toEqual({ kind: "video.denoise", level: "medium" });
  expect(va("nettoie l'image")[0]).toEqual({ kind: "video.denoise", level: "medium" });
});

describe("ce que le pilote promet est compris", () => {
  it("chaque bouton d'exemple", () => {
    for (const domaine of ["photo", "video"] as const)
      for (const exemple of EXEMPLES[domaine])
        expect(() => parsePrompt(exemple, domaine), exemple).not.toThrow();
    expect(parsePrompt("Crée les sous-titres", "video").actions).toEqual([{ kind: "video.caption" }]);
  });
  it("chaque commande du catalogue de l'IA locale", () => {
    const { CATALOGUE } = require("../electron/local-planner.cjs") as {
      CATALOGUE: Record<"COMMON" | "PHOTO" | "VIDEO", string>;
    };
    // Les commandes sont entre guillemets, sur les lignes « - » ; ce qui
    // précède « => » est une demande d'utilisateur, pas une commande.
    const commandes = (texte: string, lignes: RegExp) =>
      texte
        .split("\n")
        .filter((l) => lignes.test(l))
        .flatMap((l) =>
          [...l.matchAll(/"((?:[^"\\]|\\.)*)"(\s*=>)?/g)]
            .filter((m) => !m[2])
            .map((m) => m[1].replace(/\\"/g, '"')),
        );
    const refusees: string[] = [];
    for (const [domaine, texte, lignes] of [
      ["photo", CATALOGUE.COMMON, /^Commandes communes/],
      ["video", CATALOGUE.COMMON, /^Commandes communes/],
      ["photo", CATALOGUE.PHOTO, /^- /],
      ["video", CATALOGUE.VIDEO, /^- /],
    ] as const)
      for (const c of commandes(texte, lignes)) {
        try {
          parsePrompt(c.replace("NOM", "mariee"), domaine);
        } catch (e) {
          refusees.push(`${domaine} · ${c} · ${(e as Error).message}`);
        }
      }
    expect(refusees).toEqual([]);
    expect(commandes(CATALOGUE.VIDEO, /^- /).length).toBeGreaterThan(40);
  });
});

describe("les nombres parasites ne deviennent plus des valeurs", () => {
  it("« un peu », « légèrement », « fort »", () => {
    expect(va("stabilise un peu")[0]).toEqual({ kind: "video.stabilise", strength: 0.3 });
    expect(va("stabilise fort")[0]).toEqual({ kind: "video.stabilise", strength: 0.9 });
    expect(va("stabilise ce plan à 80")[0]).toEqual({ kind: "video.stabilise", strength: 0.8 });
    expect(va("débruite un peu")[0]).toEqual({ kind: "video.denoise", level: "light" });
    expect(va("débruite légèrement")[0]).toEqual({ kind: "video.denoise", level: "light" });
    expect(va("débruite tous les plans")[0]).toEqual({ kind: "video.denoise", level: "medium" });
    expect(va("débruite fort ce plan")[0]).toEqual({ kind: "video.denoise", level: "strong" });
    expect(va("stabilise légèrement ce plan")[0]).toEqual({ kind: "video.stabilise", strength: 0.3 });
  });
  it("« les deux plans » n'est pas une force de 2 %", () => {
    let erreur: unknown;
    try {
      va("stabilise les deux plans");
    } catch (e) {
      erreur = e;
    }
    // Refusée en consigne ordinaire : l'IA locale peut encore la reformuler.
    expect(erreur).toBeInstanceOf(Error);
    expect(erreur).not.toBeInstanceOf(Refus);
  });
  it("« pour cent » est compris", () => {
    expect(parsePrompt("contraste à 20 pour cent", "photo").actions[0]).toEqual({ kind: "photo.adjust", field: "contrast", value: 20, relative: false });
    expect(va("opacité à 80 pour cent")[0]).toMatchObject({ field: "opacity", value: 80 });
  });
});

it("la recherche garde les accents et laisse la portée de côté", () => {
  expect(parsePrompt("cherche Cérémonie", "photo").actions[0]).toEqual({ kind: "media.search", query: "Cérémonie" });
  expect(parsePrompt("Juno, cherche « Mariée » sur tout le projet.", "photo").actions[0]).toEqual({ kind: "media.search", query: "Mariée" });
  expect(parsePrompt("cherche l'Église sur l'album", "photo").actions[0]).toEqual({ kind: "media.search", query: "l'Église" });
  // En vidéo, les noms de médias se cherchent aussi en plusieurs mots.
  expect(parsePrompt("cherche robe et voile", "video").actions[0]).toEqual({ kind: "media.search", query: "robe et voile" });
  // En photo, une phrase se cherche par le sens, dans le champ de recherche.
  expect(() => parsePrompt("cherche robe blanche", "photo")).toThrow(Refus);
});

it("le sens et la variante d'une transition sont respectés", () => {
  expect(va("mets un volet vers la droite")[0]).toEqual({ kind: "video.transition", transition: "wiperight", seconds: 1 });
  expect(va("mets un volet de 2 secondes vers le haut")[0]).toEqual({ kind: "video.transition", transition: "wipeup", seconds: 2 });
  expect(va("mets un glissement vers la droite")[0]).toMatchObject({ transition: "slideright" });
  expect(va("mets un cercle qui se ferme")[0]).toMatchObject({ transition: "circleclose" });
  expect(va("mets un cercle")[0]).toMatchObject({ transition: "circleopen" });
  expect(va("mets un rideau vertical")[0]).toMatchObject({ transition: "vertopen" });
  expect(() => va("mets un iris vers la droite")).toThrow(Refus);
  // Une précision inconnue n'est plus ignorée en silence.
  expect(() => va("mets une transition douce")).toThrow(/non reconnue/);
});

it("« tous les plans » ne bute plus sur le son lié", () => {
  const s = seq([
    clip({ id: "v1", linkId: "l1", component: "video" } as never),
    clip({ id: "a1", linkId: "l1", component: "audio", track: 10 } as never),
    clip({ id: "v2", start: 500, speed: 0.5 } as never),
  ]);
  const plan = parsePrompt("débruite tous les plans", "video");
  expect(plan.scope).toBe("album");
  const out = applyVideoActions(s, plan.actions as never, ["v1", "a1", "v2"], 0, [media()]);
  expect(out.clips.map((c) => c.denoise)).toEqual(["medium", undefined, "medium"]);
  const fondu = applyVideoActions(s, va("mets un fondu enchaîné sur tous les plans"), ["v1", "a1", "v2"], 0, [media()]);
  expect(fondu.clips.map((c) => c.transition?.kind)).toEqual(["dissolve", undefined, "dissolve"]);
  // Le ralenti fluide va aux seuls plans ralentis.
  const lisse = applyVideoActions(s, va("ralenti fluide"), ["v1", "a1", "v2"], 0, [media()]);
  expect(lisse.clips.map((c) => !!c.smoothSlow)).toEqual([false, false, true]);
});

it("un fondu seul est un fondu d'entrée", () => {
  const s = seq([clip()]);
  const bouts = (t: string) => {
    const c = applyVideoActions(s, va(t), ["c1"], 0, [media()]).clips[0];
    return [c.fadeIn, c.fadeOut];
  };
  expect(bouts("ajoute un fondu de 1 seconde")).toEqual([25, 0]);
  expect(bouts("ajoute un fondu de sortie de 1 seconde")).toEqual([0, 25]);
  expect(bouts("ajoute un fondu de 1 seconde en sortie")).toEqual([0, 25]);
  expect(bouts("ajoute des fondus de 1 seconde")).toEqual([25, 25]);
  expect(bouts("ajoute un fondu d'entrée et de sortie de 1 seconde")).toEqual([25, 25]);
  expect(bouts("mets un fondu")).toEqual([13, 0]);
});

it("noms de version et titres : le texte entre guillemets, et lui seul", () => {
  expect(parsePrompt('Juno crée une version "Chaude"', "photo").actions[0]).toEqual({ kind: "photo.version", name: "Chaude" });
  const ici = parsePrompt('crée une version "Chaude" sur cette photo', "photo", "album");
  expect(ici.actions[0]).toEqual({ kind: "photo.version", name: "Chaude" });
  expect(ici.scope).toBe("current");
  expect(parsePrompt("crée une version « Chaude »", "photo").actions[0]).toEqual({ kind: "photo.version", name: "Chaude" });
  expect(va("ajoute un titre “Bienvenue”")[0]).toEqual({ kind: "video.title", text: "Bienvenue", seconds: 3 });
});

describe("moteur de langue orphelin", () => {
  const { LocalPlanner, MODELE } = require("../electron/local-planner.cjs");
  const vivant = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const attendre = async (condition: () => boolean, ms = 4000) => {
    for (const fin = Date.now() + ms; Date.now() < fin; )
      if (condition()) return true;
      else await new Promise((r) => setTimeout(r, 50));
    return condition();
  };
  /** Un faux llama-server : la même interface HTTP, sans modèle. */
  async function installation() {
    const racine = await fs.mkdtemp(path.join(os.tmpdir(), "juno-garde-"));
    const nativeRoot = path.join(racine, "natif"),
      userData = path.join(racine, "userData");
    await fs.mkdir(path.join(nativeRoot, "llama"), { recursive: true });
    await fs.mkdir(path.join(userData, "models"), { recursive: true });
    await fs.writeFile(path.join(userData, "models", MODELE.nom), "faux");
    const moteur = path.join(nativeRoot, "llama", "llama-server");
    await fs.writeFile(
      moteur,
      `#!${process.execPath}
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
require("node:http").createServer((q, r) => { r.writeHead(200); r.end("{}"); }).listen(port, "127.0.0.1");
`,
    );
    await fs.chmod(moteur, 0o755);
    return { racine, nativeRoot, userData };
  }
  it.skipIf(process.platform === "win32")(
    "l'application tuée sans prévenir, le moteur s'arrête aussi",
    async () => {
      const { racine, nativeRoot, userData } = await installation();
      const script = path.join(racine, "app.cjs");
      await fs.writeFile(
        script,
        `const { LocalPlanner } = require(${JSON.stringify(require.resolve("../electron/local-planner.cjs"))});
const p = new LocalPlanner(${JSON.stringify(nativeRoot)}, ${JSON.stringify(userData)});
p.start().then(() => console.log(JSON.stringify({ moteur: p.child.pid })));
setInterval(() => {}, 1000);
`,
      );
      let app: ChildProcess | undefined, moteur = 0;
      try {
        app = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
        moteur = await new Promise<number>((ok, ko) => {
          app!.stdout!.once("data", (d) => ok(JSON.parse(String(d)).moteur));
          app!.once("exit", () => ko(Error("application arrêtée trop tôt")));
        });
        expect(vivant(moteur)).toBe(true);
        app.kill("SIGKILL");
        expect(await attendre(() => !vivant(moteur))).toBe(true);
      } finally {
        app?.kill("SIGKILL");
        if (moteur && vivant(moteur)) process.kill(moteur, "SIGKILL");
        await fs.rm(racine, { recursive: true, force: true });
      }
    },
    20000,
  );
  it.skipIf(process.platform === "win32")(
    "la garde ne survit ni à l'arrêt normal, ni à un moteur arrêté de lui-même",
    async () => {
      const { racine, nativeRoot, userData } = await installation();
      const p = new LocalPlanner(nativeRoot, userData);
      try {
        await p.start();
        let garde = p.garde.pid, moteur = p.child.pid;
        p.stop();
        expect(await attendre(() => !vivant(garde) && !vivant(moteur))).toBe(true);
        await p.start();
        garde = p.garde.pid;
        moteur = p.child.pid;
        process.kill(moteur, "SIGKILL");
        expect(await attendre(() => !vivant(garde))).toBe(true);
      } finally {
        p.stop();
        await fs.rm(racine, { recursive: true, force: true });
      }
    },
    20000,
  );
});

describe("relecture des corrections du pilote (29/09/2026)", () => {
  it("un seuil de blancs sans unité compte en secondes, au lieu d'être remplacé en silence", () => {
    // Un rush de 20 s : un blanc d'environ 1 s (5 à 6,3 s) et un blanc de 3 s (10 à 13 s).
    const rush = media({ duration: 20, analysis: { scenes: [], silences: [{ start: 5, end: 6.3 }, { start: 10, end: 13 }] } } as never);
    const plans = (t: string) => applyVideoActions(seq([clip()]), va(t), ["c1"], 0, [rush]).clips.length;
    expect(va("retire les blancs de plus de 2")[0]).toEqual({ kind: "video.silence", minSilence: 2 });
    // Seul le blanc de 3 s part ; celui d'une seconde reste.
    expect(plans("retire les blancs de plus de 2")).toBe(2);
    expect(plans("retire les blancs de plus de 2 secondes")).toBe(2);
    expect(va("retire les blancs de 2")[0]).toMatchObject({ minSilence: 2 });
    expect(va("coupe les silences de plus de 1,5")[0]).toMatchObject({ minSilence: 1.5 });
    expect(va("enlève les silences de plus de 0,5")[0]).toMatchObject({ minSilence: 0.5 });
    expect(va("retire les blancs d'au moins 0.8")[0]).toMatchObject({ minSilence: 0.8 });
    expect(va("retire les blancs d'au moins deux secondes")[0]).toMatchObject({ minSilence: 2 });
    expect(va("retire les blancs de plus de 2 secs")[0]).toMatchObject({ minSilence: 2 });
    expect(va("retire les blancs de plus de 2 dans ce plan")[0]).toMatchObject({ minSilence: 2 });
    // Hors de ce que Juno sait faire, ou un nombre qui n'est pas une durée : refusé, avec la raison.
    expect(() => va("retire les blancs de plus de 10")).toThrow(/de 0,2 à 4 secondes/);
    expect(() => va("retire les blancs de 2 plans")).toThrow(Refus);
    expect(() => va("retire les blancs de 2 plans")).toThrow(/en secondes/);
    // « des deux plans » n'est toujours pas un seuil, et sans nombre le seuil reste 0,6 s.
    expect(va("retire les blancs des deux plans")[0]).toEqual({ kind: "video.silence", minSilence: 0.6 });
    expect(va("retire les blancs")[0]).toEqual({ kind: "video.silence", minSilence: 0.6 });
  });

  it("écarter, noter ou remettre à l'original plusieurs photos se confirme, quelle que soit la portée", () => {
    const ids = portees({ selection: 3, album: 400, kept: 250 });
    for (const t of ["écarte", "5 étoiles", "reviens à l'original"]) {
      expect(confirmationRequise(parsePrompt(t, "photo", "kept"), ids), t).toMatch(/vise les photos gardées : .*250 photos/);
      expect(confirmationRequise(parsePrompt(t, "photo", "selection"), ids), t).toMatch(/vise la sélection : .*3 photos/);
      expect(confirmationRequise(parsePrompt(t, "photo", "album"), ids), t).toMatch(/vise tout le projet : .*400 photos/);
      expect(confirmationRequise(parsePrompt(t, "photo", "current"), ids), t).toBeUndefined();
    }
    // « sur les photos gardées » dit dans la phrase : même confirmation.
    expect(confirmationRequise(parsePrompt("écarte sur les photos gardées", "photo"), ids)).toMatch(/écarter 250 photos/);
    // Garder des photos déjà gardées ne change rien ; une sélection d'une photo non plus.
    expect(confirmationRequise(parsePrompt("garde", "photo", "kept"), ids)).toBeUndefined();
    expect(confirmationRequise(parsePrompt("écarte", "photo", "selection"), portees({ selection: 1, album: 400 }))).toBeUndefined();
    // Un réglage réversible sur les photos gardées passe sans confirmation.
    expect(confirmationRequise(parsePrompt("Exposition à 1", "photo", "kept"), ids)).toBeUndefined();
  });

  it("la cible nommée dans la phrase reste celle de la proposition de l'IA locale", () => {
    const ids = portees({ selection: 3, album: 312, kept: 40 });
    // Panneau sur « Tout le projet » ; l'IA locale reformule « écarte la photo active » en « Écarte ».
    const plan = relireProposition("écarte la photo active", ["Écarte"], "photo", "album");
    expect(plan.scope).toBe("current");
    expect(confirmationRequise(plan, ids)).toBeUndefined();
    expect(relireProposition("écarte cette photo, elle est floue", ["Écarte"], "photo", "kept").scope).toBe("current");
    expect(relireProposition("rends plus lumineuse la photo active", ["Augmente l'exposition de 0.3"], "photo", "selection").scope).toBe("current");
    expect(relireProposition("supprime ce plan qui tremble", ["Supprime ce plan"], "video", "album").scope).toBe("current");
    // Une cible d'ensemble nommée compte aussi.
    expect(relireProposition("rends plus lumineuses les photos gardées", ["Augmente l'exposition de 0.3"], "photo", "current").scope).toBe("kept");
    // Sans cible dans la phrase, la portée du panneau reste celle qui compte.
    expect(relireProposition("rends-la plus lumineuse", ["Augmente l'exposition de 0.3"], "photo", "album").scope).toBe("album");
    // L'IA qui élargit d'elle-même la cible nommée est refusée.
    expect(() => relireProposition("écarte la photo active", ["Écarte sur tout le projet"], "photo", "album")).toThrow(/cible nommée/);
    // Le contrôle du sens de la demande reste fait.
    expect(() => relireProposition("rends plus lumineuse la photo active", ["Baisse l'exposition de 0.3"], "photo", "album")).toThrow(/sens de votre demande/);
    // « la photo active » est aussi comprise sans l'IA.
    expect(parsePrompt("écarte la photo active", "photo", "album")).toMatchObject({ scope: "current", actions: [{ kind: "photo.status", status: "reject" }] });
    expect(parsePrompt("exposition à 0,3 sur la photo active", "photo", "album").scope).toBe("current");
  });

  it("les commandes de l'IA locale sont relues une par une ; « ; » coupe la phrase, pas « puis »", () => {
    // La réponse de l'IA locale : « Contraste à 10 » reste une valeur visée, sans le « Augmente » d'avant.
    const reponse = ["Augmente l'exposition de 0.3", "Contraste à 10"];
    const p = relireProposition("rends-la plus lumineuse et moins contrastée", reponse, "photo", "current");
    expect(p.actions[1]).toEqual({ kind: "photo.adjust", field: "contrast", value: 10, relative: false });
    const photoRetouchee = (p.actions as PhotoAction[]).reduce((x, a) => applyPhotoAction(x, a, "g"), photo({ contrast: 30 }));
    expect(photoRetouchee.adjustments.contrast).toBe(10);
    // Seul « ; » ouvre une autre consigne, sans verbe hérité (« puis » : voir la relecture suivante).
    expect(parsePrompt("baisse les ombres de 20 ; contraste à 10", "photo").actions[1]).toEqual({ kind: "photo.adjust", field: "contrast", value: 10, relative: false });
    // Dans la même phrase, « et » garde le verbe, y compris après un « puis ».
    expect(parsePrompt("augmente l'exposition de 0.3 puis baisse les ombres de 20 et hautes lumières de 10", "photo").actions).toEqual([
      { kind: "photo.adjust", field: "exposure", value: 0.3, relative: true },
      { kind: "photo.adjust", field: "shadows", value: -20, relative: true },
      { kind: "photo.adjust", field: "highlights", value: -10, relative: true },
    ]);
    // « puis » avant « et » : le verbe d'avant le « puis » ne revient pas.
    expect(() => parsePrompt("baisse les ombres de 20 puis écarte et hautes lumières de 10", "photo")).not.toThrow();
    expect(parsePrompt("baisse les ombres de 20 puis écarte et hautes lumières de 10", "photo").actions[2]).toEqual({ kind: "photo.adjust", field: "highlights", value: 10, relative: false });
  });

  it("en vidéo, le curseur ne compte que pour les commandes qui s'y posent", () => {
    const ctx = (frame: number, clips: Clip[] = [clip()]) => ({
      domain: "video" as const,
      projectId: "p",
      ids: { current: ["c1"], selection: ["c1"], album: ["c1"], kept: [] },
      sequence: seq(clips),
      frame,
    });
    // Pendant la lecture, le curseur avance tout seul (3 s à 25 i/s) : un volume reste applicable.
    const volume = va("Volume à -6 dB");
    expect(cibleInchangee(ctx(100), ctx(175), "current", volume)).toBe(true);
    for (const t of ["débruite ce plan", "supprime ce plan", "mets un fondu", "stabilise à 80", "mets un volet"])
      expect(cibleInchangee(ctx(100), ctx(175), "current", va(t)), t).toBe(true);
    // Coupe, titre, images clés, masque et relief se posent au curseur : il compte.
    for (const t of ["coupe ici", "ajoute un titre « Bienvenue »", "anime le volume de -12 dB à 0 dB sur 2 secondes", "floute la zone", "mets du relief de 30"])
      expect(cibleInchangee(ctx(100), ctx(175), "current", va(t)), t).toBe(false);
    // Un volume animé se règle en image clé au curseur : il compte aussi.
    const anime = [clip({ animation: { gain: [{ frame: 0, value: 1, easing: "linear" }] } } as never)];
    expect(cibleInchangee(ctx(100, anime), ctx(175, anime), "current", volume)).toBe(false);
    expect(cibleInchangee(ctx(100, anime), ctx(100, anime), "current", volume)).toBe(true);
    // Sans les actions, par prudence, le curseur compte.
    expect(cibleInchangee(ctx(100), ctx(175), "current")).toBe(false);
    // La séquence et le plan visé comptent toujours.
    expect(cibleInchangee(ctx(100), { ...ctx(100), sequence: { ...seq([clip()]), id: "t" } }, "current", volume)).toBe(false);
    expect(cibleInchangee(ctx(100), { ...ctx(100), ids: { ...ctx(100).ids, current: ["c2"] } }, "current", volume)).toBe(false);
  });
});

describe("troisième relecture du pilote (29/09/2026)", () => {
  // Un rush de 20 s : un blanc d'environ 1 s (5 à 6,3 s) et un blanc de 3 s (10 à 13 s).
  const rush = media({ duration: 20, analysis: { scenes: [], silences: [{ start: 5, end: 6.3 }, { start: 10, end: 13 }] } } as never);
  const blancs = (t: string) => {
    const actions = va(t) as { minSilence: number }[];
    return { minSilence: actions[0].minSilence, plans: applyVideoActions(seq([clip()]), actions as never, ["c1"], 0, [rush]).clips.length };
  };

  it("dans une consigne de blancs, tout nombre qui ne compte pas des plans est la durée minimale", () => {
    for (const t of [
      "retire les blancs dépassant 2",
      "retire les blancs qui dépassent 2",
      "retire les blancs dès 2",
      "retire les blancs à 2",
      "retire les blancs minimum 2",
      "retire les blancs de 2 minimum",
      "retire les blancs (2)",
      "retire les blancs de plus de 2 dans les deux plans",
      "retire les blancs des deux plans de plus de 2 secondes",
    ])
      // Seul le blanc de 3 s part : celui d'une seconde reste, au lieu d'un seuil de 0,6 s posé en silence.
      expect(blancs(t), t).toEqual({ minSilence: 2, plans: 2 });
    expect(blancs("coupe les silences excédant 1,5")).toEqual({ minSilence: 1.5, plans: 2 });
    expect(va("retire les blancs dépassant 1500 ms")[0]).toEqual({ kind: "video.silence", minSilence: 1.5 });
    // Un nombre qui compte ou numérote des plans n'est pas une durée.
    for (const t of ["retire les blancs des deux plans", "retire les blancs sur les 2 derniers plans", "retire les blancs du plan 2"])
      expect(va(t)[0], t).toEqual({ kind: "video.silence", minSilence: 0.6 });
    // « de 2 plans » pourrait être un seuil mal tapé, et « 2 heures » ou « 25 images » ne sont pas des secondes.
    for (const t of ["retire les blancs de 2 plans", "retire les blancs de 2 heures", "retire les blancs de 25 images", "retire les blancs de plus de 2 secondes 3"])
      expect(() => va(t), t).toThrow(/durée minimale des blancs en secondes/);
  });

  it("une fourchette est refusée, avec ou sans unité, au lieu de valoir sa borne haute", () => {
    for (const t of [
      "retire les blancs de 2 à 3",
      "retire les blancs de 2 à 3 secondes",
      "retire les blancs de 0,5 à 1 seconde",
      "retire les blancs entre 1 et 2",
      "retire les blancs entre 1 et 2 secondes",
      "retire les blancs entre une et deux secondes",
      "retire les blancs de 2-3 s",
      "retire les blancs de 2 ou 3 secondes",
    ]) {
      expect(() => va(t), t).toThrow(Refus);
      expect(() => va(t), t).toThrow(/fourchette/);
    }
  });

  it("« de moins de 2 » est refusé : Juno ne retire que les blancs longs", () => {
    for (const t of [
      "retire les blancs de moins de 2",
      "retire les blancs de moins de 2 secondes",
      "retire les blancs de moins d'une seconde",
      "coupe les silences inférieurs à 2 s",
      "retire les blancs au plus 2",
      "retire les blancs plus courts que 1 seconde",
    ]) {
      expect(() => va(t), t).toThrow(Refus);
      expect(() => va(t), t).toThrow(/blancs longs/);
    }
    // « au moins » reste un seuil minimal.
    expect(blancs("retire les blancs d'au moins 2")).toEqual({ minSilence: 2, plans: 2 });
  });

  it("dans la phrase du photographe, « puis » reprend le verbe comme « et »", () => {
    // Le guide présente « puis » pour enchaîner : les hautes lumières baissent, elles ne remontent pas à +10.
    expect(appliquer("baisse les ombres de 20 puis hautes lumières de 10", photo({ highlights: -30 })).adjustments.highlights).toBe(-40);
    expect(appliquer("baisse les ombres de 20 ensuite hautes lumières de 10", photo({ highlights: -30 })).adjustments.highlights).toBe(-40);
    const opacite = applyVideoActions(seq([clip()]), va("baisse le volume de 3 dB puis opacité de 10"), ["c1"], 0, [rush]);
    expect(opacite.clips[0].opacity).toBeCloseTo(0.9);
    // Un verbe propre après « puis » garde son sens.
    expect(parsePrompt("baisse les ombres de 20 puis augmente le contraste de 5", "photo").actions[1]).toEqual({ kind: "photo.adjust", field: "contrast", value: 5, relative: true });
  });

  it("chaque commande de l'IA locale garde son propre sens", () => {
    const reponse = ["Baisse les ombres de 20", "Contraste à 10"];
    // Jointes par « puis », « Contraste à 10 » hériterait du « Baisse » : refusée sur un contraste de 5.
    expect(() => appliquer(reponse.join(" puis "), photo({ contrast: 5 }))).toThrow(/la ferait monter/);
    // Relues une par une, la commande absolue reste absolue, telle que la proposition l'affiche.
    const plan = relireProposition("baisse un peu les ombres et règle le contraste", reponse, "photo", "current");
    expect(plan.actions).toEqual([
      { kind: "photo.adjust", field: "shadows", value: -20, relative: true },
      { kind: "photo.adjust", field: "contrast", value: 10, relative: false },
    ]);
    const r = (plan.actions as PhotoAction[]).reduce((x, a) => applyPhotoAction(x, a, "g"), photo({ contrast: 5 }));
    expect(r.adjustments.contrast).toBe(10);
    expect(plan.text).toBe("baisse un peu les ombres et règle le contraste");
    // La portée nommée par une commande vaut pour elle seule : deux cibles, refusées ensemble.
    expect(() => relireProposition("écarte-les et note-les", ["Écarte sur tout le projet", "Mets 3 étoiles"], "photo", "current")).toThrow(/plusieurs cibles/);
    expect(relireProposition("écarte-les et note-les", ["Écarte sur tout le projet", "Mets 3 étoiles sur tout le projet"], "photo", "current").scope).toBe("album");
    // Une tâche longue reste seule, même proposée en deux commandes.
    expect(() => relireProposition("nettoie le montage", ["Retire les blancs", "Volume à -6 dB"], "video", "current")).toThrow(/Lancez séparément/);
  });

  it("une cible nommée avec une négation n'est jamais lue comme la cible contraire", () => {
    const negatives = [
      "écarte les photos non gardées",
      "écarte les photos qui ne sont pas gardées",
      "écarte toutes les photos pas encore gardées",
      "écarte toutes les photos sauf cette photo",
      "garde les photos hors sélection",
      "écarte les photos autres que la sélection",
      "mets 1 étoile aux photos excepté les gardées",
    ];
    for (const t of negatives) {
      expect(() => cibleDite(t), t).toThrow(Refus);
      // Refusée sans passer par l'IA locale…
      expect(() => parsePrompt(t, "photo", "kept"), t).toThrow(Refus);
      // …et, si elle y passe, sa proposition n'est pas appliquée à une cible devinée.
      expect(() => relireProposition(t, ["Écarte"], "photo", "kept"), t).toThrow(/négation/);
    }
    // Sans cible nommée, la négation ne laisse pas l'IA en choisir une à sa place.
    expect(() => relireProposition("écarte celles que je n'ai pas retenues", ["Écarte sur les photos gardées"], "photo", "current")).toThrow(/négation/);
    expect(relireProposition("écarte celles que je n'ai pas retenues", ["Écarte"], "photo", "selection").scope).toBe("selection");
    // Sans négation, la cible nommée compte toujours.
    expect(cibleDite("écarte les photos gardées")).toBe("kept");
    expect(cibleDite("écarte cette photo, elle est floue")).toBe("current");
    expect(relireProposition("écarte les photos gardées", ["Écarte"], "photo", "current").scope).toBe("kept");
    // Ce qui est entre guillemets n'est ni une cible ni une négation.
    expect(parsePrompt("crée une version « Pas gardée » sur cette photo", "photo", "album").scope).toBe("current");
  });
});

describe("quatrième relecture du pilote (29/09/2026)", () => {
  const rush = media({ duration: 20, analysis: { scenes: [], silences: [{ start: 5, end: 5.8 }, { start: 8, end: 9.3 }, { start: 10, end: 13 }] } } as never);
  const seuil = (t: string) => (va(t)[0] as { minSilence: number }).minSilence;
  it("un article n'est pas un seuil : « pour un rythme plus serré » garde le seuil par défaut", () => {
    for (const t of [
      "retire les blancs pour un rythme plus serré",
      "retire les blancs pour un montage plus dynamique",
      "retire les blancs dans une interview",
    ])
      expect(seuil(t), t).toBe(0.6);
    expect(seuil("retire les blancs de plus de 2 dans l'interview")).toBe(2);
    expect(seuil("retire les blancs d'une durée supérieure à 2 secondes")).toBe(2);
    expect(seuil("retire les blancs avec un seuil de 2 secondes")).toBe(2);
    expect(rush).toBeDefined();
  });
  it("les fractions dites en mots comptent", () => {
    expect(seuil("retire les blancs de plus d'une demi-seconde")).toBe(0.5);
    expect(seuil("retire les blancs de plus d'un quart de seconde")).toBe(0.25);
    expect(seuil("retire les blancs de plus de trois dixièmes de seconde")).toBe(0.3);
  });
  it("« maximum », « jusqu'à » et « ou moins » visent les blancs courts : refus", () => {
    for (const t of [
      "retire les blancs de 2 secondes maximum",
      "retire les blancs de 1 seconde max",
      "retire les blancs de 1 seconde au plus",
      "retire les blancs jusqu'à 1 seconde",
      "retire les blancs d'une seconde ou moins",
    ])
      expect(() => va(t), t).toThrow(/blancs longs/);
    expect(seuil("retire les blancs de 2 secondes minimum")).toBe(2);
  });
  it("« en dehors de », « à l'exclusion de » et « moins les » sont des exceptions", () => {
    for (const t of [
      "écarte les photos en dehors de la sélection",
      "écarte tout l'album moins les gardées",
      "écarte tout l'album à l'exclusion des gardées",
    ])
      expect(() => cibleDite(t), t).toThrow(Refus);
    expect(cibleDite("garde au moins les photos gardées")).toBe("kept");
  });
});
