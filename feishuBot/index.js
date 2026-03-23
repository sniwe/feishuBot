require("dotenv").config({ path: __dirname + "/.env" });

const Lark = require("@larksuiteoapi/node-sdk");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const CODEX_COMMAND = (
  process.env.CODEX_COMMAND ||
  path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm", "codex.cmd")
).trim();
const CODEX_MODEL = (process.env.CODEX_MODEL || process.env.OPENAI_MODEL || "gpt-5.3-codex").trim();
const CODEX_EXTRA_ARGS = (process.env.CODEX_EXTRA_ARGS || "").trim();
const CODEX_RELAY_PROMPT = (process.env.CODEX_RELAY_PROMPT || `You are replying through a chat relay.
Return only the final user-facing answer text.
Do not include tool logs, status lines, internal reasoning, or metadata.
Never output exactly the same text as USER_MESSAGE.
If the user asks you to upload a local file, you must output a single line exactly in the form "UPLOAD_FILE: <absolute_path>" and nothing else on that line.
If USER_MESSAGE is vague, ask one concise clarifying question instead of echoing.`).trim();
const CODEX_SESSION_INDEX_PATH = path.join(os.homedir(), ".codex", "session_index.jsonl");

const baseConfig = {
  appId: APP_ID,
  appSecret: APP_SECRET,
};

const client = new Lark.Client(baseConfig);

const wsClient = new Lark.WSClient({
  ...baseConfig,
  loggerLevel: Lark.LoggerLevel.info,
});

const SESSION_STORE_PATH = path.join(__dirname, "codex-chat-sessions.json");
const DATA_DIR_PATH = path.join(__dirname, "data");
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

