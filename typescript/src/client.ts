import { AnalyticsResource } from "./resources/analytics";
import { AttachmentsResource } from "./resources/attachments";
import { ChannelsResource } from "./resources/channels";
import { ContactsResource } from "./resources/contacts";
import { ConversationsResource } from "./resources/conversations";
import { IngestResource } from "./resources/ingest";
import { RagResource } from "./resources/rag";
import { RealtimeResource } from "./resources/realtime";
import { TeamResource } from "./resources/team";
import { WebhooksResource } from "./resources/webhooks";
import { WidgetResource } from "./resources/widget";
import {
  type ClientOptions,
  type RateLimitInfo,
  type RequestOptions,
  Transport,
} from "./transport";
import type { HealthResponse, ReadyResponse, StatusResponse } from "./types";

export type SupportlyClientOptions = ClientOptions;

/**
 * Client for the Supportly **public API** (`api.supportly.cc`).
 *
 * Authenticates with a tenant API key (`sk_live_…`) whose scopes decide which
 * resources are reachable. Panel/operator endpoints live on a different host
 * behind a session JWT and are intentionally absent here.
 *
 * ```ts
 * import { SupportlyClient } from "@sapportly/sdk";
 *
 * const client = new SupportlyClient({ apiKey: process.env.SUPPORTLY_API_KEY! });
 *
 * await client.ingest.send({ channel: "custom:shop", body: "Где заказ?" });
 * ```
 */
export class SupportlyClient {
  private readonly transport: Transport;

  /** `POST /v1/ingest/messages` — scope `messages:write`. */
  readonly ingest: IngestResource;
  /** `/v1/conversations/*` — scopes `conversations:read|write|assign`. */
  readonly conversations: ConversationsResource;
  /** `/v1/contacts` — scopes `conversations:read|write`. */
  readonly contacts: ContactsResource;
  /** `/v1/channels` — scopes `channels:read|write`. */
  readonly channels: ChannelsResource;
  /** `/v1/attachments/*` — scope `attachments:write`. */
  readonly attachments: AttachmentsResource;
  /** `GET /v1/team/roles` — scope `team:read`. */
  readonly team: TeamResource;
  /** `POST /v1/analytics/track` — scope `analytics:write`. */
  readonly analytics: AnalyticsResource;
  /** `POST /v1/ws/ticket` — scope `ws:connect`. */
  readonly realtime: RealtimeResource;
  /** `/v1/widget/*` — API key for embed sessions, visitor token for the rest. */
  readonly widget: WidgetResource;
  /** `GET/PUT /v1/webhooks` — scopes `conversations:read|write`. */
  readonly webhooks: WebhooksResource;
  /** `/v1/rag/documents` — scope `attachments:write`. */
  readonly rag: RagResource;

  constructor(options: SupportlyClientOptions = {}) {
    this.transport = new Transport(options);

    this.ingest = new IngestResource(this.transport);
    this.conversations = new ConversationsResource(this.transport);
    this.contacts = new ContactsResource(this.transport);
    this.channels = new ChannelsResource(this.transport);
    this.attachments = new AttachmentsResource(this.transport);
    this.team = new TeamResource(this.transport);
    this.analytics = new AnalyticsResource(this.transport);
    this.realtime = new RealtimeResource(this.transport);
    this.widget = new WidgetResource(this.transport);
    this.webhooks = new WebhooksResource(this.transport);
    this.rag = new RagResource(this.transport);
  }

  /** Swaps the API key in place, e.g. after a rotation. */
  setApiKey(apiKey: string): void {
    this.transport.setApiKey(apiKey);
  }

  /**
   * Rate-limit state from the most recent response that reported any
   * (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`).
   */
  get rateLimit(): RateLimitInfo | undefined {
    return this.transport.lastRateLimit;
  }

  /** `GET /v1/status` — API version and feature flags. Unauthenticated. */
  status(options?: RequestOptions): Promise<StatusResponse> {
    return this.transport.request<StatusResponse>({
      method: "GET",
      path: "/v1/status",
      auth: "none",
      options,
    });
  }

  /** `GET /health` — liveness probe. Unauthenticated. */
  health(options?: RequestOptions): Promise<HealthResponse> {
    return this.transport.request<HealthResponse>({
      method: "GET",
      path: "/health",
      auth: "none",
      options,
    });
  }

  /**
   * `GET /ready` — dependency readiness. Unauthenticated.
   *
   * Answers 503 when a dependency is down, which the SDK surfaces as a
   * `SupportlyServerError`; catch it if you want the body rather than a throw.
   */
  ready(options?: RequestOptions): Promise<ReadyResponse> {
    return this.transport.request<ReadyResponse>({
      method: "GET",
      path: "/ready",
      auth: "none",
      options,
    });
  }
}
