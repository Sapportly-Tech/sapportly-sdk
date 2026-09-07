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

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100_000;

/**
 * Shared contract for “have we already handled this `message_id`?”.
 *
 * Default: {@link MessageDeduper} (in-memory, one process).
 * Fleet / restart-safe: implement with Redis/SQL via {@link ExternalMessageSeenStore}.
 *
 * `claim` returns `true` when the id was **already** claimed (caller must skip).
 *
 * Default is **at-most-once** after a successful claim. Optional {@link MessageSeenStore.release}
 * + inbox `releaseOnHandlerError` enables at-least-once retry after a handler throw
 * (fleet: Redis `DEL` via {@link ExternalSeenStoreHooks.tryRelease}).
 */
export interface MessageSeenStore {
  claim(messageId: string, now?: number): boolean | Promise<boolean>;
  /**
   * Undo a prior claim so the same `message_id` can be processed again.
   * Invoked by {@link SapportlyInbox} only when `releaseOnHandlerError` is set.
   */
  release?(messageId: string): void | Promise<void>;
}

export interface MessageDeduperOptions {
  /** How long an id stays remembered. Default 24 h. */
  ttlMs?: number;
  /** Hard cap on retained ids; the oldest are dropped first. Default 100 000. */
  maxEntries?: number;
}

/**
 * In-memory, per-process seen-set. Implements {@link MessageSeenStore}.
 *
 * Good enough for a single worker. Across a fleet, or across restarts, pass a
 * {@link ExternalMessageSeenStore} into {@link SapportlyInbox} instead.
 */
export class MessageDeduper implements MessageSeenStore {
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

  /** {@link MessageSeenStore} — same semantics as {@link seen}. */
  claim(messageId: string, now = Date.now()): boolean {
    return this.seen(messageId, now);
  }

  /** Drop a claim so a later dual-delivery can re-enter (opt-in via inbox). */
  release(messageId: string): void {
    this.seenAt.delete(messageId);
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

/**
 * Hooks for a shared store. Prefer an **atomic** `tryClaim` (Redis `SET NX EX`,
 * SQL `INSERT … ON CONFLICT DO NOTHING` returning whether the row was inserted).
 * Non-atomic check-then-set races under concurrent dual delivery — {@link SapportlyInbox}
 * serializes claims per `message_id`, but fleet-wide safety still needs atomic tryClaim.
 *
 * ```ts
 * // Redis (ioredis-style):
 * const store = new ExternalMessageSeenStore({
 *   async tryClaim(id, ttlMs) {
 *     // SET NX: null → key existed → duplicate (return true to skip)
 *     const ok = await redis.set(`sapportly:seen:${id}`, "1", "PX", ttlMs, "NX");
 *     return ok === null;
 *   },
 * });
 * ```
 */
export interface ExternalSeenStoreHooks {
  /**
   * Atomically claim `messageId` for `ttlMs`.
   * Return `true` if it was already claimed (duplicate → skip).
   * Return `false` if this call won the claim (process the message).
   */
  tryClaim(messageId: string, ttlMs: number): boolean | Promise<boolean>;
  /**
   * Optional undo for `releaseOnHandlerError` (e.g. Redis `DEL`).
   * Omit to keep strict at-most-once on handler failure.
   */
  tryRelease?(messageId: string): void | Promise<void>;
}

export interface ExternalMessageSeenStoreOptions {
  ttlMs?: number;
}

/**
 * Adapter around Redis/SQL/etc. No Redis client is bundled — inject `tryClaim`.
 */
export class ExternalMessageSeenStore implements MessageSeenStore {
  private readonly ttlMs: number;
  private readonly hooks: ExternalSeenStoreHooks;

  constructor(hooks: ExternalSeenStoreHooks, options: ExternalMessageSeenStoreOptions = {}) {
    this.hooks = hooks;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  claim(messageId: string, _now?: number): boolean | Promise<boolean> {
    return this.hooks.tryClaim(messageId, this.ttlMs);
  }

  release(messageId: string): void | Promise<void> {
    return this.hooks.tryRelease?.(messageId);
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
