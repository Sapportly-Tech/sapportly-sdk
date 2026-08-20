import type { SupportlyLoaderOptions } from "./types";

/** Common env var names for the public widget Site ID (`wgt_…`). */
export const DEFAULT_SITE_ID_ENV_KEYS = [
  "NEXT_PUBLIC_SUPPORTLY_SITE_ID",
  "VITE_SUPPORTLY_SITE_ID",
  "PUBLIC_SUPPORTLY_SITE_ID",
  "SUPPORTLY_SITE_ID",
] as const;

export interface ResolveSiteIdOptions {
  /** Explicit Site ID — highest priority. */
  siteId?: string;
  /** Env var names to try (default: {@link DEFAULT_SITE_ID_ENV_KEYS}). */
  envKeys?: readonly string[];
}

/**
 * Resolve the public widget Site ID from props or environment variables.
 * Works in Node (Next.js build). In Vite, pass `siteId` from `import.meta.env`.
 */
export function resolveSiteId(options: ResolveSiteIdOptions = {}): string | undefined {
  const explicit = options.siteId?.trim();
  if (explicit) return explicit;

  const keys = options.envKeys ?? DEFAULT_SITE_ID_ENV_KEYS;
  const env = readEnvRecord();
  if (env) {
    for (const key of keys) {
      const value = env[key]?.trim();
      if (value) return value;
    }
  }

  return undefined;
}

function readEnvRecord(): Record<string, string | undefined> | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env;
}

/** Merge partial loader options with a required Site ID. */
export function createLoaderOptions(
  siteIdOrOptions: string | SupportlyLoaderOptions,
  overrides?: Partial<SupportlyLoaderOptions>,
): SupportlyLoaderOptions {
  const base: SupportlyLoaderOptions =
    typeof siteIdOrOptions === "string"
      ? { siteId: siteIdOrOptions }
      : siteIdOrOptions;

  return { ...base, ...overrides, siteId: overrides?.siteId ?? base.siteId };
}

export interface LoaderOptionsFromEnvOptions
  extends Partial<SupportlyLoaderOptions>,
    ResolveSiteIdOptions {}

/**
 * Build loader options using `siteId` or env vars.
 * @throws when Site ID cannot be resolved
 */
export function loaderOptionsFromEnv(
  options: LoaderOptionsFromEnvOptions = {},
): SupportlyLoaderOptions {
  const { siteId: explicit, envKeys, ...rest } = options;
  const siteId = resolveSiteId({ siteId: explicit, envKeys });
  if (!siteId) {
    throw new Error(
      `Supportly Site ID is required. Pass siteId or set one of: ${(envKeys ?? DEFAULT_SITE_ID_ENV_KEYS).join(", ")}`,
    );
  }
  return createLoaderOptions(siteId, rest);
}
