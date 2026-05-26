const PROTOCOL_PREFIX = "!cluster";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMachineToken(value) {
  return normalizeText(value);
}

function shortMachineId(machineId, length = 8) {
  const cleaned = normalizeMachineToken(machineId);
  if (!cleaned) {
    return "";
  }

  return cleaned.slice(0, Math.max(4, length));
}

function formatMachineLabel(machine, ctx = {}) {
  const cleanedMachine = machine && typeof machine === "object" ? machine : {};
  const selfMachineId = normalizeMachineToken(ctx.selfMachineId || "");
  const alias = normalizeMachineToken(cleanedMachine.alias);
  const machineId = normalizeMachineToken(cleanedMachine.machineId);
  const isSelf = selfMachineId && machineId === selfMachineId;
  const peers = Array.isArray(ctx.peers) ? ctx.peers : [];
  const aliasKey = alias.toLowerCase();
  const aliasCount = alias
    ? peers.filter((peer) => normalizeMachineToken(peer?.alias).toLowerCase() === aliasKey).length
    : 0;
  const suffix = alias && (aliasCount > 1 || isSelf) && machineId ? ` (${shortMachineId(machineId)})` : "";

  if (alias) {
    return `${alias}${suffix}`;
  }

  if (machineId) {
    return shortMachineId(machineId);
  }

  return "unknown";
}

function buildProtocolMessage(type, payload = {}) {
  const cleanedType = normalizeText(type).toLowerCase();
  const body = payload && typeof payload === "object" ? JSON.stringify(payload) : String(payload || "");
  return body ? `${PROTOCOL_PREFIX} ${cleanedType} ${body}` : `${PROTOCOL_PREFIX} ${cleanedType}`;
}

function parseProtocolMessage(text) {
  const raw = normalizeText(text);
  if (!raw.toLowerCase().startsWith(`${PROTOCOL_PREFIX} `) && raw.toLowerCase() !== PROTOCOL_PREFIX) {
    return null;
  }

  const remainder = raw.slice(PROTOCOL_PREFIX.length).trim();
  if (!remainder) {
    return null;
  }

  const spaceIndex = remainder.indexOf(" ");
  const type = normalizeText(spaceIndex >= 0 ? remainder.slice(0, spaceIndex) : remainder).toLowerCase();
  const payloadText = spaceIndex >= 0 ? remainder.slice(spaceIndex + 1).trim() : "";
  let payload = payloadText;

  if (!payloadText) {
    payload = {};
  } else {
    try {
      payload = JSON.parse(payloadText);
    } catch {
      payload = payloadText;
    }
  }

  return {
    prefix: PROTOCOL_PREFIX,
    type,
    payload,
    raw,
  };
}

function parseExplicitTarget(text) {
  const raw = normalizeText(text);
  if (!raw) {
    return null;
  }

  const patterns = [
    { kind: "at-colon", regex: /^@(.+?)\s*:\s*([\s\S]+)$/ },
    { kind: "at-bare", regex: /^@(\S+)$/ },
    { kind: "at-space", regex: /^@(\S+)\s+([\s\S]+)$/ },
    { kind: "bang-to", regex: /^!to\s+(.+?)\s+([\s\S]+)$/i },
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern.regex);
    if (!match || !match[1]) {
      continue;
    }

    return {
      kind: "explicit-target",
      syntax: pattern.kind,
      targetToken: normalizeTargetToken(match[1]),
      message: typeof match[2] === "string" ? match[2].trim() : "",
      raw,
    };
  }

  return null;
}

function normalizeTargetToken(token) {
  return normalizeText(token)
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^@+/, "")
    .replace(/^machine\s+/i, "")
    .replace(/^to\s+/i, "")
    .trim();
}

