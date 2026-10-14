/**
 * Reconnaître les rafales, puis en garder une seule image : la meilleure.
 *
 * Mesuré le 28/09/2026 sur les 3 552 RAW de l'album Audrey-Ann et Clément,
 * face aux séries d'Aftershoot (756 livrées) ; réglé sur le matin seulement,
 * vérifié sur l'après-midi. Détail dans COMPARAISON-AFTERSHOOT.md.
 *
 * Regroupement, en une phrase : dans l'ordre de prise de vue, une photo
 * rejoint la rafale en cours si elle a été prise au plus 2,5 s après la
 * PREMIÈRE image de la rafale, et si elle ressemble à la précédente sur au
 * moins deux des trois signaux :
 *   - le résumé de sens SigLIP 2 (cosinus ≥ 0,945), à défaut l'histogramme
 *     de couleur (intersection ≥ 0,96) ;
 *   - la miniature grise de 48 px (corrélation ≥ 0,90, décalage de ±2 px
 *     toléré pour la main levée) ;
 *   - les contours par cases (distance L1 ≤ 0,30).
 * La ressemblance au dhash (8 bits) de la 1.2.1 ne réunissait que 17 % des
 * images voisines d'une même série : une rafale à main levée bouge.
 *
 * Pourquoi un plafond de durée : Aftershoot découpe une longue rafale en
 * tranches (1,4 s en médiane, jamais plus de 16 images) et livre une image
 * par tranche. Au-delà de 3 s, réunir deux images même très ressemblantes se
 * trompe une fois sur deux (décor re-photographié, pas une rafale).
 *
 * Résultat (B³ face aux séries d'Aftershoot) : F1 82,7 % contre 44,9 % en
 * 1.2.1 ; 1 053 rafales pour 3 552 photos ; 91 % des livrées restent
 * atteignables en n'en gardant qu'une par rafale. Limite : 16 % des images
 * voisines de deux séries différentes sont réunies à tort (1,7 % en 1.2.1),
 * surtout des coupures d'Aftershoot au milieu d'une rafale continue.
 */
import type { Analysis, FaceRead, Photo } from "../model";
import { hamming } from "../model";
import { decisiveSharpness } from "./quality";

export const VERSION_EMPREINTE = "rafale-v1";

/**
 * Ce qu'il faut garder de l'image d'analyse pour reconnaître une rafale plus
 * tard sans la redécoder : environ 3 ko par photo.
 */
export type Empreinte = {
  version: string;
  /**
   * L'heure de prise de vue au millième, en heure locale de l'appareil : la
   * seconde de `capturedAt` ne suffit pas, une rafale en tient dix.
   */
  instant?: number;
  /** Miniature grise, 48 px sur le grand côté, en base64 (gw × gh octets). */
  gw: number;
  gh: number;
  g: string;
  /** Histogramme de couleur 4 × 4 × 4, somme 1. */
  hist: number[];
  /** Histogramme des contours, 4 × 4 cases × 8 orientations, somme 1. */
  hog: number[];
  /**
   * Le numéro du boîtier (BodySerialNumber) : deux photographes équipés du
   * même modèle ne se coupent pas leurs rafales.
   */
  boitier?: string;
};

/**
 * Au-delà, une nouvelle rafale commence : 20 images par seconde pendant
 * 2,5 s font 50 images, la plus longue de l'album de mesure en a 15. C'est
 * un garde-fou contre un catalogue piégé, pas un réglage.
 */
const IMAGES_MAX = 60;
/** Les visages suivis par image, les plus grands : même garde-fou. */
const VISAGES_MAX = 20;

export const REGLAGES_RAFALE = Object.freeze({
  duree: 2500, // ms, depuis la première image de la rafale
  siglip: 0.945, // cosinus SigLIP 2
  miniature: 0.9, // corrélation des miniatures grises
  contours: 0.3, // distance L1 des histogrammes de contours
  couleur: 0.96, // intersection des histogrammes de couleur, faute de SigLIP
});

