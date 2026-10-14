// Film livré, neuvième passe (30/09/2026), sur de vrais fichiers et de la
// vraie parole (synthèse vocale de macOS, avec ses pauses) :
// - un ancien aperçu n'était comparé à la piste de l'app que sur trois
//   passages fixes (au quart, à la moitié et aux trois quarts du média), et
//   un silence des deux côtés y valait accord. Sur un rush de cérémonie dont
//   les trois tombaient dans une longue pause, un aperçu qui servait le
//   micro-cravate au lieu du micro caméra, ou le micro de secours 12 dB plus
//   bas, était jugé juste, marqué, et plus jamais revu : le moniteur faisait
//   entendre un autre micro que le film, pour toujours. Les passages sont
//   pris là où l'aperçu a du son, et un aperçu qui n'en a pas assez pour
//   conclure est refait.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  fss = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { Engine, sameSound } = require("../electron/video/engine.cjs");
const nativeRoot = path.join(__dirname, "../native", process.platform + "-" + process.arch),
  colorRoot = path.join(__dirname, "../public/video-color"),
  exe = process.platform === "win32" ? ".exe" : "",
  ffmpeg = path.join(nativeRoot, "ffmpeg" + exe),
  ffprobe = path.join(nativeRoot, "ffprobe" + exe),
  // La parole vient de la synthèse vocale de macOS (« say »).
  skip = !fss.existsSync(ffmpeg) || process.platform !== "darwin" || spawnSync("say", ["-v", "?"]).status !== 0;
