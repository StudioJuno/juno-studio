const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs"),
  { validateAnimation } = require("../electron/video/animation.cjs");
test("animation rejects unsorted, injected and unbounded keys", () => {
  for (const animation of [
    { x: [{ frame: 1, value: 9, easing: "linear" }] },
    {
      x: [
        { frame: 1, value: 0, easing: "linear" },
        { frame: 0, value: 0, easing: "hold" },
      ],
    },
    { x: [{ frame: 0, value: "system()", easing: "linear" }] },
    { arbitrary: [] },
  ])
    assert.throws(() => validateAnimation(animation));
});
test(
  "native animation moves real pixels, changes real audio and preserves a resumed segment",
  { timeout: 120000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-keyframes-"));
    const engine = new Engine({
      nativeRoot: path.resolve("native", process.platform + "-" + process.arch),
      colorRoot: path.resolve("public/video-color"),
    });
    try {
      await engine.init();
      assert(engine.status.available);
      const source = path.join(root, "source.mkv");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=red:s=320x180:r=25:d=4",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=4",
        "-c:v",
        "ffv1",
        "-c:a",
        "pcm_s16le",
        source,
      ]);
      const a = {
          id: "camera",
          kind: "video",
          duration: 4,
          audioChannels: 1,
          inputSpace: "rec709",
        },
        s = M.sequence();
      s.width = 320;
      s.height = 180;
      s.clips = [M.clip(a, s, 0)];
      const c = s.clips[0];
      c.scale = 0.3;
      c.animation = {
        x: [
          { frame: 0, value: -0.25, easing: "linear" },
          { frame: 99, value: 0.25, easing: "linear" },
        ],
        gain: [
          { frame: 0, value: 0.1, easing: "linear" },
          { frame: 99, value: 1, easing: "linear" },
        ],
      };
      M.validateSequence(s, new Map([[a.id, a]]));
      const opts = {
        engine,
        sequence: s,
        assets: new Map([[a.id, a]]),
        registry: { [a.id]: { source } },
        cache: root,
      };
      const full = path.join(root, "full.mkv"),
        resume = path.join(root, "resume.mkv");
      await R.renderSegment({ ...opts, start: 0, count: 100 }, full);
      await R.renderSegment({ ...opts, start: 50, count: 50 }, resume);
      async function center(file, second, label) {
        const dest = path.join(root, label + ".rgb");
        await engine.ff([
          "-y",
          "-ss",
          String(second),
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
        const b = await fs.readFile(dest);
        let count = 0,
          total = 0;
        for (let i = 0; i < b.length; i += 3)
          if (b[i] > 100 && b[i] > b[i + 1] * 2 && b[i] > b[i + 2] * 2) {
            count++;
            total += (i / 3) % 320;
          }
        assert(count > 500);
        return total / count;
      }
      const first = await center(full, 0, "first"),
        last = await center(full, 3.96, "last"),
        mid = await center(full, 2, "mid"),
        resumed = await center(resume, 0, "resumed");
      assert(last - first > 140, JSON.stringify({ first, last }));
      assert(Math.abs(mid - resumed) < 1, JSON.stringify({ mid, resumed }));
      async function rms(time, label) {
        const file = path.join(root, label + ".pcm");
        await engine.ff([
          "-y",
          "-ss",
          String(time),
          "-i",
          full,
          "-t",
          "0.1",
          "-vn",
          "-ac",
          "1",
          "-f",
          "f32le",
          file,
        ]);
        const b = await fs.readFile(file);
        let energy = 0;
        for (let i = 0; i < b.length; i += 4) energy += b.readFloatLE(i) ** 2;
        return Math.sqrt(energy / (b.length / 4));
      }
      const quiet = await rms(0.1, "quiet"),
        loud = await rms(3.7, "loud");
      assert(loud > quiet * 4, JSON.stringify({ quiet, loud }));
      console.log(
        "Animation pixels/audio/resume",
        JSON.stringify({ first, last, mid, resumed, quiet, loud }),
      );
    } finally {
      engine.children.forEach((p) => p.kill());
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
