/**
 * Le dérushage : découper un rush en passages bons, à vérifier et masqués,
 * d'après ce qu'on voit de son image (PLAN-DERUSHAGE.md).
 *
 * Une seule lecture de l'aperçu du rush (960×540, Log déjà développé) donne
 * deux séries, lues en même temps par FFmpeg :
 *   · la qualité, à 6 images par seconde : flou (`blurdetect`), détail
 *     spatial (`siti`), luminance et différence d'une image à l'autre
 *     (`signalstats`), écrites par `metadata=print` dans un fichier ;
 *   · le mouvement de la caméra, à 12 images par seconde : des miniatures
 *     grises de 96×54, écrites dans un fichier et relues par Node, où une
 *     corrélation de phase sur six zones donne le déplacement de la caméra
 *     d'une image à la suivante.
 * Rien d'autre n'est lu : ni l'original 4K, ni le son (le son ne masque
 * jamais l'image).
 *
 * Ce qui est masqué : le noir, le flou fort et passager, le bougé fort, le
 * début ou la fin d'enregistrement agités, le rush de moins d'une seconde.
 * Ce qui est « à vérifier » : le flou léger, ou tenu, ou entre deux coupes ;
 * le bougé léger ; le mouvement brusque ; la surexposition ; rien qui bouge
 * pendant plus de 2 min ; un bon passage trop court entre deux défauts.
 *
 * Les règles sont lisibles et chacune donne sa raison. Elles jugent le flou
 * par rapport au rush lui-même (le flou « normal » varie de 4,7 à 7,5 d'un
 * plan net à l'autre, mesuré le 01/10/2026) et le bougé par sa forme : un
 * tremblement change sans cesse de sens, un panoramique jamais.
 *
 * Réglage « prudent » (décision de Johan, 01/10/2026) : tant que les seuils
 * n'ont pas été mesurés contre un vrai montage, seul l'inutilisable évident
 * est masqué ; le reste est « à vérifier », visible, avec sa raison.
 */

const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { writeJsonAtomic } = require("../atomic.cjs");
const { escapeFilter } = require("./engine.cjs");

/**
 * Deux versions : celle des relevés (la lecture FFmpeg) et celle des règles.
 * Changer les règles refait le découpage à partir des relevés gardés dans le
 * cache, sans relire un seul rush ; changer la lecture refait tout. Ni l'une
 * ni l'autre ne touche aux décisions de l'utilisateur.
 */
const VERSION_MESURE = "mesure-v1";
const VERSION_REGLES = "regles-v1";

/** Cadences d'analyse : qualité et mouvement. */
const FPS_QUALITE = 6;
const FPS_MOUVEMENT = 12;
/** Miniatures du mouvement. */
const MINI_L = 96;
const MINI_H = 54;
/**
 * Un rush est lu par tranches de trois minutes, chacune rangée dans le cache
 * dès qu'elle est lue : une analyse qui cède sa place à un export, ou que la
 * fermeture de l'app interrompt, reprend à la tranche suivante. Chaque
 * tranche relit la seconde qui la précède, pour la différence d'image et le
 * mouvement de sa première image.
 */
const TRANCHE = 180;
const RECOUVREMENT = 1;

const RAISONS = {
  noir: "Noir",
  immobile: "Rien ne bouge depuis plus de 2 min",
  flou: "Flou",
  "flou-leger": "Un peu flou",
  bouge: "Bougé",
  "bouge-leger": "Un peu bougé",
  brusque: "Mouvement brusque",
  surexpose: "Surexposé",
  declenchement: "Début ou fin d'enregistrement",
  accidentel: "Rush de moins d'une seconde",
  court: "Passage court entre deux défauts",
};

/**
 * Les seuils du réglage « prudent », le seul tant qu'aucun montage réel n'a
 * servi de mesure (décision de Johan, 01/10/2026). Chaque défaut a une durée
 * minimale : plus court, ce n'est pas un défaut (une image floue isolée, un
 * sursaut de 0,2 s). Les valeurs viennent du banc du 01/10/2026 (rush
 * d'essai à sept défauts fabriqués, films publiés de Juno comme témoins).
 */
