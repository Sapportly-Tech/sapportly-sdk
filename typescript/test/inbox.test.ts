import { describe, expect, it, vi } from "vitest";

import { SapportlyClient } from "../src/client";
import { ExternalMessageSeenStore } from "../src/dedup";
import { SapportlyInbox } from "../src/inbox";
import { classifyWireEvent, isAgentReply, isVisitorMessage, parseWireEvent } from "../src/wire";
import type { WsTicketResponse } from "../src/types";
import { SapportlyRealtime, type WebSocketLike } from "../src/realtime";

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  emit(data: unknown): void {
    this.onmessage?.({ data });
  }
  close(): void {
    this.readyState = 3;
  }
  send(data: string): void {
    this.sent.push(data);
  }
}

describe("parseWireEvent", () => {
  it("reads v2 frames and nested payload", () => {
    const frame = parseWireEvent(
      JSON.stringify({
        v: 2,
        type: "message.delivered",
        event_id: "e1",
        payload: { type: "message.delivered", channel: "custom:shop", body: "hi", role: "visitor" },
      }),
    );
    expect(frame?.type).toBe("message.delivered");
    const classified = classifyWireEvent(frame!);
    expect(classified.kind).toBe("message");
    expect(classified.channel).toBe("custom:shop");
    expect(classified.message?.body).toBe("hi");
  });

  it("classifies ai.draft", () => {
    const frame = parseWireEvent({
      type: "ai.draft",
      payload: { type: "ai.draft", draft_body: "ok", partial: true, channel: "custom:shop" },
    });
    expect(classifyWireEvent(frame!).kind).toBe("ai.draft");
  });

  it("returns null for garbage", () => {
    expect(parseWireEvent("not json")).toBeNull();
    expect(parseWireEvent({ hello: 1 })).toBeNull();
  });
});

