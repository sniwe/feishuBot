function createTracker(ctx) {
  const { data = {}, ui = {}, deps } = ctx;
  const now = deps.now ? deps.now() : new Date().toISOString();
  return {
    mapPath: data.mapPath || "",
    statePath: data.statePath || "",
    lastRunAt: now,
    ui,
  };
}

module.exports = {
  createTracker,
};
