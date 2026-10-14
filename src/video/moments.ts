/**
 * Transformer les moments forts d'un rush en extraits à monter.
 *
 * Un moment fort entendu est souvent une réaction : on applaudit après le
 * baiser, on crie après le « oui ». Monter seulement le pic sonore montrerait
 * la salle qui applaudit sans ce qui l'a fait applaudir. L'extrait commence
 * donc avant le pic.
 */
export type Moment = { start: number; end: number; crete: number; relief: number };
export type Extrait = { start: number; end: number };
export const AVANT = 2.5;
export const APRES = 1;
export function extraits(
  moments: Moment[],
  duree: number,
  avant = AVANT,
  apres = APRES,
): Extrait[] {
  const bornes = moments
    .map((m) => ({
      start: Math.max(0, m.start - avant),
      end: Math.min(duree, m.end + apres),
    }))
    .filter((e) => e.end - e.start > 0.2)
    .sort((a, b) => a.start - b.start);
  // Deux extraits qui se touchent ne font qu'un plan : sinon le montage
  // répéterait la même seconde à la coupe.
  const fusionnes: Extrait[] = [];
  for (const e of bornes) {
    const d = fusionnes.at(-1);
    if (d && e.start <= d.end) d.end = Math.max(d.end, e.end);
    else fusionnes.push({ ...e });
  }
  return fusionnes;
}
