// Film livré : son et gel de l'export, sixième passe (29/09/2026), sur de
// vrais fichiers et de vrais rendus FFmpeg :
// - l'export d'un MPEG-PS (.mpg, .vob) à son MP2 se bloquait sans fin,
//   FFmpeg à 0 % du processeur, dès que deux plans son d'un même segment
//   tombaient sur un -ss où le décodeur rend une trame parasite ;
// - un export dont FFmpeg ne progresse plus n'avait aucun garde-fou (et
//   le garde-fou ne doit pas couper l'écriture finale du fichier, sans
//   suivi, d'un long film) ;
// - le son d'un MPEG-TS qui commence après l'image partait trop tôt pendant
//   le premier segment, puis se recalait au suivant ;
// - un MPEG-TS à deux pistes son prenait son zéro sur la piste que l'aperçu
//   ne sert pas : film décalé d'environ six images sur chaque plan ; les
//   aperçus fabriqués avant, qui servent une autre piste, sont refaits.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs");
const nativeRoot = path.join(__dirname, "../native", process.platform + "-" + process.arch),
  colorRoot = path.join(__dirname, "../public/video-color"),
  exe = process.platform === "win32" ? ".exe" : "",
  ffmpeg = path.join(nativeRoot, "ffmpeg" + exe),
  ffprobe = path.join(nativeRoot, "ffprobe" + exe),
  skip = !fss.existsSync(ffmpeg),
  NTSC = { n: 30000, d: 1001 },
  RATE = 48000;
function sh(bin, args) {
  const r = spawnSync(bin, args, { maxBuffer: 1 << 28 });
  if (r.status) throw Error(args.join(" ").slice(0, 300) + "\n" + String(r.stderr).slice(-600));
  return r.stdout;
}
const probe = (file) =>
  JSON.parse(sh(ffprobe, ["-v", "error", "-show_entries", "stream=index,codec_type,start_time,channels", "-of", "json", file])).streams;
