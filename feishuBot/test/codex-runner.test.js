const assert = require("assert");
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
