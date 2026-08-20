import { generateIdempotencyKey } from "../idempotency";
import { paginate, paginatePages, type PaginationLimits } from "../pagination";
import type { RequestOptions, Transport } from "../transport";
import type {
  AssignmentEvent,
  AssignmentResponse,
  AssignRequest,
  ConversationReplyAccepted,
  ConversationReplyRequest,
  ConversationSummary,
  ListConversationsParams,
  ListMessagesParams,
  Message,
  TransferRequest,
} from "../types";

interface ConversationCursor {
  before_at: string;
  before_channel: string;
}

interface MessageCursor {
  before_message_at: string;
  before_message_id: string;
  before_channel_sequence: number | null;
}

const DEFAULT_CONVERSATION_LIMIT = 50;
const DEFAULT_MESSAGE_LIMIT = 100;

/**
 * Лента канала и ответы: `/v1/conversations/*`.
 *
 * Чтение — `conversations:read`, ответ — `conversations:write`,
 * назначение — `conversations:assign`.
 *
 * `{channel}` в URL — ключ ленты: источник `custom:shop` или тред
 * `custom:shop:{uuid}`. Reply адресует этот ключ, не «отправь user id».
 * Не путать с ingest: туда кладут входящее от клиента, сюда — исходящее агента.
 */
export class ConversationsResource {
  constructor(private readonly transport: Transport) {}

  /**
   * One page of conversations, newest activity first.
   *
   * For the next page pass the final item's `last_at` and `channel` as
   * `before_at` / `before_channel`, or use {@link iterate}.
   */
  list(
    params: ListConversationsParams = {},
    options?: RequestOptions,
  ): Promise<ConversationSummary[]> {
    return this.transport.request<ConversationSummary[]>({
      method: "GET",
      path: "/v1/conversations",
      auth: "apiKey",
      query: {
        limit: params.limit ?? DEFAULT_CONVERSATION_LIMIT,
        q: params.q,
        before_at: params.before_at,
        before_channel: params.before_channel,
      },
      asList: true,
      options,
    });
  }

  /** Walks every conversation, newest first, one page at a time. */
  iterate(
    params: ListConversationsParams & PaginationLimits = {},
    options?: RequestOptions,
  ): AsyncGenerator<ConversationSummary, void, undefined> {
    const limit = params.limit ?? DEFAULT_CONVERSATION_LIMIT;
    return paginate<ConversationSummary, ConversationCursor>({
      limit,
      maxItems: params.maxItems,
      maxPages: params.maxPages,
      fetchPage: (cursor) => this.list({ ...params, limit, ...cursor }, options),
      cursorFrom: (page) => {
        const last = page[page.length - 1];
        return last ? { before_at: last.last_at, before_channel: last.channel } : undefined;
      },
    });
  }

  /**
   * One page of channel history, **oldest first within the page**.
   *
   * The endpoint pages backwards in time: the next (older) page is requested
   * with the cursor fields of `page[0]`. {@link iterateMessages} does that.
   */
  messages(
    channelKey: string,
    params: ListMessagesParams = {},
    options?: RequestOptions,
  ): Promise<Message[]> {
    return this.transport.request<Message[]>({
      method: "GET",
      path: `/v1/conversations/${encodeURIComponent(channelKey)}/messages`,
      auth: "apiKey",
      query: {
        limit: params.limit ?? DEFAULT_MESSAGE_LIMIT,
        before_message_at: params.before_message_at,
        before_message_id: params.before_message_id,
        before_channel_sequence: params.before_channel_sequence,
      },
      asList: true,
      options,
    });
  }

