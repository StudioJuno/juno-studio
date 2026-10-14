import type { Asset, Clip, Derush, DerushEtat, DerushPlage, Sequence } from "./types";
import { addClip, fps, length, rangeCuts, removeCuts } from "./edit";

/**
 * Ce que l'interface fait du dérushage (electron/video/derush.cjs) : les
 * passages d'un rush, vos décisions appliquées par-dessus l'analyse ; ce qui
 * s'ajoute au montage ; ce qui se retire d'un plan déjà posé ; le
 * pré-montage. Rien n'est jamais supprimé d'un rush : masquer, c'est
 * seulement ne pas proposer.
 */

/** Les raisons, telles qu'on les lit. */
export const RAISONS: Record<string, string> = {
  noir: "Noir",
  flou: "Flou",
  "flou-leger": "Un peu flou",
  bouge: "Bougé",
  "bouge-leger": "Un peu bougé",
  brusque: "Mouvement brusque",
  surexpose: "Surexposé",
  declenchement: "Début ou fin d’enregistrement",
  accidentel: "Rush de moins d’une seconde",
  court: "Passage court entre deux défauts",
  immobile: "Rien ne bouge depuis plus de 2 min",
  choix: "Votre choix",
};
export const raisonLue = (r: string) => RAISONS[r] || r;

export const ETATS: Record<DerushEtat, string> = {
  bon: "Bon",
  verifier: "À vérifier",
  masque: "Masqué",
};

/** Le mouvement d'ensemble d'un rush, tel qu'on le lit. */
export const MOUVEMENTS: Record<string, string> = {
  fixe: "Fixe",
  maitrise: "Mouvement maîtrisé",
  main: "À la main",
};

// Un passage décidé reste à part de ses voisins de même état : réuni à
// eux, tout le passage se disait « Votre choix », et « Rendre à l'analyse »
// visait plus large que la décision.
const decide = (p: DerushPlage) => p.raisons.includes("choix");
const fusionner = (plages: DerushPlage[]) =>
  plages.reduce<DerushPlage[]>((acc, p) => {
    const d = acc[acc.length - 1];
    if (p.fin - p.debut <= 1e-6) return acc;
    if (d && d.etat === p.etat && decide(d) === decide(p) && Math.abs(d.fin - p.debut) < 1e-6) {
      d.fin = p.fin;
      for (const r of p.raisons) if (!d.raisons.includes(r)) d.raisons.push(r);
    } else acc.push({ ...p, raisons: [...p.raisons] });
    return acc;
  }, []);

/**
 * Les passages d'un rush, vos décisions appliquées par-dessus l'analyse :
 * une décision remplace l'état sur sa durée (raison « Votre choix »), la
 * plus récente l'emporte sur les précédentes. Vide si le rush n'est pas
 * encore dérushé.
 */
const memoire = new WeakMap<Derush, DerushPlage[]>();
export function passages(d: Derush | undefined): DerushPlage[] {
  if (!d?.plages?.length) return [];
  // Calculés une fois par dérushage : l'onglet Dérush les relit à chaque
  // rendu, pour des centaines de rushes. Le résultat n'est jamais modifié.
  const deja = memoire.get(d);
  if (deja) return deja;
  const calcule = calculerPassages(d);
  memoire.set(d, calcule);
  return calcule;
}
function calculerPassages(d: Derush): DerushPlage[] {
  const duree = d.plages[d.plages.length - 1].fin;
  let out = d.plages.map((p) => ({ ...p, raisons: [...p.raisons] }));
  for (const dec of d.decisions || []) {
    const debut = Math.max(0, dec.debut),
      fin = Math.min(duree, dec.fin);
    if (!(fin > debut)) continue;
    const next: DerushPlage[] = [];
    for (const p of out) {
      if (p.fin <= debut || p.debut >= fin) {
        next.push(p);
        continue;
      }
      if (p.debut < debut) next.push({ ...p, fin: debut });
      if (p.fin > fin) next.push({ ...p, debut: fin });
    }
    next.push({ debut, fin, etat: dec.etat, raisons: ["choix"] });
    out = next.sort((a, b) => a.debut - b.debut);
  }
  return fusionner(out);
}

/** Les durées par état, vos décisions comprises. */
export function resume(d: Derush | undefined) {
  const total = { bon: 0, verifier: 0, masque: 0 };
  for (const p of passages(d)) total[p.etat] += p.fin - p.debut;
  return total;
}

/**
 * Les morceaux utiles d'un rush : tout ce qui n'est pas masqué (les passages
 * « à vérifier » restent proposés : c'est à vous d'en juger), voisins réunis,
 * en secondes du média. Un morceau plus court que `minimum` est laissé : on
 * ne monte pas une demi-seconde coincée entre deux défauts.
 */
export function utiles(a: Pick<Asset, "derush" | "duration">, minimum = 0.5) {
  const p = passages(a.derush);
  if (!p.length) return [{ debut: 0, fin: a.duration }];
  const morceaux: { debut: number; fin: number }[] = [];
  for (const x of p) {
    if (x.etat === "masque") continue;
    const d = morceaux[morceaux.length - 1];
    if (d && Math.abs(d.fin - x.debut) < 1e-6) d.fin = Math.min(x.fin, a.duration);
    else morceaux.push({ debut: x.debut, fin: Math.min(x.fin, a.duration) });
  }
  return morceaux.filter((m) => m.fin - m.debut >= minimum);
}

