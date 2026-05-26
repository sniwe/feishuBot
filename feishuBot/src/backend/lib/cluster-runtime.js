const {
  buildGoodbyePayload,
  buildHelloPayload,
  buildIdentityPayload,
  buildProtocolMessage,
  buildTargetPayload,
  formatMachineLabel,
  parseExplicitTarget,
  parseProtocolMessage,
  shortMachineId,
} = require("./cluster-protocol.js");
const { createClusterStateManager } = require("./cluster-state.js");

function createClusterRuntime(ctx) {
  const { data = {}, deps } = ctx || {};
  const { sendTextMessage } = deps;
  const stateManager = createClusterStateManager(ctx);

  function getProfile() {
    return stateManager.getSelfProfile();
  }

  function isEnabled() {
    return stateManager.isEnabled();
  }

  function shouldProcessChat(chatId) {
    return stateManager.shouldProcessChat(chatId);
  }

  function getPeers() {
    return stateManager.listPeers();
  }

  function getMachineRoster() {
    return typeof stateManager.getMachineRoster === "function" ? stateManager.getMachineRoster() : [getProfile(), ...getPeers()];
  }

  function formatSelfLabel() {
    return formatMachineLabel(getProfile(), {
      selfMachineId: getProfile().machineId,
      peers: getMachineRoster(),
    });
  }

  function getMachineLabel(machineId) {
    return stateManager.getMachineLabel(machineId);
  }

  function resolveSenderMachineByOpenId(senderOpenId) {
    return typeof stateManager.resolveSenderMachineByOpenId === "function"
      ? stateManager.resolveSenderMachineByOpenId(senderOpenId)
      : null;
  }

  function rememberSenderMachine(senderOpenId, machine) {
    return typeof stateManager.rememberSenderMachine === "function"
      ? stateManager.rememberSenderMachine(senderOpenId, machine)
      : null;
  }

  function buildHelloMessage() {
    const profile = getProfile();
    const payload = buildHelloPayload({
      ...profile,
      announceId: data.announceId || profile.bootId,
      timestamp: new Date().toISOString(),
    });
    return buildProtocolMessage("hello", payload);
  }

  function buildIdentityMessage(replyToAnnounceId = "") {
    const profile = getProfile();
    const payload = buildIdentityPayload(profile, {
      replyToAnnounceId,
      timestamp: new Date().toISOString(),
    });
    return buildProtocolMessage("identity", payload);
  }

  function buildGoodbyeMessage(reason = "") {
    const profile = getProfile();
    const payload = buildGoodbyePayload(profile, {
      reason,
      timestamp: new Date().toISOString(),
    });
    return buildProtocolMessage("goodbye", payload);
  }

  function buildTargetMessage(target, message, context = {}) {
    const profile = getProfile();
    const payload = buildTargetPayload(profile, target, message, context);
    return buildProtocolMessage("target", payload);
  }

  function resolveTarget(targetToken) {
    return typeof stateManager.resolveTarget === "function"
      ? stateManager.resolveTarget(targetToken)
      : {
          status: "miss",
          targetToken,
        };
  }

  function parseProtocol(text) {
    return parseProtocolMessage(text);
  }

  function parseTarget(text) {
    return parseExplicitTarget(text);
  }

  function recordHello(payload, meta) {
    return stateManager.recordHello(payload, meta);
  }

  function recordIdentity(payload, meta) {
    return stateManager.recordIdentity(payload, meta);
  }

  function recordGoodbye(payload, meta) {
    return stateManager.recordGoodbye(payload, meta);
  }

  function markEventSeen(eventId) {
    return stateManager.markEventSeen(eventId);
  }

  function markAnnounceSeen(announceId) {
    return stateManager.markAnnounceSeen(announceId);
  }

  function hasSeenAnnounceId(announceId) {
    return stateManager.hasSeenAnnounceId(announceId);
  }

  function logEvent(kind, details = {}) {
    stateManager.logClusterEvent(kind, details);
  }

  async function announceHello(chatId) {
    if (!isEnabled() || !getProfile().announceOnStart || !chatId || typeof sendTextMessage !== "function") {
      return "";
    }

    const message = buildHelloMessage();
    const messageId = await sendTextMessage(chatId, message, {
      cluster_protocol: "hello",
      cluster_machine_id: getProfile().machineId,
      cluster_alias: getProfile().alias,
      cluster_boot_id: getProfile().bootId,
    });
    markAnnounceSeen(data.announceId || getProfile().bootId);
    logEvent("announce", {
      chatId,
      messageId,
      message,
    });
    return messageId || "";
  }

  async function announceGoodbye(chatId, reason = "") {
    if (!isEnabled() || !chatId || typeof sendTextMessage !== "function") {
      return "";
    }

    const message = buildGoodbyeMessage(reason);
    const messageId = await sendTextMessage(chatId, message, {
      cluster_protocol: "goodbye",
      cluster_machine_id: getProfile().machineId,
      cluster_alias: getProfile().alias,
      cluster_boot_id: getProfile().bootId,
    });
    logEvent("shutdown-goodbye", {
      chatId,
      messageId,
      reason,
    });
    return messageId || "";
  }

  function describeTargetResolution(targetToken) {
    const result = resolveTarget(targetToken);
    if (result.status === "match") {
      return {
        ...result,
        label: getMachineLabel(result.machineId),
      };
    }

    if (result.status === "ambiguous") {
      return {
        ...result,
        candidates: Array.isArray(result.candidates)
          ? result.candidates.map((candidate) => ({
              ...candidate,
              label: getMachineLabel(candidate.machineId),
            }))
          : [],
      };
    }

    return result;
  }

  return {
    getProfile,
    getPeers,
    getMachineLabel,
    formatSelfLabel,
    shortMachineId,
    isEnabled,
    shouldProcessChat,
    parseProtocol,
    parseTarget,
    resolveTarget: describeTargetResolution,
    recordHello,
    recordIdentity,
    recordGoodbye,
    markEventSeen,
    markAnnounceSeen,
    hasSeenAnnounceId,
    getMachineRoster,
    resolveSenderMachineByOpenId,
    rememberSenderMachine,
    logEvent,
    buildHelloMessage,
    buildIdentityMessage,
    buildGoodbyeMessage,
    buildTargetMessage,
    announceHello,
    announceGoodbye,
  };
}

module.exports = { createClusterRuntime };
