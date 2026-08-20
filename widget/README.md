# @sapportly/widget-sdk

[![npm](https://img.shields.io/npm/v/@sapportly/widget-sdk.svg)](https://www.npmjs.com/package/@sapportly/widget-sdk)
[![CI](https://github.com/Supportly-Tech/supportly-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Supportly-Tech/supportly-sdk/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@sapportly/widget-sdk.svg)](LICENSE)

**This is the Sapportly Widget SDK** — the official embed helper for the [Supportly](https://supportly.cc) chat widget.

Install **`@sapportly/widget-sdk`**. There is no `@supportly/widget-sdk` on npm.

The product, Site ID (`wgt_…`), CDN (`cdn.supportly.cc`), and `window.Supportly` remain **Supportly**. The npm scope `supportly` is not available for this package, so it is published under the **sapportly** org. Do not confuse this with [`@sapportly/sdk`](https://www.npmjs.com/package/@sapportly/sdk) (REST API client) or `@supportly/api` (internal monorepo package).

Source: [github.com/Supportly-Tech/supportly-sdk](https://github.com/Supportly-Tech/supportly-sdk) · Docs: [docs.supportly.cc/docs/guides/widget](https://docs.supportly.cc/docs/guides/widget)

Works in any modern browser. Framework helpers for **React**, **Next.js**, **Vue 3**, and **Svelte**. Zero runtime dependencies.

## Security model

The browser embed uses a public **Site ID** (`wgt_…`) — never your API key.

```
data-site-id → POST /v1/widget/bootstrap (Origin allowlist)
            → visitor JWT + ws_ticket + config
            → conversation tape widget:{visitor_uuid}
            → all widget API calls use X-Visitor-Token
```

API keys belong on the server (BFF) only. Headless / server widget REST: [`@sapportly/sdk`](https://www.npmjs.com/package/@sapportly/sdk) → `client.widget` (for example `createEmbedSession()`).

Each visitor already has a 1:1 tape (`widget:{uuid}`). Custom-channel threads (`custom:shop:{uuid}`) are a different surface — the REST SDK, not this package.

## Installation

```bash
npm install @sapportly/widget-sdk
```

Peer dependencies (`react`, `vue`, `svelte`, `next`) are optional — install only what you use.

## Quick start (vanilla)

Copy the snippet from **Dashboard → Widget** or:

```html
<script>window.Supportly=window.Supportly||{q:[]};</script>
<script
  src="https://cdn.supportly.cc/supportly.widget.js?v=322a4f989216"
  data-site-id="wgt_..."
  data-api-url="https://api.supportly.cc"
  async
></script>
```

The `?v=` value is the WASM cache-bust hash shipped with this package (`WIDGET_WASM_ASSET_VERSION`). Dashboard snippets use the same hash from the live config.

### One-liner (TypeScript)

```typescript
import { installWidget } from "@sapportly/widget-sdk";

const widget = await installWidget("wgt_...");
await widget.open();
widget.track("checkout_started", { plan: "pro" });
await widget.identify({ email: "ada@example.com", external_id: "user_42" });
```

### Env-based (Next.js / Node)

```bash
# .env.local
NEXT_PUBLIC_SUPPORTLY_SITE_ID=wgt_...
```

```typescript
import { installWidget, loaderOptionsFromEnv } from "@sapportly/widget-sdk";

const widget = await installWidget(loaderOptionsFromEnv());
```

## React

```tsx
"use client";

import { SupportlyWidget } from "@sapportly/widget-sdk/react";

export function App() {
  return <SupportlyWidget siteId="wgt_..." />;
}
```

Zero-config with env:

```tsx
import { SupportlyWidgetFromEnv } from "@sapportly/widget-sdk/react";

export function App() {
  return <SupportlyWidgetFromEnv />;
}
```

Custom launcher:

```tsx
import { useSupportly } from "@sapportly/widget-sdk/react";

function ChatButton() {
  const { open, ready, identify } = useSupportly({ siteId: "wgt_..." });
  return (
    <button disabled={!ready} onClick={() => void open()}>
      Support
    </button>
  );
}
```

## Next.js (App Router)

```tsx
// app/providers.tsx
"use client";

import { SupportlyScriptFromEnv } from "@sapportly/widget-sdk/next";

export function SupportlyProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SupportlyScriptFromEnv />
      {children}
    </>
  );
}
```

```tsx
"use client";

import { useSupportlyClient } from "@sapportly/widget-sdk/next";

export function SupportButton() {
  const { open, ready } = useSupportlyClient();
  return (
    <button disabled={!ready} onClick={() => void open()}>
      Chat
    </button>
  );
}
```

## Vue 3

```vue
<script setup lang="ts">
import { SupportlyWidget, useSupportlyFromEnv } from "@sapportly/widget-sdk/vue";

const { open, ready } = useSupportlyFromEnv();
</script>

<template>
  <SupportlyWidget site-id="wgt_..." />
  <button :disabled="!ready" @click="open()">Support</button>
</template>
```

## Svelte

```svelte
<script lang="ts">
  import { createSupportly } from "@sapportly/widget-sdk/svelte";

  const { client, ready } = createSupportly({ siteId: "wgt_..." });

  async function openChat() {
    await $client?.open();
  }
</script>

<button disabled={!$ready} on:click={openChat}>Support</button>
```

## API reference

### Core (`@sapportly/widget-sdk`)

| Export | Description |
|--------|-------------|
| `installWidget(siteId)` | Inject script + return client (easiest) |
| `loadSupportly(options)` | Full control over loader options |
| `loaderOptionsFromEnv()` | Resolve Site ID from env vars |
| `resolveSiteId()` | Read Site ID from props/env |
| `buildEmbedSnippet(options)` | HTML copy-paste snippet |
| `getSupportly()` | Get live client or `null` |
| `onSupportlyEvent(event, handler)` | DOM `supportly:*` listener |

### `SupportlyClient` (embed shell)

| Method | Description |
|--------|-------------|
| `ready` | Promise when widget boots |
| `open()` / `close()` / `toggle()` | Panel control |
| `track(name, props?)` | Custom analytics |
| `identify(traits?)` | Persist email / phone / `external_id` on `widget:{uuid}` |
| `on(event, handler)` | Lifecycle (`ready`, `open`, `security_changed`, …) |
| `reloadConfig()` | Refresh preset after Dashboard changes |
| `destroy()` | Remove widget from DOM |

### Headless REST (not this package)

```typescript
import { SupportlyClient } from "@sapportly/sdk";

const client = new SupportlyClient({ apiKey: process.env.SUPPORTLY_API_KEY! });
await client.widget.createEmbedSession({ site_id: "wgt_..." });
```

### Subpath exports

| Package | Exports |
|---------|---------|
| `@sapportly/widget-sdk` | loader, snippet, env helpers |
| `@sapportly/widget-sdk/react` | `SupportlyWidget`, `useSupportly`, `*FromEnv` |
| `@sapportly/widget-sdk/next` | `SupportlyScript`, `useSupportlyClient` |
| `@sapportly/widget-sdk/vue` | `SupportlyWidget`, `useSupportly` |
| `@sapportly/widget-sdk/svelte` | `createSupportly`, `attachSupportly` |

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `siteId` | — | Public Site ID `wgt_…` (**required**) |
| `apiUrl` | `https://api.supportly.cc` | REST API base |
| `cdnUrl` | `https://cdn.supportly.cc` | Widget assets CDN |
| `wsUrl` | — | WebSocket override |
| `title` | — | Panel title override |
| `version` | WASM hash | Cache-bust query on shell script |

### Env variables

| Variable | Framework |
|----------|-----------|
| `NEXT_PUBLIC_SUPPORTLY_SITE_ID` | Next.js |
| `VITE_SUPPORTLY_SITE_ID` | Vite |
| `PUBLIC_SUPPORTLY_SITE_ID` | SvelteKit / Astro |
| `SUPPORTLY_SITE_ID` | Node scripts |

## Publishing

Same GitHub repo as `@sapportly/sdk`. Widget releases use tags `widget-vX.Y.Z` (not `vX.Y.Z` — those publish the REST SDK). See [`../PUBLISHING.md`](../PUBLISHING.md).

## Links

- [Dashboard — Widget settings](https://dashboard.supportly.cc/widget)
- [Documentation](https://docs.supportly.cc/docs/guides/widget)
- [Widget REST API](https://docs.supportly.cc/docs/api/widget)
- [REST API SDK `@sapportly/sdk`](https://www.npmjs.com/package/@sapportly/sdk)

---

## Русский

Это **Sapportly Widget SDK**: на npm пакет **`@sapportly/widget-sdk`**, не `@supportly/widget-sdk`.
Scope `supportly` для публичных SDK недоступен; org npm — **sapportly**. Продукт и виджет —
Supportly (`cdn.supportly.cc`, Site ID `wgt_…`, `window.Supportly`).

Headless REST виджета — `@sapportly/sdk` (`client.widget`), не внутренний `@supportly/api`.
Лента посетителя — `widget:{uuid}`; реестр канала — `widget:web`.
