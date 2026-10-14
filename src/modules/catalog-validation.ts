import { COLOR_BANDS } from "./advanced-color";
import { AUTO_FIELDS } from "./auto-tone";
import {
  DEFAULT,
  STYLES,
  type Adjustments,
  type Photo,
  type Project,
  type LocalEdit,
} from "../model";
const fail = () => {
  throw Error("Le catalogue contient des réglages invalides.");
};
function number(v: unknown, min: number, max: number) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    return fail();
  return v;
}
/**
 * Une coordonnée en proportions. Un trait posé au bord d'une photo redressée
 * revient de la géométrie à 1 + 2e-16 : l'écart d'arrondi est ramené dans le
 * cadre au lieu de refuser le calque que l'atelier vient d'écrire.
 */
function proportion(v: unknown) {
  return Math.min(1, Math.max(0, number(v, -1e-6, 1 + 1e-6)));
}
function point(p: { x: number; y: number }) {
  if (!p || typeof p !== "object") return fail();
  return { x: proportion(p.x), y: proportion(p.y) };
}
/**
 * La force d'un calque, en diaphragmes pour la lumière. Le champ « Force »
 * accepte n'importe quel nombre tapé au clavier : au-delà de ±16, l'image est
 * de toute façon saturée (2^16 dépasse la plage d'un pixel sur 16 bits, et la
 * couleur locale sature dès 12,5), donc on borne sans rien changer au rendu.
 * Refuser la valeur bloquait ensuite chaque curseur de la photo.
 */
const FORCE_MAX = 16;
function force(v: unknown) {
  return Math.min(FORCE_MAX, Math.max(-FORCE_MAX, number(v, -Infinity, Infinity)));
}
export function validateAdjustments(input: Adjustments): Adjustments {
  if (!input || typeof input !== "object") return fail();
  const out = { ...DEFAULT };
  for (const key of Object.keys(DEFAULT) as (keyof typeof DEFAULT)[]) {
    if (key === "style") {
      out.style = STYLES.some((s) => s.id === input.style)
        ? input.style
        : "original";
      continue;
    }
    const v = input[key];
    if (v === undefined) continue;
    const bounds =
      key === "exposure"
        ? [-4, 4]
        : key === "rotation"
          ? [0, 270]
          : key === "crop"
            ? [0, 40]
            : key === "intensity"
              ? [0, 100]
              : [-100, 100];
    (out as unknown as Record<string, unknown>)[key] = number(
      v,
      bounds[0],
      bounds[1],
    );
  }
  if (![0, 90, 180, 270].includes(out.rotation)) return fail();
  // Le redressement fin : sans ce bloc, la clé serait jetée sans un mot à la
  // restauration d'une sauvegarde, et la photo reviendrait penchée.
  if (input.straighten !== undefined)
    out.straighten = number(input.straighten, -45, 45);
  for (const key of [
    "whites",
    "blacks",
    "vibrance",
    "clarity",
    "sharpening",
    "noiseReduction",
  ] as const) {
    if (input[key] !== undefined)
      out[key] = number(
        input[key],
        key === "sharpening" || key === "noiseReduction" ? 0 : -100,
        100,
      );
  }
  if (input.curves !== undefined) {
    if (!input.curves || typeof input.curves !== "object") return fail();
    out.curves = {};
    for (const channel of ["rgb", "red", "green", "blue"] as const) {
      const points = input.curves[channel];
      if (points === undefined) continue;
      if (!Array.isArray(points) || points.length < 2 || points.length > 16)
        return fail();
      const clean = points.map(point);
      if (
        clean[0].x !== 0 ||
        clean[clean.length - 1].x !== 1 ||
        clean.some((p, i) => i > 0 && p.x <= clean[i - 1].x)
      )
        return fail();
      out.curves[channel] = clean;
    }
  }
  if (input.colorMix !== undefined) {
    if (!input.colorMix || typeof input.colorMix !== "object") return fail();
    out.colorMix = {};
    for (const band of COLOR_BANDS) {
      const mix = input.colorMix[band.id];
      if (mix !== undefined)
        out.colorMix[band.id] = {
          hue: number(mix.hue, -100, 100),
          saturation: number(mix.saturation, -100, 100),
          luminance: number(mix.luminance, -100, 100),
        };
    }
  }
  if (input.cropRect) {
    const c = input.cropRect;
    out.cropRect = {
      x: number(c.x, 0, 1),
      y: number(c.y, 0, 1),
      w: number(c.w, 0.001, 1),
      h: number(c.h, 0.001, 1),
    };
    if (c.x + c.w > 1.000001 || c.y + c.h > 1.000001) return fail();
  }
  if (input.localEdits) {
    if (!Array.isArray(input.localEdits) || input.localEdits.length > 100)
      return fail();
    out.localEdits = input.localEdits.map((e) => {
      if (
        !e ||
        typeof e.id !== "string" ||
        typeof e.name !== "string" ||
        !["exposure", "warmth", "soften", "clone", "mask", "subject"].includes(
          e.tool,
        ) ||
        !Array.isArray(e.points) ||
        e.points.length > 2000 ||
        // Une retouche sur le sujet détouré n'a pas de trait de pinceau :
        // c'est le masque qui dit où elle s'applique.
        (!e.points.length && e.tool !== "subject")
      )
        return fail();
      return {
        id: e.id.slice(0, 100),
        name: e.name.slice(0, 60),
        tool: e.tool,
        ...(e.invert === true ? { invert: true } : {}),
        points: e.points.map(point),
        // « Sujet détouré » n'a pas de pinceau : l'atelier l'écrit avec un
        // rayon nul (EditorPreview), que le rendu n'utilise pas.
        radius: number(e.radius, e.tool === "subject" ? 0 : 0.001, 0.5),
        amount: force(e.amount),
        opacity: number(e.opacity, 0, 1),
        visible: !!e.visible,
        ...(e.source ? { source: point(e.source) } : {}),
      } satisfies LocalEdit;
    });
  }
  return out;
}
/**
 * Le résumé de sens après un aller-retour JSON : un Float32Array y devient
 * {"0": …, "1": …}, sans longueur, et ni la recherche ni les rafales ne le
 * lisaient plus, sans jamais le recalculer. Il redevient un Float32Array ;
 * tout autre contenu est retiré, la prochaine passe d'album le refera.
 */
