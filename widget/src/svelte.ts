import { get, writable, type Readable, type Writable } from "svelte/store";
import { getSapportly, isBrowser, loadSapportly } from "./loader";
import type { SapportlyClient, SapportlyLoaderOptions } from "./types";

export interface SapportlyStores {
  client: Readable<SapportlyClient | null> & Writable<SapportlyClient | null>;
  ready: Readable<boolean> & Writable<boolean>;
  error: Readable<Error | null> & Writable<Error | null>;
  destroy: () => void;
}

export interface CreateSapportlyOptions extends SapportlyLoaderOptions {
  /** Call `destroy()` from `destroy()` helper (default: `false`). */
  destroyOnTeardown?: boolean;
}

/**
 * Svelte store factory — loads the widget on creation (browser only).
 *
 * ```svelte
 * <script>
 *   import { createSapportly } from '@sapportly/widget-sdk/svelte';
 *   const { client, ready, open } = createSapportly({ siteId: 'wgt_...' });
 * </script>
 * ```
 */
export function createSapportly(options: CreateSapportlyOptions): SapportlyStores {
  const { destroyOnTeardown = false, ...loaderOptions } = options;

  const client = writable<SapportlyClient | null>(null);
  const ready = writable(false);
  const error = writable<Error | null>(null);

  let instance: SapportlyClient | null = null;

  if (isBrowser()) {
    loadSapportly(loaderOptions)
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
export function attachSapportly(): SapportlyStores {
  const client = writable<SapportlyClient | null>(getSapportly());
  const ready = writable(Boolean(getSapportly()));
  const error = writable<Error | null>(null);

  if (isBrowser() && !getSapportly()) {
    const timer = setInterval(() => {
      const live = getSapportly();
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

export type { SapportlyClient, SapportlyLoaderOptions };
