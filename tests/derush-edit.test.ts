import { it, expect } from "vitest";
import {
  passages,
  resume,
  utiles,
  ajouterUtiles,
  coupesInutilisables,
  retirerInutilisables,
  preMontage,
  ordreDeTournage,
} from "../src/video/derush";
import { addClip, length } from "../src/video/edit";
import type { Asset, Derush, Sequence } from "../src/video/types";

const FPS = { n: 25, d: 1 };
const derush = (plages: Derush["plages"], decisions: Derush["decisions"] = []): Derush => ({
  mesure: "mesure-v1",
  regles: "regles-v1",
  marque: "1|1",
  plages,
  resume: { duree: 30, bon: 0, verifier: 0, masque: 0 },
  decisions,
  date: 0,
});
const rush = (id: string, d?: Derush, over: Partial<Asset> = {}): Asset =>
  ({
    id,
    name: id + ".mp4",
    kind: "video",
    status: "ready",
    duration: 30,
    audioChannels: 2,
    fps: FPS,
    derush: d,
    ...over,
  }) as unknown as Asset;
const seq = (): Sequence =>
  ({
    id: "s",
    name: "Montage",
    version: 3,
    fps: FPS,
    width: 1920,
    height: 1080,
    clips: [],
    titles: [],
    captions: [],
    markers: [],
    masterGain: 1,
    created: 0,
  }) as unknown as Sequence;
// Un rush de 30 s : noir 0-2, bon 2-10, bougé 10-12, à vérifier 12-15, bon 15-30.
const typique = () =>
  derush([
    { debut: 0, fin: 2, etat: "masque", raisons: ["noir"] },
    { debut: 2, fin: 10, etat: "bon", raisons: [] },
    { debut: 10, fin: 12, etat: "masque", raisons: ["bouge"] },
    { debut: 12, fin: 15, etat: "verifier", raisons: ["flou-leger"] },
    { debut: 15, fin: 30, etat: "bon", raisons: [] },
  ]);

it("vos décisions passent par-dessus l'analyse, la plus récente l'emportant", () => {
  const d = typique();
  d.decisions = [
    { debut: 10.5, fin: 11.5, etat: "bon" },
    { debut: 20, fin: 22, etat: "masque" },
    { debut: 21, fin: 23, etat: "bon" },
  ];
  const p = passages(d);
  // 20-22 masqué puis 21-23 gardé : de 20 à 21 reste masqué. Un passage
  // décidé reste à part de ses voisins de même état.
  expect(p.map((x) => [x.debut, x.fin, x.etat, x.raisons.includes("choix")])).toEqual([
    [0, 2, "masque", false],
    [2, 10, "bon", false],
    [10, 10.5, "masque", false],
    [10.5, 11.5, "bon", true],
    [11.5, 12, "masque", false],
    [12, 15, "verifier", false],
    [15, 20, "bon", false],
    [20, 21, "masque", true],
    [21, 23, "bon", true],
    [23, 30, "bon", false],
  ]);
  expect(p.find((x) => x.debut === 10.5)?.raisons).toEqual(["choix"]);
  expect(p.find((x) => x.debut === 21)?.raisons).toEqual(["choix"]);
  expect(resume(d)).toEqual({ bon: 8 + 1 + 5 + 9, verifier: 3, masque: 2 + 0.5 + 0.5 + 1 });
  // Une décision hors du rush est bornée ; sans dérushage, rien.
  expect(passages(derush(typique().plages, [{ debut: -5, fin: 1, etat: "bon" }]))[0]).toMatchObject({ debut: 0, fin: 1, etat: "bon" });
  expect(passages(undefined)).toEqual([]);
});

it("les morceaux utiles gardent le « à vérifier » et laissent les miettes", () => {
  expect(utiles(rush("a", typique()))).toEqual([
    { debut: 2, fin: 10 },
    { debut: 12, fin: 30 },
  ]);
  const miette = derush([
    { debut: 0, fin: 5, etat: "bon", raisons: [] },
    { debut: 5, fin: 8, etat: "masque", raisons: ["flou"] },
    { debut: 8, fin: 8.3, etat: "verifier", raisons: ["court"] },
    { debut: 8.3, fin: 30, etat: "masque", raisons: ["noir"] },
  ]);
  expect(utiles(rush("a", miette))).toEqual([{ debut: 0, fin: 5 }]);
  // Pas encore dérushé : le rush entier.
  expect(utiles(rush("a"))).toEqual([{ debut: 0, fin: 30 }]);
});

