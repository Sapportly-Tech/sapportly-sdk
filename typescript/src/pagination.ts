/**
 * Keyset pagination helpers.
 *
 * List endpoints still accept a bare JSON array (compat). The SDK always asks
 * for the envelope (`X-Supportly-List-Envelope: 1`) and unwraps `{ data }` so
 * callers keep iterating over items. "Is there more?" is still page size:
 * a short page is the last page.
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

/** Accepts both a bare array and `{ data, has_more, next_cursor }`. */
export function unwrapList<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === "object" && "data" in body) {
    const data = (body as ListEnvelope<T>).data;
    if (Array.isArray(data)) return data;
  }
  return [];
}

export interface PaginateConfig<Item, Cursor> extends PaginationLimits {
  /** Page size sent to the API. A page smaller than this ends the iteration. */
  limit: number;
  fetchPage: (cursor: Cursor | undefined) => Promise<Item[]>;
  /** Reads the cursor for the next request off the page just received. */
  cursorFrom: (page: Item[]) => Cursor | undefined;
}

/** Yields one page (array) at a time. Useful for batch processing. */
export async function* paginatePages<Item, Cursor>(
  config: PaginateConfig<Item, Cursor>,
): AsyncGenerator<Item[], void, undefined> {
  const { limit, fetchPage, cursorFrom, maxItems, maxPages } = config;

  let cursor: Cursor | undefined;
  let pages = 0;
  let items = 0;

  for (;;) {
    if (maxPages !== undefined && pages >= maxPages) return;

    const page = await fetchPage(cursor);
    pages += 1;

    if (page.length === 0) return;

    if (maxItems !== undefined && items + page.length >= maxItems) {
      yield page.slice(0, maxItems - items);
      return;
    }

    items += page.length;
    yield page;

    // A short page means the server had nothing left to give.
    if (page.length < limit) return;

    const next = cursorFrom(page);
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
