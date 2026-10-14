import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import { PhotoWriter, type WriteState } from "../src/modules/photo-writer";
import {
  DEFAULT,
  editPhoto,
  undoPhoto,
  redoPhoto,
  resetPhoto,
  recoverPhoto,
  type Photo,
} from "../src/model";
import { getPhoto, modifyPhoto, modifyPhotoBatch, putPhoto } from "../src/db";
const photo = (id: string): Photo => ({
  id,
  projectId: "writer",
  name: id + ".jpg",
  source: "idb",
  thumbnail: "",
  width: 100,
  height: 100,
  size: 1,
  hash: "a".repeat(64),
  status: "pending",
  stars: 0,
  protected: false,
  chapter: "Prises de vue",
  adjustments: { ...DEFAULT },
  history: [],
  created: 1,
});
it("1000 quick edits and background writes preserve ratings, protection, versions and the last setting", async () => {
  await putPhoto(photo("fast"));
  const states: WriteState[] = [],
    writer = new PhotoWriter(
      (s) => states.push(s),
      () => {},
    );
  const work = Array.from({ length: 1000 }, (_, i) =>
    writer.write("fast", (p) => editPhoto(p, { exposure: i / 1000 })),
  );
  work.push(
    writer.write("fast", (p) => ({
      ...p,
      stars: 5,
      protected: true,
      status: "keep",
    })),
  );
  await modifyPhoto("fast", (p) => ({
    ...p,
    analysis: {
      brightness: 0.4,
      sharpness: 50,
      clipped: 0,
      dhash: "0".repeat(64),
      advice: "normal",
      reasons: [],
    },
  }));
  await Promise.all(work);
  await writer.flush();
  const actual = await getPhoto("fast");
  expect(actual?.adjustments.exposure).toBe(0.999);
  expect(actual?.history).toHaveLength(40);
  expect(actual?.stars).toBe(5);
  expect(actual?.protected).toBe(true);
  expect(actual?.analysis?.sharpness).toBe(50);
  expect(states.at(-1)).toEqual({ pending: 0, error: "" });
}, 20000);
it("a failed write pauses later commands and retry preserves their order", async () => {
  await putPhoto(photo("retry"));
  let fail = true,
    calls = 0;
  const writer = new PhotoWriter(
    () => {},
    () => {},
    async (id, fn) => {
      calls++;
      if (fail) throw Error("Disque plein");
      return modifyPhoto(id, fn);
    },
  );
  const results = await Promise.allSettled([
    writer.write("retry", (p) => editPhoto(p, { exposure: 0.1 })),
    writer.write("retry", (p) => editPhoto(p, { exposure: 0.9 })),
  ]);
  expect(results.every((r) => r.status === "rejected")).toBe(true);
  expect(calls).toBe(1);
  await expect(
    writer.write("retry", (p) => ({ ...p, stars: 4 })),
  ).rejects.toThrow("Disque plein");
  expect(calls).toBe(1);
  fail = false;
  await writer.retry();
  const actual = await getPhoto("retry");
  expect(actual?.adjustments.exposure).toBe(0.9);
  expect(actual?.stars).toBe(4);
  expect(actual?.history).toHaveLength(2);
  expect(calls).toBe(4);
});

it("original recovery survives a double click and undo/redo preserves masked edits", () => {
  const edited = editPhoto(photo("original"), {
    exposure: 0.8,
    style: "signature",
    cropRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
    localEdits: [
      {
        id: "mask",
        name: "Lumière",
        tool: "exposure",
        points: [{ x: 0.4, y: 0.4 }],
        radius: 0.1,
        amount: 0.5,
        opacity: 0.8,
        visible: true,
      },
    ],
  });
  const original = resetPhoto(edited);
  expect(original.adjustments.exposure).toBe(0);
  expect(original.adjustments.cropRect).toBeUndefined();
  expect(original.adjustments.localEdits).toEqual([]);
  const repeated = resetPhoto(original);
  expect(repeated.originalRecovery).toEqual(edited.adjustments);
  expect(recoverPhoto(repeated).adjustments).toEqual(edited.adjustments);
  expect(undoPhoto(original).adjustments).toEqual(edited.adjustments);
  expect(redoPhoto(undoPhoto(original)).adjustments).toEqual(
    original.adjustments,
  );
  expect(repeated.hash).toBe(edited.hash);
  expect(repeated.source).toBe(edited.source);
});

it("atomic bulk writes roll back every photo if a later record is missing", async () => {
  await putPhoto(photo("bulk-atomic"));
  await expect(
    modifyPhotoBatch([
      { id: "bulk-atomic", update: (p) => ({ ...p, stars: 5 }) },
      { id: "missing-bulk-record", update: (p) => p },
    ]),
  ).rejects.toThrow("Photo introuvable.");
  expect((await getPhoto("bulk-atomic"))?.stars).toBe(0);
});
it("large batches publish bounded updates and preserve later commands and undo", async () => {
  const ids = Array.from({ length: 230 }, (_, i) => "bulk-" + i);
  for (const id of ids) await putPhoto(photo(id));
  const saved: Photo[][] = [];
  const writer = new PhotoWriter(
    () => {},
    () => {},
    undefined,
    (ps) => saved.push(ps),
  );
  const work = ids.map((id) =>
    writer.write(id, (p) => ({ ...p, status: "keep" })),
  );
  work.push(writer.write(ids[100], (p) => ({ ...p, stars: 5 })));
  expect(writer.project(photo(ids[100]))).toMatchObject({
    status: "keep",
    stars: 5,
  });
  await Promise.all(work);
  await writer.flush();
  expect(saved.length).toBeLessThan(10);
  expect(await getPhoto(ids[100])).toMatchObject({ status: "keep", stars: 5 });
});
