import { audioMix } from "./audio-mix";
import { retimeAnimation } from "./animation";
import { retimeMasks } from "./masks";
import type { Sequence, Clip, Asset, Grade } from "./types";
export const BASE_GRADE: Grade = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  warmth: 0,
  tint: 0,
  fade: 0,
  style: "original",
  intensity: 1,
};
export const fps = (s: Sequence) => s.fps.n / s.fps.d;
export const seconds = (frames: number, s: Sequence) =>
  (frames * s.fps.d) / s.fps.n;
export const frame = (time: number, s: Sequence) => Math.round(time * fps(s));
export const length = (s: Sequence) =>
  Math.max(
    0,
    ...s.clips.map((c) => c.start + c.duration),
    ...s.titles.map((c) => c.start + c.duration),
    ...s.captions.map((c) => c.start + c.duration),
  );
export const timecode = (f: number, s: Sequence) => {
  const rate = Math.round(fps(s)),
    total = Math.max(0, Math.floor(f)),
    sec = Math.floor(total / rate);
  return [
    Math.floor(sec / 3600),
    Math.floor(sec / 60) % 60,
    sec % 60,
    total % rate,
  ]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
};
/**
 * La piste où poser un média : un son va sur les pistes son (A1 et
 * suivantes), une image ou une vidéo sur les pistes image. Un son lâché sur
 * V1 produisait un plan que l'enregistrement refusait, et une vidéo lâchée
 * sur A2 perdait son image sans rien dire.
 */
export function trackFor(a: Pick<Asset, "kind">, track: number): number {
  const t = Math.max(0, Math.min(19, Math.round(track) || 0));
  if (a.kind === "audio") return t < 10 ? 10 + t : t;
  return t >= 10 ? t - 10 : t;
}
export function addClip(
  s: Sequence,
  a: Asset,
  start = length(s),
  track = a.kind === "audio" ? 10 : 0,
): Sequence {
  const c: Clip = {
    id: crypto.randomUUID(),
    assetId: a.id,
    start,
    duration: Math.max(1, frame(a.kind === "image" ? 5 : a.duration, s)),
    inUs: 0,
    track: trackFor(a, track),
    speed: 1,
    gain: 1,
    muted: false,
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    fadeIn: 0,
    fadeOut: 0,
    grade: { ...BASE_GRADE },
  };
  return expandAV({ ...s, clips: [...s.clips, c] }, [a]);
}
/**
 * Le point source d'une image, en microsecondes, arrondi vers le bas.
 *
 * Arrondi au plus près, il tombait parfois une fraction de microseconde après
 * l'instant exact de l'image (37 images en 29,97 font 1 234 566,67 µs) : la
 * lecture commençait alors à l'image suivante et le plan perdait sa première
 * image.
 */
export const sourceMicros = (frames: number, s: Sequence, speed = 1) =>
  Math.floor(seconds(frames, s) * speed * 1e6 + 1e-6);
/**
 * La marge de lecture de l'export, en secondes (render.cjs, `SEEK_SLACK`) :
 * une image du rush passe à l'écran si elle commence au plus une milliseconde
 * après l'instant voulu.
 */
export const EXPORT_SLACK = 0.001;
/**
 * La cadence des images d'un média, celle de la séquence à défaut. Sur un
 * rush à cadence variable, ce n'est qu'une moyenne : elle règle un seuil
 * (`monitorTolerance`), jamais l'image montrée.
 */
export function mediaRate(a: Pick<Asset, "fps">, s: Sequence): number {
  const r = a.fps && a.fps.n > 0 && a.fps.d > 0 ? a.fps.n / a.fps.d : 0;
  return r > 0 && r <= 1000 ? r : fps(s);
}
const soundOf = (
  c: Pick<Clip, "component" | "track">,
  a: Pick<Asset, "kind">,
) => a.kind === "audio" || c.component === "audio" || c.track >= 10;
/**
 * La borne de l'export pour l'image `f` du montage, en microsecondes du
 * média, exclue : l'export y pose la dernière image du rush commencée avant
 * elle (render.cjs, `retime`). C'est l'instant voulu plus la marge d'une
 * milliseconde de montage, comptés comme FFmpeg les compte : instants
 * arrondis à la microseconde, divisés par la vitesse, tronqués (setpts), puis
 * arrondis vers le haut à la cadence de la séquence (fps).
 */
