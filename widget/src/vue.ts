import { defineComponent, onMounted, onUnmounted, ref, type Ref } from "vue";
import { getSapportly, loadSapportly } from "./loader";
import { loaderOptionsFromEnv, type LoaderOptionsFromEnvOptions } from "./options";
import type {
  SapportlyClient,
  SapportlyIdentifyTraits,
  SapportlyLoaderOptions,
} from "./types";

export interface UseSapportlyOptions extends SapportlyLoaderOptions {
  destroyOnUnmount?: boolean;
  manual?: boolean;
}

export interface UseSapportlyReturn {
  client: Ref<SapportlyClient | null>;
  ready: Ref<boolean>;
  error: Ref<Error | null>;
  open: () => Promise<void>;
  close: () => Promise<void>;
  toggle: () => Promise<void>;
  track: (name: string, properties?: Record<string, unknown>) => void;
  identify: (traits?: SapportlyIdentifyTraits) => Promise<{ ok: boolean }>;
}

/** Vue 3 composable — loads the widget and exposes the embed API. */
export function useSapportly(options: UseSapportlyOptions): UseSapportlyReturn {
  const { destroyOnUnmount = false, manual = false, ...loaderOptions } = options;

  const client = ref<SapportlyClient | null>(manual ? getSapportly() : null);
  const ready = ref(false);
  const error = ref<Error | null>(null);
  let owned = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  onMounted(() => {
    const attach = (instance: SapportlyClient) => {
      client.value = instance;
      ready.value = true;
    };

    const fail = (err: unknown) => {
      error.value = err instanceof Error ? err : new Error(String(err));
    };

    if (manual) {
      const existing = getSapportly();
      if (existing) {
        existing.ready.then(() => attach(existing)).catch(fail);
        return;
      }
      pollTimer = setInterval(() => {
        const live = getSapportly();
        if (live) {
          clearInterval(pollTimer);
          pollTimer = undefined;
          live.ready.then(() => attach(live)).catch(fail);
        }
      }, 100);
      return;
    }

    owned = true;
    loadSapportly(loaderOptions).then(attach).catch(fail);
  });

  onUnmounted(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (destroyOnUnmount && owned) {
      client.value?.destroy();
      owned = false;
    }
  });

  return {
    client,
    ready,
    error,
    open: async () => {
      await client.value?.open();
    },
    close: async () => {
      await client.value?.close();
    },
    toggle: async () => {
      await client.value?.toggle();
    },
    track: (name, properties) => {
      client.value?.track(name, properties);
    },
    identify: async (traits) => {
      if (!client.value) return { ok: false };
      return client.value.identify(traits);
    },
  };
}

/** Vue composable — Site ID from prop or env (`VITE_SUPPORTLY_SITE_ID`, …). */
export function useSapportlyFromEnv(
  options: Omit<UseSapportlyOptions, "siteId"> & LoaderOptionsFromEnvOptions = {},
): UseSapportlyReturn {
  return useSapportly(loaderOptionsFromEnv(options));
}

export const SapportlyWidget = defineComponent({
  name: "SapportlyWidget",
  props: {
    siteId: { type: String, required: true },
    apiUrl: String,
    cdnUrl: String,
    wsUrl: String,
    title: String,
    version: String,
    wasmJs: String,
    wasmBin: String,
    widgetCss: String,
    destroyOnUnmount: { type: Boolean, default: true },
  },
  emits: ["ready", "error"],
  setup(props, { emit }) {
    let client: SapportlyClient | null = null;

    onMounted(() => {
      const options: SapportlyLoaderOptions = {
        siteId: props.siteId,
        apiUrl: props.apiUrl,
        cdnUrl: props.cdnUrl,
        wsUrl: props.wsUrl,
        title: props.title,
        version: props.version,
        wasmJs: props.wasmJs,
        wasmBin: props.wasmBin,
        widgetCss: props.widgetCss,
      };

      loadSapportly(options)
        .then((instance) => {
          client = instance;
          emit("ready", instance);
        })
        .catch((err: unknown) => {
          emit("error", err instanceof Error ? err : new Error(String(err)));
        });
    });

    onUnmounted(() => {
      if (props.destroyOnUnmount) client?.destroy();
    });

    return () => null;
  },
});

export type { SapportlyClient, SapportlyIdentifyTraits, SapportlyLoaderOptions };
