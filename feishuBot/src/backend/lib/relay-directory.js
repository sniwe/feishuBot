const { normalizeTargetToken } = require("./cluster-protocol.js");

function createRelayDirectory(ctx) {
  const { data = {}, deps } = ctx || {};
  const { fs, path, console } = deps;
  const directoryPath = typeof data.directoryPath === "string" ? data.directoryPath.trim() : "";
  const startedAt = new Date().toISOString();

  let directoryState = null;

  function ensureDir(targetPath) {
    if (!targetPath) {
      return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }

  function normalizeMachineRecord(entry, fallback = {}) {
    const cleaned = entry && typeof entry === "object" ? entry : {};
    const machineId = typeof cleaned.machineId === "string" ? cleaned.machineId.trim() : "";
    if (!machineId) {
      return null;
    }

    const createdAt = typeof cleaned.createdAt === "string" && cleaned.createdAt.trim()
      ? cleaned.createdAt.trim()
      : typeof fallback.createdAt === "string" && fallback.createdAt.trim()
        ? fallback.createdAt.trim()
        : startedAt;
    const updatedAt = typeof cleaned.updatedAt === "string" && cleaned.updatedAt.trim()
      ? cleaned.updatedAt.trim()
      : typeof fallback.updatedAt === "string" && fallback.updatedAt.trim()
        ? fallback.updatedAt.trim()
        : createdAt;

    return {
      machineId,
      alias: typeof cleaned.alias === "string" ? cleaned.alias.trim() : typeof fallback.alias === "string" ? fallback.alias.trim() : "",
      mentionId: typeof cleaned.mentionId === "string" ? cleaned.mentionId.trim() : typeof cleaned.openId === "string" ? cleaned.openId.trim() : typeof fallback.mentionId === "string" ? fallback.mentionId.trim() : "",
      openId: typeof cleaned.openId === "string" ? cleaned.openId.trim() : typeof fallback.openId === "string" ? fallback.openId.trim() : "",
      relayChatId: typeof cleaned.relayChatId === "string" ? cleaned.relayChatId.trim() : typeof fallback.relayChatId === "string" ? fallback.relayChatId.trim() : "",
      status: typeof cleaned.status === "string" && cleaned.status.trim() ? cleaned.status.trim() : typeof fallback.status === "string" && fallback.status.trim() ? fallback.status.trim() : "active",
      notes: typeof cleaned.notes === "string" ? cleaned.notes.trim() : typeof fallback.notes === "string" ? fallback.notes.trim() : "",
      createdAt,
      updatedAt,
    };
  }

  function normalizeDirectory(raw) {
    const cleaned = raw && typeof raw === "object" ? raw : {};
    const rawMachines = Array.isArray(cleaned.machines)
      ? cleaned.machines
      : cleaned.machines && typeof cleaned.machines === "object"
        ? Object.values(cleaned.machines)
        : Array.isArray(cleaned.entries)
          ? cleaned.entries
          : [];

    const machines = [];
    for (const entry of rawMachines) {
      const normalized = normalizeMachineRecord(entry);
      if (normalized) {
        machines.push(normalized);
      }
    }

    return {
      version: Number(cleaned.version) || 1,
      updatedAt: typeof cleaned.updatedAt === "string" && cleaned.updatedAt.trim() ? cleaned.updatedAt.trim() : startedAt,
      machines,
    };
  }

  function loadDirectory() {
    if (directoryState) {
      return directoryState;
    }

    if (!directoryPath || !fs.existsSync(directoryPath)) {
      directoryState = normalizeDirectory({ version: 1, updatedAt: startedAt, machines: [] });
      saveDirectory();
      return directoryState;
    }

    try {
      const raw = fs.readFileSync(directoryPath, "utf8");
      directoryState = normalizeDirectory(JSON.parse(raw));
      saveDirectory();
    } catch (err) {
      if (console && typeof console.warn === "function") {
        console.warn("Failed to load relay machine directory, rebuilding:", err.message);
      }
      directoryState = normalizeDirectory({ version: 1, updatedAt: startedAt, machines: [] });
      saveDirectory();
    }

    return directoryState;
  }

  function saveDirectory() {
    if (!directoryPath) {
      return;
    }

    ensureDir(directoryPath);
    if (!directoryState) {
      directoryState = normalizeDirectory({ version: 1, updatedAt: startedAt, machines: [] });
    }
    directoryState.updatedAt = new Date().toISOString();
    fs.writeFileSync(directoryPath, JSON.stringify(directoryState, null, 2), "utf8");
  }

  function getMachines() {
    const current = loadDirectory();
    return Array.isArray(current.machines) ? current.machines.map((machine) => ({ ...machine })) : [];
  }

  function upsertMachine(machine, fallback = {}) {
    const current = loadDirectory();
    const normalized = normalizeMachineRecord(machine, fallback);
    if (!normalized) {
      return null;
    }

    const index = current.machines.findIndex((entry) => entry.machineId === normalized.machineId);
    if (index >= 0) {
      current.machines[index] = {
        ...current.machines[index],
        ...normalized,
        updatedAt: new Date().toISOString(),
      };
    } else {
      current.machines.push(normalized);
    }

    saveDirectory();
    return current.machines.find((entry) => entry.machineId === normalized.machineId) || normalized;
  }

  function compactMachineEntry(entry, source = "directory") {
    if (!entry || typeof entry !== "object") {
      return null;
    }

    const machineId = typeof entry.machineId === "string" ? entry.machineId.trim() : "";
    if (!machineId) {
      return null;
    }

    return {
      source,
      machineId,
      alias: typeof entry.alias === "string" ? entry.alias.trim() : "",
      mentionId: typeof entry.mentionId === "string" ? entry.mentionId.trim() : "",
      openId: typeof entry.openId === "string" ? entry.openId.trim() : "",
      relayChatId: typeof entry.relayChatId === "string" ? entry.relayChatId.trim() : "",
      status: typeof entry.status === "string" ? entry.status.trim() : "",
      notes: typeof entry.notes === "string" ? entry.notes.trim() : "",
    };
  }

  function buildMachineRoster(ctx = {}) {
    const selfProfile = ctx.profile && typeof ctx.profile === "object" ? ctx.profile : {};
    const peers = Array.isArray(ctx.peers) ? ctx.peers : [];
    const machines = [];
    const seen = new Set();

    function pushMachine(entry, source) {
      const compact = compactMachineEntry(entry, source);
      if (!compact || !compact.machineId || seen.has(compact.machineId)) {
        return;
      }

      seen.add(compact.machineId);
      machines.push(compact);
    }

    if (selfProfile.machineId) {
      pushMachine({
        machineId: selfProfile.machineId,
        alias: selfProfile.alias || "",
        mentionId: selfProfile.mentionId || "",
        openId: selfProfile.openId || "",
        relayChatId: selfProfile.clusterChatId || "",
        status: "self",
      }, "self");
    }

    for (const machine of getMachines()) {
      pushMachine(machine, "directory");
    }

    for (const peer of peers) {
      pushMachine(peer, "peer");
    }

    return machines;
  }

  function resolveByField(entries, field, cleanedLower) {
    return entries.filter((entry) => {
      const value = typeof entry?.[field] === "string" ? entry[field].trim().toLowerCase() : "";
      return value && value === cleanedLower;
    });
  }

  function dedupeMatches(entries) {
    const seen = new Set();
    const result = [];
    for (const entry of entries) {
      const machineId = typeof entry?.machineId === "string" ? entry.machineId.trim() : "";
      const openId = typeof entry?.openId === "string" ? entry.openId.trim() : "";
      const key = [machineId, openId].filter(Boolean).join("::") || JSON.stringify(entry || {});
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(entry);
    }

    return result;
  }

  function makeCandidate(entry, source) {
    return {
      source,
      machineId: typeof entry?.machineId === "string" ? entry.machineId.trim() : "",
      alias: typeof entry?.alias === "string" ? entry.alias.trim() : "",
      mentionId: typeof entry?.mentionId === "string" ? entry.mentionId.trim() : "",
      openId: typeof entry?.openId === "string" ? entry.openId.trim() : "",
      relayChatId: typeof entry?.relayChatId === "string" ? entry.relayChatId.trim() : "",
    };
  }

  function resolveTarget(token, ctx = {}) {
    const cleanedToken = normalizeTargetToken(token);
    const profile = ctx.profile && typeof ctx.profile === "object" ? ctx.profile : {};
    const selfMachineId = typeof profile.machineId === "string" ? profile.machineId.trim() : "";
    const selfAlias = typeof profile.alias === "string" ? profile.alias.trim() : "";
    const selfMentionId = typeof profile.mentionId === "string" ? profile.mentionId.trim() : typeof profile.openId === "string" ? profile.openId.trim() : "";
    const directoryEntries = Array.isArray(ctx.directoryEntries) ? ctx.directoryEntries : getMachines();
    const peers = Array.isArray(ctx.peers) ? ctx.peers : [];

    if (!cleanedToken) {
      return {
        status: "invalid",
        reason: "empty-target",
      };
    }

    if (selfMachineId && cleanedToken === selfMachineId) {
      return {
        status: "match",
        scope: "self",
        source: "self",
        machineId: selfMachineId,
        alias: selfAlias,
        mentionId: selfMentionId,
      };
    }

    if (selfMentionId && cleanedToken === selfMentionId) {
      return {
        status: "match",
        scope: "self",
        source: "self",
        machineId: selfMachineId,
        alias: selfAlias,
        mentionId: selfMentionId,
      };
    }

    const cleanedLower = cleanedToken.toLowerCase();
    const directoryAliasMatches = resolveByField(directoryEntries, "alias", cleanedLower);
    const directoryMentionMatches = dedupeMatches(resolveByField(directoryEntries, "mentionId", cleanedLower).concat(resolveByField(directoryEntries, "openId", cleanedLower)));
    const directoryMachineMatches = resolveByField(directoryEntries, "machineId", cleanedLower);

    const peerAliasMatches = resolveByField(peers, "alias", cleanedLower);
    const peerMentionMatches = dedupeMatches(resolveByField(peers, "mentionId", cleanedLower).concat(resolveByField(peers, "openId", cleanedLower)));
    const peerMachineMatches = resolveByField(peers, "machineId", cleanedLower);

    if (selfAlias && cleanedLower === selfAlias.toLowerCase()) {
      return {
        status: "match",
        scope: "self",
        source: "self",
        machineId: selfMachineId,
        alias: selfAlias,
      };
    }

    if (directoryAliasMatches.length === 1) {
      const match = directoryAliasMatches[0];
      return {
        status: "match",
        scope: "directory",
        source: "directory",
        machineId: match.machineId,
        alias: match.alias,
        mentionId: match.mentionId,
        openId: match.openId,
        relayChatId: match.relayChatId,
        entry: match,
      };
    }

    if (directoryAliasMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "alias-collision",
        targetToken: cleanedToken,
        candidates: directoryAliasMatches.map((entry) => makeCandidate(entry, "directory")),
      };
    }

    if (directoryMentionMatches.length === 1) {
      const match = directoryMentionMatches[0];
      return {
        status: "match",
        scope: "directory",
        source: "directory",
        machineId: match.machineId,
        alias: match.alias,
        mentionId: match.mentionId || match.openId,
        openId: match.openId,
        relayChatId: match.relayChatId,
        entry: match,
      };
    }

    if (directoryMentionMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "mention-collision",
        targetToken: cleanedToken,
        candidates: directoryMentionMatches.map((entry) => makeCandidate(entry, "directory")),
      };
    }

    if (directoryMachineMatches.length === 1) {
      const match = directoryMachineMatches[0];
      return {
        status: "match",
        scope: "directory",
        source: "directory",
        machineId: match.machineId,
        alias: match.alias,
        mentionId: match.mentionId || match.openId,
        openId: match.openId,
        relayChatId: match.relayChatId,
        entry: match,
      };
    }

    if (directoryMachineMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "machine-id-collision",
        targetToken: cleanedToken,
        candidates: directoryMachineMatches.map((entry) => makeCandidate(entry, "directory")),
      };
    }

    if (peerAliasMatches.length === 1) {
      const match = peerAliasMatches[0];
      return {
        status: "match",
        scope: "peer",
        source: "peer",
        machineId: match.machineId,
        alias: match.alias,
        mentionId: match.mentionId || match.openId,
        openId: match.openId,
        relayChatId: match.relayChatId,
        peer: match,
      };
    }

    if (peerAliasMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "alias-collision",
        targetToken: cleanedToken,
        candidates: peerAliasMatches.map((entry) => makeCandidate(entry, "peer")),
      };
    }

    if (peerMentionMatches.length === 1) {
      const match = peerMentionMatches[0];
      return {
        status: "match",
        scope: "peer",
        source: "peer",
        machineId: match.machineId,
        alias: match.alias,
        mentionId: match.mentionId || match.openId,
        openId: match.openId,
        relayChatId: match.relayChatId,
        peer: match,
      };
    }

    if (peerMentionMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "mention-collision",
        targetToken: cleanedToken,
        candidates: peerMentionMatches.map((entry) => makeCandidate(entry, "peer")),
      };
    }

    if (peerMachineMatches.length === 1) {
      const match = peerMachineMatches[0];
      return {
        status: "match",
        scope: "peer",
        source: "peer",
        machineId: match.machineId,
        alias: match.alias,
        mentionId: match.mentionId || match.openId,
        openId: match.openId,
        relayChatId: match.relayChatId,
        peer: match,
      };
    }

    if (peerMachineMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "machine-id-collision",
        targetToken: cleanedToken,
        candidates: peerMachineMatches.map((entry) => makeCandidate(entry, "peer")),
      };
    }

    return {
      status: "miss",
      targetToken: cleanedToken,
    };
  }

  function resolveOpenId(openId, ctx = {}) {
    const cleanedOpenId = typeof openId === "string" ? openId.trim() : "";
    if (!cleanedOpenId) {
      return {
        status: "invalid",
        reason: "empty-open-id",
      };
    }

    const profile = ctx.profile && typeof ctx.profile === "object" ? ctx.profile : {};
    const selfMachineId = typeof profile.machineId === "string" ? profile.machineId.trim() : "";
    const selfAlias = typeof profile.alias === "string" ? profile.alias.trim() : "";
    const selfMentionId = typeof profile.mentionId === "string" ? profile.mentionId.trim() : typeof profile.openId === "string" ? profile.openId.trim() : "";
    const directoryEntries = Array.isArray(ctx.directoryEntries) ? ctx.directoryEntries : getMachines();
    const peers = Array.isArray(ctx.peers) ? ctx.peers : [];

    if (selfMentionId && cleanedOpenId === selfMentionId) {
      return {
        status: "match",
        scope: "self",
        source: "self",
        machineId: selfMachineId,
        alias: selfAlias,
        mentionId: selfMentionId,
        openId: selfMentionId,
      };
    }

    const directoryOpenMatches = resolveByField(directoryEntries, "openId", cleanedOpenId);
    if (directoryOpenMatches.length === 1) {
      const match = directoryOpenMatches[0];
      return {
        status: "match",
        scope: "directory",
        source: "directory",
        machineId: match.machineId,
        alias: match.alias,
        mentionId: match.mentionId || match.openId,
        openId: match.openId,
        relayChatId: match.relayChatId,
        entry: match,
      };
    }

    if (directoryOpenMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "open-id-collision",
        targetToken: cleanedOpenId,
        candidates: directoryOpenMatches.map((entry) => makeCandidate(entry, "directory")),
      };
    }

    const peerOpenMatches = resolveByField(peers, "openId", cleanedOpenId);
    if (peerOpenMatches.length === 1) {
      const match = peerOpenMatches[0];
      return {
        status: "match",
        scope: "peer",
        source: "peer",
        machineId: match.machineId,
        alias: match.alias,
        mentionId: match.mentionId || match.openId,
        openId: match.openId,
        relayChatId: match.relayChatId,
        peer: match,
      };
    }

    if (peerOpenMatches.length > 1) {
      return {
        status: "ambiguous",
        reason: "open-id-collision",
        targetToken: cleanedOpenId,
        candidates: peerOpenMatches.map((entry) => makeCandidate(entry, "peer")),
      };
    }

    const result = resolveTarget(cleanedOpenId, ctx);
    return result.status === "match"
      ? result
      : {
          status: result.status,
          reason: result.reason || "unresolved",
          openId: cleanedOpenId,
        };
  }

  return {
    loadDirectory,
    saveDirectory,
    getMachines,
    upsertMachine,
    buildMachineRoster,
    resolveTarget,
    resolveOpenId,
  };
}

module.exports = { createRelayDirectory };
