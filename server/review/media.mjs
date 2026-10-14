import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { fail, hash, integer, id } from "./store.mjs";

export async function body(req, maximum = 2 * 1024 * 1024) {
  if (Number(req.headers["content-length"]) > maximum)
    fail(413, "Envoi trop volumineux.");
  const parts = [];
  let total = 0;
  for await (const part of req) {
    total += part.length;
    if (total > maximum) fail(413, "Envoi trop volumineux.");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
export async function json(req, maximum) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    fail(415, "Format JSON requis.");
  try {
    const value = JSON.parse((await body(req, maximum)).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      fail(400, "Objet JSON requis.");
    return value;
  } catch (error) {
    if (error.status) throw error;
    fail(400, "Données illisibles.");
  }
}
export async function sha256(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
export class MediaStore {
  constructor(store) {
    this.store = store;
    this.root = path.join(store.root, "media");
    this.pending = new Map();
    this.active = 0;
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
  }
  file(asset, variant = "file") {
    return path.join(
      this.root,
      asset.id + (variant === "thumbnail" ? ".jpg" : ".media"),
    );
  }
  partial(asset) {
    return path.join(this.root, asset.id + ".upload");
  }
  async locked(key, action) {
    if (this.active >= 8)
      fail(
        429,
        "Plusieurs transferts sont en cours. Réessayez dans quelques secondes.",
      );
    if (this.pending.has(key))
      fail(409, "Ce média est déjà en cours de transfert.");
    this.pending.set(key, true);
    this.active++;
    try {
      return await action();
    } finally {
      this.pending.delete(key);
      this.active--;
    }
  }
  async upload(req, operator, assetId) {
    return this.locked(assetId, async () => {
      const asset = this.store.asset(operator, assetId),
        revision = this.store.revision(operator, asset.revision_id);
      if (revision.state !== "draft") fail(409, "Cette version est figée.");
      if (asset.state === "ready") return { received: asset.size, ready: true };
      const offset = integer(
        Number(req.headers["upload-offset"]),
        0,
        asset.size,
        "Position de reprise",
      );
      if (offset > asset.received)
        fail(409, "Reprenez à la position confirmée par le serveur.");
      const bytes = await body(req, 8 * 1024 * 1024);
      if (
        !bytes.length ||
        offset + bytes.length > asset.size ||
        req.headers["x-chunk-sha256"] !== hash(bytes)
      )
        fail(400, "Le contrôle du morceau envoyé a échoué.");
      const partial = this.partial(asset);
      if (offset < asset.received) {
        if (offset + bytes.length > asset.received)
          fail(409, "Morceau déjà reçu en partie. Actualisez la reprise.");
        const handle = await fs.open(partial, "r");
        try {
          const previous = Buffer.alloc(bytes.length);
          const read = await handle.read(previous, 0, bytes.length, offset);
          if (read.bytesRead !== bytes.length || hash(previous) !== hash(bytes))
            fail(409, "Ce morceau diffère de celui déjà reçu.");
        } finally {
          await handle.close();
        }
        return { received: asset.received, ready: false };
      }
      const disk = await fs.statfs(this.root);
      if (disk.bavail * disk.bsize < bytes.length + 64 * 1024 * 1024)
        fail(507, "Le stockage de relecture est plein.");
      const handle = await fs.open(partial, "a+", 0o600);
      try {
        const stat = await handle.stat();
        if (stat.size < asset.received)
          fail(
            409,
            "Le transfert doit être réinitialisé : un morceau enregistré manque.",
          );
        await handle.truncate(asset.received);
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      this.store.run("UPDATE assets SET received=? WHERE id=?", [
        offset + bytes.length,
        asset.id,
      ]);
      return { received: offset + bytes.length, ready: false };
    });
  }
  async finish(operator, assetId) {
    return this.locked(assetId, async () => {
      const asset = this.store.asset(operator, assetId);
      if (asset.state === "ready") return { ready: true };
      if (this.store.revision(operator, asset.revision_id).state !== "draft")
        fail(409, "Version figée.");
      if (asset.received !== asset.size)
        fail(409, "Le transfert de ce média est incomplet.");
      const final = this.file(asset),
        partial = this.partial(asset);
      const file = await fs.access(partial).then(
        () => partial,
        () => final,
      );
      if (
        (await fs.stat(file)).size !== asset.size ||
        (await sha256(file)) !== asset.sha256
      )
        fail(
          422,
          "Le fichier reçu est différent du rendu attendu. Réinitialisez son transfert.",
        );
      const handle = await fs.open(file, "r"),
        first = Buffer.alloc(32);
      try {
        await handle.read(first, 0, 32, 0);
      } finally {
        await handle.close();
      }
      const valid =
        asset.mime === "image/jpeg"
          ? first[0] === 255 && first[1] === 216 && first[2] === 255
          : asset.mime === "image/png"
            ? first
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : asset.mime === "video/mp4" &&
              first.subarray(4, 8).toString() === "ftyp";
      if (!valid)
        fail(415, "Ce fichier n’est pas un rendu de relecture compatible.");
      if (file !== final) await fs.rename(file, final);
      this.store.run("UPDATE assets SET state=? WHERE id=?", [
        "ready",
        asset.id,
      ]);
      return { ready: true };
    });
  }
  async thumbnail(req, operator, assetId) {
    return this.locked(assetId, async () => {
      const asset = this.store.asset(operator, assetId);
      if (this.store.revision(operator, asset.revision_id).state !== "draft")
        fail(409, "Version figée.");
      const data = await body(req, 256 * 1024);
      if (
        data.length < 4 ||
        data[0] !== 255 ||
        data[1] !== 216 ||
        data[2] !== 255
      )
        fail(415, "Miniature JPEG requise.");
      const destination = this.file(asset, "thumbnail");
      if (asset.thumbnail_size) {
        if ((await sha256(destination)) !== hash(data))
          fail(409, "La miniature existe déjà.");
        return { ready: true };
      }
      const temp = destination + "." + id();
      try {
        await fs.writeFile(temp, data, { mode: 0o600, flag: "wx" });
        await fs.rename(temp, destination);
      } finally {
        await fs.unlink(temp).catch(() => {});
      }
      this.store.run("UPDATE assets SET thumbnail_size=? WHERE id=?", [
        data.length,
        asset.id,
      ]);
      return { ready: true };
    });
  }
  async reset(operator, assetId) {
    return this.locked(assetId, async () => {
      const asset = this.store.asset(operator, assetId);
      if (
        this.store.revision(operator, asset.revision_id).state !== "draft" ||
        asset.state === "ready"
      )
        fail(409, "Ce rendu est déjà vérifié. Créez une autre version.");
      await fs.unlink(this.partial(asset)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      this.store.run("UPDATE assets SET received=0 WHERE id=?", [asset.id]);
      return { received: 0 };
    });
  }
  async stream(req, res, asset, variant, download = false) {
    const file = this.file(asset, variant),
      stat = await fs
        .stat(file)
        .catch(() => fail(404, "Le rendu n’est plus disponible."));
    const headers = {
      "Content-Type": variant === "thumbnail" ? "image/jpeg" : asset.mime,
      "Cache-Control": "private, no-store",
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    };
    if (download)
      headers["Content-Disposition"] =
        "attachment; filename*=UTF-8''" +
        encodeURIComponent(asset.name.replace(/[\r\n]/g, ""));
    let start = 0,
      end = stat.size - 1,
      status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!match || (!match[1] && !match[2])) {
        res.writeHead(416, {
          ...headers,
          "Content-Range": "bytes */" + stat.size,
        });
        res.end();
        return;
      }
      start = match[1]
        ? Number(match[1])
        : Math.max(0, stat.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= stat.size
      ) {
        res.writeHead(416, {
          ...headers,
          "Content-Range": "bytes */" + stat.size,
        });
        res.end();
        return;
      }
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
    }
    res.writeHead(status, { ...headers, "Content-Length": end - start + 1 });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    await pipeline(createReadStream(file, { start, end }), res).catch(
      (error) => {
        if (!req.destroyed && error.code !== "ERR_STREAM_PREMATURE_CLOSE")
          throw error;
      },
    );
  }
}
