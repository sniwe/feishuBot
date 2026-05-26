(function (global) {
  const STORAGE_KEY = "audioTest.auth.v4";
  const LEGACY_STORAGE_KEYS = ["audioTest.auth", "audioTest.auth.v2", "audioTest.auth.v3"];
  const RESUME_CONTEXT_PREFIX = "audioTest.resumeContext:";
  const RESUME_CONTEXT_VERSION = 1;
  const RESUME_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;

  LEGACY_STORAGE_KEYS.forEach(function (key) {
    try {
      global.localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  });

  function persistLogin(ctx) {
    const { data = {} } = ctx || {};
    try {
      const ttlMs = Number(data.ttlMs);
      const safe = {
        username: String(data.username || "").toLowerCase(),
        token: String(data.token || ""),
        loggedInAt: Number(data.loggedInAt || Date.now()),
        ttlMs: Number.isFinite(ttlMs) ? ttlMs : 5 * 60 * 1000,
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
    const fallbackTtlMsValue = Number(data.fallbackTtlMs ?? 5 * 60 * 1000);
    const fallbackTtlMs = Number.isFinite(fallbackTtlMsValue) ? fallbackTtlMsValue : 5 * 60 * 1000;

    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      const username = String(parsed && parsed.username ? parsed.username : "").toLowerCase();
      const token = String(parsed && parsed.token ? parsed.token : "");
      const loggedInAt = Number(parsed && parsed.loggedInAt);
      const ttlMsValue = Number(parsed && parsed.ttlMs);
      const ttlMs = Number.isFinite(ttlMsValue) ? ttlMsValue : fallbackTtlMs;
      const lastActivityAt = Number(parsed && parsed.lastActivityAt ? parsed.lastActivityAt : loggedInAt);
      if (
        allowedUsers.indexOf(username) < 0 ||
        !token ||
        !Number.isFinite(loggedInAt) ||
        !Number.isFinite(ttlMs) ||
        !Number.isFinite(lastActivityAt)
      ) {
        return null;
      }
      if (ttlMs > 0 && (Date.now() - lastActivityAt) > ttlMs) {
        global.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return { username, token, loggedInAt, ttlMs, lastActivityAt };
    } catch {
      return null;
    }
  }

  function clearLogin() {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
  }

  function clearAllAuthState() {
    clearLogin();
    try {
      const keys = [];
      for (let index = 0; index < global.localStorage.length; index += 1) {
        const key = global.localStorage.key(index);
        if (key && String(key).indexOf(RESUME_CONTEXT_PREFIX) === 0) {
          keys.push(key);
        }
      }
      keys.forEach(function (key) {
        global.localStorage.removeItem(key);
      });
    } catch {
      // Ignore storage failures.
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

  function buildResumeContextStorageKey(ctx) {
    const { data = {} } = ctx || {};
    const username = String(data.username || "").trim().toLowerCase();
    if (!username) {
      return "";
    }
    return RESUME_CONTEXT_PREFIX + username;
  }

  function persistResumeContext(ctx) {
    const { data = {} } = ctx || {};
    const storageKey = buildResumeContextStorageKey({ data: { username: data.username }, deps: {} });
    const snapshot = data.snapshot;
    if (!storageKey || !snapshot || typeof snapshot !== "object") {
      return;
    }

    try {
      const capturedAt = String(data.capturedAt || new Date().toISOString());
      const payload = {
        version: RESUME_CONTEXT_VERSION,
        username: storageKey.slice(RESUME_CONTEXT_PREFIX.length),
        capturedAt,
        expiresAt: String(data.expiresAt || new Date(Date.now() + RESUME_CONTEXT_TTL_MS).toISOString()),
        snapshot
      };
      global.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage failures.
    }
  }

  function restoreResumeContext(ctx) {
    const { data = {} } = ctx || {};
    const storageKey = buildResumeContextStorageKey({ data: { username: data.username }, deps: {} });
    if (!storageKey) {
      return null;
    }

    try {
      const raw = global.localStorage.getItem(storageKey);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      const version = Number(parsed && parsed.version);
      const storedUsername = String(parsed && parsed.username ? parsed.username : "").trim().toLowerCase();
      const expiresAt = Date.parse(String(parsed && parsed.expiresAt ? parsed.expiresAt : ""));
      if (
        version !== RESUME_CONTEXT_VERSION ||
        storedUsername !== storageKey.slice(RESUME_CONTEXT_PREFIX.length) ||
        !Number.isFinite(expiresAt) ||
        Date.now() > expiresAt ||
        !parsed ||
        typeof parsed.snapshot !== "object" ||
        parsed.snapshot === null
      ) {
        global.localStorage.removeItem(storageKey);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function clearResumeContext(ctx) {
    const { data = {} } = ctx || {};
    const storageKey = buildResumeContextStorageKey({ data: { username: data.username }, deps: {} });
    if (!storageKey) {
      return;
    }
    try {
      global.localStorage.removeItem(storageKey);
    } catch {
      // Ignore storage failures.
    }
  }

  global.audioTestAuthStorage = {
    storageKey: STORAGE_KEY,
    persistLogin,
    restoreLogin,
    clearLogin,
    clearAllAuthState,
    buildAuthHeaders,
    buildResumeContextStorageKey,
    persistResumeContext,
    restoreResumeContext,
    clearResumeContext
  };
})(window);
