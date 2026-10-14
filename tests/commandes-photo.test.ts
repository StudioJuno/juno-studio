import { it, expect } from "vitest";
import { parsePrompt, PHOTO_FIELDS } from "../src/assistant/commands";
const compris = (phrase: string) => {
  try {
    return parsePrompt(phrase, "photo").actions.length > 0;
  } catch {
    return false;
  }
};
it("tout nom de réglage annoncé est réellement accepté", () => {
  // Le défaut trouvé le 26/09/2026 : la liste des noms qui identifient un
  // réglage et celle qui autorise un début de phrase étaient recopiées à la
  // main, et avaient divergé. « débruitage », « luminosité » et
  // « température » étaient annoncés comme synonymes et refusés à l'usage.
  const refuses: string[] = [];
  for (const [champ, f] of Object.entries(PHOTO_FIELDS))
    for (const nom of f.names.split("|")) {
      const valeur = f.min < 0 ? 10 : 30;
      if (!compris(`${nom} ${valeur}`)) refuses.push(`${champ} · ${nom}`);
    }
  expect(refuses).toEqual([]);
});
it("les verbes qu'on emploie en parlant sont compris", () => {
  // Chaque tournure refusée ici réveille le modèle de langue de deux
  // giga-octets, ce qui prend plusieurs secondes pour rien.
  for (const verbe of [
    "regle",
    "mets",
    "fixe",
    "augmente",
    "monte",
    "remonte",
    "baisse",
    "abaisse",
    "descends",
    "diminue",
    "reduit",
  ])
    expect(compris(`${verbe} l'exposition de 0.5`)).toBe(true);
});
it("les deux contrôles successifs ne se contredisent jamais", () => {
  // Le second symptôme du même défaut : une tournure acceptée par le premier
  // contrôle puis refusée par le suivant, avec un message sans rapport.
  for (const phrase of [
    "monte les ombres de 15",
    "descends le contraste de 10",
    "abaisse la saturation de 20",
    "remonte la clarte de 5",
    "debruitage 30",
    "reduction du bruit 30",
    "luminosite 0.5",
    "temperature 10",
  ])
    expect(compris(phrase), phrase).toBe(true);
});
it("une consigne sans réglage ni valeur reste refusée", () => {
  // Le garde-fou doit rester serré : c'est lui qui évite d'appliquer une
  // consigne mal comprise à tout un album.
  for (const phrase of [
    "fais quelque chose",
    "augmente",
    "exposition",
    "rends la plus belle",
  ])
    expect(compris(phrase), phrase).toBe(false);
});
it("un réglage enchaîné sans verbe reprend celui qui le précède", () => {
  // « augmente l'exposition de 3 et le contraste de 10 » était refusée, et
  // la même phrase sans l'article passait avec le contraste à +10 en valeur
  // absolue. Le verbe repris donne aux deux la lecture attendue.
  expect(
    parsePrompt("augmente l'exposition de 3 et le contraste de 10", "photo")
      .actions,
  ).toEqual([
    { kind: "photo.adjust", field: "exposure", value: 3, relative: true },
    { kind: "photo.adjust", field: "contrast", value: 10, relative: true },
  ]);
});
it("« envoie le tri à Lightroom » ouvre la fenêtre d'envoi, sans rien écrire", () => {
  for (const t of ["envoie le tri à Lightroom", "exporte vers Lightroom Classic", "envoie les notes dans lightroom", "passe les photos à Lightroom"])
    expect(parsePrompt(t, "photo").actions, t).toEqual([{ kind: "lightroom.open" }]);
  // En vidéo, Lightroom n'a pas de sens : la consigne n'est pas reprise.
  expect(() => parsePrompt("envoie le tri à Lightroom", "video")).toThrow();
});
