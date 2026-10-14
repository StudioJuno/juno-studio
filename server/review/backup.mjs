import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { ReviewStore } from "./store.mjs";
import { sha256 } from "./media.mjs";

/** Cold backup: acquires the same exclusive lease as the service. Never copies a running database. */
export async function backupReview(source, destination) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  if (destination === source || destination.startsWith(source + path.sep))
    throw Error("La sauvegarde doit être hors du dossier du portail.");
  await fs.access(path.join(source, "review.sqlite"));
  const store = new ReviewStore(source);
  try {
    await fs.mkdir(destination, { mode: 0o700 });
    store.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    await fs.copyFile(
      path.join(source, "review.sqlite"),
      path.join(destination, "review.sqlite"),
    );
    const copy = new DatabaseSync(path.join(destination, "review.sqlite"));
    try {
      copy.exec("DELETE FROM runtime_lease; PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      copy.close();
    }
    await fs.cp(path.join(source, "media"), path.join(destination, "media"), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const files = [
      "review.sqlite",
      ...(await fs.readdir(path.join(destination, "media"))).map(
        (name) => "media/" + name,
      ),
    ];
    const manifest = {
      schema: 1,
      created: new Date().toISOString(),
      files: [],
    };
    for (const file of files) {
      const full = path.join(destination, file),
        stat = await fs.lstat(full);
      if (!stat.isFile())
        throw Error("Fichier inattendu dans le stockage de relecture.");
      manifest.files.push({
        path: file,
        size: stat.size,
        sha256: await sha256(full),
      });
    }
    await fs.writeFile(
      path.join(destination, "backup.json"),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600, flag: "wx" },
    );
    return {
      files: files.length,
      bytes: manifest.files.reduce((n, f) => n + f.size, 0),
    };
  } finally {
    store.close();
  }
}
export async function restoreReview(source, destination) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  const manifest = JSON.parse(
    await fs.readFile(path.join(source, "backup.json"), "utf8"),
  );
  if (
    manifest.schema !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.some((f) => f.path === "review.sqlite")
  )
    throw Error("Sauvegarde invalide.");
  for (const file of manifest.files) {
    if (
      !/^(review\.sqlite|media\/[A-Za-z0-9_-]+\.(media|jpg|upload))$/.test(
        file.path,
      )
    )
      throw Error("Chemin de sauvegarde invalide.");
    const full = path.join(source, file.path),
      stat = await fs.lstat(full);
    if (
      !stat.isFile() ||
      stat.size !== file.size ||
      (await sha256(full)) !== file.sha256
    )
      throw Error("Sauvegarde altérée : " + file.path);
  }
  await fs.mkdir(destination, { mode: 0o700 });
  await fs.mkdir(path.join(destination, "media"), { mode: 0o700 });
  for (const file of manifest.files)
    await fs.copyFile(
      path.join(source, file.path),
      path.join(destination, file.path),
      fs.constants.COPYFILE_EXCL,
    );
  const db = new DatabaseSync(path.join(destination, "review.sqlite"));
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw Error("La base restaurée est endommagée.");
  } finally {
    db.close();
  }
  return { files: manifest.files.length };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.umask(0o077);
  const [action, source, destination] = process.argv.slice(2);
  if (!["backup", "restore"].includes(action) || !source || !destination)
    throw Error(
      "Usage : node backup.mjs backup|restore DOSSIER_SOURCE NOUVEAU_DOSSIER_DESTINATION. Arrêtez le portail avant backup.",
    );
  console.log(
    JSON.stringify(
      await (action === "backup" ? backupReview : restoreReview)(
        source,
        destination,
      ),
    ),
  );
}