describe("SapportlyInbox", () => {
  it("splits visitor / agent / ai and replies via conversations", async () => {
    FakeSocket.instances = [];
    const replies: unknown[] = [];
    const client = new SapportlyClient({
      baseUrl: "https://api.test",
      apiKey: "sk_live_test",
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/v1/ws/ticket")) {
          const body: WsTicketResponse = {
            ticket: "tk",
            ws_url: "wss://ws.test/ws",
            expires_in_secs: 60,
          };
          return new Response(JSON.stringify(body), { status: 200 });
        }
        if (url.includes("/v1/conversations/") && init?.method === "POST") {
          replies.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ accepted: true, message_id: "m-reply" }), {
            status: 200,
          });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const visitors: string[] = [];
    const agents: Array<{ body: string; echo: boolean }> = [];
    const drafts: string[] = [];

    const inbox = new SapportlyInbox(client, {
      WebSocket: (url) => new FakeSocket(url),
    });
    inbox.onVisitor((m) => visitors.push(m.body));
    inbox.onAgent((m) => agents.push({ body: m.body, echo: m.echo }));
    inbox.onAi((d) => drafts.push(d.draft_body ?? ""));

    const pending = inbox.connect();
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    FakeSocket.instances[0]!.open();
    await pending;

    const sock = FakeSocket.instances[0]!;
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "1",
        payload: { role: "visitor", channel: "custom:shop", body: "from user", message_id: "m1" },
      }),
    );
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "2",
        payload: { role: "agent", channel: "custom:shop", body: "from ops", message_id: "m2" },
      }),
    );
    sock.emit(
      JSON.stringify({
        type: "ai.draft",
        event_id: "3",
        payload: { draft_body: "ai text", partial: false, message_id: "m1", channel: "custom:shop" },
      }),
    );

    await vi.waitFor(() => {
      expect(visitors).toEqual(["from user"]);
      expect(agents).toEqual([{ body: "from ops", echo: false }]);
      expect(drafts).toEqual(["ai text"]);
    });

    await inbox.reply("custom:shop", "pong");
    expect(replies).toEqual([
      { body: "pong", idempotency_key: expect.stringMatching(/^agent-reply-/), attachment_ids: [] },
    ]);

    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "4",
        payload: {
          role: "agent",
          channel: "custom:shop",
          body: "pong",
          message_id: "m-reply",
        },
      }),
    );
    await vi.waitFor(() =>
      expect(agents).toEqual([
        { body: "from ops", echo: false },
        { body: "pong", echo: true },
      ]),
    );
    inbox.close();
  });

  it("treats assistant as agent and does not send system to onVisitor", async () => {
    FakeSocket.instances = [];
    const client = new SapportlyClient({
      baseUrl: "https://api.test",
      apiKey: "sk_live_test",
      fetch: async (input) => {
        if (String(input).endsWith("/v1/ws/ticket")) {
          const body: WsTicketResponse = {
            ticket: "tk",
            ws_url: "wss://ws.test/ws",
            expires_in_secs: 60,
          };
          return new Response(JSON.stringify(body), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const visitors: string[] = [];
    const agents: string[] = [];
    const other: string[] = [];
    const inbox = new SapportlyInbox(client, {
      WebSocket: (url) => new FakeSocket(url),
    });
    inbox.onVisitor((m) => visitors.push(m.body));
    inbox.onAgent((m) => agents.push(m.body));
    inbox.onEvent((e) => other.push(e.message?.role ?? e.type));

    const pending = inbox.connect();
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    FakeSocket.instances[0]!.open();
    await pending;

    const sock = FakeSocket.instances[0]!;
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "a",
        payload: { role: "assistant", channel: "custom:shop", body: "llm", message_id: "m-ai" },
      }),
    );
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "s",
        payload: { role: "system", channel: "custom:shop", body: "note", message_id: "m-sys" },
      }),
    );

    await vi.waitFor(() => {
      expect(agents).toEqual(["llm"]);
      expect(visitors).toEqual([]);
      expect(other).toEqual(["assistant", "system"]);
    });
    inbox.close();
  });

  it("does not let ai.draft occupy the visitor message_id in the deduper", async () => {
    FakeSocket.instances = [];
    const client = new SapportlyClient({
      baseUrl: "https://api.test",
      apiKey: "sk_live_test",
      fetch: async (input) => {
        if (String(input).endsWith("/v1/ws/ticket")) {
          const body: WsTicketResponse = {
            ticket: "tk",
            ws_url: "wss://ws.test/ws",
            expires_in_secs: 60,
          };
          return new Response(JSON.stringify(body), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });

    const visitors: string[] = [];
    const drafts: string[] = [];
    const inbox = new SapportlyInbox(client, {
      WebSocket: (url) => new FakeSocket(url),
    });
    inbox.onVisitor((m) => visitors.push(m.body));
    inbox.onAi((d) => drafts.push(d.draft_body ?? ""));

    const pending = inbox.connect();
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    FakeSocket.instances[0]!.open();
    await pending;

    const sock = FakeSocket.instances[0]!;
    sock.emit(
      JSON.stringify({
        type: "ai.draft",
        event_id: "d0",
        payload: {
          draft_body: "soon",
          partial: true,
          message_id: "m-in",
          channel: "custom:shop",
        },
      }),
    );
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "v0",
        payload: { role: "visitor", channel: "custom:shop", body: "hi", message_id: "m-in" },
      }),
    );

    await vi.waitFor(() => {
      expect(drafts).toEqual(["soon"]);
      expect(visitors).toEqual(["hi"]);
    });
    inbox.close();
  });
});

describe("role helpers", () => {
  it("maps assistant to agent and system to neither", () => {
    const assistant = classifyWireEvent(
      parseWireEvent({
        type: "message.delivered",
        payload: { role: "assistant", channel: "custom:shop" },
      })!,
    );
    const system = classifyWireEvent(
      parseWireEvent({
        type: "message.delivered",
        payload: { role: "system", channel: "custom:shop" },
      })!,
    );
    expect(isAgentReply(assistant)).toBe(true);
    expect(isVisitorMessage(assistant)).toBe(false);
    expect(isAgentReply(system)).toBe(false);
    expect(isVisitorMessage(system)).toBe(false);
  });
});

