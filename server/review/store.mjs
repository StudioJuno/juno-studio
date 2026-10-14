import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export class ReviewError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => {
  throw new ReviewError(status, message);
};
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const id = () => randomUUID();
export function identifier(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
    fail(400, "Identifiant invalide.");
  return value;
}
export function text(value, max = 4000, optional = false) {
  if (value == null && optional) return "";
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!optional && !value.trim())
  )
    fail(400, "Texte vide ou trop long.");
  return value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}
export function integer(value, min, max, label = "Valeur") {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(400, label + " invalide.");
  return value;
}

export class ReviewStore {
  constructor(root, bootstrapToken) {
    if (bootstrapToken && !/^[A-Za-z0-9_-]{43,100}$/.test(bootstrapToken)) throw Error("Jeton administrateur initial invalide.");
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = root;
    this.db = new DatabaseSync(path.join(root, "review.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS operators(id TEXT PRIMARY KEY,name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,role TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES operators(id),name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS members(project_id TEXT NOT NULL REFERENCES projects(id),operator_id TEXT NOT NULL REFERENCES operators(id),PRIMARY KEY(project_id,operator_id));
      CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,message TEXT NOT NULL,created INTEGER NOT NULL,active_revision TEXT,archived INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES deliveries(id),number INTEGER NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,published INTEGER,expected_count INTEGER NOT NULL,base_revision TEXT,UNIQUE(delivery_id,number));
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES revisions(id),logical_id TEXT NOT NULL,kind TEXT NOT NULL,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,received INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'uploading',metadata TEXT NOT NULL,position INTEGER NOT NULL,thumbnail_size INTEGER NOT NULL DEFAULT 0,UNIQUE(revision_id,logical_id));
      CREATE INDEX IF NOT EXISTS assets_revision ON assets(revision_id,position,id);
      CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL REFERENCES deliveries(id),name TEXT NOT NULL,token_hash TEXT UNIQUE NOT NULL,pass_hash TEXT,expires INTEGER,revoked INTEGER NOT NULL DEFAULT 0,downloads INTEGER NOT NULL DEFAULT 0,all_versions INTEGER NOT NULL DEFAULT 1,can_approve INTEGER NOT NULL DEFAULT 1,required INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id_hash TEXT PRIMARY KEY,share_id TEXT NOT NULL REFERENCES shares(id),participant_id TEXT NOT NULL,name TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_share ON sessions(share_id);
      CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES revisions(id),asset_id TEXT REFERENCES assets(id),anchor TEXT NOT NULL,visibility TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',assigned_to TEXT,revision INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS threads_revision ON threads(revision_id,created,id);
      CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id),actor_id TEXT NOT NULL,author TEXT NOT NULL,body TEXT NOT NULL,internal INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS comments_thread ON comments(thread_id,created,id);
      CREATE TABLE IF NOT EXISTS selections(share_id TEXT NOT NULL REFERENCES shares(id),participant_id TEXT NOT NULL,revision_id TEXT NOT NULL REFERENCES revisions(id),asset_id TEXT NOT NULL REFERENCES assets(id),PRIMARY KEY(share_id,participant_id,revision_id,asset_id));
      CREATE TABLE IF NOT EXISTS selection_revisions(share_id TEXT NOT NULL,participant_id TEXT NOT NULL,revision_id TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(share_id,participant_id,revision_id));
      CREATE TABLE IF NOT EXISTS approvals(revision_id TEXT NOT NULL REFERENCES revisions(id),share_id TEXT NOT NULL REFERENCES shares(id),state TEXT NOT NULL,author TEXT NOT NULL,participant_id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(revision_id,share_id));
      CREATE TABLE IF NOT EXISTS revision_approvers(revision_id TEXT NOT NULL REFERENCES revisions(id),share_id TEXT NOT NULL REFERENCES shares(id),PRIMARY KEY(revision_id,share_id));
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,delivery_id TEXT NOT NULL REFERENCES deliveries(id),actor_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS events_delivery ON events(delivery_id,seq);
      CREATE TABLE IF NOT EXISTS requests(actor_id TEXT NOT NULL,key TEXT NOT NULL,payload_hash TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(actor_id,key));
      CREATE TABLE IF NOT EXISTS budgets(project_id TEXT PRIMARY KEY REFERENCES projects(id),limit_cents INTEGER NOT NULL DEFAULT 500,spent_cents INTEGER NOT NULL DEFAULT 0,reserved_cents INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reservations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),max_cents INTEGER NOT NULL,actual_cents INTEGER,state TEXT NOT NULL,created INTEGER NOT NULL);
    `);
    this.lease = id();
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS runtime_lease(id INTEGER PRIMARY KEY,pid INTEGER NOT NULL,token TEXT NOT NULL)",
    );
    try {
      this.transaction(() => {
        const previous = this.get("SELECT * FROM runtime_lease WHERE id=1");
        if (previous) {
          let alive = true;
          try {
            process.kill(previous.pid, 0);
          } catch (e) {
            if (e.code === "ESRCH") alive = false;
          }
          if (alive)
            throw Error(
              "Ce stockage de relecture est déjà ouvert par un autre processus.",
            );
        }
        this.run("INSERT OR REPLACE INTO runtime_lease VALUES(1,?,?)", [
          process.pid,
          this.lease,
        ]);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
    if (bootstrapToken) {
      if (!/^[A-Za-z0-9_-]{43,100}$/.test(bootstrapToken))
        throw Error("Jeton administrateur initial invalide.");
      const count = this.get("SELECT COUNT(*) AS n FROM operators").n;
      if (!count)
        this.run("INSERT INTO operators VALUES(?,?,?,?,0)", [
          "owner",
          "Juno",
          hash(bootstrapToken),
          "admin",
        ]);
    }
  }
  get(sql, args = []) {
    return this.db.prepare(sql).get(...args);
  }
  all(sql, args = []) {
    return this.db.prepare(sql).all(...args);
  }
  run(sql, args = []) {
    return this.db.prepare(sql).run(...args);
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      if (result?.then) throw Error("Transaction synchrone requise.");
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  once(actor, key, payload, fn) {
    identifier(key);
    const digest = hash(JSON.stringify(payload));
    return this.transaction(() => {
      const previous = this.get(
        "SELECT * FROM requests WHERE actor_id=? AND key=?",
        [actor, key],
      );
      if (previous) {
        if (previous.payload_hash !== digest)
          fail(
            409,
            "Cette opération a déjà été utilisée pour une autre demande.",
          );
        return JSON.parse(previous.result);
      }
      const result = fn();
      this.run("INSERT INTO requests VALUES(?,?,?,?,?)", [
        actor,
        key,
        digest,
        JSON.stringify(result),
        Date.now(),
      ]);
      return result;
    });
  }
  operator(token) {
    if (!token || token.length > 100) fail(401, "Connexion à Juno requise.");
    const operator = this.get(
      "SELECT id,name,role FROM operators WHERE token_hash=? AND disabled=0",
      [hash(token)],
    );
    return operator || fail(401, "Connexion à Juno requise.");
  }
  project(operator, projectId) {
    const project = this.get("SELECT * FROM projects WHERE id=?", [
      identifier(projectId),
    ]);
    if (
      !project ||
      (operator.role !== "admin" &&
        project.owner !== operator.id &&
        !this.get(
          "SELECT 1 FROM members WHERE project_id=? AND operator_id=?",
          [projectId, operator.id],
        ))
    )
      fail(404, "Projet inaccessible.");
    return project;
  }
  delivery(operator, deliveryId) {
    const delivery = this.get("SELECT * FROM deliveries WHERE id=?", [
      identifier(deliveryId),
    ]);
    if (!delivery) fail(404, "Livraison introuvable.");
    this.project(operator, delivery.project_id);
    return delivery;
  }
  revision(operator, revisionId) {
    const revision = this.get("SELECT * FROM revisions WHERE id=?", [
      identifier(revisionId),
    ]);
    if (!revision) fail(404, "Version introuvable.");
    this.delivery(operator, revision.delivery_id);
    return revision;
  }
  asset(operator, assetId) {
    const asset = this.get("SELECT * FROM assets WHERE id=?", [
      identifier(assetId),
    ]);
    if (!asset) fail(404, "Média introuvable.");
    this.revision(operator, asset.revision_id);
    return asset;
  }
  share(shareId) {
    const share = this.get("SELECT * FROM shares WHERE id=?", [
      identifier(shareId),
    ]);
    if (
      !share ||
      share.revoked ||
      (share.expires && share.expires <= Date.now())
    )
      fail(404, "Ce lien est expiré ou indisponible.");
    const delivery = this.get("SELECT * FROM deliveries WHERE id=?", [
      share.delivery_id,
    ]);
    if (!delivery || delivery.archived)
      fail(404, "Ce lien est expiré ou indisponible.");
    return { share, delivery };
  }
  clientRevision(client, revisionId) {
    const revision = this.get("SELECT * FROM revisions WHERE id=?", [
      identifier(revisionId),
    ]);
    if (
      !revision ||
      revision.delivery_id !== client.delivery.id ||
      revision.state !== "published" ||
      (!client.share.all_versions &&
        revision.id !== client.delivery.active_revision)
    )
      fail(404, "Version inaccessible.");
    return revision;
  }
  clientAsset(client, assetId) {
    const asset = this.get("SELECT * FROM assets WHERE id=? AND state=?", [
      identifier(assetId),
      "ready",
    ]);
    if (!asset) fail(404, "Média inaccessible.");
    this.clientRevision(client, asset.revision_id);
    return asset;
  }
  event(delivery, actor, kind, payload) {
    this.run(
      "INSERT INTO events(delivery_id,actor_id,kind,payload,created) VALUES(?,?,?,?,?)",
      [delivery, actor, kind, JSON.stringify(payload), Date.now()],
    );
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.run("DELETE FROM runtime_lease WHERE id=1 AND token=?", [this.lease]);
    this.db.close();
  }
}

export function publicAsset(asset) {
  const m = JSON.parse(asset.metadata);
  return {
    id: asset.id,
    logicalId: asset.logical_id,
    revisionId: asset.revision_id,
    kind: asset.kind,
    name: asset.name,
    mime: asset.mime,
    size: asset.size,
    width: m.width,
    height: m.height,
    fps: m.fps,
    frames: m.frames,
    duration: m.duration,
    thumbnail: asset.thumbnail_size > 0,
    position: asset.position,
  };
}

export function validateAnchor(value, asset) {
  const anchor = value || {};
  if (typeof anchor !== "object" || Array.isArray(anchor))
    fail(400, "Annotation invalide.");
  const out = {};
  if (anchor.point != null) {
    const p = anchor.point;
    if (
      !asset ||
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < 0 ||
      p.x > 1 ||
      p.y < 0 ||
      p.y > 1
    )
      fail(400, "Repère hors de l’image.");
    out.point = { x: p.x, y: p.y };
    if (p.w != null || p.h != null) {
      if (
        ![p.w, p.h].every((x) => Number.isFinite(x) && x > 0) ||
        p.x + p.w > 1.000001 ||
        p.y + p.h > 1.000001
      )
        fail(400, "Zone hors de l’image.");
      Object.assign(out.point, { w: p.w, h: p.h });
    }
  }
  if (anchor.frame != null) {
    if (asset?.kind !== "video") fail(400, "Le timecode nécessite une vidéo.");
    const metadata = JSON.parse(asset.metadata);
    out.frame = integer(anchor.frame, 0, metadata.frames - 1, "Image");
    out.pts = (out.frame * metadata.fps.d) / metadata.fps.n;
    if (anchor.endFrame != null)
      out.endFrame = integer(
        anchor.endFrame,
        out.frame + 1,
        metadata.frames,
        "Fin de plage",
      );
  }
  if (anchor.endFrame != null && out.frame == null)
    fail(400, "Début de plage requis.");
  return out;
}
