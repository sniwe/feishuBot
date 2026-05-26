const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const config = require("./config");
const { parseRequestUrl, sendJson, readJsonBody, readBodyBuffer, streamFile, streamAudioBinary } = require("./utils");
const { createRuntimeLogStore } = require("./runtime-log-store");
const { AUTH_SESSIONS, createAuthSession, requireAuthUser, handlePostAuthPing, normalizeUsername } = require("./auth");
const {
  normalizeSessionId,
  buildSessionId,
  getSessionFilePath,
  isOwnedByUser,
  isValidSessionPayload,
  readSessionSummaries,
  refreshLatestSessionAfterDelete,
  isAudioReferencedByAnySession,
  normalizeLoadedSession,
  parseRevision
} = require("./session-store");
const {
  getAudioBinaryPath,
  getAudioMetadataPath,
  saveLocalAudioFromBase64,
  readAudioMetadata,
  deleteAudioById
} = require("./audio-store");
const {
  readRemoteSessionSummaries,
  getRemoteSession,
  saveRemoteSession,
  deleteRemoteSession,
  saveRemoteAudio,
  remoteFetch,
  withRemoteUserHeaders
} = require("./remote-store");

let runtimeLogStore = null;
let serverLogTarget = null;

startServer({ data: {}, deps: { fs, fsp, http, path } }).catch(function (error) {
  console.error(error);
  process.exit(1);
});

async function startServer(ctx) {
  const { deps } = ctx;
  if (!config.IS_REMOTE_STORAGE) {
    await deps.fsp.mkdir(config.DATA_DIR, { recursive: true });
    await deps.fsp.mkdir(config.SESSIONS_DIR, { recursive: true });
    await deps.fsp.mkdir(config.AUDIO_DIR, { recursive: true });
  }

  runtimeLogStore = createRuntimeLogStore({ deps: { fsp: deps.fsp } });
  serverLogTarget = await runtimeLogStore.allocateRuntimeTarget({
    data: {
      runtimeId: "server-" + String(process.pid),
      label: "server",
      date: new Date()
    },
    deps: {}
  });
  runtimeLogStore.createConsoleTee({ data: { target: serverLogTarget, consoleRef: console }, deps: {} });
  console.info("[audioTest] server log target ready", serverLogTarget);

  const server = deps.http.createServer(function (req, res) {
    routeRequest({ data: { req, res }, deps: { fs: deps.fs, fsp: deps.fsp, path: deps.path } }).catch(function (error) {
      sendJson({ data: { res, status: 500, payload: { error: "internal_error", detail: String(error && error.message ? error.message : error) } }, deps: {} });
    });
  });

  await new Promise(function (resolve) {
    server.listen(config.PORT, resolve);
  });

  console.log("audioTest server listening on http://localhost:" + config.PORT);
}

function logServerEvent(ctx) {
  const { data = {} } = ctx || {};
  if (data.req && !shouldLogServerEvents(data.req)) {
    return;
  }
  if (!runtimeLogStore || !serverLogTarget) {
    return;
  }
  void runtimeLogStore.appendEntry({
    data: {
      runtimeId: serverLogTarget.runtimeId,
      entry: {
        ts: new Date(),
        source: String(data.source || "server"),
        level: String(data.level || "info"),
        kind: String(data.kind || "action"),
        label: String(data.label || ""),
        detail: data.detail || {}
      }
    },
    deps: {}
  });
}

function shouldLogServerEvents(req) {
  const cookie = String(req && req.headers && req.headers.cookie ? req.headers.cookie : "");
  if (!cookie) {
    return true;
  }
  return !/(?:^|;\s*)audioTest\.stateActionLoggingEnabled=(?:0|false)(?:;|$)/i.test(cookie);
}