const REGLAGES = {
  prudent: {
    // Noir : luminance moyenne et 90e centile au ras du noir, et aucune
    // lumière dans l'image. Sans le maximum, une soirée sombre traversée de
    // quelques projecteurs, ou un feu d'artifice, passait pour du noir.
    noirYavg: 22,
    noirYhigh: 40,
    noirYmax: 80,
    noirDuree: 0.3,
    // Rien ne bouge : la caméra oubliée en marche, posée sur une table ou
    // retournée. Ni mouvement de la caméra, ni changement dans l'image
    // (différence médiane des miniatures sous 0,06) pendant plus de 2 min :
    // « à vérifier ». Une image figée n'est pas cherchée : sur l'aperçu,
    // dont l'encodeur efface le bruit du capteur, elle ne se distingue pas
    // d'un plan sur pied d'un objet immobile (mesuré le 01/10/2026 : 0,001 à
    // 0,035 pour l'une comme pour l'autre), qui est un plan qu'on garde ; et
    // une caméra ne fige pas son image.
    immobileEcart: 0.06,
    immobileVitesse: 0.01,
    immobileDuree: 120,
    // Flou : rapport au flou de référence du rush autour de l'instant
    // (premier quartile sur une minute), écart minimal, et chute du détail
    // par rapport au détail de référence (troisième quartile).
    flouFenetre: 20,
    flouRapport: 1.8,
    flouEcart: 6,
    flouDetail: 0.5,
    flouDuree: 0.8,
    flouLegerRapport: 1.25,
    flouLegerEcart: 1.5,
    flouLegerDetail: 0.7,
    flouLegerDuree: 1,
    // Un flou n'est masqué que passager (moins de 8 s) et à côté d'un
    // passage net du même rush (à moins de 3 s) : une mise au point ratée,
    // pas un parti pris. Plus long, ou sans voisin net (brume, ciel, flou
    // artistique tenu), il est « à vérifier ».
    flouPassager: 8,
    flouVoisinage: 3,
    flouNet: 1.25,
    // Une coupe (film déjà monté, clips d'un téléphone mis bout à bout,
    // quelqu'un qui passe devant l'objectif) : une image sans rapport avec la
    // précédente, à la fois par la corrélation (pic médian des zones sous
    // 0,25 : 0,14 à 0,20 mesuré aux coupes, 0,26 à 0,99 dans un plan) et par
    // la différence d'image (trois fois la normale des deux secondes
    // autour, et au moins 20). Un voisin net au-delà d'une coupe ne compte
    // pas : le flou d'un plan entier est un parti pris, pas une mise au
    // point ratée.
    coupePic: 0.25,
    coupeYdif: 20,
    coupeRapport: 3,
    // Bougé : un tremblement (écart au mouvement lissé, en pixels de la
    // miniature de 96 px, soit en centièmes de la largeur) qui change sans
    // cesse de sens (inversions par seconde) ou ne va nulle part (régularité
    // basse : les déplacements s'annulent). Un panoramique ou un drone vont
    // dans un sens (régularité 0,8 à 1) sans s'inverser. Un cœur fort masque
    // son passage agité, à une seconde près de part et d'autre ; le
    // tremblement léger seul est « à vérifier ».
    bougeTremblement: 0.9,
    bougeInversions: 4,
    bougeRegularite: 0.35,
    bougeDuree: 0.5,
    bougeLegerTremblement: 0.5,
    bougeLegerInversions: 3,
    bougeLegerDuree: 0.5,
    bougeExtension: 1,
    // Mouvement brusque : plus de 80 % de la largeur par seconde, sans
    // régularité. Souvent voulu : à vérifier seulement.
    brusqueVitesse: 0.8,
    brusqueRegularite: 0.7,
    brusqueDuree: 0.3,
    // Surexposé : au moins 10 % de l'image écrêtée, sur une image claire.
    surexposeYhigh: 233,
    surexposeYavg: 150,
    surexposeDuree: 1,
    // Un bon passage plus court que ceci, entre deux passages qui ne le sont
    // pas, devient « à vérifier ».
    bonMinimum: 1.5,
    // Début et fin d'enregistrement agités : 1,2 s au plus.
    bord: 1.2,
    accidentel: 1,
  },
};

/* ── La corrélation de phase ─────────────────────────────────────────────── */

const puissance2 = (v) => 1 << Math.ceil(Math.log2(v));

function fft(re, im, inverse) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let b = N >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const a = ((2 * Math.PI) / len) * (inverse ? 1 : -1),
      wr = Math.cos(a),
      wi = Math.sin(a);
    for (let i = 0; i < N; i += len) {
      let cr = 1,
        ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const k = i + j,
          l = k + len / 2,
          tr = re[l] * cr - im[l] * ci,
          ti = re[l] * ci + im[l] * cr;
        re[l] = re[k] - tr;
        im[l] = im[k] - ti;
        re[k] += tr;
        im[k] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < N; i++) {
      re[i] /= N;
      im[i] /= N;
    }
}

/**
 * La corrélation de phase d'une zone de `L`×`H` pixels, prise à (x0, y0)
 * dans des images de `largeur` pixels de large : `pousser(image)` rend le
 * déplacement du contenu de la zone depuis l'image précédente, en pixels, et
 * la hauteur du pic de corrélation (près de 1 : même contenu déplacé ; près
 * de 0 : rien de comparable).
 */
