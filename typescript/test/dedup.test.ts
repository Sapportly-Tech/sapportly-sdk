import { describe, expect, it } from "vitest";

import { ExternalMessageSeenStore, extractMessageId, MessageDeduper } from "../src/dedup";

describe("MessageDeduper", () => {
  it("reports the first sighting as new and the second as seen", () => {
    const deduper = new MessageDeduper();
    expect(deduper.seen("m1")).toBe(false);
    expect(deduper.seen("m1")).toBe(true);
  });

  it("keeps distinct ids apart", () => {
    const deduper = new MessageDeduper();
    expect(deduper.seen("m1")).toBe(false);
    expect(deduper.seen("m2")).toBe(false);
    expect(deduper.size).toBe(2);
  });

  it("deduplicates the webhook and websocket copies of one message", () => {
    // The dual-delivery case the class exists for.
    const deduper = new MessageDeduper();
    const fromWs = { type: "message.created", delivery: { message_id: "m-42", source: "ws" } };
    const fromWebhook = { delivery: { message_id: "m-42", source: "webhook" } };

    expect(deduper.seen(extractMessageId(fromWs)!)).toBe(false);
    expect(deduper.seen(extractMessageId(fromWebhook)!)).toBe(true);
  });

  it("forgets an id once its TTL has passed", () => {
    const deduper = new MessageDeduper({ ttlMs: 1000 });
    expect(deduper.seen("m1", 0)).toBe(false);
    expect(deduper.seen("m1", 500)).toBe(true);
    expect(deduper.seen("m1", 5000)).toBe(false);
  });

  it("has() does not record the id", () => {
    const deduper = new MessageDeduper();
    expect(deduper.has("m1")).toBe(false);
    expect(deduper.size).toBe(0);
    deduper.seen("m1");
    expect(deduper.has("m1")).toBe(true);
  });

  it("evicts the oldest entries at the cap", () => {
    const deduper = new MessageDeduper({ maxEntries: 3 });
    for (const id of ["a", "b", "c", "d"]) deduper.seen(id);

    expect(deduper.size).toBe(3);
    expect(deduper.has("a")).toBe(false);
    expect(deduper.has("d")).toBe(true);
  });

  it("treats a re-seen id as recent for eviction purposes", () => {
    const deduper = new MessageDeduper({ maxEntries: 2 });
    deduper.seen("a");
    deduper.seen("b");
    deduper.seen("a");
    deduper.seen("c");

    expect(deduper.has("a")).toBe(true);
    expect(deduper.has("b")).toBe(false);
  });

  it("clears", () => {
    const deduper = new MessageDeduper();
    deduper.seen("m1");
    deduper.clear();
    expect(deduper.size).toBe(0);
  });
});

describe("extractMessageId", () => {
  it("prefers delivery.message_id", () => {
    expect(extractMessageId({ delivery: { message_id: "m1" }, message_id: "other" })).toBe("m1");
  });

  it("reads the shapes each channel actually sends", () => {
    expect(extractMessageId({ message_id: "m2" })).toBe("m2");
    expect(extractMessageId({ payload: { message_id: "m3" } })).toBe("m3");
    expect(extractMessageId({ payload: { body: { message_id: "m4" } } })).toBe("m4");
    expect(extractMessageId({ data: { delivery: { message_id: "m5" } } })).toBe("m5");
  });

  it("returns undefined for frames without an id", () => {
    expect(extractMessageId(undefined)).toBeUndefined();
    expect(extractMessageId(null)).toBeUndefined();
    expect(extractMessageId("string")).toBeUndefined();
    expect(extractMessageId({ type: "presence" })).toBeUndefined();
    expect(extractMessageId({ message_id: 42 })).toBeUndefined();
    expect(extractMessageId({ message_id: "" })).toBeUndefined();
  });

  it("ignores delivery_id, which is per-attempt and not a dedup key", () => {
    expect(extractMessageId({ delivery: { delivery_id: "d1" } })).toBeUndefined();
  });
});

describe("MessageSeenStore adapters", () => {
  it("MessageDeduper.claim matches seen", () => {
    const store = new MessageDeduper();
    expect(store.claim("m1")).toBe(false);
    expect(store.claim("m1")).toBe(true);
  });

  it("ExternalMessageSeenStore delegates tryClaim", async () => {
    const claimed = new Set<string>();
    const store = new ExternalMessageSeenStore({
      async tryClaim(id, ttlMs) {
        expect(ttlMs).toBeGreaterThan(0);
        if (claimed.has(id)) return true;
        claimed.add(id);
        return false;
      },
    });
    expect(await store.claim("m1")).toBe(false);
    expect(await store.claim("m1")).toBe(true);
  });
});

