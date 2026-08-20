import { defineComponent, onMounted, onUnmounted, ref, type Ref } from "vue";
import { getSupportly, loadSupportly } from "./loader";
import { loaderOptionsFromEnv, type LoaderOptionsFromEnvOptions } from "./options";
import type {
  SupportlyClient,
  SupportlyIdentifyTraits,
  SupportlyLoaderOptions,
} from "./types";

export interface UseSupportlyOptions extends SupportlyLoaderOptions {
  destroyOnUnmount?: boolean;
  manual?: boolean;
}

export interface UseSupportlyReturn {
  client: Ref<SupportlyClient | null>;
  ready: Ref<boolean>;
  error: Ref<Error | null>;
  open: () => Promise<void>;
  close: () => Promise<void>;
  toggle: () => Promise<void>;
  track: (name: string, properties?: Record<string, unknown>) => void;
  identify: (traits?: SupportlyIdentifyTraits) => Promise<{ ok: boolean }>;
}

/** Vue 3 composable — loads the widget and exposes the embed API. */
export function useSupportly(options: UseSupportlyOptions): UseSupportlyReturn {
  const { destroyOnUnmount = false, manual = false, ...loaderOptions } = options;

  const client = ref<SupportlyClient | null>(manual ? getSupportly() : null);
  const ready = ref(false);
  const error = ref<Error | null>(null);
  let owned = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  onMounted(() => {
    const attach = (instance: SupportlyClient) => {
      client.value = instance;
      ready.value = true;
    };

    const fail = (err: unknown) => {
      error.value = err instanceof Error ? err : new Error(String(err));
    };

    if (manual) {
      const existing = getSupportly();
      if (existing) {
        existing.ready.then(() => attach(existing)).catch(fail);
        return;
      }
      pollTimer = setInterval(() => {
        const live = getSupportly();
        if (live) {
          clearInterval(pollTimer);
          pollTimer = undefined;
          live.ready.then(() => attach(live)).catch(fail);
        }
      }, 100);
      return;
    }

    owned = true;
    loadSupportly(loaderOptions).then(attach).catch(fail);
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
export function useSupportlyFromEnv(
  options: Omit<UseSupportlyOptions, "siteId"> & LoaderOptionsFromEnvOptions = {},
): UseSupportlyReturn {
  return useSupportly(loaderOptionsFromEnv(options));
}

export const SupportlyWidget = defineComponent({
  name: "SupportlyWidget",
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
    let client: SupportlyClient | null = null;

    onMounted(() => {
      const options: SupportlyLoaderOptions = {
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

      loadSupportly(options)
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

export type { SupportlyClient, SupportlyIdentifyTraits, SupportlyLoaderOptions };
