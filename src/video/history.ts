import type { CommandRecord } from "../assistant/records";
import type { Sequence } from "./types";

// Large timelines retain fewer snapshots so undo cannot grow without a bound.
export function pushHistory(stack: Sequence[], sequence: Sequence) {
  stack.push(structuredClone(sequence));
  let items = 0;
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    items += s.clips.length + s.titles.length + s.captions.length + 1;
    if ((items > 100000 || stack.length - i > 40) && i < stack.length - 1) {
      stack.splice(0, i + 1);
      break;
    }
  }
}
/**
 * La commande que vise « annule » ou « rétablis » dans le journal du montage,
 * comme en photo (App.tsx).
 *
 * « annule » : la dernière commande encore entièrement appliquée. Une
 * commande annulée en partie ne se vise plus : « annule » butait sinon sur la
 * même entrée à chaque fois (29/09/2026).
 * « rétablis » : la dernière commande annulée, en tout ou en partie, et
 * seulement si aucune commande nouvelle n'a été lancée depuis. Sans cela,
 * « rétablis » remettait une commande plus ancienne par-dessus le travail fait
 * après elle.
 */
export function pilotRecord<
  R extends Pick<CommandRecord, "state" | "created" | "updated">,
>(records: R[], redo: boolean): R | undefined {
  const recent = [...records].sort((a, b) => b.updated - a.updated);
  const candidate = redo
    ? recent.find((r) => r.state !== "done")
    : recent.find((r) => r.state === "done");
  if (redo && candidate && records.some((r) => r.created > candidate.updated))
    return undefined;
  return candidate;
}
/**
 * Rien n'a été annulé ni rétabli parce que le montage a été repris depuis
 * (commands.cjs) : ce n'est pas une panne, c'est la réponse à la consigne.
 */
export const nothingRestored = (message: string) =>
  /^Rien n’a été (?:annulé|rétabli) :/.test(message);
