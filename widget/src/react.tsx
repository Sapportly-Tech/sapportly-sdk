import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { getSapportly, loadSapportly, supportlyLoaderKey } from "./loader";
import { loaderOptionsFromEnv, type LoaderOptionsFromEnvOptions } from "./options";
import type {
  SapportlyClient,
  SapportlyIdentifyTraits,
  SapportlyLoaderOptions,
} from "./types";

export interface UseSapportlyOptions extends SapportlyLoaderOptions {
  /** Call `destroy()` when the hook unmounts (default: `false`). */
  destroyOnUnmount?: boolean;
  /** Skip automatic script injection — only attach to an existing widget. */
  manual?: boolean;
}

export interface UseSapportlyResult {
  client: SapportlyClient | null;
  ready: boolean;
  error: Error | null;
  open: () => Promise<void>;
  close: () => Promise<void>;
  toggle: () => Promise<void>;
  track: (name: string, properties?: Record<string, unknown>) => void;
  identify: (traits?: SapportlyIdentifyTraits) => Promise<{ ok: boolean }>;
}

/** React hook — loads the widget (unless `manual`) and exposes the embed API. */
export function useSapportly(options: UseSapportlyOptions): UseSapportlyResult {
  const { destroyOnUnmount = false, manual = false, ...loaderOptions } = options;
  const loaderKey = supportlyLoaderKey(loaderOptions);

  const [client, setClient] = useState<SapportlyClient | null>(() =>
    manual ? getSapportly() : null,
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const ownedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    const attach = (instance: SapportlyClient) => {
      if (cancelled) return;
      setClient(instance);
      setReady(true);
    };

    const fail = (err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    };

    if (manual) {
      const existing = getSapportly();
      if (existing) {
        existing.ready.then(() => attach(existing)).catch(fail);
      } else {
        const timer = setInterval(() => {
          const live = getSapportly();
          if (live) {
            clearInterval(timer);
            live.ready.then(() => attach(live)).catch(fail);
          }
        }, 100);
        return () => {
          cancelled = true;
          clearInterval(timer);
        };
      }
      return () => {
        cancelled = true;
      };
    }

    ownedRef.current = true;
    loadSapportly(loaderOptions).then(attach).catch(fail);

    return () => {
      cancelled = true;
      if (destroyOnUnmount && ownedRef.current) {
        getSapportly()?.destroy();
        ownedRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by loaderKey
  }, [loaderKey, manual, destroyOnUnmount]);

  const open = useCallback(async () => {
    await client?.open();
  }, [client]);

  const close = useCallback(async () => {
    await client?.close();
  }, [client]);

  const toggle = useCallback(async () => {
    await client?.toggle();
  }, [client]);

  const track = useCallback(
    (name: string, properties?: Record<string, unknown>) => {
      client?.track(name, properties);
    },
    [client],
  );

  const identify = useCallback(
    async (traits?: SapportlyIdentifyTraits) => {
      if (!client) return { ok: false };
      return client.identify(traits);
    },
    [client],
  );

  return useMemo(
    () => ({ client, ready, error, open, close, toggle, track, identify }),
    [client, ready, error, open, close, toggle, track, identify],
  );
}

export interface UseSapportlyFromEnvOptions
  extends Omit<UseSapportlyOptions, "siteId">,
    LoaderOptionsFromEnvOptions {}

/**
 * React hook — resolves Site ID from `siteId` prop or env vars, then loads the widget.
 * Set `NEXT_PUBLIC_SUPPORTLY_SITE_ID` (or `VITE_SUPPORTLY_SITE_ID`) for zero-config installs.
 */
export function useSapportlyFromEnv(options: UseSapportlyFromEnvOptions = {}): UseSapportlyResult {
  const resolved = useMemo(() => {
    try {
      return {
        loader: loaderOptionsFromEnv(options),
        error: null as Error | null,
      };
    } catch (err) {
      return {
        loader: null,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }, [options.siteId, options.apiUrl, options.cdnUrl, options.wsUrl, options.version, options.envKeys]);

  const hook = useSapportly(
    resolved.loader
      ? { ...options, ...resolved.loader }
      : { ...options, siteId: "wgt_invalid", manual: true },
  );

  if (resolved.error) {
    return {
      client: null,
      ready: false,
      error: resolved.error,
      open: async () => {},
      close: async () => {},
      toggle: async () => {},
      track: () => {},
      identify: async () => ({ ok: false }),
    };
  }

  return hook;
}

export interface SapportlyWidgetProps extends SapportlyLoaderOptions {
  onReady?: (client: SapportlyClient) => void;
  onError?: (error: Error) => void;
  destroyOnUnmount?: boolean;
}

/**
 * Headless React component — injects the embed script and mounts the widget.
 * Renders nothing; the shell creates its own launcher in the DOM.
 */
export function SapportlyWidget({
  onReady,
  onError,
  destroyOnUnmount = true,
  ...loaderOptions
}: SapportlyWidgetProps): ReactElement | null {
  const loaderKey = supportlyLoaderKey(loaderOptions);

  useEffect(() => {
    let client: SapportlyClient | null = null;
    let cancelled = false;

    loadSapportly(loaderOptions)
      .then((instance) => {
        if (cancelled) return;
        client = instance;
        onReady?.(instance);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        onError?.(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
      if (destroyOnUnmount) client?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by loaderKey
  }, [loaderKey, destroyOnUnmount]);

  return null;
}

/** Headless component — resolves Site ID from env when `siteId` prop is omitted. */
export function SapportlyWidgetFromEnv(
  props: Omit<SapportlyWidgetProps, "siteId"> & {
    siteId?: string;
    envKeys?: readonly string[];
  },
): ReactElement | null {
  const { siteId, apiUrl, cdnUrl, wsUrl, version, envKeys, ...rest } = props;
  const loaderOptions = useMemo(
    () => loaderOptionsFromEnv({ siteId, apiUrl, cdnUrl, wsUrl, version, envKeys }),
    [siteId, apiUrl, cdnUrl, wsUrl, version, envKeys],
  );
  return <SapportlyWidget {...rest} {...loaderOptions} />;
}

export type { SapportlyClient, SapportlyIdentifyTraits, SapportlyLoaderOptions };
