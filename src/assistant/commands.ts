import {
  STYLES,
  editPhoto,
  resetPhoto,
  recoverPhoto,
  type Photo,
  type Adjustments,
} from "../model";
import { validateAdjustments } from "../modules/catalog-validation";
import { angleOf, cadreAuFormat } from "../modules/geometry";
import { correctionDe } from "../modules/level";
export { cadreAuFormat };
export type Scope = "current" | "selection" | "album" | "kept";
export type PhotoAction =
  | {
      kind: "photo.adjust";
      field: string;
      value: number;
      relative: boolean;
      /** « augmente … à N » (1) ou « baisse … à N » (-1) : la cible doit aller dans ce sens. */
      sens?: 1 | -1;
    }
  | { kind: "photo.style"; style: string }
  | { kind: "photo.status"; status: Photo["status"] }
  | { kind: "photo.protect"; value: boolean }
  | { kind: "photo.stars"; value: number }
  | { kind: "photo.original" | "photo.recover" }
  | { kind: "photo.version"; name: string }
  | { kind: "photo.rotate"; degrees: 90 | 180 | 270 }
  | { kind: "photo.straighten"; degrees: number; relative: boolean }
  | { kind: "photo.autostraighten" }
  | { kind: "photo.aspect"; ratio: number };
export type VideoAction =
  | {
      kind: "video.animate";
      field: "x" | "y" | "gain";
      from: number;
      to: number;
      seconds: number;
    }
  | {
      kind: "video.adjust";
      field: string;
      value: number;
      relative: boolean;
      sens?: 1 | -1;
    }
  | { kind: "video.split" | "video.remove" | "video.duplicate" }
  | { kind: "video.seek"; seconds: number }
  | { kind: "video.title"; text: string; seconds: number }
  | { kind: "video.style"; style: string }
  | {
      kind: "video.fade";
      seconds: number;
      /** Sans précision, le fondu d'entrée du plan, comme le dit le guide. */
      bouts?: "entree" | "sortie" | "deux";
    }
  | { kind: "video.mask"; effect: "blur" | "pixelate" | "solid" }
  | { kind: "video.track" }
  | { kind: "video.depth"; extrude: number }
  | {
      kind: "video.trim";
      seconds: number;
      /** « raccourcis de 2 s » : retirer cette durée au lieu de la viser. */
      retire?: boolean;
      /** « raccourcis à 2 s » : la durée visée ne doit pas allonger le plan. */
      raccourcit?: boolean;
    }
  | { kind: "video.transition"; transition: string; seconds: number }
  | { kind: "video.denoise"; level: "none" | "light" | "medium" | "strong" }
  | { kind: "video.stabilise"; strength: number }
  | { kind: "video.smoothslow"; on: boolean }
  | { kind: "video.ducking"; on: boolean; depth?: number }
  | { kind: "video.silence"; minSilence: number }
  | { kind: "video.assemble"; seconds: number; vertical: boolean }
  | {
      kind:
        | "video.caption"
        | "video.analyze"
        | "video.transcribe"
        | "video.autocolor"
        // Le dérushage (PLAN-DERUSHAGE.md) : le lancer, retirer d'un plan
        // ses passages masqués, pré-monter les rushes.
        | "video.derush"
        | "video.unusable"
        | "video.premontage";
    };
export type Action =
  | PhotoAction
  | VideoAction
  | {
      kind:
        | "history.undo"
        | "history.redo"
        | "view.original"
        | "view.edit"
        | "export.open"
        | "lightroom.open"
        | "import.open";
    }
  | { kind: "album.process"; style: string }
  | { kind: "media.search"; query: string };
export type Plan = {
  id: string;
  text: string;
  actions: Action[];
  scope: Scope;
  label: string;
  explanation: string;
  source: "text" | "voice";
};
/**
 * Une consigne comprise, mais qu'on ne peut pas exécuter.
 *
 * Le pilote confie au modèle de langue toute consigne que ce lecteur refuse.
 * Pour celles-ci, c'est inutile et lent : le modèle ne ferait que la
 * reformuler vers une action qui n'existe pas. Le pilote la rend telle quelle.
 */
export class Refus extends Error {}
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export const PHOTO_FIELDS: Record<
  string,
  { names: string; min: number; max: number; unit: string }
> = {
  exposure: {
    names: "exposition|expo|luminosite",
    min: -4,
    max: 4,
    unit: "IL",
  },
  contrast: { names: "contraste", min: -100, max: 100, unit: "%" },
  highlights: { names: "hautes lumieres", min: -100, max: 100, unit: "%" },
  shadows: { names: "ombres", min: -100, max: 100, unit: "%" },
  warmth: { names: "chaleur|temperature", min: -100, max: 100, unit: "%" },
  tint: { names: "teinte", min: -100, max: 100, unit: "%" },
  saturation: { names: "saturation", min: -100, max: 100, unit: "%" },
  vibrance: { names: "vibrance", min: -100, max: 100, unit: "%" },
  clarity: { names: "clarte", min: -100, max: 100, unit: "%" },
  whites: { names: "blancs", min: -100, max: 100, unit: "%" },
  blacks: { names: "noirs", min: -100, max: 100, unit: "%" },
  sharpening: { names: "nettete", min: 0, max: 100, unit: "%" },
  noiseReduction: {
    names: "reduction du bruit|debruitage",
    min: 0,
    max: 100,
    unit: "%",
  },
  intensity: { names: "intensite", min: 0, max: 100, unit: "%" },
  grain: { names: "grain", min: 0, max: 100, unit: "%" },
  vignette: { names: "vignettage", min: -100, max: 100, unit: "%" },
  fade: { names: "noirs adoucis", min: 0, max: 100, unit: "%" },
  straighten: { names: "redressement|inclinaison", min: -45, max: 45, unit: "°" },
};
export function applyPhotoAction(
  photo: Photo,
  action: PhotoAction,
  group?: string,
): Photo {
  switch (action.kind) {
    case "photo.adjust": {
      const field = PHOTO_FIELDS[action.field];
      if (!field || !Number.isFinite(action.value))
        throw Error("Réglage inconnu.");
      const value =
        action.value +
        (action.relative
          ? Number(
              (photo.adjustments as unknown as Record<string, unknown>)[
                action.field
              ] || 0,
            )
          : 0);
      if (value < field.min || value > field.max)
        throw Error(
          `${action.field} : valeur hors limites (${field.min} à ${field.max} ${field.unit}).`,
        );
      if (action.sens && !action.relative) {
        const actuel = Number(
          (photo.adjustments as unknown as Record<string, unknown>)[
            action.field
          ] || 0,
        );
        if ((value - actuel) * action.sens < 0)
          throw Error(sensContraire(actuel, value, action.sens));
      }
      const patch = { [action.field]: value } as Partial<Adjustments>;
      // Un redressement nul s'efface : une photo remise droite ne doit pas
      // compter comme retouchée.
      if (action.field === "straighten")
        patch.straighten = Math.round(value * 100) / 100 || undefined;
      validateAdjustments({ ...photo.adjustments, ...patch });
      return editPhoto(photo, patch, group);
    }
    case "photo.style":
      if (!STYLES.some((s) => s.id === action.style))
        throw Error("Style introuvable.");
      return editPhoto(photo, { style: action.style, intensity: 100 }, group);
    case "photo.status":
      if (!["pending", "keep", "reject"].includes(action.status))
        throw Error("Classement inconnu.");
      if (photo.protected && action.status === "reject")
        throw Error(
          "Une photo est protégée. Retirez-la de la sélection pour l’écarter.",
        );
      return { ...photo, status: action.status };
    case "photo.protect":
      return { ...photo, protected: action.value };
    case "photo.stars":
      if (
        !Number.isInteger(action.value) ||
        action.value < 0 ||
        action.value > 5
      )
        throw Error("Choisissez de 0 à 5 étoiles.");
      return { ...photo, stars: action.value };
    case "photo.rotate": {
      const rotation =
        (((photo.adjustments.rotation + action.degrees) % 360) + 360) % 360;
      return editPhoto(photo, { rotation }, group);
    }
    case "photo.straighten": {
      const t =
        Math.round(
          ((action.relative ? angleOf(photo.adjustments) : 0) + action.degrees) *
            100,
        ) / 100;
      if (!Number.isFinite(t) || Math.abs(t) > 45)
        throw Error("Redressement hors limites : de −45 à 45 degrés.");
      return editPhoto(photo, { straighten: t || undefined }, group);
    }
    case "photo.autostraighten": {
      // Sans lignes fiables, la photo reste telle quelle : sur un album, une
      // photo sans repère ne doit pas faire échouer les autres.
      const t = correctionDe(photo.analysis?.level, ["auto", "suggest", "level"]);
      if (t === undefined) return photo;
      return editPhoto(photo, { straighten: t || undefined }, group);
    }
    case "photo.aspect": {
      if (!action.ratio)
        return editPhoto(photo, { cropRect: undefined, crop: 0 }, group);
      if (!photo.width || !photo.height)
        throw Error("Dimensions de la photo inconnues : recadrage impossible.");
      // Le cadre s'écrit dans le repère redressé : sur une photo inclinée,
      // le plus grand cadre au format voulu est celui sans coin vide.
      const cropRect = cadreAuFormat(
        photo.width,
        photo.height,
        photo.adjustments.rotation,
        action.ratio,
        angleOf(photo.adjustments),
      );
      validateAdjustments({ ...photo.adjustments, cropRect, crop: 0 });
      return editPhoto(photo, { cropRect, crop: 0 }, group);
    }
    case "photo.original":
      return resetPhoto(photo);
    case "photo.recover":
      return recoverPhoto(photo);
    case "photo.version":
      if (!action.name.trim()) throw Error("Nommez la version.");
      if ((photo.versions?.length || 0) >= 20)
        throw Error("Cette photo contient déjà 20 versions nommées.");
      return {
        ...photo,
        versions: [
          ...(photo.versions || []),
          {
            id: crypto.randomUUID(),
            name: action.name.slice(0, 80),
            created: Date.now(),
            adjustments: structuredClone(photo.adjustments),
          },
        ],
      };
  }
}

