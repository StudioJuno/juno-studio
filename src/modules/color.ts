import type { Raster } from "./raster";
let base = "",
  modulePromise: Promise<any> | undefined,
  profilePromise: Promise<Uint8Array> | undefined;
export function setColorBase(value: string) {
  base = value;
}
export const colorBase = () =>
  base ||
  (typeof document !== "undefined"
    ? document.baseURI
    : new URL("../", import.meta.url).href);
async function engine() {
  return (modulePromise ??= (async () => {
    const root = new URL("vendor/lcms/", colorBase()).href;
    const api = await import(/* @vite-ignore */ root + "lcms.min.js");
    return {
      api,
      lcms: await api.instantiate({ locateFile: () => root + "lcms.wasm" }),
    };
  })());
}
export async function srgbProfile() {
  return (profilePromise ??= fetch(new URL("color/sRGB.icc", colorBase())).then(
    async (r) => {
      if (!r.ok) throw Error("Profil sRGB introuvable.");
      return new Uint8Array(await r.arrayBuffer());
    },
  ));
}
export async function convertIcc(r: Raster, bytes: Uint8Array) {
  if (
    bytes.length < 128 ||
    bytes.length > 4 * 1024 * 1024 ||
    new TextDecoder().decode(bytes.slice(36, 40)) !== "acsp"
  )
    throw Error("Profil ICC invalide.");
  const { api, lcms } = await engine();
  const input = lcms.cmsOpenProfileFromMem(bytes, bytes.length);
  if (!input) throw Error("Profil ICC illisible.");
  let output = 0,
    transform = 0;
  try {
    if (lcms.cmsGetColorSpaceASCII(input) !== "RGB")
      throw Error(
        "Ce profil ICC n’est pas RGB. Convertissez ce TIFF en RGB avant l’import.",
      );
    const name = lcms.cmsGetProfileInfoASCII(
      input,
      api.cmsInfoDescription,
      "en",
      "US",
    );
    output = lcms.cmsCreate_sRGBProfile();
    const format = r.bitDepth === 16 ? api.TYPE_RGBA_16 : api.TYPE_RGBA_8;
    transform = lcms.cmsCreateTransform(
      input,
      format,
      output,
      format,
      api.INTENT_RELATIVE_COLORIMETRIC,
      api.cmsFLAGS_BLACKPOINTCOMPENSATION |
        api.cmsFLAGS_COPY_ALPHA |
        api.cmsFLAGS_NOOPTIMIZE,
    );
    if (!transform) throw Error("Conversion ICC indisponible.");
    for (let offset = 0; offset < r.data.length; offset += 65536 * 4) {
      const data = r.data.subarray(
        offset,
        Math.min(r.data.length, offset + 65536 * 4),
      );
      r.data.set(lcms.cmsDoTransform(transform, data, data.length / 4), offset);
    }
    r.color = {
      space: "sRGB",
      source: "embedded",
      profile: name || "Profil ICC RGB",
    };
  } finally {
    if (transform) lcms.cmsDeleteTransform(transform);
    if (output) lcms.cmsCloseProfile(output);
    lcms.cmsCloseProfile(input);
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  for (let j = 0; j < 8; j++) i = i & 1 ? 0xedb88320 ^ (i >>> 1) : i >>> 1;
  return i >>> 0;
});
function crc(bytes: Uint8Array) {
  let n = 0xffffffff;
  for (const b of bytes) n = crcTable[(n ^ b) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
export async function tagSrgb(blob: Blob): Promise<Blob> {
  if (blob.type === "image/jpeg") {
    const profile = await srgbProfile(),
      segment = new Uint8Array(profile.length + 18),
      view = new DataView(segment.buffer);
    segment.set([255, 226]);
    view.setUint16(2, profile.length + 16);
    segment.set(new TextEncoder().encode("ICC_PROFILE\0"), 4);
    segment[16] = 1;
    segment[17] = 1;
    segment.set(profile, 18);
    return new Blob([blob.slice(0, 2), segment, blob.slice(2)], {
      type: blob.type,
    });
  }
  if (blob.type === "image/png") {
    const chunk = new Uint8Array(13),
      view = new DataView(chunk.buffer);
    view.setUint32(0, 1);
    chunk.set(new TextEncoder().encode("sRGB"), 4);
    chunk[8] = 1;
    view.setUint32(9, crc(chunk.subarray(4, 9)));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let offset = 8;
    const parts: BlobPart[] = [bytes.slice(0, 8)];
    let inserted = false;
    while (offset + 12 <= bytes.length) {
      const size = new DataView(bytes.buffer).getUint32(offset),
        end = offset + 12 + size;
      if (end > bytes.length) throw Error("PNG invalide.");
      const type = new TextDecoder().decode(
        bytes.slice(offset + 4, offset + 8),
      );
      if (!["iCCP", "sRGB", "gAMA", "cHRM"].includes(type))
        parts.push(bytes.slice(offset, end));
      if (type === "IHDR") {
        parts.push(chunk);
        inserted = true;
      }
      offset = end;
    }
    if (!inserted) throw Error("PNG invalide.");
    return new Blob(parts, { type: blob.type });
  }
  return blob;
}
