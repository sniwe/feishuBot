const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createClusterRuntime } = require("../src/backend/lib/cluster-runtime.js");
const { createRelayController } = require("../src/backend/lib/relay.js");
const { formatMachineLabel, resolveTargetToken } = require("../src/backend/lib/cluster-protocol.js");

function silentConsole() {
  return {
    log() {},
    warn() {},
    error() {},
  };
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "feishuBot-cluster-test-"));
}

function makeStateStore() {
  const chatStates = new Map();
  const seenEventKeys = new Set();
  const logs = [];

  return {
    logs,
    load() {},
    getChatState(chatId) {
      if (!chatStates.has(chatId)) {
        chatStates.set(chatId, {
          chatId,
          isArmed: false,
          waitingForModeChoice: false,
          waitingForResumeChatSelection: false,
          resumeChatCandidates: [],
          hasActiveSession: false,
          codexResponseId: null,
          chatName: "",
          currentThreadId: "",
          pendingNewThread: false,
          lastSenderOpenId: "",
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
    },
    setChatDisplayName() {},
    setChatSessionId() {},
    getPersistedChatEntry() {
      return { sessionId: "", chatName: "", threadId: "" };
    },
    appendMessageLog(entry) {
      logs.push(entry);
    },
    markRecentEventKey(eventKey) {
      if (!eventKey) {
        return false;
      }

      if (seenEventKeys.has(eventKey)) {
        return true;
      }

      seenEventKeys.add(eventKey);
      return false;
    },
    splitForFeishu(text, maxLen = 3000) {
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
    },
    buildNamedResumeChatCandidates() {
      return [];
    },
  };
}

function makeFileTransfer() {
  return {
    parseMessageContent(content) {
      if (!content) {
        return {};
      }

      try {
        return JSON.parse(content);
      } catch {
        return { text: String(content) };
      }
    },
    extractUserTextFromMessage(messageType, contentObj) {
      const type = (messageType || "").trim().toLowerCase();
      if (!contentObj || typeof contentObj !== "object") {
        return "";
      }

      function renderPostNode(node) {
        if (!node || typeof node !== "object") {
          return "";
        }

        if (typeof node.text === "string") {
          return node.text;
        }

        const tag = typeof node.tag === "string" ? node.tag.trim().toLowerCase() : "";
        if (tag === "at") {
          const mentionName =
            (typeof node.open_id === "string" && node.open_id.trim()) ||
            (typeof node.user_id === "string" && node.user_id.trim()) ||
            (typeof node.id === "string" && node.id.trim()) ||
            (typeof node.user_name === "string" && node.user_name.trim()) ||
            "";
          return mentionName ? `@${mentionName}` : "@";
        }

        return "";
      }

      if (type === "text") {
        return typeof contentObj.text === "string" ? contentObj.text.trim() : "";
      }

      if (type === "post") {
        const zhCn = contentObj.zh_cn;
        const firstLocale = Object.values(contentObj).find((value) => value && typeof value === "object");
        const localeBlock = zhCn && typeof zhCn === "object" ? zhCn : firstLocale;
        const paragraphs = Array.isArray(localeBlock?.content) ? localeBlock.content : [];
        const lines = [];

        for (const paragraph of paragraphs) {
          if (!Array.isArray(paragraph)) {
            continue;
          }

          const line = paragraph
            .map((node) => renderPostNode(node))
            .join("")
            .trim();
          if (line) {
            lines.push(line);
          }
        }

        return lines.join("\n").trim();
      }

      return "";
    },
    uploadFileToChat() {},
    downloadIncomingFileFromMessage() {},
    extractUploadDirective() {
      return "";
    },
  };
}

function makeContactResolver() {
  return {
    async resolveRecipientOpenId(token) {
      if (!token) {
        return null;
      }

      return { openId: `resolved:${token}` };
    },
  };
}

function createBus() {
  const instances = [];
  let messageSeq = 0;
  let eventSeq = 0;

  return {
    register(instance) {
      instances.push(instance);
    },
    async broadcast({ senderName, chatId, text, meta = {}, senderType = "bot" }) {
      messageSeq += 1;
      eventSeq += 1;
      const event = {
        event_id: meta.event_id || `evt-${eventSeq}`,
        message: {
          chat_id: chatId,
          message_id: meta.message_id || `${senderName}-msg-${messageSeq}`,
          message_type: meta.message_type || "text",
          content: JSON.stringify({ text }),
        },
        sender: {
          sender_type: meta.sender_type || senderType,
          sender_id: {
            open_id: meta.sender_open_id || `${senderName}-open`,
          },
        },
        chat: {
          name: meta.chat_name || "hub",
        },
      };

      for (const instance of instances) {
        const handler = instance.dispatcher?.handlers?.["im.message.receive_v1"];
        if (handler) {
          // eslint-disable-next-line no-await-in-loop
          await handler(event);
        }
      }

      return event;
    },
  };
}

function createHarness({ name, alias, machineId, mentionId = "", bus, statePath, clusterChatId = "hub" }) {
  const stateStore = makeStateStore();
  const fileTransfer = makeFileTransfer();
  const contactResolver = makeContactResolver();
  const codexCalls = [];
  const directMessages = [];
  const sentMessages = [];
  const consoleStub = silentConsole();

  const harness = {
    name,
    alias,
    machineId,
    statePath,
    stateStore,
    fileTransfer,
    contactResolver,
    codexCalls,
    directMessages,
    sentMessages,
    dispatcher: null,
  };

  harness.sendTextMessage = async (chatId, text, meta = {}) => {
    const messageId = `${name}-out-${sentMessages.length + 1}`;
    sentMessages.push({ chatId, text, meta, messageId });
    await bus.broadcast({
      senderName: name,
      chatId,
      text,
      meta: {
        ...meta,
        message_id: messageId,
      },
      senderType: meta.sender_type || "bot",
    });
    return messageId;
  };

  harness.clusterRuntime = createClusterRuntime({
    data: {
      statePath,
      clusterMode: "multi",
      clusterChatId,
      machineAlias: alias,
      machineId,
      machineMentionId: mentionId,
      announceOnStart: true,
    },
    deps: {
      fs,
      os,
      path,
      crypto,
      console: consoleStub,
      sendTextMessage: harness.sendTextMessage,
    },
  });

  harness.codexRunner = {
    async runCodexTurn(chatId, state, text) {
      codexCalls.push({
        chatId,
        text,
        machineId: harness.machineId,
        armed: state.isArmed,
      });
    },
    async startNewCodexSession() {},
    async cancelTurn() {},
    async stopCodexSession() {},
  };

  const relay = createRelayController({
    deps: {
      Lark: {
        EventDispatcher: class {
          constructor() {
            this.handlers = {};
          }

          register(handlers) {
            this.handlers = handlers;
            return this;
          }
        },
      },
      fs,
      path,
      stateStore,
      fileTransfer,
      contactResolver,
      codexRunner: harness.codexRunner,
      sendTextMessage: harness.sendTextMessage,
      sendDirectMessage: async (openId, text, meta = {}) => {
        directMessages.push({ openId, text, meta });
      },
      clusterRuntime: harness.clusterRuntime,
    },
  });

  harness.dispatcher = relay.createEventDispatcher();
  bus.register(harness);

  return harness;
}

test("hello handshake records peers and replies once", async () => {
  const root = makeTempDir();
  const bus = createBus();

  const alpha = createHarness({
    name: "alpha",
    alias: "alpha",
    machineId: "aaaa1111-aaaa-1111-aaaa-111111111111",
    bus,
    statePath: path.join(root, "alpha-state.json"),
  });
  const bravo = createHarness({
    name: "bravo",
    alias: "bravo",
    machineId: "bbbb2222-bbbb-2222-bbbb-222222222222",
    bus,
    statePath: path.join(root, "bravo-state.json"),
  });

  await alpha.clusterRuntime.announceHello("hub");

  assert.equal(alpha.sentMessages.filter((entry) => entry.meta.cluster_protocol === "identity").length, 0);
  assert.equal(bravo.sentMessages.filter((entry) => entry.meta.cluster_protocol === "identity").length, 1);
  assert.equal(alpha.clusterRuntime.getPeers().some((peer) => peer.machineId === bravo.machineId), true);
  assert.equal(bravo.clusterRuntime.getPeers().some((peer) => peer.machineId === alpha.machineId), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test("peer-targeted messages forward to the peer relay chat", async () => {
  const root = makeTempDir();
  const bus = createBus();
  const alphaRelayChatId = "alpha-relay";
  const bravoRelayChatId = "bravo-relay";

  const alpha = createHarness({
    name: "alpha",
    alias: "alpha",
    machineId: "aaaa1111-aaaa-1111-aaaa-111111111111",
    clusterChatId: alphaRelayChatId,
    bus,
    statePath: path.join(root, "alpha-state.json"),
  });
  const bravo = createHarness({
    name: "bravo",
    alias: "bravo",
    machineId: "bbbb2222-bbbb-2222-bbbb-222222222222",
    clusterChatId: bravoRelayChatId,
    bus,
    statePath: path.join(root, "bravo-state.json"),
  });

  alpha.clusterRuntime.recordHello({
    machineId: bravo.machineId,
    alias: bravo.alias,
    mentionId: "ou_bravo",
    hostname: "bravo-host",
    bootId: "boot-bravo",
    announceId: "announce-bravo",
  }, {
    chatId: bravoRelayChatId,
    senderOpenId: "ou_bravo",
  });

  alpha.sentMessages.length = 0;
  bravo.sentMessages.length = 0;
  alpha.codexCalls.length = 0;
  bravo.codexCalls.length = 0;

  await bus.broadcast({
    senderName: "human",
    chatId: alphaRelayChatId,
    text: "@bravo: ping",
    senderType: "user",
  });

  assert.equal(alpha.codexCalls.length, 0);
  assert.equal(bravo.codexCalls.length, 1);
  assert.equal(bravo.codexCalls[0].text, "ping");
  assert.equal(
    alpha.sentMessages.some((entry) =>
      entry.chatId === bravoRelayChatId &&
      entry.meta &&
      entry.meta.relay_forwarded === true &&
      entry.meta.relay_forward_target_machine_id === bravo.machineId,
    ),
    true,
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test("targeted user messages resolve machine mention ids", async () => {
  const root = makeTempDir();
  const bus = createBus();
  const alphaRelayChatId = "alpha-relay";
  const bravoRelayChatId = "bravo-relay";

  const alpha = createHarness({
    name: "alpha",
    alias: "alpha",
    machineId: "aaaa1111-aaaa-1111-aaaa-111111111111",
    mentionId: "ou_alpha_target",
    clusterChatId: alphaRelayChatId,
    bus,
    statePath: path.join(root, "alpha-state.json"),
  });
  const bravo = createHarness({
    name: "bravo",
    alias: "bravo",
    machineId: "bbbb2222-bbbb-2222-bbbb-222222222222",
    mentionId: "ou_bravo_target",
    clusterChatId: bravoRelayChatId,
    bus,
    statePath: path.join(root, "bravo-state.json"),
  });

  alpha.clusterRuntime.recordHello({
    machineId: bravo.machineId,
    alias: bravo.alias,
    mentionId: "ou_bravo_target",
    hostname: "bravo-host",
    bootId: "boot-bravo",
    announceId: "announce-bravo",
  }, {
    chatId: bravoRelayChatId,
    senderOpenId: "ou_bravo_target",
  });

  alpha.sentMessages.length = 0;
  bravo.sentMessages.length = 0;
  alpha.codexCalls.length = 0;
  bravo.codexCalls.length = 0;

  await bus.broadcast({
    senderName: "human",
    chatId: alphaRelayChatId,
    text: "@ou_bravo_target: ping",
    senderType: "user",
  });

  assert.equal(alpha.codexCalls.length, 0);
  assert.equal(bravo.codexCalls.length, 1);
  assert.equal(bravo.codexCalls[0].text, "ping");
  assert.equal(
    alpha.sentMessages.some((entry) =>
      entry.chatId === bravoRelayChatId &&
      entry.meta &&
      entry.meta.relay_forwarded === true &&
      entry.meta.relay_forward_target_mention_id === "ou_bravo_target",
    ),
    true,
  );

  fs.rmSync(root, { recursive: true, force: true });
});

test("bare self mention wakes local codex", async () => {
  const root = makeTempDir();
  const bus = createBus();

  const alpha = createHarness({
    name: "alpha",
    alias: "qub",
    machineId: "aaaa1111-aaaa-1111-aaaa-111111111111",
    bus,
    statePath: path.join(root, "alpha-state.json"),
  });

  alpha.stateStore.getChatState("hub").isArmed = false;
  alpha.stateStore.getChatState("hub").hasActiveSession = false;

  await bus.broadcast({
    senderName: "human",
    chatId: "hub",
    text: "@qub",
    senderType: "user",
  });

  assert.equal(alpha.sentMessages.some((entry) => /Codex armed\./.test(entry.text)), true);
  assert.equal(alpha.codexCalls.length, 0);

  fs.rmSync(root, { recursive: true, force: true });
});

test("post mentions preserve explicit targets", () => {
  const fileTransfer = makeFileTransfer();
  const content = {
    zh_cn: {
      content: [
        [
          { tag: "at", user_name: "qub", user_id: "ou_test_qub", open_id: "ou_test_qub_open" },
          { text: " hi" },
        ],
      ],
    },
  };

  assert.equal(fileTransfer.extractUserTextFromMessage("post", content), "@ou_test_qub_open hi");
});

test("post mentions fall back to user ids when open ids are missing", () => {
  const fileTransfer = makeFileTransfer();
  const content = {
    zh_cn: {
      content: [
        [
          { tag: "at", user_name: "qub", user_id: "ou_test_qub" },
          { text: " hi" },
        ],
      ],
    },
  };

  assert.equal(fileTransfer.extractUserTextFromMessage("post", content), "@ou_test_qub hi");
});

test("cluster mode ignores messages outside the hub chat", async () => {
  const root = makeTempDir();
  const bus = createBus();

  const alpha = createHarness({
    name: "alpha",
    alias: "alpha",
    machineId: "aaaa1111-aaaa-1111-aaaa-111111111111",
    bus,
    statePath: path.join(root, "alpha-state.json"),
  });
  const bravo = createHarness({
    name: "bravo",
    alias: "bravo",
    machineId: "bbbb2222-bbbb-2222-bbbb-222222222222",
    bus,
    statePath: path.join(root, "bravo-state.json"),
  });

  await alpha.clusterRuntime.announceHello("hub");
  alpha.sentMessages.length = 0;
  bravo.sentMessages.length = 0;
  alpha.codexCalls.length = 0;
  bravo.codexCalls.length = 0;

  await bus.broadcast({
    senderName: "human",
    chatId: "other-chat",
    text: "@bravo: ping",
    senderType: "user",
  });

  assert.equal(alpha.codexCalls.length, 0);
  assert.equal(bravo.codexCalls.length, 0);
  assert.equal(alpha.sentMessages.length, 0);
  assert.equal(bravo.sentMessages.length, 0);

  fs.rmSync(root, { recursive: true, force: true });
});

test("alias collisions require machineId fallback", () => {
  const result = resolveTargetToken("worker", {
    profile: {
      machineId: "cccc3333-cccc-3333-cccc-333333333333",
      alias: "local",
    },
    peers: [
      { machineId: "aaaa1111-aaaa-1111-aaaa-111111111111", alias: "worker" },
      { machineId: "bbbb2222-bbbb-2222-bbbb-222222222222", alias: "worker" },
    ],
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.reason, "alias-collision");
  assert.equal(
    formatMachineLabel(
      { machineId: "aaaa1111-aaaa-1111-aaaa-111111111111", alias: "worker" },
      {
        selfMachineId: "cccc3333-cccc-3333-cccc-333333333333",
        peers: [
          { machineId: "aaaa1111-aaaa-1111-aaaa-111111111111", alias: "worker" },
          { machineId: "bbbb2222-bbbb-2222-bbbb-222222222222", alias: "worker" },
        ],
      },
    ).startsWith("worker ("),
    true,
  );
  assert.equal(
    resolveTargetToken("aaaa1111-aaaa-1111-aaaa-111111111111", {
      profile: {
        machineId: "cccc3333-cccc-3333-cccc-333333333333",
        alias: "local",
      },
      peers: [
        { machineId: "aaaa1111-aaaa-1111-aaaa-111111111111", alias: "worker" },
        { machineId: "bbbb2222-bbbb-2222-bbbb-222222222222", alias: "worker" },
      ],
    }).status,
    "match",
  );
});
