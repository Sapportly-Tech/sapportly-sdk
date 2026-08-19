# Changelog

## 1.2.1 — 2026-08-19

- **Inbox roles:** `assistant` is treated as an agent (`onAgent`); `system` is no longer routed to `onVisitor`.
- **Echo set** for `inbox.reply` is capped so a missing echo cannot grow unbounded.
- Wire helpers `isAgentRole` / `isAgentReply` / `isVisitorMessage` match the dashboard mapping.
- **`ai.draft` is not recorded** in the dual-delivery seen-set (it reuses the inbound `message_id`).
- Generated `conversations.reply` keys are prefixed `agent-reply-` so REST history can tell them apart from ingest.

## 1.2.0 — 2026-08-19

- **Contacts:** `client.contacts.list/get/upsert` → `/v1/contacts`.
- **List envelope:** SDK sends `X-Supportly-List-Envelope: 1` and unwraps `{ data }`, still accepts a bare array.
- **Idempotency-Key** header is sent alongside `idempotency_key` in the body.
- **Structured errors:** `code`, `type`, `docsUrl`, `requestId` from the JSON body; `message` preferred over `error`.
- **Rate-limit headers** are parsed into `client.rateLimit`.
- **RAG** is JSON `{ title, body }` (`list` / `upload` / `delete`). Multipart `filename`+`content` still accepted as a fallback.
- Conversation summaries include `status` (`open` | `resolved` | `transferred`).

## 1.1.1 — 2026-08-14

- Канал — источник для аналитики (`custom:telegram`), не тред на chat_id.
  Хелперы `channelKey` / `channelIdentifier`. Пример `examples/telegram-bot.ts`.
- `SupportlyInbox`: `echo` на кадрах своего `reply`, чтобы бот не слал в Telegram дважды.
- Комментарии в коде: ingest vs reply, шифрование body, дедуп `ai.draft`.

## 1.1.0 — 2026-08-14

- **`SupportlyInbox`** (`@supportly/sdk/realtime`): reconnecting socket with
  `onVisitor` / `onAgent` / `onAi`, channel filter, reply helper, async
  iterator. Integrator bots no longer mint tickets by hand.
- **Wire helpers:** `parseWireEvent`, `classifyWireEvent` — frames without
  `event_id` are accepted; `ai.draft` is a first-class kind.
- **`nodeWebSocketFactory`** for Node 22+ / Bun.

## 1.0.0 — 2026-07-30

First release of the rebuilt SDK. TypeScript is now the single reference client
for the public API; see [`../README.md`](../README.md).

Breaking, and there are many — treat this as a new library rather than an
upgrade.

### Removed

- **`client.dashboard.*`** — the panel/internal API. Those routes live on
  `app.supportly.cc` behind a session JWT, RBAC, and a proxy gate; they were
  never usable with an API key and shipping them in a public SDK implied a
  support contract that does not exist. Includes `inboxUnread()` and
  `markRead()`, which reached `/v1/inbox/unread` and
  `/v1/conversations/{channel}/read` — both require a panel session despite
  sitting on the public router.
- **`websocketTicketUrl()`** — renamed to `websocketUrl()`, same behaviour.
- **`realtime.issueTicket()`** — renamed to `realtime.createTicket()`.
- **`isEphemeralWidgetVisitorChannel()`** — renamed to
  `isWidgetVisitorChannel()`.
- Auth, API-key management, and contact-form helpers: panel surface.

### Added

- **Timestamped webhook verification.** `verifyWebhook`,
  `verifyWebhookRequest`, and `isValidWebhook` check
  `X-Supportly-Timestamp` + `X-Supportly-Signature` over `"{timestamp}.{body}"`
  with a 300-second window and a constant-time compare. The previous helper
  verified the body alone, which left captured requests replayable
  indefinitely.
- **Automatic retries** — exponential backoff with jitter on 429/5xx/network
  errors, honouring `Retry-After`, capped by `maxRetryAfterMs`. Non-idempotent
  writes are never retried.
- **Automatic idempotency keys** on every message write, making those retries
  safe by default.
- **Typed error hierarchy** — twelve classes carrying `status`, `requestId`,
  parsed `body`, and `attempts`.
- **Keyset pagination iterators** — `conversations.iterate`,
  `iterateMessages`, `iterateMessagePages`, `widget.iterateHistoryPages`, plus
  the generic `paginate` / `paginatePages` / `collect`.
- **Conversation assignment** — `getAssignment`, `assign`, `transfer`,
  `assignmentHistory` (`conversations:assign`).
- **Channel registry** — `channels.list/get/create/update/archive`.
- **Team roles** — `team.listRoles()` (`team:read`).
- **Custom metrics** — `analytics.track()` (`analytics:write`).
- **Attachment download** — `attachments.get()` and `attachments.download()`.
- **Reconnecting realtime** — `SupportlyRealtime` mints a fresh ticket per
  reconnect, since tickets are single-use.
- `client.rateLimit`, `setApiKey()`, per-request `timeoutMs` / `retry` /
  `signal` overrides.

### Changed

- Package is now part of the pnpm workspace; tests run on the monorepo's
  vitest, and the dual ESM/CJS build uses esbuild like `@supportly/widget-sdk`
  (tsup and the standalone `package-lock.json` are gone).
- `sideEffects: false`; `./package.json` added to the `exports` map.
- Node 18 is still supported: no `AbortSignal.any`, no Node-only imports in any
  entry point.
- Zero runtime dependencies.

### Fixed

- A WebSocket that closed before opening left `connect()` pending forever and
  stalled the reconnect loop; a pre-open close now rejects.

## 0.3.0 — 2026-07-25

- Inbox realtime (panel): `unread_count`, `inboxUnread()`, `markRead()`.
- OpenAPI v1.3 paths `/v1/inbox/unread`, `/v1/conversations/{channel}/read`.

## 0.2.0 — 2026-07-20

- `client.conversations.list/messages/reply` (API key + `conversations:*`).
- `client.attachments.upload()` — intent → presigned PUT → complete.
- `client.realtime.issueTicket()`, `SupportlyRealtime.connect()` (`ws:connect`).
- `MessageDeduper`, `extractMessageId()` for dual-delivery dedup.
- Subpath export `@supportly/sdk/realtime`.

## 0.1.0 — 2026-07-14

- Initial release: REST coverage, webhook HMAC verification, WebSocket URL
  helper, ESM + CJS build.
