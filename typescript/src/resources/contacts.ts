import type { RequestOptions, Transport } from "../transport";
import type { Contact, ListContactsParams, UpsertContactRequest } from "../types";

/**
 * Visitor identities — `GET/PUT /v1/contacts`.
 *
 * Traits are keyed by channel (`custom:shop`, `widget:{uuid}`). Scope
 * `conversations:read` to list/get, `conversations:write` to upsert.
 */
export class ContactsResource {
  constructor(private readonly transport: Transport) {}

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