async function routeRequest(ctx) {
  const { data, deps } = ctx;
  const { req, res } = data;
  const requestUrl = parseRequestUrl({ data: { rawUrl: req.url }, deps: {} });
  const requestPath = requestUrl.pathname;
  if (shouldLogServerEvents(req)) {
    logServerEvent({
      data: {
        req,
        source: "request",
        level: "info",
        kind: "action",
        label: req.method + " " + requestPath,
        detail: {
          url: req.url
        }
      }
    });
  }

  if (req.method === "POST" && requestPath === "/api/runtime-log/start") {
    await handlePostRuntimeLogStart({ data: { req, res }, deps });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/runtime-log/entry-batch") {
    await handlePostRuntimeLogEntryBatch({ data: { req, res }, deps });
    return;
  }

  if (req.method === "GET" && requestPath === "/api/sessions") {
    await handleGetSessions({ data: { req, res }, deps });
    return;
  }

  if (req.method === "GET" && requestPath === "/api/session") {
    await handleGetSession({ data: { req, res, sessionId: requestUrl.searchParams.get("id") }, deps });
    return;
  }

  if (req.method === "GET" && requestPath === "/api/audio") {
    await handleGetAudio({ data: { req, res, audioId: requestUrl.searchParams.get("id") }, deps });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/session") {
    await handlePostSession({ data: { req, res }, deps });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/login") {
    await handlePostLogin({ data: { req, res }, deps });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/auth/ping") {
    await handlePostAuthPing({ data: { req, res }, deps });
    return;
  }

  if (req.method === "DELETE" && requestPath === "/api/session") {
    await handleDeleteSession({ data: { req, res, sessionId: requestUrl.searchParams.get("id") }, deps });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/audio") {
    await handlePostAudio({
      data: {
        req,
        res,
        fileName: requestUrl.searchParams.get("name"),
        mimeType: requestUrl.searchParams.get("type"),
        lastModified: requestUrl.searchParams.get("lastModified")
      },
      deps
    });
    return;
  }

  if (req.method === "GET") {
    await handleStatic({ data: { res, requestPath }, deps });
    return;
  }

  sendJson({ data: { res, status: 405, payload: { error: "method_not_allowed" } }, deps: {} });
}

async function handlePostRuntimeLogStart(ctx) {
  const { data, deps } = ctx;
  const { req, res } = data;

  let payload;
  try {
    payload = await readJsonBody({ data: { req }, deps: {} });
  } catch (error) {
    sendJson({ data: { res, status: 400, payload: { error: "invalid_json", detail: String(error && error.message ? error.message : error) } }, deps: {} });
    return;
  }

  if (!runtimeLogStore) {
    sendJson({ data: { res, status: 503, payload: { error: "runtime_log_unavailable" } }, deps: {} });
    return;
  }

  const target = await runtimeLogStore.allocateRuntimeTarget({
    data: {
      runtimeId: String(payload.runtimeId || "").trim() || undefined,
      label: String(payload.runtimeKind || "frontend").trim() || "frontend",
      date: new Date(),
      forceNewTarget: payload.forceNewTarget === true,
      bootId: String(payload.bootId || "").trim()
    },
    deps: {}
  });

  logServerEvent({
    data: {
      req,
      source: "runtime-log",
      level: "info",
      kind: "action",
      label: "runtime-log:start",
      detail: {
        runtimeKind: String(payload.runtimeKind || "frontend"),
        location: String(payload.location || ""),
        userAgent: String(payload.userAgent || ""),
        target
      }
    }
  });

  sendJson({ data: { res, status: 200, payload: { runtimeId: target.runtimeId, target } }, deps: {} });
}

async function handlePostRuntimeLogEntryBatch(ctx) {
  const { data, deps } = ctx;
  const { req, res } = data;

  let payload;
  try {
    payload = await readJsonBody({ data: { req }, deps: {} });
  } catch (error) {
    sendJson({ data: { res, status: 400, payload: { error: "invalid_json", detail: String(error && error.message ? error.message : error) } }, deps: {} });
    return;
  }

  const runtimeId = String(payload.runtimeId || "").trim();
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  if (!runtimeId || !entries.length || !runtimeLogStore) {
    sendJson({ data: { res, status: 400, payload: { error: "invalid_payload" } }, deps: {} });
    return;
  }

  await runtimeLogStore.appendLines({
    data: {
      runtimeId,
      entries
    },
    deps: {}
  });

  sendJson({ data: { res, status: 200, payload: { ok: true } }, deps: {} });
}