it("ajouter un rush n'ajoute que ses morceaux utiles, image et son liés", () => {
  const r = ajouterUtiles(seq(), rush("a", typique()));
  expect(r.plans).toBe(2);
  expect(r.laisse).toBeCloseTo(4, 6);
  const images = r.sequence.clips.filter((c) => c.track < 10 && c.component !== "audio");
  expect(images.map((c) => [c.start, c.duration, c.inUs])).toEqual([
    [0, 200, 2e6],
    [200, 450, 12e6],
  ]);
  // Chaque morceau garde son son, au même endroit.
  const sons = r.sequence.clips.filter((c) => c.track >= 10 || c.component === "audio");
  expect(sons.map((c) => [c.start, c.duration, c.inUs])).toEqual(images.map((c) => [c.start, c.duration, c.inUs]));
  expect(length(r.sequence)).toBe(650);
  // Sans rien de masqué, ou sans dérushage : le rush entier, comme avant.
  const entier = ajouterUtiles(seq(), rush("b", derush([{ debut: 0, fin: 30, etat: "verifier", raisons: ["brusque"] }])));
  expect(entier.plans).toBe(1);
  expect(entier.sequence.clips.map((c) => c.duration)).toEqual(addClip(seq(), rush("b")).clips.map((c) => c.duration));
});

it("un plan ne dépasse jamais la fin de son rush", () => {
  const d = derush([
    { debut: 0, fin: 1.3, etat: "masque", raisons: ["noir"] },
    { debut: 1.3, fin: 29.99, etat: "bon", raisons: [] },
  ]);
  const r = ajouterUtiles(seq(), rush("a", d, { duration: 29.99 }));
  const c = r.sequence.clips[0];
  expect(c.inUs / 1e6 + c.duration / 25).toBeLessThanOrEqual(29.99 + 1e-9);
});

it("retirer les passages inutilisables d'un plan posé, en une fois", () => {
  const a = rush("a", typique()),
    s = addClip(seq(), a);
  const id = s.clips.find((c) => c.track < 10)!.id;
  const cuts = coupesInutilisables(s, s.clips.find((c) => c.id === id)!, a);
  // Le noir du début touche le bord du plan : il part aussi (au contraire
  // d'un blanc, qui laisse une image de chaque côté).
  expect(cuts).toEqual([
    { start: 0, duration: 50 },
    { start: 250, duration: 50 },
  ]);
  const r = retirerInutilisables(s, id, [a]);
  expect(r.cuts).toBe(2);
  expect(r.removed).toBe(100);
  expect(length(r.sequence)).toBe(750 - 100);
  const images = r.sequence.clips.filter((c) => c.track < 10);
  expect(images.map((c) => [c.start, c.duration, c.inUs])).toEqual([
    [0, 200, 2e6],
    [200, 450, 12e6],
  ]);
  // Un noir final part en entier : pas d'image noire laissée au bout.
  const fin = rush("f", derush([
    { debut: 0, fin: 28, etat: "bon", raisons: [] },
    { debut: 28, fin: 30, etat: "masque", raisons: ["noir"] },
  ]));
  const sf = addClip(seq(), fin),
    idf = sf.clips.find((c) => c.track < 10)!.id,
    rf = retirerInutilisables(sf, idf, [fin]);
  expect(rf.sequence.clips.filter((c) => c.track < 10).map((c) => c.duration)).toEqual([700]);
  // Un rush accidentel, masqué en entier : le plan part.
  const tout = rush("t", derush([{ debut: 0, fin: 30, etat: "masque", raisons: ["accidentel"] }]));
  const st = addClip(seq(), tout),
    rt = retirerInutilisables(st, st.clips.find((c) => c.track < 10)!.id, [tout]);
  expect(rt.sequence.clips.length).toBe(0);
  // Une décision « garder » sur le bougé : il reste, seul le noir part.
  const garde = rush("a", derush(typique().plages, [{ debut: 10, fin: 12, etat: "bon" }]));
  const rg = retirerInutilisables(s, id, [garde]);
  expect(rg.cuts).toBe(1);
  expect(rg.removed).toBe(50);
});

