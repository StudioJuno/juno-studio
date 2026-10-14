const fs = require("node:fs/promises"),
  M = require("./model.cjs");
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODELS = ["veo-3.1-fast-generate-preview", "veo-3.1-generate-preview"];
function validate(input) {
  M.text(input.prompt, 4000);
  if (input.prompt.trim().length < 5) throw Error("Décrivez le plan à générer");
  if (
    !MODELS.includes(input.model) ||
    !["16:9", "9:16"].includes(input.aspect) ||
    !["720p", "1080p"].includes(input.resolution)
  )
    throw Error("Paramètres de génération invalides");
  return {
    prompt: input.prompt.trim(),
    model: input.model,
    aspect: input.aspect,
    resolution: input.resolution,
    duration: 8,
  };
}
function operationPath(name) {
  if (
    typeof name !== "string" ||
    !/^(?:models\/[a-zA-Z0-9._-]+\/)?operations\/[a-zA-Z0-9._-]+$/.test(name)
  )
    throw Error("Identifiant de génération invalide");
  return name;
}
function downloadURL(uri) {
  const u = new URL(uri);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    !(
      u.hostname === "generativelanguage.googleapis.com" ||
      u.hostname === "storage.googleapis.com" ||
      u.hostname.endsWith(".googleusercontent.com")
    )
  )
    throw Error("Adresse de vidéo non autorisée");
  return u;
}
class VeoProvider {
  constructor(key, fetchImpl = fetch) {
    this.key = key;
    this.fetch = fetchImpl;
  }
  async request(route, options, signal) {
    const response = await this.fetch(BASE + "/" + route, {
      ...options,
      headers: {
        "x-goog-api-key": this.key,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90000)])
        : AbortSignal.timeout(90000),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error("Réponse du fournisseur illisible");
    }
    if (!response.ok) {
      const e = Error(
        "Google : " +
          String(data.error?.message || response.status)
            .replaceAll(this.key, "[clé masquée]")
            .slice(0, 1200),
      );
      e.httpStatus = response.status;
      throw e;
    }
    return data;
  }
  async submit(input, signal) {
    const r = validate(input);
    const result = await this.request(
      "models/" + r.model + ":predictLongRunning",
      {
        method: "POST",
        body: JSON.stringify({
          instances: [{ prompt: r.prompt }],
          parameters: {
            aspectRatio: r.aspect,
            resolution: r.resolution,
            durationSeconds: 8,
            sampleCount: 1,
          },
        }),
      },
      signal,
    );
    return operationPath(result.name);
  }
  async poll(name, signal) {
    return this.request(operationPath(name), { method: "GET" }, signal);
  }
  async download(uri, file, signal) {
    let url = downloadURL(uri);
    for (let i = 0; i < 6; i++) {
      const response = await this.fetch(url.href, {
        headers:
          url.hostname === "generativelanguage.googleapis.com"
            ? { "x-goog-api-key": this.key }
            : {},
        redirect: "manual",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
          : AbortSignal.timeout(120000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        url = downloadURL(new URL(response.headers.get("location"), url).href);
        continue;
      }
      if (!response.ok || !response.body)
        throw Error("Téléchargement vidéo refusé par le fournisseur");
      if (Number(response.headers.get("content-length")) > 500e6)
        throw Error("Vidéo générée trop volumineuse");
      const handle = await fs.open(file, "w", 0o600);
      let bytes = 0;
      try {
        for await (const chunk of response.body) {
          bytes += chunk.length;
          if (bytes > 500e6) throw Error("Vidéo générée trop volumineuse");
          await handle.write(chunk);
        }
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (bytes < 32) throw Error("Vidéo générée vide");
      return;
    }
    throw Error("Trop de redirections du fournisseur");
  }
}
module.exports = { VeoProvider, MODELS, validate, operationPath, downloadURL };
