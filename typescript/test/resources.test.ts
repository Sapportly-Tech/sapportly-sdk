import { describe, expect, it } from "vitest";

import {
  channelIdentifier,
  channelKey,
  channelNamespace,
  isWidgetVisitorChannel,
  visitorIdFromWidgetChannel,
  widgetChannel,
  WIDGET_REGISTRY_CHANNEL,
} from "../src/channels";
import { SapportlyClient } from "../src/client";
import { SapportlyError, SapportlyValidationError } from "../src/errors";
import { websocketUrl } from "../src/resources/realtime";
import { mockFetch } from "./helpers";

function client(mock: ReturnType<typeof mockFetch>) {
  return new SapportlyClient({ apiKey: "sk_live_test", fetch: mock.fetch, sleep: mock.sleep });
}

const VISITOR = "9d4c1e2a-5b6f-4c3d-8a1b-2e3f4a5b6c7d";

describe("channels resource", () => {
  it("lists with filters", async () => {
    const mock = mockFetch([{ body: [] }]);
    await client(mock).channels.list({ namespace: "custom", status: "archived", limit: 10 });

    const url = new URL(mock.requests[0]!.url);
    expect(url.pathname).toBe("/v1/channels");
    expect(url.searchParams.get("namespace")).toBe("custom");
    expect(url.searchParams.get("status")).toBe("archived");
    expect(url.searchParams.get("limit")).toBe("10");
  });

  it("creates, reads and updates a channel", async () => {
    const channel = { id: "ch_1", slug: "orders", namespace: "custom" };
    const mock = mockFetch([{ status: 201, body: channel }, { body: channel }, { body: channel }]);
    const c = client(mock);

    await c.channels.create({ slug: "orders", namespace: "custom", display_name: "Orders" });
    await c.channels.get("ch_1");
    await c.channels.update("ch_1", { display_name: "Orders v2" });

    expect(mock.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /v1/channels",
      "GET /v1/channels/ch_1",
      "PATCH /v1/channels/ch_1",
    ]);
  });
});

describe("attachments upload flow", () => {
  const intent = {
    attachment_id: "att_1",
    upload_url: "https://s3.example.test/bucket/att_1?sig=abc",
    headers: { "content-type": "application/pdf" },
    expires_in: 900,
  };
  const ready = { attachment: { id: "att_1", status: "ready", filename: "invoice.pdf" } };

  it("runs intent, presigned PUT and complete in order", async () => {
    const mock = mockFetch([{ body: intent }, { status: 200 }, { body: ready }]);
    const content = new Uint8Array([1, 2, 3, 4]);

    const attachment = await client(mock).attachments.upload({
      channel: "custom:orders",
      filename: "invoice.pdf",
      mimeType: "application/pdf",
      content,
    });

    expect(attachment.id).toBe("att_1");
    expect(mock.requests.map((r) => r.method)).toEqual(["POST", "PUT", "POST"]);
    expect(mock.requests[0]?.body).toMatchObject({
      filename: "invoice.pdf",
      mime_type: "application/pdf",
      size_bytes: 4,
      channel: "custom:orders",
    });
    expect(mock.requests[1]?.url).toBe(intent.upload_url);
    expect(mock.requests[1]?.headers["content-type"]).toBe("application/pdf");
  });

  it("does not send the API key to S3", async () => {
    const mock = mockFetch([{ body: intent }, { status: 200 }, { body: ready }]);
    await client(mock).attachments.upload({
      channel: "custom:orders",
      filename: "f.pdf",
      mimeType: "application/pdf",
      content: new Uint8Array([1]),
    });

    expect(mock.requests[1]?.headers.authorization).toBeUndefined();
  });

  it("rejects an empty file before making any request", async () => {
    const mock = mockFetch([{ body: intent }]);
    await expect(
      client(mock).attachments.upload({
        channel: "custom:orders",
        filename: "empty.txt",
        mimeType: "text/plain",
        content: new Uint8Array(),
      }),
    ).rejects.toBeInstanceOf(SapportlyValidationError);

    expect(mock.calls).toBe(0);
  });

  it("stops without completing when the presigned PUT fails", async () => {
    const mock = mockFetch([{ body: intent }, { status: 403, body: "AccessDenied" }]);
    await expect(
      client(mock).attachments.upload({
        channel: "custom:orders",
        filename: "f.pdf",
        mimeType: "application/pdf",
        content: new Uint8Array([1]),
      }),
    ).rejects.toBeInstanceOf(SapportlyError);

    expect(mock.calls).toBe(2);
  });

  it("does not retry the intent call, which would leak a pending row", async () => {
    const mock = mockFetch([{ status: 503, body: { error: "unavailable" } }]);
    await expect(
      client(mock).attachments.createUploadIntent({
        filename: "f.pdf",
        mime_type: "application/pdf",
        size_bytes: 10,
        channel: "custom:orders",
      }),
    ).rejects.toThrow();

    expect(mock.calls).toBe(1);
  });
});

