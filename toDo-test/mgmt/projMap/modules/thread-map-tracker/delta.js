/**
 * @param {{ data?: object, ui?: object, deps: object }} ctx
 */
function buildDelta(ctx) {
  const { data = {} } = ctx;
  const { previousMap = null, nextMap } = data;

  const prevNodes = new Map(((previousMap && previousMap.nodes) || []).map((n) => [n.id, JSON.stringify(n)]));
  const nextNodes = new Map(((nextMap && nextMap.nodes) || []).map((n) => [n.id, JSON.stringify(n)]));

  const prevEdges = new Map(((previousMap && previousMap.edges) || []).map((e) => [e.id, JSON.stringify(e)]));
  const nextEdges = new Map(((nextMap && nextMap.edges) || []).map((e) => [e.id, JSON.stringify(e)]));

  const nodesAdded = [];
  const nodesRemoved = [];
  const nodesChanged = [];

  const edgesAdded = [];
  const edgesRemoved = [];
  const edgesChanged = [];

  nextNodes.forEach(function (value, id) {
    if (!prevNodes.has(id)) nodesAdded.push(id);
    else if (prevNodes.get(id) !== value) nodesChanged.push(id);
  });

  prevNodes.forEach(function (_value, id) {
    if (!nextNodes.has(id)) nodesRemoved.push(id);
  });

  nextEdges.forEach(function (value, id) {
    if (!prevEdges.has(id)) edgesAdded.push(id);
    else if (prevEdges.get(id) !== value) edgesChanged.push(id);
  });

  prevEdges.forEach(function (_value, id) {
    if (!nextEdges.has(id)) edgesRemoved.push(id);
  });

  const isInitial = !previousMap;

  return {
    kind: isInitial ? "initial" : "delta",
    nodes_added: nodesAdded.sort(),
    nodes_removed: nodesRemoved.sort(),
    nodes_changed: nodesChanged.sort(),
    edges_added: edgesAdded.sort(),
    edges_removed: edgesRemoved.sort(),
    edges_changed: edgesChanged.sort()
  };
}

module.exports = { buildDelta };
