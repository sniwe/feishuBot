const assert = require("assert");
const events = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { createCodexRunner } = require("../src/backend/lib/codex-runner.js");

test("codex runner recognizes machine relay directives before human DM directives", () => {
  const runner = createCodexRunner({
    data: {
      projectRoot: "C:\\tmp\\project",
      codexCommand: "codex",
      codexModel: "gpt-5.3-codex",
      codexExtraArgs: "",
      codexRelayPrompt: "relay prompt",
      codexStatusPath: "",
      turnTimeoutMs: 1000,
    },
    deps: {
      spawn: () => {
        throw new Error("spawn not expected");
      },
      fs: require("fs"),
      os: require("os"),
      path: require("path"),
      projectRoot: "C:\\tmp\\project",
      codexCommand: "codex",
      codexModel: "gpt-5.3-codex",
      codexExtraArgs: "",
      codexRelayPrompt: "relay prompt",
      codexStatusPath: "",
      quoteForCmd: (value) => value,
      splitForFeishu: (text) => [text],
      uploadFileToChat: async () => "",
      resolveRecipientOpenId: async () => ({ openId: "ou_human" }),
      sendDirectMessage: async () => "",
      sendTextMessage: async () => "",
      setChatSessionId: () => {},
      extractThreadStartedId: () => "",
      lookupCodexSessionIdByThreadName: () => "",
      extractUploadDirective: () => "",
      clusterRuntime: {
        isEnabled: () => true,
        getProfile: () => ({ machineId: "bot-self", alias: "self" }),
        formatSelfLabel: () => "self",
        getMachineRoster: () => [
          { machineId: "bot-self", alias: "self", source: "self" },
          { machineId: "bot-peer", alias: "atlas", source: "directory" },
        ],
        resolveTarget: (token) => {
          if (token === "bot-peer" || token === "atlas") {
            return {
              status: "match",
              scope: "directory",
              source: "directory",
              machineId: "bot-peer",
              alias: "atlas",
            };
          }

          return { status: "miss", targetToken: token };
        },
      },
    },
  });

  const relayDirective = runner.extractRelayDirective("@atlas: answer the ping", {});
  assert.ok(relayDirective);
  assert.equal(relayDirective.targetToken, "atlas");
  assert.equal(relayDirective.machineId, "bot-peer");
  assert.equal(relayDirective.message, "answer the ping");
  assert.equal(relayDirective.raw, "@atlas: answer the ping");

  const noRelayDirective = runner.extractRelayDirective("@ou_human: answer the ping", {});
  assert.equal(noRelayDirective, null);

  const prompt = runner.buildCodexPrompt("hello", {
    chatId: "chat-relay",
    lastSenderOpenId: "ou_peer",
    lastSenderMachineId: "bot-peer",
  });
  assert.match(prompt, /LAST_SENDER_MACHINE_ID: bot-peer/);
  assert.match(prompt, /KNOWN_MACHINE_ROSTER/);
  assert.match(prompt, /bot-peer/);
});

test("self-target relay output renders as normal answer text", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feishuBot-codex-runner-"));
  const messages = [];
  const runner = createCodexRunner({
    data: {
      projectRoot: tempDir,
      codexCommand: "codex",
      codexModel: "gpt-5.3-codex",
      codexExtraArgs: "",
      codexRelayPrompt: "relay prompt",
      codexStatusPath: "",
      turnTimeoutMs: 1000,
    },
    deps: {
      spawn: (_cmd, args) => {
        const child = new events.EventEmitter();
        child.stdout = new events.EventEmitter();
        child.stderr = new events.EventEmitter();
        child.stdin = { end() {} };
        child.pid = 1234;
        const commandLine = Array.isArray(args) ? args.join(" ") : String(args || "");
        const outputMatch = commandLine.match(/--output-last-message\s+("?)([^"\s]+)\1/i);
        const outputPath = outputMatch ? outputMatch[2] : "";
        process.nextTick(() => {
          if (outputPath) {
            fs.writeFileSync(outputPath, "@qub: The population of Libya is around 7.1 million.", "utf8");
          }
          child.emit("close", 0);
        });
        return child;
      },
      fs,
      os,
      path,
      projectRoot: tempDir,
      codexCommand: "codex",
      codexModel: "gpt-5.3-codex",
      codexExtraArgs: "",
      codexRelayPrompt: "relay prompt",
      codexStatusPath: "",
      quoteForCmd: (value) => value,
      splitForFeishu: (text) => [text],
      uploadFileToChat: async () => "",
      resolveRecipientOpenId: async () => ({ openId: "ou_human" }),
      sendDirectMessage: async () => "",
      sendTextMessage: async (chatId, text, meta = {}) => {
        messages.push({ chatId, text, meta });
        return "msg-1";
      },
      setChatSessionId: () => {},
      extractThreadStartedId: () => "",
      lookupCodexSessionIdByThreadName: () => "",
      extractUploadDirective: () => "",
      clusterRuntime: {
        isEnabled: () => true,
        getProfile: () => ({ machineId: "bot-self", alias: "qub", mentionId: "ou_qub" }),
        formatSelfLabel: () => "qub",
        getMachineRoster: () => [
          { machineId: "bot-self", alias: "qub", source: "self" },
        ],
        resolveTarget: (token) => {
          if (token === "qub") {
            return {
              status: "match",
              scope: "self",
              source: "self",
              machineId: "bot-self",
              alias: "qub",
              mentionId: "ou_qub",
            };
          }

          return { status: "miss", targetToken: token };
        },
      },
    },
  });

  await runner.runCodexTurn("chat-relay", {
    chatId: "chat-relay",
    chatName: "relay",
    isTurnInFlight: false,
    isArmed: true,
    hasActiveSession: true,
    waitingForModeChoice: false,
    waitingForResumeChatSelection: false,
    waitingForQueueSelection: false,
    queuedCodexTasks: [],
    pendingUserTexts: [],
    stateStore: {},
  }, "what's the population of libya");

  assert.ok(messages.some((entry) => entry.text === "The population of Libya is around 7.1 million."));
  assert.equal(messages.some((entry) => entry.text.startsWith("@qub:")), false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