async function handleGetSessions(ctx) {
  const { data, deps } = ctx;
  const { req, res } = data;
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }

  const sessions = config.IS_REMOTE_STORAGE
    ? await readRemoteSessionSummaries({ data: { username: authUser }, deps: {} })
    : await readSessionSummaries({ data: { username: authUser }, deps: { fsp: deps.fsp, path: deps.path } });
  sendJson({ data: { res, status: 200, payload: { sessions } }, deps: {} });
}

async function handleGetSession(ctx) {
  const { data, deps } = ctx;
  const { req, res, sessionId } = data;
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }

  if (config.IS_REMOTE_STORAGE) {
    try {
      const session = await getRemoteSession({ data: { sessionId, username: authUser }, deps: {} });
      sendJson({ data: { res, status: 200, payload: session }, deps: {} });
    } catch (error) {
      if (error && error.code === "REMOTE_SESSION_NOT_FOUND") {
        sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
        return;
      }
      throw error;
    }
    return;
  }

  const resolvedSessionId = normalizeSessionId({ data: { sessionId }, deps: {} });

  try {
    if (!resolvedSessionId) {
      const text = await deps.fsp.readFile(config.SESSION_PATH, "utf8");
      const parsed = JSON.parse(text);
      if (!isOwnedByUser({ data: { record: parsed, username: authUser }, deps: {} })) {
        sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
        return;
      }
      const normalized = await normalizeLoadedSession({
        data: { record: parsed },
        deps: { fsp: deps.fsp, path: deps.path, saveLocalAudioFromBase64 }
      });
      sendJson({ data: { res, status: 200, payload: normalized }, deps: {} });
      return;
    }

    const sessionPath = getSessionFilePath({ data: { sessionId: resolvedSessionId }, deps: { path: deps.path } });
    const text = await deps.fsp.readFile(sessionPath, "utf8");
    const parsed = JSON.parse(text);
    if (!isOwnedByUser({ data: { record: parsed, username: authUser }, deps: {} })) {
      sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
      return;
    }
    const normalized = await normalizeLoadedSession({
      data: { record: parsed },
      deps: { fsp: deps.fsp, path: deps.path, saveLocalAudioFromBase64 }
    });
    sendJson({ data: { res, status: 200, payload: normalized }, deps: {} });
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
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }

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

  logServerEvent({
    data: {
      req,
      source: "session",
      level: "info",
      kind: "state",
      label: "session:save",
      detail: {
        username: authUser,
        sessionId: String(payload.sessionId || ""),
        fileName: payload.file && payload.file.name ? String(payload.file.name) : "",
        baseRevision: payload.baseRevision,
        playbackKeys: Object.keys(payload.playback || {})
      }
    }
  });

  if (config.IS_REMOTE_STORAGE) {
    const saved = await saveRemoteSession({ data: { payload, username: authUser }, deps: {} });
    sendJson({
      data: {
        res,
        status: 200,
        payload: {
          ok: true,
          id: saved.id,
          path: "remote://session/" + String(saved.id || ""),
          revision: parseRevision({ data: { value: saved && saved.revision, fallback: 0 }, deps: {} }),
          updatedAt: saved && saved.updatedAt ? saved.updatedAt : (saved && saved.savedAt ? saved.savedAt : new Date().toISOString())
        }
      },
      deps: {}
    });
    return;
  }

  const sessionId = normalizeSessionId({ data: { sessionId: payload.sessionId }, deps: {} }) || buildSessionId({ data: { fileName: payload.file && payload.file.name }, deps: {} });
  const sessionPath = getSessionFilePath({ data: { sessionId }, deps: { path: deps.path } });
  let existingRecord = null;
  try {
    const existingText = await deps.fsp.readFile(sessionPath, "utf8");
    existingRecord = JSON.parse(existingText);
    if (existingRecord && !isOwnedByUser({ data: { record: existingRecord, username: authUser }, deps: {} })) {
      sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
      return;
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }

  const currentRevision = parseRevision({ data: { value: existingRecord && existingRecord.revision, fallback: 0 }, deps: {} });
  if (payload.baseRevision != null) {
    const baseRevision = parseRevision({ data: { value: payload.baseRevision, fallback: 0 }, deps: {} });
    if (baseRevision < currentRevision) {
      sendJson({
        data: {
          res,
          status: 409,
          payload: {
            error: "session_conflict",
            sessionId,
            currentRevision,
            currentSavedAt: existingRecord && existingRecord.savedAt ? existingRecord.savedAt : "",
            message: "baseRevision is stale"
          }
        },
        deps: {}
      });
      return;
    }
  }

  const nowIso = new Date().toISOString();
  const record = {
    id: sessionId,
    owner: authUser,
    savedAt: nowIso,
    updatedAt: nowIso,
    revision: currentRevision + 1,
    file: payload.file,
    playback: payload.playback,
    audioId: normalizeSessionId({ data: { sessionId: payload.audioId }, deps: {} }) || "",
    audioUrl: payload.audioUrl ? String(payload.audioUrl) : ""
  };

  if (!record.audioId && payload.audioBase64) {
    const uploadedAudio = await saveLocalAudioFromBase64({
      data: { payload, owner: authUser },
      deps: { fsp: deps.fsp, path: deps.path }
    });
    record.audioId = uploadedAudio.id;
  }

  if (record.audioId) {
    const audioMeta = await readAudioMetadata({
      data: { audioId: record.audioId },
      deps: { fsp: deps.fsp, path: deps.path }
    });
    if (!audioMeta || !isOwnedByUser({ data: { record: audioMeta, username: authUser }, deps: {} })) {
      sendJson({ data: { res, status: 403, payload: { error: "forbidden_audio_owner" } }, deps: {} });
      return;
    }
  }

  if (!record.audioId && !record.audioUrl) {
    sendJson({ data: { res, status: 400, payload: { error: "missing_audio_reference" } }, deps: {} });
    return;
  }

  await deps.fsp.mkdir(config.DATA_DIR, { recursive: true });
  await deps.fsp.mkdir(config.SESSIONS_DIR, { recursive: true });
  await deps.fsp.writeFile(sessionPath, JSON.stringify(record, null, 2), "utf8");
  await deps.fsp.writeFile(config.SESSION_PATH, JSON.stringify(record, null, 2), "utf8");

  sendJson({
    data: {
      res,
      status: 200,
      payload: { ok: true, id: sessionId, path: sessionPath, revision: record.revision, updatedAt: record.updatedAt }
    },
    deps: {}
  });
}

