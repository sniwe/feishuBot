const { LOGIN_TTL_MS, USER_CREDENTIALS } = require("./config");
const { parseRequestUrl, sendJson } = require("./utils");

const AUTH_SESSIONS = new Map();

function normalizeUsername(ctx) {
  const { data } = ctx;
  const { username } = data;
  const value = String(username || "").trim().toLowerCase();
  if (!value) {
    return "";
  }
  return value.replace(/[^a-z0-9_-]/g, "");
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
  if (LOGIN_TTL_MS > 0 && (!Number.isFinite(session.lastActivityAt) || (now - session.lastActivityAt) > LOGIN_TTL_MS)) {
    AUTH_SESSIONS.delete(token);
    return "";
  }
  session.lastActivityAt = now;
  AUTH_SESSIONS.set(token, session);
  return username;
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

module.exports = {
  AUTH_SESSIONS,
  normalizeUsername,
  createAuthSession,
  resolveAuthenticatedUser,
  requireAuthUser,
  handlePostAuthPing
};
