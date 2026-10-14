// Les transitions entre deux plans.
//
// Le motif est fabriqué en faisant un xfade entre du noir et du blanc, puis
// posé comme couche alpha du plan entrant. Ce détour a trois vertus : il donne
// accès aux cinquante-huit motifs compilés dans FFmpeg sans en réécrire un
// seul ; il ne coûte presque rien (chaîne complète mesurée à 200 i/s en 1080p,
// contre 111 pour un rendu nu) ; et il reste juste dans un rendu par segments,
// puisque le motif est régénéré au bon endroit pour chaque segment.
//
// L'alternative, une alpha calculée par geq, tombait à 19,5 i/s.
/** Ce que Juno propose, nommé en français. FFmpeg en offre davantage. */
const CATALOGUE = [
  { id: "dissolve", label: "Fondu enchaîné" },
  { id: "fade", label: "Fondu doux" },
  { id: "fadeblack", label: "Fondu par le noir" },
  { id: "fadewhite", label: "Fondu par le blanc" },
  { id: "wipeleft", label: "Volet vers la gauche" },
  { id: "wiperight", label: "Volet vers la droite" },
  { id: "wipeup", label: "Volet vers le haut" },
  { id: "wipedown", label: "Volet vers le bas" },
  { id: "smoothleft", label: "Volet adouci, gauche" },
  { id: "smoothright", label: "Volet adouci, droite" },
  { id: "slideleft", label: "Glissement vers la gauche" },
  { id: "slideright", label: "Glissement vers la droite" },
  { id: "slideup", label: "Glissement vers le haut" },
  { id: "slidedown", label: "Glissement vers le bas" },
  { id: "circleopen", label: "Cercle qui s'ouvre" },
  { id: "circleclose", label: "Cercle qui se ferme" },
  { id: "circlecrop", label: "Iris" },
  { id: "horzopen", label: "Rideau horizontal" },
  { id: "vertopen", label: "Rideau vertical" },
  { id: "diagtl", label: "Diagonale" },
  { id: "radial", label: "Balayage circulaire" },
  { id: "pixelize", label: "Pixelisation" },
  { id: "hblur", label: "Flou de passage" },
  { id: "zoomin", label: "Zoom avant" },
  { id: "squeezeh", label: "Écrasement horizontal" },
  { id: "squeezev", label: "Écrasement vertical" },
];
const KINDS = new Set(CATALOGUE.map((t) => t.id));
const MAX_FRAMES = 240;
function validate(transition, clipDuration) {
  if (transition === undefined) return;
  if (!transition || typeof transition !== "object" || Array.isArray(transition))
    throw Error("Transition invalide");
  if (!KINDS.has(transition.kind)) throw Error("Transition inconnue");
  const d = transition.duration;
  if (
    !Number.isSafeInteger(d) ||
    d < 1 ||
    d > MAX_FRAMES ||
    d > clipDuration
  )
    throw Error("Durée de transition invalide");
}
/**
 * Le motif d'alpha à poser sur le plan entrant, ou null s'il n'y a rien à
 * faire dans ce segment.
 *
 * `offsetSeconds` est le temps déjà écoulé depuis le début du plan quand
 * commence la portion rendue ici : au-delà de la durée de la transition, elle
 * est terminée et le plan est pleinement visible.
 */
function alphaFilters({
  transition,
  input,
  source,
  label,
  width,
  height,
  rate,
  offsetSeconds,
  offsetFrames,
  lengthSeconds,
}) {
  if (!transition) return null;
  const d = transition.seconds;
  if (!(d > 0) || offsetSeconds >= d) return null;
  // Rognage en images quand le nombre est connu : en secondes arrondies à
  // six décimales, le motif partait une image trop loin en 29,97.
  const cut = Number.isSafeInteger(offsetFrames)
    ? `trim=start_frame=${offsetFrames}`
    : `trim=start=${offsetSeconds.toFixed(6)}`;
  const span = (offsetSeconds + lengthSeconds + d + 1).toFixed(6);
  const size = `${width}x${height}`;
  const out = [
    `color=c=black:s=${size}:r=${rate}:d=${span}[tb${input}]`,
    `color=c=white:s=${size}:r=${rate}:d=${span}[tw${input}]`,
  ];
  // Le motif part toujours du début du plan ; ce qui précède le segment est
  // ensuite coupé, pour que la transition reprenne à son avancement réel.
  let chain =
    `[tb${input}][tw${input}]xfade=transition=${transition.kind}` +
    `:duration=${d.toFixed(6)}:offset=0`;
  if (offsetSeconds > 0) chain += `,${cut},setpts=PTS-STARTPTS`;
  out.push(chain + `,format=gray[tm${input}]`);
  // alphamerge remplace la couche alpha : il doit donc passer avant les fondus
  // et l'opacité du plan, qui la multiplient ensuite.
  //
  // Le motif est calculé en 8 bits, donc son blanc vaut 255, qui devient 1020
  // une fois porté en 10 bits, et non 1023. Sans la correction ci-dessous, un
  // plan resterait 0,3 % plus sombre que son voisin pendant toute sa durée,
  // longtemps après la fin de la transition. Le facteur est exactement
  // 1023/1020, et FFmpeg borne le résultat.
  out.push(
    `[${source}][tm${input}]alphamerge=shortest=1,` +
      `colorchannelmixer=aa=${(1023 / 1020).toFixed(7)}[${label}]`,
  );
  return out;
}
module.exports = { CATALOGUE, KINDS, MAX_FRAMES, validate, alphaFilters };
