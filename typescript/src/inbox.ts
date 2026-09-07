/**
 * Inbox интегратора: CRM, бэкенд, своя админка.
 *
 * Один ticket + reconnect + обработчики. Тикеты и разбор wire сами не нужны.
 *
 * Канал в `channels` — источник (весь магазин / весь коннектор). Треды
 * `custom:shop:{uuid}` тоже проходят фильтр `custom:shop`.
 *
 * ```ts
 * import { SapportlyClient } from "@sapportly/sdk";
 * import { SapportlyInbox } from "@sapportly/sdk/realtime";
 *
 * const CHANNEL = "custom:shop";
 * const client = new SapportlyClient({ apiKey: process.env.SAPPORTLY_API_KEY ?? process.env.SUPPORTLY_API_KEY });
 * const inbox = new SapportlyInbox(client, { channels: [CHANNEL] });
 *
 * inbox.onVisitor((msg) => console.log("входящее в ленту", msg.body));
 * inbox.onAgent((msg) => {
 *   if (msg.echo) return; // это наш же inbox.reply — во внешний канал уже отправили
 *   // ответ из панели: msg.channel — тред, msg.externalId — кому доставить
 * });
 * inbox.onAi((draft) => {
 *   if (draft.partial) return; // стрим «печатает…»
 * });
 *
 * inbox.onStateChange((state) => {
 *   if (state === "open") {
 *     // WS не реплеит историю — только REST catch-up (persist, не deliver).
 *     void inbox.catchUp({ onMessage: (row) => persistLocally(row) });
 *   }
 * });
 *
 * await inbox.connect();
 * ```
 */

import {
  catchUpInbox,
  type CatchUpOptions,
  type CatchUpResult,
} from "./catch-up";
import { sourceChannel as registrySourceChannel, threadIdFromChannel } from "./channels";
import type { SapportlyClient } from "./client";
import { generateIdempotencyKey } from "./idempotency";
import {
  extractMessageId,
  MessageDeduper,
  type MessageSeenStore,
} from "./dedup";
import { SapportlyRealtime, type RealtimeOptions, type RealtimeState } from "./realtime";
import type { ConversationReplyAccepted } from "./types";
import {
  classifyWireEvent,
  isAgentRole,
  type AiDraftPayload,
  type ClassifiedWireEvent,
  type MessageDeliveredPayload,
  nodeWebSocketFactory,
} from "./wire";

export interface InboxMessage {
  messageId: string;
  /** Ключ ленты: тред `custom:shop:{uuid}` или источник, если identity не передали. */
  channel: string;
  /** Источник для аналитики (`custom:shop`). */
  sourceChannel: string;
  /** UUID треда, если это 1:1. */
  threadId: string | null;
  /** `identity.external_id` с ingest — кому доставить ответ из панели. */
  externalId: string | null;
  /**
   * Текст. На канале с tenant-шифрованием (`enc_v1_standard`) это ciphertext:
   * публичный SDK его не расшифровывает. Для ботов обычно оставляют plaintext.
   */
  body: string;
  role: NonNullable<MessageDeliveredPayload["role"]>;
  encoding: string;
  /**
   * `true`, если это эхо нашего {@link SapportlyInbox.reply}.
   * Во внешний канал его повторно слать не нужно.
   */
  echo: boolean;
  event: ClassifiedWireEvent;
}

export interface InboxOptions {
  /**
   * Слушать эти источники. `custom:shop` включает треды `custom:shop:{uuid}`.
   * Без списка придут все каналы тенанта.
   */
  channels?: string[];
  WebSocket?: RealtimeOptions["WebSocket"];
  /**
   * Dedup by `message_id` (webhook+WS twins).
   * - omit / `true` → in-memory {@link MessageDeduper}
   * - `false` → off
   * - {@link MessageSeenStore} → custom (Redis/SQL via {@link ExternalMessageSeenStore})
   */
  dedup?: boolean | MessageSeenStore;
  onError?: (error: unknown) => void;
  /**
   * When true and `seenStore.release` is implemented, unclaim after a handler
   * throw so dual-delivery can retry (at-least-once). Default **false** (at-most-once).
   */
  releaseOnHandlerError?: boolean;
  onStateChange?: (state: RealtimeState) => void;
}

