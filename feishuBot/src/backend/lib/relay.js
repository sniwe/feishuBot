function createRelayController(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    Lark,
    fs,
    path,
    stateStore,
    fileTransfer,
    codexRunner,
    sendTextMessage,
    sendDirectMessage,
  } = deps;

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

      const match = trimmed.match(/^!?(?:\/)?dm\s+(\S+)\s+([\s\S]+)$/i);
      if (!match || !match[1] || !match[2]) {
        continue;
      }

      return {
        recipient: match[1].trim(),
        message: match[2].trim(),
      };
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

    let openId = recipientToken;
    if (/^(me|last|sender)$/i.test(recipientToken)) {
      openId = state.lastSenderOpenId || "";
    }

    if (!openId) {
      await sendTextMessage(chatId, "No direct-message recipient is available yet.");
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
    await sendTextMessage(chatId, "Codex armed.\n1) resume\n2) new");
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
      await sendModeOptions(chatId);
      return;
    }

    if (normalizedText === "!codex off") {
      state.isArmed = false;
      state.waitingForModeChoice = false;
      state.waitingForResumeChatSelection = false;
      state.resumeChatCandidates = [];
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

      if (normalizedText === "2") {
        state.waitingForModeChoice = false;
        await codexRunner.startNewCodexSession(chatId, state);
        return;
      }

      await sendTextMessage(chatId, "Reply with 1 or 2.");
      return;
    }

    if (!state.hasActiveSession) {
      state.waitingForModeChoice = true;
      await sendModeOptions(chatId);
      return;
    }

    await codexRunner.runCodexTurn(chatId, state, userText);
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

          if (dataEvent?.sender?.sender_type !== "user") {
            return;
          }

          const chatId = dataEvent.message.chat_id;
          const state = stateStore.getChatState(chatId);
          state.lastSenderOpenId = dataEvent.sender?.sender_id?.open_id || state.lastSenderOpenId || "";
          const chatName = extractChatName(dataEvent);
          if (chatName) {
            stateStore.setChatDisplayName(chatId, state, chatName);
          }
          const eventKey = dataEvent.event_id || dataEvent.message.message_id;
          if (stateStore.markRecentEventKey(eventKey)) {
            return;
          }

          if (dataEvent.message.message_type === "file") {
            await handleIncomingFileMessage(dataEvent, chatId, state);
            return;
          }

          if (dataEvent.message.message_type !== "text") {
            return;
          }

          const contentObj = fileTransfer.parseMessageContent(dataEvent.message.content);
          const userText = (contentObj.text || "").trim();

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
