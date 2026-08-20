import { buildScriptAttributes, buildScriptUrl } from "./snippet";
import { createLoaderOptions } from "./options";
import type { SupportlyClient, SupportlyEvent, SupportlyEventDetail, SupportlyLoaderOptions } from "./types";
import { isSupportlyClient } from "./types";

const DEFAULT_SCRIPT_ID = "supportly-widget-script";
const DEFAULT_STUB_ID = "supportly-widget-stub";

/** `true` when `window` and `document` are available (browser). */
export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/** Inject the pre-load command queue stub (`window.Supportly = { q: [] }`). */
export function injectQueueStub(stubId = DEFAULT_STUB_ID): void {
  if (!isBrowser()) return;
  if (document.getElementById(stubId)) return;

  const existing = window.Supportly;
  if (isSupportlyClient(existing)) return;

  if (!existing) {
    window.Supportly = { q: [] };
    return;
  }

  if (!("q" in existing) || !Array.isArray(existing.q)) {
    window.Supportly = { q: [] };
  }
}

/** Return the live `window.Supportly` client, or `null` if not loaded yet. */
export function getSupportly(): SupportlyClient | null {
  if (!isBrowser()) return null;
  const api = window.Supportly;
  return isSupportlyClient(api) && !api.isDestroyed() ? api : null;
}

/** Wait until `window.Supportly` is ready (polls after script injection). */
export function waitForSupportly(timeoutMs = 30_000): Promise<SupportlyClient> {
  if (!isBrowser()) {
    return Promise.reject(new Error("waitForSupportly() requires a browser environment"));
  }

  const existing = getSupportly();
  if (existing) return existing.ready.then(() => existing);

  return new Promise((resolve, reject) => {
    const started = Date.now();

    const tick = () => {
      const api = window.Supportly;
      if (isSupportlyClient(api)) {
        api.ready.then(() => resolve(api)).catch(reject);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Supportly widget script failed to load within timeout"));
        return;
      }
      setTimeout(tick, 50);
    };

    tick();
  });
}

/** Dynamically inject the embed shell `<script>` and return the typed client. */
export async function loadSupportly(options: SupportlyLoaderOptions): Promise<SupportlyClient> {
  if (!isBrowser()) {
    throw new Error("loadSupportly() requires a browser environment");
  }

  const existing = getSupportly();
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

  return waitForSupportly(options.timeoutMs);
}

/**
 * One-liner: inject the embed shell and return the typed client.
 * Accepts a Site ID string or full {@link SupportlyLoaderOptions}.
 */
export async function installWidget(
  siteIdOrOptions: string | SupportlyLoaderOptions,
  overrides?: Partial<SupportlyLoaderOptions>,
): Promise<SupportlyClient> {
  return loadSupportly(createLoaderOptions(siteIdOrOptions, overrides));
}

/** @deprecated Use {@link installWidget} or {@link loadSupportly}. */
export const installSupportly = installWidget;

/** Subscribe to embed events via DOM `supportly:*` CustomEvents. */
export function onSupportlyEvent(
  event: SupportlyEvent,
  handler: (detail?: SupportlyEventDetail) => void,
): () => void {
  if (!isBrowser()) return () => {};

  const listener = (e: Event) => {
    handler((e as CustomEvent<SupportlyEventDetail>).detail);
  };

  window.addEventListener(`supportly:${event}`, listener);
  return () => window.removeEventListener(`supportly:${event}`, listener);
}

/** Stable dependency key for framework hooks (siteId + urls). */
export function supportlyLoaderKey(options: SupportlyLoaderOptions): string {
  return [
    options.siteId,
    options.apiUrl ?? "",
    options.cdnUrl ?? "",
    options.wsUrl ?? "",
    options.version ?? "",
  ].join("|");
}
