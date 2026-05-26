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
