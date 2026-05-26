const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const test = require("node:test");

const { createClusterRuntime } = require("../src/backend/lib/cluster-runtime.js");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("cluster runtime merges directory machines with live peers", () => {
  const tempDir = makeTempDir("feishuBot-cluster-runtime-");
  const statePath = path.join(tempDir, "cluster-state.json");
  const directoryPath = path.join(tempDir, "machine-directory.json");

  fs.writeFileSync(directoryPath, JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    machines: [
      {
        machineId: "bot-directory",
        alias: "atlas",
        openId: "ou_dir",
        relayChatId: "chat-relay",
        status: "active",
        notes: "directory machine",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  }, null, 2));

  const clusterRuntime = createClusterRuntime({
    data: {
      statePath,
      directoryPath,
      clusterMode: "multi",
      clusterChatId: "chat-relay",
      machineAlias: "self",
      machineId: "bot-self",
      machineMentionId: "ou_self",
      announceOnStart: true,
    },
    deps: {
      fs,
      os,
      path,
      crypto,
      console,
      sendTextMessage: async () => "",
    },
  });

  clusterRuntime.recordHello({
    machineId: "bot-peer",
    alias: "peer",
    mentionId: "ou_peer",
    hostname: "peer-host",
    bootId: "boot-1",
    announceId: "announce-1",
    timestamp: new Date().toISOString(),
  }, {
    chatId: "chat-relay",
    senderOpenId: "ou_peer",
  });

  const directoryResolution = clusterRuntime.resolveTarget("atlas");
  assert.equal(directoryResolution.status, "match");
  assert.equal(directoryResolution.source, "directory");
  assert.equal(directoryResolution.machineId, "bot-directory");

  const senderResolution = clusterRuntime.resolveSenderMachineByOpenId("ou_peer");
  assert.equal(senderResolution.machineId, "bot-peer");

  const roster = clusterRuntime.getMachineRoster();
  assert.ok(roster.some((entry) => entry.machineId === "bot-directory" && entry.source === "directory"));
  assert.ok(roster.some((entry) => entry.machineId === "bot-peer" && (entry.source === "directory" || entry.source === "peer")));
});
