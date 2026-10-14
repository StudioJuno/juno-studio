/**
 * Mesurer l'inclinaison d'une photo à partir de ses lignes.
 *
 * Porté du prototype mesuré le 27/09/2026 sur 300 photos de l'album
 * Audrey-Ann et Clément (EOS R) : 50 ms par image à 1 024 px ; répétabilité
 * de 0,01° en médiane sur le palier automatique ; abstention sur environ la
 * moitié des photos, celles sans lignes fiables. Voir AUDIT-AFTERSHOOT.md et
 * REGISTRE-MODELES.md.
 *
 * Principe : segments au sous-pixel, point de fuite vertical par moindres
 * carrés repondérés, horizon reconstitué en fusionnant les segments alignés
 * (il est souvent coupé par les personnes), puis une décision par paliers.
 * Pas de modèle : un réseau publié se trompe de 0,9 à 3° en médiane, plus que
 * la correction utile (0,66° en médiane chez Aftershoot).
 *
 * Convention : `angle` > 0 veut dire que la photo penche dans le sens
 * horaire à l'écran (y vers le bas). La correction est l'opposé :
 * `straighten = −angle`.
 */
export const VERSION_NIVEAU = "lignes-v1";
const DEG = 180 / Math.PI;
type Segment = {
  famille: 1 | 2;
  angle: number;
  delta: number;
  len: number;
  mx: number;
  my: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
function flou(src: ArrayLike<number>, w: number, h: number, sigma: number) {
  const r = Math.ceil(sigma * 3),
    k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  const tmp = new Float32Array(w * h),
    out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * src[y * w + Math.min(w - 1, Math.max(0, x + i))];
      tmp[y * w + x] = a;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let a = 0;
      for (let i = -r; i <= r; i++) a += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = a;
    }
  return out;
}
const replie = (a: number) => ((((a + 90) % 180) + 180) % 180) - 90;
/** Les segments presque horizontaux (famille 1) et presque verticaux (famille 2). */
export function segments(gris: ArrayLike<number>, w: number, h: number): Segment[] {
  const SEUIL = 24,
    FAMILLE = 20,
    CROISSANCE = 6,
    minLen = 0.04 * Math.max(w, h),
    maxRms = 0.7;
  const b = flou(gris, w, h, 1);
  const gx = new Float32Array(w * h),
    gy = new Float32Array(w * h),
    mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = b[i - w - 1], bb = b[i - w], c = b[i - w + 1], d = b[i - 1], f = b[i + 1],
        g = b[i + w - 1], hh = b[i + w], k = b[i + w + 1];
      const X = c + 2 * f + k - a - 2 * d - g,
        Y = g + 2 * hh + k - a - 2 * bb - c;
      gx[i] = X;
      gy[i] = Y;
      mag[i] = Math.hypot(X, Y);
    }
  const fam = new Uint8Array(w * h),
    la = new Float32Array(w * h),
    ox = new Float32Array(w * h),
    oy = new Float32Array(w * h);
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      const i = y * w + x,
        m = mag[i];
      if (m < SEUIL) continue;
      // Non-maxima supprimés le long du gradient.
      const ga = Math.atan2(gy[i], gx[i]);
      const q = Math.round(((((ga * DEG) % 180) + 180) % 180) / 45) % 4;
      const n1 = q === 0 ? mag[i - 1] : q === 1 ? mag[i - w - 1] : q === 2 ? mag[i - w] : mag[i - w + 1];
      const n2 = q === 0 ? mag[i + 1] : q === 1 ? mag[i + w + 1] : q === 2 ? mag[i + w] : mag[i + w - 1];
      if (m < n1 || m < n2) continue;
      // Affinage au sous-pixel : sans lui, une ligne à 0,4° se lisait à 0,65°.
      const den = n1 - 2 * m + n2,
        t = den < 0 ? Math.max(-0.5, Math.min(0.5, (n1 - n2) / (2 * den))) : 0;
      ox[i] = t * (q === 2 ? 0 : q === 3 ? -1 : 1);
      oy[i] = t * (q === 0 ? 0 : 1);
      const a = replie(ga * DEG + 90);
      if (Math.abs(a) <= FAMILLE) {
        fam[i] = 1;
        la[i] = a;
      } else if (90 - Math.abs(a) <= FAMILLE) {
        fam[i] = 2;
        la[i] = a;
      }
    }
  const vu = new Uint8Array(w * h),
    out: Segment[] = [],
    pile: number[] = [];
  const ecart = (a: number, b2: number) => Math.abs(replie(a - b2));
  for (let i0 = 0; i0 < w * h; i0++) {
    if (!fam[i0] || vu[i0]) continue;
    const F = fam[i0];
    let cx = Math.cos((2 * la[i0]) / DEG),
      sy = Math.sin((2 * la[i0]) / DEG);
    const px: number[] = [],
      pw: number[] = [];
    pile.length = 0;
    pile.push(i0);
    vu[i0] = 1;
    while (pile.length) {
      const i = pile.pop()!;
      px.push(i);
      pw.push(mag[i]);
      const moy = (Math.atan2(sy, cx) / 2) * DEG;
      const x = i % w,
        y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = (y + dy) * w + x + dx;
          if (j < 0 || j >= w * h || vu[j] || fam[j] !== F) continue;
          if (ecart(la[j], moy) > CROISSANCE) continue;
          vu[j] = 1;
          pile.push(j);
          cx += Math.cos((2 * la[j]) / DEG);
          sy += Math.sin((2 * la[j]) / DEG);
        }
    }
    if (px.length < minLen * 0.6) continue;
    // Analyse en composantes principales pondérée par le gradient.
    let W = 0,
      mx = 0,
      my = 0;
    const PX = (k: number) => (px[k] % w) + ox[px[k]],
      PY = (k: number) => ((px[k] / w) | 0) + oy[px[k]];
    for (let k = 0; k < px.length; k++) {
      W += pw[k];
      mx += pw[k] * PX(k);
      my += pw[k] * PY(k);
    }
    mx /= W;
    my /= W;
    let sxx = 0,
      syy = 0,
      sxy = 0;
    for (let k = 0; k < px.length; k++) {
      const x = PX(k) - mx,
        y = PY(k) - my;
      sxx += pw[k] * x * x;
      syy += pw[k] * y * y;
      sxy += pw[k] * x * y;
    }
    sxx /= W;
    syy /= W;
    sxy /= W;
    const tr = sxx + syy,
      det = sxx * syy - sxy * sxy,
      disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l2 = Math.max(0, tr / 2 - disc);
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const dx = Math.cos(theta),
      dy = Math.sin(theta);
    let tmin = Infinity,
      tmax = -Infinity;
    for (let k = 0; k < px.length; k++) {
      const t = (PX(k) - mx) * dx + (PY(k) - my) * dy;
      if (t < tmin) tmin = t;
      if (t > tmax) tmax = t;
    }
    const len = tmax - tmin,
      rms = Math.sqrt(l2);
    if (len < minLen || rms > maxRms) continue;
    const a = replie(theta * DEG);
    const famille = Math.abs(a) <= FAMILLE ? 1 : 90 - Math.abs(a) <= FAMILLE ? 2 : 0;
    if (!famille) continue;
    out.push({
      famille,
      angle: a,
      delta: famille === 1 ? a : a > 0 ? a - 90 : a + 90,
      len,
      mx,
      my,
      x1: mx + dx * tmin,
      y1: my + dy * tmin,
      x2: mx + dx * tmax,
      y2: my + dy * tmax,
    });
  }
  return out;
}
function valeursPropres3(M: number[][]) {
  const a = M.map((r) => r.slice()),
    v = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  for (let it = 0; it < 50; it++) {
    let p = 0,
      q = 1,
      grand = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > grand) {
      p = 0;
      q = 2;
      grand = Math.abs(a[0][2]);
    }
    if (Math.abs(a[1][2]) > grand) {
      p = 1;
      q = 2;
      grand = Math.abs(a[1][2]);
    }
    if (grand < 1e-14) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]),
      c = Math.cos(th),
      s = Math.sin(th);
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p], vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }
  return { valeurs: [a[0][0], a[1][1], a[2][2]], vecteurs: v };
}
function medianePonderee(v: number[], p: number[]) {
  const idx = v.map((_, i) => i).sort((a, b) => v[a] - v[b]);
  const tot = p.reduce((a, b) => a + b, 0);
  let c = 0;
  for (const i of idx) {
    c += p[i];
    if (c >= tot / 2) return v[i];
  }
  return v[idx[idx.length - 1]];
}
type Verticales = { delta: number; dist: number; n: number; support: number; rms: number };
/**
 * Le point de fuite des verticales, par moindres carrés repondérés (Cauchy).
 * La médiane des angles se laisse tromper par une contre-plongée : sur une
 * mire tournée de 2° vue d'en bas, elle donnait −0,32° ; le point de fuite 1,98°.
 */
