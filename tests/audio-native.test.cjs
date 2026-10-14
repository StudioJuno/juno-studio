const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const A = require("../electron/video/audio.cjs"),
  { Engine } = require("../electron/video/engine.cjs");
test("audio settings reject malformed and unbounded effects", () => {
  for (const settings of [
    { strength: NaN },
    { strength: 2 },
    { compression: 0 },
    { highpass: "100,evil" },
    { bass: 15 },
  ])
    assert.throws(() => A.validate(settings));
  assert.equal(A.validate().strength, 0.7);
});
test(
  "local neural voice cleanup writes playable PCM and preserves source duration",
  { timeout: 120000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "juno-voice-")),
      engine = new Engine({
        nativeRoot: path.resolve(
          "native",
          process.platform + "-" + process.arch,
        ),
        colorRoot: path.resolve("public/video-color"),
      });
    try {
      await engine.init();
      const source = path.resolve("tests/fixtures/jfk.wav"),
        before = await fs.readFile(source),
        out = path.join(dir, "voice.wav");
      await engine.ff([
        "-y",
        "-i",
        source,
        "-af",
        A.filters(A.validate(), path.resolve("native/models/juno-voice.rnnn")),
        "-c:a",
        "pcm_s24le",
        "-ar",
        "48000",
        "-ac",
        "2",
        out,
      ]);
      const orig = await engine.probe(source),
        result = await engine.probe(out);
      assert.equal(result.kind, "audio");
      assert.equal(result.audioChannels, 2);
      assert.equal(result.sampleRate, 48000);
      assert(Math.abs(result.duration - orig.duration) < 0.05);
      assert.deepEqual(await fs.readFile(source), before);
      assert.notDeepEqual(await fs.readFile(out), before);
      const wave = await engine.waveform(out, result.duration);
      assert(wave.some((v) => v > 0));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
test(
  "voice job persists a reversible derivative and reuses it after restart",
  { timeout: 120000 },
  async () => {
    const { registerVideo } = require("../electron/video/index.cjs"),
      M = require("../electron/video/model.cjs");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-audio-job-")),
      api = {},
      events = {};
    let module;
    const source = path.resolve("tests/fixtures/jfk.wav");
    const setup = () =>
      registerVideo({
        handle: (n, f) => (api[n] = f),
        app: { getPath: () => root, on: (n, f) => (events[n] = f) },
        dialog: {
          showOpenDialog: async () => ({
            canceled: false,
            filePaths: [source],
          }),
        },
        protocol: { handle: () => {} },
        getWindow: () => undefined,
        nativeRoot: path.resolve(
          "native",
          process.platform + "-" + process.arch,
        ),
        colorRoot: path.resolve("public/video-color"),
      });
    async function wait(id) {
      for (let i = 0; i < 600; i++) {
        const j = api["video-list"]().jobs.find((j) => j.id === id);
        if (j.state === "failed") throw Error(j.error);
        if (j.state === "done") return j;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error("Timeout");
    }
    try {
      module = await setup();
      const p = await api["video-create"]({ name: "Voix" });
      await wait((await api["video-import"](p.id)).id);
      const original = api["video-project"](p.id).assets[0];
      const job = await api["video-audio-process"]({
        projectId: p.id,
        assetId: original.id,
        settings: { strength: 0.5 },
      });
      const done = await wait(job.id);
      const project = api["video-project"](p.id),
        enhanced = project.assets.find((a) => a.id === done.result);
      assert(enhanced);
      assert.equal(enhanced.audioProcessing.sourceAssetId, original.id);
      assert.equal(project.assets.length, 2);
      assert.equal(
        module.store.data.media[enhanced.id].proxy,
        module.store.data.media[enhanced.id].source,
      );
      const s = project.sequences[0];
      s.clips = [
        {
          ...M.clip(enhanced, s, 0, 10),
          component: "audio",
          originalAssetId: original.id,
        },
      ];
      await api["video-sequence"]({
        projectId: p.id,
        sequence: s,
        expectedVersion: s.version || 1,
      });
      await events["before-quit"]?.();
      module = await setup();
      const restored = api["video-project"](p.id);
      assert.equal(restored.assets.length, 2);
      assert.equal(restored.sequences[0].clips[0].originalAssetId, original.id);
      assert.equal(restored.sequences[0].clips[0].assetId, enhanced.id);
    } finally {
      await events["before-quit"]?.();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
