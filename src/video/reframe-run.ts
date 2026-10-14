/**
 * Recadrer les plans d'une séquence pour son format.
 *
 * C'est le passage qui relie les trois morceaux : relever les visages sur
 * quelques images, calculer le cadre, le poser sur le plan. Séparé de
 * l'interface pour rester lisible, et pour qu'on puisse l'appeler sur un seul
 * plan quand on change son mode de cadrage.
 */
import { cadrerPlan, type Mode } from "./reframe";
import { appliquerCadrage } from "./reframe-apply";
import { releverVisages } from "./reframe-scan";
import { seconds } from "./edit";
import type { Asset, Clip, Sequence } from "./types";
export type Note = {
  clipId: string;
  nom: string;
  texte: string;
  tientTout: boolean;
  mode: Mode;
};
/**
 * Le cadrage à appliquer à un plan quand on recadre toute la séquence.
 *
 * Un plan réglé à la main n'est plus touché, et un plan déjà recadré garde son
 * choix : sans cela, un second clic sur « Recadrer » repassait tout sur le
 * couple et écrasait le travail fait plan par plan.
 */
export function modeDuPlan(c: Clip): Mode | null {
  if (c.reframe === "main") return null;
  return c.reframe || "couple";
}
/** Vrai quand la séquence n'a pas le format de ce plan, donc qu'il y a à faire. */
export function aRecadrer(clip: Clip, asset: Asset, s: Sequence) {
  if (asset.kind === "audio" || clip.component === "audio") return false;
  if (!asset.width || !asset.height) return false;
  const source = asset.width / asset.height,
    cible = s.width / s.height;
  return Math.abs(source - cible) > 0.01;
}
export type Avancement = (fait: number, total: number, nom: string) => void;
/**
 * @param cibles identifiants des plans à recadrer ; tous les plans concernés
 *               si la liste est absente
 */
export async function recadrer(
  s: Sequence,
  assets: Asset[],
  choix: Mode | ((c: Clip) => Mode | null),
  cibles?: string[],
  avancement?: Avancement,
  signal?: AbortSignal,
): Promise<{ sequence: Sequence; notes: Note[] }> {
  const parId = new Map(assets.map((a) => [a.id, a]));
  const modeDe = typeof choix === "function" ? choix : () => choix;
  const aFaire = s.clips.filter((c) => {
    const a = parId.get(c.assetId);
    if (!a || !aRecadrer(c, a, s)) return false;
    if (cibles && !cibles.includes(c.id)) return false;
    return modeDe(c) !== null;
  });
  const notes: Note[] = [];
  const cadres = new Map<string, Clip>();
  for (const [i, clip] of aFaire.entries()) {
    if (signal?.aborted) break;
    const asset = parId.get(clip.assetId)!;
    avancement?.(i, aFaire.length, asset.name);
    // Une image fixe n'a qu'un seul état : un seul relevé suffit.
    const duree =
      asset.kind === "image" ? 0 : seconds(clip.duration, s) * clip.speed;
    const releve = await releverVisages(
      asset.proxy || asset.source,
      clip.inUs / 1e6,
      duree,
      asset.kind === "image" ? 1 : undefined,
      signal,
    );
    const mode = modeDe(clip)!;
    const resultat = cadrerPlan(
      releve.echantillons,
      releve.source,
      { w: s.width, h: s.height },
      mode,
    );
    cadres.set(clip.id, {
      ...appliquerCadrage(clip, resultat, s.fps.n / s.fps.d),
      reframe: mode,
    });
    notes.push({
      clipId: clip.id,
      nom: asset.name,
      texte: resultat.note,
      tientTout: resultat.tientTout,
      mode,
    });
  }
  avancement?.(aFaire.length, aFaire.length, "");
  return {
    sequence: { ...s, clips: s.clips.map((c) => cadres.get(c.id) || c) },
    notes,
  };
}
/** Ce qui décide du cadre d'un plan, tel que le relevé l'a vu. */
const cadreDe = (c: Clip) =>
  JSON.stringify([
    c.scale,
    c.x,
    c.y,
    c.reframe ?? null,
    c.animation?.x ?? null,
    c.animation?.y ?? null,
  ]);
