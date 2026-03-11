const fs = require('node:fs/promises');
const path = require('node:path');
const { trackMapUpdate } = require('../modules/thread-map-tracker/index.js');

(async function main() {
  const cwd = process.cwd();
  const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : cwd;
  const mgmtDir = path.join(projectRoot, 'mgmt', 'projMap');
  const result = await trackMapUpdate({
    data: {
      mapPath: path.join(mgmtDir, 'map.json'),
      threadCachePath: path.join(mgmtDir, 'threads', 'current-thread.json'),
      historyPath: path.join(mgmtDir, 'state', 'thread-map-deltas.json'),
      nowIso: new Date().toISOString(),
      maxSnapshots: 30
    },
    deps: { fs }
  });
  console.log(JSON.stringify(result));
})().catch(function (error) {
  console.error(error);
  process.exit(1);
});