/** Vrai quand un rush a des passages masqués : l'ajouter n'ajoute pas tout. */
export const aDesMasques = (a: Pick<Asset, "derush">) =>
  passages(a.derush).some((p) => p.etat === "masque");

/**
 * Ajoute au montage les morceaux utiles d'un rush, à la suite, à partir de
 * l'image `start`. Sans dérushage, ou sans rien de masqué, le rush entier.
 * Rend la séquence, le nombre de plans posés et les secondes laissées de
 * côté.
 */
export function ajouterUtiles(
  s: Sequence,
  a: Asset,
  start = length(s),
  track?: number,
): { sequence: Sequence; plans: number; laisse: number } {
  if (a.kind !== "video" || !aDesMasques(a))
    return { sequence: addClip(s, a, start, track), plans: 1, laisse: 0 };
  // Tout masqué : rien à poser (`plans` à zéro), la séquence est rendue
  // telle quelle.
  const morceaux = utiles(a),
    rate = fps(s);
  let next = s,
    at = start;
  for (const m of morceaux) {
    const avant = next.clips.length,
      // Arrondi vers le bas : le plan ne dépasse jamais la fin du morceau,
      // donc jamais celle du rush.
      images = Math.max(1, Math.floor((m.fin - m.debut) * rate + 1e-6));
    next = addClip(next, a, at, track);
    for (const c of next.clips.slice(avant)) {
      c.inUs = Math.round(m.debut * 1e6);
      c.duration = images;
    }
    at += images;
  }
  const garde = morceaux.reduce((t, m) => t + (m.fin - m.debut), 0);
  return { sequence: next, plans: morceaux.length, laisse: Math.max(0, a.duration - garde) };
}

/**
 * Les morceaux masqués d'un plan déjà posé, en images de montage, comme les
 * blancs de « Retirer les blancs » (edit.ts, `rangeCuts`).
 */
export function coupesInutilisables(s: Sequence, clip: Clip, a: Asset | undefined) {
  if (!a?.derush) return [];
  const masques = passages(a.derush)
    .filter((p) => p.etat === "masque")
    .map((p) => ({ start: p.debut, end: p.fin }));
  return rangeCuts(s, clip, masques, { minimum: 0.2, bords: true });
}

/** Retire d'un plan ses passages masqués, en une seule annulation. */
export function retirerInutilisables(s: Sequence, id: string, assets: Asset[]) {
  const clip = s.clips.find((c) => c.id === id);
  if (!clip) return { sequence: s, removed: 0, cuts: 0 };
  return removeCuts(s, id, coupesInutilisables(s, clip, assets.find((a) => a.id === clip.assetId)));
}

/**
 * L'ordre de la journée : les rushes datés d'abord, par heure de tournage,
 * puis ceux sans heure ; le nom du fichier départage. Un ordre total : sans
 * cela, un seul rush sans heure (un téléphone, un drone) mélangeait le
 * pré-montage.
 */
export function ordreDeTournage(a: Asset, b: Asset) {
  const da = Number.isFinite(a.recorded),
    db = Number.isFinite(b.recorded);
  if (da !== db) return da ? -1 : 1;
  if (da && db && a.recorded !== b.recorded) return a.recorded! - b.recorded!;
  return a.name.localeCompare(b.name, "fr", { numeric: true, sensitivity: "base" });
}

/**
 * Les blocs de la journée : les rushes rangés par heure de tournage, un
 * nouveau bloc quand plus de `pause` (20 min) sépare la fin d'un rush du
 * début du suivant. Les rushes sans heure forment un dernier bloc. Les
 * heures viennent des caméras, réglées ou non : un bloc dit l'ordre, pas
 * l'heure exacte.
 */
export function blocs(assets: Asset[], pause = 20 * 60 * 1000) {
  const dates = assets.filter((a) => Number.isFinite(a.recorded)).sort(ordreDeTournage),
    sans = assets.filter((a) => !Number.isFinite(a.recorded)).sort(ordreDeTournage),
    sortie: { debut?: number; fin?: number; assets: Asset[] }[] = [];
  for (const a of dates) {
    const d = sortie[sortie.length - 1],
      debut = a.recorded!,
      fin = debut + a.duration * 1000;
    if (d && d.fin !== undefined && debut - d.fin <= pause) {
      d.assets.push(a);
      d.fin = Math.max(d.fin, fin);
    } else sortie.push({ debut, fin, assets: [a] });
  }
  if (sans.length) sortie.push({ assets: sans });
  return sortie;
}

/**
 * Le pré-montage : une nouvelle séquence, réglée comme `base`, avec les
 * morceaux utiles des rushes vidéo donnés, dans l'ordre de la journée. C'est
 * le bout-à-bout de départ : il ne reste qu'à choisir et raccourcir.
 */
export function preMontage(base: Sequence, assets: Asset[], nom = "Pré-montage"): Sequence {
  let s: Sequence = {
    ...structuredClone(base),
    id: crypto.randomUUID(),
    version: 1,
    name: nom,
    created: Date.now(),
    clips: [],
    titles: [],
    captions: [],
    markers: [],
    tracks: {},
  };
  for (const a of assets.filter((a) => a.kind === "video" && a.status === "ready").sort(ordreDeTournage))
    s = ajouterUtiles(s, a).sequence;
  return s;
}