export function exportLimit(
  c: Pick<Clip, "start" | "inUs" | "speed">,
  s: Sequence,
  f: number,
): number {
  const elapsed = Math.floor(((f - c.start) * s.fps.d * 1e6) / s.fps.n);
  return c.inUs + c.speed * (elapsed + Math.round(EXPORT_SLACK * 1e6) + 1);
}
/**
 * Au-delà de la marge de l'export, en microsecondes : le navigateur ne
 * tranche qu'à une microseconde près autour du début d'une image. Mesuré dans
 * Electron le 29/09/2026 sur un aperçu 29,97 : une image qui commence pile à
 * l'instant demandé n'est montrée qu'à partir d'une microseconde après.
 */
const BROWSER_SLACK_US = 1.5;
/**
 * L'instant du média où le moniteur se place pour l'image `f` du montage,
 * sans connaître les instants des images du fichier.
 *
 * L'export pose à cette image la dernière image du rush commencée à l'instant
 * voulu, marge comprise : une milliseconde de montage, soit `speed`
 * millisecondes du rush (render.cjs, `retime`). Le navigateur, lui, montre
 * l'image du fichier dont l'intervalle contient l'instant qu'on lui donne. Le
 * moniteur se place donc à l'instant voulu plus cette même marge, et une
 * microseconde et demie de plus pour que le navigateur tranche comme l'export
 * quand une image commence exactement au bout de la marge : la règle de
 * l'export, sur les vrais instants du fichier, sans supposer aucune cadence.
 * Seule une image qui commence à une ou deux microsecondes de la borne de
 * l'export peut encore passer d'un côté au moniteur et de l'autre au film :
 * quand le moniteur connaît les instants des images, il se pose au milieu de
 * la bonne (`monitorFrameTime`).
 *
 * Posé pile sur l'instant voulu, il tombait sur la frontière et le navigateur
 * montrait l'image d'avant : deux images sur trois en 29,97, et tout le plan
 * de droite d'une coupe, dont le point source est arrondi vers le bas. Posé
 * au milieu d'une image comptée sur la cadence moyenne du rush, il se
 * trompait d'image dès que le rush n'avait pas une cadence régulière : sur un
 * rush d'iPhone où une seule image manque, 35 images sur 48 en 29,97. Et posé
 * à la marge seule, il perdait les images qui commencent exactement au bout
 * de la marge, que l'export garde : dans un rush 29,97 posé dans une séquence
 * 25, l'image 30 commence une milliseconde exactement après la première
 * seconde (29/09/2026). Un son reprend, lui, à l'instant exact.
 */
export function monitorTime(
  c: Pick<Clip, "start" | "inUs" | "speed" | "component" | "track">,
  a: Pick<Asset, "kind">,
  s: Sequence,
  f: number,
): number {
  if (a.kind === "image") return 0;
  if (soundOf(c, a))
    return Math.max(0, c.inUs / 1e6 + seconds(f - c.start, s) * c.speed);
  // En microsecondes : à l'échelle de la seconde, l'arrondi des flottants
  // pèserait autant que l'écart qu'on règle.
  const elapsed = ((f - c.start) * s.fps.d * 1e6) / s.fps.n,
    micros =
      c.inUs + c.speed * (elapsed + EXPORT_SLACK * 1e6) + BROWSER_SLACK_US;
  return Math.max(0, micros / 1e6);
}
/**
 * L'instant où le moniteur se place pour l'image `f` du montage quand il
 * connaît les instants des images du fichier qu'il lit (`times`, en
 * microsecondes, croissants : frame-index.ts) : le milieu de l'image que
 * l'export y pose, la dernière commencée avant sa borne (`exportLimit`).
 * Loin des deux frontières, le navigateur ne peut plus hésiter, quelle que
 * soit la cadence du rush. Avant la première image, l'export répète la
 * première ; après la dernière, il garde la dernière.
 */