function creerZone(largeur, x0, y0, L, H) {
  const PW = puissance2(L),
    PH = puissance2(H),
    hann = new Float64Array(L * H),
    ligneR = new Float64Array(PW),
    ligneI = new Float64Array(PW),
    colR = new Float64Array(PH),
    colI = new Float64Array(PH),
    cr = new Float64Array(PW * PH),
    ci = new Float64Array(PW * PH);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < L; x++)
      hann[y * L + x] =
        (0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / L)) *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / H));
  const fft2 = (re, im, inverse) => {
    for (let y = 0; y < PH; y++) {
      for (let x = 0; x < PW; x++) {
        ligneR[x] = re[y * PW + x];
        ligneI[x] = im[y * PW + x];
      }
      fft(ligneR, ligneI, inverse);
      for (let x = 0; x < PW; x++) {
        re[y * PW + x] = ligneR[x];
        im[y * PW + x] = ligneI[x];
      }
    }
    for (let x = 0; x < PW; x++) {
      for (let y = 0; y < PH; y++) {
        colR[y] = re[y * PW + x];
        colI[y] = im[y * PW + x];
      }
      fft(colR, colI, inverse);
      for (let y = 0; y < PH; y++) {
        re[y * PW + x] = colR[y];
        im[y * PW + x] = colI[y];
      }
    }
  };
  const spectre = (image) => {
    const re = new Float64Array(PW * PH),
      im = new Float64Array(PW * PH);
    let m = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) m += image[(y0 + y) * largeur + x0 + x];
    m /= L * H;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < L; x++) re[y * PW + x] = (image[(y0 + y) * largeur + x0 + x] - m) * hann[y * L + x];
    fft2(re, im, false);
    return [re, im];
  };
  let precedent = null;
  return {
    pousser(image) {
      const actuel = spectre(image);
      if (!precedent) {
        precedent = actuel;
        return null;
      }
      for (let i = 0; i < PW * PH; i++) {
        const a = actuel[0][i],
          b = actuel[1][i],
          c = precedent[0][i],
          d = -precedent[1][i],
          r = a * c - b * d,
          s = a * d + b * c,
          mag = Math.hypot(r, s) + 1e-9;
        cr[i] = r / mag;
        ci[i] = s / mag;
      }
      fft2(cr, ci, true);
      let pic = -1,
        indice = 0;
      for (let i = 0; i < PW * PH; i++)
        if (cr[i] > pic) {
          pic = cr[i];
          indice = i;
        }
      const px = indice % PW,
        py = Math.floor(indice / PW),
        a = (x, y) => cr[((y + PH) % PH) * PW + ((x + PW) % PW)],
        affine = (m1, c0, p1) => {
          const den = m1 - 2 * c0 + p1;
          return den < 0 ? (0.5 * (m1 - p1)) / den : 0;
        };
      let dx = px + affine(a(px - 1, py), pic, a(px + 1, py)),
        dy = py + affine(a(px, py - 1), pic, a(px, py + 1));
      if (dx > PW / 2) dx -= PW;
      if (dy > PH / 2) dy -= PH;
      precedent = actuel;
      return { dx, dy, pic };
    },
  };
}

/**
 * Le mouvement de la caméra d'une image à la suivante, sur des miniatures
 * grises de 96×54 découpées en six zones (trois de large, deux de haut),
 * chacune mesurée par corrélation de phase.
 *
 * Une seule corrélation sur l'image entière prenait le mouvement d'un sujet
 * pour celui de la caméra : un jongleur filmé sur pied devant un décor à
 * rayures verticales (qui ne dit rien d'un déplacement vertical) passait pour
 * un bougé fort (banc du 01/10/2026). La caméra, elle, déplace tout le cadre :
 * son mouvement est celui sur lequel les zones s'accordent. On garde la
 * médiane des zones fiables (pic d'au moins 0,25), et la part des zones qui
 * s'y accordent (`accord`) ; `pic` est la médiane des pics, qui tombe à une
 * coupe, un flash ou une image noire.
 */
function creerMouvement(W = MINI_L, H = MINI_H) {
  const cols = 3,
    rangs = 2,
    L = Math.floor(W / cols),
    Hz = Math.floor(H / rangs),
    zones = [];
  for (let r = 0; r < rangs; r++)
    for (let c = 0; c < cols; c++) zones.push(creerZone(W, c * L, r * Hz, L, Hz));
  return {
    pousser(image) {
      const mesures = zones.map((z) => z.pousser(image));
      if (!mesures[0]) return null;
      const pic = mediane(mesures.map((m) => m.pic)),
        fiables = mesures.filter((m) => m.pic >= 0.25);
      if (fiables.length < 3) return { dx: 0, dy: 0, pic: Math.min(pic, 0.2), accord: 0 };
      const dx = mediane(fiables.map((m) => m.dx)),
        dy = mediane(fiables.map((m) => m.dy)),
        tolerance = Math.max(0.75, 0.3 * Math.hypot(dx, dy)),
        accord = fiables.filter((m) => Math.hypot(m.dx - dx, m.dy - dy) <= tolerance).length / fiables.length;
      return { dx, dy, pic, accord };
    },
  };
}

/* ── La lecture des mesures de qualité ───────────────────────────────────── */

const CLES = {
  "lavfi.blur": "flou",
  "lavfi.siti.si": "detail",
  "lavfi.signalstats.YAVG": "yavg",
  "lavfi.signalstats.YLOW": "ylow",
  "lavfi.signalstats.YHIGH": "yhigh",
  "lavfi.signalstats.YMAX": "ymax",
  "lavfi.signalstats.YDIF": "ydif",
};

/**
 * Le fichier de `metadata=mode=print` : une ligne « frame:… pts_time:… »
 * par image, puis une ligne « clé=valeur » par mesure.
 */
function lireQualite(texte) {
  const echantillons = [];
  let courant = null;
  for (const ligne of texte.split("\n")) {
    const tete = /pts_time:(-?[0-9.]+)/.exec(ligne);
    if (tete) {
      courant = { t: Number(tete[1]) };
      echantillons.push(courant);
      continue;
    }
    const m = /^(lavfi\.[A-Za-z0-9._]+)=(-?[0-9.]+(?:e[-+]?\d+)?)/.exec(ligne.trim());
    if (m && courant && CLES[m[1]]) courant[CLES[m[1]]] = Number(m[2]);
  }
  return echantillons.filter((e) => Number.isFinite(e.t));
}

/* ── La lecture d'un rush ────────────────────────────────────────────────── */

const arrondi = (v, n) => (Number.isFinite(v) ? Math.round(v * 10 ** n) / 10 ** n : undefined);

