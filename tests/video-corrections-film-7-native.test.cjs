// Film livré, septième passe (30/09/2026), sur de vrais fichiers, de vrais
// rendus FFmpeg et une vraie image disque exFAT :
// - le garde-fou de l'export coupait l'assemblage final d'un film livré sur
//   un disque exFAT : pendant la réécriture en place de « +faststart », ni le
//   suivi de FFmpeg, ni la taille, ni la date du fichier n'y bougent ;
// - un MPEG-TS dont la première piste son est déclarée mais vide (TNT,
//   satellite) ne s'importait plus, et la tâche « Refaire l'aperçu » d'un
//   projet importé avant échouait à chaque lancement : la piste son de l'app
//   est la première UTILISABLE, partout ;
// - un aperçu fabriqué avant, qui servait la seconde piste son (marquée « par
//   défaut »), n'était pas refait : le moniteur faisait entendre une autre
//   piste que le film ;
// - un MPEG-PS dont la définition change en cours de fichier bloquait le
//   rendu d'un segment de deux plans.
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
  FRAME = 1001 / 30000,
  RATE = 48000;
function sh(bin, args) {
  const r = spawnSync(bin, args, { maxBuffer: 1 << 28 });
  if (r.status) throw Error(args.join(" ").slice(0, 300) + "\n" + String(r.stderr).slice(-600));
  return r.stdout;
}
const streams = (file) =>
  JSON.parse(sh(ffprobe, ["-v", "error", "-show_entries", "stream=index,codec_type,start_time,channels,width,height", "-of", "json", file])).streams;
/** Le son d'un fichier (sa première piste son), mono 48 kHz, en échantillons entiers. */
function pcm(file, map = "0:a:0") {
  const b = sh(ffmpeg, ["-v", "error", "-i", file, "-map", map, "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"]);
  return Array.from({ length: b.length / 2 }, (_, i) => b.readInt16LE(i * 2));
}
/**
 * Le son d'un fichier sur sa propre ligne de temps (l'échantillon 0 à
 * l'instant 0 du fichier, silence devant un son qui commence plus tard),
 * mono 48 kHz : ce qu'entend le lecteur du moniteur.
 */