describe("widget resource", () => {
  it("uses the API key for embed sessions", async () => {
    const mock = mockFetch([{ body: { token: "vt_1", visitor_id: VISITOR } }]);
    await client(mock).widget.createEmbedSession({ visitor_id: VISITOR });

    expect(mock.requests[0]?.headers.authorization).toBe("Bearer sk_live_test");
    expect(mock.requests[0]?.headers["x-visitor-token"]).toBeUndefined();
  });

  it("uses the visitor token, not the API key, for visitor calls", async () => {
    const mock = mockFetch([{ status: 202, body: { accepted: true } }]);
    await client(mock).widget.sendMessage("vt_1", { visitor_id: VISITOR, body: "hello" });

    expect(mock.requests[0]?.headers["x-visitor-token"]).toBe("vt_1");
    expect(mock.requests[0]?.headers.authorization).toBeUndefined();
  });

  it("works without an API key at all for visitor calls", async () => {
    const mock = mockFetch([{ body: [] }]);
    const anonymous = new SapportlyClient({ fetch: mock.fetch });

    await expect(
      anonymous.widget.history("vt_1", { visitor_id: VISITOR }),
    ).resolves.toEqual([]);
  });

  it("only retries embed-session issuance when the visitor is pinned", async () => {
    const failing = mockFetch([{ status: 503, body: { error: "unavailable" } }]);
    await client(failing).widget.createEmbedSession({}).catch(() => undefined);
    expect(failing.calls).toBe(1);

    const pinned = mockFetch([
      { status: 503, body: { error: "unavailable" } },
      { body: { token: "vt_1" } },
    ]);
    await client(pinned).widget.createEmbedSession({ visitor_id: VISITOR });
    expect(pinned.calls).toBe(2);
  });
});

describe("analytics and team", () => {
  it("tracks a custom metric", async () => {
    const mock = mockFetch([{ status: 202, body: { accepted: true } }]);
    await client(mock).analytics.track({ metric_key: "csat", value: 4.5 });

    expect(new URL(mock.requests[0]!.url).pathname).toBe("/v1/analytics/track");
    expect(mock.requests[0]?.body).toMatchObject({ metric_key: "csat", value: 4.5 });
  });

  it("defaults a tracked value to 1 so counters can be incremented bare", async () => {
    const mock = mockFetch([{ status: 202, body: { accepted: true } }]);
    await client(mock).analytics.track({ metric_key: "signups" });
    expect(mock.requests[0]?.body).toMatchObject({ metric_key: "signups", value: 1 });
  });

  it("lists team roles", async () => {
    const mock = mockFetch([{ body: [{ id: "r1", name: "Support" }] }]);
    await expect(client(mock).team.listRoles()).resolves.toHaveLength(1);
    expect(new URL(mock.requests[0]!.url).pathname).toBe("/v1/team/roles");
  });
});

describe("webhooks and rag", () => {
  it("reads and updates webhook config", async () => {
    const cfg = { url: "https://example.test/hook", enabled: true, event_types: ["message.received"] };
    const mock = mockFetch([{ body: cfg }, { body: cfg }]);
    const c = client(mock);
    await c.webhooks.get();
    await c.webhooks.update({ enabled: true, event_types: ["message.received"], url: cfg.url });
    expect(mock.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/webhooks",
      "PUT /v1/webhooks",
    ]);
  });

  it("uploads a rag document as JSON", async () => {
    const mock = mockFetch([{ body: { id: "doc_1", title: "FAQ", status: "indexing", chunk_count: 0 } }]);
    await client(mock).rag.upload({ title: "FAQ", body: "# FAQ" });
    expect(new URL(mock.requests[0]!.url).pathname).toBe("/v1/rag/documents");
    expect(mock.requests[0]?.headers["content-type"]).toBe("application/json");
    expect(mock.requests[0]?.body).toEqual({ title: "FAQ", body: "# FAQ" });
  });

  it("lists and upserts contacts", async () => {
    const row = { channel: "custom:shop", email: "ada@example.com", phone: null, external_id: "ord_1", updated_at: "2026-08-19T00:00:00Z" };
    const mock = mockFetch([{ body: [row] }, { body: row }, { body: row }]);
    const c = client(mock);
    await expect(c.contacts.list()).resolves.toHaveLength(1);
    await c.contacts.get("custom:shop");
    await c.contacts.upsert("custom:shop", { email: "ada@example.com" });
    expect(mock.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "GET /v1/contacts",
      "GET /v1/contacts/custom%3Ashop",
      "PUT /v1/contacts/custom%3Ashop",
    ]);
  });
});

describe("realtime tickets", () => {
  it("mints a ticket and builds a connect URL", async () => {
    const mock = mockFetch([
      { body: { ticket: "tk_1", ws_url: "wss://ws.sapportly.pro/ws", expires_in_secs: 60 } },
    ]);

    const { ticket, ws_url } = await client(mock).realtime.createTicket();
    expect(new URL(mock.requests[0]!.url).pathname).toBe("/v1/ws/ticket");
    expect(websocketUrl(ws_url, ticket)).toBe("wss://ws.sapportly.pro/ws?ticket=tk_1");
  });

  it("appends the ticket to a URL that already has a query", () => {
    expect(websocketUrl("wss://ws.test/ws?v=2", "tk 1")).toBe("wss://ws.test/ws?v=2&ticket=tk%201");
  });
});

describe("channel key helpers", () => {
  it("builds and recognises visitor channels", () => {
    expect(widgetChannel(VISITOR)).toBe(`widget:${VISITOR}`);
    expect(isWidgetVisitorChannel(`widget:${VISITOR}`)).toBe(true);
    expect(visitorIdFromWidgetChannel(`widget:${VISITOR}`)).toBe(VISITOR);
  });

  it("does not mistake the registry channel for a visitor channel", () => {
    expect(isWidgetVisitorChannel(WIDGET_REGISTRY_CHANNEL)).toBe(false);
    expect(visitorIdFromWidgetChannel(WIDGET_REGISTRY_CHANNEL)).toBeNull();
  });

  it("extracts the namespace and identifier", () => {
    expect(channelKey("custom", "telegram")).toBe("custom:telegram");
    expect(channelNamespace("telegram:shop")).toBe("telegram");
    expect(channelIdentifier("custom:telegram")).toBe("telegram");
    expect(channelNamespace("custom:orders")).toBe("custom");
    expect(channelNamespace("nonsense")).toBeNull();
    expect(channelIdentifier("nonsense")).toBeNull();
  });
});
