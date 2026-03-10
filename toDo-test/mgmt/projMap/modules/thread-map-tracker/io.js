const crypto = require("node:crypto");

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function readJsonOrDefault(ctx) {
  const { data = {}, deps } = ctx;
  const { fs } = deps;
  const { filePath, fallback } = data;

  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function writeJson(ctx) {
  const { data = {}, deps } = ctx;
  const { fs } = deps;
  const { filePath, value } = data;

  await fs.mkdir(require("node:path").dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function hashJson(ctx) {
  const { data = {} } = ctx;
  const serialized = JSON.stringify(data.value);
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

module.exports = {
  readJsonOrDefault,
  writeJson,
  hashJson
};