function loadCodexSessionIndex() {
  try {
    if (!fs.existsSync(CODEX_SESSION_INDEX_PATH)) {
      return [];
    }

    const raw = fs.readFileSync(CODEX_SESSION_INDEX_PATH, "utf8");
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

function isLikelyCodexSessionId(sessionId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((sessionId || "").trim());
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

function loadPersistedSessions() {
  try {
    if (!fs.existsSync(SESSION_STORE_PATH)) {
      persistedSessions = { chats: {} };
      return;
    }

    const raw = fs.readFileSync(SESSION_STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    persistedSessions = normalizePersistedSessions(parsed);
  } catch (err) {
    console.error("Failed to load persisted sessions:", err.message);
    persistedSessions = { chats: {} };
  }
}

function savePersistedSessions() {
  try {
    fs.writeFileSync(SESSION_STORE_PATH, JSON.stringify(persistedSessions, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save persisted sessions:", err.message);
  }
}

function toYYMMDD(date = new Date()) {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function getDailyMessagesPath(date = new Date()) {
  const dirPath = path.join(DATA_DIR_PATH, toYYMMDD(date));
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
    if (resolvedSessionId && !sessionId) {
      persistedSessions.chats[chatId] = {
        sessionId: resolvedSessionId,
        chatName,
      };
      savePersistedSessions();
    } else if (resolvedSessionId && resolvedSessionId !== sessionId) {
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

async function sendResumeChatOptions(chatId, state) {
  const candidates = buildNamedResumeChatCandidates();

  if (!candidates.length) {
    state.waitingForModeChoice = true;
    await sendTextMessage(chatId, "No named chats with saved sessions yet. Reply 2 to start a new session.");
    return;
  }

  state.waitingForResumeChatSelection = true;
  state.resumeChatCandidates = candidates;
  const options = candidates.map((candidate, index) => `${index + 1}) ${candidate.chatName}`);
  await sendTextMessage(chatId, `Select a chat to resume:\n${options.join("\n")}`);
}

function extractChatName(data) {
  const candidates = [
    data?.message?.chat_name,
    data?.chat?.name,
    data?.event?.chat?.name,
    data?.event?.message?.chat_name,
    data?.message?.chat_display_name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return "";
}

function extractRenameDirective(text) {
  const lines = (text || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const match = trimmed.match(/^!?(?:\/)?rename\s+(.+)$/i);
    if (!match || !match[1]) {
      continue;
    }

    return match[1].trim().replace(/^["'`]+|["'`]+$/g, "");
  }

  return "";
}

async function applyChatRename(chatId, state, chatName) {
  const cleanedName = (chatName || "").trim();
  if (!cleanedName) {
    await sendTextMessage(chatId, "Reply with a chat name after /rename.");
    return;
  }

  const storedEntry = getPersistedChatEntry(chatId);
  const sessionId = state.codexResponseId || storedEntry.sessionId || "";
  if (!sessionId) {
    await sendTextMessage(chatId, "Start or resume a session before renaming this chat.");
    return;
  }

  setChatSessionId(chatId, state, sessionId, cleanedName);
  state.hasActiveSession = true;
  await sendTextMessage(chatId, `Saved chat name as "${cleanedName}".`);
}

async function sendTextMessage(chatId, text, meta = {}) {
  const state = chatStates.get(chatId);
  const persistedEntry = getPersistedChatEntry(chatId);
  appendMessageLog({
    direction: "outgoing",
    chat_id: chatId,
    message_type: "text",
    text,
    codex_session_id: state?.codexResponseId || persistedEntry.sessionId || "",
    chat_name: persistedEntry.chatName || "",
    ...meta,
  });

  await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });
}

async function sendModeOptions(chatId) {
  await sendTextMessage(chatId, "Codex armed.\n1) resume\n2) new");
}

function buildCodexPrompt(userText) {
  return `${CODEX_RELAY_PROMPT}\n\nUSER_MESSAGE: ${userText}\nASSISTANT_REPLY:`;
}

function buildCodexArgs(outputPath) {
  const args = ["exec", "--json", "--sandbox", "danger-full-access", "--cd", __dirname, "--output-last-message", outputPath];

  if (CODEX_MODEL) {
    args.push("--model", CODEX_MODEL);
  }

  if (CODEX_EXTRA_ARGS) {
    for (const chunk of CODEX_EXTRA_ARGS.split(/\s+/).filter(Boolean)) {
      args.push(chunk);
    }
  }

  args.push("-");
  return args;
}

function quoteForCmd(arg) {
  if (!/[ \t"&<>|^]/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

function buildCodexCommandLine(outputPath) {
  const args = buildCodexArgs(outputPath);
  return [CODEX_COMMAND, ...args].map(quoteForCmd).join(" ");
}

function buildCodexResumeArgs(sessionId, outputPath) {
  const args = ["exec", "resume", "--json", "--output-last-message", outputPath];

  if (CODEX_MODEL) {
    args.push("--model", CODEX_MODEL);
  }

  if (CODEX_EXTRA_ARGS) {
    for (const chunk of CODEX_EXTRA_ARGS.split(/\s+/).filter(Boolean)) {
      args.push(chunk);
    }
  }

  args.push(sessionId);
  args.push("-");
  return args;
}

function inferImFileType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4") {
    return "mp4";
  }
  if (ext === ".pdf") {
    return "pdf";
  }
  if (ext === ".doc" || ext === ".docx") {
    return "doc";
  }
  if (ext === ".xls" || ext === ".xlsx") {
    return "xls";
  }
  if (ext === ".ppt" || ext === ".pptx") {
    return "ppt";
  }
  if (ext === ".mp3" || ext === ".wav" || ext === ".m4a" || ext === ".aac" || ext === ".ogg" || ext === ".opus") {
    return "opus";
  }
  return "stream";
}

function resolveUploadPath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(__dirname, inputPath);
}

function sanitizeFileName(fileName, fallback = "downloaded_file") {
  const name = (fileName || "").trim();
  if (!name) {
    return fallback;
  }

  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

function parseMessageContent(content) {
  try {
    const parsed = JSON.parse(content || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function downloadIncomingFileFromMessage(messageId, fileKey, fileName) {
  if (!messageId || !fileKey) {
    throw new Error("Missing message_id or file_key for file download.");
  }

  const saveDir = path.join(DATA_DIR_PATH, toYYMMDD(new Date()), "incoming_files");
  fs.mkdirSync(saveDir, { recursive: true });
  const safeName = sanitizeFileName(fileName, `${fileKey}.bin`);
  const savePath = path.join(saveDir, safeName);

  const downloadResult = await client.im.v1.messageResource.get({
    params: { type: "file" },
    path: {
      message_id: messageId,
      file_key: fileKey,
    },
  });

  await downloadResult.writeFile(savePath);
  return savePath;
}

function makeUniqueFilePath(dirPath, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(dirPath, fileName);
  let counter = 1;

  while (fs.existsSync(candidate)) {
    const suffix = ` (${counter})`;
    candidate = path.join(dirPath, `${parsed.name}${suffix}${parsed.ext}`);
    counter += 1;
  }

  return candidate;
}

function saveOutgoingFileToDailyDataDir(sourcePath) {
  const saveDir = path.join(DATA_DIR_PATH, toYYMMDD(new Date()), "outgoing_files");
  fs.mkdirSync(saveDir, { recursive: true });

  const safeName = sanitizeFileName(path.basename(sourcePath), `${Date.now()}.bin`);
  const savePath = makeUniqueFilePath(saveDir, safeName);
  fs.copyFileSync(sourcePath, savePath);
  return savePath;
}

function extractUploadDirective(text) {
  const lines = (text || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const directMatch = trimmed.match(/^!upload\s+(.+)$/i) || trimmed.match(/^UPLOAD_FILE:\s*(.+)$/i);
    if (directMatch && directMatch[1]) {
      return directMatch[1].trim().replace(/^["'`]+|["'`]+$/g, "");
    }
  }

  return "";
}

async function uploadFileToChat(chatId, inputPath) {
  const cleanedInputPath = (inputPath || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  const resolvedPath = resolveUploadPath(cleanedInputPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }

  const stats = fs.statSync(resolvedPath);
  if (!stats.isFile()) {
    throw new Error(`Not a file: ${resolvedPath}`);
  }

  if (stats.size <= 0) {
    throw new Error(`File is empty: ${resolvedPath}`);
  }

  const savedOutgoingPath = saveOutgoingFileToDailyDataDir(resolvedPath);
  const maxUploadSize = 30 * 1024 * 1024;
  if (stats.size > maxUploadSize) {
    throw new Error(`File exceeds Feishu upload limit of 30MB: ${resolvedPath}`);
  }

  const uploadResult = await client.im.v1.file.create({
    data: {
      file_type: inferImFileType(resolvedPath),
      file_name: path.basename(resolvedPath),
      file: fs.createReadStream(resolvedPath),
    },
  });

  const fileKey = uploadResult && typeof uploadResult.file_key === "string" ? uploadResult.file_key : "";
  if (!fileKey) {
    throw new Error("Feishu did not return a file_key for the uploaded file.");
  }

  await client.im.v1.message.create({
    params: { receive_id_type: "chat_id" },
    data: {
      receive_id: chatId,
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
    },
  });

  const state = chatStates.get(chatId);
  const persistedEntry = getPersistedChatEntry(chatId);
  appendMessageLog({
    direction: "outgoing",
    chat_id: chatId,
    message_type: "file",
    file_key: fileKey,
    file_path: resolvedPath,
    saved_outgoing_path: savedOutgoingPath,
    codex_session_id: state?.codexResponseId || persistedEntry.sessionId || "",
    chat_name: persistedEntry.chatName || "",
  });

  return { resolvedPath, fileKey, savedOutgoingPath };
}

async function handleUserText(chatId, state, userText) {
  const normalizedText = userText.toLowerCase();

  if (normalizedText.startsWith("!upload ")) {
    try {
      const uploadPath = userText.slice("!upload ".length).trim();
      await uploadFileToChat(chatId, uploadPath);
    } catch (uploadErr) {
      console.error("Upload error:", uploadErr);
      await sendTextMessage(chatId, `Failed to upload file: ${uploadErr.message}`);
    }
    return;
  }

  const renameTarget = extractRenameDirective(userText);
  if (renameTarget) {
    await applyChatRename(chatId, state, renameTarget);
    return;
  }

  if (normalizedText === "!codex on") {
    state.isArmed = true;
    state.waitingForModeChoice = true;
    state.waitingForResumeChatSelection = false;
    state.resumeChatCandidates = [];
    await sendModeOptions(chatId);
    return;
  }

  if (normalizedText === "!codex off") {
    state.isArmed = false;
    state.waitingForModeChoice = false;
    state.waitingForResumeChatSelection = false;
    state.resumeChatCandidates = [];
    await stopCodexSession(chatId, state);
    return;
  }

  if (normalizedText === "!codex cancel") {
    await cancelTurn(chatId, state);
    return;
  }

  if (!state.isArmed) {
    return;
  }

  if (state.waitingForResumeChatSelection) {
    const selectedIndex = Number.parseInt(normalizedText, 10);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > state.resumeChatCandidates.length) {
      await sendTextMessage(chatId, "Reply with a valid chat number from the list.");
      return;
    }

    const selected = state.resumeChatCandidates[selectedIndex - 1];
    state.waitingForResumeChatSelection = false;
    state.resumeChatCandidates = [];
    state.waitingForModeChoice = false;
    state.hasActiveSession = true;
    setChatSessionId(chatId, state, selected.sessionId, selected.chatName);
    await sendTextMessage(chatId, `Resumed Codex session from "${selected.chatName}". Send your message.`);
    return;
  }

  if (state.waitingForModeChoice) {
    if (normalizedText === "1") {
      state.waitingForModeChoice = false;
      await sendResumeChatOptions(chatId, state);
      return;
    }

    if (normalizedText === "2") {
      state.waitingForModeChoice = false;
      await startNewCodexSession(chatId, state);
      return;
    }

    await sendTextMessage(chatId, "Reply with 1 or 2.");
    return;
  }

  if (!state.hasActiveSession) {
    state.waitingForModeChoice = true;
    await sendModeOptions(chatId);
    return;
  }

  await runCodexTurn(chatId, state, userText);
}

async function handleIncomingFileMessage(data, chatId, state) {
  const contentObj = parseMessageContent(data.message?.content);
  const fileKey = typeof contentObj.file_key === "string" ? contentObj.file_key.trim() : "";
  const fileName = typeof contentObj.file_name === "string" ? contentObj.file_name.trim() : "";
  const messageId = data.message?.message_id || "";
  const persistedEntry = getPersistedChatEntry(chatId);

  if (!fileKey || !messageId) {
    await sendTextMessage(chatId, "I received a file message but it did not include a valid file key.");
    return;
  }

  const downloadedPath = await downloadIncomingFileFromMessage(messageId, fileKey, fileName);
  const ext = path.extname(downloadedPath).toLowerCase();

  appendMessageLog({
    direction: "incoming",
    chat_id: chatId,
    event_id: data.event_id || "",
    message_id: messageId,
    message_type: "file",
    file_key: fileKey,
    file_name: fileName || path.basename(downloadedPath),
    downloaded_path: downloadedPath,
    sender_type: data.sender?.sender_type || "",
    sender_open_id: data.sender?.sender_id?.open_id || "",
    codex_session_id: state.codexResponseId || persistedEntry.sessionId || "",
    chat_name: extractChatName(data) || persistedEntry.chatName || "",
  });

  if (ext !== ".txt") {
    await sendTextMessage(chatId, `Downloaded file: ${downloadedPath}. I currently auto-extract text only from .txt files.`);
    return;
  }

  let textContent = fs.readFileSync(downloadedPath, "utf8");
  textContent = textContent.replace(/\u0000/g, "").trim();
  const maxChars = 20000;
  const truncated = textContent.length > maxChars;
  const extractedText = truncated ? `${textContent.slice(0, maxChars)}\n\n[truncated]` : textContent;

  if (!extractedText) {
    await sendTextMessage(chatId, `Downloaded ${path.basename(downloadedPath)} but it appears to be empty.`);
    return;
  }

  appendMessageLog({
    direction: "system",
    chat_id: chatId,
    message_type: "file_extract",
    source_path: downloadedPath,
    extracted_char_count: extractedText.length,
    truncated,
    codex_session_id: state.codexResponseId || persistedEntry.sessionId || "",
    chat_name: extractChatName(data) || persistedEntry.chatName || "",
  });

  await sendTextMessage(chatId, `Extracted text from ${path.basename(downloadedPath)}:\n${extractedText}`);
}

async function drainUserTextQueue(chatId, state) {
  if (state.isDrainingQueue) {
    return;
  }

  state.isDrainingQueue = true;
  try {
    while (state.pendingUserTexts.length > 0) {
      const nextText = state.pendingUserTexts.shift();
      if (typeof nextText !== "string" || !nextText.trim()) {
        continue;
      }

      await handleUserText(chatId, state, nextText);
    }
  } finally {
    state.isDrainingQueue = false;
    if (state.pendingUserTexts.length > 0) {
      void drainUserTextQueue(chatId, state);
    }
  }
}

function extractLastUsefulText(text) {
  const raw = (text || "").trim();
  if (!raw) {
    return "";
  }

  const lines = raw.split(/\r?\n/);
  const useful = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (/^(Codex stderr:|\[info\]:|\[warn\]:|warning:|deprecated:|\d{4}-\d{2}-\d{2}T)/.test(trimmed)) {
      continue;
    }

    if (trimmed === "codex") {
      continue;
    }

    useful.push(trimmed);
  }

  return useful.join("\n").trim();
}

async function runCodexTurn(chatId, state, userText) {
  if (state.isTurnInFlight) {
    return;
  }

  state.isTurnInFlight = true;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feishuBot-codex-"));
  const outputPath = path.join(tempDir, "last-message.txt");
  const prompt = buildCodexPrompt(userText);
  const codexSessionId = typeof state.codexResponseId === "string" ? state.codexResponseId.trim() : "";
  const codexArgs = codexSessionId ? buildCodexResumeArgs(codexSessionId, outputPath) : buildCodexArgs(outputPath);
  const child = spawn("cmd.exe", ["/d", "/s", "/c", [CODEX_COMMAND, ...codexArgs].map(quoteForCmd).join(" ")], {
    cwd: __dirname,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  state.activeCodexProcess = child;
  let stderr = "";
  let stdout = "";

  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.once("close", resolve);
      child.stdin.end(prompt);
    });

    const fileText = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    const finalMessage = extractLastUsefulText(fileText) || extractLastUsefulText(stdout) || extractLastUsefulText(stderr);

    if (exitCode !== 0 && !finalMessage) {
      throw new Error(`Codex exec exited with code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
    }

    if (!finalMessage) {
      await sendTextMessage(chatId, "No response content returned by Codex.");
      return;
    }

    const startedSessionId = extractThreadStartedId(stdout);
    if (startedSessionId) {
      setChatSessionId(chatId, state, startedSessionId, state.chatName);
    } else if (codexSessionId) {
      setChatSessionId(chatId, state, codexSessionId, state.chatName);
    } else {
      const fallbackSessionId = lookupCodexSessionIdByThreadName(state.chatName) || "";
      setChatSessionId(chatId, state, fallbackSessionId, state.chatName);
    }
    state.hasActiveSession = true;

    const uploadPath = extractUploadDirective(finalMessage);
    let messageText = finalMessage;
    if (uploadPath) {
      await uploadFileToChat(chatId, uploadPath);
      messageText = finalMessage
        .split(/\r?\n/)
        .filter((line) => !/^(!upload\s+|UPLOAD_FILE:)/i.test(line.trim()))
        .join("\n")
        .trim();
    }

    for (const chunk of splitForFeishu(messageText)) {
      await sendTextMessage(chatId, chunk);
    }
  } catch (err) {
    if (err && err.signal === "SIGTERM") {
      return;
    }

    console.error("Codex request error:", err);
    await sendTextMessage(chatId, `Failed to run Codex: ${err.message}`);
  } finally {
    state.isTurnInFlight = false;
    if (state.activeCodexProcess === child) {
      state.activeCodexProcess = null;
    }

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error("Failed to clean Codex temp dir:", cleanupErr.message);
    }
  }
}

async function startNewCodexSession(chatId, state) {
  state.hasActiveSession = true;
  state.waitingForResumeChatSelection = false;
  state.resumeChatCandidates = [];
  state.isTurnInFlight = false;
  state.activeCodexProcess = null;
  setChatSessionId(chatId, state, null, state.chatName);

  await sendTextMessage(chatId, "Started new Codex session. Send your message.");
}

async function cancelTurn(chatId, state) {
  if (!state.activeCodexProcess) {
    await sendTextMessage(chatId, "No active Codex request to cancel.");
    return;
  }

  state.activeCodexProcess.kill();
  state.activeCodexProcess = null;
  state.isTurnInFlight = false;
  await sendTextMessage(chatId, "Cancelled current Codex request.");
}

async function stopCodexSession(chatId, state) {
  if (state.activeCodexProcess) {
    state.activeCodexProcess.kill();
  }

  state.hasActiveSession = false;
  state.waitingForResumeChatSelection = false;
  state.resumeChatCandidates = [];
  state.isTurnInFlight = false;
  state.activeCodexProcess = null;
  setChatSessionId(chatId, state, state.codexResponseId, state.chatName);

  await sendTextMessage(chatId, "Codex disarmed.");
}

loadPersistedSessions();

const eventDispatcher = new Lark.EventDispatcher({}).register({
  "im.message.receive_v1": async (data) => {
    try {
      console.log("Received event:", JSON.stringify(data, null, 2));

      if (!data?.message) {
        return;
      }

      if (data?.sender?.sender_type !== "user") {
        return;
      }

      const chatId = data.message.chat_id;
      const state = getChatState(chatId);
      const chatName = extractChatName(data);
      if (chatName) {
        setChatDisplayName(chatId, state, chatName);
      }
      const eventKey = data.event_id || data.message.message_id;
      if (markRecentEventKey(eventKey)) {
        return;
      }

      if (data.message.message_type === "file") {
        await handleIncomingFileMessage(data, chatId, state);
        return;
      }

      if (data.message.message_type !== "text") {
        return;
      }

      const contentObj = parseMessageContent(data.message.content);
      const userText = (contentObj.text || "").trim();

      const persistedEntry = getPersistedChatEntry(chatId);
      appendMessageLog({
        direction: "incoming",
        chat_id: chatId,
        event_id: data.event_id || "",
        message_id: data.message.message_id || "",
        message_type: data.message.message_type || "",
        text: userText,
        sender_type: data.sender?.sender_type || "",
        sender_open_id: data.sender?.sender_id?.open_id || "",
        codex_session_id: state.codexResponseId || persistedEntry.sessionId || "",
        chat_name: extractChatName(data) || persistedEntry.chatName || "",
      });

      if (!userText) {
        return;
      }

      state.pendingUserTexts.push(userText);
      await drainUserTextQueue(chatId, state);
    } catch (err) {
      console.error("Handler error:", err);
    }
  },
});

wsClient.start({ eventDispatcher });

console.log("Feishu long connection starting...");
