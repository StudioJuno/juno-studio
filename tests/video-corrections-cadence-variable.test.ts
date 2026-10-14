// Moniteur et rushes à cadence variable (29/09/2026, troisième passe).
//
// Le moniteur visait le milieu d'une image comptée sur la cadence moyenne du
// rush. Sur un rush d'iPhone où une image manque, cette grille se décalait :
// le moniteur montrait une autre image que le film livré. Il se place
// désormais à l'instant voulu plus la marge de l'export, et le navigateur
// montre l'image du fichier dont l'intervalle contient cet instant.
import { it, expect } from "vitest";
import {
  addClip,
  EXPORT_SLACK,
  monitorFrameTime,
  monitorMustSeek,
  monitorTime,
  monitorTolerance,
  split,
} from "../src/video/edit";
import * as frameIndex from "../src/video/frame-index";
import type { Asset, Clip, Sequence } from "../src/video/types";
const sequence = (fps: Sequence["fps"]): Sequence => ({
  id: "s",
  name: "test",
  width: 1920,
  height: 1080,
  fps,
  masterGain: 1,
  clips: [],
  titles: [],
  captions: [],
  markers: [],
  created: 1,
});
/** Un rush dont les images commencent aux instants `pts` (en 1/600 s). */
const rush = (pts: number[], fps: Asset["fps"]) =>
  ({
    id: "a",
    name: "rush.mov",
    kind: "video",
    size: 1,
    duration: (pts[pts.length - 1] + 20) / 600,
    width: 1920,
    height: 1080,
    fps,
    audioChannels: 0,
  }) as Asset;
/** Des images toutes les 20 graduations de 1/600 s (30 i/s), sauf `holes`. */
const skipped = (n: number, holes: number[]) => {
  const out: number[] = [];
  for (let i = 0; out.length < n; i++) if (!holes.includes(i)) out.push(i * 20);
  return out;
};
/**
 * L'image que le navigateur montre à l'arrêt à l'instant `t` : celle dont
 * l'intervalle contient `t`. Chromium ne tranche qu'à une microseconde près
 * autour du début d'une image (mesuré dans Electron le 29/09/2026 : montrée
 * de 1,5 µs avant son début à 1 µs après, selon l'image) : l'image n'est sûre
 * que si `t` tombe plus d'une microseconde après son début et au moins 2 µs
 * avant la suivante.
 */
function shownAt(pts: number[], t: number, den = 600) {
  const at = t * 1e6;
  let i = -1;
  for (let k = 0; k < pts.length; k++) if ((pts[k] * 1e6) / den <= at) i = k;
  const start = i < 0 ? -Infinity : (pts[i] * 1e6) / den,
    next = i + 1 < pts.length ? (pts[i + 1] * 1e6) / den : Infinity;
  return at - start > 1 && next - at >= 2 ? i : `${i} à ${(at - start).toFixed(2)} µs de son début, ${(next - at).toFixed(2)} µs de la suivante`;
}
/**
 * L'image que l'export pose à l'image `f` du montage, comptée comme FFmpeg la
 * compte (render.cjs, `retime`) : les instants en microsecondes depuis le
 * point d'entrée, divisés par la vitesse, moins la marge d'une milliseconde,
 * tronqués (setpts), puis la dernière image dont l'instant arrondi vers le
 * haut à la cadence de la séquence ne dépasse pas l'image `f` (fps).
 */
function exported(pts: number[], s: Sequence, c: Clip, f: number, den = 600) {
  const image = f - c.start;
  let i = -1;
  for (let k = 0; k < pts.length; k++) {
    const q = Math.trunc((Math.round((pts[k] * 1e6) / den) - c.inUs) / c.speed - 1000);
    if (Math.ceil((q * s.fps.n) / (s.fps.d * 1e6)) <= image) i = k;
  }
  return i;
}
/** Le montage de la relecture : plan entier, coupes à la touche S à 37 et 111. */
function cutAt(s: Sequence, a: Asset, speed: number) {
  let t = addClip(s, a, 0);
  t = { ...t, clips: [{ ...t.clips[0], speed, duration: Math.floor(t.clips[0].duration / speed) - 2 }] };
  for (const at of [37, 111]) {
    const c = t.clips.find((x) => x.start < at && x.start + x.duration > at);
    if (c) t = split(t, c.id, at);
  }
  return t;
}
const planAt = (s: Sequence, f: number) =>
  s.clips.find((c) => c.start <= f && c.start + c.duration > f)!;
