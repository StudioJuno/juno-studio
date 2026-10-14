// Film livré, huitième passe (30/09/2026), sur de vrais fichiers et de vrais
// rendus FFmpeg :
// - la définition « de départ » imposée à chaque entrée image se lisait avant
//   le recadrage du conteneur (atome « clap » d'un MOV ou d'un MP4,
//   « PixelCrop » d'un MKV) : l'image recadrée était étirée, et le film
//   n'était plus l'image du moniteur ;
// - le rush tourné d'un téléphone dont la définition change en cours de
//   fichier figeait encore son segment ;
// - la réfection des anciens aperçus refaisait aussi ceux qui étaient justes,
//   passait avant un export demandé ensuite, et une tâche annulée ou
//   interrompue comptait comme une tentative : le média n'était jamais
//   réparé ;
// - l'harmonisation couleur regradait les plans des pistes verrouillées, et
//   le suivi d'un masque écrivait ses repères sur une piste verrouillée
//   pendant qu'il tournait.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { Engine } = require("../electron/video/engine.cjs"),
  M = require("../electron/video/model.cjs"),
  R = require("../electron/video/render.cjs"),
  TRACK = require("../electron/video/track.cjs");
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
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** Le son d'un fichier, mono 48 kHz, en échantillons entiers. */
function pcm(file, map = "0:a:0") {
  const b = sh(ffmpeg, ["-v", "error", "-i", file, "-map", map, "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"]);
  return Array.from({ length: b.length / 2 }, (_, i) => b.readInt16LE(i * 2));
}
/** La tonalité d'un son entre deux instants : passages par zéro par seconde, divisés par deux. */
function tone(samples, from = 0.5, to = 1.5) {
  let zc = 0;
  for (let i = Math.round(from * RATE) + 1; i < Math.round(to * RATE); i++) if (samples[i] >= 0 !== samples[i - 1] >= 0) zc++;
  return zc / 2 / (to - from);
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
/**
 * Le segment tel que le rendait la passe d'avant les entrées figées : sans
 * « -reinit_filter », sans « -noautorotate », et sans les filtres qui figent
 * puis redressent l'image au début de chaque plan (FFmpeg redressait seul).
 */
function legacy(b) {
  return {
    inputs: b.inputs.filter((x, i) => x !== "-reinit_filter:v" && b.inputs[i - 1] !== "-reinit_filter:v" && x !== "-noautorotate"),
    filter: b.filter.replace(/(\[\d+:\d+\])scale=\d+:\d+,((format=\w+,)?((transpose=\w+|hflip|vflip|rotate=[^,]+),)+(scale,)?)?/g, "$1"),
  };
}
/** Les images (et le son) d'un segment, sortie du graphe, sans encodage. */
function framemd5(b, inputs, filter, frames) {
  const out = String(sh(ffmpeg, ["-v", "error", "-y", ...inputs, ...b.audioGraphs.flatMap((g) => ["-filter_complex", g]), "-filter_complex", filter, "-map", "[vout]", "-map", "[aout]", "-frames:v", String(frames), "-c:v", "rawvideo", "-pix_fmt", "yuv444p10le", "-c:a", "pcm_s24le", "-f", "framemd5", "-"]));
  return out.split("\n").filter((l) => /^0,/.test(l)).map((l) => l.split(",").pop().trim());
}
/**
 * Un MOV ou un MP4 recadré par son conteneur : l'atome « clap » (ouverture
 * nette, centrée) de `cw` x `ch` pixels, posé dans la description de la piste
 * image. Le fichier source a son « moov » après les données (sortie par
 * défaut de FFmpeg) : rien d'autre ne bouge.
 */
function withClap(src, dst, cw, ch) {
  const b = fss.readFileSync(src),
    boxes = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
  const find = (start, end, chain) => {
    for (let i = start; i < end; ) {
      const size = b.readUInt32BE(i),
        type = b.toString("latin1", i + 4, i + 8);
      if (boxes.has(type)) {
        const r = find(i + 8, i + size, [...chain, i]);
        if (r) return r;
      } else if (type === "stsd") {
        const e = i + 16;
        if (["avc1", "hvc1", "mp4v"].includes(b.toString("latin1", e + 4, e + 8))) return [...chain, i, e];
      }
      i += size;
    }
  };
  const chain = find(0, b.length, []);
  assert(chain, "piste image introuvable");
  const clap = Buffer.alloc(40);
  clap.writeUInt32BE(40, 0);
  clap.write("clap", 4, "latin1");
  [cw, 1, ch, 1, 0, 1, 0, 1].forEach((v, k) => clap.writeUInt32BE(v, 8 + 4 * k));
  const entry = chain.at(-1),
    at = entry + b.readUInt32BE(entry),
    out = Buffer.concat([b.subarray(0, at), clap, b.subarray(at)]);
  for (const offset of chain) out.writeUInt32BE(out.readUInt32BE(offset) + 40, offset);
  fss.writeFileSync(dst, out);
}
/** Largeur de l'image (pixels non noirs) sur la ligne du milieu d'une image grise. */
function extent(row) {
  let l = -1,
    r = -1;
  for (let i = 0; i < row.length; i++)
    if (row[i] > 20) {
      if (l < 0) l = i;
      r = i;
    }
  return r - l + 1;
}
/** L'application, ouverte sur un profil jetable (`root`). */
async function openApp(root, picked = () => [], saveTo) {
  const { registerVideo } = require("../electron/video/index.cjs"),
    api = {},
    events = {},
    video = await registerVideo({
      handle: (name, fn) => (api[name] = fn),
      app: { getPath: () => root, getVersion: () => "0.0.0-test", on: (name, fn) => (events[name] = fn) },
      dialog: {
        showOpenDialog: async () => ({ canceled: false, filePaths: picked() }),
        showSaveDialog: async () => (saveTo ? { canceled: false, filePath: saveTo() } : { canceled: true }),
      },
      protocol: { handle: () => {} },
      getWindow: () => undefined,
      nativeRoot,
      colorRoot,
    });
  return { api, video, quit: () => events["will-quit"]?.() };
}
async function settle(api, ms = 180000) {
  for (let t = Date.now(); Date.now() - t < ms; ) {
    const jobs = api["video-list"]().jobs;
    if (jobs.every((j) => ["done", "failed", "cancelled", "interrupted"].includes(j.state))) return jobs;
    await pause(100);
  }
  throw Error("les tâches ne finissent pas");
}
async function waitJob(api, id, ms = 180000) {
  for (let t = Date.now(); Date.now() - t < ms; ) {
    const j = api["video-list"]().jobs.find((x) => x.id === id);
    if (j && ["done", "failed", "cancelled", "interrupted"].includes(j.state)) return j;
    await pause(100);
  }
  throw Error("la tâche ne finit pas");
}
/** L'aperçu tel que le fabriquait la 1.2.x : sans « -map », FFmpeg choisit seul sa piste son. */
function oldProxy(engine, file, target) {
  sh(ffmpeg, ["-v", "error", "-y", "-i", file, "-vf", "scale=160:90", "-enc_time_base:v", "demux", ...engine.encode(), "-c:a", "aac", "-ac", "2", "-ar", "48000", "-movflags", "+faststart", target]);
}
/** Le catalogue d'un profil ramené à l'état d'une 1.2.x : aperçus sans « -map », aucune marque. */
async function makeOld(root, engine, ids) {
  const catalog = path.join(root, "Video Studio", "catalog.json"),
    data = JSON.parse(await fs.readFile(catalog, "utf8"));
  // Profil couleur confirmé par l'utilisateur, comme dans un vrai projet.
  for (const p of data.projects) for (const a of p.assets) if (ids.includes(a.id)) a.spaceConfirmed = true;
  for (const id of ids) {
    delete data.media[id].proxySound;
    delete data.media[id].proxyTrack;
    oldProxy(engine, data.media[id].source, data.media[id].proxy);
  }
  await fs.writeFile(catalog, JSON.stringify(data));
  return data;
}
/** Une « voix » : bruit rose modulé comme une parole, d'une graine donnée. */
const VOICE = (seed, d) => `anoisesrc=d=${d}:c=pink:r=48000:a=0.4:seed=${seed},volume='0.2+0.8*abs(sin(2*PI*${2 + seed / 3}*t))*abs(sin(2*PI*0.4*t))':eval=frame`;

test(
  "recadrage du conteneur (clap d'un MOV et d'un MP4, PixelCrop d'un MKV) : l'entrée image est figée à sa taille décodée, le film garde l'image du moniteur, image par image comme avant les entrées figées",
  { skip, timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-recadrage-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const base = path.join(root, "base.mov"),
        mov = path.join(root, "recadre.mov"),
        mp4 = path.join(root, "recadre.mp4"),
        mkv = path.join(root, "recadre.mkv");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30000/1001:d=3", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=3", "-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac", base]);
      withClap(base, mov, 560, 360);
      sh(ffmpeg, ["-v", "error", "-y", "-i", mov, "-c", "copy", mp4]);
      sh(ffmpeg, ["-v", "error", "-y", "-i", mov, "-c", "copy", mkv]);
      for (const file of [mov, mp4, mkv]) {
        const crop = JSON.parse(sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width:stream_side_data", "-of", "json", file])).streams[0];
        assert.equal(crop.width, 640, "le flux se déclare en 640 de large");
        assert.equal(crop.side_data_list?.find((x) => x.side_data_type === "Frame Cropping")?.crop_left, 40, path.basename(file) + " : recadré par son conteneur");
        const asset = await describe(engine, file),
          s = sequence(960, 540);
        s.clips = [pictureClip(asset, s, 0, 40, 500000)];
        const options = { engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 40 },
          b = await R.buildSegment(options);
        // Le film : une image du milieu, sa largeur sur la ligne du milieu.
        const row = sh(ffmpeg, ["-v", "error", "-y", ...b.inputs, ...b.audioGraphs.flatMap((g) => ["-filter_complex", g]), "-filter_complex", b.filter + ";[vout]select=eq(n\\,20),format=gray,crop=iw:1:0:ih/2[p]", "-map", "[p]", "-frames:v", "1", "-f", "rawvideo", "-", "-map", "[aout]", "-f", "null", "-"]);
        const film = extent(row) / 540;
        // Le moniteur : l'aperçu que fabrique l'app.
        const proxy = path.join(root, path.basename(file) + ".apercu.mp4");
        await engine.proxy(file, asset, proxy);
        const shown = JSON.parse(sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", proxy])).streams[0],
          monitor = shown.width / shown.height;
        assert(Math.abs(film - 560 / 360) < 0.01, `${path.basename(file)} : film ${film.toFixed(3)}, image recadrée ${(560 / 360).toFixed(3)}`);
        assert(Math.abs(film - monitor) < 0.01, `${path.basename(file)} : film ${film.toFixed(3)}, moniteur ${monitor.toFixed(3)}`);
        // Et image par image, le rendu d'avant les entrées figées.
        const before = legacy(b);
        assert.deepEqual(framemd5(b, b.inputs, b.filter, 40), framemd5(b, before.inputs, before.filter, 40), path.basename(file));
        assert(b.inputs.includes("-reinit_filter:v"), "l'entrée image est figée");
        assert.match(b.filter, /\[0:0\]scale=560:360,/, path.basename(file) + " : figée à sa taille décodée, recadrage fait");
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "entrées figées puis redressées : sur des rushes tournés (90°, -90°, 180°, miroir, retourné, recadré puis tourné), 10 bits, anamorphosé, alpha, le rendu est identique image par image à celui où FFmpeg redressait seul, nettoyage, ralenti et accéléré compris",
  { skip, timeout: 420000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-redresse-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const raw = path.join(root, "brut.mov"),
        // Le recadré d'abord : figé à sa taille d'avant recadrage, il était
        // étiré (voir plus haut).
        files = { recadre: null };
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30000/1001:d=4", "-f", "lavfi", "-i", "sine=f=440:r=48000:d=4", "-c:v", "mpeg4", "-q:v", "3", "-c:a", "aac", raw]);
      for (const [name, args] of [
        ["tourne-90", ["-display_rotation", "90"]],
        ["tourne-moins-90", ["-display_rotation", "-90"]],
        ["tourne-180", ["-display_rotation", "180"]],
        ["miroir-90", ["-display_rotation", "90", "-display_hflip"]],
        ["retourne", ["-display_rotation", "0", "-display_vflip"]],
      ]) {
        files[name] = path.join(root, name + ".mov");
        sh(ffmpeg, ["-v", "error", "-y", ...args, "-i", raw, "-c", "copy", files[name]]);
      }
      const clap = path.join(root, "recadre.mov");
      withClap(raw, clap, 280, 180);
      files["recadre"] = clap;
      files["recadre-tourne"] = path.join(root, "recadre-tourne.mov");
      sh(ffmpeg, ["-v", "error", "-y", "-display_rotation", "-90", "-i", clap, "-c", "copy", files["recadre-tourne"]]);
      files["dix-bits"] = path.join(root, "dix-bits.mov");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30000/1001:d=4", "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", files["dix-bits"]]);
      files["dix-bits-tourne"] = path.join(root, "dix-bits-tourne.mov");
      sh(ffmpeg, ["-v", "error", "-y", "-display_rotation", "90", "-i", files["dix-bits"], "-c", "copy", files["dix-bits-tourne"]]);
      files["anamorphose"] = path.join(root, "anamorphose.ts");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=720x576:r=25:d=4", "-vf", "setsar=64/45", "-c:v", "mpeg2video", "-b:v", "6M", "-flags", "+ilme+ildct", "-aspect", "16:9", "-f", "mpegts", files["anamorphose"]]);
      files["alpha"] = path.join(root, "alpha.mov");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30000/1001:d=4", "-vf", "format=argb,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(Y,H/2),255,60)'", "-c:v", "qtrle", files["alpha"]]);
      for (const [name, file] of Object.entries(files)) {
        const asset = await describe(engine, file),
          s = sequence(320, 180);
        s.clips = [
          { ...pictureClip(asset, s, 0, 40, 500000), denoise: "medium" },
          { ...pictureClip(asset, s, 40, 50, 1500000), speed: 0.5, smoothSlow: true },
          { ...pictureClip(asset, s, 20, 40, 0), track: 2, scale: 0.5, x: 0.2, stabilise: 1, speed: 2 },
        ];
        const b = await R.buildSegment({ engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 90 }),
          turned = /tourne|miroir|retourne/.test(name);
        const before = legacy(b);
        assert.deepEqual(framemd5(b, b.inputs, b.filter, 90), framemd5(b, before.inputs, before.filter, 90), name + " : mêmes images");
        assert.equal(b.inputs.filter((x) => x === "-reinit_filter:v").length, 3, name + " : chaque entrée image est figée");
        assert.equal(b.inputs.filter((x) => x === "-noautorotate").length, turned ? 3 : 0, name + (turned ? " : redressé par l'app" : " : rien à redresser"));
        assert.notEqual(before.filter, b.filter);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "rush tourné (téléphone) dont la définition change en cours de fichier : un segment de deux plans, l'un traversant le changement quand l'autre a fini, se rend sans bloquer et montre l'image du moniteur ; redressé par FFmpeg comme avant, il se fige et le garde-fou l'arrête",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-tourne-definition-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      const parts = [];
      for (const [name, size] of [["a", "640x360"], ["b", "480x360"]]) {
        const part = path.join(root, name + ".ts");
        sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", `testsrc2=s=${size}:r=30000/1001:d=6`, "-f", "lavfi", "-i", "sine=f=440:r=48000:d=6", "-c:v", "mpeg2video", "-b:v", "4M", "-g", "15", "-bf", "2", "-c:a", "aac", "-f", "mpegts", part]);
        parts.push(part);
      }
      const list = path.join(root, "liste.txt"),
        joined = path.join(root, "joint.ts"),
        file = path.join(root, "telephone.mov");
      await fs.writeFile(list, parts.map((x) => `file '${x}'`).join("\n"));
      sh(ffmpeg, ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-f", "mpegts", joined]);
      sh(ffmpeg, ["-v", "error", "-y", "-display_rotation", "90", "-i", joined, "-c", "copy", file]);
      const widths = String(sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=width", "-of", "csv=p=0", file])).trim().split("\n");
      assert.deepEqual([...new Set(widths.map((x) => parseInt(x, 10)))], [640, 480], "la définition change en cours de fichier");
      const asset = await describe(engine, file),
        proxy = path.join(root, "apercu.mp4");
      await engine.proxy(file, asset, proxy);
      const s = sequence(360, 640);
      // Le premier plan finit à 5,33 s du rush ; le second traverse le
      // changement (6 s) pendant le segment.
      for (const [start, duration, inS] of [[0, 10, 5.0], [10, 80, 5.5]]) {
        s.clips.push(pictureClip(asset, s, start, duration, Math.round(inS * 1e6)));
        s.clips.push(soundClip(asset, s, start, duration, Math.round(inS * 1e6)));
      }
      const options = { engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 90 },
        out = path.join(root, "segment.mov"),
        t0 = Date.now();
      assert(await renderWithin(options, out, 60000), "le segment ne doit pas bloquer");
      const b = await R.buildSegment(options);
      assert.equal(b.inputs.filter((x) => x === "-noautorotate").length, 2, "l'app redresse elle-même, après avoir figé");
      assert(Date.now() - t0 < 30000);
      assert.equal(Number(sh(ffprobe, ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", out]).toString()), 90);
      const tags = JSON.parse(sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data", "-of", "json", out])).streams[0];
      assert.equal(tags.side_data_list, undefined, "le film ne porte aucune rotation");
      // Avant et après le changement, l'image est celle du moniteur.
      const grab = (f, select) => sh(ffmpeg, ["-v", "error", "-i", f, "-vf", `${select},format=yuv420p,extractplanes=y`, "-frames:v", "1", "-f", "rawvideo", "-"]),
        times = String(sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", proxy])).trim().split("\n").map((x) => parseFloat(x));
      for (const frameAt of [5, 70]) {
        const sourceTime = frameAt < 10 ? 5.0 + frameAt * FRAME : 5.5 + (frameAt - 10) * FRAME,
          film = grab(out, `select=eq(n\\,${frameAt}),scale=36:64:flags=area`),
          shownAt = times.reduce((k, x, i) => (x <= sourceTime + 0.001 ? i : k), 0),
          monitor = grab(proxy, `select=eq(n\\,${shownAt}),scale=36:64:flags=area`);
        let diff = 0;
        for (let i = 0; i < film.length; i++) diff += Math.abs(film[i] - monitor[i]);
        assert(diff / film.length < 2, `image ${frameAt} : écart moyen avec le moniteur ${diff / film.length}`);
      }
      // Le même segment, redressé par FFmpeg comme avant : il se fige, et
      // le garde-fou l'arrête.
      const before = legacy(b),
        frozen = await engine
          .ff(["-y", ...before.inputs, ...b.audioGraphs.flatMap((g) => ["-filter_complex", g]), "-filter_complex", before.filter, "-map", "[vout]", "-map", "[aout]", "-frames:v", "90", "-c:v", "ffv1", "-c:a", "pcm_s24le", path.join(root, "fige.mov")], { stall: 3000 })
          .then(() => null, (e) => e);
      assert.equal(frozen?.code, "JUNO_STALL", "le rendu d'avant se fige : " + frozen);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "rotation portée par les images seules (message SEI d'un H.264) : FFmpeg la fait, le plan est figé après elle, à la définition de l'image debout ; chaque image du film est celle du moniteur, et un segment de plusieurs plans se rend sans bloquer",
  { skip, timeout: 240000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-sei-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      if (!engine.status.encoder) return;
      const raw = path.join(root, "brut.mov"),
        file = path.join(root, "sei.mov");
      sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30000/1001:d=4", ...engine.encode(), "-g", "15", raw]);
      sh(ffmpeg, ["-v", "error", "-y", "-i", raw, "-c", "copy", "-bsf:v", "h264_metadata=display_orientation=insert:rotate=90", file]);
      const asset = await describe(engine, file),
        proxy = path.join(root, "apercu.mp4");
      await engine.proxy(file, asset, proxy);
      const s = sequence(320, 180);
      s.clips = [pictureClip(asset, s, 0, 60, 500000)];
      const b = await R.buildSegment({ engine, sequence: s, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 60 });
      // Le film montre l'image debout, comme le moniteur : 180 x 320 posée
      // dans 320 x 180, soit 101 pixels de large. Figée à 320 x 180 après
      // la rotation de FFmpeg, elle était étirée sur toute la largeur.
      const row = sh(ffmpeg, ["-v", "error", "-y", ...b.inputs, ...b.audioGraphs.flatMap((g) => ["-filter_complex", g]), "-filter_complex", b.filter + ";[vout]select=eq(n\\,20),format=gray,crop=iw:1:0:ih/2[p]", "-map", "[p]", "-frames:v", "1", "-f", "rawvideo", "-", "-map", "[aout]", "-f", "null", "-"]);
      assert(Math.abs(extent(row) - 101) <= 2, "largeur de l'image au film : " + extent(row));
      // Chaque image du film est celle du moniteur au même instant. Laissé
      // libre, FFmpeg reconstruisait le graphe à chaque message SEI et le
      // plan prenait une image de retard.
      const small = (args) => sh(ffmpeg, ["-v", "error", "-y", ...args]),
        film = small([...b.inputs, ...b.audioGraphs.flatMap((g) => ["-filter_complex", g]), "-filter_complex", b.filter + ";[vout]crop=100:180:(iw-100)/2:0,scale=36:64,format=gray[p]", "-map", "[p]", "-frames:v", "60", "-f", "rawvideo", "-", "-map", "[aout]", "-f", "null", "-"]),
        monitor = small(["-i", proxy, "-vf", "scale=36:64,format=gray", "-f", "rawvideo", "-"]),
        times = String(sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", proxy])).trim().split("\n").map(Number),
        size = 36 * 64,
        gaps = [];
      for (let f = 0; f < 60; f++) {
        const t = 0.5 + f * FRAME,
          m = times.reduce((k, x, i) => (x <= t + 0.001 ? i : k), 0);
        let d = 0;
        for (let i = 0; i < size; i++) d += Math.abs(film[f * size + i] - monitor[m * size + i]);
        gaps.push(d / size);
      }
      // Même image : l'écart ne tient qu'à la réduction et à l'encodage de
      // l'aperçu (un peu plus sur ses images clés) ; une image de décalage
      // le double, sur presque toutes les images après le premier message.
      const least = Math.min(...gaps),
        off = gaps.filter((g) => g > least * 1.5).length;
      assert(off <= 6, `${off} images loin du moniteur : ` + gaps.map((g) => g.toFixed(1)).join(" "));
      assert.deepEqual(await engine.pictureShape(file), { width: 180, height: 320, format: "yuv420p", turn: [], own: false });
      assert(b.inputs.includes("-reinit_filter:v") && !b.inputs.includes("-noautorotate"));
      assert.match(b.filter, /\[0:0\]scale=180:320,/);
      // Trois plans dans un segment : il se rend, sans bloquer.
      const three = sequence(320, 180);
      three.clips = [
        { ...pictureClip(asset, three, 0, 30, 500000), denoise: "medium" },
        { ...pictureClip(asset, three, 30, 30, 1000000), speed: 2 },
        { ...pictureClip(asset, three, 10, 40, 200000), track: 2, scale: 0.5, x: 0.2 },
      ];
      assert(await renderWithin({ engine, sequence: three, assets: new Map([["a", asset]]), registry: { a: { source: file } }, cache: root, start: 0, count: 60 }, path.join(root, "trois.mov"), 60000), "le segment ne doit pas bloquer");
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "anciens aperçus : seuls ceux qui sont faux sont refaits (piste servie autre, micro de secours 12 dB plus bas), ceux qui sont justes sont marqués sans être refaits (FFmpeg servait déjà la piste de l'app, son 1,5 s après l'image, double mono)",
  { skip, timeout: 420000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-refection-")),
      catalog = path.join(root, "Video Studio", "catalog.json"),
      film = path.join(root, "film.mp4");
    let picked = [],
      session;
    try {
      const V = ["-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=8"],
        files = {
          // AC-3 5.1 puis stéréo, sons différents : FFmpeg servait la première (plus de canaux), celle de l'app.
          juste: path.join(root, "juste.mts"),
          // La même voix sur deux pistes mono.
          double: path.join(root, "double-mono.mov"),
          // Comme « juste », son qui commence 1,5 s après l'image.
          tard: path.join(root, "son-tard.mts"),
          // Seconde piste « par défaut », une autre voix.
          autre: path.join(root, "autre.mkv"),
          // Micro de secours : la même voix, 12 dB plus bas, stéréo et « par défaut ».
          secours: path.join(root, "secours.mov"),
        };
      sh(ffmpeg, ["-v", "error", "-y", ...V, "-f", "lavfi", "-i", VOICE(1, 8), "-f", "lavfi", "-i", VOICE(7, 8), "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a", "ac3", "-ac:a:0", "6", "-ac:a:1", "2", "-f", "mpegts", files.juste]);
      sh(ffmpeg, ["-v", "error", "-y", ...V, "-f", "lavfi", "-i", VOICE(1, 8), "-filter_complex", "[1:a]asplit[a][b]", "-map", "0:v", "-map", "[a]", "-map", "[b]", "-c:v", "mpeg4", "-c:a", "pcm_s16le", "-ac", "1", files.double]);
      sh(ffmpeg, ["-v", "error", "-y", ...V, "-itsoffset", "1.5", "-f", "lavfi", "-i", VOICE(1, 8), "-itsoffset", "1.5", "-f", "lavfi", "-i", VOICE(7, 8), "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a", "ac3", "-ac:a:0", "6", "-ac:a:1", "2", "-f", "mpegts", files.tard]);
      sh(ffmpeg, ["-v", "error", "-y", ...V, "-f", "lavfi", "-i", VOICE(1, 8), "-f", "lavfi", "-i", VOICE(7, 8), "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg4", "-c:a", "aac", "-ac", "2", "-disposition:a:0", "0", "-disposition:a:1", "default", files.autre]);
      sh(ffmpeg, ["-v", "error", "-y", ...V, "-f", "lavfi", "-i", VOICE(1, 8), "-filter_complex", "[1:a]asplit[a][b];[b]volume=-12dB[c]", "-map", "0:v", "-map", "[a]", "-map", "[c]", "-c:v", "mpeg4", "-c:a", "pcm_s24le", "-ac:a:0", "1", "-ac:a:1", "2", "-disposition:a:0", "0", "-disposition:a:1", "default", files.secours]);
      session = await openApp(root, () => picked, () => film);
      const p = await session.api["video-create"]({ name: "Réfection" });
      picked = Object.values(files);
      await session.api["video-import"](p.id);
      await settle(session.api);
      const assets = session.api["video-project"](p.id).assets,
        byName = (n) => assets.find((a) => a.name === n);
      assert.equal(assets.filter((a) => a.status === "ready").length, 5);
      const { engine } = session.video;
      session.quit();
      const data = await makeOld(root, engine, assets.map((a) => a.id)),
        before = Object.fromEntries(assets.map((a) => [a.name, fss.statSync(data.media[a.id].proxy).mtimeMs]));
      session = await openApp(root, () => picked, () => film);
      await session.video.healed;
      const heal = session.video.store.data.jobs.filter((j) => j.kind === "proxy");
      assert.deepEqual(heal.map((j) => assets.find((a) => a.id === j.payload.assetId)?.name).sort(), ["autre.mkv", "secours.mov"], "seuls les aperçus faux sont à refaire");
      assert(heal.every((j) => j.payload.background && j.label === "Refaire l’aperçu"));
      const jobs = (await settle(session.api)).filter((j) => j.kind === "proxy");
      assert.deepEqual(jobs.map((j) => j.state), ["done", "done"], JSON.stringify(jobs));
      // Les aperçus refaits font entendre la piste de l'app ; les justes
      // n'ont pas bougé, et tous sont marqués.
      const after = JSON.parse(await fs.readFile(catalog, "utf8")).media;
      for (const name of ["juste.mts", "double-mono.mov", "son-tard.mts"]) assert.equal(fss.statSync(after[byName(name).id].proxy).mtimeMs, before[name], name + " : aperçu gardé");
      for (const name of ["autre.mkv", "secours.mov"]) assert.notEqual(fss.statSync(after[byName(name).id].proxy).mtimeMs, before[name], name + " : aperçu refait");
      for (const a of assets) assert.match(after[a.id].proxySound ?? "", /^premiere-utilisable\|/, a.name + " : marqué");
      for (const name of ["autre.mkv", "secours.mov"]) {
        const heard = await engine.samples(after[byName(name).id].proxy, "0:a:0", 3, 2),
          wanted = await engine.samples(byName(name) && data.media[byName(name).id].source, "0:1", 2, 4);
        assert(require("../electron/video/engine.cjs").sameSound(heard, wanted), name + " : l'aperçu refait fait entendre la piste de l'app");
      }
      session.quit();
      // Lancement suivant : plus rien à refaire.
      session = await openApp(root, () => picked, () => film);
      await session.video.healed;
      assert.equal((await settle(session.api)).filter((j) => j.kind === "proxy").length, 2);
    } finally {
      session?.quit();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "réfection des anciens aperçus en tâche de fond : un export demandé à l'ouverture commence aussitôt, la réfection en cours lui cède la place puis reprend et finit",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-refection-priorite-")),
      film = path.join(root, "film.mp4");
    let picked = [],
      session;
    try {
      const files = [];
      for (const name of ["cam1", "cam2", "cam3"]) {
        const file = path.join(root, name + ".mkv");
        sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=4", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=4", "-f", "lavfi", "-i", "sine=f=600:r=48000:d=4", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg4", "-c:a", "aac", "-ac", "2", "-disposition:a:0", "0", "-disposition:a:1", "default", file]);
        files.push(file);
      }
      session = await openApp(root, () => picked, () => film);
      const p = await session.api["video-create"]({ name: "Priorité" });
      picked = files;
      await session.api["video-import"](p.id);
      await settle(session.api);
      const assets = session.api["video-project"](p.id).assets,
        { engine } = session.video;
      session.quit();
      await makeOld(root, engine, assets.map((a) => a.id));
      // Lancement suivant : trois aperçus à refaire, lents (4 s chacun), et
      // un export demandé dès l'ouverture.
      session = await openApp(root, () => picked, () => film);
      const real = session.video.engine.proxy,
        runs = [];
      session.video.engine.proxy = async function (file, asset, target, options = {}) {
        runs.push(asset.id);
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 4000);
          options.signal?.addEventListener("abort", () => (clearTimeout(t), reject(Object.assign(Error("Interrompu"), { name: "AbortError" }))), { once: true });
        });
        return real.call(this, file, asset, target, options);
      };
      await session.video.healed;
      assert.equal(session.api["video-list"]().jobs.filter((j) => j.kind === "proxy").length, 3);
      for (let i = 0; i < 100 && !runs.length; i++) await pause(50);
      assert.equal(runs.length, 1, "une réfection est en cours");
      const project = session.api["video-project"](p.id),
        s = { ...project.sequences[0], fps: NTSC, width: 160, height: 90 };
      s.clips = [pictureClip(project.assets[0], s, 0, 30, 0)];
      const t0 = Date.now(),
        exported = await session.api["video-export"]({ projectId: p.id, sequence: s, codec: "h264", overlays: [], maskImages: {}, loudness: null });
      let started = 0;
      for (let i = 0; i < 600 && !started; i++) {
        const j = session.api["video-list"]().jobs.find((x) => x.id === exported.id);
        if (j && j.state !== "queued") started = Date.now() - t0;
        else await pause(50);
      }
      assert(started > 0 && started < 1000, `export commencé après ${started} ms, derrière la réfection`);
      const done = await waitJob(session.api, exported.id);
      assert.equal(done.state, "done", JSON.stringify(done));
      assert(Date.now() - t0 < 8000, "l'export n'attend pas la réfection");
      const jobs = (await settle(session.api)).filter((j) => j.kind === "proxy");
      assert.deepEqual(jobs.map((j) => j.state), ["done", "done", "done"], JSON.stringify(jobs.map((j) => [j.state, j.error])));
      assert.equal(runs.length, 4, "la réfection qui a cédé la place a repris de zéro");
      const media = JSON.parse(await fs.readFile(path.join(root, "Video Studio", "catalog.json"), "utf8")).media;
      for (const a of assets) assert(Math.abs(tone(pcm(media[a.id].proxy)) - 300) < 10, a.name + " : aperçu réparé");
    } finally {
      session?.quit();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "réfection d'un ancien aperçu : annulée ou interrompue par la fermeture, elle ne compte pas comme une tentative et repart au lancement suivant ; un échec compte, et la tâche n'est plus recréée",
  { skip, timeout: 420000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-refection-tentative-"));
    let picked = [],
      session;
    try {
      const files = [];
      for (const name of ["a", "b", "c"]) {
        const file = path.join(root, name + ".mkv");
        sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=160x90:r=30000/1001:d=4", "-f", "lavfi", "-i", "sine=f=300:r=48000:d=4", "-f", "lavfi", "-i", "sine=f=600:r=48000:d=4", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-c:v", "mpeg4", "-c:a", "aac", "-ac", "2", "-disposition:a:0", "0", "-disposition:a:1", "default", file]);
        files.push(file);
      }
      session = await openApp(root, () => picked);
      const p = await session.api["video-create"]({ name: "Tentatives" });
      picked = files;
      await session.api["video-import"](p.id);
      await settle(session.api);
      const assets = session.api["video-project"](p.id).assets,
        id = (n) => assets.find((a) => a.name === n + ".mkv").id,
        { engine } = session.video;
      session.quit();
      const data = await makeOld(root, engine, assets.map((a) => a.id));
      for (const a of assets) assert(Math.abs(tone(pcm(data.media[a.id].proxy)) - 600) < 10, "l'ancien aperçu sert la seconde piste");
      // Premier lancement : « a » est annulée, « c » échoue, et l'app est
      // fermée pendant que « b » se refait.
      session = await openApp(root, () => picked);
      const real = session.video.engine.proxy;
      let running = null;
      session.video.engine.proxy = async function (file, asset, target, options = {}) {
        if (asset.id === id("c")) throw Error("aperçu impossible (essai)");
        running = asset.id;
        await new Promise((resolve, reject) => {
          const t = setTimeout(resolve, 60000);
          options.signal?.addEventListener("abort", () => (clearTimeout(t), reject(Object.assign(Error("Interrompu"), { name: "AbortError" }))), { once: true });
        });
        return real.call(this, file, asset, target, options);
      };
      await session.video.healed;
      let jobs = session.api["video-list"]().jobs.filter((j) => j.kind === "proxy");
      assert.equal(jobs.length, 3);
      for (let i = 0; i < 200 && running !== id("a"); i++) await pause(50);
      assert.equal(running, id("a"));
      await session.api["video-job"]({ id: jobs[0].id, action: "cancel" });
      for (let i = 0; i < 200 && running !== id("b"); i++) await pause(50);
      assert.equal(running, id("b"), "la file continue");
      session.quit();
      await pause(500);
      const states = session.api["video-list"]().jobs.filter((j) => j.kind === "proxy").map((j) => j.state);
      assert.deepEqual(states.slice(0, 2), ["cancelled", "interrupted"], JSON.stringify(states));
      // Deuxième lancement : « a » (annulée) et « b » (interrompue) repartent
      // et réparent leur aperçu ; « c » échoue, pour de bon.
      session = await openApp(root, () => picked);
      const again = session.video.engine.proxy;
      session.video.engine.proxy = async function (file, asset, ...rest) {
        if (asset.id === id("c")) throw Error("aperçu impossible (essai)");
        return again.call(this, file, asset, ...rest);
      };
      await session.video.healed;
      jobs = (await settle(session.api)).filter((j) => j.kind === "proxy");
      assert.deepEqual(jobs.map((j) => j.state), ["done", "done", "failed"], JSON.stringify(jobs.map((j) => [j.state, j.error])));
      const media = JSON.parse(await fs.readFile(path.join(root, "Video Studio", "catalog.json"), "utf8")).media;
      for (const n of ["a", "b"]) assert(Math.abs(tone(pcm(media[id(n)].proxy)) - 300) < 10, n + " : l'aperçu est réparé");
      session.quit();
      // Troisième lancement : rien de nouveau, l'échec n'est pas recréé.
      session = await openApp(root, () => picked);
      await session.video.healed;
      jobs = (await settle(session.api)).filter((j) => j.kind === "proxy");
      assert.deepEqual(jobs.map((j) => j.state), ["done", "done", "failed"]);
    } finally {
      session?.quit();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

/** Un projet à trois médias (clair, sombre, carré qui se déplace), profils confirmés. */
async function lockProject(root) {
  const bright = path.join(root, "clair.mov"),
    dark = path.join(root, "sombre.mov"),
    moving = path.join(root, "carre.mkv");
  sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=2", "-c:v", "mpeg4", "-q:v", "3", bright]);
  sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=2", "-vf", "lutyuv=y='val*0.45'", "-c:v", "mpeg4", "-q:v", "3", dark]);
  sh(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=2", "-f", "lavfi", "-i", "testsrc=s=40x40:r=25:d=2", "-filter_complex", "[0:v][1:v]overlay=x='30+(W-w-60)*t/2':y='(H-h)/2'", "-c:v", "mpeg4", "-q:v", "2", moving]);
  let picked = [];
  const session = await openApp(root, () => picked),
    { api } = session,
    p = await api["video-create"]({ name: "Verrous" });
  picked = [bright, dark, moving];
  await api["video-import"](p.id);
  await settle(api);
  for (const a of api["video-project"](p.id).assets) await waitJob(api, (await api["video-space"]({ projectId: p.id, assetId: a.id, inputSpace: "rec709" })).id);
  const project = api["video-project"](p.id);
  return { session, api, p, project, byName: (n) => project.assets.find((a) => a.name === n) };
}

test(
  "verrou côté moteur : l'harmonisation couleur laisse tels quels les plans d'une piste verrouillée, dans la demande ou dans la séquence enregistrée, et la version harmonisée garde le verrou",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-verrou-couleur-"));
    let session;
    try {
      const f = await lockProject(root),
        { api, p, project, byName } = f;
      session = f.session;
      // Le sombre sur V1 (verrouillée) et sur V2, le clair en référence.
      const s = { ...project.sequences[0], fps: { n: 25, d: 1 }, width: 320, height: 180 };
      s.clips = [
        { ...M.clip(byName("sombre.mov"), s, 0, 0), duration: 25, id: "v1" },
        { ...M.clip(byName("sombre.mov"), s, 0, 1), duration: 25, id: "v2" },
        { ...M.clip(byName("clair.mov"), s, 25, 1), duration: 25, id: "ref" },
      ];
      const harmonise = async (sequence) => {
        const j = await api["video-autocolor"]({ projectId: p.id, sequence, referenceAssetId: byName("clair.mov").id });
        const done = await waitJob(api, j.id);
        assert.equal(done.state, "done", JSON.stringify(done));
        return api["video-project"](p.id).sequences.find((x) => x.id === done.result);
      };
      const locked = { ...s, tracks: { 0: { locked: true } } };
      await api["video-sequence"]({ projectId: p.id, sequence: locked, expectedVersion: s.version || 1 });
      const grade = (seq, id) => seq.clips.find((c) => c.id === id).grade;
      let graded = await harmonise(locked);
      assert.deepEqual(grade(graded, "v1"), grade(locked, "v1"), "la piste verrouillée garde son étalonnage");
      assert(grade(graded, "v2").exposure > 0.2, "la piste libre est harmonisée : " + JSON.stringify(grade(graded, "v2")));
      assert.equal(graded.tracks?.[0]?.locked, true);
      // Verrouillée dans la séquence enregistrée, pas dans la demande.
      graded = await harmonise({ ...locked, tracks: {} });
      assert.deepEqual(grade(graded, "v1"), grade(locked, "v1"), "verrouillée dans la séquence enregistrée : gardée aussi");
      assert(grade(graded, "v2").exposure > 0.2);
      assert.equal(graded.tracks?.[0]?.locked, true, "la copie garde le verrou");
    } finally {
      session?.quit();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);

test(
  "verrou côté moteur : un suivi de masque lancé avant que la piste soit verrouillée n'écrit rien, et finit avec un message clair ; un suivi demandé sur une piste verrouillée est refusé",
  { skip, timeout: 300000 },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-verrou-suivi-"));
    let session;
    const realTrack = TRACK.trackMask;
    let release = () => {};
    try {
      const f = await lockProject(root),
        { api, p, project, byName } = f;
      session = f.session;
      const stored = project.sequences[0],
        s = { ...stored, fps: { n: 25, d: 1 }, width: 320, height: 180 },
        mask = { id: "m", effect: "blur", shape: "rectangle", width: 0.15, height: 0.25, strength: 1, feather: 0.1, keys: [{ frame: 0, x: 50 / 320, y: 0.5 }] },
        tracked = { ...s, tracks: {}, clips: [{ ...M.clip(byName("carre.mkv"), s, 0, 0), duration: 50, id: "t", masks: [mask] }] };
      const saved = await api["video-sequence"]({ projectId: p.id, sequence: tracked, expectedVersion: stored.version || 1 });
      // Le suivi calcule ses repères, puis attend que la piste soit
      // verrouillée avant de les rendre.
      const gate = new Promise((r) => (release = r));
      TRACK.trackMask = async (...args) => {
        const result = await realTrack(...args);
        await gate;
        return result;
      };
      const job = await api["video-track-mask"]({ projectId: p.id, sequence: tracked, clipId: "t", maskId: "m" });
      for (let i = 0; i < 200 && api["video-list"]().jobs.find((j) => j.id === job.id)?.state !== "running"; i++) await pause(50);
      await api["video-sequence"]({ projectId: p.id, sequence: { ...tracked, tracks: { 0: { locked: true } } }, expectedVersion: saved.version });
      release();
      const done = await waitJob(api, job.id);
      const now = api["video-project"](p.id).sequences.find((x) => x.id === s.id);
      assert.deepEqual(now.clips[0].masks[0].keys, mask.keys, "les repères n'ont pas bougé");
      assert.equal(now.clips[0].masks[0].tracked, undefined);
      assert.equal(done.state, "failed", JSON.stringify(done));
      assert.match(done.error, /V1 a été verrouillée pendant le suivi/);
      // Et un suivi demandé sur une piste verrouillée est refusé.
      await assert.rejects(api["video-track-mask"]({ projectId: p.id, sequence: { ...tracked, tracks: { 0: { locked: true } } }, clipId: "t", maskId: "m" }), /verrouillée/);
    } finally {
      TRACK.trackMask = realTrack;
      release();
      session?.quit();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);
