import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { getSupportly, loadSupportly, supportlyLoaderKey } from "./loader";
import { loaderOptionsFromEnv, type LoaderOptionsFromEnvOptions } from "./options";
import type {
  SupportlyClient,
  SupportlyIdentifyTraits,
  SupportlyLoaderOptions,
} from "./types";

export interface UseSupportlyOptions extends SupportlyLoaderOptions {
  /** Call `destroy()` when the hook unmounts (default: `false`). */
  destroyOnUnmount?: boolean;
  /** Skip automatic script injection — only attach to an existing widget. */
  manual?: boolean;
}

export interface UseSupportlyResult {
  client: SupportlyClient | null;
  ready: boolean;
  error: Error | null;
  open: () => Promise<void>;
  close: () => Promise<void>;
  toggle: () => Promise<void>;
  track: (name: string, properties?: Record<string, unknown>) => void;
  identify: (traits?: SupportlyIdentifyTraits) => Promise<{ ok: boolean }>;
}

/** React hook — loads the widget (unless `manual`) and exposes the embed API. */
export function useSupportly(options: UseSupportlyOptions): UseSupportlyResult {
  const { destroyOnUnmount = false, manual = false, ...loaderOptions } = options;
  const loaderKey = supportlyLoaderKey(loaderOptions);

  const [client, setClient] = useState<SupportlyClient | null>(() =>
    manual ? getSupportly() : null,
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const ownedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    const attach = (instance: SupportlyClient) => {
      if (cancelled) return;
      setClient(instance);
      setReady(true);
    };

    const fail = (err: unknown) => {
      if (cancelled) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    };

    if (manual) {
      const existing = getSupportly();
      if (existing) {
        existing.ready.then(() => attach(existing)).catch(fail);
      } else {
        const timer = setInterval(() => {
          const live = getSupportly();
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
    loadSupportly(loaderOptions).then(attach).catch(fail);

    return () => {
      cancelled = true;
      if (destroyOnUnmount && ownedRef.current) {
        getSupportly()?.destroy();
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
    async (traits?: SupportlyIdentifyTraits) => {
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

export interface UseSupportlyFromEnvOptions
  extends Omit<UseSupportlyOptions, "siteId">,
    LoaderOptionsFromEnvOptions {}

/**
 * React hook — resolves Site ID from `siteId` prop or env vars, then loads the widget.
 * Set `NEXT_PUBLIC_SUPPORTLY_SITE_ID` (or `VITE_SUPPORTLY_SITE_ID`) for zero-config installs.
 */
export function useSupportlyFromEnv(options: UseSupportlyFromEnvOptions = {}): UseSupportlyResult {
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

  const hook = useSupportly(
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

export interface SupportlyWidgetProps extends SupportlyLoaderOptions {
  onReady?: (client: SupportlyClient) => void;
  onError?: (error: Error) => void;
  destroyOnUnmount?: boolean;
}

/**
 * Headless React component — injects the embed script and mounts the widget.
 * Renders nothing; the shell creates its own launcher in the DOM.
 */
export function SupportlyWidget({
  onReady,
  onError,
  destroyOnUnmount = true,
  ...loaderOptions
}: SupportlyWidgetProps): ReactElement | null {
  const loaderKey = supportlyLoaderKey(loaderOptions);

  useEffect(() => {
    let client: SupportlyClient | null = null;
    let cancelled = false;

    loadSupportly(loaderOptions)
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
export function SupportlyWidgetFromEnv(
  props: Omit<SupportlyWidgetProps, "siteId"> & {
    siteId?: string;
    envKeys?: readonly string[];
  },
): ReactElement | null {
  const { siteId, apiUrl, cdnUrl, wsUrl, version, envKeys, ...rest } = props;
  const loaderOptions = useMemo(
    () => loaderOptionsFromEnv({ siteId, apiUrl, cdnUrl, wsUrl, version, envKeys }),
    [siteId, apiUrl, cdnUrl, wsUrl, version, envKeys],
  );
  return <SupportlyWidget {...rest} {...loaderOptions} />;
}

export type { SupportlyClient, SupportlyIdentifyTraits, SupportlyLoaderOptions };
