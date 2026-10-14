/**
 * Recognising people without shipping another model: MediaPipe already returns
 * 468 landmarks per face, and the distances between them describe a face's
 * geometry. Normalised for size and roll, they identify someone well enough to
 * say "the couple" inside one album. It is geometry, not appearance: two very
 * similar faces can be confused, and a strong profile degrades the reading.
 */
export type FaceSignature = number[];
export type Person = {
  id: string;
  name?: string;
  /** Running mean of the signatures assigned to this person. */
  centre: FaceSignature;
  /** Running mean of the network descriptors, when the model was available. */
  descriptor?: number[];
  samples: number;
};
/** A face as the clustering sees it: the descriptor decides when it exists. */
export type FaceInput = {
  id: string;
  signature?: FaceSignature;
  descriptor?: number[];
  turned?: number;
};
/**
 * Distance between a face and a person, using whichever reading both share.
 * The network descriptor wins: it identifies a person, where geometry only
 * describes the shape of a face.
 */
export function personDistance(person: Person, face: FaceInput) {
  if (person.descriptor?.length && face.descriptor?.length)
    return {
      value: descriptorDistance(person.descriptor, face.descriptor),
      threshold: SAME_FACE,
    };
  if (person.centre?.length && face.signature?.length)
    return {
      value: signatureDistance(person.centre, face.signature),
      threshold: SAME_PERSON,
    };
  return { value: Infinity, threshold: 0 };
}
/** Landmark indices that stay put on a face, whatever the expression. */
export const ANCHORS = [
  33, 133, 362, 263, 1, 4, 61, 291, 199, 168, 234, 454, 10, 152, 145, 374, 13,
  14, 78, 308,
];
export const SIGNATURE_LENGTH = (ANCHORS.length * (ANCHORS.length - 1)) / 2;
/**
 * Pairwise distances between the anchors, divided by the eye to eye distance
 * so a face close to the lens and the same face far away read the same.
 */
export function faceSignature(
  points: { x: number; y: number; z?: number }[],
): FaceSignature | undefined {
  if (!points || points.length < 468) return undefined;
  const anchors = ANCHORS.map((i) => points[i]);
  if (anchors.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return undefined;
  // Scale reference: the distance between the outer eye corners.
  const left = points[33],
    right = points[263];
  const scale = Math.hypot(right.x - left.x, right.y - left.y);
  if (!(scale > 1e-6)) return undefined;
  const signature: number[] = [];
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++)
      signature.push(
        Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y) /
          scale,
      );
  return signature;
}
/**
 * Euclidean distance between two face descriptors, the measure the network was
 * trained for. Below 0,6 the two faces are the same person, which is the
 * threshold dlib and face-api publish for this model.
 */
export const SAME_FACE = 0.6;
export function descriptorDistance(a: number[], b: number[]) {
  if (!a?.length || a.length !== b?.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}
/** Cosine distance, 0 for identical shapes and 1 for unrelated ones. */
export function signatureDistance(a: FaceSignature, b: FaceSignature) {
  if (!a?.length || a.length !== b?.length) return 1;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na <= 0 || nb <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - dot / Math.sqrt(na * nb)));
}
/** Above this distance two faces are treated as two different people. */
export const SAME_PERSON = 0.004;
/** Faces too turned away are not used to build an identity. */
export const MAX_TURNED = 0.6;
export function mergeInto(person: Person, face: FaceInput): Person {
  const n = person.samples + 1;
  const centre =
    face.signature?.length && person.centre?.length
      ? person.centre.map((v, i) => v + (face.signature![i] - v) / n)
      : person.centre;
  const descriptor = face.descriptor?.length
    ? person.descriptor?.length
      ? person.descriptor.map((v, i) => v + (face.descriptor![i] - v) / n)
      : [...face.descriptor]
    : person.descriptor;
  return { ...person, centre, descriptor, samples: n };
}
/**
 * Cluster the faces of an album. Order matters as little as possible: each
 * face joins its closest person when close enough, and opens a new one
 * otherwise. Named people keep their name through the merge.
 */
export function clusterFaces(faces: FaceInput[], existing: Person[] = []) {
  const people: Person[] = existing.map((p) => ({
    ...p,
    centre: [...(p.centre ?? [])],
    descriptor: p.descriptor ? [...p.descriptor] : undefined,
  }));
  const assignment = new Map<string, string>();
  for (const face of faces) {
    if (!face.signature?.length && !face.descriptor?.length) continue;
    // A profile shot describes the pose more than the person: never let it
    // create an identity, though it may still join an established one.
    const turnedAway = (face.turned ?? 0) > MAX_TURNED;
    let best: Person | undefined,
      bestScore = Infinity,
      bestThreshold = 0;
    for (const person of people) {
      const { value, threshold } = personDistance(person, face);
      // Compare how far each candidate sits relative to its own threshold, so
      // a descriptor match and a geometric match stay comparable.
      const score = threshold > 0 ? value / threshold : Infinity;
      if (score < bestScore) {
        bestScore = score;
        bestThreshold = threshold;
        best = person;
      }
    }
    if (best && bestThreshold > 0 && bestScore <= 1) {
      const merged = mergeInto(best, face);
      people[people.indexOf(best)] = merged;
      assignment.set(face.id, merged.id);
    } else if (!turnedAway) {
      const person: Person = {
        id: "person-" + (people.length + 1) + "-" + face.id.slice(0, 8),
        centre: [...(face.signature ?? [])],
        descriptor: face.descriptor ? [...face.descriptor] : undefined,
        samples: 1,
      };
      people.push(person);
      assignment.set(face.id, person.id);
    }
  }
  return { people, assignment };
}
/** People sorted by how often they appear: the couple leads a wedding album. */
export function rankPeople(people: Person[]) {
  return [...people].sort((a, b) => b.samples - a.samples);
}
export function nearestPerson(face: FaceInput, people: Person[]) {
  let best: Person | undefined,
    bestScore = Infinity;
  for (const person of people) {
    const { value, threshold } = personDistance(person, face);
    const score = threshold > 0 ? value / threshold : Infinity;
    if (score < bestScore) {
      bestScore = score;
      best = person;
    }
  }
  return best && bestScore <= 1 ? best : undefined;
}
