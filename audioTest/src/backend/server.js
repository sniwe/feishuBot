const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "src", "public");
const FRONTEND_DIR = path.join(PROJECT_ROOT, "src", "frontend");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const SESSION_PATH = path.join(DATA_DIR, "session-latest.json");
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_SIZE = 1024 * 1024 * 500;
const LOGIN_TTL_MS = Number(process.env.LOGIN_IDLE_TTL_MS || (5 * 60 * 1000));
const STORAGE_PROVIDER = String(process.env.SESSION_STORE || "local").trim().toLowerCase();
const REMOTE_BASE_URL = String(process.env.REMOTE_BASE_URL || "https://braggadocian-osteometrical-petronila.ngrok-free.dev").trim().replace(/\/+$/g, "");
const REMOTE_TIMEOUT_MS = Number(process.env.REMOTE_TIMEOUT_MS || 60000);
const REMOTE_SESSIONS_PATH = String(process.env.REMOTE_SESSIONS_PATH || "/api/sessions").trim() || "/api/sessions";
const REMOTE_SESSION_PATH = String(process.env.REMOTE_SESSION_PATH || "/api/session").trim() || "/api/session";
const REMOTE_AUDIO_PATH = String(process.env.REMOTE_AUDIO_PATH || "/api/audio").trim() || "/api/audio";
const IS_REMOTE_STORAGE = STORAGE_PROVIDER === "remote" || STORAGE_PROVIDER === "ngrok";
const USER_CREDENTIALS = {
  zhaoying: String(process.env.USER_PASSWORD_ZHAOYING || "zhaoying123"),
  rhys: String(process.env.USER_PASSWORD_RHYS || "rhys123")
};
const AUTH_SESSIONS = new Map();

startServer({ data: {}, deps: { http, fs, fsp, path } }).catch(function (error) {
  console.error(error);
  process.exit(1);
});

