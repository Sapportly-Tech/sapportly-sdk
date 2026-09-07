/**
 * Catch-up after integrator WebSocket reconnect.
 *
 * The public integrator socket does **not** replay missed frames. After
 * `onStateChange("open")` (including the first connect and every reconnect),
 * walk conversations over REST and persist locally. Do **not** call
 * `deliverToCustomer` from catch-up — only live `onAgent` with `echo: false`
 * should push to the external channel.
 */

import { sourceChannel } from "./channels";
import type { SapportlyClient } from "./client";
import type { Message } from "./types";

export interface CatchUpMessage {
  id: string;
  channel: string;
  sourceChannel: string;
  body: string;
  createdAt: string;
  userId: string | null;
  idempotencyKey: string;
  contentEncoding: string;
  /**
   * Heuristic only — REST history has no `role`.
   * Prefer live WS `onAgent` for delivery; use this for local archive UI.
   */
  likelyAgent: boolean;
  raw: Message;
}

export interface CatchUpOptions {
  client: Pick<SapportlyClient, "conversations">;
  /**
   * Source allow-list (`custom:shop` matches threads `custom:shop:{uuid}`).
   * Omit / empty = every conversation.
   */
  sources?: string[];
  /** Conversations page size. Default 50. */
  conversationLimit?: number;
  /**
   * Cap conversation pages. Default **3** (shallow — raise after long disconnects).
   */
  maxConversationPages?: number;
  /** Messages page size per conversation. Default 50. */
  messageLimit?: number;
  /**
   * Cap message pages per conversation. Default **1** (newest page only).
   * Increase when reconciling after a long outage; WS does not replay history.
   */
  maxMessagePages?: number;
  /**
   * Called for each history row. Persist only — never deliver to the end user
   * from here (risk of double-send after reconnect).
   */
  onMessage: (row: CatchUpMessage) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface CatchUpResult {
  conversations: number;
  messages: number;
}

/** True when REST row looks like an agent/AI outbound (no `role` on the wire). */
export function likelyAgentMessage(message: Pick<Message, "idempotency_key" | "user_id">): boolean {
  const key = message.idempotency_key ?? "";
  if (key.startsWith("agent-reply-") || key.startsWith("ai:auto:")) return true;
  return Boolean(message.user_id);
}

function matchesSources(channel: string, sources: string[] | undefined): boolean {
  if (!sources?.length) return true;
  const src = sourceChannel(channel);
  return sources.some((filter) => filter === channel || filter === src);
}

/**
 * Walk recent conversations and their newest message pages.
 *
 * ```ts
 * inbox.onStateChange((state) => {
 *   if (state === "open") {
 *     void catchUpInbox({
 *       client,
 *       sources: ["custom:shop"],
 *       onMessage: (row) => persistLocally(row),
 *     });
 *   }
 * });
 * ```
 */
export async function catchUpInbox(options: CatchUpOptions): Promise<CatchUpResult> {
  const {
    client,
    sources,
    conversationLimit = 50,
    maxConversationPages = 3,
    messageLimit = 50,
    maxMessagePages = 1,
    onMessage,
    signal,
  } = options;

  let conversations = 0;
  let messages = 0;

  for await (const summary of client.conversations.iterate({
    limit: conversationLimit,
    maxPages: maxConversationPages,
  })) {
    if (signal?.aborted) break;
    if (!matchesSources(summary.channel, sources)) continue;
    conversations += 1;

    for await (const page of client.conversations.iterateMessagePages(summary.channel, {
      limit: messageLimit,
      maxPages: maxMessagePages,
    })) {
      if (signal?.aborted) break;
      for (const message of page) {
        if (signal?.aborted) break;
        messages += 1;
        await onMessage({
          id: message.id,
          channel: summary.channel,
          sourceChannel: sourceChannel(summary.channel),
          body: message.body,
          createdAt: message.created_at,
          userId: message.user_id,
          idempotencyKey: message.idempotency_key,
          contentEncoding: message.content_encoding,
          likelyAgent: likelyAgentMessage(message),
          raw: message,
        });
      }
    }
  }

  return { conversations, messages };
}
