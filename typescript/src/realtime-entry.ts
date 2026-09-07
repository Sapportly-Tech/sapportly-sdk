/**
 * `@sapportly/sdk/realtime` — сокет интегратора.
 *
 * Отдельный entry: процесс, который только делает ingest, не тащит WebSocket.
 * Node 18/20 без глобального `WebSocket` передают свою фабрику.
 *
 * Для ботов берите {@link SapportlyInbox}, не собирайте ticket вручную.
 */

export {
  SapportlyRealtime,
  type RealtimeOptions,
  type RealtimeState,
  type WebSocketFactory,
  type WebSocketLike,
} from "./realtime";

export { websocketUrl } from "./resources/realtime";

export {
  ExternalMessageSeenStore,
  extractMessageId,
  MessageDeduper,
  type ExternalMessageSeenStoreOptions,
  type ExternalSeenStoreHooks,
  type MessageDeduperOptions,
  type MessageSeenStore,
} from "./dedup";

export {
  catchUpInbox,
  likelyAgentMessage,
  type CatchUpMessage,
  type CatchUpOptions,
  type CatchUpResult,
} from "./catch-up";

export { SapportlyInbox, type InboxMessage, type InboxOptions } from "./inbox";

export {
  bindThreadKey,
  conversationMatchesSource,
  sourceChannel,
  threadIdFromChannel,
} from "./channels";

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
