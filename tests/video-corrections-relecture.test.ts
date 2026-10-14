// Corrections du studio vidéo après relecture (29/09/2026) : le moniteur
// montre l'image que le film livré montre, et le pilote annule et rétablit
// dans le bon ordre.
import { it, expect } from "vitest";
import {
  addClip,
  EXPORT_SLACK,
  monitorTime,
  monitorTolerance,
  seconds,
  split,
} from "../src/video/edit";
import { nothingRestored, pilotRecord } from "../src/video/history";
import type { Asset, Sequence } from "../src/video/types";
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
const asset = (o: Partial<Asset> = {}): Asset =>
  ({
    id: "a",
    name: "rush.mov",
    kind: "video",
    size: 1,
    duration: 20,
    width: 1920,
    height: 1080,
    fps: { n: 25, d: 1 },
    audioChannels: 0,
    ...o,
  }) as Asset;
const RATES = [
  { n: 25, d: 1 },
  { n: 30000, d: 1001 },
  { n: 24000, d: 1001 },
  { n: 60000, d: 1001 },
  { n: 24, d: 1 },
  { n: 30, d: 1 },
  { n: 50, d: 1 },
  { n: 60, d: 1 },
];
/** Le plan à l'écran à l'image `f`. */
const at = (s: Sequence, f: number) =>
  s.clips.find((c) => c.start <= f && c.start + c.duration > f)!;
