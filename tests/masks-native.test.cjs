const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs"),
  MASKS = require("../electron/video/masks.cjs");
test("mask geometry stays even, bounded and follows the scaled clip", () => {
  assert.deepEqual(MASKS.geometry({ width: 0.25, height: 0.5 }, 1920, 1080), {
    width: 480,
    height: 540,
  });
  assert.deepEqual(MASKS.geometry({ width: 0.001, height: 2 }, 320, 180), {
    width: 8,
    height: 180,
  });
  const a = MASKS.amount({ width: 0.25, height: 0.5, strength: 1 }, 1920, 1080);
  assert(a.sigma > 0);
  assert(a.block >= 2 && a.block <= 1024);
  assert(
    MASKS.amount({ width: 0.25, height: 0.5, strength: 0 }, 1920, 1080).sigma <
      a.sigma,
  );
});
test("an export refuses a mask whose shape was never rendered", () => {
  const clip = {
    masks: [{ id: "m", keys: [{ frame: 0, x: 0.5, y: 0.5 }] }],
  };
  assert.throws(() => MASKS.require_(clip, {}), /Forme de masque absente/);
  assert.equal(MASKS.require_(clip, { m: "/tmp/a.png" }).length, 1);
  assert.equal(MASKS.require_({}, {}).length, 0);
});
test("masks reject impossible shapes, strengths and out-of-clip keys", () => {
  const s = M.sequence();
  const ok = (masks) => M.masks(masks, 50, new Map());
  assert.doesNotThrow(() =>
    ok([
      {
        id: "m1",
        effect: "blur",
        shape: "ellipse",
        width: 0.2,
        height: 0.2,
        strength: 0.5,
        feather: 0.2,
        keys: [
          { frame: 0, x: 0.5, y: 0.5 },
          { frame: 30, x: 0.6, y: 0.4 },
        ],
      },
    ]),
  );
  assert.throws(() => ok([{ id: "m1", effect: "glow" }]), /Effet de masque/);
  assert.throws(
    () =>
      ok([
        {
          id: "m1",
          effect: "blur",
          shape: "ellipse",
          width: 0.2,
          height: 0.2,
          strength: 0.5,
          feather: 0.2,
          keys: [{ frame: 80, x: 0.5, y: 0.5 }],
        },
      ]),
    /Repère du masque/,
  );
  assert.throws(
    () =>
      ok([
        {
          id: "m1",
          effect: "blur",
          shape: "ellipse",
          width: 0.2,
          height: 0.2,
          strength: 0.5,
          feather: 0.2,
          keys: [
            { frame: 10, x: 0.5, y: 0.5 },
            { frame: 10, x: 0.5, y: 0.5 },
          ],
        },
      ]),
    /désordonnés/,
  );
  // An empty mask list is a mask that would silently do nothing.
  assert.throws(
    () =>
      ok([
        {
          id: "m1",
          effect: "blur",
          shape: "ellipse",
          width: 0.2,
          height: 0.2,
          strength: 0.5,
          feather: 0.2,
          keys: [],
        },
      ]),
    /Repères du masque/,
  );
  s.clips = [];
  assert.doesNotThrow(() => M.validateSequence(s, new Map()));
});
test(
  "a moving mask really hides its region in rendered pixels and leaves the rest untouched",
  { timeout: 180000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-masks-")),
      engine = new Engine({
        nativeRoot: path.resolve(
          "native",
          process.platform + "-" + process.arch,
        ),
        colorRoot: path.resolve("public/video-color"),
      });
    try {
      await engine.init();
      // A fine checkerboard everywhere makes blur and pixelation measurable.
      const raw = path.join(root, "checker.rgb"),
        pixels = Buffer.alloc(320 * 180 * 3);
      for (let y = 0; y < 180; y++)
        for (let x = 0; x < 320; x++) {
          const v = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 255 : 0,
            i = (y * 320 + x) * 3;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = v;
        }
      await fs.writeFile(raw, pixels);
      const source = path.join(root, "source.mkv");
      await engine.ff([
        "-y",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgb24",
        "-video_size",
        "320x180",
        "-framerate",
        "25",
        "-stream_loop",
        "49",
        "-i",
        raw,
        "-vf",
        "format=yuv444p10le",
        "-c:v",
        "ffv1",
        "-frames:v",
        "50",
        source,
      ]);
      const shape = path.join(root, "shape.png");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=white:s=64x64:d=1",
        "-frames:v",
        "1",
        shape,
      ]);
      const s = M.sequence();
      s.width = 320;
      s.height = 180;
      s.fps = { n: 25, d: 1 };
      const asset = {
        id: "a",
        kind: "video",
        duration: 2,
        inputSpace: "rec709",
        audioChannels: 0,
      };
      const base = M.clip(asset, s, 0);
      base.duration = 50;
      const mask = {
        id: "m1",
        effect: "blur",
        shape: "rectangle",
        width: 0.2,
        height: 0.36,
        strength: 1,
        feather: 0,
        keys: [
          { frame: 0, x: 0.25, y: 0.5 },
          { frame: 49, x: 0.75, y: 0.5 },
        ],
      };
      const options = {
        engine,
        sequence: { ...s, clips: [{ ...base, masks: [mask] }] },
        assets: new Map([["a", asset]]),
        registry: { a: { source } },
        cache: root,
        maskFiles: { m1: shape },
      };
      const plain = path.join(root, "plain.mkv"),
        masked = path.join(root, "masked.mkv");
      await R.renderSegment(
        { ...options, sequence: { ...s, clips: [base] }, start: 0, count: 50 },
        plain,
      );
      await R.renderSegment({ ...options, start: 0, count: 50 }, masked);
      async function frame(file, time, name) {
        const dest = path.join(root, name + ".rgb");
        await engine.ff([
          "-y",
          "-ss",
          String(time),
          "-i",
          file,
          "-frames:v",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          dest,
        ]);
        return fs.readFile(dest);
      }
      /** Mean absolute difference inside a column band, 0 to 1 of the width. */
      const band = (a, b, from, to) => {
        let sum = 0,
          count = 0;
        for (let i = 0; i < a.length; i += 3) {
          const p = i / 3,
            x = p % 320,
            y = Math.floor(p / 320);
          if (x >= from * 320 && x < to * 320 && y > 55 && y < 125) {
            sum += Math.abs(a[i] - b[i]);
            count++;
          }
        }
        return sum / count;
      };
      /** Local detail: neighbouring pixels stop differing once smoothed. */
      const detail = (a, from, to) => {
        let sum = 0,
          count = 0;
        for (let i = 0; i < a.length - 3; i += 3) {
          const p = i / 3,
            x = p % 320,
            y = Math.floor(p / 320);
          if (x >= from * 320 && x < to * 320 - 1 && y > 55 && y < 125) {
            sum += Math.abs(a[i] - a[i + 3]);
            count++;
          }
        }
        return sum / count;
      };
      const p0 = await frame(plain, 0, "p0"),
        m0 = await frame(masked, 0, "m0"),
        p1 = await frame(plain, 1.9, "p1"),
        m1 = await frame(masked, 1.9, "m1");
      // At the start the mask sits left; at the end it has travelled right.
      assert(
        detail(m0, 0.17, 0.33) < detail(p0, 0.17, 0.33) / 3,
        "le flou ne lisse pas la zone au début",
      );
      assert(band(p0, m0, 0.65, 0.85) < 1, "la droite a bougé au début");
      assert(
        detail(m1, 0.67, 0.83) < detail(p1, 0.67, 0.83) / 3,
        "le flou n’a pas suivi vers la droite",
      );
      assert(band(p1, m1, 0.15, 0.35) < 1, "la gauche a bougé à la fin");
      console.log(
        "Mask render",
        JSON.stringify({
          startPlain: Number(detail(p0, 0.17, 0.33).toFixed(2)),
          startMasked: Number(detail(m0, 0.17, 0.33).toFixed(2)),
          endPlain: Number(detail(p1, 0.67, 0.83).toFixed(2)),
          endMasked: Number(detail(m1, 0.67, 0.83).toFixed(2)),
          untouched: Number(band(p1, m1, 0.15, 0.35).toFixed(2)),
        }),
      );
      // A solid mask must paint its own colour, whatever the source shows.
      const solid = path.join(root, "solid.mkv");
      await R.renderSegment(
        {
          ...options,
          sequence: {
            ...s,
            clips: [
              {
                ...base,
                masks: [
                  {
                    ...mask,
                    effect: "solid",
                    color: "#ff0000",
                    keys: [{ frame: 0, x: 0.5, y: 0.5 }],
                  },
                ],
              },
            ],
          },
          start: 0,
          count: 25,
        },
        solid,
      );
      const red = await frame(solid, 0.2, "solid");
      const at = (x, y) => {
        const i = (y * 320 + x) * 3;
        return [red[i], red[i + 1], red[i + 2]];
      };
      const centre = at(160, 90);
      assert(
        centre[0] > 180 && centre[1] < 90 && centre[2] < 90,
        "cache plein absent au centre : " + centre.join(","),
      );
      // Outside the mask the picture must stay exactly as it was.
      assert(
        band(await frame(plain, 0.2, "p3"), red, 0.05, 0.15) < 1,
        "le cache plein a débordé",
      );
      // Pixelation keeps the average but destroys the fine checkerboard.
      const pixelated = path.join(root, "pixel.mkv");
      await R.renderSegment(
        {
          ...options,
          sequence: {
            ...s,
            clips: [
              {
                ...base,
                masks: [
                  {
                    ...mask,
                    effect: "pixelate",
                    keys: [{ frame: 0, x: 0.5, y: 0.5 }],
                  },
                ],
              },
            ],
          },
          start: 0,
          count: 25,
        },
        pixelated,
      );
      const blocks = await frame(pixelated, 0.2, "pixel"),
        plainMid = await frame(plain, 0.2, "p2");
      assert(
        detail(blocks, 0.45, 0.55) < detail(plainMid, 0.45, 0.55) / 1.5,
        "pixelisation absente",
      );
      assert(
        band(plainMid, blocks, 0.05, 0.15) < 1,
        "la pixelisation a débordé",
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
