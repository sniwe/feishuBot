function createRelaySweeper(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    client,
    relayController,
    fileTransfer,
    console,
  } = deps;

  const relayChatId = typeof data.relayChatId === "string" ? data.relayChatId.trim() : "";
  const intervalMs = Number.isFinite(data.intervalMs) && data.intervalMs > 0 ? data.intervalMs : 15 * 1000;
  const lookbackMs = Number.isFinite(data.lookbackMs) && data.lookbackMs > 0 ? data.lookbackMs : 5 * 60 * 1000;
  const pageSize = Number.isFinite(data.pageSize) && data.pageSize > 0 ? data.pageSize : 50;
  const seenEventTtlMs = Number.isFinite(data.seenEventTtlMs) && data.seenEventTtlMs > 0 ? data.seenEventTtlMs : 24 * 60 * 60 * 1000;

  let timer = null;
  let running = false;
  let sweepInFlight = false;

  function isEnabled() {
    return Boolean(
      relayChatId &&
      client &&
      client.im &&
      client.im.v1 &&
      client.im.v1.message &&
      typeof client.im.v1.message.list === "function" &&
      relayController &&
      fileTransfer &&
      typeof fileTransfer.parseMessageContent === "function" &&
      typeof fileTransfer.extractUserTextFromMessage === "function" &&
      typeof relayController.buildRelayEventFromListItem === "function" &&
      typeof relayController.isTargetedRelayMessage === "function" &&
      typeof relayController.handleRelayDataEvent === "function"
    );
  }

  async function loadRecentMessages() {
    const items = [];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const startSeconds = Math.max(0, nowSeconds - Math.ceil(lookbackMs / 1000));
    let pageToken = "";

    do {
      const response = await client.im.v1.message.list({
        params: {
          container_id_type: "chat_id",
          container_id: relayChatId,
          start_time: String(startSeconds),
          end_time: String(nowSeconds),
          sort_type: "ByCreateTimeAsc",
          page_size: pageSize,
          page_token: pageToken || undefined,
        },
      });

      const dataBlock = response?.data || {};
      const pageItems = Array.isArray(dataBlock.items) ? dataBlock.items : [];
      items.push(...pageItems);
      pageToken = dataBlock.has_more ? (dataBlock.page_token || "") : "";
    } while (pageToken);

    return items;
  }

  async function sweepOnce() {
    if (!isEnabled() || sweepInFlight) {
      return {
        ok: false,
        skipped: true,
      };
    }

    sweepInFlight = true;
    try {
      const items = await loadRecentMessages();
      let processed = 0;

      for (const item of items) {
        const senderType = typeof item?.sender?.sender_type === "string" ? item.sender.sender_type.trim().toLowerCase() : "";
        if (senderType !== "bot") {
          continue;
        }

        const messageType = typeof item?.msg_type === "string" && item.msg_type.trim() ? item.msg_type.trim() : "text";
        const contentObj = fileTransfer.parseMessageContent(item?.body?.content || "");
        const userText = fileTransfer.extractUserTextFromMessage(messageType, contentObj);
        if (!userText || !relayController.isTargetedRelayMessage(userText)) {
          continue;
        }

        const dataEvent = relayController.buildRelayEventFromListItem(item);

        // Re-hydrate the live event shape and feed it through the normal relay pipeline.
        // The shared handler marks the message/event ids, so later live delivery won't double-fire.
        // eslint-disable-next-line no-await-in-loop
        const handled = await relayController.handleRelayDataEvent(dataEvent, {
          source: "sweep",
          logReceipt: false,
          eventTtlMs: seenEventTtlMs,
        });
        if (handled) {
          processed += 1;
        }
      }

      return {
        ok: true,
        processed,
      };
    } catch (err) {
      if (console && typeof console.error === "function") {
        console.error("Relay sweep failed:", err.message);
      }
      return {
        ok: false,
        error: err,
      };
    } finally {
      sweepInFlight = false;
    }
  }

  function start() {
    if (!isEnabled() || running) {
      return false;
    }

    running = true;
    void sweepOnce();
    timer = setInterval(() => {
      void sweepOnce();
    }, intervalMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    return true;
  }

  function stop() {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    isEnabled,
    loadRecentMessages,
    sweepOnce,
    start,
    stop,
    get intervalMs() {
      return intervalMs;
    },
    get lookbackMs() {
      return lookbackMs;
    },
  };
}

module.exports = { createRelaySweeper };
