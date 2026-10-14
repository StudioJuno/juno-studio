import type { ColorBand, ColorMix, Curves } from "./modules/advanced-color";
import { toneExporte, type AutoField } from "./modules/auto-tone";
export type Status = "pending" | "keep" | "reject";
export type Point = { x: number; y: number };
export type CropRect = { x: number; y: number; w: number; h: number };
export type LocalEdit = {
  id: string;
  name: string;
  /**
   * « subject » ne se peint pas au pinceau : il s'applique là où le détourage
   * a trouvé la personne, avec la transparence par pixel que MODNet rend.
   */
  tool: "exposure" | "warmth" | "soften" | "clone" | "mask" | "subject";
  points: Point[];
  radius: number;
  amount: number;
  opacity: number;
  visible: boolean;
  source?: Point;
  /** Pour « subject » : agir sur le fond au lieu du sujet. */
  invert?: boolean;
};
export type Adjustments = {
  whites?: number;
  blacks?: number;
  vibrance?: number;
  clarity?: number;
  sharpening?: number;
  noiseReduction?: number;
  curves?: Curves;
  colorMix?: Partial<Record<ColorBand, ColorMix>>;
  localEdits?: LocalEdit[];
  /**
   * Le cadre, en proportions du repère redressé (la source tournée de
   * `straighten` autour de son centre). Sans angle, c'est la source : les
   * anciens catalogues restent justes. Voir src/modules/geometry.ts.
   */
  cropRect?: CropRect;
  /**
   * Le redressement fin, en degrés, positif = sens horaire à l'écran, de −45 à
   * 45. Optionnel et absent de DEFAULT : sinon toute photo ancienne serait
   * jugée « déjà retouchée » par la passe d'album, qui compare à DEFAULT.
   */
  straighten?: number;
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  warmth: number;
  tint: number;
  saturation: number;
  fade: number;
  vignette: number;
  grain: number;
  rotation: number;
  crop: number;
  style: string;
  intensity: number;
};
export const ADVANCED_DEFAULTS = {
  whites: 0,
  blacks: 0,
  vibrance: 0,
  clarity: 0,
  sharpening: 0,
  noiseReduction: 0,
  curves: {},
  colorMix: {},
} satisfies Partial<Adjustments>;
export const DEFAULT: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  warmth: 0,
  tint: 0,
  saturation: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  rotation: 0,
  crop: 0,
  style: "original",
  intensity: 100,
};
/** One detected face, with the signals that decide between two frames of a burst. */
export type FaceRead = {
  region: CropRect;
  /** Share of the frame this face covers; weights every other signal. */
  weight: number;
  /**
   * Laplacian variance measured inside the face, not on the whole frame. It
   * grows as the face shrinks: comparable only between frames of a burst.
   */
  sharpness: number;
  /**
   * Netteté de la bande des yeux, indépendante de la taille du visage (0 à
   * 0,75 ; un visage net vaut environ 0,29). Absente des analyses d'avant la
   * 1.2.1, ou quand elle n'est pas mesurable. Voir public/face-sharpness.js.
   */
  nettete?: number;
  /**
   * Part des pixels blancs purs (luminance > 249) dans le cœur du visage
   * (60 % central de sa boîte), sur l'image d'analyse : un visage brûlé.
   */
  ecrete?: number;
  eyesClosed: number;
  smile: number;
  /** 0 when the head faces the lens, 1 when it is turned away. */
  turned: number;
  /** Geometric face signature, the fallback when the model is unavailable. */
  signature?: number[];
  /** 128 numbers from the local face network: the real identity reading. */
  descriptor?: number[];
  /** Identifier of the person this face was assigned to. */
  personId?: string;
};
export type Analysis = {
  brightness: number;
  sharpness: number;
  clipped: number;
  dhash: string;
  advice: "review" | "normal";
  reasons: string[];
  /** Width the sharpness was measured at: an old low value is not comparable. */
  sharpnessWidth?: number;
  /**
   * La netteté de la case la plus nette d'une grille de 8 × 8 : un gros plan
   * net sur fond flou n'est pas une image « peu détaillée ».
   */
  nettetePointe?: number;
  /** Mid tone colour average, skin weighted, for the white balance. */
  cast?: { r: number; g: number; b: number };
  /**
   * Le rendu de la photo avant retouche : centiles de luminance, saturation,
   * dominante. Mesuré à l'analyse parce que c'est le seul moment où les
   * pixels sont disponibles, et servant à viser le rendu appris.
   */
  look?: import("./modules/look").LookStats;
  faces?: {
    count: number;
    closedEyes: number;
    blink: number;
    regions?: CropRect[];
    reads?: FaceRead[];
    /** Sharpness of the largest face, the subject in practice. */
    subjectSharpness?: number;
    version: string;
  };
  /**
   * L'inclinaison mesurée à l'analyse (src/modules/level.ts). `angle` est
   * l'inclinaison de la photo, positive si elle penche dans le sens horaire ;
   * la correction à appliquer est son opposé.
   */
  level?: {
    tier: "auto" | "suggest" | "level" | "abstain";
    angle: number | null;
    reason: string;
    version: string;
  };
  /**
   * Ce qu'il faut pour reconnaître une rafale sans redécoder l'image : heure
   * au millième, miniature grise, couleur, contours (src/modules/rafales.ts).
   */
  empreinte?: import("./modules/rafales").Empreinte;
  groupId?: string;
  suggested?: boolean;
  /** Why this photo was suggested or set aside, in the user's language. */
  verdict?: string;
};
export type Photo = {
  revision?: number;
  id: string;
  projectId: string;
  name: string;
  source: string;
  thumbnail: string;
  width: number;
  height: number;
  size: number;
  hash: string;
  capturedAt?: number;
  color?: {
    source: "raw" | "embedded" | "assumed";
    profile: string;
    space: "sRGB";
  };
  status: Status;
  stars: number;
  protected: boolean;
  chapter: string;
  adjustments: Adjustments;
  history: Adjustments[];
  /**
   * Le résumé de sens de la photo, pour la recherche en français.
   * Stocké en Float32Array : 768 nombres par photo, soit 3 ko, contre 15 ko
   * si on les rangeait un par un dans un tableau ordinaire.
   */
  semantic?: Float32Array;
  /** Le moment de la journée proposé, jamais imposé. */
  moment?: string;
  /** What Juno proposed on its last automatic pass, to learn from the edit. */
  proposal?: Partial<Adjustments>;
  /**
   * Le style appris que portait cette proposition (voir profilPorte) : vide
   * si le profil ne s'appliquait pas encore. Absent sur une proposition
   * posée jusqu'à la 1.2.2 : le style appris n'était alors jamais enregistré
   * dans l'application, elle n'en portait donc aucun.
   */
  proposalProfile?: Partial<Record<AutoField, number>>;
  /** Set once the correction has been folded into the style profile. */
  proposalLearned?: boolean;
  /** One pointer/keyboard gesture is one undo step, including queued writes. */
  editGroup?: string;
  future?: Adjustments[];
  originalRecovery?: Adjustments;
  created: number;
  analysis?: Analysis;
  generated?: boolean;
  parentId?: string;
  prompt?: string;
  camera?: {
    make?: string;
    model?: string;
    iso?: number;
    aperture?: number;
    shutter?: number;
  };
  bitDepth?: number;
  previewOnly?: boolean;
  remotePhotoId?: string;
  versions?: {
    id: string;
    name: string;
    created: number;
    adjustments: Adjustments;
  }[];
};
export type Project = {
  id: string;
  name: string;
  date: string;
  location: string;
  demo: boolean;
  kind?: string;
  created: number;
  sharedRevision?: number;
  remoteId?: string;
  remoteServer?: string;
};
export const PROJECT_TYPES = [
  "Mariage",
  "Portrait",
  "Produit",
  "Immobilier",
  "Événement",
  "Mode",
  "Projet libre",
];
export function chaptersFor(kind?: string): string[] {
  return [
    "Tout le projet",
    ...(kind === "Mariage"
      ? ["Préparatifs", "Cérémonie", "Le couple", "Réception", "Soirée"]
      : kind === "Portrait"
        ? ["Portraits", "Studio", "Extérieur", "Détails"]
        : kind === "Produit"
          ? ["Packshots", "En situation", "Détails", "Variantes"]
          : kind === "Immobilier"
            ? ["Extérieur", "Pièces de vie", "Chambres", "Détails"]
            : kind === "Événement"
              ? ["Ambiance", "Temps forts", "Participants", "Détails"]
              : kind === "Mode"
                ? ["Looks", "Portraits", "Silhouettes", "Détails"]
                : ["Prises de vue", "Sélection finale", "Détails"]),
  ];
}
export const STYLES = [
  {
    id: "original",
    name: "Original",
    desc: "Votre image, simplement.",
    color: "#8b968c",
    settings: {},
  },
  {
    id: "signature",
    name: "Juno Signature",
    desc: "Des tons doux, un regard intemporel.",
    color: "#bc956d",
    settings: {
      warmth: 8,
      contrast: 7,
      highlights: -12,
      shadows: 12,
      saturation: -7,
      fade: 5,
    },
  },
  {
    id: "editorial",
    name: "Éditorial",
    desc: "Des blancs francs, une présence affirmée.",
    color: "#9c9ca0",
    settings: { contrast: 18, highlights: -8, shadows: 5, saturation: -15 },
  },
  {
    id: "golden",
    name: "Golden Hour",
    desc: "La chaleur des derniers rayons.",
    color: "#c39349",
    settings: {
      warmth: 22,
      contrast: 5,
      highlights: -18,
      shadows: 15,
      saturation: 6,
      fade: 7,
    },
  },
  {
    id: "film",
    name: "Film doux",
    desc: "Une couleur feutrée et un grain discret.",
    color: "#879481",
    settings: {
      warmth: 7,
      contrast: -7,
      highlights: -16,
      shadows: 10,
      saturation: -18,
      fade: 14,
      grain: 12,
    },
  },
  {
    id: "mono",
    name: "Noir & blanc",
    desc: "Garder uniquement l’émotion.",
    color: "#4b4b4b",
    settings: { saturation: -100, contrast: 18, highlights: -9, shadows: 8 },
  },
];
export function effective(a: Adjustments): Adjustments {
  const s = STYLES.find((x) => x.id === a.style),
    out = { ...a };
  if (s)
    for (const [k, v] of Object.entries(s.settings))
      (out as unknown as Record<string, unknown>)[k] =
        Number((a as unknown as Record<string, unknown>)[k]) +
        (Number(v) * a.intensity) / 100;
  return out;
}
export const uid = () => crypto.randomUUID();
export function editPhoto(
  p: Photo,
  patch: Partial<Adjustments>,
  group?: string,
): Photo {
  const adjustments = { ...p.adjustments, ...patch };
  if (JSON.stringify(adjustments) === JSON.stringify(p.adjustments)) return p;
  return {
    ...p,
    adjustments,
    history:
      group && p.editGroup === group
        ? p.history
        : [...p.history, p.adjustments].slice(-40),
    future: [],
    editGroup: group,
  };
}
/** A named version replaces the whole recipe, including fields absent in old catalogues. */
export function replacePhotoAdjustments(p: Photo, recipe: Adjustments): Photo {
  const adjustments = { ...DEFAULT, ...structuredClone(recipe) };
  if (JSON.stringify(adjustments) === JSON.stringify(p.adjustments)) return p;
  return {
    ...p,
    adjustments,
    history: [...p.history, p.adjustments].slice(-40),
    future: [],
    editGroup: undefined,
  };
}
export function undoPhoto(p: Photo): Photo {
  const history = [...p.history],
    adjustments = history.pop();
  return adjustments
    ? {
        ...p,
        adjustments,
        history,
        editGroup: undefined,
        future: [...(p.future || []), p.adjustments].slice(-40),
      }
    : p;
}
export function redoPhoto(p: Photo): Photo {
  const future = [...(p.future || [])],
    adjustments = future.pop();
  return adjustments
    ? {
        ...p,
        adjustments,
        history: [...p.history, p.adjustments].slice(-40),
        future,
        editGroup: undefined,
      }
    : p;
}
export function resetPhoto(p: Photo): Photo {
  if (
    Object.entries(DEFAULT).every(
      ([k, v]) => p.adjustments[k as keyof Adjustments] === v,
    ) &&
    !p.adjustments.localEdits?.length &&
    !p.adjustments.cropRect &&
    !p.adjustments.straighten &&
    ![
      p.adjustments.whites,
      p.adjustments.blacks,
      p.adjustments.vibrance,
      p.adjustments.clarity,
      p.adjustments.sharpening,
      p.adjustments.noiseReduction,
    ].some(Boolean) &&
    !Object.keys(p.adjustments.curves || {}).length &&
    !Object.keys(p.adjustments.colorMix || {}).length
  )
    return p;
  return {
    ...editPhoto(p, {
      ...DEFAULT,
      localEdits: [],
      cropRect: undefined,
      straighten: undefined,
      whites: 0,
      blacks: 0,
      vibrance: 0,
      clarity: 0,
      sharpening: 0,
      noiseReduction: 0,
      curves: {},
      colorMix: {},
    }),
    originalRecovery: structuredClone(p.adjustments),
  };
}
export function recoverPhoto(p: Photo): Photo {
  return p.originalRecovery
    ? {
        ...p,
        adjustments: structuredClone(p.originalRecovery),
        history: [...p.history, p.adjustments].slice(-40),
        future: [],
        editGroup: undefined,
        originalRecovery: undefined,
      }
    : p;
}
/**
 * Le bouton « Auto » de l'éditeur : exposition, hautes lumières et ombres.
 * Pour un RAW, l'exposition vise le rendu de Juno mesuré dans `analysis.rendu`
 * (voir auto-tone.ts), comme « Préparer l'album » : réglée sur l'aperçu
 * intégré, elle assombrissait l'export. Sans cette mesure, c'est l'ancien
 * calcul, juste pour un JPEG ; l'éditeur la fait d'abord pour un RAW.
 */
export function autoSettings(a: Analysis): Partial<Adjustments> {
  return toneExporte(a);
}
export function hamming(a: string, b: string) {
  if (a.length !== b.length) return 999;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}
