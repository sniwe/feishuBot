const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
const metaStamp = document.getElementById("metaStamp");
const filtersRoot = document.getElementById("projectFilters");
const hintBtn = document.getElementById("regenHintBtn");
const hintDialog = document.getElementById("hintDialog");
const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
const layoutRoot = document.querySelector(".layout");
const sidebarPanel = document.getElementById("sidebarPanel");
const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const fitBtn = document.getElementById("fitBtn");
const resetBtn = document.getElementById("resetBtn");

const state = {
  graph: null,
  selectedProjects: new Set(),
  view: { x: 20, y: 20, scale: 1 },
  drag: { active: false, lastX: 0, lastY: 0 },
  layout: null,
  sidebarCollapsed: false
};

hintBtn.addEventListener("click", () => hintDialog.showModal());

function roundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawArrow(fromX, fromY, toX, toY, color, dashed) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  if (dashed) ctx.setLineDash([7, 6]);

  const cp1x = fromX + Math.max(40, (toX - fromX) * 0.35);
  const cp1y = fromY;
  const cp2x = toX - Math.max(40, (toX - fromX) * 0.35);
  const cp2y = toY;

  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, toX, toY);
  ctx.stroke();

  const angle = Math.atan2(toY - cp2y, toX - cp2x);
  const len = 8;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - len * Math.cos(angle - 0.35), toY - len * Math.sin(angle - 0.35));
  ctx.lineTo(toX - len * Math.cos(angle + 0.35), toY - len * Math.sin(angle + 0.35));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function computeLayout(graph, selectedProjects) {
  const colWidth = 420;
  const colGap = 36;
  const rowH = 86;
  const nodeW = 250;
  const nodeH = 52;
  const topPad = 70;

  const visibleProjects = graph.projects.filter((p) => selectedProjects.has(p.id));
  const nodeIndex = new Map();
  const groupBounds = new Map();
  const nodeByProject = new Map();

  visibleProjects.forEach((p) => nodeByProject.set(p.id, []));

  for (const n of graph.nodes) {
    if (n.projectId && nodeByProject.has(n.projectId)) {
      nodeByProject.get(n.projectId).push(n);
    }
  }

  visibleProjects.forEach((p, i) => {
    const list = nodeByProject.get(p.id);
    const x0 = 40 + i * (colWidth + colGap);
    const y0 = 24;
    const groupH = Math.max(180, topPad + list.length * rowH);
    groupBounds.set(p.id, { x: x0, y: y0, w: colWidth, h: groupH, name: p.name });

    list.forEach((n, idx) => {
      const x = x0 + 20;
      const y = y0 + topPad + idx * rowH;
      nodeIndex.set(n.id, { ...n, x, y, w: nodeW, h: nodeH });
    });
  });

  return {
    nodeIndex,
    groupBounds,
    width: Math.max(1200, visibleProjects.length * (colWidth + colGap) + 80),
    height: 1100
  };
}

