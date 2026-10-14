/**
 * Les instants où commencent les images d'un fichier MP4 ou MOV, lus dans son
 * index (la boîte « moov ») sans rien décoder.
 *
 * Le moniteur s'en sert pour se poser au milieu de l'image que l'export
 * montre, au lieu d'un instant tout près de son début : Chromium ne tranche
 * qu'à une microseconde près autour du début d'une image, et selon la base de
 * temps du fichier, une image qui commence à la microseconde où l'export
 * tranche passait au moniteur d'un côté et au film de l'autre (29/09/2026).
 *
 * Les instants sont en microsecondes, arrondis comme FFmpeg et Chromium les
 * arrondissent, croissants. `null` quand le fichier n'a pas d'index lisible
 * (autre conteneur, liste de montage à plusieurs segments) : le moniteur se
 * rabat alors sur l'instant voulu plus la marge (edit.ts, `monitorTime`).
 */
type Box = { type: string; start: number; end: number };
function boxes(view: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at),
      header = 8;
    const type = String.fromCharCode(
      view.getUint8(at + 4),
      view.getUint8(at + 5),
      view.getUint8(at + 6),
      view.getUint8(at + 7),
    );
    if (size === 1) {
      if (at + 16 > end) break;
      size = Number(view.getBigUint64(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}
const child = (view: DataView, box: Box | undefined, type: string) =>
  box && boxes(view, box.start, box.end).find((b) => b.type === type);
/** L'échelle de temps d'une boîte mvhd ou mdhd. */
const timescale = (view: DataView, box: Box) =>
  view.getUint32(box.start + (view.getUint8(box.start) === 1 ? 20 : 12));
/** Les instants des images de la piste vidéo, d'après la boîte moov. */
export function moovTimes(view: DataView, moov: Box): number[] | null {
  const mvhd = child(view, moov, "mvhd");
  for (const trak of boxes(view, moov.start, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia = child(view, trak, "mdia"),
      hdlr = child(view, mdia, "hdlr"),
      mdhd = child(view, mdia, "mdhd");
    if (!hdlr || !mdhd || hdlr.end - hdlr.start < 12) continue;
    if (view.getUint32(hdlr.start + 8) !== 0x76696465) continue; // « vide »
    const scale = timescale(view, mdhd),
      stbl = child(view, child(view, mdia, "minf"), "stbl"),
      stts = child(view, stbl, "stts"),
      ctts = child(view, stbl, "ctts");
    if (!scale || !stts) return null;
    // Décodage : les durées des images, par séries.
    const decode: number[] = [];
    let t = 0;
    for (let i = 0, n = view.getUint32(stts.start + 4); i < n; i++) {
      const count = view.getUint32(stts.start + 8 + i * 8),
        delta = view.getUint32(stts.start + 12 + i * 8);
      if (decode.length + count > 2_000_000) return null;
      for (let k = 0; k < count; k++, t += delta) decode.push(t);
    }
    // Présentation : le décalage des images réordonnées, s'il y en a.
    if (ctts) {
      let k = 0;
      for (let i = 0, n = view.getUint32(ctts.start + 4); i < n; i++) {
        const count = view.getUint32(ctts.start + 8 + i * 8),
          offset = view.getInt32(ctts.start + 12 + i * 8);
        for (let j = 0; j < count && k < decode.length; j++) decode[k++] += offset;
      }
    }
    // Liste de montage : un début à vide, puis un seul segment lu.
    let shift = 0;
    const elst = child(view, child(view, trak, "edts"), "elst");
    if (elst) {
      const v1 = view.getUint8(elst.start) === 1,
        size = v1 ? 20 : 12,
        movie = mvhd ? timescale(view, mvhd) : scale;
      let played = 0;
      for (let i = 0, n = view.getUint32(elst.start + 4); i < n; i++) {
        const at = elst.start + 8 + i * size,
          duration = v1
            ? Number(view.getBigUint64(at))
            : view.getUint32(at),
          media = v1 ? Number(view.getBigInt64(at + 8)) : view.getInt32(at + 4);
        if (media === -1) {
          if (played) return null;
          shift += (duration * scale) / (movie || scale);
        } else if (played++) return null;
        else shift -= media;
      }
    }
    const times = decode
      .map((x) => x + shift)
      .filter((x) => x >= 0)
      .sort((a, b) => a - b)
      .map((x) => Math.round((x * 1e6) / scale));
    return times.length ? times : null;
  }
  return null;
}
/** Les instants des images d'un fichier entier déjà en mémoire. */
export function fileTimes(bytes: Uint8Array): number[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    moov = boxes(view, 0, bytes.byteLength).find((b) => b.type === "moov");
  return moov ? moovTimes(view, moov) : null;
}
/** Une portion du fichier, ou rien si le serveur ne sait pas la découper. */
async function slice(url: string, start: number, length: number) {
  const r = await fetch(url, {
    headers: { Range: `bytes=${start}-${start + length - 1}` },
  });
  if (r.status !== 206) {
    await r.body?.cancel().catch(() => {});
    return null;
  }
  return new Uint8Array(await r.arrayBuffer());
}
/** Cherche la boîte moov de boîte en boîte, puis la lit seule. */
async function load(url: string): Promise<number[] | null> {
  let at = 0;
  for (let i = 0; i < 64; i++) {
    const head = await slice(url, at, 16);
    if (!head || head.byteLength < 8) return null;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let size = view.getUint32(0);
    const type = String.fromCharCode(...head.subarray(4, 8));
    if (size === 1) {
      if (head.byteLength < 16) return null;
      size = Number(view.getBigUint64(8));
    }
    if (size < 8) return null;
    if (type === "moov") {
      if (size > 64 * 1024 * 1024) return null;
      const moov = await slice(url, at, size);
      if (!moov || moov.byteLength !== size) return null;
      const whole = new DataView(moov.buffer, moov.byteOffset, moov.byteLength),
        [box] = boxes(whole, 0, moov.byteLength);
      return box ? moovTimes(whole, box) : null;
    }
    at += size;
  }
  return null;
}
const cache = new Map<string, Promise<number[] | null>>();
/**
 * Les instants des images du fichier que lit un élément vidéo (un aperçu
 * `juno-video://`, découpé à la demande), gardés pour les derniers fichiers.
 */
export function frameTimes(url: string): Promise<number[] | null> {
  let times = cache.get(url);
  if (!times) {
    times = load(url).catch(() => null);
    cache.set(url, times);
    while (cache.size > 32) cache.delete(cache.keys().next().value!);
  }
  return times;
}