  /**
   * Walks channel history backwards in time, newest page first. Each yielded
   * page is chronological internally.
   */
  iterateMessagePages(
    channelKey: string,
    params: ListMessagesParams & PaginationLimits = {},
    options?: RequestOptions,
  ): AsyncGenerator<Message[], void, undefined> {
    const limit = params.limit ?? DEFAULT_MESSAGE_LIMIT;
    return paginatePages<Message, MessageCursor>({
      limit,
      maxItems: params.maxItems,
      maxPages: params.maxPages,
      fetchPage: (cursor) => this.messages(channelKey, { ...params, limit, ...cursor }, options),
      cursorFrom: (page) => {
        const oldest = page[0];
        return oldest
          ? {
              before_message_at: oldest.created_at,
              before_message_id: oldest.id,
              before_channel_sequence: oldest.channel_sequence,
            }
          : undefined;
      },
    });
  }

  /** Same traversal as {@link iterateMessagePages}, flattened to messages. */
  async *iterateMessages(
    channelKey: string,
    params: ListMessagesParams & PaginationLimits = {},
    options?: RequestOptions,
  ): AsyncGenerator<Message, void, undefined> {
    for await (const page of this.iterateMessagePages(channelKey, params, options)) {
      for (const message of page) yield message;
    }
  }

  /**
   * Ответ оператора / бота в ленту канала. Не ingest.
   *
   * Виджет (`widget:{visitor_id}`) доставляет посетителю в сокет.
   * Custom / email / api — пишут в ленту и рассылают интеграторам.
   * Если ключ не передан, SDK ставит `agent-reply-{uuid}`.
   */
  reply(
    channelKey: string,
    request: ConversationReplyRequest,
    options?: RequestOptions,
  ): Promise<ConversationReplyAccepted> {
    const body: ConversationReplyRequest = {
      ...request,
      idempotency_key: request.idempotency_key ?? `agent-reply-${generateIdempotencyKey()}`,
      attachment_ids: request.attachment_ids ?? [],
    };

    return this.transport.request<ConversationReplyAccepted>({
      method: "POST",
      path: `/v1/conversations/${encodeURIComponent(channelKey)}/messages`,
      auth: "apiKey",
      body,
      idempotent: true,
      options,
    });
  }

  /** Current assignment. 404 when the conversation was never assigned. */
  getAssignment(channelKey: string, options?: RequestOptions): Promise<AssignmentResponse> {
    return this.transport.request<AssignmentResponse>({
      method: "GET",
      path: `/v1/conversations/${encodeURIComponent(channelKey)}/assignment`,
      auth: "apiKey",
      options,
    });
  }

  /** Assigns to a user, a role, or neither (`null` clears). */
  assign(
    channelKey: string,
    request: AssignRequest,
    options?: RequestOptions,
  ): Promise<AssignmentResponse> {
    return this.transport.request<AssignmentResponse>({
      method: "PUT",
      path: `/v1/conversations/${encodeURIComponent(channelKey)}/assignment`,
      auth: "apiKey",
      body: request,
      // An upsert to a fixed target: replaying it converges on the same state.
      idempotent: true,
      options,
    });
  }

  /** Hands a conversation to another user or role, recording the handoff. */
  transfer(
    channelKey: string,
    request: TransferRequest,
    options?: RequestOptions,
  ): Promise<AssignmentResponse> {
    return this.transport.request<AssignmentResponse>({
      method: "POST",
      path: `/v1/conversations/${encodeURIComponent(channelKey)}/transfer`,
      auth: "apiKey",
      body: request,
      // Appends an audit row per call, so a replay is not free — no retry.
      idempotent: false,
      options,
    });
  }

  /** Assignment history, newest first. */
  assignmentHistory(
    channelKey: string,
    params: { limit?: number } = {},
    options?: RequestOptions,
  ): Promise<AssignmentEvent[]> {
    return this.transport.request<AssignmentEvent[]>({
      method: "GET",
      path: `/v1/conversations/${encodeURIComponent(channelKey)}/assignment/history`,
      auth: "apiKey",
      query: { limit: params.limit ?? DEFAULT_CONVERSATION_LIMIT },
      asList: true,
      options,
    });
  }
}
