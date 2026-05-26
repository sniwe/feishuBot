const Lark = require("@larksuiteoapi/node-sdk");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const { createClusterRuntime } = require("./lib/cluster-runtime.js");
const { createStateStore } = require("./lib/state-store.js");
const { createFileTransferService } = require("./lib/file-transfer.js");
const { createContactResolver } = require("./lib/contact-resolver.js");
const { createCodexRunner } = require("./lib/codex-runner.js");
const { createCodexStatusPoller } = require("./lib/codex-status-poller.js");
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
If you need to send a direct message to a Feishu user, output a single line exactly in the form "DM_USER: <open_id|last_sender|me> | <message>" and nothing else on that line.
You may also use the shorthand forms "@<recipient>: <message>" or "send a message to <recipient>: <message>" on a single line.
Recipients may be an open_id, an email address, a mobile number, or the current sender alias.
If USER_MESSAGE is vague, ask one concise clarifying question instead of echoing.`).trim();
const CODEX_SESSION_INDEX_PATH = path.join(os.homedir(), ".codex", "session_index.jsonl");
const CODEX_STATUS_PATH = path.join(PROJECT_ROOT, "mgmt", "projMap", "state", "codex-status.json");
const CLUSTER_MODE = (process.env.FEISHU_CLUSTER_MODE || "multi").trim().toLowerCase();
const CLUSTER_CHAT_ID = (process.env.FEISHU_CLUSTER_CHAT_ID || "").trim();
const MACHINE_ALIAS = (process.env.FEISHU_MACHINE_ALIAS || "").trim();
const MACHINE_ID = (process.env.FEISHU_MACHINE_ID || "").trim();
const ANNOUNCE_ON_START = !/^(false|0|no|off)$/i.test((process.env.FEISHU_ANNOUNCE_ON_START || "true").trim());
const CLUSTER_STATE_PATH = path.join(os.homedir(), "mgmt", "state", "feishuBot-cluster-state.json");

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

const contactResolver = createContactResolver({
  data: {
    cachePath: path.join(PROJECT_ROOT, "data", "contact-resolver-cache.json"),
  },
  deps: {
    client,
    fs,
    path,
  },
});
contactResolver.loadCache();

async function sendMessage(receiveIdType, receiveId, text, meta = {}) {
  const isChatMessage = receiveIdType === "chat_id";
  const state = isChatMessage ? stateStore.getChatState(receiveId) : null;
  const persistedEntry = isChatMessage ? stateStore.getPersistedChatEntry(receiveId) : { sessionId: "", chatName: "" };
  const response = await client.im.v1.message.create({
    params: { receive_id_type: receiveIdType },
    data: {
      receive_id: receiveId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });

  stateStore.appendMessageLog({
    direction: "outgoing",
    chat_id: isChatMessage ? receiveId : "",
    message_type: "text",
    text,
    codex_session_id: state?.codexResponseId || persistedEntry.sessionId || "",
    chat_name: persistedEntry.chatName || "",
    destination_type: receiveIdType,
    destination_id: receiveId,
    message_id: response?.data?.message_id || "",
    ...meta,
  });

  return response?.data?.message_id || "";
}

async function sendTextMessage(chatId, text, meta = {}) {
  return sendMessage("chat_id", chatId, text, meta);
}

async function sendDirectMessage(openId, text, meta = {}) {
  return sendMessage("open_id", openId, text, meta);
}

async function updateTextMessage(messageId, text) {
  if (!messageId) {
    return "";
  }

  await client.im.v1.message.update({
    path: { message_id: messageId },
    data: {
      msg_type: "text",
      content: JSON.stringify({ text }),
    },
  });

  return messageId;
}

async function deleteTextMessage(messageId) {
  if (!messageId) {
    return "";
  }

  await client.im.v1.message.delete({
    path: { message_id: messageId },
  });

  return messageId;
}

const clusterRuntime = createClusterRuntime({
  data: {
    statePath: CLUSTER_STATE_PATH,
    clusterMode: CLUSTER_MODE,
    clusterChatId: CLUSTER_CHAT_ID,
    machineAlias: MACHINE_ALIAS,
    machineId: MACHINE_ID,
    announceOnStart: ANNOUNCE_ON_START,
  },
  deps: {
    fs,
    os,
    path,
    crypto,
    console,
    sendTextMessage,
  },
});
const clusterProfile = clusterRuntime.getProfile();

const codexRunner = createCodexRunner({
  data: {
    projectRoot: PROJECT_ROOT,
    codexCommand: CODEX_COMMAND,
    codexModel: CODEX_MODEL,
    codexExtraArgs: CODEX_EXTRA_ARGS,
    codexRelayPrompt: CODEX_RELAY_PROMPT,
    codexStatusPath: CODEX_STATUS_PATH,
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
    codexStatusPath: CODEX_STATUS_PATH,
    quoteForCmd,
    splitForFeishu: stateStore.splitForFeishu,
    uploadFileToChat: fileTransfer.uploadFileToChat,
    resolveRecipientOpenId: contactResolver.resolveRecipientOpenId,
    sendDirectMessage,
    sendTextMessage,
    setChatSessionId: stateStore.setChatSessionId,
    extractThreadStartedId: stateStore.extractThreadStartedId,
    lookupCodexSessionIdByThreadName: stateStore.lookupCodexSessionIdByThreadName,
    extractUploadDirective: fileTransfer.extractUploadDirective,
    clusterRuntime,
  },
});

const relay = createRelayController({
  deps: {
    Lark,
    fs,
    path,
    stateStore,
    fileTransfer,
    contactResolver,
    codexRunner,
    sendTextMessage,
    sendDirectMessage,
    clusterRuntime,
  },
});

const eventDispatcher = relay.createEventDispatcher();
const codexStatusPoller = createCodexStatusPoller({
  data: {
    statusPath: CODEX_STATUS_PATH,
    intervalMs: 5000,
  },
  deps: {
    fs,
    path,
    console,
    sendTextMessage,
    deleteTextMessage,
    updateTextMessage,
    machineLabel: clusterRuntime.formatSelfLabel(),
    machineId: clusterProfile.machineId,
    machineAlias: clusterProfile.alias,
  },
});

function isProcessAlive(pid) {
  const cleanedPid = Number(pid);
  if (!Number.isInteger(cleanedPid) || cleanedPid <= 0) {
    return false;
  }

  try {
    process.kill(cleanedPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function clearStaleCodexStatus() {
  if (!fs.existsSync(CODEX_STATUS_PATH)) {
    return;
  }

  let status = null;
  try {
    status = JSON.parse(fs.readFileSync(CODEX_STATUS_PATH, "utf8"));
  } catch (err) {
    console.error("Failed to read Codex status file:", err.message);
    return;
  }

  if (!status?.busy) {
    return;
  }

  if (isProcessAlive(status.processId)) {
    return;
  }

  const clearedStatus = {
    ...status,
    busy: false,
    processId: null,
    codexSessionId: "",
    statusMessageId: "",
    startedAt: "",
    statusEditCount: 0,
    updatedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(CODEX_STATUS_PATH, JSON.stringify(clearedStatus, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to clear stale Codex status:", err.message);
    return;
  }

  if (status.statusMessageId) {
    try {
      await deleteTextMessage(status.statusMessageId);
    } catch (err) {
      console.error("Failed to delete stale Codex working message:", err.message);
    }
  }
}

void (async () => {
  await clearStaleCodexStatus();
  codexStatusPoller.start();
  wsClient.start({ eventDispatcher });
  void clusterRuntime.announceHello(clusterProfile.clusterChatId || CLUSTER_CHAT_ID).catch((err) => {
    console.error("Failed to send cluster hello:", err.message);
  });
})();

let shutdownStarted = false;
async function gracefulShutdown(reason) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  try {
    await clusterRuntime.announceGoodbye(clusterProfile.clusterChatId || CLUSTER_CHAT_ID, reason);
  } catch (err) {
    console.error("Failed to send cluster goodbye:", err.message);
  }
}

process.once("SIGINT", () => {
  void gracefulShutdown("SIGINT").finally(() => {
    process.exit(0);
  });
});

process.once("SIGTERM", () => {
  void gracefulShutdown("SIGTERM").finally(() => {
    process.exit(0);
  });
});

console.log("Feishu long connection starting...");