async function startServer(ctx) {
  const { deps } = ctx;
  if (!IS_REMOTE_STORAGE) {
    await deps.fsp.mkdir(DATA_DIR, { recursive: true });
    await deps.fsp.mkdir(SESSIONS_DIR, { recursive: true });
    await deps.fsp.mkdir(AUDIO_DIR, { recursive: true });
  }

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
    await handleGetSessions({ data: { req, res }, deps: { fsp: deps.fsp, path: deps.path } });
    return;
  }

  if (req.method === "GET" && requestPath === "/api/session") {
    await handleGetSession({ data: { req, res, sessionId: requestUrl.searchParams.get("id") }, deps: { fsp: deps.fsp, path: deps.path } });
    return;
  }

  if (req.method === "GET" && requestPath === "/api/audio") {
    await handleGetAudio({ data: { req, res, audioId: requestUrl.searchParams.get("id") }, deps: { fs: deps.fs, fsp: deps.fsp, path: deps.path } });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/session") {
    await handlePostSession({ data: { req, res }, deps: { fsp: deps.fsp, path: deps.path } });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/login") {
    await handlePostLogin({ data: { req, res }, deps: {} });
    return;
  }

  if (req.method === "POST" && requestPath === "/api/auth/ping") {
    await handlePostAuthPing({ data: { req, res }, deps: {} });
    return;
  }

  if (req.method === "DELETE" && requestPath === "/api/session") {
    await handleDeleteSession({ data: { req, res, sessionId: requestUrl.searchParams.get("id") }, deps: { fsp: deps.fsp, path: deps.path } });
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
      deps: { fsp: deps.fsp, path: deps.path, fs: deps.fs }
    });
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
  const { req, res } = data;
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }

  const sessions = IS_REMOTE_STORAGE
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

  if (IS_REMOTE_STORAGE) {
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
      const text = await deps.fsp.readFile(SESSION_PATH, "utf8");
      const parsed = JSON.parse(text);
      if (!isOwnedByUser({ data: { record: parsed, username: authUser }, deps: {} })) {
        sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
        return;
      }
      const normalized = await normalizeLoadedSession({ data: { record: parsed }, deps: { fsp: deps.fsp, path: deps.path } });
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
    const normalized = await normalizeLoadedSession({ data: { record: parsed }, deps: { fsp: deps.fsp, path: deps.path } });
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

  if (IS_REMOTE_STORAGE) {
    const saved = await saveRemoteSession({ data: { payload, username: authUser }, deps: {} });
    sendJson({
      data: {
        res,
        status: 200,
        payload: { ok: true, id: saved.id, path: "remote://session/" + String(saved.id || "") }
      },
      deps: {}
    });
    return;
  }

  const sessionId = normalizeSessionId({ data: { sessionId: payload.sessionId }, deps: {} }) || buildSessionId({ data: { fileName: payload.file && payload.file.name }, deps: {} });
  const sessionPath = getSessionFilePath({ data: { sessionId }, deps: { path: deps.path } });
  if (normalizeSessionId({ data: { sessionId: payload.sessionId }, deps: {} })) {
    try {
      const existingText = await deps.fsp.readFile(sessionPath, "utf8");
      const existingRecord = JSON.parse(existingText);
      if (!isOwnedByUser({ data: { record: existingRecord, username: authUser }, deps: {} })) {
        sendJson({ data: { res, status: 404, payload: { error: "session_not_found" } }, deps: {} });
        return;
      }
    } catch (error) {
      if (!error || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  const record = {
    id: sessionId,
    owner: authUser,
    savedAt: new Date().toISOString(),
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

  await deps.fsp.mkdir(DATA_DIR, { recursive: true });
  await deps.fsp.mkdir(SESSIONS_DIR, { recursive: true });
  await deps.fsp.writeFile(sessionPath, JSON.stringify(record, null, 2), "utf8");
  await deps.fsp.writeFile(SESSION_PATH, JSON.stringify(record, null, 2), "utf8");

  sendJson({ data: { res, status: 200, payload: { ok: true, id: sessionId, path: sessionPath } }, deps: {} });
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

  const expectedPassword = USER_CREDENTIALS[username];
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
        ttlMs: LOGIN_TTL_MS
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

  if (IS_REMOTE_STORAGE) {
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

async function readSessionSummaries(ctx) {
  const { data, deps } = ctx;
  const { username } = data;

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
      if (parsed && typeof parsed === "object" && isOwnedByUser({ data: { record: parsed, username }, deps: {} })) {
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
      if (
        latest &&
        typeof latest === "object" &&
        (latest.audioBase64 || latest.audioId || latest.audioUrl) &&
        isOwnedByUser({ data: { record: latest, username }, deps: {} })
      ) {
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
  const checkpoints = Array.isArray(parsed.playback && parsed.playback.checkpoints)
    ? parsed.playback.checkpoints
    : [];
  const subSegs = Array.isArray(parsed.playback && parsed.playback.subSegs)
    ? parsed.playback.subSegs
    : [];
  const subSegValueEntries = parsed && parsed.playback && parsed.playback.subSegValueEntries && typeof parsed.playback.subSegValueEntries === "object"
    ? parsed.playback.subSegValueEntries
    : {};
  const subSegValueKeyCount = Object.keys(subSegValueEntries).length;
  const inputCardCount = Object.keys(subSegValueEntries).reduce(function (sum, key) {
    const list = Array.isArray(subSegValueEntries[key]) ? subSegValueEntries[key] : [];
    return sum + list.length;
  }, 0);

  return {
    id: normalizeSessionId({ data: { sessionId: parsed.id }, deps: {} }) || fallbackId,
    savedAt: parsed.savedAt,
    file: parsed.file || {},
    playback: {
      checkpoints,
      subSegs,
      stats: {
        audSegs: Math.max(0, checkpoints.length + 1),
        subSegs: Math.max(subSegs.length, subSegValueKeyCount),
        inputCards: inputCardCount
      }
    },
    audioId: normalizeSessionId({ data: { sessionId: parsed.audioId }, deps: {} }) || "",
    audioUrl: typeof parsed.audioUrl === "string" ? parsed.audioUrl : ""
  };
}

async function handlePostAudio(ctx) {
  const { data, deps } = ctx;
  const { req, res, fileName, mimeType, lastModified } = data;
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }

  if (IS_REMOTE_STORAGE) {
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

  await deps.fsp.mkdir(AUDIO_DIR, { recursive: true });
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

  if (IS_REMOTE_STORAGE) {
    const rangeHeader = req && req.headers && req.headers.range ? String(req.headers.range) : "";
    const headers = {};
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }
    const response = await remoteFetch({
      data: {
        method: "GET",
        endpointPath: REMOTE_AUDIO_PATH + "?id=" + encodeURIComponent(safeId) + "&username=" + encodeURIComponent(authUser),
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

async function deleteAudioById(ctx) {
  const { data, deps } = ctx;
  const { audioId } = data;
  const safeId = normalizeSessionId({ data: { sessionId: audioId }, deps: {} });
  if (!safeId) {
    return;
  }
  const metadataPath = getAudioMetadataPath({ data: { audioId: safeId }, deps: { path: deps.path } });
  const binaryPath = getAudioBinaryPath({ data: { audioId: safeId }, deps: { path: deps.path } });
  await deps.fsp.unlink(metadataPath).catch(function () {});
  await deps.fsp.unlink(binaryPath).catch(function () {});
}

async function refreshLatestSessionAfterDelete(ctx) {
  const { deps } = ctx;
  let latestText = "";
  try {
    latestText = await deps.fsp.readFile(SESSION_PATH, "utf8");
  } catch {
    return;
  }

  let latest = null;
  try {
    latest = JSON.parse(latestText);
  } catch {
    latest = null;
  }
  if (!latest || typeof latest !== "object") {
    return;
  }

  const latestId = normalizeSessionId({ data: { sessionId: latest.id }, deps: {} });
  const deletedSessionId = normalizeSessionId({ data: { sessionId: ctx.data.deletedSessionId }, deps: {} });
  if (!latestId || latestId !== deletedSessionId) {
    return;
  }

  const summaries = await readSessionSummaries({ data: {}, deps: { fsp: deps.fsp, path: deps.path } });
  if (!summaries.length) {
    await deps.fsp.unlink(SESSION_PATH).catch(function () {});
    return;
  }

  const nextId = normalizeSessionId({ data: { sessionId: summaries[0].id }, deps: {} });
  if (!nextId) {
    await deps.fsp.unlink(SESSION_PATH).catch(function () {});
    return;
  }

  const nextPath = getSessionFilePath({ data: { sessionId: nextId }, deps: { path: deps.path } });
  try {
    const nextText = await deps.fsp.readFile(nextPath, "utf8");
    await deps.fsp.writeFile(SESSION_PATH, nextText, "utf8");
  } catch {
    await deps.fsp.unlink(SESSION_PATH).catch(function () {});
  }
}

async function isAudioReferencedByAnySession(ctx) {
  const { data, deps } = ctx;
  const { audioId, ignoreSessionId } = data;
  const safeAudioId = normalizeSessionId({ data: { sessionId: audioId }, deps: {} });
  const ignoredId = normalizeSessionId({ data: { sessionId: ignoreSessionId }, deps: {} });
  if (!safeAudioId) {
    return false;
  }

  let entries = [];
  try {
    entries = await deps.fsp.readdir(SESSIONS_DIR, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const sid = normalizeSessionId({ data: { sessionId: entry.name.slice(0, -5) }, deps: {} });
    if (sid && sid === ignoredId) {
      continue;
    }
    try {
      const raw = await deps.fsp.readFile(deps.path.join(SESSIONS_DIR, entry.name), "utf8");
      const parsed = JSON.parse(raw);
      const candidate = normalizeSessionId({ data: { sessionId: parsed && parsed.audioId }, deps: {} });
      if (candidate && candidate === safeAudioId) {
        return true;
      }
    } catch {
      // Ignore malformed rows.
    }
  }

  return false;
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

function normalizeUsername(ctx) {
  const { data } = ctx;
  const { username } = data;
  const value = String(username || "").trim().toLowerCase();
  if (!value) {
    return "";
  }
  return value.replace(/[^a-z0-9_-]/g, "");
}

function requireAuthUser(ctx) {
  const { data } = ctx;
  const { req, res } = data;
  const user = resolveAuthenticatedUser({ data: { req }, deps: {} });
  if (!user) {
    sendJson({ data: { res, status: 401, payload: { error: "auth_required" } }, deps: {} });
    return "";
  }
  return user;
}

function createAuthSession(ctx) {
  const { data } = ctx;
  const { username } = data;
  const loggedInAt = Date.now();
  const token = "tok_" + loggedInAt.toString(36) + "_" + Math.random().toString(36).slice(2, 12);
  AUTH_SESSIONS.set(token, {
    username,
    lastActivityAt: loggedInAt
  });
  return {
    token,
    loggedInAt
  };
}

async function handlePostAuthPing(ctx) {
  const { data } = ctx;
  const { req, res } = data;
  const authUser = requireAuthUser({ data: { req, res }, deps: {} });
  if (!authUser) {
    return;
  }
  sendJson({
    data: {
      res,
      status: 200,
      payload: { ok: true, username: authUser, serverNow: Date.now(), ttlMs: LOGIN_TTL_MS }
    },
    deps: {}
  });
}

function resolveAuthenticatedUser(ctx) {
  const { data } = ctx;
  const { req } = data;
  const requestUrl = parseRequestUrl({ data: { rawUrl: req && req.url ? req.url : "/" }, deps: {} });
  const username = normalizeUsername({
    data: {
      username:
        (req && req.headers ? req.headers["x-audio-user"] : "") ||
        requestUrl.searchParams.get("username")
    },
    deps: {}
  });
  const token = String(
    (req && req.headers ? req.headers["x-audio-auth"] || "" : "") ||
    requestUrl.searchParams.get("authToken") ||
    requestUrl.searchParams.get("token") ||
    ""
  ).trim();
  if (!username || !token || !USER_CREDENTIALS[username]) {
    return "";
  }
  const session = AUTH_SESSIONS.get(token);
  if (!session || session.username !== username) {
    return "";
  }
  const now = Date.now();
  if (!Number.isFinite(session.lastActivityAt) || (now - session.lastActivityAt) > LOGIN_TTL_MS) {
    AUTH_SESSIONS.delete(token);
    return "";
  }
  session.lastActivityAt = now;
  AUTH_SESSIONS.set(token, session);
  return username;
}

function isOwnedByUser(ctx) {
  const { data } = ctx;
  const { record, username } = data;
  if (!record || typeof record !== "object") {
    return false;
  }
  const owner = normalizeUsername({ data: { username: record.owner }, deps: {} });
  if (!owner || !username) {
    return false;
  }
  return owner === username;
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

function getAudioBinaryPath(ctx) {
  const { data, deps } = ctx;
  const { audioId } = data;
  return deps.path.join(AUDIO_DIR, String(audioId) + ".bin");
}

function getAudioMetadataPath(ctx) {
  const { data, deps } = ctx;
  const { audioId } = data;
  return deps.path.join(AUDIO_DIR, String(audioId) + ".json");
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
  if (payload.audioBase64 != null && typeof payload.audioBase64 !== "string") {
    return false;
  }
  if (payload.audioId != null && typeof payload.audioId !== "string") {
    return false;
  }
  if (payload.audioUrl != null && typeof payload.audioUrl !== "string") {
    return false;
  }
  if (!payload.audioBase64 && !payload.audioId && !payload.audioUrl) {
    return false;
  }
  return true;
}

function streamFile(ctx) {
  const { data, deps } = ctx;
  const { res, filePath } = data;

  return new Promise(function (resolve) {
    const ext = path.extname(filePath).toLowerCase();
    const type = data.overrideContentType || (ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "application/javascript; charset=utf-8"
          : "application/octet-stream");

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

async function streamAudioBinary(ctx) {
  const { data, deps } = ctx;
  const { req, res, filePath, contentType } = data;
  let stat;
  try {
    stat = await deps.fsp.stat(filePath);
  } catch {
    sendJson({ data: { res, status: 404, payload: { error: "audio_not_found" } }, deps: {} });
    return;
  }

  const fileSize = Number(stat.size || 0);
  const range = req && req.headers && req.headers.range ? String(req.headers.range) : "";

  if (!range || !/^bytes=/.test(range)) {
    await pipeStream({
      data: {
        res,
        stream: deps.fs.createReadStream(filePath),
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store"
        }
      },
      deps: {}
    });
    return;
  }

  const parsed = parseBytesRange({ data: { range, fileSize }, deps: {} });
  if (!parsed) {
    res.writeHead(416, {
      "Content-Range": "bytes */" + String(fileSize),
      "Cache-Control": "no-store"
    });
    res.end();
    return;
  }

  await pipeStream({
    data: {
      res,
      stream: deps.fs.createReadStream(filePath, { start: parsed.start, end: parsed.end }),
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(parsed.end - parsed.start + 1),
        "Content-Range": "bytes " + String(parsed.start) + "-" + String(parsed.end) + "/" + String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      }
    },
    deps: {}
  });
}

function parseBytesRange(ctx) {
  const { data } = ctx;
  const { range, fileSize } = data;
  const raw = String(range || "").trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(raw);
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  if (!startRaw && !endRaw) {
    return null;
  }

  let start = startRaw ? Number(startRaw) : NaN;
  let end = endRaw ? Number(endRaw) : NaN;

  if (!Number.isFinite(start) && Number.isFinite(end)) {
    const suffix = end;
    if (suffix <= 0) {
      return null;
    }
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) {
      return null;
    }
    if (!Number.isFinite(end) || end >= fileSize) {
      end = fileSize - 1;
    }
  }

  if (start > end || start >= fileSize) {
    return null;
  }

  return { start, end };
}

function pipeStream(ctx) {
  const { data } = ctx;
  const { res, stream, status, headers } = data;
  return new Promise(function (resolve) {
    stream.on("error", function () {
      if (!res.headersSent) {
        sendJson({ data: { res, status: 404, payload: { error: "not_found" } }, deps: {} });
      } else {
        res.end();
      }
      resolve();
    });
    res.writeHead(status, headers);
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

function readBodyBuffer(ctx) {
  const { data } = ctx;
  const { req } = data;

  return new Promise(function (resolve, reject) {
    const chunks = [];
    let total = 0;
    req.on("data", function (chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_BODY_SIZE) {
        reject(new Error("payload_too_large"));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks)); });
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

async function readRemoteSessionSummaries(ctx) {
  const { data } = ctx;
  const { username } = data;
  const query = username ? "?username=" + encodeURIComponent(username) : "";
  const payload = await remoteRequestJson({
    data: {
      method: "GET",
      endpointPath: REMOTE_SESSIONS_PATH + query,
      headers: withRemoteUserHeaders({ data: { username }, deps: {} })
    },
    deps: {}
  });
  if (!payload || !Array.isArray(payload.sessions)) {
    return [];
  }
  return payload.sessions;
}

async function getRemoteSession(ctx) {
  const { data } = ctx;
  const { sessionId, username } = data;
  const resolvedSessionId = normalizeSessionId({ data: { sessionId }, deps: {} });
  const queryParams = new URLSearchParams();
  if (resolvedSessionId) {
    queryParams.set("id", resolvedSessionId);
  }
  if (username) {
    queryParams.set("username", username);
  }
  const query = queryParams.toString() ? "?" + queryParams.toString() : "";
  const payload = await remoteRequestJson({
    data: {
      method: "GET",
      endpointPath: REMOTE_SESSION_PATH + query,
      headers: withRemoteUserHeaders({ data: { username }, deps: {} })
    },
    deps: {}
  });
  if (payload && payload.error === "session_not_found") {
    const notFoundError = new Error("session_not_found");
    notFoundError.code = "REMOTE_SESSION_NOT_FOUND";
    throw notFoundError;
  }
  if (!payload || typeof payload !== "object") {
    throw new Error("invalid_remote_session_payload");
  }

  return {
    id: payload._id || payload.id || resolvedSessionId || "",
    savedAt: payload.savedAt,
    file: payload.file || {},
    playback: payload.playback || {},
    audioId: payload.audioId || "",
    audioUrl: payload.audioUrl || ""
  };
}

async function saveRemoteSession(ctx) {
  const { data } = ctx;
  const { payload, username } = data;
  const remotePayload = {
    ...(payload || {}),
    owner: username
  };
  const result = await remoteRequestJson({
    data: {
      method: "POST",
      endpointPath: REMOTE_SESSION_PATH,
      payload: remotePayload,
      headers: withRemoteUserHeaders({ data: { username }, deps: {} })
    },
    deps: {}
  });
  if (!result || !result.ok) {
    throw new Error("remote_save_failed detail=" + JSON.stringify(result || {}));
  }
  return result;
}

async function deleteRemoteSession(ctx) {
  const { data } = ctx;
  const { sessionId, username } = data;
  const query = new URLSearchParams();
  query.set("id", sessionId);
  if (username) {
    query.set("username", username);
  }
  const result = await remoteRequestJson({
    data: {
      method: "DELETE",
      endpointPath: REMOTE_SESSION_PATH + "?" + query.toString(),
      headers: withRemoteUserHeaders({ data: { username }, deps: {} })
    },
    deps: {}
  });
  if (!result || !result.ok) {
    throw new Error("remote_delete_failed detail=" + JSON.stringify(result || {}));
  }
  return result;
}

async function saveRemoteAudio(ctx) {
  const { data } = ctx;
  const { bodyBuffer, fileName, mimeType, lastModified, username } = data;
  const query = new URLSearchParams();
  if (fileName) {
    query.set("name", String(fileName));
  }
  if (mimeType) {
    query.set("type", String(mimeType));
  }
  if (lastModified) {
    query.set("lastModified", String(lastModified));
  }
  if (username) {
    query.set("username", username);
  }

  const response = await remoteFetch({
    data: {
      method: "POST",
      endpointPath: REMOTE_AUDIO_PATH + "?" + query.toString(),
      headers: withRemoteUserHeaders({
        data: { username, headers: { "Content-Type": String(mimeType || "application/octet-stream") } },
        deps: {}
      }),
      body: bodyBuffer
    },
    deps: {}
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || !payload.ok) {
    throw new Error("remote_audio_save_failed detail=" + text);
  }
  return payload;
}

function buildAudioUploadQuery(ctx) {
  const { data } = ctx;
  const query = new URLSearchParams();
  if (data.fileName) {
    query.set("name", String(data.fileName));
  }
  if (data.mimeType) {
    query.set("type", String(data.mimeType));
  }
  if (data.lastModified) {
    query.set("lastModified", String(data.lastModified));
  }
  const serialized = query.toString();
  return serialized ? "?" + serialized : "";
}

async function remoteRequestJson(ctx) {
  const { data } = ctx;
  const { method, endpointPath, payload, headers } = data;
  if (!REMOTE_BASE_URL) {
    throw new Error("REMOTE_BASE_URL is required when SESSION_STORE=remote");
  }

  const controller = new AbortController();
  const timeout = setTimeout(function () { controller.abort(); }, REMOTE_TIMEOUT_MS);

  try {
    const response = await remoteFetch({
      data: {
        method,
        endpointPath,
        headers: { "Content-Type": "application/json", ...(headers || {}) },
        payload
      },
      deps: { controller }
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error("remote_http_error status=" + String(response.status) + " detail=" + text);
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function remoteFetch(ctx) {
  const { data, deps } = ctx;
  const controller = deps && deps.controller;
  return fetch(REMOTE_BASE_URL + data.endpointPath, {
    method: data.method,
    headers: data.headers || {},
    cache: "no-store",
    signal: controller ? controller.signal : undefined,
    body: data.payload ? JSON.stringify(data.payload) : data.body
  });
}

async function saveLocalAudioFromBase64(ctx) {
  const { data, deps } = ctx;
  const { payload, owner } = data;
  const base64 = String(payload.audioBase64 || "");
  const marker = "base64,";
  const markerIndex = base64.indexOf(marker);
  const raw = markerIndex >= 0 ? base64.slice(markerIndex + marker.length) : base64;
  const buffer = Buffer.from(raw, "base64");
  const audioId = buildSessionId({ data: { fileName: payload.file && payload.file.name }, deps: {} });
  const binaryPath = getAudioBinaryPath({ data: { audioId }, deps: { path: deps.path } });
  const metadataPath = getAudioMetadataPath({ data: { audioId }, deps: { path: deps.path } });
  await deps.fsp.mkdir(AUDIO_DIR, { recursive: true });
  await deps.fsp.writeFile(binaryPath, buffer);
  await deps.fsp.writeFile(metadataPath, JSON.stringify({
    id: audioId,
    owner: normalizeUsername({ data: { username: owner }, deps: {} }),
    fileName: payload.file && payload.file.name ? String(payload.file.name) : "audio.bin",
    mimeType: payload.file && payload.file.type ? String(payload.file.type) : "application/octet-stream",
    size: buffer.length,
    lastModified: payload.file && Number.isFinite(Number(payload.file.lastModified)) ? Number(payload.file.lastModified) : Date.now(),
    savedAt: new Date().toISOString()
  }, null, 2), "utf8");
  return { id: audioId };
}

async function readAudioMetadata(ctx) {
  const { data, deps } = ctx;
  const { audioId } = data;
  const safeId = normalizeSessionId({ data: { sessionId: audioId }, deps: {} });
  if (!safeId) {
    return null;
  }
  const metadataPath = getAudioMetadataPath({ data: { audioId: safeId }, deps: { path: deps.path } });
  try {
    const raw = await deps.fsp.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function withRemoteUserHeaders(ctx) {
  const { data } = ctx;
  const { username, headers } = data;
  const merged = { ...(headers || {}) };
  if (username) {
    merged["x-audio-user"] = username;
  }
  return merged;
}

async function normalizeLoadedSession(ctx) {
  const { data, deps } = ctx;
  const { record } = data;
  if (!record || typeof record !== "object") {
    return { id: "", file: {}, playback: {} };
  }
  if (!record.audioId && typeof record.audioBase64 === "string" && record.audioBase64) {
    const uploadedAudio = await saveLocalAudioFromBase64({ data: { payload: record }, deps: { fsp: deps.fsp, path: deps.path } });
    record.audioId = uploadedAudio.id;
  }
  return {
    id: record.id || "",
    savedAt: record.savedAt,
    file: record.file || {},
    playback: record.playback || {},
    audioId: record.audioId || "",
    audioUrl: record.audioUrl || ""
  };
}