export function verticales(segs: Segment[], w: number, h: number): Verticales | null {
  const F = Math.max(w, h),
    s0 = 0.5 / DEG;
  const S = segs
    .filter((s) => s.famille === 2)
    .map((s) => {
      const t = s.angle / DEG;
      let dx = Math.cos(t),
        dy = Math.sin(t);
      if (dy < 0) {
        dx = -dx;
        dy = -dy;
      }
      return { ...s, dx, dy, x: (s.mx - w / 2) / F, y: (s.my - h / 2) / F };
    });
  if (!S.length) return null;
  const med = medianePonderee(
    S.map((s) => s.delta),
    S.map((s) => s.len),
  );
  let v = [-Math.sin(med / DEG), Math.cos(med / DEG), 0];
  const residu = (s: (typeof S)[number], v2: number[]) => {
    let ux: number, uy: number;
    if (Math.abs(v2[2]) < 1e-9) {
      ux = v2[0];
      uy = v2[1];
    } else {
      ux = v2[0] / v2[2] - s.x;
      uy = v2[1] / v2[2] - s.y;
    }
    const n = Math.hypot(ux, uy) || 1;
    return Math.asin(Math.min(1, Math.abs(s.dx * uy - s.dy * ux) / n));
  };
  for (let it = 0; it < 8; it++) {
    const M = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    for (const s of S) {
      const r = residu(s, v),
        wt = s.len / (1 + (r / s0) ** 2);
      const l = [s.dy, -s.dx, -(s.dy * s.x - s.dx * s.y)];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += wt * l[i] * l[j];
    }
    const e = valeursPropres3(M);
    let k = 0;
    for (let i = 1; i < 3; i++) if (e.valeurs[i] < e.valeurs[k]) k = i;
    v = [e.vecteurs[0][k], e.vecteurs[1][k], e.vecteurs[2][k]];
  }
  let ux = v[0],
    uy = v[1];
  if (uy < 0) {
    ux = -ux;
    uy = -uy;
  }
  const inl = S.filter((s) => residu(s, v) < 0.75 / DEG);
  const poids = inl.reduce((a, s) => a + s.len, 0);
  return {
    delta: Math.atan2(-ux, uy) * DEG,
    dist: Math.abs(v[2]) < 1e-9 ? Infinity : Math.hypot(v[0], v[1]) / Math.abs(v[2]),
    n: inl.length,
    support: poids / h,
    rms: inl.length ? Math.sqrt(inl.reduce((a, s) => a + s.len * residu(s, v) ** 2, 0) / poids) * DEG : 0,
  };
}
function resout3(A: number[][], B: number[]) {
  const M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < 3; r++)
      if (r !== c) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}
