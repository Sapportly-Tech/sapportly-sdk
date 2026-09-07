/**
 * `@sapportly/widget-sdk` — публичный embed SDK (vanilla / React / Vue / Next / Svelte).
 *
 * Имя на npm — `@sapportly/widget-sdk`, не `@supportly/widget-sdk`.
 * Продукт, Site ID (`wgt_…`) и глобал `window.Sapportly` — Sapportly.
 * Не путать с `@sapportly/sdk` (REST) и с panel JWT.
 */

export {
  DEFAULT_API_URL,
  DEFAULT_CDN_URL,
  WIDGET_SDK_VERSION,
  WIDGET_WASM_ASSET_VERSION,
  WIDGET_GLUE_ASSET_VERSION,
  WIDGET_ANALYTICS_EVENTS,
  type WidgetAnalyticsEventId,
} from "./constants";

export {
  buildEmbedSnippet,
  buildWidgetEmbedSnippet,
  buildScriptUrl,
  buildScriptAttributes,
  type BuildEmbedSnippetOptions,
} from "./snippet";

export {
  DEFAULT_SITE_ID_ENV_KEYS,
  resolveSiteId,
  createLoaderOptions,
  loaderOptionsFromEnv,
  type ResolveSiteIdOptions,
  type LoaderOptionsFromEnvOptions,
} from "./options";

export {
  isBrowser,
  injectQueueStub,
  getSapportly,
  waitForSapportly,
  loadSapportly,
  installWidget,
  installSapportly,
  onSapportlyEvent,
  supportlyLoaderKey,
  sapportlyLoaderKey,
} from "./loader";

export type {
  SapportlyClient,
  SapportlyEvent,
  SapportlyEventDetail,
  SapportlyIdentifyTraits,
  SapportlyLoaderOptions,
  SapportlyGlobal,
  SapportlyQueueStub,
  SapportlyTrackHandler,
} from "./types";

export { isSapportlyClient } from "./types";