function resumeDeSens(v: unknown): Float32Array | undefined {
  if (v instanceof Float32Array) return v.length && v.length <= 4096 ? v : undefined;
  if (!v || typeof v !== "object") return undefined;
  // Les clés d'un tableau sérialisé : "0", "1", … dans l'ordre, rien d'autre.
  if (!Array.isArray(v)) {
    const cles = Object.keys(v);
    if (cles.length > 4096 || !cles.every((c, i) => c === String(i))) return undefined;
  }
  const valeurs: unknown[] = Array.isArray(v) ? v : Object.values(v);
  if (
    !valeurs.length ||
    valeurs.length > 4096 ||
    !valeurs.every((x) => typeof x === "number" && Number.isFinite(x))
  )
    return undefined;
  return Float32Array.from(valeurs as number[]);
}
/*
 * Les champs descriptifs d'une fiche reçue (sauvegarde, copie d'équipe) étaient
 * recopiés tels quels. Un verdict qui n'était pas un texte (un objet, dans une
 * sauvegarde forgée) faisait planter l'affichage à chaque ouverture du projet,
 * et ce projet restant le dernier ouvert, plus rien ne s'ouvrait. Ces champs se
 * recalculent ou ne sont qu'indicatifs : une valeur du mauvais type est
 * retirée, sans refuser toute la sauvegarde.
 */
const texte = (max: number) => (v: unknown) =>
  typeof v === "string" ? v.slice(0, max) : undefined;
