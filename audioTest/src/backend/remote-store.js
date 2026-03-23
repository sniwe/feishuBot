const { REMOTE_BASE_URL, REMOTE_TIMEOUT_MS, REMOTE_SESSIONS_PATH, REMOTE_SESSION_PATH, REMOTE_AUDIO_PATH } = require("./config");
const { parseRevision, normalizeSessionId } = require("./session-store");

function withRemoteUserHeaders(ctx) {
  const { data } = ctx;
  const { username, headers } = data;
  const merged = { ...(headers || {}) };
  if (username) {
    merged["x-audio-user"] = username;
  }
  return merged;
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

async function remoteRequestJson(ctx) {
  const { data } = ctx;
  const { method, endpointPath, payload, headers } = data;
  if (!REMOTE_BASE_URL) {
    throw new Error("REMOTE_BASE_URL is required when SESSION_STORE=remote");
  }

  const controller = new AbortController();
  const timeout = setTimeout(function () {
    controller.abort();
  }, REMOTE_TIMEOUT_MS);

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
    updatedAt: payload.updatedAt || payload.savedAt,
    revision: parseRevision({ data: { value: payload.revision, fallback: 0 }, deps: {} }),
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
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok || !payload.ok) {
    throw new Error("remote_audio_save_failed detail=" + text);
  }
  return payload;
}

module.exports = {
  withRemoteUserHeaders,
  remoteFetch,
  remoteRequestJson,
  readRemoteSessionSummaries,
  getRemoteSession,
  saveRemoteSession,
  deleteRemoteSession,
  saveRemoteAudio
};
