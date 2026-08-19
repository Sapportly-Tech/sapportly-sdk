import type { RequestOptions, Transport } from "../transport";
import type { WsTicketResponse } from "../types";

/** `POST /v1/ws/ticket` — scope `ws:connect`. */
export class RealtimeResource {
  constructor(private readonly transport: Transport) {}

  /**
   * Mints a single-use WebSocket ticket (~60 s TTL).
   *
   * The ticket, not the API key, goes in the query string: query strings land
   * in proxy logs and browser history, and a leaked ticket expires in a minute
   * (ADR-003).
   */
  createTicket(options?: RequestOptions): Promise<WsTicketResponse> {
    return this.transport.request<WsTicketResponse>({
      method: "POST",
      path: "/v1/ws/ticket",
      auth: "apiKey",
      // Each call burns a Redis slot but issues an independent ticket, so a
      // replay is harmless.
      idempotent: true,
      options,
    });
  }
}

/**
 * Builds the connect URL for a ticket.
 *
 * ```ts
 * const { ticket, ws_url } = await client.realtime.createTicket();
 * const socket = new WebSocket(websocketUrl(ws_url, ticket));
 * ```
 */
export function websocketUrl(wsUrl: string, ticket: string): string {
  const separator = wsUrl.includes("?") ? "&" : "?";
  return `${wsUrl}${separator}ticket=${encodeURIComponent(ticket)}`;
}
