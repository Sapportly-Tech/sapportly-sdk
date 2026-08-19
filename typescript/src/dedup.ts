/**
 * Deduplication for dual delivery.
 *
 * Integrators may run webhooks and a WebSocket at the same time, so the same
 * logical message arrives twice. The dedup key is always `message_id` — it is
 * identical across webhook, WebSocket, and REST. `delivery_id` is unique per
 * attempt and `metadata.event_id` identifies the internal event, so neither
 * one deduplicates anything.
 */

import type { OutboundDelivery } from "./types";

export interface MessageDeduperOptions {
  /** How long an id stays remembered. Default 24 h. */
  ttlMs?: number;
  /** Hard cap on retained ids; the oldest are dropped first. Default 100 000. */
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100_000;

/**
 * In-memory, per-process seen-set.
 *
 * Good enough for a single worker. Across a fleet, or across restarts, put the
 * same `message_id` in a shared store instead — this class deliberately does
 * not pretend to solve distributed dedup.
 */
export class MessageDeduper {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly seenAt = new Map<string, number>();

  constructor(options: MessageDeduperOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  }

  /**
   * Records `messageId` and reports whether it had been seen before.
   *
   * ```ts
   * if (deduper.seen(message_id)) return;
   * ```
   */
  seen(messageId: string, now = Date.now()): boolean {
    const previous = this.seenAt.get(messageId);
    const fresh = previous !== undefined && now - previous < this.ttlMs;

    // Re-inserting moves the key to the end of the Map's insertion order,
    // which is what makes the eviction below least-recently-seen.
    this.seenAt.delete(messageId);
    this.seenAt.set(messageId, now);

    this.evict(now);
    return fresh;
  }

  /** Whether the id is currently remembered, without recording it. */
  has(messageId: string, now = Date.now()): boolean {
    const previous = this.seenAt.get(messageId);
    return previous !== undefined && now - previous < this.ttlMs;
  }

  clear(): void {
    this.seenAt.clear();
  }

  get size(): number {
    return this.seenAt.size;
  }

  private evict(now: number): void {
    for (const [id, at] of this.seenAt) {
      if (now - at < this.ttlMs && this.seenAt.size <= this.maxEntries) break;
      this.seenAt.delete(id);
    }
  }
}

/** Frame shapes that may carry a message id, across delivery channels. */
interface DeliveryCarrier {
  message_id?: unknown;
  delivery?: Partial<OutboundDelivery>;
  payload?: { message_id?: unknown; body?: { message_id?: unknown } };
  data?: { delivery?: Partial<OutboundDelivery> };
}

/**
 * Pulls the canonical `message_id` out of a webhook body or WebSocket frame,
 * preferring `delivery.message_id` and falling back to the older shapes that
 * predate the delivery contract.
 */
export function extractMessageId(frame: unknown): string | undefined {
  if (!frame || typeof frame !== "object") return undefined;
  const f = frame as DeliveryCarrier;

  const candidates = [
    f.delivery?.message_id,
    f.message_id,
    f.data?.delivery?.message_id,
    f.payload?.message_id,
    f.payload?.body?.message_id,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return undefined;
}
