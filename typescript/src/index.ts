/**
 * `@sapportly/sdk` — Sapportly TypeScript SDK, официальный клиент публичного API Supportly.
 *
 * Пакет на npm — `@sapportly/sdk`, не `@supportly/sdk`: scope `supportly` для этого SDK
 * недоступен. Продукт, API (`api.supportly.cc`) и классы (`SupportlyClient`) — Supportly.
 *
 * Runtime-agnostic: нужен только глобальный `fetch`
 * (Node 18+, Bun, Deno, Cloudflare Workers, браузеры). Без runtime-зависимостей.
 *
 * Верификацию webhook можно импортировать отдельно, без HTTP-клиента:
 *
 * ```ts
 * import { verifyWebhook } from "@sapportly/sdk/webhooks";
 * ```
 */

export { SupportlyClient, type SupportlyClientOptions } from "./client";

export {
  type AuthMode,
  type ClientOptions,
  type HttpMethod,
  parseRateLimit,
  type RateLimitInfo,
  type RequestOptions,
  type RetryOptions,
} from "./transport";

export {
  isRetryableError,
  SupportlyAuthError,
  SupportlyConfigError,
  SupportlyConnectionError,
  SupportlyError,
  type SupportlyErrorInit,
  type SupportlyErrorName,
  SupportlyNotFoundError,
  SupportlyPayloadTooLargeError,
  SupportlyPaymentRequiredError,
  SupportlyPermissionError,
  SupportlyRateLimitError,
  SupportlyServerError,
  SupportlyTimeoutError,
  SupportlyValidationError,
} from "./errors";

export {
  collect,
  paginate,
  type PaginateConfig,
  paginatePages,
  type PaginationLimits,
  type ListEnvelope,
  unwrapList,
} from "./pagination";

export { generateIdempotencyKey } from "./idempotency";

export {
  bindThreadKey,
  channelIdentifier,
  channelKey,
  channelNamespace,
  composeThreadChannel,
  conversationMatchesSource,
  deriveThreadId,
  isThreadChannel,
  isWidgetVisitorChannel,
  parseConversationKey,
  sourceChannel,
  threadIdFromChannel,
  visitorIdFromWidgetChannel,
  widgetChannel,
  THREAD_ID_NAMESPACE,
  WIDGET_REGISTRY_CHANNEL,
  WIDGET_REGISTRY_SLUG,
  type ParsedConversationKey,
} from "./channels";

export { extractMessageId, MessageDeduper, type MessageDeduperOptions } from "./dedup";

export { websocketUrl } from "./resources/realtime";

export { SupportlyInbox, type InboxMessage, type InboxOptions } from "./inbox";
export {
  classifyWireEvent,
  isAgentReply,
  isAgentRole,
  isVisitorMessage,
  nodeWebSocketFactory,
  parseWireEvent,
  type AiDraftPayload,
  type ClassifiedWireEvent,
  type MessageDeliveredPayload,
  type WireKind,
} from "./wire";

export {
  type UploadContent,
  type UploadParams,
} from "./resources/attachments";

export {
  isValidWebhook,
  signWebhookBody,
  timingSafeEqual,
  verifyWebhook,
  verifyWebhookRequest,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  type WebhookBody,
  type WebhookHeaders,
  WebhookVerificationError,
  type WebhookVerificationFailure,
  type VerifyWebhookOptions,
} from "./webhooks";

export { VERSION } from "./version";

export * from "./types";