/** Le son d'un fichier, mono 48 kHz, en échantillons entiers. */
function pcm(file) {
  const b = sh(ffmpeg, ["-v", "error", "-i", file, "-map", "0:a", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"]);
  return Array.from({ length: b.length / 2 }, (_, i) => b.readInt16LE(i * 2));
}
/** Énergie moyenne du son entre deux instants (secondes). */
function energy(samples, from, to) {
  const a = Math.round(from * RATE),
    b = Math.min(samples.length, Math.round(to * RATE));
  let sum = 0;
  for (let i = a; i < b; i++) sum += Math.abs(samples[i]);
  return b > a ? sum / (b - a) : 0;
}
/** Début de chaque bip (seuil franchi après au moins 0,1 s de calme), en secondes. */
function bips(samples) {
  const out = [];
  let last = -1e9;
  samples.forEach((v, i) => {
    if (Math.abs(v) > 3000) {
      if (i - last > RATE / 10) out.push(i / RATE);
      last = i;
    }
  });
  return out;
}
/** Un plan son (piste 10) d'un média, dans le repère d'une séquence. */
function soundClip(asset, s, start, duration, inUs) {
  return { ...M.clip(asset, s, start, 10), component: "audio", audioRole: "voice", duration, inUs };
}
const sequence = (width, height, clips = []) => ({ ...M.sequence(), fps: NTSC, width, height, clips });
async function describe(engine, file) {
  return { id: "a", name: path.basename(file), ...(await engine.probe(file)), inputSpace: "rec709" };
}
/** Rend un segment, borné dans le temps : `false` s'il a fallu l'arrêter. */
async function renderWithin(options, target, ms) {
  const ac = new AbortController(),
    timer = setTimeout(() => ac.abort(), ms);
  try {
    await R.renderSegment(options, target, ac.signal);
    return true;
  } catch (e) {
    if (ac.signal.aborted) return false;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

test(
  "MPEG-PS à son MP2 : deux plans son d'un segment, dont l'un tombe sur un -ss où le décodeur rend une trame parasite, se rendent sans bloquer et gardent chacun leur son",
  { skip, timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-son-ps-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const file = path.join(root, "rush.mpg");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30000/1001:d=40", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=40", "-ac", "1", "-c:v", "mpeg2video", "-b:v", "2M", "-g", "15", "-bf", "2", "-c:a", "mp2", "-f", "vob", file]);
      // Les -ss où le décodeur MP2 rend une trame d'un autre format (FFmpeg
      // reconstruit alors le graphe qui la reçoit).
      const parasites = [];
      for (let i = 0; i < 200 && parasites.length < 2; i++) {
        const ss = +(0.5 + i * 0.19).toFixed(6),
          r = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-v", "info", "-ss", String(ss), "-t", "0.4", "-i", file, "-map", "0:a", "-af", "anull", "-f", "null", "-"]);
        if (/Reconfiguring/.test(String(r.stderr))) parasites.push(ss);
      }
      assert(parasites.length > 0, "le rush d'essai doit contenir un -ss à trame parasite");
      const asset = await describe(engine, file),
        shift = await engine.seekShift(file),
        period = asset.fps.d / asset.fps.n;
      for (const hit of parasites) {
        const s = sequence(320, 180);
        // A : court, lu proprement ; B : son -ss tombe sur la trame parasite.
        s.clips = [soundClip(asset, s, 0, 10, 5e6), soundClip(asset, s, 20, 60, Math.round((hit - shift + period + 0.001) * 1e6))];
        const options = { engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 90 },
          built = await R.buildSegment(options),
          at = built.inputs.map((x, i) => (x === "-ss" ? Number(built.inputs[i + 1]) : null)).filter((x) => x !== null);
        assert(at.some((x) => Math.abs(x - hit) < 1e-6), `le plan B est lu depuis ${hit} s : ${at}`);
        const out = path.join(root, `segment-${hit}.mov`);
        assert(await renderWithin(options, out, 30000), `le segment dont un plan son est lu depuis ${hit} s ne doit pas bloquer`);
        const sound = pcm(out),
          frame = 1001 / 30000;
        assert.equal(sound.length, Math.round(90 * frame * RATE));
        assert(energy(sound, 0.01, 10 * frame - 0.01) > 1000, "le plan A a son son");
        assert(energy(sound, 10 * frame + 0.01, 20 * frame - 0.01) < 5, "silence entre les deux plans");
        assert(energy(sound, 20 * frame + 0.08, 80 * frame - 0.01) > 1000, "le plan B a son son");
        assert(energy(sound, 80 * frame + 0.01, 90 * frame) < 5, "silence après le plan B");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "un plan son qui ne rend aucune trame (point d'entrée après la fin du son) rend du silence de la bonne durée, à côté d'un plan qui a son son",
  { skip, timeout: 120000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-son-vide-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      // Image de 6 s, son de 2 s : un plan son ouvert à 4 s ne lit rien.
      const file = path.join(root, "court.ts");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=6", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=2", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a", "mp2", "-f", "mpegts", file]);
      const asset = await describe(engine, file),
        s = sequence(160, 90);
      s.clips = [soundClip(asset, s, 0, 20, 500000), soundClip(asset, s, 30, 40, 4e6)];
      const out = path.join(root, "segment.mov");
      assert(await renderWithin({ engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 90 }, out, 30000), "le segment se rend");
      const sound = pcm(out),
        frame = 1001 / 30000;
      assert.equal(sound.length, Math.round(90 * frame * RATE));
      assert(energy(sound, 0.01, 20 * frame - 0.01) > 1000);
      assert(energy(sound, 20 * frame + 0.01, 90 * frame) < 5);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "son d'un MPEG-TS qui commence après l'image : chaque bip tombe au film où il tombe sous l'image, dans tous les segments, lu depuis le début du fichier ou avec un -ss d'avant le son",
  { skip, timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-son-apres-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const frame = 1001 / 30000;
      for (const [late, inUs] of [
        [0.2, 0],
        [0.6, 400000],
      ]) {
        // Bips de 50 ms à 1 kHz aux instants 1 et 3 s DU SON, qui commence
        // `late` secondes après l'image.
        const file = path.join(root, `son-apres-${late}.mts`);
        sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=5", "-itsoffset", String(late), "-f", "lavfi", "-i", "aevalsrc='if(gte(mod(t\\,2)\\,1)*lt(mod(t\\,2)\\,1.05)\\,sin(2*PI*1000*t)\\,0)':s=48000:d=4.5:c=stereo", "-map", "0:v", "-map", "1:a", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a", "ac3", "-b:a", "192k", "-f", "mpegts", file]);
        const streams = probe(file),
          v0 = Number(streams.find((x) => x.codec_type === "video").start_time),
          a0 = Number(streams.find((x) => x.codec_type === "audio").start_time);
        assert(a0 - v0 > late - 0.02, `le son commence après l'image : ${a0 - v0}`);
        const asset = await describe(engine, file),
          s = sequence(160, 90);
        s.clips = [soundClip(asset, s, 0, 120, inUs)];
        // Instants des bips au montage : ceux du son décodé depuis son début
        // (l'AC-3 les retarde de quelques millisecondes), comptés depuis le
        // zéro du moniteur, ici le début de l'image, puis depuis l'entrée.
        const expected = bips(pcm(file))
          .map((x) => x + (a0 - v0) - inUs / 1e6)
          .filter((x) => x > 0 && x < 120 * frame);
        assert.equal(expected.length, 2);
        const heard = [];
        for (const [start, count] of [
          [0, 60],
          [60, 60],
        ]) {
          const out = path.join(root, `seg-${late}-${start}.mov`);
          await R.renderSegment({ engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start, count }, out);
          heard.push(...bips(pcm(out)).map((t) => t + start * frame));
        }
        assert.equal(heard.length, expected.length, `bips entendus ${heard} contre ${expected}`);
        heard.forEach((t, i) =>
          assert(Math.abs(t - expected[i]) < 0.003, `son ${late} s après l'image, entrée à ${inUs / 1e6} s : bip au film à ${t.toFixed(4)} s, attendu à ${expected[i].toFixed(4)} s`),
        );
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "MPEG-TS à deux pistes son : le zéro du moniteur ne compte que l'image et la piste que prend le rendu, et l'aperçu sert explicitement cette piste",
  { skip, timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-deux-sons-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      // Première piste : AC-3 5.1 (300 Hz) qui commence avec l'image, 0,2 s
      // après une piste MP2 stéréo (600 Hz) ; puis l'inverse, où FFmpeg
      // aurait servi à l'aperçu la seconde piste (plus de canaux).
      const layouts = {
        "ac3-premiere": [
          ["-itsoffset", "0.2", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=3"],
          ["-f", "lavfi", "-i", "sine=f=600:r=48000:d=3.2"],
          ["-c:a:0", "ac3", "-ac:a:0", "6", "-c:a:1", "mp2", "-ac:a:1", "2"],
          600,
          300,
        ],
        "mp2-premiere": [
          ["-f", "lavfi", "-i", "sine=f=600:r=48000:d=3.2"],
          ["-itsoffset", "0.2", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=3"],
          ["-c:a:0", "mp2", "-ac:a:0", "2", "-c:a:1", "ac3", "-ac:a:1", "6"],
          1200,
          600,
        ],
      };
      for (const [name, [first, second, codecs, crossings]] of Object.entries(layouts)) {
        const file = path.join(root, name + ".mts");
        sh(ffmpeg, ["-v", "error", "-y", "-itsoffset", "0.2", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=3", ...first, ...second, "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", ...codecs, "-f", "mpegts", file]);
        const streams = probe(file),
          v = streams.find((x) => x.codec_type === "video"),
          [a0, a1] = streams.filter((x) => x.codec_type === "audio");
        assert(Math.abs(Number(a1.start_time) - Number(a0.start_time)) > 0.15, name + " : les deux pistes ne commencent pas ensemble");
        const track = await engine.videoTrack(file);
        assert(
          Math.abs(track.start - Math.min(Number(v.start_time), Number(a0.start_time))) < 1e-6,
          `${name} : zéro ${track.start}, image ${v.start_time}, première piste ${a0.start_time}, seconde ${a1.start_time}`,
        );
        const asset = await describe(engine, file),
          proxy = path.join(root, name + "-apercu.mp4");
        await engine.proxy(file, asset, proxy);
        // Le zéro de l'aperçu : l'instant du rush qui y tombe à 0.
        const px = probe(proxy),
          zero = Number(v.start_time) - Number(px.find((x) => x.codec_type === "video").start_time);
        assert(Math.abs(zero - track.start) < 0.002, `${name} : zéro de l'aperçu ${zero}, du moteur ${track.start}`);
        assert(Math.abs(track.lead - (Number(v.start_time) - track.start)) < 1e-6);
        // L'aperçu sert la première piste : sa tonalité (passages par zéro
        // sur une seconde).
        const sound = pcm(proxy);
        let zc = 0;
        for (let i = RATE + 1; i < 2 * RATE; i++) if (sound[i] >= 0 !== sound[i - 1] >= 0) zc++;
        assert(Math.abs(zc - crossings) < 20, `${name} : l'aperçu sert la piste à ${zc / 2} Hz`);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

/**
 * Un faux FFmpeg : figé (blocs de suivi immobiles), muet, lent mais qui
 * avance, ou qui finit son fichier (« final ») : plus aucun suivi pendant
 * 3 s, comme FFmpeg quand il recopie tout le fichier pour « +faststart »,
 * mais le fichier de sortie (dernier argument) grossit.
 */
async function fakeFfmpeg(dir) {
  const file = path.join(dir, "ffmpeg" + exe);
  await fs.writeFile(
    file,
    `#!${process.execPath}
const mode = process.env.JUNO_FAUX_FFMPEG || "fige";
let frame = 3, blocks = 0;
const block = () => process.stdout.write("frame=" + frame + "\\nfps=" + Math.random().toFixed(2) + "\\nout_time_us=" + frame * 33367 + "\\ntotal_size=" + frame * 1000 + "\\nspeed=" + Math.random().toFixed(3) + "x\\nprogress=continue\\n");
if (mode === "muet") setInterval(() => {}, 1000);
else if (mode === "final") {
  const out = process.argv[process.argv.length - 1];
  let n = 0;
  setInterval(() => {
    n++;
    if (n <= 6) {
      frame++;
      block();
    } else require("fs").appendFileSync(out, "x".repeat(4096));
    if (n >= 36) { process.stdout.write("frame=" + frame + "\\nprogress=end\\n"); process.exit(0); }
  }, 100);
} else setInterval(() => {
  blocks++;
  if (mode === "lent" && blocks % 6 === 0) frame++;
  if (mode === "lent" && blocks >= 36) { process.stdout.write("frame=" + frame + "\\nprogress=end\\n"); process.exit(0); }
  block();
}, 100);
`,
  );
  await fs.chmod(file, 0o755);
  return file;
}
/** Attend une promesse au plus `ms` : `"attente"` si elle n'a pas abouti. */
const within = (promise, ms) =>
  Promise.race([
    promise.then(
      () => "fini",
      (e) => e,
    ),
    new Promise((r) => setTimeout(() => r("attente"), ms)),
  ]);

test(
  "garde-fou de l'export : un FFmpeg figé ou muet est arrêté au bout du délai avec un message clair, un FFmpeg lent qui avance ne l'est jamais",
  { skip: process.platform === "win32", timeout: 60000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-garde-fou-")),
      previous = process.env.JUNO_FAUX_FFMPEG;
    try {
      await fakeFfmpeg(root);
      const engine = new Engine({ nativeRoot: root, colorRoot }),
        ac = new AbortController();
      try {
        const output = path.join(root, "y.mov");
        for (const mode of ["fige", "muet"]) {
          process.env.JUNO_FAUX_FFMPEG = mode;
          const t0 = Date.now(),
            r = await within(engine.ff(["-y", "-i", "x", output], { signal: ac.signal, stall: 1000, output }), 8000);
          assert(r instanceof Error, `FFmpeg ${mode} : ${r}`);
          assert.equal(r.code, "JUNO_STALL");
          assert.match(r.message, /n’avançait plus depuis 1 s/);
          assert(Date.now() - t0 < 4000, `arrêté en ${Date.now() - t0} ms`);
        }
        // Lent : une image toutes les 0,6 s pendant 3,6 s, délai de 1 s.
        process.env.JUNO_FAUX_FFMPEG = "lent";
        const t0 = Date.now();
        assert.equal(await within(engine.ff(["-y", "-i", "x", output], { signal: ac.signal, stall: 1000, output }), 12000), "fini");
        assert(Date.now() - t0 > 3000, "le rendu lent a tourné jusqu'au bout");
        // L'écriture finale du fichier (« +faststart ») : 3 s sans suivi,
        // délai de 1 s, mais le fichier s'écrit. Elle n'est pas coupée.
        process.env.JUNO_FAUX_FFMPEG = "final";
        await fs.rm(output, { force: true });
        const t1 = Date.now(),
          last = await within(engine.ff(["-y", "-i", "x", output], { signal: ac.signal, stall: 1000, output }), 12000);
        assert.equal(last, "fini", `écriture finale sans suivi : ${last}`);
        assert(Date.now() - t1 > 3000 && (await fs.stat(output)).size >= 29 * 4096, "le fichier a été écrit jusqu'au bout");
        // Une mise en veille de dix minutes pendant le rendu (l'horloge saute)
        // ne le fait pas passer pour figé.
        process.env.JUNO_FAUX_FFMPEG = "lent";
        const now = Date.now;
        try {
          const run = engine.ff(["-y", "-i", "x", output], { signal: ac.signal, stall: 1000 });
          setTimeout(() => (Date.now = () => now() + 600000), 900);
          assert.equal(await within(run, 12000), "fini");
        } finally {
          Date.now = now;
        }
        // Le rendu d'un segment passe par le garde-fou.
        process.env.JUNO_FAUX_FFMPEG = "fige";
        engine.stallFloor = 1000;
        const source = path.join(root, "rush.mov");
        await fs.writeFile(source, "");
        const asset = { id: "a", kind: "video", duration: 10, fps: NTSC, width: 160, height: 90, audioChannels: 2, inputSpace: "rec709" },
          s = sequence(160, 90);
        s.clips = [{ ...M.clip(asset, s, 0), component: "video", duration: 30 }, soundClip(asset, s, 0, 30, 0)];
        const r = await within(R.renderSegment({ engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source } }, cache: root, start: 0, count: 30 }, path.join(root, "seg.mov"), ac.signal), 8000);
        assert(r instanceof Error && r.code === "JUNO_STALL", `rendu d'un segment : ${r}`);
      } finally {
        ac.abort();
      }
      // Le délai : jamais moins de cinq minutes, et bien plus long pour un
      // plan 4K au débruitage fort (une image toutes les quelques secondes).
      const light = { id: "a", kind: "video", width: 1920, height: 1080 },
        heavy = { id: "a", kind: "video", width: 3840, height: 2160 },
        s = sequence(1920, 1080);
      s.clips = [{ ...M.clip(light, s, 0), duration: 250 }];
      assert.equal(R.stallLimit({ engine: {}, sequence: s, assets: new Map([["a", light]]), start: 0, count: 250 }), R.STALL_FLOOR);
      assert.equal(R.STALL_FLOOR, 5 * 60 * 1000);
      s.clips = [{ ...M.clip(heavy, s, 0), duration: 250, denoise: "strong", stabilise: 1, smoothSlow: true, speed: 0.5 }];
      assert(R.stallLimit({ engine: {}, sequence: s, assets: new Map([["a", heavy]]), start: 0, count: 250 }) > 60 * 60 * 1000);
    } finally {
      if (previous === undefined) delete process.env.JUNO_FAUX_FFMPEG;
      else process.env.JUNO_FAUX_FFMPEG = previous;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "garde-fou de l'export : la tâche d'un export figé finit en échec, avec l'endroit du montage, et garde de quoi reprendre",
  { skip: skip || process.platform === "win32", timeout: 180000 },
  async () => {
    const { registerVideo } = require("../electron/video/index.cjs");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-garde-fou-tache-")),
      video = {},
      api = {},
      events = {},
      previous = process.env.JUNO_FAUX_FFMPEG;
    let picked = [];
    const saved = path.join(root, "film.mp4");
    try {
      Object.assign(video, await registerVideo({
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
      }));
      const { engine } = video,
        file = path.join(root, "camera.mov");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=12", "-vf", "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709", "-c:v", "mpeg4", "-q:v", "5", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+write_colr", file]);
      const p = await api["video-create"]({ name: "Garde-fou" });
      picked = [file];
      let j = await api["video-import"](p.id);
      for (let i = 0; i < 600 && !["done", "failed"].includes(api["video-list"]().jobs.find((x) => x.id === j.id).state); i++) await new Promise((r) => setTimeout(r, 100));
      const asset = api["video-project"](p.id).assets[0];
      assert.equal(asset?.status, "ready");
      const s = { ...api["video-project"](p.id).sequences[0], fps: NTSC, width: 160, height: 90 };
      s.clips = [{ ...M.clip(asset, s, 0), component: "video", duration: 300 }];
      // Le rendu du second segment se fige.
      const real = engine.ffmpeg,
        fake = await fakeFfmpeg(await fs.mkdtemp(path.join(root, "faux-"))),
        render = R.renderSegment;
      process.env.JUNO_FAUX_FFMPEG = "fige";
      R.renderSegment = async (options, target, signal) => {
        const frozen = options.start >= 250;
        engine.ffmpeg = frozen ? fake : real;
        engine.stallFloor = frozen ? 1000 : undefined;
        try {
          return await render(options, target, signal);
        } finally {
          engine.ffmpeg = real;
          engine.stallFloor = undefined;
        }
      };
      try {
        j = await api["video-export"]({ projectId: p.id, sequence: s, codec: "h264", overlays: [] });
        let job;
        for (let i = 0; i < 300; i++) {
          job = api["video-list"]().jobs.find((x) => x.id === j.id);
          if (["done", "failed", "cancelled"].includes(job.state)) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        assert.equal(job.state, "failed", JSON.stringify(job));
        assert.match(job.error, /^Export arrêté au segment 2 sur 2, vers 00:08 du montage : le moteur vidéo n’avançait plus depuis 1 s\. Reprenez l’export, il repartira de ce segment/);
        assert.equal(job.cursor, 1, "le premier segment rendu est gardé");
      } finally {
        R.renderSegment = render;
        engine.ffmpeg = real;
      }
    } finally {
      // Rien ne doit continuer à tourner, même si le garde-fou a manqué.
      events["will-quit"]?.();
      if (previous === undefined) delete process.env.JUNO_FAUX_FFMPEG;
      else process.env.JUNO_FAUX_FFMPEG = previous;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "aperçus fabriqués avant la correction : celui d'un MPEG-TS dont la piste son servie n'est pas la première est refait au démarrage, les autres sont seulement marqués",
  { skip, timeout: 180000 },
  async () => {
    const { registerVideo } = require("../electron/video/index.cjs");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-apercus-anciens-")),
      catalog = path.join(root, "Video Studio", "catalog.json");
    let picked = [];
    const open = async () => {
      const api = {},
        events = {},
        video = await registerVideo({
          handle: (name, fn) => (api[name] = fn),
          app: { getPath: () => root, getVersion: () => "0.0.0-test", on: (name, fn) => (events[name] = fn) },
          dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: picked }), showSaveDialog: async () => ({ canceled: true }) },
          protocol: { handle: () => {} },
          getWindow: () => undefined,
          nativeRoot,
          colorRoot,
        });
      return { api, video, quit: () => events["will-quit"]?.() };
    };
    const settle = async (api) => {
      for (let i = 0; i < 900; i++) {
        const jobs = api["video-list"]().jobs;
        if (jobs.every((j) => ["done", "failed", "cancelled", "interrupted"].includes(j.state))) return jobs;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw Error("les tâches ne finissent pas");
    };
    let session;
    try {
      // Deux pistes son : la première (MP2 stéréo, 600 Hz) commence avec
      // l'image, la seconde (AC-3 5.1, 300 Hz) 0,2 s avant. Sans « -map »,
      // FFmpeg servait la seconde (plus de canaux) : l'aperçu gardait son
      // zéro, 0,2 s avant celui du moteur. Et une seule piste son à côté.
      const twin = path.join(root, "deux-pistes.mts"),
        single = path.join(root, "une-piste.mts");
      sh(ffmpeg, ["-v", "error", "-y", "-itsoffset", "0.2", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=3", "-itsoffset", "0.2", "-f", "lavfi", "-i", "sine=f=600:r=48000:d=3", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=3.2", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a:0", "mp2", "-ac:a:0", "2", "-c:a:1", "ac3", "-ac:a:1", "6", "-f", "mpegts", twin]);
      sh(ffmpeg, ["-v", "error", "-y", "-itsoffset", "0.2", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=3", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=3.2", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a", "ac3", "-ac", "6", "-f", "mpegts", single]);
      session = await open();
      const p = await session.api["video-create"]({ name: "Anciens aperçus" });
      picked = [twin, single];
      await session.api["video-import"](p.id);
      await settle(session.api);
      const assets = session.api["video-project"](p.id).assets,
        byName = (n) => assets.find((a) => a.name === n);
      assert.equal(byName("deux-pistes.mts")?.status, "ready");
      assert.equal(byName("une-piste.mts")?.status, "ready");
      const { engine } = session.video;
      const media = JSON.parse(await fs.readFile(catalog, "utf8")).media,
        twinMedia = media[byName("deux-pistes.mts").id],
        singleMedia = media[byName("une-piste.mts").id];
      // Marqué de la règle de la piste son et de la version du fichier
      // (septième passe, 30/09/2026 : il l'était de « proxyTrack »).
      assert.match(twinMedia.proxySound ?? "", /^premiere-utilisable\|/, "un aperçu neuf est marqué");
      session.quit();
      // L'état d'avant la correction : l'aperçu du fichier à deux pistes
      // refait sans « -map », et aucun des deux marqué.
      sh(ffmpeg, ["-v", "error", "-y", "-i", twin, "-vf", "scale=160:90", "-t", "3", "-enc_time_base:v", "demux", ...engine.encode(), "-c:a", "aac", "-ac", "2", "-ar", "48000", "-movflags", "+faststart", twinMedia.proxy]);
      const track = await engine.videoTrack(twin),
        begins = (file) => Number(probe(file).find((x) => x.codec_type === "video").start_time);
      assert(Math.abs(begins(twinMedia.proxy) - track.lead) > 0.1, `l'ancien aperçu est décalé : ${begins(twinMedia.proxy)} contre ${track.lead}`);
      const untouched = (await fs.stat(singleMedia.proxy)).mtimeMs,
        data = JSON.parse(await fs.readFile(catalog, "utf8"));
      for (const m of Object.values(data.media)) delete m.proxySound;
      await fs.writeFile(catalog, JSON.stringify(data));
      // Au démarrage suivant.
      session = await open();
      await session.video.healed;
      const jobs = await settle(session.api),
        rebuilt = jobs.filter((j) => j.kind === "proxy");
      assert.equal(rebuilt.length, 1, JSON.stringify(jobs));
      assert.equal(rebuilt[0].state, "done", JSON.stringify(rebuilt[0]));
      assert.equal(rebuilt[0].label, "Refaire l’aperçu");
      const after = JSON.parse(await fs.readFile(catalog, "utf8")).media;
      assert.equal(after[byName("deux-pistes.mts").id].proxySound, twinMedia.proxySound);
      assert.equal(after[byName("une-piste.mts").id].proxySound, singleMedia.proxySound, "l'autre aperçu est marqué");
      assert.equal((await fs.stat(singleMedia.proxy)).mtimeMs, untouched, "sans être refait");
      assert(Math.abs(begins(twinMedia.proxy) - track.lead) < 0.002, `aperçu refait : ${begins(twinMedia.proxy)} contre ${track.lead}`);
      // Il sert la première piste (600 Hz), celle du film.
      const sound = pcm(twinMedia.proxy);
      let zc = 0;
      for (let i = RATE + 1; i < 2 * RATE; i++) if (sound[i] >= 0 !== sound[i - 1] >= 0) zc++;
      assert(Math.abs(zc - 1200) < 20, `l'aperçu refait sert la piste à ${zc / 2} Hz`);
      // Le profil couleur n'est pas pour autant confirmé à la place de
      // l'utilisateur.
      const asset = session.api["video-project"](p.id).assets.find((a) => a.name === "deux-pistes.mts");
      assert.equal(asset.spaceConfirmed, byName("deux-pistes.mts").spaceConfirmed);
      assert.equal(asset.status, "ready");
    } finally {
      session?.quit();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);
