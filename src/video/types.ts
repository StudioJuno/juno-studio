export type FrameRate = { n: number; d: number };
export type Grade = {
  lutId?: string;
  lutIntensity?: number;
  exposure: number;
  contrast: number;
  saturation: number;
  warmth: number;
  tint: number;
  fade: number;
  style: string;
  intensity: number;
};
export type TranscriptWord = {
  start: number;
  end: number;
  text: string;
  confidence?: number;
};
export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  words?: TranscriptWord[];
};
export type CaptionWord = {
  confidence?: number;
  start: number;
  end: number;
  from: number;
  to: number;
};
/**
 * Le dérushage d'un rush (electron/video/derush.cjs) : des passages qui
 * couvrent tout le rush, en secondes du média, chacun bon, à vérifier ou
 * masqué, avec ses raisons. Rien n'est supprimé : masquer, c'est seulement
 * ne pas proposer.
 */
export type DerushEtat = "bon" | "verifier" | "masque";
export type DerushPlage = {
  debut: number;
  fin: number;
  etat: DerushEtat;
  raisons: string[];
};
export type Derush = {
  mesure: string;
  regles: string;
  /** La version de l'aperçu lu (taille et date). */
  marque: string;
  plages: DerushPlage[];
  resume: { duree: number; bon: number; verifier: number; masque: number };
  /** Le mouvement d'ensemble du rush. */
  mouvement?: "fixe" | "maitrise" | "main";
  /** Le type de plan, d'après la taille des visages (derush-plans.ts). */
  plan?: "gros" | "moyen" | "large" | "sans-visage";
  /** Les choix de l'utilisateur, qui priment sur l'analyse et lui survivent. */
  decisions: { debut: number; fin: number; etat: "bon" | "masque" }[];
  date: number;
};
export type Asset = {
  wordTimestamps?: boolean;
  transcriptManual?: boolean;
  audioProcessing?: { sourceAssetId: string; settings: Record<string, number> };
  id: string;
  name: string;
  kind: "video" | "audio" | "image";
  size: number;
  duration: number;
  width: number;
  height: number;
  fps: FrameRate;
  codec: string;
  pixelFormat: string;
  bits: number;
  audioChannels: number;
  sampleRate: number;
  color: { primaries: string; transfer: string; matrix: string; range: string };
  inputSpace: string;
  timecode?: string;
  /** L'heure de tournage (ms), lue à l'import ; absente des médias plus anciens. */
  recorded?: number;
  /** La caméra, devinée à l'import (étiquettes, nom du fichier). */
  camera?: string;
  spaceConfirmed?: boolean;
  source: string;
  proxy?: string;
  thumbnail?: string;
  waveform?: number[];
  status: "ready" | "processing" | "error";
  error?: string;
  transcript?: TranscriptSegment[];
  derush?: Derush;
  /** Un dérushage qui a échoué pour cet aperçu (illisible) : pas relancé tant qu'il ne change pas. */
  derushEchec?: {
    marque: string;
    mesure: string;
    message: string;
    date: number;
  };
  analysis?: {
    scenes: number[];
    silences: { start: number; end: number }[];
    /** Les passages qui ressortent nettement de leur contexte sonore. */
    moments?: import("./moments").Moment[];
    brightness: number;
    clipped: number;
  };
  created: number;
};
export type MaskKey = { frame: number; x: number; y: number };
export type Mask = {
  id: string;
  name?: string;
  effect: "blur" | "pixelate" | "solid";
  shape: "rectangle" | "ellipse";
  /** Fractions of the sequence frame; constant for the whole mask. */
  width: number;
  height: number;
  strength: number;
  feather: number;
  color?: string;
  /** Centre of the mask, in sequence fractions, at clip-relative frames. */
  keys: MaskKey[];
  tracked?: { asset: string; from: number; to: number };
};
export type Clip = {
  masks?: Mask[];
  component?: "video" | "audio";
  linkId?: string;
  originalAssetId?: string;
  audioRole?: "voice" | "music" | "ambience" | "effect";
  pan?: number;
  animation?: import("./animation").Animation;
  id: string;
  assetId: string;
  start: number;
  duration: number;
  inUs: number;
  track: number;
  speed: number;
  gain: number;
  muted: boolean;
  opacity: number;
  scale: number;
  x: number;
  y: number;
  rotation: number;
  fadeIn: number;
  fadeOut: number;
  /**
   * Le cadrage vertical retenu pour ce plan : le couple, tout le monde, ou
   * réglé à la main. Absent tant que le plan n'a jamais été recadré.
   */
  reframe?: "tous" | "couple" | "main";
  /** Débruitage appliqué au rendu, du plus léger au plus lent. */
  denoise?: "none" | "light" | "medium" | "strong";
  /** Stabilisation, de 0 à 1. Elle recadre l'image pour compenser. */
  stabilise?: number;
  /** Images intermédiaires calculées, seulement sous 1× de vitesse. */
  smoothSlow?: boolean;
  /** La transition qui ouvre le plan, en images. */
  transition?: { kind: string; duration: number };
  grade: Grade;
};
/**
 * Les transitions proposées, dans l'ordre où elles sont offertes.
 * Cette liste doit rester identique à celle de electron/video/transitions.cjs :
 * un test le vérifie, car un nom qui n'existe pas côté moteur ferait échouer
 * un export entier, à la toute fin, après des heures de rendu.
 */
