/**
 * Ключ канала.
 *
 * Источник (аналитика, реестр): `{namespace}:{slug}` — `custom:shop`.
 * Тред 1:1 (панель, ИИ, reply): `{namespace}:{slug}:{uuid}` — `custom:shop:{uuid}`.
 *
 * Не создавайте отдельный канал на каждого человека. Передайте
 * `identity.external_id` или `thread_id` — SDK и шлюз соберут тред сами.
 *
 * Виджет — исключение: тред `widget:{uuid}`, реестр {@link WIDGET_REGISTRY_CHANNEL}.
 */

import { uuidV5 } from "./uuid-v5";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WIDGET_PREFIX = "widget:";

/** Совпадает с `THREAD_ID_NAMESPACE` в `supportly_common`. Менять нельзя. */
export const THREAD_ID_NAMESPACE = "a1f0c3e8-7b2d-4e91-9c54-6d8e0b1a2c3d";

export const WIDGET_REGISTRY_SLUG = "web";
export const WIDGET_REGISTRY_CHANNEL = `${WIDGET_PREFIX}${WIDGET_REGISTRY_SLUG}`;

export function channelKey(namespace: string, slug: string): string {
  return `${namespace}:${slug}`;
}

export function widgetChannel(visitorId: string): string {
  return `${WIDGET_PREFIX}${visitorId}`;
}

export function isWidgetVisitorChannel(channelKeyValue: string): boolean {
  if (!channelKeyValue.startsWith(WIDGET_PREFIX)) return false;
  return UUID_RE.test(channelKeyValue.slice(WIDGET_PREFIX.length).trim());
}

export function visitorIdFromWidgetChannel(channel: string): string | null {
  if (!isWidgetVisitorChannel(channel)) return null;
  return channel.slice(WIDGET_PREFIX.length).trim();
}

export function channelNamespace(channel: string): string | null {
  const index = channel.indexOf(":");
  return index > 0 ? channel.slice(0, index) : null;
}

/** Slug источника: `custom:shop:uuid` → `shop`, `custom:shop` → `shop`. */
export function channelIdentifier(channel: string): string | null {
  return parseConversationKey(channel)?.sourceSlug ?? null;
}

export interface ParsedConversationKey {
  namespace: string;
  sourceSlug: string;
  threadId: string | null;
  sourceChannel: string;
  conversationChannel: string;
}

export function parseConversationKey(channel: string): ParsedConversationKey | null {
  const trimmed = channel.trim();
  const colon = trimmed.indexOf(":");
  if (colon <= 0) return null;
  const namespace = trimmed.slice(0, colon);
  const rest = trimmed.slice(colon + 1);
  if (!rest) return null;

  if (namespace === "widget") {
    if (rest.includes(":")) return null;
    if (rest === WIDGET_REGISTRY_SLUG) {
      return {
        namespace,
        sourceSlug: WIDGET_REGISTRY_SLUG,
        threadId: null,
        sourceChannel: WIDGET_REGISTRY_CHANNEL,
        conversationChannel: WIDGET_REGISTRY_CHANNEL,
      };
    }
    if (!UUID_RE.test(rest)) return null;
    return {
      namespace,
      sourceSlug: WIDGET_REGISTRY_SLUG,
      threadId: rest,
      sourceChannel: WIDGET_REGISTRY_CHANNEL,
      conversationChannel: `${WIDGET_PREFIX}${rest}`,
    };
  }

  const lastColon = rest.lastIndexOf(":");
  if (lastColon >= 0) {
    const slug = rest.slice(0, lastColon);
    const maybeUuid = rest.slice(lastColon + 1);
    if (!slug || slug.includes(":") || !UUID_RE.test(maybeUuid)) return null;
    const source = `${namespace}:${slug}`;
    return {
      namespace,
      sourceSlug: slug,
      threadId: maybeUuid,
      sourceChannel: source,
      conversationChannel: `${source}:${maybeUuid}`,
    };
  }

  return {
    namespace,
    sourceSlug: rest,
    threadId: null,
    sourceChannel: `${namespace}:${rest}`,
    conversationChannel: `${namespace}:${rest}`,
  };
}

export function sourceChannel(channel: string): string {
  return parseConversationKey(channel)?.sourceChannel ?? channel;
}

export function threadIdFromChannel(channel: string): string | null {
  return parseConversationKey(channel)?.threadId ?? null;
}

export function isThreadChannel(channel: string): boolean {
  return threadIdFromChannel(channel) != null;
}

export function composeThreadChannel(source: string, threadId: string): string {
  const parsed = parseConversationKey(source);
  if (parsed?.namespace === "widget") return widgetChannel(threadId);
  const src = parsed?.sourceChannel ?? source;
  return `${src}:${threadId}`;
}

/** `custom:shop` ловит `custom:shop:{uuid}`. */
export function conversationMatchesSource(conversation: string, filter: string): boolean {
  if (!filter || conversation === filter) return true;
  return sourceChannel(conversation) === filter;
}

export async function deriveThreadId(sourceChannelValue: string, externalId: string): Promise<string> {
  const name = new TextEncoder().encode(`${sourceChannelValue}\0${externalId}`);
  return uuidV5(THREAD_ID_NAMESPACE, name);
}

export async function bindThreadKey(
  channel: string,
  options: { thread?: string; externalId?: string } = {},
): Promise<string> {
  const parsed = parseConversationKey(channel);
  if (!parsed) return channel;
  if (parsed.threadId) return parsed.conversationChannel;
  const thread =
    options.thread ??
    (options.externalId ? await deriveThreadId(parsed.sourceChannel, options.externalId) : undefined);
  if (!thread) return parsed.sourceChannel;
  return composeThreadChannel(parsed.sourceChannel, thread);
}