/**
 * Lire une tranche de l'aperçu : de `debut` à `debut + longueur`, plus la
 * seconde qui précède. Rend les relevés de la tranche seule, en secondes du
 * rush (la même base que les silences et les scènes de l'analyse).
 */
async function lireTranche(engine, apercu, dossier, debut, longueur, { signal } = {}) {
  const id = randomUUID(),
    meta = path.join(dossier, `.derush-${id}.txt`),
    brut = path.join(dossier, `.derush-${id}.gray`),
    avant = Math.min(debut, RECOUVREMENT),
    ss = debut - avant;
  try {
    await engine.ff(
      [
        "-y",
        ...(ss > 0 ? ["-ss", ss.toFixed(3)] : []),
        "-t",
        (longueur + avant).toFixed(3),
        "-i",
        apercu,
        "-filter_complex",
        `[0:v:0]split=2[q][m];` +
          `[q]fps=${FPS_QUALITE},format=yuv420p,blurdetect,signalstats,siti,metadata=mode=print:file='${escapeFilter(meta)}'[qo];` +
          // Un rush vertical ou carré n'est pas écrasé dans la miniature : on
          // en garde la bande centrale à 16/9, pour que le tremblement se
          // mesure pareil dans les deux sens.
          `[m]fps=${FPS_MOUVEMENT},scale=${MINI_L}:${MINI_H}:force_original_aspect_ratio=increase:flags=area,crop=${MINI_L}:${MINI_H},format=gray[mo]`,
        "-map",
        "[qo]",
        "-f",
        "null",
        "-",
        "-map",
        "[mo]",
        // Cadence constante explicite : l'image n du fichier est à
        // ss + n/12 (`lireTranche`), même si l'image du rush commence après
        // son son.
        "-fps_mode",
        "cfr",
        "-f",
        "rawvideo",
        brut,
      ],
      // Une lecture de l'aperçu qui ne progresse plus est arrêtée (`run`).
      { signal, stall: 120000 },
    );
    const texte = await fs.readFile(meta, "utf8").catch(() => ""),
      fin = debut + longueur;
    const lus = lireQualite(texte).map((e) => ({ ...e, t: e.t + ss }));
    const qualite = lus
      .filter((e) => e.t >= debut - 1e-3 && e.t < fin - 1e-3)
      .map((e) => ({
        t: arrondi(e.t, 3),
        flou: arrondi(e.flou, 3),
        detail: arrondi(e.detail, 2),
        yavg: arrondi(e.yavg, 1),
        ylow: arrondi(e.ylow, 1),
        yhigh: arrondi(e.yhigh, 1),
        ymax: arrondi(e.ymax, 1),
        ydif: arrondi(e.ydif, 3),
      }));
    // Les miniatures du mouvement, sans instant : la sortie à cadence
    // constante commence au point de lecture, en répétant la première image
    // si celle du rush commence plus tard (une vidéo qui démarre 0,5 s après
    // son son). L'image n est donc à ss + n/12. Prendre l'instant de la
    // première mesure de qualité décalait tout le mouvement d'autant, et les
    // coupes n'étaient plus vues (relecture du 01/10/2026).
    const mouvement = [],
      depart = ss,
      taille = MINI_L * MINI_H,
      calcul = creerMouvement(),
      fichier = await fs.open(brut, "r").catch(() => null);
    let precedente = null;
    if (fichier)
      try {
        // 24 images (2 s de rush) par lecture, puis la main rendue : le calcul
        // tourne dans le processus principal, qui sert aussi l'interface et
        // la lecture des aperçus ; 240 d'un coup le bloquaient 130 ms.
        const bloc = Buffer.alloc(taille * 24);
        let n = 0,
          reste = Buffer.alloc(0);
        for (;;) {
          signal?.throwIfAborted();
          const { bytesRead } = await fichier.read(bloc, 0, bloc.length, null);
          if (!bytesRead) break;
          let donnees = Buffer.concat([reste, bloc.subarray(0, bytesRead)]);
          const entieres = Math.floor(donnees.length / taille);
          for (let k = 0; k < entieres; k++, n++) {
            const image = donnees.subarray(k * taille, (k + 1) * taille),
              d = calcul.pousser(image),
              t = depart + n / FPS_MOUVEMENT;
            // La différence moyenne avec la miniature précédente : ce qui
            // change dans l'image, hors du mouvement de la caméra (une
            // caméra oubliée en marche n'y voit rien changer).
            let ecart = 0;
            if (precedente) {
              for (let p = 0; p < taille; p++) ecart += Math.abs(image[p] - precedente[p]);
              ecart /= taille;
            }
            precedente = Buffer.from(image);
            if (d && t >= debut - 1e-3 && t < fin - 1e-3)
              mouvement.push({
                t: arrondi(t, 3),
                dx: arrondi(d.dx, 3),
                dy: arrondi(d.dy, 3),
                pic: arrondi(d.pic, 3),
                accord: arrondi(d.accord, 2),
                ecart: arrondi(ecart, 3),
              });
          }
          reste = Buffer.from(donnees.subarray(entieres * taille));
          await new Promise((r) => setImmediate(r));
        }
      } finally {
        await fichier.close();
      }
    return { qualite, mouvement };
  } finally {
    await fs.unlink(meta).catch(() => {});
    await fs.unlink(brut).catch(() => {});
  }
}

