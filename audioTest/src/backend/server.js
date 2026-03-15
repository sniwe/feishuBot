const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "src", "public");
const FRONTEND_DIR = path.join(PROJECT_ROOT, "src", "frontend");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const SESSION_PATH = path.join(DATA_DIR, "session-latest.json");
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_SIZE = 1024 * 1024 * 500;

startServer({ data: {}, deps: { http, fs, fsp, path } }).catch(function (error) {
  console.error(error);
  process.exit(1);
});

async function startServer(ctx) {
  const { deps } = ctx;
  await deps.fsp.mkdir(DATA_DIR, { recursive: true });
  await deps.fsp.mkdir(SESSIONS_DIR, { recursive: true });

  const server = deps.http.createServer(function (req, res) {
    routeRequest({ data: { req, res }, deps: { fs: deps.fs, fsp: deps.fsp, path: deps.path } }).catch(function (error) {
      sendJson({ data: { res, status: 500, payload: { error: "internal_error", detail: String(error && error.message ? error.message : error) } }, deps: {} });
    });
  });

  await new Promise(function (resolve) {
    server.listen(PORT, resolve);
  });

  console.log("audioTest server listening on http://localhost:" + PORT);
}

async function routeRequest(ctx) {
  const { data, deps } = ctx;
  const { req, res } = data;
  const requestUrl = parseRequestUrl({ data: { rawUrl: req.url }, deps: {} });
  const requestPath = requestUrl.pathname;

  if (req.method === "GET" && requestPath === "/api/sessions") {
    await handleGetSessions({ data: { res }, deps: { fsp: deps.fsp, path: deps.path } });
    return;
  }

  if (req.method === "GET" && requestPath === "/api/session") {
    await handleGetSession({ data: { res, sessionId: requestUrl.searchParams.get("id") }, deps: { fsp: deps.fsp, path: deps.path } });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/session") {
    await handlePostSession({ data: { req, res }, deps: { fsp: deps.fsp, path: deps.path } });
    return;
  }

  if (req.method === "GET") {
    await handleStatic({ data: { res, requestPath }, deps: { fs: deps.fs, path: deps.path } });
    return;
  }

  sendJson({ data: { res, status: 405, payload: { error: "method_not_allowed" } }, deps: {} });
}

async function handleGetSessions(ctx) {
  const { data, deps } = ctx;
  const { res } = data;

  const sessions = await readSessionSummaries({ data: {}, deps: { fsp: deps.fsp, path: deps.path } });
  sendJson({ data: { res, status: 200, payload: { sessions } }, deps: {} });
}

async function handleGetSession(ctx) {
  const { data, deps } = ctx;
  const { res, sessionId } = data;

  const resolvedSessionId = normalizeSessionId({ data: { sessionId }, deps: {} });

  try {
    if (!resolvedSessionId) {
      const text = await deps.fsp.readFile(SESSION_PATH, "utf8");
      const parsed = JSON.parse(text);
      sendJson({ data: { res, status: 200, payload: parsed }, deps: {} });
      return;
    }

    const sessionPath = getSessionFilePath({ data: { sessionId: resolvedSessionId }, deps: { path: deps.path } });
    const text = await deps.fsp.readFile(sessionPath, "utf8");
    const parsed = JSON.parse(text);
    sendJson({ data: { res, status: 200, payload: parsed }, deps: {} });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
      return;
    }
    throw error;
  }
}

async function handlePostSession(ctx) {
  const { data, deps } = ctx;
  const { req, res } = data;

  let payload;
  try {
    payload = await readJsonBody({ data: { req }, deps: {} });
  } catch (error) {
    sendJson({ data: { res, status: 400, payload: { error: "invalid_json", detail: String(error && error.message ? error.message : error) } }, deps: {} });
    return;
  }

  if (!isValidSessionPayload({ data: { payload }, deps: {} })) {
    sendJson({ data: { res, status: 400, payload: { error: "invalid_payload" } }, deps: {} });
    return;
  }

  const sessionId = normalizeSessionId({ data: { sessionId: payload.sessionId }, deps: {} }) || buildSessionId({ data: { fileName: payload.file && payload.file.name }, deps: {} });
  const sessionPath = getSessionFilePath({ data: { sessionId }, deps: { path: deps.path } });

  const record = {
    id: sessionId,
    savedAt: new Date().toISOString(),
    file: payload.file,
    playback: payload.playback,
    audioBase64: payload.audioBase64
  };

  await deps.fsp.mkdir(DATA_DIR, { recursive: true });
  await deps.fsp.mkdir(SESSIONS_DIR, { recursive: true });
  await deps.fsp.writeFile(sessionPath, JSON.stringify(record, null, 2), "utf8");
  await deps.fsp.writeFile(SESSION_PATH, JSON.stringify(record, null, 2), "utf8");

  sendJson({ data: { res, status: 200, payload: { ok: true, id: sessionId, path: sessionPath } }, deps: {} });
}

