import { it, expect } from "vitest";
import {
  REGLAGES_RAFALE,
  VERSION_EMPREINTE,
  correlationMiniatures,
  empreinteDe,
  grouperRafales,
  lireCR3,
  instantExif,
  noterRafale,
  raisonPreference,
  type Empreinte,
} from "../src/modules/rafales";
import { groupSuggestions, raisonsDePasse, rechoisirRafale, RAISON_VARIANTE } from "../src/modules/culling";
import { validateCatalog } from "../src/modules/catalog-validation";
import { DEFAULT, type Analysis, type FaceRead, type Photo } from "../src/model";

const base: Analysis = {
  brightness: 0.48,
  sharpness: 1200,
  sharpnessWidth: 1024,
  clipped: 0.01,
  dhash: "0".repeat(64),
  advice: "normal",
  reasons: [],
};
/** Une image RVBA de synthèse. */
function image(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = f(x, y);
      d.set([r, g, b, 255], (y * w + x) * 4);
    }
  return d;
}
// Deux scènes : un dégradé traversé de disques, et un damier bleu.
const scene = (dx = 0) => (x: number, y: number): [number, number, number] => {
  const u = x + dx;
  const disque = (cx: number, cy: number, r: number) => (u - cx) ** 2 + (y - cy) ** 2 < r * r;
  const v = disque(60, 50, 22) || disque(140, 70, 30) ? 230 : 40 + u * 0.6;
  return [v, v * 0.8, 60];
};
const damier = (x: number, y: number): [number, number, number] =>
  (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? [20, 60, 200] : [200, 210, 240];
const W = 200,
  H = 133;
const photo = (
  id: string,
  t: number | undefined,
  empreinte?: Empreinte,
  over: Partial<Photo> = {},
  analysis: Partial<Analysis> = {},
): Photo =>
  ({
    id,
    projectId: "p",
    name: id + ".CR3",
    source: "",
    thumbnail: "",
    width: 6720,
    height: 4480,
    size: 1,
    hash: id,
    status: "pending",
    protected: false,
    created: 1,
    adjustments: DEFAULT,
    history: [],
    camera: { model: "Canon EOS R5" },
    ...over,
    analysis: {
      ...base,
      ...analysis,
      ...(empreinte ? { empreinte: { ...empreinte, instant: t } } : {}),
    },
    ...(t !== undefined && !empreinte ? { capturedAt: t } : {}),
  }) as unknown as Photo;

it("l'empreinte garde 48 px sur le grand côté, et des histogrammes de somme 1", () => {
  const e = empreinteDe(image(W, H, scene()), W, H, 123);
  expect([e.gw, e.gh]).toEqual([48, 32]);
  expect(e.version).toBe(VERSION_EMPREINTE);
  expect(e.instant).toBe(123);
  expect(atob(e.g).length).toBe(48 * 32);
  expect(e.hist).toHaveLength(64);
  expect(e.hog).toHaveLength(128);
  expect(e.hist.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 3);
  expect(e.hog.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 3);
  const portrait = empreinteDe(image(H, W, scene()), H, W);
  expect([portrait.gw, portrait.gh]).toEqual([32, 48]);
  expect(portrait.instant).toBeUndefined();
});

/**
 * Le calcul du banc qui a fixé les seuils (mesurer-signaux.cjs, 28/09/2026),
 * recopié tel quel : l'empreinte de l'application doit lui rester fidèle.
 */
function reference(data: Uint8ClampedArray, w: number, h: number) {
  const L = 48, gw = w >= h ? L : Math.round((L * w) / h), gh = w >= h ? Math.round((L * h) / w) : L;
  const g = new Float32Array(gw * gh), n = new Float32Array(gw * gh);
  const hist = new Float32Array(64), hog = new Float32Array(4 * 4 * 8);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], gg = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
    hist[(r >> 6) * 16 + (gg >> 6) * 4 + (b >> 6)]++;
    const cx = Math.min(gw - 1, Math.floor(((i % w) * gw) / w)), cy = Math.min(gh - 1, Math.floor((Math.floor(i / w) * gh) / h));
    g[cy * gw + cx] += gray[i]; n[cy * gw + cx]++;
  }
  for (let i = 0; i < g.length; i++) g[i] = Math.round(g[i] / Math.max(1, n[i]));
  for (let i = 0; i < 64; i++) hist[i] = +(hist[i] / (w * h)).toFixed(5);
  for (let y = 1; y < h - 1; y += 2) for (let xx = 1; xx < w - 1; xx += 2) {
    const i = y * w + xx, gx = gray[i + 1] - gray[i - 1], gy = gray[i + w] - gray[i - w], m = Math.hypot(gx, gy);
    if (m < 8) continue;
    const o = Math.floor(((Math.atan2(gy, gx) + Math.PI) / (2 * Math.PI)) * 8) % 8;
    hog[(Math.min(3, Math.floor((y * 4) / h)) * 4 + Math.min(3, Math.floor((xx * 4) / w))) * 8 + o] += m;
  }
  let s = 0; for (const v of hog) s += v; for (let i = 0; i < hog.length; i++) hog[i] = +(hog[i] / (s || 1)).toFixed(5);
  return { gw, gh, g: Array.from(g), hist: Array.from(hist), hog: Array.from(hog) };
}

