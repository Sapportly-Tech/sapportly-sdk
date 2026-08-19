/**
 * Webhook signature verification.
 *
 * The platform signs the **timestamp together with the body** — `"{t}.{body}"`
 * — with HMAC-SHA256, and sends the two halves in separate headers. Verifying
 * only the body would leave a captured request replayable forever, which is
 * exactly what the timestamp is there to prevent. Mirrors
 * `backend/crates/common/src/webhook_sign.rs`.
 *
 * Importable on its own so a webhook route pulls in no HTTP client:
 *
 * ```ts
 * import { verifyWebhook } from "@supportly/sdk/webhooks";
 * ```
 */

/** Unix seconds at which the payload was signed. */
export const WEBHOOK_TIMESTAMP_HEADER = "X-Supportly-Timestamp";

/** `sha256={lowercase-hex}`. */
export const WEBHOOK_SIGNATURE_HEADER = "X-Supportly-Signature";

/** Clock skew the platform tolerates, in seconds. Matches the sender. */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

const SIGNATURE_PREFIX = "sha256=";

/** Why a webhook was rejected. */
export type WebhookVerificationFailure =
  | "missing_timestamp"
  | "invalid_timestamp"
  | "stale_timestamp"
  | "missing_signature"
  | "malformed_signature"
  | "signature_mismatch";

export class WebhookVerificationError extends Error {
  override readonly name = "WebhookVerificationError";
  readonly reason: WebhookVerificationFailure;