export function monitorFrameTime(
  times: readonly number[],
  c: Pick<Clip, "start" | "inUs" | "speed">,
  s: Sequence,
  f: number,
): number {
  const limit = exportLimit(c, s, f);
  let low = 0,
    high = times.length - 1,
    k = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] < limit) {
      k = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  const start = times[k],
    end =
      k + 1 < times.length
        ? times[k + 1]
        : start + (k > 0 ? start - times[k - 1] : 40000);
  return Math.max(0, (start + end) / 2 / 1e6);
}
/**
 * L'écart toléré entre le moniteur et sa cible avant de le replacer, en
 * secondes. À l'arrêt, il ne dépasse jamais un quart d'image du média : les
 * 18 ms d'avant dépassaient une image entière en 59,94, et le moniteur
 * restait sur la même image quand on avançait d'une image. À l'arrêt, le
 * moniteur est aussi replacé dès que sa cible change (`monitorMustSeek`).
 */
export function monitorTolerance(
  c: Pick<Clip, "component" | "track">,
  a: Pick<Asset, "kind" | "fps">,
  s: Sequence,
  playing: boolean,
): number {
  if (playing) return 0.13;
  return soundOf(c, a) ? 0.018 : Math.min(0.018, 0.25 / mediaRate(a, s));
}
/**
 * Replacer le moniteur sur sa cible ?
 *
 * En lecture, seulement s'il s'en écarte de plus que la tolérance. À l'arrêt,
 * aussi dès que la cible a changé depuis qu'on l'y a posé (`placed`, sans
 * valeur après une lecture ou un changement de fichier). La cible ne tombe
 * plus sur une grille d'images : au ralenti, une image de montage la fait
 * avancer de moins d'un quart d'image du rush (8,3 ms à 0,25× en 29,97 pour
 * un rush à 25 i/s, sous le seuil de 10 ms), et le moniteur restait sur
 * l'image d'avant quand une frontière tombait entre les deux. De même à
 * l'arrêt d'une lecture, arrêtée à moins d'un quart d'image de la cible.
 */
export function monitorMustSeek(
  current: number,
  target: number,
  placed: number | undefined,
  tolerance: number,
  playing: boolean,
): boolean {
  return (
    (!playing && placed !== target) || Math.abs(current - target) > tolerance
  );
}
/** Le plafond de durée d'une transition, en images (transitions.cjs). */
export const TRANSITION_MAX = 240;
/**
 * La transition d'entrée ramenée à la durée du plan, ou retirée quand il ne
 * reste plus rien à ouvrir. Sans cela, une coupe, un rognage ou un changement
 * de vitesse laissait une transition plus longue que le plan, que
 * l'enregistrement refusait.
 */
