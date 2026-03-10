function createDelta(ctx) {
  const { data = {}, deps } = ctx;
  const before = data.before || {};
  const after = data.after || {};

  const beforeUpdated = before.updated || null;
  const afterUpdated = after.updated || null;

  return {
    changed: beforeUpdated !== afterUpdated,
    beforeUpdated,
    afterUpdated,
    generatedAt: deps.now ? deps.now() : new Date().toISOString(),
  };
}

module.exports = {
  createDelta,
};
