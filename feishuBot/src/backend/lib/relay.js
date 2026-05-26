function createRelayController(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    Lark,
    fs,
    path,
    stateStore,
    fileTransfer,
    contactResolver,
    codexRunner,
    sendTextMessage,
    sendDirectMessage,
    clusterRuntime,
  } = deps;
  const isClusterMode = Boolean(clusterRuntime && typeof clusterRuntime.isEnabled === "function" && clusterRuntime.isEnabled());
  const localProfile = typeof clusterRuntime?.getProfile === "function" ? clusterRuntime.getProfile() : {};
  const localIdentity = (localProfile.alias || (typeof clusterRuntime?.formatSelfLabel === "function" ? clusterRuntime.formatSelfLabel() : "") || localProfile.machineId || "unknown").trim();

  function logCluster(kind, details = {}) {
    if (clusterRuntime && typeof clusterRuntime.logEvent === "function") {
      clusterRuntime.logEvent(kind, details);
    }
  }

  function resolveIncomingSender(dataEvent, state, payload = {}) {
    const senderOpenId = dataEvent?.sender?.sender_id?.open_id || "";
    const senderMachineFromOpenId = typeof clusterRuntime?.resolveSenderMachineByOpenId === "function"
      ? clusterRuntime.resolveSenderMachineByOpenId(senderOpenId)
      : null;
    const payloadMachineId = typeof payload.machineId === "string" ? payload.machineId.trim() : "";
    const senderMachineId = (senderMachineFromOpenId && typeof senderMachineFromOpenId.machineId === "string" && senderMachineFromOpenId.machineId.trim())
      || payloadMachineId
      || "";

    if (state) {
      state.lastSenderOpenId = senderOpenId || state.lastSenderOpenId || "";
      state.lastSenderMachineId = senderMachineId || "";
    }

    return {
      senderOpenId,
      senderMachineId,
      senderMachine: senderMachineFromOpenId || null,
    };
  }

  function extractChatName(dataEvent) {
    const candidates = [
      dataEvent?.message?.chat_name,
      dataEvent?.chat?.name,
      dataEvent?.event?.chat?.name,
      dataEvent?.event?.message?.chat_name,
      dataEvent?.message?.chat_display_name,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }

    return "";
  }

  function extractRenameDirective(text) {
    const lines = (text || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const match = trimmed.match(/^!?(?:\/)?rename\s+(.+)$/i);
      if (!match || !match[1]) {
        continue;
      }

      return match[1].trim().replace(/^["'`]+|["'`]+$/g, "");
    }

    return "";
  }

  function extractDirectMessageDirective(text) {
    const lines = (text || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const patterns = [
        /^!?(?:\/)?dm\s+(\S+)\s+([\s\S]+)$/i,
      ];

      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (!match || !match[1] || !match[2]) {
          continue;
        }

        return {
          recipient: match[1]
            .trim()
            .replace(/^["'`]+|["'`]+$/g, "")
            .replace(/^@+/, "")
            .replace(/^user\s+/i, "")
            .replace(/^member\s+/i, "")
            .replace(/^to\s+/i, ""),
          message: match[2].trim(),
        };
      }
    }

    return null;
  }

  async function applyDirectMessage(chatId, state, directive) {
    const recipientToken = (directive?.recipient || "").trim();
    const message = (directive?.message || "").trim();

    if (!recipientToken || !message) {
      await sendTextMessage(chatId, "Use `!dm <open_id|me|last> <message>`.");
      return;
    }

    let openId = "";
    if (/^(me|last|sender)$/i.test(recipientToken)) {
      openId = state.lastSenderOpenId || "";
    } else if (contactResolver && typeof contactResolver.resolveRecipientOpenId === "function") {
      const resolved = await contactResolver.resolveRecipientOpenId(recipientToken);
      openId = resolved?.openId || "";
    }

    if (!openId) {
      await sendTextMessage(chatId, `I could not resolve "${recipientToken}" to a valid open_id yet. Use an open_id, email, or mobile number.`);
      return;
    }

    await sendDirectMessage(openId, message, {
      source_chat_id: chatId,
      direct_message: true,
    });
    await sendTextMessage(chatId, `Sent a direct message to ${recipientToken}.`);
  }

  async function applyChatRename(chatId, state, chatName) {
    const cleanedName = (chatName || "").trim();
    if (!cleanedName) {
      await sendTextMessage(chatId, "Reply with a chat name after /rename.");
      return;
    }

    const storedEntry = stateStore.getPersistedChatEntry(chatId);
    const sessionId = state.codexResponseId || (state.currentThreadId ? storedEntry.sessionId : "");
    if (!sessionId) {
      state.chatName = cleanedName;
      if (state.pendingNewThread) {
        await sendTextMessage(chatId, `Saved chat name "${cleanedName}" for the next new session.`);
      } else {
        await sendTextMessage(chatId, "Start or resume a session before renaming this chat.");
      }
      return;
    }

    stateStore.setChatSessionId(chatId, state, sessionId, cleanedName);
    state.hasActiveSession = true;
    await sendTextMessage(chatId, `Saved chat name as "${cleanedName}".`);
  }

  async function sendModeOptions(chatId) {
    await sendTextMessage(chatId, `Codex armed.\nMachine: [${localIdentity}]\n1) resume\n2) new`);
  }

  async function sendResumeChatOptions(chatId, state) {
    const candidates = stateStore.buildNamedResumeChatCandidates();

    if (!candidates.length) {
      state.waitingForModeChoice = true;
      await sendTextMessage(chatId, "No named chats with saved sessions yet. Reply 2 to start a new session.");
      return;
    }

    state.waitingForResumeChatSelection = true;
    state.resumeChatCandidates = candidates;
    const options = candidates.map((candidate, index) => `${index + 1}) ${candidate.displayName || candidate.chatName}`);
    await sendTextMessage(chatId, `Select a chat to resume:\n${options.join("\n")}`);
  }

  function getQueuedCodexTasks(state) {
    if (!Array.isArray(state.queuedCodexTasks)) {
      state.queuedCodexTasks = [];
    }

    return state.queuedCodexTasks;
  }

  function queueCodexTask(state, text) {
    const cleanedText = (text || "").trim();
    if (!cleanedText) {
      return null;
    }

    const task = {
      text: cleanedText,
      queuedAt: new Date().toISOString(),
    };
    getQueuedCodexTasks(state).push(task);
    return task;
  }

  function clearQueuedCodexTaskAt(state, index) {
    const tasks = getQueuedCodexTasks(state);
    if (index < 0 || index >= tasks.length) {
      return null;
    }

    const [removed] = tasks.splice(index, 1);
    return removed || null;
  }

  function formatQueuedCodexTasks(state) {
    const tasks = getQueuedCodexTasks(state);
    const lines = ["Queued tasks:"];
    tasks.forEach((task, index) => {
      lines.push(`${index + 1}) ${task.text}`);
    });
    lines.push("cancel queue");
    lines.push("clear item <n>");
    lines.push("Reply with a number to hand that task item to Codex.");
    return lines.join("\n");
  }

  async function sendQueuedCodexTaskSelection(chatId, state) {
    const tasks = getQueuedCodexTasks(state);
    if (!tasks.length) {
      state.waitingForQueueSelection = false;
      return;
    }

    state.waitingForQueueSelection = true;
    await sendTextMessage(chatId, formatQueuedCodexTasks(state));
  }

  async function runQueuedCodexTask(chatId, state, taskIndex) {
    const tasks = getQueuedCodexTasks(state);
    if (taskIndex < 0 || taskIndex >= tasks.length) {
      await sendTextMessage(chatId, "Reply with a valid queued task number.");
      return;
    }

    const [selectedTask] = tasks.splice(taskIndex, 1);
    if (!selectedTask) {
      await sendTextMessage(chatId, "That queued task could not be found anymore.");
      return;
    }

    state.waitingForQueueSelection = false;
    await codexRunner.runCodexTurn(chatId, state, selectedTask.text);
    if (getQueuedCodexTasks(state).length > 0) {
      await sendQueuedCodexTaskSelection(chatId, state);
    }
  }

  function isSelectionLikeClusterMessage(text) {
    const normalizedText = (text || "").trim().toLowerCase();
    return (
      normalizedText === "1" ||
      normalizedText === "2" ||
      normalizedText === "resume" ||
      normalizedText === "new" ||
      normalizedText === "!codex on" ||
      normalizedText === "!codex off" ||
      normalizedText === "!codex cancel"
    );
  }

  function isSelfAddressedTargetToken(targetToken, selfProfile = {}) {
    const cleanedToken = (targetToken || "").trim().toLowerCase();
    if (!cleanedToken) {
      return false;
    }

    const machineId = typeof selfProfile.machineId === "string" ? selfProfile.machineId.trim() : "";
    const alias = typeof selfProfile.alias === "string" ? selfProfile.alias.trim() : "";
    const mentionId = typeof selfProfile.mentionId === "string" ? selfProfile.mentionId.trim() : "";
    const shortMachineId = typeof clusterRuntime?.shortMachineId === "function"
      ? clusterRuntime.shortMachineId(machineId)
      : machineId.slice(0, 8);

    return Boolean(
      (machineId && cleanedToken === machineId.toLowerCase()) ||
      (alias && cleanedToken === alias.toLowerCase()) ||
      (mentionId && cleanedToken === mentionId.toLowerCase()) ||
      (shortMachineId && cleanedToken === shortMachineId.toLowerCase())
    );
  }

  async function handleQueuedCodexSelection(chatId, state, userText) {
    const normalizedText = (userText || "").trim().toLowerCase();
    const tasks = getQueuedCodexTasks(state);

    if (!tasks.length) {
      state.waitingForQueueSelection = false;
      return false;
    }

    if (normalizedText === "cancel queue") {
      tasks.length = 0;
      state.waitingForQueueSelection = false;
      await sendTextMessage(chatId, "Cancelled queued tasks.");
      return true;
    }

    const clearMatch = normalizedText.match(/^clear item\s+(\d+)$/i);
    if (clearMatch) {
      const clearIndex = Number.parseInt(clearMatch[1], 10) - 1;
      if (!Number.isInteger(clearIndex) || clearIndex < 0 || clearIndex >= tasks.length) {
        await sendTextMessage(chatId, "Reply with a valid queued task number to clear.");
        return true;
      }

      const removed = clearQueuedCodexTaskAt(state, clearIndex);
      if (!removed) {
        await sendTextMessage(chatId, "That queued task could not be cleared.");
        return true;
      }

      if (getQueuedCodexTasks(state).length > 0) {
        await sendQueuedCodexTaskSelection(chatId, state);
      } else {
        state.waitingForQueueSelection = false;
        await sendTextMessage(chatId, "Queued task removed.");
      }
      return true;
    }

    const selectedIndex = Number.parseInt(normalizedText, 10);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > tasks.length) {
      await sendTextMessage(chatId, "Reply with a number, `cancel queue`, or `clear item <n>`.");
      return true;
    }

    await runQueuedCodexTask(chatId, state, selectedIndex - 1);
    return true;
  }

  async function handleClusterProtocolMessage(dataEvent, chatId, state, userText, senderInfo = {}) {
    if (!isClusterMode || !clusterRuntime || typeof clusterRuntime.parseProtocol !== "function") {
      return false;
    }

    const protocol = clusterRuntime.parseProtocol(userText);
    if (!protocol) {
      return false;
    }

    if (!clusterRuntime.shouldProcessChat(chatId)) {
      logCluster("hub-miss", {
        chatId,
        messageId: dataEvent?.message?.message_id || "",
        eventId: dataEvent?.event_id || "",
        protocolType: protocol.type,
      });
      return true;
    }

    const selfProfile = typeof clusterRuntime.getProfile === "function" ? clusterRuntime.getProfile() : localProfile;
    const payload = protocol.payload && typeof protocol.payload === "object" ? protocol.payload : {};
    const senderMachineId = typeof payload.machineId === "string" ? payload.machineId.trim() : "";
    const senderOpenId = typeof senderInfo.senderOpenId === "string" ? senderInfo.senderOpenId.trim() : dataEvent?.sender?.sender_id?.open_id || "";
    if (senderMachineId && selfProfile.machineId && senderMachineId === selfProfile.machineId) {
      logCluster("duplicate-ignore", {
        chatId,
        protocolType: protocol.type,
        reason: "self-message",
        senderMachineId,
      });
      return true;
    }

    if (protocol.type === "hello") {
      const result = clusterRuntime.recordHello(payload, { chatId, senderOpenId });
      if (result.self) {
        return true;
      }

      if (result.duplicate) {
        logCluster("duplicate-ignore", {
          chatId,
          protocolType: "hello",
          senderMachineId,
          announceId: typeof payload.announceId === "string" ? payload.announceId.trim() : "",
        });
        return true;
      }

      logCluster("announce", {
        chatId,
        senderMachineId: payload.machineId || "",
        senderAlias: payload.alias || "",
        announceId: payload.announceId || "",
      });

      if (result.shouldReplyIdentity && payload.announceId) {
        const identityMessage = clusterRuntime.buildIdentityMessage(payload.announceId);
        await sendTextMessage(chatId, identityMessage, {
          cluster_protocol: "identity",
          cluster_reply_to_announce_id: payload.announceId,
          cluster_machine_id: selfProfile.machineId || "",
          cluster_alias: selfProfile.alias || "",
        });
      }

      return true;
    }

    if (protocol.type === "identity") {
      const result = clusterRuntime.recordIdentity(payload, { chatId, senderOpenId });
      if (result.self) {
        return true;
      }

      logCluster("identity", {
        chatId,
        senderMachineId: payload.machineId || "",
        senderAlias: payload.alias || "",
        replyToAnnounceId: payload.replyToAnnounceId || "",
      });
      return true;
    }

    if (protocol.type === "goodbye") {
      const result = clusterRuntime.recordGoodbye(payload, { chatId, senderOpenId });
      if (result.self) {
        return true;
      }

      logCluster("shutdown-goodbye", {
        chatId,
        senderMachineId: payload.machineId || "",
        senderAlias: payload.alias || "",
      });
      return true;
    }

    if (protocol.type === "target") {
      const targetToken = typeof payload.to === "string" ? payload.to.trim() : typeof payload.target === "string" ? payload.target.trim() : "";
      const message = typeof payload.message === "string" ? payload.message.trim() : typeof payload.text === "string" ? payload.text.trim() : "";
      const targetResolution = clusterRuntime.resolveTarget(targetToken);

      if (targetResolution.status === "match" && targetResolution.scope === "self") {
        logCluster("target-match", {
          chatId,
          senderMachineId: payload.machineId || "",
          targetToken,
          targetMachineId: selfProfile.machineId || "",
        });
        if (message) {
          resolveIncomingSender(dataEvent, state, {
            machineId: payload.machineId || "",
          });
          await handleUserText(chatId, state, message);
        }
        return true;
      }

      if (targetResolution.status === "ambiguous" || targetResolution.status === "miss" || targetResolution.status === "invalid") {
        logCluster("target-miss", {
          chatId,
          senderMachineId: payload.machineId || "",
          targetToken,
          reason: targetResolution.reason || targetResolution.status,
        });
      }

      return true;
    }

    return true;
  }

  async function handleClusterExplicitTarget(dataEvent, chatId, state, userText, senderInfo = {}) {
    if (!isClusterMode || !clusterRuntime || typeof clusterRuntime.parseTarget !== "function") {
      return false;
    }

    const selfProfile = typeof clusterRuntime.getProfile === "function" ? clusterRuntime.getProfile() : localProfile;
    const target = clusterRuntime.parseTarget(userText);
    if (!target) {
      return false;
    }

    const targetResolution = clusterRuntime.resolveTarget(target.targetToken);
    const isSelfTarget = targetResolution.status === "match" && targetResolution.scope === "self" || isSelfAddressedTargetToken(target.targetToken, selfProfile);
    if (isSelfTarget) {
      logCluster("target-match", {
        chatId,
        messageId: dataEvent?.message?.message_id || "",
        eventId: dataEvent?.event_id || "",
        targetToken: target.targetToken,
        targetMachineId: targetResolution.machineId || selfProfile.machineId || "",
        fallbackSelfTarget: targetResolution.status !== "match" || targetResolution.scope !== "self",
      });
      const nextMessage = (target.message || "").trim() || "!codex on";
      if (nextMessage && !isSelectionLikeClusterMessage(nextMessage)) {
        state.isArmed = true;
        state.waitingForModeChoice = false;
        state.waitingForResumeChatSelection = false;
        state.waitingForQueueSelection = false;
        state.resumeChatCandidates = [];
        state.queuedCodexTasks = [];
        state.hasActiveSession = true;
      }
      resolveIncomingSender(dataEvent, state, {
        machineId: senderInfo.senderMachineId || "",
      });
      await handleUserText(chatId, state, nextMessage);
      return true;
    }

    if (targetResolution.status === "ambiguous") {
      logCluster("target-miss", {
        chatId,
        messageId: dataEvent?.message?.message_id || "",
        eventId: dataEvent?.event_id || "",
        targetToken: target.targetToken,
        reason: "alias-collision",
      });
      return true;
    }

    if (targetResolution.status === "miss" || targetResolution.status === "invalid") {
      logCluster("target-miss", {
        chatId,
        messageId: dataEvent?.message?.message_id || "",
        eventId: dataEvent?.event_id || "",
        targetToken: target.targetToken,
        reason: targetResolution.reason || targetResolution.status,
      });
      return true;
    }

    logCluster("target-miss", {
      chatId,
      messageId: dataEvent?.message?.message_id || "",
      eventId: dataEvent?.event_id || "",
      targetToken: target.targetToken,
      reason: "other-machine",
    });
    return true;
  }

  async function handleUserText(chatId, state, userText) {
    const normalizedText = userText.toLowerCase();

    if (normalizedText.startsWith("!upload ")) {
      try {
        const uploadPath = userText.slice("!upload ".length).trim();
        await fileTransfer.uploadFileToChat(chatId, uploadPath);
      } catch (uploadErr) {
        console.error("Upload error:", uploadErr);
        await sendTextMessage(chatId, `Failed to upload file: ${uploadErr.message}`);
      }
      return;
    }

    const renameTarget = extractRenameDirective(userText);
    if (renameTarget) {
      await applyChatRename(chatId, state, renameTarget);
      return;
    }

    const directMessageDirective = extractDirectMessageDirective(userText);
    if (directMessageDirective) {
      await applyDirectMessage(chatId, state, directMessageDirective);
      return;
    }

    if (normalizedText === "!codex on") {
      state.isArmed = true;
      state.waitingForModeChoice = true;
      state.waitingForResumeChatSelection = false;
      state.resumeChatCandidates = [];
      state.waitingForQueueSelection = false;
      state.queuedCodexTasks = [];
      await sendModeOptions(chatId);
      return;
    }

    if (normalizedText === "!codex off") {
      state.isArmed = false;
      state.waitingForModeChoice = false;
      state.waitingForResumeChatSelection = false;
      state.resumeChatCandidates = [];
      state.waitingForQueueSelection = false;
      state.queuedCodexTasks = [];
      await codexRunner.stopCodexSession(chatId, state);
      return;
    }

    if (normalizedText === "!codex cancel") {
      await codexRunner.cancelTurn(chatId, state);
      return;
    }

    if (!state.isArmed) {
      return;
    }

    if (state.waitingForQueueSelection) {
      const handledQueueSelection = await handleQueuedCodexSelection(chatId, state, userText);
      if (handledQueueSelection) {
        return;
      }
    }

    if (state.waitingForResumeChatSelection) {
      const selectedIndex = Number.parseInt(normalizedText, 10);
      if (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > state.resumeChatCandidates.length) {
        await sendTextMessage(chatId, "Reply with a valid chat number from the list.");
        return;
      }

      const selected = state.resumeChatCandidates[selectedIndex - 1];
      state.waitingForResumeChatSelection = false;
      state.resumeChatCandidates = [];
      state.waitingForModeChoice = false;
      state.waitingForQueueSelection = false;
      state.queuedCodexTasks = [];
      state.hasActiveSession = true;
      state.pendingNewThread = false;
      state.currentThreadId = selected.threadId || "";
      stateStore.setChatSessionId(chatId, state, selected.sessionId, selected.chatName);
      await sendTextMessage(chatId, `Resumed Codex session from "${selected.chatName}". Send your message.`);
      return;
    }

    if (state.waitingForModeChoice) {
      if (normalizedText === "1") {
        state.waitingForModeChoice = false;
        await sendResumeChatOptions(chatId, state);
        return;
      }

      if (normalizedText === "2" || normalizedText === "new") {
        state.waitingForModeChoice = false;
        state.waitingForQueueSelection = false;
        state.queuedCodexTasks = [];
        await codexRunner.startNewCodexSession(chatId, state);
        return;
      }

      if (normalizedText === "resume") {
        state.waitingForModeChoice = false;
        await sendResumeChatOptions(chatId, state);
        return;
      }

      await sendTextMessage(chatId, "Reply with 1 or 2.");
      return;
    }

    if (state.isTurnInFlight) {
      queueCodexTask(state, userText);
      return;
    }

    if (!state.hasActiveSession) {
      state.waitingForModeChoice = true;
      await sendModeOptions(chatId);
      return;
    }

    await codexRunner.runCodexTurn(chatId, state, userText);
    if (getQueuedCodexTasks(state).length > 0) {
      await sendQueuedCodexTaskSelection(chatId, state);
    }
  }

  async function handleIncomingFileMessage(dataEvent, chatId, state) {
    const contentObj = fileTransfer.parseMessageContent(dataEvent.message?.content);
    const fileKey = typeof contentObj.file_key === "string" ? contentObj.file_key.trim() : "";
    const fileName = typeof contentObj.file_name === "string" ? contentObj.file_name.trim() : "";
    const messageId = dataEvent.message?.message_id || "";
    const persistedEntry = stateStore.getPersistedChatEntry(chatId);

    if (!fileKey || !messageId) {
      await sendTextMessage(chatId, "I received a file message but it did not include a valid file key.");
      return;
    }

    const downloadedPath = await fileTransfer.downloadIncomingFileFromMessage(messageId, fileKey, fileName);
    const ext = path.extname(downloadedPath).toLowerCase();

    stateStore.appendMessageLog({
      direction: "incoming",
      chat_id: chatId,
      event_id: dataEvent.event_id || "",
      message_id: messageId,
      message_type: "file",
      file_key: fileKey,
      file_name: fileName || path.basename(downloadedPath),
      downloaded_path: downloadedPath,
      sender_type: dataEvent.sender?.sender_type || "",
      sender_open_id: dataEvent.sender?.sender_id?.open_id || "",
      codex_session_id: state.codexResponseId || persistedEntry.sessionId || "",
      chat_name: extractChatName(dataEvent) || persistedEntry.chatName || "",
    });

    if (ext !== ".txt") {
      await sendTextMessage(chatId, `Downloaded file: ${downloadedPath}. I currently auto-extract text only from .txt files.`);
      return;
    }

    let textContent = fs.readFileSync(downloadedPath, "utf8");
    textContent = textContent.replace(/\u0000/g, "").trim();
    const maxChars = 20000;
    const truncated = textContent.length > maxChars;
    const extractedText = truncated ? `${textContent.slice(0, maxChars)}\n\n[truncated]` : textContent;

    if (!extractedText) {
      await sendTextMessage(chatId, `Downloaded ${path.basename(downloadedPath)} but it appears to be empty.`);
      return;
    }

    stateStore.appendMessageLog({
      direction: "system",
      chat_id: chatId,
      message_type: "file_extract",
      source_path: downloadedPath,
      extracted_char_count: extractedText.length,
      truncated,
      codex_session_id: state.codexResponseId || persistedEntry.sessionId || "",
      chat_name: extractChatName(dataEvent) || persistedEntry.chatName || "",
    });

    await sendTextMessage(chatId, `Extracted text from ${path.basename(downloadedPath)}:\n${extractedText}`);
  }

  async function drainUserTextQueue(chatId, state) {
    if (state.isDrainingQueue) {
      return;
    }

    state.isDrainingQueue = true;
    try {
      while (state.pendingUserTexts.length > 0) {
        const nextText = state.pendingUserTexts.shift();
        if (typeof nextText !== "string" || !nextText.trim()) {
          continue;
        }

        await handleUserText(chatId, state, nextText);
      }
    } finally {
      state.isDrainingQueue = false;
      if (state.pendingUserTexts.length > 0) {
        void drainUserTextQueue(chatId, state);
      }
    }
  }

  function createEventDispatcher() {
    return new Lark.EventDispatcher({}).register({
      "im.message.message_read_v1": async () => {
        return;
      },
      "im.message.receive_v1": async (dataEvent) => {
        try {
          console.log("Received event:", JSON.stringify(dataEvent, null, 2));

          if (!dataEvent?.message) {
            return;
          }

          const senderType = dataEvent?.sender?.sender_type || "";
          const chatId = dataEvent.message.chat_id;
          if (isClusterMode && !clusterRuntime.shouldProcessChat(chatId)) {
            logCluster("hub-miss", {
              chatId,
              messageId: dataEvent.message.message_id || "",
              eventId: dataEvent.event_id || "",
            });
            return;
          }

          const state = stateStore.getChatState(chatId);
          const chatName = extractChatName(dataEvent);
          if (chatName) {
            stateStore.setChatDisplayName(chatId, state, chatName);
          }
          const eventKey = dataEvent.event_id || dataEvent.message.message_id;
          if (stateStore.markRecentEventKey(eventKey)) {
            logCluster("duplicate-ignore", {
              chatId,
              messageId: dataEvent.message.message_id || "",
              eventId: dataEvent.event_id || "",
              reason: "recent-event-key",
            });
            return;
          }

          const contentObj = fileTransfer.parseMessageContent(dataEvent.message.content);
          const userText = fileTransfer.extractUserTextFromMessage(dataEvent.message.message_type, contentObj);
          const senderOpenId = dataEvent.sender?.sender_id?.open_id || "";
          const senderMachine = isClusterMode && typeof clusterRuntime.resolveSenderMachineByOpenId === "function"
            ? clusterRuntime.resolveSenderMachineByOpenId(senderOpenId)
            : null;
          const senderMachineId = senderMachine && typeof senderMachine.machineId === "string" ? senderMachine.machineId.trim() : "";
          const selfMachineId = typeof clusterRuntime?.getProfile === "function"
            ? (clusterRuntime.getProfile().machineId || "")
            : localProfile.machineId || "";
          if (isClusterMode && senderMachineId && senderMachineId === selfMachineId) {
            return;
          }

          const protocolHandled = await handleClusterProtocolMessage(dataEvent, chatId, state, userText, {
            senderOpenId,
            senderMachineId,
          });
          if (protocolHandled) {
            return;
          }

          if (isClusterMode) {
            resolveIncomingSender(dataEvent, state, {
              machineId: senderMachineId || "",
            });
          }

          if (dataEvent.message.message_type === "file") {
            if (isClusterMode) {
              logCluster("target-miss", {
                chatId,
                messageId: dataEvent.message.message_id || "",
                eventId: dataEvent.event_id || "",
                reason: "file-message-not-supported",
              });
              return;
            }

            await handleIncomingFileMessage(dataEvent, chatId, state);
            return;
          }

          if (dataEvent.message.message_type !== "text" && dataEvent.message.message_type !== "post") {
            return;
          }

          const persistedEntry = stateStore.getPersistedChatEntry(chatId);
          stateStore.appendMessageLog({
            direction: "incoming",
            chat_id: chatId,
            event_id: dataEvent.event_id || "",
            message_id: dataEvent.message.message_id || "",
            message_type: dataEvent.message.message_type || "",
            text: userText,
            sender_type: dataEvent.sender?.sender_type || "",
            sender_open_id: dataEvent.sender?.sender_id?.open_id || "",
            codex_session_id: state.codexResponseId || persistedEntry.sessionId || "",
            chat_name: extractChatName(dataEvent) || persistedEntry.chatName || "",
          });

          if (!userText) {
            return;
          }

          if (isClusterMode) {
            const targeted = await handleClusterExplicitTarget(dataEvent, chatId, state, userText, {
              senderOpenId,
              senderMachineId,
            });
            if (targeted) {
              return;
            }

            logCluster("target-miss", {
              chatId,
              messageId: dataEvent.message.message_id || "",
              eventId: dataEvent.event_id || "",
              reason: senderType === "user" ? "unaddressed" : "unaddressed-bot",
            });
            return;
          }

          if (senderType !== "user") {
            return;
          }

          state.pendingUserTexts.push(userText);
          await drainUserTextQueue(chatId, state);
        } catch (err) {
          console.error("Handler error:", err);
        }
      },
    });
  }

  return {
    extractChatName,
    extractRenameDirective,
    extractDirectMessageDirective,
    sendModeOptions,
    sendResumeChatOptions,
    handleUserText,
    handleIncomingFileMessage,
    drainUserTextQueue,
    createEventDispatcher,
  };
}

module.exports = { createRelayController };