export const TRANSITIONS = [
  { id: "dissolve", label: "Fondu enchaîné" },
  { id: "fade", label: "Fondu doux" },
  { id: "fadeblack", label: "Fondu par le noir" },
  { id: "fadewhite", label: "Fondu par le blanc" },
  { id: "wipeleft", label: "Volet vers la gauche" },
  { id: "wiperight", label: "Volet vers la droite" },
  { id: "wipeup", label: "Volet vers le haut" },
  { id: "wipedown", label: "Volet vers le bas" },
  { id: "smoothleft", label: "Volet adouci, gauche" },
  { id: "smoothright", label: "Volet adouci, droite" },
  { id: "slideleft", label: "Glissement vers la gauche" },
  { id: "slideright", label: "Glissement vers la droite" },
  { id: "slideup", label: "Glissement vers le haut" },
  { id: "slidedown", label: "Glissement vers le bas" },
  { id: "circleopen", label: "Cercle qui s'ouvre" },
  { id: "circleclose", label: "Cercle qui se ferme" },
  { id: "circlecrop", label: "Iris" },
  { id: "horzopen", label: "Rideau horizontal" },
  { id: "vertopen", label: "Rideau vertical" },
  { id: "diagtl", label: "Diagonale" },
  { id: "radial", label: "Balayage circulaire" },
  { id: "pixelize", label: "Pixelisation" },
  { id: "hblur", label: "Flou de passage" },
  { id: "zoomin", label: "Zoom avant" },
  { id: "squeezeh", label: "Écrasement horizontal" },
  { id: "squeezev", label: "Écrasement vertical" },
] as const;
/** Les niveaux de débruitage, avec leur coût et leur gain mesurés en 1080p. */
export const DENOISE_LEVELS = [
  { id: "none", label: "Aucun", detail: "" },
  { id: "light", label: "Léger", detail: "gratuit, grain seulement" },
  { id: "medium", label: "Moyen", detail: "recommandé · rendu 1,7× plus long" },
  { id: "strong", label: "Fort", detail: "meilleur, mais rendu 90× plus long" },
] as const;
/** Extruded relief for a title, a logo or a shape. */
export type Depth = {
  extrude: number;
  angle: number;
  light: number;
  color?: string;
};
export type Title = {
  depth?: Depth;
  motionOrigin?: number;
  highlight?: { from: number; to: number; color: string };
  motion?: import("./motion").Motion;
  graphic?: {
    kind: "rectangle" | "circle" | "arrow" | "bar";
    width: number;
    height: number;
    fill: string;
    value?: number;
  };
  x?: number;
  fontFamily?: "Arial" | "Georgia" | "Inter" | "monospace";
  fontWeight?: number;
  italic?: boolean;
  align?: "left" | "center" | "right";
  width?: number;
  lineHeight?: number;
  strokeWidth?: number;
  strokeColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  padding?: number;
  rotation?: number;
  opacity?: number;
  shadow?: boolean;
  uppercase?: boolean;
  id: string;
  text: string;
  start: number;
  duration: number;
  size: number;
  y: number;
  color: string;
};
export type CaptionStyle = {
  wordMode?: "none" | "highlight" | "single";
  highlightColor?: string;
  effect?: "none" | "fade" | "rise" | "pop" | "slide";
} & Partial<Omit<Title, "id" | "text" | "start" | "duration">>;
export type Caption = {
  words?: CaptionWord[];
  style?: CaptionStyle;
  id: string;
  text: string;
  start: number;
  duration: number;
};
export type Sequence = {
  captionStyle?: CaptionStyle;
  audioLayoutVersion?: number;
  tracks?: Record<
    string,
    {
      name?: string;
      muted?: boolean;
      solo?: boolean;
      locked?: boolean;
      hidden?: boolean;
      gain?: number;
      pan?: number;
      bus?: import("./audio-mix").AudioBus;
    }
  >;
  buses?: Partial<
    Record<
      import("./audio-mix").AudioBus,
      { gain?: number; muted?: boolean; solo?: boolean }
    >
  >;
  id: string;
  version?: number;
  name: string;
  fps: FrameRate;
  width: number;
  height: number;
  clips: Clip[];
  titles: Title[];
  captions: Caption[];
  markers: { id: string; frame: number; text: string }[];
  masterGain: number;
  /** L'atténuation de la musique sous la voix, calculée au rendu. */
  ducking?: {
    enabled: boolean;
    depth: number;
    attack: number;
    release: number;
    hold: number;
  };
  created: number;
};
/** Les cibles de niveau de livraison, en LUFS. */
export const LOUDNESS_TARGETS = [
  { id: "reseaux", label: "Réseaux sociaux", detail: "-14 LUFS" },
  { id: "podcast", label: "Podcast", detail: "-16 LUFS" },
  { id: "television", label: "Télévision (EBU R128)", detail: "-23 LUFS" },
  { id: "cinema", label: "Cinéma", detail: "-27 LUFS" },
] as const;
export type LoudnessTarget = (typeof LOUDNESS_TARGETS)[number]["id"];
export const DUCKING_DEFAULT = {
  enabled: true,
  depth: 0.65,
  attack: 0.25,
  release: 0.6,
  hold: 0.35,
};
export type VideoProject = {
  id: string;
  name: string;
  photoProjectId: string | null;
  revision: number;
  created: number;
  updated: number;
  assets: Asset[];
  sequences: Sequence[];
  multicam: MulticamGroup[];
  comments: {
    id: string;
    sequenceId: string;
    frame: number;
    text: string;
    resolved: boolean;
    created: number;
  }[];
};
export type VideoJob = {
  unresolvedErrors?: number;
  retryJobId?: string;
  failures?: { index: number; name: string; message: string }[];
  id: string;
  projectId: string;
  kind: string;
  label: string;
  state:
    | "queued"
    | "running"
    | "paused"
    | "interrupted"
    | "done"
    | "failed"
    | "cancelled";
  cursor: number;
  total: number;
  progress: number;
  created: number;
  error?: string;
  errors?: string[];
  result?: string;
};
export type EngineStatus = {
  exports?: {
    id: string;
    label: string;
    extension: string;
    available: boolean;
    error?: string;
  }[];
  error?: string;
  transcriptionError?: string;
  luts: { id: string; name: string; size: number }[];
  available: boolean;
  version: string;
  encoder: string;
  platform: string;
  spaces: { id: string; name: string }[];
  transcription: boolean;
};

export type MulticamGroup = {
  id: string;
  name: string;
  referenceAssetId: string;
  angles: {
    assetId: string;
    offset: number;
    sync?: string;
    estimate?: { offset: number; confidence: number; reliable: boolean };
  }[];
  switches: { time: number; assetId: string }[];
};
