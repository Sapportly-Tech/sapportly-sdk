import { get, writable, type Readable, type Writable } from "svelte/store";
import { getSupportly, isBrowser, loadSupportly } from "./loader";
import type { SupportlyClient, SupportlyLoaderOptions } from "./types";

export interface SupportlyStores {
  client: Readable<SupportlyClient | null> & Writable<SupportlyClient | null>;
  ready: Readable<boolean> & Writable<boolean>;
  error: Readable<Error | null> & Writable<Error | null>;
  destroy: () => void;
}

export interface CreateSupportlyOptions extends SupportlyLoaderOptions {
  /** Call `destroy()` from `destroy()` helper (default: `false`). */
  destroyOnTeardown?: boolean;
}

/**
 * Svelte store factory — loads the widget on creation (browser only).
 *
 * ```svelte
 * <script>
 *   import { createSupportly } from '@sapportly/widget-sdk/svelte';
 *   const { client, ready, open } = createSupportly({ siteId: 'wgt_...' });
 * </script>
 * ```
 */
export function createSupportly(options: CreateSupportlyOptions): SupportlyStores {
  const { destroyOnTeardown = false, ...loaderOptions } = options;

  const client = writable<SupportlyClient | null>(null);
  const ready = writable(false);
  const error = writable<Error | null>(null);

  let instance: SupportlyClient | null = null;

  if (isBrowser()) {
    loadSupportly(loaderOptions)
      .then((loaded) => {
        instance = loaded;
        client.set(loaded);
        ready.set(true);
      })
      .catch((err: unknown) => {
        error.set(err instanceof Error ? err : new Error(String(err)));
      });
  }

  return {
    client,
    ready,
    error,
    destroy: () => {
      if (destroyOnTeardown) instance?.destroy();
      instance = null;
      client.set(null);
      ready.set(false);
    },
  };
}

/** Attach to an already-injected widget (e.g. after a static HTML snippet). */
export function attachSupportly(): SupportlyStores {
  const client = writable<SupportlyClient | null>(getSupportly());
  const ready = writable(Boolean(getSupportly()));
  const error = writable<Error | null>(null);

  if (isBrowser() && !getSupportly()) {
    const timer = setInterval(() => {
      const live = getSupportly();
      if (live) {
        clearInterval(timer);
        live.ready
          .then(() => {
            client.set(live);
            ready.set(true);
          })
          .catch((err: unknown) => {
            error.set(err instanceof Error ? err : new Error(String(err)));
          });
      }
    }, 100);
  }

  return {
    client,
    ready,
    error,
    destroy: () => {
      get(client)?.destroy();
      client.set(null);
      ready.set(false);
    },
  };
}

export type { SupportlyClient, SupportlyLoaderOptions };
