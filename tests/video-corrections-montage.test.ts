// Recadrage posé sur la séquence d'aujourd'hui : seul le cadre est reporté
// (30/09/2026).
//
// `reporterCadrage` (src/video/reframe-run.ts) pose le résultat du relevé des
// visages sur la séquence telle qu'elle est à son retour. Du plan relevé, il
// ne reprend que le cadre : l'échelle, la position, leurs images clés et le
// mode de cadrage. Tout le reste vient du plan d'aujourd'hui, y compris ce
// qui a été réglé pendant le relevé : les images clés d'un autre champ (le
// volume), les masques, l'étalonnage, l'opacité, le début.
//
// Relecture de la passe 9 : la version précédente de ce fichier avait été
// retirée (elle n'échouait sur le code d'avant que parce que la fonction
// n'existait pas), et plus aucun test ne voyait les images clés de volume
// reprises du plan relevé (`{ ...fait.animation }` au lieu de
// `{ ...c.animation }`). La fonction existe maintenant : ces tests la gardent,
// et le même geste est vérifié sur l'éditeur monté dans
// video-corrections-clavier.test.ts.
import { describe, expect, it, vi } from "vitest";
// Un visage qui traverse l'image de gauche à droite : le cadre le suit, donc
// le relevé écrit ses propres images clés de position.
const releve = vi.hoisted(() => ({
  echantillons: Array.from({ length: 8 }, (_, i) => ({
    seconde: i * 0.5,
    visages: [{ x: 0.1 + i * 0.1, y: 0.3, w: 0.08, h: 0.15 }],
  })),
}));
vi.mock("../src/video/reframe-scan", () => ({
  releverVisages: vi.fn(async () => ({
    echantillons: releve.echantillons,
    source: { w: 1920, h: 1080 },
  })),
}));
import { recadrer, reporterCadrage } from "../src/video/reframe-run";
import { BASE_GRADE } from "../src/video/edit";
import type { Keyframe } from "../src/video/animation";
import type { Asset, Clip, Sequence } from "../src/video/types";

// Un rush 16/9 dans une séquence verticale.
const rush = {
  id: "rush",
  name: "Couple.mov",
  kind: "video",
  width: 1920,
  height: 1080,
  duration: 20,
  fps: { n: 25, d: 1 },
  source: "juno-media://rush",
} as Asset;
const plan = (id: string, extra: Partial<Clip> = {}): Clip => ({
  id,
  assetId: "rush",
  component: "video",
  track: 0,
  start: 0,
  duration: 100,
  inUs: 0,
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
  grade: { ...BASE_GRADE },
  ...extra,
});
const cle = (frame: number, value: number, easing: Keyframe["easing"] = "linear") => ({
  frame,
  value,
  easing,
});
// Le plan « b » porte déjà une position animée à la main et un volume animé.
function film(): Sequence {
  return {
    id: "s",
    name: "Teaser",
    version: 1,
    width: 1080,
    height: 1920,
    fps: { n: 25, d: 1 },
    masterGain: 1,
    tracks: {},
    clips: [
      plan("a"),
      plan("b", {
        start: 100,
        animation: {
          x: [cle(0, -0.3), cle(99, 0.3)],
          y: [cle(0, 0.1), cle(99, -0.1)],
          gain: [cle(0, 1)],
        },
      }),
    ],
    titles: [],
    captions: [],
    markers: [],
    created: 1,
  } as Sequence;
}
const masques = [
  {
    id: "m",
    name: "Visage",
    effect: "blur",
    shape: "ellipse",
    width: 0.2,
    height: 0.2,
    strength: 0.5,
    feather: 0.1,
    keys: [{ frame: 0, x: 0.5, y: 0.5 }],
  },
] as Clip["masks"];
const byId = (s: Sequence, id: string) => s.clips.find((c) => c.id === id)!;
// Ce qui a été réglé sur « b » pendant le relevé : tout sauf son cadre.
function reglePendant(depart: Sequence, gain: Keyframe[]): Sequence {
  return {
    ...depart,
    clips: depart.clips.map((c) =>
      c.id === "b"
        ? {
            ...c,
            start: 400,
            opacity: 0.5,
            masks: masques,
            grade: { ...c.grade, exposure: 1 },
            animation: { ...c.animation, gain },
          }
        : c,
    ),
  };
}

describe("reporterCadrage ne pose que le cadre", () => {
  it("volume animé, masques, étalonnage, opacité et début réglés pendant le relevé restent ceux d'aujourd'hui", async () => {
    const depart = film();
    const { sequence: recadree, notes } = await recadrer(depart, [rush], () => "couple");
    expect(notes.map((n) => n.clipId)).toEqual(["a", "b"]);
    const fait = byId(recadree, "b");
    // Témoin : le relevé a bien écrit ses propres images clés de position, et
    // gardé le volume du plan tel qu'il était au clic.
    expect(fait.animation?.x?.length).toBeGreaterThan(1);
    expect(fait.animation?.x).not.toEqual(byId(depart, "b").animation?.x);
    expect(fait.animation?.gain).toEqual([cle(0, 1)]);
    const gain = [cle(0, 0.2, "hold"), cle(50, 0.8)];
    const courante = reglePendant(depart, gain);
    const r = reporterCadrage(courante, depart, recadree, notes);
    if ("abandon" in r) throw Error(r.abandon);
    expect(r.ecartes).toBe(0);
    expect(byId(r.sequence, "b")).toEqual({
      ...byId(courante, "b"),
      scale: fait.scale,
      x: fait.x,
      y: fait.y,
      reframe: "couple",
      animation: { gain, x: fait.animation!.x, y: fait.animation!.y },
    });
    // Le plan « a », que rien n'a touché, reçoit son cadre.
    expect(byId(r.sequence, "a")).toEqual(byId(recadree, "a"));
  });
  it("cadre fixe : les anciennes images clés de position partent, le volume d'aujourd'hui reste", async () => {
    // Aucun visage : cadre au centre, sans images clés de position.
    const avant = releve.echantillons;
    releve.echantillons = [];
    try {
      const depart = film();
      const { sequence: recadree, notes } = await recadrer(depart, [rush], () => "couple");
      const fait = byId(recadree, "b");
      expect(fait.animation).toEqual({ gain: [cle(0, 1)] });
      const gain = [cle(0, 0.5)];
      const courante = reglePendant(depart, gain);
      const r = reporterCadrage(courante, depart, recadree, notes);
      if ("abandon" in r) throw Error(r.abandon);
      expect(byId(r.sequence, "b")).toEqual({
        ...byId(courante, "b"),
        scale: fait.scale,
        x: fait.x,
        y: fait.y,
        reframe: "couple",
        animation: { gain },
      });
      // Sans autre image clé que la position, il ne reste pas d'animation vide.
      const seul: Sequence = {
        ...depart,
        clips: depart.clips.map((c) =>
          c.id === "b" ? { ...c, animation: { x: c.animation!.x, y: c.animation!.y } } : c,
        ),
      };
      const vide = await recadrer(seul, [rush], () => "couple");
      const r2 = reporterCadrage(seul, seul, vide.sequence, vide.notes);
      if ("abandon" in r2) throw Error(r2.abandon);
      expect("animation" in byId(r2.sequence, "b")).toBe(false);
    } finally {
      releve.echantillons = avant;
    }
  });
});
