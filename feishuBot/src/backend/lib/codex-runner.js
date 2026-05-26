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
    clusterRuntime,
    deleteTextMessage,
  } = deps;
  const skipGitRepoCheck = !/^(false|0|no|off)$/i.test((process.env.CODEX_SKIP_GIT_REPO_CHECK || "true").trim());
  const turnTimeoutMs = Number.isFinite(data.turnTimeoutMs) && data.turnTimeoutMs > 0 ? data.turnTimeoutMs : 5 * 60 * 1000;
  const isClusterMode = Boolean(clusterRuntime && typeof clusterRuntime.isEnabled === "function" && clusterRuntime.isEnabled());

  function getMachineProfile() {
    return typeof clusterRuntime?.getProfile === "function" ? clusterRuntime.getProfile() : {};
  }

  function getMachineLabel(profile = getMachineProfile()) {
    if (typeof clusterRuntime?.formatSelfLabel === "function") {
      const label = clusterRuntime.formatSelfLabel();
      if (typeof label === "string" && label.trim()) {
        return label.trim();
      }
    }

    return [profile.alias, profile.machineId ? `(${String(profile.machineId).slice(0, 8)})` : ""].filter(Boolean).join(" ").trim();
  }

  function getWorkingIdentity(profile = getMachineProfile()) {
    return (profile.alias || getMachineLabel(profile) || profile.machineId || "unknown").trim();
  }

  function compactMachineRoster(roster = []) {
    return roster
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const machineId = typeof entry.machineId === "string" ? entry.machineId.trim() : "";
        if (!machineId) {
          return "";
        }

        const alias = typeof entry.alias === "string" ? entry.alias.trim() : "";
        const openId = typeof entry.openId === "string" ? entry.openId.trim() : "";
        const source = typeof entry.source === "string" ? entry.source.trim() : "";
        return [alias || machineId, machineId ? `(${machineId.slice(0, 8)})` : "", openId ? `open_id=${openId}` : "", source ? `[${source}]` : ""]
          .filter(Boolean)
          .join(" ");
      })
      .filter(Boolean);
  }

  function killProcessTree(pid, reason = "") {
    const cleanedPid = Number(pid);
    if (!Number.isInteger(cleanedPid) || cleanedPid <= 0) {
      return;
    }

    try {
      const killer = spawn("taskkill", ["/PID", String(cleanedPid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", (err) => {
        console.error(`Failed to taskkill Codex process${reason ? ` (${reason})` : ""}:`, err.message);
      });
    } catch (err) {
      console.error(`Failed to launch taskkill for Codex process${reason ? ` (${reason})` : ""}:`, err.message);
    }
  }

  function buildCodexPrompt(userText, state = {}) {
    const machineProfile = getMachineProfile();
    const machineLabel = getMachineLabel(machineProfile);
    const chatId = state.chatId || "";
    const senderOpenId = state.lastSenderOpenId || "";
    const senderMachineId = state.lastSenderMachineId || "";
    const roster = typeof clusterRuntime?.getMachineRoster === "function" ? clusterRuntime.getMachineRoster() : [];
    const rosterLines = compactMachineRoster(roster);
    return `${codexRelayPrompt}\n\nCHAT_CONTEXT:\n- MACHINE_LABEL: ${machineLabel || "(unknown)"}\n- MACHINE_ID: ${machineProfile.machineId || "(unknown)"}\n- MACHINE_ALIAS: ${machineProfile.alias || "(unknown)"}\n- CHAT_ID: ${chatId}\n- LAST_SENDER_OPEN_ID: ${senderOpenId || "(unknown)"}\n- LAST_SENDER_MACHINE_ID: ${senderMachineId || "(unknown)"}\n- KNOWN_MACHINE_ROSTER:\n${rosterLines.length ? rosterLines.map((line) => `  - ${line}`).join("\n") : "  - (none)"}\n\nUSER_MESSAGE: ${userText}\nASSISTANT_REPLY:`;
  }

  function writeCodexStatus(busy, extra = {}) {
    if (!codexStatusPath) {
      return;
    }

    const machineProfile = getMachineProfile();
    const machineLabel = getMachineLabel(machineProfile);
    const dirPath = path.dirname(codexStatusPath);
    const tmpPath = `${codexStatusPath}.tmp`;
    const payload = {
      busy: Boolean(busy),
      updatedAt: new Date().toISOString(),
      machineLabel,
      machineId: machineProfile.machineId || "",
      machineAlias: machineProfile.alias || "",
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

  function sanitizeCodexExtraArgs(extraArgs) {
    const tokens = typeof extraArgs === "string" ? extraArgs.split(/\s+/).filter(Boolean) : [];
    const cleaned = [];
    let skipValue = false;

    for (const token of tokens) {
      if (skipValue) {
        skipValue = false;
        continue;
      }

      if (/^(--sandbox|--cd|--launch)(=.+)?$/i.test(token) || /^-C(=.+)?$/i.test(token)) {
        if (!/=/.test(token)) {
          skipValue = true;
        }
        continue;
      }

      cleaned.push(token);
    }

    return cleaned;
  }

  function buildCodexArgs(outputPath) {
    const args = ["exec", "--json"];

    if (skipGitRepoCheck) {
      args.push("--skip-git-repo-check");
    }

    if (codexModel) {
      args.push("--model", codexModel);
    }

    if (codexExtraArgs) {
      args.push(...sanitizeCodexExtraArgs(codexExtraArgs));
    }

    args.push("--sandbox", "danger-full-access", "--cd", projectRoot);
    args.push("--output-last-message", outputPath);
    args.push("-");
    return args;
  }

  function buildCodexResumeArgs(sessionId, outputPath) {
    const args = ["exec", "resume", "--json"];

    if (skipGitRepoCheck) {
      args.push("--skip-git-repo-check");
    }

    if (codexModel) {
      args.push("--model", codexModel);
    }

    if (codexExtraArgs) {
      args.push(...sanitizeCodexExtraArgs(codexExtraArgs));
    }

    args.push("--sandbox", "danger-full-access", "--cd", projectRoot);
    args.push("--output-last-message", outputPath);
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

  function extractRelayDirective(text, state = {}) {
    if (!isClusterMode || !clusterRuntime || typeof clusterRuntime.resolveTarget !== "function") {
      return null;
    }

    const lines = (text || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const match = trimmed.match(/^@(.+?)\s*:\s*([\s\S]+)$/i);
      if (!match || !match[1] || !match[2]) {
        continue;
      }

      const targetToken = match[1]
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/^@+/, "")
        .replace(/^machine\s+/i, "")
        .replace(/^to\s+/i, "");
      const message = match[2].trim();
      if (!targetToken || !message) {
        continue;
      }

      const targetResolution = clusterRuntime.resolveTarget(targetToken);
      if (targetResolution.status !== "match" || !targetResolution.machineId) {
        continue;
      }

      return {
        targetToken,
        machineId: targetResolution.machineId,
        alias: targetResolution.alias || "",
        message,
        raw: trimmed,
      };
    }

    return null;
  }

  function isDirectContactToken(token) {
    const cleanedToken = (token || "").trim();
    return (
      /^ou_[a-z0-9]+$/i.test(cleanedToken) ||
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanedToken) ||
      /^\+?[0-9][0-9\s()-]{5,}[0-9]$/.test(cleanedToken)
    );
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
    let timedOut = false;
    let turnTimeoutHandle = null;
    let relayStatusMessageId = "";
    const machineProfile = getMachineProfile();
    const machineLabel = getMachineLabel(machineProfile);
    const workingIdentity = getWorkingIdentity(machineProfile);

    try {
      try {
        relayStatusMessageId = await sendTextMessage(chatId, `Relayed & working [${workingIdentity}] (0s)`, {
          relay_status: true,
          source_codex_session_id: codexSessionId || "",
          machine_label: machineLabel,
          machine_identity: workingIdentity,
          machine_id: machineProfile.machineId || "",
          machine_alias: machineProfile.alias || "",
        });
      } catch (statusErr) {
        console.error("Failed to send Codex working status message:", statusErr.message);
      }

      state.relayStatusMessageId = relayStatusMessageId || "";
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
        machineLabel,
        machineId: machineProfile.machineId || "",
        machineAlias: machineProfile.alias || "",
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
        turnTimeoutHandle = setTimeout(() => {
          timedOut = true;
          try {
            killProcessTree(child?.pid, "timeout");
          } catch (killErr) {
            console.error("Failed to kill timed-out Codex process:", killErr.message);
          }
          reject(new Error(`Codex timed out after ${Math.round(turnTimeoutMs / 60000)} minutes.`));
        }, turnTimeoutMs);
        if (turnTimeoutHandle && typeof turnTimeoutHandle.unref === "function") {
          turnTimeoutHandle.unref();
        }
      });
      if (turnTimeoutHandle) {
        clearTimeout(turnTimeoutHandle);
      }

      if (timedOut) {
        throw new Error(`Codex timed out after ${Math.round(turnTimeoutMs / 60000)} minutes.`);
      }

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
        machineLabel,
        machineId: machineProfile.machineId || "",
        machineAlias: machineProfile.alias || "",
      });
      state.relayStatusMessageId = "";
      state.relayStatusStartedAt = "";
      if (state.isTurnInFlight) {
        state.isTurnInFlight = false;
      }

      let messageText = finalMessage;
      let usedInChatTagFallback = false;
      let handledSelfRelayDirective = false;
      const relayDirective = extractRelayDirective ? extractRelayDirective(finalMessage, state) : null;
      if (relayDirective) {
        const relayTargetResolution = clusterRuntime && typeof clusterRuntime.resolveTarget === "function"
          ? clusterRuntime.resolveTarget(relayDirective.targetToken)
          : { status: "miss", targetToken: relayDirective.targetToken };
        if (relayTargetResolution.status === "match" && relayTargetResolution.scope === "self") {
          messageText = stripDirectiveLines(finalMessage) || relayDirective.message;
          handledSelfRelayDirective = true;
        } else {
          const relayTargetToken = relayTargetResolution.status === "match" && relayTargetResolution.machineId
            ? relayTargetResolution.machineId
            : relayDirective.targetToken;

          await sendTextMessage(chatId, `@${relayTargetToken}: ${relayDirective.message}`, {
            source_chat_id: chatId,
            source_codex_session_id: state.codexResponseId || codexSessionId || "",
            direct_message: false,
            relay_target_token: relayDirective.targetToken,
            relay_target_machine_id: relayTargetResolution.machineId || "",
            relay_target_machine_alias: relayTargetResolution.alias || "",
            relay_target_mention_id: relayTargetResolution.mentionId || "",
            relay_target_relay_chat_id: relayTargetResolution.relayChatId || "",
            codex_directive: "RELAY_MACHINE",
          });
          messageText = stripDirectiveLines(finalMessage);
          if (!messageText) {
            return;
          }
        }
      }

      const directMessageDirective = relayDirective ? null : extractDirectMessageDirective ? extractDirectMessageDirective(finalMessage, state) : null;
      if (directMessageDirective) {
        let resolvedOpenId = directMessageDirective.openId;
        if (!resolvedOpenId && typeof resolveRecipientOpenId === "function") {
          const resolved = await resolveRecipientOpenId(directMessageDirective.recipientToken);
          resolvedOpenId = resolved?.openId || "";
        }

        if (!resolvedOpenId) {
          if (!isDirectContactToken(directMessageDirective.recipientToken)) {
            await sendTextMessage(chatId, `@${directMessageDirective.recipientToken}: ${directMessageDirective.message}`, {
              source_chat_id: chatId,
              source_codex_session_id: state.codexResponseId || codexSessionId || "",
              direct_message: true,
              direct_message_fallback: true,
              codex_directive: "DM_USER",
            });
            usedInChatTagFallback = true;
            messageText = stripDirectiveLines(finalMessage);
            if (!messageText) {
              return;
            }
          }

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

      if (!handledSelfRelayDirective) {
        messageText = stripDirectiveLines(finalMessage);
      }
      if (usedInChatTagFallback && !messageText) {
        return;
      }
      if (directMessageDirective && !messageText) {
        messageText = `Sent a direct message to ${directMessageDirective.recipientToken}.`;
      }

      for (const chunk of splitForFeishu(messageText)) {
        await sendTextMessage(chatId, chunk);
      }
    } catch (err) {
      if (turnTimeoutHandle) {
        clearTimeout(turnTimeoutHandle);
      }
      if (err && err.signal === "SIGTERM") {
        return;
      }

      console.error("Codex request error:", err);
      await sendTextMessage(chatId, `Failed to run Codex: ${err.message}`);
    } finally {
      if (turnTimeoutHandle) {
        clearTimeout(turnTimeoutHandle);
      }
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
        machineLabel,
        machineId: machineProfile.machineId || "",
        machineAlias: machineProfile.alias || "",
      });

      if (relayStatusMessageId && typeof deleteTextMessage === "function") {
        try {
          await deleteTextMessage(relayStatusMessageId);
        } catch (deleteErr) {
          console.error("Failed to delete Codex working message:", deleteErr.message);
        }
      }

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

    await sendTextMessage(chatId, `Started new Codex session [${getWorkingIdentity()}]. Send your message.`);
  }

  async function cancelTurn(chatId, state) {
    const relayStatusMessageId = typeof state.relayStatusMessageId === "string" ? state.relayStatusMessageId.trim() : "";
    if (!state.activeCodexProcess) {
      await sendTextMessage(chatId, "No active Codex request to cancel.");
      return;
    }

    killProcessTree(state.activeCodexProcess?.pid, "cancel");
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

    if (relayStatusMessageId && typeof deleteTextMessage === "function") {
      try {
        await deleteTextMessage(relayStatusMessageId);
      } catch (deleteErr) {
        console.error("Failed to delete Codex working message:", deleteErr.message);
      }
    }

    await sendTextMessage(chatId, "Cancelled current Codex request.");
  }

  async function stopCodexSession(chatId, state) {
    const relayStatusMessageId = typeof state.relayStatusMessageId === "string" ? state.relayStatusMessageId.trim() : "";
    if (state.activeCodexProcess) {
      killProcessTree(state.activeCodexProcess?.pid, "stop");
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

    if (relayStatusMessageId && typeof deleteTextMessage === "function") {
      try {
        await deleteTextMessage(relayStatusMessageId);
      } catch (deleteErr) {
        console.error("Failed to delete Codex working message:", deleteErr.message);
      }
    }

    await sendTextMessage(chatId, `Codex disarmed [${getWorkingIdentity()}].`);
  }

      return {
        buildCodexPrompt,
        buildCodexArgs,
        buildCodexResumeArgs,
        extractLastUsefulText,
        extractRelayDirective,
        extractDirectMessageDirective,
        runCodexTurn,
        startNewCodexSession,
        cancelTurn,
    stopCodexSession,
  };
}

module.exports = { createCodexRunner };
