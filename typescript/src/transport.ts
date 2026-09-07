/**
 * HTTP transport: one `fetch` call per attempt, with timeouts, retry policy,
 * and status-to-error mapping. Everything above this file speaks in typed
 * resources and never touches `Response`.
 */

import { generateIdempotencyKey } from "./idempotency";
import { parseListBody, unwrapList, type ListPage } from "./pagination";
import { warnBareListOnce } from "./diy-list-warn";
import {
  SapportlyAuthError,
  SapportlyConfigError,
  SapportlyConnectionError,
  SapportlyError,
  type SapportlyErrorInit,
  SapportlyNotFoundError,
  SapportlyPayloadTooLargeError,
  SapportlyPaymentRequiredError,
  SapportlyPermissionError,
  SapportlyRateLimitError,
  SapportlyServerError,
  SapportlyTimeoutError,
  SapportlyValidationError,
} from "./errors";
import { DEFAULT_BASE_URL } from "./types";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Which credential a call presents. */
export type AuthMode = "apiKey" | "visitor" | "none";

/** Rate-limit state parsed from response headers, when the API supplies it. */
export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Absolute time the window resets, if the API reports it. */
  resetAt?: Date;
  /** Wait hint from `Retry-After`. */
  retryAfterMs?: number;
}

export interface RetryOptions {
  /**
   * Extra attempts after the first. `2` means up to three requests total.
   * Set to `0` to disable retrying.
   */
  maxRetries?: number;
  /** Delay before the first retry, doubled each attempt. Default 250 ms. */
  initialDelayMs?: number;
  /** Ceiling for a single backoff delay. Default 20 s. */
  maxDelayMs?: number;
  /**
   * `full` picks a uniform delay in `[0, backoff]`; `equal` uses
   * `backoff/2 + random(0, backoff/2)`. Default `full`.
   */
  jitter?: "full" | "equal" | "none";
  /**
   * Cap on how long the SDK will honour a `Retry-After` before failing fast
   * instead of parking the caller. Default 60 s.
   */
  maxRetryAfterMs?: number;
}

export interface ClientOptions {
  /** Tenant API key (`sk_live_…`). Required for every scoped endpoint. */
  apiKey?: string;
  /** Defaults to `https://api.sapportly.pro`. */
  baseUrl?: string;
  /** Per-attempt deadline in ms. Default 30 000. `0` disables it. */
  timeoutMs?: number;
  /** Injected `fetch` — tests, proxies, edge runtimes with a custom pool. */
  fetch?: typeof fetch;
  retry?: RetryOptions;
  /** Extra headers on every request. Cannot override `Authorization`. */
  headers?: Record<string, string>;
  /**
   * Sleep function used between retries. Injected by tests so backoff does not
   * cost real time.
   */
  sleep?: (ms: number) => Promise<void>;
}

/** Per-call overrides. */
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Overrides the client-level retry policy for this call. */
  retry?: RetryOptions;
  /**
   * Declares that replaying this write is safe. Resources set it when the body
   * carries an `idempotency_key`; unsafe writes are never retried.
   */
  idempotent?: boolean;
}

interface InternalRequest {
  method: HttpMethod;
  path: string;
  auth: AuthMode;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  visitorToken?: string;
  options?: RequestOptions;
  /** Writes are retried only when this is `true`. */
  idempotent?: boolean;
  /**
   * Treat the JSON body as a list page: send `X-Sapportly-List-Envelope: 1`
   * and unwrap `{ data }` when the gateway returns an envelope.
   * When `listEnvelope` is also set, the full {@link ListPage} is returned
   * instead of a bare array (P-08).
   */
  asList?: boolean;
  /**
   * Like `asList`, but keep `has_more` / `next_cursor` for pagination.
   * Implies the list-envelope header.
   */
  listEnvelope?: boolean;
}

