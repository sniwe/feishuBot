import { createHash } from 'node:crypto';
import path from 'node:path';
import { computeMapDelta, stableStringify } from './delta.js';
import { readJsonOrNull, writeJson } from './io.js';

/**
 * Track map updates against thread+turn and persist per-update deltas.
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {Promise<object>}
 */
export async function trackMapUpdate(ctx) {
  const { data = {}, deps } = ctx;
  const {
    mapPath,
    threadCachePath,
    historyPath,
    nowIso,
    maxSnapshots = 20
  } = data;

  const { fs } = deps;

  const mapDoc = await readJsonOrNull({ data: { path: mapPath }, deps });
  if (!mapDoc) {
    throw new Error(`Map file missing or invalid: ${mapPath}`);
  }

  const threadCache = (await readJsonOrNull({ data: { path: threadCachePath }, deps })) || {};
  const history = (await readJsonOrNull({ data: { path: historyPath }, deps })) || {
    id: 'thread-map-deltas',
    type: 'thread-map-tracker',
    updated: '',
    map_path: mapPath,
    thread_cache_path: threadCachePath,
    last_map_hash: '',
    entries: [],
    snapshots: []
  };

  const previousSnapshot = (history.snapshots || []).length > 0
    ? history.snapshots[history.snapshots.length - 1]
    : null;

  const mapStable = stableStringify({ data: { value: mapDoc } });
  const mapHash = createHash('sha256').update(mapStable).digest('hex');

  const delta = computeMapDelta({
    data: {
      previousMap: previousSnapshot ? previousSnapshot.map : null,
      currentMap: mapDoc
    }
  });

  const threadId = threadCache.thread_id || 'unknown';
  const nextTurn = Number.isFinite(Number(threadCache.turn_index))
    ? Number(threadCache.turn_index) + 1
    : 1;

  const entry = {
    id: `delta:${Date.now()}:${threadId}:${nextTurn}`,
    recorded_at: nowIso,
    thread_id: threadId,
    turn_index: nextTurn,
    map_updated: mapDoc.updated || nowIso,
    map_hash: mapHash,
    delta
  };

  history.updated = nowIso;
  history.map_path = mapPath;
  history.thread_cache_path = threadCachePath;
  history.last_map_hash = mapHash;
  history.entries = [...(history.entries || []), entry];

  const newSnapshots = [...(history.snapshots || []), {
    map_hash: mapHash,
    captured_at: nowIso,
    map: mapDoc
  }];
  history.snapshots = newSnapshots.slice(-Math.max(1, maxSnapshots));

  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await writeJson({ data: { path: historyPath, value: history }, deps });

  const nextThreadCache = {
    ...threadCache,
    thread_id: threadId,
    turn_index: nextTurn,
    updated_at_local: nowIso,
    last_map_hash: mapHash,
    last_delta_id: entry.id
  };
  await writeJson({ data: { path: threadCachePath, value: nextThreadCache }, deps });

  return {
    ok: true,
    thread_id: threadId,
    turn_index: nextTurn,
    history_path: historyPath,
    delta_id: entry.id,
    delta_kind: delta.kind
  };
}
