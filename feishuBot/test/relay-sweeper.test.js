const assert = require("node:assert/strict");
const test = require("node:test");

const { createRelaySweeper } = require("../src/backend/lib/relay-sweeper.js");

test("relay sweeper backfills a targeted bot message once", async () => {
  const handled = [];
  const seen = new Set();

  const sweeper = createRelaySweeper({
    data: {
      relayChatId: "chat-relay",
      intervalMs: 1000,
      lookbackMs: 60_000,
      seenEventTtlMs: 60_000,
    },
    deps: {
      client: {
        im: {
          v1: {
            message: {
              list: async () => ({
                data: {
                  has_more: false,
                  items: [
                    {
                      message_id: "msg-1",
                      chat_id: "chat-relay",
                      msg_type: "text",
                      body: { content: JSON.stringify({ text: "@bot-peer: ping" }) },
                      sender: { id: "ou_bot", id_type: "open_id", sender_type: "bot" },
                    },
                  ],
                },
              }),
            },
          },
        },
      },
      stateStore: {
        markRecentEventKey(eventKey) {
          if (seen.has(eventKey)) {
            return true;
          }

          seen.add(eventKey);
          return false;
        },
      },
      fileTransfer: {
        parseMessageContent(content) {
          return JSON.parse(content);
        },
        extractUserTextFromMessage(messageType, contentObj) {
          return messageType === "text" ? (contentObj.text || "") : "";
        },
      },
      relayController: {
        buildRelayEventFromListItem(item) {
          return {
            event_id: `sweep:${item.message_id}`,
            message: {
              chat_id: item.chat_id,
              message_id: item.message_id,
              message_type: item.msg_type,
              content: item.body.content,
            },
            sender: {
              sender_type: item.sender.sender_type,
              sender_id: { open_id: item.sender.id },
            },
          };
        },
        isTargetedRelayMessage(text) {
          return /^@.+?:\s+.+$/.test(text);
        },
        async handleRelayDataEvent(dataEvent, options = {}) {
          if (seen.has(dataEvent.message.message_id)) {
            return false;
          }

          seen.add(dataEvent.message.message_id);
          handled.push({ dataEvent, options });
          return true;
        },
      },
      console: {
        error() {},
      },
    },
  });

  const first = await sweeper.sweepOnce();
  const second = await sweeper.sweepOnce();

  assert.equal(first.ok, true);
  assert.equal(first.processed, 1);
  assert.equal(second.ok, true);
  assert.equal(second.processed, 0);
  assert.equal(handled.length, 1);
  assert.equal(handled[0].dataEvent.message.message_id, "msg-1");
  assert.equal(handled[0].options.source, "sweep");
});
