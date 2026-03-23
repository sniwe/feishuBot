function createStateStore(ctx) {
  const { data = {}, deps } = ctx || {};
  const { fs, os, path } = deps;
  const projectRoot = data.projectRoot;
  const sessionStorePath = data.sessionStorePath;
  const codexSessionIndexPath = data.codexSessionIndexPath;
  const dataDirPath = data.dataDirPath;

  const chatStates = new Map();
  const recentEventKeys = new Map();
  let persistedSessions = { chats: {} };

  function normalizePersistedSessions(raw) {
    if (!raw || typeof raw !== "object") {
      return { chats: {} };
    }

    if (raw.chats && typeof raw.chats === "object") {
      return { chats: raw.chats };
    }

    const chats = {};
    for (const [chatId, value] of Object.entries(raw)) {
      if (typeof value === "string" && value.trim()) {
        chats[chatId] = { sessionId: value.trim(), chatName: "" };
        continue;
      }

      if (value && typeof value === "object") {
        const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
        const chatName = typeof value.chatName === "string" ? value.chatName.trim() : "";
        if (sessionId || chatName) {
          chats[chatId] = { sessionId, chatName };
        }
      }
    }

    return { chats };
  }

  function getPersistedChatEntry(chatId) {
    if (!persistedSessions.chats || typeof persistedSessions.chats !== "object") {
      persistedSessions.chats = {};
    }

    const existing = persistedSessions.chats[chatId];
    if (!existing || typeof existing !== "object") {
      return { sessionId: "", chatName: "" };
    }

    return {
      sessionId: typeof existing.sessionId === "string" ? existing.sessionId.trim() : "",
      chatName: typeof existing.chatName === "string" ? existing.chatName.trim() : "",
    };
  }

  function loadPersistedSessions() {
    try {
      if (!fs.existsSync(sessionStorePath)) {
        persistedSessions = { chats: {} };
        return;
      }

      const raw = fs.readFileSync(sessionStorePath, "utf8");
      const parsed = JSON.parse(raw);
      persistedSessions = normalizePersistedSessions(parsed);
    } catch (err) {
      console.error("Failed to load persisted sessions:", err.message);
      persistedSessions = { chats: {} };
    }
  }

  function savePersistedSessions() {
    try {
      fs.writeFileSync(sessionStorePath, JSON.stringify(persistedSessions, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save persisted sessions:", err.message);
    }
  }

  function loadCodexSessionIndex() {
    try {
      if (!fs.existsSync(codexSessionIndexPath)) {
        return [];
      }

      const raw = fs.readFileSync(codexSessionIndexPath, "utf8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (err) {
      console.error("Failed to load Codex session index:", err.message);
      return [];
    }
  }

  function isLikelyCodexSessionId(sessionId) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((sessionId || "").trim());
  }

  function lookupCodexSessionIdByThreadName(threadName) {
    const cleanedName = (threadName || "").trim();
    if (!cleanedName) {
      return "";
    }

    const normalizedName = cleanedName.toLowerCase();
    const entries = loadCodexSessionIndex();
    let latestSessionId = "";
    let latestUpdatedAt = 0;

    for (const entry of entries) {
      const entryName = typeof entry.thread_name === "string" ? entry.thread_name.trim() : "";
      const entryId = typeof entry.id === "string" ? entry.id.trim() : "";
      if (!entryName || !entryId || entryName.toLowerCase() !== normalizedName) {
        continue;
      }

      const updatedAt = Date.parse(entry.updated_at || "") || 0;
      if (!latestSessionId || updatedAt >= latestUpdatedAt) {
        latestSessionId = entryId;
        latestUpdatedAt = updatedAt;
      }
    }

    return latestSessionId;
  }

  function lookupLatestCodexHistorySessionId() {
    try {
      const historyPath = path.join(os.homedir(), ".codex", "history.jsonl");
      if (!fs.existsSync(historyPath)) {
        return "";
      }

      const raw = fs.readFileSync(historyPath, "utf8");
      const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        try {
          const parsed = JSON.parse(lines[index]);
          const sessionId = typeof parsed.session_id === "string" ? parsed.session_id.trim() : "";
          if (isLikelyCodexSessionId(sessionId)) {
            return sessionId;
          }
        } catch {
          continue;
        }
      }
    } catch (err) {
      console.error("Failed to load Codex history:", err.message);
    }

    return "";
  }

  function resolveCodexSessionIdForChat(chatName, sessionId) {
    const cleanedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
    if (isLikelyCodexSessionId(cleanedSessionId)) {
      return cleanedSessionId;
    }

    return (
      lookupCodexSessionIdByThreadName(chatName) ||
      lookupLatestCodexHistorySessionId() ||
      cleanedSessionId
    );
  }

  function extractThreadStartedId(stdout) {
    const lines = (stdout || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (parsed?.type === "thread.started" && typeof parsed.thread_id === "string" && parsed.thread_id.trim()) {
          return parsed.thread_id.trim();
        }
      } catch {
        continue;
      }
    }

    return "";
  }

  function toYYMMDD(date = new Date()) {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  function getDailyMessagesPath(date = new Date()) {
    const dirPath = path.join(dataDirPath, toYYMMDD(date));
    return path.join(dirPath, "messages.json");
  }

  function appendMessageLog(entry) {
    try {
      const now = new Date();
      const logPath = getDailyMessagesPath(now);
      const logDir = path.dirname(logPath);
      fs.mkdirSync(logDir, { recursive: true });

      let existing = [];
      if (fs.existsSync(logPath)) {
        try {
          const raw = fs.readFileSync(logPath, "utf8").trim();
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              existing = parsed;
            }
          }
        } catch {
          existing = [];
        }
      }

      existing.push({
        timestamp: now.toISOString(),
        ...entry,
      });

      fs.writeFileSync(logPath, JSON.stringify(existing, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to append message log:", err.message);
    }
  }

  function markRecentEventKey(eventKey) {
    if (!eventKey) {
      return false;
    }

    const now = Date.now();
    const ttlMs = 10 * 60 * 1000;

    for (const [key, seenAt] of recentEventKeys.entries()) {
      if (now - seenAt > ttlMs) {
        recentEventKeys.delete(key);
      }
    }

    if (recentEventKeys.has(eventKey)) {
      return true;
    }

    recentEventKeys.set(eventKey, now);
    return false;
  }

  function splitForFeishu(text, maxLen = 3000) {
    const chunks = [];
    let remaining = text || "";
    while (remaining.length > maxLen) {
      chunks.push(remaining.slice(0, maxLen));
      remaining = remaining.slice(maxLen);
    }
    if (remaining.trim()) {
      chunks.push(remaining);
    }
    return chunks;
  }

  function getChatState(chatId) {
    if (!chatStates.has(chatId)) {
      const stored = getPersistedChatEntry(chatId);
      const storedResponseId = stored.sessionId || null;
      chatStates.set(chatId, {
        isArmed: false,
        waitingForModeChoice: false,
        waitingForResumeChatSelection: false,
        resumeChatCandidates: [],
        hasActiveSession: Boolean(storedResponseId),
        codexResponseId: storedResponseId,
        chatName: stored.chatName || "",
        isTurnInFlight: false,
        activeCodexProcess: null,
        pendingUserTexts: [],
        isDrainingQueue: false,
      });
    }

    return chatStates.get(chatId);
  }

  function setChatSessionId(chatId, state, responseId, chatName = state.chatName || "") {
    state.codexResponseId = responseId || null;
    state.chatName = (chatName || "").trim();

    if (!persistedSessions.chats || typeof persistedSessions.chats !== "object") {
      persistedSessions.chats = {};
    }

    if (state.codexResponseId || state.chatName) {
      persistedSessions.chats[chatId] = {
        sessionId: state.codexResponseId || "",
        chatName: state.chatName,
      };
    } else if (persistedSessions.chats[chatId]) {
      delete persistedSessions.chats[chatId];
    }

    savePersistedSessions();
  }

  function setChatDisplayName(chatId, state, chatName) {
    const cleanedName = (chatName || "").trim();
    if (!cleanedName || cleanedName === state.chatName) {
      return;
    }

    state.chatName = cleanedName;
    if (state.codexResponseId || persistedSessions?.chats?.[chatId]) {
      setChatSessionId(chatId, state, state.codexResponseId, cleanedName);
    }
  }

  function buildNamedResumeChatCandidates() {
    const candidates = [];
    const chats = persistedSessions.chats && typeof persistedSessions.chats === "object" ? persistedSessions.chats : {};

    for (const [chatId, entry] of Object.entries(chats)) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const sessionId = typeof entry.sessionId === "string" ? entry.sessionId.trim() : "";
      const chatName = typeof entry.chatName === "string" ? entry.chatName.trim() : "";
      if (!chatName) {
        continue;
      }

      const resolvedSessionId = resolveCodexSessionIdForChat(chatName, sessionId);
      if (resolvedSessionId && resolvedSessionId !== sessionId) {
        persistedSessions.chats[chatId] = {
          sessionId: resolvedSessionId,
          chatName,
        };
        savePersistedSessions();
      }

      candidates.push({ chatId, chatName, sessionId: resolvedSessionId });
    }

    candidates.sort((a, b) => a.chatName.localeCompare(b.chatName));
    return candidates;
  }

  function load() {
    loadPersistedSessions();
  }

  return {
    load,
    loadPersistedSessions,
    savePersistedSessions,
    normalizePersistedSessions,
    getPersistedChatEntry,
    loadCodexSessionIndex,
    lookupCodexSessionIdByThreadName,
    lookupLatestCodexHistorySessionId,
    resolveCodexSessionIdForChat,
    isLikelyCodexSessionId,
    extractThreadStartedId,
    toYYMMDD,
    getDailyMessagesPath,
    appendMessageLog,
    markRecentEventKey,
    splitForFeishu,
    getChatState,
    setChatSessionId,
    setChatDisplayName,
    buildNamedResumeChatCandidates,
  };
}

module.exports = { createStateStore };
