/**
 * Relever les visages sur quelques images d'un plan.
 *
 * On n'analyse pas tout le plan : à vingt-cinq images par seconde, ce serait
 * long pour rien. Quelques relevés bien répartis suffisent à savoir où sont
 * les gens et s'ils se déplacent, et le lissage fait le reste.
 *
 * Tout se passe ici plutôt que dans le processus natif parce que c'est ici que
 * vivent déjà le modèle de visages et le bassin de travailleurs. Rien ne sort
 * de cet ordinateur.
 */
import { analyzeFacesOn } from "../modules/culling";
import type { Echantillon } from "./reframe";
/**
 * La taille à laquelle l'image est confiée au travailleur, qui la relit
 * ensuite par morceaux à cette même taille. Au-delà, le détecteur ne gagne
 * plus rien et chaque morceau coûte plus cher.
 */
export const LARGEUR_ANALYSE = 1280;
/** Assez de relevés pour voir un déplacement, assez peu pour rester rapide. */
export const RELEVES = 8;
function pret(video: HTMLVideoElement, evenement: string, delai = 20000) {
  return new Promise<void>((resolve, reject) => {
    const fini = () => {
      clearTimeout(timer);
      video.removeEventListener(evenement, ok);
      video.removeEventListener("error", ko);
    };
    const ok = () => {
      fini();
      resolve();
    };
    const ko = () => {
      fini();
      reject(Error("Ce plan n’a pas pu être relu pour le recadrage."));
    };
    const timer = setTimeout(ko, delai);
    video.addEventListener(evenement, ok, { once: true });
    video.addEventListener("error", ko, { once: true });
  });
}
/**
 * Chercher les visages sur l'image entière puis par morceaux.
 *
 * Sur l'image entière seule, le détecteur ne voyait aucun visage dans un plan
 * moyen : il est fait pour les portraits rapprochés. Le découpage se fait
 * dans le travailleur (`public/face-tiles.js`), qui ramène chaque visage dans
 * le repère de l'image entière.
 */
async function visagesParTuiles(
  video: HTMLVideoElement,
  source: { w: number; h: number },
) {
  const image = await createImageBitmap(video, {
    resizeWidth: Math.min(LARGEUR_ANALYSE, source.w),
    resizeQuality: "high",
  });
  return (await analyzeFacesOn(image, { tuiles: true })).regions || [];
}
export type Releve = {
  echantillons: Echantillon[];
  source: { w: number; h: number };
};
/**
 * @param url      le média, tel que l'aperçu le lit déjà
 * @param depart   début du plan dans la source, en secondes
 * @param duree    durée du plan dans la source, en secondes
 */
export async function releverVisages(
  url: string,
  depart: number,
  duree: number,
  releves = RELEVES,
  signal?: AbortSignal,
): Promise<Releve> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await pret(video, "loadedmetadata");
    const source = { w: video.videoWidth, h: video.videoHeight };
    if (!source.w || !source.h) throw Error("Taille du plan inconnue.");
    const fin = Math.max(0, (video.duration || duree) - 0.05);
    const echantillons: Echantillon[] = [];
    for (let i = 0; i < releves; i++) {
      if (signal?.aborted) break;
      // Viser le milieu de chaque tranche : les bords d'un plan sont souvent
      // une transition ou une image sale.
      const instant = Math.min(fin, depart + (duree * (i + 0.5)) / releves);
      video.currentTime = instant;
      await pret(video, "seeked");
      echantillons.push({
        seconde: instant - depart,
        visages: await visagesParTuiles(video, source),
      });
    }
    return { echantillons, source };
  } finally {
    // Sans cela, le média reste chargé et le fichier verrouillé.
    video.removeAttribute("src");
    video.load();
  }
}