function setCanvasSize(layout) {
  const w = Math.max(layout.width, 1800);
  const h = Math.max(layout.height, 1000);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

function draw(graph) {
  const layout = computeLayout(graph, state.selectedProjects);
  state.layout = layout;
  setCanvasSize(layout);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(state.view.x, state.view.y);
  ctx.scale(state.view.scale, state.view.scale);

  // Group boxes (Mermaid-style subgraphs).
  for (const [, g] of layout.groupBounds) {
    ctx.save();
    ctx.fillStyle = "#f6f9ff";
    ctx.strokeStyle = "#a8bddf";
    ctx.lineWidth = 1.4;
    roundedRect(g.x, g.y, g.w, g.h, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#284570";
    ctx.font = "600 15px 'Segoe UI'";
    ctx.fillText(`subgraph ${g.name}`, g.x + 12, g.y + 22);
    ctx.restore();
  }

  // Edges first.
  const edges = graph.edges.filter((e) => {
    const from = layout.nodeIndex.get(e.from);
    const to = layout.nodeIndex.get(e.to);
    return from && to;
  });

  for (const e of edges) {
    const from = layout.nodeIndex.get(e.from);
    const to = layout.nodeIndex.get(e.to);
    const fromX = from.x + from.w;
    const fromY = from.y + from.h / 2;
    const toX = to.x;
    const toY = to.y + to.h / 2;
    const cross = e.intraProject === false || from.projectId !== to.projectId;
    drawArrow(fromX, fromY, toX, toY, cross ? "#e67e22" : "#2f80ed", cross);
  }

  // Nodes.
  for (const [, n] of layout.nodeIndex) {
    ctx.save();
    ctx.fillStyle = n.type === "project" ? "#e9f3ff" : "#ffffff";
    ctx.strokeStyle = "#4a5568";
    ctx.lineWidth = 1.2;
    roundedRect(n.x, n.y, n.w, n.h, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#1f2430";
    ctx.font = "600 12px 'Consolas', 'Courier New', monospace";
    const label = (n.label || n.id).slice(0, 36);
    ctx.fillText(label, n.x + 10, n.y + 22);
    ctx.fillStyle = "#6b7280";
    ctx.font = "11px 'Segoe UI'";
    ctx.fillText(`[${n.type}]`, n.x + 10, n.y + 39);
    ctx.restore();
  }
  ctx.restore();
}

function renderFilters(graph) {
  filtersRoot.innerHTML = "";
  graph.projects.forEach((p) => {
    if (!state.selectedProjects.size) state.selectedProjects.add(p.id);
    const id = `f-${p.id}`;
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = state.selectedProjects.has(p.id);
    input.addEventListener("change", () => {
      if (input.checked) state.selectedProjects.add(p.id);
      else state.selectedProjects.delete(p.id);
      draw(state.graph);
    });
    const span = document.createElement("span");
    span.textContent = p.name;
    label.appendChild(input);
    label.appendChild(span);
    filtersRoot.appendChild(label);
  });
}

function clampScale(scale) {
  return Math.min(2.8, Math.max(0.25, scale));
}

function zoomAt(screenX, screenY, factor) {
  const oldScale = state.view.scale;
  const newScale = clampScale(oldScale * factor);
  if (newScale === oldScale) return;
  const worldX = (screenX - state.view.x) / oldScale;
  const worldY = (screenY - state.view.y) / oldScale;
  state.view.scale = newScale;
  state.view.x = screenX - worldX * newScale;
  state.view.y = screenY - worldY * newScale;
  draw(state.graph);
}

function fitView() {
  if (!state.layout) return;
  const groups = [...state.layout.groupBounds.values()];
  if (!groups.length) {
    state.view = { x: 20, y: 20, scale: 1 };
    draw(state.graph);
    return;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of groups) {
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.w);
    maxY = Math.max(maxY, g.y + g.h);
  }
  const pad = 40;
  const worldW = maxX - minX + pad * 2;
  const worldH = maxY - minY + pad * 2;
  const scaleX = canvas.width / worldW;
  const scaleY = canvas.height / worldH;
  const scale = clampScale(Math.min(scaleX, scaleY));
  state.view.scale = scale;
  state.view.x = (canvas.width - (maxX - minX) * scale) / 2 - minX * scale;
  state.view.y = (canvas.height - (maxY - minY) * scale) / 2 - minY * scale;
  draw(state.graph);
}

function resetView() {
  state.view = { x: 20, y: 20, scale: 1 };
  draw(state.graph);
}

function bindNavigation() {
  canvas.addEventListener("mousedown", (e) => {
    state.drag.active = true;
    state.drag.lastX = e.clientX;
    state.drag.lastY = e.clientY;
    canvas.classList.add("panning");
  });

  window.addEventListener("mouseup", () => {
    state.drag.active = false;
    canvas.classList.remove("panning");
  });

  window.addEventListener("mousemove", (e) => {
    if (!state.drag.active) return;
    const dx = e.clientX - state.drag.lastX;
    const dy = e.clientY - state.drag.lastY;
    state.drag.lastX = e.clientX;
    state.drag.lastY = e.clientY;
    state.view.x += dx;
    state.view.y += dy;
    draw(state.graph);
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      zoomAt(x, y, factor);
    },
    { passive: false }
  );

  zoomInBtn.addEventListener("click", () => zoomAt(canvas.width / 2, canvas.height / 2, 1.15));
  zoomOutBtn.addEventListener("click", () => zoomAt(canvas.width / 2, canvas.height / 2, 0.87));
  fitBtn.addEventListener("click", fitView);
  resetBtn.addEventListener("click", resetView);

  sidebarToggleBtn.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    layoutRoot.classList.toggle("collapsed", state.sidebarCollapsed);
    sidebarPanel.setAttribute("aria-hidden", state.sidebarCollapsed ? "true" : "false");
    sidebarToggleBtn.textContent = state.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar";
    setTimeout(() => draw(state.graph), 150);
  });
}

async function boot() {
  const graph = window.__GRAPH_DATA__;
  if (!graph) throw new Error("Missing graph data. Run generate-graph-data.ps1 first.");
  state.graph = graph;
  metaStamp.textContent = `generated ${new Date(graph.generatedAt).toLocaleString()}`;
  bindNavigation();
  renderFilters(graph);
  draw(graph);
  fitView();
}

boot().catch((err) => {
  metaStamp.textContent = `error: ${err.message}`;
});
