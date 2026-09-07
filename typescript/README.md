# @sapportly/sdk

[![npm](https://img.shields.io/npm/v/@sapportly/sdk.svg)](https://www.npmjs.com/package/@sapportly/sdk)
[![CI](https://github.com/Sapportly-Tech/supportly-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Sapportly-Tech/supportly-sdk/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@sapportly/sdk.svg)](LICENSE)

**This is the Sapportly TypeScript SDK** — the official client for the [Sapportly](https://sapportly.pro) public API.

Install **`@sapportly/sdk`**. There is no `@supportly/sdk` on npm.

The product, API host (`api.sapportly.pro`), and classes (`SapportlyClient`, `SapportlyInbox`, …) remain **Sapportly**. The npm scope and organization name `supportly` are not available for this SDK, so the package is published under the **sapportly** org. Do not confuse this with [`@sapportly/widget-sdk`](https://www.npmjs.com/package/@sapportly/widget-sdk) (browser widget) or `@sapportly/api` (internal monorepo package).

Source: [github.com/Sapportly-Tech/supportly-sdk](https://github.com/Sapportly-Tech/supportly-sdk) · Docs: [docs.sapportly.pro/docs/sdk/typescript](https://docs.sapportly.pro/docs/sdk/typescript)

- **Runs anywhere `fetch` does** — Node 18+, Bun, Deno, Cloudflare Workers, browsers.
- **No runtime dependencies.**
- **Typed errors**, automatic retries with backoff, keyset pagination as async iterators
  (stops on envelope `has_more: false`, including full final pages).
- **Webhook verification built in** — timestamped HMAC, constant-time compare.

```bash
npm install @sapportly/sdk
```

## Zero to first message

Create an API key in the dashboard (Settings → API keys) with the
`messages:write` scope. Keys are shown once.

```ts
import { SapportlyClient } from "@sapportly/sdk";

const client = new SapportlyClient({ apiKey: process.env.SAPPORTLY_API_KEY ?? process.env.SUPPORTLY_API_KEY! });

const result = await client.ingest.send({
  channel: "custom:shop",
  body: "Где мой заказ?",
  identity: { email: "ada@example.com", external_id: "ord_1042" },
});

console.log(result.accepted); // true
```

That is the whole happy path. `idempotency_key` is generated for you (CSPRNG;
throws `SapportlyConfigError` if none is available — never a weak PRNG), so if the
call is retried — by the SDK or by you — the platform recognises the duplicate
and stores one message.

`accepted: true` with a stable `message_id` and `channel` means the write was queued (HTTP 202); persist is async.
A populated `message_id` (HTTP 200) means the key matched an earlier write and
nothing new was created.

## Каналы

Реестр и аналитика — **источник** `namespace:slug` (`custom:shop`).
Диалог в панели и история ИИ — **тред** `namespace:slug:{uuid}`.

Не создавайте канал на человека. Передайте `identity.external_id` (или `thread_id`):
шлюз соберёт стабильный UUID v5. Без identity остаётся общая лента источника (legacy).

```ts
const accepted = await client.ingest.send({
  channel: "custom:shop",
  body: text,
  idempotency_key: `shop:${orderId}:${commentId}`,
  identity: { email, external_id: orderId },
});
// accepted.channel === "custom:shop:{uuid}" — этот ключ для reply и истории

inbox.onAgent(async (msg) => {
  if (msg.echo) return;
  await deliverToCustomer(msg.externalId, msg.body); // человек
  // панель уже записала исходящее в msg.channel
});

await client.conversations.reply(accepted.channel!, { body: reply });
```

Виджет — исключение: тред `widget:{visitor_uuid}`, реестр `widget:web`.

## Realtime inbox (bots / custom admin)

```ts
import { SapportlyInbox } from "@sapportly/sdk/realtime";

const inbox = new SapportlyInbox(client, { channels: ["custom:shop"] });
inbox.onVisitor((m) => console.log("user", m.body));
inbox.onAgent((m) => {
  if (m.echo) return; // свой reply — в CRM уже отправили
  console.log("agent", m.channel, m.externalId, m.body);
});
inbox.onAi((d) => console.log("ai", d.draft_body));
await inbox.connect();
await inbox.reply("custom:shop", "Принято");
```

Tickets are single-use; the wrapper mints a new one on every reconnect. Integrator
guidebook (receive user messages, receive operator replies, send both directions,
AI drafts vs auto-reply, catch-up pagination):
https://docs.sapportly.pro/docs/sdk/inbox

## Production recipe: custom channels (panel ↔ integrator)

Оператор отвечает в панели (`app.sapportly.pro`) → платформа пишет в ленту → ваш процесс
получает кадр и доставляет человеку во внешний канал. API host: `https://api.sapportly.pro`.

### WS-only

Держите долгоживущий процесс с `ws:connect` + `conversations:write`.

```ts
import { SapportlyClient } from "@sapportly/sdk";
import { SapportlyInbox } from "@sapportly/sdk/realtime";

const client = new SapportlyClient({ apiKey: process.env.SAPPORTLY_API_KEY ?? process.env.SUPPORTLY_API_KEY! });
const inbox = new SapportlyInbox(client, { channels: ["custom:shop"] });

inbox.onAgent(async (msg) => {
  if (msg.echo) return; // свой inbox.reply — во внешний канал уже отправили
  await deliverToCustomer(msg.externalId, msg.body); // ответ из панели
});

inbox.onStateChange((state) => {
  if (state !== "open") return;
  // Сокет интегратора НЕ реплеит историю. Persist only — не deliverToCustomer.
  void inbox.catchUp({
    // Defaults: maxConversationPages=3, maxMessagePages=1 — raise after long outages.
    maxConversationPages: 20,
    maxMessagePages: 5,
    onMessage: (row) => persistLocally(row),
  });
});

await inbox.connect();
```

### Webhooks-only

HTTPS endpoint + secret. Слушайте `agent.reply` (исходящее) и `message.received` (входящее).
Черновики ИИ (`ai.draft`) на webhooks **нет**.

```ts
import { verifyWebhook, extractMessageId, MessageDeduper } from "@sapportly/sdk";

const deduper = new MessageDeduper(); // один процесс; на флоте — ExternalMessageSeenStore

app.post("/hooks/sapportly", express.raw({ type: "application/json" }), async (req, res) => {
  await verifyWebhook(process.env.SAPPORTLY_WEBHOOK_SECRET ?? process.env.SUPPORTLY_WEBHOOK_SECRET!, req.body, {
    timestamp: req.header("X-Sapportly-Timestamp"),
    signature: req.header("X-Sapportly-Signature"),
  });
  const event = JSON.parse(req.body.toString("utf8"));
  const id = extractMessageId(event);
  if (id && deduper.seen(id)) return res.sendStatus(204);
  if (event.type === "agent.reply") {
    void deliverToCustomer(/* external_id из data.payload */, /* body */);
  }
  res.sendStatus(204);
});
```

### Both (WS + webhooks)

Одинаковый `message_id` на обоих каналах. Обязателен общий store на флоте:

```ts
import { ExternalMessageSeenStore, SapportlyClient } from "@sapportly/sdk";
import { SapportlyInbox } from "@sapportly/sdk/realtime";

const seen = new ExternalMessageSeenStore({
  async tryClaim(id, ttlMs) {
    // Redis SET NX: true = duplicate (skip), false = first claim
    const ok = await redis.set(`sapportly:seen:${id}`, "1", "PX", ttlMs, "NX");
    return ok === null;
  },
});

const inbox = new SapportlyInbox(client, { channels: ["custom:shop"], dedup: seen });
```

В webhook-хендлере вызывайте тот же `seen.claim(message_id)` перед `deliverToCustomer`.

### Anti-dup checklist

| Риск | Что делать |
|------|------------|
| WS + webhook twin | `message_id` + `MessageSeenStore` |
| Свой `inbox.reply` | `onAgent` → `if (msg.echo) return` |
| **Флот воркеров** | In-memory `MessageDeduper` и `echo` **не шарятся**. На ≥2 процессах нужен общий `ExternalMessageSeenStore` (Redis SET NX и т.п.). Reply на воркере A приходит на B как `echo: false` — без общего store будет повторная доставка человеку. |
| Reconnect gap | `inbox.catchUp` / `catchUpInbox` — **persist**, не deliver |
| Долгий даунтайм | Дефолты catch-up мелкие (`maxConversationPages=3`, `maxMessagePages=1`). Поднимите caps, иначе история обрежется; сокет историю не реплеит. |
| `ai.draft` | не класть draft `message_id` в seen-set (Inbox уже так делает) |

Env в примерах: канон `SAPPORTLY_API_KEY` / `SAPPORTLY_WEBHOOK_SECRET`; legacy alias `SUPPORTLY_*`. SDK **не** читает env сам — передайте `apiKey` в конструктор.

Подробный гайд: https://docs.sapportly.pro/docs/sdk/inbox

## Receiving a webhook

This is the part worth getting right. The platform signs
`"{timestamp}.{body}"` with HMAC-SHA256 and sends
`X-Sapportly-Timestamp` plus `X-Sapportly-Signature: sha256=<hex>`. Verification
must compare in constant time and reject anything older than 300 seconds, or a
captured request stays replayable forever.

```ts
import { verifyWebhook } from "@sapportly/sdk/webhooks";

app.post("/hooks/sapportly", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    await verifyWebhook(process.env.SAPPORTLY_WEBHOOK_SECRET ?? process.env.SUPPORTLY_WEBHOOK_SECRET!, req.body, {
      timestamp: req.header("X-Sapportly-Timestamp"),
      signature: req.header("X-Sapportly-Signature"),
    });
  } catch {
    return res.sendStatus(401);
  }

  const event = JSON.parse(req.body.toString("utf8"));
  res.sendStatus(204); // ack fast, process afterwards
});
```

**`rawBody` must be the exact bytes received.** A JSON body parser re-serialises
the payload, changing key order and whitespace, and the signature will not
match. On frameworks with a `Request` object there is a one-liner that reads
the body correctly for you:

```ts
import { verifyWebhookRequest } from "@sapportly/sdk/webhooks";

export async function POST(request: Request) {
  const event = await verifyWebhookRequest(process.env.SAPPORTLY_WEBHOOK_SECRET ?? process.env.SUPPORTLY_WEBHOOK_SECRET!, request);
  return new Response(null, { status: 204 });
}
```

`verifyWebhook` throws `WebhookVerificationError` with a `reason` of
`missing_timestamp`, `invalid_timestamp`, `stale_timestamp`, `missing_signature`,
`malformed_signature`, or `signature_mismatch`. Log the reason; return 401
regardless.

## Handling errors

Every failure is a subclass of `SapportlyError`, carrying `status`, `requestId`,
`code`, `type`, `docsUrl`, the parsed `body`, and the number of `attempts` made.

```ts
import {
  SapportlyRateLimitError,
  SapportlyPermissionError,
  SapportlyValidationError,
  SapportlyError,
} from "@sapportly/sdk";

try {
  await client.ingest.send({ channel: "custom:shop", body: "hi" });
} catch (error) {
  if (error instanceof SapportlyRateLimitError) {
    // Already retried and still limited.
    console.warn(`retry in ${error.retryAfterMs}ms`);
  } else if (error instanceof SapportlyPermissionError) {
    console.error("API key is missing a scope:", error.message);
  } else if (error instanceof SapportlyValidationError) {
    console.error("bad request:", error.body);
  } else if (error instanceof SapportlyError) {
    console.error(`${error.name} ${error.status} (request ${error.requestId})`);
  }
}
```

| Class | When |
|-------|------|
| `SapportlyConfigError` | Missing API key, no `fetch`, or no CSPRNG for auto `idempotency_key` |
| `SapportlyConnectionError` | Network failure |
| `SapportlyTimeoutError` | Deadline elapsed, or the caller aborted (`error.aborted`) |
| `SapportlyAuthError` | 401 — key invalid or revoked |
| `SapportlyPermissionError` | 403 — key lacks the required scope |
| `SapportlyNotFoundError` | 404 |
| `SapportlyValidationError` | Other 4xx — bad payload |
| `SapportlyPaymentRequiredError` | 402 — plan quota exhausted (`resource`, `used`, `limit`) |
| `SapportlyPayloadTooLargeError` | 413 — body over 2 MiB |
| `SapportlyRateLimitError` | 429 — includes `retryAfterMs` |
| `SapportlyServerError` | 5xx |

## Retries

Enabled by default: up to two retries on 429, 5xx, and network errors, with
exponential backoff and full jitter, honouring `Retry-After`.

Writes are only retried when a replay is provably safe — `ingest.send`,
`conversations.reply`, and widget sends carry an `idempotency_key`, so they are.
`conversations.transfer`, `analytics.track`, and `attachments.createUploadIntent`
would duplicate work on replay, so they are never retried.

```ts
const client = new SapportlyClient({
  apiKey: process.env.SAPPORTLY_API_KEY ?? process.env.SUPPORTLY_API_KEY!,
  timeoutMs: 10_000,
  retry: { maxRetries: 4, initialDelayMs: 200, maxDelayMs: 10_000 },
});

// Per call
await client.conversations.list({}, { timeoutMs: 2_000, retry: { maxRetries: 0 } });
```

## Pagination

List endpoints use keyset cursors. Prefer **`iterate` / `iterateMessagePages` /
`listPage` / `messagesPage` / `historyPage`** — they honour envelope `has_more`.
`list()` / `messages()` / `history()` return bare arrays (envelope unwrapped);
do **not** DIY-loop while `page.length === limit` or a full final page loops forever.

```ts
for await (const conversation of client.conversations.iterate({ limit: 100 })) {
  console.log(conversation.channel, conversation.last_at);
}

// Backwards through one channel's history, in pages
for await (const page of client.conversations.iterateMessagePages("widget:abc", { limit: 200 })) {
  await archive(page);
}

// Bounded
import { collect } from "@sapportly/sdk";
const recent = await collect(client.conversations.iterate({ maxItems: 500 }));
```

## Realtime

Tickets are single-use and expire in about a minute, so the socket wrapper
mints a fresh one on every connect and reconnect.

```ts
import { SapportlyRealtime } from "@sapportly/sdk/realtime";

const stream = new SapportlyRealtime({
  tickets: client.realtime,
  // Node 18/20 have no global WebSocket:
  // WebSocket: (url) => new (require("ws").WebSocket)(url),
  onEvent: (event) => console.log(event.type, event.payload),
});

await stream.connect();
```

If you consume both webhooks and the WebSocket, deduplicate on `message_id` —
it is the only identifier stable across channels. `SapportlyInbox` awaits claim
before emit and serializes per id; fleet stores must use an **atomic** `tryClaim`
(Redis `SET NX`). After a successful claim, handler errors go to `onError`
(at-most-once — no auto-unclaim; fleet stores dead-letter). Empty webhook
secrets are rejected:

```ts
import { MessageDeduper, extractMessageId } from "@sapportly/sdk";

const deduper = new MessageDeduper();
const id = extractMessageId(frame);
if (id && deduper.seen(id)) return; // already handled
```

## Attachments

Files bypass the API: the SDK requests a presigned URL, PUTs the bytes to
storage directly, then finalises. The 2 MiB request cap does not apply.

```ts
const file = await client.attachments.upload({
  channel: "custom:telegram",
  filename: "invoice.pdf",
  mimeType: "application/pdf",
  content: bytes, // Blob | ArrayBuffer | Uint8Array
});

await client.ingest.send({
  channel: "custom:telegram",
  body: "Invoice attached",
  attachment_ids: [file.id],
});
```

## Scopes

A key only reaches what its scopes allow; a missing scope is a 403.

| Scope | Grants |
|-------|--------|
| `messages:write` | `client.ingest.send()` |
| `conversations:read` | `conversations.list/messages/getAssignment/assignmentHistory` |
| `conversations:write` | `conversations.reply()` |
| `conversations:assign` | `conversations.assign()`, `conversations.transfer()` |
| `channels:read` | `channels.list()`, `channels.get()` |
| `channels:write` | `channels.create/update/archive()` |
| `attachments:write` | `attachments.*` (legacy keys with `messages:write` also work) |
| `team:read` | `team.listRoles()` |
| `analytics:write` | `analytics.track()` |
| `ws:connect` | `realtime.createTicket()` |
| `webhooks:read` | `webhooks.get()` (legacy: `conversations:read`) |
| `webhooks:write` | `webhooks.update()` / `webhooks.test()` (legacy: `conversations:write`) |
| `widget:embed:issue` | `widget.createEmbedSession()` |

No scope is needed for `status()`, `health()`, `ready()`, or
`widget.bootstrap()`.

## Client surface

```
SapportlyClient(options)
├── status() / health() / ready()
├── rateLimit                      last seen rate-limit headers
├── setApiKey(key)
├── ingest.send()
├── conversations  list · listPage · iterate · messages · messagesPage · iterateMessages · iterateMessagePages
│                  reply · getAssignment · assign · transfer · assignmentHistory · assignmentHistoryPage
├── contacts       list · listPage · get · upsert
├── channels       list · get · create · update · archive
├── attachments    upload · createUploadIntent · complete · get · download
├── webhooks       get · update · test
├── rag            list · upload · delete
├── team           listRoles
├── analytics      track
├── realtime       createTicket
└── widget         createEmbedSession · bootstrap · sendMessage · history · historyPage · iterateHistoryPages
                   iterateHistoryPages · trackEvent · cannedPrompt · channelSecurity
                   identify · listCapabilityConfirms · actCapabilityConfirm
```

| Option | Default | Notes |
|--------|---------|-------|
| `apiKey` | — | Required for scoped endpoints |
| `baseUrl` | `https://api.sapportly.pro` | |
| `timeoutMs` | `30000` | Per attempt; `0` disables |
| `fetch` | global | Inject for proxies or tests |
| `headers` | `{}` | Added to every request; cannot override `Authorization` |
| `retry` | 2 retries, 250 ms base, full jitter | See above |

## Widget vs. this SDK

`@sapportly/sdk` is a server-side client. To put a chat widget on a website use
[`@sapportly/widget-sdk`](https://www.npmjs.com/package/@sapportly/widget-sdk),
which authenticates with a public Site ID.

`client.widget.createEmbedSession()` is the bridge: call it from your backend to
mint a visitor session without exposing the API key to the browser.

## Notes on the API

- Request bodies are capped at 2 MiB (413 beyond that).
- Rate limiting is a Redis sliding window. `client.rateLimit` exposes
  `X-RateLimit-*` headers when present — currently the gateway rarely sends
  them, so treat it as advisory and rely on the 429 handling.

## Out of scope: panel / dashboard API

`@sapportly/sdk` covers **only** the public mass API on `api.sapportly.pro`
(ingest, conversations, channels, widget embed, webhooks, attachments, WS
tickets). It does **not** include:

- Login, team invite, billing admin, knowledge base, panel AI, incidents admin
- Flow rules, capabilities, analytics dashboards, API key management
- Any route under `app.sapportly.pro` / `/api/slc`

Those live on `platform_surface` behind a panel session JWT and the internal
OpenAPI at `packages/panel/openapi.json`. Use the dashboard UI or your own BFF;
do not point the SDK at panel routes.

Per-agent inbox helpers (`/v1/inbox/unread`, mark-read) are panel-only even
though the gateway mounts them on the public router for the BFF proxy — they
are intentionally absent from this SDK and from `packages/api/openapi.json`.

## Development

```bash
git clone https://github.com/Sapportly-Tech/supportly-sdk.git
cd supportly-sdk/typescript
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

In the Sapportly monorepo the same package is `sdks/typescript`:

```bash
pnpm --filter @sapportly/sdk test
pnpm --filter @sapportly/sdk typecheck
pnpm --filter @sapportly/sdk build
```

Releases are semver tags (`v1.4.3`) on this repository. See [`../PUBLISHING.md`](../PUBLISHING.md).

## License

MIT
