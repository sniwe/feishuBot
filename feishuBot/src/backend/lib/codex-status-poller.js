function createCodexStatusPoller(ctx) {
  const { data = {}, deps } = ctx || {};
  const { fs, path, console, sendTextMessage, deleteTextMessage, updateTextMessage } = deps;
  const statusPath = data.statusPath;
  const intervalMs = Number.isFinite(data.intervalMs) ? data.intervalMs : 5000;
  const maxEditsPerMessage = Number.isFinite(data.maxEditsPerMessage) ? data.maxEditsPerMessage : 3;
  let timer = null;

  function formatWorkingText(startedAt) {
    const startedTime = Date.parse(startedAt || "");
    const elapsedMs = Number.isFinite(startedTime) ? Math.max(0, Date.now() - startedTime) : 0;
    const elapsedTicks = Math.floor(elapsedMs / intervalMs);
    const elapsedSeconds = elapsedTicks * Math.max(1, Math.round(intervalMs / 1000));
    return `Relayed & working (${elapsedSeconds}s)`;
  }

  function readStatus() {
    if (!statusPath || !fs || !path) {
      return null;
    }

    if (!fs.existsSync(statusPath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(statusPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeStatus(status, patch = {}) {
    if (!statusPath || !fs) {
      return;
    }

    const nextStatus = {
      ...status,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(statusPath, JSON.stringify(nextStatus, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to persist Codex status update:", err.message);
    }
  }

  async function rotateWorkingMessage(status, workingText) {
    const previousMessageId = typeof status?.statusMessageId === "string" ? status.statusMessageId.trim() : "";
    if (previousMessageId && typeof deleteTextMessage === "function") {
      try {
        await deleteTextMessage(previousMessageId);
      } catch (err) {
        console.error("Failed to delete stale Codex working message:", err.message);
      }
    }

    if (typeof sendTextMessage !== "function") {
      return "";
    }

    const nextMessageId = await sendTextMessage(status.chatId || "", workingText, {
      relay_status: true,
      source_codex_session_id: status.codexSessionId || "",
    });

    writeStatus(status, {
      statusMessageId: nextMessageId || "",
      statusEditCount: 0,
    });

    return nextMessageId || "";
  }

  async function tick() {
    const status = readStatus();
    const busy = Boolean(status?.busy);
    console.log(busy ? "x" : "o");

    if (!busy) {
      return;
    }

    const messageId = typeof status?.statusMessageId === "string" ? status.statusMessageId.trim() : "";
    if (!messageId || typeof updateTextMessage !== "function") {
      return;
    }

    const workingText = formatWorkingText(status?.startedAt || status?.updatedAt || "");
    const editCount = Number(status?.statusEditCount || 0);

    try {
      if (editCount >= maxEditsPerMessage) {
        await rotateWorkingMessage(status, workingText);
        return;
      }

      await updateTextMessage(messageId, workingText);
      writeStatus(status, {
        statusEditCount: editCount + 1,
      });
    } catch (err) {
      const errorCode = err?.response?.data?.code || err?.response?.data?.error?.code || err?.code || "";
      if (String(errorCode) === "230072" || /number of times it can be edited/i.test(err?.response?.data?.msg || err?.message || "")) {
        await rotateWorkingMessage(status, workingText);
        return;
      }

      console.error("Failed to update Codex working message:", err.message);
    }
  }

  function start() {
    if (timer) {
      return;
    }

    void tick();
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  function stop() {
    if (!timer) {
      return;
    }

    clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    tick,
  };
}

module.exports = { createCodexStatusPoller };
