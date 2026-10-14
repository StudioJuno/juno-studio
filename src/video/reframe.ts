/**
 * Recadrer un plan pour le format vertical, en gardant les visages dans l'image.
 *
 * Le problème : un plan 16/9 posé dans une séquence 1080×1920 est mis à
 * l'échelle avec `force_original_aspect_ratio=decrease`. Il en sort des bandes
 * noires et des mariés minuscules. Un teaser fabriqué comme ça n'est pas
 * publiable.
 *
 * Rien de neuf n'est nécessaire pour le réparer : un plan porte déjà `scale`,
 * `x` et `y`, la détection de visages est déjà embarquée, et le rendu applique
 * déjà ces valeurs. Il ne manquait que le calcul, qui est ici.
 *
 * Le repère, lu dans `electron/video/render.cjs` : le plan est mis à l'échelle
 * dans une boîte de `W*scale` sur `H*scale` à rapport conservé, puis posé au
 * centre avec un décalage de `x*W` et `y*H`. Donc `scale` zoome et `x`/`y`
 * déplacent le cadre. Le zoom reste fixe sur toute la durée du plan : c'est
 * `x` et `y` qui suivent, parce qu'un zoom qui bouge se voit et fait amateur.
 */
/** Une boîte de visage, en proportions de l'image source. */
export type Visage = { x: number; y: number; w: number; h: number };
/** Ce qu'on a relevé sur une image du plan. */
export type Echantillon = { seconde: number; visages: Visage[] };
export type Mode = "tous" | "couple";
/**
 * Ce que le modèle accepte, lu dans `electron/video/model.cjs`.
 *
 * Dépasser ces bornes ferait refuser l'enregistrement du plan : mieux vaut un
 * cadrage un peu moins serré qu'une séquence qu'on ne peut plus sauvegarder.
 */
export const LIMITES = { zoom: [0.05, 5] as const, position: [-2, 2] as const };
const brider = (v: number, [bas, haut]: readonly [number, number]) =>
  Math.min(haut, Math.max(bas, v));
