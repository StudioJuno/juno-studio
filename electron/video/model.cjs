const { validateMotion } = require("./motion.cjs");
const { validateDuck } = require("./loudness.cjs");
const CLEANUP = require("./cleanup.cjs");
const TRANSITIONS = require("./transitions.cjs");
const { validateAnimation } = require("./animation.cjs");
const { randomUUID } = require("node:crypto");
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fail = (m) => {
  throw Error(m);
};
const number = (v, a, b, label) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < a || v > b)
    fail(label + " invalide");
  return v;
};
const integer = (v, a, b, label) => {
  number(v, a, b, label);
  if (!Number.isSafeInteger(v)) fail(label + " doit être entier");
  return v;
};
const text = (v, max = 200) => {
  if (typeof v !== "string" || v.length > max) fail("Texte invalide");
  return v;
};
const id = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,90}$/.test(v);
const fpsValue = (f) => f.n / f.d;
const seconds = (frames, fps) => (frames * fps.d) / fps.n;
const frameAt = (time, fps) => Math.round((time * fps.n) / fps.d);
const GRADE = {
  exposure: 0,
  contrast: 1,
  saturation: 1,
  warmth: 0,
  tint: 0,
  fade: 0,
  style: "original",
  intensity: 1,
};
const STYLE = {
  original: {},
  signature: { warmth: 0.045, contrast: 1.04, saturation: 0.92, fade: 0.015 },
  editorial: { contrast: 1.13, saturation: 0.85 },
  golden: { warmth: 0.11, contrast: 1.04, saturation: 1.04, fade: 0.015 },
  film: { contrast: 0.94, saturation: 0.8, warmth: 0.04, fade: 0.03 },
  mono: { saturation: 0, contrast: 1.12 },
};
function grade(g = {}) {
  const o = { ...GRADE, ...g };
  if (o.lutId && !/^[a-f0-9]{64}$/.test(o.lutId)) fail("LUT invalide");
  if (o.lutIntensity !== undefined)
    number(o.lutIntensity, 0, 1, "Intensité LUT");
  number(o.exposure, -5, 5, "Exposition");
  number(o.contrast, 0.2, 2.5, "Contraste");
  number(o.saturation, 0, 2.5, "Saturation");
  number(o.warmth, -0.5, 0.5, "Température");
  number(o.tint, -0.5, 0.5, "Teinte");
  number(o.fade, 0, 0.3, "Noirs");
  number(o.intensity, 0, 1, "Intensité");
  if (!Object.hasOwn(STYLE, o.style)) fail("Style inconnu");
  return o;
}
function sequence(name = "Premier montage") {
  return {
    id: randomUUID(),
    name,
    fps: { n: 25, d: 1 },
    width: 1920,
    height: 1080,
    clips: [],
    titles: [],
    captions: [],
    markers: [],
    masterGain: 1,
    created: Date.now(),
  };
}
function project(name, photoProjectId) {
  return {
    id: randomUUID(),
    name: name || "Nouveau film",
    photoProjectId: photoProjectId || null,
    revision: 1,
    created: Date.now(),
    updated: Date.now(),
    assets: [],
    sequences: [sequence()],
    multicam: [],
    comments: [],
  };
}
function validateSequence(s, assets) {
  if (!s || !id(s.id)) fail("Séquence invalide");
  text(s.name);
  integer(s.fps?.n, 1, 240000, "Cadence");
  integer(s.fps?.d, 1, 10000, "Base de temps");
  number(fpsValue(s.fps), 1, 120, "Cadence");
  integer(s.width, 64, 8192, "Largeur");
  integer(s.height, 64, 8192, "Hauteur");
  if (s.width % 2 || s.height % 2) fail("Dimensions paires requises");
  number(s.masterGain, 0, 2, "Gain général");
  if (s.ducking !== undefined) {
    if (!s.ducking || typeof s.ducking !== "object" || Array.isArray(s.ducking))
      fail("Atténuation automatique invalide");
    if (typeof s.ducking.enabled !== "boolean")
      fail("Atténuation automatique invalide");
    validateDuck(s.ducking);
  }
  if (!Array.isArray(s.clips) || s.clips.length > 20000) fail("Trop de plans");
  if (s.tracks !== undefined) {
    if (
      !s.tracks ||
      typeof s.tracks !== "object" ||
      Array.isArray(s.tracks) ||
      Object.keys(s.tracks).length > 20
    )
      fail("Pistes invalides");
    for (const [key, t] of Object.entries(s.tracks)) {
      if (!/^(?:[0-9]|1[0-9])$/.test(key) || !t || typeof t !== "object")
        fail("Piste invalide");
      if (t.name !== undefined) text(t.name, 80);
      for (const b of ["muted", "solo", "locked", "hidden"])
        if (t[b] !== undefined && typeof t[b] !== "boolean")
          fail("État de piste invalide");
      if (t.gain !== undefined) number(t.gain, 0, 4, "Volume de piste");
      if (
        t.bus !== undefined &&
        !["voice", "music", "ambience", "effect"].includes(t.bus)
      )
        fail("Bus audio invalide");
      if (t.pan !== undefined) number(t.pan, -1, 1, "Panoramique de piste");
    }
  }
  if (s.buses !== undefined) {
    if (
      !s.buses ||
      typeof s.buses !== "object" ||
      Array.isArray(s.buses) ||
      Object.keys(s.buses).length > 4
    )
      fail("Bus audio invalides");
    for (const [key, b] of Object.entries(s.buses)) {
      if (
        !["voice", "music", "ambience", "effect"].includes(key) ||
        !b ||
        typeof b !== "object" ||
        Array.isArray(b)
      )
        fail("Bus audio invalide");
      if (b.gain !== undefined) number(b.gain, 0, 4, "Volume du bus");
      for (const f of ["muted", "solo"])
        if (b[f] !== undefined && typeof b[f] !== "boolean")
          fail("État du bus invalide");
    }
  }
  const ids = new Set();
  for (const c of s.clips) {
    if (!id(c.id) || ids.has(c.id) || !assets.has(c.assetId))
      fail("Média de plan introuvable ou identifiant répété");
    ids.add(c.id);
    integer(c.start, 0, 100000000, "Début");
    integer(c.duration, 1, 100000000, "Durée");
    integer(c.inUs, 0, 1e14, "Point source");
    integer(c.track, 0, 19, "Piste");
    number(c.speed, 0.125, 8, "Vitesse");
    number(c.gain, 0, 4, "Volume");
    number(c.opacity, 0, 1, "Opacité");
    number(c.scale, 0.05, 5, "Échelle");
    number(c.x, -2, 2, "Position X");
    number(c.y, -2, 2, "Position Y");
    number(c.rotation, -360, 360, "Rotation");
    integer(c.fadeIn, 0, c.duration, "Fondu");
    integer(c.fadeOut, 0, c.duration, "Fondu");
    if (typeof c.muted !== "boolean") fail("État audio invalide");
    if (c.component !== undefined && !["video", "audio"].includes(c.component))
      fail("Composant de plan invalide");
    if (c.linkId !== undefined && !id(c.linkId)) fail("Liaison invalide");
    if (c.originalAssetId !== undefined && !assets.has(c.originalAssetId))
      fail("Original audio introuvable");
    if (c.pan !== undefined) number(c.pan, -1, 1, "Panoramique");
    if (
      c.reframe !== undefined &&
      !["tous", "couple", "main"].includes(c.reframe)
    )
      fail("Cadrage vertical invalide");
    if (
      c.audioRole !== undefined &&
      !["voice", "music", "ambience", "effect"].includes(c.audioRole)
    )
      fail("Rôle audio invalide");
    if (
      (c.component === "audio" && c.track < 10) ||
      (c.component === "video" && c.track >= 10)
    )
      fail("Type de piste incompatible");
    grade(c.grade);
    CLEANUP.validate(c);
    TRANSITIONS.validate(c.transition, c.duration);
    validateAnimation(c.animation);
    masks(c.masks, c.duration, assets);
    const a = assets.get(c.assetId);
    if (
      a.kind !== "image" &&
      c.inUs / 1e6 + seconds(c.duration, s.fps) * c.speed > a.duration + 0.15
    )
      fail("Le plan dépasse la durée du média");
  }
  for (const field of ["titles", "captions", "markers"])
    if (!Array.isArray(s[field]) || s[field].length > 20000)
      fail("Éléments temporels invalides");
  for (const t of s.titles) {
    if (!id(t.id)) fail("Titre invalide");
    text(t.text, 2000);
    integer(t.start, 0, 1e8, "Début titre");
    integer(t.duration, 1, 1e8, "Durée titre");
    titleStyle(t, s.height);
  }
  for (const t of s.captions) {
    if (!id(t.id)) fail("Sous-titre invalide");
    text(t.text, 2000);
    integer(t.start, 0, 1e8, "Début sous-titre");
    integer(t.duration, 1, 1e8, "Durée sous-titre");
    if (t.words !== undefined) {
      if (!Array.isArray(t.words) || t.words.length > 200)
        fail("Repères des mots invalides");
      let end = 0,
        charEnd = 0;
      for (const w of t.words) {
        if (w.confidence !== undefined)
          number(w.confidence, 0, 1, "Confiance du mot");
        integer(w.start, end, t.duration - 1, "Début du mot");
        integer(w.end, w.start + 1, t.duration, "Fin du mot");
        integer(w.from, charEnd, t.text.length - 1, "Début du texte");
        integer(w.to, w.from + 1, t.text.length, "Fin du texte");
        end = w.end;
        charEnd = w.to;
      }
    }

    if (t.style !== undefined)
      titleStyle({ size: 48, y: 0.87, color: "#ffffff", ...t.style }, s.height);
  }
  if (s.captionStyle !== undefined) {
    if (
      !s.captionStyle ||
      typeof s.captionStyle !== "object" ||
      Array.isArray(s.captionStyle)
    )
      fail("Style sous-titres invalide");
    titleStyle(
      { size: 48, y: 0.87, color: "#ffffff", ...s.captionStyle },
      s.height,
    );
  }
  for (const m of s.markers) {
    if (!id(m.id)) fail("Marqueur invalide");
    integer(m.frame, 0, 1e8, "Position marqueur");
    text(m.text, 1000);
  }
  return s;
}
const MASK_LIMIT = 6,
  MASK_KEY_LIMIT = 2000;