it("l'empreinte est celle du banc qui a fixé les seuils", () => {
  // Une image de la taille d'analyse, avec du détail fin et des contours dans tous les sens.
  const w = 1024, h = 683;
  const data = image(w, h, (x, y) => {
    const v = 128 + 90 * Math.sin(x / 7 + Math.cos(y / 11) * 3) * Math.cos(y / 5);
    return [v, (v * 0.7 + x / 8) % 256, (y * 0.3 + 40) % 256];
  });
  const e = empreinteDe(data, w, h), r = reference(data, w, h);
  expect([e.gw, e.gh]).toEqual([r.gw, r.gh]);
  const g = Uint8Array.from(atob(e.g), (c) => c.charCodeAt(0));
  // Le banc cumulait en simple précision : un niveau de gris d'écart au plus.
  expect(Math.max(...Array.from(g, (v, i) => Math.abs(v - r.g[i])))).toBeLessThanOrEqual(1);
  for (let i = 0; i < 64; i++) expect(e.hist[i]).toBeCloseTo(r.hist[i], 5);
  for (let i = 0; i < 128; i++) expect(e.hog[i]).toBeCloseTo(r.hog[i], 4);
});

it("une image décalée de 2 px à main levée reste la même miniature", () => {
  const a = empreinteDe(image(W, H, scene()), W, H),
    b = empreinteDe(image(W, H, scene(8)), W, H),
    c = empreinteDe(image(W, H, damier), W, H);
  const m = (e: Empreinte) => ({ gw: e.gw, gh: e.gh, g: Uint8Array.from(atob(e.g), (x) => x.charCodeAt(0)) });
  expect(correlationMiniatures(m(a), m(b))).toBeGreaterThan(REGLAGES_RAFALE.miniature);
  expect(correlationMiniatures(m(a), m(c))).toBeLessThan(REGLAGES_RAFALE.miniature);
});

/** Un faux début de CR3 : du remplissage, puis CMT2 et un EXIF au format TIFF. */
function fauxCR3(date: string, fraction: string, serie?: string) {
  const texte = (t: string) => Array.from(t + "\0", (c) => c.charCodeAt(0));
  const n = serie ? 3 : 2,
    donnees = 8 + 2 + n * 12 + 4;
  const d = texte(date),
    sn = serie ? texte(serie) : [];
  const tiff = new Uint8Array(donnees + d.length + sn.length);
  const dv = new DataView(tiff.buffer);
  tiff.set([73, 73]);
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true);
  dv.setUint16(8, n, true);
  const entree = (k: number, tag: number, count: number, valeur: number) => {
    const o = 10 + k * 12;
    dv.setUint16(o, tag, true);
    dv.setUint16(o + 2, 2, true);
    dv.setUint32(o + 4, count, true);
    dv.setUint32(o + 8, valeur, true);
  };
  // DateTimeOriginal, puis SubSecTimeOriginal tenu dans l'entrée même.
  entree(0, 0x9003, d.length, donnees);
  entree(1, 0x9291, fraction.length + 1, 0);
  tiff.set(texte(fraction), 10 + 12 + 8);
  tiff.set(d, donnees);
  // BodySerialNumber : le numéro du boîtier.
  if (serie) {
    entree(2, 0xa431, sn.length, donnees + d.length);
    tiff.set(sn, donnees + d.length);
  }
  const fichier = new Uint8Array(100 + 4 + tiff.length);
  fichier.set([67, 77, 84, 50], 100);
  fichier.set(tiff, 104);
  return fichier.buffer;
}

it("l'heure du CR3 se lit au millième dans la boîte CMT2, avec le numéro du boîtier", () => {
  const r = lireCR3(fauxCR3("2026:09:19 15:04:05", "45", "083021001234"));
  expect(r.instant).toBe(Date.UTC(2026, 8, 19, 15, 4, 5, 450));
  expect(r.boitier).toBe("083021001234");
  // Un centième tenu sur un chiffre vaut des dixièmes : « 4 » = 400 ms.
  expect(lireCR3(fauxCR3("2026:09:19 15:04:05", "4")).instant).toBe(Date.UTC(2026, 8, 19, 15, 4, 5, 400));
  expect(lireCR3(fauxCR3("2026:09:19 15:04:05", "4")).boitier).toBeUndefined();
  expect(lireCR3(new Uint8Array(64).buffer)).toEqual({});
  // Un fichier tronqué au milieu de l'EXIF ne fait rien tomber.
  expect(lireCR3(fauxCR3("2026:09:19 15:04:05", "45").slice(0, 120))).toEqual({});
});

