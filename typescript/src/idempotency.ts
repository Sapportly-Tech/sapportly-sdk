/**
 * Idempotency key generation.
 *
 * Every write endpoint on the public API takes an `idempotency_key`, and the
 * SDK fills one in when the caller does not. That is what makes the automatic
 * retry in the transport safe: a replayed POST resolves to the same message
 * instead of a duplicate.
 */

let counter = 0;

function webCrypto(): Crypto | undefined {
  return typeof globalThis.crypto === "object" ? globalThis.crypto : undefined;
}

function randomUuidV4(): string | undefined {
  const c = webCrypto();
  if (!c) return undefined;

  if (typeof c.randomUUID === "function") return c.randomUUID();

  if (typeof c.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
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

  return undefined;
}

/**
 * Returns a fresh idempotency key (1–128 chars, as the API requires).
 *
 * Prefers a crypto-random UUID v4. On runtimes without Web Crypto it falls
 * back to time plus a process-local counter, which is enough for the only
 * property an idempotency key needs — uniqueness, not unpredictability.
 */
export function generateIdempotencyKey(): string {
  const uuid = randomUuidV4();
  if (uuid) return uuid;

  counter = (counter + 1) % 0xffff;
  const time = Date.now().toString(16);
  const seq = counter.toString(16).padStart(4, "0");
  const noise = Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `idem-${time}-${seq}-${noise}`;
}