function isFormBody(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function encodeBody(body: unknown): BodyInit | undefined {
  if (body === undefined) return undefined;
  if (isFormBody(body)) return body;
  return JSON.stringify(body);
}

const DEFAULT_TIMEOUT_MS = 30_000;

const DEFAULT_RETRY: Required<RetryOptions> = {
  maxRetries: 2,
  initialDelayMs: 250,
  maxDelayMs: 20_000,
  jitter: "full",
  maxRetryAfterMs: 60_000,
};

/** Statuses worth replaying: transient by definition, never a client mistake. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Headers the API may use to correlate a request; first match wins. */
const REQUEST_ID_HEADERS = ["x-request-id", "x-correlation-id", "cf-ray"];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function parseNumericHeader(headers: Headers, ...names: string[]): number | undefined {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw === null) continue;
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Reads rate-limit state from a response (`X-RateLimit-*`, `Retry-After`).
 */
export function parseRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = parseNumericHeader(headers, "x-ratelimit-limit", "ratelimit-limit");
  const remaining = parseNumericHeader(headers, "x-ratelimit-remaining", "ratelimit-remaining");
  const reset = parseNumericHeader(headers, "x-ratelimit-reset", "ratelimit-reset");
  const retryAfterMs = parseRetryAfter(headers.get("retry-after"));

  if (limit === undefined && remaining === undefined && reset === undefined && retryAfterMs === undefined) {
    return undefined;
  }

  // `reset` is a delta in seconds in the RFC draft and an epoch second in the
  // older de-facto header. Values below ~1e6 cannot be an epoch.
  let resetAt: Date | undefined;
  if (reset !== undefined) {
    resetAt = reset > 1_000_000 ? new Date(reset * 1000) : new Date(Date.now() + reset * 1000);
  }

  return { limit, remaining, resetAt, retryAfterMs };
}

function backoffDelay(attempt: number, retry: Required<RetryOptions>): number {
  const exponential = Math.min(retry.maxDelayMs, retry.initialDelayMs * 2 ** attempt);
  switch (retry.jitter) {
    case "none":
      return exponential;
    case "equal":
      return exponential / 2 + Math.random() * (exponential / 2);
    default:
      return Math.random() * exponential;
  }
}

function requestId(headers: Headers): string | undefined {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name);
    if (value) return value;
  }
  return undefined;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "string" && body.trim()) return body.trim().slice(0, 500);
  if (body && typeof body === "object") {
    const record = body as { message?: unknown; error?: unknown };
    if (typeof record.message === "string" && record.message) return record.message;
    if (typeof record.error === "string" && record.error) return record.error;
  }
  return fallback;
}

function mapStatusToError(status: number, message: string, init: SapportlyErrorInit): SapportlyError {
  if (status === 401) return new SapportlyAuthError(message, init);
  if (status === 403) return new SapportlyPermissionError(message, init);
  if (status === 404) return new SapportlyNotFoundError(message, init);
  if (status === 413) return new SapportlyPayloadTooLargeError(message, init);

  if (status === 402) {
    const body = init.body as { resource?: string; used?: number; limit?: number } | undefined;
    return new SapportlyPaymentRequiredError(message, {
      ...init,
      resource: body?.resource,
      used: body?.used,
      limit: body?.limit,
    });
  }

  if (status === 429) {
    return new SapportlyRateLimitError(message, {
      ...init,
      retryAfterMs: init.headers ? parseRetryAfter(init.headers.get("retry-after")) : undefined,
    });
  }

  if (status >= 500) return new SapportlyServerError(message, init);
  if (status >= 400) return new SapportlyValidationError(message, init);

  return new SapportlyError(message, init);
}


/** Drop caller Authorization / visitor token variants (any casing) before we set ours. */
function stripSensitiveRequestHeaders(headers: Record<string, string>): void {
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (
      lower === "authorization" ||
      lower === "proxy-authorization" ||
      lower === "x-visitor-token"
    ) {
      delete headers[key];
    }
  }
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle && value) return value;
  }
  return undefined;
}

