import type { RequestOptions, Transport } from "../transport";
import type { ListPage } from "../pagination";
import type { Contact, ListContactsParams, UpsertContactRequest } from "../types";

/**
 * Visitor identities — `GET/PUT /v1/contacts`.
 *
 * Traits are keyed by channel (`custom:shop`, `widget:{uuid}`). Scope
 * `conversations:read` to list/get, `conversations:write` to upsert.
 *
 * Cap-only list (no keyset cursor). Do **not** DIY-loop while `page.length === limit`.
 */
export class ContactsResource {
  constructor(private readonly transport: Transport) {}

  /**
   * One page as a bare array (envelope unwrapped). Prefer {@link listPage}.
   * There is no safe multi-page iterate without server cursors.
   */
  list(params: ListContactsParams = {}, options?: RequestOptions): Promise<Contact[]> {
    return this.transport.request<Contact[]>({
      method: "GET",
      path: "/v1/contacts",
      auth: "apiKey",
      query: { limit: params.limit },
      asList: true,
      options,
    });
  }

  /** Same as {@link list}, preserving envelope `has_more` (cap-only; no next_cursor). */
  listPage(
    params: ListContactsParams = {},
    options?: RequestOptions,
  ): Promise<ListPage<Contact>> {
    return this.transport.requestListPage<Contact>({
      method: "GET",
      path: "/v1/contacts",
      auth: "apiKey",
      query: { limit: params.limit },
      options,
    });
  }

  get(channel: string, options?: RequestOptions): Promise<Contact> {
    return this.transport.request<Contact>({
      method: "GET",
      path: `/v1/contacts/${encodeURIComponent(channel)}`,
      auth: "apiKey",
      options,
    });
  }

  upsert(channel: string, request: UpsertContactRequest, options?: RequestOptions): Promise<Contact> {
    return this.transport.request<Contact>({
      method: "PUT",
      path: `/v1/contacts/${encodeURIComponent(channel)}`,
      auth: "apiKey",
      body: request,
      idempotent: true,
      options,
    });
  }
}
