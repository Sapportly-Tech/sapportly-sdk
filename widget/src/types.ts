import type { WidgetAnalyticsEventId } from "./constants";

/** Events emitted via `Supportly.on()` and `supportly:*` DOM events. */
export type SupportlyEvent =
  | "ready"
  | "config"
  | "open"
  | "close"
  | "launcher_click"
  | "security_changed"
  | "error"
  | "track";

export type SupportlyEventDetail = Record<string, unknown>;

/** Options passed to `loadSupportly()` and framework helpers. */
export interface SupportlyLoaderOptions {
  /** Public widget site id (`wgt_…`). */
  siteId: string;
  /** REST API base URL (default: `https://api.supportly.cc`). */
  apiUrl?: string;
  /** CDN base URL for widget assets (default: `https://cdn.supportly.cc`). */
  cdnUrl?: string;
  /** WebSocket URL override. */
  wsUrl?: string;
  /** Optional panel title override. */
  title?: string;
  /** Cache-bust query на shell script (по умолчанию WASM hash). */
  version?: string;
  /** Override WASM JS bundle URL. */
  wasmJs?: string;
  /** Override WASM binary URL. */
  wasmBin?: string;
  /** Override widget CSS URL. */
  widgetCss?: string;
  /** Inject queue stub before the script tag (default: `true`). */
  queueStub?: boolean;
  /** Script load timeout in ms (default: `30000`). */
  timeoutMs?: number;
  /** HTML script element id (default: `supportly-widget-script`). */
  scriptId?: string;
}

/** CRM-поля посетителя для `POST /v1/widget/identify` (лента `widget:{uuid}`). */
export interface SupportlyIdentifyTraits {
  email?: string;
  phone?: string;
  external_id?: string;
  externalId?: string;
}

/** Runtime API exposed as `window.Supportly` after the embed shell loads. */
export interface SupportlyClient {
  version: string;
  ready: Promise<void>;
  boot(): Promise<void>;
  open(): Promise<void>;
  close(): Promise<void>;
  toggle(): Promise<void>;
  track(name: string, properties?: Record<string, unknown>): void;
  identify(traits?: SupportlyIdentifyTraits): Promise<{ ok: boolean }>;
  on(event: SupportlyEvent, handler: (detail?: SupportlyEventDetail) => void): () => void;
  off(event: SupportlyEvent, handler: (detail?: SupportlyEventDetail) => void): void;
  destroy(): Promise<void>;
  reloadConfig(): Promise<void>;
  getConfig(): unknown;
  getVisitorId(): string;
  getVersion(): string;
  isOpen(): boolean;
  isMounted(): boolean;
  isDestroyed(): boolean;
}

/** Queue stub shape before the embed shell replaces `window.Supportly`. */
export interface SupportlyQueueStub {
  q: Array<{ m: string; a?: unknown[] }>;
}

export type SupportlyGlobal = SupportlyClient | SupportlyQueueStub;

export function isSupportlyClient(value: SupportlyGlobal | undefined): value is SupportlyClient {
  return Boolean(value && typeof (value as SupportlyClient).boot === "function");
}

/** Track custom analytics via the embed shell (`widget.custom` under the hood). */
export type SupportlyTrackHandler = (
  name: string,
  properties?: Record<string, unknown>,
) => void;

/** Known widget analytics event ids (for typing custom `track` payloads). */
export type { WidgetAnalyticsEventId };

declare global {
  interface Window {
    Supportly?: SupportlyGlobal;
    __supportlyOnEvent?: (name: string, detailJson?: string) => void;
  }
}

export {};
