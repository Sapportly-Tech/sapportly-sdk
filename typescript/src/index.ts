/**
 * `@sapportly/sdk` — Sapportly TypeScript SDK, официальный клиент публичного API Sapportly.
 *
 * Пакет на npm — `@sapportly/sdk`, не `@supportly/sdk`: scope `supportly` для этого SDK
 * недоступен. Продукт, API (`api.sapportly.pro`) и классы (`SapportlyClient`) — Sapportly.
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

export { SapportlyClient, type SapportlyClientOptions } from "./client";

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
  SapportlyAuthError,
  SapportlyConfigError,
  SapportlyConnectionError,
  SapportlyError,
  type SapportlyErrorInit,
  type SapportlyErrorName,
  SapportlyNotFoundError,
  SapportlyPayloadTooLargeError,
  SapportlyPaymentRequiredError,
  SapportlyPermissionError,
  SapportlyRateLimitError,
  SapportlyServerError,
  SapportlyTimeoutError,
  SapportlyValidationError,
} from "./errors";

export {
  collect,
  paginate,
  type PaginateConfig,
  paginatePages,
  type PaginationLimits,
  type ListEnvelope,
  type ListPage,
  parseListBody,
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

export {
  ExternalMessageSeenStore,
  extractMessageId,
  MessageDeduper,
  type ExternalMessageSeenStoreOptions,
  type ExternalSeenStoreHooks,
  type MessageDeduperOptions,
  type MessageSeenStore,
} from "./dedup";

export {
  catchUpInbox,
  likelyAgentMessage,
  type CatchUpMessage,
  type CatchUpOptions,
  type CatchUpResult,
} from "./catch-up";

export { websocketUrl } from "./resources/realtime";

// Inbox / wire helpers: `@sapportly/sdk/realtime` (HTTP-only apps skip WS code).

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
  WebhookReplayGuard,
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
