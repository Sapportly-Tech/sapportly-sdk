/**
 * Reconnecting WebSocket stream.
 *
 * Tickets are single-use and expire in about a minute, so every connect — and
 * every reconnect — mints a fresh one. That is the whole reason this wrapper
 * exists: a plain `new WebSocket(url)` cannot reconnect, because the URL it
 * was given is already spent.
 */

import { conversationMatchesSource } from "./channels";
import { SupportlyConfigError } from "./errors";
import type { RealtimeResource } from "./resources/realtime";
import { websocketUrl } from "./resources/realtime";
import type { WsWireEvent } from "./types";
import { parseWireEvent } from "./wire";

/** The slice of the `WebSocket` interface this wrapper uses. */
export interface WebSocketLike {
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  send(data: string): void;
  onopen: ((event: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onclose: ((event: any) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export type RealtimeState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface RealtimeOptions {
  /** Issues tickets — normally `client.realtime`. */
  tickets: Pick<RealtimeResource, "createTicket">;
  /** Required where `WebSocket` is not global (Node 18/20). */
  WebSocket?: WebSocketFactory;
  onEvent?: (event: WsWireEvent) => void;
  /** Raw frames that were not JSON, or did not match the wire schema. */
  onRaw?: (data: unknown) => void;
  onError?: (error: unknown) => void;
  onStateChange?: (state: RealtimeState) => void;
  /** Set to `false` to surface disconnects instead of retrying. Default `true`. */
  reconnect?: boolean;
  /** First reconnect delay, doubled each attempt. Default 500 ms. */
  initialReconnectDelayMs?: number;
  /** Ceiling for a reconnect delay. Default 30 s. */
  maxReconnectDelayMs?: number;
  /** Give up after this many consecutive failures. Default `Infinity`. */
  maxReconnectAttempts?: number;
  /**
   * Optional source allow-list. `custom:shop` совпадает с тредами
   * `custom:shop:{uuid}`. Кадры без канала проходят. Отброшенные видны в `onRaw`.
   */
  channels?: string[];
}

const OPEN = 1;

function resolveFactory(options: RealtimeOptions): WebSocketFactory {
  if (options.WebSocket) return options.WebSocket;

  const global = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (global) return (url) => new global(url);

  throw new SupportlyConfigError(
    "no global WebSocket — pass `WebSocket` in the realtime options (e.g. the `ws` package on Node 18)",
  );
}

export class SupportlyRealtime {
  private readonly options: RealtimeOptions;
  private readonly factory: WebSocketFactory;
  private socket?: WebSocketLike;
  private timer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private stopped = false;
  private currentState: RealtimeState = "idle";
  private opening?: Promise<void>;
  private readonly waiters = new Set<(event: WsWireEvent) => void>();

  constructor(options: RealtimeOptions) {
    this.options = options;
    this.factory = resolveFactory(options);
  }

  get state(): RealtimeState {
    return this.currentState;
  }

  /** Opens the stream. Resolves once the first connection is established. */
  async connect(): Promise<void> {
    this.stopped = false;
    if (this.currentState === "open") return;
    if (this.opening) return this.opening;
    this.opening = this.open().finally(() => {
      this.opening = undefined;
    });
    await this.opening;
  }

  /**
   * Async iterator of parsed wire events. Starts the socket if needed.
   *
   * ```ts
   * for await (const event of stream.events()) {
   *   if (event.type === "message.delivered") break;
   * }
   * ```
   */
  async *events(signal?: AbortSignal): AsyncGenerator<WsWireEvent, void, undefined> {
    if (this.currentState !== "open") await this.connect();
    const queue: WsWireEvent[] = [];
    let notify: (() => void) | undefined;
    const onEvent = (event: WsWireEvent) => {
      queue.push(event);
      notify?.();
    };
    this.waiters.add(onEvent);
    try {
      while (!this.stopped && !signal?.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notify = resolve;
            signal?.addEventListener("abort", () => resolve(), { once: true });
          });
          notify = undefined;
        }
        const next = queue.shift();
        if (next) yield next;
      }
    } finally {
      this.waiters.delete(onEvent);
    }
  }

  /** Closes the stream and cancels any pending reconnect. */
  close(code = 1000, reason = "client closed"): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.socket?.close(code, reason);
    this.socket = undefined;
    this.setState("closed");
  }

  /** Sends a raw frame. Throws when the socket is not open. */
  send(data: string): void {
    if (!this.socket || this.socket.readyState !== OPEN) {
      throw new SupportlyConfigError("realtime socket is not open");
    }
    this.socket.send(data);
  }

  private setState(state: RealtimeState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.options.onStateChange?.(state);
  }

  private async open(): Promise<void> {
    this.setState(this.attempts === 0 ? "connecting" : "reconnecting");

    const { ticket, ws_url } = await this.options.tickets.createTicket();
    const socket = this.factory(websocketUrl(ws_url, ticket));
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      socket.onopen = () => {
        settled = true;
        this.attempts = 0;
        this.setState("open");
        resolve();
      };

      socket.onmessage = (event) => this.handleMessage(event.data);

      socket.onerror = (error) => {
        this.options.onError?.(error);
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error("websocket error"));
        }
      };

      socket.onclose = (event) => {
        this.socket = undefined;
        if (this.stopped) {
          this.setState("closed");
          return;
        }

        // A close before `onopen` — a rejected ticket, say — does not always
        // come with an `onerror`, so reject here too or the promise never
        // settles and the reconnect loop stalls for good.
        if (!settled) {
          settled = true;
          reject(new Error(`websocket closed before opening (code ${event.code ?? "unknown"})`));
          return;
        }

        this.scheduleReconnect();
      };
    });
  }

  private handleMessage(data: unknown): void {
    const frame = parseWireEvent(data);
    if (!frame) {
      this.options.onRaw?.(data);
      return;
    }

    const channel =
      typeof frame.payload.channel === "string" ? frame.payload.channel : undefined;
    if (
      this.options.channels?.length &&
      channel &&
      !this.options.channels.some((filter) => conversationMatchesSource(channel, filter))
    ) {
      this.options.onRaw?.(frame);
      return;
    }

    this.options.onEvent?.(frame);
    for (const waiter of this.waiters) waiter(frame);
  }

  private scheduleReconnect(): void {
    if (this.options.reconnect === false) {
      this.setState("closed");
      return;
    }

    const max = this.options.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
    if (this.attempts >= max) {
      this.setState("closed");
      this.options.onError?.(new Error(`realtime gave up after ${this.attempts} attempts`));
      return;
    }

    const initial = this.options.initialReconnectDelayMs ?? 500;
    const ceiling = this.options.maxReconnectDelayMs ?? 30_000;
    const backoff = Math.min(ceiling, initial * 2 ** this.attempts);
    const delay = Math.random() * backoff;

    this.attempts += 1;
    this.setState("reconnecting");

    this.timer = setTimeout(() => {
      void this.open().catch((error: unknown) => {
        this.options.onError?.(error);
        this.scheduleReconnect();
      });
    }, delay);
  }
}