/** Ce qui décide des images relevées : le média, son entrée, sa durée. */
const tempsDe = (c: Clip) =>
  JSON.stringify([c.assetId, c.inUs, c.speed, c.duration]);
/**
 * Pose le résultat d'un recadrage sur la séquence telle qu'elle est à son
 * retour, et non sur la copie prise au clic.
 *
 * Le relevé des visages dure de quelques secondes à plusieurs minutes, et le
 * montage reste ouvert pendant ce temps. Rendre la copie du clic avec les
 * nouveaux cadres défaisait tout ce qui avait été fait entre-temps, sans un
 * mot : un verrou posé pendant « Recadrage 1/30 » disparaissait à la fin.
 *
 * Seuls l'échelle, la position, leurs images clés et le mode de cadrage des
 * plans relevés sont reportés, et seulement sur un plan qui existe encore,
 * n'est pas sur une piste verrouillée, n'a pas été recadré à la main (ni
 * raccourci, ni changé de vitesse) pendant le relevé. Un format, une cadence
 * ou une séquence qui ont changé rendent tout le relevé caduc.
 *
 * @param courante la séquence affichée au retour du relevé
 * @param depart   la séquence au clic, celle qu'a lue le relevé
 * @param recadree `depart` avec les cadres calculés (résultat de `recadrer`)
 */
export function reporterCadrage(
  courante: Sequence,
  depart: Sequence,
  recadree: Sequence,
  notes: Note[],
):
  | { sequence: Sequence; notes: Note[]; ecartes: number }
  | { abandon: string } {
  if (courante.id !== depart.id)
    return {
      abandon:
        "Recadrage abandonné : une autre séquence a été ouverte pendant le relevé des visages.",
    };
  if (
    courante.width !== depart.width ||
    courante.height !== depart.height ||
    courante.fps.n !== depart.fps.n ||
    courante.fps.d !== depart.fps.d
  )
    return {
      abandon:
        "Recadrage abandonné : le format ou la cadence de la séquence a changé pendant le relevé des visages. Relancez « Recadrer ».",
    };
  const avant = new Map(depart.clips.map((c) => [c.id, c])),
    apres = new Map(recadree.clips.map((c) => [c.id, c])),
    maintenant = new Map(courante.clips.map((c) => [c.id, c]));
  const poses = new Map<string, Clip>(),
    gardees: Note[] = [];
  for (const note of notes) {
    const o = avant.get(note.clipId),
      fait = apres.get(note.clipId),
      c = maintenant.get(note.clipId);
    if (
      !o ||
      !fait ||
      !c ||
      courante.tracks?.[c.track]?.locked ||
      tempsDe(c) !== tempsDe(o) ||
      cadreDe(c) !== cadreDe(o)
    )
      continue;
    const animation = { ...c.animation };
    delete animation.x;
    delete animation.y;
    if (fait.animation?.x) animation.x = fait.animation.x;
    if (fait.animation?.y) animation.y = fait.animation.y;
    const plan: Clip = {
      ...c,
      scale: fait.scale,
      x: fait.x,
      y: fait.y,
      reframe: fait.reframe,
      animation,
    };
    if (!Object.keys(animation).length) delete plan.animation;
    poses.set(c.id, plan);
    gardees.push(note);
  }
  return {
    sequence: {
      ...courante,
      clips: courante.clips.map((c) => poses.get(c.id) ?? c),
    },
    notes: gardees,
    ecartes: notes.length - gardees.length,
  };
}
/** Le bilan à montrer, en français, sans jargon. */
export function bilan(notes: Note[]): string {
  if (!notes.length)
    return "Aucun plan à recadrer : ils sont déjà au format de la séquence, ou réglés à la main.";
  const serres = notes.filter((n) => !n.tientTout).length;
  const modes = new Set(notes.map((n) => n.mode));
  const qui =
    modes.size > 1
      ? "selon le choix de chaque plan"
      : modes.has("tous")
        ? "sur tout le monde"
        : "sur le couple";
  const base = `${notes.length} plan${notes.length > 1 ? "s" : ""} recadré${notes.length > 1 ? "s" : ""} ${qui}.`;
  if (!serres) return base;
  return (
    base +
    ` ${serres} ne tient pas entièrement dans le format vertical : ouvrez le plan pour choisir un autre cadrage.`
  );
}
