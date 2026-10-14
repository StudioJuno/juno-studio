import type { Analysis, CropRect, FaceRead } from "../model";
/**
 * Photo quality, expressed the way a photographer judges it: the subject first,
 * the frame second. Every number here is comparable between two photos of the
 * same burst, and every decision comes back as a sentence the user can read.
 */
export const ANALYSIS_WIDTH = 1024;
/**
 * Sharpness scales with the width it was measured at, so an old analysis made
 * on a 128 px thumbnail has to be redone. A photo smaller than the target is
 * already measured as finely as it can be: asking for more would re-analyse it
 * on every pass, forever.
 */
export function comparableSharpness(
  a: Analysis | undefined,
  photoWidth = ANALYSIS_WIDTH,
  photoHeight?: number,
) {
  if (!a?.sharpnessWidth) return false;
  // L'analyse réduit le GRAND côté à 1 024 px : une photo verticale y fait
  // 683 px de large. Comparée à 1 024, elle n'était jamais « comparable » et
  // chaque passe redécodait toutes les photos verticales.
  if (photoHeight && photoHeight > photoWidth) {
    const attendu = Math.round(
      (Math.min(ANALYSIS_WIDTH, photoHeight) * photoWidth) / photoHeight,
    );
    return a.sharpnessWidth >= attendu - 1;
  }
  return a.sharpnessWidth >= Math.min(ANALYSIS_WIDTH, photoWidth);
}
/** Laplacian variance inside a region of a grayscale plane. */
export function regionSharpness(
  gray: Float32Array | Uint8ClampedArray,
  width: number,
  height: number,
  region?: CropRect,
) {
  const x0 = Math.max(1, Math.floor((region?.x ?? 0) * width)),
    y0 = Math.max(1, Math.floor((region?.y ?? 0) * height)),
    x1 = Math.min(
      width - 1,
      Math.ceil(((region?.x ?? 0) + (region?.w ?? 1)) * width),
    ),
    y1 = Math.min(
      height - 1,
      Math.ceil(((region?.y ?? 0) + (region?.h ?? 1)) * height),
    );
  let sum = 0,
    square = 0,
    n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * width + x,
        v =
          4 * gray[i] -
          gray[i - 1] -
          gray[i + 1] -
          gray[i - width] -
          gray[i + width];
      sum += v;
      square += v * v;
      n++;
    }
  return n ? square / n - (sum / n) ** 2 : 0;
}
/**
 * The subject: a named person when the photographer pointed one out, the
 * largest face otherwise. Naming the couple changes every later decision.
 */
