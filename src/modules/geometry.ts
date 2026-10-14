/**
 * La géométrie d'une photo, en un seul endroit.
 *
 * Trois transformations s'enchaînent, toujours dans cet ordre :
 * 1. le redressement fin (`straighten`, en degrés, positif = sens horaire),
 *    autour du centre, sur un cadre de même taille que la source : c'est le
 *    « repère redressé » ;
 * 2. le cadre, exprimé dans ce repère redressé en proportions ;
 * 3. le quart de tour (`rotation`, 0, 90, 180 ou 270).
 *
 * Les retouches locales, le détourage et le masque IA restent en coordonnées
 * de la source : ils sont appliqués avant toute géométrie, et ne bougent pas
 * quand on redresse.
 *
 * Le cadre sans coins vides n'est jamais stocké : il se calcule. Un redressement
 * change donc de valeur sans rien avoir à resynchroniser. Tant que l'angle vaut
 * zéro, tout ce qui suit redonne exactement l'ancien comportement.
 *
 * Toutes les fonctions prennent les dimensions de l'image (orientée) : une
 * rotation fine dépend du rapport largeur / hauteur, un quart de tour non.
 */
import type { Adjustments, CropRect, Point } from "../model";
const RAD = Math.PI / 180;
/** Le redressement enregistré, borné à ±45°. */
export function angleOf(a: Pick<Adjustments, "straighten">): number {
  const t = Number(a.straighten) || 0;
  return Math.max(-45, Math.min(45, t));
}
function quart(a: Pick<Adjustments, "rotation">) {
  return (((a.rotation || 0) % 360) + 360) % 360;
}
/**
 * Le plus grand rectangle centré, au rapport `ratio` (largeur / hauteur, en
 * pixels du repère redressé), qui tient dans la source tournée de `degres`.
 *
 * Pour un demi-rectangle (a, b), ses coins ramenés dans la source doivent
 * vérifier a·cos t + b·sin t ≤ W/2 et a·sin t + b·cos t ≤ H/2 : d'où la valeur
 * de b, puis a = ratio·b. Au même rapport que la photo, on retrouve le facteur
 * classique 1 / (cos t + (L/S)·sin t).
 */
export function cadreInscrit(
  W: number,
  H: number,
  degres: number,
  ratio = W / H,
): CropRect {
  const t = Math.abs(degres) * RAD,
    c = Math.cos(t),
    s = Math.sin(t);
  const b = Math.min(
    W / 2 / (ratio * c + s),
    H / 2 / (ratio * s + c),
    W / 2 / ratio,
    H / 2,
  );
  const w = (2 * ratio * b) / W,
    h = (2 * b) / H;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}
/** Un point du repère redressé (proportions) ramené dans la source. */
export function redresseVersSource(
  p: Point,
  degres: number,
  W: number,
  H: number,
): Point {
  if (!degres) return { x: p.x, y: p.y };
  const t = degres * RAD,
    c = Math.cos(t),
    s = Math.sin(t);
  const dx = (p.x - 0.5) * W,
    dy = (p.y - 0.5) * H;
  // Rotation de −t : on défait le redressement.
  return { x: 0.5 + (c * dx + s * dy) / W, y: 0.5 + (-s * dx + c * dy) / H };
}
/** Un point de la source (proportions) placé dans le repère redressé. */
export function sourceVersRedresse(
  p: Point,
  degres: number,
  W: number,
  H: number,
): Point {
  if (!degres) return { x: p.x, y: p.y };
  const t = degres * RAD,
    c = Math.cos(t),
    s = Math.sin(t);
  const dx = (p.x - 0.5) * W,
    dy = (p.y - 0.5) * H;
  return { x: 0.5 + (c * dx - s * dy) / W, y: 0.5 + (s * dx + c * dy) / H };
}
const DEDANS = 1e-9;
function cadreValide(r: CropRect, degres: number, W: number, H: number) {
  for (const [x, y] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ]) {
    const q = redresseVersSource({ x, y }, degres, W, H);
    if (q.x < -DEDANS || q.y < -DEDANS || q.x > 1 + DEDANS || q.y > 1 + DEDANS)
      return false;
  }
  return true;
}
/**
 * Le cadre réellement appliqué, dans le repère redressé.
 *
 * Sans cadre enregistré : le plus grand rectangle centré au rapport de la
 * photo, puis la marge « recadrage centré » appliquée à l'intérieur. Avec un
 * cadre enregistré : il est réduit autour de son centre, et au besoin ramené
 * vers le milieu, jusqu'à n'avoir plus aucun coin vide ; la marge s'applique
 * ensuite à l'intérieur de ce cadre. Elle y était ignorée : le curseur
 * enregistrait sa valeur et un pas d'annulation sans rien changer à l'image.
 */