  constructor(reason: WebhookVerificationFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** Anything a runtime is likely to hand you as the raw request body. */
export type WebhookBody = string | Uint8Array | ArrayBuffer;

/** The header pair, however your framework exposes headers. */
export interface WebhookHeaders {
  timestamp: string | number | null | undefined;
  signature: string | null | undefined;
}

export interface VerifyWebhookOptions {
  /** Override for tests. Defaults to `Date.now() / 1000`. */
  nowSeconds?: number;
  /** Override the replay window. Widening it weakens replay protection. */
  toleranceSeconds?: number;
}

function toBytes(body: WebhookBody): Uint8Array {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(body);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Web Crypto. Node 19+/browsers/edge: `globalThis.crypto.subtle`.
 * Node 18: subtle живёт на `node:crypto.webcrypto`, не на globalThis.
 */
async function getSubtle(): Promise<SubtleCrypto> {
  const fromGlobal = globalThis.crypto?.subtle;
  if (fromGlobal) return fromGlobal;

  const fromRequire = nodeSubtleFromRequire();
  if (fromRequire) return fromRequire;

  try {
    // Не `import("node:crypto")`: library tsconfig с `types: []`, иначе tsc --emitDeclarationOnly падает.
    const load = new Function("s", "return import(s)") as (s: string) => Promise<{ webcrypto?: Crypto }>;
    const { webcrypto } = await load("node:crypto");
    const nodeSubtle = webcrypto?.subtle as unknown as SubtleCrypto | undefined;
    if (nodeSubtle) return nodeSubtle;
  } catch {
    // Браузер / edge без node:crypto — ниже общий error.
  }

  throw new Error(
    "Web Crypto is unavailable — webhook verification needs `crypto.subtle` (Node 18+: node:crypto.webcrypto; browsers, Deno, Bun)",
  );
}

function nodeSubtleFromRequire(): SubtleCrypto | undefined {
  try {
    const req = new Function(
      "return typeof require === 'function' ? require : undefined",
    )() as ((id: string) => { webcrypto?: Crypto }) | undefined;
    const subtle = req?.("node:crypto")?.webcrypto?.subtle ?? req?.("crypto")?.webcrypto?.subtle;
    return subtle as unknown as SubtleCrypto | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compares two strings without leaking how many leading characters matched.
 *
 * A byte-by-byte comparison that returns on first difference lets an attacker
 * recover a valid signature one character at a time from response timing.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  // Length is not secret: the signature format is fixed and public.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Computes `sha256=<hex>` over `"{timestamp}.{body}"`.
 *
 * Exported mainly so tests and local webhook simulators can produce a valid
 * request; receivers should call {@link verifyWebhook} instead.
 */
export async function signWebhookBody(
  secret: string,
  timestampSeconds: number,
  body: WebhookBody,
): Promise<string> {
  const subtle = await getSubtle();
  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const bodyBytes = toBytes(body);
  const prefix = new TextEncoder().encode(`${Math.trunc(timestampSeconds)}.`);
  const signed = new Uint8Array(prefix.length + bodyBytes.length);
  signed.set(prefix, 0);
  signed.set(bodyBytes, prefix.length);

  const mac = await subtle.sign("HMAC", key, signed as BufferSource);
  return `${SIGNATURE_PREFIX}${toHex(mac)}`;
}

/**
 * Verifies an incoming webhook. Resolves on success, throws
 * {@link WebhookVerificationError} on any failure.
 *
 * `rawBody` must be the **exact bytes** received. Re-serialising a parsed JSON
 * object changes key order and whitespace, and the signature will not match.
 *
 * ```ts
 * app.post("/hooks/supportly", express.raw({ type: "application/json" }), async (req, res) => {
 *   try {
 *     await verifyWebhook(process.env.SUPPORTLY_WEBHOOK_SECRET!, req.body, {
 *       timestamp: req.header("X-Supportly-Timestamp"),
 *       signature: req.header("X-Supportly-Signature"),
 *     });
 *   } catch {
 *     return res.sendStatus(401);
 *   }
 *   const event = JSON.parse(req.body.toString("utf8"));
 *   res.sendStatus(204);
 * });
 * ```
 */
export async function verifyWebhook(
  secret: string,
  rawBody: WebhookBody,
  headers: WebhookHeaders,
  options: VerifyWebhookOptions = {},
): Promise<void> {
  const { timestamp, signature } = headers;

  if (timestamp === null || timestamp === undefined || timestamp === "") {
    throw new WebhookVerificationError(
      "missing_timestamp",
      `missing ${WEBHOOK_TIMESTAMP_HEADER} header`,
    );
  }

  const signedAt = typeof timestamp === "number" ? timestamp : Number(String(timestamp).trim());
  if (!Number.isFinite(signedAt)) {
    throw new WebhookVerificationError(
      "invalid_timestamp",
      `${WEBHOOK_TIMESTAMP_HEADER} is not a unix timestamp`,
    );
  }

  if (!signature) {
    throw new WebhookVerificationError(
      "missing_signature",
      `missing ${WEBHOOK_SIGNATURE_HEADER} header`,
    );
  }
  if (!signature.startsWith(SIGNATURE_PREFIX)) {
    throw new WebhookVerificationError(
      "malformed_signature",
      `${WEBHOOK_SIGNATURE_HEADER} must start with "${SIGNATURE_PREFIX}"`,
    );
  }

  // Freshness is checked before the HMAC: a replayed request should be cheap
  // to reject, and the timestamp is covered by the signature anyway, so an
  // attacker cannot swap in a fresh one.
  const tolerance = options.toleranceSeconds ?? WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = Math.abs(now - signedAt);
  if (skew > tolerance) {
    throw new WebhookVerificationError(
      "stale_timestamp",
      `timestamp is ${skew}s out of date (tolerance ${tolerance}s)`,
    );
  }

  const expected = await signWebhookBody(secret, signedAt, rawBody);
  if (!timingSafeEqual(expected, signature)) {
    throw new WebhookVerificationError("signature_mismatch", "signature does not match body");
  }
}

/** Boolean form of {@link verifyWebhook} for callers that prefer a branch. */
export async function isValidWebhook(
  secret: string,
  rawBody: WebhookBody,
  headers: WebhookHeaders,
  options: VerifyWebhookOptions = {},
): Promise<boolean> {
  try {
    await verifyWebhook(secret, rawBody, headers, options);
    return true;
  } catch (error) {
    if (error instanceof WebhookVerificationError) return false;
    throw error;
  }
}

/**
 * Verifies a `Request` and returns the parsed event.
 *
 * Reads the body as text first, so the signature is checked against the exact
 * bytes rather than a re-serialisation.
 */
export async function verifyWebhookRequest<T = unknown>(
  secret: string,
  request: Request,
  options: VerifyWebhookOptions = {},
): Promise<T> {
  const rawBody = await request.text();
  await verifyWebhook(
    secret,
    rawBody,
    {
      timestamp: request.headers.get(WEBHOOK_TIMESTAMP_HEADER),
      signature: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
    },
    options,
  );
  return JSON.parse(rawBody) as T;
}

export type { OutboundDelivery, WebhookEvent } from "./types";
