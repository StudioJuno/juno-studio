import { it, expect } from "vitest";
import {
  ANCHORS,
  SIGNATURE_LENGTH,
  SAME_PERSON,
  clusterFaces,
  faceSignature,
  mergeInto,
  nearestPerson,
  rankPeople,
  signatureDistance,
} from "../src/modules/people";
/** A synthetic face: 468 points, with the anchors placed deliberately. */
function makeFace(seed: number, scale = 1, offset = { x: 0, y: 0 }) {
  const points = Array.from({ length: 468 }, (_, i) => ({
    x: offset.x + scale * (0.5 + Math.sin(i * 0.7 + seed) * 0.12),
    y: offset.y + scale * (0.5 + Math.cos(i * 0.9 + seed * 1.3) * 0.12),
  }));
  // Eyes must be apart, they set the scale reference.
  points[33] = { x: offset.x + scale * 0.4, y: offset.y + scale * 0.45 };
  points[263] = { x: offset.x + scale * 0.6, y: offset.y + scale * 0.45 };
  return points;
}
it("a signature has one distance per pair of anchors", () => {
  const signature = faceSignature(makeFace(1));
  expect(signature).toHaveLength(SIGNATURE_LENGTH);
  expect(SIGNATURE_LENGTH).toBe((ANCHORS.length * (ANCHORS.length - 1)) / 2);
  expect(signature!.every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
});
it("the same face read bigger or moved gives the same signature", () => {
  const near = faceSignature(makeFace(2))!,
    far = faceSignature(makeFace(2, 0.35, { x: 0.2, y: 0.1 }))!;
  // Scale and position are normalised away, so the distance is negligible.
  expect(signatureDistance(near, far)).toBeLessThan(1e-9);
});
it("two different faces are further apart than the same face twice", () => {
  const a = faceSignature(makeFace(3))!,
    b = faceSignature(makeFace(9))!;
  expect(signatureDistance(a, b)).toBeGreaterThan(SAME_PERSON);
  expect(signatureDistance(a, a)).toBeLessThan(1e-12);
});
it("a malformed face never produces a signature", () => {
  expect(faceSignature([])).toBeUndefined();
  expect(
    faceSignature(Array.from({ length: 10 }, () => ({ x: 0, y: 0 }))),
  ).toBeUndefined();
  // Both eyes on the same spot: no scale reference, so no identity.
  const flat = makeFace(4);
  flat[33] = { x: 0.5, y: 0.5 };
  flat[263] = { x: 0.5, y: 0.5 };
  expect(faceSignature(flat)).toBeUndefined();
  const broken = makeFace(5);
  broken[61] = { x: Number.NaN, y: 0 };
  expect(faceSignature(broken)).toBeUndefined();
});
it("distance is bounded and safe on mismatched input", () => {
  expect(signatureDistance([1, 2, 3], [1, 2])).toBe(1);
  expect(signatureDistance([], [])).toBe(1);
  expect(signatureDistance([0, 0], [0, 0])).toBe(1);
});
it("an album of two people groups into two identities", () => {
  const camille = faceSignature(makeFace(11))!,
    louis = faceSignature(makeFace(21))!;
  const faces = [
    { id: "a1", signature: camille },
    { id: "b1", signature: louis },
    { id: "a2", signature: faceSignature(makeFace(11, 0.6))! },
    { id: "b2", signature: faceSignature(makeFace(21, 1.4))! },
    { id: "a3", signature: camille },
  ];
  const { people, assignment } = clusterFaces(faces);
  expect(people).toHaveLength(2);
  expect(assignment.get("a1")).toBe(assignment.get("a2"));
  expect(assignment.get("a1")).toBe(assignment.get("a3"));
  expect(assignment.get("b1")).toBe(assignment.get("b2"));
  expect(assignment.get("a1")).not.toBe(assignment.get("b1"));
  // The most photographed person comes first: the couple leads an album.
  expect(rankPeople(people)[0].samples).toBe(3);
});
it("a face turned away joins a known person but never creates one", () => {
  const known = faceSignature(makeFace(31))!;
  const first = clusterFaces([{ id: "f1", signature: known }]);
  expect(first.people).toHaveLength(1);
  // A profile of a stranger is ignored rather than inventing an identity.
  const second = clusterFaces(
    [{ id: "f2", signature: faceSignature(makeFace(77))!, turned: 0.9 }],
    first.people,
  );
  expect(second.people).toHaveLength(1);
  expect(second.assignment.get("f2")).toBeUndefined();
  // The same person seen in profile still joins their identity.
  const third = clusterFaces(
    [{ id: "f3", signature: known, turned: 0.9 }],
    first.people,
  );
  expect(third.assignment.get("f3")).toBe(first.people[0].id);
});
it("a person keeps their name while their centre keeps learning", () => {
  const named = {
    id: "p1",
    name: "Camille",
    centre: faceSignature(makeFace(41))!,
    samples: 4,
  };
  const merged = mergeInto(named, {
    id: "m",
    signature: faceSignature(makeFace(41, 0.8))!,
  });
  expect(merged.name).toBe("Camille");
  expect(merged.samples).toBe(5);
  const { people } = clusterFaces(
    [{ id: "x", signature: faceSignature(makeFace(41))! }],
    [named],
  );
  expect(people[0].name).toBe("Camille");
});
it("a face is only matched to a person when it is close enough", () => {
  const people = [
    { id: "p1", centre: faceSignature(makeFace(51))!, samples: 2 },
  ];
  const face = (seed: number) => ({
    id: "f",
    signature: faceSignature(makeFace(seed))!,
  });
  expect(nearestPerson(face(51), people)?.id).toBe("p1");
  expect(nearestPerson(face(91), people)).toBeUndefined();
  expect(nearestPerson(face(51), [])).toBeUndefined();
});
import {
  SAME_FACE,
  descriptorDistance,
  personDistance,
} from "../src/modules/people";
/** A 128-value descriptor, as the local network produces. */
const descriptor = (seed: number, drift = 0) =>
  Array.from(
    { length: 128 },
    (_, i) => Math.sin(i * 0.3 + seed) + drift * Math.cos(i),
  );
it("descriptor distance is euclidean, bounded and safe", () => {
  const a = descriptor(1);
  expect(descriptorDistance(a, a)).toBe(0);
  expect(descriptorDistance(a, descriptor(9))).toBeGreaterThan(SAME_FACE);
  // Mismatched or empty input must never look like a match.
  expect(descriptorDistance(a, [1, 2])).toBe(Infinity);
  expect(descriptorDistance([], [])).toBe(Infinity);
});
it("the network descriptor decides over the geometry when both exist", () => {
  // Geometry says these are the same face; the descriptor says they are not.
  const shared = faceSignature(makeFace(5))!;
  const person = {
    id: "p",
    centre: shared,
    descriptor: descriptor(1),
    samples: 3,
  };
  const other = { id: "f", signature: shared, descriptor: descriptor(40) };
  const read = personDistance(person, other);
  expect(read.threshold).toBe(SAME_FACE);
  expect(read.value).toBeGreaterThan(SAME_FACE);
  expect(nearestPerson(other, [person])).toBeUndefined();
  // The same person, read twice with a slight drift, still matches.
  const again = { id: "g", signature: shared, descriptor: descriptor(1, 0.01) };
  expect(nearestPerson(again, [person])?.id).toBe("p");
});
it("geometry still works when the model produced nothing", () => {
  const signature = faceSignature(makeFace(7))!;
  const person = { id: "p", centre: signature, samples: 1 };
  expect(nearestPerson({ id: "f", signature }, [person])?.id).toBe("p");
  // A person with no reading at all can never be matched.
  expect(
    nearestPerson({ id: "f", signature }, [
      { id: "empty", centre: [], samples: 0 },
    ]),
  ).toBeUndefined();
});
it("a person learns both readings as photos come in", () => {
  const first = clusterFaces([
    {
      id: "a",
      signature: faceSignature(makeFace(11))!,
      descriptor: descriptor(2),
    },
  ]);
  expect(first.people[0].descriptor).toHaveLength(128);
  const second = clusterFaces(
    [
      {
        id: "b",
        signature: faceSignature(makeFace(11))!,
        descriptor: descriptor(2, 0.02),
      },
    ],
    first.people,
  );
  expect(second.people).toHaveLength(1);
  expect(second.people[0].samples).toBe(2);
  // A descriptor that disagrees opens a second identity, geometry or not.
  const third = clusterFaces(
    [
      {
        id: "c",
        signature: faceSignature(makeFace(11))!,
        descriptor: descriptor(60),
      },
    ],
    second.people,
  );
  expect(third.people).toHaveLength(2);
});
import {
  MAX_FACES_PER_PHOTO,
  MIN_FACE_WEIGHT,
  facesWorthDescribing,
} from "../src/modules/face-embed";
it("only faces that can carry an identity are sent to the network", () => {
  // 127 ms per face on the GPU: describing every guest of a wedding costs hours.
  const reads = [
    { weight: 0.3 },
    { weight: 0.0005 },
    { weight: 0.12 },
    { weight: 0.05 },
    { weight: 0.02 },
    { weight: 0.01 },
  ];
  const kept = facesWorthDescribing(reads);
  expect(kept).toHaveLength(MAX_FACES_PER_PHOTO);
  // Sorted by size, and the speck in the background is dropped entirely.
  expect(kept.map((k) => k.read.weight)).toEqual([0.3, 0.12, 0.05, 0.02]);
  expect(kept.every((k) => k.read.weight >= MIN_FACE_WEIGHT)).toBe(true);
  // The original position is preserved, so descriptors land on the right face.
  expect(kept[0].index).toBe(0);
  expect(kept[1].index).toBe(2);
  expect(facesWorthDescribing([{ weight: 0.0001 }])).toHaveLength(0);
  expect(facesWorthDescribing([])).toHaveLength(0);
});
