import { buildScriptAttributes, buildScriptUrl } from "./snippet";
import { createLoaderOptions } from "./options";
import type { SapportlyClient, SapportlyEvent, SapportlyEventDetail, SapportlyLoaderOptions } from "./types";
import { isSapportlyClient } from "./types";

const DEFAULT_SCRIPT_ID = "supportly-widget-script";
const DEFAULT_STUB_ID = "supportly-widget-stub";

/** `true` when `window` and `document` are available (browser). */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** Inject the pre-load command queue stub (`window.Sapportly = { q: [] }`). */
export function injectQueueStub(stubId = DEFAULT_STUB_ID): void {
  if (!isBrowser()) return;
  if (document.getElementById(stubId)) return;

  const existing = window.Sapportly;
  if (isSapportlyClient(existing)) return;

  if (!existing) {
    window.Sapportly = { q: [] };
    return;
  }

  if (!("q" in existing) || !Array.isArray(existing.q)) {
    window.Sapportly = { q: [] };
  }
}

/** Return the live `window.Sapportly` client, or `null` if not loaded yet. */
export function getSapportly(): SapportlyClient | null {
  if (!isBrowser()) return null;
  const api = window.Sapportly;
  return isSapportlyClient(api) && !api.isDestroyed() ? api : null;
}

/** Wait until `window.Sapportly` is ready (polls after script injection). */
export function waitForSapportly(timeoutMs = 30_000): Promise<SapportlyClient> {
  if (!isBrowser()) {
    return Promise.reject(new Error("waitForSapportly() requires a browser environment"));
  }

  const existing = getSapportly();
  if (existing) return existing.ready.then(() => existing);

  return new Promise((resolve, reject) => {
    const started = Date.now();

    const tick = () => {
      const api = window.Sapportly;
      if (isSapportlyClient(api)) {
        api.ready.then(() => resolve(api)).catch(reject);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Sapportly widget script failed to load within timeout"));
        return;
      }
      setTimeout(tick, 50);
    };

    tick();
  });
}

/** Dynamically inject the embed shell `<script>` and return the typed client. */
export async function loadSapportly(options: SapportlyLoaderOptions): Promise<SapportlyClient> {
  if (!isBrowser()) {
    throw new Error("loadSapportly() requires a browser environment");
  }

  const existing = getSapportly();
  if (existing) return existing.ready.then(() => existing);

  const scriptId = options.scriptId ?? DEFAULT_SCRIPT_ID;
  const queueStub = options.queueStub ?? true;

  if (queueStub) injectQueueStub();

  let script = document.getElementById(scriptId) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.src = buildScriptUrl(options);
    const attrs = buildScriptAttributes(options);
    for (const [key, value] of Object.entries(attrs)) {
      script.setAttribute(key, value);
    }
    document.head.appendChild(script);
  }

  return waitForSapportly(options.timeoutMs);
}

/**
 * One-liner: inject the embed shell and return the typed client.
 * Accepts a Site ID string or full {@link SapportlyLoaderOptions}.
 */
export async function installWidget(
  siteIdOrOptions: string | SapportlyLoaderOptions,
  overrides?: Partial<SapportlyLoaderOptions>,
): Promise<SapportlyClient> {
  return loadSapportly(createLoaderOptions(siteIdOrOptions, overrides));
}

/** @deprecated Use {@link installWidget} or {@link loadSapportly}. */
export const installSapportly = installWidget;

/** Subscribe to embed events via DOM `supportly:*` CustomEvents. */
export function onSapportlyEvent(
  event: SapportlyEvent,
  handler: (detail?: SapportlyEventDetail) => void,
): () => void {
  if (!isBrowser()) return () => {};

  const listener = (e: Event) => {
    handler((e as CustomEvent<SapportlyEventDetail>).detail);
  };

  window.addEventListener(`supportly:${event}`, listener);
  return () => window.removeEventListener(`supportly:${event}`, listener);
}

/** Stable dependency key for framework hooks (siteId + urls). */
export function sapportlyLoaderKey(options: SapportlyLoaderOptions): string {
  return [
    options.siteId,
    options.apiUrl ?? "",
    options.cdnUrl ?? "",
    options.wsUrl ?? "",
    options.version ?? "",
  ].join("|");
}

/** @deprecated Use {@link sapportlyLoaderKey}. */
export const supportlyLoaderKey = sapportlyLoaderKey;
