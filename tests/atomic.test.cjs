const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { writeJsonAtomic } = require("../electron/atomic.cjs"),
  { fingerprint, sha256 } = require("../electron/video/identity.cjs"),
  { VideoStore } = require("../electron/video/store.cjs");
test("failed atomic writes preserve the previous catalogue and clean temporary files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-atomic-"));
  try {
    const file = path.join(root, "catalog.json");
    await writeJsonAtomic(file, { revision: 1 });
    await assert.rejects(writeJsonAtomic(file, { invalid: 1n }));
    assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), {
      revision: 1,
    });
    const folder = path.join(root, "folder");
    await fs.mkdir(folder);
    await assert.rejects(writeJsonAtomic(folder, { revision: 2 }));
    assert.deepEqual((await fs.readdir(root)).sort(), [
      "catalog.json",
      "folder",
    ]);
    const store = await new VideoStore(path.join(root, "store")).init();
    await store.mutate((d) => d.projects.push({ id: "safe" }));
    const rename = fs.rename;
    fs.rename = async () => {
      throw Object.assign(Error("Disk full"), { code: "ENOSPC" });
    };
    try {
      await assert.rejects(
        store.mutate((d) => (d.projects = [])),
        /Disk full/,
      );
    } finally {
      fs.rename = rename;
    }
    assert.equal(store.data.projects[0].id, "safe");
    assert.equal(
      (await new VideoStore(store.root).init()).data.projects[0].id,
      "safe",
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("full source hashes detect alterations hidden between identical file ends", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-hash-"));
  try {
    const a = path.join(root, "a"),
      b = path.join(root, "b"),
      bytes = Buffer.alloc(4 * 1024 * 1024, 17);
    await fs.writeFile(a, bytes);
    bytes[2 * 1024 * 1024] = 18;
    await fs.writeFile(b, bytes);
    assert.equal(await fingerprint(a), await fingerprint(b));
    assert.notEqual(await sha256(a), await sha256(b));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
