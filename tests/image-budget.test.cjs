const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
const { ImageBudget } = require("../electron/image-budget.cjs");
test("project budget reserves before requests, persists across restart, and rejects concurrent excess", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "juno-budget-"));
  try {
    const ledger = new ImageBudget(path.join(root, "ledger.json"));
    const calls = await Promise.allSettled(
      Array.from({ length: 8 }, () => ledger.reserve("album", "test-model")),
    );
    assert.equal(calls.filter((x) => x.status === "fulfilled").length, 5);
    assert.equal(
      (await new ImageBudget(ledger.file).status("album")).canRun,
      false,
    );
    assert.equal((await ledger.status("another")).remainingEuro, 5);
    assert.equal((await fs.stat(ledger.file)).mode & 0o777, 0o600);
    await fs.writeFile(ledger.file, "broken");
    await assert.rejects(() => ledger.reserve("album", "model"), /illisible/);
    assert.equal(await fs.readFile(ledger.file, "utf8"), "broken");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
