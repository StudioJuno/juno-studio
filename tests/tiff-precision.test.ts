import { it, expect } from "vitest";
import { decodeRaster } from "../src/modules/raster";

function grayTiff(whiteZero: boolean, bits = 16, format = 1) {
  const tags = [
    [256, 4, 2],
    [257, 4, 1],
    [258, 3, bits],
    [259, 3, 1],
    [262, 3, whiteZero ? 0 : 1],
    [273, 4, 146],
    [277, 3, 1],
    [278, 4, 1],
    [279, 4, 4],
    [284, 3, 1],
    [339, 3, format],
  ];
  const buffer = new ArrayBuffer(150),
    v = new DataView(buffer);
  v.setUint16(0, 0x4949, true);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, value], i) => {
    const off = 10 + 12 * i;
    v.setUint16(off, tag, true);
    v.setUint16(off + 2, type, true);
    v.setUint32(off + 4, 1, true);
    v.setUint32(off + 8, value, true);
  });
  v.setUint16(146, 12345, true);
  v.setUint16(148, 54321, true);
  return new Blob([buffer], { type: "image/tiff" });
}
it("retains all grayscale TIFF sample bits and handles white-is-zero", async () => {
  for (const whiteZero of [false, true]) {
    const r = await decodeRaster(grayTiff(whiteZero), "precision.tif");
    expect(r.bitDepth).toBe(16);
    expect(r.data).toBeInstanceOf(Uint16Array);
    expect(Array.from(r.data)).toEqual(
      [12345, 12345, 12345, 65535, 54321, 54321, 54321, 65535].map((v, i) =>
        whiteZero && i % 4 !== 3 ? 65535 - v : v,
      ),
    );
  }
});
it("diagnoses floating point TIFFs instead of silently reducing their precision", async () => {
  await expect(
    decodeRaster(grayTiff(false, 32, 3), "hdr.tiff"),
  ).rejects.toThrow("32 bits");
});