it("l'heure EXIF prend le millième de SubSecTimeOriginal", () => {
  const t = Date.UTC(2026, 8, 19, 15, 4, 5);
  expect(instantExif("2026:09:19 15:04:05", "45")).toBe(t + 450);
  expect(instantExif("2026:09:19 15:04:05", 7)).toBe(t + 700);
  expect(instantExif("2026:09:19 15:04:05", undefined)).toBe(t);
  // Une date déjà convertie par exifr : l'heure affichée par le boîtier compte.
  expect(instantExif(new Date(2026, 8, 19, 15, 4, 5), "45")).toBe(t + 450);
  expect(instantExif("2026:09:19", "45")).toBeUndefined();
});

it("la nuit du passage à l'heure d'été, deux heures du boîtier restent distinctes", () => {
  // 2 h 30 n'existe pas à Paris le 29 mars 2026 : lue en heure locale, elle
  // tombait sur 3 h 30, une heure plus tard, et les deux se mélangeaient.
  expect(instantExif("2026:03:29 03:30:00", "")! - instantExif("2026:03:29 02:30:00", "")!).toBe(3600000);
});

const A = empreinteDe(image(W, H, scene()), W, H),
  A2 = empreinteDe(image(W, H, scene(2)), W, H),
  B = empreinteDe(image(W, H, damier), W, H);

it("une rafale à main levée est reconnue, une autre scène ouvre une rafale", () => {
  const groupes = grouperRafales([
    photo("a1", 0, A),
    photo("a2", 150, A2),
    photo("a3", 300, A),
    photo("b1", 450, B),
    photo("b2", 600, B),
  ]);
  expect(groupes).toEqual([["a1", "a2", "a3"], ["b1", "b2"]]);
});

it("deux signaux sur trois suffisent, un seul ne suffit pas", () => {
  // Même miniature et mêmes contours, couleur changée (flash, nuage) : réunies.
  const couleur = { ...A, hist: [...B.hist] };
  expect(grouperRafales([photo("a", 0, A), photo("b", 100, couleur)])).toHaveLength(1);
  // Seule la couleur ressemble : séparées.
  const seule = { ...B, hist: [...A.hist] };
  expect(grouperRafales([photo("a", 0, A), photo("b", 100, seule)])).toHaveLength(2);
});

it("le résumé de sens remplace la couleur quand les deux photos l'ont", () => {
  const sens = (v: number[]) => Float32Array.from(v);
  const couleur = { ...A, hist: [...B.hist] };
  // Couleur différente, mais même sens : le sens vote, la couleur non.
  const proches = [
    photo("a", 0, A, { semantic: sens([1, 0]) }),
    photo("b", 100, couleur, { semantic: sens([0.99, 0.141]) }),
  ];
  expect(grouperRafales(proches)).toHaveLength(1);
  // Même couleur, sens éloigné, contours changés : la couleur ne vote plus.
  const autre = { ...A, hog: [...B.hog] };
  const loin = [
    photo("a", 0, A, { semantic: sens([1, 0]) }),
    photo("b", 100, autre, { semantic: sens([0, 1]) }),
  ];
  expect(grouperRafales(loin)).toHaveLength(2);
});

it("le cache du regroupement suit le résumé de sens, jamais périmé", () => {
  // Mêmes objets empreinte d'un appel à l'autre, comme dans l'écran de comparaison.
  const a = { ...A, instant: 0 },
    b = { ...A, hog: [...B.hog], instant: 100 };
  const deux = (sa?: number[], sb?: number[]) =>
    grouperRafales([
      { ...photo("a", 0, A), analysis: { ...base, empreinte: a }, ...(sa ? { semantic: Float32Array.from(sa) } : {}) },
      { ...photo("b", 100, A), analysis: { ...base, empreinte: b }, ...(sb ? { semantic: Float32Array.from(sb) } : {}) },
    ] as Photo[]).length;
  // Sans résumé : couleur et miniature votent oui, contours non → réunies.
  expect(deux()).toBe(1);
  // Le résumé arrive (passe d'album) et dit « autre chose » : séparées.
  expect(deux([1, 0], [0, 1])).toBe(2);
  expect(deux()).toBe(1);
});

it("un portrait et un paysage ne sont jamais la même rafale", () => {
  expect(
    grouperRafales([photo("a", 0, A), photo("b", 100, A, { width: 4480, height: 6720 })]),
  ).toHaveLength(2);
});

it("deux boîtiers au même instant font deux rafales, sans se couper", () => {
  const second = { camera: { model: "Canon EOS R6" } } as Partial<Photo>;
  const groupes = grouperRafales([
    photo("a1", 0, A),
    photo("b1", 50, B, second),
    photo("a2", 100, A),
    photo("b2", 150, B, second),
    photo("a3", 200, A),
  ]);
  expect(groupes.map((g) => g.join()).sort()).toEqual(["a1,a2,a3", "b1,b2"]);
});