it("le pré-montage met les morceaux utiles de chaque rush dans l'ordre de la journée", () => {
  const base = seq();
  base.clips = addClip(seq(), rush("z")).clips;
  const rushes = [
    rush("C0003", typique(), { recorded: Date.UTC(2026, 5, 14, 16, 0) }),
    rush("C0001", derush([{ debut: 0, fin: 30, etat: "bon", raisons: [] }]), { recorded: Date.UTC(2026, 5, 14, 14, 0) }),
    rush("son", undefined, { kind: "audio" }),
    rush("C0002", undefined, { recorded: undefined }),
  ];
  const s = preMontage(base, rushes);
  expect(s.id).not.toBe(base.id);
  expect(s.version).toBe(1);
  expect(s.name).toBe("Pré-montage");
  const images = s.clips.filter((c) => c.track < 10 && c.component !== "audio");
  // Les rushes datés d'abord, dans l'ordre de leurs heures ; puis ceux sans
  // heure.
  expect(images.map((c) => c.assetId)).toEqual(["C0001", "C0003", "C0003", "C0002"]);
  expect(images.every((c, i) => i === 0 || c.start === images[i - 1].start + images[i - 1].duration)).toBe(true);
  // La séquence d'origine n'est pas touchée.
  expect(base.clips.length).toBe(2);
  // Sans heure de tournage, l'ordre des noms de fichiers, numéros compris.
  expect([rush("C10"), rush("C9"), rush("C010b")].sort(ordreDeTournage).map((a) => a.id)).toEqual(["C9", "C10", "C010b"]);
  // Un ordre total, quel que soit l'ordre d'arrivée (A daté 10 h, M sans
  // heure, Z daté 9 h).
  const h = (x: number) => Date.UTC(2026, 5, 14, x);
  const melange = [rush("A", undefined, { recorded: h(10) }), rush("M"), rush("Z", undefined, { recorded: h(9) })];
  for (const ordre of [melange, [...melange].reverse(), [melange[1], melange[0], melange[2]]])
    expect([...ordre].sort(ordreDeTournage).map((a) => a.id)).toEqual(["Z", "A", "M"]);
});

import { parsePrompt } from "../src/assistant/commands";
import { applyVideoActions } from "../src/assistant/video-actions";
const consigne = (t: string) => parsePrompt(t, "video").actions.map((a) => a.kind);

it("le pilote comprend le dérushage, le pré-montage et le retrait des passages inutilisables", () => {
  expect(consigne("dérushe les rushes")).toEqual(["video.derush"]);
  expect(consigne("lance le dérushage")).toEqual(["video.derush"]);
  expect(consigne("pré-monte les rushes")).toEqual(["video.premontage"]);
  expect(consigne("fais un pré-montage")).toEqual(["video.premontage"]);
  expect(consigne("retire les passages inutilisables")).toEqual(["video.unusable"]);
  expect(consigne("enlève les flous et bougés")).toEqual(["video.unusable"]);
  expect(consigne("retire les passages flous")).toEqual(["video.unusable"]);
  // « les masques », « les flous » seuls : les masques de flou de l'app,
  // jamais le retrait de passages.
  for (const t of ["supprime les masques", "retire les masques", "enlève les flous", "retire les bougés"])
    expect(() => consigne(t)).toThrow();
  // Une tâche longue reste seule dans sa consigne.
  expect(() => parsePrompt("dérushe les rushes et coupe", "video")).toThrow();
  // Sur un plan posé en entier : ses passages masqués partent, en une fois.
  const a = rush("a", typique()),
    s = addClip(seq(), a);
  const id = s.clips.find((c) => c.track < 10)!.id;
  const r = applyVideoActions(s, [{ kind: "video.unusable" }], [id], 0, [a]);
  expect(length(r)).toBe(650);
  expect(() => applyVideoActions(s, [{ kind: "video.unusable" }], [id], 0, [rush("a")])).toThrow(/Aucun passage masqué/);
});

import { blocs } from "../src/video/derush";
it("les blocs de la journée se coupent aux pauses de plus de 20 minutes", () => {
  const h = (heure: number, minute: number) => Date.UTC(2026, 5, 14, heure, minute);
  const b = blocs([
    rush("C0004", undefined, { recorded: h(16, 0), duration: 60 }),
    rush("C0001", undefined, { recorded: h(10, 0), duration: 600 }),
    rush("C0002", undefined, { recorded: h(10, 25), duration: 60 }),
    rush("C0003", undefined, { recorded: h(10, 50), duration: 60 }),
    rush("DJI_0001", undefined, { recorded: undefined }),
  ]);
  // 10:00 + 10 min → 10:10 ; 10:25 est à 15 min : même bloc ; 10:50 est à
  // 24 min de 10:26 : nouveau bloc ; 16:00 : nouveau bloc ; puis les rushes
  // sans heure.
  expect(b.map((x) => x.assets.map((a) => a.id))).toEqual([["C0001", "C0002"], ["C0003"], ["C0004"], ["DJI_0001"]]);
  expect(b[0].debut).toBe(h(10, 0));
  expect(b[0].fin).toBe(h(10, 26));
  expect(b[3].debut).toBeUndefined();
});

import { typeDePlan } from "../src/video/derush-plans";
it("le type de plan suit la taille du plus grand visage, et la présence de visages", () => {
  expect(typeDePlan([0.3, 0.28, 0.25])).toBe("gros");
  expect(typeDePlan([0.12, 0.1, 0.09, 0])).toBe("moyen");
  expect(typeDePlan([0.03, 0.04, 0.05])).toBe("large");
  // Un visage sur dix relevés : un passant, pas un plan sur quelqu'un.
  expect(typeDePlan([0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe("sans-visage");
  expect(typeDePlan([])).toBe("sans-visage");
});