export function fitTransition(
  transition: Clip["transition"],
  duration: number,
): Clip["transition"] {
  if (!transition) return undefined;
  const d = Math.min(TRANSITION_MAX, Math.round(transition.duration), duration);
  return d >= 1 ? { ...transition, duration: d } : undefined;
}
/** Toutes les transitions de la séquence ramenées à la durée de leur plan. */
export function fitTransitions(s: Sequence): Sequence {
  let changed = false;
  const clips = s.clips.map((c) => {
    if (!c.transition) return c;
    const t = fitTransition(c.transition, c.duration);
    if (t && t.duration === c.transition.duration) return c;
    changed = true;
    return { ...c, transition: t };
  });
  return changed ? { ...s, clips } : s;
}
function splitOne(s: Sequence, id: string, at: number): Sequence {
  const c = s.clips.find((c) => c.id === id);
  if (!c || at <= c.start || at >= c.start + c.duration) return s;
  const left = at - c.start,
    right = c.duration - left;
  return {
    ...s,
    clips: s.clips.flatMap((p) =>
      p.id !== id
        ? [p]
        : [
            {
              ...c,
              duration: left,
              fadeIn: Math.min(c.fadeIn, left),
              fadeOut: 0,
              masks: retimeMasks(c, 0, 1, left),
              transition: fitTransition(c.transition, left),
            },
            {
              ...c,
              id: crypto.randomUUID(),
              start: at,
              duration: right,
              inUs: c.inUs + sourceMicros(left, s, c.speed),
              animation: retimeAnimation(c.animation, left),
              masks: retimeMasks(c, left, 1, right),
              fadeIn: 0,
              fadeOut: Math.min(c.fadeOut, right),
              // La moitié droite continue le plan : l'ouvrir par une
              // transition ferait un fondu au milieu d'une prise continue.
              transition: undefined,
            },
          ],
    ),
  };
}
function removeOne(s: Sequence, id: string, ripple = false): Sequence {
  const c = s.clips.find((c) => c.id === id);
  if (!c) return s;
  return {
    ...s,
    clips: s.clips
      .filter((p) => p.id !== id)
      .map((p) =>
        ripple && p.track === c.track && p.start >= c.start + c.duration
          ? { ...p, start: p.start - c.duration }
          : p,
      ),
  };
}
function trimOne(
  s: Sequence,
  id: string,
  edge: "start" | "end",
  to: number,
): Sequence {
  return {
    ...s,
    clips: s.clips.map((c) => {
      if (c.id !== id) return c;
      let start = c.start,
        duration = c.duration,
        inUs = c.inUs;
      if (edge === "start") {
        const minimum = c.start - Math.floor((c.inUs / 1e6 / c.speed) * fps(s));
        start = Math.max(0, minimum, Math.min(to, c.start + c.duration - 1));
        duration = c.duration + c.start - start;
        inUs = Math.max(0, c.inUs + sourceMicros(start - c.start, s, c.speed));
      } else duration = Math.max(1, to - c.start);
      return {
        ...c,
        start,
        duration,
        inUs,
        animation: retimeAnimation(c.animation, start - c.start),
        masks: retimeMasks(c, start - c.start, 1, duration),
        fadeIn: Math.min(c.fadeIn, duration),
        fadeOut: Math.min(c.fadeOut, duration),
        transition: fitTransition(c.transition, duration),
      };
    }),
  };
}
/** Expand legacy combined clips in memory. Persist through the ordinary versioned writer. */
export function expandAV(s: Sequence, assets: Asset[]): Sequence {
  const map = new Map(assets.map((a) => [a.id, a]));
  let changed = false;
  const clips = s.clips.flatMap((c) => {
    const a = map.get(c.assetId);
    if (c.component || !a) return [c];
    changed = true;
    if (a.kind === "audio" || c.track >= 10)
      return [
        {
          ...c,
          component: "audio" as const,
          audioRole: c.audioRole || ("music" as const),
        },
      ];
    if (!a.audioChannels || a.kind !== "video")
      return [{ ...c, component: "video" as const }];
    const linkId = "av-" + crypto.randomUUID();
    return [
      {
        ...c,
        component: "video" as const,
        linkId,
        animation: c.animation
          ? { ...c.animation, gain: undefined }
          : undefined,
      },
      {
        ...c,
        id: crypto.randomUUID(),
        component: "audio" as const,
        track: 10 + Math.min(9, c.track),
        linkId,
        audioRole: "voice" as const,
        animation: c.animation?.gain ? { gain: c.animation.gain } : undefined,
        grade: { ...BASE_GRADE },
      },
    ];
  });
  if (clips.length > 20000)
    throw Error(
      "Séquence trop volumineuse pour séparer toutes les pistes. Créez plusieurs séquences.",
    );
  return changed ? { ...s, audioLayoutVersion: 1, clips } : s;
}
export function linkedClips(s: Sequence, id: string) {
  const c = s.clips.find((c) => c.id === id);
  return c
    ? s.clips.filter(
        (p) => p.id === id || (!!c.linkId && p.linkId === c.linkId),
      )
    : [];
}
export function unlink(s: Sequence, id: string): Sequence {
  const ids = new Set(linkedClips(s, id).map((c) => c.id));
  return {
    ...s,
    clips: s.clips.map((c) =>
      ids.has(c.id) ? { ...c, linkId: undefined } : c,
    ),
  };
}
export function moveClip(
  s: Sequence,
  id: string,
  start: number,
  track?: number,
): Sequence {
  const c = s.clips.find((c) => c.id === id),
    group = linkedClips(s, id);
  if (
    !c ||
    group.some((x) => s.tracks?.[x.track]?.locked) ||
    (track !== undefined && s.tracks?.[track]?.locked)
  )
    return s;
  const delta = Math.max(
      -Math.min(...group.map((x) => x.start)),
      Math.round(start - c.start),
    ),
    ids = new Set(group.map((x) => x.id));
  return {
    ...s,
    clips: s.clips.map((x) =>
      ids.has(x.id)
        ? {
            ...x,
            start: x.start + delta,
            track: x.id === id && track !== undefined ? track : x.track,
          }
        : x,
    ),
  };
}

