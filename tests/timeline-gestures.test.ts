import { it, expect } from "vitest";
import {
  addClip,
  moveClip,
  overwriteVideoTrack,
  BASE_GRADE,
} from "../src/video/edit";
import type { Asset, Sequence } from "../src/video/types";
const sequence = (): Sequence => ({
  id: "s",
  name: "Film",
  width: 1920,
  height: 1080,
  fps: { n: 25, d: 1 },
  masterGain: 1,
  clips: [],
  titles: [],
  captions: [],
  markers: [],
  created: 1,
});
const media = (id: string) =>
  ({ id, kind: "video", duration: 8, audioChannels: 2 }) as Asset;
it("poser un plan sur V1 remplace seulement la partie couverte et garde les deux morceaux vidéo/son synchronisés", () => {
  const first = addClip(sequence(), media("old"), 0, 0);
  const inserted = addClip(first, media("new"), 50, 0);
  inserted.clips[2].duration = 100;
  inserted.clips[3].duration = 100;
  const result = overwriteVideoTrack(inserted, [inserted.clips[2].id]);
  const pictures = result.clips.filter((c) => c.track === 0),
    sounds = result.clips.filter((c) => c.track === 10);
  expect(pictures.map((c) => [c.assetId, c.start, c.duration])).toEqual([
    ["old", 0, 50],
    ["old", 150, 50],
    ["new", 50, 100],
  ]);
  expect(sounds.map((c) => [c.assetId, c.start, c.duration])).toEqual([
    ["old", 0, 50],
    ["old", 150, 50],
    ["new", 50, 100],
  ]);
  expect(pictures[1].inUs).toBe(6e6);
  expect(first.clips).toHaveLength(2);
});
it("V2 peut couvrir V1 sans effacer son montage ; une piste verrouillée bloque un remplacement", () => {
  const first = addClip(sequence(), media("old"), 0, 0),
    layer = addClip(first, media("new"), 50, 1);
  expect(overwriteVideoTrack(layer, [layer.clips[2].id]).clips).toHaveLength(4);
  const same = moveClip(layer, layer.clips[2].id, 50, 0);
  same.tracks = { "10": { locked: true } };
  expect(() => overwriteVideoTrack(same, [same.clips[2].id])).toThrow(
    /Déverrouillez/,
  );
});
