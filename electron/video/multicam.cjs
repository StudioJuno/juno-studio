const M = require("./model.cjs");
const { randomUUID } = require("node:crypto");
function validateGroup(g, assets) {
  if (!g || !M.id(g.id)) throw Error("Groupe multicaméra invalide");
  M.text(g.name, 200);
  if (!Array.isArray(g.angles) || g.angles.length < 2 || g.angles.length > 10)
    throw Error("Choisissez de 2 à 10 caméras");
  const ids = new Set();
  for (const a of g.angles) {
    if (ids.has(a.assetId) || assets.get(a.assetId)?.kind !== "video")
      throw Error("Angle vidéo inconnu ou répété");
    ids.add(a.assetId);
    M.number(a.offset, -86400, 86400, "Décalage");
  }
  if (!ids.has(g.referenceAssetId)) throw Error("Caméra de référence inconnue");
  if (!Array.isArray(g.switches) || g.switches.length > 20000)
    throw Error("Coupes multicaméra invalides");
  for (const cut of g.switches) {
    M.number(cut.time, 0, 21600, "Point de coupe");
    if (!ids.has(cut.assetId)) throw Error("Angle de coupe inconnu");
  }
  return g;
}
function parseTimecode(tc, fps) {
  const m = /^(\d{2}):(\d{2}):(\d{2})([:;])(\d{2})$/.exec(tc || "");
  if (!m) throw Error("Timecode absent ou illisible");
  const h = +m[1],
    min = +m[2],
    sec = +m[3],
    f = +m[5],
    rate = M.fpsValue(fps),
    nominal = Math.round(rate);
  if (h > 23 || min > 59 || sec > 59 || f >= nominal)
    throw Error("Timecode hors limites");
  let frames = ((h * 60 + min) * 60 + sec) * nominal + f;
  if (m[4] === ";") {
    if (
      Math.abs(rate - 30000 / 1001) > 0.0001 &&
      Math.abs(rate - 60000 / 1001) > 0.0001
    )
      throw Error("Cadence incompatible avec le timecode drop-frame");
    const drop = nominal / 15;
    if (min % 10 && sec === 0 && f < drop)
      throw Error("Numéro d’image sauté dans le timecode");
    const total = h * 60 + min;
    frames -= drop * (total - Math.floor(total / 10));
  }
  return frames / rate;
}
function byTimecode(group, assets) {
  validateGroup(group, assets);
  const ref = assets.get(group.referenceAssetId),
    base = parseTimecode(ref.timecode, ref.fps),
    origin = group.angles.find((a) => a.assetId === ref.id).offset;
  return {
    ...group,
    angles: group.angles.map((a) => {
      const asset = assets.get(a.assetId);
      let delta = parseTimecode(asset.timecode, asset.fps) - base;
      if (delta > 43200) delta -= 86400;
      if (delta < -43200) delta += 86400;
      return { ...a, offset: origin + delta, sync: "timecode" };
    }),
  };
}
function buildSequence(group, assets, settings) {
  validateGroup(group, assets);
  const s = M.sequence(group.name + " · Montage");
  Object.assign(s, {
    fps: settings.fps,
    width: settings.width,
    height: settings.height,
  });
  const end = Math.min(
    21600,
    Math.max(
      ...group.angles.map((a) => a.offset + assets.get(a.assetId).duration),
    ),
  );
  const points = [...group.switches].sort((a, b) => a.time - b.time);
  if (!points.length || points[0].time > 0) {
    const initial =
      group.angles.find(
        (a) => a.offset <= 0 && a.offset + assets.get(a.assetId).duration > 0,
      ) || group.angles.reduce((a, b) => (a.offset < b.offset ? a : b));
    points.unshift({
      time: Math.max(0, initial.offset),
      assetId: initial.assetId,
    });
  }
  for (let i = 0; i < points.length; i++) {
    const cut = points[i],
      angle = group.angles.find((a) => a.assetId === cut.assetId),
      asset = assets.get(cut.assetId);
    const start = M.frameAt(Math.max(cut.time, angle.offset, 0), s.fps),
      finish = M.frameAt(
        Math.min(
          points[i + 1]?.time ?? end,
          angle.offset + asset.duration,
          end,
        ),
        s.fps,
      );
    if (finish <= start) continue;
    const c = M.clip(asset, s, start);
    Object.assign(c, {
      duration: finish - start,
      inUs: Math.max(
        0,
        Math.round((M.seconds(start, s.fps) - angle.offset) * 1e6),
      ),
      muted: true,
    });
    s.clips.push(c);
  }
  const ref = group.angles.find((a) => a.assetId === group.referenceAssetId),
    audio = assets.get(ref.assetId);
  if (audio.audioChannels) {
    const start = M.frameAt(Math.max(0, ref.offset), s.fps),
      finish = M.frameAt(Math.min(end, ref.offset + audio.duration), s.fps);
    if (finish > start) {
      const c = M.clip(audio, s, start, 10);
      Object.assign(c, {
        duration: finish - start,
        inUs: Math.max(
          0,
          Math.round((M.seconds(start, s.fps) - ref.offset) * 1e6),
        ),
      });
      s.clips.push(c);
    }
  }
  M.validateSequence(s, assets);
  return { ...s, version: 1, multicamId: group.id };
}
// Iterative radix-2 FFT, used on bounded 100 Hz audio envelopes, never full PCM files.
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const a = ((inverse ? 2 : -2) * Math.PI) / len,
      wr0 = Math.cos(a),
      wi0 = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let wr = 1,
        wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = i + j,
          v = u + len / 2,
          tr = re[v] * wr - im[v] * wi,
          ti = re[v] * wi + im[v] * wr;
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
        const next = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}
