const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs");
const nativeRoot = path.join(
    __dirname,
    "../native",
    process.platform + "-" + process.arch,
  ),
  colorRoot = path.join(__dirname, "../public/video-color");
test(
  "available export codecs deliver exact frames, expected bit depth and continuous sound without re-encoding segments",
  {
    skip: !fss.existsSync(
      path.join(
        nativeRoot,
        "ffmpeg" + (process.platform === "win32" ? ".exe" : ""),
      ),
    ),
    timeout: 180000,
  },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-codecs-"));
    const engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const profiles = engine.status.exports.filter((x) => x.available);
      assert(profiles.some((x) => x.id === "h264"));
      assert(profiles.some((x) => x.id === "prores"));
      assert(profiles.some((x) => x.id === "dnxhr"));
      const source = path.join(root, "source.mov");
      await engine.ff([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=s=384x216:r=30000/1001:d=1",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=1",
        ...engine.encode({ codec: "prores" }),
        "-c:a",
        "pcm_s24le",
        "-shortest",
        source,
      ]);
      const meta = await engine.probe(source),
        a = {
          ...meta,
          id: "camera",
          inputSpace: "rec709",
          spaceConfirmed: true,
          source,
        };
      const p = M.project("Codecs"),
        s = {
          ...p.sequences[0],
          width: 384,
          height: 216,
          fps: { n: 30000, d: 1001 },
        };
      s.clips = [{ ...M.clip(a, s, 0), duration: 19 }];
      const assets = new Map([[a.id, a]]),
        registry = { [a.id]: { source } };
      const measured = [];
      for (const profile of profiles) {
        const segments = [],
          durations = [];
        for (const [i, start, count] of [
          [0, 0, 10],
          [1, 10, 9],
        ]) {
          const dest = path.join(root, profile.id + "-" + i + ".mov");
          await R.renderSegment(
            {
              engine,
              sequence: s,
              assets,
              registry,
              cache: root,
              start,
              count,
              overlays: [],
              deliveryCodec: profile.id,
            },
            dest,
          );
          segments.push(dest);
          durations.push(M.seconds(count, s.fps));
        }
        const output = path.join(root, profile.id + "." + profile.extension);
        const originalEncode = engine.encode;
        engine.encode = () => {
          throw Error("Unexpected second video encoding");
        };
        try {
          await R.finishRender(
            engine,
            s,
            segments,
            output,
            profile.id,
            undefined,
            true,
            durations,
          );
        } finally {
          engine.encode = originalEncode;
        }
        const result = await engine.probe(output);
        const data = JSON.parse(
            (
              await engine.run(engine.ffprobe, [
                "-v",
                "error",
                "-count_frames",
                "-show_streams",
                "-of",
                "json",
                output,
              ])
            ).stdout,
          ),
          video = data.streams.find((x) => x.codec_type === "video"),
          audio = data.streams.find((x) => x.codec_type === "audio");
        assert.equal(Number(video.nb_read_frames), 19, profile.id);
        assert(
          Math.abs(result.duration - M.seconds(19, s.fps)) < 0.04,
          profile.id + " duration",
        );
        assert(audio, profile.id + " sound");
        assert.equal(video.color_transfer, "bt709");
        if (profile.id !== "h264")
          assert.match(video.pix_fmt, /10|12/, profile.id + " pixel format");
        if (profile.id === "hevc") assert.equal(video.codec_tag_string, "hvc1");
        const decoded = path.join(root, profile.id + ".pcm");
        await engine.ff([
          "-y",
          "-i",
          output,
          "-map",
          "0:a:0",
          "-ar",
          "48000",
          "-ac",
          "1",
          "-f",
          "s16le",
          decoded,
        ]);
        const pcm = await fs.readFile(decoded);
        assert(pcm.some((b) => b !== 0));
        assert(
          Math.abs(pcm.length / 2 / 48000 - M.seconds(19, s.fps)) < 0.05,
          "audio duration " + profile.id,
        );
        measured.push({
          id: profile.id,
          codec: video.codec_name,
          pixels: video.pix_fmt,
          frames: Number(video.nb_read_frames),
          duration: result.duration,
          bytes: (await fs.stat(output)).size,
        });
      }
      console.log("Verified codec matrix:", JSON.stringify(measured));
    } finally {
      engine.stop();
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  },
);
