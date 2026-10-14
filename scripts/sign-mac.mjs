// Signe un paquet macOS avec le certificat Developer ID, puis vérifie que
// chaque binaire du paquet est réellement couvert. Sans cette signature,
// macOS refuse d'ouvrir Juno sur l'ordinateur d'un autre photographe.
//
// À lancer APRÈS makeNativeLinksPortable : la réécriture des chemins de
// bibliothèques invalide toute signature posée avant elle.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { sign } from "@electron/osx-sign";
// codesign écrit son rapport sur la sortie d'erreur : elle est capturée,
// jamais laissée fuir dans le journal de construction.
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 64 << 20,
    stdio: ["ignore", "pipe", "pipe"],
  });
/**
 * Le certificat de diffusion hors App Store parmi ceux du trousseau.
 * « Apple Distribution » ne convient pas : il ne vaut que pour l'App Store.
 */
export function parseIdentity(securityOutput) {
  const line = String(securityOutput)
    .split("\n")
    .find((l) => l.includes("Developer ID Application"));
  return line?.match(/"([^"]+)"/)?.[1];
}
export function developerIdIdentity() {
  try {
    return parseIdentity(run("security", ["find-identity", "-v", "-p", "codesigning"]));
  } catch {
    return undefined;
  }
}
/** Tous les fichiers Mach-O du paquet, y compris les ressources natives. */
export function machOFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const size = statSync(full).size;
      if (size < 4) continue;
      let kind = "";
      try {
        kind = run("file", ["-b", full]);
      } catch {
        continue;
      }
      if (kind.includes("Mach-O")) found.push(full);
    }
  };
  walk(root);
  return found;
}
/**
 * Lit un rapport codesign. Un binaire n'est conforme que s'il porte à la fois
 * le certificat de diffusion ET l'exécution durcie : Apple refuse sans les deux.
 */
export function parseSignature(out) {
  const text = String(out);
  if (!text.includes("CodeDirectory")) return { signed: false };
  const authority =
    text.match(/Authority=([^\n]+)/)?.[1] ??
    (/Signature=adhoc/.test(text) ? "ad hoc" : "");
  // codesign écrit « flags=0x10000(runtime) » : le nom est entre parenthèses,
  // et le bit 0x10000 est CS_RUNTIME. On lit les deux, le drapeau fait foi.
  const flags = text.match(/CodeDirectory v=[^\n]*flags=(\S+)/)?.[1] ?? "";
  const bits = Number.parseInt(flags.match(/^0x([0-9a-f]+)/i)?.[1] ?? "0", 16);
  return {
    signed: true,
    authority: authority.trim(),
    developerId: authority.includes("Developer ID Application"),
    hardened: (bits & 0x10000) !== 0 || /\(.*runtime.*\)/.test(flags),
  };
}
export function inspect(file) {
  // Le détail part sur la sortie d'erreur même lorsque la commande réussit.
  const child = spawnSync("codesign", ["-dv", "--verbose=4", file], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  return {
    file,
    ...parseSignature(String(child.stdout || "") + String(child.stderr || "")),
  };
}
/**
 * Rendre le paquet signable.
 *
 * codesign refuse tout fichier portant des métadonnées parasites : « resource
 * fork, Finder information, or similar detritus not allowed ». Deux sources,
 * et il a fallu les traiter différemment.
 *
 * `xattr -cr` retire ce que le Finder pose en ouvrant un dossier. Il ne peut
 * rien contre `com.apple.provenance`, que macOS applique aux fichiers issus du
 * cache d'Electron et qu'aucune commande d'espace utilisateur n'efface.
 *
 * L'observation qui débloque : après un aller-retour par `ditto`, codesign
 * accepte le paquet **bien que l'attribut soit toujours là**, alors qu'il le
 * refuse après un `cp -R`. Ce n'est donc pas l'attribut lui-même qui gêne,
 * mais quelque chose que `ditto` normalise et que `cp` recopie. Mesuré sur ce
 * paquet le 24 septembre 2026 : ditto et tar passent, cp échoue.
 */
export function stripExtendedAttributes(app) {
  execFileSync("xattr", ["-cr", app], { stdio: ["ignore", "pipe", "pipe"] });
  const propre = app + ".ditto";
  execFileSync("rm", ["-rf", propre], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("ditto", ["--norsrc", "--noextattr", "--noacl", app, propre], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  execFileSync("rm", ["-rf", app], { stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("mv", [propre, app], { stdio: ["ignore", "pipe", "pipe"] });
}
export async function signBundle(app, identity) {
  stripExtendedAttributes(app);
  await sign({
    app,
    identity,
    platform: "darwin",
    hardenedRuntime: true,
    // L'horodatage passe par le serveur d'Apple par défaut : Apple refuse
    // une application notarisée qui n'en porte pas.
    optionsForFile: (file) => ({
      hardenedRuntime: true,
      entitlements: /Helper|Frameworks/.test(file)
        ? "build/entitlements.mac.inherit.plist"
        : "build/entitlements.mac.plist",
    }),
  });
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const app = process.argv[2];
  if (!app || !existsSync(app))
    throw Error("Usage : node scripts/sign-mac.mjs <chemin/Juno Studio.app>");
  const identity = developerIdIdentity();
  if (!identity) {
    console.error(
      [
        "Aucun certificat « Developer ID Application » dans le trousseau.",
        "Le paquet restera signé ad hoc et macOS le refusera ailleurs.",
        "La marche à suivre est dans NOTARISATION.md.",
      ].join("\n"),
    );
    process.exit(3);
  }
  console.log("Signature avec : " + identity);
  await signBundle(app, identity);
  const files = machOFiles(app).map(inspect);
  const manquants = files.filter((f) => !f.signed || !f.developerId),
    mous = files.filter((f) => f.signed && f.developerId && !f.hardened);
  // La vérification d'Apple, celle qui décidera à la notarisation.
  let verdict = "";
  const check = spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", app],
    { encoding: "utf8", maxBuffer: 64 << 20 },
  );
  verdict =
    check.status === 0
      ? "codesign --verify --deep --strict : conforme"
      : "ÉCHEC : " + String(check.stderr || "").slice(0, 400);
  console.log(
    JSON.stringify(
      {
        binaires: files.length,
        signesDeveloperId: files.length - manquants.length,
        sansExecutionDurcie: mous.length,
        manquants: manquants.map((f) => path.basename(f.file)).slice(0, 10),
        verdict,
      },
      null,
      2,
    ),
  );
  if (manquants.length || mous.length || verdict.startsWith("ÉCHEC"))
    process.exit(1);
}