async function handlePostLogin(ctx) {
  const { data } = ctx;
  const { req, res } = data;
  let payload;
  try {
    payload = await readJsonBody({ data: { req }, deps: {} });
  } catch (error) {
    sendJson({ data: { res, status: 400, payload: { error: "invalid_json", detail: String(error && error.message ? error.message : error) } }, deps: {} });
    return;
  }

  const username = normalizeUsername({ data: { username: payload && payload.username }, deps: {} });
  const password = payload && typeof payload.password === "string" ? payload.password : "";
  if (!username || !password) {
    sendJson({ data: { res, status: 400, payload: { ok: false, error: "missing_credentials" } }, deps: {} });
    return;
  }

  logServerEvent({
    data: {
      req,
      source: "auth",
      level: "info",
      kind: "action",
      label: "login:attempt",
      detail: {
        username
      }
    }
  });

  const expectedPassword = config.USER_CREDENTIALS[username];
  if (!expectedPassword || password !== expectedPassword) {
    sendJson({ data: { res, status: 401, payload: { ok: false, error: "invalid_credentials" } }, deps: {} });
    return;
  }
  const authSession = createAuthSession({ data: { username }, deps: {} });

  sendJson({
    data: {
      res,
      status: 200,
      payload: {
        ok: true,
        username,
        token: authSession.token,
        loggedInAt: authSession.loggedInAt,
        ttlMs: config.LOGIN_TTL_MS
      }
    },
    deps: {}
  });
}

