/* Bundled MediaPipe model: all requests stay within the installed app. No network service. */
// La géométrie des morceaux, partagée avec les tests : voir face-tiles.js.
importScripts("face-tiles.js");
// La netteté des visages indépendante de leur taille : voir face-sharpness.js.
// Si elle manque, l'ancienne mesure décide ; tout le reste marche.
try {
  importScripts("face-sharpness.js");
} catch (e) {
  console.warn("Netteté des visages indisponible", e);
}
/** L'échelle à laquelle la netteté des visages a été calibrée. */
const LARGEUR_NETTETE = 480;
/**
 * Ramener la mesure faite depuis l'image d'analyse à celle des vignettes.
 *
 * La vignette est un JPEG crénelé : son bruit fait un plancher qui gonfle la
 * netteté des visages flous. Mesurée depuis l'image d'analyse, propre, la
 * même netteté descend plus bas (rapport 0,3 à 0,6 sur un visage flou, 0,7 à
 * 0,8 sur un net). Mesuré le 27/09/2026 sur 60 photos de mariage floutées à
 * cinq degrés : de 1,8 à 1,9, le verdict « visage flou » (seuil 12) ne diffère
 * de l'ancien que sur 2 visages sur 254, deux flous que l'ancien disait nets
 * de justesse, et n'en manque aucun. Hors de ce plateau, 3 à 10 désaccords.
 */
const CALIBRATION_NETTETE = 1.85;
/** Le même échantillonnage que `resizeRaster` (src/modules/raster.ts). */
function reduire(src, w, h, gw, gh) {
  const out = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const sx = ((x + 0.5) * w) / gw - 0.5,
        sy = ((y + 0.5) * h) / gh - 0.5,
        x0 = Math.max(0, Math.floor(sx)),
        y0 = Math.max(0, Math.floor(sy)),
        x1 = Math.min(w - 1, x0 + 1),
        y1 = Math.min(h - 1, y0 + 1),
        fx = Math.max(0, sx - x0),
        fy = Math.max(0, sy - y0);
      out[y * gw + x] =
        (src[y0 * w + x0] * (1 - fx) + src[y0 * w + x1] * fx) * (1 - fy) +
        (src[y1 * w + x0] * (1 - fx) + src[y1 * w + x1] * fx) * fy;
    }
  return out;
}
let landmarker;
/** Stable landmarks: same list as src/modules/people.ts ANCHORS. */
const ANCHORS = [
  33, 133, 362, 263, 1, 4, 61, 291, 199, 168, 234, 454, 10, 152, 145, 374, 13,
  14, 78, 308,
];
/** Pairwise distances between anchors, scaled by the eye to eye distance. */
function faceSignature(points) {
  if (!points || points.length < 468) return undefined;
  const anchors = ANCHORS.map((i) => points[i]);
  if (anchors.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return undefined;
  const scale = Math.hypot(
    points[263].x - points[33].x,
    points[263].y - points[33].y,
  );
  if (!(scale > 1e-6)) return undefined;
  const signature = [];
  for (let i = 0; i < anchors.length; i++)
    for (let j = i + 1; j < anchors.length; j++)
      signature.push(
        Math.hypot(anchors[i].x - anchors[j].x, anchors[i].y - anchors[j].y) /
          scale,
      );
  return signature;
}
/** Laplacian variance inside a region, measured on the thumbnail's own pixels. */
function regionSharpness(gray, width, height, region) {
  const x0 = Math.max(1, Math.floor(region.x * width)),
    y0 = Math.max(1, Math.floor(region.y * height)),
    x1 = Math.min(width - 1, Math.ceil((region.x + region.w) * width)),
    y1 = Math.min(height - 1, Math.ceil((region.y + region.h) * height));
  let sum = 0,
    square = 0,
    n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * width + x,
        v =
          4 * gray[i] -
          gray[i - 1] -
          gray[i + 1] -
          gray[i - width] -
          gray[i + width];
      sum += v;
      square += v * v;
      n++;
    }
  return n ? square / n - (sum / n) ** 2 : 0;
}
/**
 * Charger MediaPipe une seule fois, même si plusieurs images arrivent pendant
 * le chargement.
 *
 * Le chargement attend : entre-temps, une deuxième image entrait ici, voyait
 * `landmarker` encore vide et relançait `importScripts`. Le paquet évalué deux
 * fois dans le même espace échouait sur « Identifier 'i' has already been
 * declared ». Le tri photo n'envoyait qu'une image à la fois et ne le voyait
 * pas ; la recherche de visages par tuiles en envoie plusieurs d'un coup.
 */