/**
 * Combines the caller's signal with a per-attempt timeout.
 *
 * `AbortSignal.any` would do this in one line but is not in Node 18, which the
 * package still supports.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; cleanup: () => void; timedOut: () => boolean } {
  if (!timeoutMs && !signal) return { signal: undefined, cleanup: () => {}, timedOut: () => false };
  if (!timeoutMs) return { signal, cleanup: () => {}, timedOut: () => false };

  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

  const forward = () => controller.abort();
  if (signal) {
    if (signal.aborted) forward();
    else signal.addEventListener("abort", forward, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
    timedOut: () => expired,
  };
}

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | boolean | null | undefined>,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  if (!query) return `${base}${suffix}`;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${base}${suffix}?${qs}` : `${base}${suffix}`;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class Transport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retry: Required<RetryOptions>;
  private readonly extraHeaders: Record<string, string>;
  private readonly sleep: (ms: number) => Promise<void>;
  private apiKey: string;

  /** Rate-limit state from the most recent response that carried any. */
  lastRateLimit?: RateLimitInfo;

  constructor(options: ClientOptions = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new SapportlyConfigError(
        "no global fetch available — pass `fetch` in the client options (Node 18+ or a polyfill)",
      );
    }

    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    // Unbound `globalThis.fetch` throws "Illegal invocation" in browsers.
    this.fetchImpl = options.fetch ?? fetchImpl.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.extraHeaders = { ...options.headers };
    this.sleep = options.sleep ?? defaultSleep;
    this.apiKey = options.apiKey ?? "";
  }

  /** Escape hatch for typed list pages that keep has_more / next_cursor. */
  requestListPage<T>(req: Omit<InternalRequest, "listEnvelope" | "asList">): Promise<ListPage<T>> {
    return this.request<ListPage<T>>({ ...req, listEnvelope: true });
  }

  setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  /** Absolute API origin used for WebSocket host allowlisting. */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  async request<T>(req: InternalRequest): Promise<T> {
    const retry: Required<RetryOptions> = {
      ...this.retry,
      ...req.options?.retry,
    };

    const wantsList = Boolean(req.asList || req.listEnvelope);
    const query =
      wantsList && (req.query?.envelope === undefined || req.query?.envelope === null)
        ? { ...req.query, envelope: true }
        : req.query;
    const url = buildUrl(this.baseUrl, req.path, query);
    const headers = this.buildHeaders(req);
    const body = encodeBody(req.body);

    // GET/HEAD are idempotent by definition. Writes replay only when the
    // caller (or a resource method on their behalf) says a replay is safe.
    const replayable = req.method === "GET" || req.idempotent === true;
    const maxAttempts = replayable ? retry.maxRetries + 1 : 1;

    let lastError: SapportlyError | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const isLast = attempt === maxAttempts - 1;

      let result: { value: T } | { error: SapportlyError };
      try {
        result = { value: await this.attempt<T>(req, url, headers, body, attempt + 1) };
      } catch (error) {
        if (!(error instanceof SapportlyError)) throw error;
        result = { error };
      }

      if ("value" in result) return result.value;
      lastError = result.error;

      if (isLast || !this.shouldRetry(lastError)) break;

      const delay = this.retryDelay(lastError, attempt, retry);
      if (delay === undefined) break;
      await this.sleep(delay);
    }

    throw lastError ?? new SapportlyError("request failed", { method: req.method, url });
  }

  /**
   * Single authenticated request returning the raw `Response`, without JSON
   * parsing or retries. For endpoints that answer with a redirect or a stream
   * rather than a JSON document.
   */
  async requestResponse(req: InternalRequest & { redirect?: RequestRedirect }): Promise<Response> {
    const url = buildUrl(this.baseUrl, req.path, req.query);
    const headers = this.buildHeaders(req);
    const timeoutMs = req.options?.timeoutMs ?? this.timeoutMs;
    const { signal, cleanup, timedOut } = withTimeout(req.options?.signal, timeoutMs);

    try {
      return await this.fetchImpl(url, {
        method: req.method,
        headers,
        body: encodeBody(req.body),
        redirect: req.redirect,
        signal,
      });
    } catch (error) {
      const base: SapportlyErrorInit = { method: req.method, url, cause: error };
      if (timedOut()) {
        throw new SapportlyTimeoutError(`request timed out after ${timeoutMs}ms`, base);
      }
      throw new SapportlyConnectionError(
        error instanceof Error ? error.message : "network error",
        base,
      );
    } finally {
      cleanup();
    }
  }

  /** Escape hatch for presigned S3 uploads, which bypass the API entirely. */
  async fetchRaw(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (error) {
      throw new SapportlyConnectionError(
        error instanceof Error ? error.message : "network error",
        { url, cause: error },
      );
    }
  }

  private buildHeaders(req: InternalRequest): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.extraHeaders,
      ...req.options?.headers,
    };
    // SPEC: caller cannot override auth — strip any casing of Authorization / X-Visitor-Token.
    stripSensitiveRequestHeaders(headers);

    if (!headerValue(headers, "x-request-id")) {
      headers["X-Request-Id"] = generateIdempotencyKey();
    }

    if (
      (req.asList || req.listEnvelope) &&
      !headerValue(headers, "x-sapportly-list-envelope")
    ) {
      headers["X-Sapportly-List-Envelope"] = "1";
    }

    const bodyKey =
      req.body && typeof req.body === "object" && !isFormBody(req.body)
        ? (req.body as { idempotency_key?: unknown }).idempotency_key
        : undefined;
    if (typeof bodyKey === "string" && bodyKey && !headerValue(headers, "idempotency-key")) {
      headers["Idempotency-Key"] = bodyKey;
    }

    if (req.body !== undefined && !isFormBody(req.body)) {
      headers["Content-Type"] = "application/json";
    }

    if (req.auth === "apiKey") {
      if (!this.apiKey) {
        throw new SapportlyConfigError(
          `API key required for ${req.method} ${req.path} — pass \`apiKey\` to the client`,
        );
      }
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    if (req.visitorToken) headers["X-Visitor-Token"] = req.visitorToken;

    return headers;
  }

  private async attempt<T>(
    req: InternalRequest,
    url: string,
    headers: Record<string, string>,
    body: BodyInit | undefined,
    attemptNumber: number,
  ): Promise<T> {
    const timeoutMs = req.options?.timeoutMs ?? this.timeoutMs;
    const { signal, cleanup, timedOut } = withTimeout(req.options?.signal, timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: req.method,
        headers,
        body,
        signal,
      });
    } catch (error) {
      const base: SapportlyErrorInit = {
        method: req.method,
        url,
        attempts: attemptNumber,
        cause: error,
      };

      if (timedOut()) {
        throw new SapportlyTimeoutError(`request timed out after ${timeoutMs}ms`, base);
      }
      if (req.options?.signal?.aborted) {
        throw new SapportlyTimeoutError("request aborted by caller", { ...base, aborted: true });
      }
      throw new SapportlyConnectionError(
        error instanceof Error ? error.message : "network error",
        base,
      );
    } finally {
      cleanup();
    }

    const rateLimit = parseRateLimit(response.headers);
    if (rateLimit) this.lastRateLimit = rateLimit;

    if (response.status === 204) return undefined as T;

    const parsed = await readBody(response);

    if (!response.ok) {
      throw mapStatusToError(
        response.status,
        errorMessage(parsed, response.statusText || `HTTP ${response.status}`),
        {
          status: response.status,
          body: parsed,
          headers: response.headers,
          requestId: requestId(response.headers),
          method: req.method,
          url,
          attempts: attemptNumber,
        },
      );
    }

    if (req.listEnvelope) return parseListBody(parsed) as T;
    if (req.asList) {
      warnBareListOnce(req.path);
      return unwrapList(parsed) as T;
    }

    return parsed as T;
  }

  private shouldRetry(error: SapportlyError): boolean {
    if (error instanceof SapportlyConfigError) return false;
    if (error instanceof SapportlyTimeoutError) return !error.aborted;
    if (error instanceof SapportlyConnectionError) return true;
    return RETRYABLE_STATUS.has(error.status);
  }

  /** `undefined` means "do not retry" — used when `Retry-After` is too long. */
  private retryDelay(
    error: SapportlyError,
    attempt: number,
    retry: Required<RetryOptions>,
  ): number | undefined {
    const hint =
      error instanceof SapportlyRateLimitError
        ? error.retryAfterMs
        : error.headers
          ? parseRetryAfter(error.headers.get("retry-after"))
          : undefined;

    if (hint !== undefined) {
      if (hint > retry.maxRetryAfterMs) return undefined;
      // Jitter on top of the server's hint, so a fleet that was rate-limited
      // together does not come back in lockstep.
      return hint + Math.random() * Math.min(1_000, retry.initialDelayMs);
    }

    return backoffDelay(attempt, retry);
  }
}
