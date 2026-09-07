import { generateIdempotencyKey } from "../idempotency";
import { paginatePages, type ListPage, type PaginationLimits } from "../pagination";
import type { RequestOptions, Transport } from "../transport";
import type {
  Message,
  WidgetBootstrapRequest,
  WidgetCannedPromptRequest,
  WidgetChannelSecurity,
  WidgetEmbedSessionRequest,
  WidgetEventRequest,
  WidgetHistoryParams,
  WidgetIdentifyRequest,
  WidgetIdentifyResponse,
  WidgetSendRequest,
  WidgetSendResponse,
  WidgetSession,
} from "../types";

interface WidgetHistoryCursor {
  before_at: string;
  before_id: string;
  before_sequence: number | null;
}

const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Visitor-facing widget API: `/v1/widget/*`.
 *
 * Two credentials are in play and they are not interchangeable:
 *
 * - `createEmbedSession` is the only method that uses the tenant API key
 *   (scope `widget:embed:issue`). Call it from your backend to mint a visitor
 *   session without exposing the key to the browser.
 * - Every other method authenticates with the **visitor token** returned by
 *   that session (or by `bootstrap`), passed as `X-Visitor-Token`. They take
 *   no API key at all.
 *
 * Most integrations only need `createEmbedSession`; the rest exist for teams
 * building a custom chat UI on top of the platform.
 */
