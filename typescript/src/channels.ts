/**
 * Ключ канала: `{namespace}:{slug}`.
 *
 * Канал — **источник** (сайт, CRM, свой коннектор), не тред
 * с одним человеком. Все обращения источника идут через один ключ
 * (`custom:shop`, `email:support`). Аналитика режется по каналам.
 *
 * Не создавайте канал на каждого посетителя: внешний id храните у себя
 * (`identity.external_id` / `idempotency_key`).
 *
 * Виджет — исключение: в панели нужен тред 1:1, поэтому посетитель живёт в
 * `widget:{visitor_uuid}`. Реестр виджета при этом один: {@link WIDGET_REGISTRY_CHANNEL}.
 */

const WIDGET_VISITOR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const WIDGET_PREFIX = "widget:";

/** Slug единственной записи реестра «виджет на сайте». */
export const WIDGET_REGISTRY_SLUG = "web";

/**
 * Канал реестра виджета (`widget:web`).
 *
 * Это конфигурация источника «сайт», не диалог. Диалоги посетителей —
 * {@link widgetChannel}.
 */
export const WIDGET_REGISTRY_CHANNEL = `${WIDGET_PREFIX}${WIDGET_REGISTRY_SLUG}`;

/** Собрать ключ канала. `channelKey("custom", "shop")` → `custom:shop`. */
export function channelKey(namespace: string, slug: string): string {
  return `${namespace}:${slug}`;
}

/** Канал одного посетителя виджета (`widget:{uuid}`). */
export function widgetChannel(visitorId: string): string {
  return `${WIDGET_PREFIX}${visitorId}`;
}

/**
 * Это канал посетителя (`widget:{uuid}`), а не `widget:web`.
 *
 * UUID отличает тред от записи реестра.
 */
export function isWidgetVisitorChannel(channelKeyValue: string): boolean {
  if (!channelKeyValue.startsWith(WIDGET_PREFIX)) return false;
  return WIDGET_VISITOR_UUID_RE.test(channelKeyValue.slice(WIDGET_PREFIX.length).trim());
}

/** Visitor id из `widget:{uuid}`, иначе `null`. */
export function visitorIdFromWidgetChannel(channel: string): string | null {
  if (!isWidgetVisitorChannel(channel)) return null;
  return channel.slice(WIDGET_PREFIX.length).trim();
}

/** Namespace ключа: `custom:telegram` → `custom`. */
export function channelNamespace(channel: string): string | null {
  const index = channel.indexOf(":");
  return index > 0 ? channel.slice(0, index) : null;
}

/** Идентификатор после двоеточия: `custom:telegram` → `telegram`. */
export function channelIdentifier(channel: string): string | null {
  const index = channel.indexOf(":");
  return index > 0 ? channel.slice(index + 1) : null;
}
