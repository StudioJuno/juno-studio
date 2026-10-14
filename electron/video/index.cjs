const WORDS = require("./transcript-words.cjs");
const MOTION = require("./motion.cjs");
const LOUD = require("./loudness.cjs");
const MOMENTS = require("./moments.cjs");
const TRACK = require("./track.cjs");
const DERUSH = require("./derush.cjs");
const fs = require("node:fs/promises"),
  fss = require("node:fs"),
  path = require("node:path"),
  { randomUUID, createHash } = require("node:crypto"),
  { Readable } = require("node:stream");
const { VideoStore } = require("./store.cjs"),
  { Engine, stallText, SOUND_RULE, cameraOf } = require("./engine.cjs"),
  M = require("./model.cjs"),
  R = require("./render.cjs");
const MC = require("./multicam.cjs");
const AUDIO = require("./audio.cjs");
const commandHistory = require("./commands.cjs");
const { fingerprint, sha256 } = require("./identity.cjs");
const { writeJsonAtomic } = require("../atomic.cjs");
const { formats, filters } = require("../media-import.cjs");
const publicJob = (j) => {
  const { payload, ...safe } = j;
  return safe;
};
async function registerVideo({
  handle,
  app,
  dialog,
  protocol,
  getWindow,
  nativeRoot,
  colorRoot,
  safeStorage,
  registerMediaFiles,
  secureMedia,
  resolveMedia,
  locateMedia,
  // Le dérushage de fond après un import, un aperçu refait ou l'ouverture
  // d'un projet. Éteint par défaut : les tests du moteur comptent leurs
  // écritures et leurs tâches sans lui ; l'application l'allume (main.cjs).
  autoDerush = false,
}) {
  const store = await new VideoStore(
      path.join(app.getPath("userData"), "Video Studio"),
    ).init(),
    engine = new Engine({ nativeRoot, colorRoot });
  await engine.init();
  const lanes = {
    local: { pumping: false, controller: null, id: null },
    cloud: { pumping: false, controller: null, id: null },
  };
  const diskFailures = new Map();
  // Les prévisions de dérushage d'un projet, l'une après l'autre (`planDerush`).
  const derushVerrous = new Map();
  // L'app se ferme (« will-quit ») : plus rien ne commence.
  let quitting = false;
  const laneFor = (kind) => (kind === "generate" ? "cloud" : "local");
  function requireProject(id) {
    const p = store.project(id);
    if (!p) throw Error("Projet vidéo introuvable");
    return p;
  }
  const updateJob = (id, patch) =>
    store.mutate((d) =>
      Object.assign(
        d.jobs.find((j) => j.id === id),
        patch,
      ),
    );
  async function enqueue(projectId, kind, label, payload, total) {
    requireProject(projectId);
    if (!engine.status.available && kind !== "noop")
      throw Error("Le moteur vidéo est indisponible sur cette installation");
    const job = {
      id: randomUUID(),
      projectId,
      kind,
      label,
      state: "queued",
      cursor: 0,
      total,
      progress: 0,
      created: Date.now(),
      payload,
      errors: [],
    };
    await store.mutate((d) => d.jobs.push(job));
    if (!payload?.background) makeWay(laneFor(kind));
    void pump(laneFor(kind));
    return publicJob(job);
  }
  /**
   * Les tâches de fond (`payload.background` : aperçus refaits au démarrage,
   * `healProxies`) ne retardent jamais une tâche demandée : la file prend
   * d'abord celles-ci (`pump`), et une tâche de fond en cours cède sa place
   * dès qu'une autre arrive. Elle repart plus tard, de zéro (un aperçu
   * s'écrit à part puis remplace l'ancien d'un coup). Elles passaient dans
   * l'ordre d'arrivée : six .mts à deux pistes retardaient de 40 s un export
   * demandé à l'ouverture, des heures pour un mariage entier (30/09/2026).
   */
  const YIELD = "juno-cede-la-place";
  function makeWay(laneName) {
    const lane = lanes[laneName],
      running = lane.id && store.data.jobs.find((j) => j.id === lane.id);
    if (running?.payload?.background && !lane.controller?.signal.aborted)
      lane.controller?.abort(YIELD);
  }
  async function pump(laneName = "local") {
    const lane = lanes[laneName];
    if (
      // L'app se ferme : plus aucune tâche ne commence. Celles qui attendent
      // reprendront au lancement suivant.
      quitting ||
      lane.pumping ||
      [...diskFailures.keys()].some(
        (id) =>
          laneFor(store.data.jobs.find((j) => j.id === id)?.kind) === laneName,
      )
    )
      return;
    const waiting = store.data.jobs.filter(
        (j) => j.state === "queued" && laneFor(j.kind) === laneName,
      ),
      next = waiting.find((j) => !j.payload?.background) || waiting[0];
    if (!next) return;
    lane.pumping = true;
    lane.id = next.id;
    lane.controller = new AbortController();
    const signal = lane.controller.signal;
    try {
      await updateJob(next.id, { state: "running", error: undefined });
      if (next.kind === "autocolor") await doAutoColor(next, signal);
      else if (next.kind === "audio") await doAudio(next, signal);
      else if (next.kind === "generate") await doGenerate(next, signal);
      else if (next.kind === "restore") await doRestore(next, signal);
      else if (next.kind === "sync") await doSync(next, signal);
      else if (next.kind === "import") await doImport(next, signal);
      else if (next.kind === "proxy") await doProxy(next, signal);
      else if (next.kind === "export") await doExport(next, signal);
      else if (next.kind === "analyze") await doAnalyze(next, signal);
      else if (next.kind === "transcribe") await doTranscribe(next, signal);
      else if (next.kind === "track") await doTrack(next, signal);
      else if (next.kind === "derush") await doDerush(next, signal);
      // Une tâche de fond qui a fini son travail au moment de céder la place
      // est finie (`makeWay`).
      if (!signal.aborted || signal.reason === YIELD) {
        await updateJob(next.id, { state: "done", progress: 1 });
        // Des rushes nouveaux, ou un aperçu refait (profil couleur
        // confirmé, média retrouvé) : leur dérushage part en fond.
        if (["import", "proxy", "restore"].includes(next.kind))
          void planDerush(next.projectId, { ids: mediasDeTache(next) }).catch(
            () => {},
          );
      }
    } catch (e) {
      try {
        const current = store.data.jobs.find((j) => j.id === next.id);
        if (e.name === "AbortError" || signal.aborted) {
          // Une tâche de fond qui cède la place attend son tour, sans
          // compter comme une tentative (`makeWay`).
          if (current?.state === "running")
            await updateJob(
              next.id,
              signal.reason === YIELD
                ? { state: "queued", cursor: 0, progress: 0 }
                : { state: "interrupted" },
            );
        } else await updateJob(next.id, { state: "failed", error: e.message });
      } catch (writeError) {
        // Keep the durable cursor; stop this lane until the user explicitly retries.
        diskFailures.set(
          next.id,
          "Enregistrement interrompu : " +
            writeError.message +
            ". Vérifiez le disque puis reprenez la tâche.",
        );
      }
    } finally {
      lane.pumping = false;
      lane.id = null;
      lane.controller = null;
      void pump(laneName);
    }
  }
  /**
   * Ménage du démarrage : les segments d'exports qui ne reprendront plus
   * (tâche retirée, terminée ou annulée) et les films de relecture dont la
   * tâche a été retirée. Avant, ils restaient sur le disque pour toujours.
   */
  async function purgeRenders() {
    // L'état des tâches est relu à chaque fichier : une tâche ajoutée pendant
    // ce ménage garde les siens.
    const resumable = (id) =>
      store.data.jobs.some(
        (j) =>
          j.id === id &&
          j.kind === "export" &&
          !["done", "cancelled"].includes(j.state),
      );
    const renders = path.join(store.root, "renders");
    for (const name of await fs.readdir(renders).catch(() => []))
      if (!resumable(name))
        await fs
          .rm(path.join(renders, name), { recursive: true, force: true })
          .catch(() => {});
    const review = path.join(store.root, "review-renders"),
      stem = (file) => path.basename(file).split(".")[0],
      owned = (name) =>
        store.data.jobs.some(
          (j) =>
            j.kind === "export" &&
            typeof j.payload?.destination === "string" &&
            path.dirname(j.payload.destination) === review &&
            stem(j.payload.destination) === stem(name),
        );
    for (const name of await fs.readdir(review).catch(() => []))
      if (!owned(name))
        await fs.rm(path.join(review, name), { force: true }).catch(() => {});
  }
  const purged = purgeRenders().catch(() => {});
  /**
   * La marque d'un aperçu fabriqué selon la règle de la piste son
   * (`SOUND_RULE`), pour une version donnée du fichier (taille et date) :
   * `healProxies` ne revoit jamais deux fois la même.
   */
  async function soundMark(file) {
    const s = await fs.stat(file);
    return [SOUND_RULE, s.size, s.mtimeMs].join("|");
  }
  /**
   * Les aperçus fabriqués avant le 30/09/2026, sans « -map » ou avec la
   * première piste son quelle qu'elle soit : FFmpeg y servait une piste qui
   * peut ne pas être celle du film, et la fiche du média pouvait décrire une
   * piste vide. Seuls ceux qui sont faux (moteur, `proxyStale`) sont refaits,
   * en tâche de fond (`payload.background`), fiche et onde comprises
   * (`doProxy`) ; tous les autres sont seulement marqués, sans rien refaire.
   *
   * Une seule tentative par version du fichier, qui ne compte qu'à sa fin
   * réelle : la marque est posée quand la tâche réussit ou échoue (`doProxy`),
   * et une tâche qui échoue n'est jamais recréée. Posée dès la création, elle
   * comptait comme une tentative une tâche annulée ou interrompue par la
   * fermeture de l'app, et le média n'était jamais réparé (30/09/2026). Une
   * tâche de fond interrompue par la fermeture repart au démarrage suivant,
   * une tâche annulée y est reproposée. Un média hors ligne est revu au
   * démarrage suivant.
   */
  async function healProxies() {
    if (!engine.status.available) return;
    const again = (ids) =>
      store.mutate((d) => {
        for (const j of d.jobs)
          if (
            ids.includes(j.id) &&
            ["interrupted", "cancelled"].includes(j.state)
          )
            Object.assign(j, {
              state: "queued",
              cursor: 0,
              progress: 0,
              error: undefined,
            });
      });
    const stopped = store.data.jobs
      .filter((j) => j.payload?.background && j.state === "interrupted")
      .map((j) => j.id);
    if (stopped.length) {
      await again(stopped);
      void pump("local");
    }
    let marks = new Map();
    const flush = async () => {
      const done = marks;
      marks = new Map();
      if (done.size)
        await store.mutate((d) => {
          for (const [id, mark] of done)
            if (d.media[id]) {
              d.media[id].proxySound = mark;
              delete d.media[id].proxyTrack;
            }
        });
    };
    const seen = new Set();
    for (const p of store.data.projects)
      for (const a of p.assets || []) {
        if (quitting) break;
        const registered = store.data.media[a.id];
        if (
          seen.has(a.id) ||
          !["video", "audio"].includes(a.kind) ||
          a.status !== "ready" ||
          !registered?.proxy ||
          registered.proxy === registered.source ||
          store.data.jobs.some(
            (j) =>
              j.kind === "proxy" &&
              j.payload?.assetId === a.id &&
              !["done", "failed", "cancelled"].includes(j.state),
          )
        )
          continue;
        seen.add(a.id);
        const file = registered.renderSource || registered.source;
        let mark, stale;
        try {
          mark = await soundMark(file);
          if (registered.proxySound === mark) continue;
          await fs.access(registered.proxy);
          stale = await engine.proxyStale(file, a, registered.proxy);
        } catch {
          continue;
        }
        if (quitting) break;
        if (!stale) {
          marks.set(a.id, mark);
          if (marks.size >= 50) await flush();
          continue;
        }
        // Annulée à un lancement précédent : la même tâche repart.
        const cancelled = store.data.jobs.findLast(
          (j) =>
            j.kind === "proxy" &&
            j.payload?.assetId === a.id &&
            j.payload?.background &&
            j.state === "cancelled",
        );
        if (cancelled) {
          await again([cancelled.id]).catch(() => {});
          void pump("local");
        } else
          await enqueue(
            p.id,
            "proxy",
            "Refaire l’aperçu",
            {
              assetId: a.id,
              inputSpace: a.inputSpace,
              rebuild: true,
              background: true,
            },
            1,
          ).catch(() => {});
      }
    await flush();
  }
  const healed = purged.then(() => healProxies()).catch(() => {});
  const keyPath = path.join(store.root, "google-key.enc");
  const readKey = async () => {
    if (!safeStorage?.isEncryptionAvailable())
      throw Error("Stockage sécurisé indisponible");
    try {
      return safeStorage.decryptString(await fs.readFile(keyPath));
    } catch {
      throw Error(
        "Configurez une clé Google AI Studio dans le panneau Génération",
      );
    }
  };
  async function doGenerate(job, signal) {
    const { VeoProvider } = require("./generation.cjs"),
      provider = new VeoProvider(await readKey());
    const payload = () => store.data.jobs.find((j) => j.id === job.id).payload;
    const setPayload = (patch) =>
      store.mutate((d) =>
        Object.assign(d.jobs.find((j) => j.id === job.id).payload, patch),
      );
    if (!payload().operation) {
      if (payload().submitting)
        throw Error(
          "La réponse à la demande initiale est incertaine. Vérifiez la génération et la consommation dans votre compte Google avant toute nouvelle demande.",
        );
      await setPayload({ submitting: true });
      let operation;
      try {
        operation = await provider.submit(payload().request, signal);
      } catch (e) {
        if (e.httpStatus && e.httpStatus < 500)
          await setPayload({ submitting: false });
        throw e;
      }
      await setPayload({ operation, submitting: false });
      await updateJob(job.id, { cursor: 1, progress: 0.1 });
    }
    const folder = path.join(store.root, "generated");
    await fs.mkdir(folder, { recursive: true });
    const file = path.join(folder, "Juno-IA-" + job.id + ".mp4");
    if (!payload().downloaded) {
      let result,
        done = false;
      for (let i = 0; i < 180; i++) {
        result = await provider.poll(payload().operation, signal);
        if (result.done) {
          done = true;
          break;
        }
        await new Promise((resolve, reject) => {
          const abort = () => {
            clearTimeout(timer);
            reject(Object.assign(Error("Interrompu"), { name: "AbortError" }));
          };
          const timer = setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
          }, 10000);
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        });
      }
      if (!done)
        throw Error(
          "La génération continue chez Google. Reprenez cette tâche pour consulter son résultat sans renvoyer de demande.",
        );
      if (result.error)
        throw Error(
          "Google : " +
            String(result.error.message || "Génération refusée").slice(0, 1200),
        );
      const uri =
        result.response?.generateVideoResponse?.generatedSamples?.[0]?.video
          ?.uri;
      if (!uri)
        throw Error("Le fournisseur n’a pas renvoyé de vidéo exploitable");
      const partial = file + ".partial";
      try {
        await provider.download(uri, partial, signal);
        await engine.probe(partial);
        await fs.rename(partial, file);
      } finally {
        await fs.unlink(partial).catch(() => {});
      }
      await setPayload({ downloaded: true });
      await updateJob(job.id, { cursor: 2, progress: 0.9 });
    }
    if (!payload().importJobId) {
      const task = await enqueue(
        job.projectId,
        "import",
        "Préparer la vidéo générée",
        {
          files: [file],
          ids: [job.payload.assetId],
          generation: {
            provider: "Google Veo",
            model: job.payload.request.model,
            prompt: job.payload.request.prompt,
          },
        },
        1,
      );
      await setPayload({ importJobId: task.id });
    }
    await updateJob(job.id, { result: file, cursor: 3, progress: 1 });
  }
  async function doAutoColor(job, signal) {
    const p = requireProject(job.projectId),
      s = structuredClone(job.payload.sequence),
      ids = [
        ...new Set(s.clips.filter((c) => c.track < 10).map((c) => c.assetId)),
      ],
      stats = {};
    for (let i = 0; i < ids.length; i++) {
      const a = p.assets.find((a) => a.id === ids[i]);
      if (a.inputSpace !== job.payload.spaces[a.id])
        throw Error("Un profil source a changé : recommencez l’harmonisation");
      stats[a.id] = await engine.colorStats(
        store.data.media[a.id].proxy,
        a,
        store.root,
        { signal },
      );
      await updateJob(job.id, {
        cursor: i + 1,
        progress: (i + 1) / (ids.length + 1),
      });
    }
    const { recommend } = require("./autocolor.cjs"),
      reference = stats[job.payload.referenceAssetId],
      // Une piste verrouillée garde ses plans tels quels dans la version
      // harmonisée : verrouillée quand l'harmonisation a été demandée, ou
      // depuis, dans la séquence enregistrée. Ses plans étaient regradés
      // comme les autres (30/09/2026). La copie garde ce verrou.
      current = requireProject(job.projectId).sequences.find(
        (x) => x.id === job.payload.sequence.id,
      ),
      locked = (n) => !!s.tracks?.[n]?.locked || !!current?.tracks?.[n]?.locked;
    for (const [n, t] of Object.entries(current?.tracks || {}))
      if (t?.locked && !s.tracks?.[n]?.locked)
        s.tracks = { ...s.tracks, [n]: { ...s.tracks?.[n], locked: true } };
    s.id = job.payload.sequenceId;
    s.name = s.name.slice(0, 155) + " · Couleur harmonisée";
    s.version = 1;
    for (const c of s.clips)
      if (c.track < 10 && !locked(c.track)) {
        const delta = recommend(
          stats[c.assetId],
          reference,
          job.payload.strength,
        );
        c.grade = {
          ...c.grade,
          exposure: M.clamp(c.grade.exposure + delta.exposure, -5, 5),
          warmth: M.clamp(c.grade.warmth + delta.warmth, -0.5, 0.5),
          tint: M.clamp(c.grade.tint + delta.tint, -0.5, 0.5),
        };
      }
    M.validateSequence(s, new Map(p.assets.map((a) => [a.id, a])));
    await store.history(p);
    await store.mutate((d) => {
      const q = d.projects.find((p) => p.id === job.projectId);
      if (!q.sequences.some((x) => x.id === s.id)) {
        if (q.sequences.length >= 100)
          throw Error("Limite de séquences atteinte");
        q.sequences.push(s);
        q.revision++;
      }
    });
    await updateJob(job.id, { result: s.id, progress: 1 });
  }
  async function doImport(job, signal) {
    for (let i = job.cursor; i < job.payload.files.length; i++) {
      if (signal.aborted)
        throw Object.assign(Error("Interrompu"), { name: "AbortError" });
      let file = job.payload.files[i];
      const originalName = job.payload.names?.[i] || path.basename(file),
        p = requireProject(job.projectId),
        existing = p.assets.find(
          (a) => store.data.media[a.id]?.source === file,
        );
      if (existing) {
        await updateJob(job.id, {
          cursor: i + 1,
          progress: (i + 1) / job.total,
        });
        continue;
      }
      let stage = "source",
        sourceSha256;
      try {
        if (secureMedia && job.payload.registeredIds?.[i]) {
          stage = "copie";
          const secured = await secureMedia(
            job.payload.registeredIds[i],
            job.payload.hashes?.[i],
          );
          file = typeof secured === "string" ? secured : secured.source;
          sourceSha256 = secured.hash;
          await store.mutate((d) => {
            const payload = d.jobs.find((j) => j.id === job.id).payload;
            payload.files[i] = file;
            if (secured.hash) (payload.hashes ??= [])[i] = secured.hash;
          });
        }
        stage = "vérification";
        const sourceSignature = await signature(file),
          sourceFingerprint = await fingerprint(file);
        sourceSha256 ||= await sha256(file);
        stage = "lecture";
        const meta = await engine.probe(file),
          id = job.payload.ids[i],
          cache = path.join(store.root, "cache", id);
        await fs.mkdir(cache, { recursive: true });
        const image = meta.kind === "image",
          inputSpace = image ? "srgb" : "rec709",
          asset = {
            id,
            name: originalName,
            ...meta,
            // Un média de la bibliothèque est lu dans sa copie sûre, sous un
            // autre nom : la caméra se devine aussi sur le nom d'origine
            // (C0001.MP4, MVI_0457.MP4, DJI_0001.MP4).
            camera: meta.camera ?? cameraOf(undefined, undefined, originalName),
            inputSpace,
            spaceConfirmed: image || meta.color.transfer === "bt709",
            status: "processing",
            source: "juno-video://media/" + id + "/source",
            created: Date.now(),
            generation: job.payload.generation,
          };
        stage = "décodage image";
        const renderSource = await engine.imageSource(file, meta, cache, {
          signal,
        });
        if (renderSource !== file)
          asset.note = "Image composite · profil couleur à vérifier";
        stage = "aperçu";
        await engine.proxy(renderSource, asset, path.join(cache, "proxy.mp4"), {
          signal,
        });
        stage = "miniature";
        // Une vignette manquante ne vaut pas un média refusé : le plan reste
        // montable, sa case affiche seulement son nom.
        const thumbnailed = await thumbnailOrNothing(
          renderSource,
          asset,
          path.join(cache, "thumb.jpg"),
          signal,
        );
        if (meta.audioChannels)
          asset.waveform = await engine.waveform(file, meta.duration, {
            signal,
          });
        asset.proxy = "juno-video://media/" + id + "/proxy";
        if (!image && meta.kind === "video" && asset.spaceConfirmed === false)
          asset.note = "Profil source à confirmer";
        if (meta.kind !== "audio" && thumbnailed)
          asset.thumbnail = "juno-video://media/" + id + "/thumb";
        asset.status = "ready";
        stage = "catalogue";
        await unchanged(file, sourceSignature, "Le média source");
        // L'aperçu sert la piste son de l'app (`healProxies`).
        const proxySound = await soundMark(renderSource);
        await store.mutate((d) => {
          d.media[id] = {
            source: file,
            renderSource: renderSource !== file ? renderSource : undefined,
            managed: !!job.payload.registeredIds?.[i],
            sourceSignature,
            sourceFingerprint,
            sourceSha256,
            proxy: path.join(cache, "proxy.mp4"),
            proxySound,
            thumb: path.join(cache, "thumb.jpg"),
          };
          const q = d.projects.find((p) => p.id === job.projectId);
          q.assets.push(asset);
          q.revision++;
          q.updated = Date.now();
        });
      } catch (e) {
        if (signal.aborted) throw e;
        await store.mutate((d) => {
          const j = d.jobs.find((j) => j.id === job.id),
            message = String(e.message || e).slice(0, 2400);
          j.errors.push(originalName + " : " + message);
          (j.failures ??= []).push({
            index: i,
            name: originalName,
            message,
            stage,
            code: e.code || "MEDIA_DECODE",
          });
        });
      }
      await updateJob(job.id, { cursor: i + 1, progress: (i + 1) / job.total });
    }
  }
  /** La vignette si elle se fabrique ; sinon rien, sans refuser le média. */
  async function thumbnailOrNothing(file, asset, target, signal) {
    try {
      await engine.thumbnail(file, asset, target, { signal });
      return true;
    } catch (e) {
      if (signal?.aborted) throw e;
      return false;
    }
  }
  async function doRestore(job, signal) {
    for (let i = job.cursor; i < job.payload.ids.length; i++) {
      const id = job.payload.ids[i];
      try {
        await relinkMedia(
          job.projectId,
          id,
          job.payload.paths?.[id] || store.data.media[id].source,
          signal,
        );
      } catch (e) {
        if (signal.aborted) throw e;
        await store.mutate((d) => {
          const p = d.projects.find((p) => p.id === job.projectId);
          Object.assign(
            p.assets.find((a) => a.id === id),
            { status: "error", error: e.message },
          );
          p.revision++;
          d.jobs.find((j) => j.id === job.id).errors.push(e.message);
        });
      }
      await updateJob(job.id, { cursor: i + 1, progress: (i + 1) / job.total });
    }
  }
  async function relinkMedia(projectId, id, file, signal) {
    const p = requireProject(projectId),
      a = p.assets.find((a) => a.id === id),
      record = store.data.media[id];
    if (!a || !record) throw Error("Média inconnu");
    if (!path.isAbsolute(file)) throw Error("Choisissez un média compatible");
    const sourceSignature = await signature(file),
      sourceFingerprint = await fingerprint(file);
    let expectedSha256 = record.sourceSha256;
    if (!expectedSha256) {
      const sourceJob = store.data.jobs.find(
        (j) => j.kind === "import" && j.payload.ids?.includes(id),
      );
      expectedSha256 =
        sourceJob?.payload.hashes?.[sourceJob.payload.ids.indexOf(id)];
    }
    const sourceSha256 = await sha256(file);
    if (expectedSha256 && expectedSha256 !== sourceSha256)
      throw Error(
        "L’intégrité complète du fichier ne correspond pas à " + a.name,
      );
    if (
      record.sourceFingerprint &&
      record.sourceFingerprint !== sourceFingerprint
    )
      throw Error("Ce fichier ne correspond pas au média attendu : " + a.name);
    const meta = await engine.probe(file);
    // Un média importé plus tôt peut porter la durée du conteneur, celle de
    // la piste la plus longue ; un média importé aujourd'hui, celle de son
    // image. Les deux désignent le même fichier.
    const near = (d) => Math.abs(d - a.duration) <= 0.15;
    if (
      meta.kind !== a.kind ||
      !(near(meta.duration) || near(meta.containerDuration ?? meta.duration))
    )
      throw Error(
        "Le type ou la durée du fichier ne correspond pas à " + a.name,
      );
    const cache = path.join(store.root, "cache", id);
    await fs.mkdir(cache, { recursive: true });
    const proxy = path.join(cache, "proxy.mp4"),
      thumb = path.join(cache, "thumb.jpg");
    const renderSource = await engine.imageSource(file, meta, cache, {
      signal,
    });
    await engine.proxy(renderSource, a, proxy, { signal });
    const thumbnailed = await thumbnailOrNothing(
      renderSource,
      a,
      thumb,
      signal,
    );
    // La fiche décrit la piste son que sert l'aperçu et que prend le rendu
    // (moteur, `soundOf`) : relue ici, comme à l'import.
    const waveform = meta.audioChannels
        ? await engine.waveform(file, a.duration, { signal })
        : undefined,
      proxySound = await soundMark(renderSource);
    await unchanged(file, sourceSignature, "Le média source");
    await store.mutate((d) => {
      d.media[id] = {
        source: file,
        renderSource: renderSource !== file ? renderSource : undefined,
        proxy,
        proxySound,
        thumb,
        sourceFingerprint,
        sourceSha256,
        sourceSignature,
      };
      const q = d.projects.find((p) => p.id === projectId),
        target = q.assets.find((a) => a.id === id);
      Object.assign(target, {
        status: "ready",
        error: undefined,
        proxy: "juno-video://media/" + id + "/proxy?v=" + Date.now(),
        thumbnail:
          a.kind === "audio" || !thumbnailed
            ? undefined
            : "juno-video://media/" + id + "/thumb?v=" + Date.now(),
        waveform,
        audioChannels: meta.audioChannels,
        sampleRate: meta.sampleRate,
      });
      q.revision++;
    });
  }
  async function doAudio(job, signal) {
    const p = requireProject(job.projectId),
      { assetId, resultId, settings } = job.payload;
    if (p.assets.some((a) => a.id === resultId)) {
      await updateJob(job.id, { result: resultId, cursor: 1, progress: 1 });
      return;
    }
    const a = p.assets.find((a) => a.id === assetId),
      registered = store.data.media[assetId];
    if (!a?.audioChannels || !registered)
      throw Error("Source audio introuvable");
    const source = registered.source,
      before = await signature(source),
      beforeHash = await fingerprint(source);
    const folder = path.join(store.root, "audio");
    await fs.mkdir(folder, { recursive: true });
    await requireSpace(folder, Math.ceil(a.duration * 48000 * 2 * 3) + 100e6);
    const file = path.join(folder, resultId + ".wav"),
      partial = file + ".partial.wav";
    const model = path.join(
      path.dirname(nativeRoot),
      "models",
      "juno-voice.rnnn",
    );
    try {
      if (settings.strength) await fs.access(model);
      // La piste son de l'app (moteur, `soundOf`), celle du moniteur et du
      // film.
      const sound = await engine.soundMap(source);
      if (!sound.length) throw Error("Ce média ne contient pas de son lisible");
      await engine.ff(
        [
          "-y",
          "-i",
          source,
          ...sound,
          "-vn",
          "-af",
          AUDIO.filters(settings, model),
          "-ar",
          "48000",
          "-ac",
          "2",
          "-c:a",
          "pcm_s24le",
          partial,
        ],
        { signal },
      );
      const meta = await engine.probe(partial),
        // Comparer au son de la source, pas à son image : le son d'un rush
        // peut déborder de l'image de quelques centièmes.
        heard = (await engine.probe(source)).audioDuration || a.duration;
      if (Math.abs(meta.duration - heard) > 0.1)
        throw Error(
          "La durée du son traité ne correspond pas à la source. Aucun plan remplacé.",
        );
      const waveform = await engine.waveform(partial, meta.duration, {
        signal,
      });
      await unchanged(source, before, "Le son source");
      if ((await fingerprint(source)) !== beforeHash)
        throw Error("Le son source a changé pendant le traitement");
      if (signal.aborted)
        throw Object.assign(Error("Interrompu"), { name: "AbortError" });
      await fs.rename(partial, file);
      const sourceSignature = await signature(file),
        sourceFingerprint = await fingerprint(file),
        sourceSha256 = await sha256(file);
      await store.mutate((d) => {
        const q = d.projects.find((p) => p.id === job.projectId);
        if (!q) throw Error("Projet introuvable");
        d.media[resultId] = {
          source: file,
          proxy: file,
          managed: true,
          sourceSignature,
          sourceFingerprint,
          sourceSha256,
        };
        q.assets.push({
          ...meta,
          id: resultId,
          name: a.name + " · voix améliorée",
          inputSpace: "rec709",
          spaceConfirmed: true,
          source: "juno-video://media/" + resultId + "/source",
          proxy: "juno-video://media/" + resultId + "/proxy",
          waveform,
          status: "ready",
          created: Date.now(),
          audioProcessing: { sourceAssetId: assetId, settings },
        });
        q.revision++;
        q.updated = Date.now();
      });
      await updateJob(job.id, { result: resultId, cursor: 1, progress: 1 });
    } finally {
      await fs.unlink(partial).catch(() => {});
    }
  }
  async function doProxy(job, signal) {
    const p = requireProject(job.projectId),
      a = p.assets.find((a) => a.id === job.payload.assetId);
    if (!a) throw Error("Média introuvable");
    const background = !!job.payload.background,
      registered = store.data.media[a.id],
      // Refait en tâche de fond (`healProxies`), l'aperçu garde le profil
      // couleur que le média a quand la tâche commence : elle passe après
      // les tâches demandées, et le profil noté à sa création aurait défait
      // un « Actualiser la couleur source » fait entre-temps.
      space = background ? a.inputSpace : job.payload.inputSpace,
      asset = { ...a, inputSpace: space },
      file = registered.renderSource || registered.source,
      proxySound = await soundMark(file);
    // Déjà refait selon la règle depuis (profil couleur actualisé) : rien à
    // refaire.
    if (background && registered.proxySound === proxySound) return;
    try {
      await buildProxy(job, signal, {
        a,
        registered,
        space,
        asset,
        file,
        proxySound,
      });
    } catch (e) {
      // Une tentative ne compte qu'à sa fin réelle (`healProxies`) : un échec
      // est marqué, et la tâche n'est plus recréée pour cette version du
      // fichier ; une annulation ou une fermeture ne l'est pas.
      if (background && !signal.aborted && e?.name !== "AbortError")
        await store
          .mutate((d) => {
            if (d.media[a.id]) {
              d.media[a.id].proxySound = proxySound;
              delete d.media[a.id].proxyTrack;
            }
          })
          .catch(() => {});
      throw e;
    }
  }
  async function buildProxy(
    job,
    signal,
    { a, registered, space, asset, file, proxySound },
  ) {
    // Refait au démarrage (`healProxies`) : la fiche relit aussi la piste son
    // de l'app, et l'onde est refaite sur elle. Un média importé avant le
    // 30/09/2026 décrivait la première piste son, vide ou non.
    let sound;
    if (job.payload.rebuild && a.kind !== "image") {
      const meta = await engine.probe(file);
      sound = {
        audioChannels: meta.audioChannels,
        sampleRate: meta.sampleRate,
        waveform: meta.audioChannels
          ? await engine.waveform(file, a.duration, { signal })
          : undefined,
      };
    }
    await engine.proxy(file, asset, registered.proxy + ".new", {
      signal,
    });
    await engine.thumbnail(
      registered.renderSource || registered.source,
      asset,
      registered.thumb + ".new.jpg",
      { signal },
    );
    await fs.rename(registered.proxy + ".new", registered.proxy);
    if (a.kind !== "audio")
      await fs.rename(registered.thumb + ".new.jpg", registered.thumb);
    await store.mutate((d) => {
      const q = d.projects.find((p) => p.id === job.projectId),
        target = q.assets.find((a) => a.id === asset.id);
      if (d.media[asset.id]) {
        d.media[asset.id].proxySound = proxySound;
        delete d.media[asset.id].proxyTrack;
      }
      if (sound) Object.assign(target, sound);
      Object.assign(target, {
        inputSpace: space,
        // Un aperçu refait au démarrage (`healProxies`) ne vaut pas une
        // confirmation du profil couleur par l'utilisateur.
        spaceConfirmed: job.payload.rebuild ? target.spaceConfirmed : true,
        proxy: target.proxy.split("?")[0] + "?v=" + Date.now(),
        // Refaite ici, la vignette existe même si l'import n'avait pas pu la
        // produire.
        thumbnail:
          a.kind === "audio"
            ? target.thumbnail
            : "juno-video://media/" + a.id + "/thumb?v=" + Date.now(),
      });
      q.revision++;
    });
    await updateJob(job.id, { cursor: 1, progress: 1 });
  }
  async function signature(file) {
    try {
      const s = await fs.stat(file);
      return { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino };
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  async function unchanged(file, expected, label) {
    if (JSON.stringify(await signature(file)) !== JSON.stringify(expected))
      throw Error(
        label +
          " a changé depuis la préparation du traitement : " +
          path.basename(file),
      );
  }
  async function checkSources(registry) {
    for (const r of Object.values(registry)) {
      if (r.signature)
        await unchanged(r.source, r.signature, "Le média source");
      if (r.renderSource && r.renderSignature)
        await unchanged(
          r.renderSource,
          r.renderSignature,
          "L’image de travail",
        );
    }
  }
  async function requireSpace(folder, bytes) {
    const s = await fs.statfs(folder);
    if (s.bavail * s.bsize < bytes)
      throw Error(
        "Espace disque insuffisant pour poursuivre le rendu. Libérez de l’espace puis reprenez la tâche.",
      );
  }
  /**
   * Ce qu'un export laisse derrière lui quand il ne reprendra plus : les
   * segments déjà rendus, le fichier final partiel posé à côté de la
   * destination, et, pour un film de relecture, le film et sa fiche, qui
   * vivent dans le dossier de Juno. Un film livré au client n'est jamais
   * touché.
   */
  async function discardExport(job, { reviewFilm = false } = {}) {
    if (job.kind !== "export") return;
    await fs
      .rm(path.join(store.root, "renders", job.id), {
        recursive: true,
        force: true,
      })
      .catch(() => {});
    const destination = job.payload?.destination;
    if (typeof destination !== "string") return;
    await fs
      .unlink(destination + ".partial" + path.extname(destination))
      .catch(() => {});
    if (
      reviewFilm &&
      path.dirname(destination) === path.join(store.root, "review-renders")
    )
      for (const file of [
        destination,
        destination + ".juno-" + job.id + ".json",
      ])
        await fs.unlink(file).catch(() => {});
  }
  async function doExport(job, signal) {
    try {
      await renderExport(job, signal);
    } catch (e) {
      // Un export annulé ne reprendra jamais : ses segments (18 Mo pour dix
      // secondes en ProRes) et son fichier partiel ne servent plus. Un export
      // en pause ou interrompu les garde pour reprendre où il en était.
      if (store.data.jobs.find((j) => j.id === job.id)?.state === "cancelled")
        await discardExport(job);
      throw e;
    }
  }
  async function renderExport(job, signal) {
    const s = job.payload.sequence,
      p = requireProject(job.projectId),
      assets = new Map(job.payload.assetDescriptions.map((a) => [a.id, a])),
      length = M.duration(s),
      chunk = job.payload.chunkFrames ?? 250,
      segments = [],
      segmentDurations = [],
      cache = path.join(store.root, "renders", job.id);
    const complete = async () => {
      await writeJsonAtomic(
        job.payload.destination + ".juno-" + job.id + ".json",
        {
          version: 1,
          sequence: s,
          projectId: p.id,
          created: new Date().toISOString(),
          sourceAssets: job.payload.assetDescriptions,
        },
      );
      await updateJob(job.id, {
        result: job.payload.destination,
        progress: 1,
        state: "done",
      });
      await fs.rm(cache, { recursive: true, force: true }).catch(() => {});
    };
    const proof = job.payload.completedFile;
    if (proof) {
      const stat = await fs.stat(job.payload.destination).catch((e) => {
        if (e.code !== "ENOENT") throw e;
        return null;
      });
      if (
        stat?.size === proof.size &&
        (await sha256(job.payload.destination)) === proof.sha256
      ) {
        await complete();
        return;
      }
    }
    await fs.mkdir(cache, { recursive: true });
    for (let start = 0, i = 0; start < length; start += chunk, i++) {
      const file = path.join(cache, String(i).padStart(7, "0") + ".mov");
      segments.push(file);
      segmentDurations.push(M.seconds(Math.min(chunk, length - start), s.fps));
      if (i < job.cursor) {
        await fs.access(file);
        continue;
      }
      await checkSources(job.payload.registry);
      const bitrate = ["prores", "dnxhr"].includes(job.payload.codec)
        ? s.width * s.height * M.fpsValue(s.fps) * 3.6
        : engine.bitrate(s);
      await requireSpace(
        cache,
        Math.ceil(
          (bitrate / 8) *
            M.seconds(Math.min(chunk, length - start), s.fps) *
            1.4,
        ) + 100e6,
      );
      const temp = file + ".partial.mov";
      try {
        await R.renderSegment(
          {
            engine,
            sequence: s,
            assets,
            registry: job.payload.registry,
            cache: store.root,
            start,
            count: Math.min(chunk, length - start),
            overlays: job.payload.overlays,
            maskFiles: job.payload.maskFiles,
            deliveryCodec: job.payload.codec,
          },
          temp,
          signal,
        );
        await fs.rename(temp, file);
      } catch (e) {
        throw stalledExport(e, {
          where: `au segment ${i + 1} sur ${Math.ceil(length / chunk)}, vers ${clock(M.seconds(start, s.fps))} du montage`,
          resume: "il repartira de ce segment",
        });
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
      await updateJob(job.id, {
        cursor: i + 1,
        progress: (i + 1) / (job.total + 1),
      });
    }
    const destination = job.payload.destination,
      temp = destination + ".partial" + path.extname(destination);
    const segmentBytes = (
      await Promise.all(segments.map((file) => fs.stat(file)))
    ).reduce((sum, item) => sum + item.size, 0);
    await requireSpace(path.dirname(destination), segmentBytes * 2 + 100e6);
    try {
      await R.finishRender(
        engine,
        s,
        segments,
        temp,
        job.payload.codec,
        signal,
        true,
        segmentDurations,
        {
          loudness: job.payload.loudness || null,
          onStage: (stage) =>
            updateJob(job.id, {
              stage:
                stage === "measure"
                  ? "Mesure du niveau sonore"
                  : "Normalisation et assemblage",
            }).catch(() => {}),
        },
      );
      const meta = await engine.probe(temp);
      if (
        Math.abs(meta.duration - M.seconds(length, s.fps)) >
        Math.max(0.15, 2 / M.fpsValue(s.fps))
      )
        throw Error("La durée du rendu final ne correspond pas à la séquence");
      await checkSources(job.payload.registry);
      if (Object.hasOwn(job.payload, "destinationSignature"))
        await unchanged(
          destination,
          job.payload.destinationSignature,
          "Le fichier de destination",
        );
      const handle = await fs.open(temp, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      const completedFile = {
        sha256: await sha256(temp),
        size: (await fs.stat(temp)).size,
      };
      await store.mutate((d) => {
        d.jobs.find((j) => j.id === job.id).payload.completedFile =
          completedFile;
      });
      await fs.rename(temp, destination);
    } catch (e) {
      // Le fichier partiel est posé chez le client : il n'y reste pas, que
      // l'export reprenne ensuite (l'assemblage repart de zéro) ou non.
      await fs.unlink(temp).catch(() => {});
      throw stalledExport(e, {
        where: "pendant l’assemblage final",
        resume: "les segments déjà rendus sont gardés",
      });
    }
    await complete();
  }
  /**
   * L'erreur d'un export dont FFmpeg ne progressait plus (moteur, `run`,
   * `stall`), dite à l'utilisateur avec l'endroit du montage en cause ; toute
   * autre erreur passe telle quelle. La tâche finit en échec et se reprend.
   */
  function stalledExport(e, { where, resume }) {
    if (e?.code !== "JUNO_STALL") return e;
    return Object.assign(
      Error(
        `Export arrêté ${where} : le moteur vidéo n’avançait plus depuis ${stallText(e.stall)}. Reprenez l’export, ${resume} ; si le blocage revient au même endroit, un rush de ce passage est sans doute abîmé.`,
      ),
      { code: e.code },
    );
  }
  /** Un instant du montage, en minutes et secondes (« 01:05 »). */
  function clock(t) {
    const total = Math.max(0, Math.floor(t)),
      h = Math.floor(total / 3600),
      m = Math.floor((total % 3600) / 60),
      sec = total % 60,
      two = (x) => String(x).padStart(2, "0");
    return (h ? h + ":" + two(m) : two(m)) + ":" + two(sec);
  }
  async function doAnalyze(job, signal) {
    for (let i = job.cursor; i < job.payload.ids.length; i++) {
      const p = requireProject(job.projectId),
        a = p.assets.find((a) => a.id === job.payload.ids[i]);
      if (!a) {
        await updateJob(job.id, { cursor: i + 1 });
        continue;
      }
      const source =
        store.data.media[a.id].proxy || store.data.media[a.id].source;
      let scenes = [],
        silences = [],
        sonie = [],
        partial = "",
        // null plutôt que 0 : un silence_end sans début ne doit pas fabriquer
        // un silence qui commencerait au début du média.
        silenceStart = null;
      const lines = (text, fn) => {
        partial += text;
        const parts = partial.split("\n");
        partial = parts.pop();
        for (const line of parts) fn(line);
      };
      const sceneLine = (line) => {
        const m = /pts_time:([0-9.]+)/.exec(line);
        if (m && scenes.length < 20000) scenes.push(Number(m[1]));
      };
      const silenceLine = (line) => {
        // La même passe relit la sonie : une seule lecture du son pour deux
        // mesures. Plafonnée à dix heures de relevés à 10 par seconde.
        const releve = MOMENTS.lireLigne(line);
        if (releve && sonie.length < 360000) sonie.push(releve);
        for (const m of line.matchAll(/silence_(start|end): (-?[0-9.]+)/g)) {
          const value = Number(m[2]);
          if (!Number.isFinite(value)) continue;
          if (m[1] === "start") silenceStart = Math.max(0, value);
          else if (silenceStart !== null) {
            if (value > silenceStart && silences.length < 20000)
              silences.push({ start: silenceStart, end: value });
            silenceStart = null;
          }
        }
      };
      // FFmpeg n'écrit pas de silence_end quand le média se termine en silence :
      // sans cette fermeture, le dernier blanc d'un discours était perdu.
      const closeSilence = () => {
        if (silenceStart !== null && a.duration > silenceStart)
          silences.push({ start: silenceStart, end: a.duration });
        silenceStart = null;
      };
      if (a.kind !== "audio") {
        const r = await engine.run(
          engine.ffmpeg,
          [
            "-hide_banner",
            "-nostdin",
            "-v",
            "info",
            "-i",
            source,
            "-an",
            "-vf",
            "select='gt(scene,0.28)',showinfo",
            "-f",
            "null",
            "-",
          ],
          { signal, onStderr: (b) => lines(b, sceneLine) },
        );
        sceneLine(partial);
        partial = "";
      }
      const sound = a.audioChannels ? await engine.soundMap(source) : [];
      if (sound.length) {
        const r = await engine.run(
          engine.ffmpeg,
          [
            "-hide_banner",
            "-nostdin",
            "-v",
            "info",
            "-i",
            source,
            // La piste son de l'app, que FFmpeg choisissait seul.
            ...sound,
            "-vn",
            "-af",
            "silencedetect=n=-35dB:d=0.6,ebur128=peak=none",
            "-f",
            "null",
            "-",
          ],
          { signal, onStderr: (b) => lines(b, silenceLine) },
        );
        silenceLine(partial);
        closeSilence();
        partial = "";
      }
      const moments = MOMENTS.momentsForts(sonie);
      await store.mutate((d) => {
        const q = d.projects.find((p) => p.id === job.projectId);
        q.assets.find((x) => x.id === a.id).analysis = {
          scenes,
          silences,
          moments,
        };
        q.revision++;
      });
      await updateJob(job.id, { cursor: i + 1, progress: (i + 1) / job.total });
    }
  }
  /**
   * Le dérushage (PLAN-DERUSHAGE.md, electron/video/derush.cjs) : chaque rush
   * vidéo est découpé en passages bons, à vérifier et masqués, d'après son
   * aperçu. Le résultat compact va sur le média (`asset.derush`), à part de
   * `asset.analysis` que « Analyser » remplace d'un bloc ; les relevés image
   * par image restent dans le cache du média. Rien n'est supprimé ni coupé :
   * l'interface s'en sert pour masquer et proposer.
   */
  const sessionStart = Date.now(),
    derushPlanned = new Set();
  const derushable = (a) => {
    const registered = a && store.data.media[a.id];
    return (
      a?.kind === "video" &&
      a.status === "ready" &&
      a.duration > 0 &&
      !!registered?.proxy &&
      registered.proxy !== registered.source
    );
  };
  // La version de l'aperçu lu : refait (profil couleur confirmé, média
  // retrouvé), il change de taille et de date, et le rush est relu.
  async function proxyMark(file) {
    const s = await fs.stat(file);
    return [s.size, Math.round(s.mtimeMs)].join("|");
  }
  async function derushCurrent(a) {
    let marque;
    try {
      marque = await proxyMark(store.data.media[a.id].proxy);
    } catch {
      // Aperçu absent : rien à relire tant qu'il n'est pas refait.
      return true;
    }
    // Un aperçu illisible n'est pas relu en boucle : seulement quand il
    // change, ou quand la lecture change de version.
    const e = a.derushEchec;
    if (e?.marque === marque && e.mesure === DERUSH.VERSION_MESURE) return true;
    const d = a.derush;
    return (
      d?.mesure === DERUSH.VERSION_MESURE &&
      d.regles === DERUSH.VERSION_REGLES &&
      d.marque === marque
    );
  }
  /**
   * Prévoit le dérushage des rushes d'un projet qui ne l'ont pas encore été,
   * ou plus (aperçu refait, nouvelle version des relevés ou des règles) : une
   * tâche de fond, qui cède toujours la place aux tâches demandées
   * (`makeWay`).
   *
   * `ids` : après un import, un aperçu refait ou une restauration, seuls les
   * médias de cette tâche ; un dérushage annulé n'est ainsi pas relancé pour
   * les autres. À l'ouverture du projet (`opening`), tous, sauf si un
   * dérushage y a été annulé dans la session. Les appels d'un même projet se
   * suivent (`derushVerrous`) : deux appels simultanés prévoyaient les mêmes
   * rushes deux fois.
   */
  function planDerush(projectId, options = {}) {
    const avant = derushVerrous.get(projectId) || Promise.resolve(),
      suite = avant
        .then(() => planDerushSeul(projectId, options))
        .catch(() => {});
    derushVerrous.set(projectId, suite);
    return suite;
  }
  async function planDerushSeul(
    projectId,
    { opening = false, ids: seulement } = {},
  ) {
    if (!autoDerush) return;
    await healed;
    if (!engine.status.available || quitting) return;
    const p = store.project(projectId);
    if (!p) return;
    if (
      opening &&
      store.data.jobs.some(
        (j) =>
          j.kind === "derush" &&
          j.projectId === projectId &&
          j.state === "cancelled" &&
          j.created >= sessionStart,
      )
    )
      return;
    const pending = new Set(
      store.data.jobs
        .filter(
          (j) =>
            j.kind === "derush" &&
            j.projectId === projectId &&
            !["done", "failed", "cancelled"].includes(j.state),
        )
        .flatMap((j) => j.payload?.ids || []),
    );
    const ids = [];
    for (const a of p.assets || [])
      if (
        (!seulement || seulement.includes(a.id)) &&
        !pending.has(a.id) &&
        derushable(a) &&
        !(await derushCurrent(a))
      )
        ids.push(a.id);
    if (ids.length)
      await enqueue(
        projectId,
        "derush",
        "Dérushage des rushes",
        { ids, background: true },
        ids.length,
      );
  }
  /** Les médias d'une tâche finie, pour n'y dérusher qu'eux (`pump`). */
  function mediasDeTache(j) {
    return j.kind === "proxy"
      ? [j.payload?.assetId].filter(Boolean)
      : j.payload?.ids || [];
  }
  async function doDerush(job, signal) {
    // Les résultats sont écrits par lots (toutes les 15 s au plus) : chaque
    // écriture change la révision du projet, que l'interface relit en entier.
    // Un rush par écriture la faisait relire toutes les quelques secondes
    // pendant tout le dérushage d'un mariage.
    let lot = new Map(),
      ecrit = Date.now();
    const ecrire = async (cursor) => {
      const resultats = lot;
      lot = new Map();
      ecrit = Date.now();
      await store.mutate((d) => {
        const q = d.projects.find((p) => p.id === job.projectId);
        let change = false;
        for (const [id, { fiche, echec, ...derush }] of resultats) {
          const x = q?.assets.find((x) => x.id === id);
          if (!x) continue;
          if (echec) x.derushEchec = echec;
          else {
            // Les décisions de l'utilisateur survivent à toute relecture.
            x.derush = {
              ...derush,
              decisions: x.derush?.decisions || [],
              // Le type de plan ne dépend que des images : une relecture
              // (aperçu refait, nouvelles règles) le garde.
              ...(x.derush?.plan ? { plan: x.derush.plan } : {}),
            };
            delete x.derushEchec;
          }
          // L'heure de tournage et la caméra d'un média importé avant
          // qu'elles soient lues (`probe`), quand l'original est là.
          for (const [k, v] of Object.entries(fiche || {}))
            if (v !== undefined && x[k] === undefined) x[k] = v;
          change = true;
        }
        if (change) q.revision++;
        const j = d.jobs.find((j) => j.id === job.id);
        if (j && cursor !== undefined)
          Object.assign(j, { cursor, progress: cursor / job.total });
      });
    };
    // L'avancement d'un rush, sans réécrire tout le catalogue : gardé en
    // mémoire (la liste des tâches le lit là), enregistré avec les résultats.
    const avancement = (fraction) => {
      const j = store.data.jobs.find((j) => j.id === job.id);
      if (j) j.progress = Math.min(1, fraction);
    };
    try {
      for (let i = job.cursor; i < job.payload.ids.length; i++) {
        // Céder sa place à une tâche demandée, même quand tout est en cache.
        signal.throwIfAborted();
        const id = job.payload.ids[i],
          a = requireProject(job.projectId).assets.find((x) => x.id === id),
          registered = store.data.media[id],
          // Un aperçu en cours de fabrication est relu après lui (`pump`).
          rebuilding = store.data.jobs.some(
            (j) =>
              j.kind === "proxy" &&
              j.payload?.assetId === id &&
              ["queued", "running"].includes(j.state),
          );
        let marque = null;
        if (derushable(a) && !rebuilding && !(await derushCurrent(a)))
          marque = await proxyMark(registered.proxy).catch(() => null);
        if (marque) {
          let fiche;
          if (a.recorded === undefined && a.camera === undefined)
            fiche = await engine
              .probe(registered.renderSource || registered.source)
              .then((m) => ({
                recorded: m.recorded,
                camera: m.camera ?? cameraOf(undefined, undefined, a.name),
              }))
              .catch(() => undefined);
          try {
            const releves = await DERUSH.mesurer(
                engine,
                registered.proxy,
                path.join(store.root, "cache", id),
                {
                  duree: a.duration,
                  marque,
                  signal,
                  onTranche: (part) => avancement((i + part) / job.total),
                },
              ),
              r = DERUSH.decouper(releves);
            lot.set(id, {
              fiche,
              mesure: DERUSH.VERSION_MESURE,
              regles: DERUSH.VERSION_REGLES,
              marque,
              plages: r.plages,
              resume: r.resume,
              mouvement: r.mouvement,
              date: Date.now(),
            });
          } catch (e) {
            if (signal.aborted) throw e;
            // Un aperçu illisible ne bloque pas les rushes suivants : son
            // échec est noté, et il ne sera relu que s'il change.
            const message = String(e?.message || e).slice(0, 400);
            lot.set(id, {
              fiche,
              echec: {
                marque,
                mesure: DERUSH.VERSION_MESURE,
                message,
                date: Date.now(),
              },
            });
            await store
              .mutate((d) => {
                const j = d.jobs.find((j) => j.id === job.id);
                if (j && (j.errors ??= []).length < 200)
                  j.errors.push(a.name + " : " + message);
              })
              .catch(() => {});
          }
        }
        avancement((i + 1) / job.total);
        if (Date.now() - ecrit > 15000) await ecrire(i + 1);
      }
      await ecrire(job.payload.ids.length);
    } finally {
      // Interrompue ou cédant sa place : ce qui est fini est gardé.
      if (lot.size) await ecrire().catch(() => {});
    }
  }
  async function doSync(job, signal) {
    const p = requireProject(job.projectId),
      group = structuredClone(job.payload.group),
      assets = new Map(p.assets.map((a) => [a.id, a]));
    const reference = assets.get(group.referenceAssetId);
    if (!reference.audioChannels)
      throw Error("La caméra de référence ne contient pas de son");
    const audio = new Map(),
      sample = async (id) => {
        if (!audio.has(id)) {
          const a = assets.get(id);
          if (!a.audioChannels) throw Error("Son absent pour " + a.name);
          audio.set(
            id,
            await engine.waveform(store.data.media[id].source, a.duration, {
              signal,
              hz: 100,
              maxSeconds: 600,
            }),
          );
        }
        return audio.get(id);
      };
    const ref = await sample(reference.id),
      origin = group.angles.find((a) => a.assetId === reference.id).offset;
    for (let i = 0; i < group.angles.length; i++) {
      const angle = group.angles[i];
      if (
        angle.assetId !== reference.id &&
        !assets.get(angle.assetId)?.audioChannels
      ) {
        // Une caméra sans micro ne s'entend pas : elle garde son décalage et
        // reste à caler à la main, sans empêcher la synchro des autres.
        angle.sync = "à vérifier";
      } else if (angle.assetId !== reference.id) {
        const estimate = MC.align(ref, await sample(angle.assetId));
        angle.estimate = estimate;
        if (estimate.reliable) angle.offset = origin + estimate.offset;
        angle.sync = estimate.reliable ? "audio" : "à vérifier";
      }
      await updateJob(job.id, { progress: (i + 1) / group.angles.length });
    }
    group.id = job.payload.resultGroupId;
    group.name = group.name.slice(0, 160) + " · Synchro audio";
    await store.mutate((d) => {
      const q = d.projects.find((p) => p.id === job.projectId);
      if (!q.multicam.some((g) => g.id === group.id)) q.multicam.push(group);
      q.revision++;
    });
    await updateJob(job.id, { result: group.id, cursor: group.angles.length });
  }
  /** Tracking writes its result on the stored clip, never on a stale copy. */
  /** Le nom d'une piste tel que le montage l'affiche : V1, A1... */
  const trackName = (n) => (n < 10 ? "V" + (n + 1) : "A" + (n - 9));
  async function doTrack(job, signal) {
    const p = requireProject(job.projectId),
      stored = p.sequences.find((x) => x.id === job.payload.sequenceId);
    if (!stored) throw Error("Séquence introuvable");
    const clip = stored.clips.find((c) => c.id === job.payload.clipId);
    if (!clip) throw Error("Ce plan n’existe plus dans le montage");
    const mask = (clip.masks || []).find((m) => m.id === job.payload.maskId);
    if (!mask) throw Error("Ce masque n’existe plus");
    if (stored.tracks?.[clip.track]?.locked)
      throw Error(
        `La piste ${trackName(clip.track)} est verrouillée : déverrouillez-la avant de lancer le suivi.`,
      );
    const record = store.data.media[clip.assetId];
    if (!record) throw Error("Original introuvable pour le suivi");
    const asset = p.assets.find((a) => a.id === clip.assetId);
    const result = await TRACK.trackMask({
      engine,
      source: record.renderSource || record.source,
      clip,
      mask,
      sequence: stored,
      sourceFrame: asset?.fps ? asset.fps.d / asset.fps.n : undefined,
      signal,
      onProgress: (done) =>
        void updateJob(job.id, {
          progress: Math.min(0.99, done / Math.max(1, clip.duration)),
        }).catch(() => {}),
    });
    if (!result.keys.length) throw Error("Le suivi n’a rien trouvé à suivre");
    await store.mutate((d) => {
      const project = d.projects.find((x) => x.id === job.projectId),
        sequence = project?.sequences.find((x) => x.id === stored.id),
        target = sequence?.clips.find((c) => c.id === clip.id),
        entry = (target?.masks || []).find((m) => m.id === mask.id);
      if (!entry) throw Error("Ce masque n’existe plus");
      // Le verrou se lit au moment d'écrire : une piste verrouillée pendant
      // le suivi garde ses repères. Ils s'écrivaient quand même (30/09/2026).
      if (sequence.tracks?.[target.track]?.locked)
        throw Error(
          `La piste ${trackName(target.track)} a été verrouillée pendant le suivi : ses repères n’ont pas été modifiés. Déverrouillez-la puis relancez le suivi.`,
        );
      entry.keys = result.keys;
      entry.tracked = {
        asset: clip.assetId,
        from: result.keys[0].frame,
        to: result.keys[result.keys.length - 1].frame,
      };
      if (sequence) sequence.version = (sequence.version || 1) + 1;
      if (project) project.revision = (project.revision || 1) + 1;
    });
    await updateJob(job.id, {
      result: JSON.stringify({
        confidence: result.confidence,
        keys: result.keys.length,
        frames: result.frames,
      }),
    });
  }
  async function doTranscribe(job, signal) {
    if (!engine.status.transcription)
      throw Error("Le modèle de transcription locale n’est pas installé");
    for (let i = job.cursor; i < job.payload.ids.length; i++) {
      const p = requireProject(job.projectId),
        a = p.assets.find((a) => a.id === job.payload.ids[i]);
      if (a?.transcriptManual)
        throw Error("Ce texte a été corrigé manuellement ; il est conservé");
      if (!a?.audioChannels) {
        await updateJob(job.id, { cursor: i + 1 });
        continue;
      }
      const source = store.data.media[a.id].source,
        // La piste son de l'app, que FFmpeg choisissait seul.
        sound = await engine.soundMap(source),
        folder = path.join(
          store.root,
          "cache",
          a.id,
          "transcript-words-v2-" +
            path.basename(engine.whisperModel) +
            "-" +
            job.payload.language,
        );
      await fs.mkdir(folder, { recursive: true });
      const transcript = [];
      for (let start = 0; start < a.duration; start += 600) {
        if (signal.aborted)
          throw Object.assign(Error("Interrompu"), { name: "AbortError" });
        const base = path.join(folder, String(start).padStart(7, "0")),
          json = base + ".json",
          wav = base + ".wav";
        let data;
        try {
          data = JSON.parse(await fs.readFile(json, "utf8"));
        } catch {
          await engine.ff(
            [
              "-y",
              "-ss",
              String(start),
              "-t",
              String(Math.min(600, a.duration - start)),
              "-i",
              source,
              ...sound,
              "-vn",
              "-ac",
              "1",
              "-ar",
              "16000",
              "-c:a",
              "pcm_s16le",
              wav,
            ],
            { signal },
          );
          try {
            await engine.run(
              engine.whisper,
              [
                "-m",
                engine.whisperModel,
                "-f",
                wav,
                "-l",
                job.payload.language,
                "-t",
                "4",
                "-ml",
                "1",
                "-sow",
                "-ojf",
                "-of",
                base,
                "-np",
              ],
              { signal },
            );
            data = JSON.parse(await fs.readFile(json, "utf8"));
          } finally {
            await fs.unlink(wav).catch(() => {});
          }
        }
        transcript.push(...WORDS.parseWords(data, start, a.duration));
      }
      await store.mutate((d) => {
        const q = d.projects.find((p) => p.id === job.projectId);
        const asset = q.assets.find((x) => x.id === a.id);
        if (asset.transcriptManual)
          throw Error(
            "Le texte a été corrigé pendant le traitement ; il est conservé",
          );
        asset.transcript = transcript;
        asset.transcriptionModel =
          path.basename(engine.whisperModel) + "-words-v2";
        asset.wordTimestamps = true;
        q.revision++;
      });
      await updateJob(job.id, { cursor: i + 1, progress: (i + 1) / job.total });
    }
  }
  protocol.handle("juno-video", async (request) => {
    try {
      const url = new URL(request.url),
        [id, variant] = url.pathname.slice(1).split("/"),
        record = store.data.media[id];
      if (
        url.hostname !== "media" ||
        !record ||
        !["source", "proxy", "thumb"].includes(variant)
      )
        return new Response("Média inconnu", { status: 404 });
      const file = record[variant];
      if (!file) return new Response("Média absent", { status: 404 });
      const stat = await fs.stat(file);
      let start = 0,
        end = stat.size - 1,
        status = 200;
      const range = request.headers.get("range");
      if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!m || (!m[1] && !m[2]))
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": "bytes */" + stat.size },
          });
        if (m[1]) {
          start = Number(m[1]);
          if (m[2]) end = Math.min(Number(m[2]), end);
        } else start = Math.max(0, stat.size - Number(m[2]));
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end ||
          start >= stat.size
        )
          return new Response(null, {
            status: 416,
            headers: { "Content-Range": "bytes */" + stat.size },
          });
        status = 206;
      }
      const ext = path.extname(file).toLowerCase(),
        mime =
          variant === "thumb"
            ? "image/jpeg"
            : ext === ".wav"
              ? "audio/wav"
              : ext === ".webm"
                ? "video/webm"
                : "video/mp4";
      const headers = {
        "Content-Type": mime,
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      };
      if (status === 206)
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
      return new Response(
        request.method === "HEAD"
          ? null
          : Readable.toWeb(fss.createReadStream(file, { start, end })),
        { status, headers },
      );
    } catch {
      return new Response("Original indisponible", { status: 404 });
    }
  });
  handle("video-status", () => ({
    ...engine.status,
    luts: Object.entries(store.data.luts).map(([id, l]) => ({
      id,
      name: l.name,
      size: l.size,
    })),
  }));
  handle("video-lut", async (input) => {
    const { parseCube, serialize } = require("./lut.cjs");
    if (input.action === "read") {
      if (!/^[a-f0-9]{64}$/.test(input.id) || !store.data.luts[input.id])
        throw Error("LUT inconnue");
      return parseCube(
        await fs.readFile(
          path.join(store.root, "luts", input.id + ".cube"),
          "utf8",
        ),
      );
    }
    if (input.action !== "import") throw Error("Action LUT inconnue");
    const choice = await dialog.showOpenDialog(getWindow(), {
      title: "Importer une LUT créative SDR (.cube)",
      properties: ["openFile"],
      filters: [{ name: "LUT 3D", extensions: ["cube"] }],
    });
    if (choice.canceled) return null;
    const file = choice.filePaths[0];
    if ((await fs.stat(file)).size > 20e6) throw Error("LUT trop volumineuse");
    const cube = parseCube(await fs.readFile(file, "utf8")),
      normalized = serialize(cube),
      id = createHash("sha256").update(normalized).digest("hex"),
      name = path.basename(file, ".cube");
    await fs.mkdir(path.join(store.root, "luts"), { recursive: true });
    await fs.writeFile(
      path.join(store.root, "luts", id + ".cube"),
      normalized,
      { mode: 0o600 },
    );
    await store.mutate((d) => (d.luts[id] = { name, size: cube.size }));
    return { id, name, size: cube.size };
  });
  handle("video-generation-key", async (input) => {
    if (input.action === "status") {
      try {
        await fs.access(keyPath);
        return !!safeStorage?.isEncryptionAvailable();
      } catch {
        return false;
      }
    }
    if (
      input.action !== "save" ||
      typeof input.key !== "string" ||
      input.key.length > 500
    )
      throw Error("Clé invalide");
    if (!input.key) {
      await fs.unlink(keyPath).catch(() => {});
      return false;
    }
    if (!safeStorage?.isEncryptionAvailable())
      throw Error("Stockage sécurisé indisponible");
    const temp = keyPath + ".tmp";
    await fs.writeFile(temp, safeStorage.encryptString(input.key.trim()), {
      mode: 0o600,
    });
    await fs.rename(temp, keyPath);
    return true;
  });
  handle("video-generate", async (input) => {
    requireProject(input.projectId);
    const request = require("./generation.cjs").validate(input);
    await readKey();
    return enqueue(
      input.projectId,
      "generate",
      "Générer un plan avec Google Veo",
      { request, assetId: randomUUID() },
      3,
    );
  });
  handle("video-autocolor", (input) => {
    const p = requireProject(input.projectId),
      s = structuredClone(input.sequence),
      assets = new Map(p.assets.map((a) => [a.id, a]));
    M.validateSequence(s, assets);
    M.number(input.strength ?? 0.65, 0, 1, "Intensité");
    const spaces = {};
    for (const c of s.clips.filter((c) => c.track < 10)) {
      const a = assets.get(c.assetId);
      if (a.kind === "video" && !a.spaceConfirmed)
        throw Error("Confirmez d’abord le profil source de " + a.name);
      spaces[a.id] = a.inputSpace;
    }
    if (
      input.referenceAssetId &&
      !Object.hasOwn(spaces, input.referenceAssetId)
    )
      throw Error("Le plan de référence n’est pas dans la séquence");
    return enqueue(
      p.id,
      "autocolor",
      "Harmoniser la couleur",
      {
        sequence: s,
        sequenceId: randomUUID(),
        spaces,
        referenceAssetId: input.referenceAssetId,
        strength: input.strength ?? 0.65,
      },
      Object.keys(spaces).length,
    );
  });
  handle("video-list", () => ({
    projects: store.data.projects.map((p) => ({
      id: p.id,
      name: p.name,
      photoProjectId: p.photoProjectId,
      updated: p.updated,
      revision: p.revision,
      count: p.assets.length,
    })),
    jobs: store.data.jobs.map((j) => ({
      ...publicJob(j),
      ...(diskFailures.has(j.id)
        ? { state: "interrupted", error: diskFailures.get(j.id) }
        : {}),
      unresolvedErrors:
        j.kind === "import"
          ? importFailures(j).filter(
              (f) =>
                !store
                  .project(j.projectId)
                  ?.assets.some((a) => a.id === j.payload.ids[f.index]),
            ).length
          : j.errors?.length || 0,
    })),
  }));
  handle("video-project", (id) => {
    const p = store.public(requireProject(id));
    // Une fois par session et par projet : les rushes importés avant le
    // dérushage, ou dont l'aperçu a changé, sont relus en fond.
    if (!derushPlanned.has(id)) {
      derushPlanned.add(id);
      void planDerush(id, { opening: true }).catch(() => {});
    }
    return p;
  });
  handle("video-create", async (input) => {
    M.text(input?.name, 200);
    if (input.photoProjectId && !M.id(input.photoProjectId))
      throw Error("Projet photo invalide");
    const p = M.project(input.name, input.photoProjectId);
    await store.mutate((d) => d.projects.push(p));
    return store.public(p);
  });
  handle("video-sequence", async (input) => {
    const p = requireProject(input.projectId),
      s = input.sequence;
    M.validateSequence(s, new Map(p.assets.map((a) => [a.id, a])));
    await store.history(p);
    return store.mutate((d) => {
      const q = d.projects.find((x) => x.id === p.id),
        old = q.sequences.find((x) => x.id === s.id);
      if (
        input.command &&
        (!M.id(input.command.id) ||
          typeof input.command.label !== "string" ||
          input.command.label.length > 250 ||
          !["manual", "text", "voice", "recipe"].includes(input.command.source))
      )
        throw Error("Commande invalide.");
      const existingCommand =
        input.command?.id && q.commands?.find((c) => c.id === input.command.id);
      if (existingCommand) {
        if (existingCommand.sequenceId !== s.id)
          throw Error("Cette commande appartient à une autre séquence.");
        return { version: old?.version || 1, revision: q.revision };
      }
      if (old && (old.version || 1) !== input.expectedVersion)
        throw Error(
          "Cette séquence a changé. Rechargez sa version avant de continuer.",
        );
      if (!old && input.expectedVersion !== 0)
        throw Error("Rechargez la séquence avant de continuer");
      if (!old && q.sequences.length >= 100)
        throw Error("Limite de séquences atteinte");
      const next = { ...s, version: (old ? old.version || 1 : 0) + 1 };
      commandHistory.recordSequence(q, old, next, input.command);
      if (old) q.sequences[q.sequences.indexOf(old)] = next;
      else q.sequences.push(next);
      q.updated = Date.now();
      q.revision++;
      return { version: next.version, revision: q.revision };
    });
  });
  handle("video-command-history", ({ projectId, sequenceId }) =>
    (requireProject(projectId).commands || [])
      .filter((c) => !sequenceId || c.sequenceId === sequenceId)
      .map(({ changes, ...record }) => record)
      .sort((a, b) => b.updated - a.updated),
  );
  handle("video-command-restore", async ({ projectId, id, redo = false }) => {
    const p = requireProject(projectId);
    await store.history(p);
    return store.mutate((d) => {
      const q = d.projects.find((p) => p.id === projectId);
      return commandHistory.restoreSequence(q, id, redo, (s) =>
        M.validateSequence(s, new Map(q.assets.map((a) => [a.id, a]))),
      );
    });
  });
  async function queueMedia(projectId, files, registered) {
    return enqueue(
      projectId,
      "import",
      "Préparer les vidéos, sons et images",
      {
        files,
        ids: files.map(() => randomUUID()),
        registeredIds: registered?.map((x) => x.id),
        names: registered?.map((x) => x.name),
        sizes: registered?.map((x) => x.size || 0),
      },
      files.length,
    );
  }
  handle("video-import", async (projectId) => {
    requireProject(projectId);
    const r = await dialog.showOpenDialog(getWindow(), {
      title: "Importer vidéos, sons et images",
      properties: ["openFile", "multiSelections"],
      filters,
    });
    if (r.canceled || !r.filePaths.length) return null;
    const registered = registerMediaFiles
      ? await registerMediaFiles(r.filePaths)
      : undefined;
    return queueMedia(projectId, r.filePaths, registered);
  });
  handle("video-import-registered", async (input) => {
    if (
      !resolveMedia ||
      !Array.isArray(input?.ids) ||
      input.ids.length < 1 ||
      input.ids.length > 20000 ||
      (!M.id(input.photoProjectId) && !M.id(input.projectId))
    )
      throw Error("Sélection de médias invalide");
    if (input.name !== undefined) M.text(input.name, 200);
    const files = input.ids.map((id) => {
      if (!M.id(id) || !resolveMedia(id))
        throw Error("Média sélectionné inconnu");
      return resolveMedia(id);
    });
    let p = input.projectId
      ? requireProject(input.projectId)
      : store.data.projects.find(
          (p) => p.photoProjectId === input.photoProjectId,
        );
    if (!p) {
      if (!input.name) throw Error("Nom du projet requis");
      p = M.project(input.name, input.photoProjectId);
      await store.mutate((d) => d.projects.push(p));
    }
    const job = await queueMedia(
      p.id,
      files,
      input.ids.map((id, i) => ({ id, name: path.basename(files[i]) })),
    );
    return { projectId: p.id, job };
  });
  const importFailures = (job) =>
    job.failures ||
    job.payload.files.flatMap((file, index) =>
      job.errors.some((e) => e.startsWith(path.basename(file) + " : "))
        ? [
            {
              index,
              name: path.basename(file),
              message: job.errors.find((e) =>
                e.startsWith(path.basename(file) + " : "),
              ),
            },
          ]
        : [],
    );
  const retryImport = async (input) => {
    const id = typeof input === "string" ? input : input?.id,
      index = typeof input === "string" ? undefined : input?.index;
    const j = store.data.jobs.find((j) => j.id === id);
    if (!j || j.kind !== "import" || !["done", "failed"].includes(j.state))
      throw Error("Attendez la fin de l’importation");
    if (j.retryJobId) {
      const retry = store.data.jobs.find((x) => x.id === j.retryJobId);
      if (retry && !["done", "failed", "cancelled"].includes(retry.state))
        throw Error("Une reprise existe déjà dans les tâches");
    }
    const failures = importFailures(j),
      p = requireProject(j.projectId);
    const indices = failures
      .map((f) => f.index)
      .filter(
        (i) =>
          (index === undefined || i === index) &&
          !p.assets.some((a) => a.id === j.payload.ids[i]),
      );
    if (!indices.length)
      throw Error("Aucun fichier échoué restant à reprendre");
    const payload = {
      files: indices.map((i) => j.payload.files[i]),
      ids: indices.map((i) => j.payload.ids[i]),
      names: indices.map(
        (i) => j.payload.names?.[i] || path.basename(j.payload.files[i]),
      ),
      registeredIds:
        j.payload.registeredIds &&
        indices.map((i) => j.payload.registeredIds[i]),
      sizes: indices.map((i) => j.payload.sizes?.[i] || 0),
      hashes: indices.map((i) => j.payload.hashes?.[i]),
      retryOf: id,
    };
    const retry = await enqueue(
      j.projectId,
      "import",
      "Reprendre les médias échoués",
      payload,
      indices.length,
    );
    await store.mutate((d) => {
      d.jobs.find((x) => x.id === id).retryJobId = retry.id;
    });
    return retry;
  };
  handle("video-import-retry", retryImport);
  handle("video-import-locate", async (input) => {
    const j = store.data.jobs.find((j) => j.id === input?.id),
      i = input?.index;
    if (
      !locateMedia ||
      !j ||
      j.kind !== "import" ||
      !Number.isSafeInteger(i) ||
      !importFailures(j).some((f) => f.index === i) ||
      !j.payload.registeredIds?.[i]
    )
      throw Error("Fichier importé inconnu");
    if (!["done", "failed"].includes(j.state))
      throw Error("Attendez la fin de l’importation");
    const found = await locateMedia({
      id: j.payload.registeredIds[i],
      name: j.payload.names?.[i] || path.basename(j.payload.files[i]),
      size: j.payload.sizes?.[i] || 0,
      hash: j.payload.hashes?.[i],
    });
    if (!found) return null;
    await store.mutate((d) => {
      d.jobs.find((x) => x.id === j.id).payload.files[i] = resolveMedia(
        j.payload.registeredIds[i],
      );
    });
    return retryImport({ id: j.id, index: i });
  });
  handle("video-import-report", async (id) => {
    const j = store.data.jobs.find((j) => j.id === id);
    if (!j || j.kind !== "import") throw Error("Importation introuvable");
    const r = await dialog.showSaveDialog(getWindow(), {
      defaultPath: "Juno-diagnostic-medias-" + j.id + ".json",
      filters: [{ name: "Diagnostic JSON", extensions: ["json"] }],
    });
    if (r.canceled) return false;
    const report = {
      schema: 1,
      application: "Juno Studio",
      version: app.getVersion(),
      generatedAt: new Date().toISOString(),
      job: publicJob(j),
      files: importFailures(j).map((f) => ({
        ...f,
        path: j.payload.files[f.index],
        recovered: requireProject(j.projectId).assets.some(
          (a) => a.id === j.payload.ids[f.index],
        ),
      })),
    };
    const temp = r.filePath + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(temp, JSON.stringify(report, null, 2), {
        mode: 0o600,
      });
      await fs.rename(temp, r.filePath);
    } finally {
      await fs.unlink(temp).catch(() => {});
    }
    return true;
  });
  const photoConversions = new Map();
  handle("media-photo-raster", async (id) => {
    if (!M.id(id) || !resolveMedia?.(id))
      throw Error("Image importée inconnue");
    if (photoConversions.has(id)) return photoConversions.get(id);
    const task = (async () => {
      const source = resolveMedia(id);
      if (
        !formats.nativePhoto.includes(
          path.extname(source).slice(1).toLowerCase(),
        )
      )
        throw Error("Conversion réservée aux formats image complémentaires");
      const meta = await engine.probe(source);
      if (
        meta.kind !== "image" ||
        !meta.width ||
        !meta.height ||
        meta.width * meta.height > 100000000
      )
        throw Error("Dimensions ou type d’image non pris en charge");
      if (/f32|f16/.test(meta.pixelFormat) || /\.(exr|hdr)$/i.test(source))
        throw Error(
          "Image HDR ou flottante : un développement préservant la plage dynamique est requis avant retouche. L’original est conservé.",
        );
      const folder = path.join(store.root, "photo-raster");
      await fs.mkdir(folder, { recursive: true });
      const sig = await signature(source),
        key = createHash("sha256").update(JSON.stringify(sig)).digest("hex"),
        target = path.join(folder, id + "-" + key + ".tif");
      if (!fss.existsSync(target)) {
        await engine.compositeImage(source, meta, target);
        await unchanged(source, sig, "L’image source");
      }
      return new Uint8Array(await fs.readFile(target));
    })();
    photoConversions.set(id, task);
    try {
      return await task;
    } finally {
      photoConversions.delete(id);
    }
  });
  handle("video-space", async (input) => {
    requireProject(input.projectId);
    if (!engine.status.spaces.some((s) => s.id === input.inputSpace))
      throw Error("Profil couleur inconnu");
    return enqueue(
      input.projectId,
      "proxy",
      "Actualiser la couleur source",
      { assetId: input.assetId, inputSpace: input.inputSpace },
      1,
    );
  });
  handle("video-reveal-job", async (id) => {
    const j = store.data.jobs.find((j) => j.id === id);
    if (!j || !["export", "generate"].includes(j.kind) || !j.result)
      throw Error("Résultat indisponible");
    await fs.access(j.result);
    require("electron").shell.showItemInFolder(j.result);
  });
  handle("video-job", async (input) => {
    const job = store.data.jobs.find((j) => j.id === input.id);
    if (!job) throw Error("Tâche inconnue");
    if (!["pause", "resume", "cancel", "remove"].includes(input.action))
      throw Error("Action inconnue");
    if (input.action === "remove") {
      if (
        job.kind === "import" &&
        importFailures(job).some(
          (f) =>
            !requireProject(job.projectId).assets.some(
              (a) => a.id === job.payload.ids[f.index],
            ),
        )
      )
        throw Error(
          "Le diagnostic est conservé tant que des fichiers restent en échec",
        );
      if (!["done", "failed", "cancelled"].includes(job.state))
        throw Error("Arrêtez la tâche avant de la retirer");
      await store.mutate(
        (d) => (d.jobs = d.jobs.filter((j) => j.id !== job.id)),
      );
      // Retirée, la tâche ne reprendra plus : ses fichiers de travail partent
      // avec elle, et le film de relecture qu'elle avait produit aussi.
      await discardExport(job, { reviewFilm: true });
      return;
    }
    if (["done", "cancelled"].includes(job.state)) return;
    const state =
      input.action === "resume"
        ? "queued"
        : input.action === "pause"
          ? "paused"
          : "cancelled";
    await updateJob(job.id, { state, error: undefined });
    diskFailures.delete(job.id);
    const lane = lanes[laneFor(job.kind)];
    if (lane.id === job.id && input.action !== "resume")
      lane.controller.abort();
    else {
      // Annulée hors du rendu (en pause, interrompue) : rien ne tourne pour
      // faire le ménage, il se fait ici.
      if (state === "cancelled") await discardExport(job);
      // Reprise à la demande : elle passe avant une tâche de fond.
      if (state === "queued" && !job.payload?.background)
        makeWay(laneFor(job.kind));
      void pump(laneFor(job.kind));
    }
  });
  handle("video-multicam", async (input) => {
    const p = requireProject(input.projectId),
      assets = new Map(p.assets.map((a) => [a.id, a])),
      group = structuredClone(input.group);
    MC.validateGroup(group, assets);
    if (input.action === "timecode")
      return { group: MC.byTimecode(group, assets) };
    if (input.action === "audio")
      return {
        job: await enqueue(
          p.id,
          "sync",
          "Synchroniser les caméras par le son",
          { group, resultGroupId: randomUUID() },
          group.angles.length,
        ),
      };
    if (!["save", "build"].includes(input.action))
      throw Error("Action multicaméra inconnue");
    const sequence =
      input.action === "build"
        ? MC.buildSequence(group, assets, input.settings)
        : null;
    await store.history(p);
    await store.mutate((d) => {
      const q = d.projects.find((p) => p.id === input.projectId),
        at = q.multicam.findIndex((g) => g.id === group.id);
      if (at >= 0) q.multicam[at] = group;
      else {
        if (q.multicam.length >= 100) throw Error("Limite de groupes atteinte");
        q.multicam.push(group);
      }
      if (sequence) {
        if (q.sequences.length >= 100)
          throw Error("Limite de séquences atteinte");
        q.sequences.push(sequence);
      }
      q.revision++;
    });
    return { group, sequence };
  });
  handle("video-transcript", async (input) => {
    const p = requireProject(input.projectId),
      a = p.assets.find((a) => a.id === input.assetId);
    if (!a || !Array.isArray(input.segments) || input.segments.length > 50000)
      throw Error("Transcription invalide");
    for (const t of input.segments) {
      M.number(t.start, 0, a.duration, "Début");
      M.number(t.end, t.start, a.duration, "Fin");
      M.text(t.text, 4000);
      WORDS.validateWords(t);
    }
    return store.mutate((d) => {
      const q = d.projects.find((p) => p.id === input.projectId),
        target = q.assets.find((a) => a.id === input.assetId);
      target.transcript = input.segments;
      target.transcriptManual = true;
      target.wordTimestamps = input.segments.some((t) => t.words?.length);
      q.revision++;
    });
  });
  handle("video-transcribe", (input) => {
    const p = requireProject(input.projectId),
      ids =
        input.ids || p.assets.filter((a) => a.audioChannels).map((a) => a.id);
    if (
      !Array.isArray(ids) ||
      ids.some((id) => !p.assets.some((a) => a.id === id))
    )
      throw Error("Médias inconnus");
    const language = input.language || "auto";
    if (
      ![
        "auto",
        "fr",
        "en",
        "es",
        "de",
        "it",
        "pt",
        "nl",
        "ar",
        "zh",
        "ja",
      ].includes(language)
    )
      throw Error("Langue invalide");
    return enqueue(
      p.id,
      "transcribe",
      "Transcrire les voix",
      { ids, language },
      ids.length,
    );
  });
  handle("video-audio-process", (input) => {
    const p = requireProject(input.projectId),
      a = p.assets.find((a) => a.id === input.assetId);
    if (!a?.audioChannels) throw Error("Ce média ne contient pas de son");
    const settings = AUDIO.validate(input.settings);
    return enqueue(
      p.id,
      "audio",
      "Améliorer la voix · " + a.name,
      { assetId: a.id, resultId: randomUUID(), settings },
      1,
    );
  });
  handle("video-analyze", (input) => {
    const p = requireProject(input.projectId),
      ids = input.ids || p.assets.map((a) => a.id);
    if (
      !Array.isArray(ids) ||
      ids.some((id) => !p.assets.some((a) => a.id === id))
    )
      throw Error("Médias inconnus");
    return enqueue(
      p.id,
      "analyze",
      "Analyser scènes, silences et moments forts",
      { ids },
      ids.length,
    );
  });
  /**
   * Une décision de l'utilisateur sur un passage d'un rush : « bon » le
   * remontre, « masque » le cache, `null` rend la main à l'analyse. Elle
   * remplace les décisions qu'elle recouvre, et survit à toute relecture du
   * rush (`doDerush`).
   */
  handle("video-derush-decision", async (input) => {
    const p = requireProject(input?.projectId),
      a = p.assets.find((x) => x.id === input.assetId);
    if (!a?.derush) throw Error("Ce rush n’est pas encore dérushé");
    const debut = Number(input.debut),
      fin = Number(input.fin);
    if (
      !Number.isFinite(debut) ||
      !Number.isFinite(fin) ||
      debut < 0 ||
      fin > a.duration + 0.05 ||
      fin - debut < 0.04
    )
      throw Error("Passage invalide");
    if (![null, "bon", "masque"].includes(input.etat ?? null))
      throw Error("Décision inconnue");
    await store.mutate((d) => {
      const q = d.projects.find((x) => x.id === p.id),
        x = q?.assets.find((x) => x.id === a.id);
      if (!x?.derush) return;
      const garde = [];
      // Ce que la nouvelle décision ne recouvre pas des anciennes reste.
      for (const dec of x.derush.decisions || []) {
        if (dec.fin <= debut || dec.debut >= fin) garde.push(dec);
        else {
          if (dec.debut < debut) garde.push({ ...dec, fin: debut });
          if (dec.fin > fin) garde.push({ ...dec, debut: fin });
        }
      }
      if (input.etat)
        garde.push({
          debut: Math.round(debut * 1000) / 1000,
          fin: Math.round(Math.min(fin, a.duration) * 1000) / 1000,
          etat: input.etat,
        });
      if (garde.length > 2000) throw Error("Trop de décisions sur ce rush");
      x.derush.decisions = garde.sort((u, v) => u.debut - v.debut);
      q.revision++;
    });
    return store.public(requireProject(p.id).assets.find((x) => x.id === a.id));
  });
  /**
   * Les types de plan de plusieurs rushes, relevés par l'interface
   * (derush-plans.ts) et écrits par lots : une révision pour dix rushes.
   */
  handle("video-derush-plans", async (input) => {
    const p = requireProject(input?.projectId),
      plans = Object.entries(input?.plans || {});
    if (!plans.length || plans.length > 2000)
      throw Error("Lot de types de plan invalide");
    for (const [id, plan] of plans)
      if (
        typeof id !== "string" ||
        !["gros", "moyen", "large", "sans-visage"].includes(plan)
      )
        throw Error("Type de plan inconnu");
    await store.mutate((d) => {
      const q = d.projects.find((x) => x.id === p.id);
      let change = false;
      for (const [id, plan] of plans) {
        const x = q?.assets.find((x) => x.id === id);
        if (!x?.derush) continue;
        x.derush.plan = plan;
        change = true;
      }
      if (change) q.revision++;
    });
  });
  handle("video-derush", (input) => {
    const p = requireProject(input.projectId),
      ids =
        input.ids ||
        p.assets.filter((a) => a.kind === "video").map((a) => a.id);
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 10000 ||
      ids.some((id) => !p.assets.some((a) => a.id === id))
    )
      throw Error("Médias inconnus");
    // En fond, comme le dérushage automatique : demandé par « Dérusher
    // maintenant » ou le pilote, il retardait sinon tous les exports
    // demandés après lui, des heures pour un mariage.
    return enqueue(
      p.id,
      "derush",
      "Dérushage des rushes",
      { ids, background: true },
      ids.length,
    );
  });
  handle("video-overlay", async (input) => {
    requireProject(input.projectId);
    if (!(input.bytes instanceof ArrayBuffer) || input.bytes.byteLength > 15e6)
      throw Error("Titre trop volumineux");
    const b = Buffer.from(input.bytes);
    if (b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      throw Error("Image PNG requise");
    const id = createHash("sha256").update(b).digest("hex"),
      file = path.join(store.root, "cache", "overlay-" + id + ".png");
    await fs.writeFile(file, b);
    return id;
  });
  handle("video-track-mask", async (input) => {
    const p = requireProject(input.projectId),
      s = structuredClone(input.sequence);
    M.validateSequence(s, new Map(p.assets.map((a) => [a.id, a])));
    const clip = s.clips.find((c) => c.id === input.clipId);
    if (!clip) throw Error("Plan introuvable");
    const mask = (clip.masks || []).find((m) => m.id === input.maskId);
    if (!mask) throw Error("Masque introuvable");
    const asset = p.assets.find((a) => a.id === clip.assetId);
    if (!asset || asset.kind !== "video")
      throw Error("Le suivi demande un plan vidéo");
    if (clip.duration > 18000)
      throw Error("Suivi limité à dix minutes de plan. Découpez le plan.");
    const stored = p.sequences.find((x) => x.id === s.id);
    if (!stored)
      throw Error("Enregistrez la séquence avant de lancer le suivi");
    const savedClip = stored.clips.find((c) => c.id === clip.id);
    if (!savedClip || !(savedClip.masks || []).some((m) => m.id === mask.id))
      throw Error("Enregistrez le masque avant de lancer le suivi");
    if (stored.tracks?.[savedClip.track]?.locked)
      throw Error(
        `La piste ${trackName(savedClip.track)} est verrouillée : déverrouillez-la avant de lancer le suivi.`,
      );
    return enqueue(
      p.id,
      "track",
      "Suivre le masque de " + asset.name,
      { sequenceId: s.id, clipId: clip.id, maskId: mask.id },
      clip.duration,
    );
  });
  handle("video-export", async (input) => {
    const p = requireProject(input.projectId),
      s = structuredClone(input.sequence);
    M.validateSequence(s, new Map(p.assets.map((a) => [a.id, a])));
    for (const c of s.clips)
      if (c.grade.lutId && !store.data.luts[c.grade.lutId])
        throw Error("Une LUT du montage est absente de cet ordinateur");
    const length = M.duration(s);
    if (!length) throw Error("Ajoutez des plans à la séquence");
    if (M.seconds(length, s.fps) > 21600)
      throw Error("Export limité à six heures par séquence");
    const ids = [...new Set(s.clips.map((c) => c.assetId))],
      registry = {},
      descriptions = [];
    for (const id of ids) {
      const a = p.assets.find((a) => a.id === id);
      if (a.kind === "video" && !a.spaceConfirmed)
        throw Error(
          "Confirmez le profil couleur de " + a.name + " avant la livraison",
        );
      const r = store.data.media[id];
      await fs.access(r.source);
      if (r.sourceSignature)
        await unchanged(r.source, r.sourceSignature, "Le média source");
      const renderSource =
        r.renderSource && fss.existsSync(r.renderSource)
          ? r.renderSource
          : await engine.imageSource(r.source, a, path.dirname(r.proxy));
      registry[id] = {
        ...structuredClone(r),
        renderSource: renderSource !== r.source ? renderSource : undefined,
        renderSignature:
          renderSource !== r.source ? await signature(renderSource) : undefined,
        signature: await signature(r.source),
      };
      descriptions.push(structuredClone(a));
    }
    const profile = engine.status.exports.find((e) => e.id === input.codec);
    if (!profile?.available)
      throw Error(
        "Ce format d’export n’est pas disponible sur cette machine. Choisissez un format vérifié dans la liste.",
      );
    const codec = profile.id,
      ext = profile.extension,
      choice = input.review
        ? {
            canceled: false,
            filePath: path.join(
              store.root,
              "review-renders",
              randomUUID() + "." + ext,
            ),
          }
        : await dialog.showSaveDialog(getWindow(), {
            title: "Exporter le film",
            defaultPath: s.name + "." + ext,
            filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
          });
    if (input.review)
      await fs.mkdir(path.join(store.root, "review-renders"), {
        recursive: true,
      });
    if (choice.canceled || !choice.filePath) return null;
    const destination = choice.filePath.endsWith("." + ext)
      ? choice.filePath
      : choice.filePath + "." + ext;
    const overlays = [];
    if (
      input.overlays !== undefined &&
      (!Array.isArray(input.overlays) || input.overlays.length > 20000)
    )
      throw Error("Trop d’éléments à exporter");
    for (const o of input.overlays || []) {
      if (!/^[a-f0-9]{64}$/.test(o.id)) throw Error("Titre invalide");
      M.integer(o.start, 0, 1e8, "Début");
      M.integer(o.duration, 1, 1e8, "Durée");
      const file = path.join(store.root, "cache", "overlay-" + o.id + ".png");
      await fs.access(file);
      MOTION.placement(o.placement);
      if (o.motionOrigin !== undefined)
        M.integer(o.motionOrigin, 0, o.start, "Origine de l’animation");
      overlays.push({
        file,
        start: o.start,
        duration: o.duration,
        placement: o.placement,
        motionOrigin: o.motionOrigin,
      });
    }
    // Every mask needs the shape Juno rendered for it, checked before queuing.
    const maskFiles = {};
    const wanted = new Map();
    for (const c of s.clips) for (const m of c.masks || []) wanted.set(m.id, m);
    if (input.maskImages !== undefined) {
      if (
        !input.maskImages ||
        typeof input.maskImages !== "object" ||
        Array.isArray(input.maskImages)
      )
        throw Error("Masques invalides");
      for (const [maskId, sha] of Object.entries(input.maskImages)) {
        if (!wanted.has(maskId)) throw Error("Masque inconnu");
        if (!/^[a-f0-9]{64}$/.test(sha))
          throw Error("Forme de masque invalide");
        const file = path.join(store.root, "cache", "overlay-" + sha + ".png");
        await fs.access(file);
        maskFiles[maskId] = file;
      }
    }
    for (const maskId of wanted.keys())
      if (!maskFiles[maskId])
        throw Error(
          "Forme de masque absente : rouvrez le montage puis réessayez.",
        );
    // Le niveau de livraison est facultatif, mais s'il est demandé il doit
    // correspondre à une cible connue : on ne devine pas un niveau de diffusion.
    const loudness = input.loudness ?? null;
    if (loudness !== null && !Object.hasOwn(LOUD.TARGETS, loudness))
      throw Error("Niveau de livraison inconnu");
    const chunkFrames = overlays.some((o) => o.motionOrigin !== undefined)
      ? Math.max(1, Math.min(250, Math.round(M.fpsValue(s.fps) * 2)))
      : 250;
    return enqueue(
      p.id,
      "export",
      "Exporter " + s.name,
      {
        sequence: s,
        registry,
        assetDescriptions: descriptions,
        destination,
        destinationSignature: await signature(destination),
        codec,
        overlays,
        maskFiles,
        chunkFrames,
        loudness,
      },
      Math.ceil(length / chunkFrames),
    );
  });
  handle("video-relink", async (input) => {
    const p = requireProject(input.projectId),
      a = p.assets.find((a) => a.id === input.assetId);
    if (!a) throw Error("Média inconnu");
    const r = await dialog.showOpenDialog(getWindow(), {
      title: "Retrouver " + a.name,
      properties: ["openFile"],
    });
    if (r.canceled) return null;
    const file = r.filePaths[0];
    if (!path.isAbsolute(file)) throw Error("Choisissez un fichier local");
    const actual = await fingerprint(file),
      record = store.data.media[a.id];
    if (record.sourceFingerprint && record.sourceFingerprint !== actual)
      throw Error("Ce fichier ne correspond pas au média attendu");
    return enqueue(
      p.id,
      "restore",
      "Reconnecter " + a.name,
      { ids: [a.id], paths: { [a.id]: file } },
      1,
    );
  });
  handle("video-restore", async () => {
    const choice = await dialog.showOpenDialog(getWindow(), {
      title: "Ouvrir une copie de projet Juno Vidéo",
      properties: ["openFile"],
      filters: [{ name: "Projet Juno Vidéo", extensions: ["junofilm"] }],
    });
    if (choice.canceled) return null;
    const file = choice.filePaths[0],
      stat = await fs.stat(file);
    if (stat.size > 64e6) throw Error("Projet trop volumineux");
    const data = JSON.parse(await fs.readFile(file, "utf8")),
      old = data.project;
    if (
      data.schema !== 1 ||
      !old ||
      !Array.isArray(old.assets) ||
      old.assets.length > 20000 ||
      !Array.isArray(old.sequences) ||
      old.sequences.length > 100
    )
      throw Error("Projet vidéo incompatible");
    M.text(old.name, 200);
    const p = M.project(old.name.slice(0, 170) + " · Copie"),
      map = new Map(old.assets.map((a) => [a.id, randomUUID()])),
      seqMap = new Map(old.sequences.map((s) => [s.id, randomUUID()])),
      media = {};
    for (const a of old.assets) {
      M.text(a.name, 500);
      M.number(a.duration, 0, 86400, "Durée");
      if (
        !["audio", "video", "image"].includes(a.kind) ||
        !engine.status.spaces.some((s) => s.id === a.inputSpace)
      )
        throw Error("Média incompatible");
      const id = map.get(a.id),
        source = data.media?.[a.id];
      if (typeof source !== "string" || !path.isAbsolute(source))
        throw Error("Chemin média invalide");
      const fp = data.fingerprints?.[a.id];
      if (fp && !/^[a-f0-9]{64}$/.test(fp)) throw Error("Empreinte invalide");
      const full = data.sha256?.[a.id];
      if (full && !/^[a-f0-9]{64}$/.test(full))
        throw Error("Empreinte intégrale invalide");
      media[id] = { source, sourceFingerprint: fp, sourceSha256: full };
      p.assets.push({
        ...a,
        id,
        source: "juno-video://media/" + id + "/source",
        proxy: undefined,
        thumbnail: undefined,
        status: "processing",
        error: undefined,
        // La voix améliorée garde le lien vers le son dont elle vient.
        ...(a.audioProcessing
          ? {
              audioProcessing: {
                ...a.audioProcessing,
                sourceAssetId:
                  map.get(a.audioProcessing.sourceAssetId) ??
                  a.audioProcessing.sourceAssetId,
              },
            }
          : {}),
      });
    }
    const assets = new Map(p.assets.map((a) => [a.id, a]));
    // Tout ce qui nomme un média change d'identifiant avec lui : le plan, le
    // son d'origine d'une voix améliorée, le média d'un masque suivi. Seul le
    // plan était renommé, et la copie ne se rouvrait plus.
    const remap = (c) => ({
      ...c,
      assetId: map.get(c.assetId),
      ...(c.originalAssetId !== undefined
        ? { originalAssetId: map.get(c.originalAssetId) }
        : {}),
      ...(c.masks
        ? {
            masks: c.masks.map((m) =>
              m?.tracked
                ? {
                    ...m,
                    tracked: { ...m.tracked, asset: map.get(m.tracked.asset) },
                  }
                : m,
            ),
          }
        : {}),
    });
    p.sequences = old.sequences.map((s) => {
      const next = {
        ...s,
        id: seqMap.get(s.id),
        version: 1,
        clips: s.clips.map(remap),
      };
      M.validateSequence(next, assets);
      return next;
    });
    if (!p.sequences.length) p.sequences = [M.sequence()];
    p.comments = (old.comments || [])
      .slice(0, 20000)
      .filter((c) => seqMap.has(c.sequenceId))
      .map((c) => {
        M.text(c.text, 3000);
        M.integer(c.frame, 0, 1e8, "Timecode");
        return { ...c, id: randomUUID(), sequenceId: seqMap.get(c.sequenceId) };
      });
    p.multicam = (old.multicam || []).slice(0, 100).map((g) => {
      const next = {
        ...g,
        id: randomUUID(),
        referenceAssetId: map.get(g.referenceAssetId),
        angles: g.angles.map((a) => ({ ...a, assetId: map.get(a.assetId) })),
        switches: g.switches.map((c) => ({
          ...c,
          assetId: map.get(c.assetId),
        })),
      };
      MC.validateGroup(next, assets);
      return next;
    });
    const bundledLuts = {};
    for (const [id, text] of Object.entries(data.luts || {})) {
      if (
        !/^[a-f0-9]{64}$/.test(id) ||
        typeof text !== "string" ||
        text.length > 20e6
      )
        throw Error("LUT de projet invalide");
      const { parseCube, serialize } = require("./lut.cjs"),
        cube = parseCube(text),
        normalized = serialize(cube);
      if (createHash("sha256").update(normalized).digest("hex") !== id)
        throw Error("Empreinte LUT incorrecte");
      await fs.mkdir(path.join(store.root, "luts"), { recursive: true });
      await fs.writeFile(
        path.join(store.root, "luts", id + ".cube"),
        normalized,
        { mode: 0o600 },
      );
      bundledLuts[id] = {
        name:
          typeof data.lutNames?.[id] === "string"
            ? data.lutNames[id].slice(0, 200)
            : "LUT du projet",
        size: cube.size,
      };
    }
    for (const s of p.sequences)
      for (const c of s.clips)
        if (
          c.grade.lutId &&
          !bundledLuts[c.grade.lutId] &&
          !store.data.luts[c.grade.lutId]
        )
          throw Error(
            "Une LUT du projet est absente. Importez-la avant de restaurer ce projet.",
          );
    await store.mutate((d) => {
      d.projects.push(p);
      Object.assign(d.media, media);
      Object.assign(d.luts, bundledLuts);
    });
    if (p.assets.length)
      await enqueue(
        p.id,
        "restore",
        "Préparer le projet restauré",
        { ids: p.assets.map((a) => a.id) },
        p.assets.length,
      );
    return store.public(p);
  });
  handle("video-history", async (input) => {
    const p = requireProject(input.projectId),
      folder = path.join(store.root, "history", p.id);
    if (input.revision !== undefined) {
      M.integer(input.revision, 1, 1e10, "Version");
      const saved = JSON.parse(
          await fs.readFile(
            path.join(
              folder,
              String(input.revision).padStart(10, "0") + ".json",
            ),
            "utf8",
          ),
        ),
        s = saved.sequences.find((s) => s.id === input.sequenceId);
      if (!s) throw Error("Séquence absente de cette sauvegarde");
      const next = {
        ...s,
        id: randomUUID(),
        version: 1,
        name: s.name.slice(0, 160) + " · Version récupérée",
      };
      M.validateSequence(next, new Map(p.assets.map((a) => [a.id, a])));
      await store.history(p);
      await store.mutate((d) => {
        const q = d.projects.find((p) => p.id === input.projectId);
        if (q.sequences.length >= 100)
          throw Error("Limite de séquences atteinte");
        q.sequences.push(next);
        q.revision++;
      });
      return { sequence: next };
    }
    const names = await fs.readdir(folder).catch(() => []),
      items = [];
    for (const name of names
      .filter((n) => /^\d+\.json$/.test(n))
      .sort()
      .reverse()) {
      try {
        const p = JSON.parse(
          await fs.readFile(path.join(folder, name), "utf8"),
        );
        items.push({
          revision: p.revision,
          updated: p.updated,
          sequences: p.sequences.map((s) => ({ id: s.id, name: s.name })),
        });
      } catch {
        // Une version abîmée se signale au lieu de s'effacer de la liste :
        // sinon un montage semble ne jamais avoir existé.
        items.push({
          revision: Number(name.replace(".json", "")) || 0,
          updated: 0,
          sequences: [],
          illisible: true,
        });
      }
    }
    return { items };
  });
  handle("video-backup", async (projectId) => {
    const p = requireProject(projectId),
      r = await dialog.showSaveDialog(getWindow(), {
        title: "Enregistrer le projet vidéo et ses réglages",
        defaultPath: p.name + ".junofilm",
        filters: [{ name: "Projet Juno Vidéo", extensions: ["junofilm"] }],
      });
    if (r.canceled) return false;
    const media = Object.fromEntries(
      p.assets.map((a) => [a.id, store.data.media[a.id]?.source]),
    );
    const lutIds = [
        ...new Set(
          p.sequences.flatMap((s) =>
            s.clips.map((c) => c.grade.lutId).filter(Boolean),
          ),
        ),
      ],
      luts = {},
      lutNames = {};
    for (const id of lutIds) {
      luts[id] = await fs.readFile(
        path.join(store.root, "luts", id + ".cube"),
        "utf8",
      );
      lutNames[id] = store.data.luts[id]?.name || "LUT";
    }
    await writeJsonAtomic(r.filePath, {
      schema: 1,
      project: p,
      media,
      luts,
      lutNames,
      fingerprints: Object.fromEntries(
        p.assets.map((a) => [a.id, store.data.media[a.id]?.sourceFingerprint]),
      ),
      sha256: Object.fromEntries(
        p.assets.map((a) => [a.id, store.data.media[a.id]?.sourceSha256]),
      ),
    });
    return true;
  });
  handle("video-comments", async (input) => {
    M.text(input.text, 3000);
    M.integer(input.frame, 0, 1e8, "Timecode");
    requireProject(input.projectId);
    return store.mutate((d) => {
      const p = d.projects.find((p) => p.id === input.projectId);
      p.comments.push({
        id: randomUUID(),
        sequenceId: input.sequenceId,
        frame: input.frame,
        text: input.text,
        created: Date.now(),
        resolved: false,
      });
      p.revision++;
      return p.comments;
    });
  });
  // « will-quit » et non « before-quit » : before-quit part AVANT que la
  // fenêtre demande « Rester / Quitter quand même », et « Rester » laissait
  // l'application ouverte mais déjà à moitié arrêtée (relecture du 29/09/2026).
  app.on("will-quit", () => {
    quitting = true;
    for (const lane of Object.values(lanes)) lane.controller?.abort();
    engine.stop();
  });
  return { store, engine, pump, purged, healed };
}
module.exports = { registerVideo };
