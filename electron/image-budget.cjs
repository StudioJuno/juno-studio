const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
// Conservative reservations, not a provider invoice or exchange-rate promise.
// An ambiguous network failure keeps its reservation to prevent paid retries.
class ImageBudget {
  constructor(file) {
    this.file = file;
    this.queue = Promise.resolve();
  }
  validId(id) {
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9_-]{1,150}$/.test(id) ||
      ["__proto__", "prototype", "constructor"].includes(id)
    )
      throw Error("Projet requis pour suivre le budget IA.");
  }
  async read() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (
        data.version !== 1 ||
        !data.projects ||
        Array.isArray(data.projects) ||
        typeof data.projects !== "object"
      )
        throw Error("Structure invalide");
      for (const p of Object.values(data.projects))
        if (
          !p ||
          !Number.isSafeInteger(p.reservedCents) ||
          p.reservedCents < 0 ||
          !Array.isArray(p.attempts)
        )
          throw Error("Budget invalide");
      return data;
    } catch (e) {
      if (e.code === "ENOENT") return { version: 1, projects: {} };
      throw Error(
        "Le registre de budget IA est illisible. Aucun appel payant n’a été lancé. Restaurez ce registre avant de réessayer.",
      );
    }
  }
  async status(projectId) {
    this.validId(projectId);
    await this.queue;
    const data = await this.read();
    const cents = Object.hasOwn(data.projects, projectId)
      ? data.projects[projectId].reservedCents
      : 0;
    return {
      limitEuro: 5,
      reservedEuro: cents / 100,
      remainingEuro: Math.max(0, 500 - cents) / 100,
      nextReservationEuro: 1,
      canRun: cents + 100 <= 500,
    };
  }
  reserve(projectId, model) {
    this.validId(projectId);
    const next = this.queue.then(async () => {
      const data = await this.read(),
        p = Object.hasOwn(data.projects, projectId)
          ? data.projects[projectId]
          : { reservedCents: 0, attempts: [] };
      if (p.reservedCents + 100 > 500)
        throw Error(
          "Plafond IA de ce projet atteint (5 € de réservations). Aucun appel n’a été envoyé. Les réglages et la passe locale de l’album restent disponibles.",
        );
      const attempt = {
        id: randomUUID(),
        at: Date.now(),
        reservedCents: 100,
        model,
      };
      p.reservedCents += 100;
      p.attempts = [...p.attempts, attempt].slice(-100);
      data.projects[projectId] = p;
      const temp = this.file + "." + randomUUID() + ".tmp";
      try {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(temp, JSON.stringify(data), {
          mode: 0o600,
          flag: "wx",
        });
        await fs.rename(temp, this.file);
      } finally {
        await fs.rm(temp, { force: true });
      }
      return attempt;
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
module.exports = { ImageBudget };
