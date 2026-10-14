import http from "node:http";
import { isIP } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import {
  ReviewStore,
  fail,
  hash,
  id,
  identifier,
  integer,
  text,
  publicAsset,
  validateAnchor,
} from "./store.mjs";
import { MediaStore, json } from "./media.mjs";

const derive = promisify(scrypt);
const secret = () => randomBytes(32).toString("base64url");
async function password(value) {
  if (!value) return null;
  text(value, 200);
  if (value.length < 4)
    fail(400, "Le code doit contenir au moins quatre caractères.");
  const salt = secret();
  return salt + ":" + (await derive(value, salt, 32)).toString("hex");
}
async function matches(value, stored) {
  if (!stored) return true;
  if (typeof value !== "string" || value.length > 200) return false;
  const [salt, digest] = stored.split(":");
  return timingSafeEqual(
    await derive(value, salt, 32),
    Buffer.from(digest, "hex"),
  );
}
const page = (url) => ({
  offset: integer(
    Number(url.searchParams.get("cursor") || 0),
    0,
    1000000,
    "Page",
  ),
  limit: integer(
    Number(url.searchParams.get("limit") || 60),
    1,
    100,
    "Taille de page",
  ),
});
const bool = (v) => (v ? 1 : 0);
const expiry = (value) =>
  value == null
    ? null
    : integer(
        value,
        Date.now() + 60000,
        Date.now() + 10 * 365 * 86400000,
        "Date d’expiration",
      );