it("le moniteur se place juste après l'instant voulu, de la marge de l'export, au raccord comme dans le plan continu", () => {
  for (const fps of RATES) {
    const r = fps.n / fps.d,
      a = asset({ fps }),
      base = addClip(sequence(fps), a, 0);
    let s = split(base, base.clips[0].id, 37);
    s = split(s, s.clips[1].id, 111);
    s = split(s, s.clips[2].id, 185);
    expect(s.clips.map((c) => c.start)).toEqual([0, 37, 111, 185]);
    // Même cadence : l'image f du montage est l'image f du rush, que le plan
    // soit coupé ou non. La cible tombe une milliseconde après son début,
    // jamais sur la frontière ni dans l'image suivante.
    for (let f = 0; f < 300; f++) {
      for (const clip of [base.clips[0], at(s, f)]) {
        const image = monitorTime(clip, a, s, f) * r;
        expect(Math.floor(image), `${r} i/s, image ${f}`).toBe(f);
        expect(image - f, `${r} i/s, image ${f}`).toBeGreaterThan(
          0.9 * EXPORT_SLACK * r,
        );
        expect(image - f, `${r} i/s, image ${f}`).toBeLessThan(
          1.1 * EXPORT_SLACK * r,
        );
      }
    }
    // L'ancien calcul visait le début de l'image, arrondi vers le bas au
    // raccord : il tombait avant elle, et le navigateur montrait la précédente.
    const cut = s.clips[1],
      old = cut.inUs / 1e6 + seconds(0, s) * cut.speed;
    if ((37 * fps.d * 1e6) % fps.n) expect(Math.floor(old * r)).toBe(36);
  }
});
it("à vitesse modifiée, le moniteur suit l'image que l'export saute", () => {
  const fps = { n: 30000, d: 1001 },
    r = fps.n / fps.d,
    a = asset({ fps }),
    base = addClip(sequence(fps), a, 0);
  const fast = { ...base, clips: [{ ...base.clips[0], speed: 2, duration: 250 }] };
  const s = split(fast, fast.clips[0].id, 37);
  for (let f = 0; f < 250; f++) {
    const image = monitorTime(at(s, f), a, s, f) * r;
    expect(Math.floor(image)).toBe(2 * f);
    // La marge de l'export est comptée en temps du montage : deux
    // millisecondes du rush à 2×.
    expect(image - 2 * f).toBeCloseTo(2 * EXPORT_SLACK * r, 3);
  }
});
it("un rush 25 i/s dans une séquence 29,97 : le moniteur prend l'image à l'écran à l'instant, comme l'export", () => {
  const fps = { n: 30000, d: 1001 },
    a = asset({ fps: { n: 25, d: 1 } }),
    base = addClip(sequence(fps), a, 0);
  const s = split(base, base.clips[0].id, 15);
  for (let f = 0; f < 200; f++) {
    // En nombres entiers : l'image f commence à f × 1001 / 30000 s, et
    // l'export y pose la dernière image du rush commencée au plus une
    // milliseconde après (aux images 193 et 199, l'image suivante commence
    // moins d'une milliseconde après l'instant).
    const want = Math.floor((25025 * f + 750) / 30000);
    const image = monitorTime(at(s, f), a, s, f) * 25;
    expect(Math.floor(image), "image " + f).toBe(want);
  }
});
it("à l'arrêt, avancer d'une image replace toujours le moniteur, même en 59,94", () => {
  for (const fps of RATES) {
    const a = asset({ fps }),
      s = addClip(sequence(fps), a, 0),
      c = s.clips[0];
    const still = monitorTolerance(c, a, s, false);
    // Les 18 ms d'avant dépassaient l'image entière en 59,94 (16,7 ms).
    for (let f = 0; f < 100; f++)
      expect(
        monitorTime(c, a, s, f + 1) - monitorTime(c, a, s, f),
      ).toBeGreaterThan(2 * still);
    expect(monitorTolerance(c, a, s, true)).toBe(0.13);
  }
  // Le son reprend à l'instant exact, et une image fixe à zéro.
  const fps = { n: 30000, d: 1001 },
    s = sequence(fps),
    son = asset({ kind: "audio", fps }),
    audio = addClip(s, son, 0).clips[0];
  expect(audio.track).toBe(10);
  expect(monitorTime({ ...audio, inUs: 1234566 }, son, s, 0)).toBe(1.234566);
  expect(monitorTolerance(audio, son, s, false)).toBe(0.018);
  const photo = asset({ kind: "image" }),
    still = addClip(s, photo, 0).clips[0];
  expect(monitorTime(still, photo, s, 3)).toBe(0);
});
it("le moniteur ne suppose aucune cadence du rush, lisible ou non", () => {
  const fps = { n: 30000, d: 1001 },
    s = addClip(sequence(fps), asset(), 0),
    c = s.clips[0];
  for (const rate of [{ n: 0, d: 0 }, { n: 25, d: 1 }, { n: 9000, d: 301 }])
    expect(monitorTime(c, asset({ fps: rate }), s, 37)).toBe(
      monitorTime(c, asset(), s, 37),
    );
  // À la microseconde près : la borne de l'export, comptée en microsecondes.
  expect(monitorTime(c, asset(), s, 37)).toBeCloseTo(
    (37 * 1001) / 30000 + EXPORT_SLACK,
    5,
  );
});
type R = { id: string; state: "done" | "undone" | "partial"; created: number; updated: number };
const rec = (id: string, state: R["state"], created: number, updated = created): R => ({
  id,
  state,
  created,
  updated,
});
it("« annule » vise la dernière commande encore entièrement appliquée, jamais une annulée en partie", () => {
  // B a été annulée en partie (à 5) : « annule » passe à A au lieu de buter sur B.
  const journal = [rec("B", "partial", 2, 5), rec("A", "done", 1)];
  expect(pilotRecord(journal, false)?.id).toBe("A");
  // L'ancienne règle (tout ce qui n'est pas « undone ») retombait sur B.
  expect(journal.find((r) => r.state !== "undone")?.id).toBe("B");
  // « rétablis » reprend B, annulée en partie, puisque rien n'a été lancé depuis.
  expect(pilotRecord(journal, true)?.id).toBe("B");
  expect(pilotRecord([rec("A", "undone", 1, 2)], false)).toBeUndefined();
  expect(pilotRecord([], true)).toBeUndefined();
});
it("« rétablis » ne remet pas une commande plus ancienne par-dessus une commande lancée après son annulation", () => {
  // A annulée à 5, puis B lancée à 6.
  const journal = [rec("B", "done", 6), rec("A", "undone", 1, 5)];
  expect(pilotRecord(journal, true)).toBeUndefined();
  // L'ancienne règle rétablissait A.
  expect(journal.find((r) => r.state === "undone")?.id).toBe("A");
  // « annule » vise B.
  expect(pilotRecord(journal, false)?.id).toBe("B");
});
it("« rétablis » défait les annulations dans l'ordre inverse, quel que soit l'ordre du journal reçu", () => {
  // B annulée à 6, puis A à 7 : on rétablit A d'abord, puis B.
  let journal = [rec("B", "undone", 2, 6), rec("A", "undone", 1, 7)];
  expect(pilotRecord(journal, true)?.id).toBe("A");
  journal = [rec("A", "done", 1, 8), rec("B", "undone", 2, 6)];
  expect(pilotRecord(journal, true)?.id).toBe("B");
  // Rétablir A n'est pas une commande nouvelle : B reste rétablissable.
  expect(pilotRecord(journal, false)?.id).toBe("A");
});
it("le pilote reconnaît le refus « rien n'a été annulé » du journal, et seulement lui", () => {
  expect(
    nothingRestored(
      "Rien n’a été annulé : le montage a été repris après « Coupe ». Vos modifications sont conservées ; utilisez une version de secours pour revenir plus loin.",
    ),
  ).toBe(true);
  expect(nothingRestored("Rien n’a été rétabli : le montage a été repris après l’annulation de « Coupe ».")).toBe(true);
  expect(nothingRestored("Séquence introuvable.")).toBe(false);
});
