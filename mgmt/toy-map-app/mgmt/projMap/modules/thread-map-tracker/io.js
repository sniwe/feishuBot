/**
 * Read JSON from disk when present.
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {Promise<any|null>}
 */
export async function readJsonOrNull(ctx) {
  const { data = {}, deps } = ctx;
  const { path } = data;
  const { fs } = deps;
  try {
    const raw = await fs.readFile(path, 'utf8');
    if (!raw || !raw.trim()) {
      return null;
    }
    const cleaned = raw.replace(/^\uFEFF/, '');
    return JSON.parse(cleaned);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Write JSON to disk with pretty formatting.
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {Promise<void>}
 */
export async function writeJson(ctx) {
  const { data = {}, deps } = ctx;
  const { path, value } = data;
  const { fs } = deps;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(path, payload, 'utf8');
}
