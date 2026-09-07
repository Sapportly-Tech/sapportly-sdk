/**
 * Idempotency key generation.
 *
 * Every write endpoint on the public API takes an `idempotency_key`, and the
 * SDK fills one in when the caller does not. That is what makes the automatic
 * retry in the transport safe: a replayed POST resolves to the same message
 * instead of a duplicate.
 *
 * Keys MUST come from a CSPRNG (Web Crypto / `node:crypto`). A weak PRNG
 * fallback would make retries forgeable across processes — we throw instead.
 */

import { SapportlyConfigError } from "./errors";

function webCrypto(): Crypto | undefined {
  return typeof globalThis.crypto === "object" ? globalThis.crypto : undefined;
}

function randomUuidV4(): string | undefined {
  const c = webCrypto();
  if (!c) return undefined;

  if (typeof c.randomUUID === "function") return c.randomUUID();

  if (typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    return uuidFromBytes(bytes);
  }

  return undefined;
}

function uuidFromBytes(bytes: Uint8Array): string {
  // RFC 4122 §4.4: pin the version and variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function nodeRandomUuid(): string | undefined {
  try {
    const req = new Function(
      "return typeof require === 'function' ? require : undefined",
    )() as ((id: string) => { randomUUID?: () => string; webcrypto?: Crypto }) | undefined;
    const nodeCrypto = req?.("node:crypto") ?? req?.("crypto");
    if (typeof nodeCrypto?.randomUUID === "function") return nodeCrypto.randomUUID();
    const subtleCrypto = nodeCrypto?.webcrypto;
    if (typeof subtleCrypto?.randomUUID === "function") return subtleCrypto.randomUUID();
    if (typeof subtleCrypto?.getRandomValues === "function") {
      return uuidFromBytes(subtleCrypto.getRandomValues(new Uint8Array(16)));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Returns a fresh idempotency key (1–128 chars, as the API requires).
 *
 * Prefers a crypto-random UUID v4 (Web Crypto, then `node:crypto`).
 * Throws {@link SapportlyConfigError} when no CSPRNG is available (P-10).
 */
export function generateIdempotencyKey(): string {
  const uuid = randomUuidV4() ?? nodeRandomUuid();
  if (uuid) return uuid;

  throw new SapportlyConfigError(
    "cannot generate idempotency_key: no CSPRNG (need globalThis.crypto or node:crypto). Pass an explicit idempotency_key, or run on Node 18+ / a modern browser.",
  );
}
