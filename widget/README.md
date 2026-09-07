# @sapportly/widget-sdk

[![npm](https://img.shields.io/npm/v/@sapportly/widget-sdk.svg)](https://www.npmjs.com/package/@sapportly/widget-sdk)
[![CI](https://github.com/Sapportly-Tech/sapportly-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Sapportly-Tech/sapportly-sdk/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@sapportly/widget-sdk.svg)](LICENSE)

**This is the Sapportly Widget SDK** — the official embed helper for the [Sapportly](https://sapportly.pro) chat widget.

Install **`@sapportly/widget-sdk`**. There is no `@supportly/widget-sdk` on npm.

The product, Site ID (`wgt_…`), CDN (`cdn.sapportly.pro`), and `window.Sapportly` remain **Sapportly**. The npm scope `supportly` is not available for this package, so it is published under the **sapportly** org. Do not confuse this with [`@sapportly/sdk`](https://www.npmjs.com/package/@sapportly/sdk) (REST API client) or `@sapportly/api` (internal monorepo package).

Source: [github.com/Sapportly-Tech/sapportly-sdk](https://github.com/Sapportly-Tech/sapportly-sdk) · Docs: [docs.sapportly.pro/docs/guides/widget](https://docs.sapportly.pro/docs/guides/widget)

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
<script>window.Sapportly=window.Sapportly||{q:[]};</script>
<script
  src="https://cdn.sapportly.pro/supportly.widget.js?v=36da946d2c75"
  data-site-id="wgt_..."
  data-api-url="https://api.sapportly.pro"
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
NEXT_PUBLIC_SAPPORTLY_SITE_ID=wgt_...
# legacy alias also works: NEXT_PUBLIC_SUPPORTLY_SITE_ID
```

```typescript
import { installWidget, loaderOptionsFromEnv } from "@sapportly/widget-sdk";

const widget = await installWidget(loaderOptionsFromEnv());
```

## React

```tsx
"use client";

import { SapportlyWidget } from "@sapportly/widget-sdk/react";

export function App() {
  return <SapportlyWidget siteId="wgt_..." />;
}
```

Zero-config with env:

```tsx
import { SapportlyWidgetFromEnv } from "@sapportly/widget-sdk/react";

export function App() {
  return <SapportlyWidgetFromEnv />;
}
```

Custom launcher:

```tsx
import { useSapportly } from "@sapportly/widget-sdk/react";

function ChatButton() {
  const { open, ready, identify } = useSapportly({ siteId: "wgt_..." });
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

import { SapportlyScriptFromEnv } from "@sapportly/widget-sdk/next";

export function SapportlyProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SapportlyScriptFromEnv />
      {children}
    </>
  );
}
```

```tsx
"use client";

import { useSapportlyClient } from "@sapportly/widget-sdk/next";

export function SupportButton() {
  const { open, ready } = useSapportlyClient();
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
import { SapportlyWidget, useSapportlyFromEnv } from "@sapportly/widget-sdk/vue";

const { open, ready } = useSapportlyFromEnv();
</script>

<template>
  <SapportlyWidget site-id="wgt_..." />
  <button :disabled="!ready" @click="open()">Support</button>
</template>
```

## Svelte

```svelte
<script lang="ts">
  import { createSapportly } from "@sapportly/widget-sdk/svelte";

  const { client, ready } = createSapportly({ siteId: "wgt_..." });

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
| `loadSapportly(options)` | Full control over loader options |
| `loaderOptionsFromEnv()` | Resolve Site ID from env vars |
| `resolveSiteId()` | Read Site ID from props/env |
| `buildEmbedSnippet(options)` | HTML copy-paste snippet |
| `getSapportly()` | Get live client or `null` |
| `onSapportlyEvent(event, handler)` | DOM `supportly:*` listener (wire name; product is Sapportly) |

### `SapportlyClient` (embed shell)

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
import { SapportlyClient } from "@sapportly/sdk";

const client = new SapportlyClient({ apiKey: process.env.SAPPORTLY_API_KEY ?? process.env.SUPPORTLY_API_KEY! });
await client.widget.createEmbedSession({ site_id: "wgt_..." });
```

### Subpath exports

| Package | Exports |
|---------|---------|
| `@sapportly/widget-sdk` | loader, snippet, env helpers |
| `@sapportly/widget-sdk/react` | `SapportlyWidget`, `useSapportly`, `*FromEnv` |
| `@sapportly/widget-sdk/next` | `SapportlyScript`, `useSapportlyClient` |
| `@sapportly/widget-sdk/vue` | `SapportlyWidget`, `useSapportly` |
| `@sapportly/widget-sdk/svelte` | `createSapportly`, `attachSapportly` |

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `siteId` | — | Public Site ID `wgt_…` (**required**) |
| `apiUrl` | `https://api.sapportly.pro` | REST API base |
| `cdnUrl` | `https://cdn.sapportly.pro` | Widget assets CDN |
| `wsUrl` | — | WebSocket override |
| `title` | — | Panel title override |
| `version` | WASM hash | Cache-bust query on shell script |

### Env variables

| Variable | Framework |
|----------|-----------|
| `NEXT_PUBLIC_SAPPORTLY_SITE_ID` | Next.js (canon) |
| `VITE_SAPPORTLY_SITE_ID` | Vite (canon) |
| `PUBLIC_SAPPORTLY_SITE_ID` | SvelteKit / Astro (canon) |
| `SAPPORTLY_SITE_ID` | Node scripts (canon) |
| `NEXT_PUBLIC_SUPPORTLY_SITE_ID` etc. | Legacy aliases (still accepted) |

## Publishing

Same GitHub repo as `@sapportly/sdk`. Widget releases use tags `widget-vX.Y.Z` (not `vX.Y.Z` — those publish the REST SDK). See [`../PUBLISHING.md`](../PUBLISHING.md).

## Links

- [Dashboard — Widget settings](https://app.sapportly.pro/widget)
- [Documentation](https://docs.sapportly.pro/docs/guides/widget)
- [Widget REST API](https://docs.sapportly.pro/docs/api/widget)
- [REST API SDK `@sapportly/sdk`](https://www.npmjs.com/package/@sapportly/sdk)

---

## Русский

Это **Sapportly Widget SDK**: на npm пакет **`@sapportly/widget-sdk`**, не `@supportly/widget-sdk`.
Scope `supportly` для публичных SDK недоступен; org npm — **sapportly**. Продукт и виджет —
Sapportly (`cdn.sapportly.pro`, Site ID `wgt_…`, `window.Sapportly`).

Headless REST виджета — `@sapportly/sdk` (`client.widget`), не внутренний `@sapportly/api`.
Лента посетителя — `widget:{uuid}`; реестр канала — `widget:web`.
