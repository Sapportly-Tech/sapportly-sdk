import { DEFAULT_API_URL, DEFAULT_CDN_URL, WIDGET_SDK_VERSION, WIDGET_WASM_ASSET_VERSION } from "./constants";
import type { SupportlyLoaderOptions } from "./types";

export interface BuildEmbedSnippetOptions {
  siteId: string;
  apiUrl?: string;
  cdnUrl?: string;
  wsUrl?: string;
  title?: string;
  version?: string;
  wasmJs?: string;
  wasmBin?: string;
  widgetCss?: string;
}

/** Build a copy-paste HTML embed snippet for the widget shell script. */
export function buildEmbedSnippet(options: BuildEmbedSnippetOptions): string {
  const cdn = (options.cdnUrl ?? DEFAULT_CDN_URL).replace(/\/$/, "");
  const ver = options.version ?? WIDGET_WASM_ASSET_VERSION;
  const src = `${cdn}/supportly.widget.js?v=${encodeURIComponent(ver)}`;
  const attrs = [
    `src="${src}"`,
    `data-site-id="${escapeHtmlAttr(options.siteId)}"`,
    `data-api-url="${escapeHtmlAttr((options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, ""))}"`,
  ];
  if (options.wsUrl) attrs.push(`data-ws-url="${escapeHtmlAttr(options.wsUrl)}"`);
  if (options.title) attrs.push(`data-title="${escapeHtmlAttr(options.title)}"`);
  if (options.wasmJs) attrs.push(`data-wasm-js="${escapeHtmlAttr(options.wasmJs)}"`);
  if (options.wasmBin) attrs.push(`data-wasm-bin="${escapeHtmlAttr(options.wasmBin)}"`);
  if (options.widgetCss) attrs.push(`data-widget-css="${escapeHtmlAttr(options.widgetCss)}"`);

  return (
    `<!-- Supportly Widget ${ver} -->\n` +
    `<script>window.Supportly=window.Supportly||{q:[]};</script>\n` +
    `<script\n  ${attrs.join("\n  ")}\n  async\n></script>`
  );
}

/** @deprecated Use `buildEmbedSnippet`. */
export const buildWidgetEmbedSnippet = buildEmbedSnippet;

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildScriptUrl(options: Pick<SupportlyLoaderOptions, "cdnUrl" | "version">): string {
  const cdn = (options.cdnUrl ?? DEFAULT_CDN_URL).replace(/\/$/, "");
  const ver = options.version ?? WIDGET_WASM_ASSET_VERSION;
  return `${cdn}/supportly.widget.js?v=${encodeURIComponent(ver)}`;
}

export function buildScriptAttributes(
  options: SupportlyLoaderOptions,
): Record<string, string> {
  const attrs: Record<string, string> = {
    "data-site-id": options.siteId,
    "data-api-url": (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, ""),
  };
  if (options.wsUrl) attrs["data-ws-url"] = options.wsUrl;
  if (options.title) attrs["data-title"] = options.title;
  if (options.wasmJs) attrs["data-wasm-js"] = options.wasmJs;
  if (options.wasmBin) attrs["data-wasm-bin"] = options.wasmBin;
  if (options.widgetCss) attrs["data-widget-css"] = options.widgetCss;
  return attrs;
}