/**
 * Les relevés d'un rush entier, lus tranche par tranche. `dossier` : le cache
 * du média ; `marque` : la version de l'aperçu lu (taille et date). Les
 * tranches déjà lues pour cette marque sont reprises du cache ; une fois
 * toutes lues, elles sont réunies en un seul fichier, gardé pour refaire le
 * découpage sans relire le rush.
 */
async function mesurer(
  engine,
  apercu,
  dossier,
  { duree, marque, signal, onTranche, tranche: pasTranche = TRANCHE } = {},
) {
  const fichier = path.join(dossier, `derush-${VERSION_MESURE}.json`);
  // Les fichiers de travail d'une lecture coupée net (app tuée) : jetés.
  for (const nom of await fs.readdir(dossier).catch(() => []))
    if (nom.startsWith(".derush-")) await fs.unlink(path.join(dossier, nom)).catch(() => {});
  const deja = await fs
    .readFile(fichier, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  // Une tâche qui cède sa place s'arrête ici aussi, même quand tout est déjà
  // lu (nouvelles règles seulement).
  signal?.throwIfAborted();
  if (deja?.version === VERSION_MESURE && deja.marque === marque) return deja;
  const tranches = path.join(dossier, "derush-tranches"),
    nombre = Math.max(1, Math.ceil(duree / pasTranche)),
    nomTranche = (i) => path.join(tranches, `${VERSION_MESURE}-${i}.json`);
  await fs.mkdir(tranches, { recursive: true });
  // Des tranches d'un autre aperçu ou d'une autre version : jetées.
  const entete = path.join(tranches, "marque.json"),
    vue = await fs
      .readFile(entete, "utf8")
      .then(JSON.parse)
      .catch(() => null);
  if (
    vue?.marque !== marque ||
    vue?.version !== VERSION_MESURE ||
    vue?.duree !== duree ||
    vue?.tranche !== pasTranche
  ) {
    await fs.rm(tranches, { recursive: true, force: true });
    await fs.mkdir(tranches, { recursive: true });
    await writeJsonAtomic(entete, { version: VERSION_MESURE, marque, duree, tranche: pasTranche });
  }
  const qualite = [],
    mouvement = [];
  for (let i = 0; i < nombre; i++) {
    signal?.throwIfAborted();
    let tranche = await fs
      .readFile(nomTranche(i), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    if (!tranche) {
      const debut = i * pasTranche,
        // La dernière tranche lit jusqu'au bout, une seconde de marge
        // comprise : la durée annoncée peut être un peu courte.
        longueur = i === nombre - 1 ? duree - debut + 1 : pasTranche;
      tranche = await lireTranche(engine, apercu, dossier, debut, longueur, { signal });
      await writeJsonAtomic(nomTranche(i), tranche);
    }
    qualite.push(...tranche.qualite);
    mouvement.push(...tranche.mouvement);
    await onTranche?.((i + 1) / nombre);
  }
  const releves = { version: VERSION_MESURE, marque, duree, qualite, mouvement };
  await writeJsonAtomic(fichier, releves);
  await fs.rm(tranches, { recursive: true, force: true }).catch(() => {});
  return releves;
}

/* ── Les règles ──────────────────────────────────────────────────────────── */

const quantile = (valeurs, q) => {
  const v = valeurs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const i = Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))));
  return v[i];
};
const mediane = (v) => quantile(v, 0.5);

/**
 * Les mesures de mouvement autour de chaque instant : vitesse, tremblement,
 * inversions de sens, régularité, sur une fenêtre d'une seconde.
 */
function mouvementAutour(mouvement, instants, fenetre = 1) {
  // Une image où les zones ne s'accordent pas montre le mouvement d'un
  // sujet, pas celui de la caméra : elle ne compte pas.
  const fiables = mouvement.filter((m) => m.pic >= 0.25 && !(m.accord < 0.5)),
    n = fiables.length;
  // Le mouvement lissé (médiane sur 5 images fiables), calculé une fois pour
  // tout le rush : par fenêtre, il coûtait 0,35 s pour 2 h de rush.
  const lisse = (axe) => {
    const sortie = new Float64Array(n),
      cinq = [];
    for (let i = 0; i < n; i++) {
      cinq.length = 0;
      for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) cinq.push(fiables[k][axe]);
      cinq.sort((a, b) => a - b);
      sortie[i] = cinq[Math.floor(cinq.length / 2)];
    }
    return sortie;
  };
  const lx = lisse("dx"),
    ly = lisse("dy");
  let debut = 0;
  return instants.map((t) => {
    while (debut < n && fiables[debut].t < t - fenetre / 2) debut++;
    let fin = debut;
    while (fin < n && fiables[fin].t <= t + fenetre / 2) fin++;
    const compte = fin - debut;
    if (compte < 4) return null;
    let tremblement = 0,
      somme = 0,
      sx = 0,
      sy = 0,
      inversions = 0;
    for (let i = debut; i < fin; i++) {
      const v = fiables[i];
      tremblement += (v.dx - lx[i]) ** 2 + (v.dy - ly[i]) ** 2;
      somme += Math.hypot(v.dx, v.dy);
      sx += v.dx;
      sy += v.dy;
      if (i > debut) {
        const w = fiables[i - 1];
        if (Math.abs(v.dx) > 0.15 && Math.abs(w.dx) > 0.15 && Math.sign(v.dx) !== Math.sign(w.dx)) inversions++;
        if (Math.abs(v.dy) > 0.15 && Math.abs(w.dy) > 0.15 && Math.sign(v.dy) !== Math.sign(w.dy)) inversions++;
      }
    }
    const duree = Math.max(1e-3, fiables[fin - 1].t - fiables[debut].t + 1 / FPS_MOUVEMENT),
      moyenne = somme / compte;
    return {
      tremblement: Math.sqrt(tremblement / compte),
      inversions: inversions / duree,
      // Fraction de la largeur de l'image parcourue par seconde.
      vitesse: (moyenne * FPS_MOUVEMENT) / MINI_L,
      regularite: moyenne > 1e-6 ? Math.hypot(sx, sy) / compte / moyenne : 1,
    };
  });
}

