import { useState } from "react";

// Ce qui suit la tête de lecture, sans effet React.
//
// Un `useEffect` qui remet un état à zéro quand l'image change (dépendances
// `frame`, `at` ou `playhead`) programme un rendu de plus après CHAQUE
// déplacement de la tête, même quand la valeur ne change pas : le composant
// est rendu à chaque image, React ne peut donc jamais écarter d'avance un
// `setState` identique. Après une flèche (rendu synchrone), ce rendu de plus
// reste en attente à la fin du commit ; si la flèche suivante arrive avant
// qu'il ait eu lieu, React compte une mise à jour imbriquée de plus. Au-delà
// de 50 d'affilée, il lève l'erreur 185 (« Maximum update depth exceeded »)
// dans le gestionnaire de la touche suivante, qui est alors perdue.
//
// Ici, l'état tenu est rattaché au contexte où il a été posé, et il tombe dans
// le rendu même où ce contexte change, sans rendu programmé en plus.

/** Mêmes valeurs, une à une, selon la comparaison de React (`Object.is`). */
export function sameContext(
  a: readonly unknown[],
  b: readonly unknown[],
): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/**
 * Un état qui ne vaut que pour `context` (par exemple la séquence et l'image
 * affichées). Dès qu'un rendu voit un autre contexte, la valeur tenue est
 * oubliée, comme le faisait l'effet de remise à zéro, mais sans rendu de plus :
 * rien n'est programmé quand il n'y a rien à oublier, et l'oubli se fait
 * pendant le rendu en cours (motif « ajuster l'état quand une prop change »
 * de la documentation React).
 */
export function useHeld<T>(
  context: readonly unknown[],
): [T | undefined, (value: T | undefined) => void] {
  const [held, setHeld] = useState<{ value: T; context: readonly unknown[] }>();
  const live = held && sameContext(held.context, context) ? held : undefined;
  if (held && !live) setHeld(undefined);
  return [
    live?.value,
    (value) =>
      setHeld(
        value === undefined ? undefined : { value, context: [...context] },
      ),
  ];
}

/** Déplacement de la tête demandé par une touche : flèches, ×10 avec Maj. */
export function arrowStep(e: { code: string; shiftKey: boolean }): number {
  if (e.code === "ArrowRight") return e.shiftKey ? 10 : 1;
  if (e.code === "ArrowLeft") return e.shiftKey ? -10 : -1;
  return 0;
}

/**
 * Nouvelle position de la tête, entre la première image et `last`, la
 * dernière image du film : au-delà, le moniteur n'a plus rien à montrer. À
 * passer en mise à jour fonctionnelle (`setPlayhead((f) => stepFrame(f, d,
 * last))`) : chaque touche part de la position laissée par la précédente,
 * même si le gestionnaire a été créé avant le dernier rendu.
 */
export function stepFrame(
  from: number,
  delta: number,
  last = Infinity,
): number {
  return Math.max(0, Math.min(last, Math.round(from + delta)));
}
