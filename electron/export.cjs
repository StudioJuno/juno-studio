const { writeJsonAtomic } = require("./atomic.cjs");
const fs = require("node:fs/promises"),
  { createReadStream } = require("node:fs"),
  path = require("node:path"),
  { randomUUID, createHash } = require("node:crypto");
/** Le plus gros fichier qu'un export écrit : la restauration lit jusque-là. */
const PLAFOND_EXPORT = 1024 ** 3;
/**
 * Publier le temporaire sous son nom final, sans jamais écraser un fichier du
 * même nom. Le lien dur le fait en une opération ; exFAT et FAT32 (disques
 * externes, clés USB) ne connaissent pas les liens et répondaient ENOTSUP :
 * l'export et le catalogue de sauvegarde échouaient, il restait un dossier
 * d'originaux sans catalogue. On renomme alors le temporaire, atomique lui
 * aussi, une fois la cible vérifiée absente ; l'appelant fait passer les
 * écritures d'une même cible une par une, pour qu'aucune ne se glisse entre la
 * vérification et le renommage.
 */
async function publier(temp, target) {
  try {
    await fs.link(temp, target);
    return;
  } catch (e) {
    if (e.code === "EEXIST") throw e;
  }
  try {
    await fs.lstat(target);
    throw Object.assign(Error("Un autre fichier existe déjà."), {
      code: "EEXIST",
    });
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await fs.rename(temp, target);
}
async function registerExports({ handle, app, dialog, getWindow }) {
  const registry = path.join(app.getPath("userData"), "export-folders.json"),
    dirs = new Map(),
    finished = new Map();
  try {
    for (const entry of JSON.parse(await fs.readFile(registry, "utf8"))) {
      if (
        typeof entry.token === "string" &&
        /^[a-f0-9-]{36}$/.test(entry.token) &&
        typeof entry.folder === "string" &&
        path.isAbsolute(entry.folder)
      ) {
        dirs.set(entry.token, entry.folder);
        if (entry.finished) finished.set(entry.token, entry.finished);
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT")
      throw Error(
        "Le registre des exports ne peut pas être lu. Conservez-le et contactez l’assistance.",
      );
  }
  let writing = Promise.resolve();
  const enCours = new Map();
  function persist() {
    writing = writing
      .catch(() => {})
      .then(async () => {
        await writeJsonAtomic(
          registry,
          [...dirs].map(([token, folder]) => ({
            token,
            folder,
            finished: finished.get(token),
          })),
        );
      });
    return writing;
  }
  handle("begin-export", async () => {
    const r = await dialog.showOpenDialog(getWindow(), {
      title: "Choisir le dossier de livraison",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled) return null;
    const token = randomUUID(),
      folder = path.join(
        r.filePaths[0],
        "Juno-" + new Date().toISOString().replace(/[:.]/g, "-"),
      );
    await fs.mkdir(folder);
    dirs.set(token, folder);
    await persist();
    return token;
  });
  handle("write-export", async (token, name, data) => {
    const folder = dirs.get(token);
    if (
      !folder ||
      typeof name !== "string" ||
      !name ||
      name !== path.basename(name) ||
      name === "." ||
      name === ".." ||
      !(data instanceof ArrayBuffer) ||
      data.byteLength > PLAFOND_EXPORT
    )
      throw Error("Export invalide.");
    const target = path.join(folder, name),
      temp = path.join(folder, ".juno-" + randomUUID() + ".tmp"),
      bytes = Buffer.from(data);
    async function identical() {
      const stat = await fs.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== bytes.length)
        return false;
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(target)) hash.update(chunk);
      return (
        hash.digest("hex") === createHash("sha256").update(bytes).digest("hex")
      );
    }
    const precedente = enCours.get(target) || Promise.resolve();
    const ecriture = precedente
      .catch(() => {})
      .then(async () => {
        try {
          await fs.lstat(target);
          if (await identical()) return;
          throw Error("Un autre fichier existe déjà : " + name);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
        try {
          // Écrit et synchronisé avant d'être publié : après une coupure, le
          // fichier final est complet ou absent, jamais tronqué.
          const h = await fs.open(temp, "wx");
          try {
            await h.writeFile(bytes);
            await h.sync();
          } finally {
            await h.close();
          }
          try {
            await publier(temp, target);
          } catch (e) {
            if (e.code !== "EEXIST" || !(await identical())) throw e;
          }
        } finally {
          await fs.unlink(temp).catch(() => {});
        }
      });
    enCours.set(target, ecriture);
    try {
      await ecriture;
    } finally {
      if (enCours.get(target) === ecriture) enCours.delete(target);
    }
  });
  // Retain grants for crash recovery. Every resumed write is identical or refused.
  handle("finish-export", async (token) => {
    if (dirs.has(token)) {
      finished.set(token, Date.now());
      await persist();
    }
  });
  return dirs;
}
module.exports = { registerExports, PLAFOND_EXPORT };