export function effectiveCrop(
  a: Pick<Adjustments, "straighten" | "crop" | "cropRect">,
  W: number,
  H: number,
): CropRect {
  const t = angleOf(a);
  const m = Math.max(0, Math.min(0.4, (a.crop || 0) / 100));
  if (!a.cropRect) {
    // Sans angle, l'ancienne formule exacte : le rendu doit rester identique
    // au pixel près, et (1 − 0,8) / 2 ne vaut pas 0,2 / 2 en virgule flottante.
    if (!t) return { x: m / 2, y: m / 2, w: 1 - m, h: 1 - m };
    const base = cadreInscrit(W, H, t);
    const w = base.w * (1 - m),
      h = base.h * (1 - m);
    return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }
  return avecMarge(cadreLibre(a.cropRect, t, W, H), m);
}
/** La marge « recadrage centré », prise à l'intérieur d'un cadre, autour de son centre. */
function avecMarge(r: CropRect, m: number): CropRect {
  if (!m) return r;
  const w = r.w * (1 - m),
    h = r.h * (1 - m);
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}
/** Le cadre libre enregistré, sans coin vide une fois redressé. */
function cadreLibre(r: CropRect, t: number, W: number, H: number): CropRect {
  if (!t || cadreValide(r, t, W, H)) return { ...r };
  const cx0 = r.x + r.w / 2,
    cy0 = r.y + r.h / 2;
  // D'abord réduire autour du centre ; si le centre lui-même tombe dans un
  // coin vide, le rapprocher du milieu pas à pas.
  for (let pas = 0; pas <= 20; pas++) {
    const m = pas / 20,
      cx = cx0 + (0.5 - cx0) * m,
      cy = cy0 + (0.5 - cy0) * m;
    let bas = 0,
      haut = 1;
    for (let i = 0; i < 40; i++) {
      const k = (bas + haut) / 2;
      const essai = { x: cx - (r.w * k) / 2, y: cy - (r.h * k) / 2, w: r.w * k, h: r.h * k };
      if (cadreValide(essai, t, W, H)) bas = k;
      else haut = k;
    }
    // Un cadre réduit de plus de moitié n'est plus celui qu'on avait choisi :
    // mieux vaut se recentrer un peu.
    if (bas >= 0.5 || pas === 20)
      return { x: cx - (r.w * bas) / 2, y: cy - (r.h * bas) / 2, w: r.w * bas, h: r.h * bas };
  }
  return cadreInscrit(W, H, t, (r.w * W) / (r.h * H));
}
/** Défaire le quart de tour : un point affiché ramené dans le cadre (proportions). */
function sansQuart(p: Point, r: number): Point {
  return r === 90
    ? { x: p.y, y: 1 - p.x }
    : r === 180
      ? { x: 1 - p.x, y: 1 - p.y }
      : r === 270
        ? { x: 1 - p.y, y: p.x }
        : { x: p.x, y: p.y };
}
function avecQuart(p: Point, r: number): Point {
  return r === 90
    ? { x: 1 - p.y, y: p.x }
    : r === 180
      ? { x: 1 - p.x, y: 1 - p.y }
      : r === 270
        ? { x: p.y, y: 1 - p.x }
        : { x: p.x, y: p.y };
}
/** Un point affiché ramené dans le repère redressé : sert à l'outil de recadrage. */
export function displayToFrame(p: Point, a: Adjustments, W: number, H: number): Point {
  const c = effectiveCrop(a, W, H),
    v = sansQuart(p, quart(a));
  return { x: c.x + v.x * c.w, y: c.y + v.y * c.h };
}
/** Un point affiché ramené dans la source : sert aux pinceaux et au détourage. */
export function displayToSource(p: Point, a: Adjustments, W: number, H: number): Point {
  return redresseVersSource(displayToFrame(p, a, W, H), angleOf(a), W, H);
}
/** Un point de la source placé à l'écran : sert au masque IA et à la comparaison. */
export function sourceToDisplay(p: Point, a: Adjustments, W: number, H: number): Point {
  const c = effectiveCrop(a, W, H),
    f = sourceVersRedresse(p, angleOf(a), W, H);
  return avecQuart({ x: (f.x - c.x) / c.w, y: (f.y - c.y) / c.h }, quart(a));
}
/**
 * Le plus grand cadre centré au format `ratio` tel qu'on le voit à l'écran.
 *
 * Une photo tournée d'un quart de tour échange sa largeur et sa hauteur : un
 * « 16/9 » demandé sur une photo tournée doit rester un 16/9 à l'écran.
 */
export function cadreAuFormat(
  W: number,
  H: number,
  rotation: number,
  ratio: number,
  degres = 0,
): CropRect {
  const tournee = (((rotation % 360) + 360) % 360) % 180 !== 0;
  return cadreInscrit(W, H, degres, tournee ? 1 / ratio : ratio);
}
/**
 * La transformation inverse du rendu : pour un pixel de sortie, le point de la
 * source à lire. Tout en pixels de l'image traitée (W × H).
 */
export function pixelSource(
  a: Adjustments,
  W: number,
  H: number,
): {
  largeur: number;
  hauteur: number;
  lire: (x: number, y: number) => [number, number];
} {
  const c = effectiveCrop(a, W, H),
    r = quart(a),
    t = angleOf(a) * RAD,
    cos = Math.cos(t),
    sin = Math.sin(t);
  const sx = c.x * W,
    sy = c.y * H,
    sw = Math.max(1, Math.round(c.w * W)),
    sh = Math.max(1, Math.round(c.h * H));
  const swap = r === 90 || r === 270;
  return {
    largeur: swap ? sh : sw,
    hauteur: swap ? sw : sh,
    lire(dx, dy) {
      // Défaire le quart de tour, pixel par pixel, comme la boucle historique.
      let x = dx,
        y = dy;
      if (r === 90) {
        x = dy;
        y = sh - 1 - dx;
      } else if (r === 180) {
        x = sw - 1 - dx;
        y = sh - 1 - dy;
      } else if (r === 270) {
        x = sw - 1 - dy;
        y = dx;
      }
      // Centre du pixel dans le repère redressé, puis rotation inverse.
      const fx = sx + x + 0.5 - W / 2,
        fy = sy + y + 0.5 - H / 2;
      return [W / 2 + cos * fx + sin * fy - 0.5, H / 2 - sin * fx + cos * fy - 0.5];
    },
  };
}
