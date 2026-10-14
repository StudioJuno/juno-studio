const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { registerReview } = require("../electron/review.cjs");
const { registerVideo } = require("../electron/video/index.cjs"),
  M = require("../electron/video/model.cjs");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
process.argv.push("--juno-test-hidden");
async function waitFor(fn, predicate) {
  for (let i = 0; i < 900; i++) {
    const value = await fn();
    if (predicate(value)) return value;
    await pause(100);
  }
  throw Error("Background operation timed out");
}
async function context(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-review-native-")),
    api = {},
    events = [];
  const app = {
    isPackaged: false,
    getPath: () => root,
    on: (name, fn) => {
      if (name === "before-quit") events.push(fn);
    },
  };
  const dependencies = {
    handle: (key, fn) => (api[key] = fn),
    app,
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: async () => {} },
  };
  let module = await registerReview(dependencies);
  t.after(async () => {
    await module.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    api,
    app,
    dependencies,
    events,
    get module() {
      return module;
    },
    restart: async () => {
      await module.close();
      module = await registerReview(dependencies);
      return module;
    },
  };
}
const bytes = Buffer.from([255, 216, 255, 224, 0, 4, 1, 2, 255, 217]);
const array = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
const photo = (id) => ({
  id,
  name: "Portrait.jpg",
  adjustments: { exposure: 0.4 },
  hash: "photo-hash",
  revision: 2,
});
async function stage(f, pid = randomUUID()) {
  const p = photo(pid),
    job = await f.api["review-begin"]({
      projectId: "project",
      title: "Sélection",
      kind: "photo",
      photos: [p],
      clientName: "Client",
    });
  await f.api["review-stage-photo"]({
    jobId: job.id,
    photoId: p.id,
    bytes: array(bytes),
    thumbnail: array(bytes),
    width: 600,
    height: 900,
  });
  return job;
}
test(
  "outbox resumes a lost upload acknowledgement after restart, rejects replay of completed jobs, and queues publications",
  { timeout: 60000 },
  async (t) => {
    const f = await context(t),
      job = await stage(f),
      fetchOriginal = global.fetch;
    let lost = false;
    global.fetch = async (url, options) => {
      const response = await fetchOriginal(url, options);
      if (!lost && url.endsWith("/content")) {
        lost = true;
        await response.arrayBuffer();
        throw Error("Simulated lost acknowledgement");
      }
      return response;
    };
    try {
      await f.api["review-start"]({ id: job.id });
      await waitFor(
        () => f.module.publicJob(f.module.getJob(job.id)),
        (j) => j.state === "failed",
      );
    } finally {
      global.fetch = fetchOriginal;
    }
    const partial = f.module.service.store.get("SELECT * FROM assets");
    assert.equal(partial.received, bytes.length);
    await f.restart();
    assert.equal(f.module.getJob(job.id).state, "failed");
    await f.api["review-job"]({ id: job.id, action: "resume" });
    const completed = await waitFor(
      () => f.module.publicJob(f.module.getJob(job.id)),
      (j) => j.state === "done" || j.state === "failed",
    );
    assert.equal(completed.state, "done", completed.error);
    assert.equal(
      f.module.service.store.get("SELECT COUNT(*) AS n FROM assets").n,
      1,
    );
    await assert.rejects(f.api["review-start"]({ id: job.id }), /terminée/);
    const a = await stage(f),
      b = await stage(f);
    global.fetch = async (url, options) => {
      if (url.endsWith("/content")) await pause(100);
      return fetchOriginal(url, options);
    };
    try {
      await f.api["review-start"]({ id: a.id });
      const queued = await f.api["review-start"]({ id: b.id });
      assert.equal(queued.state, "queued");
      await assert.rejects(
        f.api["review-connect"]({ local: true }),
        /Suspendez/,
      );
      await waitFor(
        () => f.api["review-jobs"](),
        (jobs) => jobs.every((j) => j.state === "done"),
      );
    } finally {
      global.fetch = fetchOriginal;
    }
    await f.api["review-job"]({ id: b.id, action: "hide" });
    assert.equal(f.api["review-jobs"]().length, 2);
    assert.equal(
      f.module.service.store.get(
        "SELECT COUNT(*) AS n FROM revisions WHERE state='published'",
      ).n,
      3,
    );
  },
);