async function handleDeleteSession(ctx) {
  const { data, deps } = ctx;
  const { req, res, sessionId } = data;
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }
  const resolvedSessionId = normalizeSessionId({ data: { sessionId }, deps: {} });

  if (!resolvedSessionId) {
    sendJson({ data: { res, status: 400, payload: { error: "invalid_session_id" } }, deps: {} });
    return;
  }

  logServerEvent({
    data: {
      req,
      source: "session",
      level: "warn",
      kind: "state",
      label: "session:delete",
      detail: {
        username: authUser,
        sessionId: resolvedSessionId
      }
    }
  });

  if (config.IS_REMOTE_STORAGE) {
    const deleted = await deleteRemoteSession({ data: { sessionId: resolvedSessionId, username: authUser }, deps: {} });
    sendJson({ data: { res, status: 200, payload: deleted }, deps: {} });
    return;
  }

  const sessionPath = getSessionFilePath({ data: { sessionId: resolvedSessionId }, deps: { path: deps.path } });
  let deletedRecord = null;
  try {
    const text = await deps.fsp.readFile(sessionPath, "utf8");
    deletedRecord = JSON.parse(text);
    if (!isOwnedByUser({ data: { record: deletedRecord, username: authUser }, deps: {} })) {
      sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
      return;
    }
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
      return;
    }
    throw error;
  }

  await deps.fsp.unlink(sessionPath).catch(function () {});
  await refreshLatestSessionAfterDelete({ data: { deletedSessionId: resolvedSessionId }, deps: { fsp: deps.fsp, path: deps.path } });

  const deletedAudioId = normalizeSessionId({ data: { sessionId: deletedRecord && deletedRecord.audioId }, deps: {} });
  if (deletedAudioId) {
    const stillReferenced = await isAudioReferencedByAnySession({
      data: { audioId: deletedAudioId, ignoreSessionId: resolvedSessionId },
      deps: { fsp: deps.fsp, path: deps.path }
    });
    if (!stillReferenced) {
      await deleteAudioById({ data: { audioId: deletedAudioId }, deps: { fsp: deps.fsp, path: deps.path } });
    }
  }

  sendJson({ data: { res, status: 200, payload: { ok: true, id: resolvedSessionId } }, deps: {} });
}

async function handlePostAudio(ctx) {
  const { data, deps } = ctx;
  const { req, res, fileName, mimeType, lastModified } = data;
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }

  if (config.IS_REMOTE_STORAGE) {
    const bodyBuffer = await readBodyBuffer({ data: { req }, deps: {} });
    const result = await saveRemoteAudio({
      data: { bodyBuffer, fileName, mimeType, lastModified, username: authUser },
      deps: {}
    });
    sendJson({ data: { res, status: 200, payload: result }, deps: {} });
    return;
  }

  const bodyBuffer = await readBodyBuffer({ data: { req }, deps: {} });
  if (!bodyBuffer.length) {
    sendJson({ data: { res, status: 400, payload: { error: "empty_audio_payload" } }, deps: {} });
    return;
  }

  const audioId = buildSessionId({ data: { fileName: fileName || "audio" }, deps: {} });
  const binaryPath = getAudioBinaryPath({ data: { audioId }, deps: { path: deps.path } });
  const metadataPath = getAudioMetadataPath({ data: { audioId }, deps: { path: deps.path } });
  const resolvedMimeType = String(mimeType || req.headers["content-type"] || "application/octet-stream").slice(0, 120);
  const resolvedFileName = String(fileName || "audio.bin").slice(0, 255);
  const resolvedLastModified = Number(lastModified || Date.now());

  logServerEvent({
    data: {
      req,
      source: "audio",
      level: "info",
      kind: "action",
      label: "audio:upload",
      detail: {
        username: authUser,
        fileName: resolvedFileName,
        mimeType: resolvedMimeType,
        lastModified: resolvedLastModified,
        byteLength: req && req.headers && req.headers["content-length"] ? Number(req.headers["content-length"]) : null
      }
    }
  });

  await deps.fsp.mkdir(config.AUDIO_DIR, { recursive: true });
  await deps.fsp.writeFile(binaryPath, bodyBuffer);
  await deps.fsp.writeFile(metadataPath, JSON.stringify({
    id: audioId,
    owner: authUser,
    fileName: resolvedFileName,
    mimeType: resolvedMimeType,
    size: bodyBuffer.length,
    lastModified: Number.isFinite(resolvedLastModified) ? resolvedLastModified : Date.now(),
    savedAt: new Date().toISOString()
  }, null, 2), "utf8");

  sendJson({
    data: {
      res,
      status: 200,
      payload: {
        ok: true,
        audio: {
          id: audioId,
          fileName: resolvedFileName,
          mimeType: resolvedMimeType,
          size: bodyBuffer.length,
          lastModified: Number.isFinite(resolvedLastModified) ? resolvedLastModified : Date.now(),
          url: "/api/audio?id=" + encodeURIComponent(audioId)
        }
      }
    },
    deps: {}
  });
}