const arrondi5 = (x: number) => Math.round(x * 1e5) / 1e5;

function versBase64(octets: Uint8Array) {
  let texte = "";
  for (let i = 0; i < octets.length; i += 8192)
    texte += String.fromCharCode(...octets.subarray(i, i + 8192));
  return btoa(texte);
}
function depuisBase64(texte: string) {
  const brut = atob(texte),
    octets = new Uint8Array(brut.length);
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets;
}

/**
 * L'empreinte de l'image d'analyse (RVBA 8 bits). Mêmes calculs, au pixel
 * près, que le banc qui a fixé les seuils : ne pas les « simplifier ».
 */
export function empreinteDe(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  instant?: number,
): Empreinte {
  // Gris réduit par moyenne de surface, 48 px sur le grand côté.
  // Au moins une case : un panorama de plus de 96:1 en donnait zéro, et le
  // catalogue le refusait à la restauration.
  const L = 48,
    gw = w >= h ? L : Math.max(1, Math.round((L * w) / h)),
    gh = w >= h ? Math.max(1, Math.round((L * h) / w)) : L;
  const somme = new Float64Array(gw * gh),
    nombre = new Float64Array(gw * gh),
    hist = new Float64Array(64),
    hog = new Float64Array(4 * 4 * 8),
    gris = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4],
      v = data[i * 4 + 1],
      b = data[i * 4 + 2];
    gris[i] = 0.2126 * r + 0.7152 * v + 0.0722 * b;
    hist[(r >> 6) * 16 + (v >> 6) * 4 + (b >> 6)]++;
    const cx = Math.min(gw - 1, Math.floor(((i % w) * gw) / w)),
      cy = Math.min(gh - 1, Math.floor((Math.floor(i / w) * gh) / h));
    somme[cy * gw + cx] += gris[i];
    nombre[cy * gw + cx]++;
  }
  const g = new Uint8Array(gw * gh);
  for (let i = 0; i < g.length; i++)
    g[i] = Math.round(somme[i] / Math.max(1, nombre[i]));
  // Contours : un pixel sur quatre suffit, les faibles (bruit) ne votent pas.
  for (let y = 1; y < h - 1; y += 2)
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x,
        gx = gris[i + 1] - gris[i - 1],
        gy = gris[i + w] - gris[i - w],
        m = Math.hypot(gx, gy);
      if (m < 8) continue;
      const o = Math.floor(((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * 8) % 8;
      hog[(Math.min(3, Math.floor((y * 4) / h)) * 4 + Math.min(3, Math.floor((x * 4) / w))) * 8 + o] += m;
    }
  let total = 0;
  for (const v of hog) total += v;
  return {
    version: VERSION_EMPREINTE,
    ...(Number.isFinite(instant) ? { instant } : {}),
    gw,
    gh,
    g: versBase64(g),
    hist: Array.from(hist, (v) => arrondi5(v / (w * h))),
    hog: Array.from(hog, (v) => arrondi5(v / (total || 1))),
  };
}

/**
 * « 2026:09:19 15:04:05 » et « 45 » → millisecondes, l'heure affichée par le
 * boîtier comptée comme si elle était en temps universel. Seuls les écarts
 * servent : lue dans le fuseau du Mac, la nuit du passage à l'heure d'été
 * confondait 2 h 30 et 3 h 30 (relecture du 28/09/2026).
 */
function heureDuBoitier(date: string, fraction = "") {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(date.trim());
  if (!m) return undefined;
  const ms = /^\d+$/.test(fraction) ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], ms);
  return Number.isFinite(t) ? t : undefined;
}

/** Un numéro de boîtier présentable, ou rien. */
function boitierDe(v: unknown) {
  const s = v === undefined || v === null ? "" : String(v).replace(/\0.*$/s, "").trim();
  return s && s.length <= 64 ? s : undefined;
}