it("deux boîtiers du même modèle se séparent par leur numéro", () => {
  const b1 = { ...A, boitier: "111" },
    b2 = { ...A, boitier: "222" };
  const groupes = grouperRafales([
    photo("a1", 0, b1),
    photo("b1", 50, b2),
    photo("a2", 100, b1),
    photo("b2", 150, b2),
  ]);
  expect(groupes.map((g) => g.join()).sort()).toEqual(["a1,a2", "b1,b2"]);
});

it("à la même heure, l'ordre des noms de fichiers départage, pas l'identifiant", () => {
  // Heure à la seconde (RAF, analyse ancienne) : A A B B dans la même seconde.
  // Rangées par identifiant (tiré au hasard), elles alternaient A B A B.
  const groupes = grouperRafales([
    photo("a", 1000, A, { name: "DSCF0001.RAF" }),
    photo("c", 1000, A, { name: "DSCF0002.RAF" }),
    photo("b", 1000, B, { name: "DSCF0003.RAF" }),
    photo("d", 1000, B, { name: "DSCF0004.RAF" }),
  ]);
  expect(groupes).toEqual([["a", "c"], ["b", "d"]]);
});

it("l'heure au millième passe avant capturedAt, tenu à la seconde", () => {
  // 2,4 s d'écart au millième, 3 s à la seconde : une seule rafale.
  const groupes = grouperRafales([
    { ...photo("a", 10900, A), capturedAt: 10000 },
    { ...photo("b", 13300, A), capturedAt: 13000 },
  ] as Photo[]);
  expect(groupes).toHaveLength(1);
});

it("chaque image est comparée à la précédente, pas à la première", () => {
  // a2 ressemble à a1 (miniature et contours), a3 à a2 (couleur et miniature),
  // mais a3 ne ressemble à a1 que par la miniature : la chaîne tient.
  const a2 = { ...A, hist: [...B.hist] },
    a3 = { ...A, hist: [...B.hist], hog: [...B.hog] };
  expect(grouperRafales([photo("a1", 0, A), photo("a2", 100, a2), photo("a3", 200, a3)])).toEqual([
    ["a1", "a2", "a3"],
  ]);
});

it("une photo sans heure reste seule, même identique à sa voisine", () => {
  expect(grouperRafales([photo("a", undefined, A), photo("b", undefined, A)])).toHaveLength(2);
});

it("une analyse d'avant la 1.2.2 retombe sur la règle du dhash", () => {
  const vieux = (id: string, t: number, dhash: string) => photo(id, t, undefined, {}, { dhash });
  expect(
    grouperRafales([vieux("a", 0, "0".repeat(64)), vieux("b", 100, "0".repeat(56) + "1".repeat(8))]),
  ).toHaveLength(1);
  expect(
    grouperRafales([vieux("a", 0, "0".repeat(64)), vieux("b", 100, "0".repeat(55) + "1".repeat(9))]),
  ).toHaveLength(2);
});

const visage = (over: Partial<FaceRead> = {}): FaceRead => ({
  region: { x: 0.4, y: 0.3, w: 0.1, h: 0.15 },
  weight: 0.01,
  sharpness: 900,
  nettete: 0.29,
  eyesClosed: 0.05,
  smile: 0.4,
  turned: 0.1,
  ...over,
});
const avec = (reads: FaceRead[], over: Partial<Analysis> = {}): Analysis => ({
  ...base,
  ...over,
  faces: { count: reads.length, closedEyes: 0, blink: 0, reads, version: "t" },
});
const meilleure = (analyses: Analysis[], priority: string[] = []) => {
  const n = noterRafale(analyses, priority).map((x) => x.total);
  return n.indexOf(Math.max(...n));
};

it("un clignement coûte, mais des yeux baissés partout ne départagent rien", () => {
  // La mariée cligne sur la première image seulement.
  expect(
    meilleure([
      avec([visage({ eyesClosed: 0.9 })]),
      avec([visage({ eyesClosed: 0.05, sharpness: 850 })]),
    ]),
  ).toBe(1);
  // Un baiser : yeux « fermés » sur toutes les images, la netteté décide.
  expect(
    meilleure([
      avec([visage({ eyesClosed: 0.9, sharpness: 500 })]),
      avec([visage({ eyesClosed: 0.95, sharpness: 900 })]),
    ]),
  ).toBe(1);
});

