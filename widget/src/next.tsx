"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_API_URL } from "./constants";
import { getSupportly, waitForSupportly } from "./loader";
import { loaderOptionsFromEnv, type LoaderOptionsFromEnvOptions } from "./options";
import { buildScriptAttributes, buildScriptUrl } from "./snippet";
import type {
  SupportlyClient,
  SupportlyIdentifyTraits,
  SupportlyLoaderOptions,
} from "./types";

export interface SupportlyScriptProps extends SupportlyLoaderOptions {
  /** next/script loading strategy (default: `afterInteractive`). */
  strategy?: "afterInteractive" | "lazyOnload" | "beforeInteractive" | "worker";
}

/**
 * Next.js App Router / Pages — inject stub + embed shell via `next/script`.
 * Place in a Client Component layout or page.
 */
export function SupportlyScript({
  strategy = "afterInteractive",
  queueStub = true,
  scriptId = "supportly-widget-script",
  ...options
}: SupportlyScriptProps) {
  const src = buildScriptUrl(options);
  const attrs = buildScriptAttributes(options);

  return (
    <>
      {queueStub ? (
        <Script id="supportly-widget-stub" strategy={strategy}>
          {`window.Supportly=window.Supportly||{q:[]};`}
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

export interface SupportlyScriptFromEnvProps
  extends Omit<SupportlyScriptProps, "siteId">,
    LoaderOptionsFromEnvOptions {}

/** Next.js script tag — Site ID from prop or `NEXT_PUBLIC_SUPPORTLY_SITE_ID`. */
export function SupportlyScriptFromEnv(props: SupportlyScriptFromEnvProps) {
  const { siteId, apiUrl, cdnUrl, wsUrl, version, envKeys, ...rest } = props;
  const options = useMemo(
    () => loaderOptionsFromEnv({ siteId, apiUrl, cdnUrl, wsUrl, version, envKeys }),
    [siteId, apiUrl, cdnUrl, wsUrl, version, envKeys],
  );
  return <SupportlyScript {...rest} {...options} />;
}

export interface UseSupportlyClientResult {
  client: SupportlyClient | null;
  ready: boolean;
  error: Error | null;
  open: () => Promise<void>;
  close: () => Promise<void>;
  toggle: () => Promise<void>;
  track: (name: string, properties?: Record<string, unknown>) => void;
  identify: (traits?: SupportlyIdentifyTraits) => Promise<{ ok: boolean }>;
}

/** Hook for apps that render `<SupportlyScript />` separately. */
export function useSupportlyClient(timeoutMs = 30_000): UseSupportlyClientResult {
  const [client, setClient] = useState<SupportlyClient | null>(() => getSupportly());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    waitForSupportly(timeoutMs)
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
    async (traits?: SupportlyIdentifyTraits) => {
      if (!client) return { ok: false };
      return client.identify(traits);
    },
    [client],
  );

  return { client, ready, error, open, close, toggle, track, identify };
}

export type { SupportlyClient, SupportlyIdentifyTraits, SupportlyLoaderOptions };
