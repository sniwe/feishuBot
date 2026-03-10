const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");
const DATA_DIR = path.join(__dirname, "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const PORT = Number(process.env.PORT || 3000);

/**
 * @param {{ data?: object, ui?: object, deps: { fs: typeof fs } }} ctx
 */
function ensureDataFile(ctx) {
  const { deps } = ctx;
  if (!deps.fs.existsSync(DATA_DIR)) {
    deps.fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!deps.fs.existsSync(TASKS_FILE)) {
    deps.fs.writeFileSync(TASKS_FILE, "[]\n", "utf8");
  }
}

/**
 * @param {{ data?: { raw: unknown }, ui?: object, deps: object }} ctx
 */
function normalizeItems(ctx) {
  const { data = {} } = ctx;
  const source = Array.isArray(data.raw) ? data.raw : [];

  return source
    .filter(function (item) {
      return item && typeof item === "object";
    })
    .map(function (item) {
      return {
        id: typeof item.id === "string" ? item.id : randomUUID(),
        text: typeof item.text === "string" ? item.text : "",
        done: Boolean(item.done)
      };
    })
    .filter(function (item) {
      return item.text.trim().length > 0;
    });
}

/**
 * @param {{ data?: object, ui?: object, deps: { fs: typeof fs } }} ctx
 */
function loadItems(ctx) {
  const { deps } = ctx;
  ensureDataFile({ deps: { fs: deps.fs } });
  try {
    const raw = deps.fs.readFileSync(TASKS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeItems({ data: { raw: parsed }, deps: {} });
  } catch {
    return [];
  }
}

/**
 * @param {{ data?: { items?: unknown[] }, ui?: object, deps: { fs: typeof fs } }} ctx
 */
function saveItems(ctx) {
  const { data = {}, deps } = ctx;
  ensureDataFile({ deps: { fs: deps.fs } });
  const items = normalizeItems({ data: { raw: data.items }, deps: {} });
  deps.fs.writeFileSync(TASKS_FILE, JSON.stringify(items, null, 2) + "\n", "utf8");
  return items;
}

/**
 * @param {{ data?: { req: import("http").IncomingMessage }, ui?: object, deps: object }} ctx
 */
function readJsonBody(ctx) {
  const { data = {} } = ctx;
  const req = data.req;

  return new Promise(function (resolve, reject) {
    let body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", function () {
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * @param {{ data?: { res: import("http").ServerResponse, status?: number, payload?: any }, ui?: object, deps: object }} ctx
 */
function sendJson(ctx) {
  const { data = {} } = ctx;
  const res = data.res;
  const status = data.status || 200;
  const payload = data.payload === undefined ? {} : data.payload;
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * @param {{ data?: { res: import("http").ServerResponse, status?: number, message: string }, ui?: object, deps: object }} ctx
 */
function sendText(ctx) {
  const { data = {} } = ctx;
  const res = data.res;
  const status = data.status || 200;
  const body = data.message || "";
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * @param {{ data?: { req: import("http").IncomingMessage, res: import("http").ServerResponse }, ui?: object, deps: { fs: typeof fs, path: typeof path } }} ctx
 */
function serveStatic(ctx) {
  const { data = {}, deps } = ctx;
  const req = data.req;
  const res = data.res;
  const requestPath = (req.url || "/").split("?")[0];

  let baseDir = null;
  let relativePath = "";

  if (requestPath === "/" || requestPath === "/index.html") {
    baseDir = PUBLIC_DIR;
    relativePath = "index.html";
  } else if (requestPath.startsWith("/frontend/")) {
    baseDir = FRONTEND_DIR;
    relativePath = requestPath.slice("/frontend/".length);
  } else if (requestPath.startsWith("/public/")) {
    baseDir = PUBLIC_DIR;
    relativePath = requestPath.slice("/public/".length);
  }

  if (!baseDir) {
    sendText({ data: { res, status: 404, message: "Not found" }, deps: {} });
    return;
  }

  const safePath = deps.path.normalize(relativePath).replace(/^([.][.][/\\])+/, "");
  const fullPath = deps.path.join(baseDir, safePath);

  if (!fullPath.startsWith(baseDir)) {
    sendText({ data: { res, status: 403, message: "Forbidden" }, deps: {} });
    return;
  }

  if (!deps.fs.existsSync(fullPath) || deps.fs.statSync(fullPath).isDirectory()) {
    sendText({ data: { res, status: 404, message: "Not found" }, deps: {} });
    return;
  }

  const ext = deps.path.extname(fullPath).toLowerCase();
  const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  const body = deps.fs.readFileSync(fullPath);
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Content-Length": body.length
  });
  res.end(body);
}

const server = http.createServer(async function (req, res) {
  try {
    const pathname = (req.url || "/").split("?")[0];

    if (req.method === "GET" && pathname === "/api/tasks") {
      const items = loadItems({ deps: { fs } });
      sendJson({ data: { res, payload: { items } }, deps: {} });
      return;
    }

    if (req.method === "PUT" && pathname === "/api/tasks") {
      const payload = await readJsonBody({ data: { req }, deps: {} });
      const rawItems = payload && Array.isArray(payload.items) ? payload.items : payload;
      const items = saveItems({ data: { items: rawItems }, deps: { fs } });
      sendJson({ data: { res, payload: { items } }, deps: {} });
      return;
    }

    if (req.method === "GET") {
      serveStatic({ data: { req, res }, deps: { fs, path } });
      return;
    }

    sendText({ data: { res, status: 405, message: "Method not allowed" }, deps: {} });
  } catch (error) {
    sendJson({
      data: {
        res,
        status: 400,
        payload: { error: error && error.message ? error.message : "Request failed" }
      },
      deps: {}
    });
  }
});

ensureDataFile({ deps: { fs } });
server.listen(PORT, function () {
  console.log("toDo-test server running at http://localhost:" + PORT);
});
