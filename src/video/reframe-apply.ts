/**
 * Poser un cadrage sur un plan.
 *
 * Rien n'est inventé ici : on remplit `scale`, `x` et `y`, qui existent déjà,
 * et les images clés de position quand le sujet se déplace. Le zoom ne bouge
 * jamais pendant un plan, seulement la position : un zoom qui respire se voit
 * tout de suite et fait amateur.
 */
import { IMAGES_CLES_MAX, LIMITES, type Resultat } from "./reframe";
import type { Clip } from "./types";
import type { Keyframe } from "./animation";
const brider = (v: number, [bas, haut]: readonly [number, number]) =>
  Math.min(haut, Math.max(bas, v));
/**
 * Les secondes du relevé sont comptées dans le média ; les images clés, elles,
 * se comptent en images de la séquence depuis le début du plan. Un plan ralenti
 * ou accéléré ne convertit donc pas au même rythme.
 */
export function imagesCles(
  suivi: { seconde: number; x: number; y: number }[],
  clip: Pick<Clip, "duration" | "speed">,
  fps: number,
): { x: Keyframe[]; y: Keyframe[] } | undefined {
  const dernier = Math.max(0, Math.round(clip.duration) - 1);
  const points: { frame: number; x: number; y: number }[] = [];
  for (const p of suivi) {
    const frame = Math.min(
      dernier,
      Math.max(0, Math.round((p.seconde / Math.max(0.01, clip.speed)) * fps)),
    );
    // Deux relevés qui retombent sur la même image : le modèle exige des
    // images clés strictement croissantes, on garde le premier.
    if (points.length && points.at(-1)!.frame >= frame) continue;
    points.push({
      frame,
      x: brider(p.x, LIMITES.position),
      y: brider(p.y, LIMITES.position),
    });
  }
  if (points.length < 2) return undefined;
  const taille = Math.min(IMAGES_CLES_MAX, points.length);
  const garde = points.slice(0, taille);
  const cle = (champ: "x" | "y"): Keyframe[] =>
    garde.map((p) => ({ frame: p.frame, value: p[champ], easing: "smooth" }));
  return { x: cle("x"), y: cle("y") };
}
/**
 * Le plan recadré.
 *
 * Les autres animations du plan sont conservées ; seules la position
 * horizontale et verticale sont réécrites, parce que ce sont elles que le
 * recadrage pilote.
 */
export function appliquerCadrage(
  clip: Clip,
  resultat: Resultat,
  fps: number,
): Clip {
  const suivant: Clip = {
    ...clip,
    scale: brider(resultat.scale, LIMITES.zoom),
    x: brider(resultat.x, LIMITES.position),
    y: brider(resultat.y, LIMITES.position),
  };
  const cles = resultat.suivi
    ? imagesCles(resultat.suivi, clip, fps)
    : undefined;
  const reste = { ...clip.animation };
  delete reste.x;
  delete reste.y;
  const animation = cles ? { ...reste, ...cles } : reste;
  if (Object.keys(animation).length) suivant.animation = animation;
  else delete suivant.animation;
  return suivant;
}