type MaybeAsync = void | Promise<void>;
type VisitorHandler = (message: InboxMessage) => MaybeAsync;
type AgentHandler = (message: InboxMessage) => MaybeAsync;
type AiHandler = (draft: AiDraftPayload, event: ClassifiedWireEvent) => MaybeAsync;
type AnyHandler = (event: ClassifiedWireEvent) => MaybeAsync;

function toInboxMessage(event: ClassifiedWireEvent, echo: boolean): InboxMessage | null {
  const payload = event.message;
  const channel = event.channel ?? payload?.channel;
  const body = payload?.body ?? "";
  const messageId = event.messageId ?? extractMessageId(event.frame) ?? "";
  if (!channel) return null;
  return {
    messageId,
    channel,
    sourceChannel: payload?.source_channel ?? registrySourceChannel(channel),
    threadId: payload?.thread_id ?? threadIdFromChannel(channel),
    externalId: payload?.external_id ?? null,
    body,
    role: payload?.role ?? "visitor",
    encoding: payload?.content_encoding ?? "plain",
    echo,
    event,
  };
}

function resolveSeenStore(dedup: InboxOptions["dedup"]): MessageSeenStore | null {
  if (dedup === false) return null;
  if (dedup === true || dedup === undefined) return new MessageDeduper();
  return dedup;
}

export class SapportlyInbox {
  private readonly realtime: SapportlyRealtime;
  private readonly seenStore: MessageSeenStore | null;
  private readonly channelFilters: string[] | undefined;
  private readonly releaseOnHandlerError: boolean;
  private readonly onError?: (error: unknown) => void;
  private readonly visitorHandlers = new Set<VisitorHandler>();
  private readonly agentHandlers = new Set<AgentHandler>();
  private readonly aiHandlers = new Set<AiHandler>();
  private readonly anyHandlers = new Set<AnyHandler>();
  private readonly stateHandlers = new Set<(state: RealtimeState) => void>();
  /** message_id ответов, которые мы сами отправили через {@link reply}. */
  private readonly outgoingIds = new Set<string>();
  /** Idempotency keys registered *before* reply HTTP returns (echo race). */
  /** idempotency_key → expiry ms (Date.now()). */
  private readonly pendingIdempotencyKeys = new Map<string, number>();
  private static readonly PENDING_ECHO_TTL_MS = 60_000;
  private static readonly OUTGOING_CAP = 2_000;
  /**
   * Per-message_id claim queue (P-09). Serializes async tryClaim so concurrent
   * dual delivery (webhook+WS or triple WS) cannot race check-then-set.
   */
  private readonly claimLocks = new Map<string, Promise<void>>();

  constructor(client: SapportlyClient, options: InboxOptions = {}) {
    this.seenStore = resolveSeenStore(options.dedup);
    this.channelFilters = options.channels;
    this.releaseOnHandlerError = Boolean(options.releaseOnHandlerError);
    this.onError = options.onError;
    let factory = options.WebSocket;
    if (!factory) {
      try {
        factory = nodeWebSocketFactory();
      } catch {
        factory = undefined;
      }
    }
    if (options.onStateChange) this.stateHandlers.add(options.onStateChange);
    this.realtime = new SapportlyRealtime({
      tickets: client.realtime,
      WebSocket: factory,
      channels: options.channels,
      trustedApiBaseUrl: client.transport.getBaseUrl(),
      onError: options.onError,
      onStateChange: (state) => {
        for (const handler of this.stateHandlers) handler(state);
      },
      onEvent: (frame) => {
        void this.dispatchAsync(classifyWireEvent(frame));
      },
    });
    this.client = client;
  }

  private readonly client: SapportlyClient;