/**
 * L'heure au millième et le numéro du boîtier d'un CR3 (Canon) : la boîte
 * CMT2 porte l'EXIF au format TIFF (DateTimeOriginal, SubSecTimeOriginal,
 * BodySerialNumber). Aucune bibliothèque du projet ne lit le CR3 ; LibRaw ne
 * rend que la seconde. Il suffit du premier mégaoctet du fichier.
 */
export function lireCR3(tampon: ArrayBuffer): { instant?: number; boitier?: string } {
  try {
    const u8 = new Uint8Array(tampon, 0, Math.min(tampon.byteLength, 1 << 20));
    let k = -1;
    for (let i = 0; i < u8.length - 4; i++)
      if (u8[i] === 67 && u8[i + 1] === 77 && u8[i + 2] === 84 && u8[i + 3] === 50) {
        k = i;
        break;
      }
    if (k < 0) return {};
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength),
      t = k + 4,
      le = u8[t] === 73;
    const u16 = (o: number) => dv.getUint16(o, le),
      u32 = (o: number) => dv.getUint32(o, le);
    const ifd = t + u32(t + 4),
      n = u16(ifd);
    const textes = new Map<number, string>();
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12,
        tag = u16(e),
        type = u16(e + 2),
        count = u32(e + 4);
      if (type !== 2 || ![0x9003, 0x9291, 0xa431].includes(tag)) continue;
      const debut = count <= 4 ? e + 8 : t + u32(e + 8);
      if (debut + count > u8.length) continue;
      textes.set(tag, String.fromCharCode(...u8.subarray(debut, debut + count)).replace(/\0.*$/s, "").trim());
    }
    const date = textes.get(0x9003),
      instant = date ? heureDuBoitier(date, textes.get(0x9291)) : undefined,
      boitier = boitierDe(textes.get(0xa431));
    return { ...(instant !== undefined ? { instant } : {}), ...(boitier ? { boitier } : {}) };
  } catch {
    return {};
  }
}

/**
 * L'heure au millième d'après l'EXIF lu par exifr (JPEG, HEIC, TIFF, DNG, NEF,
 * ARW…) : DateTimeOriginal lu en texte (`reviveValues: false`), et
 * SubSecTimeOriginal pour le reste. Une date déjà convertie par exifr est
 * relue par ses heures affichées.
 */
export function instantExif(date: unknown, fraction: unknown): number | undefined {
  const f = String(fraction ?? "").trim();
  if (typeof date === "string") return heureDuBoitier(date, f);
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return undefined;
  const ms = date.getMilliseconds() || (/^\d+$/.test(f) ? Number(f.padEnd(3, "0").slice(0, 3)) : 0);
  return Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(), ms,
  );
}

/** L'empreinte, avec ce que l'EXIF dit du moment et du boîtier. */
export function avecTemps(e: Empreinte, temps: { instant?: number; boitier?: string }): Empreinte {
  return {
    ...e,
    ...(Number.isFinite(temps.instant) ? { instant: temps.instant } : {}),
    ...(boitierDe(temps.boitier) ? { boitier: boitierDe(temps.boitier) } : {}),
  };
}

type Signaux = {
  /** L'empreinte d'où viennent les signaux : la clé des caches. */
  cle?: Empreinte;
  instant?: number;
  boitier?: string;
  largeur: number;
  hauteur: number;
  appareil?: string;
  sens?: ArrayLike<number>;
  gw?: number;
  gh?: number;
  g?: Uint8Array;
  hist?: number[];
  hog?: number[];
  dhash?: string;
};

/**
 * Les caches du regroupement, tenus par l'objet empreinte : l'écran de
 * comparaison refait les rafales à chaque note posée, et seule la photo notée
 * change d'objet. Sans eux, 0,4 s par note sur un album de 3 500 photos.
 */
const miniatures = new WeakMap<Empreinte, Uint8Array | null>();
const paires = new WeakMap<
  Empreinte,
  WeakMap<Empreinte, { sa?: ArrayLike<number>; sb?: ArrayLike<number>; oui: boolean }>
