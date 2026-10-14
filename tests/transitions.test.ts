import { it, expect } from "vitest";
import { createRequire } from "node:module";
import { TRANSITIONS } from "../src/video/types";
const native = createRequire(import.meta.url)(
  "../electron/video/transitions.cjs",
);
it("les deux catalogues de transitions ne peuvent pas diverger", () => {
  // L'interface envoie un identifiant que le moteur passe tel quel à FFmpeg.
  // Un nom présent d'un seul côté ferait échouer l'export à la toute fin.
  expect(TRANSITIONS.map((t) => t.id)).toEqual(
    native.CATALOGUE.map((t: { id: string }) => t.id),
  );
  expect(TRANSITIONS.map((t) => t.label)).toEqual(
    native.CATALOGUE.map((t: { label: string }) => t.label),
  );
});
it("chaque transition proposée est acceptée par la validation du moteur", () => {
  for (const t of TRANSITIONS)
    expect(() => native.validate({ kind: t.id, duration: 12 }, 100)).not.toThrow();
});
