const fs = require("node:fs/promises"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
function registerVoice({ handle, app, engine }) {
  let active = null;
  const temporaryRoot = path.join(app.getPath("userData"), "Voice temporary");
  const cleanup = fs
    .rm(temporaryRoot, { recursive: true, force: true })
    .catch(() => {});
  handle("voice-status", () => ({
    available: !!engine?.status.transcription,
    local: true,
    maxSeconds: 45,
    error: engine?.status.transcriptionError || "",
  }));
  handle("voice-cancel", () => {
    active?.controller.abort();
    return true;
  });
  handle("voice-transcribe", async (input) => {
    if (!engine?.status.transcription)
      throw Error("Le moteur vocal local n’est pas disponible sur ce poste.");
    if (active) throw Error("Une commande vocale est déjà en cours d’analyse.");
    if (
      !(input?.bytes instanceof ArrayBuffer) &&
      !ArrayBuffer.isView(input?.bytes)
    )
      throw Error("Enregistrement vocal invalide.");
    const bytes = Buffer.from(
      input.bytes instanceof ArrayBuffer ? input.bytes : input.bytes.buffer,
      input.bytes.byteOffset || 0,
      input.bytes.byteLength,
    );
    if (bytes.length < 100 || bytes.length > 12 * 1024 * 1024)
      throw Error(
        "Enregistrement trop court ou trop volumineux (12 Mo maximum).",
      );
    const folder = path.join(temporaryRoot, randomUUID());
    const controller = new AbortController();
    active = { controller };
    try {
      await cleanup;
      await fs.mkdir(folder, { recursive: true, mode: 0o700 });
      const source = path.join(folder, "capture.webm"),
        wav = path.join(folder, "voice.wav"),
        base = path.join(folder, "result");
      await fs.writeFile(source, bytes, { mode: 0o600 });
      await engine.ff(
        [
          "-y",
          "-i",
          source,
          "-t",
          "46",
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          wav,
        ],
        { signal: controller.signal, timeout: 60000 },
      );
      const pcm = await fs.readFile(wav);
      let energy = 0,
        samples = 0;
      for (let i = 80; i + 1 < pcm.length; i += 2) {
        energy += (pcm.readInt16LE(i) / 32768) ** 2;
        samples++;
      }
      if (!samples || Math.sqrt(energy / samples) < 0.001)
        throw Error(
          "Aucune parole audible. Vérifiez le microphone et recommencez.",
        );
      await engine.run(
        engine.whisper,
        [
          "-m",
          engine.whisperModel,
          "-f",
          wav,
          "-l",
          "fr",
          "-t",
          "4",
          "-oj",
          "-of",
          base,
          "-np",
        ],
        { signal: controller.signal, timeout: 120000 },
      );
      const result = JSON.parse(await fs.readFile(base + ".json", "utf8"));
      const text = (result.transcription || [])
        .map((s) => String(s.text || "").trim())
        .join(" ")
        .trim();
      if (!text || /^\s*(?:\[.*\]|\(.*\))\s*$/.test(text))
        throw Error(
          "La parole n’a pas été reconnue. Vous pouvez aussi écrire la consigne.",
        );
      if (text.length > 6000)
        throw Error("La consigne reconnue est trop longue.");
      return { text, local: true, model: path.basename(engine.whisperModel, ".bin").replace(/^ggml-/, "whisper-") };
    } finally {
      active = null;
      await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
    }
  });
  // « will-quit » et non « before-quit » : before-quit part AVANT que la
  // fenêtre demande « Rester / Quitter quand même », et « Rester » laissait
  // l'application ouverte mais déjà à moitié arrêtée (relecture du 29/09/2026).
  app.on("will-quit", () => active?.controller.abort());
}
module.exports = { registerVoice };
