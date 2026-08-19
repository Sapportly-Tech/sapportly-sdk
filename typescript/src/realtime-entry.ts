/**
 * `@supportly/sdk/realtime` — сокет интегратора.
 *
 * Отдельный entry: процесс, который только делает ingest, не тащит WebSocket.
 * Node 18/20 без глобального `WebSocket` передают свою фабрику.
 *
 * Для ботов берите {@link SupportlyInbox}, не собирайте ticket вручную.
 */

export {
  SupportlyRealtime,
  type RealtimeOptions,
  type RealtimeState,
  type WebSocketFactory,
  type WebSocketLike,
} from "./realtime";

export { websocketUrl } from "./resources/realtime";
export { extractMessageId, MessageDeduper } from "./dedup";
export { SupportlyInbox, type InboxMessage, type InboxOptions } from "./inbox";
export {
  classifyWireEvent,
  isAgentReply,
  isAgentRole,
  isVisitorMessage,
  nodeWebSocketFactory,
  parseWireEvent,
  type AiDraftPayload,
  type ClassifiedWireEvent,
  type MessageDeliveredPayload,
  type WireKind,
} from "./wire";
export type { WsTicketResponse, WsWireEvent } from "./types";
