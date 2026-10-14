import { it, expect } from "vitest";
import {
  similarity,
  rank,
  classifyMoment,
  MOMENTS,
  type Indexed,
} from "../src/modules/semantic";
const norm = (v: number[]) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
it("la proximité de deux vecteurs est sûre sur des entrées bancales", () => {
  const a = norm([1, 0, 0]);
  expect(similarity(a, a)).toBeCloseTo(1, 6);
  expect(similarity(a, norm([0, 1, 0]))).toBeCloseTo(0, 6);
  expect(similarity(a, norm([-1, 0, 0]))).toBeCloseTo(-1, 6);
  // Une longueur qui ne correspond pas ne doit jamais ressembler à un accord.
  expect(similarity(a, [1, 0])).toBe(-1);
  expect(similarity([], [])).toBe(-1);
  expect(similarity(a, undefined as unknown as number[])).toBe(-1);
});
const index: Indexed[] = [
  { id: "gateau", vector: norm([1, 0, 0]) },
  { id: "danse", vector: norm([0, 1, 0]) },
  { id: "eglise", vector: norm([0, 0, 1]) },
  { id: "presque-gateau", vector: norm([0.9, 0.1, 0]) },
];
it("une recherche classe du plus proche au plus loin", () => {
  const r = rank(norm([1, 0, 0]), index);
  expect(r[0].id).toBe("gateau");
  expect(r[1].id).toBe("presque-gateau");
  expect(r[0].score).toBeGreaterThan(r[1].score);
});
it("ce qui n'a rien à voir est écarté, pas classé dernier", () => {
  // Sans seuil, une recherche renvoie toujours l'album entier.
  const r = rank(norm([1, 0, 0]), index);
  expect(r.map((x) => x.id)).not.toContain("eglise");
  expect(r.map((x) => x.id)).not.toContain("danse");
  // Le seuil est réglable, et un seuil nul rend bien tout ce qui est positif.
  expect(rank(norm([1, 0, 0]), index, { minimum: -1 })).toHaveLength(4);
  expect(rank([], index)).toEqual([]);
});
it("le nombre de résultats est borné", () => {
  const gros: Indexed[] = Array.from({ length: 500 }, (_, i) => ({
    id: "p" + i,
    vector: norm([1, i / 1000, 0]),
  }));
  expect(rank(norm([1, 0, 0]), gros, { limit: 50 })).toHaveLength(50);
});
const moments = Object.fromEntries(
  MOMENTS.map((m, i) => [
    m.id,
    norm(Array.from({ length: MOMENTS.length }, (_, j) => (i === j ? 1 : 0))),
  ]),
);
it("un moment n'est proposé que s'il se détache", () => {
  const gateau = moments.gateau;
  expect(classifyMoment(gateau, moments)?.moment).toBe("gateau");
  // Une photo à mi-chemin entre deux moments n'appartient à aucun.
  const entreDeux = norm(
    moments.gateau.map((v, i) => v + moments.repas[i]),
  );
  expect(classifyMoment(entreDeux, moments)).toBeUndefined();
  // Et une photo qui ne ressemble à rien non plus.
  expect(classifyMoment([0, 0, 0, 0, 0, 0, 0, 0, 0], moments)).toBeUndefined();
});
it("les moments couvrent la journée sans doublon", () => {
  const ids = MOMENTS.map((m) => m.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const m of MOMENTS) {
    expect(m.label.length).toBeGreaterThan(2);
    // La phrase est ce qui part dans le modèle : elle doit décrire une scène.
    expect(m.phrase.split(" ").length).toBeGreaterThan(3);
  }
});
import { semanticStats, semanticAvailable } from "../src/modules/semantic";
it("l'état de la recherche est lisible sans avoir à deviner", () => {
  // Le premier appel charge 378 Mo : lui donner le délai d'une image ordinaire
  // faisait échouer toute l'indexation d'un album, sans erreur visible.
  expect(semanticAvailable()).toBe(true);
  expect(semanticStats.calls).toBe(0);
  expect(semanticStats.embedded).toBe(0);
});