export async function createReviewServer({
  dataDir,
  bootstrapToken,
  publicUrl,
  publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public"),
  maxStorageBytes = 100 * 1024 ** 3,
  maxRateEntries = 12000,
  trustProxy = false,
} = {}) {
  if (!dataDir || !path.isAbsolute(dataDir))
    throw Error("Un dossier de relecture absolu est requis.");
  if (publicUrl) {
    const parsed = new URL(publicUrl);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      (parsed.protocol !== "https:" &&
        !(
          parsed.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(parsed.hostname)
        ))
    )
      throw Error("Adresse HTTPS sans chemin requise pour un portail distant.");
    publicUrl = parsed.origin;
  }
  const store = new ReviewStore(dataDir, bootstrapToken),
    media = new MediaStore(store);
  try {
    await media.init();
  } catch (error) {
    store.close();
    throw error;
  }
  const limits = new Map();
  let passwordWork = 0;
  const origin = () => publicUrl || "http://127.0.0.1:" + server.address().port;
  /*
   * Au-delà de 12 000 entrées, la table refusait TOUT, clients et photographe
   * compris, et un anonyme la remplissait en inventant des identifiants de
   * lien. Elle garde désormais les entrées les plus récentes : une clé servie
   * repasse en fin de table, et les plus anciennes cèdent leur place.
   */
  const LIMITES_MAX = maxRateEntries,
    LIMITES_PURGE = Math.floor((maxRateEntries * 5) / 6);
  function rate(key, maximum, windowMs = 60000) {
    const now = Date.now(),
      previous = limits.get(key);
    const item =
      previous && previous.until > now
        ? previous
        : { count: 0, until: now + windowMs };
    item.count++;
    limits.delete(key);
    limits.set(key, item);
    if (limits.size > LIMITES_PURGE)
      for (const [k, v] of limits) if (v.until <= now) limits.delete(k);
    if (limits.size > LIMITES_MAX)
      for (const k of limits.keys()) {
        if (limits.size <= LIMITES_PURGE) break;
        limits.delete(k);
      }
    if (item.count > maximum)
      fail(429, "Trop de tentatives. Réessayez dans une minute.");
  }
  /**
   * L'adresse du client. Derrière le proxy TLS de deploy/review (Caddy sur la
   * même machine), toute requête arrive de 127.0.0.1 : une limite par adresse
   * devenait commune à tous les clients. Caddy écrit l'adresse réelle en
   * dernier dans X-Forwarded-For. L'en-tête n'est cru que si l'exploitant le
   * déclare (`trustProxy`, JUNO_TRUST_PROXY=1) : un proxy qui le transmet
   * tel quel laissait le client choisir son adresse et contourner les freins
   * contre les essais de code (relecture du 29/09/2026).
   */
  function adresse(req) {
    const directe = req.socket.remoteAddress || "";
    if (
      !trustProxy ||
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(directe)
    )
      return directe;
    const transmise = String(req.headers["x-forwarded-for"] || "")
      .split(",")
      .pop()
      .trim();
    return isIP(transmise) ? transmise : directe;
  }
  function client(req, shareId) {
    const access = store.share(shareId);
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith("jr_" + shareId + "="))
      ?.split("=")[1];
    const session =
      cookie &&
      store.get(
        "SELECT * FROM sessions WHERE id_hash=? AND share_id=? AND expires>?",
        [hash(cookie), shareId, Date.now()],
      );
    if (!session)
      fail(401, "Rouvrez votre lien privé pour accéder à cet espace.");
    return { ...access, session };
  }
  /** La version a-t-elle été validée par ses destinataires (et pas seulement par une révocation) ? */
  function validee(revisionId) {
    if (
      store.get(
        "SELECT 1 FROM events WHERE kind='validated' AND json_extract(payload,'$.revisionId')=?",
        [revisionId],
      )
    )
      return true;
    // Versions validées avant cette trace : chaque destinataire attendu à la
    // publication, révoqué depuis ou non, a validé.
    const attendus = store.all(
      "SELECT a.share_id AS id FROM revision_approvers a WHERE a.revision_id=?",
      [revisionId],
    );
    return (
      attendus.length > 0 &&
      attendus.every((s) =>
        store.get(
          "SELECT 1 FROM approvals WHERE revision_id=? AND share_id=? AND state='approved'",
          [revisionId, s.id],
        ),
      )
    );
  }
  function decision(revisionId, deliveryId) {
    if (!revisionId) return { state: "preparing", required: 0, approved: 0 };
    // Les validations attendues sont figées à la publication. Un lien révoqué,
    // expiré ou rendu facultatif depuis ne compte plus : sa personne ne peut
    // plus valider, et la version restait bloquée « en relecture ».
    const required = store.all(
      "SELECT a.share_id AS id FROM revision_approvers a JOIN shares s ON s.id=a.share_id WHERE a.revision_id=? AND s.revoked=0 AND s.required=1 AND s.can_approve=1 AND (s.expires IS NULL OR s.expires>?)",
      [revisionId, Date.now()],
    );
    const approvals = store.all(
      "SELECT share_id,state,author,created FROM approvals WHERE revision_id=?",
      [revisionId],
    );
    const approved = required.filter((s) =>
      approvals.some((a) => a.share_id === s.id && a.state === "approved"),
    ).length;
    return {
      state:
        required.length && approved === required.length
          ? "approved"
          : approvals.some((a) => a.state === "changes")
            ? "changes"
            : "review",
      required: required.length,
      approved,
      decisions: approvals,
    };
  }
  function threads(revisionId, url, external) {
    const { offset, limit } = page(url),
      filterAsset = url.searchParams.get("asset"),
      filterStatus = url.searchParams.get("status");
    const args = [revisionId],
      conditions = ["revision_id=?"];
    if (external) conditions.push("visibility='external'");
    if (url.searchParams.get("general") === "1")
      conditions.push("asset_id IS NULL");
    if (filterAsset) {
      conditions.push("asset_id=?");
      args.push(identifier(filterAsset));
    }
    if (filterStatus && filterStatus !== "all") {
      conditions.push("status=?");
      args.push(filterStatus);
    }
    const rows = store.all(
      "SELECT * FROM threads WHERE " +
        conditions.join(" AND ") +
        " ORDER BY created,id LIMIT ? OFFSET ?",
      [...args, limit + 1, offset],
    );
    return {
      items: rows.slice(0, limit).map((t) => ({
        ...t,
        anchor: JSON.parse(t.anchor),
        comments: store.all(
          "SELECT id,author,body,created,internal FROM comments WHERE thread_id=?" +
            (external ? " AND internal=0" : "") +
            " ORDER BY created,id",
          [t.id],
        ),
      })),
      nextCursor: rows.length > limit ? offset + limit : null,
    };
  }
  function createThread({
    revision,
    asset,
    anchor,
    actor,
    author,
    body,
    visibility = "external",
    threadId = id(),
  }) {
    const clean = validateAnchor(anchor, asset),
      now = Date.now();
    store.run(
      "INSERT INTO threads(id,revision_id,asset_id,anchor,visibility,status,created) VALUES(?,?,?,?,?,?,?)",
      [
        threadId,
        revision.id,
        asset?.id || null,
        JSON.stringify(clean),
        visibility,
        "open",
        now,
      ],
    );
    store.run("INSERT INTO comments VALUES(?,?,?,?,?,?,?)", [
      id(),
      threadId,
      actor,
      author,
      text(body),
      bool(visibility === "internal"),
      now,
    ]);
    store.event(revision.delivery_id, actor, "comment", {
      threadId,
      revisionId: revision.id,
      internal: visibility === "internal",
    });
    return threadId;
  }
  function requireNamed(c) {
    if (!c.session.name)
      fail(400, "Indiquez votre nom avant d’envoyer vos retours.");
  }

  const server = http.createServer(async (req, res) => {
    const requestId = id();
    const headers = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Robots-Tag": "noindex, nofollow",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "X-Request-Id": requestId,
    };
    for (const [key, value] of Object.entries(headers))
      res.setHeader(key, value);
    const reply = (status, data, more = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        ...more,
      });
      res.end(JSON.stringify(data));
    };
    try {
      const expected = new URL(origin());
      if (req.headers.host !== expected.host) fail(403, "Hôte non autorisé.");
      if (req.headers.origin && req.headers.origin !== expected.origin)
        fail(403, "Origine non autorisée.");
      const url = new URL(req.url, origin()),
        parts = url.pathname.split("/").filter(Boolean),
        method = req.method;
      if (url.pathname === "/health" && method === "GET") {
        reply(200, {
          ok: true,
          service: "juno-review",
          schema: 1,
          public: expected.protocol === "https:",
        });
        return;
      }
      if (parts[0] === "api") {
        rate("ip:" + adresse(req), 12000);
        if (parts[1] === "admin") {
          const operator = store.operator(
            req.headers.authorization?.match(/^Bearer (.+)$/)?.[1],
          );
          const resource = parts[2],
            itemId = parts[3],
            action = parts[4];
          if (resource === "status" && method === "GET") {
            reply(200, {
              operator,
              origin: origin(),
              storageBytes: store.get(
                "SELECT COALESCE(SUM(size+thumbnail_size),0) AS n FROM assets",
              ).n,
              maxStorageBytes,
            });
            return;
          }
          if (resource === "operators") {
            if (operator.role !== "admin") fail(403, "Administration requise.");
            if (method === "GET") {
              reply(
                200,
                store.all("SELECT id,name,role,disabled FROM operators"),
              );
              return;
            }
            if (method === "POST") {
              const v = await json(req),
                token = secret(),
                operatorId = id();
              store.run("INSERT INTO operators VALUES(?,?,?,?,0)", [
                operatorId,
                text(v.name, 100),
                hash(token),
                v.role === "admin" ? "admin" : "editor",
              ]);
              reply(201, { id: operatorId, token });
              return;
            }
            if (method === "PATCH" && itemId) {
              const v = await json(req);
              if (itemId === operator.id)
                fail(409, "Vous ne pouvez pas désactiver votre propre accès.");
              store.run("UPDATE operators SET disabled=? WHERE id=?", [
                bool(v.disabled),
                identifier(itemId),
              ]);
              reply(200, { ok: true });
              return;
            }
          }
          if (resource === "deliveries" && !itemId) {
            if (method === "GET") {
              const projectId = url.searchParams.get("projectId");
              const rows = store.all(
                `SELECT d.*,(SELECT number FROM revisions WHERE id=d.active_revision) AS version FROM deliveries d JOIN projects p ON p.id=d.project_id WHERE (?='admin' OR p.owner=? OR EXISTS(SELECT 1 FROM members m WHERE m.project_id=p.id AND m.operator_id=?)) ${projectId ? "AND d.project_id=?" : ""} ORDER BY d.created DESC LIMIT 500`,
                [
                  operator.role,
                  operator.id,
                  operator.id,
                  ...(projectId ? [identifier(projectId)] : []),
                ],
              );
              reply(
                200,
                rows.map((d) => ({
                  ...d,
                  decision: decision(d.active_revision, d.id),
                  openCount: store.get(
                    "SELECT COUNT(*) AS n FROM threads t JOIN revisions r ON r.id=t.revision_id WHERE r.delivery_id=? AND t.status NOT IN ('done','declined')",
                    [d.id],
                  ).n,
                })),
              );
              return;
            }
            if (method === "POST") {
              const v = await json(req);
              const result = store.once(operator.id, v.opId, v, () => {
                const projectId = identifier(v.projectId),
                  project = store.get("SELECT * FROM projects WHERE id=?", [
                    projectId,
                  ]);
                if (project) store.project(operator, projectId);
                else
                  store.run("INSERT INTO projects VALUES(?,?,?)", [
                    projectId,
                    operator.id,
                    text(v.projectName, 180),
                  ]);
                const deliveryId = id();
                store.run(
                  "INSERT INTO deliveries(id,project_id,title,message,created) VALUES(?,?,?,?,?)",
                  [
                    deliveryId,
                    projectId,
                    text(v.title, 180),
                    text(v.message, 2000, true),
                    Date.now(),
                  ],
                );
                store.event(deliveryId, operator.id, "created", {});
                return { id: deliveryId };
              });
              reply(201, result);
              return;
            }
          }
          if (resource === "deliveries" && itemId) {
            const delivery = store.delivery(operator, itemId);
            if (!action && method === "GET") {
              reply(200, {
                ...delivery,
                revisions: store.all(
                  "SELECT r.*,(SELECT COUNT(*) FROM assets WHERE revision_id=r.id AND state='ready') AS ready_count FROM revisions r WHERE delivery_id=? ORDER BY number DESC",
                  [itemId],
                ),
                shares: store.all(
                  "SELECT id,name,expires,revoked,downloads,all_versions,can_approve,required,created,CASE WHEN pass_hash IS NULL THEN 0 ELSE 1 END AS protected FROM shares WHERE delivery_id=? ORDER BY created",
                  [itemId],
                ),
                decision: decision(delivery.active_revision, itemId),
              });
              return;
            }
            if (!action && method === "PATCH") {
              const v = await json(req);
              store.transaction(() => {
                store.run("UPDATE deliveries SET archived=? WHERE id=?", [
                  bool(v.archived),
                  itemId,
                ]);
                store.event(
                  itemId,
                  operator.id,
                  v.archived ? "archived" : "reopened",
                  {},
                );
              });
              reply(200, { ok: true });
              return;
            }
            if (action === "members" && method === "POST") {
              if (
                operator.role !== "admin" &&
                store.project(operator, delivery.project_id).owner !==
                  operator.id
              )
                fail(403, "Responsable du projet requis.");
              const v = await json(req);
              if (
                !store.get(
                  "SELECT id FROM operators WHERE id=? AND disabled=0",
                  [identifier(v.operatorId)],
                )
              )
                fail(404, "Membre introuvable.");
              store.run(
                "INSERT INTO members VALUES(?,?) ON CONFLICT DO NOTHING",
                [delivery.project_id, v.operatorId],
              );
              reply(200, { ok: true });
              return;
            }
            if (action === "revisions" && method === "POST") {
              const v = await json(req);
              reply(
                201,
                store.once(operator.id, v.opId, v, () => {
                  const count = integer(v.count, 1, 10000, "Nombre de médias");
                  if (
                    store.get(
                      "SELECT COUNT(*) AS n FROM revisions WHERE delivery_id=? AND state='draft'",
                      [itemId],
                    ).n >= 5
                  )
                    fail(
                      409,
                      "Terminez les versions en préparation avant d’en créer une autre.",
                    );
                  const revisionId = id(),
                    number = store.get(
                      "SELECT COALESCE(MAX(number),0)+1 AS n FROM revisions WHERE delivery_id=?",
                      [itemId],
                    ).n;
                  store.run(
                    "INSERT INTO revisions(id,delivery_id,number,state,created,expected_count,base_revision) VALUES(?,?,?,?,?,?,?)",
                    [
                      revisionId,
                      itemId,
                      number,
                      "draft",
                      Date.now(),
                      count,
                      delivery.active_revision,
                    ],
                  );
                  return {
                    id: revisionId,
                    number,
                    expected_count: count,
                    base_revision: delivery.active_revision,
                  };
                }),
              );
              return;
            }
            if (action === "shares" && method === "POST") {
              const v = await json(req),
                token = v.token || secret(),
                shareId = v.id ? identifier(v.id) : id();
              if (!/^[A-Za-z0-9_-]{43}$/.test(token))
                fail(400, "Secret de lien invalide.");
              const prior = store.get("SELECT * FROM shares WHERE id=?", [
                shareId,
              ]);
              if (prior) {
                if (
                  prior.delivery_id !== itemId ||
                  prior.token_hash !== hash(token)
                )
                  fail(
                    409,
                    "Ce lien existe déjà avec une autre configuration.",
                  );
                reply(200, {
                  id: shareId,
                  url: origin() + "/r/" + shareId + "#" + token,
                });
                return;
              }
              const pass = await password(v.code);
              const expires = expiry(v.expires),
                name = text(v.name || "Client", 100);
              store.transaction(() => {
                const approval = v.canApprove !== false;
                store.run(
                  "INSERT INTO shares(id,delivery_id,name,token_hash,pass_hash,expires,downloads,all_versions,can_approve,required,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                  [
                    shareId,
                    itemId,
                    name,
                    hash(token),
                    pass,
                    expires,
                    bool(v.downloads),
                    bool(v.allVersions !== false),
                    bool(approval),
                    bool(approval && v.required !== false),
                    Date.now(),
                  ],
                );
                // Un lien « doit valider » créé après la publication rejoint
                // les validations attendues de la version en cours : c'est
                // souvent le remplaçant d'un lien révoqué. Sans lui, révoquer
                // le lien des mariés faisait passer la version « Validée »
                // sans qu'ils aient validé (relecture du 29/09/2026). Une
                // version validée par ses destinataires (événement
                // « validated ») le reste : le nouveau lien attendra la
                // suivante. Une version qui ne paraît validée que parce qu'un
                // lien a été révoqué, elle, attend le remplaçant.
                if (
                  approval &&
                  v.required !== false &&
                  delivery.active_revision &&
                  !validee(delivery.active_revision)
                )
                  store.run("INSERT INTO revision_approvers VALUES(?,?)", [
                    delivery.active_revision,
                    shareId,
                  ]);
                store.event(itemId, operator.id, "share-created", {
                  shareId,
                  name,
                });
              });
              reply(201, {
                id: shareId,
                url: origin() + "/r/" + shareId + "#" + token,
              });
              return;
            }
            if (action === "events" && method === "GET") {
              const after = integer(
                Number(url.searchParams.get("after") || 0),
                0,
                Number.MAX_SAFE_INTEGER,
              );
              reply(
                200,
                store
                  .all(
                    "SELECT * FROM events WHERE delivery_id=? AND seq>? ORDER BY seq LIMIT 200",
                    [itemId, after],
                  )
                  .map((e) => ({ ...e, payload: JSON.parse(e.payload) })),
              );
              return;
            }
            if (action === "export" && method === "GET") {
              const revisions = store.all(
                "SELECT * FROM revisions WHERE delivery_id=?",
                [itemId],
              );
              reply(200, {
                schema: 1,
                exportedAt: new Date().toISOString(),
                delivery,
                revisions: revisions.map((r) => ({
                  ...r,
                  assets: store
                    .all(
                      "SELECT * FROM assets WHERE revision_id=? ORDER BY position,id",
                      [r.id],
                    )
                    .map(publicAsset),
                  threads: store
                    .all(
                      "SELECT * FROM threads WHERE revision_id=? ORDER BY created,id",
                      [r.id],
                    )
                    .map((t) => ({
                      ...t,
                      anchor: JSON.parse(t.anchor),
                      comments: store.all(
                        "SELECT id,author,body,internal,created FROM comments WHERE thread_id=? ORDER BY created,id",
                        [t.id],
                      ),
                    })),
                  selections: store.all(
                    "SELECT share_id,participant_id,asset_id FROM selections WHERE revision_id=?",
                    [r.id],
                  ),
                  approvals: store.all(
                    "SELECT * FROM approvals WHERE revision_id=?",
                    [r.id],
                  ),
                })),
              });
              return;
            }
          }
          if (resource === "revisions" && itemId) {
            const revision = store.revision(operator, itemId);
            if (action === "abandon" && method === "POST") {
              if (revision.state === "published")
                fail(
                  409,
                  "Cette version est publiée. Révoquez son lien pour arrêter le partage.",
                );
              if (
                store
                  .all("SELECT id FROM assets WHERE revision_id=?", [itemId])
                  .some((a) => media.pending.has(a.id))
              )
                fail(
                  409,
                  "Suspendez les transferts avant d’annuler cette version.",
                );
              store.transaction(() => {
                store.run("UPDATE revisions SET state='abandoned' WHERE id=?", [
                  itemId,
                ]);
                store.event(revision.delivery_id, operator.id, "abandoned", {
                  revisionId: itemId,
                });
              });
              reply(200, { ok: true });
              return;
            }
            if (action === "assets" && method === "GET") {
              const p = page(url),
                items = store.all(
                  "SELECT * FROM assets WHERE revision_id=? ORDER BY position,id LIMIT ? OFFSET ?",
                  [itemId, p.limit + 1, p.offset],
                );
              reply(200, {
                items: items
                  .slice(0, p.limit)
                  .map((a) => ({ ...a, metadata: JSON.parse(a.metadata) })),
                nextCursor: items.length > p.limit ? p.offset + p.limit : null,
              });
              return;
            }
            if (action === "threads" && method === "GET") {
              reply(200, threads(itemId, url, false));
              return;
            }
            if (action === "selections" && method === "GET") {
              reply(
                200,
                store
                  .all(
                    "SELECT s.share_id,s.participant_id,s.asset_id,sh.name AS shareName,a.logical_id,a.metadata FROM selections s JOIN shares sh ON sh.id=s.share_id JOIN assets a ON a.id=s.asset_id WHERE s.revision_id=?",
                    [itemId],
                  )
                  .map((row) => ({
                    share_id: row.share_id,
                    participant_id: row.participant_id,
                    asset_id: row.asset_id,
                    shareName: row.shareName,
                    logicalId: row.logical_id,
                    sourceId: JSON.parse(row.metadata).sourceId,
                  })),
              );
              return;
            }
            if (action === "assets" && method === "POST") {
              const v = await json(req, 8 * 1024 * 1024);
              if (store.revision(operator, itemId).state !== "draft")
                fail(409, "Cette version est figée.");
              const assetId = identifier(v.id),
                logicalId = identifier(v.logicalId),
                name = text(v.name, 180),
                size = integer(v.size, 4, 50 * 1024 ** 3, "Taille");
              if (
                !["photo", "video"].includes(v.kind) ||
                !["image/jpeg", "image/png", "video/mp4"].includes(v.mime) ||
                (v.kind === "video") !== (v.mime === "video/mp4") ||
                !/^[a-f0-9]{64}$/.test(v.sha256)
              )
                fail(400, "Rendu incompatible.");
              const m = v.metadata || {},
                metadata = {
                  width: integer(m.width, 1, 50000),
                  height: integer(m.height, 1, 50000),
                  sourceId: identifier(m.sourceId || logicalId),
                  projectId: identifier(
                    m.projectId ||
                      store.delivery(operator, revision.delivery_id).project_id,
                  ),
                  snapshot: m.snapshot || null,
                };
              if (JSON.stringify(metadata.snapshot).length > 6 * 1024 * 1024)
                fail(413, "Trop de métadonnées.");
              if (v.kind === "video") {
                metadata.fps = {
                  n: integer(m.fps?.n, 1, 240000),
                  d: integer(m.fps?.d, 1, 100000),
                };
                if (metadata.fps.n / metadata.fps.d > 240)
                  fail(400, "Cadence incompatible.");
                metadata.frames = integer(m.frames, 1, 6000000);
                metadata.duration =
                  (metadata.frames * metadata.fps.d) / metadata.fps.n;
              }
              const prior = store.get("SELECT * FROM assets WHERE id=?", [
                assetId,
              ]);
              if (prior) {
                if (
                  prior.revision_id !== itemId ||
                  prior.sha256 !== v.sha256 ||
                  prior.size !== size ||
                  prior.logical_id !== logicalId ||
                  prior.metadata !== JSON.stringify(metadata)
                )
                  fail(409, "Ce média existe avec un autre contenu.");
                reply(200, {
                  id: prior.id,
                  received: prior.received,
                  ready: prior.state === "ready",
                  thumbnail: prior.thumbnail_size > 0,
                });
                return;
              }
              if (
                store.get(
                  "SELECT COUNT(*) AS n FROM assets WHERE revision_id=?",
                  [itemId],
                ).n >= revision.expected_count
              )
                fail(
                  409,
                  "Cette version contient déjà le nombre prévu de médias.",
                );
              if (
                store.get(
                  "SELECT COALESCE(SUM(size+thumbnail_size),0) AS n FROM assets",
                ).n +
                  size >
                maxStorageBytes
              )
                fail(507, "Le quota de stockage du portail est atteint.");
              const position = integer(v.position, 0, 9999);
              store.run(
                "INSERT INTO assets(id,revision_id,logical_id,kind,name,mime,size,sha256,metadata,position) VALUES(?,?,?,?,?,?,?,?,?,?)",
                [
                  assetId,
                  itemId,
                  logicalId,
                  v.kind,
                  name,
                  v.mime,
                  size,
                  v.sha256,
                  JSON.stringify(metadata),
                  position,
                ],
              );
              reply(201, {
                id: assetId,
                received: 0,
                ready: false,
                thumbnail: false,
              });
              return;
            }
            if (action === "publish" && method === "POST") {
              const v = await json(req);
              reply(
                200,
                store.once(operator.id, v.opId, v, () => {
                  const current = store.revision(operator, itemId),
                    delivery = store.delivery(operator, current.delivery_id);
                  if (current.state === "abandoned")
                    fail(409, "Cette préparation a été annulée.");
                  if (current.state === "published")
                    return { id: itemId, number: current.number };
                  if (delivery.active_revision !== current.base_revision)
                    fail(
                      409,
                      "Une autre version a été publiée pendant votre préparation. Créez une nouvelle version depuis l’état courant.",
                    );
                  const count = store.get(
                    "SELECT COUNT(*) AS n FROM assets WHERE revision_id=?",
                    [itemId],
                  ).n;
                  if (
                    count !== current.expected_count ||
                    store.get(
                      "SELECT COUNT(*) AS n FROM assets WHERE revision_id=? AND (state!='ready' OR thumbnail_size=0)",
                      [itemId],
                    ).n
                  )
                    fail(
                      409,
                      "Vérifiez tous les rendus et miniatures avant de publier.",
                    );
                  store.run(
                    "UPDATE revisions SET state=?,published=? WHERE id=?",
                    ["published", Date.now(), itemId],
                  );
                  store.run(
                    "INSERT INTO revision_approvers SELECT ?,id FROM shares WHERE delivery_id=? AND required=1 AND can_approve=1 AND revoked=0 AND (expires IS NULL OR expires>?)",
                    [itemId, current.delivery_id, Date.now()],
                  );
                  store.run(
                    "UPDATE deliveries SET active_revision=?,archived=0 WHERE id=?",
                    [itemId, current.delivery_id],
                  );
                  store.event(current.delivery_id, operator.id, "published", {
                    revisionId: itemId,
                    number: current.number,
                  });
                  return { id: itemId, number: current.number };
                }),
              );
              return;
            }
            if (action === "threads" && method === "POST") {
              const v = await json(req),
                asset = v.assetId ? store.asset(operator, v.assetId) : null;
              if (asset && asset.revision_id !== itemId)
                fail(400, "Le média appartient à une autre version.");
              reply(
                201,
                store.once(operator.id, v.opId, v, () => ({
                  id: createThread({
                    revision,
                    asset,
                    anchor: v.anchor,
                    actor: operator.id,
                    author: operator.name,
                    body: v.body,
                    visibility: v.internal ? "internal" : "external",
                  }),
                })),
              );
              return;
            }
          }
          if (resource === "assets" && itemId) {
            const asset = store.asset(operator, itemId);
            if (!action && method === "GET") {
              reply(200, { ...asset, metadata: JSON.parse(asset.metadata) });
              return;
            }
            if (action === "content" && method === "PUT") {
              reply(200, await media.upload(req, operator, itemId));
              return;
            }
            if (action === "complete" && method === "POST") {
              reply(200, await media.finish(operator, itemId));
              return;
            }
            if (action === "thumbnail" && method === "PUT") {
              reply(200, await media.thumbnail(req, operator, itemId));
              return;
            }
            if (action === "reset" && method === "POST") {
              reply(200, await media.reset(operator, itemId));
              return;
            }
            if (
              ["file", "thumbnail"].includes(action) &&
              ["GET", "HEAD"].includes(method)
            ) {
              await media.stream(req, res, asset, action);
              return;
            }
          }
          if (resource === "shares" && itemId && method === "PATCH") {
            let share = store.get("SELECT * FROM shares WHERE id=?", [
              identifier(itemId),
            ]);
            if (!share) fail(404, "Lien introuvable.");
            store.delivery(operator, share.delivery_id);
            const v = await json(req),
              pass = Object.hasOwn(v, "code")
                ? await password(v.code)
                : share.pass_hash;
            store.transaction(() => {
              share = store.get("SELECT * FROM shares WHERE id=?", [itemId]);
              store.run(
                "UPDATE shares SET revoked=?,downloads=?,expires=?,pass_hash=?,required=? WHERE id=?",
                [
                  v.revoked == null ? share.revoked : bool(v.revoked),
                  v.downloads == null ? share.downloads : bool(v.downloads),
                  Object.hasOwn(v, "expires")
                    ? expiry(v.expires)
                    : share.expires,
                  Object.hasOwn(v, "code") ? pass : share.pass_hash,
                  v.required == null ? share.required : bool(v.required),
                  itemId,
                ],
              );
              if (v.revoked || Object.hasOwn(v, "code"))
                store.run("DELETE FROM sessions WHERE share_id=?", [itemId]);
              store.event(share.delivery_id, operator.id, "share-updated", {
                shareId: itemId,
              });
            });
            reply(200, { ok: true });
            return;
          }
          if (resource === "threads" && itemId) {
            const thread = store.get("SELECT * FROM threads WHERE id=?", [
              identifier(itemId),
            ]);
            if (!thread) fail(404, "Retour introuvable.");
            const revision = store.revision(operator, thread.revision_id);
            if (method === "PATCH") {
              const v = await json(req);
              if (
                !["open", "working", "clarify", "done", "declined"].includes(
                  v.status,
                )
              )
                fail(400, "État invalide.");
              if (v.assignedTo) {
                const target = store.get(
                  "SELECT * FROM operators WHERE id=? AND disabled=0",
                  [identifier(v.assignedTo)],
                );
                if (!target) fail(400, "Responsable invalide.");
                store.delivery(target, revision.delivery_id);
              }
              store.transaction(() => {
                const updated = store.run(
                  "UPDATE threads SET status=?,assigned_to=?,revision=revision+1 WHERE id=? AND revision=?",
                  [
                    v.status,
                    v.assignedTo || null,
                    itemId,
                    integer(v.revision, 1, Number.MAX_SAFE_INTEGER),
                  ],
                );
                if (!updated.changes)
                  fail(
                    409,
                    "Ce retour a été modifié. Actualisez avant de poursuivre.",
                  );
                store.event(
                  revision.delivery_id,
                  operator.id,
                  "thread-updated",
                  {
                    threadId: itemId,
                    status: v.status,
                  },
                );
              });
              reply(200, { revision: v.revision + 1 });
              return;
            }
            if (method === "POST" && action === "reply") {
              const v = await json(req);
              reply(
                201,
                store.once(operator.id, v.opId, v, () => {
                  const commentId = id();
                  store.run("INSERT INTO comments VALUES(?,?,?,?,?,?,?)", [
                    commentId,
                    itemId,
                    operator.id,
                    operator.name,
                    text(v.body),
                    bool(v.internal || thread.visibility === "internal"),
                    Date.now(),
                  ]);
                  store.event(revision.delivery_id, operator.id, "reply", {
                    threadId: itemId,
                    internal: !!v.internal,
                  });
                  return { id: commentId };
                }),
              );
              return;
            }
          }
          if (resource === "budget" && itemId) {
            store.project(operator, itemId);
            store.run(
              "INSERT INTO budgets(project_id) VALUES(?) ON CONFLICT DO NOTHING",
              [itemId],
            );
            if (method === "GET") {
              reply(
                200,
                store.get("SELECT * FROM budgets WHERE project_id=?", [itemId]),
              );
              return;
            }
            if (action === "reserve" && method === "POST") {
              const v = await json(req),
                reservationId = identifier(v.id),
                cents = integer(v.maxCents, 1, 500);
              reply(
                200,
                store.transaction(() => {
                  const previous = store.get(
                    "SELECT * FROM reservations WHERE id=?",
                    [reservationId],
                  );
                  if (previous) {
                    if (
                      previous.project_id !== itemId ||
                      previous.max_cents !== cents
                    )
                      fail(409, "Réservation incompatible.");
                    return previous;
                  }
                  const changed = store.run(
                    "UPDATE budgets SET reserved_cents=reserved_cents+? WHERE project_id=? AND spent_cents+reserved_cents+?<=limit_cents",
                    [cents, itemId, cents],
                  );
                  if (!changed.changes)
                    fail(
                      402,
                      "Le plafond de 5 € de cet album ne permet pas cet appel.",
                    );
                  store.run(
                    "INSERT INTO reservations(id,project_id,max_cents,state,created) VALUES(?,?,?,?,?)",
                    [reservationId, itemId, cents, "reserved", Date.now()],
                  );
                  return {
                    id: reservationId,
                    state: "reserved",
                    max_cents: cents,
                  };
                }),
              );
              return;
            }
            if (action === "settle" && method === "POST") {
              const v = await json(req);
              reply(
                200,
                store.transaction(() => {
                  const reservation = store.get(
                    "SELECT * FROM reservations WHERE id=? AND project_id=?",
                    [identifier(v.id), itemId],
                  );
                  if (!reservation) fail(404, "Réservation introuvable.");
                  const actual = integer(
                    v.actualCents,
                    0,
                    reservation.max_cents,
                  );
                  if (reservation.state === "settled") {
                    if (reservation.actual_cents !== actual)
                      fail(409, "Coût déjà confirmé.");
                    return { ok: true };
                  }
                  store.run(
                    "UPDATE budgets SET reserved_cents=reserved_cents-?,spent_cents=spent_cents+? WHERE project_id=?",
                    [reservation.max_cents, actual, itemId],
                  );
                  store.run(
                    "UPDATE reservations SET state=?,actual_cents=? WHERE id=?",
                    ["settled", actual, v.id],
                  );
                  return { ok: true };
                }),
              );
              return;
            }
          }
          fail(404, "Action inconnue.");
        }
        if (parts[1] === "client" && parts[2]) {
          const shareId = identifier(parts[2]),
            action = parts[3];
          if (
            !["GET", "HEAD"].includes(method) &&
            req.headers["x-juno-client"] !== "1"
          )
            fail(403, "Requête de relecture invalide.");
          if (action === "access" && method === "POST") {
            // Le lien d'abord : un identifiant inventé répond 404 sans
            // occuper de place dans la table des limites.
            const { share } = store.share(shareId);
            rate("access:" + adresse(req) + ":" + shareId, 20);
            const v = await json(req);
            if (
              typeof v.token !== "string" ||
              v.token.length > 100 ||
              !timingSafeEqual(
                Buffer.from(hash(v.token)),
                Buffer.from(share.token_hash),
              )
            )
              fail(403, "Lien ou code d’accès incorrect.");
            if (passwordWork >= 4)
              fail(429, "Accès en cours. Réessayez dans quelques secondes.");
            passwordWork++;
            try {
              if (!(await matches(v.code, share.pass_hash)))
                fail(403, "Lien ou code d’accès incorrect.");
            } finally {
              passwordWork--;
            }
            const currentShare = store.share(shareId).share;
            if(currentShare.pass_hash !== share.pass_hash || currentShare.token_hash !== share.token_hash || currentShare.expires !== share.expires) fail(403,"Les accès ont changé. Rouvrez votre lien et réessayez.");
            const token = secret(),
              participantId = id(),
              expires = Math.min(
                Date.now() + 7 * 86400000,
                share.expires || Infinity,
              );
            store.run("INSERT INTO sessions VALUES(?,?,?,?,?,?)", [
              hash(token),
              shareId,
              participantId,
              text(v.name, 100, true),
              Date.now(),
              expires,
            ]);
            store.run("DELETE FROM sessions WHERE expires<?", [Date.now()]);
            reply(
              200,
              { ok: true },
              {
                "Set-Cookie": `jr_${shareId}=${token}; HttpOnly; SameSite=Strict; Path=/api/client/${shareId}; Max-Age=${Math.floor((expires - Date.now()) / 1000)}${expected.protocol === "https:" ? "; Secure" : ""}`,
              },
            );
            return;
          }
          const c = client(req, shareId);
          if (action === "identify" && method === "POST") {
            const v = await json(req);
            store.run("UPDATE sessions SET name=? WHERE id_hash=?", [
              text(v.name, 100),
              c.session.id_hash,
            ]);
            reply(200, { ok: true });
            return;
          }
          if (action === "manifest" && method === "GET") {
            const revisionId =
              url.searchParams.get("revision") || c.delivery.active_revision;
            if (!revisionId)
              fail(409, "La livraison est encore en préparation.");
            const revision = store.clientRevision(c, revisionId);
            reply(200, {
              delivery: {
                id: c.delivery.id,
                title: c.delivery.title,
                message: c.delivery.message,
              },
              revision: {
                id: revision.id,
                number: revision.number,
                count: revision.expected_count,
              },
              currentRevision: c.delivery.active_revision,
              versions: store.all(
                "SELECT id,number,published FROM revisions WHERE delivery_id=? AND state='published'" +
                  (c.share.all_versions ? "" : " AND id=?") +
                  " ORDER BY number DESC",
                [
                  c.delivery.id,
                  ...(!c.share.all_versions
                    ? [c.delivery.active_revision]
                    : []),
                ],
              ),
              viewer: {
                id: c.session.participant_id,
                name: c.session.name,
                verified: false,
              },
              downloads: !!c.share.downloads,
              canApprove: !!c.share.can_approve,
              selection: store
                .all(
                  "SELECT asset_id FROM selections WHERE share_id=? AND participant_id=? AND revision_id=?",
                  [shareId, c.session.participant_id, revisionId],
                )
                .map((s) => s.asset_id),
              selectionRevision:
                store.get(
                  "SELECT version FROM selection_revisions WHERE share_id=? AND participant_id=? AND revision_id=?",
                  [shareId, c.session.participant_id, revisionId],
                )?.version || 0,
              decision: decision(revisionId, c.delivery.id),
              ownDecision:
                store.get(
                  "SELECT state,author,created FROM approvals WHERE revision_id=? AND share_id=?",
                  [revisionId, shareId],
                ) || null,
            });
            return;
          }
          if (action === "assets" && !parts[4] && method === "GET") {
            const revision = store.clientRevision(
                c,
                url.searchParams.get("revision") || c.delivery.active_revision,
              ),
              p = page(url);
            const conditions = ["revision_id=?", "state='ready'"],
              args = [revision.id];
            if (url.searchParams.has("kind")) {
              conditions.push("kind=?");
              args.push(url.searchParams.get("kind"));
            }
            if (url.searchParams.has("logicalId")) {
              conditions.push("logical_id=?");
              args.push(identifier(url.searchParams.get("logicalId")));
            }
            if (url.searchParams.has("q")) {
              conditions.push("name LIKE ?");
              args.push("%" + text(url.searchParams.get("q"), 100, true) + "%");
            }
            if (url.searchParams.has("ids")) {
              const ids = url.searchParams
                .get("ids")
                .split(",")
                .map(identifier);
              if (ids.length > 100) fail(400, "Trop de médias demandés.");
              conditions.push("id IN (" + ids.map(() => "?").join(",") + ")");
              args.push(...ids);
            }
            const where = conditions.join(" AND "),
              items = store.all(
                "SELECT * FROM assets WHERE " +
                  where +
                  " ORDER BY position,id LIMIT ? OFFSET ?",
                [...args, p.limit + 1, p.offset],
              );
            reply(200, {
              items: items.slice(0, p.limit).map(publicAsset),
              total: store.get(
                "SELECT COUNT(*) AS n FROM assets WHERE " + where,
                args,
              ).n,
              nextCursor: items.length > p.limit ? p.offset + p.limit : null,
            });
            return;
          }
          if (
            action === "assets" &&
            parts[4] &&
            ["file", "thumbnail"].includes(parts[5]) &&
            ["GET", "HEAD"].includes(method)
          ) {
            const asset = store.clientAsset(c, parts[4]),
              download = url.searchParams.get("download") === "1";
            if (download && !c.share.downloads)
              fail(403, "Le téléchargement n’est pas activé par Juno.");
            await media.stream(req, res, asset, parts[5], download);
            return;
          }
          if (action === "threads" && method === "GET") {
            const revision = store.clientRevision(
              c,
              url.searchParams.get("revision") || c.delivery.active_revision,
            );
            reply(200, threads(revision.id, url, true));
            return;
          }
          if (action === "reply" && method === "POST") {
            requireNamed(c);
            const v = await json(req),
              thread = store.get(
                "SELECT * FROM threads WHERE id=? AND visibility='external'",
                [identifier(v.threadId)],
              );
            if (!thread) fail(404, "Discussion inaccessible.");
            const revision = store.clientRevision(c, thread.revision_id);
            reply(
              201,
              store.once(c.session.participant_id, v.opId, v, () => {
                const commentId = id();
                store.run("INSERT INTO comments VALUES(?,?,?,?,?,0,?)", [
                  commentId,
                  thread.id,
                  c.session.participant_id,
                  c.session.name,
                  text(v.body),
                  Date.now(),
                ]);
                store.event(
                  revision.delivery_id,
                  c.session.participant_id,
                  "reply",
                  { threadId: thread.id },
                );
                return { id: commentId };
              }),
            );
            return;
          }
          if (action === "submit" && method === "POST") {
            requireNamed(c);
            rate("submit:" + c.session.participant_id, 60);
            const v = await json(req),
              revision = store.clientRevision(c, v.revisionId);
            if (
              !Array.isArray(v.comments) ||
              v.comments.length > 200 ||
              (v.selection != null &&
                (!Array.isArray(v.selection) || v.selection.length > 10000))
            )
              fail(400, "Lot de retours invalide.");
            reply(
              201,
              store.once(c.session.participant_id, v.opId, v, () => {
                const threadIds = v.comments.map((comment) => {
                  const asset = comment.assetId
                    ? store.clientAsset(c, comment.assetId)
                    : null;
                  if (asset && asset.revision_id !== revision.id)
                    fail(400, "Le média appartient à une autre version.");
                  return createThread({
                    revision,
                    asset,
                    anchor: comment.anchor,
                    actor: c.session.participant_id,
                    author: c.session.name,
                    body: comment.body,
                  });
                });
                let version =
                  store.get(
                    "SELECT version FROM selection_revisions WHERE share_id=? AND participant_id=? AND revision_id=?",
                    [shareId, c.session.participant_id, revision.id],
                  )?.version || 0;
                if (v.selection != null) {
                  if (v.selectionRevision !== version)
                    fail(
                      409,
                      "Votre sélection a changé dans un autre onglet. Actualisez avant de la renvoyer.",
                    );
                  const chosen = [...new Set(v.selection)];
                  for (const assetId of chosen) {
                    const a = store.clientAsset(c, assetId);
                    if (a.revision_id !== revision.id || a.kind !== "photo")
                      fail(400, "Sélection photo invalide.");
                  }
                  store.run(
                    "DELETE FROM selections WHERE share_id=? AND participant_id=? AND revision_id=?",
                    [shareId, c.session.participant_id, revision.id],
                  );
                  for (const assetId of chosen)
                    store.run("INSERT INTO selections VALUES(?,?,?,?)", [
                      shareId,
                      c.session.participant_id,
                      revision.id,
                      assetId,
                    ]);
                  version++;
                  store.run(
                    "INSERT INTO selection_revisions VALUES(?,?,?,?) ON CONFLICT(share_id,participant_id,revision_id) DO UPDATE SET version=excluded.version",
                    [shareId, c.session.participant_id, revision.id, version],
                  );
                }
                store.event(
                  revision.delivery_id,
                  c.session.participant_id,
                  "feedback-submitted",
                  {
                    revisionId: revision.id,
                    comments: threadIds.length,
                    selected: v.selection?.length,
                    author: c.session.name,
                  },
                );
                return {
                  threadIds,
                  selectionRevision: version,
                  receivedAt: Date.now(),
                };
              }),
            );
            return;
          }
          if (action === "approve" && method === "POST") {
            requireNamed(c);
            if (!c.share.can_approve)
              fail(403, "Ce lien ne permet pas de valider la livraison.");
            const v = await json(req),
              revision = store.clientRevision(c, v.revisionId);
            if (!["approved", "changes", "withdrawn"].includes(v.decision))
              fail(400, "Décision invalide.");
            reply(
              200,
              store.once(c.session.participant_id, v.opId, v, () => {
                const delivery = store.get(
                  "SELECT * FROM deliveries WHERE id=?",
                  [c.delivery.id],
                );
                if (
                  v.decision !== "withdrawn" &&
                  delivery.active_revision !== revision.id
                )
                  fail(
                    409,
                    "Une nouvelle version est disponible. Consultez-la avant de valider.",
                  );
                store.run(
                  "INSERT INTO approvals VALUES(?,?,?,?,?,?) ON CONFLICT(revision_id,share_id) DO UPDATE SET state=excluded.state,author=excluded.author,participant_id=excluded.participant_id,created=excluded.created",
                  [
                    revision.id,
                    shareId,
                    v.decision,
                    c.session.name,
                    c.session.participant_id,
                    Date.now(),
                  ],
                );
                store.event(delivery.id, c.session.participant_id, "approval", {
                  revisionId: revision.id,
                  shareId,
                  decision: v.decision,
                  author: c.session.name,
                  verified: false,
                });
                const apres = decision(revision.id, delivery.id);
                // La trace d'une validation obtenue des destinataires eux-mêmes.
                if (apres.state === "approved" && !validee(revision.id))
                  store.event(delivery.id, c.session.participant_id, "validated", {
                    revisionId: revision.id,
                  });
                return { ok: true, decision: apres };
              }),
            );
            return;
          }
          fail(404, "Action inconnue.");
        }
        fail(404, "Action inconnue.");
      }
      if (!["GET", "HEAD"].includes(method))
        fail(405, "Méthode non autorisée.");
      const isPage =
        url.pathname === "/" || /^\/r\/[A-Za-z0-9_-]+$/.test(url.pathname);
      if (!isPage && !/^\/assets\/[A-Za-z0-9_./-]+$/.test(url.pathname))
        fail(404, "Page introuvable.");
      const relative = isPage ? "index.html" : url.pathname.slice(1),
        file = path.resolve(publicDir, relative);
      if (!file.startsWith(path.resolve(publicDir) + path.sep))
        fail(403, "Chemin invalide.");
      const data = await fs
        .readFile(file)
        .catch(() => fail(503, "Le portail est en préparation."));
      const mime =
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".woff2": "font/woff2",
          ".svg": "image/svg+xml",
          ".png": "image/png",
        }[path.extname(file)] || "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": mime,
        "Content-Length": data.length,
        ...(isPage
          ? {}
          : { "Cache-Control": "public, max-age=31536000, immutable" }),
      });
      res.end(method === "HEAD" ? undefined : data);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const status = error.status || 500;
      if (!error.status)
        console.error("Review error", requestId, error.message);
      reply(status, {
        error: error.status
          ? error.message
          : "Une erreur est survenue. Réessayez ; vos fichiers restent conservés.",
        requestId,
      });
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 30000;
  return {
    server,
    store,
    media,
    origin,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  const service = await createReviewServer({
    dataDir: process.env.JUNO_REVIEW_DATA,
    bootstrapToken: process.env.JUNO_REVIEW_BOOTSTRAP_TOKEN,
    publicUrl: process.env.JUNO_REVIEW_URL,
    maxStorageBytes:
      Number(process.env.JUNO_REVIEW_QUOTA_GB || 100) * 1024 ** 3,
    trustProxy: process.env.JUNO_TRUST_PROXY === "1",
  });
  const host = process.env.HOST || "127.0.0.1";
  if (
    host !== "127.0.0.1" &&
    !process.env.JUNO_REVIEW_URL?.startsWith("https://")
  )
    throw Error(
      "Une adresse publique HTTPS est requise avant une exposition distante.",
    );
  service.server.listen(Number(process.env.PORT || 8788), host, () =>
    console.log("Juno Review prêt."),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => service.close().then(() => process.exit(0)));
}
