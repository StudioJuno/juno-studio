import {
  cibleDite,
  contientNegation,
  normalize,
  parsePrompt,
  verifierEnchainement,
  type Action,
  type Plan,
  type Scope,
} from "./commands";
/** Fail closed on known directional contradictions. This is not a general semantic proof. */
export function checkIntent(request: string, plan: Plan) {
  const text = normalize(request);
  if (
    /\b(visages?|peau|yeux|personnes?|objets?|ciel|masques?|zones?|uniquement|seulement|sauf|except[eé])\b/.test(
      text,
    )
  )
    throw Error(
      "Cette demande comporte une cible ou une restriction que le pilote ne sait pas appliquer. Définissez la cible manuellement ; aucune correction globale n’a été lancée.",
    );
  if (plan.actions.some((a) => a.kind.startsWith("video."))) {
    if (
      /(?:baisse|diminue|redui|reduire).*?(?:son|volume)/.test(text) &&
      !/(?:a|à) -?\d/.test(text)
    ) {
      const edits = plan.actions.filter(
        (a) => a.kind === "video.adjust" && a.field === "gain",
      );
      if (
        !edits.length ||
        edits.some(
          (a) => a.kind === "video.adjust" && (!a.relative || a.value >= 0),
        )
      )
        throw Error(
          "Précisez s’il faut réduire le volume d’une valeur ou le régler à un niveau absolu. Rien n’a été modifié.",
        );
    }
    return;
  }
  const rules: [RegExp, string, number][] = [
    [/plus (?:lumineu|clair)|eclairci/, "exposure", 1],
    [/plus sombre|assombri|moins lumineu/, "exposure", -1],
    [/moins sature|baisse.*saturation|redui.*saturation/, "saturation", -1],
    [/plus sature|augmente.*saturation/, "saturation", 1],
    [/plus chaud|rechauff/, "warmth", 1],
    [/plus froid|refroid/, "warmth", -1],
  ];
  for (const [match, field, direction] of rules) {
    if (!match.test(text)) continue;
    const edits = plan.actions.filter(
      (a) => a.kind === "photo.adjust" && a.field === field,
    );
    if (
      !edits.length ||
      edits.some(
        (a) =>
          a.kind === "photo.adjust" &&
          (!a.relative || a.value * direction <= 0),
      )
    )
      throw Error(
        "La proposition IA ne respecte pas clairement le sens de votre demande. Rien n’a été modifié. Précisez le réglage, par exemple « augmente l’exposition de 0,3 ».",
      );
  }
}

/**
 * La proposition de l'IA locale, relue par le lecteur de commandes.
 *
 * La cible nommée dans la phrase d'origine (« écarte la photo active »,
 * « … sur cette photo ») prime sur la portée du panneau, comme pour une
 * commande locale. La reformulation (« Écarte ») ne la répète pas : relue
 * avec la portée du panneau, « Tout le projet » compris, elle visait tout
 * l'album (relecture du 29/09/2026). Si l'IA nomme elle-même une autre
 * cible, la proposition est refusée plutôt que d'en choisir une.
 *
 * Chaque commande est relue seule, avec son propre sens : jointes par
 * « puis », « Contraste à 10 » héritait du « Augmente » de la commande
 * précédente, puisque « puis » reprend le verbe dans une phrase tapée. Une
 * commande absolue reste absolue. Les commandes qui visent des cibles
 * différentes sont refusées ensemble, et une demande qui nie ou excepte ne
 * laisse pas l'IA nommer une cible à sa place.
 */
export function relireProposition(
  demande: string,
  commandes: string[],
  domain: "photo" | "video",
  portee: Scope,
  style?: string,
): Plan {
  const dite = cibleDite(demande);
  const plans = commandes.map((commande) =>
    parsePrompt(commande, domain, dite ?? portee, style),
  );
  if (!plans.length) throw Error("Aucune action reconnue.");
  const scope = plans[0].scope;
  if (dite && plans.some((p) => p.scope !== dite))
    throw Error(
      "La proposition de l’IA locale ne vise pas la cible nommée dans votre consigne. Rien n’a été modifié ; précisez la consigne ou choisissez la cible dans le panneau.",
    );
  if (plans.some((p) => p.scope !== scope))
    throw Error(
      "La proposition de l’IA locale vise plusieurs cibles à la fois. Rien n’a été modifié ; lancez une consigne par cible, ou choisissez la cible dans le panneau.",
    );
  if (!dite && scope !== portee && contientNegation(demande))
    throw Error(
      "Votre consigne contient une négation ou une exception, et la proposition de l’IA locale choisit une cible à sa place. Rien n’a été modifié ; sélectionnez les éléments voulus ou choisissez la cible dans le panneau.",
    );
  const actions = plans.flatMap((p) => p.actions);
  verifierEnchainement(actions);
  const plan: Plan = {
    ...plans[0],
    text: demande,
    label: demande.slice(0, 200),
    actions,
    scope,
  };
  checkIntent(demande, plan);
  return plan;
}
/** Ce qui désigne la cible d'une commande dans le contexte capturé. */
type Cible = {
  domain: "photo" | "video";
  projectId: string;
  ids: Record<Scope, string[]>;
  sequence?: {
    id: string;
    clips?: { animation?: Partial<Record<string, unknown[]>> }[];
  };
  frame?: number;
};
/**
 * Les commandes vidéo qui se posent au curseur : la coupe, le titre, les
 * images clés, le relief du titre sous le curseur et le masque.
 */