let chargement;
function charger(base) {
  chargement ??= (async () => {
    self.exports = {};
    importScripts(base + "vendor/vision/vision_bundle.js");
    const vision = self.exports;
    const files = await vision.FilesetResolver.forVisionTasks(
      base + "vendor/vision/wasm",
    );
    landmarker = await vision.FaceLandmarker.createFromOptions(files, {
      baseOptions: {
        modelAssetPath: base + "models/face_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      numFaces: 20,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.6,
      minFacePresenceConfidence: 0.6,
    });
    return landmarker;
  })().catch((e) => {
    // Un chargement raté ne doit pas condamner les images suivantes.
    chargement = undefined;
    throw e;
  });
  return chargement;
}
/**
 * Détecter sur l'image entière, puis, si demandé, sur chacun des morceaux.
 *
 * Les repères de chaque visage sont ramenés dans le repère de l'image entière
 * avant tout calcul : netteté, signature et boîte restent ainsi comparables à
 * une détection faite sur l'image seule.
 */
function detecter(lm, image, avecTuiles) {
  const T = self.JunoFaceTiles;
  const morceaux = avecTuiles
    ? T.tuiles(image.width, image.height)
    : [{ x: 0, y: 0, w: 1, h: 1 }];
  const trouves = [];
  for (const t of morceaux) {
    let source = image;
    if (t.w < 1 || t.h < 1) {
      // Découpé à la taille native : on relit les mêmes pixels, sans les
      // agrandir ni les réduire.
      const sw = Math.max(1, Math.round(t.w * image.width)),
        sh = Math.max(1, Math.round(t.h * image.height));
      const toile = new OffscreenCanvas(sw, sh);
      toile
        .getContext("2d")
        .drawImage(image, Math.round(t.x * image.width), Math.round(t.y * image.height), sw, sh, 0, 0, sw, sh);
      source = toile.transferToImageBitmap();
    }
    const sortie = lm.detect(source);
    if (source !== image) source.close();
    sortie.faceLandmarks.forEach((points, i) => {
      const pts = points.map((p) => T.versImage(p, t));
      const xs = pts.map((p) => p.x),
        ys = pts.map((p) => p.y);
      const x = Math.max(0, Math.min(...xs)),
        y = Math.max(0, Math.min(...ys));
      trouves.push({
        points: pts,
        shape: sortie.faceBlendshapes?.[i],
        matrix: sortie.facialTransformationMatrixes?.[i],
        boite: {
          x,
          y,
          w: Math.max(0, Math.min(1, Math.max(...xs)) - x),
          h: Math.max(0, Math.min(1, Math.max(...ys)) - y),
        },
      });
    });
  }
  return avecTuiles ? T.fusionner(trouves, 0.5, (d) => d.boite) : trouves;
}
self.onmessage = async ({ data: { id, image, base, tuiles = false, rapportYeux = 0, source } }) => {
  try {
    const detections = detecter(await charger(base), image, tuiles);
    const output = {
      faceLandmarks: detections.map((d) => d.points),
      faceBlendshapes: detections.map((d) => d.shape),
      facialTransformationMatrixes: detections.map((d) => d.matrix),
    };
    // Le plan de gris où l'on mesure la netteté des visages, toujours à
    // l'échelle d'une vignette de 480 px. Les visages sont désormais cherchés
    // sur l'image de 1 024 px, mais la même mesure y vaut 2,5 fois moins
    // (mesuré sur 950 photos) : le seuil « visage flou » et la note de qualité,
    // calibrés à 480 px, auraient déclaré flous des visages nets.
    const echelle = Math.min(1, LARGEUR_NETTETE / Math.max(image.width, image.height));
    const gw = Math.max(1, Math.round(image.width * echelle)),
      gh = Math.max(1, Math.round(image.height * echelle));
    // Réduit comme `resizeRaster` fabrique les vignettes : interpolation
    // bilinéaire sans préfiltre. Un lissage de meilleure qualité ôterait le
    // crénelage sur lequel le seuil a été calibré, et la même photo
    // paraîtrait plus floue.
    const canvas = new OffscreenCanvas(image.width, image.height),
      context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data,
      plein = new Float32Array(image.width * image.height);
    for (let p = 0; p < plein.length; p++) {
      const i = p * 4;
      plein[p] =
        0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    }
    const gray = echelle === 1 ? plein : reduire(plein, image.width, image.height, gw, gh);
    // La netteté qui juge un visage flou se lit sur l'image entière de
    // 1 024 px, non réduite. Hors de cette taille (vignette de secours), elle
    // reste indéfinie et l'ancienne mesure décide.
    const cote = Math.max(image.width, image.height);
    const shapes = output.faceBlendshapes || [],
      matrices = output.facialTransformationMatrixes || [];
    const reads = output.faceLandmarks.map((points, index) => {
      const bx0 = Math.min(...points.map((p) => p.x)),
        by0 = Math.min(...points.map((p) => p.y)),
        bx1 = Math.max(...points.map((p) => p.x)),
        by1 = Math.max(...points.map((p) => p.y));
      const x = Math.max(0, bx0),
        y = Math.max(0, by0),
        w = Math.max(0, Math.min(1, bx1) - x),
        h = Math.max(0, Math.min(1, by1) - y);
      const face = shapes[index],
        score = (name) =>
          face?.categories.find((c) => c.categoryName === name)?.score || 0;
      // The matrix third column tells how far the head turned from the lens.
      const matrix = matrices[index]?.data;
      const turned = matrix
        ? Math.min(1, Math.hypot(matrix[8] || 0, matrix[9] || 0))
        : Math.min(
            1,
            Math.abs(score("eyeLookOutLeft") - score("eyeLookOutRight")) * 2,
          );
      return {
        region: { x, y, w, h },
        signature: faceSignature(points),
        weight: Math.max(0, Math.min(1, w * h)),
        // Comparable d'une image à l'autre d'une même rafale, où les visages
        // ont la même taille : c'est ce que le classement d'une série utilise.
        sharpness:
          w > 0 && h > 0
            ? regionSharpness(gray, gw, gh, { x, y, w, h }) *
              (echelle < 1 ? CALIBRATION_NETTETE : 1)
            : 0,
        // Comparable d'un visage à l'autre, quelle que soit sa taille : c'est
        // ce qui décide qu'un visage est flou.
        // La boîte entière des repères, même si elle dépasse du cadre : rognée,
        // elle ferait glisser la bande des yeux vers le nez d'un visage coupé
        // par le haut de l'image. La mesure rogne elle-même la bande.
        nettete:
          w > 0 && h > 0 && self.JunoNettete
            ? self.JunoNettete.mesurer(
                plein,
                image.width,
                image.height,
                {
                  x: bx0 * image.width,
                  y: by0 * image.height,
                  w: (bx1 - bx0) * image.width,
                  h: (by1 - by0) * image.height,
                },
                cote,
                source,
              )
            : undefined,
        // Un visage brûlé : la part de blanc pur dans son cœur (60 % central
        // de la boîte), sur l'image d'analyse. C'est ce qui décide « Hautes
        // lumières à vérifier » (quality.ts, hautesLumieres) : le ciel ou un
        // fond blanc, que le RAW récupère, ne comptent plus.
        ecrete:
          w > 0 && h > 0 && self.JunoNettete?.ecrete
            ? self.JunoNettete.ecrete(plein, image.width, image.height, { x, y, w, h })
            : undefined,
        eyesClosed: Math.min(score("eyeBlinkLeft"), score("eyeBlinkRight")),
        smile: Math.max(score("mouthSmileLeft"), score("mouthSmileRight")),
        turned,
      };
    });
    const ordered = reads
      .filter((r) => r.region.w > 0 && r.region.h > 0)
      .sort((a, b) => b.weight - a.weight);
    // Les visages qui comptent pour juger les yeux : pas un invité minuscule
    // au fond d'un portrait du couple.
    const plusLarge = ordered.length ? Math.max(...ordered.map((r) => r.region.w)) : 0;
    const comptes = ordered.filter((r) => r.region.w >= rapportYeux * plusLarge);
    // Le catalogue n'accepte que 20 visages détaillés et un compte de 100 :
    // au-delà, toute l'analyse de la photo serait refusée. Lue par morceaux,
    // une photo de foule peut les dépasser ; on garde les plus grands.
    const gardes = ordered.slice(0, 20);
    self.postMessage({
      id,
      result: {
        regions: gardes.map((r) => r.region),
        reads: gardes,
        subjectSharpness: ordered[0]?.sharpness,
        count: Math.min(100, output.faceLandmarks.length),
        closedEyes: Math.min(
          100,
          comptes.filter((r) => r.eyesClosed > 0.65).length,
        ),
        blink: comptes.length ? Math.max(...comptes.map((r) => r.eyesClosed)) : 0,
      },
    });
  } catch (e) {
    self.postMessage({
      id,
      error: e.message || "Analyse des visages indisponible.",
    });
  } finally {
    image.close();
  }
};
