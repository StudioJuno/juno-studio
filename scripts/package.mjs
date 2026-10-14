import { readFileSync, existsSync } from "node:fs";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { packager } from "@electron/packager";
import { makeNativeLinksPortable } from "./portable-links.mjs";
import { developerIdIdentity, signBundle } from "./sign-mac.mjs";
const version = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
).version;
const platform = process.argv[2] || process.platform,
  arch = process.argv[3] || process.arch;
const native = path.resolve("native", platform + "-" + arch);
for (const file of [
  path.join(native, "ffmpeg" + (platform === "win32" ? ".exe" : "")),
  path.join(native, "ffprobe" + (platform === "win32" ? ".exe" : "")),
  path.resolve("native/models/ggml-small.bin"),
  path.resolve("native/models/whisper-small-provenance.json"),
  path.resolve("native/models/juno-voice.rnnn"),
  path.resolve("native/models/JUNO-VOICE-NOTICE.txt"),
  path.join(
    native,
    "llama",
    "llama-server" + (platform === "win32" ? ".exe" : ""),
  ),
])
  if (!existsSync(file)) throw Error("Dépendance native absente : " + file);
if (!existsSync(path.resolve("server/review/public/index.html")))
  throw Error(
    "Construisez le portail avec npm run build:review avant le packaging.",
  );
/**
 * Les modèles embarqués, sans le modèle de langue.
 *
 * Il pesait 2,5 Go, soit 70 % de l'application, pour ne servir que lorsque le
 * lecteur de consignes ne comprend pas une phrase. Il se télécharge
 * maintenant à la demande, depuis le pilote. Le dossier garde le nom `models` :
 * c'est sous ce nom que l'application le cherche.
 */
const modeles = path.join(
  os.tmpdir(),
  `juno-models-${platform}-${arch}`,
  "models",
);
await fs.rm(path.dirname(modeles), { recursive: true, force: true });
await fs.cp(path.resolve("native/models"), modeles, {
  recursive: true,
  filter: (source) => !/\.(gguf|partiel)$/.test(source) && !["ggml-base.bin", "whisper-provenance.json"].includes(path.basename(source)),
});
const result = await packager({
  dir: ".",
  name: "Juno Studio",
  platform,
  arch,
  out: "release/v" + version,
  tmpdir: path.join(os.tmpdir(), "juno-build-" + platform + "-" + arch),
  overwrite: true,
  asar: true,
  extraResource: [
    native,
    modeles,
    path.resolve("public/video-color"),
    path.resolve("licenses"),
    path.resolve("server/review"),
  ],
  prune: false,
  icon: platform === "win32" ? "public/juno.ico" : "public/juno.icns",
  ignore: [
    /^\/(?!dist(?:\/|$)|electron(?:\/|$)|licenses(?:\/|$)|package\.json$|MISES-A-JOUR\.md$|GUIDE-V150\.md$|VALIDATION-V150\.md$|GUIDE-V141\.md$|VALIDATION-V141\.md$|GUIDE-V02\.md$|GUIDE-V03\.md$|GUIDE-V04\.md$|GUIDE-V041\.md$|GUIDE-V050\.md$|GUIDE-V071\.md$|VALIDATION-V071\.md$|GUIDE-V070\.md$|VALIDATION-V070\.md$|GUIDE-V060\.md$|VALIDATION-V060\.md$|VALIDATION-V050\.md$|THIRD-PARTY-AI-FIRST\.md$|GUIDE-V044\.md$|VALIDATION-V044\.md$|GUIDE-V043\.md$|VALIDATION-V043\.md$|AUDIT-V043\.md$|GUIDE-V042\.md$|VALIDATION-V042\.md$|VALIDATION-V041\.md$|VALIDATION-V04\.md$|THIRD-PARTY-VIDEO\.md$|INSTALLATION-MAC\.md$|THIRD-PARTY-V02\.md$).+/,
  ],
  appBundleId: "fr.juno.studio",
  extendInfo: {
    NSMicrophoneUsageDescription:
      "Parlez à Juno pour piloter vos retouches et votre montage. La transcription des commandes est effectuée sur cet ordinateur.",
  },
  appCopyright: "Juno Studio",
  appVersion: version,
});
for (const bundle of result) {
  const resources =
    platform === "darwin"
      ? path.join(bundle, "Juno Studio.app", "Contents", "Resources")
      : path.join(bundle, "resources");
  await makeNativeLinksPortable(
    native,
    path.join(resources, platform + "-" + arch),
  );
  // La signature vient après la réécriture des chemins de bibliothèques :
  // install_name_tool invalide toute signature posée avant lui.
  if (platform === "darwin") {
    const identity = developerIdIdentity();
    if (identity) {
      console.log("Signature Developer ID : " + identity);
      await signAndArchive(bundle, identity, version);
    } else
      console.warn(
        "Aucun certificat Developer ID : paquet signé ad hoc, utilisable sur ce Mac seulement (voir NOTARISATION.md).",
      );
  }
}
/**
 * Signer l'application, puis la livrer sous forme d'archive.
 *
 * Deux raisons de passer par un dossier temporaire et de finir en archive,
 * l'une et l'autre découvertes en construisant.
 *
 * 1. **La signature ne peut pas se faire dans `~/Documents`.** macOS y appose
 *    `com.apple.provenance` sur tout ce qui s'écrit, et codesign refuse alors
 *    de sceller les bundles auxiliaires. Le même paquet, signé depuis
 *    `/private/tmp`, passe sans rien changer d'autre.
 * 2. **Un `.app` recopié dans un dossier protégé reprend des attributs**
 *    (`com.apple.FinderInfo` sur les dossiers de frameworks), que `xattr -cr`
 *    ne parvient pas à retirer durablement. `codesign --verify` s'en plaint,
 *    alors que la signature elle-même est intacte.
 *
 * Une archive règle les deux : les attributs n'y existent pas, et c'est de
 * toute façon la forme qu'Apple demande pour la notarisation.
 */
async function signAndArchive(bundle, identity, version) {
  const nom = "Juno Studio.app";
  const travail = await fs.mkdtemp(path.join(os.tmpdir(), "juno-sign-"));
  const propre = path.join(travail, nom);
  try {
    execFileSync("ditto", [path.join(bundle, nom), propre]);
    await signBundle(propre, identity);
    execFileSync("codesign", ["--verify", "--deep", "--strict", propre]);
    const archive = path.join(
      path.dirname(bundle),
      `Juno Studio-${version}-${platform}-${arch}.zip`,
    );
    await fs.rm(archive, { force: true });
    execFileSync("ditto", ["-c", "-k", "--keepParent", propre, archive]);
    // La copie de travail reste utilisable localement ; l'archive est ce qui
    // se distribue et ce qui part en notarisation.
    execFileSync("rm", ["-rf", path.join(bundle, nom)]);
    execFileSync("ditto", [propre, path.join(bundle, nom)]);
    console.log("Archive signée : " + archive);
  } finally {
    await fs.rm(travail, { recursive: true, force: true, maxRetries: 5 });
  }
}
console.log(result.join("\n"));
