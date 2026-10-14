const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  os = require("node:os");
const G = require("../electron/test-isolation.cjs");
const MAISON = "/Users/essai";
const REEL = path.join(MAISON, "Library", "Application Support", "Juno Studio");
const base = {
  essai: true,
  appData: path.join(MAISON, "Library", "Application Support"),
  nom: "Juno Studio",
  plateforme: "darwin",
  maison: MAISON,
};
test("un essai sur les vrais projets est refusé", () => {
  const r = G.verdict({ ...base, userData: REEL });
  assert.equal(r.ok, false);
  assert.match(r.raison, /vrais projets/);
});
test("un essai dans un sous-dossier des vrais projets est refusé aussi", () => {
  // Le piège : un script qui range son profil « à côté » des originaux.
  assert.equal(G.verdict({ ...base, userData: path.join(REEL, "essai") }).ok, false);
  assert.equal(G.verdict({ ...base, userData: REEL + path.sep }).ok, false);
});
test("un profil temporaire passe", () => {
  assert.equal(G.verdict({ ...base, userData: path.join(os.tmpdir(), "juno-x1") }).ok, true);
});
test("un dossier qui commence pareil sans être dedans passe", () => {
  // « Juno Studio 2 » n'est pas dans « Juno Studio » : le préfixe seul ne suffit pas.
  assert.equal(G.verdict({ ...base, userData: REEL + " 2" }).ok, true);
});
test("hors essai, rien n'est jugé", () => {
  assert.equal(G.verdict({ ...base, essai: false, userData: REEL }).ok, true);
});
test("sans dossier connu, on refuse plutôt que de deviner", () => {
  assert.equal(G.verdict({ ...base, userData: "" }).ok, false);
});
test("le second filet attrape le cas où --user-data-dir n'agirait plus", () => {
  // appData redirigé ailleurs, mais userData pointe quand même sur le vrai
  // dossier calculé depuis le dossier personnel : refusé.
  assert.equal(
    G.verdict({ ...base, appData: "/ailleurs", userData: REEL }).ok,
    false,
  );
});
test("les trois plateformes visent le bon dossier", () => {
  assert.equal(G.dossierReel("Juno Studio", "darwin", MAISON), REEL);
  assert.match(G.dossierReel("Juno Studio", "linux", MAISON), /Juno Studio$/);
  assert.match(G.dossierReel("Juno Studio", "win32", MAISON), /Juno Studio$/);
});
test("le mode essai se reconnaît par l'argument ou la variable", () => {
  assert.equal(G.enEssai(["node", "."], {}), false);
  assert.equal(G.enEssai(["node", ".", "--juno-test-hidden"], {}), true);
  assert.equal(G.enEssai(["node", "."], { JUNO_TEST: "1" }), true);
});
