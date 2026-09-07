/** Версия embed-shell + WASM (совпадает с `packages/config/src/widget.ts`). */
export const WIDGET_SDK_VERSION = "1.3.0";

/** SHA256-префикс `supportly_widget_bg.wasm` — штампует `packages/widget/build.ps1`. */
export const WIDGET_WASM_ASSET_VERSION = "36da946d2c75";

/** SHA256-префикс loader shell + CSS — штампуется на сборке виджета. */
export const WIDGET_GLUE_ASSET_VERSION = "fa75b82c5535";

/** Базовый URL публичного REST API. */
export const DEFAULT_API_URL = "https://api.sapportly.pro";

/** Базовый URL CDN ассетов виджета. */
export const DEFAULT_CDN_URL = "https://cdn.sapportly.pro";

/** Белый список analytics-событий, которые шлёт embed shell. */
export const WIDGET_ANALYTICS_EVENTS = [
  "widget.loaded",
  "widget.config_loaded",
  "widget.launcher_clicked",
  "widget.opened",
  "widget.closed",
  "widget.panel_expanded",
  "widget.panel_collapsed",
  "widget.session_started",
  "widget.message_sent",
  "widget.message_received",
  "widget.attachment_clicked",
  "widget.ws_connected",
  "widget.ws_disconnected",
  "widget.error",
  "widget.custom",
] as const;

export type WidgetAnalyticsEventId = (typeof WIDGET_ANALYTICS_EVENTS)[number];
