const crypto = require("crypto");
const os = require("os");
const path = require("path");

function createClusterStateManager(ctx) {
  const { data = {}, deps } = ctx || {};
  const { fs, console } = deps;

  const statePath = data.statePath;
  const clusterMode = (data.clusterMode || "multi").trim().toLowerCase();
  const announceOnStart = data.announceOnStart !== false;
  const clusterChatId = typeof data.clusterChatId === "string" ? data.clusterChatId.trim() : "";
  const envMachineId = typeof data.machineId === "string" ? data.machineId.trim() : "";
  const envAlias = typeof data.machineAlias === "string" ? data.machineAlias.trim() : "";
  const envMentionId = typeof data.machineMentionId === "string" ? data.machineMentionId.trim() : "";
  const hostname = typeof data.hostname === "string" ? data.hostname.trim() : os.hostname();
  const startedAt = new Date().toISOString();
  const bootId = crypto.randomUUID();

  let state = null;

  function ensureDir(targetPath) {
    if (!targetPath) {
      return;
    }

    const dirPath = path.dirname(targetPath);
    fs.mkdirSync(dirPath, { recursive: true });
  }

  function createDefaultState(existing = {}) {
    const machineId = envMachineId || existing.machineId || crypto.randomUUID();
    const alias = envAlias || existing.alias || hostname || machineId.slice(0, 8);
    return {
      version: 1,
      machineId,
      alias,
      mentionId: envMentionId || existing.mentionId || "",
      hostname,
      bootId,
      clusterMode,
      clusterChatId,
      announceOnStart,
      createdAt: existing.createdAt || startedAt,
      updatedAt: startedAt,
      knownPeers: existing.knownPeers && typeof existing.knownPeers === "object" ? existing.knownPeers : {},
      seenAnnounceIds: existing.seenAnnounceIds && typeof existing.seenAnnounceIds === "object" ? existing.seenAnnounceIds : {},
      seenEventIds: existing.seenEventIds && typeof existing.seenEventIds === "object" ? existing.seenEventIds : {},
      lastSeenAt: existing.lastSeenAt || "",
    };
  }

  function normalizeState(raw) {
    const existing = raw && typeof raw === "object" ? raw : {};
    return {
      version: Number(existing.version) || 1,
      machineId: envMachineId || (typeof existing.machineId === "string" ? existing.machineId.trim() : "") || crypto.randomUUID(),
      alias: envAlias || (typeof existing.alias === "string" ? existing.alias.trim() : "") || hostname || "",
      mentionId: envMentionId || (typeof existing.mentionId === "string" ? existing.mentionId.trim() : ""),
      hostname: typeof existing.hostname === "string" && existing.hostname.trim() ? existing.hostname.trim() : hostname,
      bootId,
      clusterMode: clusterMode || (typeof existing.clusterMode === "string" ? existing.clusterMode.trim().toLowerCase() : "multi"),
      clusterChatId,
      announceOnStart,
      createdAt: typeof existing.createdAt === "string" && existing.createdAt.trim() ? existing.createdAt.trim() : startedAt,
      updatedAt: startedAt,
      knownPeers: existing.knownPeers && typeof existing.knownPeers === "object" ? existing.knownPeers : {},
      seenAnnounceIds: existing.seenAnnounceIds && typeof existing.seenAnnounceIds === "object" ? existing.seenAnnounceIds : {},
      seenEventIds: existing.seenEventIds && typeof existing.seenEventIds === "object" ? existing.seenEventIds : {},
      lastSeenAt: typeof existing.lastSeenAt === "string" ? existing.lastSeenAt.trim() : "",
    };
  }

  function saveState() {
    if (!statePath) {
      return;
    }

    ensureDir(statePath);
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  }

  function loadState() {
    if (state) {
      return state;
    }

    if (!statePath || !fs.existsSync(statePath)) {
      state = createDefaultState();
      saveState();
      return state;
    }

    try {
      const raw = fs.readFileSync(statePath, "utf8");
      state = normalizeState(JSON.parse(raw));
      saveState();
    } catch (err) {
      if (console && typeof console.warn === "function") {
        console.warn("Failed to load cluster state, rebuilding:", err.message);
      }
      state = createDefaultState();
      saveState();
    }

    return state;
  }

  function getState() {
    return loadState();
  }

  function getSelfProfile() {
    const current = getState();
    return {
      machineId: current.machineId,
      alias: current.alias,
      mentionId: current.mentionId || "",
      hostname: current.hostname,
      bootId: current.bootId,
      clusterMode: current.clusterMode,
      clusterChatId: current.clusterChatId,
      announceOnStart: current.announceOnStart,
    };
  }

  function isEnabled() {
    return getState().clusterMode === "multi";
  }

  function shouldProcessChat(chatId) {
    const current = getState();
    if (!isEnabled()) {
      return true;
    }

    if (!current.clusterChatId) {
      return true;
    }

    return (chatId || "").trim() === current.clusterChatId;
  }

  function markEventSeen(eventId) {
    const cleanedEventId = typeof eventId === "string" ? eventId.trim() : "";
    if (!cleanedEventId) {
      return false;
    }

    const current = getState();
    if (current.seenEventIds[cleanedEventId]) {
      return true;
    }

    current.seenEventIds[cleanedEventId] = new Date().toISOString();
    saveState();
    return false;
  }

  function markAnnounceSeen(announceId) {
    const cleanedAnnounceId = typeof announceId === "string" ? announceId.trim() : "";
    if (!cleanedAnnounceId) {
      return false;
    }

    const current = getState();
    if (current.seenAnnounceIds[cleanedAnnounceId]) {
      return true;
    }

    current.seenAnnounceIds[cleanedAnnounceId] = new Date().toISOString();
    saveState();
    return false;
  }

  function upsertPeer(peer, patch = {}) {
    const current = getState();
    const machineId = typeof peer?.machineId === "string" ? peer.machineId.trim() : "";
    if (!machineId) {
      return null;
    }

    const now = new Date().toISOString();
    const existing = current.knownPeers[machineId] && typeof current.knownPeers[machineId] === "object"
      ? current.knownPeers[machineId]
      : {};
    const nextPeer = {
      machineId,
      alias: typeof peer.alias === "string" ? peer.alias.trim() : existing.alias || "",
      hostname: typeof peer.hostname === "string" ? peer.hostname.trim() : existing.hostname || "",
      bootId: typeof peer.bootId === "string" ? peer.bootId.trim() : existing.bootId || "",
      lastSeenAt: now,
      firstSeenAt: existing.firstSeenAt || now,
      helloCount: Number(existing.helloCount || 0),
      identityCount: Number(existing.identityCount || 0),
      goodbyeCount: Number(existing.goodbyeCount || 0),
      status: existing.status || "active",
      lastAnnounceId: typeof peer.announceId === "string" ? peer.announceId.trim() : existing.lastAnnounceId || "",
      lastReplyToAnnounceId: typeof patch.replyToAnnounceId === "string" ? patch.replyToAnnounceId.trim() : existing.lastReplyToAnnounceId || "",
      lastMessageType: typeof patch.messageType === "string" ? patch.messageType.trim() : existing.lastMessageType || "",
      sourceChatId: typeof patch.chatId === "string" ? patch.chatId.trim() : existing.sourceChatId || "",
      mentionId: typeof peer.mentionId === "string" ? peer.mentionId.trim() : existing.mentionId || "",
    };

    if (patch.messageType === "hello") {
      nextPeer.helloCount += 1;
      nextPeer.status = "online";
    }

    if (patch.messageType === "identity") {
      nextPeer.identityCount += 1;
      nextPeer.status = "online";
    }

    if (patch.messageType === "goodbye") {
      nextPeer.goodbyeCount += 1;
      nextPeer.status = "offline";
      nextPeer.goodbyeAt = now;
    }

    current.knownPeers[machineId] = nextPeer;
    current.lastSeenAt = now;
    saveState();
    return nextPeer;
  }

  function listPeers() {
    const current = getState();
    return Object.values(current.knownPeers || {}).filter(Boolean);
  }

  function getPeer(machineId) {
    const cleanedMachineId = typeof machineId === "string" ? machineId.trim() : "";
    if (!cleanedMachineId) {
      return null;
    }

    const current = getState();
    return current.knownPeers[cleanedMachineId] || null;
  }

  function hasSeenAnnounceId(announceId) {
    const cleanedAnnounceId = typeof announceId === "string" ? announceId.trim() : "";
    if (!cleanedAnnounceId) {
      return false;
    }

    const current = getState();
    return Boolean(current.seenAnnounceIds[cleanedAnnounceId]);
  }

  function getMachineLabel(machineId) {
    const current = getState();
    const peer = current.machineId === machineId ? getSelfProfile() : getPeer(machineId);
    if (!peer) {
      return "";
    }

    const peers = listPeers();
    const labelPeers = [{ machineId: current.machineId, alias: current.alias }, ...peers];
    const { formatMachineLabel } = require("./cluster-protocol.js");
    return formatMachineLabel(peer, {
      selfMachineId: current.machineId,
      peers: labelPeers,
    });
  }

  function logClusterEvent(kind, details = {}) {
    if (!console || typeof console.log !== "function") {
      return;
    }

    const current = getState();
    const payload = {
      kind,
      machineId: current.machineId,
      alias: current.alias,
      bootId: current.bootId,
      ...details,
    };
    console.log(`[cluster] ${JSON.stringify(payload)}`);
  }

  function recordHello(payload = {}, meta = {}) {
    const current = getState();
    const machineId = typeof payload.machineId === "string" ? payload.machineId.trim() : "";
    if (!machineId || machineId === current.machineId) {
      return {
        duplicate: false,
        self: true,
        peer: null,
      };
    }

    const announceId = typeof payload.announceId === "string" ? payload.announceId.trim() : "";
    if (announceId && hasSeenAnnounceId(announceId)) {
      return {
        duplicate: true,
        self: false,
        peer: getPeer(machineId),
      };
    }

    if (announceId) {
      current.seenAnnounceIds[announceId] = new Date().toISOString();
    }

    const peer = upsertPeer(payload, {
      messageType: "hello",
      chatId: meta.chatId || "",
      replyToAnnounceId: announceId,
    });

    return {
      duplicate: false,
      self: false,
      peer,
      shouldReplyIdentity: Boolean(peer),
    };
  }

  function recordIdentity(payload = {}, meta = {}) {
    const current = getState();
    const machineId = typeof payload.machineId === "string" ? payload.machineId.trim() : "";
    if (!machineId || machineId === current.machineId) {
      return {
        self: true,
        peer: null,
      };
    }

    const peer = upsertPeer(payload, {
      messageType: "identity",
      chatId: meta.chatId || "",
      replyToAnnounceId: payload.replyToAnnounceId || "",
    });

    return {
      self: false,
      peer,
    };
  }

  function recordGoodbye(payload = {}, meta = {}) {
    const current = getState();
    const machineId = typeof payload.machineId === "string" ? payload.machineId.trim() : "";
    if (!machineId || machineId === current.machineId) {
      return {
        self: true,
        peer: null,
      };
    }

    const peer = upsertPeer(payload, {
      messageType: "goodbye",
      chatId: meta.chatId || "",
    });

    return {
      self: false,
      peer,
    };
  }

  return {
    loadState,
    getState,
    getSelfProfile,
    isEnabled,
    shouldProcessChat,
    markEventSeen,
    markAnnounceSeen,
    hasSeenAnnounceId,
    upsertPeer,
    listPeers,
    getPeer,
    getMachineLabel,
    logClusterEvent,
    recordHello,
    recordIdentity,
    recordGoodbye,
    saveState,
  };
}

module.exports = { createClusterStateManager };