it("chaque personne est suivie : le sourire compte par rapport au sien", () => {
  const mariee = { x: 0.3, y: 0.3, w: 0.1, h: 0.15 },
    marie = { x: 0.6, y: 0.3, w: 0.1, h: 0.15 };
  expect(
    meilleure([
      avec([visage({ region: mariee, smile: 0.2 }), visage({ region: marie, smile: 0.5 })]),
      avec([visage({ region: mariee, smile: 0.8 }), visage({ region: marie, smile: 0.5 })]),
    ]),
  ).toBe(1);
  // Une personne absente d'une image (sortie du cadre) la fait perdre.
  expect(
    meilleure([
      avec([visage({ region: mariee })]),
      avec([visage({ region: mariee }), visage({ region: marie })]),
    ]),
  ).toBe(1);
});

it("une personne désignée compte autant que le plus grand visage", () => {
  const mariee = (o: Partial<FaceRead>) =>
    visage({ region: { x: 0.2, y: 0.3, w: 0.04, h: 0.06 }, weight: 0.0016, personId: "mariee", ...o });
  const invite = (o: Partial<FaceRead>) =>
    visage({ region: { x: 0.6, y: 0.2, w: 0.3, h: 0.45 }, weight: 0.09, ...o });
  const a = avec([mariee({ eyesClosed: 0.05, sharpness: 1400 }), invite({ eyesClosed: 0.9, sharpness: 60 })]);
  const b = avec([mariee({ eyesClosed: 0.9, sharpness: 90 }), invite({ eyesClosed: 0.05, sharpness: 1400 })]);
  expect(meilleure([a, b])).toBe(1);
  expect(meilleure([a, b], ["mariee"])).toBe(0);
});

it("une personne désignée qui cligne coûte, même petite, même si un invité sourit mieux", () => {
  const mariee = (o: Partial<FaceRead>) =>
    visage({ region: { x: 0.2, y: 0.3, w: 0.04, h: 0.06 }, weight: 0.0016, personId: "mariee", ...o });
  const invite = (o: Partial<FaceRead>) =>
    visage({ region: { x: 0.6, y: 0.2, w: 0.3, h: 0.45 }, weight: 0.09, ...o });
  const f0 = avec([mariee({ eyesClosed: 0.9 }), invite({ smile: 0.6 })]),
    f1 = avec([mariee({ eyesClosed: 0.05 }), invite({ smile: 0.4 })]);
  // Sans personne désignée, le plus grand visage l'emporte ; avec, la mariée.
  expect(meilleure([f0, f1])).toBe(0);
  expect(meilleure([f0, f1], ["mariee"])).toBe(1);
  // Et le tri passe bien les personnes désignées au choix.
  const out = groupSuggestions(
    [photo("f0", 0, A, {}, f0), photo("f1", 100, A, {}, f1)],
    ["mariee"],
  );
  expect(out.find((p) => p.analysis?.suggested)?.id).toBe("f1");
});

it("les yeux les plus nets l'emportent, et un visage tourné coûte", () => {
  expect(meilleure([avec([visage({ nettete: 0.265 })]), avec([visage({ nettete: 0.29 })])])).toBe(1);
  expect(meilleure([avec([visage({ nettete: 0.29 })]), avec([visage({ nettete: 0.265 })])])).toBe(0);
  expect(meilleure([avec([visage({ turned: 0.8 })]), avec([visage({ turned: 0.1 })])])).toBe(1);
  expect(meilleure([avec([visage({ turned: 0.1 })]), avec([visage({ turned: 0.8 })])])).toBe(0);
});

it("une personne sortie du cadre n'est pas confondue avec celle qui entre", () => {
  // La mariée à gauche sur f0 ; sur f1 elle est sortie et un invité entre à
  // droite, les yeux mi-clos. Ce ne sont pas la même personne : le clignement
  // de l'invité ne se compare pas aux yeux de la mariée, et f1, plus nette, gagne.
  const f0 = avec([visage({ region: { x: 0.05, y: 0.3, w: 0.1, h: 0.15 }, eyesClosed: 0.05, sharpness: 900 })]),
    f1 = avec([visage({ region: { x: 0.8, y: 0.3, w: 0.1, h: 0.15 }, eyesClosed: 0.9, sharpness: 950 })]);
  expect(meilleure([f0, f1])).toBe(1);
});

it("une image presque noire ou brûlée n'est jamais préférée à une image normale", () => {
  expect(
    meilleure([avec([visage({ sharpness: 1000 })], { brightness: 0.03 }), avec([visage({ sharpness: 900 })])]),
  ).toBe(1);
  expect(
    meilleure([avec([visage({ sharpness: 1000 })], { brightness: 0.97 }), avec([visage({ sharpness: 900 })])]),
  ).toBe(1);
});

it("la raison donnée est ce qui avantage le plus la gagnante", () => {
  const [a, b] = noterRafale([
    avec([visage({ sharpness: 900 })]),
    avec([visage({ sharpness: 300 })]),
  ]);
  expect(raisonPreference(a, b)).toBe("plus nette");
  const [c, d] = noterRafale([
    avec([visage({ eyesClosed: 0.05 })]),
    avec([visage({ eyesClosed: 0.95 })]),
  ]);
  expect(raisonPreference(c, d)).toBe("yeux mieux ouverts");
  // Plusieurs avantages : c'est le plus fort qui est dit.
  const [e, f] = noterRafale([
    avec([visage({ sharpness: 900, eyesClosed: 0.05 })]),
    avec([visage({ sharpness: 850, eyesClosed: 0.9 })]),
  ]);
  expect(raisonPreference(e, f)).toBe("yeux mieux ouverts");
});