type Horizon = { delta: number; span: number; cover: number; res: number };
/**
 * L'horizon, reconstitué en fusionnant les segments alignés, puis ajusté par
 * y = a + b·u + c·u² : le terme en u² absorbe la courbure du barillet, qui
 * penchait les deux moitiés d'un même horizon de −0,51° et −0,06° au 24 mm.
 */
export function horizon(segs: Segment[], w: number, h: number): Horizon | null {
  const S = segs.filter((s) => s.famille === 1 && Math.abs(s.delta) <= 10).sort((a, b) => b.len - a.len);
  const tolD = 1,
    tolY = Math.max(2, 0.004 * w);
  const groupes: { delta: number; x0: number; y0: number; membres: Segment[] }[] = [];
  for (const s of S) {
    let trouve = null;
    for (const c of groupes) {
      const yPred = c.y0 + Math.tan(c.delta / DEG) * (s.mx - c.x0);
      if (Math.abs(s.delta - c.delta) <= tolD && Math.abs(s.my - yPred) <= tolY) {
        trouve = c;
        break;
      }
    }
    if (trouve) trouve.membres.push(s);
    else groupes.push({ delta: s.delta, x0: s.mx, y0: s.my, membres: [s] });
  }
  let meilleur: Horizon | null = null;
  for (const c of groupes) {
    const pts: [number, number][] = [];
    for (const m of c.membres) {
      const k = Math.max(2, Math.round(m.len / 6));
      for (let i = 0; i <= k; i++) pts.push([m.x1 + ((m.x2 - m.x1) * i) / k, m.y1 + ((m.y2 - m.y1) * i) / k]);
    }
    const span =
      (Math.max(...c.membres.map((m) => Math.max(m.x1, m.x2))) - Math.min(...c.membres.map((m) => Math.min(m.x1, m.x2)))) / w;
    const cover = c.membres.reduce((a, m) => a + m.len, 0) / w;
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const B = [0, 0, 0];
    for (const [x, y] of pts) {
      const u = (x - w / 2) / w,
        v = [1, u, u * u];
      for (let i = 0; i < 3; i++) {
        B[i] += v[i] * y;
        for (let j = 0; j < 3; j++) A[i][j] += v[i] * v[j];
      }
    }
    let coef = span >= 0.5 && c.membres.length >= 2 ? resout3(A, B) : null;
    if (!coef) {
      const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
      coef = det ? [(B[0] * A[1][1] - B[1] * A[0][1]) / det, (A[0][0] * B[1] - A[1][0] * B[0]) / det, 0] : [0, 0, 0];
    }
    const [c0, c1, c2] = coef;
    const res = Math.sqrt(
      pts.reduce((a, [x, y]) => {
        const u = (x - w / 2) / w;
        return a + (y - c0 - c1 * u - c2 * u * u) ** 2;
      }, 0) / pts.length,
    );
    const cand = { delta: Math.atan(c1 / w) * DEG, span, cover, res };
    if (!meilleur || span * cover > meilleur.span * meilleur.cover) meilleur = cand;
  }
  return meilleur;
}
/** Stabilité : retirer tour à tour les plus longues verticales, et regarder bouger l'angle. */
function stabilite(segs: Segment[], w: number, h: number) {
  const S = segs.filter((s) => s.famille === 2).sort((a, b) => b.len - a.len);
  if (S.length < 3) return Infinity;
  const base = verticales(S, w, h)?.delta;
  if (base === undefined) return Infinity;
  let ecart = 0;
  for (let i = 0; i < Math.min(12, S.length); i++) {
    const d = verticales(S.filter((_, j) => j !== i), w, h)?.delta;
    if (d !== undefined) ecart = Math.max(ecart, Math.abs(d - base));
  }
  return ecart;
}
export type Niveau = {
  tier: "auto" | "suggest" | "level" | "abstain";
  angle: number | null;
  reason: string;
};
/**
 * La décision, par paliers : appliquer, proposer, déjà droit, ou s'abstenir.
 *
 * Une erreur de redressement coûte plus cher qu'une absence de correction :
 * sans lignes fiables, on s'abstient, et au-delà de 10° l'inclinaison est
 * tenue pour voulue (une danse, un plan de biais).
 */
