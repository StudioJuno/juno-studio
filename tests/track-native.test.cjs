const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  TRACK = require("../electron/video/track.cjs");
test("path simplification keeps the shape and respects the key budget", () => {
  const line = Array.from({ length: 200 }, (_, i) => ({
    frame: i,
    x: 0.1 + (i / 199) * 0.8,
    y: 0.5,
  }));
  // A straight run collapses to its two ends.
  assert.equal(TRACK.simplify(line, 0.0015, 240).length, 2);
  const zigzag = Array.from({ length: 200 }, (_, i) => ({
    frame: i,
    x: 0.5 + (i % 2 ? 0.05 : -0.05),
    y: 0.5,
  }));
  const reduced = TRACK.simplify(zigzag, 0.0015, 40);
  assert(reduced.length <= 40, "budget dépassé : " + reduced.length);
  assert.equal(reduced[0].frame, 0);
  assert.equal(reduced.at(-1).frame, 199);
  assert.deepEqual(
    TRACK.simplify([{ frame: 0, x: 0.5, y: 0.5 }], 0.001, 10).length,
    1,
  );
});
test("correlation prefers the exact patch and rejects an out-of-frame search", () => {
  const w = 8,
    h = 8,
    frame = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) frame[y * w + x] = x < 4 ? 0 : 255;
  const template = new Float32Array(4);
  template[0] = 0;
  template[1] = 255;
  template[2] = 0;
  template[3] = 255;
  const good = TRACK.correlate(frame, template, w, h, 2, 2, 3, 2);
  assert(good > 0.9, "corrélation attendue au bon endroit : " + good);
  assert.equal(TRACK.correlate(frame, template, w, h, 2, 2, -5, 2), -1);
  assert.equal(TRACK.correlate(frame, template, w, h, 2, 2, 7, 2), -1);
});
test(
  "tracking follows a real moving subject and reports its confidence",
  { timeout: 180000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-track-")),
      engine = new Engine({
        nativeRoot: path.resolve(
          "native",
          process.platform + "-" + process.arch,
        ),
        colorRoot: path.resolve("public/video-color"),
      });
    try {
      await engine.init();
      // A textured square crossing a textured background, left to right.
      const source = path.join(root, "move.mkv");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=640x360:r=25:d=2",
        "-f",
        "lavfi",
        "-i",
        "testsrc=s=80x80:r=25:d=2",
        "-filter_complex",
        "[0:v][1:v]overlay=x='60+(W-w-120)*t/2':y='(H-h)/2',format=yuv444p10le[v]",
        "-map",
        "[v]",
        "-c:v",
        "ffv1",
        source,
      ]);
      const s = M.sequence();
      s.width = 640;
      s.height = 360;
      s.fps = { n: 25, d: 1 };
      const clip = {
        id: "c",
        assetId: "a",
        start: 0,
        duration: 50,
        inUs: 0,
        speed: 1,
      };
      const mask = {
        id: "m",
        width: 0.14,
        height: 0.25,
        keys: [{ frame: 0, x: 100 / 640, y: 0.5 }],
      };
      const result = await TRACK.trackMask({
        engine,
        source,
        clip,
        mask,
        sequence: s,
      });
      assert(result.keys.length >= 2, "aucun repère produit");
      assert(
        result.keys.length <= 240,
        "trop de repères : " + result.keys.length,
      );
      const first = result.keys[0],
        last = result.keys.at(-1);
      // The square starts near x=100 px and ends near x=540 px of 640.
      assert(Math.abs(first.x - 100 / 640) < 0.05, "départ faux : " + first.x);
      assert(
        last.x - first.x > 0.55,
        "le suivi n’a pas suivi : " + JSON.stringify({ first, last }),
      );
      assert(Math.abs(last.y - 0.5) < 0.08, "dérive verticale : " + last.y);
      assert(
        result.confidence > 0.6,
        "confiance faible : " + result.confidence,
      );
      console.log(
        "Track",
        JSON.stringify({
          keys: result.keys.length,
          frames: result.frames,
          confidence: result.confidence,
          first: Number(first.x.toFixed(3)),
          last: Number(last.x.toFixed(3)),
        }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
