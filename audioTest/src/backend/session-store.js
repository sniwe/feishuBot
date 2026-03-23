const { SESSIONS_DIR, SESSION_PATH } = require("./config");
const { normalizeUsername } = require("./auth");

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

function parseRevision(ctx) {
  const { data } = ctx;
  const { value, fallback } = data;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    return Number.isInteger(fallback) && fallback >= 0 ? fallback : 0;
  }
  return numeric;
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
  if (payload.baseRevision != null) {
    const revision = Number(payload.baseRevision);
    if (!Number.isInteger(revision) || revision < 0) {
      return false;
    }
  }
  if (!payload.audioBase64 && !payload.audioId && !payload.audioUrl) {
    return false;
  }
  return true;
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
    updatedAt: parsed.updatedAt || parsed.savedAt,
    revision: parseRevision({ data: { value: parsed.revision, fallback: 0 }, deps: {} }),
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

async function normalizeLoadedSession(ctx) {
  const { data, deps } = ctx;
  const { record } = data;
  if (!record || typeof record !== "object") {
    return { id: "", file: {}, playback: {} };
  }
  if (!record.audioId && typeof record.audioBase64 === "string" && record.audioBase64) {
    const uploadedAudio = await deps.saveLocalAudioFromBase64({ data: { payload: record }, deps: { fsp: deps.fsp, path: deps.path } });
    record.audioId = uploadedAudio.id;
  }
  return {
    id: record.id || "",
    savedAt: record.savedAt,
    updatedAt: record.updatedAt || record.savedAt,
    revision: parseRevision({ data: { value: record.revision, fallback: 0 }, deps: {} }),
    file: record.file || {},
    playback: record.playback || {},
    audioId: record.audioId || "",
    audioUrl: record.audioUrl || ""
  };
}

module.exports = {
  normalizeSessionId,
  buildSessionId,
  getSessionFilePath,
  isOwnedByUser,
  parseRevision,
  isValidSessionPayload,
  toSessionSummary,
  readSessionSummaries,
  refreshLatestSessionAfterDelete,
  isAudioReferencedByAnySession,
  normalizeLoadedSession
};