>();

function miniature(e: Empreinte) {
  let o = miniatures.get(e);
  if (o === undefined) {
    try {
      const d = depuisBase64(e.g);
      o = d.length === e.gw * e.gh ? d : null;
    } catch {
      o = null;
    }
    miniatures.set(e, o);
  }
  return o || undefined;
}

/**
 * `capturedAt` est l'heure réelle (EXIF ou LibRaw lus dans le fuseau du Mac),
 * `instant` l'heure affichée par le boîtier comptée en UTC. Une photo sans
 * empreinte au milieu d'une suite qui en a sortait sinon de sa rafale, deux
 * heures plus tôt en été : on ramène l'une à l'échelle de l'autre.
 */
function horlogeDe(t: number | undefined) {
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t!);
  return Date.UTC(
    d.getFullYear(), d.getMonth(), d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds(),
  );
}
function signauxDe(p: Photo): Signaux {
  const e = p.analysis?.empreinte;
  const g = e?.version === VERSION_EMPREINTE ? miniature(e) : undefined;
  return {
    instant: e?.instant ?? horlogeDe(p.capturedAt),
    boitier: e?.boitier,
    largeur: p.width,
    hauteur: p.height,
    appareil: p.camera?.model,
    // Un résumé de 768 nombres ; tout autre chose (catalogue piégé, aller-retour
    // JSON) est ignoré plutôt que parcouru.
    sens:
      p.semantic instanceof Float32Array && p.semantic.length && p.semantic.length <= 4096
        ? p.semantic
        : undefined,
    ...(g ? { cle: e!, gw: e!.gw, gh: e!.gh, g, hist: e!.hist, hog: e!.hog } : {}),
    dhash: p.analysis?.dhash,
  };
}

/** Corrélation de deux miniatures grises, la meilleure sur ±2 px de décalage. */
export function correlationMiniatures(
  a: { gw: number; gh: number; g: ArrayLike<number> },
  b: { gw: number; gh: number; g: ArrayLike<number> },
  decalage = 2,
) {
  const w = a.gw,
    h = a.gh,
    A = a.g,
    B = b.g;
  let meilleure = -1;
  for (let dy = -decalage; dy <= decalage; dy++)
    for (let dx = -decalage; dx <= decalage; dx++) {
      let n = 0,
        sa = 0,
        sb = 0,
        saa = 0,
        sbb = 0,
        sab = 0;
      for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++)
        for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
          const u = A[y * w + x],
            v = B[(y + dy) * w + x + dx];
          n++;
          sa += u;
          sb += v;
          saa += u * u;
          sbb += v * v;
          sab += u * v;
        }
      const va = saa - (sa * sa) / n,
        vb = sbb - (sb * sb) / n;
      if (va <= 0 || vb <= 0) continue;
      const r = (sab - (sa * sb) / n) / Math.sqrt(va * vb);
      if (r > meilleure) meilleure = r;
    }
  return meilleure;
}

/** Les voix disponibles pour deux images : true = « se ressemblent ». */
function voix(a: Signaux, b: Signaux, R = REGLAGES_RAFALE) {
  const v: boolean[] = [];
  if (a.sens && b.sens && a.sens.length === b.sens.length) {
    let s = 0;
    for (let i = 0; i < a.sens.length; i++) s += a.sens[i] * b.sens[i];
    v.push(s >= R.siglip);
  } else if (a.hist && b.hist) {
    let s = 0;
    for (let i = 0; i < a.hist.length; i++) s += Math.min(a.hist[i], b.hist[i]);
    v.push(s >= R.couleur);
  }
  if (a.g && b.g && a.gw === b.gw && a.gh === b.gh)
    v.push(correlationMiniatures(a as any, b as any) >= R.miniature);
  if (a.hog && b.hog) {
    let s = 0;
    for (let i = 0; i < a.hog.length; i++) s += Math.abs(a.hog[i] - b.hog[i]);
    v.push(s <= R.contours);
  }
  return v;
}

