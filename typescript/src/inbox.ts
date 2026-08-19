/**
 * Inbox интегратора: CRM, бэкенд, своя админка.
 *
 * Один ticket + reconnect + обработчики. Тикеты и разбор wire сами не нужны.
 *
 * Канал в `channels` — источник (весь магазин / весь коннектор), не id посетителя.
 *
 * ```ts
 * import { SupportlyClient } from "@supportly/sdk";
 * import { SupportlyInbox } from "@supportly/sdk/realtime";
 *
 * const CHANNEL = "custom:shop";
 * const client = new SupportlyClient({ apiKey: process.env.SUPPORTLY_API_KEY });
 * const inbox = new SupportlyInbox(client, { channels: [CHANNEL] });
 *
 * inbox.onVisitor((msg) => console.log("входящее в ленту", msg.body));
 * inbox.onAgent((msg) => {
 *   if (msg.echo) return; // это наш же inbox.reply — во внешний канал уже отправили
 *   // ответ из панели Supportly: доставьте человеку сами
 * });
 * inbox.onAi((draft) => {
 *   if (draft.partial) return; // стрим «печатает…»
 * });
 *
 * await inbox.connect();
 * ```
 */

import type { SupportlyClient } from "./client";
import { extractMessageId, MessageDeduper } from "./dedup";
import { SupportlyRealtime, type RealtimeOptions, type RealtimeState } from "./realtime";
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
  /** Ключ источника, тот же что в ingest (`custom:shop`). */
  channel: string;
  /**
   * Текст. На канале с tenant-шифрованием (`enc_v1_standard`) это ciphertext:
   * публичный SDK его не расшифровывает. Для ботов обычно оставляют plaintext.
   */
  body: string;
  role: NonNullable<MessageDeliveredPayload["role"]>;
  encoding: string;
  /**
   * `true`, если это эхо нашего {@link SupportlyInbox.reply}.
   * Во внешний канал его повторно слать не нужно.
   */
  echo: boolean;
  event: ClassifiedWireEvent;
}

export interface InboxOptions {
  /**
   * Слушать только эти каналы-источники. Без списка придут все каналы тенанта.
   * Сюда не кладут внешний id посетителя.
   */
  channels?: string[];
  WebSocket?: RealtimeOptions["WebSocket"];
  /** Снимать дубли webhook+WS по `message_id`. По умолчанию включено. */
  dedup?: boolean;
  onError?: (error: unknown) => void;
  onStateChange?: (state: RealtimeState) => void;
}

type VisitorHandler = (message: InboxMessage) => void;
type AgentHandler = (message: InboxMessage) => void;
type AiHandler = (draft: AiDraftPayload, event: ClassifiedWireEvent) => void;
type AnyHandler = (event: ClassifiedWireEvent) => void;

function toInboxMessage(event: ClassifiedWireEvent, echo: boolean): InboxMessage | null {
  const payload = event.message;
  const channel = event.channel ?? payload?.channel;
  const body = payload?.body ?? "";
  const messageId = event.messageId ?? extractMessageId(event.frame) ?? "";
  if (!channel) return null;
  return {
    messageId,
    channel,
    body,
    role: payload?.role ?? "visitor",
    encoding: payload?.content_encoding ?? "plain",
    echo,
    event,
  };
}

export class SupportlyInbox {
  private readonly realtime: SupportlyRealtime;
  private readonly deduper: MessageDeduper | null;
  private readonly visitorHandlers = new Set<VisitorHandler>();
  private readonly agentHandlers = new Set<AgentHandler>();
  private readonly aiHandlers = new Set<AiHandler>();
  private readonly anyHandlers = new Set<AnyHandler>();
  /** message_id ответов, которые мы сами отправили через {@link reply}. */
  private readonly outgoingIds = new Set<string>();
  private static readonly OUTGOING_CAP = 2_000;

  constructor(client: SupportlyClient, options: InboxOptions = {}) {
    this.deduper = options.dedup === false ? null : new MessageDeduper();
    let factory = options.WebSocket;
    if (!factory) {
      try {
        factory = nodeWebSocketFactory();
      } catch {
        factory = undefined;
      }
    }
    this.realtime = new SupportlyRealtime({
      tickets: client.realtime,
      WebSocket: factory,
      channels: options.channels,
      onError: options.onError,
      onStateChange: options.onStateChange,
      onEvent: (frame) => this.dispatch(classifyWireEvent(frame)),
    });
    this.client = client;
  }

  private readonly client: SupportlyClient;

  get state(): RealtimeState {
    return this.realtime.state;
  }

  /** Входящее от клиента (ingest / виджет / коннектор). */
  onVisitor(handler: VisitorHandler): () => void {
    this.visitorHandlers.add(handler);
    return () => this.visitorHandlers.delete(handler);
  }

  /**
   * Исходящее агента: панель Supportly, автоответ ИИ или {@link reply}.
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

  connect(): Promise<void> {
    return this.realtime.connect();
  }

  close(): void {
    this.realtime.close();
  }

  /**
   * Записать ответ оператора / бота в ленту канала (не ingest).
   *
   * На `custom:` / email / CRM кадр не доставляет человеку сам: сначала отдайте
   * текст во внешний канал, затем `reply` — либо слушайте `onAgent` без `echo`
   * для ответов из панели Supportly.
   */
  async reply(
    channel: string,
    body: string,
    extra?: { attachment_ids?: string[]; idempotency_key?: string },
  ): Promise<ConversationReplyAccepted> {
    const accepted = await this.client.conversations.reply(channel, { body, ...extra });
    if (accepted.message_id) this.rememberOutgoing(accepted.message_id);
    return accepted;
  }

  async *events(signal?: AbortSignal): AsyncGenerator<ClassifiedWireEvent, void, undefined> {
    for await (const frame of this.realtime.events(signal)) {
      yield classifyWireEvent(frame);
    }
  }

  private dispatch(event: ClassifiedWireEvent): void {
    const id = event.messageId ?? extractMessageId(event.frame);
    // Черновик повторяет message_id входящего — в seen-set его не кладём,
    // иначе кадр посетителя после draft (или webhook-дубль) отфильтруется.
    if (event.kind !== "ai.draft" && id && this.deduper?.seen(id)) {
      return;
    }

    for (const handler of this.anyHandlers) handler(event);

    if (event.kind === "ai.draft" && event.ai) {
      for (const handler of this.aiHandlers) handler(event.ai, event);
      return;
    }

    if (event.kind !== "message") return;
    let echo = false;
    if (id && this.outgoingIds.has(id)) {
      echo = true;
      this.outgoingIds.delete(id);
    }
    const message = toInboxMessage(event, echo);
    if (!message) return;
    if (isAgentRole(message.role)) {
      for (const handler of this.agentHandlers) handler(message);
      return;
    }
    if (message.role === "visitor") {
      for (const handler of this.visitorHandlers) handler(message);
    }
  }

  private rememberOutgoing(id: string): void {
    this.outgoingIds.add(id);
    while (this.outgoingIds.size > SupportlyInbox.OUTGOING_CAP) {
      const first = this.outgoingIds.values().next().value;
      if (first === undefined) break;
      this.outgoingIds.delete(first);
    }
  }
}
