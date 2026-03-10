function toIdSet(items) {
  const ids = new Set();
  for (const item of items || []) {
    if (item && item.id) {
      ids.add(String(item.id));
    }
  }
  return ids;
}

function intersection(a, b) {
  const out = [];
  for (const value of a) {
    if (b.has(value)) {
      out.push(value);
    }
  }
  return out;
}

function diffIds(prevItems, nextItems) {
  const prevIds = toIdSet(prevItems);
  const nextIds = toIdSet(nextItems);

  const added = [];
  const removed = [];

  for (const id of nextIds) {
    if (!prevIds.has(id)) {
      added.push(id);
    }
  }
  for (const id of prevIds) {
    if (!nextIds.has(id)) {
      removed.push(id);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    shared: intersection(prevIds, nextIds).sort()
  };
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableValue(value[key]);
    }
    return out;
  }
  return value;
}

function asMapById(items) {
  const out = new Map();
  for (const item of items || []) {
    if (item && item.id) {
      out.set(String(item.id), stableValue(item));
    }
  }
  return out;
}

/**
 * Compute change summary between previous and current map.
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {object}
 */
export function computeMapDelta(ctx) {
  const { data = {} } = ctx;
  const { previousMap = null, currentMap = {} } = data;

  if (!previousMap) {
    return {
      kind: 'initial',
      nodes_added: (currentMap.nodes || []).map((x) => x.id).filter(Boolean).sort(),
      nodes_removed: [],
      nodes_changed: [],
      edges_added: (currentMap.edges || []).map((x) => x.id).filter(Boolean).sort(),
      edges_removed: [],
      edges_changed: []
    };
  }

  const nodeIds = diffIds(previousMap.nodes || [], currentMap.nodes || []);
  const edgeIds = diffIds(previousMap.edges || [], currentMap.edges || []);

  const prevNodes = asMapById(previousMap.nodes || []);
  const nextNodes = asMapById(currentMap.nodes || []);
  const prevEdges = asMapById(previousMap.edges || []);
  const nextEdges = asMapById(currentMap.edges || []);

  const nodesChanged = [];
  const edgesChanged = [];

  for (const id of nodeIds.shared) {
    if (JSON.stringify(prevNodes.get(id)) !== JSON.stringify(nextNodes.get(id))) {
      nodesChanged.push(id);
    }
  }
  for (const id of edgeIds.shared) {
    if (JSON.stringify(prevEdges.get(id)) !== JSON.stringify(nextEdges.get(id))) {
      edgesChanged.push(id);
    }
  }

  return {
    kind: 'delta',
    nodes_added: nodeIds.added,
    nodes_removed: nodeIds.removed,
    nodes_changed: nodesChanged.sort(),
    edges_added: edgeIds.added,
    edges_removed: edgeIds.removed,
    edges_changed: edgesChanged.sort()
  };
}

/**
 * Produce a deterministic JSON string for hashing.
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 * @returns {string}
 */
export function stableStringify(ctx) {
  const { data = {} } = ctx;
  const { value } = data;
  return JSON.stringify(stableValue(value));
}