export class WidgetResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Server-side session issuance (BFF). Scope `widget:embed:issue`.
   *
   * Hand the returned `token` to the browser; hand `ws_ticket` to a WebSocket
   * connection. When a new visitor is minted the response also carries
   * `visitor_secret`, which the client must persist to reclaim the same
   * identity on its next `bootstrap`.
   */
  createEmbedSession(
    request: WidgetEmbedSessionRequest = {},
    options?: RequestOptions,
  ): Promise<WidgetSession> {
    return this.transport.request<WidgetSession>({
      method: "POST",
      path: "/v1/widget/embed-session",
      auth: "apiKey",
      body: request,
      // Reissuing a session for a known visitor_id is safe; minting a brand
      // new visitor on replay is not, so only retry when the id is pinned.
      idempotent: Boolean(request.visitor_id),
      options,
    });
  }

  /**
   * Browser session issuance. No API key — the gateway authorises by public
   * `site_id` plus the request `Origin`, which must be on the install's
   * allow-list. Calling this from a server (no browser `Origin`) fails with 403.
   */
  bootstrap(request: WidgetBootstrapRequest, options?: RequestOptions): Promise<WidgetSession> {
    return this.transport.request<WidgetSession>({
      method: "POST",
      path: "/v1/widget/bootstrap",
      auth: "none",
      body: request,
      idempotent: Boolean(request.visitor_id),
      options,
    });
  }

  /** Visitor sends a message. Authenticates with the visitor token only. */
  sendMessage(
    visitorToken: string,
    request: WidgetSendRequest,
    options?: RequestOptions,
  ): Promise<WidgetSendResponse> {
    return this.transport.request<WidgetSendResponse>({
      method: "POST",
      path: "/v1/widget/messages",
      auth: "none",
      visitorToken,
      body: {
        ...request,
        idempotency_key: request.idempotency_key ?? generateIdempotencyKey(),
        attachment_ids: request.attachment_ids ?? [],
      },
      idempotent: true,
      options,
    });
  }

  /**
   * One page of the visitor's history, oldest first within the page. Pages
   * backwards in time via `before_at` / `before_id` / `before_sequence`.
   * Envelope unwrapped — no `has_more`. Prefer {@link historyPage} /
   * {@link iterateHistoryPages} for pagination.
   */
  history(
    visitorToken: string,
    params: WidgetHistoryParams,
    options?: RequestOptions,
  ): Promise<Message[]> {
    return this.transport.request<Message[]>({
      method: "GET",
      path: "/v1/widget/messages",
      auth: "none",
      visitorToken,
      query: {
        visitor_id: params.visitor_id,
        limit: params.limit ?? DEFAULT_HISTORY_LIMIT,
        before_at: params.before_at,
        before_id: params.before_id,
        before_sequence: params.before_sequence,
      },
      asList: true,
      options,
    });
  }

  /** Pending confirm cards for this visitor. Visitor JWT only. */
  listCapabilityConfirms(
    visitorToken: string,
    visitorId: string,
    options?: RequestOptions,
  ): Promise<{ items: Array<Record<string, unknown>> }> {
    return this.transport.request({
      method: "GET",
      path: "/v1/widget/capability-confirm",
      auth: "none",
      visitorToken,
      query: { visitor_id: visitorId },
      options,
    });
  }

  /** Confirm or cancel a pending write. Idempotent on confirm_id. */
  actCapabilityConfirm(
    visitorToken: string,
    request: { confirm_id: string; action: "confirm" | "cancel"; visitor_id: string },
    options?: RequestOptions,
  ): Promise<{ confirm_id: string; status: string; already_applied: boolean }> {
    return this.transport.request({
      method: "POST",
      path: "/v1/widget/capability-confirm",
      auth: "none",
      visitorToken,
      body: request,
      idempotent: true,
      options,
    });
  }

  /** Same as {@link history}, preserving list envelope metadata (P-08). */
  historyPage(
    visitorToken: string,
    params: WidgetHistoryParams,
    options?: RequestOptions,
  ): Promise<ListPage<Message>> {
    return this.transport.requestListPage<Message>({
      method: "GET",
      path: "/v1/widget/messages",
      auth: "none",
      visitorToken,
      query: {
        visitor_id: params.visitor_id,
        limit: params.limit ?? DEFAULT_HISTORY_LIMIT,
        before_at: params.before_at,
        before_id: params.before_id,
        before_sequence: params.before_sequence,
      },
      options,
    });
  }

  /** Walks the visitor's history backwards in time, newest page first. */
  iterateHistoryPages(
    visitorToken: string,
    params: WidgetHistoryParams & PaginationLimits,
    options?: RequestOptions,
  ): AsyncGenerator<Message[], void, undefined> {
    const limit = params.limit ?? DEFAULT_HISTORY_LIMIT;
    return paginatePages<Message, WidgetHistoryCursor>({
      limit,
      maxItems: params.maxItems,
      maxPages: params.maxPages,
      fetchPage: (cursor) => this.historyPage(visitorToken, { ...params, limit, ...cursor }, options),
      cursorFrom: (page) => {
        const oldest = page[0];
        return oldest
          ? {
              before_at: oldest.created_at,
              before_id: oldest.id,
              before_sequence: oldest.channel_sequence,
            }
          : undefined;
      },
      cursorFromEnvelope: (next) => widgetHistoryCursorFromEnvelope(next),
    });
  }

  /**
   * Persist visitor traits (email / phone / external_id) for bound CRM search.
   * Visitor JWT only. The response is `{ ok: true }` and never echoes PII.
   * Empty string on a field clears the stored value; omitted fields stay as-is.
   */
  identify(
    visitorToken: string,
    request: WidgetIdentifyRequest,
    options?: RequestOptions,
  ): Promise<WidgetIdentifyResponse> {
    return this.transport.request<WidgetIdentifyResponse>({
      method: "POST",
      path: "/v1/widget/identify",
      auth: "none",
      visitorToken,
      body: request,
      idempotent: true,
      options,
    });
  }

  /**
   * Records a widget analytics event. `event_name` must be one the platform
   * knows; anything else is rejected with 400.
   */
  trackEvent(
    visitorToken: string,
    request: WidgetEventRequest,
    options?: RequestOptions,
  ): Promise<{ accepted: boolean }> {
    return this.transport.request<{ accepted: boolean }>({
      method: "POST",
      path: "/v1/widget/events",
      auth: "none",
      visitorToken,
      body: request,
      // Analytics counters would double-count on replay.
      idempotent: false,
      options,
    });
  }

  /**
   * Plays a configured canned prompt, writing both the question and its answer
   * into the conversation as one exchange. Unavailable on E2EE channels.
   */
  cannedPrompt(
    visitorToken: string,
    request: WidgetCannedPromptRequest,
    options?: RequestOptions,
  ): Promise<{ accepted: boolean; duplicate?: boolean }> {
    return this.transport.request<{ accepted: boolean; duplicate?: boolean }>({
      method: "POST",
      path: "/v1/widget/canned-prompt",
      auth: "none",
      visitorToken,
      body: request,
      idempotent: true,
      options,
    });
  }

  /** Encryption state of the visitor's channel. */
  channelSecurity(
    visitorToken: string,
    visitorId: string,
    options?: RequestOptions,
  ): Promise<WidgetChannelSecurity> {
    return this.transport.request<WidgetChannelSecurity>({
      method: "GET",
      path: "/v1/widget/channel-security",
      auth: "none",
      visitorToken,
      query: { visitor_id: visitorId },
      options,
    });
  }

  /**
   * Registers the visitor's E2EE public key on the channel.
   * Tenant must have E2EE enabled in panel security settings.
   */
  startE2ee(
    visitorToken: string,
    request: { visitor_id: string; visitor_public_key: string },
    options?: RequestOptions,
  ): Promise<WidgetChannelSecurity> {
    return this.transport.request<WidgetChannelSecurity>({
      method: "POST",
      path: "/v1/widget/e2ee/start",
      auth: "none",
      visitorToken,
      body: request,
      idempotent: true,
      options,
    });
  }
}

function widgetHistoryCursorFromEnvelope(next: unknown): WidgetHistoryCursor | undefined {
  if (!next || typeof next !== "object") return undefined;
  const c = next as Record<string, unknown>;
  if (typeof c.before_at !== "string" || typeof c.before_id !== "string") return undefined;
  const seq = c.before_sequence;
  return {
    before_at: c.before_at,
    before_id: c.before_id,
    before_sequence: typeof seq === "number" ? seq : null,
  };
}
