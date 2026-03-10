const fs = require("node:fs/promises");
const path = require("node:path");
const { trackMapUpdate } = require("../modules/thread-map-tracker/index.js");

(async function main() {
  const cwd = process.cwd();
  const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : cwd;
  const mgmtDir = path.join(projectRoot, "mgmt", "projMap");

  const nowIso = new Date().toISOString();
  const mapPath = path.join(mgmtDir, "map.json");
  const threadCachePath = path.join(mgmtDir, "threads", "current-thread.json");
  const historyPath = path.join(mgmtDir, "state", "thread-map-deltas.json");

  const result = await trackMapUpdate({
    data: {
      mapPath: mapPath,
      threadCachePath: threadCachePath,
      historyPath: historyPath,
      nowIso: nowIso,
      maxSnapshots: 30
    },
    deps: {
      fs: fs
    }
  });

  console.log(JSON.stringify(result));
})().catch(function (error) {
  console.error(error);
  process.exit(1);
});