function ressemble(a: Signaux, b: Signaux, R = REGLAGES_RAFALE) {
  // Un portrait et un paysage ne sont jamais la même rafale.
  if (
    a.largeur &&
    a.hauteur &&
    b.largeur &&
    b.hauteur &&
    Math.abs(a.largeur / a.hauteur - b.largeur / b.hauteur) >= 0.06
  )
    return false;
  const cache =
    R === REGLAGES_RAFALE && a.cle && b.cle
      ? paires.get(a.cle) || paires.set(a.cle, new WeakMap()).get(a.cle)!
      : undefined;
  const connu = cache?.get(b.cle!);
  if (connu && connu.sa === a.sens && connu.sb === b.sens) return connu.oui;
  const v = voix(a, b, R);
  const oui =
    v.length >= 2
      ? v.filter(Boolean).length >= 2
      : // Analyse d'avant la 1.2.2, pas encore relue : la règle de la 1.2.1.
        !!a.dhash && !!b.dhash && hamming(a.dhash, b.dhash) <= 8;
  cache?.set(b.cle!, { sa: a.sens, sb: b.sens, oui });
  return oui;
}

/**
 * Les rafales d'un ensemble de photos : des listes d'identifiants, chaque
 * photo analysée dans une seule. Chaque album et chaque boîtier se suivent à
 * part (modèle et, s'il est connu, numéro de série) : deux photographes au
 * même instant ne font pas une rafale. Une photo
 * sans heure reste seule, la ressemblance ne suffit jamais.
 */
export function grouperRafales(photos: Photo[], R = REGLAGES_RAFALE): string[][] {
  const suites = new Map<string, { p: Photo; s: Signaux }[]>();
  const groupes: string[][] = [];
  for (const p of photos) {
    if (!p.analysis) continue;
    const s = signauxDe(p);
    if (!Number.isFinite(s.instant)) {
      groupes.push([p.id]);
      continue;
    }
    const cle = [p.projectId, s.appareil || "", s.boitier || ""].join("\u0000");
    const suite = suites.get(cle) || [];
    suite.push({ p, s });
    suites.set(cle, suite);
  }
  for (const suite of suites.values()) {
    // À la même heure (tenue à la seconde : RAF, analyse ancienne), l'ordre
    // des fichiers est celui de la prise de vue ; l'identifiant est tiré au
    // hasard et coupait les rafales (relecture du 28/09/2026).
    suite.sort(
      (a, b) =>
        a.s.instant! - b.s.instant! ||
        a.p.name.localeCompare(b.p.name, undefined, { numeric: true }) ||
        a.p.created - b.p.created ||
        a.p.id.localeCompare(b.p.id),
    );
    let courant: typeof suite = [];
    for (const x of suite) {
      const premiere = courant[0],
        precedente = courant[courant.length - 1];
      if (
        premiere &&
        courant.length < IMAGES_MAX &&
        x.s.instant! - premiere.s.instant! <= R.duree &&
        ressemble(precedente.s, x.s, R)
      )
        courant.push(x);
      else {
        if (courant.length) groupes.push(courant.map((y) => y.p.id));
        courant = [x];
      }
    }
    if (courant.length) groupes.push(courant.map((y) => y.p.id));
  }
  return groupes;
}