function sh(bin, args) {
  const r = spawnSync(bin, args, { maxBuffer: 1 << 28 });
  if (r.status) throw Error(args.join(" ").slice(0, 300) + "\n" + String(r.stderr).slice(-600));
  return r.stdout;
}
/** La piste son que FFmpeg sert seul, sans « -map » (fftools, `map_auto_audio`). */
function automatic(file) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-v", "info", "-i", file, "-c", "copy", "-t", "0", "-f", "null", "-"]),
    kinds = new Map(JSON.parse(sh(ffprobe, ["-v", "error", "-show_entries", "stream=index,codec_type", "-of", "json", file])).streams.map((s) => [s.index, s.codec_type]));
  return [...String(r.stderr).matchAll(/Stream #0:(\d+) -> #0:\d+/g)].map((m) => Number(m[1])).find((i) => kinds.get(i) === "audio") ?? null;
}
/** L'aperçu tel que le fabriquait la 1.2.x : sans « -map », FFmpeg choisit seul sa piste son. */
function oldProxy(engine, file, target) {
  sh(ffmpeg, ["-v", "error", "-y", "-i", file, "-vf", "scale=160:90", "-enc_time_base:v", "demux", ...engine.encode(), "-c:a", "aac", "-ac", "2", "-ar", "48000", "-movflags", "+faststart", target]);
}
/** Niveau (dB, moyenne quadratique) d'un flux entre deux instants. */
function level(file, map, from, length) {
  const b = sh(ffmpeg, ["-v", "error", "-ss", String(from), "-t", String(length), "-i", file, "-map", map, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"]);
  let s = 0;
  for (let i = 0; i < b.length; i += 4) s += b.readFloatLE(i) ** 2;
  return 10 * Math.log10(s / Math.max(1, b.length / 4) + 1e-30);
}
const DURATION = 48;

test(
  "anciens aperçus d'un rush de cérémonie à longue pause (parole de 0 à 10 s et de 38 à 48 s) : l'aperçu qui servait le micro-cravate, le micro de secours 12 dB plus bas ou un autre fond de salle est refait, un aperçu sans aucun son aussi ; ceux qui servaient déjà la piste de l'app (piste « par défaut » elle-même, double mono, son 1,5 s après l'image, plan de coupe sans parole) sont gardés",
  { skip, timeout: 420000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-pauses-")),
      engine = new Engine({ nativeRoot, colorRoot });
    try {
      await engine.init();
      // La parole : une phrase dite deux fois, à 0 s et à 38 s, et 28 s de
      // silence entre les deux. Les passages d'avant (12, 24 et 36 s, à une
      // seconde près) tombent tous dans la pause.
      const voice = path.join(root, "voix.aiff"),
        speech = path.join(root, "parole.wav");
      sh("say", ["-v", "Thomas", "-o", voice, "--data-format=BEI16@48000", "Mesdames et messieurs, bienvenue à tous. [[slnc 1200]] Nous sommes réunis aujourd'hui pour célébrer l'union de Claire et de Julien. [[slnc 800]] Merci d'être venus si nombreux."]);
      sh(ffmpeg, ["-v", "error", "-y", "-i", voice, "-filter_complex", `[0:a]aresample=48000,asplit[a][b];[b]adelay=38000[c];[a][c]amix=inputs=2:normalize=0,apad,atrim=0:${DURATION}`, "-c:a", "pcm_s24le", speech]);
      assert(level(speech, "0:a:0", 11, 26) < -120, "la pause est muette");
      assert(level(speech, "0:a:0", 0, 10) > -40, "la parole est là");
      const V = ["-f", "lavfi", "-i", `testsrc2=s=160x90:r=30000/1001:d=${DURATION}`, "-i", speech],
        room = (seed, a = 0.004) => ["-f", "lavfi", "-i", `anoisesrc=d=${DURATION}:c=pink:r=48000:a=${a}:seed=${seed}`],
        // Micro caméra : la parole à -24 dB dans le fond de salle (entrée 2).
        CAMERA = "[1:a]volume=-24dB[v];[v][2:a]amix=inputs=2:normalize=0",
        // Micro-cravate : la parole de près, sans fond, muet dans la pause.
        CRAVATE = "[1:a]highpass=f=150,volume=-10dB",
        mov = (name, graph, extra, inputs = []) => {
          const file = path.join(root, name);
          sh(ffmpeg, ["-v", "error", "-y", ...V, ...inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[t1]", "-map", "[t2]", "-c:v", "mpeg4", "-c:a", "aac", "-b:a", "256k", ...extra, "-t", String(DURATION), file]);
          return file;
        },
        cases = [
          // Faux : FFmpeg servait la seconde piste, stéréo et « par défaut ».
          ["cravate.mov", true, mov("cravate.mov", `${CAMERA}[t1];${CRAVATE},pan=stereo|c0=c0|c1=c0[t2]`, ["-disposition:a:0", "0", "-disposition:a:1", "default"], room(11))],
          ["secours.mov", true, mov("secours.mov", `${CAMERA},asplit[t1][s];[s]volume=-12dB,pan=stereo|c0=c0|c1=c0[t2]`, ["-disposition:a:0", "0", "-disposition:a:1", "default"], room(11))],
          // Deux fonds de salle, sans parole : un autre micro reste un autre micro.
          ["autre-fond.mov", true, mov("autre-fond.mov", "[2:a]anull[t1];[3:a]pan=stereo|c0=c0|c1=c0[t2]", ["-disposition:a:0", "0", "-disposition:a:1", "default"], [...room(21, 0.002), ...room(22, 0.002)])],
          // Aucun son nulle part : rien ne permet de conclure.
          ["muet.mov", true, mov("muet.mov", "[2:a]anull[t1];[3:a]anull[t2]", ["-ac:a:0", "1", "-ac:a:1", "2"], ["-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono:d=${DURATION}`, "-f", "lavfi", "-i", `anullsrc=r=48000:cl=mono:d=${DURATION}`])],
          // Justes : FFmpeg servait déjà la piste de l'app.
          ["juste.mov", false, mov("juste.mov", `${CAMERA},pan=stereo|c0=c0|c1=c0[t1];${CRAVATE}[t2]`, ["-disposition:a:0", "default", "-disposition:a:1", "0"], room(11))],
          ["double-mono.mov", false, mov("double-mono.mov", `${CAMERA},asplit[t1][t2]`, [], room(11))],
          ["plan-calme.mov", false, mov("plan-calme.mov", "[2:a]pan=stereo|c0=c0|c1=c0[t1];[3:a]anull[t2]", [], [...room(21, 0.002), ...room(22, 0.002)])],
        ];
      // MPEG-TS, AC-3 5.1 puis stéréo, son 1,5 s après l'image : FFmpeg
      // servait la première, celle de l'app.
      const late = path.join(root, "son-tard.mts");
      sh(ffmpeg, ["-v", "error", "-y", ...V.slice(0, 4), "-itsoffset", "1.5", "-i", speech, ...room(11), "-filter_complex", `${CAMERA}[t1];${CRAVATE}[t2]`, "-map", "0:v", "-map", "[t1]", "-map", "[t2]", "-c:v", "mpeg2video", "-b:v", "1M", "-g", "15", "-c:a", "ac3", "-ac:a:0", "6", "-ac:a:1", "2", "-t", String(DURATION), "-f", "mpegts", late]);
      cases.push(["son-tard.mts", false, late]);
      const costs = [];
      for (const [name, stale, file] of cases) {
        const sound = await engine.soundTrack(file),
          chosen = automatic(file);
        assert.equal(sound.usable, 2, name);
        if (name !== "muet.mov") assert.equal(chosen !== sound.index, ["cravate.mov", "secours.mov", "autre-fond.mov"].includes(name), `${name} : FFmpeg servait la piste ${chosen}, l'app prend ${sound.index}`);
        const asset = { id: name, name, ...(await engine.probe(file)), inputSpace: "rec709" },
          old = path.join(root, name + ".apercu.mp4");
        oldProxy(engine, file, old);
        const t0 = Date.now();
        assert.equal(await engine.proxyStale(file, asset, old), stale, `${name} : ${stale ? "l'aperçu est faux ou muet, il doit être refait" : "l'aperçu servait déjà la piste de l'app, il est gardé"}`);
        costs.push(`${name} ${Date.now() - t0} ms`);
        if (!stale) continue;
        // Refait par la version actuelle, l'aperçu est jugé juste, sauf
        // celui qui n'a toujours aucun son.
        const fresh = path.join(root, name + ".refait.mp4");
        await engine.proxy(file, asset, fresh);
        assert.equal(await engine.proxyStale(file, asset, fresh), name === "muet.mov", name + " : l'aperçu refait");
      }
      t.diagnostic("coût de la revue par média : " + costs.join(", "));
      // Le passage le plus fort de l'aperçu faux est bien de la parole, et
      // la piste de l'app n'y dit pas la même chose (13 dB d'écart).
      const wrong = path.join(root, "cravate.mov.apercu.mp4"),
        at = await engine.loudPassages(wrong, 2, DURATION - 2.1);
      assert(at.length >= 2 && at.every((x) => x < 10 || x > 37), "passages de parole : " + at);
      assert(!sameSound(await engine.samples(wrong, "0:a:0", at[0], 2), await engine.samples(cases[0][2], "0:1", at[0] - 1, 4)));
      // Un silence ne vaut plus accord.
      assert.equal(sameSound(new Float32Array(32000), new Float32Array(64000)), false);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
);
