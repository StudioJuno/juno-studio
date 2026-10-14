const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs");
const nativeRoot = path.join(
    __dirname,
    "../native",
    process.platform + "-" + process.arch,
  ),
  colorRoot = path.join(__dirname, "../public/video-color");
function energy(file, ffmpeg) {
  const r = spawnSync(
    ffmpeg,
    [
      "-v",
      "error",
      "-i",
      file,
      "-map",
      "0:a",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-f",
      "f32le",
      "-",
    ],
    { maxBuffer: 16 << 20 },
  );
  if (r.status) throw Error(String(r.stderr));
  let l = 0,
    rr = 0,
    n = 0;
  for (let i = (48000 * 8) / 2; i < r.stdout.length - (48000 * 8) / 2; i += 8) {
    l += r.stdout.readFloatLE(i) ** 2;
    rr += r.stdout.readFloatLE(i + 4) ** 2;
    n++;
  }
  return [Math.sqrt(l / n), Math.sqrt(rr / n)];
}
test(
  "real exports honour track pan, bus gain and bus mute without modifying source",
  { timeout: 60000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-mix-export-")),
      e = new Engine({ nativeRoot, colorRoot });
    try {
      await e.init();
      const source = path.join(root, "source.wav");
      await e.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=0.1*sin(2*PI*440*t)|0.1*sin(2*PI*880*t):s=48000:d=3",
        "-c:a",
        "pcm_s16le",
        source,
      ]);
      const a = {
          id: "a",
          name: "source.wav",
          ...(await e.probe(source)),
          inputSpace: "rec709",
        },
        base = {
          ...M.sequence(),
          width: 320,
          height: 180,
          fps: { n: 25, d: 1 },
        };
      base.clips = [
        { ...M.clip(a, base, 0, 10), duration: 75, component: "audio" },
      ];
      const levels = {};
      for (const [name, pan, gain, muted] of [
        ["center", 0, 1, false],
        ["left", -1, 1, false],
        ["right", 1, 1, false],
        ["quiet", 0, 0.5, false],
        ["muted", 0, 1, true],
      ]) {
        const s = {
          ...base,
          tracks: { 10: { pan, bus: "voice" } },
          buses: { voice: { gain, muted } },
        };
        M.validateSequence(s, new Map([["a", a]]));
        const file = path.join(root, name + ".mov");
        await R.renderSegment(
          {
            engine: e,
            sequence: s,
            assets: new Map([["a", a]]),
            registry: { a: { source } },
            cache: root,
            start: 0,
            count: 75,
          },
          file,
        );
        levels[name] = energy(file, e.ffmpeg);
      }
      assert(levels.center[0] > 0.05 && levels.center[1] > 0.05);
      assert(levels.left[1] < 0.00001 && levels.left[0] > 0.05);
      assert(levels.right[0] < 0.00001 && levels.right[1] > 0.05);
      assert(Math.abs(levels.quiet[0] / levels.center[0] - 0.5) < 0.02);
      assert(levels.muted[0] < 0.00001 && levels.muted[1] < 0.00001);
      assert((await fs.stat(source)).size > 0);
      console.log("Stereo RMS export:", JSON.stringify(levels));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
