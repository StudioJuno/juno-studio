// Envoie un paquet signé à Apple pour notarisation, puis agrafe le ticket.
// Sans ticket agrafé, un Mac hors ligne refuse toujours l'application.
//
// Les identifiants ne sont jamais écrits ici. Deux chemins possibles :
//   1. une clé API App Store Connect, décrite dans signing/notary.json ;
//   2. un profil déjà rangé dans le trousseau par « notarytool store-credentials ».
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { credentials, readConfig } from "./notarize-credentials.mjs";
const app = process.argv[2];
if (!app || !existsSync(app))
  throw Error("Usage : node scripts/notarize-mac.mjs <chemin/Juno Studio.app>");
const config = readConfig(),
  auth = credentials(config);
if (!auth) {
  console.error(
    [
      "Aucun identifiant de notarisation.",
      "Créez signing/notary.json en suivant NOTARISATION.md.",
      "Aucun mot de passe n'est nécessaire : une clé API suffit.",
    ].join("\n"),
  );
  process.exit(3);
}
const temp = mkdtempSync(path.join(os.tmpdir(), "juno-notary-"));
const archive = path.join(temp, "juno.zip");
try {
  console.log("Compression du paquet…");
  execFileSync("ditto", ["-c", "-k", "--keepParent", app, archive]);
  console.log("Envoi à Apple, avec attente du verdict (" + auth.source + ")…");
  /**
   * Un envoi de trois giga-octets se fait couper.
   *
   * Apple rend alors un « abortedUpload » brut, sans JSON. Ce n'est pas un
   * refus de notarisation mais une coupure de réseau : elle mérite d'être
   * retentée, pas rapportée comme une réponse illisible.
   */
  let verdict = {};
  let derniere = "";
  for (let essai = 1; essai <= 3; essai++) {
    const submit = spawnSync(
      "xcrun",
      ["notarytool", "submit", archive, ...auth.args, "--wait", "--output-format", "json"],
      { encoding: "utf8", maxBuffer: 32 << 20 },
    );
    const out = (submit.stdout || "").trim();
    derniere = (out || submit.stderr || "").slice(0, 400);
    try {
      verdict = JSON.parse(out.slice(out.indexOf("{")));
      break;
    } catch {
      const coupure = /abortedUpload|timed out|connection|network|EPIPE/i.test(derniere);
      if (!coupure || essai === 3)
        throw Error(
          (coupure
            ? "L'envoi à Apple a été coupé trois fois de suite. Relancez quand le réseau sera plus stable : "
            : "Réponse illisible d'Apple : ") + derniere,
        );
      console.log(`Envoi coupé, nouvelle tentative (${essai + 1} sur 3)…`);
    }
  }
  console.log(JSON.stringify(verdict, null, 2));
  if (verdict.status !== "Accepted") {
    // Le journal dit précisément quel binaire a été refusé.
    if (verdict.id)
      console.error(
        spawnSync("xcrun", ["notarytool", "log", verdict.id, ...auth.args], {
          encoding: "utf8",
        }).stdout,
      );
    throw Error("Notarisation refusée : " + verdict.status);
  }
  console.log("Agrafage du ticket…");
  execFileSync("xcrun", ["stapler", "staple", app], { stdio: "inherit" });
  const gate = spawnSync("spctl", ["-a", "-vvv", "-t", "install", app], {
    encoding: "utf8",
  });
  console.log((gate.stderr || gate.stdout || "").trim());
  if (!/accepted/i.test(gate.stderr + gate.stdout))
    throw Error("Gatekeeper refuse encore le paquet.");
  console.log("Notarisé, agrafé, accepté par Gatekeeper.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
