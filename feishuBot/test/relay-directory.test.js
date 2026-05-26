const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");

const { createRelayDirectory } = require("../src/backend/lib/relay-directory.js");

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("relay directory resolves directory machines before peer collisions", () => {
  const tempDir = makeTempDir("feishuBot-relay-directory-");
  const directoryPath = path.join(tempDir, "machine-directory.json");
  const relayDirectory = createRelayDirectory({
    data: { directoryPath },
    deps: { fs, path, console },
  });

  relayDirectory.upsertMachine({
    machineId: "bot-directory",
    alias: "atlas",
    openId: "ou_dir",
    relayChatId: "chat-1",
    status: "active",
  });

  const resolution = relayDirectory.resolveTarget("atlas", {
    profile: { machineId: "bot-self", alias: "self" },
    directoryEntries: relayDirectory.getMachines(),
    peers: [
      { machineId: "bot-peer", alias: "atlas", openId: "ou_peer" },
    ],
  });

  assert.equal(resolution.status, "match");
  assert.equal(resolution.source, "directory");
  assert.equal(resolution.machineId, "bot-directory");
});

test("relay directory resolves peer machines with relay chat metadata", () => {
  const tempDir = makeTempDir("feishuBot-relay-directory-");
  const directoryPath = path.join(tempDir, "machine-directory.json");
  const relayDirectory = createRelayDirectory({
    data: { directoryPath },
    deps: { fs, path, console },
  });

  relayDirectory.upsertMachine({
    machineId: "bot-peer",
    alias: "atlas",
    mentionId: "ou_peer",
    openId: "ou_peer",
    relayChatId: "chat-peer",
    status: "active",
  });

  const resolution = relayDirectory.resolveTarget("atlas", {
    profile: { machineId: "bot-self", alias: "self", mentionId: "ou_self", clusterChatId: "chat-self" },
    directoryEntries: [],
    peers: [
      { machineId: "bot-peer", alias: "atlas", mentionId: "ou_peer", openId: "ou_peer", relayChatId: "chat-peer" },
    ],
  });

  assert.equal(resolution.status, "match");
  assert.equal(resolution.scope, "peer");
  assert.equal(resolution.machineId, "bot-peer");
  assert.equal(resolution.alias, "atlas");
  assert.equal(resolution.mentionId, "ou_peer");
  assert.equal(resolution.openId, "ou_peer");
  assert.equal(resolution.relayChatId, "chat-peer");
});

test("relay directory resolves sender open ids back to machine ids", () => {
  const tempDir = makeTempDir("feishuBot-relay-directory-");
  const directoryPath = path.join(tempDir, "machine-directory.json");
  const relayDirectory = createRelayDirectory({
    data: { directoryPath },
    deps: { fs, path, console },
  });

  relayDirectory.upsertMachine({
    machineId: "bot-directory",
    alias: "atlas",
    openId: "ou_dir",
    relayChatId: "chat-1",
    status: "active",
  });

  const resolution = relayDirectory.resolveOpenId("ou_dir", {
    profile: { machineId: "bot-self", alias: "self" },
    directoryEntries: relayDirectory.getMachines(),
    peers: [],
  });

  assert.equal(resolution.status, "match");
  assert.equal(resolution.machineId, "bot-directory");
  assert.equal(resolution.openId, "ou_dir");
});

test("relay directory resolves user ids as stable mention ids", () => {
  const tempDir = makeTempDir("feishuBot-relay-directory-");
  const directoryPath = path.join(tempDir, "machine-directory.json");
  const relayDirectory = createRelayDirectory({
    data: { directoryPath },
    deps: { fs, path, console },
  });

  relayDirectory.upsertMachine({
    machineId: "bot-directory",
    alias: "atlas",
    userId: "u_dir",
    relayChatId: "chat-1",
    status: "active",
  });

  const resolution = relayDirectory.resolveTarget("u_dir", {
    profile: { machineId: "bot-self", alias: "self" },
    directoryEntries: relayDirectory.getMachines(),
    peers: [],
  });

  assert.equal(resolution.status, "match");
  assert.equal(resolution.machineId, "bot-directory");
  assert.equal(resolution.userId, "u_dir");
});