function resolveTargetToken(token, ctx = {}) {
  const cleanedToken = normalizeTargetToken(token);
  const profile = ctx.profile && typeof ctx.profile === "object" ? ctx.profile : {};
  const selfMachineId = normalizeMachineToken(profile.machineId || "");
  const selfAlias = normalizeMachineToken(profile.alias || "");
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
      machineId: selfMachineId,
      alias: selfAlias,
    };
  }

  const cleanedLower = cleanedToken.toLowerCase();
  const aliasPeers = peers.filter((peer) => normalizeMachineToken(peer?.alias).toLowerCase() === cleanedLower);
  if (selfAlias && cleanedLower === selfAlias.toLowerCase()) {
    const duplicateAliasPeers = peers.filter((peer) => normalizeMachineToken(peer?.alias).toLowerCase() === selfAlias.toLowerCase());
    if (duplicateAliasPeers.length > 1) {
      return {
        status: "ambiguous",
        reason: "alias-collision",
        targetToken: cleanedToken,
        candidates: duplicateAliasPeers.map((peer) => ({
          machineId: normalizeMachineToken(peer?.machineId),
          alias: normalizeMachineToken(peer?.alias),
        })),
      };
    }

    return {
      status: "match",
      scope: "self",
      machineId: selfMachineId,
      alias: selfAlias,
    };
  }

  if (aliasPeers.length === 1) {
    return {
      status: "match",
      scope: "peer",
      machineId: normalizeMachineToken(aliasPeers[0].machineId),
      alias: normalizeMachineToken(aliasPeers[0].alias),
      peer: aliasPeers[0],
    };
  }

  if (aliasPeers.length > 1) {
    return {
      status: "ambiguous",
      reason: "alias-collision",
      targetToken: cleanedToken,
      candidates: aliasPeers.map((peer) => ({
        machineId: normalizeMachineToken(peer?.machineId),
        alias: normalizeMachineToken(peer?.alias),
      })),
    };
  }

  const exactPeer = peers.find((peer) => normalizeMachineToken(peer?.machineId) === cleanedToken);
  if (exactPeer) {
    return {
      status: "match",
      scope: "peer",
      machineId: normalizeMachineToken(exactPeer.machineId),
      alias: normalizeMachineToken(exactPeer.alias),
      peer: exactPeer,
    };
  }

  return {
    status: "miss",
    targetToken: cleanedToken,
  };
}

function buildHelloPayload(profile) {
  const cleaned = profile && typeof profile === "object" ? profile : {};
  return {
    machineId: normalizeMachineToken(cleaned.machineId),
    alias: normalizeMachineToken(cleaned.alias),
    hostname: normalizeMachineToken(cleaned.hostname),
    bootId: normalizeMachineToken(cleaned.bootId),
    announceId: normalizeMachineToken(cleaned.announceId),
    clusterChatId: normalizeMachineToken(cleaned.clusterChatId),
    timestamp: normalizeMachineToken(cleaned.timestamp) || new Date().toISOString(),
  };
}

function buildIdentityPayload(profile, context = {}) {
  const cleaned = profile && typeof profile === "object" ? profile : {};
  return {
    machineId: normalizeMachineToken(cleaned.machineId),
    alias: normalizeMachineToken(cleaned.alias),
    hostname: normalizeMachineToken(cleaned.hostname),
    bootId: normalizeMachineToken(cleaned.bootId),
    replyToAnnounceId: normalizeMachineToken(context.replyToAnnounceId),
    timestamp: normalizeMachineToken(context.timestamp) || new Date().toISOString(),
  };
}

function buildGoodbyePayload(profile, context = {}) {
  const cleaned = profile && typeof profile === "object" ? profile : {};
  return {
    machineId: normalizeMachineToken(cleaned.machineId),
    alias: normalizeMachineToken(cleaned.alias),
    hostname: normalizeMachineToken(cleaned.hostname),
    bootId: normalizeMachineToken(cleaned.bootId),
    reason: normalizeMachineToken(context.reason),
    timestamp: normalizeMachineToken(context.timestamp) || new Date().toISOString(),
  };
}

function buildTargetPayload(profile, target, message, context = {}) {
  const cleaned = profile && typeof profile === "object" ? profile : {};
  return {
    machineId: normalizeMachineToken(cleaned.machineId),
    alias: normalizeMachineToken(cleaned.alias),
    hostname: normalizeMachineToken(cleaned.hostname),
    bootId: normalizeMachineToken(cleaned.bootId),
    to: normalizeTargetToken(target),
    message: normalizeText(message),
    replyToAnnounceId: normalizeMachineToken(context.replyToAnnounceId),
    timestamp: normalizeMachineToken(context.timestamp) || new Date().toISOString(),
  };
}

module.exports = {
  PROTOCOL_PREFIX,
  buildProtocolMessage,
  buildHelloPayload,
  buildIdentityPayload,
  buildGoodbyePayload,
  buildTargetPayload,
  formatMachineLabel,
  normalizeMachineToken,
  normalizeTargetToken,
  parseExplicitTarget,
  parseProtocolMessage,
  resolveTargetToken,
  shortMachineId,
};