it("la passe d'album ne met la raison de variante que sur les autres images", () => {
  // La gagnante n'est pas la première de sa rafale : c'est le cas courant.
  const out = groupSuggestions([
    photo("a1", 0, A, {}, avec([visage({ eyesClosed: 0.9 })])),
    photo("a2", 100, A2, {}, avec([visage({ eyesClosed: 0.05 })])),
  ]);
  const [a1, a2] = out.map((p) => raisonsDePasse(p.analysis!, false));
  expect(a2).not.toContain(RAISON_VARIANTE);
  expect(a1).toContain(RAISON_VARIANTE);
  const sombre = raisonsDePasse(out[1].analysis!, true);
  expect(sombre).toEqual(["Ambiance sombre ou très claire : exposition conservée."]);
  // Une photo seule n'est la variante de personne.
  expect(raisonsDePasse(groupSuggestions([photo("b", 0, B)])[0].analysis!, false)).toEqual([]);
});

it("le tri ne propose qu'une image par rafale, et dit pourquoi", () => {
  const photos = [
    photo("a1", 0, A, {}, avec([visage({ eyesClosed: 0.9 })])),
    photo("a2", 100, A2, {}, avec([visage({ eyesClosed: 0.05 })])),
    photo("a3", 200, A, {}, avec([visage({ eyesClosed: 0.05, sharpness: 400 })])),
    photo("b1", 300, B, {}, avec([visage()])),
  ];
  const out = groupSuggestions(photos);
  expect(out.filter((p) => p.analysis?.suggested).map((p) => p.id)).toEqual(["a2", "b1"]);
  const a2 = out.find((p) => p.id === "a2")!;
  expect(a2.analysis!.verdict).toMatch(/^Meilleure de la rafale \(3 images\)/);
  expect(out.find((p) => p.id === "a1")!.analysis!.verdict).toMatch(
    /Une autre image de la rafale est préférée : yeux mieux ouverts\.$/,
  );
  expect(out.find((p) => p.id === "a3")!.analysis!.verdict).toMatch(/: plus nette\.$/);
  expect(new Set(out.slice(0, 3).map((p) => p.analysis!.groupId)).size).toBe(1);
  // Une image seule garde sa phrase, sans mention de rafale.
  expect(out.find((p) => p.id === "b1")!.analysis!.verdict).not.toMatch(/rafale/);
});

it("une photo protégée reste la proposée, et on dit pourquoi", () => {
  const out = groupSuggestions([
    photo("a", 0, A, { protected: true }, avec([visage({ sharpness: 100 })])),
    photo("b", 100, A, {}, avec([visage({ sharpness: 1000 })])),
  ]);
  expect(out.find((p) => p.analysis?.suggested)?.id).toBe("a");
  expect(out.find((p) => p.id === "b")!.analysis!.verdict).toMatch(/elle est protégée\.$/);
});

it("une image écartée n'est jamais proposée, sa voisine l'est", () => {
  const out = groupSuggestions([
    photo("a", 0, A, { status: "reject" }, avec([visage({ sharpness: 1000 })])),
    photo("b", 100, A, {}, avec([visage({ sharpness: 100 })])),
  ]);
  expect(out.map((p) => !!p.analysis?.suggested)).toEqual([false, true]);
});

it("la raison de variante d'une passe précédente ne colle plus", () => {
  for (const vieille of [RAISON_VARIANTE, "Variante conservée : comparez la série avant d’écarter."]) {
    const [p] = groupSuggestions([
      photo("a", 0, A, {}, { reasons: [vieille], advice: "review" }),
    ]);
    expect(p.analysis!.reasons).toEqual([]);
    expect(p.analysis!.advice).toBe("normal");
    expect(p.analysis!.suggested).toBe(true);
  }
});

it("le catalogue accepte une empreinte bien formée et refuse le reste", () => {
  const projet = { id: "p", name: "Projet", kind: "Mariage", date: "2026-09-19", location: "", created: 1, demo: false };
  const cat = (empreinte: unknown) =>
    validateCatalog(projet as never, [
      {
        id: "x", projectId: "p", name: "x.jpg", source: "idb", thumbnail: "", width: 10, height: 10, size: 10,
        created: 1, status: "pending", stars: 0, adjustments: DEFAULT, history: [],
        analysis: { ...base, empreinte },
      },
    ] as never);
  const e = { ...A, instant: 1789897269344 };
  expect(() => cat(undefined)).not.toThrow();
  expect(() => cat(e)).not.toThrow();
  expect(() => cat({ ...e, hist: e.hist.slice(1) })).toThrow();
  expect(() => cat({ ...e, hog: e.hog.map(() => 2) })).toThrow();
  expect(() => cat({ ...e, g: "<script>" })).toThrow();
  expect(() => cat({ ...e, gw: 4096 })).toThrow();
  expect(() => cat({ ...e, instant: "hier" })).toThrow();
  expect(() => cat({ ...e, boitier: "083021001234" })).not.toThrow();
  expect(() => cat({ ...e, boitier: "x".repeat(65) })).toThrow();
});

