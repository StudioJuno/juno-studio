const { audioMix, panFilter } = require("./audio-mix.cjs");
const MOTION = require("./motion.cjs");
const MASKS = require("./masks.cjs");
const { expression } = require("./animation.cjs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const { seconds, duration, mapRGB, validateSequence } = require("./model.cjs");
const { parseCube, sample } = require("./lut.cjs");
const { escapeFilter } = require("./engine.cjs");
const LOUD = require("./loudness.cjs");
const CLEAN = require("./cleanup.cjs");
const TRANS = require("./transitions.cjs");
const fmt = (n) => Number(n).toFixed(8),
  hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
async function gradeLut(root, g) {
  const name = hash(g) + ".cube",
    file = path.join(root, name);
  try {
    await fs.access(file);
    return file;
  } catch {}
  const custom = g.lutId
    ? parseCube(
        await fs.readFile(
          path.join(path.dirname(root), "luts", g.lutId + ".cube"),
          "utf8",
        ),
      )
    : null;
  const transform = (rgb) => {
    const base = mapRGB(rgb, g);
    if (!custom) return base;
    const result = sample(custom, base),
      k = g.lutIntensity ?? 1;
    return base.map((v, i) => v + (result[i] - v) * k);
  };
  const size = 33,
    lines = ["LUT_3D_SIZE " + size, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let b = 0; b < size; b++)
    for (let q = 0; q < size; q++)
      for (let r = 0; r < size; r++)
        lines.push(
          transform([r / (size - 1), q / (size - 1), b / (size - 1)])
            .map(fmt)
            .join(" "),
        );
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(file, lines.join("\n"));
  return file;
}
/**
 * Change la vitesse du son sans changer sa hauteur.
 *
 * atempo avale une demi-fenêtre au début de ce qu'il reçoit (1 024
 * échantillons à 48 kHz, soit 21 ms) : sans compensation, le son de chaque
 * plan partait en avance sur l'image, même à vitesse normale. Un silence de
 * la même longueur est donc posé devant chaque étage, et à vitesse 1 le son
 * ne traverse aucun atempo. Renvoie une chaîne vide quand il n'y a rien à
 * faire.
 */
function atempo(speed, rate = 48000) {
  let window = 1;
  while (window < rate / 24) window *= 2;
  const stage = (v) => `adelay=${window / 2}S:all=1,atempo=${v}`,
    parts = [];
  while (speed > 2) {
    parts.push(stage(2));
    speed /= 2;
  }
  while (speed < 0.5) {
    parts.push(stage(0.5));
    speed *= 2;
  }
  if (Math.abs(speed - 1) > 1e-9) parts.push(stage(fmt(speed)));
  return parts.join(",");
}
/**
 * Marge de lecture avant un point d'entrée, en secondes. Le moniteur prend la
 * même pour choisir l'image qu'il montre, et compte la borne comme `retime`
 * (src/video/edit.ts, `EXPORT_SLACK` et `exportLimit`).
 */
const SEEK_SLACK = 0.001;
/** En deçà, on lit depuis le début du fichier au lieu de chercher. */
const SEEK_FLOOR = 0.25;
/**
 * Écart laissé entre un -ss et l'image clé qu'il doit précéder (moteur,
 * `seekPoint`, `key`) : bien plus que les arrondis d'un -ss (la microseconde,
 * puis la graduation de 1/90 000 s du MPEG-TS), bien moins qu'une image.
 */
const KEY_SLACK = 0.002;
/**
 * Où lire un média pour en tirer une portion qui commence à `source`
 * secondes, préchauffage des filtres (`lead`) compris.
 *
 * Deux pièges de FFmpeg y sont contournés. Un -ss ne garde que les images
 * qui commencent après lui : l'image à l'écran au point d'entrée commence
 * avant, d'un rien quand le point a été arrondi, d'une fraction d'image quand
 * le rush n'a pas la cadence de la séquence, de plusieurs images quand il
 * en saute. La lecture commence donc au début de cette image (`frame`, en
 * secondes avant le premier instant lu), et le tri se fait ensuite image par
 * image. Et un -ss posé dans les vingt premières millisecondes d'un
 * MP4 perd le décalage d'amorce du son AAC, qui partait alors 21 ms en
 * avance : près du début, on lit depuis zéro et on retire l'excédent dans les
 * filtres.
 *
 * `video` et `audio` disent combien de secondes retirer au début de ce qui est
 * lu : l'image garde son préchauffage et sa marge, le son commence pile au
 * point d'entrée. Voir `inputWindow` pour ce que le moteur ajoute.
 */
function readWindow(source, lead = 0, frame = 0, tick = 0) {
  const { seek, video, audio } = inputWindow(source, lead, frame, tick);
  return { seek, video, audio };
}
/**
 * `readWindow`, avec ce que le moteur sait du fichier (`seekPoint`) :
 * - `key` : le -ss reste avant cet instant, pour que FFmpeg commence à
 *   décoder à une image clé d'où l'image voulue se décode (MPEG-TS, GOP
 *   ouvert) ;
 * - `delay` : où FFmpeg compte le temps de l'entrée quand il le compte
 *   depuis le premier des flux qu'elle sert (MPEG-TS lu sans -ss) : le début
 *   de l'image pour une entrée qui ne sert qu'elle, celui du son pour un plan
 *   son (moteur, `videoTrack`, `lead` et `audioLead`) ;
 * - `shift` : où commence le zéro du moniteur dans le fichier.
 * `ss` est le -ss à passer (zéro : aucun), `zero` l'instant, compté comme
 * `source`, où commence ce qui est lu, image ou son. `audio` : ce qu'il faut
 * retirer du son lu pour qu'il commence au point d'entrée ; négatif quand le
 * son lu commence après lui, d'autant de silence à poser devant.
 */
function inputWindow(
  source,
  lead = 0,
  frame = 0,
  tick = 0,
  { key, delay = 0, shift = 0 } = {},
) {
  const from = Math.max(0, source - lead - frame - SEEK_SLACK),
    offset = shift > 0 ? shift : 0;
  let seek = from < SEEK_FLOOR ? 0 : from;
  if (seek && Number.isFinite(key) && seek > key - KEY_SLACK)
    seek = key - KEY_SLACK < SEEK_FLOOR ? 0 : key - KEY_SLACK;
  // Calé sur une graduation de la piste image (`tick`, sa base de temps, ou
  // plusieurs quand il faut tomber sur une microseconde entière : moteur,
  // `seekGrain`) :
  // FFmpeg arrondit le décalage d'un -ss à cette graduation, et chaque image
  // arrivait alors jusqu'à une demi-graduation trop tôt ou trop tard (20 ms
  // sur une base de 1/25, 0,8 ms sur la base 1/600 des iPhone). Aux images
  // où le rush change presque à l'instant voulu, le film prenait l'une ou
  // l'autre selon le point de lecture, et plus celle que le moniteur montre.
  let ss = seek ? seek + offset : 0;
  if (ss && tick > 0 && tick <= 0.1) ss = Math.floor(ss / tick + 1e-9) * tick;
  if (ss) seek = ss - offset;
  const zero = Math.max(seek, delay > 0 ? delay : 0);
  return {
    seek,
    ss,
    zero,
    video: Math.max(0, from - zero),
    audio: source - zero,
  };
}
/**
 * La fenêtre de lecture de l'image d'un rush pour une portion de plan qui
 * commence à `source` secondes, préchauffage `lead` compris, telle que le
 * rendu et le suivi de masque la posent : `inputWindow`, remontée jusqu'au
 * début de l'image à l'écran au premier instant lu (`retime` : commencée au
 * plus une marge après lui).
 *
 * Une image du rush en arrière suffit quand aucune ne dure plus d'une image
 * moyenne (`period`). Sur un rush qui saute des images, un -ss posé une image
 * moyenne avant la perdait, et le plan s'ouvrait sur l'image d'après le trou,
 * là où le moniteur montre la bonne (29/09/2026). Le moteur ne se dispense de
 * lire les paquets que si la table d'échantillons du fichier garantit
 * qu'aucune image ne dure plus que `period`, la dernière comprise : un
 * Matroska, un rush dont les trous sont compensés plus loin, ou dont la
 * dernière image est figée, passaient pour réguliers (moteur, `videoTrack`).
 * La remontée n'est jamais plus courte qu'une image. Le moteur dit aussi
 * avant quel instant poser le -ss pour que cette image se décode (`key`), et
 * où FFmpeg compte le temps du fichier (`delay`, `shift`) : MPEG-TS, GOP
 * ouvert (moteur, `seekPoint`).
 *
 * `sound` : la même entrée sert aussi le son du plan (ancien plan image et son
 * d'un seul tenant). FFmpeg compte alors son temps depuis le premier de
 * l'image et du son, c'est-à-dire depuis le zéro du moniteur (moteur,
 * `videoTrack`) : aucun décalage à reporter.
 */
async function sourceWindow(
  engine,
  file,
  { source, lead = 0, speed = 1, period, sound = false },
) {
  const tick = await Promise.resolve(
      engine.seekGrain ? engine.seekGrain(file) : engine.videoTick?.(file),
    ).catch(() => 0),
    opening = source - lead,
    at = opening + SEEK_SLACK * speed,
    point = await Promise.resolve(
      engine.seekPoint
        ? engine.seekPoint(file, at, period)
        : Promise.resolve(engine.frameStart?.(file, at, period)).then(
            (shown) => ({ shown }),
          ),
    ).catch(() => undefined),
    shown = point?.shown;
  return inputWindow(
    source,
    lead,
    Number.isFinite(shown) ? Math.max(period, opening - shown) : period,
    tick,
    { key: point?.key, delay: sound ? 0 : point?.lead, shift: point?.shift },
  );
}
/**
 * Les images du rush posées sur la cadence de la séquence.
 *
 * Chaque image de sortie montre l'image du rush à l'écran à son instant :
 * la dernière qui a commencé avant lui. Les instants sont comptés depuis
 * `origin` (secondes lues avant la première image voulue) et passent en
 * microsecondes avant tout calcul, pour ne dépendre ni de la base de temps
 * du fichier ni d'une troncature de setpts. Le millième de seconde retiré
 * absorbe les arrondis : une image ne passe jamais à l'instant suivant pour
 * un reste de calcul.
 *
 * Avec `first`, `origin` est le point d'entrée du plan et la première image
 * à sortir est la `first`-ième du plan (préchauffage compris) : chaque image
 * du rush est comptée en microsecondes depuis le point d'entrée, divisée par
 * la vitesse et tronquée, puis posée sur la grille des images du plan, en
 * graduations assez fines pour que la grille tombe juste (1/3 000 000 s en
 * 29,97). C'est la règle du moniteur (src/video/edit.ts, `exportLimit`).
 * Compté depuis le début du segment, `origin` tombait entre deux
 * microsecondes et setpts en tronquait le reste : une image qui commence
 * pile au bout de la marge sortait au film et pas au moniteur, au milieu
 * d'un plan (29/09/2026).
 */
function retime(origin, speed, rate, first) {
  const [n, d = 1] = String(rate).split("/").map(Number),
    gcd = (x, y) => (y ? gcd(y, x % y) : x),
    step =
      n > 0 && d > 0 && Number.isInteger(n) && Number.isInteger(d)
        ? n / gcd(n, d)
        : 0,
    scale = step ? (1e6 / gcd(1e6, step)) * step : 0,
    tick = (d * scale) / n;
  if (
    first === undefined ||
    !(scale > 0 && scale <= 2147483647 && Number.isInteger(tick))
  )
    return `settb=AVTB,setpts=(PTS-${fmt(origin + (first ? (first * d * speed) / n : 0))}/TB)/${fmt(speed)}-${SEEK_SLACK}/TB,fps=${rate}:round=up:start_time=0:eof_action=pass`;
  const m = scale / 1e6;
  return `settb=AVTB,settb=1/${scale},setpts=${m}*(trunc((PTS/${m}-(${Math.round(origin * 1e6)}))/${fmt(speed)})-${Math.round(SEEK_SLACK * 1e6)})-(${first * tick}),fps=${rate}:round=up:start_time=0:eof_action=pass`;
}
async function buildSegment({
  engine,
  sequence: s,
  assets,
  registry,
  cache,
  start,
  count,
  overlays = [],
  maskFiles = {},
}) {
  const end = start + count,
    W = s.width,
    H = s.height,
    rate = s.fps.n + "/" + s.fps.d,
    totalTime = seconds(count, s.fps),
    sampleStart = Math.round(seconds(start, s.fps) * 48000),
    sampleEnd = Math.round(seconds(end, s.fps) * 48000),
    samples = sampleEnd - sampleStart;
  let n = 0;
  const inputs = [],
    filters = [],
    audios = [],
    // Un graphe par entrée son, à part (voir plus bas).
    audioGraphs = [];
  // L'atténuation de la musique sous la voix, calculée sur le temps absolu du
  // montage : un compresseur latéral repartirait de zéro à chaque segment.
  const ducking = s.ducking?.enabled
    ? {
        speech: LOUD.sequenceSpeech(s, assets),
        window: {
          start: seconds(start, s.fps),
          end: seconds(end, s.fps),
        },
      }
    : null;
  let bottom = "base";
  filters.push(
    `color=c=black:s=${W}x${H}:r=${rate}:d=${fmt(totalTime)},format=yuv444p10le[base]`,
  );
  const clips = s.clips
    .filter(
      (c) =>
        c.start < end &&
        c.start + c.duration > start &&
        !s.tracks?.[c.track]?.hidden,
    )
    .sort(
      (a, b) =>
        a.track - b.track || a.start - b.start || a.id.localeCompare(b.id),
    );
  for (const c of clips) {
    const asset = assets.get(c.assetId),
      registered = registry[c.assetId];
    if (!asset || !registered)
      throw Error("Original introuvable : " + c.assetId);
    await fs.access(registered.source);
    const a = Math.max(c.start, start),
      b = Math.min(c.start + c.duration, end),
      frames = b - a,
      relative = seconds(a - start, s.fps),
      source = c.inUs / 1e6 + seconds(a - c.start, s.fps) * c.speed,
      len = seconds(frames, s.fps);
    const index = n++;
    // Les filtres temporels ont besoin de quelques images avant le segment
    // pour se caler. Sans ce préchauffage, ils repartiraient de zéro toutes
    // les dix secondes et laisseraient un sursaut visible à chaque frontière.
    const warmup =
      asset.kind === "image"
        ? { frames: 0, seconds: 0 }
        : CLEAN.lead(c, source, s.fps);
    const picture =
      asset.kind === "video" && c.track < 10 && c.component !== "audio";
    const file = registered.renderSource || registered.source,
      period = asset.fps ? asset.fps.d / asset.fps.n : 1 / 24;
    const wanted =
      asset.audioChannels &&
      c.component !== "video" &&
      !c.muted &&
      audioMix(s, c).audible &&
      (c.gain > 0 || c.animation?.gain?.some((k) => k.value > 0));
    // La piste son de l'app (moteur, `soundTrack`) : la première utilisable,
    // celle que sert l'aperçu. « [n:a] » prenait la première, quelle qu'elle
    // soit : vide (MPEG-TS de la TNT), le plan n'avait aucun son alors que le
    // moniteur en faisait entendre un (30/09/2026). Un fichier sans piste son
    // utilisable rend son plan muet.
    const track =
      wanted && asset.kind !== "image"
        ? await Promise.resolve(engine.soundTrack?.(file)).catch(
            () => undefined,
          )
        : undefined;
    const heard = !!wanted && track !== null;
    // L'image se lit comme le moniteur la montre (`sourceWindow`). Le son
    // d'un rush vidéo garde le zéro du moniteur (moteur, `seekShift`) ; lu
    // seul, FFmpeg en compte le temps depuis le début du son quand le -ss
    // ne le dépasse pas (moteur, `audioLead`). Sans cela, le son d'un MPEG-TS
    // qui commence 0,2 s après l'image partait 0,2 s trop tôt pendant tout
    // le premier segment, puis se recalait au suivant (29/09/2026).
    const read = picture
      ? await sourceWindow(engine, file, {
          source,
          lead: warmup.seconds,
          speed: c.speed,
          period,
          sound: !!heard,
        })
      : inputWindow(
          source,
          warmup.seconds,
          period,
          0,
          asset.kind === "video"
            ? {
                shift: await Promise.resolve(engine.seekShift?.(file)).catch(
                  () => 0,
                ),
                delay: await Promise.resolve(engine.audioLead?.(file)).catch(
                  () => 0,
                ),
              }
            : {},
        );
    // La piste image de l'aperçu (« 0:V:0 », la première qui n'est pas une
    // vignette), et la définition qu'elle a au début du fichier, celle que
    // montre le moniteur : l'aperçu garde la taille de sa première image
    // (FFmpeg, `autoscale`). Un MPEG-PS ou un MPEG-TS de télévision peut
    // changer de définition en cours de fichier (720x480 puis 704x480) :
    // FFmpeg reconstruisait alors le graphe du segment entier, et le
    // bloquait sans fin dès qu'un autre plan avait fini (30/09/2026). Pour
    // une entrée image, il ne le reconstruit plus (« -reinit_filter ») : le
    // premier filtre du plan ramène chaque image à cette définition, et
    // suit seul un changement de taille, de format ou de couleurs
    // (libavfilter, `scale_frame`). Dans le cas ordinaire, rien ne change
    // et l'image passe telle quelle, sans être recopiée (`sws_is_noop`).
    // Un graphe à part par entrée image, comme pour le son, bloquait FFmpeg
    // au hasard (une fois sur trois ou quatre sur un .mkv ordinaire).
    //
    // Cette définition est celle que reçoit le plan (moteur, `pictureShape`),
    // recadrage du conteneur fait : lue avant lui, elle étirait l'image d'un
    // MOV, d'un MP4 ou d'un MKV recadré. Un rush tourné (téléphone) est
    // redressé ici, après ce filtre, par les mêmes filtres que FFmpeg posait
    // seul avant lui, et qui ne suivaient pas un changement de taille : son
    // segment se figeait. Quand l'app ne sait pas reproduire ce redressement,
    // le plan garde l'ancien chemin.
    const image = picture
        ? await Promise.resolve(engine.videoTrack?.(file)).catch(
            () => undefined,
          )
        : undefined,
      shape =
        picture && image
          ? await Promise.resolve(engine.pictureShape?.(file)).catch(
              () => undefined,
            )
          : undefined,
      // Redressée, l'image l'est comme quand FFmpeg la redressait seul :
      // dans le format où le décodeur la rend (« format ») quand les filtres
      // de redressement l'acceptent, puis convertie, s'il le faut, au format
      // que négocie la suite du plan (« scale » sans réglage, qui laisse
      // passer l'image telle quelle quand rien n'est à convertir) ; sinon
      // (4:2:2 d'un ProRes, par exemple) convertie d'abord, par le filtre
      // qui la fige, au format que négocient ensemble la rotation et la
      // suite (`native`). Autrement, la conversion ne se faisait pas au même
      // endroit, et l'image n'était plus tout à fait la même.
      pin =
        shape?.width > 0 && shape?.height > 0 && Array.isArray(shape.turn)
          ? [
              `scale=${shape.width}:${shape.height}`,
              ...(!shape.turn.length
                ? []
                : shape.native
                  ? ["format=" + shape.format, ...shape.turn, "scale"]
                  : shape.turn),
            ]
              .map((x) => x + ",")
              .join("")
          : "";
    inputs.push(
      ...(pin
        ? ["-reinit_filter:v", "0", ...(shape.own ? ["-noautorotate"] : [])]
        : []),
      ...(asset.kind === "image"
        ? ["-loop", "1"]
        : read.ss > 0
          ? ["-ss", fmt(read.ss)]
          : []),
      "-t",
      fmt(
        asset.kind === "image"
          ? len * c.speed + 0.15
          : source - read.seek + len * c.speed + 0.15,
      ),
      "-i",
      file,
    );
    // Les images du plan dans ce segment, en numéros d'image du segment.
    // Une fenêtre en secondes arrondies laissait passer une image noire aux
    // raccords en 23,976 et 29,97.
    const first = a - start,
      last = b - start - 1;
    if (asset.kind !== "audio" && c.track < 10 && c.component !== "audio") {
      const lut = await gradeLut(path.join(cache, "grade-luts"), c.grade),
        id = "v" + index,
        scaledW = Math.max(2, Math.round((W * c.scale) / 2) * 2),
        scaledH = Math.max(2, Math.round((H * c.scale) / 2) * 2);
      const cleanup = CLEAN.sourceFilters(c),
        slow = CLEAN.slowFilter(c, s.fps);
      // Ordre voulu : débruiter et stabiliser sur les images telles qu'elles
      // ont été tournées, puis seulement changer la vitesse.
      const skip =
        asset.kind !== "image" && read.video > 1e-6
          ? `trim=start=${fmt(read.video)},`
          : "";
      const before = cleanup.length ? cleanup.join(",") + "," : "";
      const after = slow ? slow + "," : "";
      // Une image fixe bouclée part de zéro, quel que soit son point source ;
      // une vidéo, du point d'entrée du plan, dont la première image du
      // segment, préchauffage compris, est à `a - c.start` images (`retime`).
      const pace =
        asset.kind === "image"
          ? retime(0, c.speed, rate)
          : retime(
              c.inUs / 1e6 - read.zero,
              c.speed,
              rate,
              a - c.start - warmup.frames,
            );
      let f = `[${index}:${image?.index ?? "v"}]${pin}${skip}${before}${pace},${after}trim=start_frame=${warmup.frames}:end_frame=${warmup.frames + frames},setpts=PTS-STARTPTS,${engine.inputFilter(asset.inputSpace)}lut3d=file='${escapeFilter(lut)}':interp=tetrahedral,scale=${scaledW}:${scaledH}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
      f += `,format=yuva444p10le`;
      // La transition d'entrée pose l'alpha du plan. Elle vient avant les
      // fondus et l'opacité, qui la multiplient au lieu de l'écraser.
      const entrance = TRANS.alphaFilters({
        transition: c.transition && {
          kind: c.transition.kind,
          seconds: seconds(c.transition.duration, s.fps),
        },
        input: index,
        source: "tin" + index,
        label: "tout" + index,
        width: scaledW,
        height: scaledH,
        rate,
        offsetSeconds: seconds(a - c.start, s.fps),
        offsetFrames: a - c.start,
        lengthSeconds: len,
      });
      if (entrance) {
        filters.push(f + `[tin${index}]`, ...entrance);
        // « null » ne fait rien, mais permet aux filtres suivants de
        // s'enchaîner derrière l'étiquette avec une virgule.
        f = `[tout${index}]null`;
      }
      if (c.rotation)
        f += `,rotate=${fmt((c.rotation * Math.PI) / 180)}:c=none:ow=rotw(iw):oh=roth(ih)`;
      if (c.opacity < 1) f += `,colorchannelmixer=aa=${fmt(c.opacity)}`;
      // The offset retains the original fade envelope across resumed render segments.
      // setpts tronque : sans round(), 36,9999999 devenait 36 et décalait
      // tout le plan d'une image, avec une image noire au bout.
      const localOffset = seconds(a - c.start, s.fps);
      f += `,setpts=round(PTS+${fmt(localOffset)}/TB)`;
      if (c.fadeIn)
        f += `,fade=t=in:st=0:d=${fmt(seconds(c.fadeIn, s.fps))}:alpha=1`;
      if (c.fadeOut)
        f += `,fade=t=out:st=${fmt(seconds(c.duration - c.fadeOut, s.fps))}:d=${fmt(seconds(c.fadeOut, s.fps))}:alpha=1`;
      f += `,setpts=round(PTS-${fmt(localOffset)}/TB+${fmt(relative)}/TB)[${id}]`;
      filters.push(f);
      const next = "o" + index;
      const clock = `(t+${fmt(seconds(start - c.start, s.fps))})*(${rate})`;
      const x = expression(c.animation?.x, clock, c.x),
        y = expression(c.animation?.y, clock, c.y);
      filters.push(
        `[${bottom}][${id}]overlay=x='(W-w)/2+(${x})*${W}':y='(H-h)/2+(${y})*${H}':eof_action=pass:repeatlast=0:format=yuv444p10:enable='between(n,${first},${last})'[${next}]`,
      );
      bottom = next;
      // Les masques se posent sur l'image composée, dans le repère de la
      // séquence, exactement là où le moniteur les montre. Appliqués au plan
      // avant son placement, ils suivaient ses pixels et glissaient dès que
      // le plan était zoomé, déplacé ou d'un autre format que la séquence.
      for (const [order, mask] of MASKS.require_(c, maskFiles).entries()) {
        const label = "mask" + index + "s" + order,
          maskInput = n++;
        inputs.push("-loop", "1", "-framerate", rate, "-i", maskFiles[mask.id]);
        filters.push(
          ...MASKS.filters({
            mask,
            input: maskInput,
            source: bottom,
            label,
            width: W,
            height: H,
            offset: start - c.start,
            window: [first, last],
            rate,
          }),
        );
        bottom = label;
      }
    }
    if (heard) {
      const label = "a" + index,
        delay = Math.round(relative * 48000),
        clipOffset = seconds(a - c.start, s.fps);
      const gain = expression(
        c.animation?.gain,
        `(t+${fmt(clipOffset)})*(${rate})`,
        c.gain,
      );
      // Après asetpts le plan repart à zéro : son horloge absolue est décalée
      // du moment où sa portion commence dans le montage.
      const duck =
        ducking && c.audioRole === "music"
          ? LOUD.duckExpression(
              ducking.speech,
              s.ducking,
              ducking.window,
              `(t+${fmt(seconds(a, s.fps))})`,
            )
          : null;
      // Chaque entrée son passe d'abord par son propre graphe, qui la met au
      // format du mélange. Après un -ss dans un MPEG-PS, le décodeur MP2 peut
      // rendre une trame parasite d'un autre format (16 kHz, « Header
      // missing ») : FFmpeg reconstruit alors le graphe qui la reçoit, et
      // reconstruire le graphe du segment entier, sources comprises, le
      // bloquait sans fin quand un autre plan son avait déjà fini (29/09/2026).
      // Ici, seul ce petit graphe se reconstruit, et le son parasite, lu avant
      // le -ss, est écarté comme le reste. Il se prolonge de silence sans fin
      // (apad) : la fin d'une entrée, passée d'un graphe à l'autre, coupait
      // le son du segment entier au bout du plus court des plans, et faisait
      // planter FFmpeg quand l'entrée ne rendait aucune trame (point d'entrée
      // après la fin du son). Le plan est borné plus loin (`end_sample`), et
      // un plan qui ne rend rien rend ainsi du silence de sa durée.
      const sound = "snd" + index;
      audioGraphs.push(
        `[${index}:${track ? track.index : "a"}]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad[${sound}]`,
      );
      // Le son commence pile au point d'entrée : la marge et le préchauffage
      // lus pour l'image sont retirés ici, sinon ils l'avançaient d'autant.
      // Ses instants restent ceux de FFmpeg, comptés depuis le point
      // d'entrée : quand le son lu commence après lui (son d'un MPEG-TS qui
      // commence après l'image, trou au début), le silence qui manque est
      // posé devant (aresample, `first_pts`) au lieu d'avancer le son. Plus
      // loin, rien n'est comblé ni retiré (`min_hard_comp`).
      const cut = read.audio,
        trim = cut > 1e-6 ? `atrim=start=${fmt(cut)},` : "",
        place =
          Math.abs(cut) > 1e-9
            ? `asetpts=PTS${cut > 0 ? "-" : "+"}${fmt(Math.abs(cut))}/TB,`
            : "",
        tempo = atempo(c.speed);
      let f = `[${sound}]${trim}${place}aresample=48000:min_comp=0.001:min_hard_comp=100000:first_pts=0,${tempo ? tempo + "," : ""}aformat=sample_fmts=fltp:channel_layouts=stereo,volume='(${gain})*${fmt(audioMix(s, c).gain)}${duck ? `*(${duck})` : ""}':eval=frame,atrim=end_sample=${Math.round(len * 48000)},asetpts=PTS+${fmt(clipOffset)}/TB`;
      const pan = panFilter(audioMix(s, c).pan);
      if (pan) f += "," + pan;
      if (c.fadeIn) f += `,afade=t=in:st=0:d=${fmt(seconds(c.fadeIn, s.fps))}`;
      if (c.fadeOut)
        f += `,afade=t=out:st=${fmt(seconds(c.duration - c.fadeOut, s.fps))}:d=${fmt(seconds(c.fadeOut, s.fps))}`;
      f += `,asetpts=PTS-${fmt(clipOffset)}/TB,adelay=${delay}S:all=1,apad=whole_len=${samples},atrim=end_sample=${samples}[${label}]`;
      filters.push(f);
      audios.push(label);
    }
  }
  for (const overlay of overlays) {
    if (overlay.start >= end || overlay.start + overlay.duration <= start)
      continue;
    const i = n++,
      label = "text" + i;
    inputs.push("-loop", "1", "-framerate", rate, "-i", overlay.file);
    // Première et dernière image du titre dans ce segment, comptées en
    // images : en secondes arrondies, un titre sur trois perdait sa première
    // image en 29,97.
    const a = Math.max(overlay.start, start) - start,
      b = Math.min(overlay.start + overlay.duration, end) - start - 1;
    const p = overlay.placement,
      clock = `(t*(${rate})+${start - (overlay.motionOrigin ?? overlay.start)})`;
    if (p)
      filters.push(
        MOTION.filters(
          p,
          i,
          label,
          start - (overlay.motionOrigin ?? overlay.start),
          rate,
        ),
      );
    else filters.push(`[${i}:v]scale=${W}:${H},format=yuva444p10le[${label}]`);
    const px = p
      ? `${p.x}+(${expression(p.motion?.x, clock, 0)})*${W}-w/2`
      : "0";
    const py = p
      ? `${p.y}+(${expression(p.motion?.y, clock, 0)})*${H}-h/2`
      : "0";
    const next = "ot" + i;
    filters.push(
      `[${bottom}][${label}]overlay=x='${px}':y='${py}':format=yuv444p10:enable='between(n,${a},${b})'[${next}]`,
    );
    bottom = next;
  }
  filters.push(
    `[${bottom}]trim=end_frame=${count},setpts=PTS-STARTPTS,format=yuv444p10le[vout]`,
  );
  filters.push(
    `anullsrc=r=48000:cl=stereo,atrim=end_sample=${samples}[silence]`,
  );
  audios.push("silence");
  filters.push(
    audios.map((a) => "[" + a + "]").join("") +
      `amix=inputs=${audios.length}:duration=longest:normalize=0,volume=${fmt(s.masterGain)},alimiter=limit=0.95:level=0:latency=1,atrim=end_sample=${samples},asetpts=PTS-STARTPTS[aout]`,
  );
  return { inputs, filter: filters.join(";"), audioGraphs, count, samples };
}
/**
 * Le délai au-delà duquel un FFmpeg qui ne sort plus rien est arrêté
 * (moteur, `run`, `stall`), en millisecondes : jamais moins de
 * `STALL_FLOOR`, et quarante fois le temps que peut prendre une image du
 * segment. Celui-ci s'estime plan par plan, image du rush comprise (les
 * filtres de nettoyage travaillent à sa définition), à `STALL_RATE` images
 * par seconde en 1080p sans filtre, ralenti par le débruitage, la
 * stabilisation et le ralenti fluide (cleanup.cjs, `costFactor`) : un plan
 * 4K au débruitage fort, stabilisé et ralenti, sort une image toutes les deux
 * minutes environ, et n'est arrêté qu'après deux heures et demie sans en
 * sortir aucune. Le garde-fou se fonde sur la progression, jamais sur la
 * durée totale : un rendu lent qui avance n'est pas coupé.
 */
const STALL_FLOOR = 5 * 60 * 1000,
  STALL_RATE = 60;
function stallLimit({ engine, sequence: s, assets, start = 0, count = 0 }) {
  const end = start + count;
  let perFrame = 0;
  for (const c of s?.clips || []) {
    if (!(c.start < end && c.start + c.duration > start)) continue;
    const a = assets?.get?.(c.assetId);
    if (a?.kind !== "video" || c.component === "audio" || c.track >= 10)
      continue;
    const pixels = Math.max(
      1,
      ((a.width || 1920) * (a.height || 1080)) / (1920 * 1080),
    );
    perFrame +=
      (pixels * Math.max(1, c.speed || 1)) /
      (STALL_RATE * Math.max(1e-6, CLEAN.costFactor(c)));
  }
  return Math.max(
    engine?.stallFloor ?? STALL_FLOOR,
    Math.ceil(perFrame * 40 * 1000),
  );
}
async function renderSegment(options, target, signal) {
  const { engine, sequence: s } = options,
    b = await buildSegment(options);
  await engine.ff(
    [
      "-y",
      ...b.inputs,
      ...b.audioGraphs.flatMap((g) => ["-filter_complex", g]),
      "-filter_complex",
      b.filter,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-frames:v",
      String(b.count),
      "-r",
      s.fps.n + "/" + s.fps.d,
      ...(options.deliveryCodec
        ? engine.encode({
            quality: "final",
            codec: options.deliveryCodec,
            width: s.width,
            height: s.height,
            fps: s.fps,
          })
        : ["-c:v", "ffv1", "-level", "3", "-pix_fmt", "yuv444p10le"]),
      ...(options.deliveryCodec
        ? ["-video_track_timescale", String(s.fps.n)]
        : []),
      "-c:a",
      "pcm_s24le",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-colorspace",
      "bt709",
      target,
    ],
    { signal, stall: stallLimit(options) },
  );
}
/**
 * Assemble les segments et produit le fichier livré.
 *
 * `loudness` demande une normalisation au niveau d'une cible de diffusion.
 * Elle se fait ici, sur le film entier, et jamais par segment : le niveau
 * intégré d'un film n'est pas la somme des niveaux de ses morceaux.
 */
async function finishRender(
  engine,
  sequence,
  segments,
  destination,
  codec,
  signal,
  encoded = false,
  segmentDurations,
  { loudness, onStage } = {},
) {
  const list = destination + ".concat.txt";
  await fs.writeFile(
    list,
    segments
      .map(
        (p, i) =>
          "file '" +
          p.replaceAll("'", "'\\''") +
          "'" +
          (segmentDurations
            ? "\nduration " + Number(segmentDurations[i]).toFixed(12)
            : ""),
      )
      .join("\n"),
  );
  // L'assemblage recopie les images déjà rendues : le délai de base suffit.
  // L'écriture finale du fichier (« +faststart »), sans suivi, n'y compte
  // pas (moteur, `run`).
  const stall = engine.stallFloor ?? STALL_FLOOR;
  try {
    let audioFilter = null;
    if (loudness) {
      onStage?.("measure");
      // Première passe : mesurer. Sans elle, loudnorm travaille en aveugle et
      // le niveau livré s'écarte de la cible.
      const mesure = await engine.analyse(
        [
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          list,
          "-vn",
          "-af",
          LOUD.normaliseFilter(loudness) + ":print_format=json",
        ],
        { signal, stall },
      );
      onStage?.("normalise");
      // loudnorm monte en interne à 192 kHz pour mesurer le vrai crête :
      // il faut redescendre, sinon le fichier livré part à 192 kHz. Ses
      // paquets de 100 ms faussent aussi la durée annoncée du son AAC : les
      // instants sont recomptés échantillon par échantillon, et le son borné
      // à la longueur du film. Sans cela, un film de 10,01 s en annonçait
      // 10,1, l'image figée à la fin.
      const total = segmentDurations
          ? segmentDurations.reduce((sum, d) => sum + Number(d), 0)
          : seconds(duration(sequence), sequence.fps),
        samples = Math.round(total * 48000);
      audioFilter =
        LOUD.normaliseFilter(loudness, mesure.text) +
        ",aresample=48000,asetpts=N/SR/TB" +
        (samples > 0 ? `,atrim=end_sample=${samples}` : "");
    }
    await engine.ff(
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        ...(audioFilter ? ["-af", audioFilter] : []),
        ...(encoded
          ? ["-c:v", "copy"]
          : engine.encode({
              quality: "final",
              codec,
              width: sequence.width,
              height: sequence.height,
              fps: sequence.fps,
            })),
        "-video_track_timescale",
        String(sequence.fps.n),
        "-c:a",
        ["prores", "dnxhr"].includes(codec) ? "pcm_s24le" : "aac",
        ...(["prores", "dnxhr"].includes(codec) ? [] : ["-b:a", "320k"]),
        ...(codec === "hevc" ? ["-tag:v", "hvc1"] : []),
        "-movflags",
        "+faststart+write_colr",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-color_range",
        "tv",
        destination,
      ],
      { signal, stall },
    );
    if (codec === "h264") await engine.tagH264(destination, { signal, stall });
  } finally {
    await fs.unlink(list).catch(() => {});
  }
}
module.exports = {
  gradeLut,
  atempo,
  readWindow,
  inputWindow,
  sourceWindow,
  retime,
  buildSegment,
  renderSegment,
  finishRender,
  stallLimit,
  STALL_FLOOR,
  hash,
};
