"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_API_URL } from "./constants";
import { getSapportly, waitForSapportly } from "./loader";
import { loaderOptionsFromEnv, type LoaderOptionsFromEnvOptions } from "./options";
import { buildScriptAttributes, buildScriptUrl } from "./snippet";
import type {
  SapportlyClient,
  SapportlyIdentifyTraits,
  SapportlyLoaderOptions,
} from "./types";

export interface SapportlyScriptProps extends SapportlyLoaderOptions {
  /** next/script loading strategy (default: `afterInteractive`). */
  strategy?: "afterInteractive" | "lazyOnload" | "beforeInteractive" | "worker";
}

/**
 * Next.js App Router / Pages — inject stub + embed shell via `next/script`.
 * Place in a Client Component layout or page.
 */
export function SapportlyScript({
  strategy = "afterInteractive",
  queueStub = true,
  scriptId = "supportly-widget-script",
  ...options
}: SapportlyScriptProps) {
  const src = buildScriptUrl(options);
  const attrs = buildScriptAttributes(options);

  return (
    <>
      {queueStub ? (
        <Script id="supportly-widget-stub" strategy={strategy}>
          {`window.Sapportly=window.Sapportly||{q:[]};`}
        </Script>
      ) : null}
      <Script
        id={scriptId}
        src={src}
        strategy={strategy}
        data-site-id={attrs["data-site-id"]}
        data-api-url={attrs["data-api-url"] ?? DEFAULT_API_URL}
        {...(attrs["data-ws-url"] ? { "data-ws-url": attrs["data-ws-url"] } : {})}
        {...(attrs["data-title"] ? { "data-title": attrs["data-title"] } : {})}
        {...(attrs["data-wasm-js"] ? { "data-wasm-js": attrs["data-wasm-js"] } : {})}
        {...(attrs["data-wasm-bin"] ? { "data-wasm-bin": attrs["data-wasm-bin"] } : {})}
        {...(attrs["data-widget-css"] ? { "data-widget-css": attrs["data-widget-css"] } : {})}
      />
    </>
  );
}

export interface SapportlyScriptFromEnvProps
  extends Omit<SapportlyScriptProps, "siteId">,
    LoaderOptionsFromEnvOptions {}

/** Next.js script tag — Site ID from prop or `NEXT_PUBLIC_SUPPORTLY_SITE_ID`. */
export function SapportlyScriptFromEnv(props: SapportlyScriptFromEnvProps) {
  const { siteId, apiUrl, cdnUrl, wsUrl, version, envKeys, ...rest } = props;
  const options = useMemo(
    () => loaderOptionsFromEnv({ siteId, apiUrl, cdnUrl, wsUrl, version, envKeys }),
    [siteId, apiUrl, cdnUrl, wsUrl, version, envKeys],
  );
  return <SapportlyScript {...rest} {...options} />;
}

export interface UseSapportlyClientResult {
  client: SapportlyClient | null;
  ready: boolean;
  error: Error | null;
  open: () => Promise<void>;
  close: () => Promise<void>;
  toggle: () => Promise<void>;
  track: (name: string, properties?: Record<string, unknown>) => void;
  identify: (traits?: SapportlyIdentifyTraits) => Promise<{ ok: boolean }>;
}

/** Hook for apps that render `<SapportlyScript />` separately. */
export function useSapportlyClient(timeoutMs = 30_000): UseSapportlyClientResult {
  const [client, setClient] = useState<SapportlyClient | null>(() => getSapportly());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    waitForSapportly(timeoutMs)
      .then((instance) => {
        if (cancelled) return;
        setClient(instance);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      });

    return () => {
      cancelled = true;
    };
  }, [timeoutMs]);

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

  return { client, ready, error, open, close, toggle, track, identify };
}

export type { SapportlyClient, SapportlyIdentifyTraits, SapportlyLoaderOptions };