const fini = (min = -Number.MAX_VALUE, max = Number.MAX_VALUE) => (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max
    ? v
    : undefined;
const booleen = (v: unknown) => (typeof v === "boolean" ? v : undefined);
const objet = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
/** Un objet dont toutes les valeurs sont des nombres finis, sinon rien. */
function mesures(v: unknown, requis: string[] = []) {
  const o = objet(v);
  if (
    !o ||
    requis.some((k) => o[k] === undefined) ||
    Object.values(o).some((x) => fini()(x) === undefined)
  )
    return undefined;
  return o;
}
const nombres = (v: unknown) =>
  Array.isArray(v) && v.length <= 4096 && v.every((x) => fini()(x) !== undefined)
    ? v
    : undefined;
/**
 * Recopie un objet reçu en passant les champs connus par leur règle. Un champ
 * absent reste absent ; un champ que la règle rejette est retiré.
 */
function recopie<T extends object>(
  source: T,
  regles: Record<string, (v: unknown) => unknown>,
): T {
  const out = { ...source } as Record<string, unknown>;
  for (const [cle, regle] of Object.entries(regles)) {
    if (out[cle] === undefined) continue;
    const v = regle(out[cle]);
    if (v === undefined) delete out[cle];
    else out[cle] = v;
  }
  return out as T;
}
/**
 * Une lecture de visage : ses nombres servent aux comparaisons de rafale et à
 * la reconnaissance des personnes. Une lecture mal formée est retirée, et la
 * version effacée pour que la prochaine passe relise les visages.
 */
function lectureSaine(r: unknown) {
  const o = objet(r);
  if (!o) return false;
  if (o.region !== undefined && !mesures(o.region, ["x", "y", "w", "h"]))
    return false;
  for (const k of [
    "weight",
    "sharpness",
    "nettete",
    "ecrete",
    "eyesClosed",
    "smile",
    "turned",
  ])
    if (o[k] !== undefined && fini()(o[k]) === undefined) return false;
  for (const k of ["signature", "descriptor"])
    if (o[k] !== undefined && !nombres(o[k])) return false;
  return o.personId === undefined || typeof o.personId === "string";
}
function visagesRecus(f: NonNullable<NonNullable<Photo["analysis"]>["faces"]>) {
  const lectures = Array.isArray(f.reads) ? f.reads : undefined;
  const saines = lectures?.filter(lectureSaine);
  const intactes =
    f.reads === undefined ||
    (!!lectures && saines!.length === lectures.length);
  const out = recopie(f, {
    version: intactes ? texte(40) : () => undefined,
    subjectSharpness: fini(0),
  });
  if (saines) out.reads = saines;
  else delete out.reads;
  return out;
}
function analyseRecue(a: NonNullable<Photo["analysis"]>) {
  return recopie(
    { ...a, ...(a.faces ? { faces: visagesRecus(a.faces) } : {}) },
    {
      verdict: texte(500),
      groupId: texte(200),
      suggested: booleen,
      sharpnessWidth: fini(0),
      cast: (v) => mesures(v, ["r", "g", "b"]),
      look: (v) => mesures(v),
    },
  );
}
const reglesFiche: Record<string, (v: unknown) => unknown> = {
  hash: texte(128),
  chapter: texte(200),
  moment: texte(200),
  prompt: texte(4000),
  parentId: texte(200),
  remotePhotoId: texte(200),
  editGroup: texte(200),
  protected: (v) => v === true,
  generated: booleen,
  previewOnly: booleen,
  proposalLearned: booleen,
  revision: fini(0, Number.MAX_SAFE_INTEGER),
  bitDepth: fini(1, 64),
  camera: (v) => {
    const o = objet(v);
    return o
      ? recopie(o, {
          make: texte(100),
          model: texte(100),
          iso: fini(0),
          aperture: fini(0),
          shutter: fini(0),
        })
      : undefined;
  },
  // La proposition de la passe d'album : des nombres, relus pour apprendre le
  // style. Un texte y fausserait le profil de retouche pour de bon.
  proposal: (v) => {
    const o = objet(v);
    return o
      ? Object.fromEntries(
          Object.entries(o).filter(([, x]) => fini()(x) !== undefined),
        )
      : undefined;
  },
  // Le style appris que portait cette proposition : seulement les réglages
  // que Juno apprend, dans leurs bornes. Il s'ajoute à chaque correction
  // relue : une valeur hors bornes ou étrangère fausserait le profil.
  proposalProfile: (v) => {
    const o = objet(v);
    if (!o) return undefined;
    const porte: Record<string, number> = {};
    for (const [cle, [min, max]] of Object.entries(AUTO_FIELDS)) {
      const x = fini(min, max)(o[cle]);
      if (x !== undefined) porte[cle] = x;
    }
    return porte;
  },
};
export function validateCatalog(project: Project, photos: Photo[]) {
  if (
    !project ||
    typeof project.id !== "string" ||
    typeof project.name !== "string" ||
    project.name.length > 250 ||
    !Array.isArray(photos) ||
    photos.length > 50000
  )
    throw Error("Catalogue invalide.");
  if (
    typeof project.date !== "string" ||
    typeof project.location !== "string" ||
    (project.kind !== undefined && typeof project.kind !== "string")
  )
    throw Error("Informations de projet invalides.");
  number(project.created, 0, Number.MAX_SAFE_INTEGER);
  const ids = new Set();
  const clean = photos.map((p) => {
    if (
      !p ||
      typeof p.id !== "string" ||
      ids.has(p.id) ||
      p.projectId !== project.id ||
      typeof p.name !== "string" ||
      p.name.length > 1000 ||
      !["pending", "keep", "reject"].includes(p.status) ||
      typeof p.source !== "string" ||
      typeof p.thumbnail !== "string" ||
      p.thumbnail.length > 1000000 ||
      (!/^data:image\/(jpeg|png|webp);base64,/.test(p.thumbnail) &&
        p.thumbnail !== "")
    )
      throw Error("Photo invalide dans le catalogue.");
    ids.add(p.id);
    if (p.capturedAt !== undefined)
      number(p.capturedAt, -8640000000000000, 8640000000000000);
    if (
      p.color &&
      (!["raw", "embedded", "assumed"].includes(p.color.source) ||
        p.color.space !== "sRGB" ||
        typeof p.color.profile !== "string" ||
        p.color.profile.length > 200)
    )
      throw Error("Profil couleur invalide.");
    number(p.created, 0, Number.MAX_SAFE_INTEGER);
    number(p.size, 0, 1024 ** 4);
    if (p.analysis) {
      const a = p.analysis;
      if (
        typeof a !== "object" ||
        !["normal", "review"].includes(a.advice) ||
        typeof a.dhash !== "string" ||
        !/^[01]{64}$/.test(a.dhash) ||
        !Array.isArray(a.reasons) ||
        a.reasons.length > 100 ||
        a.reasons.some((x) => typeof x !== "string" || x.length > 500)
      )
        throw Error("Analyse de photo invalide.");
      number(a.brightness, 0, 1);
      number(a.sharpness, 0, 1e12);
      number(a.clipped, 0, 1);
      if (a.level) {
        if (
          typeof a.level !== "object" ||
          !["auto", "suggest", "level", "abstain"].includes(a.level.tier) ||
          typeof a.level.reason !== "string" ||
          a.level.reason.length > 200 ||
          typeof a.level.version !== "string"
        )
          throw Error("Mesure d’inclinaison invalide.");
        if (a.level.angle !== null) number(a.level.angle, -45, 45);
      }
      if (a.nettetePointe !== undefined) number(a.nettetePointe, 0, 1e9);
      if (a.empreinte) {
        const e = a.empreinte;
        if (
          typeof e !== "object" ||
          typeof e.version !== "string" ||
          e.version.length > 40 ||
          !Number.isInteger(e.gw) ||
          !Number.isInteger(e.gh) ||
          e.gw < 1 ||
          e.gh < 1 ||
          e.gw > 64 ||
          e.gh > 64 ||
          typeof e.g !== "string" ||
          e.g.length > 8192 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(e.g) ||
          !Array.isArray(e.hist) ||
          e.hist.length !== 64 ||
          !Array.isArray(e.hog) ||
          e.hog.length !== 128
        )
          throw Error("Empreinte de rafale invalide.");
        for (const v of e.hist) number(v, 0, 1);
        for (const v of e.hog) number(v, 0, 1);
        if (e.instant !== undefined)
          number(e.instant, -8640000000000000, 8640000000000000);
        if (
          e.boitier !== undefined &&
          (typeof e.boitier !== "string" || e.boitier.length > 64)
        )
          throw Error("Empreinte de rafale invalide.");
      }
      if (a.faces) {
        number(a.faces.count, 0, 100);
        // Seule la netteté est contrôlée : les lectures des catalogues d'avant
        // la 1.1.0 n'avaient pas de plafond, et les refuser ferait perdre la
        // photo entière à la restauration.
        if (Array.isArray(a.faces.reads))
          for (const r of a.faces.reads)
            if (r?.nettete !== undefined) number(r.nettete, 0, 1);
        if (Array.isArray(a.faces.reads))
          for (const r of a.faces.reads)
            if (r?.ecrete !== undefined) number(r.ecrete, 0, 1);
        number(a.faces.closedEyes, 0, a.faces.count);
        number(a.faces.blink, 0, 1);
        if (a.faces.regions) {
          if (!Array.isArray(a.faces.regions) || a.faces.regions.length > 20)
            throw Error("Visages invalides.");
          for (const r of a.faces.regions) {
            number(r.x, 0, 1);
            number(r.y, 0, 1);
            number(r.w, 0, 1);
            number(r.h, 0, 1);
            if (r.x + r.w > 1.00001 || r.y + r.h > 1.00001)
              throw Error("Visage hors cadre.");
          }
        }
      }
    }
    number(p.width, 1, 100000);
    number(p.height, 1, 100000);
    number(p.stars, 0, 5);
    return {
      ...recopie(p, reglesFiche),
      ...(p.analysis ? { analysis: analyseRecue(p.analysis) } : {}),
      semantic: resumeDeSens(p.semantic),
      adjustments: validateAdjustments(p.adjustments),
      history: (Array.isArray(p.history) ? p.history : [])
        .slice(-40)
        .map(validateAdjustments),
      future: (Array.isArray(p.future) ? p.future : [])
        .slice(-40)
        .map(validateAdjustments),
      originalRecovery: p.originalRecovery
        ? validateAdjustments(p.originalRecovery)
        : undefined,
      versions: p.versions?.slice(-20).map((v) => {
        number(v.created, 0, Number.MAX_SAFE_INTEGER);
        if (typeof v.name !== "string" || typeof v.id !== "string")
          throw Error("Version invalide.");
        return {
          ...v,
          name: v.name.slice(0, 80),
          adjustments: validateAdjustments(v.adjustments),
        };
      }),
    };
  });
  return { project, photos: clean };
}
