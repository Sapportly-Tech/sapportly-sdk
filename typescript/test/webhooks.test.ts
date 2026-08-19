import { describe, expect, it } from "vitest";

import {
  isValidWebhook,
  signWebhookBody,
  timingSafeEqual,
  verifyWebhook,
  verifyWebhookRequest,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS,
  WebhookVerificationError,
} from "../src/webhooks";

const SECRET = "whsec_test_2f8c1a4b9e";
const BODY = JSON.stringify({
  event: "message.created",
  delivery: { message_id: "01J8Z3Q5", idempotency_key: "k-1", delivery_id: "d-1", source: "webhook" },
});
const NOW = 1_780_000_000;

async function headersFor(body = BODY, at = NOW, secret = SECRET) {
  return {
    timestamp: String(at),
    signature: await signWebhookBody(secret, at, body),
  };
}

/** Reason code for a rejection, or `null` if verification passed. */
async function reasonFor(
  body: string,
  headers: { timestamp: unknown; signature: unknown },
  nowSeconds = NOW,
): Promise<string | null> {
  try {
    await verifyWebhook(
      SECRET,
      body,
      headers as { timestamp: string; signature: string },
      { nowSeconds },
    );
    return null;
  } catch (error) {
    if (error instanceof WebhookVerificationError) return error.reason;
    throw error;
  }
}