/** Les suites de `true` : [premier indice, dernier indice]. */
function suites(drapeaux) {
  const sortie = [];
  for (let i = 0; i < drapeaux.length; i++) {
    if (!drapeaux[i]) continue;
    let j = i;
    while (j + 1 < drapeaux.length && drapeaux[j + 1]) j++;
    sortie.push([i, j]);
    i = j;
  }
  return sortie;
}

/** Bouche les trous d'au plus `trou` mesures entre deux `true`. */
function boucher(drapeaux, trou = 1) {
  const sortie = drapeaux.slice();
  for (let i = 0; i < drapeaux.length; i++) {
    if (drapeaux[i]) continue;
    let j = i;
    while (j + 1 < drapeaux.length && !drapeaux[j + 1]) j++;
    if (i > 0 && j < drapeaux.length - 1 && j - i + 1 <= trou) for (let k = i; k <= j; k++) sortie[k] = true;
    i = j;
  }
  return sortie;
}

/**
 * Le flou et le détail de référence autour de chaque instant : premier
 * quartile du flou et troisième quartile du détail, sur les mesures utiles
 * à `fenetre` secondes de part et d'autre, calculés à chaque seconde. Une
 * fenêtre trop pauvre prend les références du rush entier.
 */
function references(q, utile, fenetre) {
  const globale = {
      flou: quantile(q.filter((_, i) => utile[i]).map((e) => e.flou), 0.25),
      detail: quantile(q.filter((_, i) => utile[i]).map((e) => e.detail), 0.75),
    },
    grille = [],
    fin = q.length ? q[q.length - 1].t : 0,
    // Une référence toutes les 5 s : elle varie lentement (fenêtre de 40 s),
    // et chaque seconde coûtait 0,4 s de tri pour 2 h de rush.
    PAS = 5;
  let a = 0,
    b = 0;
  for (let c = 0; c <= fin + PAS; c += PAS) {
    while (a < q.length && q[a].t < c - fenetre) a++;
    while (b < q.length && q[b].t <= c + fenetre) b++;
    const flous = [],
      details = [];
    for (let k = a; k < b; k++)
      if (utile[k]) {
        flous.push(q[k].flou);
        details.push(q[k].detail);
      }
    grille.push(
      flous.filter(Number.isFinite).length >= 2 * FPS_QUALITE
        ? { flou: quantile(flous, 0.25), detail: quantile(details, 0.75) }
        : globale,
    );
  }
  return { globale, a: (t) => grille[Math.min(grille.length - 1, Math.max(0, Math.round(t / PAS)))] };
}

/** La différence médiane des miniatures sur la demi-seconde autour de chaque instant. */
function ecartAutour(mouvement, instants) {
  const avec = mouvement.filter((m) => Number.isFinite(m.ecart));
  let debut = 0;
  return instants.map((t) => {
    while (debut < avec.length && avec[debut].t < t - 0.5) debut++;
    const v = [];
    for (let k = debut; k < avec.length && avec[k].t <= t + 0.5; k++) v.push(avec[k].ecart);
    return v.length >= 4 ? mediane(v) : NaN;
  });
}

/**
 * Les coupes : `coupe[i]` vrai quand la mesure `i` n'a pas de rapport avec
 * la précédente. Il faut les deux signes : la corrélation de phase seule
 * tombe aussi sur un plan pauvre en détails (un ciel), la différence d'image
 * seule monte aussi dans un mouvement rapide.
 */
function coupes(q, mouvement, R) {
  const ydif = q.map((e) => e.ydif),
    fiables = mouvement.slice().sort((a, b) => a.t - b.t);
  let k = 0;
  return q.map((e, i) => {
    if (i === 0) return false;
    const autour = [];
    for (let j = i - 1; j >= 0 && q[j].t >= e.t - 2; j--) autour.push(ydif[j]);
    for (let j = i + 1; j < q.length && q[j].t <= e.t + 2; j++) autour.push(ydif[j]);
    const normale = mediane(autour);
    if (!(ydif[i] >= Math.max(R.coupeYdif, R.coupeRapport * (Number.isFinite(normale) ? normale : 0))))
      return false;
    // Les images du mouvement entre la mesure précédente et celle-ci, plus
    // la suivante : les deux cadences ne prennent pas toujours la même image
    // source autour d'une coupe (mesuré : jusqu'à un douzième de seconde).
    while (k < fiables.length && fiables[k].t <= q[i - 1].t) k++;
    let pic = Infinity;
    for (let j = k; j < fiables.length && fiables[j].t <= e.t + 1 / FPS_MOUVEMENT + 1e-6; j++)
      pic = Math.min(pic, fiables[j].pic);
    return pic < R.coupePic;
  });
}