const AU_CURSEUR = new Set([
  "video.split",
  "video.title",
  "video.animate",
  "video.depth",
  "video.mask",
]);
/**
 * Une commande dépend-elle du curseur ? Un réglage aussi, quand le réglage
 * est animé : il se lit et s'écrit en image clé au curseur. Sans la
 * séquence pour le vérifier, on le suppose.
 */
function dependDuCurseur(cible: Cible, actions?: Action[]) {
  if (!actions) return true;
  return actions.some(
    (a) =>
      AU_CURSEUR.has(a.kind) ||
      (a.kind === "video.adjust" &&
        (!cible.sequence?.clips ||
          cible.sequence.clips.some((c) => !!c.animation?.[a.field]?.length))),
  );
}
/**
 * La cible d'une proposition est-elle encore celle qu'on voit ?
 *
 * Une proposition de l'IA locale est préparée sur la photo active, ou au
 * curseur, du moment de la demande. Appliquée plus tard, après un passage à
 * une autre photo, elle frappait l'ancienne alors que l'en-tête du pilote
 * montrait la nouvelle. On compare donc les éléments visés, et en vidéo la
 * séquence, puis le curseur pour les seules commandes qui s'y posent : il
 * avance tout seul pendant la lecture, et un réglage de volume préparé
 * pendant qu'elle tournait n'était jamais applicable (relecture du
 * 29/09/2026). Sans les actions, le curseur est comparé, par prudence.
 */
export function cibleInchangee(
  avant: Cible,
  apres: Cible,
  scope: Scope,
  actions?: Action[],
) {
  if (avant.domain !== apres.domain || avant.projectId !== apres.projectId)
    return false;
  const a = [...(avant.ids[scope] || [])].sort(),
    b = [...(apres.ids[scope] || [])].sort();
  if (a.length !== b.length || a.some((id, i) => id !== b[i])) return false;
  if (avant.domain === "video")
    return (
      avant.sequence?.id === apres.sequence?.id &&
      (!dependDuCurseur(avant, actions) ||
        (avant.frame ?? 0) === (apres.frame ?? 0))
    );
  return true;
}
const PORTEES: Record<Scope, string> = {
  current: "l’élément actif",
  selection: "la sélection",
  album: "tout le projet",
  kept: "les photos gardées",
};
/**
 * Ce qu'une commande changerait sur plusieurs éléments à la fois, quand elle
 * efface des décisions prises une à une : le tri, les étoiles, les
 * retouches, les plans de la séquence. Rien si elle ne vise qu'un élément.
 *
 * Tout reste annulable dans l'historique, mais une portée laissée dans le
 * panneau d'une consigne précédente suffisait à écarter l'album entier sans
 * un mot. « Tout le projet » demandait déjà une confirmation ; « Photos
 * gardées » et la sélection, qui restent aussi d'une consigne à l'autre, n'en
 * demandaient pas (relecture du 29/09/2026). Le nombre compté est celui de la
 * portée du plan, et non celui de l'album.
 */
export function confirmationRequise(
  plan: Plan,
  ids: Partial<Record<Scope, string[]>>,
) {
  const nombre = ids[plan.scope]?.length ?? 0;
  if (nombre < 2) return undefined;
  const effets = plan.actions.flatMap((a) =>
    a.kind === "photo.status"
      ? // Garder des photos déjà gardées ne change rien.
        a.status === "keep" && plan.scope === "kept"
        ? []
        : [
            a.status === "reject"
              ? `écarter ${nombre} photos`
              : a.status === "keep"
                ? `garder ${nombre} photos`
                : `remettre ${nombre} photos en attente`,
          ]
      : a.kind === "photo.stars"
        ? [`noter ${nombre} photos à ${a.value} étoile${a.value > 1 ? "s" : ""}`]
        : a.kind === "photo.original"
          ? [`ramener ${nombre} photos à l’original`]
          : a.kind === "video.remove"
            ? [`retirer ${nombre} plans de la séquence`]
            : [],
  );
  if (!effets.length) return undefined;
  return `Cette commande vise ${PORTEES[plan.scope]} : ${effets.join(", ")}. Confirmez pour l’appliquer, ou choisissez « Élément actif » dans le panneau.`;
}