describe("signWebhookBody", () => {
  it("signs the timestamp together with the body", async () => {
    const signature = await signWebhookBody(SECRET, NOW, BODY);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("produces a different signature for the same body at a different time", async () => {
    // This is what makes a captured request non-replayable once it goes stale.
    const a = await signWebhookBody(SECRET, NOW, BODY);
    const b = await signWebhookBody(SECRET, NOW + 1, BODY);
    expect(a).not.toBe(b);
  });

  it("accepts bytes and text interchangeably", async () => {
    const fromText = await signWebhookBody(SECRET, NOW, BODY);
    const fromBytes = await signWebhookBody(SECRET, NOW, new TextEncoder().encode(BODY));
    expect(fromBytes).toBe(fromText);
  });

  it("matches a known-good vector from the Rust signer", async () => {
    // Pins the wire format: HMAC-SHA256 over "{timestamp}.{body}", lowercase hex.
    const signature = await signWebhookBody("secret", 1_700_000_000, "hello");
    expect(signature).toBe(
      "sha256=47b1df0ab12338b2685470b0d2b37033add7c3b2bc8172f313e77413f1bb78c8",
    );
  });
});

describe("verifyWebhook", () => {
  it("accepts a valid signature", async () => {
    expect(await reasonFor(BODY, await headersFor())).toBeNull();
  });

  it("rejects a tampered body", async () => {
    const headers = await headersFor();
    const tampered = BODY.replace("message.created", "message.deleted");
    expect(await reasonFor(tampered, headers)).toBe("signature_mismatch");
  });

  it("rejects a single flipped byte", async () => {
    const headers = await headersFor();
    expect(await reasonFor(`${BODY} `, headers)).toBe("signature_mismatch");
  });

  it("rejects the wrong secret", async () => {
    const headers = await headersFor(BODY, NOW, "whsec_someone_elses_secret");
    expect(await reasonFor(BODY, headers)).toBe("signature_mismatch");
  });

  it("rejects a stale timestamp beyond the tolerance window", async () => {
    const headers = await headersFor(BODY, NOW - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS - 1);
    expect(await reasonFor(BODY, headers)).toBe("stale_timestamp");
  });

  it("rejects a timestamp too far in the future", async () => {
    // Guards against a sender with a badly skewed clock, in both directions.
    const headers = await headersFor(BODY, NOW + WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS + 1);
    expect(await reasonFor(BODY, headers)).toBe("stale_timestamp");
  });

  it("accepts a timestamp at the edge of the window", async () => {
    const headers = await headersFor(BODY, NOW - WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS);
    expect(await reasonFor(BODY, headers)).toBeNull();
  });

  it("still rejects a stale request whose signature is otherwise valid", async () => {
    // The replay case: attacker resends a genuine request captured yesterday.
    const capturedAt = NOW - 86_400;
    const headers = await headersFor(BODY, capturedAt);
    expect(await reasonFor(BODY, headers, NOW)).toBe("stale_timestamp");
    // ...and it verifies fine if you pretend no time has passed, proving the
    // rejection came from freshness rather than a broken signature.
    expect(await reasonFor(BODY, headers, capturedAt)).toBeNull();
  });

  it("rejects a missing timestamp header", async () => {
    const { signature } = await headersFor();
    expect(await reasonFor(BODY, { timestamp: null, signature })).toBe("missing_timestamp");
    expect(await reasonFor(BODY, { timestamp: "", signature })).toBe("missing_timestamp");
  });

  it("rejects a non-numeric timestamp", async () => {
    const { signature } = await headersFor();
    expect(await reasonFor(BODY, { timestamp: "not-a-number", signature })).toBe(
      "invalid_timestamp",
    );
  });

  it("rejects a missing signature header", async () => {
    expect(await reasonFor(BODY, { timestamp: String(NOW), signature: null })).toBe(
      "missing_signature",
    );
  });

  it("rejects a signature without the sha256 prefix", async () => {
    const { signature } = await headersFor();
    expect(
      await reasonFor(BODY, { timestamp: String(NOW), signature: signature.slice(7) }),
    ).toBe("malformed_signature");
  });

  it("rejects a truncated signature rather than matching on a prefix", async () => {
    const { signature } = await headersFor();
    expect(
      await reasonFor(BODY, { timestamp: String(NOW), signature: signature.slice(0, 40) }),
    ).toBe("signature_mismatch");
  });

  it("honours a caller-supplied tolerance", async () => {
    const headers = await headersFor(BODY, NOW - 600);
    await expect(
      verifyWebhook(SECRET, BODY, headers, { nowSeconds: NOW, toleranceSeconds: 900 }),
    ).resolves.toBeUndefined();
  });

  it("accepts a numeric timestamp header", async () => {
    const signature = await signWebhookBody(SECRET, NOW, BODY);
    await expect(
      verifyWebhook(SECRET, BODY, { timestamp: NOW, signature }, { nowSeconds: NOW }),
    ).resolves.toBeUndefined();
  });
});

describe("isValidWebhook", () => {
  it("returns true for a valid request", async () => {
    expect(await isValidWebhook(SECRET, BODY, await headersFor(), { nowSeconds: NOW })).toBe(true);
  });

  it("returns false instead of throwing on a bad signature", async () => {
    const headers = await headersFor(BODY, NOW, "wrong");
    expect(await isValidWebhook(SECRET, BODY, headers, { nowSeconds: NOW })).toBe(false);
  });
});

describe("verifyWebhookRequest", () => {
  it("verifies a Request and returns the parsed event", async () => {
    const { timestamp, signature } = await headersFor();
    const request = new Request("https://example.test/hooks", {
      method: "POST",
      headers: {
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_SIGNATURE_HEADER]: signature,
      },
      body: BODY,
    });

    const event = await verifyWebhookRequest<{ event: string }>(SECRET, request, {
      nowSeconds: NOW,
    });
    expect(event.event).toBe("message.created");
  });

  it("throws before parsing when the signature is wrong", async () => {
    const { timestamp } = await headersFor();
    const request = new Request("https://example.test/hooks", {
      method: "POST",
      headers: {
        [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
        [WEBHOOK_SIGNATURE_HEADER]: `sha256=${"0".repeat(64)}`,
      },
      body: BODY,
    });

    await expect(verifyWebhookRequest(SECRET, request, { nowSeconds: NOW })).rejects.toThrow(
      WebhookVerificationError,
    );
  });
});

describe("timingSafeEqual", () => {
  it("compares equal and unequal strings correctly", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("does not short-circuit on the first differing character", () => {
    // Both comparisons must do the same amount of work; this asserts the
    // result rather than the timing, which a unit test cannot measure reliably.
    const base = "a".repeat(64);
    expect(timingSafeEqual(base, `b${base.slice(1)}`)).toBe(false);
    expect(timingSafeEqual(base, `${base.slice(0, 63)}b`)).toBe(false);
  });
});
