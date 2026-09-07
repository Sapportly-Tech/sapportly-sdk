/**
 * Keyset pagination helpers.
 *
 * List endpoints still accept a bare JSON array (compat). The SDK always asks
 * for the envelope (`X-Sapportly-List-Envelope: 1`) and unwraps `{ data }` so
 * callers keep iterating over items. Termination prefers the envelope's
 * `has_more` (and `next_cursor` when present); a short page remains a fallback
 * for bare-array responses.
 */

export interface PaginationLimits {
  /** Stop after yielding this many items. */
  maxItems?: number;
  /** Stop after this many HTTP requests, whatever the item count. */
  maxPages?: number;
}

export interface ListEnvelope<T> {
  data: T[];
  has_more: boolean;
  next_cursor?: unknown;
}

/** One decoded list page — items plus optional envelope metadata (P-08). */
export interface ListPage<T> {
  items: T[];
  /**
   * From `{ has_more }`. When `false`, iteration MUST stop even if the page is
   * full (`length === limit`). When `undefined` (bare array), fall back to
   * `items.length < limit`.
   */
  hasMore?: boolean;
  /** Server-supplied cursor object when the envelope included `next_cursor`. */
  nextCursor?: unknown;
}

/** Accepts both a bare array and `{ data, has_more, next_cursor }`. */
export function unwrapList<T>(body: unknown): T[] {
  return parseListBody<T>(body).items;
}

/** Decode a list response without dropping `has_more` / `next_cursor`. */
export function parseListBody<T>(body: unknown): ListPage<T> {
  if (Array.isArray(body)) return { items: body as T[] };
  if (body && typeof body === "object" && "data" in body) {
    const env = body as ListEnvelope<T>;
    if (Array.isArray(env.data)) {
      return {
        items: env.data,
        // Malformed non-boolean has_more → stop (false), not bare-array continue.
        hasMore:
          typeof env.has_more === "boolean"
            ? env.has_more
            : "has_more" in env
              ? false
              : undefined,
        nextCursor: "next_cursor" in env ? env.next_cursor : undefined,
      };
    }
  }
  return { items: [] };
}

function asListPage<Item>(page: ListPage<Item> | Item[]): ListPage<Item> {
  return Array.isArray(page) ? { items: page } : page;
}

export interface PaginateConfig<Item, Cursor> extends PaginationLimits {
  /** Page size sent to the API. */
  limit: number;
  /**
   * Fetch one page. May return a bare `Item[]` (tests / legacy) or a
   * {@link ListPage} that preserves `has_more` / `next_cursor`.
   */
  fetchPage: (cursor: Cursor | undefined) => Promise<ListPage<Item> | Item[]>;
  /** Reads the cursor for the next request off the page just received. */
  cursorFrom: (page: Item[]) => Cursor | undefined;
  /**
   * Prefer the envelope `next_cursor` when present. Return `undefined` to fall
   * back to {@link cursorFrom}.
   */
  cursorFromEnvelope?: (nextCursor: unknown, page: Item[]) => Cursor | undefined;
}

/** Yields one page (array) at a time. Useful for batch processing. */
export async function* paginatePages<Item, Cursor>(
  config: PaginateConfig<Item, Cursor>,
): AsyncGenerator<Item[], void, undefined> {
  const { limit, fetchPage, cursorFrom, cursorFromEnvelope, maxItems, maxPages } = config;

  let cursor: Cursor | undefined;
  let pages = 0;
  let items = 0;

  for (;;) {
    if (maxPages !== undefined && pages >= maxPages) return;

    const page = asListPage(await fetchPage(cursor));
    pages += 1;

    if (page.items.length === 0) return;

    if (maxItems !== undefined && items + page.items.length >= maxItems) {
      yield page.items.slice(0, maxItems - items);
      return;
    }

    items += page.items.length;
    yield page.items;

    // P-08: envelope has_more=false stops even on a full page.
    if (page.hasMore === false) return;

    // Bare array / missing has_more: short page is the last page.
    if (page.hasMore === undefined && page.items.length < limit) return;

    const fromEnvelope =
      page.nextCursor !== undefined && cursorFromEnvelope
        ? cursorFromEnvelope(page.nextCursor, page.items)
        : undefined;
    const next = fromEnvelope ?? cursorFrom(page.items);
    // Missing cursor (even if has_more=true) — stop rather than loop forever.
    if (next === undefined) return;

    cursor = next;
  }
}

/** Yields individual items across pages. */
export async function* paginate<Item, Cursor>(
  config: PaginateConfig<Item, Cursor>,
): AsyncGenerator<Item, void, undefined> {
  for await (const page of paginatePages(config)) {
    for (const item of page) yield item;
  }
}

/** Drains an async iterable into an array. Guard large sets with `max`. */
export async function collect<T>(source: AsyncIterable<T>, max?: number): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
    if (max !== undefined && out.length >= max) break;
  }
  return out;
}