async function handleGetAudio(ctx) {
  const { data, deps } = ctx;
  const { req, res, audioId } = data;
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }
  const safeId = normalizeSessionId({ data: { sessionId: audioId }, deps: {} });

  if (!safeId) {
    sendJson({ data: { res, status: 404, payload: { error: "audio_not_found" } }, deps: {} });
    return;
  }

  if (config.IS_REMOTE_STORAGE) {
    const rangeHeader = req && req.headers && req.headers.range ? String(req.headers.range) : "";
    const headers = {};
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }
    const response = await remoteFetch({
      data: {
        method: "GET",
        endpointPath: config.REMOTE_AUDIO_PATH + "?id=" + encodeURIComponent(safeId) + "&username=" + encodeURIComponent(authUser),
        headers: withRemoteUserHeaders({ data: { username: authUser, headers }, deps: {} })
      },
      deps: {}
    });
    res.writeHead(response.status, {
      "Content-Type": response.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "no-store",
      "Accept-Ranges": response.headers.get("accept-ranges") || "bytes",
      ...(response.headers.get("content-range") ? { "Content-Range": response.headers.get("content-range") } : {}),
      ...(response.headers.get("content-length") ? { "Content-Length": response.headers.get("content-length") } : {})
    });
    const arrayBuffer = await response.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
    return;
  }

  const metadataPath = getAudioMetadataPath({ data: { audioId: safeId }, deps: { path: deps.path } });
  const binaryPath = getAudioBinaryPath({ data: { audioId: safeId }, deps: { path: deps.path } });

  let meta = {};
  try {
    const raw = await deps.fsp.readFile(metadataPath, "utf8");
    meta = JSON.parse(raw);
    if (!isOwnedByUser({ data: { record: meta, username: authUser }, deps: {} })) {
      sendJson({ data: { res, status: 404, payload: { error: "audio_not_found" } }, deps: {} });
      return;
    }
  } catch {
    sendJson({ data: { res, status: 404, payload: { error: "audio_not_found" } }, deps: {} });
    return;
  }

  await streamAudioBinary({
    data: {
      req,
      res,
      filePath: binaryPath,
      contentType: String(meta.mimeType || "application/octet-stream")
    },
    deps: { fs: deps.fs, fsp: deps.fsp }
  });
}

async function handleStatic(ctx) {
  const { data, deps } = ctx;
  const { res, requestPath } = data;

  if (requestPath === "/" || requestPath === "/index.html") {
    await streamFile({ data: { res, filePath: path.join(config.PUBLIC_DIR, "index.html") }, deps: { fs: deps.fs } });
    return;
  }

  if (requestPath.startsWith("/frontend/")) {
    const relativePath = requestPath.slice("/frontend/".length);
    const normalized = deps.path.normalize(relativePath);
    const resolvedPath = deps.path.resolve(config.FRONTEND_DIR, normalized);
    if (!resolvedPath.startsWith(config.FRONTEND_DIR + deps.path.sep) && resolvedPath !== config.FRONTEND_DIR) {
      sendJson({ data: { res, status: 404, payload: { error: "not_found" } }, deps: {} });
      return;
    }

    await streamFile({ data: { res, filePath: resolvedPath }, deps: { fs: deps.fs } });
    return;
  }

  sendJson({ data: { res, status: 404, payload: { error: "not_found" } }, deps: {} });
}

module.exports = {
  startServer,
  routeRequest,
  handleGetSessions,
  handleGetSession,
  handlePostSession,
  handlePostLogin,
  handleDeleteSession,
  handlePostAudio,
  handleGetAudio,
  handleStatic,
  AUTH_SESSIONS
};
