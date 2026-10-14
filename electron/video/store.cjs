const { writeJsonAtomic } = require("../atomic.cjs");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
class VideoStore {
  constructor(root) {
    this.root = root;
    this.pending = Promise.resolve();
    this.data = { schema: 1, projects: [], media: {}, jobs: [], luts: {} };
  }
  async init() {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const folder of ["cache", "history", "renders"])
      await fs.mkdir(path.join(this.root, folder), { recursive: true });
    try {
      const data = JSON.parse(
        await fs.readFile(path.join(this.root, "catalog.json"), "utf8"),
      );
      if (data.schema !== 1 || !Array.isArray(data.projects) || !data.media)
        throw Error("Catalogue vidéo incompatible");
      this.data = data;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    let changed = false;
    for (const job of this.data.jobs)
      if (["queued", "running"].includes(job.state)) {
        job.state = "interrupted";
        changed = true;
      }
    if (changed) await this.persist();
    return this;
  }
  async persist() {
    const task = async () => {
      await writeJsonAtomic(path.join(this.root, "catalog.json"), this.data);
    };
    this.pending = this.pending.catch(() => {}).then(task);
    await this.pending;
  }
  async mutate(fn) {
    const task = async () => {
      const next = structuredClone(this.data),
        result = await fn(next);
      await writeJsonAtomic(path.join(this.root, "catalog.json"), next);
      this.data = next;
      return result;
    };
    const work = this.pending.catch(() => {}).then(task);
    // The caller receives `work`'s error; the queue tail must never reject unobserved.
    this.pending = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  async history(p) {
    const folder = path.join(this.root, "history", p.id);
    await fs.mkdir(folder, { recursive: true });
    await writeJsonAtomic(
      path.join(folder, String(p.revision).padStart(10, "0") + ".json"),
      p,
    );
    const names = (await fs.readdir(folder))
      .filter((n) => /^\d+\.json$/.test(n))
      .sort();
    for (const name of names.slice(0, -30))
      await fs.unlink(path.join(folder, name));
  }
  project(id) {
    return this.data.projects.find((p) => p.id === id);
  }
  public(p) {
    return structuredClone(p);
  }
}
module.exports = { VideoStore };