it("un panorama extrême garde une empreinte que le catalogue accepte", () => {
  const e = empreinteDe(image(1024, 10, scene()), 1024, 10);
  expect([e.gw, e.gh]).toEqual([48, 1]);
  const projet = { id: "p", name: "Projet", kind: "Mariage", date: "2026-09-19", location: "", created: 1, demo: false };
  expect(() =>
    validateCatalog(projet as never, [
      {
        id: "x", projectId: "p", name: "x.jpg", source: "idb", thumbnail: "", width: 1024, height: 10, size: 10,
        created: 1, status: "pending", stars: 0, adjustments: DEFAULT, history: [], analysis: { ...base, empreinte: e },
      },
    ] as never),
  ).not.toThrow();
});

it("le résumé de sens revient d'une sauvegarde JSON, un contenu piégé est retiré", () => {
  const projet = { id: "p", name: "Projet", kind: "Mariage", date: "2026-09-19", location: "", created: 1, demo: false };
  const restaure = (semantic: unknown) =>
    validateCatalog(projet as never, [
      {
        id: "x", projectId: "p", name: "x.jpg", source: "idb", thumbnail: "", width: 10, height: 10, size: 10,
        created: 1, status: "pending", stars: 0, adjustments: DEFAULT, history: [], semantic,
      },
    ] as never).photos[0].semantic;
  // JSON.stringify d'un Float32Array donne {"0": …, "1": …}.
  const v = JSON.parse(JSON.stringify(Float32Array.from([0.6, 0.8])));
  expect(restaure(v)).toBeInstanceOf(Float32Array);
  expect(Array.from(restaure(v)!)).toEqual([Float32Array.from([0.6])[0], Float32Array.from([0.8])[0]]);
  expect(restaure({ length: 200000000 })).toBeUndefined();
  expect(restaure({ 0: "x" })).toBeUndefined();
  expect(restaure(undefined)).toBeUndefined();
});

it("un résumé de sens piégé n'est jamais parcouru par le regroupement", () => {
  const piege = { length: 1e15 } as unknown as Float32Array;
  const t = performance.now();
  grouperRafales([photo("a", 0, A, { semantic: piege }), photo("b", 100, A, { semantic: piege })]);
  expect(performance.now() - t).toBeLessThan(500);
});

it("une rafale ne dépasse jamais 60 images", () => {
  const run = Array.from({ length: 130 }, (_, i) => photo("r" + i, i * 10, A));
  expect(grouperRafales(run).map((g) => g.length)).toEqual([60, 60, 10]);
});

it("une image écartée ne garde pas le verdict de meilleure d'une passe précédente", () => {
  const avant = groupSuggestions([
    photo("a1", 0, A, {}, avec([visage({ sharpness: 400 })])),
    photo("a2", 100, A, {}, avec([visage({ sharpness: 900 })])),
  ]);
  expect(avant[1].analysis!.verdict).toMatch(/^Meilleure de la rafale/);
  // Le photographe écarte a2 et relance l'analyse.
  const apres = groupSuggestions([avant[0], { ...avant[1], status: "reject" }]);
  expect(apres[0].analysis!.verdict).toMatch(/^Meilleure de la rafale/);
  expect(apres[1].analysis!.verdict).not.toMatch(/Meilleure/);
});

