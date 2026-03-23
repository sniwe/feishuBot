const Lark = require("@larksuiteoapi/node-sdk");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createStateStore } = require("./lib/state-store.js");
const { createFileTransferService } = require("./lib/file-transfer.js");
const { createCodexRunner } = require("./lib/codex-runner.js");
const { createRelayController } = require("./lib/relay.js");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
require("dotenv").config({ path: path.join(PROJECT_ROOT, ".env") });

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

function quoteForCmd(arg) {
  if (!/[ \t"&<>|^]/.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/"/g, '\\"')}"`;
}

const baseConfig = {
  appId: APP_ID,
  appSecret: APP_SECRET,
};

const client = new Lark.Client(baseConfig);
const wsClient = new Lark.WSClient({
  ...baseConfig,
  loggerLevel: Lark.LoggerLevel.info,
});

const stateStore = createStateStore({
  data: {
    projectRoot: PROJECT_ROOT,
    sessionStorePath: path.join(PROJECT_ROOT, "codex-chat-sessions.json"),
    dataDirPath: path.join(PROJECT_ROOT, "data"),
    codexSessionIndexPath: CODEX_SESSION_INDEX_PATH,
  },
  deps: { fs, os, path },
});
stateStore.load();

const fileTransfer = createFileTransferService({
  data: {
    projectRoot: PROJECT_ROOT,
    dataDirPath: path.join(PROJECT_ROOT, "data"),
  },
  deps: {
    client,
    fs,
    path,
    projectRoot: PROJECT_ROOT,
    dataDirPath: path.join(PROJECT_ROOT, "data"),
    toYYMMDD: stateStore.toYYMMDD,
    appendMessageLog: stateStore.appendMessageLog,
    getChatState: stateStore.getChatState,
    getPersistedChatEntry: stateStore.getPersistedChatEntry,
  },
});

async function sendTextMessage(chatId, text, meta = {}) {
  const state = stateStore.getChatState(chatId);
  const persistedEntry = stateStore.getPersistedChatEntry(chatId);
  stateStore.appendMessageLog({
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

const codexRunner = createCodexRunner({
  data: {
    projectRoot: PROJECT_ROOT,
    codexCommand: CODEX_COMMAND,
    codexModel: CODEX_MODEL,
    codexExtraArgs: CODEX_EXTRA_ARGS,
    codexRelayPrompt: CODEX_RELAY_PROMPT,
  },
  deps: {
    spawn,
    fs,
    os,
    path,
    projectRoot: PROJECT_ROOT,
    codexCommand: CODEX_COMMAND,
    codexModel: CODEX_MODEL,
    codexExtraArgs: CODEX_EXTRA_ARGS,
    codexRelayPrompt: CODEX_RELAY_PROMPT,
    quoteForCmd,
    splitForFeishu: stateStore.splitForFeishu,
    uploadFileToChat: fileTransfer.uploadFileToChat,
    sendTextMessage,
    setChatSessionId: stateStore.setChatSessionId,
    extractThreadStartedId: stateStore.extractThreadStartedId,
    lookupCodexSessionIdByThreadName: stateStore.lookupCodexSessionIdByThreadName,
    extractUploadDirective: fileTransfer.extractUploadDirective,
  },
});

const relay = createRelayController({
  deps: {
    Lark,
    fs,
    path,
    stateStore,
    fileTransfer,
    codexRunner,
    sendTextMessage,
  },
});

const eventDispatcher = relay.createEventDispatcher();
wsClient.start({ eventDispatcher });

console.log("Feishu long connection starting...");