/**
 * Choisir l'image d'une rafale, avec les règles d'un photographe devant sa
 * planche. Chaque personne est suivie d'une image à l'autre et comparée À
 * ELLE-MÊME, jamais dans l'absolu : sur un baiser, les yeux sont « fermés »
 * partout et ne départagent rien ; seul le clignement coûte.
 *   - sourire au-dessus de sa moyenne dans la rafale : gagne ;
 *   - yeux plus fermés que son meilleur moment : perd ;
 *   - plus tournée que d'habitude : perd ;
 *   - bande des yeux plus nette que sa moyenne (échelle de la 1.2.1, saturée
 *     de 0,262 à 0,29) : gagne ;
 *   - absente alors qu'elle est dans la rafale : perd.
 * Et la netteté décisive (visage principal, sinon l'image), rapportée à la
 * plus nette de la rafale, pèse double. Chaque personne compte selon sa
 * taille (surface rapportée au plus grand visage) ; une personne désignée
 * compte autant que la plus grande.
 *
 * Poids choisis sur le matin seulement. Sur les 610 séries d'Aftershoot, la
 * livrée est choisie 35,7 % des fois (31,6 % pour le score de la 1.2.1, 24,7 %
 * au hasard ; 62 séries gagnées pour 37 perdues, p = 0,015). Quand ce n'est
 * pas la livrée, c'est presque toujours sa voisine immédiate, prise moins
 * d'une seconde avant ou après.
 */
export const POIDS_CHOIX = Object.freeze({
  sourire: 1,
  yeux: 1,
  tourne: 1,
  netteteYeux: 1,
  absent: 1,
  netteteImage: 2,
  /** Image presque noire ou brûlée : jamais préférée à une image normale. */
  exposition: 2,
});
const NETTETE_FLOU = 0.262,
  NETTETE_NET = 0.29;

export type Motif = keyof typeof POIDS_CHOIX;
export type NoteRafale = { total: number; parts: Record<Motif, number> };

const nombre = (x: unknown, d = 0) =>
  typeof x === "number" && Number.isFinite(x) ? x : d;
const largeurVisage = (f: FaceRead) =>
  nombre(f.region?.w) || Math.sqrt(Math.max(0, nombre(f.weight)));

type Piste = { cx: number; cy: number; w: number; designee: boolean; faces: Map<number, FaceRead> };

/** Rattacher chaque visage à une personne suivie d'une image à l'autre. */
function suivre(analyses: Analysis[], priority: string[]) {
  const faces: { k: number; f: FaceRead; w: number; cx: number; cy: number }[] = [];
  analyses.forEach((a, k) => {
    const reads = Array.isArray(a.faces?.reads) ? a.faces!.reads! : [];
    [...reads]
      .sort((x, y) => nombre(y?.weight) - nombre(x?.weight))
      .slice(0, VISAGES_MAX)
      .forEach((f) => {
        if (!f?.region) return;
        const w = largeurVisage(f);
        if (w > 0)
          faces.push({
            k,
            f,
            w,
            cx: nombre(f.region.x) + nombre(f.region.w) / 2,
            cy: nombre(f.region.y) + nombre(f.region.h) / 2,
          });
      });
  });
  faces.sort((a, b) => b.w - a.w);
  const pistes: Piste[] = [];
  for (const o of faces) {
    let meilleure: Piste | undefined,
      distance = 1; // une largeur de visage au plus
    for (const t of pistes) {
      if (t.faces.has(o.k)) continue;
      const r = o.w / t.w;
      if (r < 0.6 || r > 1.6) continue;
      const d = Math.hypot(o.cx - t.cx, o.cy - t.cy) / Math.max(o.w, t.w);
      if (d < distance) {
        distance = d;
        meilleure = t;
      }
    }
    const designee = !!o.f.personId && priority.includes(o.f.personId);
    if (meilleure) {
      meilleure.faces.set(o.k, o.f);
      const n = meilleure.faces.size;
      meilleure.cx += (o.cx - meilleure.cx) / n;
      meilleure.cy += (o.cy - meilleure.cy) / n;
      meilleure.w += (o.w - meilleure.w) / n;
      meilleure.designee ||= designee;
    } else
      pistes.push({ cx: o.cx, cy: o.cy, w: o.w, designee, faces: new Map([[o.k, o.f]]) });
  }
  return pistes;
}

