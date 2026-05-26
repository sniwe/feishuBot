function createStateStore(ctx) {
  const { data = {}, deps } = ctx || {};
  const { fs, os, path } = deps;
  const projectRoot = data.projectRoot;
  const sessionStorePath = data.sessionStorePath;
  const codexSessionIndexPath = data.codexSessionIndexPath;
  const dataDirPath = data.dataDirPath;

  const chatStates = new Map();
  const recentEventKeys = new Map();
  let persistedSessions = { chats: {}, threads: [] };

  function makeThreadRecordId(chatId, chatName, sessionId) {
    const cleanedChatId = (chatId || "").trim() || "chat";
    const cleanedName = (chatName || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const cleanedSessionId = (sessionId || "").trim().slice(0, 8);
    const timestamp = Date.now().toString(36);
    return [cleanedChatId, cleanedName, cleanedSessionId, timestamp].filter(Boolean).join("-");
  }

  function normalizeThreadEntry(entry, fallback = {}) {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const threadId = typeof entry.threadId === "string" ? entry.threadId.trim() : typeof entry.thread_id === "string" ? entry.thread_id.trim() : "";
    const chatId = typeof entry.chatId === "string" ? entry.chatId.trim() : typeof fallback.chatId === "string" ? fallback.chatId.trim() : "";
    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId.trim() : typeof fallback.sessionId === "string" ? fallback.sessionId.trim() : "";
    const chatName = typeof entry.chatName === "string" ? entry.chatName.trim() : typeof fallback.chatName === "string" ? fallback.chatName.trim() : "";
    const createdAt = typeof entry.createdAt === "string" && entry.createdAt.trim() ? entry.createdAt.trim() : new Date().toISOString();
    const updatedAt = typeof entry.updatedAt === "string" && entry.updatedAt.trim() ? entry.updatedAt.trim() : createdAt;

    if (!threadId && !chatId && !sessionId && !chatName) {
      return null;
    }

    return {
      threadId: threadId || makeThreadRecordId(chatId, chatName, sessionId),
      chatId,
      sessionId,
      chatName,
      createdAt,
      updatedAt,
    };
  }

  function normalizePersistedSessions(raw) {
    if (!raw || typeof raw !== "object") {
      return { chats: {}, threads: [] };
    }

    const chats = {};
    const threads = [];
    const rawThreads = Array.isArray(raw.threads) ? raw.threads : [];
    const rawChats = raw.chats && typeof raw.chats === "object" ? raw.chats : null;

    if (rawChats) {
      for (const [chatId, value] of Object.entries(rawChats)) {
        if (typeof value === "string" && value.trim()) {
          chats[chatId] = { sessionId: value.trim(), chatName: "", threadId: "" };
          continue;
        }

        if (value && typeof value === "object") {
          const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
          const chatName = typeof value.chatName === "string" ? value.chatName.trim() : "";
          const threadId = typeof value.threadId === "string" ? value.threadId.trim() : "";
          if (sessionId || chatName || threadId) {
            chats[chatId] = { sessionId, chatName, threadId };
          }
        }
      }
    }

    if (rawThreads.length > 0) {
      for (const entry of rawThreads) {
        const normalized = normalizeThreadEntry(entry);
        if (normalized) {
          threads.push(normalized);
        }
      }
    } else {
      for (const [chatId, value] of Object.entries(raw)) {
        if (chatId === "chats" || chatId === "threads") {
          continue;
        }

        if (typeof value === "string" && value.trim()) {
          const sessionId = value.trim();
          const thread = normalizeThreadEntry({
            threadId: makeThreadRecordId(chatId, "", sessionId),
            chatId,
            sessionId,
            chatName: "",
          });
          chats[chatId] = { sessionId, chatName: "", threadId: thread.threadId };
          threads.push(thread);
          continue;
        }

        if (value && typeof value === "object") {
          const sessionId = typeof value.sessionId === "string" ? value.sessionId.trim() : "";
          const chatName = typeof value.chatName === "string" ? value.chatName.trim() : "";
          const threadId = typeof value.threadId === "string" ? value.threadId.trim() : "";
          if (sessionId || chatName || threadId) {
            const thread = normalizeThreadEntry({
              threadId: threadId || makeThreadRecordId(chatId, chatName, sessionId),
              chatId,
              sessionId,
              chatName,
              createdAt: value.createdAt,
              updatedAt: value.updatedAt,
            });
            chats[chatId] = { sessionId, chatName, threadId: thread.threadId };
            threads.push(thread);
          }
        }
      }
    }

    return { chats, threads };
  }

  function getPersistedChatEntry(chatId) {
    if (!persistedSessions.chats || typeof persistedSessions.chats !== "object") {
      persistedSessions.chats = {};
    }

    const existing = persistedSessions.chats[chatId];
    if (!existing || typeof existing !== "object") {
      return { sessionId: "", chatName: "", threadId: "" };
    }

    return {
      sessionId: typeof existing.sessionId === "string" ? existing.sessionId.trim() : "",
      chatName: typeof existing.chatName === "string" ? existing.chatName.trim() : "",
      threadId: typeof existing.threadId === "string" ? existing.threadId.trim() : "",
    };
  }

  function getPersistedThreadEntry(threadId) {
    const cleanedThreadId = (threadId || "").trim();
    if (!cleanedThreadId || !Array.isArray(persistedSessions.threads)) {
      return null;
    }

    for (let index = persistedSessions.threads.length - 1; index >= 0; index -= 1) {
      const entry = persistedSessions.threads[index];
      if (entry && typeof entry === "object" && entry.threadId === cleanedThreadId) {
        return {
          threadId: entry.threadId,
          chatId: typeof entry.chatId === "string" ? entry.chatId.trim() : "",
          sessionId: typeof entry.sessionId === "string" ? entry.sessionId.trim() : "",
          chatName: typeof entry.chatName === "string" ? entry.chatName.trim() : "",
          createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
        };
      }
    }

    return null;
  }

  function getLatestThreadEntryForChat(chatId) {
    const cleanedChatId = (chatId || "").trim();
    if (!cleanedChatId || !Array.isArray(persistedSessions.threads)) {
      return null;
    }

    for (let index = persistedSessions.threads.length - 1; index >= 0; index -= 1) {
      const entry = persistedSessions.threads[index];
      if (entry && typeof entry === "object" && entry.chatId === cleanedChatId) {
        return {
          threadId: typeof entry.threadId === "string" ? entry.threadId.trim() : "",
          chatId: typeof entry.chatId === "string" ? entry.chatId.trim() : "",
          sessionId: typeof entry.sessionId === "string" ? entry.sessionId.trim() : "",
          chatName: typeof entry.chatName === "string" ? entry.chatName.trim() : "",
          createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
          updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
        };
      }
    }

    return null;
  }

  function loadPersistedSessions() {
    try {
      if (!fs.existsSync(sessionStorePath)) {
        persistedSessions = { chats: {}, threads: [] };
        return;
      }

      const raw = fs.readFileSync(sessionStorePath, "utf8");
      const parsed = JSON.parse(raw);
      persistedSessions = normalizePersistedSessions(parsed);
    } catch (err) {
      console.error("Failed to load persisted sessions:", err.message);
      persistedSessions = { chats: {}, threads: [] };
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

  function markRecentEventKey(eventKey, ttlMs = 10 * 60 * 1000) {
    if (!eventKey) {
      return false;
    }

    const now = Date.now();
    const cleanedTtlMs = Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : 10 * 60 * 1000;

    for (const [key, seenAt] of recentEventKeys.entries()) {
      if (now - seenAt > cleanedTtlMs) {
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
      const latestThread = stored.threadId ? getPersistedThreadEntry(stored.threadId) : getLatestThreadEntryForChat(chatId);
      const storedResponseId = stored.sessionId || latestThread?.sessionId || null;
      chatStates.set(chatId, {
        chatId,
        isArmed: false,
        waitingForModeChoice: false,
        waitingForResumeChatSelection: false,
        resumeChatCandidates: [],
        hasActiveSession: Boolean(storedResponseId),
        codexResponseId: storedResponseId,
        chatName: stored.chatName || latestThread?.chatName || "",
        currentThreadId: stored.threadId || latestThread?.threadId || "",
        pendingNewThread: false,
        lastSenderOpenId: "",
        lastSenderMachineId: "",
        isTurnInFlight: false,
        activeCodexProcess: null,
        pendingUserTexts: [],
        isDrainingQueue: false,
        relayStatusMessageId: "",
        relayStatusStartedAt: "",
        queuedCodexTasks: [],
        waitingForQueueSelection: false,
      });
    }

    return chatStates.get(chatId);
  }

  function setChatSessionId(chatId, state, responseId, chatName = state.chatName || "") {
    const cleanedChatName = (chatName || "").trim();
    const cleanedResponseId = (responseId || "").trim();
    state.chatName = cleanedChatName;
    state.codexResponseId = cleanedResponseId || null;

    if (!persistedSessions.chats || typeof persistedSessions.chats !== "object") {
      persistedSessions.chats = {};
    }

    if (!Array.isArray(persistedSessions.threads)) {
      persistedSessions.threads = [];
    }

    if (!cleanedResponseId) {
      const currentPointer = getPersistedChatEntry(chatId);
      if (state.currentThreadId) {
        const threadEntry = getPersistedThreadEntry(state.currentThreadId);
        if (threadEntry) {
          threadEntry.chatName = cleanedChatName || threadEntry.chatName;
          threadEntry.updatedAt = new Date().toISOString();
          const index = persistedSessions.threads.findIndex((entry) => entry && entry.threadId === threadEntry.threadId);
          if (index >= 0) {
            persistedSessions.threads[index] = threadEntry;
          }
          persistedSessions.chats[chatId] = {
            sessionId: threadEntry.sessionId,
            chatName: threadEntry.chatName,
            threadId: threadEntry.threadId,
          };
          savePersistedSessions();
        }
      } else if (currentPointer.chatName !== cleanedChatName) {
        persistedSessions.chats[chatId] = {
          sessionId: currentPointer.sessionId || "",
          chatName: cleanedChatName,
          threadId: currentPointer.threadId || "",
        };
        savePersistedSessions();
      }
      return;
    }

    const nowIso = new Date().toISOString();
    let threadId = state.currentThreadId || "";
    let threadEntry = threadId ? getPersistedThreadEntry(threadId) : null;

    if (state.pendingNewThread || !threadEntry) {
      threadId = makeThreadRecordId(chatId, cleanedChatName, cleanedResponseId);
      threadEntry = {
        threadId,
        chatId,
        sessionId: cleanedResponseId,
        chatName: cleanedChatName,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      persistedSessions.threads.push(threadEntry);
      state.pendingNewThread = false;
    } else {
      threadEntry = {
        ...threadEntry,
        chatId,
        sessionId: cleanedResponseId,
        chatName: cleanedChatName || threadEntry.chatName,
        updatedAt: nowIso,
      };
      const index = persistedSessions.threads.findIndex((entry) => entry && entry.threadId === threadEntry.threadId);
      if (index >= 0) {
        persistedSessions.threads[index] = threadEntry;
      } else {
        persistedSessions.threads.push(threadEntry);
      }
    }

    state.currentThreadId = threadId;
    persistedSessions.chats[chatId] = {
      sessionId: cleanedResponseId,
      chatName: cleanedChatName,
      threadId,
    };

    savePersistedSessions();
  }

  function setChatDisplayName(chatId, state, chatName) {
    const cleanedName = (chatName || "").trim();
    if (!cleanedName || cleanedName === state.chatName) {
      return;
    }

    state.chatName = cleanedName;
    if (state.pendingNewThread && !state.codexResponseId) {
      return;
    }

    if (state.codexResponseId || persistedSessions?.chats?.[chatId]) {
      setChatSessionId(chatId, state, state.codexResponseId, cleanedName);
    }
  }

  function buildNamedResumeChatCandidates() {
    const candidates = [];
    const threads = Array.isArray(persistedSessions.threads) && persistedSessions.threads.length > 0
      ? persistedSessions.threads
      : Object.entries(persistedSessions.chats && typeof persistedSessions.chats === "object" ? persistedSessions.chats : {}).map(([chatId, entry]) => ({
          threadId: typeof entry?.threadId === "string" ? entry.threadId.trim() : chatId,
          chatId,
          sessionId: typeof entry?.sessionId === "string" ? entry.sessionId.trim() : "",
          chatName: typeof entry?.chatName === "string" ? entry.chatName.trim() : "",
          createdAt: "",
          updatedAt: "",
        }));

    const nameCounts = new Map();
    for (const thread of threads) {
      const chatName = typeof thread.chatName === "string" ? thread.chatName.trim() : "";
      if (!chatName) {
        continue;
      }
      nameCounts.set(chatName.toLowerCase(), (nameCounts.get(chatName.toLowerCase()) || 0) + 1);
    }

    for (const thread of threads) {
      if (!thread || typeof thread !== "object") {
        continue;
      }

      const chatId = typeof thread.chatId === "string" ? thread.chatId.trim() : "";
      const threadId = typeof thread.threadId === "string" ? thread.threadId.trim() : "";
      const sessionId = typeof thread.sessionId === "string" ? thread.sessionId.trim() : "";
      const chatName = typeof thread.chatName === "string" ? thread.chatName.trim() : "";
      if (!chatName) {
        continue;
      }

      const resolvedSessionId = resolveCodexSessionIdForChat(chatName, sessionId);
      if (!resolvedSessionId) {
        continue;
      }

      const duplicateCount = nameCounts.get(chatName.toLowerCase()) || 0;
      const updatedAt = typeof thread.updatedAt === "string" ? thread.updatedAt : "";
      const displaySuffix = duplicateCount > 1 ? ` (${resolvedSessionId.slice(0, 8)})` : "";
      candidates.push({
        chatId,
        threadId,
        chatName,
        displayName: `${chatName}${displaySuffix}`,
        sessionId: resolvedSessionId,
        updatedAt,
      });
    }

    candidates.sort((a, b) => {
      const aTime = Date.parse(a.updatedAt || "") || 0;
      const bTime = Date.parse(b.updatedAt || "") || 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }

      return a.displayName.localeCompare(b.displayName);
    });
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