test(
  "real rational-rate H.264/AAC montage renders, publishes and preserves its frozen timeline",
  { timeout: 180000 },
  async (t) => {
    const f = await context(t),
      nativeRoot = path.resolve(
        "native",
        process.platform + "-" + process.arch,
      );
    let picked = [];
    const video = await registerVideo({
      ...f.dependencies,
      nativeRoot,
      colorRoot: path.resolve("public/video-color"),
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: picked }),
        showSaveDialog: async () => {
          throw Error("Review export must not require a file dialog");
        },
      },
      protocol: { handle: () => {} },
      getWindow: () => undefined,
    });
    t.after(async () => {
      f.events.slice(1).forEach((fn) => fn());
      await pause(100);
    });
    const file = path.join(f.root, "camera.mp4");
    await video.engine.ff([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:r=30000/1001:d=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=4",
      ...video.engine.encode(),
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
    await video.engine.tagH264(file);
    const project = await f.api["video-create"]({ name: "Film de relecture" });
    picked = [file];
    const imported = await f.api["video-import"](project.id);
    await waitFor(
      () => f.api["video-list"]().jobs.find((j) => j.id === imported.id),
      (j) => j.state === "done" || j.state === "failed",
    );
    const p = f.api["video-project"](project.id);
    assert.equal(p.assets.length, 1);
    const sequence = {
      ...p.sequences[0],
      fps: { n: 30000, d: 1001 },
      width: 320,
      height: 180,
    };
    sequence.clips = [{ ...M.clip(p.assets[0], sequence, 0), duration: 100 }];
    const exported = await f.api["video-export"]({
      projectId: p.id,
      sequence,
      codec: "h264",
      review: true,
    });
    const rendered = await waitFor(
      () => f.api["video-list"]().jobs.find((j) => j.id === exported.id),
      (j) => j.state === "done" || j.state === "failed",
    );
    assert.equal(rendered.state, "done", rendered.error);
    // Re-register with the real video module against the same outbox and catalogue.
    f.dependencies.videoModule = video;
    const bridge = await f.restart();
    const job = await f.api["review-begin"]({
      projectId: p.id,
      title: "Film",
      kind: "video",
      videoProjectId: p.id,
      videoJobId: rendered.id,
    });
    await f.api["review-stage-video"]({ id: job.id });
    // Le film rendu pour la relecture est retiré une fois sa copie vérifiée.
    await assert.rejects(fs.stat(rendered.result));
    await f.api["review-start"]({ id: job.id });
    const completed = await waitFor(
      () => bridge.publicJob(bridge.getJob(job.id)),
      (j) => j.state === "done" || j.state === "failed",
    );
    assert.equal(completed.state, "done", completed.error);
    const asset = bridge.service.store.get("SELECT * FROM assets"),
      metadata = JSON.parse(asset.metadata);
    assert.equal(metadata.frames, 100);
    assert.deepEqual(metadata.fps, { n: 30000, d: 1001 });
    assert.deepEqual(
      metadata.snapshot.sequence.clips,
      sequence.clips.map(
        ({ id, assetId, start, duration, inUs, speed, track }) => ({
          id,
          assetId,
          start,
          duration,
          inUs,
          speed,
          track,
        }),
      ),
    );
    const stored = bridge.service.media.file(asset),
      meta = await video.engine.probe(stored);
    assert.equal(meta.codec, "h264");
    assert(meta.audioChannels > 0);
    assert.equal((await fs.readFile(stored)).length, asset.size);
    assert.equal(
      createHash("sha256")
        .update(await fs.readFile(stored))
        .digest("hex"),
      asset.sha256,
    );
    // Keep only a disposable test fixture for browser validation, never user content.
    const artifacts = path.resolve("../../work/review");
    await fs.copyFile(stored, path.join(artifacts, "fixture-video.mp4"));
    await fs.copyFile(
      bridge.service.media.file(asset, "thumbnail"),
      path.join(artifacts, "fixture-video.jpg"),
    );
    await bridge.close();
  },
);
