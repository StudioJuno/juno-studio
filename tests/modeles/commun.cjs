/**
 * Ce que partagent les contrats des modèles.
 *
 * Ces vérifications lancent la vraie application et de vrais modèles : elles
 * prennent plusieurs minutes, et ne font donc pas partie de `npm test`. On les
 * lance avec `npm run test:modeles -- <photo d'une personne>`.
 */
const path = require("node:path"), os = require("node:os"), fs = require("node:fs");
/** Playwright n'est pas une dépendance de l'application : on le cherche. */
function playwright() {
  const candidats = [
    process.env.JUNO_PLAYWRIGHT,
    "/Users/johan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright",
    "playwright",
  ].filter(Boolean);
  for (const c of candidats) {
    try { return require(c); } catch {}
  }
  throw Error("Playwright introuvable. Indiquez son dossier dans JUNO_PLAYWRIGHT.");
}
const racine = path.resolve(__dirname, "..", "..");
/** Les captures et rapports vont hors du dépôt. */
const sortie = process.env.JUNO_SORTIE || fs.mkdtempSync(path.join(os.tmpdir(), "juno-contrats-"));
fs.mkdirSync(sortie, { recursive: true });
/**
 * Lancer l'application sur un profil jetable.
 *
 * `JUNO_TEST_EXEC` fait tourner le paquet construit au lieu des sources : c'est
 * lui qu'on livre, et il n'embarque plus les mêmes fichiers.
 */
async function lancer(profil) {
  const { _electron: electron } = playwright();
  return electron.launch({
    executablePath: process.env.JUNO_TEST_EXEC || require(racine + "/node_modules/electron"),
    args: [
      ...(process.env.JUNO_TEST_EXEC ? [] : [racine]),
      "--juno-test-hidden",
      "--user-data-dir=" + profil,
    ],
  });
}
module.exports = { playwright, racine, sortie, lancer };