/** Les 150 premières images du montage, ou moins s'il est plus court. */
const imagesOf = (s: Sequence) => {
  const last = s.clips[s.clips.length - 1];
  return [...Array(Math.min(150, last.start + last.duration)).keys()];
};
const IPHONE = skipped(300, [11]);
const HOLES = [5, 20, 21, 36, 37, 38, 60, 61, 62, 63, 100, 110, 111, 112, 113, 114, 115];
// Écarts d'un enregistrement d'écran : irréguliers, jamais sur une grille.
const SCREEN = (() => {
  const gaps = [70, 10, 10, 10, 10, 10, 10, 10, 13, 7, 10, 30, 10, 10, 11, 9, 50, 10, 10, 10];
  const out = [0];
  for (let i = 1; i < 300; i++) out.push(out[i - 1] + gaps[i % gaps.length]);
  return out;
})();
const S2997 = { n: 30000, d: 1001 },
  S25 = { n: 25, d: 1 },
  S30 = { n: 30, d: 1 };
it("rush d'iPhone à une image sautée : le moniteur montre l'image du film à chaque image, là où la grille moyenne se trompait 35 fois sur 48", () => {
  const a = rush(IPHONE, { n: 9000, d: 301 });
  for (const fps of [S2997, S30, S25])
    for (const speed of [1, 2, 0.5, 0.25]) {
      const s = cutAt(sequence(fps), a, speed);
      for (const f of imagesOf(s)) {
        const c = planAt(s, f);
        expect(shownAt(IPHONE, monitorTime(c, a, s, f)), `${fps.n}/${fps.d}, ${speed}×, image ${f}`).toBe(
          exported(IPHONE, s, c, f),
        );
      }
    }
  // L'ancien calcul : le milieu d'une image de la grille à 9000/301 i/s.
  const s = cutAt(sequence(S2997), a, 1),
    rate = 9000 / 301;
  let wrong = 0;
  for (let f = 0; f < 48; f++) {
    const c = planAt(s, f),
      t = c.inUs / 1e6 + ((f - c.start) * 1001) / 30000,
      old = (Math.floor((t + EXPORT_SLACK) * rate) + 0.5) / rate;
    if (String(shownAt(IPHONE, old)) !== String(exported(IPHONE, s, c, f))) wrong++;
  }
  expect(wrong).toBe(35);
});
it("plusieurs images sautées, trous sous les coupes, et instants d'un enregistrement d'écran : aucune image d'écart", () => {
  for (const pts of [skipped(300, HOLES), SCREEN]) {
    const a = rush(pts, { n: pts.length * 600, d: pts[pts.length - 1] + 20 });
    for (const fps of [S2997, S25, { n: 60000, d: 1001 }, { n: 24000, d: 1001 }])
      for (const speed of [1, 2, 0.5, 0.25]) {
        const s = cutAt(sequence(fps), a, speed);
        for (const f of imagesOf(s)) {
          const c = planAt(s, f);
          expect(shownAt(pts, monitorTime(c, a, s, f)), `${fps.n}/${fps.d}, ${speed}×, image ${f}`).toBe(
            exported(pts, s, c, f),
          );
        }
      }
  }
});
it("un 29,97 écrit en base 1/600 : ses images tombent à côté de la grille, le moniteur suit quand même l'export, même au ralenti", () => {
  // L'image k commence à round(20,02 k) / 600 s, jusqu'à 0,8 ms après la grille.
  const pts = Array.from({ length: 400 }, (_, k) => Math.round(20.02 * k)),
    a = rush(pts, S2997);
  for (const speed of [1, 2, 0.5, 0.25]) {
    const s = cutAt(sequence(S2997), a, speed);
    for (const f of imagesOf(s)) {
      const c = planAt(s, f);
      expect(shownAt(pts, monitorTime(c, a, s, f)), `${speed}×, image ${f}`).toBe(exported(pts, s, c, f));
    }
  }
});
it("un rush 29,97 dans une séquence 25 : l'image 30 du rush commence exactement une milliseconde après la première seconde, et le moniteur la montre comme le film", () => {
  // Base de temps 1/30000 : l'image k commence à 1001 k graduations.
  const pts = Array.from({ length: 400 }, (_, k) => 1001 * k),
    a = rush([], { n: 30000, d: 1001 });
  a.duration = 400 / (30000 / 1001);
  for (const speed of [1, 2, 0.5, 1.5, 4]) {
    const s = cutAt(sequence(S25), a, speed);
    for (const f of imagesOf(s)) {
      const c = planAt(s, f);
      expect(shownAt(pts, monitorTime(c, a, s, f), 30000), `${speed}×, image ${f}`).toBe(
        exported(pts, s, c, f, 30000),
      );
    }
    // L'égalité : à l'image 25 (une seconde), l'export prend l'image 30 × vitesse.
    if (Number.isInteger(30 * speed))
      expect(exported(pts, s, planAt(s, 25), 25, 30000)).toBe(30 * speed);
  }
  // Posé à la marge seule, le moniteur tombait pile au début de l'image 30,
  // là où Chromium montre encore l'image 29 : aucune image n'y est sûre.
  expect(typeof shownAt(pts, 1 + EXPORT_SLACK, 30000)).toBe("string");
});
/**
 * Le moniteur à l'arrêt, image par image, comme Preview.tsx : l'élément vidéo
 * garde l'instant où on l'a posé, et montre l'image du fichier qui le contient.
 */
