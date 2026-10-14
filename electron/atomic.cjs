const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

async function writeJsonAtomic(file, value) {
  const data = JSON.stringify(value);
  const temp = path.join(
    path.dirname(file),
    "." + path.basename(file) + "." + randomUUID() + ".tmp",
  );
  try {
    const handle = await fs.open(temp, "wx", 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
module.exports = { writeJsonAtomic };
