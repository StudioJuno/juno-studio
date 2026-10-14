const fs = require("node:fs/promises"),
  { createHash } = require("node:crypto");
async function fingerprint(file) {
  const h = await fs.open(file, "r");
  try {
    const stat = await h.stat(),
      chunk = 1024 * 1024,
      hash = createHash("sha256");
    hash.update(String(stat.size) + ":");
    for (const at of [...new Set([0, Math.max(0, stat.size - chunk)])]) {
      const b = Buffer.alloc(Math.min(chunk, stat.size - at));
      const { bytesRead } = await h.read(b, 0, b.length, at);
      hash.update(b.subarray(0, bytesRead));
    }
    return hash.digest("hex");
  } finally {
    await h.close();
  }
}
module.exports = { fingerprint };
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const data of require("node:fs").createReadStream(file))
    hash.update(data);
  return hash.digest("hex");
}
module.exports.sha256 = sha256;