function masks(list, duration, assets) {
  if (list === undefined) return;
  if (!Array.isArray(list) || list.length > MASK_LIMIT)
    fail("Masques invalides");
  const seen = new Set();
  for (const m of list) {
    if (!m || typeof m !== "object" || !id(m.id) || seen.has(m.id))
      fail("Masque invalide");
    seen.add(m.id);
    if (m.name !== undefined) text(m.name, 80);
    if (!["blur", "pixelate", "solid"].includes(m.effect))
      fail("Effet de masque invalide");
    if (!["rectangle", "ellipse"].includes(m.shape))
      fail("Forme de masque invalide");
    number(m.width, 0.01, 1, "Largeur du masque");
    number(m.height, 0.01, 1, "Hauteur du masque");
    number(m.strength, 0, 1, "Intensité du masque");
    number(m.feather, 0, 0.5, "Contour du masque");
    if (m.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(m.color))
      fail("Couleur du masque invalide");
    if (
      !Array.isArray(m.keys) ||
      !m.keys.length ||
      m.keys.length > MASK_KEY_LIMIT
    )
      fail("Repères du masque invalides");
    let last = -1;
    for (const k of m.keys) {
      if (!k || typeof k !== "object") fail("Repère de masque invalide");
      integer(k.frame, 0, Math.max(0, duration - 1), "Repère du masque");
      if (k.frame <= last) fail("Repères du masque désordonnés");
      last = k.frame;
      number(k.x, -1, 2, "Position X du masque");
      number(k.y, -1, 2, "Position Y du masque");
    }
    if (m.tracked !== undefined) {
      if (!m.tracked || typeof m.tracked !== "object")
        fail("Suivi de masque invalide");
      if (assets && !assets.has(m.tracked.asset))
        fail("Média suivi introuvable");
      integer(m.tracked.from, 0, 1e8, "Début du suivi");
      integer(m.tracked.to, m.tracked.from, 1e8, "Fin du suivi");
    }
  }
}
/** Text size follows the delivery format: a fixed 240 px cap starves 4K and 6K. */
function titleSizeLimit(height) {
  return Math.max(240, Math.round(Math.min(8192, Math.max(1, height)) / 2));
}
function titleStyle(t, height = 1080) {
  if (
    t.wordMode !== undefined &&
    !["none", "highlight", "single"].includes(t.wordMode)
  )
    fail("Mode mot à mot invalide");
  if (
    t.highlightColor !== undefined &&
    !/^#[0-9a-fA-F]{6}$/.test(t.highlightColor)
  )
    fail("Couleur du mot invalide");

  if (
    t.effect !== undefined &&
    !["none", "fade", "rise", "pop", "slide"].includes(t.effect)
  )
    fail("Effet de sous-titre invalide");
  validateMotion(t.motion);
  if (t.depth !== undefined) {
    const d = t.depth;
    if (!d || typeof d !== "object" || Array.isArray(d))
      fail("Relief invalide");
    number(d.extrude, 0, 1, "Profondeur du relief");
    number(d.angle, -180, 180, "Angle du relief");
    number(d.light, 0, 1, "Lumière du relief");
    if (d.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(d.color))
      fail("Couleur du relief invalide");
  }
  if (t.graphic !== undefined) {
    const g = t.graphic;
    if (!g || !["rectangle", "circle", "arrow", "bar"].includes(g.kind))
      fail("Forme graphique invalide");
    number(g.width, 0.01, 1, "Largeur graphique");
    number(g.height, 0.01, 1, "Hauteur graphique");
    if (!/^#[0-9a-fA-F]{6}$/.test(g.fill)) fail("Couleur graphique invalide");
    if (g.value !== undefined) number(g.value, 0, 1, "Valeur graphique");
  }

  number(t.size, 12, titleSizeLimit(height), "Taille titre");
  number(t.y, 0, 1, "Position titre");
  for (const [key, min, max] of [
    ["x", 0, 1],
    ["width", 0.1, 1],
    ["fontWeight", 400, 700],
    ["lineHeight", 0.8, 3],
    ["strokeWidth", 0, 24],
    ["backgroundOpacity", 0, 1],
    ["padding", 0, 200],
    ["rotation", -180, 180],
    ["opacity", 0, 1],
  ])
    if (t[key] !== undefined) number(t[key], min, max, "Titre : " + key);
  for (const key of ["strokeColor", "backgroundColor"])
    if (t[key] !== undefined && !/^#[0-9a-fA-F]{6}$/.test(t[key]))
      fail("Couleur titre invalide");
  for (const key of ["italic", "shadow", "uppercase"])
    if (t[key] !== undefined && typeof t[key] !== "boolean")
      fail("Style titre invalide");
  if (
    t.fontFamily !== undefined &&
    !["Arial", "Inter", "Georgia", "monospace"].includes(t.fontFamily)
  )
    fail("Police titre invalide");
  if (t.align !== undefined && !["left", "center", "right"].includes(t.align))
    fail("Alignement titre invalide");
  if (!/^#[0-9a-fA-F]{6}$/.test(t.color)) fail("Couleur titre invalide");
}
function duration(s) {
  return Math.max(
    0,
    ...s.clips.map((c) => c.start + c.duration),
    ...s.titles.map((t) => t.start + t.duration),
    ...s.captions.map((t) => t.start + t.duration),
  );
}
function clip(asset, s, start, track = 0) {
  return {
    id: randomUUID(),
    assetId: asset.id,
    start,
    duration: Math.max(
      1,
      frameAt(asset.kind === "image" ? 5 : asset.duration, s.fps),
    ),
    inUs: 0,
    track,
    speed: 1,
    gain: 1,
    muted: false,
    opacity: 1,
    scale: 1,
    x: 0,
    y: 0,
    rotation: 0,
    fadeIn: 0,
    fadeOut: 0,
    grade: { ...GRADE },
  };
}
function effectiveGrade(g) {
  const out = grade(g),
    s = STYLE[g.style] || {},
    k = g.intensity ?? 1;
  for (const [key, value] of Object.entries(s)) {
    if (["contrast", "saturation"].includes(key))
      out[key] *= 1 + (value - 1) * k;
    else out[key] += value * k;
  }
  return out;
}
function mapRGB(rgb, g) {
  const e = effectiveGrade(g),
    v = rgb.map((x) => Math.pow(Math.max(0, x), 2.4) * Math.pow(2, e.exposure));
  v[0] *= 1 + e.warmth;
  v[2] *= 1 - e.warmth;
  v[1] *= 1 - e.tint;
  const enc = v.map((x) => Math.pow(Math.max(0, x), 1 / 2.4));
  const l = 0.2126 * enc[0] + 0.7152 * enc[1] + 0.0722 * enc[2];
  return enc
    .map((x) =>
      clamp((l + (x - l) * e.saturation - 0.5) * e.contrast + 0.5, 0, 1),
    )
    .map((x) => e.fade + (1 - e.fade) * x);
}
module.exports = {
  masks,
  clamp,
  id,
  number,
  integer,
  text,
  grade,
  GRADE,
  STYLE,
  project,
  sequence,
  validateSequence,
  fpsValue,
  seconds,
  frameAt,
  duration,
  clip,
  effectiveGrade,
  mapRGB,
};