export function decider(V: Verticales | null, Hz: Horizon | null, jV: number): Niveau {
  const vFort = !!V && V.n >= 3 && V.support >= 1 && V.rms <= 0.35 && V.dist >= 1.5 && jV <= 0.25;
  const vFaible = !!V && V.n >= 2 && V.support >= 0.5 && V.dist >= 1 && jV <= 0.6;
  const hFort = !!Hz && Hz.span >= 0.7 && Hz.cover >= 0.3 && Hz.res <= 1.5;
  const hFaible = !!Hz && Hz.span >= 0.5 && Hz.cover >= 0.2 && Hz.res <= 2.5;
  const accord = !!V && !!Hz && Math.abs(V.delta - Hz.delta) <= 0.75;
  let angle: number | null = null,
    tier: Niveau["tier"] = "abstain",
    reason = "pas assez de lignes fiables",
    horizonSeul = false;
  if (vFort && hFort) {
    if (accord) {
      angle = (V!.delta * V!.support + Hz!.delta * 2 * Hz!.span) / (V!.support + 2 * Hz!.span);
      tier = "auto";
      reason = "verticales et horizon d'accord";
    } else {
      angle = Hz!.delta;
      tier = "suggest";
      reason = "verticales et horizon en désaccord";
    }
  } else if (vFort) {
    angle = V!.delta;
    tier = hFaible && !accord ? "suggest" : "auto";
    reason = "verticales";
  } else if (hFort) {
    angle = Hz!.delta;
    tier = vFaible && !accord ? "suggest" : "auto";
    reason = "horizon";
    horizonSeul = true;
  } else if (vFaible && hFaible && accord) {
    angle = (V!.delta + Hz!.delta) / 2;
    tier = "auto";
    reason = "deux indices faibles d'accord";
  } else if (hFaible) {
    angle = Hz!.delta;
    tier = "suggest";
    reason = "horizon partiel";
  } else if (vFaible) {
    angle = V!.delta;
    tier = "suggest";
    reason = "verticales faibles";
  }
  if (angle === null) return { tier, angle, reason };
  const a = Math.abs(angle);
  if (a > 10) return { tier: "abstain", angle: null, reason: "inclinaison de plus de 10°, sans doute voulue" };
  if (a > 5) return { tier: "suggest", angle, reason: reason + ", au-delà de 5°" };
  // Vérifié à l'œil sur le prototype : 3 « horizons » sur 20 étaient des
  // bords d'auvent ou de toit, lus entre 2,9 et 3,7°.
  if (tier === "auto" && horizonSeul && a > 2)
    return { tier: "suggest", angle, reason: "horizon seul, au-delà de 2°" };
  if (a < 0.15) return { tier: "level", angle: 0, reason: "déjà droite" };
  return { tier, angle, reason };
}
/**
 * Le redressement à poser d'après une mesure enregistrée, ou `undefined`
 * quand ce palier n'est pas retenu. « Déjà droite » rend 0.
 *
 * La passe d'album n'accepte que le palier sûr ; une consigne explicite
 * (« redresse la photo ») accepte aussi la proposition.
 */
