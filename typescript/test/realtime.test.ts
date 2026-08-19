import { describe, expect, it, vi } from "vitest";

import { type RealtimeOptions, SupportlyRealtime, type WebSocketLike } from "../src/realtime";
import type { WsTicketResponse } from "../src/types";

/** Minimal scriptable `WebSocket`, so tests drive the lifecycle by hand. */
class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  closed?: { code?: number; reason?: string };

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

  fail(error: unknown = new Error("socket error")): void {
    this.onerror?.(error);
  }

  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.closed = { code, reason };
  }

  send(data: string): void {
    this.sent.push(data);
  }
}

function ticketStub(): { createTicket: () => Promise<WsTicketResponse>; calls: number } {
  const stub = {
    calls: 0,
    createTicket: async () => {
      stub.calls += 1;
      return {
        ticket: `tk_${stub.calls}`,
        ws_url: "wss://ws.test/ws",
        expires_in_secs: 60,
      } satisfies WsTicketResponse;
    },
  };
  return stub;
}

function setup(overrides: Partial<RealtimeOptions> = {}) {
  FakeSocket.instances = [];
  const tickets = ticketStub();
  const events: unknown[] = [];
  const states: string[] = [];

  const realtime = new SupportlyRealtime({
    tickets,
    WebSocket: (url) => new FakeSocket(url),
    onEvent: (event) => events.push(event),
    onStateChange: (state) => states.push(state),
    ...overrides,
  });

  return { realtime, tickets, events, states };
}

/** Opens the socket created by a pending `connect()`. */
async function openLatest(pending: Promise<void>): Promise<FakeSocket> {
  await vi.waitFor(() => expect(FakeSocket.instances.length).toBeGreaterThan(0));
  const socket = FakeSocket.instances[FakeSocket.instances.length - 1]!;
  socket.open();
  await pending;
  return socket;
}

describe("SupportlyRealtime", () => {
  it("mints a ticket and connects with it in the query string", async () => {
    const { realtime, tickets } = setup();
    const socket = await openLatest(realtime.connect());

    expect(tickets.calls).toBe(1);
    expect(socket.url).toBe("wss://ws.test/ws?ticket=tk_1");
    expect(realtime.state).toBe("open");
  });

  it("parses wire events and forwards them", async () => {
    const { realtime, events } = setup();
    const socket = await openLatest(realtime.connect());

    socket.emit(JSON.stringify({ v: 2, type: "message.delivered", event_id: "e1", payload: { type: "message.delivered", body: "hi" } }));
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe("message.delivered");
  });

  it("accepts frames that omit event_id", async () => {
    const { realtime, events } = setup();
    const socket = await openLatest(realtime.connect());
    socket.emit(JSON.stringify({ type: "message.delivered", payload: { channel: "custom:x" } }));
    expect(events).toHaveLength(1);
  });

  it("routes malformed frames to onRaw instead of throwing", async () => {
    const raw: unknown[] = [];
    const { realtime } = setup({ onRaw: (data: unknown) => raw.push(data) });
    const socket = await openLatest(realtime.connect());

    socket.emit("not json at all");
    socket.emit(JSON.stringify({ hello: "world" }));
    socket.emit(new Uint8Array([1, 2]));

    expect(raw).toHaveLength(3);
  });

  it("mints a fresh ticket on reconnect, because tickets are single-use", async () => {
    const { realtime, tickets } = setup({ initialReconnectDelayMs: 1 });
    const first = await openLatest(realtime.connect());

    first.drop();

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    const second = FakeSocket.instances[1]!;
    expect(tickets.calls).toBe(2);
    expect(second.url).toBe("wss://ws.test/ws?ticket=tk_2");
  });

  it("reports reconnecting then open across a drop", async () => {
    const { realtime, states } = setup({ initialReconnectDelayMs: 1 });
    const first = await openLatest(realtime.connect());
    first.drop();

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    FakeSocket.instances[1]!.open();

    await vi.waitFor(() => expect(realtime.state).toBe("open"));
    expect(states).toEqual(["connecting", "open", "reconnecting", "open"]);
  });

  it("does not reconnect when the caller closes", async () => {
    const { realtime } = setup({ initialReconnectDelayMs: 1 });
    const socket = await openLatest(realtime.connect());

    realtime.close();
    socket.drop();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeSocket.instances).toHaveLength(1);
    expect(realtime.state).toBe("closed");
  });

  it("does not reconnect when reconnect is disabled", async () => {
    const { realtime } = setup({ reconnect: false });
    const socket = await openLatest(realtime.connect());
    socket.drop();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(FakeSocket.instances).toHaveLength(1);
    expect(realtime.state).toBe("closed");
  });

  it("gives up after maxReconnectAttempts", async () => {
    const errors: unknown[] = [];
    const { realtime } = setup({
      initialReconnectDelayMs: 1,
      maxReconnectAttempts: 2,
      onError: (error: unknown) => errors.push(error),
    });

    const socket = await openLatest(realtime.connect());
    socket.drop();

    // Every replacement socket dies before opening, so the budget is spent.
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    FakeSocket.instances[1]!.drop();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(3));
    FakeSocket.instances[2]!.drop();

    await vi.waitFor(() => expect(realtime.state).toBe("closed"));
    expect(errors.some((e) => String(e).includes("gave up"))).toBe(true);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it("resets the attempt budget after a successful reconnect", async () => {
    // A flaky link that keeps recovering must not exhaust a finite budget.
    const { realtime } = setup({ initialReconnectDelayMs: 1, maxReconnectAttempts: 1 });
    let socket = await openLatest(realtime.connect());

    for (let i = 0; i < 3; i++) {
      socket.drop();
      await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(i + 2));
      socket = FakeSocket.instances[i + 1]!;
      socket.open();
    }

    expect(realtime.state).toBe("open");
  });

  it("recovers when a reconnect socket dies before opening", async () => {
    const { realtime } = setup({ initialReconnectDelayMs: 1 });
    const first = await openLatest(realtime.connect());

    first.drop();
    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(2));
    FakeSocket.instances[1]!.drop();

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(3));
    FakeSocket.instances[2]!.open();
    await vi.waitFor(() => expect(realtime.state).toBe("open"));
  });

  it("rejects connect() when the first socket errors", async () => {
    const { realtime } = setup();
    const pending = realtime.connect();

    await vi.waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    FakeSocket.instances[0]!.fail(new Error("handshake refused"));

    await expect(pending).rejects.toThrow("handshake refused");
  });

  it("propagates a ticket failure to the caller", async () => {
    const realtime = new SupportlyRealtime({
      tickets: { createTicket: async () => Promise.reject(new Error("403 missing ws:connect")) },
      WebSocket: (url) => new FakeSocket(url),
    });

    await expect(realtime.connect()).rejects.toThrow("ws:connect");
  });

  it("refuses to send while the socket is not open", async () => {
    const { realtime } = setup();
    expect(() => realtime.send("{}")).toThrow(/not open/);

    const socket = await openLatest(realtime.connect());
    realtime.send('{"type":"ping"}');
    expect(socket.sent).toEqual(['{"type":"ping"}']);
  });

  it("explains itself when no WebSocket implementation exists", () => {
    const original = (globalThis as { WebSocket?: unknown }).WebSocket;
    delete (globalThis as { WebSocket?: unknown }).WebSocket;
    try {
      expect(() => new SupportlyRealtime({ tickets: ticketStub() })).toThrow(/global WebSocket/);
    } finally {
      if (original) (globalThis as { WebSocket?: unknown }).WebSocket = original;
    }
  });
});