export function subjectRead(
  faces: FaceRead[] | undefined,
  priority: string[] = [],
) {
  if (!faces?.length) return undefined;
  const wanted = priority.length
    ? faces.filter((f) => f.personId && priority.includes(f.personId))
    : [];
  const pool = wanted.length ? wanted : faces;
  return [...pool].sort((a, b) => b.weight - a.weight)[0];
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/**
 * Le poids de chaque visage dans les signaux de personnes.
 *
 * C'est sa surface rapportée à celle du plus grand visage de la photo. Le
 * poids était la part du cadre occupée, avec un plancher de 0,02 : sur un plan
 * moyen, tous les visages touchaient le plancher et pesaient autant, si bien
 * que le clignement d'un invité du fond comptait comme celui de la mariée.
 * La lecture par morceaux trouvant six fois plus de visages, ce défaut serait
 * devenu la règle. Rapporté au plus grand, le poids ne dépend plus ni du
 * cadrage ni de la résolution d'analyse.
 */
export function poidsVisages(faces: FaceRead[]): number[] {
  const largeur = (f: FaceRead) => f.region?.w || Math.sqrt(Math.max(0, f.weight));
  const plusLarge = Math.max(1e-6, ...faces.map(largeur));
  return faces.map((f) => Math.max(0.01, (largeur(f) / plusLarge) ** 2));
}
/** Sharpness that decides: the subject's face when there is one. */
export function decisiveSharpness(a: Analysis, priority: string[] = []) {
  const subject = subjectRead(a.faces?.reads, priority);
  return Math.max(0, subject ? subject.sharpness : a.sharpness);
}
/** Everything except sharpness: exposure, clipping and the people in frame. */
export function contextScore(a: Analysis, priority: string[] = []) {
  const faces = a.faces?.reads;
  const exposure =
    a.brightness < 0.08 || a.brightness > 0.94
      ? -25
      : a.brightness < 0.16 || a.brightness > 0.86
        ? -8
        : 0;
  const clipping = -Math.min(20, a.clipped * 120);
  let people = 0;
  if (faces?.length) {
    // Each signal is weighted by how much of the frame the face occupies, so a
    // guest blinking in the background never outweighs the subject.
    let closed = 0,
      smiling = 0,
      turned = 0,
      total = 0;
    const poids = poidsVisages(faces);
    for (const [i, f] of faces.entries()) {
      // A named person weighs as much as the main face, wherever they stand.
      const named = !!f.personId && priority.includes(f.personId);
      const w = named ? 1 : poids[i];
      closed += f.eyesClosed * w;
      smiling += f.smile * w;
      turned += f.turned * w;
      total += w;
    }
    if (total > 0)
      people =
        -30 * clamp01(closed / total) +
        10 * clamp01(smiling / total) -
        8 * clamp01(turned / total);
    // A frame missing the people who matter loses ground to one that has them.
    if (
      priority.length &&
      !faces.some((f) => f.personId && priority.includes(f.personId))
    )
      people -= 12;
  } else if (a.faces?.count) {
    // Catalogues analysed before per-face reads existed still carry a count of
    // closed eyes: honour it rather than scoring those photos blind.
    people = -30 * clamp01(a.faces.closedEyes / Math.max(1, a.faces.count));
  }
  return exposure + clipping + people;
}
/** 0 to 100, where 100 is a sharp, well exposed subject looking at the lens. */
export function qualityScore(a: Analysis) {
  const faces = a.faces?.reads,
    subject = subjectRead(faces);
  // Sharpness of the subject when a face is present, of the frame otherwise.
  const sharp = subject ? subject.sharpness : a.sharpness;
  const sharpScore = Math.min(60, Math.log2(1 + Math.max(0, sharp)) * 6);
  // Exposure: only real failures cost points, a chosen dark frame does not.
  const exposure =
    a.brightness < 0.08 || a.brightness > 0.94
      ? -25
      : a.brightness < 0.16 || a.brightness > 0.86
        ? -8
        : 0;
  const clipping = -Math.min(20, a.clipped * 120);
  let people = 0;
  if (faces?.length) {
    // Each signal is weighted by how much of the frame the face occupies, so a
    // guest blinking in the background never outweighs the subject.
    let closed = 0,
      smiling = 0,
      turned = 0,
      total = 0;
    const poids = poidsVisages(faces);
    for (const [i, f] of faces.entries()) {
      const w = poids[i];
      closed += f.eyesClosed * w;
      smiling += f.smile * w;
      turned += f.turned * w;
      total += w;
    }
    if (total > 0) {
      closed /= total;
      smiling /= total;
      turned /= total;
      people =
        -30 * clamp01(closed) + 10 * clamp01(smiling) - 8 * clamp01(turned);
    }
  } else if (a.faces?.count) {
    people = -30 * clamp01(a.faces.closedEyes / Math.max(1, a.faces.count));
  }
  return Math.round(
    Math.max(0, Math.min(100, 40 + sharpScore + exposure + clipping + people)),
  );
}
/**
 * Les seuils de `nettete`, mesurés le 28/09/2026 sur l'album Audrey-Ann et
 * Clément : 189 visages jugés à l'œil par trois juges, puis 154 visages de
 * l'album jugés en aveugle autour du seuil.
 * - Sous 0,262 : 81 flous, 0 net. Le visage est flou.
 * - De 0,262 à 0,27 : 9 flous, 12 nets, un pile ou face. À vérifier.
 * - Au-dessus de 0,27 : 34 nets, 0 flou ; aucun des 110 visages nets jugés à
 *   l'œil n'est en dessous.
 * Le 5e centile des visages nets est à 0,275 : ne pas monter ces seuils.
 */
export const NETTETE_FLOU = 0.262;
export const NETTETE_DOUTE = 0.27;
/**
 * Le visage principal est-il flou ? `undefined` quand la mesure manque (analyse
 * d'avant la 1.2.1, vignette de secours, bande des yeux sans bord).
 *
 * Un invité flou au premier plan ne condamne pas la photo : sans personne
 * désignée, si un autre visage au moins moitié moins large est net, c'est
 * sans doute sur lui que le photographe a fait le point. Vérifié à l'œil sur
 * 9 photos livrées signalées : 8 fois un invité flou devant un sujet net.
 */
export function jugementNettete(
  faces: FaceRead[] | undefined,
  priority: string[] = [],
): "flou" | "doute" | "net" | undefined {
  const subject = subjectRead(faces, priority);
  const v = subject?.nettete;
  if (!subject || v === undefined) return undefined;
  if (v >= NETTETE_DOUTE) return "net";
  const designe = priority.length && subject.personId && priority.includes(subject.personId);
  if (
    !designe &&
    faces!.some(
      (f) =>
        f !== subject &&
        f.nettete !== undefined &&
        f.nettete >= NETTETE_DOUTE &&
        (f.region?.w || 0) >= 0.5 * (subject.region?.w || 0),
    )
  )
    return "net";
  return v < NETTETE_FLOU ? "flou" : "doute";
}
/**
 * Le jugement que verdict et raisons partagent : la nouvelle mesure quand elle
 * existe, sinon l'ancienne, qui ne reconnaît que les flous extrêmes (analyses
 * d'avant la 1.2.1, petite source, vignette, bande des yeux sans bord).
 */
export function jugementVisage(
  a: Analysis,
  priority: string[] = [],
): "flou" | "doute" | "net" | undefined {
  const j = jugementNettete(a.faces?.reads, priority);
  if (j !== undefined) return j;
  const subject = subjectRead(a.faces?.reads, priority);
  return subject && subject.sharpness < 12 ? "flou" : undefined;
}
export const PEU_DE_DETAILS = "Peu de détails : vérifier la netteté";
export const RAISON_SOMBRE = "Image très sombre";
export const RAISON_LUMIERES = "Hautes lumières à vérifier";
/**
 * L'image entière manque-t-elle de détails ? Mesure globale : un portrait net
 * sur fond flou en a peu, d'où l'avis du visage qui l'emporte quand il est
 * mesuré (voir `raisonsVisage` dans culling.ts).
 */
// Threshold calibrated at 1024 px on real photographs: sharp frames measure
// 550 and above, a clearly blurred one falls near 65.
//
// Depuis le 29/09/2026, jugée sur la case la plus nette d'une grille de 8 × 8
// (`pointe`) plutôt que sur la moyenne de l'image : un gros plan de mains ou
// d'alliances, net là où il faut, était signalé à cause de son fond flou.
// Sur l'album de mesure, les 5 photos du matin dont la meilleure case reste
// sous 150 sont floues partout à 100 % ; au-dessus, la case la plus nette
// montre peau, tissu ou bijou nets. Seuil voisin (50 à 150) : même résultat.
// Limite : un sujet bougé devant un fond net passe (1 cas sur 15 regardés).
// Sans `pointe` (analyse d'avant le 29/09/2026), l'ancienne règle.
export function peuDeDetails(sharpness: number, width: number, pointe?: number) {
  return width >= 512 ? (pointe ?? sharpness) < 150 : sharpness < 65;
}
/** Sous ce seuil, l'image est « très sombre » : aligné sur « presque noire ». */
export const TRES_SOMBRE = 0.08;
/** Au-dessus, l'image est brûlée. */
export const BRULEE = 0.94;
/** Part du cœur d'un visage compté en blanc pur au-delà de laquelle il est brûlé. */
export const VISAGE_ECRETE = 0.1;
/** Garde-fou sans visage lu : plus de la moitié de l'image en blanc pur. */
export const ECRETAGE_GLOBAL = 0.5;
/**
 * Des hautes lumières à vérifier ? Mesuré le 29/09/2026 sur l'album Audrey-Ann
 * et Clément : l'ancienne règle (luminosité > 0,86 ou 22 % de l'image en blanc
 * pur) signalait 51 meilleures images de rafale, dont 49 pour du ciel ou un
 * fond blanc, que le RAW récupère ; une seule avait un visage brûlé. On juge
 * donc le cœur des visages comptés (au moins 40 % de la largeur du plus grand,
 * comme pour les yeux) : 0,10 est la première valeur ronde au-dessus du
 * visage le plus écrêté du matin (0,076, de simples reflets vus à 100 %).
 * Limite connue : un vêtement blanc brûlé au soleil n'est plus signalé tant
 * que le visage est intact ; seul le garde-fou global le rattrape.
 */
export function hautesLumieres(a: Analysis) {
  if (a.brightness > BRULEE || a.clipped > ECRETAGE_GLOBAL) return true;
  const reads = a.faces?.reads || [];
  const plusLarge = Math.max(0, ...reads.map((f) => f.region?.w || 0));
  return reads.some(
    (f) => (f.region?.w || 0) >= 0.4 * plusLarge && (f.ecrete ?? 0) > VISAGE_ECRETE,
  );
}
/** Le seuil des yeux fermés du visage principal, que verdict et raisons partagent. */
export const YEUX_FERMES = 0.6;
/** The sentence shown next to a photo: one cause, the one that decided. */
export function verdictFor(a: Analysis, priority: string[] = []): string {
  const subject = subjectRead(a.faces?.reads, priority);
  if (
    priority.length &&
    a.faces?.reads?.length &&
    !a.faces.reads.some((f) => f.personId && priority.includes(f.personId))
  )
    return "Les personnes suivies ne sont pas sur cette image.";
  if (subject && subject.eyesClosed > YEUX_FERMES)
    return "Yeux fermés sur le visage principal.";
  if (!a.faces?.reads?.length && a.faces?.closedEyes)
    return `Yeux fermés · ${a.faces.closedEyes} visage(s).`;
  if (a.brightness < 0.08) return "Image presque noire.";
  if (a.brightness > 0.94) return "Image brûlée.";
  if (hautesLumieres(a)) return "Hautes lumières à vérifier.";
  const nettete = jugementVisage(a, priority);
  if (nettete === "flou") return "Visage principal flou.";
  if (nettete === "doute") return "Visage peut-être flou : à vérifier à 100 %.";
  // Même mesure que la raison « Peu de détails » : l'une ne dit plus « nette »
  // quand l'autre dit le contraire (48 photos de l'album de mesure).
  const peu = peuDeDetails(a.sharpness, a.sharpnessWidth ?? 0, a.nettetePointe);
  if (!subject && peu) return "Peu de détails : netteté à vérifier.";
  if (subject && subject.turned > 0.75) return "Visage de profil.";
  if (subject && nettete === undefined && peu)
    return "Netteté du visage à vérifier.";
  if (subject && subject.smile > 0.5) return "Visage net et souriant.";
  if (subject) return "Visage net, yeux ouverts.";
  return "Image nette.";
}
// Les rafales et le choix de leur meilleure image : src/modules/rafales.ts.
