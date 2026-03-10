const path = require("node:path");
const { readJsonOrDefault, writeJson, hashJson } = require("./io.js");
const { buildDelta } = require("./delta.js");

/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
async function trackMapUpdate(ctx) {
  const { data = {}, deps } = ctx;
  const { fs } = deps;

  const mapPath = data.mapPath;
  const threadCachePath = data.threadCachePath;
  const historyPath = data.historyPath;
  const nowIso = data.nowIso || new Date().toISOString();
  const maxSnapshots = Number.isInteger(data.maxSnapshots) ? data.maxSnapshots : 30;

  const mapRaw = await fs.readFile(mapPath, "utf8");
  const map = JSON.parse(mapRaw);

  const threadCache = await readJsonOrDefault({
    data: {
      filePath: threadCachePath,
      fallback: {
        thread_id: "unknown-thread",
        turn_index: 0,
        updated_at_local: "",
        sessions_day_dir: "",
        session_file: ""
      }
    },
    deps: { fs }
  });

  const history = await readJsonOrDefault({
    data: {
      filePath: historyPath,
      fallback: {
        id: "thread-map-deltas",
        type: "thread-map-tracker",
        updated: nowIso,
        map_path: mapPath,
        thread_cache_path: threadCachePath,
        last_map_hash: "",
        entries: [],
        snapshots: []
      }
    },
    deps: { fs }
  });

  const mapHash = hashJson({ data: { value: map }, deps: {} });
  const prevSnapshot = (history.snapshots || []).find(function (s) { return s.map_hash === history.last_map_hash; });
  const previousMap = prevSnapshot ? prevSnapshot.map : null;

  const delta = buildDelta({ data: { previousMap: previousMap, nextMap: map }, deps: {} });

  const threadId = String(threadCache.thread_id || "unknown-thread");
  const priorTurn = Number.isInteger(threadCache.turn_index) ? threadCache.turn_index : 0;
  const nextTurn = priorTurn + 1;

  const deltaId = "delta:" + Date.now() + ":" + threadId + ":" + nextTurn;

  const entry = {
    id: deltaId,
    recorded_at: nowIso,
    thread_id: threadId,
    turn_index: nextTurn,
    map_updated: map.updated || nowIso,
    map_hash: mapHash,
    delta: delta
  };

  const snapshots = Array.isArray(history.snapshots) ? history.snapshots.slice() : [];
  snapshots.push({ map_hash: mapHash, captured_at: nowIso, map: map });

  const nextHistory = {
    id: "thread-map-deltas",
    type: "thread-map-tracker",
    updated: nowIso,
    map_path: mapPath,
    thread_cache_path: threadCachePath,
    last_map_hash: mapHash,
    entries: [...(Array.isArray(history.entries) ? history.entries : []), entry],
    snapshots: snapshots.slice(-maxSnapshots)
  };

  const nextThreadCache = {
    ...threadCache,
    turn_index: nextTurn,
    updated_at_local: nowIso,
    last_map_hash: mapHash,
    last_delta_id: deltaId
  };

  await writeJson({ data: { filePath: historyPath, value: nextHistory }, deps: { fs } });
  await writeJson({ data: { filePath: threadCachePath, value: nextThreadCache }, deps: { fs } });

  return {
    ok: true,
    history_path: historyPath,
    thread_cache_path: threadCachePath,
    map_hash: mapHash,
    delta_id: deltaId,
    turn_index: nextTurn
  };
}

module.exports = { trackMapUpdate };
