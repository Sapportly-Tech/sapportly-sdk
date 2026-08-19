import { describe, expect, it } from "vitest";

import { SupportlyClient } from "../src/client";
import {
  SupportlyAuthError,
  SupportlyConfigError,
  SupportlyConnectionError,
  SupportlyNotFoundError,
  SupportlyPayloadTooLargeError,
  SupportlyPaymentRequiredError,
  SupportlyPermissionError,
  SupportlyRateLimitError,
  SupportlyServerError,
  SupportlyTimeoutError,
  SupportlyValidationError,
} from "../src/errors";
import { hangingFetch, mockFetch } from "./helpers";

const API_KEY = "sk_live_test";

function client(mock: ReturnType<typeof mockFetch>, options = {}) {
  return new SupportlyClient({
    apiKey: API_KEY,
    fetch: mock.fetch,
    sleep: mock.sleep,
    ...options,
  });
}

const ACCEPTED = { accepted: true, event_id: "e1", correlation_id: "c1", message_id: null };

describe("request shape", () => {
  it("sends the API key as a bearer token with a JSON body", async () => {
    const mock = mockFetch([{ status: 202, body: ACCEPTED }]);
    await client(mock).ingest.send({ channel: "custom:orders", body: "hi" });

    const [request] = mock.requests;
    expect(request?.url).toBe("https://api.supportly.cc/v1/ingest/messages");
    expect(request?.method).toBe("POST");
    expect(request?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request?.headers["content-type"]).toBe("application/json");
    expect(request?.headers["idempotency-key"]).toBeTruthy();
    expect(request?.headers["x-request-id"]).toBeTruthy();
    expect(request?.body).toMatchObject({ channel: "custom:orders", body: "hi" });
    expect(request?.headers["idempotency-key"]).toBe(
      (request?.body as { idempotency_key: string }).idempotency_key,
    );
  });

  it("honours a custom base URL and strips a trailing slash", async () => {
    const mock = mockFetch([{ body: { status: "ok" } }]);
    await client(mock, { baseUrl: "http://localhost:8080/" }).health();
    expect(mock.requests[0]?.url).toBe("http://localhost:8080/health");
  });

  it("serialises query parameters and omits empty ones", async () => {
    const mock = mockFetch([{ body: [] }]);
    await client(mock).conversations.list({ limit: 25, q: "refund" });

    const url = new URL(mock.requests[0]!.url);
    expect(url.pathname).toBe("/v1/conversations");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("q")).toBe("refund");
    expect(url.searchParams.has("before_at")).toBe(false);
    expect(mock.requests[0]?.headers["x-supportly-list-envelope"]).toBe("1");
  });

  it("percent-encodes channel keys in the path", async () => {
    const mock = mockFetch([{ body: [] }]);
    await client(mock).conversations.messages("widget:8f2c/../admin");
    expect(mock.requests[0]?.url).toContain("/v1/conversations/widget%3A8f2c%2F..%2Fadmin/messages");
  });

  it("merges caller headers but never lets them replace Authorization", async () => {
    const mock = mockFetch([{ body: { status: "ok" } }]);
    await client(mock, { headers: { "X-Trace": "abc", Authorization: "Bearer hijacked" } })
      .conversations.list();

    expect(mock.requests[0]?.headers["x-trace"]).toBe("abc");
    expect(mock.requests[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it("returns undefined for 204 without trying to parse a body", async () => {
    const mock = mockFetch([{ status: 204 }]);
    await expect(client(mock).channels.archive("ch_1")).resolves.toBeUndefined();
  });

  it("swaps the API key at runtime", async () => {
    const mock = mockFetch([{ body: [] }, { body: [] }]);
    const c = client(mock);
    await c.conversations.list();
    c.setApiKey("sk_live_rotated");
    await c.conversations.list();

    expect(mock.requests[1]?.headers.authorization).toBe("Bearer sk_live_rotated");
  });
});

describe("authentication guards", () => {
  it("fails before the network when a scoped call has no API key", async () => {
    const mock = mockFetch([{ body: [] }]);
    const anonymous = new SupportlyClient({ fetch: mock.fetch });

    await expect(anonymous.conversations.list()).rejects.toThrow(SupportlyConfigError);
    expect(mock.calls).toBe(0);
  });

  it("allows unauthenticated ops endpoints without a key", async () => {
    const mock = mockFetch([{ body: { version: "1.3", phase: "ga" } }]);
    await expect(new SupportlyClient({ fetch: mock.fetch }).status()).resolves.toMatchObject({
      version: "1.3",
    });
  });

  it("throws when no fetch implementation exists", () => {
    const original = globalThis.fetch;
    // @ts-expect-error — deliberately removing the global for this assertion.
    delete globalThis.fetch;
    try {
      expect(() => new SupportlyClient({ apiKey: API_KEY })).toThrow(SupportlyConfigError);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("error mapping", () => {
  const cases: Array<[number, unknown, new (...args: never[]) => Error]> = [
    [400, { error: "channel is required" }, SupportlyValidationError],
    [401, { error: "invalid api key" }, SupportlyAuthError],
    [403, { error: "missing scope messages:write" }, SupportlyPermissionError],
    [404, { error: "not found" }, SupportlyNotFoundError],
    [409, { error: "conflict" }, SupportlyValidationError],
    [413, { error: "payload too large" }, SupportlyPayloadTooLargeError],
    [422, { error: "invalid channel namespace" }, SupportlyValidationError],
    [429, { error: "rate limited" }, SupportlyRateLimitError],
    [500, { error: "boom" }, SupportlyServerError],
    [503, { error: "unavailable" }, SupportlyServerError],
  ];

  for (const [status, body, expected] of cases) {
    it(`maps ${status} to ${expected.name}`, async () => {
      const mock = mockFetch([{ status, body }]);
      await expect(
        client(mock, { retry: { maxRetries: 0 } }).conversations.list(),
      ).rejects.toBeInstanceOf(expected);
    });
  }

  it("carries status, request id, parsed body and message", async () => {
    const mock = mockFetch([
      {
        status: 403,
        body: { error: "missing scope conversations:read" },
        headers: { "x-request-id": "req_9f2" },
      },
    ]);

    const error = await client(mock).conversations.list().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SupportlyPermissionError);

    const permission = error as SupportlyPermissionError;
    expect(permission.status).toBe(403);
    expect(permission.requestId).toBe("req_9f2");
    expect(permission.message).toBe("missing scope conversations:read");
    expect(permission.body).toEqual({ error: "missing scope conversations:read" });
    expect(permission.method).toBe("GET");
  });

  it("prefers structured message/code/docs_url and body request_id", async () => {
    const mock = mockFetch([
      {
        status: 400,
        body: {
          error: "legacy",
          type: "invalid_request_error",
          code: "validation_error",
          message: "channel is required",
          request_id: "req_body",
          docs_url: "https://docs.supportly.cc/docs/api/errors#validation_error",
        },
      },
    ]);

    const error = (await client(mock).conversations.list().catch((e: unknown) => e)) as SupportlyValidationError;
    expect(error).toBeInstanceOf(SupportlyValidationError);
    expect(error.message).toBe("channel is required");
    expect(error.code).toBe("validation_error");
    expect(error.type).toBe("invalid_request_error");
    expect(error.docsUrl).toBe("https://docs.supportly.cc/docs/api/errors#validation_error");
    expect(error.requestId).toBe("req_body");
  });

  it("exposes quota details on 402", async () => {
    const mock = mockFetch([
      { status: 402, body: { error: "quota exceeded", resource: "messages", used: 1000, limit: 1000 } },
    ]);

    const error = (await client(mock)
      .ingest.send({ channel: "custom:x", body: "y" })
      .catch((e: unknown) => e)) as SupportlyPaymentRequiredError;

    expect(error).toBeInstanceOf(SupportlyPaymentRequiredError);
    expect(error.resource).toBe("messages");
    expect(error.limit).toBe(1000);
  });

  it("falls back to the status text when the body is not JSON", async () => {
    const mock = mockFetch([{ status: 502, body: "<html>bad gateway</html>" }]);
    const error = (await client(mock, { retry: { maxRetries: 0 } })
      .conversations.list()
      .catch((e: unknown) => e)) as SupportlyServerError;

    expect(error.status).toBe(502);
    expect(error.body).toBe("<html>bad gateway</html>");
  });

  it("wraps network failures as connection errors", async () => {
    const mock = mockFetch([{ error: new TypeError("fetch failed") }]);
    await expect(
      client(mock, { retry: { maxRetries: 0 } }).conversations.list(),
    ).rejects.toBeInstanceOf(SupportlyConnectionError);
  });

  it("reports a timeout distinctly from a generic connection error", async () => {
    const c = new SupportlyClient({ apiKey: API_KEY, fetch: hangingFetch(), timeoutMs: 5 });
    const error = await c.conversations.list().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SupportlyTimeoutError);
    expect((error as SupportlyTimeoutError).aborted).toBe(false);
  });

  it("marks caller-initiated aborts so they are not retried", async () => {
    const controller = new AbortController();
    const c = new SupportlyClient({ apiKey: API_KEY, fetch: hangingFetch(), timeoutMs: 0 });

    const pending = c.conversations.list({}, { signal: controller.signal });
    controller.abort();

    const error = (await pending.catch((e: unknown) => e)) as SupportlyTimeoutError;
    expect(error).toBeInstanceOf(SupportlyTimeoutError);
    expect(error.aborted).toBe(true);
  });
});

describe("retry policy", () => {
  it("retries 5xx and returns the eventual success", async () => {
    const mock = mockFetch([
      { status: 503, body: { error: "unavailable" } },
      { status: 500, body: { error: "boom" } },
      { body: [{ channel: "custom:a" }] },
    ]);

    await expect(client(mock).conversations.list()).resolves.toHaveLength(1);
    expect(mock.calls).toBe(3);
    expect(mock.sleeps).toHaveLength(2);
  });

  it("stops at the attempt cap and throws the last error", async () => {
    const mock = mockFetch([{ status: 500, body: { error: "boom" } }]);
    await expect(
      client(mock, { retry: { maxRetries: 2 } }).conversations.list(),
    ).rejects.toBeInstanceOf(SupportlyServerError);

    // maxRetries: 2 means three requests in total.
    expect(mock.calls).toBe(3);
  });

  it("does not retry 4xx that the client caused", async () => {
    const mock = mockFetch([{ status: 400, body: { error: "bad channel" } }]);
    await expect(client(mock).conversations.list()).rejects.toBeInstanceOf(
      SupportlyValidationError,
    );
    expect(mock.calls).toBe(1);
  });

  it("retries network errors", async () => {
    const mock = mockFetch([{ error: new TypeError("fetch failed") }, { body: [] }]);
    await expect(client(mock).conversations.list()).resolves.toEqual([]);
    expect(mock.calls).toBe(2);
  });

  it("grows the delay exponentially and keeps it under the ceiling", async () => {
    const mock = mockFetch([{ status: 500, body: { error: "boom" } }]);
    await client(mock, {
      retry: { maxRetries: 4, initialDelayMs: 100, maxDelayMs: 400, jitter: "none" },
    })
      .conversations.list()
      .catch(() => undefined);

    expect(mock.sleeps).toEqual([100, 200, 400, 400]);
  });

  it("keeps jittered delays inside the exponential envelope", async () => {
    const mock = mockFetch([{ status: 500, body: { error: "boom" } }]);
    await client(mock, { retry: { maxRetries: 3, initialDelayMs: 100, jitter: "full" } })
      .conversations.list()
      .catch(() => undefined);

    expect(mock.sleeps).toHaveLength(3);
    mock.sleeps.forEach((delay, attempt) => {
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(100 * 2 ** attempt);
    });
    // Jitter must actually vary, otherwise a rate-limited fleet retries in lockstep.
    expect(new Set(mock.sleeps).size).toBeGreaterThan(1);
  });
});

describe("429 handling", () => {
  it("waits for Retry-After instead of its own backoff", async () => {
    const mock = mockFetch([
      { status: 429, body: { error: "rate limited" }, headers: { "retry-after": "2" } },
      { body: [] },
    ]);

    await client(mock, { retry: { initialDelayMs: 10 } }).conversations.list();
    expect(mock.sleeps[0]).toBeGreaterThanOrEqual(2000);
    expect(mock.sleeps[0]).toBeLessThan(2000 + 10 + 1);
  });

  it("parses an HTTP-date Retry-After", async () => {
    const at = new Date(Date.now() + 3_000).toUTCString();
    const mock = mockFetch([
      { status: 429, body: { error: "slow down" }, headers: { "retry-after": at } },
      { body: [] },
    ]);

    await client(mock).conversations.list();
    expect(mock.sleeps[0]).toBeGreaterThan(1_000);
  });

  it("gives up rather than parking the caller for an absurd Retry-After", async () => {
    const mock = mockFetch([
      { status: 429, body: { error: "rate limited" }, headers: { "retry-after": "3600" } },
    ]);

    const error = (await client(mock, { retry: { maxRetryAfterMs: 60_000 } })
      .conversations.list()
      .catch((e: unknown) => e)) as SupportlyRateLimitError;

    expect(error).toBeInstanceOf(SupportlyRateLimitError);
    expect(error.retryAfterMs).toBe(3_600_000);
    expect(mock.calls).toBe(1);
  });

  it("surfaces rate-limit headers when the API sends them", async () => {
    const mock = mockFetch([
      {
        body: [],
        headers: {
          "x-ratelimit-limit": "600",
          "x-ratelimit-remaining": "12",
          "x-ratelimit-reset": "30",
        },
      },
    ]);

    const c = client(mock);
    await c.conversations.list();

    expect(c.rateLimit?.limit).toBe(600);
    expect(c.rateLimit?.remaining).toBe(12);
    expect(c.rateLimit?.resetAt).toBeInstanceOf(Date);
  });

  it("leaves rate-limit state undefined when no headers are present", async () => {
    const mock = mockFetch([{ body: [] }]);
    const c = client(mock);
    await c.conversations.list();
    expect(c.rateLimit).toBeUndefined();
  });
});

describe("idempotency and replay safety", () => {
  it("generates an idempotency key when the caller omits one", async () => {
    const mock = mockFetch([{ status: 202, body: ACCEPTED }]);
    await client(mock).ingest.send({ channel: "custom:orders", body: "hi" });

    const key = (mock.requests[0]?.body as { idempotency_key: string }).idempotency_key;
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("keeps a caller-supplied idempotency key", async () => {
    const mock = mockFetch([{ status: 202, body: ACCEPTED }]);
    await client(mock).ingest.send({
      channel: "custom:orders",
      body: "hi",
      idempotency_key: "order-1042",
    });

    expect((mock.requests[0]?.body as { idempotency_key: string }).idempotency_key).toBe(
      "order-1042",
    );
  });

  it("replays a retried write with the same key, so the server deduplicates", async () => {
    const mock = mockFetch([
      { status: 503, body: { error: "unavailable" } },
      { status: 202, body: ACCEPTED },
    ]);

    await client(mock).ingest.send({ channel: "custom:orders", body: "hi" });

    const first = mock.requests[0]?.body as { idempotency_key: string };
    const second = mock.requests[1]?.body as { idempotency_key: string };
    expect(second.idempotency_key).toBe(first.idempotency_key);
  });

  it("never retries a write whose replay would duplicate work", async () => {
    // Transfers append an audit row per call, so the resource opts out.
    const mock = mockFetch([{ status: 503, body: { error: "unavailable" } }]);
    await expect(
      client(mock).conversations.transfer("widget:abc", { to_user_id: "u1" }),
    ).rejects.toBeInstanceOf(SupportlyServerError);

    expect(mock.calls).toBe(1);
  });

  it("retries idempotent PUT assignment", async () => {
    const mock = mockFetch([
      { status: 500, body: { error: "boom" } },
      { body: { channel: "widget:abc", status: "assigned" } },
    ]);

    await client(mock).conversations.assign("widget:abc", { assignee_user_id: "u1" });
    expect(mock.calls).toBe(2);
  });
});