function pcmTimeline(file) {
  const b = sh(ffmpeg, ["-v", "error", "-copyts", "-i", file, "-map", "0:a:0", "-af", "aresample=48000:async=1:first_pts=0", "-ac", "1", "-f", "s16le", "-"]);
  return Array.from({ length: b.length / 2 }, (_, i) => b.readInt16LE(i * 2));
}
/** La tonalité d'un son entre deux instants : passages par zéro par seconde, divisés par deux. */
function tone(samples, from = 0.5, to = 1.5) {
  let zc = 0;
  for (let i = Math.round(from * RATE) + 1; i < Math.round(to * RATE); i++) if (samples[i] >= 0 !== samples[i - 1] >= 0) zc++;
  return zc / 2 / (to - from);
}
/** Énergie moyenne du son entre deux instants (secondes). */
function energy(samples, from, to) {
  const a = Math.round(from * RATE),
    b = Math.min(samples.length, Math.round(to * RATE));
  let sum = 0;
  for (let i = a; i < b; i++) sum += Math.abs(samples[i]);
  return b > a ? sum / (b - a) : 0;
}
/** Le choix de FFmpeg sans « -map » : le flux son qu'il sert, ou null. */
function automatic(file) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-v", "info", "-i", file, "-c", "copy", "-t", "0", "-f", "null", "-"]),
    kinds = new Map(streams(file).map((s) => [s.index, s.codec_type]));
  return [...String(r.stderr).matchAll(/Stream #0:(\d+) -> #0:\d+/g)].map((m) => Number(m[1])).find((i) => kinds.get(i) === "audio") ?? null;
}
const sequence = (width, height, clips = []) => ({ ...M.sequence(), fps: NTSC, width, height, clips });
async function describe(engine, file, id = "a") {
  return { id, name: path.basename(file), ...(await engine.probe(file)), inputSpace: "rec709" };
}
function soundClip(asset, s, start, duration, inUs) {
  return { ...M.clip(asset, s, start, 10), component: "audio", audioRole: "voice", duration, inUs };
}
function pictureClip(asset, s, start, duration, inUs) {
  return { ...M.clip(asset, s, start, 1), component: "video", duration, inUs };
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
/** Bips de 50 ms à 1 kHz toutes les deux secondes, à partir de 1 s. */
const BIPS = "aevalsrc='if(gte(mod(t\\,2)\\,1)*lt(mod(t\\,2)\\,1.05)\\,sin(2*PI*1000*t)\\,0)':s=48000:c=stereo";
/** L'application, ouverte sur un profil jetable (`root`). */
async function openApp(root, picked) {
  const { registerVideo } = require("../electron/video/index.cjs"),
    api = {},
    events = {},
    video = await registerVideo({
      handle: (name, fn) => (api[name] = fn),
      app: { getPath: () => root, getVersion: () => "0.0.0-test", on: (name, fn) => (events[name] = fn) },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: picked() }), showSaveDialog: async () => ({ canceled: true }) },
      protocol: { handle: () => {} },
      getWindow: () => undefined,
      nativeRoot,
      colorRoot,
    });
  return { api, video, quit: () => events["will-quit"]?.() };
}
async function settle(api) {
  for (let i = 0; i < 1200; i++) {
    const jobs = api["video-list"]().jobs;
    if (jobs.every((j) => ["done", "failed", "cancelled", "interrupted"].includes(j.state))) return jobs;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("les tâches ne finissent pas");
}
/** L'aperçu tel que le fabriquait l'application avant le 29/09/2026 : sans « -map ». */
function oldProxy(engine, file, target) {
  sh(ffmpeg, ["-v", "error", "-y", "-i", file, "-vf", "scale=160:90", "-enc_time_base:v", "demux", ...engine.encode(), "-c:a", "aac", "-ac", "2", "-ar", "48000", "-movflags", "+faststart", target]);
}

/**
 * Un faux FFmpeg qui travaille comme le vrai sur un assemblage : il écrit son
 * fichier en donnant son suivi, puis le réécrit EN PLACE sans plus rien dire
 * pendant `JUNO_FAUX_REECRITURE` ms, comme « +faststart » (libavformat,
 * `ff_format_shift_data` : blocs relus et réécrits dans le fichier, qui ne
 * grandit qu'à la fin), avant son bloc final. « fige » : blocs de suivi
 * immobiles, sans fin.
 */
async function fakeFfmpeg(dir) {
  const file = path.join(dir, "ffmpeg" + exe);
  await fs.writeFile(
    file,
    `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2), out = args[args.length - 1], input = args[args.indexOf("-i") + 1];
const mode = process.env.JUNO_FAUX_FFMPEG || "faststart", hold = Number(process.env.JUNO_FAUX_REECRITURE || 3000);
let frame = 0;
const block = (end) => process.stdout.write("frame=" + frame + "\\nout_time_us=" + frame * 33367 + "\\ntotal_size=" + frame * 4096 + "\\nprogress=" + (end ? "end" : "continue") + "\\n");
if (mode === "fige") setInterval(block, 100);
else {
  const data = /\\.txt$/.test(input) ? Buffer.alloc(4 << 20, 7) : fs.readFileSync(input);
  const fd = fs.openSync(out, "w+"), CHUNK = 256 << 10;
  let pos = 0;
  const copy = () => {
    if (pos < data.length) {
      fs.writeSync(fd, data, pos, Math.min(CHUNK, data.length - pos), pos);
      pos += CHUNK;
      frame++;
      block();
      return setTimeout(copy, 30);
    }
    const t0 = Date.now(), moov = Buffer.from("moov".repeat(1024)), b = Buffer.alloc(CHUNK);
    let at = 0;
    const shift = () => {
      if (Date.now() - t0 < hold) {
        const n = fs.readSync(fd, b, 0, CHUNK, at);
        fs.writeSync(fd, b, 0, n, at);
        at = (at + CHUNK) % data.length;
        return setTimeout(shift, 10);
      }
      const all = Buffer.alloc(data.length);
      fs.readSync(fd, all, 0, data.length, 0);
      fs.writeSync(fd, moov, 0, moov.length, 0);
      fs.writeSync(fd, all, 0, all.length, moov.length);
      fs.closeSync(fd);
      block(true);
      process.exit(0);
    };
    shift();
  };
  copy();
}
`,
  );
  await fs.chmod(file, 0o755);
  return file;
}
/** Une image disque exFAT montée, le temps de `run`. */
async function withExfat(root, run) {
  const image = path.join(root, "disque.dmg"),
    mount = path.join(await fs.realpath(root), "disque");
  await fs.mkdir(mount);
  sh("hdiutil", ["create", "-quiet", "-size", "96m", "-fs", "ExFAT", "-volname", "JUNOEXFAT", "-layout", "NONE", image]);
  sh("hdiutil", ["attach", "-quiet", "-nobrowse", "-noverify", "-mountpoint", mount, image]);
  try {
    assert.match(String(sh("mount", [])).split("\n").find((l) => l.includes(" on " + mount + " ")) || "", /\(exfat/, "le volume d'essai est en exFAT");
    return await run(mount);
  } finally {
    spawnSync("hdiutil", ["detach", "-quiet", "-force", mount]);
  }
}

test(
  "assemblage final vers un disque exFAT : la réécriture en place de « +faststart », sans suivi ni changement visible du fichier, n'est jamais coupée ; un FFmpeg figé l'est toujours",
  { skip: skip || process.platform !== "darwin", timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-exfat-")),
      previous = { mode: process.env.JUNO_FAUX_FFMPEG, hold: process.env.JUNO_FAUX_REECRITURE };
    try {
      await withExfat(root, async (disk) => {
        const engine = new Engine({ nativeRoot, colorRoot });
        await engine.init();
        const real = engine.ffmpeg,
          fake = await fakeFfmpeg(root),
          s = sequence(160, 90);
        // Sur ce disque, une réécriture en place ne change ni la taille ni la
        // date vues par le système : ce que le garde-fou regardait.
        const probeFile = path.join(disk, "essai.bin");
        await fs.writeFile(probeFile, Buffer.alloc(4 << 20, 1));
        const before = await fs.stat(probeFile),
          fd = fss.openSync(probeFile, "r+");
        for (let i = 0; i < 16; i++) fss.writeSync(fd, Buffer.alloc(256 << 10, i), 0, 256 << 10, i * (256 << 10));
        const during = await fs.stat(probeFile);
        fss.closeSync(fd);
        await fs.rm(probeFile);
        const visible = during.size !== before.size || during.mtimeMs !== before.mtimeMs;
        // Deux segments de 2 s (le contenu importe peu au faux FFmpeg).
        const segments = [];
        for (const k of [0, 1]) {
          const seg = path.join(root, `segment-${k}.mov`);
          sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=2", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=2", ...engine.encode({ quality: "final", width: 160, height: 90, fps: NTSC }), "-c:a", "pcm_s24le", seg]);
          segments.push(seg);
        }
        const lengths = [2, 2];
        // 1. Le faux FFmpeg : 3 s de réécriture en place sans suivi, pour
        // l'assemblage puis pour le marquage H.264 (`tagH264`), délai de 1 s.
        engine.ffmpeg = fake;
        engine.stallFloor = 1000;
        process.env.JUNO_FAUX_FFMPEG = "faststart";
        process.env.JUNO_FAUX_REECRITURE = "3000";
        const film = path.join(disk, "film.mp4"),
          t0 = Date.now();
        let failure;
        await R.finishRender(engine, s, segments, film, "h264", undefined, true, lengths, {}).catch((e) => (failure = e));
        assert.equal(failure, undefined, `assemblage final sur exFAT (changement visible pendant la réécriture : ${visible}) : ${failure?.message}`);
        assert(Date.now() - t0 > 6000, "les deux réécritures ont duré ce qu'elles devaient");
        const written = await fs.readFile(film);
        assert.equal(written.length, (4 << 20) + 2 * 4096, "le film est écrit jusqu'au bout");
        assert.equal(written.toString("latin1", 0, 4), "moov");
        await fs.rm(film);
        // 2. Figé pendant l'assemblage : arrêté au bout du délai, même ici.
        process.env.JUNO_FAUX_FFMPEG = "fige";
        const t1 = Date.now();
        const stalled = await R.finishRender(engine, s, segments, film, "h264", undefined, true, lengths, {}).then(() => null, (e) => e);
        assert.equal(stalled?.code, "JUNO_STALL", String(stalled));
        assert(Date.now() - t1 < 5000, `arrêté en ${Date.now() - t1} ms`);
        await fs.rm(film, { force: true });
        // 3. Le vrai FFmpeg, garde-fou actif : le film livré sur exFAT est
        // complet, son index en tête (« +faststart »).
        engine.ffmpeg = real;
        await R.finishRender(engine, s, segments, film, "h264", undefined, true, lengths, {});
        const bytes = await fs.readFile(film),
          info = streams(film);
        assert(bytes.indexOf("moov") < bytes.indexOf("mdat"), "index en tête du film");
        assert.deepEqual(info.map((x) => x.codec_type).sort(), ["audio", "video"]);
        const seconds = Number(sh(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", film]).toString());
        assert(Math.abs(seconds - 4) < 0.05, `durée ${seconds}`);
      });
    } finally {
      for (const [k, v] of [["JUNO_FAUX_FFMPEG", previous.mode], ["JUNO_FAUX_REECRITURE", previous.hold]])
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "garde-fou : un FFmpeg qui se tait après avoir donné son suivi termine son fichier et n'est pas coupé, quel que soit le disque ; celui qui se tait dès le départ l'est",
  { skip: process.platform === "win32", timeout: 60000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-garde-fou-7-")),
      previous = { mode: process.env.JUNO_FAUX_FFMPEG, hold: process.env.JUNO_FAUX_REECRITURE };
    try {
      await fakeFfmpeg(root);
      const engine = new Engine({ nativeRoot: root, colorRoot }),
        input = path.join(root, "entree.bin"),
        output = path.join(root, "sortie.mp4");
      await fs.writeFile(input, Buffer.alloc(1 << 20, 3));
      // Réécriture de 2,5 s, délai de 1 s, sans rien dire au moteur du
      // fichier écrit (le garde-fou ne regarde plus le disque).
      process.env.JUNO_FAUX_FFMPEG = "faststart";
      process.env.JUNO_FAUX_REECRITURE = "2500";
      await engine.ff(["-y", "-i", input, output], { stall: 1000 });
      assert.equal((await fs.stat(output)).size, (1 << 20) + 4096);
      // Muet dès le départ (aucun bloc de suivi) : arrêté.
      await fs.writeFile(path.join(root, "ffmpeg"), `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`);
      const t0 = Date.now(),
        e = await engine.ff(["-y", "-i", input, output], { stall: 1000 }).then(() => null, (x) => x);
      assert.equal(e?.code, "JUNO_STALL");
      assert(Date.now() - t0 < 4000);
    } finally {
      for (const [k, v] of [["JUNO_FAUX_FFMPEG", previous.mode], ["JUNO_FAUX_REECRITURE", previous.hold]])
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "MPEG-TS à première piste son vide, MOV à première piste son indécodable : la piste son de l'app est la première utilisable, la même pour la fiche, l'aperçu, l'onde, le zéro du moniteur et le film",
  { skip, timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-piste-vide-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      // TNT : la première piste son est déclarée mais ne reçoit aucun paquet
      // (0 canal) ; la seconde porte les bips, 0,2 s après l'image.
      const ts = path.join(root, "tnt.ts");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=6", "-itsoffset", "0.2", "-f", "lavfi", "-i", BIPS + ":d=5.5", "-map", "0:v", "-map", "1:a", "-map", "1:a", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a", "ac3", "-b:a", "192k", "-bsf:a:0", "noise=drop=1", "-f", "mpegts", ts]);
      const info = streams(ts),
        [empty, full] = info.filter((x) => x.codec_type === "audio");
      assert.equal(empty.channels, 0, "la première piste son est vide");
      assert.equal(full.channels, 2);
      const asset = await describe(engine, ts);
      assert.equal(asset.audioChannels, 2, "la fiche décrit la piste utilisable");
      assert.equal(asset.sampleRate, 48000);
      assert.equal((await engine.soundTrack(ts)).index, full.index);
      // L'aperçu se fabrique, et sert les bips.
      const proxy = path.join(root, "tnt-apercu.mp4");
      await engine.proxy(ts, asset, proxy);
      const monitor = pcmTimeline(proxy),
        at = (samples) => {
          const hits = [];
          let last = -1e9;
          samples.forEach((x, i) => {
            if (Math.abs(x) > 3000) {
              if (i - last > RATE / 10) hits.push(i / RATE);
              last = i;
            }
          });
          return hits;
        };
      assert(at(monitor).length >= 2, "l'aperçu fait entendre la piste utilisable");
      // L'onde est celle de cette piste.
      const wave = await engine.waveform(ts, asset.duration, { hz: 100 });
      assert(Math.max(...wave) > 0.1, "onde non vide");
      // Le zéro du moniteur : l'image et cette piste, comme l'aperçu.
      const track = await engine.videoTrack(ts),
        v = info.find((x) => x.codec_type === "video"),
        zero = Number(v.start_time) - Number(streams(proxy).find((x) => x.codec_type === "video").start_time);
      assert(Math.abs(zero - track.start) < 0.002, `zéro de l'aperçu ${zero}, du moteur ${track.start}`);
      assert(Math.abs(track.audioLead - (Number(full.start_time) - track.start)) < 1e-6);
      // Le film : un plan son de 4 s depuis le début fait entendre les bips
      // où le moniteur les fait entendre.
      const s = sequence(160, 90);
      s.clips = [soundClip(asset, s, 0, 120, 0)];
      const options = { engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: ts } }, cache: root, start: 0, count: 120 },
        built = await R.buildSegment(options);
      assert(built.audioGraphs.some((g) => g.startsWith(`[0:${full.index}]`)), built.audioGraphs.join(" ; "));
      const out = path.join(root, "tnt-film.mov");
      await R.renderSegment(options, out);
      const film = pcm(out);
      const heard = at(film),
        shown = at(monitor).filter((t) => t < 120 * FRAME);
      assert.equal(heard.length, shown.length, `bips du film ${heard}, du moniteur ${shown}`);
      heard.forEach((t, i) => assert(Math.abs(t - shown[i]) < 0.004, `bip au film à ${t}, au moniteur à ${shown[i]}`));
      // iPhone à son spatial : une première piste qu'aucun décodeur ne lit
      // (APAC), puis la piste AAC. On la fabrique en renommant la première.
      const src = path.join(root, "iphone-src.mov"),
        mov = path.join(root, "iphone.mov");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=3", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=3", "-f", "lavfi", "-i", "sine=f=600:r=48000:d=3", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg4", "-c:a", "aac", "-ac", "2", "-movflags", "+faststart", src]);
      const b = await fs.readFile(src),
        traks = [];
      for (let i = b.indexOf("trak"); i >= 0; i = b.indexOf("trak", i + 4)) traks.push(i);
      for (let i = b.indexOf("mp4a", traks[1]); i >= 0 && i < traks[2]; i = b.indexOf("mp4a", i + 4)) b.write("apac", i, "latin1");
      b.write("free", b.indexOf("esds", traks[1]), "latin1");
      await fs.writeFile(mov, b);
      const apac = JSON.parse(sh(ffprobe, ["-v", "error", "-show_entries", "stream=index,codec_name,sample_fmt,channels", "-of", "json", mov])).streams;
      assert.equal(apac[1].codec_name, "apple_apac");
      assert.equal(apac[1].sample_fmt, undefined, "aucun décodeur pour la première piste son");
      const phone = await describe(engine, mov, "b");
      assert.equal(phone.audioChannels, 2);
      assert.equal((await engine.soundTrack(mov)).index, 2);
      const phoneProxy = path.join(root, "iphone-apercu.mp4");
      await engine.proxy(mov, phone, phoneProxy);
      assert(Math.abs(tone(pcm(phoneProxy)) - 600) < 10, "l'aperçu sert la piste AAC");
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "projet importé avant la correction : l'aperçu d'un MPEG-TS à première piste son vide est refait une fois, la fiche et l'onde décrivent la piste utilisable ; une tâche qui échoue n'est jamais recréée",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-apercus-7-")),
      catalog = path.join(root, "Video Studio", "catalog.json");
    let picked = [],
      session;
    try {
      const ts = path.join(root, "tnt.ts"),
        other = path.join(root, "tnt-bis.ts");
      for (const file of [ts, other])
        sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=4", "-f", "lavfi", "-i", BIPS + ":d=4", "-map", "0:v", "-map", "1:a", "-map", "1:a", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a", "ac3", "-bsf:a:0", "noise=drop=1", "-f", "mpegts", file]);
      session = await openApp(root, () => picked);
      const p = await session.api["video-create"]({ name: "TNT" });
      picked = [ts, other];
      await session.api["video-import"](p.id);
      await settle(session.api);
      const assets = session.api["video-project"](p.id).assets;
      assert.deepEqual(assets.map((a) => [a.name, a.status, a.audioChannels]), [["tnt.ts", "ready", 2], ["tnt-bis.ts", "ready", 2]], "le média s'importe");
      const [first, second] = assets,
        { engine } = session.video;
      session.quit();
      // L'état d'avant la correction : fiche lue sur la première piste son
      // (vide), aucune onde, aperçu sans « -map », aucune marque.
      const data = JSON.parse(await fs.readFile(catalog, "utf8")),
        project = data.projects.find((x) => x.id === p.id);
      for (const a of project.assets) Object.assign(a, { audioChannels: 0, sampleRate: 0, waveform: undefined });
      for (const id of [first.id, second.id]) {
        // Ni la marque de la septième passe, ni celle de la sixième.
        delete data.media[id].proxySound;
        delete data.media[id].proxyTrack;
        oldProxy(engine, data.media[id].source, data.media[id].proxy);
      }
      await fs.writeFile(catalog, JSON.stringify(data));
      // Premier lancement : l'aperçu du premier se refait ; celui du second
      // échoue (fichier devenu illisible pour FFmpeg pendant la tâche).
      session = await openApp(root, () => picked);
      const real = session.video.engine.proxy;
      session.video.engine.proxy = async function (file, asset, ...rest) {
        if (asset.id === second.id) throw Error("aperçu impossible (essai)");
        return real.call(this, file, asset, ...rest);
      };
      await session.video.healed;
      let jobs = (await settle(session.api)).filter((j) => j.kind === "proxy");
      assert.deepEqual(jobs.map((j) => j.state).sort(), ["done", "failed"], JSON.stringify(jobs));
      const healed = session.api["video-project"](p.id).assets.find((a) => a.id === first.id);
      assert.equal(healed.audioChannels, 2, "la fiche décrit la piste utilisable");
      assert.equal(healed.sampleRate, 48000);
      assert(Array.isArray(healed.waveform) && Math.max(...healed.waveform) > 0.1, "l'onde est refaite sur cette piste");
      session.quit();
      // Deuxième et troisième lancements : aucune nouvelle tâche, ni pour
      // l'aperçu refait, ni pour celui qui a échoué (même version du fichier).
      for (let launch = 2; launch <= 3; launch++) {
        session = await openApp(root, () => picked);
        await session.video.healed;
        jobs = (await settle(session.api)).filter((j) => j.kind === "proxy");
        assert.equal(jobs.length, 2, `lancement ${launch} : ${JSON.stringify(jobs.map((j) => [j.state, j.error]))}`);
        session.quit();
      }
      // Le fichier change : une nouvelle version a droit à une tentative.
      await fs.appendFile(other, Buffer.alloc(188 * 10, 0xff));
      session = await openApp(root, () => picked);
      await session.video.healed;
      jobs = (await settle(session.api)).filter((j) => j.kind === "proxy");
      assert.equal(jobs.length, 3);
      assert.equal(jobs.at(-1).state, "done");
    } finally {
      session?.quit();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "seconde piste son marquée « par défaut » : l'ancien aperçu, qui la servait, est refait ; tout fichier où FFmpeg choisissait seul une autre piste que celle de l'app est revu, et un fichier à une seule piste utilisable n'est pas refait",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-defaut-7-")),
      catalog = path.join(root, "Video Studio", "catalog.json");
    let picked = [],
      session;
    try {
      const engine = new Engine({ nativeRoot, colorRoot });
      await engine.init();
      // 1. Le parcours : un MKV et un MOV dont la seconde piste (600 Hz) est
      // « par défaut », importés avant la correction.
      const files = [];
      for (const ext of ["mkv", "mov"]) {
        const file = path.join(root, "defaut2." + ext);
        sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=3", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=3", "-f", "lavfi", "-i", "sine=f=600:r=48000:d=3", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg4", "-c:a", "aac", "-ac", "2", "-disposition:a:0", "0", "-disposition:a:1", "default", file]);
        files.push(file);
      }
      session = await openApp(root, () => picked);
      const p = await session.api["video-create"]({ name: "Défaut" });
      picked = files;
      await session.api["video-import"](p.id);
      await settle(session.api);
      session.quit();
      const data = JSON.parse(await fs.readFile(catalog, "utf8")),
        ids = data.projects.find((x) => x.id === p.id).assets.map((a) => a.id);
      assert.equal(ids.length, 2);
      for (const id of ids) {
        // Ni la marque de la septième passe, ni celle de la sixième.
        delete data.media[id].proxySound;
        delete data.media[id].proxyTrack;
        oldProxy(engine, data.media[id].source, data.media[id].proxy);
        assert(Math.abs(tone(pcm(data.media[id].proxy)) - 600) < 10, "l'ancien aperçu servait la seconde piste");
      }
      await fs.writeFile(catalog, JSON.stringify(data));
      session = await openApp(root, () => picked);
      await session.video.healed;
      const jobs = (await settle(session.api)).filter((j) => j.kind === "proxy");
      assert.deepEqual(jobs.map((j) => j.state), ["done", "done"], JSON.stringify(jobs));
      for (const id of ids) {
        const proxy = JSON.parse(await fs.readFile(catalog, "utf8")).media[id].proxy;
        assert(Math.abs(tone(pcm(proxy)) - 300) < 10, "l'aperçu refait sert la première piste, celle du film");
      }
      // Le film prend la même.
      const asset = session.api["video-project"](p.id).assets[0],
        s = sequence(160, 90);
      s.clips = [soundClip(asset, s, 0, 60, 0)];
      const out = path.join(root, "film.mov");
      await R.renderSegment({ engine, sequence: s, assets: new Map([[asset.id, asset]]), registry: { [asset.id]: { source: files[0] } }, cache: root, start: 0, count: 60 }, out);
      assert(Math.abs(tone(pcm(out), 0.2, 1.8) - 300) < 10, "le film fait entendre la première piste");
      // 2. La règle, sur toutes les combinaisons qui décident du choix de
      // FFmpeg : ordre, canaux, disposition « par défaut », piste vide.
      const combos = path.join(root, "combinaisons");
      await fs.mkdir(combos);
      let differ = 0;
      for (const ext of ["mkv", "mov", "ts"])
        for (const ch of [[2, 2], [1, 2], [2, 6], [6, 2]])
          for (const def of ext === "ts" ? [[0, 0]] : [[0, 0], [1, 0], [0, 1], [1, 1]])
            for (const empty of ext === "ts" ? [-1, 0, 1] : [-1]) {
              const file = path.join(combos, `${ext}-${ch.join("")}-${def.join("")}-${empty}.${ext}`),
                args = ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=64x36:r=25:d=1", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=1", "-f", "lavfi", "-i", "sine=f=600:r=48000:d=1", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg4", "-c:a", ext === "mov" ? "aac" : "ac3", "-ac:a:0", String(ch[0]), "-ac:a:1", String(ch[1])];
              if (ext !== "ts") args.push("-disposition:a:0", def[0] ? "default" : "0", "-disposition:a:1", def[1] ? "default" : "0");
              if (empty >= 0) args.push("-bsf:a:" + empty, "noise=drop=1");
              sh(ffmpeg, [...args, file]);
              const chosen = automatic(file),
                sound = await engine.soundTrack(file),
                asset = await describe(engine, file);
              // Huitième passe (30/09/2026) : l'ancien aperçu est jugé sur son
              // son. Refait quand FFmpeg servait une autre piste (ici un
              // autre son), gardé quand il servait déjà celle de l'app.
              const old = file + ".apercu.mp4";
              oldProxy(engine, file, old);
              if (chosen !== sound.index) {
                differ++;
                assert(await engine.proxyStale(file, asset, old), `${path.basename(file)} : FFmpeg servait ${chosen}, l'app prend ${sound.index}, l'aperçu doit être refait`);
              } else assert.equal(await engine.proxyStale(file, asset, old), false, `${path.basename(file)} : FFmpeg servait déjà la piste de l'app`);
              if (sound.usable < 2) {
                assert.equal(chosen, sound.index, `${path.basename(file)} : une seule piste utilisable, FFmpeg ne pouvait servir qu'elle`);
                assert.equal(await engine.proxyStale(file, asset), false, path.basename(file));
              }
            }
      assert(differ >= 10, `combinaisons où FFmpeg choisissait une autre piste : ${differ}`);
    } finally {
      session?.quit();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "MPEG-PS dont la définition change en cours de fichier (720x480 puis 704x480) : un segment de deux plans, l'un traversant le changement quand l'autre a fini, se rend sans bloquer, avec ou sans son, et montre l'image du moniteur ; lu comme avant, il se fige et le garde-fou l'arrête",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-definition-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const parts = [];
      for (const [name, width] of [["a", 720], ["b", 704]]) {
        const part = path.join(root, name + ".mpg");
        sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=${width}x480:r=30000/1001:d=6`, "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6", "-c:v", "mpeg2video", "-b:v", "4M", "-g", "15", "-bf", "2", "-c:a", "mp2", "-b:a", "192k", "-f", "vob", part]);
        parts.push(part);
      }
      const list = path.join(root, "liste.txt"),
        file = path.join(root, "tv.mpg");
      await fs.writeFile(list, parts.map((x) => `file '${x}'`).join("\n"));
      sh(ffmpeg, ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-f", "vob", file]);
      const widths = String(sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=width", "-of", "csv=p=0", file])).trim().split("\n");
      assert.deepEqual([...new Set(widths.map((x) => parseInt(x, 10)))], [720, 704], "la définition change en cours de fichier");
      const asset = await describe(engine, file),
        proxy = path.join(root, "apercu.mp4");
      await engine.proxy(file, asset, proxy);
      for (const muted of [false, true]) {
        const s = sequence(720, 480),
          pair = (start, duration, inS) => {
            s.clips.push(pictureClip(asset, s, start, duration, Math.round(inS * 1e6)));
            if (!muted) s.clips.push(soundClip(asset, s, start, duration, Math.round(inS * 1e6)));
          };
        // Le premier plan finit à 5,33 s du rush ; le second traverse le
        // changement (6,5 s) pendant le segment.
        pair(0, 10, 5.0);
        pair(10, 80, 5.5);
        const out = path.join(root, `segment-${muted ? "muet" : "son"}.mov`),
          t0 = Date.now();
        assert(await renderWithin({ engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 90 }, out, 60000), `le segment ${muted ? "sans son" : "avec son"} ne doit pas bloquer`);
        assert(Date.now() - t0 < 30000);
        assert.equal(Number(sh(ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out]).toString()), 90);
        // Après le changement, l'image est celle du moniteur : la 704 étirée
        // sur toute la largeur, comme l'aperçu la garde à sa première taille.
        const track = await engine.videoTrack(file),
          frameAt = 70,
          sourceTime = 5.5 + (frameAt - 10) * FRAME,
          // La luminance seule, sans conversion de plage (le film est en 10 bits).
          grab = (f, select) => sh(ffmpeg, ["-v", "error", "-i", f, "-vf", `${select},format=yuv420p,extractplanes=y`, "-frames:v", "1", "-f", "rawvideo", "-"]),
          film = grab(out, `select=eq(n\\,${frameAt}),scale=72:48:flags=area`),
          // L'image que montre le moniteur à cet instant : la dernière de
          // l'aperçu commencée avant lui (ses instants sont ceux du rush,
          // comptés depuis le zéro du moniteur).
          times = String(sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", proxy])).trim().split("\n").map((x) => parseFloat(x)),
          shownAt = times.reduce((k, x, i) => (x <= sourceTime + 0.001 ? i : k), 0),
          monitor = grab(proxy, `select=eq(n\\,${shownAt}),scale=72:48:flags=area`);
        let diff = 0;
        for (let i = 0; i < film.length; i++) diff += Math.abs(film[i] - monitor[i]);
        assert(diff / film.length < 1, `écart moyen avec le moniteur : ${diff / film.length}`);
        const edge = grab(out, `select=eq(n\\,${frameAt}),crop=4:480:0:0`);
        assert(edge.reduce((x, y) => x + y, 0) / edge.length > 30, "pas de bande noire à gauche");
        // Le même segment, lu comme avant la correction, se fige vraiment :
        // le garde-fou l'arrête (FFmpeg donne toujours son suivi, immobile).
        if (!muted) {
          const b = await R.buildSegment({ engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 90 }),
            inputs = b.inputs.filter((x, i) => x !== "-reinit_filter:v" && b.inputs[i - 1] !== "-reinit_filter:v"),
            filter = b.filter.replace(/(\[\d+:\d+\])scale=\d+:\d+,/g, "$1"),
            t1 = Date.now(),
            frozen = await engine
              .ff(["-y", ...inputs, ...b.audioGraphs.flatMap((g) => ["-filter_complex", g]), "-filter_complex", filter, "-map", "[vout]", "-map", "[aout]", "-frames:v", "90", "-c:v", "ffv1", "-c:a", "pcm_s24le", path.join(root, "fige.mov")], { stall: 3000 })
              .then(() => null, (e) => e);
          assert.equal(frozen?.code, "JUNO_STALL", "le rendu d'avant se fige, et le garde-fou l'arrête : " + frozen);
          assert(Date.now() - t1 < 20000, `arrêté en ${Date.now() - t1} ms`);
        }
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "entrées image ramenées à leur définition de départ, sans reconstruction du graphe : le rendu d'un rush ordinaire est identique à l'image près à celui d'avant, nettoyage, ralenti et accéléré compris ; un rush tourné aussi, redressé par l'app après avoir été figé (huitième passe)",
  { skip, timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-definition-figee-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const plain = path.join(root, "camera.mov"),
        vfr = path.join(root, "telephone-vfr.mov"),
        raw = path.join(root, "telephone-brut.mov"),
        turned = path.join(root, "telephone.mov");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30000/1001:d=4", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=4", "-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac", plain]);
      // Cadence variable : des images sautées, comme un iPhone.
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=60:d=4", "-vf", "select='not(eq(mod(n\\,7)\\,3))',setpts=N/60/TB*1.02", "-fps_mode", "vfr", "-video_track_timescale", "600", "-c:v", "mpeg4", "-q:v", "3", vfr]);
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30000/1001:d=4", "-c:v", "mpeg4", "-q:v", "3", raw]);
      sh(ffmpeg, ["-v", "error", "-y", "-display_rotation", "90", "-i", raw, "-c", "copy", turned]);
      for (const file of [plain, vfr, turned]) {
        const asset = await describe(engine, file),
          s = sequence(320, 180);
        s.clips = [
          { ...pictureClip(asset, s, 0, 40, 500000), denoise: "medium" },
          { ...pictureClip(asset, s, 40, 50, 1500000), speed: 0.5, smoothSlow: true },
          { ...pictureClip(asset, s, 20, 40, 0), track: 2, scale: 0.5, x: 0.2, stabilise: 1, speed: 2 },
        ];
        const options = { engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 90 },
          b = await R.buildSegment(options),
          pins = b.inputs.filter((x) => x === "-reinit_filter:v").length;
        // Huitième passe (30/09/2026) : un rush tourné est figé aussi, puis
        // redressé par l'app (« -noautorotate »), par les filtres que FFmpeg
        // posait seul avant lui ; il gardait l'ancien chemin, et son segment
        // se figeait quand sa définition changeait en cours de fichier.
        assert.equal(pins, 3, "chaque entrée image est figée");
        assert.equal(b.inputs.filter((x) => x === "-noautorotate").length, file === turned ? 3 : 0);
        // Le même segment tel qu'avant la correction.
        const legacyInputs = b.inputs.filter((x, i) => x !== "-reinit_filter:v" && b.inputs[i - 1] !== "-reinit_filter:v" && x !== "-noautorotate"),
          legacy = b.filter.replace(/(\[\d+:\d+\])scale=\d+:\d+,((format=\w+,)?((transpose=\w+|hflip|vflip|rotate=[^,]+),)+(scale,)?)?/g, "$1");
        assert.notEqual(legacy, b.filter);
        const render = (inputs, filter, target) =>
          sh(ffmpeg, ["-v", "error", "-y", ...inputs, ...b.audioGraphs.flatMap((g) => ["-filter_complex", g]), "-filter_complex", filter, "-map", "[vout]", "-map", "[aout]", "-frames:v", "90", "-c:v", "ffv1", "-pix_fmt", "yuv444p10le", "-c:a", "pcm_s24le", "-f", "framemd5", target]);
        const now = path.join(root, "nouveau.md5"),
          before = path.join(root, "avant.md5");
        render(b.inputs, b.filter, now);
        render(legacyInputs, legacy, before);
        const lines = (f) => fss.readFileSync(f, "utf8").split("\n").filter((l) => /^\d/.test(l));
        assert.equal(lines(now).length, 90 + lines(now).filter((l) => l.startsWith("1,")).length);
        assert.deepEqual(lines(now), lines(before), path.basename(file) + " : mêmes images, même son");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);
