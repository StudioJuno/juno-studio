import { clipCaptions } from "../video/caption-timing";
import { retimeMasks, newMask, MASK_LIMIT } from "../video/masks";
import {
  addKey,
  retimeAnimation,
  valueAt,
  type AnimatedField,
} from "../video/animation";
import type { Asset, Clip, Sequence } from "../video/types";
import { DUCKING_DEFAULT } from "../video/types";
import {
  addClip,
  split,
  remove,
  fps,
  frame,
  length,
  linkedClips,
  removeSilence,
} from "../video/edit";
import { STYLES } from "../model";
import { retirerInutilisables } from "../video/derush";
import { sensContraire, type VideoAction } from "./commands";
const bounds: Record<string, [number, number]> = {
  x: [-2, 2],
  y: [-2, 2],
  gain: [0, 4],
  opacity: [0, 1],
  scale: [0.05, 5],
  rotation: [-360, 360],
  speed: [0.125, 8],
  exposure: [-5, 5],
  saturation: [0, 2.5],
  contrast: [0.2, 2.5],
};
const DEVERROUILLEZ = "Déverrouillez la piste avant de la modifier.";
const verrouille = (s: Sequence, c: Clip) => !!s.tracks?.[c.track]?.locked;
/** Une valeur vidéo telle que le panneau l'affiche : dB, pourcentage ou brute. */
function affichee(field: string, value: number) {
  if (field === "gain") return Math.round(200 * Math.log10(value)) / 10;
  return ["x", "y", "opacity", "scale", "saturation", "contrast"].includes(field)
    ? value * 100
    : value;
}
function bounded(field: string, value: number) {
  const range = bounds[field];
  if (!range || !Number.isFinite(value) || value < range[0] || value > range[1])
    throw Error("Valeur hors limites pour " + field + ".");
  return value;
}
export function applyVideoActions(
  s: Sequence,
  actions: VideoAction[],
  ids: string[],
  at: number,
  assets: Asset[],
): Sequence {
  let next = structuredClone(s);
  for (const action of actions) {
    if (action.kind === "video.title") {
      if (!action.text.trim() || action.text.length > 2000)
        throw Error("Le titre doit contenir de 1 à 2 000 caractères.");
      next.titles.push({
        id: crypto.randomUUID(),
        text: action.text,
        start: Math.max(0, Math.round(at)),
        duration: Math.max(1, frame(action.seconds, next)),
        size: 64,
        y: 0.8,
        color: "#ffffff",
      });
      continue;
    }
    if (!ids.length || ids.some((id) => !next.clips.some((c) => c.id === id)))
      throw Error("Sélectionnez les plans à modifier.");
    // Une piste verrouillée ne change pas, quelle que soit la commande : le
    // réglage manuel le refusait déjà, le pilote posait pourtant débruitage,
    // transition ou masque, et « supprime ce plan » annonçait une commande
    // appliquée sans rien retirer.
    const groupeVerrouille = (id: string) =>
      linkedClips(next, id).some((c) => verrouille(next, c));
    if (action.kind === "video.split") {
      if (ids.length !== 1) throw Error("Sélectionnez un plan pour le couper.");
      const c = next.clips.find((c) => c.id === ids[0])!;
      if (at <= c.start || at >= c.start + c.duration)
        throw Error("Placez le curseur à l’intérieur du plan à couper.");
      if (groupeVerrouille(ids[0])) throw Error(DEVERROUILLEZ);
      next = split(next, ids[0], at);
      continue;
    }
    if (action.kind === "video.remove") {
      if (ids.some(groupeVerrouille)) throw Error(DEVERROUILLEZ);
      for (const id of ids) next = remove(next, id);
      continue;
    }
    // L'atténuation vaut pour toute la séquence, pas pour un plan.
    if (action.kind === "video.ducking") {
      const base = next.ducking ?? DUCKING_DEFAULT;
      next.ducking = {
        ...base,
        enabled: action.on,
        depth: action.depth ?? base.depth,
      };
      if (
        action.on &&
        !next.clips.some((c) => c.audioRole === "voice")
      )
        throw Error(
          "Marquez au moins un plan comme « Voix » avant de baisser la musique.",
        );
      continue;
    }
    if (action.kind === "video.silence") {
      if (ids.length !== 1)
        throw Error("Sélectionnez un seul plan pour en retirer les blancs.");
      // Sans ce contrôle, la piste verrouillée donnait « Aucun blanc trouvé.
      // Analysez le média », sur un média pourtant analysé.
      if (groupeVerrouille(ids[0])) throw Error(DEVERROUILLEZ);
      const r = removeSilence(next, ids[0], assets, {
        minSilence: action.minSilence,
      });
      if (!r.cuts)
        throw Error(
          "Aucun blanc trouvé. Analysez le média, ou baissez la durée minimale.",
        );
      next = r.sequence;
      continue;
    }
    if (action.kind === "video.unusable") {
      if (ids.length !== 1)
        throw Error("Sélectionnez un seul plan pour en retirer les passages inutilisables.");
      if (groupeVerrouille(ids[0])) throw Error(DEVERROUILLEZ);
      const r = retirerInutilisables(next, ids[0], assets);
      if (!r.cuts)
        throw Error(
          "Aucun passage masqué dans ce plan. Le dérushage n’est peut-être pas fini : voyez l’onglet Dérush.",
        );
      next = r.sequence;
      continue;
    }
    if (
      action.kind === "video.denoise" ||
      action.kind === "video.stabilise" ||
      action.kind === "video.smoothslow" ||
      action.kind === "video.transition"
    ) {
      // « Tout le projet » compte aussi les blocs son liés à chaque rush : ils
      // sont laissés de côté, au lieu de faire échouer toute la commande au
      // premier d'entre eux.
      const plans = ids
        .map((id) => next.clips.find((x) => x.id === id)!)
        .filter((c) => c.track < 10 && c.component !== "audio");
      if (!plans.length)
        throw Error("Cette retouche se pose sur un plan vidéo.");
      if (plans.some((c) => verrouille(next, c))) throw Error(DEVERROUILLEZ);
      // Sur plusieurs plans, le ralenti fluide va à ceux qui ralentissent.
      const ralentis = plans.filter((c) => c.speed < 0.95);
      if (action.kind === "video.smoothslow" && !ralentis.length)
        throw Error(
          "Le ralenti fluide ne s’applique qu’à un plan ralenti sous 1×.",
        );
      for (const c of action.kind === "video.smoothslow" ? ralentis : plans) {
        if (action.kind === "video.denoise") c.denoise = action.level;
        else if (action.kind === "video.stabilise") c.stabilise = action.strength;
        else if (action.kind === "video.smoothslow") c.smoothSlow = action.on;
        else {
          const frames = Math.max(1, Math.min(240, frame(action.seconds, next)));
          if (frames > c.duration)
            throw Error("La transition dure plus longtemps que le plan.");
          c.transition = { kind: action.transition, duration: frames };
        }
      }
      continue;
    }
    if (action.kind === "video.depth") {
      // Relief applies to the graphics, which is where it means something.
      const targets = next.titles.filter(
        (t) => t.start <= at && t.start + t.duration > at,
      );
      if (!targets.length)
        throw Error("Placez le curseur sur un titre ou un élément graphique.");
      for (const t of targets)
        t.depth = { extrude: action.extrude, angle: 45, light: 0.4 };
      continue;
    }
    if (action.kind === "video.mask" || action.kind === "video.track") {
      if (ids.length !== 1)
        throw Error("Sélectionnez un seul plan pour son masque.");
      const clip = next.clips.find((c) => c.id === ids[0])!;
      if (clip.track >= 10 || clip.component === "audio")
        throw Error("Un masque se pose sur un plan vidéo.");
      if (verrouille(next, clip)) throw Error(DEVERROUILLEZ);
      const local = Math.max(0, Math.min(clip.duration - 1, at - clip.start));
      if (action.kind === "video.mask") {
        const masks = clip.masks ?? [];
        if (masks.length >= MASK_LIMIT)
          throw Error(`Maximum de ${MASK_LIMIT} masques par plan.`);
        clip.masks = [
          ...masks,
          {
            ...newMask(action.effect),
            keys: [{ frame: local, x: 0.5, y: 0.5 }],
          },
        ];
      } else if (!clip.masks?.length)
        // Tracking needs a mask to follow; say so instead of doing nothing.
        throw Error("Ajoutez d’abord un masque sur ce plan.");
      continue;
    }
    const affected = new Set<string>();
    const soundOnly =
      (action.kind === "video.adjust" || action.kind === "video.animate") &&
      action.field === "gain";
    const linked =
      action.kind === "video.trim" ||
      action.kind === "video.fade" ||
      (action.kind === "video.adjust" && action.field === "speed");
    for (const id of ids) {
      const group = linkedClips(next, id),
        selected = next.clips.find((c) => c.id === id)!;
      const targets = linked
        ? group
        : soundOnly && selected.component === "video"
          ? group.filter((c) => c.component === "audio")
          : [selected];
      if (targets.some((c) => verrouille(next, c))) throw Error(DEVERROUILLEZ);
      for (const c of targets) affected.add(c.id);
    }
    if (!affected.size)
      throw Error(
        "Ce plan ne contient pas de son lié. Sélectionnez un bloc audio.",
      );
    next.clips = next.clips.map((c) => {
      if (!affected.has(c.id)) return c;
      if (action.kind === "video.animate") {
        const begin = Math.round(at - c.start),
          end = begin + frame(action.seconds, next);
        const convert = (n: number) =>
          action.field === "gain" ? Math.pow(10, n / 20) : n / 100;
        return addKey(
          addKey(c, action.field, begin, convert(action.from), "smooth"),
          action.field,
          end,
          convert(action.to),
          "linear",
        );
      }
      if (action.kind === "video.style") {
        if (!STYLES.some((s) => s.id === action.style))
          throw Error("Style vidéo indisponible.");
        return {
          ...c,
          grade: { ...c.grade, style: action.style, intensity: 1 },
        };
      }
      if (action.kind === "video.fade") {
        if (
          !Number.isFinite(action.seconds) ||
          action.seconds < 0 ||
          action.seconds > 60
        )
          throw Error("Fondu : choisissez entre 0 et 60 secondes.");
        const f = Math.min(
          Math.floor(c.duration / 2),
          frame(action.seconds, next),
        );
        // Sans précision, l'entrée seule : c'est ce que dit le guide.
        const bouts = action.bouts ?? "entree";
        return {
          ...c,
          fadeIn: bouts === "sortie" ? c.fadeIn : f,
          fadeOut: bouts === "entree" ? c.fadeOut : f,
        };
      }
      if (action.kind === "video.trim") {
        if (!Number.isFinite(action.seconds) || action.seconds <= 0)
          throw Error("Précisez une durée positive en secondes.");
        const asset = assets.find((a) => a.id === c.assetId)!;
        const demandee = frame(action.seconds, next);
        const duration = action.retire ? c.duration - demandee : demandee;
        if (duration < 1)
          throw Error(
            "Le plan dure moins que la durée à retirer. Rien n’a été modifié.",
          );
        if (action.raccourcit && duration > c.duration)
          throw Error(
            "Le plan est déjà plus court : « raccourcis à » ne l’allonge pas. Dites « règle la durée à » pour l’allonger. Rien n’a été modifié.",
          );
        if (
          !asset ||
          (asset.kind !== "image" &&
            c.inUs / 1e6 + (duration / fps(next)) * c.speed >
              asset.duration + 0.01)
        )
          throw Error("La durée demandée dépasse le média source.");
        return {
          ...c,
          duration,
          fadeIn: Math.min(c.fadeIn, duration),
          fadeOut: Math.min(c.fadeOut, duration),
        };
      }
      if (action.kind !== "video.adjust")
        throw Error("Cette opération nécessite une exécution séparée.");
      const { field, relative } = action;
      let value = action.value;
      const keys = c.animation?.[field as AnimatedField];
      const animated = keys?.length
        ? valueAt(keys, at - c.start, Number(c[field as keyof Clip]))
        : undefined;
      if (field === "gain")
        value =
          Math.pow(10, value / 20) * (relative ? (animated ?? c.gain) : 1);
      else if (
        ["x", "y", "opacity", "scale", "saturation", "contrast"].includes(field)
      )
        value /= 100;
      const grade = ["exposure", "saturation", "contrast"].includes(field);
      const base = grade
        ? Number(c.grade[field as keyof typeof c.grade])
        : (animated ?? Number(c[field as keyof Clip]));
      if (relative && field !== "gain") value += base;
      // « augmente … à N » ne doit pas baisser, ni l'inverse.
      if (action.sens && !relative && (value - base) * action.sens < 0)
        throw Error(
          sensContraire(
            affichee(field, base),
            affichee(field, value),
            action.sens,
          ),
        );
      bounded(field, value);
      if (keys?.length)
        return addKey(
          c,
          field as AnimatedField,
          at - c.start,
          value,
          keys.find((k) => k.frame === at - c.start)?.easing || "linear",
        );
      if (field === "speed") {
        // Preserve the source range, matching the manual speed control.
        return {
          ...c,
          speed: value,
          duration: Math.max(1, Math.round((c.duration * c.speed) / value)),
          animation: retimeAnimation(c.animation, 0, c.speed / value),
          masks: retimeMasks(
            c,
            0,
            c.speed / value,
            Math.max(1, Math.round((c.duration * c.speed) / value)),
          ),
          fadeIn: 0,
          fadeOut: 0,
        };
      }
      return grade
        ? { ...c, grade: { ...c.grade, [field]: value } }
        : { ...c, [field]: value };
    });
  }
  return next;
}