/** Sur une même piste image, le nouveau plan remplace la portion couverte.
 * Les parties avant/après et leur son lié restent dans le montage. Des pistes
 * image différentes gardent naturellement leurs plans superposés. */
export function overwriteVideoTrack(
  s: Sequence,
  placedIds: string[],
): Sequence {
  let next = s;
  const placed = new Set(placedIds);
  for (const id of placedIds) {
    const incoming = next.clips.find((c) => c.id === id);
    if (!incoming || incoming.track >= 10 || incoming.component === "audio")
      continue;
    const from = incoming.start,
      to = from + incoming.duration;
    const candidates = next.clips
      .filter(
        (c) =>
          c.track === incoming.track &&
          c.component !== "audio" &&
          !placed.has(c.id) &&
          c.start < to &&
          c.start + c.duration > from,
      )
      .map((c) => c.id);
    for (const candidate of candidates) {
      let old = next.clips.find((c) => c.id === candidate);
      if (
        !old ||
        old.track !== incoming.track ||
        old.start >= to ||
        old.start + old.duration <= from
      )
        continue;
      if (linkedClips(next, old.id).some((c) => next.tracks?.[c.track]?.locked))
        throw Error("Déverrouillez la piste avant de la modifier.");
      if (old.start < from && old.start + old.duration > from) {
        next = split(next, old.id, from);
        old = next.clips.find(
          (c) =>
            c.track === incoming.track && !placed.has(c.id) && c.start === from,
        );
      }
      if (!old) continue;
      if (old.start + old.duration > to) next = split(next, old.id, to);
      old = next.clips.find(
        (c) =>
          c.track === incoming.track &&
          !placed.has(c.id) &&
          c.start >= from &&
          c.start < to,
      );
      if (old) next = remove(next, old.id);
    }
  }
  return next;
}
export function split(s: Sequence, id: string, at: number): Sequence {
  const group = linkedClips(s, id);
  if (group.some((c) => s.tracks?.[c.track]?.locked)) return s;
  let next = s;
  const rightLink = group.length > 1 ? "av-" + crypto.randomUUID() : undefined;
  for (const c of group) {
    const old = new Set(next.clips.map((x) => x.id));
    next = splitOne(next, c.id, at);
    if (rightLink)
      next = {
        ...next,
        clips: next.clips.map((x) =>
          !old.has(x.id) ? { ...x, linkId: rightLink } : x,
        ),
      };
  }
  return next;
}
export function remove(s: Sequence, id: string, ripple = false): Sequence {
  const group = linkedClips(s, id);
  if (group.some((c) => s.tracks?.[c.track]?.locked)) return s;
  let next = s;
  for (const c of group) next = removeOne(next, c.id, ripple);
  return next;
}
export function trim(
  s: Sequence,
  id: string,
  edge: "start" | "end",
  to: number,
): Sequence {
  const group = linkedClips(s, id),
    c = s.clips.find((c) => c.id === id);
  if (!c || group.some((c) => s.tracks?.[c.track]?.locked)) return s;
  const requested =
    Math.round(to) - (edge === "start" ? c.start : c.start + c.duration);
  const minimum =
    edge === "start"
      ? Math.max(
          ...group.map((x) =>
            Math.max(-x.start, -Math.floor((x.inUs / 1e6 / x.speed) * fps(s))),
          ),
        )
      : Math.max(...group.map((x) => 1 - x.duration));
  const maximum =
    edge === "start" ? Math.min(...group.map((x) => x.duration - 1)) : Infinity;
  const delta = Math.max(minimum, Math.min(maximum, requested));
  let next = s;
  for (const x of group)
    next = trimOne(
      next,
      x.id,
      edge,
      (edge === "start" ? x.start : x.start + x.duration) + delta,
    );
  return next;
}
export function duplicateClip(s: Sequence, id: string): Sequence {
  const group = linkedClips(s, id),
    c = s.clips.find((c) => c.id === id);
  if (!c || group.some((x) => s.tracks?.[x.track]?.locked)) return s;
  const linkId = group.length > 1 ? "av-" + crypto.randomUUID() : undefined;
  return {
    ...s,
    clips: [
      ...s.clips,
      ...group.map((x) => ({
        ...structuredClone(x),
        id: crypto.randomUUID(),
        start: x.start + c.duration,
        linkId,
      })),
    ],
  };
}
export function audioAudible(s: Sequence, c: Clip) {
  return audioMix(s, c).audible;
}
export function srt(s: Sequence): string {
  const stamp = (f: number) => {
    const ms = Math.round(seconds(f, s) * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return (
    [...s.captions]
      .sort((a, b) => a.start - b.start)
      .map(
        (c, i) =>
          `${i + 1}\n${stamp(c.start)} --> ${stamp(c.start + c.duration)}\n${c.text}`,
      )
      .join("\n\n") + "\n"
  );
}
/**
 * Les passages à retirer d'un plan, en images de montage.
 *
 * Les silences viennent de l'analyse du média, en secondes de source : ils
 * sont ramenés sur la ligne de temps en tenant compte du point d'entrée et de
 * la vitesse. Chaque silence est rétréci de `margin` de chaque côté, pour ne
 * jamais rogner le début d'un mot, puis écarté s'il ne vaut plus la peine.
 */
export function silenceCuts(
  s: Sequence,
  clip: Clip,
  asset: Asset | undefined,
  { margin = 0.15, minSilence = 0.6 } = {},
): { start: number; duration: number }[] {
  const silences = asset?.analysis?.silences;
  if (!Array.isArray(silences) || !silences.length) return [];
  return rangeCuts(s, clip, silences, { margin, minimum: minSilence });
}
/**
 * Des passages de la source (en secondes du média), ramenés en morceaux à
 * retirer d'un plan, en images de montage : `silenceCuts` pour les blancs,
 * le dérushage pour les passages inutilisables (derush.ts).
 *
 * Un blanc ne se retire qu'au milieu du plan : le plan garde au moins une
 * image de chaque côté. `bords` retire aussi ce qui touche le début ou la
 * fin du plan, et le plan entier s'il est couvert : un passage inutilisable
 * est le plus souvent au début ou à la fin d'un rush (l'appui sur le bouton).
 */
export function rangeCuts(
  s: Sequence,
  clip: Clip,
  ranges: { start: number; end: number }[],
  { margin = 0, minimum = 0, bords = false } = {},
): { start: number; duration: number }[] {
  const rate = fps(s),
    inSec = clip.inUs / 1e6,
    speed = clip.speed || 1;
  const clipEnd = clip.start + clip.duration;
  const cuts: { start: number; duration: number }[] = [];
  for (const raw of ranges) {
    const from = raw.start + margin,
      to = raw.end - margin;
    if (!(to - from >= minimum) || !(to > from)) continue;
    const a = Math.round(clip.start + ((from - inSec) / speed) * rate),
      b = Math.round(clip.start + ((to - inSec) / speed) * rate);
    const start = Math.max(a, clip.start),
      end = Math.min(b, clipEnd);
    if (bords) {
      if (end - start >= 1) cuts.push({ start, duration: end - start });
      continue;
    }
    // Un plan doit garder au moins une image de chaque côté d'une coupe.
    if (end - start < 1 || start <= clip.start || end >= clipEnd) {
      if (end - start >= 1 && start > clip.start && end >= clipEnd)
        cuts.push({ start, duration: clipEnd - start - 1 });
      continue;
    }
    cuts.push({ start, duration: end - start });
  }
  return cuts
    .filter((c) => c.duration >= 1)
    .sort((a, b) => a.start - b.start)
    .filter(
      (c, i, list) =>
        i === 0 || c.start >= list[i - 1].start + list[i - 1].duration,
    );
}
/**
 * Retire les silences d'un plan et referme les trous.
 *
 * Les plans liés image et son suivent, et ce qui vient après sur les mêmes
 * pistes est décalé d'autant : un discours raccourci ne laisse pas de blanc.
 */
export function removeSilence(
  s: Sequence,
  id: string,
  assets: Asset[],
  options?: { margin?: number; minSilence?: number },
): { sequence: Sequence; removed: number; cuts: number } {
  const clip = s.clips.find((c) => c.id === id);
  if (!clip) return { sequence: s, removed: 0, cuts: 0 };
  const asset = assets.find((a) => a.id === clip.assetId);
  return removeCuts(s, id, silenceCuts(s, clip, asset, options));
}
/**
 * Retire d'un plan des morceaux (en images de montage, `rangeCuts`) et
 * referme les trous. Les plans liés image et son suivent, et ce qui vient
 * après sur les mêmes pistes est décalé d'autant.
 */
export function removeCuts(
  s: Sequence,
  id: string,
  cuts: { start: number; duration: number }[],
): { sequence: Sequence; removed: number; cuts: number } {
  const clip = s.clips.find((c) => c.id === id);
  if (!clip) return { sequence: s, removed: 0, cuts: 0 };
  const group = linkedClips(s, id);
  if (group.some((c) => s.tracks?.[c.track]?.locked))
    return { sequence: s, removed: 0, cuts: 0 };
  if (!cuts.length) return { sequence: s, removed: 0, cuts: 0 };
  let next = s,
    removed = 0;
  // De la fin vers le début : une coupe tardive ne déplace jamais les bornes
  // des coupes qui la précèdent.
  for (const cut of [...cuts].reverse()) {
    const end = cut.start + cut.duration;
    let step = split(next, id, end);
    const middle = step.clips.find(
      (c) =>
        c.track === clip.track &&
        c.start <= cut.start &&
        c.start + c.duration > cut.start,
    );
    if (!middle) continue;
    step = split(step, middle.id, cut.start);
    const doomed = step.clips.find(
      (c) => c.track === clip.track && c.start === cut.start,
    );
    if (!doomed || doomed.duration !== cut.duration) continue;
    next = closeGap(remove(step, doomed.id, true), cut.start, cut.duration);
    removed += cut.duration;
  }
  return { sequence: next, removed, cuts: cuts.length };
}
/**
 * Referme un trou de `gap` images ouvert à l'image `at` pour ce qui n'est pas
 * un plan : titres, sous-titres et marqueurs.
 *
 * Ce qui tombe dans le trou disparaît, ce qui le chevauche est raccourci, ce
 * qui vient après avance d'autant. Un marqueur est une note de l'utilisateur :
 * s'il tombe dans le trou, il est ramené au bord au lieu d'être effacé. Sans
 * cela, « Retirer les blancs » laissait chaque sous-titre à l'endroit où l'on
 * n'entendait plus sa phrase, et allongeait le film de noir.
 */
export function closeGap(s: Sequence, at: number, gap: number): Sequence {
  if (!(gap >= 1)) return s;
  const end = at + gap,
    place = (f: number) => (f <= at ? f : f >= end ? f - gap : at);
  function timed<T extends { start: number; duration: number }>(t: T) {
    const start = place(t.start),
      finish = place(t.start + t.duration);
    return finish - start >= 1
      ? { ...t, start, duration: finish - start }
      : null;
  }
  const titles = s.titles.flatMap((t) => {
    const next = timed(t);
    if (!next) return [];
    if (next.motionOrigin !== undefined)
      next.motionOrigin = Math.min(next.start, place(next.motionOrigin));
    return [next];
  });
  const captions = s.captions.flatMap((c) => {
    const next = timed(c);
    if (!next) return [];
    if (!c.words?.length) return [next];
    const words = c.words.flatMap((w) => {
      const from = place(c.start + w.start) - next.start,
        to = place(c.start + w.end) - next.start;
      return to - from >= 1 ? [{ ...w, start: from, end: to }] : [];
    });
    const { words: _old, ...rest } = next;
    return [words.length ? { ...rest, words } : rest];
  });
  return {
    ...s,
    titles,
    captions,
    markers: s.markers.map((m) => ({ ...m, frame: place(m.frame) })),
  };
}