/** La note de chaque image d'une rafale, détaillée par motif. */
export function noterRafale(
  analyses: Analysis[],
  priority: string[] = [],
  poids = POIDS_CHOIX,
): NoteRafale[] {
  const vide = (): Record<Motif, number> => ({
    sourire: 0,
    yeux: 0,
    tourne: 0,
    netteteYeux: 0,
    absent: 0,
    netteteImage: 0,
    exposition: 0,
  });
  const parts = analyses.map(vide);
  const nettetes = analyses.map((a) => decisiveSharpness(a, priority)),
    plusNette = Math.max(0, ...nettetes);
  analyses.forEach((a, k) => {
    parts[k].netteteImage = poids.netteteImage * (plusNette > 0 ? nettetes[k] / plusNette : 1);
    if (a.brightness < 0.08 || a.brightness > 0.94) parts[k].exposition = -poids.exposition;
  });
  // Analyses d'avant la 0.9.0 : un nombre d'yeux fermés, sans visage lu.
  const anciens = analyses.map((a) =>
    !a.faces?.reads?.length && a.faces?.count
      ? nombre(a.faces.closedEyes) / Math.max(1, a.faces.count)
      : undefined,
  );
  const meilleurs = Math.min(...anciens.map((x) => x ?? Infinity));
  anciens.forEach((x, k) => {
    if (x !== undefined) parts[k].yeux -= poids.yeux * (x - meilleurs);
  });
  const pistes = suivre(analyses, priority);
  if (pistes.length) {
    const plusGrande = Math.max(...pistes.map((t) => t.w));
    const nettete = (f: FaceRead) =>
      typeof f.nettete === "number"
        ? Math.max(-1, Math.min(1, (f.nettete - NETTETE_FLOU) / (NETTETE_NET - NETTETE_FLOU)))
        : null;
    for (const t of pistes) {
      const importance = t.designee ? 1 : Math.max(0.01, (t.w / plusGrande) ** 2);
      const fs = [...t.faces.values()];
      const moyenne = (g: (f: FaceRead) => number) =>
        fs.reduce((s, f) => s + g(f), 0) / fs.length;
      const meilleursYeux = Math.min(...fs.map((f) => nombre(f.eyesClosed)));
      const sourire = moyenne((f) => nombre(f.smile)),
        tourne = moyenne((f) => nombre(f.turned));
      const nets = fs.map(nettete).filter((x): x is number => x !== null);
      const net = nets.length ? nets.reduce((s, x) => s + x, 0) / nets.length : 0;
      for (let k = 0; k < analyses.length; k++) {
        const f = t.faces.get(k);
        if (!f) {
          parts[k].absent -= importance * poids.absent;
          continue;
        }
        const n = nettete(f);
        parts[k].sourire += importance * poids.sourire * (nombre(f.smile) - sourire);
        parts[k].yeux -= importance * poids.yeux * (nombre(f.eyesClosed) - meilleursYeux);
        parts[k].tourne -= importance * poids.tourne * (nombre(f.turned) - tourne);
        parts[k].netteteYeux += importance * poids.netteteYeux * (n === null ? 0 : n - net);
      }
    }
  }
  return parts.map((p) => ({
    total: Object.values(p).reduce((s, x) => s + x, 0),
    parts: p,
  }));
}

const RAISONS: Record<Motif, string> = {
  netteteImage: "plus nette",
  netteteYeux: "yeux plus nets",
  yeux: "yeux mieux ouverts",
  sourire: "plus beau sourire",
  tourne: "visages plus tournés vers l'objectif",
  absent: "tout le monde y est",
  exposition: "mieux exposée",
};
/** Ce qui fait préférer `gagnante` : le motif qui l'avantage le plus. */
export function raisonPreference(gagnante: NoteRafale, autre: NoteRafale) {
  let motif: Motif | undefined,
    ecart = 1e-6;
  for (const m of Object.keys(RAISONS) as Motif[]) {
    const d = gagnante.parts[m] - autre.parts[m];
    if (d > ecart) {
      ecart = d;
      motif = m;
    }
  }
  return motif ? RAISONS[motif] : undefined;
}
