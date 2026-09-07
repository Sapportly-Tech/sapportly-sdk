/**
 * Live probes against api.sapportly.pro.
 * Skipped unless `SAPPORTLY_API_KEY` or legacy `SUPPORTLY_API_KEY` is set.
 * Never logs the key.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { SapportlyClient } from "../src/client";
import { SapportlyInbox } from "../src/inbox";
import { nodeWebSocketFactory } from "../src/wire";

const KEY =
  process.env.SAPPORTLY_API_KEY?.trim() ||
  process.env.SUPPORTLY_API_KEY?.trim() ||
  "";
const CHANNEL =
  process.env.SAPPORTLY_CHANNEL?.trim() ||
  process.env.SUPPORTLY_CHANNEL?.trim() ||
  "custom:test-cursor";

const describeLive = KEY ? describe : describe.skip;

describeLive("live public API", () => {
  const client = new SapportlyClient({ apiKey: KEY, timeoutMs: 20_000 });

  it("health / ready / status", async () => {
    const health = await client.health();
    expect(health.status).toBe("ok");
    const status = await client.status();
    expect(status.version).toBeTruthy();
  });

  it("ingest → list → reply on custom channel", async () => {
    const idem = `sdk-live-${randomUUID()}`;
    const accepted = await client.ingest.send({
      channel: CHANNEL,
      body: `sdk live ${idem}`,
      idempotency_key: idem,
    });
    expect(accepted.accepted).toBe(true);

    const replay = await client.ingest.send({
      channel: CHANNEL,
      body: `sdk live ${idem}`,
      idempotency_key: idem,
    });
    expect(replay.accepted).toBe(true);
    expect(replay.duplicate === true || replay.message_id != null).toBe(true);

    const skip = await client.ingest.send({
      channel: CHANNEL,
      body: "no ai please",
      skip_ai: true,
    });
    expect(skip.accepted).toBe(true);

    const convos = await client.conversations.list({ limit: 10 });
    expect(Array.isArray(convos)).toBe(true);

    const reply = await client.conversations.reply(CHANNEL, {
      body: `sdk live reply ${idem}`,
    });
    expect(reply.accepted).toBe(true);
    expect(reply.message_id).toBeTruthy();
  });

  it("attachments reject empty upload", async () => {
    await expect(
      client.attachments.upload({
        channel: CHANNEL,
        filename: "empty.txt",
        mimeType: "text/plain",
        content: new Uint8Array(),
      }),
    ).rejects.toThrow(/empty file/);
  });

  it("webhooks get + rag upload", async () => {
    const hooks = await client.webhooks.get();
    expect(hooks).toHaveProperty("enabled");

    const doc = await client.rag.upload({
      title: "sdk-live",
      body: "sdk live rag probe",
    });
    expect(doc.id).toBeTruthy();
  });

  it("inbox receives ingest over WS", async () => {
    let factory: ((url: string) => WebSocket) | undefined;
    try {
      factory = nodeWebSocketFactory();
    } catch {
      // Node 18/20 without a global WebSocket — skip rather than fail the suite.
      return;
    }

    const seen: string[] = [];
    const errors: unknown[] = [];
    const inbox = new SapportlyInbox(client, {
      WebSocket: factory,
      onError: (error) => errors.push(error),
    });
    inbox.onVisitor((m) => seen.push(m.body));
    inbox.onAgent((m) => seen.push(`agent:${m.body}`));
    inbox.onEvent((e) => seen.push(`event:${e.type}`));

    await inbox.connect();
    const idem = `sdk-live-ws-${randomUUID()}`;
    await client.ingest.send({
      channel: CHANNEL,
      body: `ws ${idem}`,
      idempotency_key: idem,
    });

    await vi.waitFor(() => {
      expect(seen.some((s) => s.includes(idem))).toBe(true);
    }, 15_000);
    inbox.close();
    expect(errors).toEqual([]);
  });
});
