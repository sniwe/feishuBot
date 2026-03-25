function createCodexRunner(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    spawn,
    fs,
    os,
    path,
    projectRoot,
    codexCommand,
    codexModel,
    codexExtraArgs,
    codexRelayPrompt,
    codexStatusPath,
    quoteForCmd,
    splitForFeishu,
    uploadFileToChat,
    resolveRecipientOpenId,
    sendDirectMessage,
    sendTextMessage,
    setChatSessionId,
    extractThreadStartedId,
    lookupCodexSessionIdByThreadName,
    extractUploadDirective,
  } = deps;

  function buildCodexPrompt(userText, state = {}) {
    const chatId = state.chatId || "";
    const senderOpenId = state.lastSenderOpenId || "";
    return `${codexRelayPrompt}\n\nCHAT_CONTEXT:\n- CHAT_ID: ${chatId}\n- LAST_SENDER_OPEN_ID: ${senderOpenId || "(unknown)"}\n\nUSER_MESSAGE: ${userText}\nASSISTANT_REPLY:`;
  }

  function writeCodexStatus(busy, extra = {}) {
    if (!codexStatusPath) {
      return;
    }

    const dirPath = path.dirname(codexStatusPath);
    const tmpPath = `${codexStatusPath}.tmp`;
    const payload = {
      busy: Boolean(busy),
      updatedAt: new Date().toISOString(),
      ...extra,
    };
    const serialized = JSON.stringify(payload, null, 2);

    fs.mkdirSync(dirPath, { recursive: true });
    try {
      fs.writeFileSync(tmpPath, serialized, "utf8");
      fs.renameSync(tmpPath, codexStatusPath);
    } catch {
      fs.writeFileSync(codexStatusPath, serialized, "utf8");
    } finally {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.rmSync(tmpPath, { force: true });
        }
      } catch {
        // Best effort cleanup only.
      }
    }
  }

  function buildCodexArgs(outputPath) {
    const args = ["exec", "--json", "--sandbox", "danger-full-access", "--cd", projectRoot, "--output-last-message", outputPath];

    if (codexModel) {
      args.push("--model", codexModel);
    }

    if (codexExtraArgs) {
      for (const chunk of codexExtraArgs.split(/\s+/).filter(Boolean)) {
        args.push(chunk);
      }
    }

    args.push("-");
    return args;
  }

  function buildCodexResumeArgs(sessionId, outputPath) {
    const args = ["exec", "resume", "--json", "--output-last-message", outputPath];

    if (codexModel) {
      args.push("--model", codexModel);
    }

    if (codexExtraArgs) {
      for (const chunk of codexExtraArgs.split(/\s+/).filter(Boolean)) {
        args.push(chunk);
      }
    }

    args.push(sessionId);
    args.push("-");
    return args;
  }

  function extractLastUsefulText(text) {
    const raw = (text || "").trim();
    if (!raw) {
      return "";
    }

    const lines = raw.split(/\r?\n/);
    const useful = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (/^(Codex stderr:|\[info\]:|\[warn\]:|warning:|deprecated:|\d{4}-\d{2}-\d{2}T)/.test(trimmed)) {
        continue;
      }

      if (trimmed === "codex") {
        continue;
      }

      useful.push(trimmed);
    }

    return useful.join("\n").trim();
  }

  function extractDirectMessageDirective(text, state = {}) {
    const lines = (text || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const patterns = [
        /^DM_USER:\s*(.+?)\s*\|\s*([\s\S]+)$/i,
        /^@(.+?)\s*:\s*([\s\S]+)$/i,
        /^send\s+a\s+message\s+to\s+(.+?)\s*:\s*([\s\S]+)$/i,
        /^send\s+message\s+to\s+(.+?)\s*:\s*([\s\S]+)$/i,
      ];

      let recipientToken = "";
      let message = "";
      for (const pattern of patterns) {
        const match = trimmed.match(pattern);
        if (!match || !match[1] || !match[2]) {
          continue;
        }

        recipientToken = match[1]
          .trim()
          .replace(/^["'`]+|["'`]+$/g, "")
          .replace(/^@+/, "")
          .replace(/^user\s+/i, "")
          .replace(/^member\s+/i, "")
          .replace(/^to\s+/i, "");
        message = match[2].trim();
        break;
      }

      if (!recipientToken || !message) {
        continue;
      }

      let openId = "";
      if (/^(me|last_sender|last|sender)$/i.test(recipientToken)) {
        openId = state.lastSenderOpenId || "";
      } else if (/^ou_[a-z0-9]+$/i.test(recipientToken)) {
        openId = recipientToken;
      }

      return {
        recipientToken,
        openId,
        message,
      };
    }

    return null;
  }

  function stripDirectiveLines(text) {
    return (text || "")
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return true;
        }

        return (
          !/^DM_USER:\s*/i.test(trimmed) &&
          !/^@.+?:/i.test(trimmed) &&
          !/^send\s+a\s+message\s+to\s+/i.test(trimmed) &&
          !/^send\s+message\s+to\s+/i.test(trimmed) &&
          !/^(!upload\s+|UPLOAD_FILE:\s*)/i.test(trimmed)
        );
      })
      .join("\n")
      .trim();
  }

  async function runCodexTurn(chatId, state, userText) {
    if (state.isTurnInFlight) {
      return;
    }

    state.isTurnInFlight = true;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "feishuBot-codex-"));
    const outputPath = path.join(tempDir, "last-message.txt");
    const prompt = buildCodexPrompt(userText, state);
    const codexSessionId = typeof state.codexResponseId === "string" ? state.codexResponseId.trim() : "";
    const codexArgs = codexSessionId ? buildCodexResumeArgs(codexSessionId, outputPath) : buildCodexArgs(outputPath);
    let child = null;
    let stderr = "";
    let stdout = "";

    try {
      let statusMessageId = "";
      try {
        statusMessageId = await sendTextMessage(chatId, "Relayed & working (0s)", {
          relay_status: true,
          source_codex_session_id: codexSessionId || "",
        });
      } catch (statusErr) {
        console.error("Failed to send Codex working status message:", statusErr.message);
      }

      state.relayStatusMessageId = statusMessageId || "";
      state.relayStatusStartedAt = new Date().toISOString();

      child = spawn("cmd.exe", ["/d", "/s", "/c", [codexCommand, ...codexArgs].map(quoteForCmd).join(" ")], {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      state.activeCodexProcess = child;
      writeCodexStatus(true, {
        chatId,
        processId: child.pid || null,
        codexSessionId: codexSessionId || "",
        statusMessageId: state.relayStatusMessageId || "",
        startedAt: state.relayStatusStartedAt || new Date().toISOString(),
      });

      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });
        child.once("close", resolve);
        child.stdin.end(prompt);
      });

      const fileText = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
      const finalMessage = extractLastUsefulText(fileText) || extractLastUsefulText(stdout) || extractLastUsefulText(stderr);

      if (exitCode !== 0 && !finalMessage) {
        throw new Error(`Codex exec exited with code ${exitCode}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
      }

      if (!finalMessage) {
        await sendTextMessage(chatId, "No response content returned by Codex.");
        return;
      }

      const startedSessionId = extractThreadStartedId(stdout);
      if (startedSessionId) {
        setChatSessionId(chatId, state, startedSessionId, state.chatName);
      } else if (codexSessionId) {
        setChatSessionId(chatId, state, codexSessionId, state.chatName);
      } else {
        const fallbackSessionId = lookupCodexSessionIdByThreadName(state.chatName) || "";
        setChatSessionId(chatId, state, fallbackSessionId, state.chatName);
      }
      state.hasActiveSession = true;

      writeCodexStatus(false, {
        chatId,
        processId: null,
        codexSessionId: state.codexResponseId || codexSessionId || "",
        statusMessageId: state.relayStatusMessageId || "",
        startedAt: state.relayStatusStartedAt || "",
      });
      state.relayStatusMessageId = "";
      state.relayStatusStartedAt = "";
      if (state.isTurnInFlight) {
        state.isTurnInFlight = false;
      }

      let messageText = finalMessage;
      const directMessageDirective = extractDirectMessageDirective ? extractDirectMessageDirective(finalMessage, state) : null;
      if (directMessageDirective) {
        let resolvedOpenId = directMessageDirective.openId;
        if (!resolvedOpenId && typeof resolveRecipientOpenId === "function") {
          const resolved = await resolveRecipientOpenId(directMessageDirective.recipientToken);
          resolvedOpenId = resolved?.openId || "";
        }

        if (!resolvedOpenId) {
          throw new Error(`Codex requested a DM to "${directMessageDirective.recipientToken}" but no recipient open_id was available.`);
        }

        await sendDirectMessage(resolvedOpenId, directMessageDirective.message, {
          source_chat_id: chatId,
          source_codex_session_id: state.codexResponseId || codexSessionId || "",
          direct_message: true,
          codex_directive: "DM_USER",
        });
      }

      const uploadDirective = extractUploadDirective ? extractUploadDirective(finalMessage) : "";
      if (uploadDirective) {
        await uploadFileToChat(chatId, uploadDirective);
      }

      messageText = stripDirectiveLines(finalMessage);
      if (directMessageDirective && !messageText) {
        messageText = `Sent a direct message to ${directMessageDirective.recipientToken}.`;
      }

      for (const chunk of splitForFeishu(messageText)) {
        await sendTextMessage(chatId, chunk);
      }
    } catch (err) {
      if (err && err.signal === "SIGTERM") {
        return;
      }

      console.error("Codex request error:", err);
      await sendTextMessage(chatId, `Failed to run Codex: ${err.message}`);
    } finally {
      state.isTurnInFlight = false;
      if (state.activeCodexProcess === child) {
        state.activeCodexProcess = null;
      }

      writeCodexStatus(false, {
        chatId,
        processId: null,
        codexSessionId: state.codexResponseId || codexSessionId || "",
        statusMessageId: "",
        startedAt: "",
      });

      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error("Failed to clean Codex temp dir:", cleanupErr.message);
      }
    }
  }

  async function startNewCodexSession(chatId, state) {
    state.hasActiveSession = true;
    state.waitingForResumeChatSelection = false;
    state.resumeChatCandidates = [];
    state.isTurnInFlight = false;
    state.activeCodexProcess = null;
    state.currentThreadId = "";
    state.pendingNewThread = true;
    state.codexResponseId = null;
    state.relayStatusMessageId = "";
    state.relayStatusStartedAt = "";
    writeCodexStatus(false, {
      chatId,
      processId: null,
      codexSessionId: "",
      statusMessageId: "",
      startedAt: "",
    });

    await sendTextMessage(chatId, "Started new Codex session. Send your message.");
  }

  async function cancelTurn(chatId, state) {
    if (!state.activeCodexProcess) {
      await sendTextMessage(chatId, "No active Codex request to cancel.");
      return;
    }

    state.activeCodexProcess.kill();
    state.activeCodexProcess = null;
    state.isTurnInFlight = false;
    state.relayStatusMessageId = "";
    state.relayStatusStartedAt = "";
    writeCodexStatus(false, {
      chatId,
      processId: null,
      codexSessionId: state.codexResponseId || "",
      statusMessageId: "",
      startedAt: "",
    });
    await sendTextMessage(chatId, "Cancelled current Codex request.");
  }

  async function stopCodexSession(chatId, state) {
    if (state.activeCodexProcess) {
      state.activeCodexProcess.kill();
    }

    state.hasActiveSession = false;
    state.waitingForResumeChatSelection = false;
    state.resumeChatCandidates = [];
    state.isTurnInFlight = false;
    state.activeCodexProcess = null;
    state.pendingNewThread = false;
    if (state.codexResponseId || state.currentThreadId) {
      setChatSessionId(chatId, state, state.codexResponseId, state.chatName);
    }
    state.relayStatusMessageId = "";
    state.relayStatusStartedAt = "";

    writeCodexStatus(false, {
      chatId,
      processId: null,
      codexSessionId: state.codexResponseId || "",
      statusMessageId: "",
      startedAt: "",
    });

    await sendTextMessage(chatId, "Codex disarmed.");
  }

  return {
    buildCodexPrompt,
    buildCodexArgs,
    buildCodexResumeArgs,
    extractLastUsefulText,
    extractDirectMessageDirective,
    runCodexTurn,
    startNewCodexSession,
    cancelTurn,
    stopCodexSession,
  };
}

module.exports = { createCodexRunner };