function prefix(a) {
  const sum = new Float64Array(a.length + 1),
    sq = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) {
    sum[i + 1] = sum[i] + a[i];
    sq[i + 1] = sq[i] + a[i] * a[i];
  }
  return { sum, sq };
}
function align(reference, other, hz = 100) {
  if (reference.length < 200 || other.length < 200)
    throw Error("Deux secondes de son au minimum sont nécessaires");
  let n = 1;
  while (n < reference.length + other.length) n *= 2;
  const xr = new Float64Array(n),
    xi = new Float64Array(n),
    yr = new Float64Array(n),
    yi = new Float64Array(n);
  xr.set(reference);
  yr.set(other);
  fft(xr, xi);
  fft(yr, yi);
  for (let i = 0; i < n; i++) {
    const r = xr[i] * yr[i] + xi[i] * yi[i],
      im = xi[i] * yr[i] - xr[i] * yi[i];
    xr[i] = r;
    xi[i] = im;
  }
  fft(xr, xi, true);
  const px = prefix(reference),
    py = prefix(other),
    minOverlap = Math.min(
      1000,
      Math.floor(Math.min(reference.length, other.length) * 0.6),
    ),
    scores = [];
  for (
    let lag = -(other.length - minOverlap);
    lag <= reference.length - minOverlap;
    lag++
  ) {
    const xs = Math.max(0, lag),
      ys = Math.max(0, -lag),
      count = Math.min(reference.length - xs, other.length - ys),
      sx = px.sum[xs + count] - px.sum[xs],
      sy = py.sum[ys + count] - py.sum[ys],
      vx = px.sq[xs + count] - px.sq[xs] - (sx * sx) / count,
      vy = py.sq[ys + count] - py.sq[ys] - (sy * sy) / count;
    if (vx < 1e-8 || vy < 1e-8) continue;
    const cross = xr[lag >= 0 ? lag : n + lag] - (sx * sy) / count;
    const score = cross / Math.sqrt(vx * vy);
    scores.push({ lag, score, overlap: count / hz });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best)
    return {
      offset: 0,
      confidence: 0,
      reliable: false,
      reason: "Son trop uniforme ou silencieux",
    };
  const second = scores.find((s) => Math.abs(s.lag - best.lag) > hz / 2),
    margin = best.score - (second?.score || 0);
  return {
    offset: best.lag / hz,
    confidence: Math.max(0, Math.min(1, best.score)),
    margin,
    overlap: best.overlap,
    reliable: best.score >= 0.55 && margin >= 0.06,
  };
}
module.exports = {
  validateGroup,
  parseTimecode,
  byTimecode,
  buildSequence,
  align,
  fft,
};