async function readSessionSummaries(ctx) {
  const { deps } = ctx;

  let fileEntries = [];
  try {
    fileEntries = await deps.fsp.readdir(SESSIONS_DIR, { withFileTypes: true });
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }

  const sessions = [];

  for (const entry of fileEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const filePath = deps.path.join(SESSIONS_DIR, entry.name);
    try {
      const text = await deps.fsp.readFile(filePath, "utf8");
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        sessions.push(toSessionSummary({ data: { parsed, fallbackId: entry.name.slice(0, -5) }, deps: {} }));
      }
    } catch {
      // Ignore malformed records so one bad file does not break list rendering.
    }
  }

  if (!sessions.length) {
    try {
      const latestText = await deps.fsp.readFile(SESSION_PATH, "utf8");
      const latest = JSON.parse(latestText);
      if (latest && typeof latest === "object" && latest.audioBase64) {
        sessions.push(toSessionSummary({ data: { parsed: latest, fallbackId: "session-latest" }, deps: {} }));
      }
    } catch {
      // No legacy latest session available.
    }
  }

  sessions.sort(function (a, b) {
    return String(b.savedAt || "").localeCompare(String(a.savedAt || ""));
  });

  return sessions;
}

function toSessionSummary(ctx) {
  const { data } = ctx;
  const { parsed, fallbackId } = data;

  return {
    id: normalizeSessionId({ data: { sessionId: parsed.id }, deps: {} }) || fallbackId,
    savedAt: parsed.savedAt,
    file: parsed.file || {},
    playback: {
      checkpoints: Array.isArray(parsed.playback && parsed.playback.checkpoints)
        ? parsed.playback.checkpoints
        : []
    }
  };
}

async function handleStatic(ctx) {
  const { data, deps } = ctx;
  const { res, requestPath } = data;

  if (requestPath === "/" || requestPath === "/index.html") {
    await streamFile({ data: { res, filePath: path.join(PUBLIC_DIR, "index.html") }, deps: { fs: deps.fs } });
    return;
  }

  if (requestPath.startsWith("/frontend/")) {
    const relativePath = requestPath.slice("/frontend/".length);
    const resolvedPath = resolveFrontendPath({ data: { relativePath }, deps: { path: deps.path } });
    if (!resolvedPath) {
      sendJson({ data: { res, status: 404, payload: { error: "not_found" } }, deps: {} });
      return;
    }

    await streamFile({ data: { res, filePath: resolvedPath }, deps: { fs: deps.fs } });
    return;
  }

  sendJson({ data: { res, status: 404, payload: { error: "not_found" } }, deps: {} });
}

function parseRequestUrl(ctx) {
  const { data } = ctx;
  const { rawUrl } = data;
  return new URL(String(rawUrl || "/"), "http://localhost");
}

function resolveFrontendPath(ctx) {
  const { data, deps } = ctx;
  const { relativePath } = data;
  const normalized = deps.path.normalize(relativePath);
  const absolute = deps.path.resolve(FRONTEND_DIR, normalized);
  if (!absolute.startsWith(FRONTEND_DIR + deps.path.sep) && absolute !== FRONTEND_DIR) {
    return null;
  }
  return absolute;
}

function normalizeSessionId(ctx) {
  const { data } = ctx;
  const { sessionId } = data;
  const value = String(sessionId || "").trim().toLowerCase();
  if (!value) {
    return "";
  }
  const sanitized = value.replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return sanitized.slice(0, 80);
}

function buildSessionId(ctx) {
  const { data } = ctx;
  const { fileName } = data;
  const base = normalizeSessionId({ data: { sessionId: fileName || "audio" }, deps: {} }) || "audio";
  const stamp = Date.now().toString(36);
  const nonce = Math.random().toString(36).slice(2, 8);
  return base.slice(0, 48) + "-" + stamp + "-" + nonce;
}

function getSessionFilePath(ctx) {
  const { data, deps } = ctx;
  const { sessionId } = data;
  const safeId = normalizeSessionId({ data: { sessionId }, deps: {} });
  return deps.path.join(SESSIONS_DIR, safeId + ".json");
}

function isValidSessionPayload(ctx) {
  const { data } = ctx;
  const { payload } = data;
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (payload.sessionId != null && typeof payload.sessionId !== "string") {
    return false;
  }
  if (!payload.file || typeof payload.file !== "object") {
    return false;
  }
  if (!payload.playback || typeof payload.playback !== "object") {
    return false;
  }
  if (!payload.audioBase64 || typeof payload.audioBase64 !== "string") {
    return false;
  }
  return true;
}

function streamFile(ctx) {
  const { data, deps } = ctx;
  const { res, filePath } = data;

  return new Promise(function (resolve) {
    const ext = path.extname(filePath).toLowerCase();
    const type = ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : "application/octet-stream";

    const stream = deps.fs.createReadStream(filePath);
    stream.on("error", function () {
      sendJson({ data: { res, status: 404, payload: { error: "not_found" } }, deps: {} });
      resolve();
    });

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": "no-store"
    });

    stream.on("end", resolve);
    stream.pipe(res);
  });
}

function readJsonBody(ctx) {
  const { data } = ctx;
  const { req } = data;

  return readBodyText({ data: { req }, deps: {} }).then(function (bodyText) {
    return JSON.parse(bodyText || "{}");
  });
}

function readBodyText(ctx) {
  const { data } = ctx;
  const { req } = data;

  return new Promise(function (resolve, reject) {
    let body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("payload_too_large"));
      }
    });
    req.on("end", function () { resolve(body); });
    req.on("error", reject);
  });
}

function sendJson(ctx) {
  const { data } = ctx;
  const { res, status, payload } = data;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}
