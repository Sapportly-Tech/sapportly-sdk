/**
 * Wire types for the Supportly public API.
 *
 * Field names mirror the JSON exactly (snake_case) so a response can be handed
 * straight to `JSON.stringify` and back without a mapping layer.
 */

/** Production API base URL. */
export const DEFAULT_BASE_URL = "https://api.supportly.cc";

/** Production WebSocket gateway. Ticket endpoints return the authoritative URL. */
export const DEFAULT_WS_URL = "wss://ws.supportly.cc/ws";

/** Gateway-wide request body ceiling (`MAX_REQUEST_BODY_BYTES`). */
export const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;

/** Longest `body` the ingest validator accepts, in bytes. */
export const MAX_MESSAGE_BODY_BYTES = 65_535;

/** Longest `idempotency_key` the ingest validator accepts. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * API key scopes. Mirrors `ALL_API_KEY_SCOPES` in
 * `backend/crates/common/src/api_key_scopes.rs`.
 */
export const API_KEY_SCOPES = [
  "messages:write",
  "widget:embed:issue",
  "attachments:write",
  "ws:connect",
  "conversations:read",
  "conversations:write",
  "conversations:assign",
  "team:read",
  "channels:read",
  "channels:write",
  "analytics:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

export interface StatusResponse {
  version: string;
  phase: string;
  features?: string[];
  breaking_changes?: {
    removed?: string[];
    use_instead?: Record<string, string>;
  };
}

export interface HealthResponse {
  status: string;
  service?: string;
}

export interface ReadyResponse {
  status: "ready" | "not_ready";
  database: boolean;
  nats: boolean;
  redis: boolean;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Namespaces `validate_ingest_channel` accepts on `POST /v1/ingest/messages`. */
export const INGEST_CHANNEL_NAMESPACES = [
  "widget",
  "api",
  "custom",
  "telegram",
  "email",
  "slack",
  "discord",
] as const;

export type IngestChannelNamespace = (typeof INGEST_CHANNEL_NAMESPACES)[number];

/** Namespaces that `POST /v1/channels` will create. `widget` is server-managed. */
export const CREATABLE_CHANNEL_NAMESPACES = [
  "api",
  "custom",
  "telegram",
  "email",
  "slack",
  "discord",
] as const;

export type CreatableChannelNamespace = (typeof CREATABLE_CHANNEL_NAMESPACES)[number];

export interface IngestMessageRequest {
  /**
   * Ключ источника `namespace:slug` (`custom:shop`, `widget:{uuid}`).
   * Не внешний id посетителя и не «канал на каждого пользователя».
   */
  channel?: string;
  /** Slug из реестра — вместо `channel`. */
  channel_slug?: string;
  /** Namespace для `channel_slug`. На сервере по умолчанию `custom`. */
  channel_namespace?: IngestChannelNamespace | (string & {});
  /** Текст. Пустой допустим, только если есть `attachment_ids`. */
  body?: string;
  /**
   * Ключ дедупа. Стабильный id внешнего события (`crm:{ticket_id}`,
   * `shop:{order_id}:{comment_id}`). SDK сгенерирует UUID, если не задать.
   */
  idempotency_key?: string;
  attachment_ids?: string[];
  /** `plain`, `enc_v1_standard`, или `enc_v1_e2ee`. */
  content_encoding?: string;
  /**
   * Не запускать AI/RAG. Сообщение всё равно пишется и уходит операторам.
   */
  skip_ai?: boolean;
  /**
   * Traits посетителя для bound CRM search.
   * Не возвращаются в accept и не уходят в webhooks. Пустая строка сбрасывает поле.
   */
  identity?: VisitorIdentityInput;
}

export interface VisitorIdentityInput {
  email?: string;
  phone?: string;
  /** Внешний id CRM / мессенджера. */
  external_id?: string;
}

export interface MessageAccepted {
  accepted: boolean;
  event_id: string;
  correlation_id: string;
  /**
   * Set only when the write was deduplicated against an existing message
   * (HTTP 200). A fresh accept (HTTP 202) is asynchronous and returns `null`.
   */
  message_id: string | null;
}

/** A stored message, as returned by conversation and widget history. */
export interface Message {
  id: string;
  tenant_id: string;
  user_id: string | null;
  channel: string;
  body: string;
  idempotency_key: string;
  status: string;
  created_at: string;
  content_encoding: string;
  dek_key_id: string | null;
  /** Monotonic per-channel position. `null` on rows written before sequencing. */
  channel_sequence: number | null;
  attachments?: Attachment[];
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  channel: string;
  visitor_id: string | null;
  /** Preview text — redacted for encrypted channels. */
  last_message: string;
  last_at: string;
  message_id: string;
  encryption_level: "standard" | "e2ee" | (string & {});
  is_secret: boolean;
  last_content_encoding?: string | null;
  /** Omitted for API-key callers; only panel sessions have per-agent unread. */
  unread_count?: number;
  assignee_user_id?: string;
  assignee_user_email?: string;
  assignee_role_id?: string;
  assignee_role_name?: string;
  assignee_role_color?: string;
  /** Inbox state derived from assignment. Default `open`. */
  status?: "open" | "resolved" | "transferred" | (string & {});
}

export interface ListConversationsParams {
  /** 1–200, default 50. */
  limit?: number;
  /** Substring match on channel key and on plaintext message bodies. */
  q?: string;
  /** Keyset position: `last_at` of the final item on the previous page. */
  before_at?: string;
  /** Keyset position: `channel` of the final item on the previous page. */
  before_channel?: string;
}

export interface ListMessagesParams {
  /** 1–500, default 50. */
  limit?: number;
  /** Keyset position: `created_at` of the oldest item already held. */
  before_message_at?: string;
  before_message_id?: string;
  before_channel_sequence?: number | null;
}

export interface ConversationReplyRequest {
  body?: string;
  attachment_ids?: string[];
  content_encoding?: string;
  /** Generated by the SDK when omitted. */
  idempotency_key?: string;
}

export interface ConversationReplyAccepted {
  accepted: boolean;
  message_id: string;
}

export interface AssignmentResponse {
  channel: string;
  assignee_user_id: string | null;
  assignee_role_id: string | null;
  assignee_user_email: string | null;
  assignee_role_name: string | null;
  assignee_role_external_key: string | null;
  assignee_role_color: string | null;
  status: string;
  assigned_by: string | null;
  assigned_at: string;
  updated_at: string;
}

export interface AssignRequest {
  assignee_user_id?: string | null;
  assignee_role_id?: string | null;
  reason?: string | null;
  status?: string | null;
}

export interface TransferRequest {
  to_user_id?: string | null;
  to_role_id?: string | null;
  reason?: string | null;
  handoff?: HandoffOverrides;
}

export interface HandoffOverrides {
  include_full_history?: boolean;
  include_ai_summary?: boolean;
  include_visitor_meta?: boolean;
  max_history_messages?: number;
}

export interface AssignmentEvent {
  id: string;
  tenant_id: string;
  channel_key: string;
  event_type: string;
  from_user_id: string | null;
  from_role_id: string | null;
  to_user_id: string | null;
  to_role_id: string | null;
  actor_user_id: string | null;
  reason: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Запись реестра: один источник для аналитики и ingest, не чат с человеком. */
export interface Channel {
  id: string;
  slug: string;
  namespace: string;
  /** `namespace:slug`, например `custom:shop`. */
  display_name: string;
  description: string | null;
  channel_type: string;
  status: "active" | "archived" | (string & {});
  config: Record<string, unknown>;
  flow_rule_id: string | null;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListChannelsParams {
  /** 1–200, default 100. */
  limit?: number;
  status?: "active" | "archived";
  namespace?: string;
}

export interface CreateChannelRequest {
  /** `a-z`, `0-9`, `-`, `_`; 1–48 chars. */
  slug: string;
  namespace: CreatableChannelNamespace | (string & {});
  /** 1–128 chars. */
  display_name: string;
  /** Max 512 chars. */
  description?: string;
  config?: Record<string, unknown>;
}

export interface UpdateChannelRequest {
  display_name?: string;
  description?: string | null;
  config?: Record<string, unknown>;
  /** `null` detaches the flow rule; omit the key to leave it untouched. */
  flow_rule_id?: string | null;
  status?: "active" | "archived";
}

export interface ArchiveChannelResponse {
  archived: boolean;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export type AttachmentKind = "image" | "video" | "audio" | "document" | "other";

export interface Attachment {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  kind: AttachmentKind | (string & {});
  download_url?: string | null;
}

export interface AttachmentMetaResponse {
  attachment: Attachment;
}

export interface UploadIntentRequest {
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** Optional client-side checksum, recorded but not enforced on upload. */
  sha256?: string;
  /** Required for API-key callers: the channel the file will be attached to. */
  channel?: string;
  visitor_id?: string;
}

export interface UploadIntentResponse {
  attachment_id: string;
  /** Presigned S3 PUT target. Upload the bytes here, not through the gateway. */
  upload_url: string;
  expires_in_secs: number;
  /** Headers the presigned PUT must carry verbatim. */
  headers: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export interface TeamRole {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  external_key: string | null;
  is_system: boolean;
  permissions: string[];
  member_count: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export interface TrackMetricRequest {
  /** Key of a custom metric defined in the panel. `a-z0-9._-`, 1–64 chars. */
  metric_key: string;
  /** Defaults to `1`. Counters reject negatives; gauges accept them. */
  value?: number;
  /** Required when the metric is scoped to a channel; must match exactly. */
  channel?: string;
}

export interface TrackMetricResponse {
  accepted: boolean;
  metric_key: string;
  value: number;
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

export interface WsTicketResponse {
  /** Single-use, ~60 s TTL. Pass as `?ticket=`, never the API key (ADR-003). */
  ticket: string;
  ws_url: string;
  expires_in_secs: number;
}

/** Connection Manager → client frame (`contracts/ws/wire_event.schema.json`). */
export interface WsWireEvent<T = Record<string, unknown>> {
  /** `2` on the current wire protocol; absent on legacy v1 frames. */
  v?: number;
  type: string;
  event_id: string;
  correlation_id?: string;
  idempotency_key?: string;
  payload: T;
}

// ---------------------------------------------------------------------------
// Delivery / webhooks
// ---------------------------------------------------------------------------

export type DeliveryChannel = "webhook" | "ws" | "rest";

/**
 * Canonical dedup context (`contracts/events/outbound_delivery.schema.json`).
 *
 * `message_id` is the dedup key across every delivery channel. `delivery_id`
 * is unique per attempt and must not be used for deduplication.
 */
export interface OutboundDelivery {
  message_id: string;
  idempotency_key?: string;
  delivery_id: string;
  /** Delivery channel — not `metadata.source`, which is the publishing service. */
  source: DeliveryChannel;
}

/** Body of an outbound webhook POST. */
export interface WebhookEvent<T = unknown> {
  /** e.g. `message.received`, `agent.reply`, `flow.completed`. */
  type: string;
  tenant_id: string;
  /** RFC 3339. */
  timestamp: string;
  /** Present when the platform could resolve a canonical message. */
  message_id?: string;
  delivery?: OutboundDelivery;
  /** The internal event envelope, with `delivery` mirrored in when resolved. */
  data: T;
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

export interface WidgetBootstrapRequest {
  /** Public install id (`wgt_…`). Not a secret. */
  site_id: string;
  visitor_id?: string;
  /** Proof of ownership of `visitor_id`, returned by the first bootstrap. */
  visitor_secret?: string;
  /** ETag from a prior bootstrap; a match omits the config payload. */
  config_etag?: string;
}

export interface WidgetEmbedSessionRequest {
  visitor_id?: string;
  config_etag?: string;
}

export interface WidgetSession {
  visitor_id: string;
  /** Returned only when a new visitor identity was minted. Persist it. */
  visitor_secret?: string;
  /** Visitor JWT for `X-Visitor-Token`. */
  token: string;
  ws_ticket: string;
  ws_url: string;
  config: Record<string, unknown>;
  etag: string;
  preset_id?: string;
  availability_state?: Record<string, unknown>;
}

export interface WidgetSendRequest {
  visitor_id: string;
  body?: string;
  /** Generated by the SDK when omitted. */
  idempotency_key?: string;
  attachment_ids?: string[];
  content_encoding?: string;
}

export interface WidgetSendResponse {
  accepted: boolean;
  /** `true` when the `idempotency_key` matched an existing message. */
  duplicate?: boolean;
  /** Set instead of `accepted` when the tenant is outside business hours. */
  error?: string;
  message?: string;
}

export interface WidgetHistoryParams {
  visitor_id: string;
  /** 1–200, default 100. */
  limit?: number;
  before_at?: string;
  before_id?: string;
  before_sequence?: number | null;
}

export interface WidgetEventRequest {
  /** Must be one of the platform's known widget analytics events. */
  event_name: string;
  /** Defaults to the visitor in the token; a mismatch is rejected with 403. */
  visitor_id?: string;
  preset_id?: string;
  properties?: Record<string, unknown>;
}

export interface WidgetIdentifyRequest {
  visitor_id: string;
  email?: string;
  phone?: string;
  /** Внешний id CRM / мессенджера. Пустая строка сбрасывает. */
  external_id?: string;
}

export interface WidgetIdentifyResponse {
  /** Всегда `true`. Traits в ответе нет. */
  ok: boolean;
}

export interface WidgetCannedPromptRequest {
  visitor_id: string;
  prompt_id: string;
  idempotency_key?: string;
}

export interface WidgetChannelSecurity {
  channel: string;
  encryption_level: string;
  session_id: string | null;
  visitor_public_key: string | null;
  agent_public_keys: unknown;
}

export interface WidgetE2eeStartRequest {
  visitor_id: string;
  /** Base64-encoded visitor public key. */
  visitor_public_key: string;
}

export interface WebhookConfig {
  url: string | null;
  enabled: boolean;
  event_types: string[];
  available_event_types: string[];
  has_secret: boolean;
  last_delivery_at: string | null;
  last_status: string | null;
  last_error: string | null;
}

export interface WebhookConfigUpdate {
  url?: string | null;
  secret?: string | null;
  enabled: boolean;
  event_types: string[];
}

export interface WebhookTestResult {
  ok: boolean;
  status_code: number | null;
  message: string;
}

export interface RagUploadParams {
  /** Заголовок документа в базе знаний. */
  title: string;
  /** Текст для индексации (до ~512k символов). */
  body?: string;
  /**
   * @deprecated Используйте `title` + `body`. Оставлено для совместимости:
   * строковый `content` уходит в `body`, `filename` — запасной title.
   */
  filename?: string;
  /** @deprecated Используйте `body`. */
  content?: string | Uint8Array | Blob;
}

export interface RagDocumentAccepted {
  id: string;
  title: string;
  status: string;
  chunk_count: number;
}

export interface RagDocumentList {
  documents: RagDocumentAccepted[];
}

export interface Contact {
  channel: string;
  email: string | null;
  phone: string | null;
  external_id: string | null;
  updated_at: string;
}

export interface ListContactsParams {
  /** 1–200, default 50. */
  limit?: number;
}

export interface UpsertContactRequest {
  email?: string | null;
  phone?: string | null;
  external_id?: string | null;
}
