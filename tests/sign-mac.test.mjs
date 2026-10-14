import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  parseIdentity,
  parseSignature,
  machOFiles,
  inspect,
} from "../scripts/sign-mac.mjs";
import { credentials } from "../scripts/notarize-credentials.mjs";
// La sortie réelle de « security find-identity » sur ce Mac, avant le chantier.
const TROUSSEAU_SANS = `  1) 0B0D…EA "Apple Development: Johan Amselem (DN5556MXJ2)"
  2) 7B84…F3 "Apple Distribution: Juno (542CN5886Z)"
     2 valid identities found`;
const TROUSSEAU_AVEC = TROUSSEAU_SANS.replace(
  "2 valid",
  '3) AAAA "Developer ID Application: Juno (542CN5886Z)"\n     3 valid',
);
test("« Apple Distribution » n'est jamais pris pour un certificat de diffusion", () => {
  // C'est le piège : ce certificat existe, il est valide, et il ne sert à rien ici.
  assert.equal(parseIdentity(TROUSSEAU_SANS), undefined);
  assert.equal(
    parseIdentity(TROUSSEAU_AVEC),
    "Developer ID Application: Juno (542CN5886Z)",
  );
  assert.equal(parseIdentity(""), undefined);
});
test("une signature ad hoc n'est jamais tenue pour conforme", () => {
  const adhoc = `CodeDirectory v=20400 size=2617 flags=0x2(adhoc) hashes=75+2
Signature=adhoc
TeamIdentifier=not set`;
  const read = parseSignature(adhoc);
  assert.equal(read.signed, true);
  assert.equal(read.authority, "ad hoc");
  assert.equal(read.developerId, false);
  assert.equal(read.hardened, false);
});
test("il faut le certificat ET l'exécution durcie", () => {
  const base = `CodeDirectory v=20500 size=900 flags=%FLAGS% hashes=20+3
Authority=Developer ID Application: Juno (542CN5886Z)
Authority=Developer ID Certification Authority
TeamIdentifier=542CN5886Z`;
  const durci = parseSignature(base.replace("%FLAGS%", "0x10000(runtime)"));
  assert.equal(durci.developerId, true);
  assert.equal(durci.hardened, true);
  // Le nom entre parenthèses ne doit pas masquer le drapeau, ni l'inverse.
  assert.equal(
    parseSignature(base.replace("%FLAGS%", "0x10000")).hardened,
    true,
  );
  assert.equal(
    parseSignature(base.replace("%FLAGS%", "0x10002(adhoc,runtime)")).hardened,
    true,
  );
  // Bon certificat, mais sans exécution durcie : Apple refusera la notarisation.
  const mou = parseSignature(base.replace("%FLAGS%", "0x0(none)"));
  assert.equal(mou.developerId, true);
  assert.equal(mou.hardened, false);
});
test("un fichier sans signature du tout est reconnu comme tel", () => {
  assert.deepEqual(parseSignature("code object is not signed at all"), {
    signed: false,
  });
  assert.deepEqual(parseSignature(""), { signed: false });
});
test("les identifiants de notarisation ne sont jamais devinés", () => {
  assert.equal(credentials(undefined), undefined);
  assert.equal(credentials({}), undefined);
  // Une clé API incomplète ne doit pas produire une commande à moitié formée.
  assert.equal(credentials({ keyId: "ABC", issuer: "x" }), undefined);
  assert.equal(credentials({ keyPath: "/x.p8", keyId: "ABC" }), undefined);
  const trousseau = credentials({ keychainProfile: "juno" });
  assert.deepEqual(trousseau.args, ["--keychain-profile", "juno"]);
  // Une clé annoncée mais absente du disque est une erreur, pas un repli.
  assert.throws(
    () => credentials({ keyPath: "/absent.p8", keyId: "A", issuer: "B" }),
    /introuvable/,
  );
});
test("tous les binaires du paquet sont trouvés, natifs compris", () => {
  const app = "release/v0.9.0/Juno Studio-darwin-arm64/Juno Studio.app";
  if (!existsSync(app)) return; // Le paquet n'est pas toujours présent.
  const files = machOFiles(app);
  // Electron, ses auxiliaires, et les 22 fichiers natifs qui doivent être signés.
  assert.ok(files.length >= 30, "binaires trouvés : " + files.length);
  for (const nom of ["ffmpeg", "ffprobe", "whisper-cli", "llama-server"])
    assert.ok(
      files.some((f) => f.endsWith("/" + nom)),
      nom + " doit être signé lui aussi",
    );
  // Les fichiers de modèles, énormes et non exécutables, sont ignorés.
  assert.ok(!files.some((f) => f.endsWith(".gguf") || f.endsWith(".bin")));
  const read = inspect(files[0]);
  assert.equal(read.signed, true);
  assert.equal(typeof read.hardened, "boolean");
});