/** Deterministic editable rough cut from available footage, not a generated film. */
export function assembleVideo(
  base: Sequence,
  assets: Asset[],
  seconds: number,
  vertical: boolean,
): Sequence {
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 7200)
    throw Error("Choisissez une durée de 1 seconde à 2 heures.");
  const footage = assets.filter(
    (a) =>
      a.status === "ready" &&
      a.kind !== "audio" &&
      (a.kind === "image" || a.duration > 0.2),
  );
  if (!footage.length)
    throw Error("Importez des images ou des rushes prêts à monter.");
  let next: Sequence = {
    ...structuredClone(base),
    id: crypto.randomUUID(),
    version: 1,
    name:
      (vertical ? "Teaser vertical" : "Premier assemblage") +
      " · " +
      Math.round(seconds) +
      " s",
    clips: [],
    titles: [],
    captions: [],
    markers: [],
    created: Date.now(),
    width: vertical ? 1080 : base.width,
    height: vertical ? 1920 : base.height,
  };
  const target = frame(seconds, next),
    perClip = Math.max(1, Math.ceil(target / footage.length));
  for (const asset of footage) {
    const remaining = target - length(next);
    if (remaining <= 0) break;
    const scene =
      asset.analysis?.scenes.find((t) => t > 0 && t < asset.duration - 1) || 0;
    const available =
      asset.kind === "image"
        ? remaining
        : Math.floor((asset.duration - scene) * fps(next));
    if (available < 1) continue;
    const first = next.clips.length;
    next = addClip(next, asset);
    const c = next.clips[first];
    for (const member of next.clips.slice(first)) {
      member.inUs = Math.round(scene * 1e6);
      member.duration = Math.min(remaining, perClip, available);
    }
    next.markers.push({
      id: crypto.randomUUID(),
      frame: c.start,
      text: asset.name,
    });
  }
  return next;
}

export function captionsFromTranscript(
  sequence: Sequence,
  assets: Asset[],
): Sequence {
  const captions = [] as Sequence["captions"];
  for (const c of sequence.clips.filter((c) => c.track < 10)) {
    const asset = assets.find((a) => a.id === c.assetId);
    captions.push(...clipCaptions(asset?.transcript ?? [], c, sequence));
  }
  if (!captions.length)
    throw Error(
      "Transcrivez les rushes utilisés dans la séquence avant de créer les sous-titres.",
    );
  if (sequence.captions.length)
    throw Error(
      "Cette séquence contient déjà des sous-titres. Dupliquez-la pour préserver les corrections existantes.",
    );
  return { ...sequence, captions };
}