/**
 * Découper un rush. `qualite` : les mesures de `lireQualite` ; `mouvement` :
 * `{ t, dx, dy, pic }` à 12 images par seconde ; `duree` : la durée du rush
 * en secondes. Rend les passages, qui couvrent tout le rush de 0 à `duree`,
 * chacun `{ debut, fin, etat, raisons }`, le résumé et le mouvement
 * d'ensemble.
 */
function decouper({ qualite, mouvement = [], duree }, nom = "prudent") {
  const R = REGLAGES[nom] || REGLAGES.prudent,
    pas = 1 / FPS_QUALITE,
    q = qualite.filter((e) => e.t >= 0 && e.t <= duree + pas);
  if (!(duree > 0)) return { plages: [], resume: resumer([], 0) };
  if (duree < R.accidentel || !q.length) {
    const plages = [
      duree < R.accidentel
        ? { debut: 0, fin: arrondir(duree), etat: "masque", raisons: ["accidentel"] }
        : { debut: 0, fin: arrondir(duree), etat: "bon", raisons: [] },
    ];
    return { plages, resume: resumer(plages, duree) };
  }
  const t = q.map((e) => e.t),
    n = q.length,
    longueur = (i, j) => t[j] - t[i] + pas,
    // Les marques de chaque mesure : raison → masquée (true) ou à vérifier.
    marques = t.map(() => new Map()),
    marquer = (i, j, raison, masque) => {
      for (let k = i; k <= j; k++) marques[k].set(raison, masque || marques[k].get(raison) === true);
    };
  // Le noir.
  const sombre = q.map(
      (e) => e.yavg <= R.noirYavg && e.yhigh <= R.noirYhigh && !(e.ymax > R.noirYmax),
    ),
    ecarts = ecartAutour(mouvement, t);
  for (const [i, j] of suites(sombre)) if (longueur(i, j) >= R.noirDuree) marquer(i, j, "noir", true);
  // Flou, jugé contre le rush autour de l'instant.
  const utile = q.map((e, i) => !sombre[i] && Number.isFinite(e.flou) && Number.isFinite(e.detail)),
    refs = references(q, utile, R.flouFenetre),
    ref = t.map((x) => refs.a(x)),
    flouFort = q.map(
      (e, i) =>
        utile[i] &&
        e.flou >= Math.max(ref[i].flou * R.flouRapport, ref[i].flou + R.flouEcart) &&
        e.detail <= ref[i].detail * R.flouDetail,
    ),
    flouLeger = q.map(
      (e, i) =>
        flouFort[i] ||
        (utile[i] &&
          e.flou >= Math.max(ref[i].flou * R.flouLegerRapport, ref[i].flou + R.flouLegerEcart) &&
          e.detail <= ref[i].detail * R.flouLegerDetail),
    ),
    net = q.map((e, i) => utile[i] && e.flou <= ref[i].flou * R.flouNet),
    coupe = coupes(q, mouvement, R),
    // Un voisin net à moins de 3 s, sans coupe entre lui et le flou.
    voisinNet = (i, j) => {
      for (let k = i - 1; k >= 0 && t[k] >= t[i] - R.flouVoisinage; k--) {
        if (coupe[k + 1]) break;
        if (net[k]) return true;
      }
      for (let k = j + 1; k < n && t[k] <= t[j] + R.flouVoisinage; k++) {
        if (coupe[k]) break;
        if (net[k]) return true;
      }
      return false;
    };
  for (const [i, j] of suites(flouFort))
    if (longueur(i, j) >= R.flouDuree)
      marquer(i, j, "flou", longueur(i, j) <= R.flouPassager && voisinNet(i, j));
  for (const [i, j] of suites(flouLeger))
    if (longueur(i, j) >= R.flouLegerDuree && longueur(i, j) <= R.flouPassager && voisinNet(i, j))
      for (let k = i; k <= j; k++) if (!marques[k].has("flou")) marquer(k, k, "flou-leger", false);
  // Bougé : un cœur fort masque son passage agité, à une seconde près de
  // part et d'autre ; le reste du passage agité est à vérifier.
  const mv = mouvementAutour(mouvement, t),
    erratique = (m, inversions) => m.inversions >= inversions || m.regularite <= R.bougeRegularite,
    // Une mesure calme isolée au milieu d'un tremblement n'en coupe pas le
    // passage (jusqu'à une demi-seconde).
    bougeFort = boucher(
      mv.map((m) => !!m && m.tremblement >= R.bougeTremblement && erratique(m, R.bougeInversions)),
      2,
    ),
    bougeLeger = boucher(
      mv.map(
        (m, i) =>
          bougeFort[i] ||
          (!!m && m.tremblement >= R.bougeLegerTremblement && erratique(m, R.bougeLegerInversions)),
      ),
      3,
    ),
    coeurs = suites(bougeFort).filter(([i, j]) => longueur(i, j) >= R.bougeDuree);
  for (const [i, j] of suites(bougeLeger)) {
    const dedans = coeurs.filter(([a, b]) => a >= i && b <= j);
    if (!dedans.length && longueur(i, j) < R.bougeLegerDuree) continue;
    for (let k = i; k <= j; k++) {
      const proche = dedans.some(([a, b]) => t[k] >= t[a] - R.bougeExtension && t[k] <= t[b] + R.bougeExtension);
      marquer(k, k, proche ? "bouge" : "bouge-leger", proche);
    }
  }
  // Rien ne bouge depuis plus de 2 min : à vérifier.
  const immobile = boucher(
    t.map(
      (_, i) =>
        Number.isFinite(ecarts[i]) && ecarts[i] < R.immobileEcart && !(mv[i]?.vitesse >= R.immobileVitesse),
    ),
    3,
  );
  for (const [i, j] of suites(immobile))
    if (longueur(i, j) >= R.immobileDuree) marquer(i, j, "immobile", false);
  // Mouvement brusque et surexposition : à vérifier.
  const brusque = mv.map((m) => !!m && m.vitesse >= R.brusqueVitesse && m.regularite < R.brusqueRegularite),
    surexpose = q.map((e) => e.yhigh >= R.surexposeYhigh && e.yavg >= R.surexposeYavg);
  for (const [i, j] of suites(brusque)) if (longueur(i, j) >= R.brusqueDuree) marquer(i, j, "brusque", false);
  for (const [i, j] of suites(surexpose)) if (longueur(i, j) >= R.surexposeDuree) marquer(i, j, "surexpose", false);
  // L'état de chaque mesure, et ses raisons : celles qui le décident. Un
  // défaut fort couvre sa version légère.
  const etats = marques.map((m) => {
    for (const [fort, leger] of [
      ["flou", "flou-leger"],
      ["bouge", "bouge-leger"],
    ])
      if (m.has(fort)) m.delete(leger);
    const masque = [...m].filter(([, v]) => v).map(([r]) => r);
    if (masque.length) return { etat: "masque", raisons: masque };
    return m.size ? { etat: "verifier", raisons: [...m.keys()] } : { etat: "bon", raisons: [] };
  });
  // Mesures consécutives de même état : des passages.
  let plages = [];
  for (let i = 0; i < n; i++) {
    const debut = i === 0 ? 0 : (t[i - 1] + t[i]) / 2,
      fin = i === n - 1 ? duree : (t[i] + t[i + 1]) / 2,
      dernier = plages[plages.length - 1];
    if (dernier && dernier.etat === etats[i].etat) {
      dernier.fin = fin;
      for (const r of etats[i].raisons) if (!dernier.raisons.includes(r)) dernier.raisons.push(r);
    } else plages.push({ debut, fin, etat: etats[i].etat, raisons: etats[i].raisons.slice() });
  }
  // Début et fin d'enregistrement : le bord du rush, s'il est agité, est
  // masqué (l'appui sur le bouton).
  const agite = (p) => p.raisons.some((r) => r === "bouge" || r === "bouge-leger" || r === "brusque");
  const premier = plages[0],
    dernier = plages[plages.length - 1];
  if (premier && premier.etat !== "bon" && agite(premier) && premier.fin <= R.bord)
    Object.assign(premier, { etat: "masque", raisons: ["declenchement"] });
  if (dernier && dernier !== premier && dernier.etat !== "bon" && agite(dernier) && duree - dernier.debut <= R.bord)
    Object.assign(dernier, { etat: "masque", raisons: ["declenchement"] });
  // Un bon passage trop court entre deux défauts : à vérifier.
  plages.forEach((p, i) => {
    if (
      p.etat === "bon" &&
      p.fin - p.debut < R.bonMinimum &&
      i > 0 &&
      i < plages.length - 1 &&
      plages[i - 1].etat !== "bon" &&
      plages[i + 1].etat !== "bon"
    )
      Object.assign(p, { etat: "verifier", raisons: ["court"] });
  });
  // Fusion des voisins devenus identiques.
  plages = plages.reduce((acc, p) => {
    const d = acc[acc.length - 1];
    if (d && d.etat === p.etat) {
      d.fin = p.fin;
      for (const r of p.raisons) if (!d.raisons.includes(r)) d.raisons.push(r);
    } else acc.push({ ...p, raisons: p.raisons.slice() });
    return acc;
  }, []);
  const arrondies = plages.map((p) => ({ ...p, debut: arrondir(p.debut), fin: arrondir(p.fin) }));
  return {
    plages: arrondies,
    resume: resumer(arrondies, duree),
    mouvement: classerMouvement(mv),
    references: refs.globale,
  };
}

