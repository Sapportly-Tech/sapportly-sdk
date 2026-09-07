import { describe, expect, it, vi } from "vitest";

import { SapportlyClient } from "../src/client";
import { collect, paginate, paginatePages } from "../src/pagination";
import { mockFetch, type StubResponse } from "./helpers";

function conversation(channel: string, lastAt: string) {
  return { channel, last_at: lastAt, last_message: "hi", message_id: `m-${channel}` };
}

function message(id: string, createdAt: string, sequence: number) {
  return { id, created_at: createdAt, channel_sequence: sequence, body: id };
}

describe("paginatePages", () => {
  it("stops when a page comes back shorter than the limit", async () => {
    const fetchPage = vi
      .fn<(cursor: number | undefined) => Promise<number[]>>()
      .mockResolvedValueOnce([1, 2, 3])
      .mockResolvedValueOnce([4, 5]);

    const pages = await collect(
      paginatePages({ limit: 3, fetchPage, cursorFrom: (page) => page[page.length - 1] }),
    );

    expect(pages).toEqual([[1, 2, 3], [4, 5]]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("stops on an empty page", async () => {
    const fetchPage = vi
      .fn<(cursor: number | undefined) => Promise<number[]>>()
      .mockResolvedValueOnce([1, 2])
      .mockResolvedValueOnce([]);

    const pages = await collect(
      paginatePages({ limit: 2, fetchPage, cursorFrom: (page) => page[page.length - 1] }),
    );
    expect(pages).toEqual([[1, 2]]);
  });

  it("feeds the previous page's cursor into the next request", async () => {
    const seen: Array<number | undefined> = [];
    const fetchPage = async (cursor: number | undefined) => {
      seen.push(cursor);
      return cursor === undefined ? [1, 2] : cursor >= 4 ? [] : [cursor + 1, cursor + 2];
    };

    await collect(paginatePages({ limit: 2, fetchPage, cursorFrom: (page) => page[page.length - 1] }));
    expect(seen).toEqual([undefined, 2, 4]);
  });

  it("stops when the cursor cannot be derived", async () => {
    const fetchPage = vi
      .fn<(cursor: undefined) => Promise<number[]>>()
      .mockResolvedValue([1, 2]);

    const pages = await collect(
      paginatePages({ limit: 2, fetchPage, cursorFrom: () => undefined }),
    );

    expect(pages).toEqual([[1, 2]]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("respects maxPages", async () => {
    const fetchPage = vi
      .fn<(cursor: number | undefined) => Promise<number[]>>()
      .mockResolvedValue([1, 2]);

    const pages = await collect(
      paginatePages({ limit: 2, maxPages: 3, fetchPage, cursorFrom: () => 1 }),
    );

    expect(pages).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("truncates the final page to satisfy maxItems", async () => {
    const fetchPage = async () => [1, 2, 3];
    const items = await collect(
      paginate({ limit: 3, maxItems: 4, fetchPage, cursorFrom: () => 1 }),
    );
    expect(items).toEqual([1, 2, 3, 1]);
  });
});

describe("collect", () => {
  it("caps the number of items drained", async () => {
    async function* infinite() {
      for (let i = 0; ; i++) yield i;
    }
    expect(await collect(infinite(), 3)).toEqual([0, 1, 2]);
  });
});

describe("conversations.iterate", () => {
  it("pages with before_at and before_channel from the last item", async () => {
    const full = Array.from({ length: 50 }, (_, i) =>
      conversation(`custom:${i}`, `2026-07-30T10:${String(i).padStart(2, "0")}:00Z`),
    );
    const mock = mockFetch([
      { body: { data: full, has_more: true, next_cursor: { before_at: full[49]!.last_at, before_channel: "custom:49" } } },
      { body: { data: [conversation("custom:last", "2026-07-29T00:00:00Z")], has_more: false } },
    ]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });

    const items = await collect(client.conversations.iterate());
    expect(items).toHaveLength(51);

    const second = new URL(mock.requests[1]!.url);
    expect(second.searchParams.get("before_at")).toBe(full[49]!.last_at);
    expect(second.searchParams.get("before_channel")).toBe("custom:49");
  });

  it("passes the search query through to every page", async () => {
    const page = Array.from({ length: 2 }, (_, i) => conversation(`custom:${i}`, "2026-07-30T10:00:00Z"));
    const mock = mockFetch([{ body: page }, { body: [] }]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });

    await collect(client.conversations.iterate({ limit: 2, q: "refund" }));
    expect(new URL(mock.requests[1]!.url).searchParams.get("q")).toBe("refund");
  });

  it("makes exactly one request when the first page is short", async () => {
    const mock = mockFetch([{ body: [conversation("custom:a", "2026-07-30T10:00:00Z")] }]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });

    await collect(client.conversations.iterate());
    expect(mock.calls).toBe(1);
  });
});

describe("conversations.iterateMessages", () => {
  it("walks backwards using the oldest item of each page", async () => {
    // The endpoint returns a page in chronological order but pages backwards
    // in time, so the cursor comes from page[0], not the last element.
    const first = Array.from({ length: 3 }, (_, i) =>
      message(`m${i + 3}`, `2026-07-30T12:0${i + 3}:00Z`, i + 3),
    );
    const second = [message("m1", "2026-07-30T12:01:00Z", 1)];

    const mock = mockFetch([{ body: first }, { body: second }]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });

    const items = await collect(client.conversations.iterateMessages("widget:abc", { limit: 3 }));
    expect(items.map((m) => m.id)).toEqual(["m3", "m4", "m5", "m1"]);

    const next = new URL(mock.requests[1]!.url);
    expect(next.searchParams.get("before_message_at")).toBe("2026-07-30T12:03:00Z");
    expect(next.searchParams.get("before_message_id")).toBe("m3");
    expect(next.searchParams.get("before_channel_sequence")).toBe("3");
  });

  it("omits a null channel_sequence from the cursor", async () => {
    // Rows written before sequencing have no sequence; sending "null" as a
    // query value would be a parse error server-side.
    const first = [
      { id: "m2", created_at: "2026-07-30T12:02:00Z", channel_sequence: null, body: "b" },
      { id: "m3", created_at: "2026-07-30T12:03:00Z", channel_sequence: null, body: "c" },
    ];
    const mock = mockFetch([{ body: first }, { body: [] }]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });

    await collect(client.conversations.iterateMessages("widget:abc", { limit: 2 }));
    expect(new URL(mock.requests[1]!.url).searchParams.has("before_channel_sequence")).toBe(false);
  });

  it("yields whole pages when asked", async () => {
    const responses: StubResponse[] = [
      { body: [message("m1", "2026-07-30T12:01:00Z", 1), message("m2", "2026-07-30T12:02:00Z", 2)] },
      { body: [] },
    ];
    const mock = mockFetch(responses);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });

    const pages = await collect(
      client.conversations.iterateMessagePages("widget:abc", { limit: 2 }),
    );
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
  });

  it("honours maxItems across pages", async () => {
    const page = Array.from({ length: 2 }, (_, i) =>
      message(`m${i}`, `2026-07-30T12:0${i}:00Z`, i),
    );
    const mock = mockFetch([{ body: page }]);
    const client = new SapportlyClient({ apiKey: "sk", fetch: mock.fetch, sleep: mock.sleep });

    const items = await collect(
      client.conversations.iterateMessages("widget:abc", { limit: 2, maxItems: 3 }),
    );
    expect(items).toHaveLength(3);
  });
});
