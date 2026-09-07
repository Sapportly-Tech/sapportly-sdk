/**
 * Typed error hierarchy.
 *
 * Every failure the SDK can produce is a {@link SapportlyError}. Callers
 * discriminate with `instanceof` (or the `name` field, which survives bundling
 * and structured cloning) instead of matching on status codes by hand.
 */

/** Machine-readable discriminator, stable across minified builds. */
export type SapportlyErrorName =
  | "SapportlyError"
  | "SapportlyConfigError"
  | "SapportlyConnectionError"
  | "SapportlyTimeoutError"
  | "SapportlyAuthError"
  | "SapportlyPermissionError"
  | "SapportlyNotFoundError"
  | "SapportlyValidationError"
  | "SapportlyPaymentRequiredError"
  | "SapportlyPayloadTooLargeError"
  | "SapportlyRateLimitError"
  | "SapportlyServerError";

export interface SapportlyErrorInit {
  /** HTTP status. `0` when no response was received (config, network, abort). */
  status?: number;
  /** Parsed JSON error body, or the raw text when the body was not JSON. */
  body?: unknown;
  /** Value of the API's request-correlation header, when the response had one. */
  requestId?: string;
  /** Machine-readable error code from the API (`unauthorized`, `rate_limited`, …). */
  code?: string;
  /** Stripe-style type: `authentication_error`, `invalid_request_error`, … */
  type?: string;
  /** Deep-link to the public docs for this code, when the API sent one. */
  docsUrl?: string;
  /** Response headers, when a response was received. */
  headers?: Headers;
  /** HTTP method of the failed request. */
  method?: string;
  /** Absolute URL of the failed request. */
  url?: string;
  /** How many attempts were made before giving up (1 = no retries). */
  attempts?: number;
  cause?: unknown;
}

/** Base class for everything the SDK throws. */
export class SapportlyError extends Error {
  override readonly name: SapportlyErrorName = "SapportlyError";
  readonly status: number;
  readonly body: unknown;
  readonly requestId?: string;
  readonly code?: string;
  readonly type?: string;
  readonly docsUrl?: string;
  readonly headers?: Headers;
  readonly method?: string;
  readonly url?: string;
  readonly attempts: number;

  constructor(message: string, init: SapportlyErrorInit = {}) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status ?? 0;
    this.body = init.body;
    this.requestId = init.requestId ?? requestIdFromBody(init.body);
    this.code = init.code ?? stringField(init.body, "code");
    this.type = init.type ?? stringField(init.body, "type");
    this.docsUrl = init.docsUrl ?? stringField(init.body, "docs_url");
    this.headers = init.headers;
    this.method = init.method;
    this.url = init.url;
    this.attempts = init.attempts ?? 1;
  }

  /** `sapportly: {message} (status {status})` — stable, greppable in logs. */
  override toString(): string {
    const id = this.requestId ? ` [request ${this.requestId}]` : "";
    return `sapportly: ${this.message} (status ${this.status})${id}`;
  }
}

/** The SDK refused to send the request: missing API key, bad base URL, no `fetch`. */
export class SapportlyConfigError extends SapportlyError {
  override readonly name = "SapportlyConfigError";
}

/** The request never produced a response (DNS, TLS, connection reset, offline). */
export class SapportlyConnectionError extends SapportlyError {
  override readonly name: SapportlyErrorName = "SapportlyConnectionError";
}

/** The request exceeded `timeoutMs`, or the caller's `AbortSignal` fired. */
export class SapportlyTimeoutError extends SapportlyConnectionError {
  override readonly name = "SapportlyTimeoutError";
  /** `true` when the caller's own signal aborted rather than the SDK's timeout. */
  readonly aborted: boolean;

  constructor(message: string, init: SapportlyErrorInit & { aborted?: boolean } = {}) {
    super(message, init);
    this.aborted = init.aborted ?? false;
  }
}

/** 401 — missing, malformed, or revoked API key / credentials. */
export class SapportlyAuthError extends SapportlyError {
  override readonly name = "SapportlyAuthError";
}

/** 403 — authenticated, but missing scope or not allowed to touch this resource. */
export class SapportlyPermissionError extends SapportlyError {
  override readonly name = "SapportlyPermissionError";
}

/** 404 — no such conversation, channel, attachment, or metric. */
export class SapportlyNotFoundError extends SapportlyError {
  override readonly name = "SapportlyNotFoundError";
}

/** 400 / 409 / 422 — the request body or query failed server-side validation. */
export class SapportlyValidationError extends SapportlyError {
  override readonly name = "SapportlyValidationError";
}

/** 402 — the tenant's plan quota is exhausted. */
export class SapportlyPaymentRequiredError extends SapportlyError {
  override readonly name = "SapportlyPaymentRequiredError";
  /** Which quota ran out, e.g. `messages`. */
  readonly resource?: string;
  readonly used?: number;
  readonly limit?: number;

  constructor(
    message: string,
    init: SapportlyErrorInit & { resource?: string; used?: number; limit?: number } = {},
  ) {
    super(message, init);
    this.resource = init.resource;
    this.used = init.used;
    this.limit = init.limit;
  }
}

/** 413 — the body exceeded the gateway's 2 MiB limit. */
export class SapportlyPayloadTooLargeError extends SapportlyError {
  override readonly name = "SapportlyPayloadTooLargeError";
}

/** 429 — the sliding-window rate limiter rejected the request. */
export class SapportlyRateLimitError extends SapportlyError {
  override readonly name = "SapportlyRateLimitError";
  /** Wait hint in milliseconds, from `Retry-After` when the API sends one. */
  readonly retryAfterMs?: number;

  constructor(message: string, init: SapportlyErrorInit & { retryAfterMs?: number } = {}) {
    super(message, init);
    this.retryAfterMs = init.retryAfterMs;
  }
}

/** 5xx — the platform failed to handle an otherwise valid request. */
export class SapportlyServerError extends SapportlyError {
  override readonly name = "SapportlyServerError";
}

function stringField(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : undefined;
}

function requestIdFromBody(body: unknown): string | undefined {
  return stringField(body, "request_id");
}

/** True for errors where retrying the identical request can succeed. */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof SapportlyTimeoutError) return !error.aborted;
  if (error instanceof SapportlyConnectionError) return true;
  if (error instanceof SapportlyRateLimitError) return true;
  if (error instanceof SapportlyServerError) return true;
  return false;
}