const arrondir = (s) => Math.round(s * 1000) / 1000;

function resumer(plages, duree) {
  const total = (etat) => plages.filter((p) => p.etat === etat).reduce((s, p) => s + (p.fin - p.debut), 0);
  return {
    duree: arrondir(duree),
    bon: arrondir(total("bon")),
    verifier: arrondir(total("verifier")),
    masque: arrondir(total("masque")),
  };
}

/**
 * Le mouvement d'ensemble du rush : fixe, maîtrisé (panoramique, travelling,
 * drone) ou à la main.
 */
function classerMouvement(mv) {
  const m = mv.filter(Boolean);
  if (!m.length) return undefined;
  const vitesse = mediane(m.map((x) => x.vitesse)),
    tremblement = mediane(m.map((x) => x.tremblement));
  if (tremblement >= 0.35) return "main";
  if (vitesse < 0.01) return "fixe";
  return "maitrise";
}

module.exports = {
  VERSION_MESURE,
  VERSION_REGLES,
  TRANCHE,
  FPS_QUALITE,
  FPS_MOUVEMENT,
  MINI_L,
  MINI_H,
  RAISONS,
  REGLAGES,
  creerMouvement,
  lireQualite,
  lireTranche,
  mesurer,
  mouvementAutour,
  suites,
  boucher,
  coupes,
  decouper,
  classerMouvement,
};
