const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { registerVideo } = require("../electron/video/index.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs");
const nativeRoot = path.join(
    __dirname,
    "../native",
    process.platform + "-" + process.arch,
  ),
  colorRoot = path.join(__dirname, "../public/video-color"),
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
const waitJob = async (
  api,
  id,
  condition = (j) => ["done", "failed"].includes(j.state),
) => {
  for (let i = 0; i < 1800; i++) {
    const j = api["video-list"]().jobs.find((j) => j.id === id);
    if (condition(j)) {
      if (j.state === "failed") throw Error(j.error);
      return j;
    }
    await pause(100);
  }
  throw Error("Job timeout " + id);
};
test(
  "native project lifecycle: import, transcript, LUT, version recovery, resumable rational export and portable restore",
  {
    skip: !fss.existsSync(
      path.join(
        nativeRoot,
        "ffmpeg" + (process.platform === "win32" ? ".exe" : ""),
      ),
    ),
    timeout: 300000,
  },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-native-")),
      api = {},
      events = {};
    let picked = [],
      saved = "",
      module;
    const setup = () =>
      registerVideo({
        handle: (name, fn) => (api[name] = fn),
        app: { getPath: () => root, getVersion: () => "0.0.0-test", on: (name, fn) => (events[name] = fn) },
        dialog: {
          showOpenDialog: async () => ({ canceled: false, filePaths: picked }),
          showSaveDialog: async () => ({ canceled: false, filePath: saved }),
        },
        protocol: { handle: () => {} },
        getWindow: () => undefined,
        nativeRoot,
        colorRoot,
      });
    try {
      module = await setup();
      const { engine, store } = module;
      assert(engine.status.available, JSON.stringify(engine.status));
      const file = path.join(root, "camera.mp4");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=320x180:r=30000/1001:d=12",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=12",
        ...engine.encode(),
        "-c:a",
        "aac",
        "-shortest",
        file,
      ]);
      await engine.tagH264(file);
      assert.equal((await engine.probe(file)).color.transfer, "bt709");
      const p = await api["video-create"]({ name: "Contrôle natif" });
      picked = [file, path.join(__dirname, "fixtures/jfk.wav")];
      let j = await api["video-import"](p.id);
      await waitJob(api, j.id);
      let project = api["video-project"](p.id);
      assert.equal(
        project.assets.length,
        2,
        JSON.stringify(api["video-list"]().jobs),
      );
      const video = project.assets.find((a) => a.kind === "video"),
        audio = project.assets.find((a) => a.kind === "audio");
      assert(video.spaceConfirmed);
      assert(video.waveform.some((x) => x > 0));
      // A full disk must halt the lane without a rejected background promise or retry loop.
      const mutate = store.mutate.bind(store);
      let writes = 0;
      store.mutate = async (fn) => {
        writes++;
        if (writes > 1) throw Error("Simulated full disk");
        return mutate(fn);
      };
      let diskJob;
      try {
        diskJob = await api["video-analyze"]({
          projectId: p.id,
          ids: [video.id],
        });
        await pause(300);
        assert.equal(
          api["video-list"]().jobs.find((x) => x.id === diskJob.id).state,
          "interrupted",
        );
        const stopped = writes;
        await pause(300);
        assert.equal(writes, stopped);
        assert.equal(writes, 3);
      } finally {
        store.mutate = mutate;
      }
      await api["video-job"]({ id: diskJob.id, action: "resume" });
      await waitJob(api, diskJob.id);
      const s = {
        ...project.sequences[0],
        fps: { n: 30000, d: 1001 },
        width: 320,
        height: 180,
      };
      s.clips = [{ ...M.clip(video, s, 0), duration: 301 }];
      const first = await api["video-sequence"]({
        projectId: p.id,
        sequence: s,
        expectedVersion: 1,
      });
      assert.equal(first.version, 2);
      await assert.rejects(
        api["video-sequence"]({
          projectId: p.id,
          sequence: s,
          expectedVersion: 1,
        }),
        /changé/,
      );
      const cube = path.join(root, "test.cube");
      let cubeText = "LUT_3D_SIZE 2\n";
      for (let b = 0; b < 2; b++)
        for (let g = 0; g < 2; g++)
          for (let r = 0; r < 2; r++) cubeText += `${r} ${g} ${b}\n`;
      await fs.writeFile(cube, cubeText);
      picked = [cube];
      const lut = await api["video-lut"]({ action: "import" });
      assert.equal(
        (await api["video-lut"]({ action: "read", id: lut.id })).size,
        2,
      );
      s.clips[0].grade.lutId = lut.id;
      await api["video-sequence"]({
        projectId: p.id,
        sequence: s,
        expectedVersion: 2,
      });
      const items = (await api["video-history"]({ projectId: p.id })).items;
      assert(items.length >= 1);
      const recovered = await api["video-history"]({
        projectId: p.id,
        revision: items[0].revision,
        sequenceId: s.id,
      });
      assert.notEqual(recovered.sequence.id, s.id);
      if (engine.status.transcription) {
        j = await api["video-transcribe"]({
          projectId: p.id,
          ids: [audio.id],
          language: "en",
        });
        await waitJob(api, j.id);
        project = api["video-project"](p.id);
        const transcript = project.assets.find(
          (a) => a.id === audio.id,
        ).transcript;
        assert(transcript.some((t) => /country/i.test(t.text)));
        await api["video-transcript"]({
          projectId: p.id,
          assetId: audio.id,
          segments: [{ start: 0, end: 1, text: "Texte corrigé" }],
        });
        j = await api["video-transcribe"]({
          projectId: p.id,
          ids: [audio.id],
          language: "en",
        });
        await assert.rejects(waitJob(api, j.id), /manuellement/);
        assert.equal(
          api["video-project"](p.id).assets.find((a) => a.id === audio.id)
            .transcript[0].text,
          "Texte corrigé",
        );
      }
      const moved = path.join(root, "camera-moved.mp4");
      await fs.rename(file, moved);
      picked = [moved];
      j = await api["video-relink"]({ projectId: p.id, assetId: video.id });
      await waitJob(api, j.id);
      assert.equal(store.data.media[video.id].source, moved);
      let block = true,
        entered = false;
      const original = R.renderSegment;
      R.renderSegment = async (options, target, signal) => {
        if (block && options.start >= 250) {
          entered = true;
          await new Promise((resolve, reject) => {
            const fail = () =>
              reject(
                Object.assign(Error("Paused by test"), { name: "AbortError" }),
              );
            if (signal.aborted) fail();
            else signal.addEventListener("abort", fail, { once: true });
          });
        }
        return original(options, target, signal);
      };
      saved = path.join(root, "film.mp4");
      j = await api["video-export"]({
        projectId: p.id,
        sequence: s,
        codec: "h264",
        overlays: [],
      });
      for (let i = 0; i < 1000 && !entered; i++) await pause(50);
      assert(entered, "second segment reached");
      await api["video-job"]({ id: j.id, action: "pause" });
      await pause(100);
      assert.equal(
        api["video-list"]().jobs.find((x) => x.id === j.id).cursor,
        1,
      );
      block = false;
      R.renderSegment = original;
      events["will-quit"]();
      module = await setup();
      await api["video-job"]({ id: j.id, action: "resume" });
      await waitJob(api, j.id);
      const out = await module.engine.probe(saved);
      assert.equal(out.color.transfer, "bt709");
      assert(
        Math.abs(out.duration - (301 * 1001) / 30000) < 0.04,
        JSON.stringify(out),
      );
      const frames = await module.engine.run(module.engine.ffprobe, [
        "-v",
        "error",
        "-count_frames",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=nb_read_frames",
        "-of",
        "json",
        saved,
      ]);
      assert.equal(JSON.parse(frames.stdout).streams[0].nb_read_frames, "301");

      // Simulate a crash after publication but before the job journal is committed.
      saved = path.join(root, "published-before-crash.mp4");
      const realRename = fs.rename;
      let fault = true;
      fs.rename = async (from, to) => {
        await realRename(from, to);
        if (to === saved && fault) {
          fault = false;
          throw Error("Simulated interruption after publication");
        }
      };
      try {
        j = await api["video-export"]({
          projectId: p.id,
          sequence: { ...s, clips: [{ ...s.clips[0], duration: 4 }] },
          codec: "h264",
          overlays: [],
        });
        await assert.rejects(waitJob(api, j.id), /Simulated interruption/);
      } finally {
        fs.rename = realRename;
      }
      const published = await fs.readFile(saved),
        realFinish = R.finishRender;
      R.finishRender = async () => {
        throw Error("Published export must not be rendered again");
      };
      try {
        await api["video-job"]({ id: j.id, action: "resume" });
        await waitJob(api, j.id);
      } finally {
        R.finishRender = realFinish;
      }
      assert.deepEqual(await fs.readFile(saved), published);
      assert((await fs.stat(saved + ".juno-" + j.id + ".json")).size > 0);
      saved = path.join(root, "copy.junofilm");
      await api["video-backup"](p.id);
      const backup = JSON.parse(await fs.readFile(saved, "utf8"));
      assert(backup.luts[lut.id]);
      picked = [saved];
      const copy = await api["video-restore"]();
      assert.notEqual(copy.id, p.id);
      const restore = api["video-list"]().jobs.find(
        (j) => j.projectId === copy.id && j.kind === "restore",
      );
      const done = await waitJob(api, restore.id);
      assert.equal(done.errors.length, 0, JSON.stringify(done));
      assert(
        api["video-project"](copy.id).assets.every((a) => a.status === "ready"),
      );
      assert.notEqual(api["video-project"](copy.id).assets[0].id, video.id);
      console.log(
        "Native lifecycle, transcription, rational MOV segments and recovery verified in isolated profile",
      );
    } finally {
      events["will-quit"]?.();
      await pause(100);
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);
