const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs"),
  Motion = require("../electron/video/motion.cjs");
const k = (frame, value) => ({ frame, value, easing: "linear" });
test("motion and subtitle styles reject invalid effects before saving", () => {
  const s = M.sequence();
  s.captionStyle = {
    size: 60,
    y: 0.7,
    color: "#ffee00",
    effect: "pop",
    fontFamily: "Inter",
  };
  assert.doesNotThrow(() => M.validateSequence(s, new Map()));
  s.captionStyle.strokeWidth = 100;
  assert.throws(() => M.validateSequence(s, new Map()));
  assert.doesNotThrow(() =>
    Motion.placement({ x: 4096, y: 100, width: 8192, height: 100, motion: {} }),
  );
  assert(
    !Motion.filters(
      { x: 200, y: 40, width: 400, height: 80, motion: {} },
      0,
      "text",
      0,
      "25/1",
    ).includes("pad="),
  );
  // The size cap follows the sequence height so 4K titles are not starved.
  const big = M.sequence();
  big.titles = [
    {
      id: "size",
      text: "Juno",
      start: 0,
      duration: 25,
      size: 600,
      y: 0.5,
      color: "#ffffff",
    },
  ];
  assert.throws(() => M.validateSequence(big, new Map()), /Taille titre/);
  big.width = 3840;
  big.height = 2160;
  assert.doesNotThrow(() => M.validateSequence(big, new Map()));
  big.titles[0].size = 1200;
  assert.throws(() => M.validateSequence(big, new Map()), /Taille titre/);
  assert.throws(() => Motion.validateMotion({ scale: [k(0, 100)] }));
  assert.throws(() =>
    Motion.placement({ x: 0, y: 0, width: 8192, height: 8192, motion: {} }),
  );
});
test(
  "motion export animates scale, rotation, opacity and position consistently after resume",
  { timeout: 120000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-motion-")),
      engine = new Engine({
        nativeRoot: path.resolve(
          "native",
          process.platform + "-" + process.arch,
        ),
        colorRoot: path.resolve("public/video-color"),
      });
    try {
      await engine.init();
      const png = path.join(root, "shape.png");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=40x40:d=1",
        "-frames:v",
        "1",
        png,
      ]);
      const s = M.sequence();
      s.width = 320;
      s.height = 180;
      s.fps = { n: 25, d: 1 };
      s.titles = [
        {
          id: "motion",
          text: "",
          size: 24,
          color: "#ffffff",
          y: 0.5,
          start: 0,
          duration: 50,
        },
      ];
      const p = {
        x: 80,
        y: 90,
        width: 40,
        height: 40,
        motion: {
          x: [k(0, 0), k(49, 0.4)],
          scale: [k(0, 1), k(49, 2)],
          rotation: [k(0, 0), k(49, 90)],
          opacity: [k(0, 0.2), k(49, 1)],
        },
      };
      const opts = {
        engine,
        sequence: s,
        assets: new Map(),
        registry: {},
        cache: root,
        overlays: [{ file: png, start: 0, duration: 50, placement: p }],
      };
      const full = path.join(root, "full.mkv"),
        resume = path.join(root, "resume.mkv");
      await R.renderSegment({ ...opts, start: 0, count: 50 }, full);
      await R.renderSegment({ ...opts, start: 25, count: 25 }, resume);
      async function pixels(file, time, name) {
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
      const first = await pixels(full, 0, "first"),
        last = await pixels(full, 1.96, "last"),
        mid = await pixels(full, 1, "mid"),
        resumed = await pixels(resume, 0, "resumed");
      function stats(b) {
        let sum = 0,
          count = 0,
          x = 0;
        for (let i = 0; i < b.length; i += 3)
          if (b[i] > 20 && b[i] > b[i + 1] * 2) {
            sum += b[i];
            count++;
            x += (i / 3) % 320;
          }
        return { count, mean: sum / count, x: x / count };
      }
      const splitRun = path.join(root, "word-run.mkv");
      await R.renderSegment(
        {
          ...opts,
          start: 25,
          count: 25,
          overlays: [
            { ...opts.overlays[0], start: 25, duration: 25, motionOrigin: 0 },
          ],
        },
        splitRun,
      );
      const wordRun = await pixels(splitRun, 0, "word-run");
      let wordDiff = 0;
      for (let i = 0; i < mid.length; i++)
        wordDiff += Math.abs(mid[i] - wordRun[i]);
      assert(
        wordDiff / mid.length < 1,
        "word boundary restarted the animation: " + wordDiff / mid.length,
      );
      const a = stats(first),
        b = stats(last);
      assert(b.x - a.x > 100, JSON.stringify({ a, b }));
      assert(b.count > a.count * 3, JSON.stringify({ a, b }));
      assert(b.mean > a.mean * 2, JSON.stringify({ a, b }));
      let diff = 0;
      for (let i = 0; i < mid.length; i++)
        diff += Math.abs(mid[i] - resumed[i]);
      assert(
        diff / mid.length < 1,
        "reprise différente : " + diff / mid.length,
      );
      const fade = path.join(root, "fade.mkv"),
        fadeResume = path.join(root, "fade-resume.mkv");
      const fading = {
        ...opts,
        overlays: [
          {
            ...opts.overlays[0],
            placement: {
              ...p,
              motion: { opacity: [k(0, 0), k(10, 1), k(39, 1), k(49, 0)] },
            },
          },
        ],
      };
      await R.renderSegment({ ...fading, start: 0, count: 50 }, fade);
      await R.renderSegment({ ...fading, start: 5, count: 45 }, fadeResume);
      const black = await pixels(fade, 0, "black"),
        half = await pixels(fade, 0.2, "half"),
        halfResume = await pixels(fadeResume, 0, "half-resume");
      assert(
        black.reduce((max, v) => Math.max(max, v), 0) < 5,
        "La première image du fondu doit être transparente",
      );
      assert(
        stats(half).mean > 110 && stats(half).mean < 145,
        "Opacité du fondu à mi-course",
      );
      let fadeDiff = 0;
      for (let i = 0; i < half.length; i++)
        fadeDiff += Math.abs(half[i] - halfResume[i]);
      assert(fadeDiff / half.length < 1, "Reprise du fondu optimisé");
      console.log(
        "Motion render",
        JSON.stringify({ a, b, resumeMeanDiff: diff / mid.length }),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