export function correctionDe(
  l: (Niveau & { version?: string }) | undefined,
  paliers: Niveau["tier"][],
): number | undefined {
  if (!l || l.version !== VERSION_NIVEAU || l.angle === null || !paliers.includes(l.tier))
    return undefined;
  return Math.round(-l.angle * 100) / 100 || 0;
}
/** La mesure complète, sur une luminance de 0 à 255, grand côté vers 1 024 px. */
export function mesurerNiveau(gris: ArrayLike<number>, w: number, h: number): Niveau {
  const segs = segments(gris, w, h);
  return decider(verticales(segs, w, h), horizon(segs, w, h), stabilite(segs, w, h));
}
/**
 * La luminance réduite par moyenne de surface.
 *
 * Pas `resizeRaster` : son échantillonnage sans préfiltre crénelle les lignes,
 * et sur le prototype, 9 photos « à proposer » sur 18 tombaient en abstention.
 */
export function luminanceReduite(
  data: ArrayLike<number>,
  W: number,
  H: number,
  maxCote = 1024,
  seize = false,
) {
  const k = Math.max(1, Math.ceil(Math.max(W, H) / maxCote)),
    w = Math.max(1, Math.floor(W / k)),
    h = Math.max(1, Math.floor(H / k)),
    out = new Float32Array(w * h),
    echelle = (seize ? 1 / 257 : 1) / (k * k);
  // Ligne par ligne, dans l'ordre de la mémoire : sur un aperçu de
  // 30 mégapixels, parcourir bloc par bloc coûte deux fois plus.
  const somme = new Float64Array(w);
  for (let by = 0; by < h; by++) {
    somme.fill(0);
    for (let j = 0; j < k; j++) {
      let o = (by * k + j) * W * 4;
      for (let bx = 0; bx < w; bx++) {
        let s = 0;
        for (let i = 0; i < k; i++, o += 4) s += 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
        somme[bx] += s;
      }
    }
    for (let bx = 0; bx < w; bx++) out[by * w + bx] = somme[bx] * echelle;
  }
  return { gris: out, w, h };
}
