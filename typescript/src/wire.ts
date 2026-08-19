/**
 * Кадры wire v2: `{ v, type, event_id, payload }`.
 *
 * `payload.type` дублирует внешний `type` (исторически). Переключайтесь по
 * {@link classifyWireEvent}, не сравнивайте строки руками.
 */

import type { WsWireEvent } from "./types";

/** Inbound visitor (or connector) message, or an operator reply. */
export interface MessageDeliveredPayload {
  type?: "message.delivered";
  message_id?: string;
  correlation_id?: string;
  role?: "visitor" | "agent" | "assistant" | "system" | (string & {});
  channel?: string;
  body?: string;
  content_encoding?: string;
  attachments?: unknown[];
  channel_sequence?: number | null;
}

/** Streaming / final AI draft. Partial frames have `partial: true`. */
export interface AiDraftPayload {
  type?: "ai.draft";
  flow_id?: string;
  message_id?: string;
  channel?: string;
  draft_body?: string;
  confidence?: number | null;
  escalated?: boolean;
  escalation_reason?: string | null;
  partial?: boolean;
  delta?: string | null;
  trigger_preview?: string | null;
  rag_sources?: unknown;
}

export type WireKind = "message" | "ai.draft" | "other";

export interface ClassifiedWireEvent {
  kind: WireKind;
  type: string;
  eventId?: string;
  channel?: string;
  messageId?: string;
  frame: WsWireEvent;
  message?: MessageDeliveredPayload;
  ai?: AiDraftPayload;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Parses a JSON frame. Protocol pings and non-JSON go to `null` so the
 * caller can ignore them instead of throwing.
 *
 * `event_id` is required by the schema but we accept frames that only have
 * `type` — reconnect/control messages from proxies sometimes omit it.
 */
export function parseWireEvent(data: unknown): WsWireEvent | null {
  let parsed: unknown = data;
  if (typeof data === "string") {
    try {
      parsed = JSON.parse(data) as unknown;
    } catch {
      return null;
    }
  }
  const rec = asRecord(parsed);
  if (!rec) return null;
  const type = str(rec.type);
  if (!type) return null;
  const payload = asRecord(rec.payload) ?? {};
  return {
    v: typeof rec.v === "number" ? rec.v : undefined,
    type,
    event_id: str(rec.event_id) ?? "",
    correlation_id: str(rec.correlation_id),
    idempotency_key: str(rec.idempotency_key),
    payload,
  };
}

export function classifyWireEvent(frame: WsWireEvent): ClassifiedWireEvent {
  const payload = asRecord(frame.payload) ?? {};
  const type = frame.type || str(payload.type) || "unknown";
  const channel = str(payload.channel);
  const messageId = str(payload.message_id);

  if (type === "message.delivered") {
    return {
      kind: "message",
      type,
      eventId: frame.event_id || undefined,
      channel,
      messageId,
      frame,
      message: payload as MessageDeliveredPayload,
    };
  }

  if (type === "ai.draft") {
    return {
      kind: "ai.draft",
      type,
      eventId: frame.event_id || undefined,
      channel,
      messageId,
      frame,
      ai: payload as AiDraftPayload,
    };
  }

  return {
    kind: "other",
    type,
    eventId: frame.event_id || undefined,
    channel,
    messageId,
    frame,
  };
}

export function isVisitorMessage(event: ClassifiedWireEvent): boolean {
  return event.kind === "message" && senderBucket(event.message?.role) === "visitor";
}

export function isAgentReply(event: ClassifiedWireEvent): boolean {
  return event.kind === "message" && senderBucket(event.message?.role) === "agent";
}

/** `assistant` — то же исходящее, что `agent` (панель и виджет так нормализуют). */
export function isAgentRole(role: string | undefined): boolean {
  return senderBucket(role) === "agent";
}

function senderBucket(role: string | undefined): "visitor" | "agent" | "other" {
  if (role === "agent" || role === "assistant") return "agent";
  if (!role || role === "visitor") return "visitor";
  return "other";
}

/**
 * Node 18/20 have no global `WebSocket`. Node 22+, Bun, Deno and browsers do.
 * Pass the result as `WebSocket:` to {@link SupportlyRealtime} / Inbox.
 */
export function nodeWebSocketFactory(): (url: string) => WebSocket {
  const ctor = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (typeof ctor === "function") {
    return (url) => new ctor(url);
  }
  throw new Error(
    "no global WebSocket — Node 18/20: `npm i ws` then pass `WebSocket: (url) => new WebSocket(url)`",
  );
}
