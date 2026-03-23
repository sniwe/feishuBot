(function (global) {
  const STORAGE_KEY = "audioTest.auth";

  function persistLogin(ctx) {
    const { data = {} } = ctx || {};
    try {
      const safe = {
        username: String(data.username || "").toLowerCase(),
        token: String(data.token || ""),
        loggedInAt: Number(data.loggedInAt || Date.now()),
        ttlMs: Number(data.ttlMs || 5 * 60 * 1000),
        lastActivityAt: Number(data.lastActivityAt || Date.now())
      };
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch {
      // Ignore storage failures.
    }
  }

  function restoreLogin(ctx) {
    const { data = {} } = ctx || {};
    const allowedUsers = Array.isArray(data.allowedUsers) ? data.allowedUsers : [];
    const fallbackTtlMs = Number(data.fallbackTtlMs || 5 * 60 * 1000);

    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      const username = String(parsed && parsed.username ? parsed.username : "").toLowerCase();
      const token = String(parsed && parsed.token ? parsed.token : "");
      const loggedInAt = Number(parsed && parsed.loggedInAt);
      const ttlMs = Number(parsed && parsed.ttlMs ? parsed.ttlMs : fallbackTtlMs);
      const lastActivityAt = Number(parsed && parsed.lastActivityAt ? parsed.lastActivityAt : loggedInAt);
      if (
        allowedUsers.indexOf(username) < 0 ||
        !token ||
        !Number.isFinite(loggedInAt) ||
        !Number.isFinite(ttlMs) ||
        ttlMs <= 0 ||
        !Number.isFinite(lastActivityAt)
      ) {
        return null;
      }
      if ((Date.now() - lastActivityAt) > ttlMs) {
        global.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return { username, token, loggedInAt, ttlMs, lastActivityAt };
    } catch {
      return null;
    }
  }

  function buildAuthHeaders(ctx) {
    const { data = {} } = ctx || {};
    const username = String(data.username || "").trim();
    const token = String(data.token || "").trim();
    if (!username || !token) {
      return {};
    }
    return {
      "x-audio-user": username,
      "x-audio-auth": token
    };
  }

  global.audioTestAuthStorage = {
    storageKey: STORAGE_KEY,
    persistLogin,
    restoreLogin,
    buildAuthHeaders
  };
})(window);