const chiffre = (n: number) =>
  String(Math.round(n * 100) / 100).replace(".", ",");
/**
 * « baisse … à 0,5 » sur une valeur déjà à 0,2 la ferait monter : le verbe et
 * la cible se contredisent, on ne choisit pas à la place du photographe.
 */
export function sensContraire(actuel: number, cible: number, sens: 1 | -1) {
  return `La valeur actuelle (${chiffre(actuel)}) est déjà ${sens > 0 ? "au-dessus" : "au-dessous"} de ${chiffre(cible)} : ${sens > 0 ? "l’augmenter" : "la baisser"} à ${chiffre(cible)} la ferait ${sens > 0 ? "baisser" : "monter"}. Rien n’a été modifié.`;
}
function numbers(s: string) {
  const words: Record<string, string> = {
    zero: "0",
    un: "1",
    une: "1",
    deux: "2",
    trois: "3",
    quatre: "4",
    cinq: "5",
    six: "6",
    sept: "7",
    huit: "8",
    neuf: "9",
    dix: "10",
    onze: "11",
    douze: "12",
    treize: "13",
    quatorze: "14",
    quinze: "15",
    seize: "16",
    vingt: "20",
    trente: "30",
    quarante: "40",
    cinquante: "50",
    soixante: "60",
    cent: "100",
  };
  return s
    .replace(
      /\b(moins|plus)\s+(?=\d|zero|un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)/g,
      (_, a) => (a === "moins" ? "-" : "+"),
    )
    .replace(
      new RegExp("\\b(" + Object.keys(words).join("|") + ")\\b", "g"),
      (a) => words[a],
    )
    .replace(/(\d)\s+virgule\s+(\d)/g, "$1.$2")
    .replace(/(\d),(\d)/g, "$1.$2");
}
const textNumber = "([+-]?\\d+(?:\\.\\d+)?)";
const numberIn = (s: string) => {
  const m = s.match(/[+-]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};
/**
 * Les unités de durée comprises, millisecondes comprises (« 500 ms »), et
 * « secs », l'abréviation qu'on tape vite.
 */
const UNITE = "(?:millisecondes?|ms|secondes?|secs?|s|minutes?|min)";
const durationIn = (s: string, fallback = 60) => {
  const m = s.match(
    /(\d+(?:\.\d+)?)\s*(millisecondes?|ms|minutes?|min|secondes?|secs?|s)\b/,
  );
  if (!m) return fallback;
  const n = Number(m[1]);
  return /^(ms|milli)/.test(m[2]) ? n / 1000 : /^min/.test(m[2]) ? n * 60 : n;
};
/**
 * Les verbes qui ouvrent un réglage photo ou vidéo, rangés par sens.
 *
 * « monte », « remonte » et « descends » sont ceux qu'on emploie en parlant,
 * et ils manquaient : chaque tournure refusée ici réveille le modèle de
 * langue de deux giga-octets, ce qui prend plusieurs secondes pour rien.
 * Ils avaient ensuite été acceptés sans leur sens : « descends le contraste
 * de 10 » le mettait à +10. Le sens se lit désormais dans ces deux listes, et
 * nulle part ailleurs.
 */
const VERBES_HAUSSE = "augmente|monte|remonte";
// « réduis » est l'impératif qu'on dit ; « descend », l'orthographe que la
// dictée donne souvent.
const VERBES_BAISSE = "baisse|abaisse|descends|descend|diminue|reduis|reduit";
const VERBES_REGLAGE =
  "regle|mets|fixe|" + VERBES_HAUSSE + "|" + VERBES_BAISSE;
const VERBE_EN_TETE = new RegExp("^(" + VERBES_REGLAGE + ")\\b");
function sensDuVerbe(verbe?: string): 1 | -1 | 0 {
  if (!verbe) return 0;
  if (new RegExp("^(?:" + VERBES_BAISSE + ")$").test(verbe)) return -1;
  if (new RegExp("^(?:" + VERBES_HAUSSE + ")$").test(verbe)) return 1;
  return 0;
}
/**
 * « baisse le contraste de 10 » retire 10 ; « baisse le contraste à 10 » le
 * règle à 10. Le verbe ne donne que le sens : c'est le connecteur qui dit
 * s'il s'agit d'un écart ou d'une valeur cible. La cible garde le sens du
 * verbe, vérifié au moment d'appliquer, quand la valeur actuelle est connue.
 */
function reglage(
  verbe: string | undefined,
  connecteur: string | undefined,
  valeur: number,
): { value: number; relative: boolean; sens?: 1 | -1 } {
  const sens = sensDuVerbe(verbe);
  if (!sens) return { value: valeur, relative: false };
  if (connecteur === "a" || connecteur === "=")
    return { value: valeur, relative: false, sens };
  return { value: sens < 0 ? -Math.abs(valeur) : valeur, relative: true };
}
/** Les noms des réglages vidéo, tels qu'on les dit. */
const NOMS_VIDEO: Record<string, string> = {
  gain: "volume|gain",
  opacity: "opacite",
  scale: "echelle|zoom",
  rotation: "rotation",
  speed: "vitesse",
  exposure: "exposition|expo",
  saturation: "saturation",
  contrast: "contraste",
};
/**
 * Un réglage sans verbe, suivi de « de », « à » ou « = » : dans « baisse les
 * ombres de 20 et hautes lumières de 10 », c'est la seconde moitié, qui
 * reprend le verbe de la première.
 */
const REGLAGE_SANS_VERBE = {
  photo: new RegExp(
    "^(?:(?:l|le|la|les) )?(?:" +
      Object.values(PHOTO_FIELDS)
        .map((f) => f.names)
        .join("|") +
      ") (?:a|de|=) ",
  ),
  video: new RegExp(
    "^(?:(?:l|le|la) )?(?:" + Object.values(NOMS_VIDEO).join("|") + ") (?:a|de|=) ",
  ),
};
/** Les suffixes de portée qu'on retire d'une consigne. */
const PORTEE_FINALE =
  "(?:toutes les photos|tout l album|cet album|l album|la selection|les photos selectionnees|les photos gardees|cette photo|la photo active|l element actif|ce plan|le plan actif|tous les plans|toute la sequence|tout le projet)";
/**
 * Un nom de style tel qu'on le dit : « noir et blanc » pour « Noir & blanc »,
 * « signature » pour « Juno Signature ».
 */
const nomDeStyle = (s: string) =>
  normalize(s)
    .replace(/\s*&\s*/g, " et ")
    .replace(/^juno /, "");
export function styleNomme(demande: string) {
  const d = nomDeStyle(demande);
  return STYLES.find((s) => nomDeStyle(s.name) === d || s.id === d);
}
/**
 * Ce que l'on cherche, tel qu'il a été écrit.
 *
 * La requête était reprise du texte normalisé : « Cérémonie » devenait
 * « ceremonie », qui ne se trouve pas dans « Cérémonie-01.jpg ». On part donc
 * du texte brut, dont on retire seulement le verbe, la portée finale et la
 * ponctuation.
 */
function requeteDe(raw: string) {
  const q = raw
    .trim()
    .replace(
      /^(?:(?:juno|peux[- ]tu|merci de|s['’ ]il te pla[iî]t)[\s,]+)*(?:cherche|recherche|trouve)\s+/i,
      "",
    )
    .replace(/[\s,.!?;:]+$/, "");
  const mots = q.split(/\s+/);
  const portee = new RegExp("^(?:sur|pour|a|dans) " + PORTEE_FINALE + "$");
  for (let n = Math.min(5, mots.length - 1); n >= 2; n--)
    if (portee.test(normalize(mots.slice(-n).join(" ")))) {
      mots.splice(-n);
      break;
    }
  return mots
    .join(" ")
    .replace(/^["«“]\s*/, "")
    .replace(/\s*["»”]$/, "")
    .normalize("NFC");
}
/**
 * Le début de phrase accepté, **dérivé** des noms de réglages.
 *
 * Il était recopié à la main, et les deux listes avaient divergé :
 * « débruitage », « luminosité » et « température » étaient annoncés comme
 * synonymes et refusés à l'usage. Un nom déclaré est désormais accepté par
 * construction.
 */
const DEBUT_RECONNU = new RegExp(
  "^(?:" +
    VERBES_REGLAGE +
    "|" +
    Object.values(PHOTO_FIELDS)
      .flatMap((f) => f.names.split("|"))
      .sort((a, b) => b.length - a.length)
      .join("|") +
    ")\\b",
);
/**
 * Tourner par quart de tour, ou redresser de quelques degrés. « à droite »
 * s'entend dans le sens des aiguilles d'une montre, comme dans tous les
 * logiciels photo.
 */
// « un » y est déjà devenu « 1 » : `numbers()` passe avant ce motif.
const ROTATION =
  /^(?:fais )?(?:pivote|pivoter|tourne|tourner)(?: la photo| l image| les photos)?(?:(?: de)? (-?\d+(?:\.\d+)?) ?(?:°|degres?)?| d (?:un|1) (quart|demi)(?: de)?[ -]tour)?(?: (?:vers la |a |sur la )?(droite|gauche))?$/;
function rotationDe(part: string): PhotoAction {
  const m = ROTATION.exec(part)!;
  if (!m[1] && !m[2] && !m[3])
    throw new Refus(
      "Précisez l’angle (90, 180 ou 270 degrés) ou le sens (à droite, à gauche). Rien n’a été modifié.",
    );
  const sens = m[3] === "gauche" ? -1 : 1;
  const base = m[1] ? Number(m[1]) : m[2] === "demi" ? 180 : 90;
  const angle = base * sens;
  // Quelques degrés : c'est un redressement, qui s'ajoute au précédent.
  if (angle % 90 !== 0 && Math.abs(angle) <= 45)
    return { kind: "photo.straighten", degrees: angle, relative: true };
  if (angle % 90 !== 0)
    throw new Refus(
      "Au-delà de 45 degrés, Juno tourne une photo par quart de tour : 90, 180 ou 270 degrés. Rien n’a été modifié.",
    );
  const r = ((angle % 360) + 360) % 360;
  if (r === 0) throw new Refus("Un tour complet ne change rien. Rien n’a été modifié.");
  return { kind: "photo.rotate", degrees: r as 90 | 180 | 270 };
}
/**
 * « redresse la photo » : l'angle mesuré sur les lignes. « redresse de 2
 * degrés à gauche » : un angle donné, ajouté au redressement actuel.
 */
const REDRESSE =
  /^(?:redresse|redresser|remets? droite?|mets? droite?|remets? d aplomb)(?: la photo| l image| les photos| l horizon| les verticales)?(?: (?:de )?(-?\d+(?:\.\d+)?) ?(?:°|degres?)?(?: (?:vers la |a |sur la )?(droite|gauche))?)?$/;
function redressementDe(part: string): PhotoAction {
  const m = REDRESSE.exec(part)!;
  if (!m[1]) return { kind: "photo.autostraighten" };
  const degres = Number(m[1]) * (m[2] === "gauche" ? -1 : 1);
  if (Math.abs(degres) > 45)
    throw new Refus("Un redressement se limite à 45 degrés. Rien n’a été modifié.");
  return { kind: "photo.straighten", degrees: degres, relative: true };
}
/** « recadre en 16/9 », « au format 4:5 », « recadre au carré ». */
const FORMAT =
  /^(?:recadre|recadrer|cadre|mets|passe)(?: la photo| l image| les photos)? (?:en|au)(?: format)? (?:(\d+(?:[.,]\d+)?) ?[/:x] ?(\d+(?:[.,]\d+)?)|carre)$/;
const SANS_RECADRAGE =
  /^(?:enleve|retire|supprime|annule|efface)(?: le| les)? recadrages?$/;
function formatDe(part: string): number {
  const m = FORMAT.exec(part)!;
  const ratio = m[1]
    ? Number(m[1].replace(",", ".")) / Number(m[2].replace(",", "."))
    : 1;
  if (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 5)
    throw new Refus("Ce format est trop étiré pour une photo. Rien n’a été modifié.");
  return ratio;
}
/**
 * « mets un fondu » : le fondu d'entrée du plan, comme l'annonce le guide ;
 * « des fondus » : entrée et sortie ; « un fondu de sortie » : la fin seule.
 * Les deux fondus étaient posés à chaque fois, avec un passage au noir en
 * fin de plan que personne n'avait demandé.
 */
const BOUT = "(d entree|en entree|au debut|de sortie|en sortie|a la fin|de fin)";
const FONDU = new RegExp(
  "^(?:ajoute|mets|pose) (?:un |1 |des |les )?(fondus?)(?: " +
    BOUT +
    ")?(?: (?:de|d) (\\d+(?:\\.\\d+)?) ?" +
    UNITE +
    ")?(?: " +
    BOUT +
    ")?$",
);
function fonduDe(part: string): VideoAction {
  const m = FONDU.exec(part)!;
  const bout = m[2] || m[4];
  return {
    kind: "video.fade",
    seconds: m[3] ? durationIn(part, 0.5) : 0.5,
    bouts: bout
      ? /entree|debut/.test(bout)
        ? "entree"
        : "sortie"
      : m[1] === "fondus"
        ? "deux"
        : "entree",
  };
}
/**
 * Une transition, son motif, son sens et sa durée.
 *
 * Le motif seul était lu : « un volet vers la droite » donnait un volet vers
 * la gauche, et le reste de la phrase était ignoré sans le dire. Une
 * précision que Juno ne sait pas poser est désormais refusée.
 */
const DUREE_TRANSITION = "(?: (?:de|d|en|sur) (\\d+(?:\\.\\d+)?) ?" + UNITE + ")?";
const TRANSITION = new RegExp(
  "^(?:mets|ajoute|pose) (?:un |une |1 )?(fondu enchaine|transition|volet adouci|volet|glissement|cercle|iris|rideau|diagonale|zoom avant)" +
    "(?: (horizontal|vertical))?" +
    "(?: (?:qui )?(?:(s ouvre|s ouvrant|ouvrant)|(se ferme|se referme|se refermant|fermant)))?" +
    DUREE_TRANSITION +
    "(?: (?:vers la |vers le |a |sur la |par la |par le )?(droite|gauche|haut|bas))?" +
    DUREE_TRANSITION +
    "$",
);
const DEBUT_TRANSITION =
  /^(?:mets|ajoute|pose) (?:un |une |1 )?(fondu enchaine|transition|volet|glissement|cercle|iris|rideau|diagonale|zoom avant)\b/;
function transitionDe(part: string): VideoAction {
  const m = TRANSITION.exec(part);
  if (!m)
    throw Error(
      "Transition non reconnue : « " +
        part +
        " ». Dites par exemple « mets un volet vers la droite de 1 seconde » ou « mets un cercle qui se ferme ». Rien n’a été modifié.",
    );
  const [, motif, axe, ouvre, ferme, avant, sens, apres] = m;
  const refus = () =>
    new Refus(
      "Cette transition n’existe pas dans ce sens. Choisissez-la dans l’inspecteur du plan pour voir les variantes. Rien n’a été modifié.",
    );
  let transition: string;
  if (motif === "volet" || motif === "glissement" || motif === "volet adouci") {
    if (axe || ouvre || ferme) throw refus();
    const cote = { gauche: "left", droite: "right", haut: "up", bas: "down" }[
      sens || "gauche"
    ]!;
    if (motif === "volet adouci" && (sens === "haut" || sens === "bas"))
      throw refus();
    transition =
      (motif === "volet" ? "wipe" : motif === "glissement" ? "slide" : "smooth") +
      cote;
  } else if (motif === "cercle") {
    if (axe || sens) throw refus();
    transition = ferme ? "circleclose" : "circleopen";
  } else if (motif === "rideau") {
    if (sens || ouvre || ferme) throw refus();
    transition = axe === "vertical" ? "vertopen" : "horzopen";
  } else {
    if (axe || sens || ouvre || ferme) throw refus();
    transition =
      motif === "iris"
        ? "circlecrop"
        : motif === "diagonale"
          ? "diagtl"
          : motif === "zoom avant"
            ? "zoomin"
            : "dissolve";
  }
  // Sans durée précisée, une seconde : le repli de 60 s de `durationIn`
  // donnait une transition de près de 10 s, refusée sur tout plan court.
  return {
    kind: "video.transition",
    transition,
    seconds: avant || apres ? durationIn(part, 1) : 1,
  };
}
/** Les plans visés, dits en toutes lettres après un verbe de retouche vidéo. */
const PLANS = "(?: (?:l image|ce plan|le plan|la video|les plans|tous les plans|toute la sequence))?";
/** Les nuances dites à la place d'un chiffre. « un peu » y est déjà « legerement ». */
const NUANCE = "(?: (legerement|leger|legere|moyen|fort|forte|fortement|maximum|maxi|au maximum|a fond))?";
const leger = (n?: string) => !!n && /^leg/.test(n);
const fort = (n?: string) => !!n && /^(fort|max|au max|a fond)/.test(n);
const DEBUT_DEBRUITAGE =
  /^(?:debruite|debruiter|nettoie|nettoyer|enleve le bruit|retire le bruit|reduis le bruit|supprime le bruit)\b/;
/**
 * Le débruitage vidéo agit sur l'image : « nettoie le son » ou « enlève le
 * bruit de fond » posaient un débruitage d'image, et le son restait bruité.
 */
function debruitageDe(part: string): VideoAction {
  if (/\b(son|sons|audio|voix|bruit de fond|souffle|vent|micro|parole)\b/.test(part))
    throw new Refus(
      "Le débruitage de Juno agit sur l’image, pas sur le son. Nettoyez le son dans votre logiciel audio. Rien n’a été modifié.",
    );
  const m = new RegExp(
    "^(?:debruite|debruiter|nettoie|nettoyer|enleve le bruit|retire le bruit|reduis le bruit|supprime le bruit)" +
      PLANS +
      NUANCE +
      PLANS +
      "$",
  ).exec(part);
  if (!m)
    throw Error(
      "Consigne vidéo non reconnue : « " +
        part +
        " ». Dites « débruite ce plan », « débruite légèrement » ou « débruite fort ». Rien n’a été modifié.",
    );
  return {
    kind: "video.denoise",
    level: fort(m[1]) ? "strong" : leger(m[1]) ? "light" : "medium",
  };
}
/**
 * La force de stabilisation : un nombre seulement dans « à 80 » ou « de 80 % ».
 * Le premier nombre de la phrase servait : « stabilise les deux plans »
 * stabilisait à 2 %, « stabilise un peu » à 1 %.
 */
function stabilisationDe(part: string): VideoAction {
  const m = new RegExp(
    "^(?:stabilise|stabiliser)" +
      PLANS +
      "(?: (?:a|de) (\\d+(?:\\.\\d+)?) ?%?)?" +
      NUANCE +
      PLANS +
      "$",
  ).exec(part);
  if (!m)
    throw Error(
      "Consigne vidéo non reconnue : « " +
        part +
        " ». Dites « stabilise ce plan » ou « stabilise à 80 ». Rien n’a été modifié.",
    );
  const force = m[1] !== undefined ? Number(m[1]) : fort(m[2]) ? 90 : leger(m[2]) ? 30 : 60;
  if (force > 100)
    throw new Refus("La stabilisation va de 0 à 100. Rien n’a été modifié.");
  return { kind: "video.stabilise", strength: force / 100 };
}
/**
 * L'atténuation de la musique, en dB comme dans le panneau Son.
 *
 * « baisse la musique de 6 dB » réglait une profondeur de 0,06, soit
 * environ -0,5 dB : la consigne en décibels était lue comme un pourcentage.
 */
function attenuationDe(part: string): VideoAction {
  const db = /(\d+(?:\.\d+)?) ?(?:db|decibels?)\b/.exec(part),
    pc = /(\d+(?:\.\d+)?) ?%/.exec(part);
  let depth: number | undefined;
  if (db) {
    const n = Number(db[1]);
    if (!(n > 0) || n > 26)
      throw new Refus(
        "La musique peut baisser de 1 à 26 dB sous la voix. Rien n’a été modifié.",
      );
    depth = Math.round((1 - Math.pow(10, -n / 20)) * 1000) / 1000;
  } else if (pc) {
    const n = Number(pc[1]);
    if (!(n > 0) || n > 95)
      throw new Refus(
        "La musique peut baisser de 1 à 95 % sous la voix. Rien n’a été modifié.",
      );
    depth = n / 100;
  } else if (/\d/.test(part))
    throw new Refus(
      "Précisez l’atténuation en dB, par exemple « baisse la musique de 6 dB ». Rien n’a été modifié.",
    );
  return { kind: "video.ducking", on: true, depth };
}
/**
 * Un nombre qui compte ou numérote des plans, et non une durée : « des deux
 * plans », « les 2 derniers plans », « du plan 2 ».
 */
const NOM_DE_PLAN = "(?:plans?|clips?|rushs?|rushes|videos?|medias?|sequences?)";
const COMPTE_DE_PLANS = new RegExp(
  "^ ?(?:(?:premiers?|derniers?|autres?|prochains?|suivants?|precedents?) )?" +
    NOM_DE_PLAN +
    "(?![a-z])",
);
const NUMERO_DE_PLAN = new RegExp("(?:^| )" + NOM_DE_PLAN + " (?:(?:n|no|numero) ?°? ?)?$");
/** Les unités de durée d'un blanc, et ce qu'elles valent en secondes. */
const UNITE_BLANC = /^ ?(millisecondes?|ms|minutes?|min|secondes?|secs?|s)(?![a-z])/;
/** Une unité qui n'est pas une durée : le nombre qui la porte n'est pas un seuil. */
const AUTRE_UNITE =
  /^ ?(?:h|heures?|images?|i|ips|fps|frames?|trames?|%|db|decibels?|px|pixels?|fois|etoiles?|photos?)(?![a-z])/;
/**
 * « de moins de 2 » : les blancs courts. Juno retire les blancs longs, ceux
 * qui dépassent une durée minimale ; « de moins de 2 » était lu comme « de
 * plus de 2 », l'inverse de la demande. « au plus 2 » y arrive en « au +2 »
 * et « moins 2 » en « -2 » : `numbers()` en fait des nombres signés.
 */
const BLANCS_COURTS = new RegExp(
  // Avant le nombre : « de moins de 2 », « jusqu'à 2 », « inférieurs à 2 »…
  "(?:^| )(?:moins (?:de|d)|au plus|au \\+|inferieurs? a|plus courts? que|en dessous (?:de|d)|en deca (?:de|d)|jusqu ?a|sous|-) ?(?=[+-]?\\d)" +
    // … ou après : « 2 secondes maximum », « 1 s max », « 1 seconde au plus »,
    // « d'une seconde ou moins ».
    "|\\d(?:\\.\\d+)? ?(?:[a-z]+ )?(?:maximum|max|au plus|au \\+|ou moins)(?![a-z])",
);
/**
 * Un nombre suivi d'un nom qui n'est pas une durée (« pour 1 rythme plus
 * serré », « dans 1 interview ») : c'est l'article « un / une » que
 * `numbers()` a changé en 1, ou un compte, pas un seuil. Il posait en silence
 * un seuil de 1 s (relecture du 29/09/2026). Un mot de liaison après le
 * nombre (« de plus de 2 dans l'interview ») le laisse seul : c'est un seuil.
 */
const LIAISON =
  /^ (?:dans|sur|pour|par|et|ou|puis|du|de|des|d|a|au|aux|en|avec|sans|la|le|les|l|ce|cet|cette|ces|qui|que|minimum|mini|environ)(?![a-z])/;
const PRECISEZ_BLANCS =
  "Précisez la durée minimale des blancs en secondes, par exemple « retire les blancs de plus de 1 seconde ». Rien n’a été modifié.";
/**
 * Les blancs à retirer : la durée minimale reste dans ce que Juno sait faire.
 * Une demande de 10 s était ramenée en silence à 4 s, et des blancs que
 * personne ne visait étaient coupés.
 *
 * Tout nombre de la consigne est cette durée minimale, en secondes sans
 * unité, l'unité du panneau : « dépassant 2 », « dès 2 », « minimum 2 » ou
 * « (2) » valent 2 s. Seuls quelques mots d'introduction étaient reconnus,
 * et les autres tournures donnaient 0,6 s sans un mot : le blanc d'une
 * seconde qu'on voulait garder partait avec les autres (relecture du
 * 29/09/2026). Un nombre qui compte des plans n'est pas une durée. Une
 * fourchette, ou deux nombres, sont refusés : on ne choisit pas lequel vaut.
 */
function blancsDe(part: string): VideoAction {
  const reste = part
    .replace(/^(?:retire|supprime|enleve|coupe) les (?:blancs|silences)/, "")
    // « au moins 2 » y arrive en « au -2 » : `numbers()` lit « moins 2 »
    // comme un nombre négatif.
    .replace(/\bau -(?=\d)/g, "au ")
    // Les fractions dites en mots : « une demi-seconde », « un quart de
    // seconde », « trois dixièmes de seconde ».
    .replace(/\b1 demie?[- ]?(?:secondes?|s)\b/g, "0.5 s")
    .replace(/\b1 quart (?:de|d) ?(?:secondes?|s)\b/g, "0.25 s")
    .replace(/\b(\d+) dixiemes? (?:de|d) ?(?:secondes?|s)\b/g, (_, n) => String(Number(n) / 10) + " s");
  if (BLANCS_COURTS.test(reste))
    throw new Refus(
      "Juno retire les blancs longs, ceux qui dépassent une durée minimale ; il ne sait pas retirer seulement les blancs courts. Dites par exemple « retire les blancs de plus de 2 secondes ». Rien n’a été modifié.",
    );
  const durees: number[] = [];
  for (const m of reste.matchAll(/[+-]?\d+(?:\.\d+)?/g)) {
    const avant = reste.slice(0, m.index),
      apres = reste.slice(m.index + m[0].length);
    // « des deux plans », « sur 3 plans » : le compte des plans visés. « de 2
    // plans » pourrait être un seuil mal tapé : on ne devine pas.
    if (COMPTE_DE_PLANS.test(apres)) {
      if (/(?:^| )d(?:e)? ?$/.test(avant)) throw new Refus(PRECISEZ_BLANCS);
      continue;
    }
    if (NUMERO_DE_PLAN.test(avant)) continue;
    const unite = UNITE_BLANC.exec(apres)?.[1];
    if (!unite && /^ [a-z]/.test(apres) && !LIAISON.test(apres) && !AUTRE_UNITE.test(apres)) continue;
    // « 2 heures », « 25 images », ou un nombre pris dans un nom (« c12 »).
    if (!unite && (AUTRE_UNITE.test(apres) || /^[a-z%]/.test(apres) || /[a-z]$/.test(avant)))
      throw new Refus(PRECISEZ_BLANCS);
    const n = Number(m[0]);
    durees.push(!unite ? n : /^(ms|milli)/.test(unite) ? n / 1000 : /^min/.test(unite) ? n * 60 : n);
  }
  if (durees.length > 1)
    throw new Refus(
      /\bentre\b/.test(reste) || /\d(?: ?[a-z]+)? ?(?:a|ou|et|-) ?[+-]?\d/.test(reste)
        ? "Une fourchette n’est pas prise en charge : Juno retire tous les blancs plus longs qu’une durée minimale. Donnez une seule durée, par exemple « retire les blancs de plus de 2 secondes ». Rien n’a été modifié."
        : PRECISEZ_BLANCS,
    );
  const secondes = durees.length ? durees[0] : 0.6;
  if (secondes < 0.2 || secondes > 4)
    throw new Refus(
      "Juno retire les blancs de 0,2 à 4 secondes. Pour des blancs plus longs, coupez-les à la main. Rien n’a été modifié.",
    );
  return { kind: "video.silence", minSilence: secondes };
}
/**
 * « raccourcis de 2 s » retire 2 s ; « raccourcis à 2 s » vise 2 s ; « règle
 * la durée à 2 s » vise 2 s. Les deux premières donnaient la même chose : un
 * plan de 20 s passait à 2 s au lieu de 18.
 */
const DUREE_PLAN = new RegExp(
  "^(?:(raccourcis)(?: le plan| ce plan)?|regle la duree(?: du plan)?|duree(?: du plan)?) (a|de) \\d+(?:\\.\\d+)? ?" +
    UNITE +
    "$",
);
function dureeDe(part: string): VideoAction {
  const m = DUREE_PLAN.exec(part)!;
  const seconds = durationIn(part, -1);
  if (!m[1]) return { kind: "video.trim", seconds };
  return m[2] === "de"
    ? { kind: "video.trim", seconds, retire: true }
    : { kind: "video.trim", seconds, raccourcit: true };
}
/** Les mots qui nient ou exceptent, dans un texte normalisé. */
const NEGATION =
  /\b(?:non|ne|n|pas|sauf|hors|hormis|except\w*|sans|ni|aucune?s?|jamais|a part|autres? que|en dehors|a l exclusion|exclu\w*|(?<!au )moins (?:les?|la|l|des|celles?|ceux))\b/;
/** La phrase nie-t-elle ou excepte-t-elle quelque chose ? Les guillemets n'en disent rien. */
export const contientNegation = (raw: string) =>
  NEGATION.test(normalize(raw.replace(/["«“][^"»”]+["»”]/g, " ")));
/**
 * La cible nommée dans la phrase, ou rien si elle n'en nomme aucune.
 *
 * « cette photo » et « ce plan » désignent l'élément actif, quelle que soit
 * la portée laissée dans le panneau : « supprime ce plan » en portée « Tout
 * le projet » vidait la timeline, « écarte cette photo » écartait l'album.
 * Le pilote la relit aussi sur la phrase d'origine quand celle-ci passe par
 * l'IA locale : la reformulation (« Écarte ») ne la répète pas, et elle était
 * relue avec la portée du panneau. Ce qui est entre guillemets est un titre
 * ou un nom, jamais une cible.
 *
 * Une négation ou une exception retourne la cible : « écarte les photos non
 * gardées » écartait les photos gardées, parce que « gardées » y était lu
 * seul (relecture du 29/09/2026). Savoir à quoi elle s'applique demanderait
 * de comprendre la phrase ; une cible nommée dans une phrase qui nie ou
 * excepte est donc refusée, et jamais remplacée par celle du panneau, qui
 * peut être justement la cible contraire.
 */
export function cibleDite(raw: string): Scope | undefined {
  const text = normalize(raw.replace(/["«“][^"»”]+["»”]/g, " "));
  const explicite: Scope | undefined =
    /\b(album|tout le projet|toutes les photos|tous les plans|toute la sequence)\b/.test(
      text,
    )
      ? "album"
      : /\b(gardees|photos gardees)\b/.test(text)
        ? "kept"
        : /\b(selection|selectionne[es]*)\b/.test(text)
          ? "selection"
          : undefined;
  const ici = /\b(cette photo|ce plan|la photo active|le plan actif|l element actif)\b/.test(
    text,
  );
  if ((ici || explicite) && NEGATION.test(text))
    throw new Refus(
      "Cette consigne nomme sa cible avec une négation ou une exception (« non gardées », « sauf cette photo »…) : Juno ne la devine pas. Sélectionnez les éléments voulus ou choisissez la cible dans le panneau, puis formulez l’action sans négation. Rien n’a été modifié.",
    );
  if (ici && (explicite === "album" || explicite === "kept"))
    throw new Refus(
      "La consigne vise à la fois cet élément et tout un ensemble. Précisez la cible ; rien n’a été modifié.",
    );
  return ici ? "current" : explicite;
}
/**
 * « entre 1 et 2 secondes » est une fourchette, pas deux consignes : le « et »
 * n'y sépare rien. Coupée en deux, la consigne devenait méconnaissable et
 * partait vers l'IA locale, au lieu d'être refusée avec sa raison. Le texte
 * n'est pas encore passé par `numbers()` : les nombres y sont encore en
 * lettres.
 */
const NOMBRE_DIT =
  "(?:[+-]?\\d+(?:[.,]\\d+)?|zero|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)(?: virgule \\S+)?";
const SEPARATEUR = new RegExp(
  "(\\s+(?:puis|ensuite)\\s+|(?<!\\bentre " +
    NOMBRE_DIT +
    "(?: ?" +
    UNITE +
    ")?)\\s+et\\s+|[;\\n]+)",
);
export function parsePrompt(
  raw: string,
  domain: "photo" | "video",
  defaultScope: Scope = "current",
  defaultStyle = "signature",
): Plan {
  if (!raw.trim() || raw.length > 6000)
    throw Error("Écrivez une consigne de 1 à 6 000 caractères.");
  const tokens: string[] = [];
  // Guillemets droits, français et typographiques : un titre collé depuis un
  // traitement de texte arrive entre “ ”, et était refusé.
  const text = normalize(
    raw.replace(
      /["«“]([^"»”]+)["»”]/g,
      (_, t: string) => `__quote${tokens.push(t.trim()) - 1}__`,
    ),
  )
    // Des noms qui contiennent « et » : coupés en deux consignes, ils
    // devenaient méconnaissables.
    .replace(/\bnoir et blanc\b/g, "noir & blanc")
    .replace(/\b(flous?|bouges?) et (flous?|bouges?)\b/g, "$1 & $2")
    .replace(/\bfondus? d entree et de sortie\b/g, "fondus");
  // La cible d'abord : nommée avec une négation, elle est refusée sans
  // passer par l'IA locale, qui ne ferait pas mieux.
  let scope: Scope = cibleDite(raw) ?? defaultScope;
  if (/\b(ne|pas|sauf|except[eé]|sans modifier)\b/.test(text))
    throw Error(
      "Cette restriction demande une cible précise. Sélectionnez les éléments concernés, puis formulez l’action ; rien n’a été modifié.",
    );
  const actions: Action[] = [];
  const album =
    /^(?:juno |peux tu |merci de )?(?:trie|trier|retouche|retoucher|traite|traiter)(?: et (?:retouche|retoucher))? (?:cet|l) album(?: avec (?:le )?style ([a-z &]+?))?[.!?]?$/.exec(
      text,
    );
  if (domain === "photo" && album) {
    if (/\b(gener|supprim|yeux|visage|peau|fond)\w*/.test(text))
      throw Error(
        "La recette locale prépare le tri et la couleur. Les corrections génératives demandées doivent être réalisées individuellement ; elles ne seront pas marquées comme terminées.",
      );
    // Un style nommé mais introuvable ne devient plus Signature en silence :
    // tout l'album aurait été retouché dans un style qu'on n'a pas choisi.
    let style = defaultStyle;
    if (album[1]) {
      const found = styleNomme(album[1]);
      if (!found)
        throw new Refus(
          "Style inconnu : « " +
            album[1].trim() +
            " ». Choisissez l’un des styles de l’album, par exemple « avec le style film doux ». Rien n’a été lancé.",
        );
      style = found.id;
    }
    actions.push({ kind: "album.process", style });
    scope = "album";
  } else if (
    /^(?:(?:juno|peux tu|merci de|s il te plait),? )?(?:cherche|recherche|trouve)\s+/.test(
      text,
    )
  ) {
    // Une recherche est seule : ses mots ne sont ni coupés aux « et », ni
    // privés de leurs accents.
    const query = requeteDe(raw);
    if (!query) throw Error("Précisez ce que vous cherchez.");
    // Dans l'espace photo, une requête à espaces n'est pas un nom de fichier :
    // la grille restait entière alors que le pilote annonçait une recherche.
    if (domain === "photo" && /\s/.test(query))
      throw new Refus(
        `Le pilote cherche un nom de fichier, en un seul mot. Pour trouver « ${query} » par le sens, écrivez la phrase dans le champ de recherche des photos, puis appuyez sur Entrée.`,
      );
    actions.push({ kind: "media.search", query });
  } else {
    // Quoted strings are kept intact when splitting a sequence of instructions.
    // Les séparateurs sont gardés : « et », « puis » et « ensuite » laissent
    // la consigne suivante dans la même phrase, donc sous le même verbe.
    // L'aide présente « puis » pour enchaîner : « baisse les ombres de 20 puis
    // hautes lumières de 10 » faisait monter les hautes lumières quand il
    // coupait la phrase (relecture du 29/09/2026). Seuls « ; » et le retour à
    // la ligne l'arrêtent. Les commandes de l'IA locale ne passent plus par
    // ici jointes par « puis » : elles sont relues une par une, et
    // « Contraste à 10 » n'y hérite d'aucun verbe (voir `relireProposition`).
    const morceaux = text.split(SEPARATEUR);
    const parts: { texte: string; memePhrase: boolean }[] = [];
    let coupee = false;
    morceaux.forEach((morceau, i) => {
      if (i % 2) coupee ||= !/^(?:et|puis|ensuite)$/.test(morceau.trim());
      else if (morceau) {
        parts.push({ texte: morceau, memePhrase: !!parts.length && !coupee });
        coupee = false;
      }
    });
    if (parts.length > 20)
      throw Error("Limitez cette demande à vingt opérations.");
    const finale = new RegExp("\\s+(?:sur|pour|a) " + PORTEE_FINALE + "$");
    let verbePrecedent: string | undefined;
    for (const { texte, memePhrase } of parts) {
      let part = texte;
      if (!memePhrase) verbePrecedent = undefined;
      const unquoted = part.replace(
        /__quote(\d+)__/g,
        (_, i) => tokens[Number(i)],
      );
      part = numbers(
        // Avant `numbers()`, qui ferait de « un peu » « 1 peu » et de
        // « pour cent » « pour 100 ».
        part.replace(/\bun peu\b/g, "legerement").replace(/\bpour ?cents?\b/g, "%"),
      )
        .replace(/^(?:juno|peux tu|merci de|s il te plait),? /, "")
        .replace(/[, .!?]+$/, "")
        .replace(finale, "")
        .replace(/[, .!?]+$/, "")
        .trim();
      if (
        !VERBE_EN_TETE.test(part) &&
        verbePrecedent &&
        REGLAGE_SANS_VERBE[domain].test(part)
      )
        part = verbePrecedent + " " + part;
      const avant = actions.length;
      if (
        /^(annule|annuler)(?: la derniere (?:action|commande|operation))?$/.test(
          part,
        )
      )
        actions.push({ kind: "history.undo" });
      else if (
        /^(retablis|retablir)(?: la derniere (?:action|commande|operation))?$/.test(
          part,
        )
      )
        actions.push({ kind: "history.redo" });
      else if (
        /^(importe|importer)(?: des (?:medias|photos|videos|sons))?$/.test(part)
      )
        actions.push({ kind: "import.open" });
      else if (
        domain === "photo" &&
        /^(?:envoie|envoyer|exporte|exporter|passe)(?: le tri| les notes| les etoiles| la selection| les photos)? (?:a|vers|dans|pour) lightroom(?: classic)?$/.test(
          part,
        )
      )
        actions.push({ kind: "lightroom.open" });
      else if (
        /^(exporte|exporter|prepare l export)(?: la selection| le film| les photos| le projet)?$/.test(
          part,
        )
      )
        actions.push({ kind: "export.open" });
      else if (
        /^(?:applique|appliquer|mets|choisis) (?:le )?style /.test(part)
      ) {
        const found = styleNomme(
          part.replace(/^(?:applique|appliquer|mets|choisis) (?:le )?style /, ""),
        );
        if (!found)
          throw Error("Style inconnu. Choisissez un des styles affichés.");
        actions.push(
          domain === "photo"
            ? { kind: "photo.style", style: found.id }
            : { kind: "video.style", style: found.id },
        );
      } else if (domain === "photo") {
        const version = /^(?:cree|enregistre) (?:une |1 |la )?version __quote(\d+)__$/.exec(
          part,
        );
        if (/^(garde|garder)(?: cette photo| la photo active| les photos)?$/.test(part))
          actions.push({ kind: "photo.status", status: "keep" });
        else if (/^(ecarte|ecarter)(?: cette photo| la photo active| les photos)?$/.test(part))
          actions.push({ kind: "photo.status", status: "reject" });
        else if (/^(protege|proteger)(?: cette photo| la photo active| les photos)?$/.test(part))
          actions.push({ kind: "photo.protect", value: true });
        else if (
          /^(deprotege|deverrouille)(?: cette photo| la photo active| les photos)?$/.test(part)
        )
          actions.push({ kind: "photo.protect", value: false });
        else if (/^(reviens|revenir|retour) a l original$/.test(part))
          actions.push({ kind: "photo.original" });
        else if (/^(retablis|recupere) la retouche$/.test(part))
          actions.push({ kind: "photo.recover" });
        else if (/^(montre|affiche) l original$/.test(part))
          actions.push({ kind: "view.original" });
        else if (/^(montre|affiche) la retouche$/.test(part))
          actions.push({ kind: "view.edit" });
        else if (
          new RegExp("^(?:mets |note a )?" + textNumber + " etoiles?$").test(
            part,
          )
        )
          actions.push({ kind: "photo.stars", value: numberIn(part)! });
        else if (ROTATION.test(part)) actions.push(rotationDe(part));
        else if (REDRESSE.test(part)) actions.push(redressementDe(part));
        else if (SANS_RECADRAGE.test(part))
          actions.push({ kind: "photo.aspect", ratio: 0 });
        else if (FORMAT.test(part))
          actions.push({ kind: "photo.aspect", ratio: formatDe(part) });
        else if (/^(?:redresse|redresser)\b/.test(part))
          throw new Refus(
            "Dites « redresse la photo » pour l’angle mesuré par Juno, ou « redresse de 2 degrés à gauche » pour un angle précis. Rien n’a été modifié.",
          );
        // Le nom tel qu'écrit entre guillemets, et lui seul : il était
        // reconstruit depuis la phrase, « Juno » et la portée compris.
        else if (version)
          actions.push({ kind: "photo.version", name: tokens[Number(version[1])] });
        else {
          // Du nom le plus long au plus court : « noirs adoucis » doit gagner
          // sur « noirs », dont il commence par le mot. Dans l'ordre de
          // déclaration, le second capturait le premier et la consigne était
          // ensuite refusée avec un message sans rapport.
          const field = Object.entries(PHOTO_FIELDS)
            .sort(
              ([, a], [, b]) =>
                Math.max(...b.names.split("|").map((n) => n.length)) -
                Math.max(...a.names.split("|").map((n) => n.length)),
            )
            .find(([, f]) =>
              new RegExp("\\b(?:" + f.names + ")\\b").test(part),
            );
          const value = numberIn(part);
          if (!field || value === undefined || !DEBUT_RECONNU.test(part))
            throw Error(
              "Consigne non reconnue : « " +
                unquoted +
                " ». Utilisez une action et une valeur précises, ou choisissez un exemple. Rien n’a été modifié.",
            );
          if (/\b(kelvin|k)\b/.test(part))
            throw new Refus(
              "La chaleur actuelle est relative ; une température caméra en Kelvin n’est pas encore disponible.",
            );
          // La même liste de verbes qu'au-dessus, et non une troisième copie :
          // elles avaient déjà divergé une fois, et le symptôme était une
          // tournure acceptée par un contrôle puis refusée par le suivant.
          const exact = new RegExp(
            "^(?:(" +
              VERBES_REGLAGE +
              ") )?(?:(?:l|le|la|les) )?(?:" +
              field[1].names +
              ")(?: (a|de|=))? " +
              textNumber +
              "(?:\\s*(?:%|il|ev|°|degres?))?$",
          ).exec(part);
          if (!exact)
            throw Error(
              "Précisez la cible avec la sélection et une valeur unique. Les restrictions de zone doivent être définies dans un masque ; rien n’a été modifié.",
            );
          actions.push({
            kind: "photo.adjust",
            field: field[0],
            ...reglage(exact[1], exact[2], Number(exact[3])),
          });
        }
      } else {
        const movement = part.match(
          /^anime (?:la |le )?(position horizontale|position verticale|volume) de ([+-]?\d+(?:\.\d+)?) (?:% |db )?a ([+-]?\d+(?:\.\d+)?)(?: %| db)? (?:sur|en) (\d+(?:\.\d+)?) secondes?$/,
        );
        const titre = /^(?:ajoute|cree) (?:un |1 |le )?titre __quote(\d+)__$/.exec(
          part,
        );
        if (movement)
          actions.push({
            kind: "video.animate",
            field:
              movement[1] === "volume"
                ? "gain"
                : movement[1] === "position horizontale"
                  ? "x"
                  : "y",
            from: Number(movement[2]),
            to: Number(movement[3]),
            seconds: Number(movement[4]),
          });
        else if (/^(coupe|couper)(?: ici| au curseur| ce plan)?$/.test(part))
          actions.push({ kind: "video.split" });
        else if (
          /^(retire|supprime)(?: ce plan| le plan selectionne)$/.test(part)
        )
          actions.push({ kind: "video.remove" });
        else if (
          /^(duplique|dupliquer)(?: la sequence| le montage)?$/.test(part)
        )
          actions.push({ kind: "video.duplicate" });
        else if (
          /^(va|place le curseur|avance) a (?:\d+:\d{2}(?::\d{2})?|\d+(?:\.\d+)? (?:secondes?|sec|s|minutes?|min))$/.test(
            part,
          )
        ) {
          const tc = part.match(/(\d+):(\d{2})(?::(\d{2}))?/);
          if (tc && (Number(tc[2]) > 59 || Number(tc[3] || 0) > 59))
            throw Error("Code temporel invalide.");
          actions.push({
            kind: "video.seek",
            seconds: tc
              ? tc[3]
                ? Number(tc[1]) * 3600 + Number(tc[2]) * 60 + Number(tc[3])
                : Number(tc[1]) * 60 + Number(tc[2])
              : durationIn(part, -1),
          });
        } else if (titre)
          actions.push({
            kind: "video.title",
            text: tokens[Number(titre[1])],
            seconds: 3,
          });
        else if (FONDU.test(part)) actions.push(fonduDe(part));
        else if (DUREE_PLAN.test(part)) actions.push(dureeDe(part));
        else if (
          /^(assemble|cree|fais|realise|prepare) (?:un|1|le) (?:montage|film|teaser)(?: (?:vertical|9:16))? de \d+(?:\.\d+)? (?:secondes?|sec|s|minutes?|min)$/.test(
            part,
          )
        )
          actions.push({
            kind: "video.assemble",
            seconds: durationIn(part),
            vertical: /\b(vertical|9:16)\b/.test(part),
          });
        // « sous-titres » garde son trait d'union après `normalize` : le
        // bouton d'exemple « Crée les sous-titres » était toujours refusé.
        else if (/^(cree|ajoute) (?:les |des )?sous[ -]?titres?$/.test(part))
          actions.push({ kind: "video.caption" });
        else if (
          /^(floute|masque|cache|pixelise)(?: la zone| le visage| une zone| ce visage)?$/.test(
            part,
          )
        )
          actions.push({
            kind: "video.mask",
            effect: /pixelise/.test(part)
              ? "pixelate"
              : /cache/.test(part)
                ? "solid"
                : "blur",
          });
        else if (
          /^suis (?:le |la |ce |cette )?(sujet|masque|visage)$/.test(part)
        )
          actions.push({ kind: "video.track" });
        else if (/^(mets|ajoute|donne) du relief/.test(part))
          actions.push({
            kind: "video.depth",
            // "du relief de 30" sets the depth; plain "du relief" uses a default.
            extrude: Math.max(0, Math.min(1, (numberIn(part) ?? 30) / 100)),
          });
        else if (
          /^(retire|supprime|enleve|coupe) les (blancs|silences)\b/.test(part)
        )
          actions.push(blancsDe(part));
        else if (
          /^(baisse|attenue|duck) la musique|^active le ducking/.test(part)
        )
          actions.push(attenuationDe(part));
        else if (/^(arrete|desactive|enleve) (le ducking|l attenuation)/.test(part))
          actions.push({ kind: "video.ducking", on: false });
        else if (DEBUT_DEBRUITAGE.test(part)) actions.push(debruitageDe(part));
        else if (/^(?:stabilise|stabiliser)\b/.test(part))
          actions.push(stabilisationDe(part));
        // La stabilisation compense les secousses, en translation : elle ne
        // redresse pas un horizon, que « redresse » stabilisait pourtant.
        else if (/^(?:redresse|redresser|remets? droit|remets? d aplomb)\b/.test(part))
          throw new Refus(
            "En vidéo, Juno ne redresse pas l’horizon automatiquement : la stabilisation compense les secousses, pas l’inclinaison. Dites par exemple « rotation à 2 » pour tourner le plan de 2 degrés. Rien n’a été modifié.",
          );
        else if (/^(ralenti fluide|fluidifie le ralenti|lisse le ralenti)/.test(part))
          actions.push({ kind: "video.smoothslow", on: true });
        // « fondu » seul désigne déjà le fondu d'entrée d'un plan : une
        // transition demande donc un mot qui la distingue, « enchaîné » ou
        // le nom du motif voulu.
        else if (DEBUT_TRANSITION.test(part)) actions.push(transitionDe(part));
        else if (/^transcri(s|re)(?: les rushes| les medias)?$/.test(part))
          actions.push({ kind: "video.transcribe" });
        else if (/^analyse(?: les rushes| les medias)?$/.test(part))
          actions.push({ kind: "video.analyze" });
        else if (
          /^(?:derushe|derusher|lance le derush(?:age)?|fais le derush(?:age)?)(?: les rushes| les medias| tout)?$/.test(
            part,
          )
        )
          actions.push({ kind: "video.derush" });
        else if (
          // « un » y arrive en « 1 » (les nombres dits en mots sont lus).
          /^(?:pre[- ]?monte|pre[- ]?monter|fais (?:un|1|le) pre[- ]?montage|lance (?:un|1|le) pre[- ]?montage)(?: les rushes| tout| la journee)?$/.test(
            part,
          )
        )
          actions.push({ kind: "video.premontage" });
        else if (
          // « les masques » et « les flous » seuls désignent les masques de
          // flou de l'app (MaskPanel) : il faut « passages », « moments » ou
          // « morceaux » devant, ou « inutilisables », ou la paire « flous et
          // bougés ».
          /^(?:retire|supprime|enleve|coupe) les (?:(?:passages |moments |morceaux )(?:inutilisables|masques|flous & bouges|bouges & flous|flous|bouges)|inutilisables|flous & bouges|bouges & flous)$/.test(
            part,
          )
        )
          actions.push({ kind: "video.unusable" });
        else if (
          /^(harmonise|equilibre)(?: la couleur| les couleurs| les plans)$/.test(
            part,
          )
        )
          actions.push({ kind: "video.autocolor" });
        else {
          const field = /\b(volume|gain)\b/.test(part)
            ? "gain"
            : /\b(opacite)\b/.test(part)
              ? "opacity"
              : /\b(echelle|zoom)\b/.test(part)
                ? "scale"
                : /\b(rotation)\b/.test(part)
                  ? "rotation"
                  : /\b(vitesse)\b/.test(part)
                    ? "speed"
                    : /\b(exposition|expo)\b/.test(part)
                      ? "exposure"
                      : /\b(saturation)\b/.test(part)
                        ? "saturation"
                        : /\b(contraste)\b/.test(part)
                          ? "contrast"
                          : "";
          const value = numberIn(part);
          if (
            !field ||
            value === undefined ||
            !new RegExp(
              "^(?:" +
                VERBES_REGLAGE +
                "|" +
                Object.values(NOMS_VIDEO).join("|") +
                ")\\b",
            ).test(part)
          )
            throw Error(
              "Consigne vidéo non reconnue : « " +
                unquoted +
                " ». Rien n’a été modifié.",
            );
          if (field === "gain" && !/\b(db|decibels?)\b/.test(part))
            throw Error(
              "Précisez le volume en décibels, par exemple « volume à -6 dB ».",
            );
          const exact = new RegExp(
            "^(?:(" +
              VERBES_REGLAGE +
              ") )?(?:(?:l|le|la) )?(?:" +
              NOMS_VIDEO[field] +
              ")(?: (a|de|=))? " +
              textNumber +
              "(?:\\s*(?:%|il|ev|db|decibels?|degres?|x))?$",
          ).exec(part);
          if (!exact)
            throw Error(
              "La consigne contient une restriction ou un effet non pris en charge. Sélectionnez les plans puis indiquez un réglage précis ; rien n’a été modifié.",
            );
          actions.push({
            kind: "video.adjust",
            field,
            ...reglage(exact[1], exact[2], Number(exact[3])),
          });
        }
      }
      const derniere = actions.length > avant ? actions[actions.length - 1] : undefined;
      verbePrecedent =
        derniere?.kind === "photo.adjust" || derniere?.kind === "video.adjust"
          ? VERBE_EN_TETE.exec(part)?.[1]
          : undefined;
    }
  }
  verifierEnchainement(actions);
  return {
    id: crypto.randomUUID(),
    text: raw,
    actions,
    scope,
    source: "text",
    label: raw.slice(0, 200),
    explanation: "Commandes locales · aucun envoi en ligne ni coût IA.",
  };
}
/**
 * Les actions d'une même consigne : les tâches longues, la navigation et
 * l'historique restent seuls. Exportée pour la proposition de l'IA locale,
 * relue commande par commande puis vérifiée d'un seul tenant.
 */
export function verifierEnchainement(actions: Action[]) {
  if (!actions.length) throw Error("Aucune action reconnue.");
  if (actions.length > 20)
    throw Error("Limitez cette demande à vingt opérations.");
  const standalone = actions.filter(
    (a) =>
      !a.kind.startsWith("photo.") &&
      ![
        "video.animate",
        "video.adjust",
        "video.split",
        "video.remove",
        "video.fade",
        "video.trim",
        "video.title",
        "video.style",
      ].includes(a.kind),
  );
  if (actions.length > 1 && standalone.length)
    throw Error(
      "Lancez séparément les opérations de navigation, les tâches longues et les modifications. Rien n’a été appliqué.",
    );
}
