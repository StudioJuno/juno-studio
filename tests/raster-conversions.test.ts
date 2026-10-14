import { it, expect } from "vitest";
import fs from "node:fs";
import { decodeRaster } from "../src/modules/raster";

/**
 * Tous les formats que Juno ne lit pas lui-même (HEIC, PSD, JPEG XL…) passent
 * par FFmpeg, qui écrit un TIFF 16 bits compressé en deflate sous le code
 * 32946. UTIF ne connaissait que le code 8 et rendait une image NOIRE, sans
 * erreur : vignette, analyse, retouche et export (relecture du 29/09/2026).
 * Ce fichier est produit par la commande exacte d'engine.cjs (compositeImage).
 */
it("la conversion FFmpeg d'un HEIC n'est plus décodée en noir", async () => {
  const octets = fs.readFileSync(__dirname + "/fixtures/conversion-ffmpeg-deflate.tif");
  const r = await decodeRaster(new Blob([octets], { type: "image/tiff" }), "photo.heic");
  expect([r.width, r.height, r.bitDepth]).toEqual([48, 32, 16]);
  let somme = 0;
  for (let i = 0; i < r.data.length; i += 4) somme += r.data[i] + r.data[i + 1] + r.data[i + 2];
  // La mire de FFmpeg est colorée : sa moyenne est loin du noir.
  expect(somme / (r.width * r.height * 3)).toBeGreaterThan(65535 * 0.2);
});

it("une compression TIFF inconnue échoue franchement au lieu de rendre du noir", async () => {
  const octets = new Uint8Array(fs.readFileSync(__dirname + "/fixtures/conversion-ffmpeg-deflate.tif"));
  // Réécrire le code de compression (étiquette 259) avec une valeur inconnue.
  const dv = new DataView(octets.buffer);
  const le = octets[0] === 73,
    ifd = dv.getUint32(4, le),
    n = dv.getUint16(ifd, le);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (dv.getUint16(e, le) === 259) dv.setUint16(e + 8, 50000, le);
  }
  await expect(decodeRaster(new Blob([octets], { type: "image/tiff" }), "photo.heic")).rejects.toThrow(
    /Compression TIFF 50000 non prise en charge/,
  );
});
