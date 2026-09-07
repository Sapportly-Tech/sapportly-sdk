import type { WidgetAnalyticsEventId } from "./constants";

/** Events emitted via `Sapportly.on()` and `supportly:*` DOM events. */
export type SapportlyEvent =
  | "ready"
  | "config"
  | "open"
  | "close"
  | "launcher_click"
  | "security_changed"
  | "error"
  | "track";

export type SapportlyEventDetail = Record<string, unknown>;

/** Options passed to `loadSapportly()` and framework helpers. */
export interface SapportlyLoaderOptions {
  /** Public widget site id (`wgt_…`). */
  siteId: string;
  /** REST API base URL (default: `https://api.sapportly.pro`). */
  apiUrl?: string;
  /** CDN base URL for widget assets (default: `https://cdn.sapportly.pro`). */
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
export interface SapportlyIdentifyTraits {
  email?: string;
  phone?: string;
  external_id?: string;
  externalId?: string;
}

/** Runtime API exposed as `window.Sapportly` after the embed shell loads. */
export interface SapportlyClient {
  version: string;
  ready: Promise<void>;
  boot(): Promise<void>;
  open(): Promise<void>;
  close(): Promise<void>;
  toggle(): Promise<void>;
  track(name: string, properties?: Record<string, unknown>): void;
  identify(traits?: SapportlyIdentifyTraits): Promise<{ ok: boolean }>;
  on(event: SapportlyEvent, handler: (detail?: SapportlyEventDetail) => void): () => void;
  off(event: SapportlyEvent, handler: (detail?: SapportlyEventDetail) => void): void;
  destroy(): Promise<void>;
  reloadConfig(): Promise<void>;
  getConfig(): unknown;
  getVisitorId(): string;
  getVersion(): string;
  isOpen(): boolean;
  isMounted(): boolean;
  isDestroyed(): boolean;
}

/** Queue stub shape before the embed shell replaces `window.Sapportly`. */
export interface SapportlyQueueStub {
  q: Array<{ m: string; a?: unknown[] }>;
}

export type SapportlyGlobal = SapportlyClient | SapportlyQueueStub;

export function isSapportlyClient(value: SapportlyGlobal | undefined): value is SapportlyClient {
  return Boolean(value && typeof (value as SapportlyClient).boot === "function");
}

/** Track custom analytics via the embed shell (`widget.custom` under the hood). */
export type SapportlyTrackHandler = (
  name: string,
  properties?: Record<string, unknown>,
) => void;

/** Known widget analytics event ids (for typing custom `track` payloads). */
export type { WidgetAnalyticsEventId };

declare global {
  interface Window {
    Sapportly?: SapportlyGlobal;
    __supportlyOnEvent?: (name: string, detailJson?: string) => void;
  }
}

export {};