it("une photo gardée à la main reste le choix de sa rafale", () => {
  const out = groupSuggestions([
    photo("a1", 0, A, { status: "keep" }, avec([visage({ sharpness: 300 })])),
    photo("a2", 100, A, {}, avec([visage({ sharpness: 1000 })])),
  ]);
  expect(out.find((p) => p.analysis?.suggested)?.id).toBe("a1");
  const a2 = out.find((p) => p.id === "a2")!;
  expect(a2.analysis!.verdict).toMatch(/préférée : vous l'avez gardée\.$/);
  // L'autre image, à décider, est bien la variante.
  expect(a2.analysis!.reasons).toContain(RAISON_VARIANTE);
  // Celle du photographe n'est jamais marquée variante.
  expect(out.find((p) => p.id === "a1")!.analysis!.reasons).not.toContain(RAISON_VARIANTE);
});

it("la raison de variante tient d'une passe à l'autre, et ne touche que les photos à décider", () => {
  const une = groupSuggestions([
    photo("a1", 0, A, {}, avec([visage({ sharpness: 300 })])),
    photo("a2", 100, A, {}, avec([visage({ sharpness: 1000 })])),
    photo("a3", 200, A, { status: "reject" }, avec([visage({ sharpness: 200 })])),
  ]);
  const deux = groupSuggestions(une);
  for (const out of [une, deux]) {
    const [a1, a2, a3] = out;
    expect(a1.analysis!.reasons).toEqual([RAISON_VARIANTE]);
    expect(a1.analysis!.advice).toBe("review");
    expect(a2.analysis!.reasons).toEqual([]);
    expect(a3.analysis!.reasons).toEqual([]);
  }
});

it("une copie reçue de l'équipe garde le regroupement reçu", () => {
  // L'empreinte n'est pas publiée : sans elle, la règle dhash de la 1.2.1
  // referait des « rafales » bien plus nombreuses.
  const recue = (id: string, t: number, groupId: string, suggested: boolean) =>
    ({
      ...photo(id, t, undefined, { previewOnly: true } as Partial<Photo>, { dhash: id === "b" ? "1".repeat(64) : "0".repeat(64) }),
      analysis: { ...base, dhash: id === "b" ? "1".repeat(64) : "0".repeat(64), groupId, suggested, verdict: "reçu" },
    }) as Photo;
  const out = groupSuggestions([recue("a", 0, "a", true), recue("b", 100, "a", false)]);
  expect(out.map((p) => [p.analysis!.groupId, p.analysis!.suggested, p.analysis!.verdict])).toEqual([
    ["a", true, "reçu"],
    ["a", false, "reçu"],
  ]);
});

it("le verdict et les raisons disent la même chose", () => {
  // Yeux fermés au-dessus du seuil du verdict : la photo est mise à vérifier.
  const yeux = groupSuggestions([photo("y", 0, A, {}, avec([visage({ eyesClosed: 0.62 })]))])[0];
  expect(yeux.analysis!.verdict).toBe("Yeux fermés sur le visage principal.");
  expect(yeux.analysis!.advice).toBe("review");
  // Écrêtage modéré : ni verdict « écrêtées » ni raison.
  const clair = groupSuggestions([photo("c", 0, A, {}, { ...avec([visage()]), clipped: 0.15 })])[0];
  expect(clair.analysis!.verdict).not.toMatch(/lumières/);
  // Peu de détails sans visage : le verdict ne dit plus « Image nette ».
  const mou = groupSuggestions([photo("m", 0, A, {}, { sharpness: 42, reasons: ["Peu de détails : vérifier la netteté"], advice: "review" })])[0];
  expect(mou.analysis!.verdict).toBe("Peu de détails : netteté à vérifier.");
});

it("une photo sans empreinte reste dans sa rafale : les deux horloges s'accordent", () => {
  // L'empreinte compte l'heure du boîtier en UTC ; capturedAt est l'heure réelle.
  const murale = Date.UTC(2026, 8, 19, 15, 4, 5, 0);
  const reelle = new Date(2026, 8, 19, 15, 4, 5, 100).getTime();
  const sans = { ...photo("b", undefined, undefined, {}, { dhash: "0".repeat(64) }), capturedAt: reelle } as Photo;
  const avecEmp = photo("a", murale, { ...A, hist: [...A.hist] }, {}, { dhash: "0".repeat(64) });
  expect(grouperRafales([avecEmp, sans])).toHaveLength(1);
});

it("écarter la proposée d'une rafale fait proposer la suivante, et le catalogue le sait", () => {
  const out = groupSuggestions([
    photo("a1", 0, A, {}, avec([visage({ sharpness: 300 })])),
    photo("a2", 100, A2, {}, avec([visage({ sharpness: 1000 })])),
    photo("b", 5000, B, {}, avec([visage()])),
  ]);
  expect(out[1].analysis!.suggested).toBe(true);
  // Le photographe écarte a2 : a1 devient la proposée, sans raison de variante.
  const apres = out.map((p) => (p.id === "a2" ? { ...p, status: "reject" as const } : p));
  const changees = rechoisirRafale(apres, "a2");
  expect(changees.map((p) => p.id).sort()).toEqual(["a1", "a2"]);
  const a1 = changees.find((p) => p.id === "a1")!;
  expect(a1.analysis!.suggested).toBe(true);
  expect(a1.analysis!.reasons).not.toContain(RAISON_VARIANTE);
  expect(a1.analysis!.advice).toBe("normal");
  expect(changees.find((p) => p.id === "a2")!.analysis!.suggested).toBe(false);
  // Le même choix que « Comparer les rafales », qui recalcule tout.
  expect(groupSuggestions(apres).find((p) => p.analysis?.suggested && p.id.startsWith("a"))?.id).toBe("a1");
  // Une photo seule, ou hors rafale : rien à refaire.
  expect(rechoisirRafale(apres, "b")).toEqual([]);
});