  get state(): RealtimeState {
    return this.realtime.state;
  }

  /** Входящее от клиента (ingest / виджет / коннектор). */
  onVisitor(handler: VisitorHandler): () => void {
    this.visitorHandlers.add(handler);
    return () => this.visitorHandlers.delete(handler);
  }

  /**
   * Исходящее агента: панель Sapportly, автоответ ИИ или {@link reply}.
   * Своё эхо (этот процесс вызвал {@link reply}) помечается `echo: true`.
   */
  onAgent(handler: AgentHandler): () => void {
    this.agentHandlers.add(handler);
    return () => this.agentHandlers.delete(handler);
  }

  /** Черновик AI. Частичные кадры: `draft.partial === true`. */
  onAi(handler: AiHandler): () => void {
    this.aiHandlers.add(handler);
    return () => this.aiHandlers.delete(handler);
  }

  /** Любой распознанный кадр, до разложения по ролям. */
  onEvent(handler: AnyHandler): () => void {
    this.anyHandlers.add(handler);
    return () => this.anyHandlers.delete(handler);
  }

  /** `connecting` / `open` / `reconnecting` / `closed`. На `open` вызывайте {@link catchUp}. */
  onStateChange(handler: (state: RealtimeState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  connect(): Promise<void> {
    return this.realtime.connect();
  }

  close(): void {
    this.realtime.close();
  }

  /**
   * REST catch-up after connect/reconnect. WS does not replay missed frames.
   *
   * Uses the same `channels` filter as the socket. Persist only — do not
   * deliver to the end user from `onMessage` (use live `onAgent` for that).
   */
  catchUp(
    options: Omit<CatchUpOptions, "client" | "sources"> & { sources?: string[] },
  ): Promise<CatchUpResult> {
    return catchUpInbox({
      ...options,
      client: this.client,
      sources: options.sources ?? this.channelFilters,
    });
  }

  /**
   * Записать ответ оператора / бота в ленту треда (не ingest).
   *
   * Передавайте `msg.channel` — полный ключ треда, не slug источника.
   * На `custom:` кадр не доставляет человеку сам: сначала отдайте текст
   * во внешний канал (`msg.externalId`), затем `reply` — либо слушайте
   * `onAgent` без `echo` для ответов из панели Sapportly.
   */
  async reply(
    channel: string,
    body: string,
    extra?: { attachment_ids?: string[]; idempotency_key?: string },
  ): Promise<ConversationReplyAccepted> {
    const idempotency_key = extra?.idempotency_key ?? `agent-reply-${generateIdempotencyKey()}`;
    // Register before the HTTP round-trip so a fast WS twin is still marked echo.
    // Keep the key for PENDING_ECHO_TTL_MS after the call — delayed WS frames
    // may carry only idempotency_key before/without a matching message_id.
    this.rememberPendingIdempotency(idempotency_key);
    const accepted = await this.client.conversations.reply(channel, {
      body,
      ...extra,
      idempotency_key,
    });
    if (accepted.message_id) this.rememberOutgoing(accepted.message_id);
    return accepted;
  }

  async *events(signal?: AbortSignal): AsyncGenerator<ClassifiedWireEvent, void, undefined> {
    for await (const frame of this.realtime.events(signal)) {
      yield classifyWireEvent(frame);
    }
  }

  /**
   * Await claim before emit (P-09). Fire-and-forget `.then(claim)` races when
   * the same `message_id` arrives twice before the first tryClaim resolves.
   */
  private async dispatchAsync(event: ClassifiedWireEvent): Promise<void> {
    const id = event.messageId ?? extractMessageId(event.frame);
    const run = async (): Promise<void> => {
      // Черновик повторяет message_id входящего — в seen-set его не кладём,
      // иначе кадр посетителя после draft (или webhook-дубль) отфильтруется.
      if (event.kind !== "ai.draft" && this.seenStore) {
        if (!id) {
          // Dedup on + missing message_id → dual-delivery would double-fire. Fail closed.
          this.onError?.(
            new Error("message missing message_id while inbox dedup is enabled; skipped"),
          );
          return;
        }
        try {
          const duplicate = await Promise.resolve(this.seenStore.claim(id));
          if (duplicate) return;
        } catch (error: unknown) {
          this.onError?.(error);
          return;
        }
      }
      // Default at-most-once after claim. Opt-in releaseOnHandlerError → at-least-once.
      // Claim+emit+release stay under the per-id lock so a twin frame cannot
      // observe "still claimed" before we release after a handler throw.
      try {
        await this.emitHandlers(event, id);
      } catch (error: unknown) {
        this.onError?.(error);
        if (
          this.releaseOnHandlerError &&
          id &&
          event.kind !== "ai.draft" &&
          this.seenStore?.release
        ) {
          try {
            await Promise.resolve(this.seenStore.release(id));
          } catch (releaseErr: unknown) {
            this.onError?.(releaseErr);
          }
        }
      }
    };

    if (event.kind !== "ai.draft" && this.seenStore) {
      // Missing id uses a shared lock key so concurrent empty-id frames serialize
      // into the fail-closed path instead of racing dual emit.
      await this.withMessageClaimLock(id ?? "__missing_message_id__", run);
    } else {
      await run();
    }
  }

  /** Chain claims for one message_id so concurrent frames serialize. */
  private withMessageClaimLock<T>(messageId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.claimLocks.get(messageId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const held = prev.then(() => gate);
    this.claimLocks.set(messageId, held);
    return prev
      .then(fn)
      .finally(() => {
        release();
        if (this.claimLocks.get(messageId) === held) {
          this.claimLocks.delete(messageId);
        }
      });
  }

  private async emitHandlers(event: ClassifiedWireEvent, id: string | undefined): Promise<void> {
    for (const handler of this.anyHandlers) await Promise.resolve(handler(event));

    if (event.kind === "ai.draft" && event.ai) {
      for (const handler of this.aiHandlers) await Promise.resolve(handler(event.ai, event));
      return;
    }

    if (event.kind !== "message") return;
    let echo = false;
    if (id && this.outgoingIds.has(id)) {
      echo = true;
      this.outgoingIds.delete(id);
    }
    const idem =
      event.message?.idempotency_key ??
      (typeof event.frame.idempotency_key === "string" ? event.frame.idempotency_key : undefined);
    if (!echo && idem) {
      const exp = this.pendingIdempotencyKeys.get(idem);
      if (exp !== undefined && exp > Date.now()) {
        echo = true;
        this.pendingIdempotencyKeys.delete(idem);
      } else if (exp !== undefined) {
        this.pendingIdempotencyKeys.delete(idem);
      }
    }
    const message = toInboxMessage(event, echo);
    if (!message) return;
    if (isAgentRole(message.role)) {
      for (const handler of this.agentHandlers) await Promise.resolve(handler(message));
      return;
    }
    if (message.role === "visitor") {
      for (const handler of this.visitorHandlers) await Promise.resolve(handler(message));
    }
  }

  private rememberPendingIdempotency(key: string): void {
    const now = Date.now();
    this.pendingIdempotencyKeys.set(key, now + SapportlyInbox.PENDING_ECHO_TTL_MS);
    for (const [k, exp] of this.pendingIdempotencyKeys) {
      if (exp <= now) this.pendingIdempotencyKeys.delete(k);
    }
    while (this.pendingIdempotencyKeys.size > SapportlyInbox.OUTGOING_CAP) {
      const first = this.pendingIdempotencyKeys.keys().next().value;
      if (first === undefined) break;
      this.pendingIdempotencyKeys.delete(first);
    }
  }

  private rememberOutgoing(id: string): void {
    this.outgoingIds.add(id);
    while (this.outgoingIds.size > SapportlyInbox.OUTGOING_CAP) {
      const first = this.outgoingIds.values().next().value;
      if (first === undefined) break;
      this.outgoingIds.delete(first);
    }
  }
}