export type Cadre = { scale: number; x: number; y: number };
export type Reglages = {
  /** Marge autour des visages, en proportion de leur taille. */
  marge: number;
  /** Air supplémentaire au-dessus des têtes, en proportion de leur hauteur. */
  airDessus: number;
  /** Nombre d'échantillons de la moyenne glissante qui lisse le mouvement. */
  lissage: number;
  /** En deçà de ce déplacement, le cadre reste fixe au lieu de suivre. */
  seuilMouvement: number;
};
/** Le modèle refuse au-delà : voir `validateAnimation` dans le natif. */
export const IMAGES_CLES_MAX = 32;
export const REGLAGES: Reglages = {
  // Mesuré à l'œil sur des plans de mariage : en dessous de 0,35 les fronts
  // sont rasés dès que quelqu'un lève la tête.
  marge: 0.45,
  airDessus: 0.35,
  lissage: 5,
  // Un dixième de la largeur du cadre : en dessous, suivre se voit plus que
  // ça ne sert.
  seuilMouvement: 0.1,
};
/** L'union de plusieurs boîtes. */
export function union(boites: Visage[]): Visage | undefined {
  if (!boites.length) return undefined;
  const x0 = Math.min(...boites.map((b) => b.x)),
    y0 = Math.min(...boites.map((b) => b.y)),
    x1 = Math.max(...boites.map((b) => b.x + b.w)),
    y1 = Math.max(...boites.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
/**
 * Les visages à garder.
 *
 * « couple » retient les deux plus grands, qui sont les plus proches de
 * l'objectif : sur un plan de mariage, ce sont les mariés bien plus souvent
 * que les invités du fond.
 */
export function retenus(visages: Visage[], mode: Mode): Visage[] {
  if (mode === "tous" || visages.length <= 2) return visages;
  return [...visages].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 2);
}
/**
 * La zone à garder dans l'image, marges comprises.
 *
 * La marge se mesure sur la taille d'un visage, jamais sur l'écart entre eux :
 * deux mariés éloignés d'un mètre n'ont pas besoin d'une marge d'un mètre. Sur
 * l'union, le cadre devenait si large qu'il retombait sur le plan entier.
 *
 * `facteur` resserre les marges quand la zone ne tient pas dans le format.
 */
export function zone(
  visages: Visage[],
  r: Reglages = REGLAGES,
  facteur = 1,
): Visage | undefined {
  const u = union(visages);
  if (!u) return undefined;
  const largeurVisage = mediane(visages.map((v) => v.w)),
    hauteurVisage = mediane(visages.map((v) => v.h));
  const mx = largeurVisage * r.marge * facteur,
    my = hauteurVisage * r.marge * facteur,
    haut = hauteurVisage * r.airDessus * facteur;
  return {
    x: u.x - mx,
    y: u.y - my - haut,
    w: u.w + mx * 2,
    h: u.h + my * 2 + haut,
  };
}
function mediane(v: number[]) {
  if (!v.length) return 0;
  const t = [...v].sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
}
/** Le zoom minimal qui remplit le cadre, sans bande noire. */
export function zoomQuiRemplit(
  source: { w: number; h: number },
  cible: { w: number; h: number },
): number {
  const rw = cible.w / source.w,
    rh = cible.h / source.h;
  return Math.max(rw, rh) / Math.min(rw, rh);
}
/** La part de la source qu'on voit, à un zoom donné. */
export function partVisible(
  scale: number,
  source: { w: number; h: number },
  cible: { w: number; h: number },
) {
  const rw = cible.w / source.w,
    rh = cible.h / source.h,
    min = Math.min(rw, rh);
  return {
    largeur: Math.min(1, rw / (scale * min)),
    hauteur: Math.min(1, rh / (scale * min)),
  };
}
/**
 * Le cadre d'une image : quel zoom, et sur quel point centrer.
 *
 * Le zoom est le plus serré qui contient encore la zone voulue, jamais
 * inférieur à celui qui remplit le cadre. Le centre est ramené à l'intérieur
 * de l'image : un cadre qui dépasse montrerait du vide.
 */
export function cadrer(
  visages: Visage[],
  source: { w: number; h: number },
  cible: { w: number; h: number },
  mode: Mode = "couple",
  r: Reglages = REGLAGES,
): Cadre {
  return ajuster(visages, source, cible, mode, r).cadre;
}
/**
 * Le cadrage, et ce qu'il a fallu concéder pour y arriver.
 *
 * Quand la zone voulue ne tient pas dans le format, on resserre les marges au
 * lieu d'abandonner : perdre un peu d'air autour des têtes vaut mieux que
 * retomber sur le plan large où les mariés sont minuscules. Si même les
 * visages nus ne tiennent pas, on le dit au lieu de faire semblant.
 */
export function ajuster(
  visages: Visage[],
  source: { w: number; h: number },
  cible: { w: number; h: number },
  mode: Mode = "couple",
  r: Reglages = REGLAGES,
): { cadre: Cadre; marge: number; tientTout: boolean } {
  const plancher = zoomQuiRemplit(source, cible),
    gardes = retenus(visages, mode);
  const rw = cible.w / source.w,
    rh = cible.h / source.h,
    min = Math.min(rw, rh);
  const serrePour = (z: Visage) =>
    Math.min(
      rw / (min * Math.max(1e-6, z.w)),
      rh / (min * Math.max(1e-6, z.h)),
    );
  let scale = plancher,
    cx = 0.5,
    cy = 0.5,
    marge = 0,
    tientTout = !gardes.length;
  for (let pas = 20; pas >= 0; pas--) {
    const facteur = pas / 20,
      z = zone(gardes, r, facteur);
    if (!z) break;
    const serre = serrePour(z);
    if (serre >= plancher) {
      scale = serre;
      cx = z.x + z.w / 2;
      cy = z.y + z.h / 2;
      marge = facteur;
      tientTout = true;
      break;
    }
    if (pas === 0) {
      // Même sans marge, les visages débordent du format : on remplit le cadre
      // et on se centre sur eux du mieux possible.
      scale = plancher;
      cx = z.x + z.w / 2;
      cy = z.y + z.h / 2;
    }
  }
  scale = brider(scale, LIMITES.zoom);
  const vue = partVisible(scale, source, cible);
  cx = borner(cx, vue.largeur / 2, 1 - vue.largeur / 2);
  cy = borner(cy, vue.hauteur / 2, 1 - vue.hauteur / 2);
  return {
    cadre: { scale, ...decalage(cx, cy, scale, source, cible) },
    marge,
    tientTout,
  };
}
function borner(v: number, bas: number, haut: number) {
  if (bas > haut) return 0.5;
  return Math.min(haut, Math.max(bas, v));
}
/**
 * Passer d'un point de la source aux valeurs `x` et `y` du plan.
 *
 * Le rendu pose l'image au centre, décalée de `x*W` et `y*H` ; le point de la
 * source qui tombe au centre du cadre est donc `0,5 - x*W/largeurRendue`.
 */
export function decalage(
  cx: number,
  cy: number,
  scale: number,
  source: { w: number; h: number },
  cible: { w: number; h: number },
) {
  const m = scale * Math.min(cible.w / source.w, cible.h / source.h),
    rendue = { w: source.w * m, h: source.h * m };
  return {
    x: brider(((0.5 - cx) * rendue.w) / cible.w, LIMITES.position),
    y: brider(((0.5 - cy) * rendue.h) / cible.h, LIMITES.position),
  };
}
/** Une moyenne glissante, qui garde autant de valeurs qu'elle en reçoit. */
export function lisser(valeurs: number[], fenetre: number): number[] {
  if (fenetre <= 1 || valeurs.length < 2) return [...valeurs];
  const demi = Math.floor(fenetre / 2);
  return valeurs.map((_, i) => {
    const a = Math.max(0, i - demi),
      b = Math.min(valeurs.length, i + demi + 1);
    let somme = 0;
    for (let k = a; k < b; k++) somme += valeurs[k];
    return somme / (b - a);
  });
}
export type Resultat = {
  scale: number;
  x: number;
  y: number;
  /** Les images clés de position, absentes quand le cadre reste fixe. */
  suivi?: { seconde: number; x: number; y: number }[];
  /** Faux quand le format est trop étroit pour garder tout le monde. */
  tientTout: boolean;
  /** Ce qu'on peut en dire, en français. */
  note: string;
};
/**
 * Le cadrage d'un plan entier.
 *
 * Le zoom est commun à toutes les images, choisi sur l'échantillon le plus
 * large : sinon il respirerait d'une image à l'autre. La position suit, lissée,
 * et seulement si le sujet se déplace assez pour que ça se justifie.
 */
export function cadrerPlan(
  echantillons: Echantillon[],
  source: { w: number; h: number },
  cible: { w: number; h: number },
  mode: Mode = "couple",
  r: Reglages = REGLAGES,
): Resultat {
  const plancher = zoomQuiRemplit(source, cible);
  const avecVisages = echantillons.filter((e) => e.visages.length);
  if (!avecVisages.length)
    return {
      scale: plancher,
      x: 0,
      y: 0,
      tientTout: true,
      note: "Aucun visage reconnu : cadrage au centre.",
    };
  // Un zoom unique pour tout le plan : le plus large des cadres nécessaires.
  // Recalculer le zoom image par image le ferait pomper à l'écran.
  const ajustes = avecVisages.map((e) => ajuster(e.visages, source, cible, mode, r));
  const scale = Math.min(...ajustes.map((a) => a.cadre.scale));
  const tientTout = ajustes.every((a) => a.tientTout);
  const vue = partVisible(scale, source, cible);
  // À ce zoom commun, où viser sur chaque image.
  const vises = avecVisages.map((e) => {
    const z = zone(retenus(e.visages, mode), r) || { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    return { seconde: e.seconde, cx: z.x + z.w / 2, cy: z.y + z.h / 2 };
  });
  // Lisser d'abord, puis ramener de force le cadre sur les visages : un
  // lissage seul retarde sur le mouvement et laisse sortir le sujet, ce qui
  // est exactement ce qu'on cherchait à éviter.
  const nus = avecVisages.map((e) => union(retenus(e.visages, mode))!);
  const cx = lisser(vises.map((v) => v.cx), r.lissage).map((v, i) =>
    contenir(v, nus[i].x, nus[i].w, vue.largeur),
  );
  const cy = lisser(vises.map((v) => v.cy), r.lissage).map((v, i) =>
    contenir(v, nus[i].y, nus[i].h, vue.hauteur),
  );
  const amplitude = Math.max(
    Math.max(...cx) - Math.min(...cx),
    Math.max(...cy) - Math.min(...cy),
  );
  const combien =
    mode === "couple" ? "les deux visages les plus marqués" : "tous les visages";
  const alerte = tientTout
    ? ""
    : " Le format vertical est trop étroit pour les garder tous : certains sortent du cadre.";
  if (amplitude < r.seuilMouvement || vises.length < 3)
    return {
      scale,
      ...decalage(moyenne(cx), moyenne(cy), scale, source, cible),
      tientTout,
      note: `Cadre fixe sur ${combien}.` + alerte,
    };
  return {
    scale,
    ...decalage(cx[0], cy[0], scale, source, cible),
    suivi: elaguer(
      vises.map((v, i) => ({
        seconde: v.seconde,
        ...decalage(cx[i], cy[i], scale, source, cible),
      })),
      IMAGES_CLES_MAX,
    ),
    tientTout,
    note:
      `Cadre qui suit ${combien} : ils se déplacent de ${Math.round(amplitude * 100)} % de l’image.` +
      alerte,
  };
}
/**
 * Ramener un centre pour qu'une boîte tienne dans la partie visible.
 *
 * Quand la boîte est plus large que ce qu'on voit, on se contente de la viser
 * au milieu : c'est le moins mauvais cadrage possible.
 */
export function contenir(centre: number, debut: number, taille: number, visible: number) {
  const demi = visible / 2;
  const bas = debut + taille - demi,
    haut = debut + demi;
  const vise = bas > haut ? debut + taille / 2 : Math.min(haut, Math.max(bas, centre));
  return borner(vise, demi, 1 - demi);
}
/**
 * Ne garder qu'un nombre d'images clés que le modèle accepte.
 *
 * On répartit régulièrement plutôt que de couper la fin, et on garde toujours
 * la première et la dernière : sinon le cadre sauterait à l'entrée ou à la
 * sortie du plan.
 */
export function elaguer<T>(suite: T[], maximum: number): T[] {
  if (suite.length <= maximum) return suite;
  const garde: T[] = [];
  for (let i = 0; i < maximum; i++)
    garde.push(suite[Math.round((i * (suite.length - 1)) / (maximum - 1))]);
  return garde;
}
function moyenne(v: number[]) {
  return v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
}
