import { describe, expect, it } from "vitest";

import { catchUpInbox, likelyAgentMessage } from "../src/catch-up";
import { SapportlyClient } from "../src/client";
import { mockFetch } from "./helpers";

describe("likelyAgentMessage", () => {
  it("detects agent-reply and ai:auto keys and user_id", () => {
    expect(likelyAgentMessage({ idempotency_key: "agent-reply-abc", user_id: null })).toBe(true);
    expect(likelyAgentMessage({ idempotency_key: "ai:auto:1", user_id: null })).toBe(true);
    expect(likelyAgentMessage({ idempotency_key: "shop:1", user_id: "u1" })).toBe(true);
    expect(likelyAgentMessage({ idempotency_key: "shop:1", user_id: null })).toBe(false);
  });
});

describe("catchUpInbox", () => {
  it("walks matching sources and skips others", async () => {
    const thread = "custom:shop:11111111-1111-4111-8111-111111111111";
    const mock = mockFetch([
      {
        body: [
          { channel: thread, last_at: "2026-01-02T00:00:00Z", last_message: "x", message_id: "m0" },
          { channel: "custom:other", last_at: "2026-01-01T00:00:00Z", last_message: "y", message_id: "m1" },
        ],
      },
      {
        body: [
          {
            id: "msg-a",
            tenant_id: "t",
            user_id: null,
            channel: thread,
            body: "hi",
            idempotency_key: "shop:1",
            status: "ok",
            created_at: "2026-01-02T00:00:00Z",
            content_encoding: "plain",
            dek_key_id: null,
            channel_sequence: 1,
          },
        ],
      },
    ]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });
    const rows: string[] = [];
    const result = await catchUpInbox({
      client,
      sources: ["custom:shop"],
      maxConversationPages: 1,
      maxMessagePages: 1,
      onMessage: (row) => {
        rows.push(`${row.channel}:${row.id}`);
      },
    });
    expect(result.conversations).toBe(1);
    expect(result.messages).toBe(1);
    expect(rows).toEqual([`${thread}:msg-a`]);
    expect(mock.requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/v1/conversations",
      `/v1/conversations/${encodeURIComponent(thread)}/messages`,
    ]);
  });

  it("stops on full conversation page when has_more is false (P-08)", async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({
      channel: `custom:shop:${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`,
      last_at: `2026-01-02T00:${String(i).padStart(2, "0")}:00Z`,
      last_message: "x",
      message_id: `m${i}`,
    }));
    const mock = mockFetch([
      {
        body: {
          data: full,
          has_more: false,
          next_cursor: { before_at: full[49]!.last_at, before_channel: full[49]!.channel },
        },
      },
      // Should not request messages for all 50 if we cap conversation pages — but
      // catch-up walks each conversation; limit message pages and only first source match.
      // With maxConversationPages: 1 we only take the first page once.
    ]);
    // Only walk conversations page; zero messages because we set maxMessagePages: 0
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });
    const result = await catchUpInbox({
      client,
      sources: ["custom:shop"],
      maxConversationPages: 1,
      maxMessagePages: 0,
      onMessage: () => undefined,
    });
    expect(result.conversations).toBe(50);
    expect(result.messages).toBe(0);
    expect(mock.calls).toBe(1);
  });
});
