// Les identifiants de notarisation, isolés pour être testés sans rien envoyer.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
const CONFIG = path.resolve("signing/notary.json");
/** Les arguments d'authentification de notarytool, sans jamais lire de secret. */
export function credentials(config) {
  if (config?.keychainProfile)
    return { args: ["--keychain-profile", config.keychainProfile], source: "trousseau" };
  if (config?.keyPath && config?.keyId && config?.issuer) {
    if (!existsSync(config.keyPath))
      throw Error("Clé API introuvable : " + config.keyPath);
    return {
      args: [
        "--key", config.keyPath,
        "--key-id", config.keyId,
        "--issuer", config.issuer,
      ],
      source: "clé API App Store Connect",
    };
  }
  return undefined;
}
export function readConfig() {
  if (!existsSync(CONFIG)) return undefined;
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch (e) {
    throw Error("signing/notary.json est illisible : " + e.message);
  }
}
