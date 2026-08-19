/**
 * Live probes against api.supportly.cc. Skipped unless SUPPORTLY_API_KEY is set.
 * Never logs the key.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { SupportlyClient } from "../src/client";
import { SupportlyInbox } from "../src/inbox";
import { nodeWebSocketFactory } from "../src/wire";

const KEY = process.env.SUPPORTLY_API_KEY?.trim() ?? "";
const CHANNEL = process.env.SUPPORTLY_CHANNEL?.trim() || "custom:test-cursor";

const describeLive = KEY ? describe : describe.skip;

describeLive("live public API", () => {
  const client = new SupportlyClient({ apiKey: KEY, timeoutMs: 20_000 });

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
    } catch (error) {
      expect(error).toBeUndefined();
      return;
    }

    const seen: string[] = [];
    const errors: unknown[] = [];
    const inbox = new SupportlyInbox(client, {
      WebSocket: factory,
      onError: (error) => errors.push(error),
    });
    inbox.onVisitor((m) => seen.push(m.body));
    inbox.onAgent((m) => seen.push(`agent:${m.body}`));
    inbox.onEvent((e) => seen.push(`event:${e.type}`));

    await inbox.connect();
    expect(inbox.state).toBe("open");
    const marker = `sdk-ws-${randomUUID()}`;
    await client.ingest.send({ channel: CHANNEL, body: marker, skip_ai: true });

    const deadline = Date.now() + 16_000;
    while (Date.now() < deadline && !seen.some((b) => b.startsWith("event:message.delivered"))) {
      await new Promise((r) => setTimeout(r, 250));
    }
    inbox.close();
    expect(errors, String(errors[0])).toEqual([]);
    expect(
      seen.some((b) => b.startsWith("event:message.delivered")),
      seen.join(" | ").slice(0, 200),
    ).toBe(true);
  }, 25_000);
});