function stepThrough(pts: number[], a: Asset, s: Sequence, frames: number[], rule: "seuil" | "cible") {
  let current = 0,
    placed: number | undefined;
  const wrong: number[] = [];
  for (const f of frames) {
    const c = planAt(s, f),
      target = monitorTime(c, a, s, f),
      tolerance = monitorTolerance(c, a, s, false);
    const seek =
      rule === "seuil"
        ? Math.abs(current - target) > tolerance
        : monitorMustSeek(current, target, placed, tolerance, false);
    if (seek) current = target;
    placed = target;
    if (String(shownAt(pts, current)) !== String(exported(pts, s, c, f))) wrong.push(f);
  }
  return wrong;
}
it("au ralenti, avancer d'une image replace le moniteur même quand la cible bouge de moins d'un quart d'image", () => {
  // Rush 25 i/s à 0,25× en 29,97 : la cible avance de 8,3 ms, sous le seuil
  // de 10 ms, et une frontière d'image tombe tous les 4,8 pas.
  const pts = Array.from({ length: 300 }, (_, k) => k * 24),
    a = rush(pts, S25),
    s = cutAt(sequence(S2997), a, 0.25),
    frames = [...Array(120).keys(), ...Array.from({ length: 30 }, (_, i) => 119 - i)];
  expect(monitorTolerance(s.clips[0], a, s, false)).toBeCloseTo(0.01, 9);
  // Avec le seul seuil, le moniteur restait sur l'image d'avant.
  expect(stepThrough(pts, a, s, frames, "seuil").length).toBeGreaterThan(10);
  expect(stepThrough(pts, a, s, frames, "cible")).toEqual([]);
  // Le rush d'iPhone à 0,25× : même chose.
  const iphone = rush(IPHONE, { n: 9000, d: 301 }),
    slow = cutAt(sequence(S2997), iphone, 0.25);
  expect(stepThrough(IPHONE, iphone, slow, [...Array(150).keys()], "cible")).toEqual([]);
});
it("à l'arrêt d'une lecture, le moniteur est replacé même à moins d'un quart d'image de sa cible", () => {
  const s = addClip(sequence(S2997), rush(IPHONE, { n: 9000, d: 301 }), 0),
    c = s.clips[0],
    target = monitorTime(c, rush(IPHONE, { n: 9000, d: 301 }), s, 40);
  // La lecture s'est arrêtée 5 ms avant la cible (seuil : 8,4 ms). Après une
  // lecture, aucune cible n'est posée.
  expect(monitorMustSeek(target - 0.005, target, undefined, 0.0084, false)).toBe(true);
  // Rien ne bouge : pas de nouvelle recherche.
  expect(monitorMustSeek(target, target, target, 0.0084, false)).toBe(false);
  // En lecture, seul l'écart compte.
  expect(monitorMustSeek(target - 0.05, target, undefined, 0.13, true)).toBe(false);
  expect(monitorMustSeek(target - 0.2, target, undefined, 0.13, true)).toBe(true);
});
/** Une boîte MP4 : taille, type, contenu. */
function box(type: string, ...parts: Uint8Array[]) {
  const size = 8 + parts.reduce((n, p) => n + p.byteLength, 0),
    out = new Uint8Array(size),
    view = new DataView(out.buffer);
  view.setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
/** Des entiers de 32 bits (négatifs compris), à la suite. */
function u32(...values: number[]) {
  const out = new Uint8Array(values.length * 4),
    view = new DataView(out.buffer);
  values.forEach((v, i) => view.setInt32(i * 4, v));
  return out;
}
/** Une piste : son type (« vide », « soun »), son échelle, ses tables. */
function trak(handler: string, scale: number, tables: Uint8Array[], elst?: number[][]) {
  const hdlr = box("hdlr", u32(0, 0), new TextEncoder().encode(handler), u32(0, 0, 0)),
    mdhd = box("mdhd", u32(0, 0, 0, scale, 0, 0)),
    stbl = box("stbl", ...tables),
    edts = elst ? [box("edts", box("elst", u32(0, elst.length, ...elst.flatMap(([d, m]) => [d, m, 0x10000]))))] : [];
  return box("trak", ...edts, box("mdia", mdhd, hdlr, box("minf", stbl)));
}
it("l'index d'un MP4 donne les instants des images comme FFmpeg : séries de durées, images réordonnées, liste de montage", () => {
  const { fileTimes } = frameIndex;
  const stts = (...runs: number[][]) => box("stts", u32(0, runs.length, ...runs.flat()));
  // Une piste son d'abord, ignorée ; puis la vidéo en base 1/600 : dix images
  // de 20 graduations, une de 40 (image sautée), puis dix de 20.
  const movie = box(
    "moov",
    box("mvhd", u32(0, 0, 0, 1000, 0)),
    trak("soun", 48000, [stts([100, 1024])]),
    trak("vide", 600, [stts([10, 20], [1, 40], [10, 20])]),
  );
  const file = new Uint8Array([...box("ftyp", u32(0x69736f6d)), ...movie]);
  const times = fileTimes(file)!;
  expect(times).toHaveLength(21);
  expect(times.slice(9, 13)).toEqual([300000, 333333, 400000, 433333]);
  // Images réordonnées (I P B B : ctts) et liste de montage qui retire le
  // décalage : les instants de présentation, triés, commencent à zéro.
  const reordered = box(
    "moov",
    box("mvhd", u32(0, 0, 0, 1000, 0)),
    trak(
      "vide",
      30000,
      [stts([4, 1001]), box("ctts", u32(0, 4, 1, 2002, 1, 4004, 1, 1001, 1, 1001))],
      [[133, 2002]],
    ),
  );
  expect(fileTimes(reordered)).toEqual([0, 33367, 66733, 100100]);
  // Un début à vide de 100 ms (échelle du film : 1/1000) décale tout.
  const delayed = box(
    "moov",
    box("mvhd", u32(0, 0, 0, 1000, 0)),
    trak("vide", 25, [stts([3, 1])], [[100, -1], [120, 0]]),
  );
  expect(fileTimes(delayed)).toEqual([100000, 140000, 180000]);
  // Deux segments lus : illisible, le moniteur se rabat sur la marge.
  const twice = box("moov", trak("vide", 25, [stts([3, 1])], [[40, 0], [40, 1]]));
  expect(fileTimes(twice)).toBeNull();
  expect(fileTimes(box("mdat", u32(1, 2, 3)))).toBeNull();
});
it("avec les instants des images, le moniteur se pose au milieu de l'image que l'export montre, quelle que soit la cadence", () => {
  const cases = [
    { pts: IPHONE, den: 600 },
    { pts: skipped(300, HOLES), den: 600 },
    { pts: SCREEN, den: 600 },
    { pts: Array.from({ length: 400 }, (_, k) => Math.round(20.02 * k)), den: 600 },
    { pts: Array.from({ length: 400 }, (_, k) => 1001 * k), den: 30000 },
  ];
  for (const { pts, den } of cases) {
    const times = pts.map((p) => Math.round((p * 1e6) / den)),
      a = rush([], { n: 30, d: 1 });
    a.duration = pts[pts.length - 1] / den;
    for (const fps of [S2997, S25, { n: 60000, d: 1001 }])
      for (const speed of [1, 2, 0.5, 0.25, 1.5]) {
        const s = cutAt(sequence(fps), a, speed);
        for (const f of imagesOf(s)) {
          const c = planAt(s, f),
            want = exported(pts, s, c, f, den),
            t = monitorFrameTime(times, c, s, f) * 1e6,
            label = `${den} ${fps.n}/${fps.d}, ${speed}×, image ${f}`;
          // L'image montrée est celle du film, et la cible tombe à mi-chemin
          // entre son début et celui de la suivante.
          expect(Math.max(0, times.findLastIndex((x) => x <= t)), label).toBe(Math.max(0, want));
          const k = Math.max(0, want),
            next = times[k + 1] ?? times[k] + 40000;
          expect(t - times[k], label).toBeCloseTo((next - times[k]) / 2, 6);
        }
      }
  }
});
