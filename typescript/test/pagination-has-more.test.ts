import { describe, expect, it, vi } from "vitest";

import { SapportlyClient } from "../src/client";
import { SapportlyConfigError } from "../src/errors";
import { generateIdempotencyKey } from "../src/idempotency";
import { collect, paginatePages, parseListBody } from "../src/pagination";
import { mockFetch } from "./helpers";

function conversation(channel: string, lastAt: string) {
  return { channel, last_at: lastAt, last_message: "hi", message_id: `m-${channel}` };
}

describe("parseListBody / has_more (P-08)", () => {
  it("preserves has_more and next_cursor from the envelope", () => {
    const page = parseListBody<{ id: number }>({
      data: [{ id: 1 }],
      has_more: false,
      next_cursor: { before_at: "t" },
    });
    expect(page).toEqual({
      items: [{ id: 1 }],
      hasMore: false,
      nextCursor: { before_at: "t" },
    });
  });

  it("stops on a full page when has_more is false (adversarial)", async () => {
    const full = [1, 2, 3];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: full, hasMore: false, nextCursor: { n: 99 } });

    const pages = await collect(
      paginatePages({
        limit: 3,
        fetchPage,
        cursorFrom: () => ({ n: 1 }),
        cursorFromEnvelope: (c) => c as { n: number },
      }),
    );

    expect(pages).toEqual([full]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("continues when has_more is true even if using envelope cursor", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        items: [1, 2, 3],
        hasMore: true,
        nextCursor: { n: 3 },
      })
      .mockResolvedValueOnce({ items: [4], hasMore: false });

    const pages = await collect(
      paginatePages({
        limit: 3,
        fetchPage,
        cursorFrom: () => undefined,
        cursorFromEnvelope: (c) => c as { n: number },
      }),
    );

    expect(pages).toEqual([[1, 2, 3], [4]]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1]![0]).toEqual({ n: 3 });
  });

  it("conversations.iterate stops on full page with has_more=false", async () => {
    const full = Array.from({ length: 50 }, (_, i) =>
      conversation(`custom:${i}`, `2026-07-30T10:${String(i).padStart(2, "0")}:00Z`),
    );
    const mock = mockFetch([
      {
        body: {
          data: full,
          has_more: false,
          next_cursor: { before_at: full[49]!.last_at, before_channel: "custom:49" },
        },
      },
    ]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });

    const items = await collect(client.conversations.iterate({ limit: 50 }));
    expect(items).toHaveLength(50);
    expect(mock.calls).toBe(1);
  });

  it("stops when has_more is true but no cursor is usable (adversarial)", async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      items: [1, 2, 3],
      hasMore: true,
      // nextCursor absent; cursorFrom returns undefined
    });
    const pages = await collect(
      paginatePages({
        limit: 3,
        fetchPage,
        cursorFrom: () => undefined,
      }),
    );
    expect(pages).toEqual([[1, 2, 3]]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("treats malformed non-boolean has_more as stop", () => {
    const page = parseListBody({ data: [{ id: 1 }, { id: 2 }], has_more: "yes" });
    expect(page.hasMore).toBe(false);
  });

  it("messages iterateMessagePages stops on full page has_more=false", async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      channel: "custom:shop",
      role: "visitor",
      body: "x",
      created_at: `2026-07-30T10:${String(i).padStart(2, "0")}:00Z`,
      channel_sequence: i + 1,
    }));
    const mock = mockFetch([
      {
        body: {
          data: full,
          has_more: false,
          next_cursor: { before_message_at: full[0]!.created_at, before_message_id: full[0]!.id },
        },
      },
    ]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });
    const pages = await collect(
      client.conversations.iterateMessagePages("custom:shop", { limit: 50 }),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(50);
    expect(mock.calls).toBe(1);
  });

  it("widget iterateHistoryPages stops on full page has_more=false", async () => {
    const full = Array.from({ length: 50 }, (_, i) => ({
      id: `w${i}`,
      channel: "widget:v",
      role: "visitor",
      body: "x",
      created_at: `2026-07-30T10:${String(i).padStart(2, "0")}:00Z`,
      channel_sequence: i + 1,
    }));
    const mock = mockFetch([
      {
        body: {
          data: full,
          has_more: false,
          next_cursor: { before_at: full[0]!.created_at, before_id: full[0]!.id },
        },
      },
    ]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });
    const pages = await collect(
      client.widget.iterateHistoryPages("vt_test", {
        visitor_id: "11111111-1111-4111-8111-111111111111",
        limit: 50,
      }),
    );
    expect(pages).toHaveLength(1);
    expect(mock.calls).toBe(1);
  });

});

describe("generateIdempotencyKey (P-10)", () => {
  it("returns a UUID-shaped CSPRNG key in normal runtimes", () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("throws SapportlyConfigError when no CSPRNG exists (adversarial)", () => {
    const previous = globalThis.crypto;
    const PrevFunction = globalThis.Function;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {}, // no randomUUID / getRandomValues
    });
    // nodeRandomUuid uses `new Function("…require…")()` — break that path.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Function = function BrokenFunction() {
      throw new Error("no-require");
    };
    try {
      expect(() => generateIdempotencyKey()).toThrow(SapportlyConfigError);
    } finally {
      globalThis.Function = PrevFunction;
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: previous,
      });
    }
  });

  it("source has no Math.random fallback", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(join(here, "../src/idempotency.ts"), "utf8");
    // Comment may mention weak PRNG; code must not call Math.random(...).
    expect(text).not.toMatch(/Math\.random\s*\(/);
    expect(text).toMatch(/SapportlyConfigError/);
  });
});
