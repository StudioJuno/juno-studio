const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { LocalPlanner, MODELE } = require("../electron/local-planner.cjs");
/** Une fausse installation : un binaire factice, et le modèle où l'on veut. */
async function installation({ telecharge = false, embarque = false } = {}) {
  const racine = await fs.mkdtemp(path.join(os.tmpdir(), "juno-planner-"));
  const nativeRoot = path.join(racine, "Resources", "darwin-arm64");
  const userData = path.join(racine, "userData");
  await fs.mkdir(path.join(nativeRoot, "llama"), { recursive: true });
  await fs.writeFile(path.join(nativeRoot, "llama", "llama-server" + (process.platform === "win32" ? ".exe" : "")), "");
  if (embarque) {
    await fs.mkdir(path.join(racine, "Resources", "models"), { recursive: true });
    await fs.writeFile(path.join(racine, "Resources", "models", MODELE.nom), "embarqué");
  }
  if (telecharge) {
    await fs.mkdir(path.join(userData, "models"), { recursive: true });
    await fs.writeFile(path.join(userData, "models", MODELE.nom), "téléchargé");
  }
  return { racine, planner: new LocalPlanner(nativeRoot, userData), userData };
}
test("sans modèle, l'IA locale est absente mais installable", async () => {
  const { racine, planner } = await installation();
  try {
    const s = planner.status();
    assert.equal(s.available, false);
    assert.equal(s.source, null);
    assert.equal(s.installable, true);
    assert.equal(s.taille, MODELE.taille);
  } finally { await fs.rm(racine, { recursive: true, force: true }); }
});
test("un modèle téléchargé est trouvé, et préféré à celui de l'application", async () => {
  const { racine, planner } = await installation({ telecharge: true, embarque: true });
  try {
    assert.equal(planner.status().source, "telecharge");
    assert.equal(planner.status().available, true);
  } finally { await fs.rm(racine, { recursive: true, force: true }); }
});
test("une ancienne installation qui l'embarque marche toujours", async () => {
  const { racine, planner } = await installation({ embarque: true });
  try {
    assert.equal(planner.status().source, "embarque");
    assert.equal(planner.status().available, true);
  } finally { await fs.rm(racine, { recursive: true, force: true }); }
});
test("désinstaller retire la copie téléchargée, jamais celle de l'application", async () => {
  const { racine, planner } = await installation({ telecharge: true, embarque: true });
  try {
    const s = await planner.desinstaller();
    assert.equal(s.source, "embarque");
    await fs.access(path.join(racine, "Resources", "models", MODELE.nom));
  } finally { await fs.rm(racine, { recursive: true, force: true }); }
});
test("l'adresse du modèle vise un commit figé, pas une branche", () => {
  // Sous une branche, le fichier pourrait changer et ne plus passer la
  // vérification d'empreinte : l'installation échouerait chez tout le monde.
  assert.match(MODELE.url, /\/resolve\/[0-9a-f]{40}\//);
  assert.match(MODELE.sha256, /^[0-9a-f]{64}$/);
});
