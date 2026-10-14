const fs = require("node:fs/promises");
const { createReadStream, existsSync } = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { writeJsonAtomic } = require("./atomic.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (value) => createHash("sha256").update(value).digest("hex");
const validId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
async function durableWrite(file, bytes) {
  const handle = await fs.open(file, "w", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function fileHash(file) {
  const h = createHash("sha256");
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest("hex");
}
/**
 * Les champs d'une photo que la préparation d'une relecture relit : le rendu
 * (src/review/prepare.ts, exportPhoto) et la fiche de la livraison
 * (review-stage-photo). Le reste de la fiche ne quitte pas le catalogue.
 */
const CHAMPS_A_RENDRE = [
  "id",
  "projectId",
  "name",
  "source",
  "hash",
  "revision",
  "width",
  "height",
  "previewOnly",
  "adjustments",
];
const ficheARendre = (p) =>
  Object.fromEntries(
    CHAMPS_A_RENDRE.filter((k) => p[k] !== undefined).map((k) => [k, p[k]]),
  );
function secureURL(value) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    u.protocol !== "https:"
  )
    throw Error(
      "Indiquez l’adresse HTTPS du portail, sans chemin ni identifiants.",
    );
  return u.origin;
}

async function registerReview({
  handle,
  app,
  safeStorage,
  shell,
  videoModule,
}) {
  const root = path.join(app.getPath("userData"), "review"),
    staging = path.join(root, "outbox");
  await fs.mkdir(staging, { recursive: true, mode: 0o700 });
  const configFile = path.join(root, "connection.json"),
    tokenFile = path.join(root, "local-key");
  const seal = (value) =>
    safeStorage.isEncryptionAvailable()
      ? {
          encrypted: true,
          data: safeStorage
            .encryptString(JSON.stringify(value))
            .toString("base64"),
        }
      : { encrypted: false, data: value };
  const unseal = (value) =>
    value.encrypted
      ? JSON.parse(safeStorage.decryptString(Buffer.from(value.data, "base64")))
      : value.data;
  let config = { url: "", token: "", links: {} },
    service,
    localError = "",
    controller,
    working = null,
    closing = false;
  let closed = false;
  const videoPreparations = new Map();
  try {
    config = {
      ...config,
      ...unseal(JSON.parse(await fs.readFile(configFile, "utf8"))),
    };
  } catch (e) {
    if (e.code !== "ENOENT")
      localError =
        "La connexion au portail ne peut pas être déchiffrée. Reconnectez le portail dans Retours clients.";
  }
  async function saveConfig() {
    await writeJsonAtomic(configFile, seal(config));
  }
  let localToken;
  try {
    localToken = await fs.readFile(tokenFile, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    if (existsSync(path.join(root, "service", "review.sqlite")))
      throw Error(
        "La clé du portail local est absente. Restaurez sa sauvegarde.",
      );
    localToken = randomBytes(32).toString("base64url");
    await fs.writeFile(tokenFile, localToken, { mode: 0o600, flag: "wx" });
  }
  const modulePath = app.isPackaged
    ? path.join(process.resourcesPath, "review", "server.mjs")
    : path.join(__dirname, "../server/review/server.mjs");
  try {
    const { createReviewServer } = await import(pathToFileURL(modulePath).href);
    service = await createReviewServer({
      dataDir: path.join(root, "service"),
      bootstrapToken: localToken,
    });
    await new Promise((resolve, reject) => {
      service.server.once("error", reject);
      service.server.listen(
        process.argv.includes("--juno-test-hidden")
          ? 0
          : Number(process.env.JUNO_REVIEW_PORT || 8788),
        "127.0.0.1",
        () => {
          service.server.removeListener("error", reject);
          resolve();
        },
      );
    });
  } catch (e) {
    if (service) await service.close();
    localError = "Portail local indisponible : " + e.message;
  }
  const db = new DatabaseSync(path.join(root, "outbox.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,state TEXT NOT NULL,context TEXT NOT NULL,delivery_id TEXT,revision_id TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,error TEXT NOT NULL DEFAULT '',hidden INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES jobs(id),logical_id TEXT NOT NULL,info TEXT NOT NULL,file TEXT NOT NULL,thumbnail TEXT NOT NULL,uploaded INTEGER NOT NULL DEFAULT 0,UNIQUE(job_id,logical_id));
    CREATE INDEX IF NOT EXISTS items_job ON items(job_id);
    CREATE TABLE IF NOT EXISTS preparation(job_id TEXT NOT NULL REFERENCES jobs(id),logical_id TEXT NOT NULL,snapshot TEXT NOT NULL,error TEXT NOT NULL DEFAULT '',PRIMARY KEY(job_id,logical_id));
    CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated INTEGER NOT NULL);
  `);
  db.prepare(
    "UPDATE jobs SET state='paused',error='Envoi interrompu. Reprenez pour continuer.' WHERE state IN ('uploading','publishing','queued')",
  ).run();
  const getJob = (id) => {
    if (!validId(id)) throw Error("Tâche invalide.");
    const job = db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    if (!job) throw Error("Publication introuvable.");
    return { ...job, context: JSON.parse(job.context) };
  };
  const publicJob = (job) => ({
    id: job.id,
    state: job.state,
    title: job.context.title,
    projectId: job.context.projectId,
    kind: job.context.kind,
    total: job.context.total,
    prepared: db
      .prepare("SELECT COUNT(*) AS n FROM items WHERE job_id=?")
      .get(job.id).n,
    uploaded: db
      .prepare("SELECT COUNT(*) AS n FROM items WHERE job_id=? AND uploaded=1")
      .get(job.id).n,
    errors: db
      .prepare(
        "SELECT logical_id,error FROM preparation WHERE job_id=? AND error!=''",
      )
      .all(job.id),
    deliveryId: job.delivery_id,
    revisionId: job.revision_id,
    created: job.created,
    error: job.error,
    hidden: !!job.hidden,
    url: job.context.resultURL || "",
    origin: job.context.origin,
  });
  const update = (id, changes) => {
    const keys = Object.keys(changes);
    db.prepare(
      "UPDATE jobs SET " +
        keys.map((k) => k + "=?").join(",") +
        ",updated=? WHERE id=?",
    ).run(
      ...keys.map((k) =>
        k === "context" ? JSON.stringify(changes[k]) : changes[k],
      ),
      Date.now(),
      id,
    );
  };
  function connection() {
    if (config.url) return { url: config.url, token: config.token };
    if (!service?.server.listening)
      throw Error(localError || "Le portail local ne répond pas.");
    return { url: service.origin(), token: localToken };
  }
  const identity = () =>
    digest((config.url || "local") + ":" + connection().token);
  const linkKey = (shareId) => identity() + ":" + shareId;
  async function request(route, method = "GET", body, options = {}) {
    if (
      typeof route !== "string" ||
      !/^\/api\/admin\/[A-Za-z0-9_/?=&%.,+-]+$/.test(route) ||
      route.includes("..")
    )
      throw Error("Action de portail invalide.");
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
      throw Error("Méthode invalide.");
    const target = options.connection || connection(),
      binary = Buffer.isBuffer(body),
      headers = {
        Authorization: "Bearer " + target.token,
        ...(body == null
          ? {}
          : {
              "Content-Type": binary
                ? "application/octet-stream"
                : "application/json",
            }),
        ...options.headers,
      };
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(120000)])
      : AbortSignal.timeout(30000);
    const response = await fetch(target.url + route, {
      method,
      headers,
      body: body == null ? undefined : binary ? body : JSON.stringify(body),
      signal,
      redirect: "error",
    });
    if (!response.ok) {
      let value;
      try {
        value = await response.json();
      } catch {}
      const error = Error(
        value?.error || "Le portail ne répond pas (" + response.status + ").",
      );
      error.status = response.status;
      throw error;
    }
    if (options.bytes) return new Uint8Array(await response.arrayBuffer());
    return response.json();
  }
  async function status() {
    let remote;
    try {
      remote = await request("/api/admin/status");
    } catch (e) {
      return {
        available: false,
        url: config.url || (service?.server.listening ? service.origin() : ""),
        mode: config.url ? "remote" : "local",
        error: e.message,
      };
    }
    return {
      available: true,
      url: connection().url,
      mode: config.url ? "remote" : "local",
      ...remote,
      error: localError,
    };
  }
  function assertCurrent(job) {
    if (job.context.identity !== identity())
      throw Error(
        "Cette publication appartient à une autre connexion. Reconnectez ce portail pour la reprendre.",
      );
  }
  async function uploadFile(assetId, file, signal) {
    const info = await request("/api/admin/assets/" + assetId);
    if (info.state === "ready") return;
    const h = await fs.open(file, "r");
    try {
      let offset = info.received;
      while (offset < info.size) {
        signal.throwIfAborted();
        const bytes = Buffer.alloc(
          Math.min(4 * 1024 * 1024, info.size - offset),
        );
        const read = await h.read(bytes, 0, bytes.length, offset);
        if (read.bytesRead !== bytes.length)
          throw Error("Le rendu préparé est incomplet. Préparez-le à nouveau.");
        const result = await request(
          "/api/admin/assets/" + assetId + "/content",
          "PUT",
          bytes,
          {
            signal,
            headers: {
              "Upload-Offset": String(offset),
              "X-Chunk-Sha256": digest(bytes),
            },
          },
        );
        offset = result.received;
      }
    } finally {
      await h.close();
    }
    await request(
      "/api/admin/assets/" + assetId + "/complete",
      "POST",
      {},
      { signal },
    );
  }
  async function run(jobId) {
    const job = getJob(jobId);
    assertCurrent(job);
    if (["done", "cancelled"].includes(job.state))
      throw Error(
        "Cette publication est terminée. Créez une nouvelle version.",
      );
    if (working === jobId) return publicJob(job);
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM items WHERE job_id=?")
      .get(jobId).n;
    if (count !== job.context.total)
      throw Error("Préparez tous les médias avant l’envoi.");
    if (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM preparation WHERE job_id=? AND error!=''",
        )
        .get(jobId).n
    )
      throw Error("Des médias doivent être repris avant publication.");
    if (working) {
      update(jobId, { state: "queued", error: "" });
      return publicJob(getJob(jobId));
    }
    working = jobId;
    controller = new AbortController();
    const signal = controller.signal;
    update(jobId, { state: "uploading", error: "" });
    void (async () => {
      try {
        const context = job.context;
        let deliveryId = job.delivery_id || context.targetDeliveryId;
        if (!deliveryId) {
          const created = await request(
            "/api/admin/deliveries",
            "POST",
            {
              opId: jobId + "_delivery",
              projectId: context.projectId,
              projectName: context.projectName,
              title: context.title,
              message: context.message,
            },
            { signal },
          );
          deliveryId = created.id;
          update(jobId, { delivery_id: deliveryId });
        } else update(jobId, { delivery_id: deliveryId });
        let revisionId = job.revision_id;
        if (!revisionId) {
          const created = await request(
            "/api/admin/deliveries/" + deliveryId + "/revisions",
            "POST",
            { opId: jobId + "_revision", count: context.total },
            { signal },
          );
          revisionId = created.id;
          update(jobId, { revision_id: revisionId });
        }
        const items = db
          .prepare("SELECT * FROM items WHERE job_id=? ORDER BY rowid")
          .all(jobId);
        for (const item of items) {
          signal.throwIfAborted();
          if (item.uploaded) continue;
          const info = JSON.parse(item.info);
          const asset = await request(
            "/api/admin/revisions/" + revisionId + "/assets",
            "POST",
            { ...info, id: item.id },
            { signal },
          );
          if (!asset.ready) await uploadFile(item.id, item.file, signal);
          if (!asset.thumbnail)
            await request(
              "/api/admin/assets/" + item.id + "/thumbnail",
              "PUT",
              await fs.readFile(item.thumbnail),
              { signal },
            );
          db.prepare("UPDATE items SET uploaded=1 WHERE id=?").run(item.id);
        }
        signal.throwIfAborted();
        update(jobId, { state: "publishing" });
        await request(
          "/api/admin/revisions/" + revisionId + "/publish",
          "POST",
          { opId: jobId + "_publish" },
          { signal },
        );
        let resultURL = "";
        if (context.targetDeliveryId) {
          const detail = await request("/api/admin/deliveries/" + deliveryId);
          const share = detail.shares.find(
            (s) => !s.revoked && (!s.expires || s.expires > Date.now()),
          );
          if (share) resultURL = config.links[linkKey(share.id)] || "";
        }
        if (!resultURL) {
          const details = unseal(context.shareSecret);
          const created = await request(
            "/api/admin/deliveries/" + deliveryId + "/shares",
            "POST",
            {
              id: details.id,
              token: details.token,
              ...context.shareOptions,
              code: details.code,
            },
            { signal },
          );
          resultURL = created.url;
          config.links[linkKey(created.id)] = resultURL;
          await saveConfig();
        }
        update(jobId, {
          state: "done",
          error: "",
          context: { ...context, resultURL },
        });
        // Only derivatives owned by this outbox are removed. Published versions live
        // in the review service; source images and user exports are never touched.
        await fs.rm(path.join(staging, jobId), {
          recursive: true,
          force: true,
        });
      } catch (e) {
        if (!closing)
          update(jobId, {
            state: signal.aborted ? "paused" : "failed",
            error: signal.aborted
              ? "Publication suspendue. Vous pouvez reprendre."
              : e.message,
          });
      } finally {
        working = null;
        controller = null;
        if (!closing) {
          const next = db
            .prepare(
              "SELECT id FROM jobs WHERE state='queued' ORDER BY created LIMIT 1",
            )
            .get();
          if (next)
            void run(next.id).catch((e) =>
              update(next.id, { state: "failed", error: e.message }),
            );
        }
      }
    })();
    return publicJob(getJob(jobId));
  }
  handle("review-status", status);
  handle("review-connect", async (input) => {
    if (
      working ||
      db
        .prepare(
          "SELECT id FROM jobs WHERE state IN ('preparing','queued') LIMIT 1",
        )
        .get()
    )
      throw Error(
        "Suspendez les préparations et publications avant de changer de portail.",
      );
    if (input.local) {
      config.url = "";
      config.token = "";
      localError = "";
      await saveConfig();
      return status();
    }
    if (!safeStorage.isEncryptionAvailable())
      throw Error(
        "Le stockage sécurisé du système est requis pour connecter un portail distant.",
      );
    const url = secureURL(input.url),
      token = String(input.token || "").trim();
    if (!/^[A-Za-z0-9_-]{43,100}$/.test(token))
      throw Error("Clé de connexion invalide.");
    await request("/api/admin/status", "GET", null, {
      connection: { url, token },
    });
    config.url = url;
    config.token = token;
    localError = "";
    await saveConfig();
    return status();
  });
  handle("review-request", async (input) => {
    if (JSON.stringify(input.body || {}).length > 2 * 1024 * 1024)
      throw Error("Demande trop volumineuse.");
    const cacheKey = identity() + ":" + input.route;
    try {
      const value = await request(
        input.route,
        input.method || "GET",
        input.body,
      );
      if (
        (input.method || "GET") === "GET" &&
        !/operators|budget|status/.test(input.route)
      )
        db.prepare(
          "INSERT INTO cache VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated=excluded.updated",
        ).run(cacheKey, JSON.stringify(value), Date.now());
      return { data: value, cached: false };
    } catch (e) {
      if ((input.method || "GET") === "GET" && !e.status) {
        const saved = db
          .prepare("SELECT * FROM cache WHERE key=?")
          .get(cacheKey);
        if (saved)
          return {
            data: JSON.parse(saved.value),
            cached: true,
            updated: saved.updated,
          };
      }
      throw e;
    }
  });
  handle("review-link", async (input) => {
    if (!validId(input.shareId)) throw Error("Lien invalide.");
    let url = config.links[linkKey(input.shareId)];
    if (!url)
      throw Error(
        "Ce lien a été créé sur un autre poste. Créez un nouveau lien pour le copier depuis cet ordinateur.",
      );
    if (!config.url) {
      const u = new URL(url);
      url = connection().url + u.pathname + u.hash;
    }
    if (input.open) await shell.openExternal(url);
    return url;
  });
  handle("review-create-share", async (input) => {
    if (!validId(input.deliveryId)) throw Error("Livraison invalide.");
    const shareId = randomUUID(),
      token = randomBytes(32).toString("base64url"),
      url = connection().url + "/r/" + shareId + "#" + token;
    config.links[linkKey(shareId)] = url;
    await saveConfig();
    return request(
      "/api/admin/deliveries/" + input.deliveryId + "/shares",
      "POST",
      { ...input.options, id: shareId, token },
    );
  });
  handle("review-jobs", () =>
    db
      .prepare(
        "SELECT * FROM jobs WHERE hidden=0 ORDER BY created DESC LIMIT 100",
      )
      .all()
      .map((j) => ({ ...j, context: JSON.parse(j.context) }))
      .filter((j) => j.context.identity === identity())
      .map(publicJob),
  );
  handle("review-begin", async (input) => {
    if (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM jobs WHERE state NOT IN ('done','cancelled')",
        )
        .get().n >= 20
    )
      throw Error(
        "Terminez ou annulez des publications avant d’en préparer une autre.",
      );
    const endpoint = connection();
    if (
      !validId(input.projectId) ||
      !["photo", "video"].includes(input.kind) ||
      typeof input.title !== "string" ||
      !input.title.trim() ||
      input.title.length > 180
    )
      throw Error("Projet ou titre invalide.");
    if (input.targetDeliveryId && !validId(input.targetDeliveryId))
      throw Error("Livraison invalide.");
    const recues = input.kind === "photo" ? input.photos : [];
    // Seul ce que la préparation relit est gardé : le rendu (source,
    // réglages, empreinte du fichier) et la fiche de la livraison. Les fiches complètes,
    // résumé de sens et empreinte de rafale compris, pesaient 26 à 33 ko par
    // photo et faisaient refuser toute sélection d'environ 1 130 photos ou plus,
    // loin des 10 000 annoncées.
    const photos = Array.isArray(recues)
      ? recues.map((p) => (p && typeof p === "object" ? ficheARendre(p) : p))
      : recues;
    if (
      !Array.isArray(photos) ||
      photos.length > 10000 ||
      (input.kind === "photo" && !photos.length) ||
      JSON.stringify(photos).length > 32 * 1024 * 1024
    )
      throw Error("Sélection trop volumineuse. Créez plusieurs collections.");
    if (photos.some((p) => !validId(p.id) || !p.adjustments))
      throw Error("Sélection photo invalide.");
    const jobId = randomUUID(),
      shareSecret = seal({
        id: randomUUID(),
        token: randomBytes(32).toString("base64url"),
        code: String(input.code || ""),
      });
    if (
      input.kind === "video" &&
      (!validId(input.videoProjectId) || !validId(input.videoJobId))
    )
      throw Error("Un rendu vidéo Juno est requis.");
    const context = {
      projectId: input.projectId,
      projectName: String(input.projectName || input.title).slice(0, 180),
      title: input.title.trim(),
      message: String(input.message || "").slice(0, 2000),
      kind: input.kind,
      total: input.kind === "photo" ? photos.length : 1,
      origin: endpoint.url,
      identity: identity(),
      targetDeliveryId: input.targetDeliveryId || null,
      shareSecret,
      shareOptions: {
        name: String(input.clientName || "Client").slice(0, 100),
        downloads: !!input.downloads,
        expires: input.expires || null,
        canApprove: true,
        required: true,
      },
      videoProjectId: input.videoProjectId || null,
      videoJobId: input.videoJobId || null,
    };
    await fs.mkdir(path.join(staging, jobId), { recursive: true, mode: 0o700 });
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO jobs(id,state,context,created,updated) VALUES(?,?,?,?,?)",
      ).run(
        jobId,
        "preparing",
        JSON.stringify(context),
        Date.now(),
        Date.now(),
      );
      const insert = db.prepare(
        "INSERT INTO preparation(job_id,logical_id,snapshot) VALUES(?,?,?)",
      );
      for (const photo of photos)
        insert.run(
          jobId,
          photo.id,
          JSON.stringify({
            ...photo,
            thumbnail: "",
            history: [],
            future: [],
            versions: [],
          }),
        );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return publicJob(getJob(jobId));
  });
  handle("review-preparation", (input) => {
    const job = getJob(input.id);
    assertCurrent(job);
    return {
      job: publicJob(job),
      photos: db
        .prepare(
          "SELECT p.logical_id,p.snapshot,p.error FROM preparation p WHERE p.job_id=? AND NOT EXISTS(SELECT 1 FROM items i WHERE i.job_id=p.job_id AND i.logical_id=p.logical_id)",
        )
        .all(job.id)
        .map((p) => ({ ...JSON.parse(p.snapshot), preparationError: p.error })),
    };
  });
  handle("review-stage-photo", async (input) => {
    const job = getJob(input.jobId);
    assertCurrent(job);
    if (job.state !== "preparing")
      throw Error("Cette préparation n’est plus modifiable.");
    const photo = db
      .prepare("SELECT * FROM preparation WHERE job_id=? AND logical_id=?")
      .get(job.id, input.photoId);
    if (!photo) throw Error("Photo absente de la sélection figée.");
    if (
      db
        .prepare("SELECT id FROM items WHERE job_id=? AND logical_id=?")
        .get(job.id, input.photoId)
    )
      return true;
    if (
      !(input.bytes instanceof ArrayBuffer) ||
      input.bytes.byteLength > 40 * 1024 * 1024 ||
      !(input.thumbnail instanceof ArrayBuffer) ||
      input.thumbnail.byteLength > 256 * 1024
    )
      throw Error("Rendu trop volumineux.");
    const bytes = Buffer.from(input.bytes),
      thumbnail = Buffer.from(input.thumbnail),
      assetId = randomUUID(),
      file = path.join(staging, job.id, assetId + ".jpg"),
      thumb = path.join(staging, job.id, assetId + "-thumb.jpg");
    if (
      bytes[0] !== 255 ||
      bytes[1] !== 216 ||
      thumbnail[0] !== 255 ||
      thumbnail[1] !== 216
    )
      throw Error("Rendu JPEG requis.");
    if (
      !Number.isSafeInteger(input.width) ||
      !Number.isSafeInteger(input.height) ||
      input.width < 1 ||
      input.height < 1 ||
      input.width > 10000 ||
      input.height > 10000
    )
      throw Error("Dimensions invalides.");
    const p = JSON.parse(photo.snapshot),
      info = {
        logicalId: p.id,
        kind: "photo",
        name: p.name.replace(/\.[^.]+$/, "") + ".jpg",
        mime: "image/jpeg",
        size: bytes.length,
        sha256: digest(bytes),
        position: db
          .prepare("SELECT COUNT(*) AS n FROM items WHERE job_id=?")
          .get(job.id).n,
        metadata: {
          width: input.width,
          height: input.height,
          sourceId: p.id,
          projectId: job.context.projectId,
          snapshot: {
            adjustments: p.adjustments,
            hash: p.hash,
            revision: p.revision || 0,
          },
        },
      };
    await durableWrite(file, bytes);
    await durableWrite(thumb, thumbnail);
    if (getJob(job.id).state !== "preparing")
      throw Error("La préparation a été arrêtée.");
    db.prepare(
      "INSERT INTO items(id,job_id,logical_id,info,file,thumbnail) VALUES(?,?,?,?,?,?)",
    ).run(assetId, job.id, p.id, JSON.stringify(info), file, thumb);
    db.prepare(
      "UPDATE preparation SET error='' WHERE job_id=? AND logical_id=?",
    ).run(job.id, p.id);
    return true;
  });
  handle("review-preparation-error", (input) => {
    const job = getJob(input.jobId);
    assertCurrent(job);
    if (job.state !== "preparing") return false;
    db.prepare(
      "UPDATE preparation SET error=? WHERE job_id=? AND logical_id=?",
    ).run(String(input.error).slice(0, 1000), job.id, input.photoId);
    return true;
  });
  handle("review-exclude-failed", (input) => {
    const job = getJob(input.id);
    assertCurrent(job);
    if (job.state !== "preparing")
      throw Error("Cette publication est déjà commencée.");
    const failed = db
      .prepare(
        "SELECT logical_id FROM preparation WHERE job_id=? AND error!=''",
      )
      .all(job.id);
    if (job.context.total - failed.length < 1)
      throw Error("Conservez au moins un média.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM preparation WHERE job_id=? AND error!=''").run(
        job.id,
      );
      update(job.id, {
        context: { ...job.context, total: job.context.total - failed.length },
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return publicJob(getJob(job.id));
  });
  handle("review-stage-video", async (input) => {
    const job = getJob(input.id);
    assertCurrent(job);
    if (job.state !== "preparing" || job.context.kind !== "video")
      throw Error("Préparation vidéo indisponible.");
    if (db.prepare("SELECT id FROM items WHERE job_id=?").get(job.id))
      return true;
    if (!videoModule?.engine.status.available)
      throw Error("Le moteur vidéo est indisponible.");
    if (videoPreparations.has(job.id))
      throw Error("Ce film est déjà en préparation.");
    const cancel = new AbortController();
    videoPreparations.set(job.id, cancel);
    try {
      let exported;
      while (true) {
        cancel.signal.throwIfAborted();
        exported = videoModule.store.data.jobs.find(
          (j) => j.id === job.context.videoJobId,
        );
        if (
          !exported ||
          exported.kind !== "export" ||
          exported.projectId !== job.context.videoProjectId
        )
          throw Error("Rendu vidéo introuvable.");
        if (exported.state === "done") break;
        if (
          ["paused", "interrupted", "failed", "cancelled"].includes(
            exported.state,
          )
        )
          throw Error(
            "Reprenez le rendu vidéo dans Activité, puis relancez cette préparation. " +
              (exported.error || ""),
          );
        await pause(500);
      }
      const source = exported.result,
        proof = exported.payload?.completedFile,
        sequence = exported.payload?.sequence;
      if (!source || !proof || !sequence)
        throw Error(
          "Réexportez ce montage pour obtenir une version vérifiable.",
        );
      if (
        (await fs.stat(source)).size !== proof.size ||
        (await fileHash(source)) !== proof.sha256
      )
        throw Error(
          "Le fichier exporté a changé. Réexportez le montage avant de le partager.",
        );
      const assetId = randomUUID(),
        file = path.join(staging, job.id, assetId + ".mp4"),
        thumb = path.join(staging, job.id, assetId + "-thumb.jpg"),
        engine = videoModule.engine;
      const frames = require("./video/model.cjs").duration(sequence),
        duration = (frames * sequence.fps.d) / sequence.fps.n;
      if (
        sequence.width <= 1920 &&
        sequence.height <= 1920 &&
        exported.payload.codec === "h264"
      )
        await engine.ff(
          [
            "-y",
            "-i",
            source,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c",
            "copy",
            "-map_metadata",
            "-1",
            "-movflags",
            "+faststart",
            file,
          ],
          { signal: cancel.signal, timeout: 600000 },
        );
      else
        await engine.ff(
          [
            "-y",
            "-i",
            source,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-vf",
            `scale=1920:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,fps=${sequence.fps.n}/${sequence.fps.d}`,
            ...engine.encode({ quality: "proxy", fps: sequence.fps }),
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-ac",
            "2",
            "-ar",
            "48000",
            "-movflags",
            "+faststart+write_colr",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-colorspace",
            "bt709",
            "-color_range",
            "tv",
            "-map_metadata",
            "-1",
            file,
          ],
          { signal: cancel.signal, timeout: 6 * 60 * 60 * 1000 },
        );
      const meta = await engine.probe(file);
      if (
        meta.codec !== "h264" ||
        Math.abs(meta.fps.n / meta.fps.d - sequence.fps.n / sequence.fps.d) >
          0.0001 ||
        Math.abs(meta.duration - duration) >
          Math.max(0.15, (2 * sequence.fps.d) / sequence.fps.n)
      )
        throw Error(
          "Le rendu de relecture ne correspond pas à la cadence ou à la durée du montage.",
        );
      await engine.ff(
        [
          "-y",
          "-ss",
          String(Math.min(0.5, Math.max(0, duration / 4))),
          "-i",
          file,
          "-frames:v",
          "1",
          "-vf",
          "scale=480:480:force_original_aspect_ratio=decrease",
          "-q:v",
          "4",
          thumb,
        ],
        { signal: cancel.signal, timeout: 60000 },
      );
      const info = {
        logicalId: sequence.id,
        kind: "video",
        name: sequence.name + ".mp4",
        mime: "video/mp4",
        size: (await fs.stat(file)).size,
        sha256: await fileHash(file),
        position: 0,
        metadata: {
          width: meta.width,
          height: meta.height,
          fps: sequence.fps,
          frames,
          sourceId: sequence.id,
          projectId: exported.projectId,
          snapshot: {
            sequence: {
              id: sequence.id,
              version: sequence.version,
              fps: sequence.fps,
              clips: sequence.clips.map(
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
            },
            renderJobId: exported.id,
          },
        },
      };
      if (getJob(job.id).state !== "preparing")
        throw Error("La préparation a été arrêtée.");
      db.prepare(
        "INSERT INTO items(id,job_id,logical_id,info,file,thumbnail) VALUES(?,?,?,?,?,?)",
      ).run(assetId, job.id, sequence.id, JSON.stringify(info), file, thumb);
      // Le film rendu pour cette relecture a sa copie vérifiée dans le dossier
      // de préparation : il n'occupait plus que de la place (relecture du
      // 29/09/2026). Seulement s'il vient du dossier réservé aux relectures,
      // jamais un export que le photographe a rangé lui-même.
      if (
        videoModule?.store?.root &&
        path.dirname(source) === path.join(videoModule.store.root, "review-renders")
      )
        await fs.unlink(source).catch(() => {});
      return true;
    } catch (e) {
      update(job.id, { error: e.message });
      throw e;
    } finally {
      videoPreparations.delete(job.id);
    }
  });
  handle("review-start", (input) => run(input.id));
  handle("review-job", async (input) => {
    const job = getJob(input.id);
    assertCurrent(job);
    if (input.action === "pause") {
      videoPreparations.get(job.id)?.abort();
      if (working === job.id) controller?.abort();
      else if (job.state === "preparing")
        update(job.id, { state: "preparation-paused" });
      else if (!["done", "cancelled"].includes(job.state))
        update(job.id, { state: "paused" });
    } else if (input.action === "resume") {
      if (job.state === "preparation-paused") {
        update(job.id, { state: "preparing" });
        return publicJob(getJob(job.id));
      }
      if (job.state === "preparing") return publicJob(job);
      return run(job.id);
    } else if (input.action === "cancel") {
      if (working === job.id) {
        controller?.abort();
        throw Error(
          "Publication en cours de suspension. Annulez-la après la suspension.",
        );
      }
      if (job.state === "done")
        throw Error(
          "La version est publiée. Révoquez son lien pour arrêter le partage.",
        );
      videoPreparations.get(job.id)?.abort();
      while (videoPreparations.has(job.id)) await pause(20);
      if (job.revision_id)
        await request(
          "/api/admin/revisions/" + job.revision_id + "/abandon",
          "POST",
          {},
        );
      update(job.id, { state: "cancelled", error: "" });
      await fs.rm(path.join(staging, job.id), { recursive: true, force: true });
    } else if (input.action === "hide") {
      if (!["done", "cancelled"].includes(job.state))
        throw Error("Terminez ou annulez cette tâche avant de la retirer.");
      update(job.id, { hidden: 1 });
    } else throw Error("Action inconnue.");
    return publicJob(getJob(job.id));
  });
  // « will-quit » et non « before-quit » : before-quit part AVANT que la
  // fenêtre demande « Rester / Quitter quand même », et « Rester » laissait
  // l'application ouverte mais déjà à moitié arrêtée (relecture du 29/09/2026).
  app.on("will-quit", () => {
    closing = true;
    controller?.abort();
    for (const c of videoPreparations.values()) c.abort();
    if (working)
      update(working, {
        state: "paused",
        error: "Envoi interrompu à la fermeture. Vous pouvez reprendre.",
      });
    // Fermer le serveur ne suffit pas : le stockage garde son verrou
    // (runtime_lease) jusqu'à store.close(). Resté posé, il portait le numéro
    // de ce processus ; repris après un redémarrage par un processus vivant,
    // il faisait refuser le portail au lancement suivant. L'application
    // quitte sans attendre : la fermeture du stockage est synchrone, et les
    // connexions encore ouvertes sont coupées au lieu d'être attendues.
    if (service?.server.listening) {
      service.server.close();
      service.server.closeAllConnections?.();
    }
    try {
      service?.store.close();
    } catch (e) {
      console.error("Review shutdown:", e.message);
    }
  });
  return {
    status,
    request,
    getJob,
    publicJob,
    update,
    db,
    staging,
    run,
    assertCurrent,
    service,
    close: async () => {
      if (closed) return;
      closed = true;
      closing = true;
      controller?.abort();
      for (const c of videoPreparations.values()) c.abort();
      while (working || videoPreparations.size) await pause(20);
      if (service?.server.listening) await service.close();
      db.close();
    },
  };
}
module.exports = { registerReview, fileHash };