describe("SapportlyRealtime events()", () => {
  it("yields classified frames", async () => {
    FakeSocket.instances = [];
    const tickets = {
      createTicket: async () =>
        ({ ticket: "tk", ws_url: "wss://ws.test/ws", expires_in_secs: 60 }) satisfies WsTicketResponse,
    };
    const rt = new SapportlyRealtime({
      tickets,
      WebSocket: (url) => new FakeSocket(url),
    });
    const pending = rt.connect();
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    FakeSocket.instances[0]!.open();
    await pending;

    const iter = rt.events();
    const first = iter.next();
    FakeSocket.instances[0]!.emit(
      JSON.stringify({ type: "message.delivered", event_id: "x", payload: { body: "z" } }),
    );
    const got = await first;
    expect(got.value?.type).toBe("message.delivered");
    rt.close();
    await iter.next();
  });
});

describe("SapportlyInbox panel / filter / external store", () => {
  async function openInbox(
    client: SapportlyClient,
    options: ConstructorParameters<typeof SapportlyInbox>[1] = {},
  ) {
    FakeSocket.instances = [];
    const inbox = new SapportlyInbox(client, {
      WebSocket: (url) => new FakeSocket(url),
      ...options,
    });
    const pending = inbox.connect();
    await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(1));
    FakeSocket.instances[0]!.open();
    await pending;
    return { inbox, sock: FakeSocket.instances[0]! };
  }

  function ticketClient() {
    return new SapportlyClient({
      baseUrl: "https://api.test",
      apiKey: "sk_live_test",
      fetch: async (input) => {
        if (String(input).endsWith("/v1/ws/ticket")) {
          const body: WsTicketResponse = {
            ticket: "tk",
            ws_url: "wss://ws.test/ws",
            expires_in_secs: 60,
          };
          return new Response(JSON.stringify(body), { status: 200 });
        }
        return new Response("{}", { status: 500 });
      },
    });
  }

  it("marks panel operator replies as onAgent with echo false", async () => {
    const agents: Array<{ body: string; echo: boolean; externalId: string | null }> = [];
    const { inbox, sock } = await openInbox(ticketClient());
    inbox.onAgent((m) => agents.push({ body: m.body, echo: m.echo, externalId: m.externalId }));

    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "p1",
        payload: {
          role: "agent",
          channel: "custom:shop:11111111-1111-4111-8111-111111111111",
          body: "из панели",
          message_id: "m-panel",
          external_id: "crm-42",
          source_channel: "custom:shop",
          thread_id: "11111111-1111-4111-8111-111111111111",
        },
      }),
    );
    await vi.waitFor(() => expect(agents).toHaveLength(1));
    expect(agents[0]).toEqual({ body: "из панели", echo: false, externalId: "crm-42" });
    inbox.close();
  });

  it("lets custom:shop filter pass threads and drop other sources", async () => {
    const bodies: string[] = [];
    const { inbox, sock } = await openInbox(ticketClient(), { channels: ["custom:shop"] });
    inbox.onAgent((m) => bodies.push(m.body));
    inbox.onVisitor((m) => bodies.push(m.body));

    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "t1",
        payload: {
          role: "visitor",
          channel: "custom:shop:11111111-1111-4111-8111-111111111111",
          body: "thread-ok",
          message_id: "m-t",
        },
      }),
    );
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "o1",
        payload: {
          role: "agent",
          channel: "custom:other",
          body: "other-skip",
          message_id: "m-o",
        },
      }),
    );
    await vi.waitFor(() => expect(bodies).toEqual(["thread-ok"]));
    inbox.close();
  });

  it("uses an async ExternalMessageSeenStore for claim", async () => {
    const claimed = new Set<string>();
    const store = new ExternalMessageSeenStore({
      async tryClaim(id) {
        if (claimed.has(id)) return true;
        claimed.add(id);
        return false;
      },
    });
    const visitors: string[] = [];
    const { inbox, sock } = await openInbox(ticketClient(), { dedup: store });
    inbox.onVisitor((m) => visitors.push(m.body));

    const frame = JSON.stringify({
      type: "message.delivered",
      event_id: "d1",
      payload: { role: "visitor", channel: "custom:shop", body: "once", message_id: "m-dup" },
    });
    sock.emit(frame);
    sock.emit(frame);
    await vi.waitFor(() => expect(visitors).toEqual(["once"]));
    inbox.close();
  });

  it("awaits claim and serializes concurrent dual delivery (P-09 adversarial)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const claimed = new Set<string>();
    const store = new ExternalMessageSeenStore({
      async tryClaim(id) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        const dup = claimed.has(id);
        if (!dup) claimed.add(id);
        inFlight -= 1;
        return dup;
      },
    });
    const visitors: string[] = [];
    const { inbox, sock } = await openInbox(ticketClient(), { dedup: store });
    inbox.onVisitor((m) => visitors.push(m.body));

    const frame = JSON.stringify({
      type: "message.delivered",
      event_id: "race",
      payload: { role: "visitor", channel: "custom:shop", body: "once", message_id: "m-race" },
    });
    sock.emit(frame);
    sock.emit(frame);
    sock.emit(frame);
    await vi.waitFor(() => expect(visitors).toEqual(["once"]));
    // Without a per-id queue, slow tryClaim would overlap (maxInFlight > 1).
    expect(maxInFlight).toBe(1);
    inbox.close();
  });

  it("routes handler errors after claim to onError without double-emit (audit)", async () => {
    const errors: unknown[] = [];
    const visitors: string[] = [];
    const { inbox, sock } = await openInbox(ticketClient(), {
      onError: (e) => errors.push(e),
    });
    inbox.onVisitor((m) => {
      visitors.push(m.body);
      throw new Error("handler boom");
    });

    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "boom",
        payload: { role: "visitor", channel: "custom:shop", body: "x", message_id: "m-boom" },
      }),
    );
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "boom2",
        payload: { role: "visitor", channel: "custom:shop", body: "x", message_id: "m-boom" },
      }),
    );

    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1));
    expect(visitors).toEqual(["x"]);
    expect(String(errors[0])).toMatch(/handler boom/);
    inbox.close();
  });

  it("skips frames without message_id when dedup is on (fail closed)", async () => {
    const errors: unknown[] = [];
    const visitors: string[] = [];
    const { inbox, sock } = await openInbox(ticketClient(), {
      onError: (e) => errors.push(e),
    });
    inbox.onVisitor((m) => visitors.push(m.body));
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "noid",
        payload: { role: "visitor", channel: "custom:shop", body: "ghost" },
      }),
    );
    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1));
    expect(visitors).toEqual([]);
    expect(String(errors[0])).toMatch(/missing message_id/);
    inbox.close();
  });

  it("awaits async onVisitor and surfaces reject via onError", async () => {
    const errors: unknown[] = [];
    const { inbox, sock } = await openInbox(ticketClient(), {
      onError: (e) => errors.push(e),
    });
    inbox.onVisitor(async () => {
      await Promise.resolve();
      throw new Error("async boom");
    });
    sock.emit(
      JSON.stringify({
        type: "message.delivered",
        event_id: "async",
        payload: {
          role: "visitor",
          channel: "custom:shop",
          body: "x",
          message_id: "m-async",
        },
      }),
    );
    await vi.waitFor(() => expect(errors.length).toBeGreaterThanOrEqual(1));
    expect(String(errors[0])).toMatch(/async boom/);
    inbox.close();
  });

  it("releaseOnHandlerError unclaims so dual-delivery can retry (opt-in)", async () => {
    const errors: unknown[] = [];
    const visitors: string[] = [];
    const { inbox, sock } = await openInbox(ticketClient(), {
      releaseOnHandlerError: true,
      onError: (e) => errors.push(e),
    });
    let boomOnce = true;
    inbox.onVisitor((m) => {
      visitors.push(m.body);
      if (boomOnce) {
        boomOnce = false;
        throw new Error("transient boom");
      }
    });

    const frame = JSON.stringify({
      type: "message.delivered",
      event_id: "retry",
      payload: {
        role: "visitor",
        channel: "custom:shop",
        body: "retry-me",
        message_id: "m-retry",
      },
    });
    sock.emit(frame);
    sock.emit(frame);

    await vi.waitFor(() => expect(visitors).toEqual(["retry-me", "retry-me"]));
    expect(String(errors[0])).toMatch(/transient boom/);
    inbox.close();
  });
});

