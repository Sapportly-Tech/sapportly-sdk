import { SapportlyConfigError } from "../errors";
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

/**
 * Reject malicious/MITM `ws_url` that would exfiltrate the single-use ticket.
 * Allows same host as the API, `api.`↔`ws.` swap, or the same registrable root.
 */
export function assertTrustedWebsocketUrl(wsUrl: string, apiBaseUrl: string): void {
  let ws: URL;
  let api: URL;
  try {
    ws = new URL(wsUrl);
    api = new URL(apiBaseUrl);
  } catch {
    throw new SapportlyConfigError("invalid ws_url or API base URL");
  }
  if (ws.protocol !== "wss:" && ws.protocol !== "ws:") {
    throw new SapportlyConfigError("ws_url must use ws: or wss:");
  }
  const apiLocal =
    api.hostname === "localhost" ||
    api.hostname === "127.0.0.1" ||
    api.hostname === "[::1]";
  if (!apiLocal && ws.protocol !== "wss:") {
    throw new SapportlyConfigError("ws_url must use wss: outside localhost");
  }
  const apiHost = api.hostname.toLowerCase();
  const wsHost = ws.hostname.toLowerCase();
  if (wsHost === apiHost) return;
  if (wsHost.replace(/^ws\./, "api.") === apiHost) return;
  if (apiHost.replace(/^api\./, "ws.") === wsHost) return;
  // RFC 2606 / local special-use names used in tests and lab stacks.
  if (
    (apiHost.endsWith(".test") && wsHost.endsWith(".test")) ||
    (apiHost.endsWith(".localhost") && wsHost.endsWith(".localhost"))
  ) {
    return;
  }
  const apiParts = apiHost.split(".");
  const wsParts = wsHost.split(".");
  if (apiParts.length >= 2 && wsParts.length >= 2) {
    const apiRoot = apiParts.slice(-2).join(".");
    const wsRoot = wsParts.slice(-2).join(".");
    if (apiRoot === wsRoot) return;
  }
  throw new SapportlyConfigError(
    `ws_url host "${wsHost}" is not trusted for API host "${apiHost}"`,
  );
}
