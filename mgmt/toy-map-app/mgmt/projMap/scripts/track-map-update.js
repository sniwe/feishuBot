import fs from 'node:fs/promises';
import path from 'node:path';
import { trackMapUpdate } from '../modules/thread-map-tracker/index.js';

const cwd = process.cwd();
const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : cwd;
const mgmtDir = path.join(projectRoot, 'mgmt', 'projMap');

const nowIso = new Date().toISOString();
const mapPath = path.join(mgmtDir, 'map.json');
const threadCachePath = path.join(mgmtDir, 'threads', 'current-thread.json');
const historyPath = path.join(mgmtDir, 'state', 'thread-map-deltas.json');

const result = await trackMapUpdate({
  data: {
    mapPath,
    threadCachePath,
    historyPath,
    nowIso,
    maxSnapshots: 30
  },
  deps: {
    fs
  }
});

console.log(JSON.stringify(result));


