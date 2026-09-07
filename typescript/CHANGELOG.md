# Changelog

## Unreleased

## 1.4.4 — 2026-09-08

- Docs/package: GitHub repo renamed to [Sapportly-Tech/sapportly-sdk](https://github.com/Sapportly-Tech/sapportly-sdk).

## 1.4.3 — 2026-09-08

- **Security:** strip Authorization/X-Visitor-Token any casing; webhook tolerance
  rejects NaN and syncs ReplayGuard TTL; atomic replay `claim`; `isValidWebhook`
  does not burn default replay nonce; `ws_url` host allowlist; reply echo race
  via pending idempotency keys (60s TTL).
- SPEC → **2.2.3** (`webhooks:read` / `webhooks:write` on gateway; SDK documents
  verify/replay/ws trust).

## 1.4.2 — 2026-09-08

- **Security:** webhook verify uses trimmed secret; default in-process replay guard;
  inbox awaits async handlers; missing `message_id` fail-closed under dedup.

## 1.4.1 — 2026-09-08

- **Inbox opt-in release:** `MessageSeenStore.release` + `releaseOnHandlerError` (default still at-most-once).
  Fleet: `ExternalSeenStoreHooks.tryRelease` (e.g. Redis `DEL`).
- **DIY list warn:** bare `list`/`asList` logs a one-shot console warning; prefer `*Page` / `iterate*`.
- SPEC → **2.2.2**.

## 1.4.0 — 2026-09-07

- **List envelope (gateway):** `X-Sapportly-List-Envelope` / `?envelope=true` wired on
  conversations, messages, widget history, channels, contacts, assignment history.
  Legacy header `X-Supportly-List-Envelope` still accepted. SDK also sends `?envelope=true`.
- **Breaking (import path):** `SapportlyInbox` and wire helpers are exported only from
  `@sapportly/sdk/realtime` (no longer from the main entry).
- Docs: fix `@supportly/sdk` naming typo; canon env `SAPPORTLY_*` with `SUPPORTLY_*` alias;
  `sapportly:` error `toString()`; `MessageAccepted.duplicate`; multi-worker / catch-up caps callouts.

- **Breaking — SDK callback HMAC (BH-6).** Outgoing `conversation.escalated` (escalation webhook) is no longer signed with a key derived from the tenant UUID. Verify with the random secret from the panel (`POST /v1/sdk/callback-secret/rotate`, shown once like an API key). Closed beta: rotate the secret and update receivers.

- **Polish:** SPEC dual-delivery at-most-once/`onError`; contacts/`assignmentHistory` `*Page`;
  cap-only pagination docs; catch-up has_more test; advisory Term label unit test.

- **P-08 pagination:** iterators honour list envelope `has_more` / `next_cursor`.
  Stops when `has_more` is `false` even on a full page (no infinite loop). New
  `ListPage` / `parseListBody` / `requestListPage`.
- **P-09 inbox dedup:** `await` claim before emit; per-`message_id` claim queue so
  concurrent dual delivery cannot double-fire. Document atomic `tryClaim` (Redis NX).
- **P-10 idempotency:** no `Math.random` fallback — CSPRNG only or `SapportlyConfigError`.
- **P-02:** `verifyWebhook` rejects empty/whitespace secrets (`missing_secret`).
- **Errors:** HTTP 401 maps to `SapportlyAuthError` (aligned with P-04).
- **Audit harden:** malformed `has_more` → stop; inbox handler errors → `onError`;
  ZWSP webhook secrets rejected; README/JSDoc warn against DIY `list()` length loops.

## 1.3.0 — 2026-08-20

- **Треды custom-каналов.** Источник остаётся `custom:shop` (реестр, аналитика).
  Диалог 1:1 — `custom:shop:{uuid}`. Шлюз собирает UUID v5 из
  `identity.external_id` (тот же namespace, что в Rust). Без identity — legacy,
  одна лента на источник.
- Хелперы: `bindThreadKey`, `deriveThreadId`, `sourceChannel`,
  `conversationMatchesSource`, `parseConversationKey`.
- `ingest.send` привязывает тред до POST. `MessageAccepted` отдаёт
  `channel` / `source_channel` / `thread_id`.
- `SapportlyInbox` / realtime: фильтр `channels: ["custom:shop"]` ловит треды.
  `InboxMessage` несёт `sourceChannel`, `threadId`, `externalId`.
- Reply из панели адресует тред; `onAgent` получает `externalId` для доставки
  человеку. Пример `examples/telegram-bot.ts` без `selectedChatId`.

## 1.2.1 — 2026-08-19

- **npm package name:** `@sapportly/sdk` (org **sapportly**). There is no `@supportly/sdk` — that scope is unavailable for this SDK. The product and API remain Sapportly.
- **Inbox roles:** `assistant` is treated as an agent (`onAgent`); `system` is no longer routed to `onVisitor`.
- **Echo set** for `inbox.reply` is capped so a missing echo cannot grow unbounded.
- Wire helpers `isAgentRole` / `isAgentReply` / `isVisitorMessage` match the dashboard mapping.
- **`ai.draft` is not recorded** in the dual-delivery seen-set (it reuses the inbound `message_id`).
- Generated `conversations.reply` keys are prefixed `agent-reply-` so REST history can tell them apart from ingest.
- **Node 18 webhooks:** HMAC uses `node:crypto.webcrypto` when `globalThis.crypto.subtle` is missing.

## 1.2.0 — 2026-08-19

- **Contacts:** `client.contacts.list/get/upsert` → `/v1/contacts`.
- **List envelope:** SDK sends `X-Sapportly-List-Envelope: 1` and unwraps `{ data }`, still accepts a bare array.
- **Idempotency-Key** header is sent alongside `idempotency_key` in the body.
- **Structured errors:** `code`, `type`, `docsUrl`, `requestId` from the JSON body; `message` preferred over `error`.
- **Rate-limit headers** are parsed into `client.rateLimit`.
- **RAG** is JSON `{ title, body }` (`list` / `upload` / `delete`). Multipart `filename`+`content` still accepted as a fallback.
- Conversation summaries include `status` (`open` | `resolved` | `transferred`).

## 1.1.1 — 2026-08-14

- Канал — источник для аналитики (`custom:telegram`), не тред на chat_id.
  Хелперы `channelKey` / `channelIdentifier`. Пример `examples/telegram-bot.ts`.
- `SapportlyInbox`: `echo` на кадрах своего `reply`, чтобы бот не слал в Telegram дважды.
- Комментарии в коде: ingest vs reply, шифрование body, дедуп `ai.draft`.

## 1.1.0 — 2026-08-14

- **`SapportlyInbox`** (`@sapportly/sdk/realtime`): reconnecting socket with
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
  `app.sapportly.pro` behind a session JWT, RBAC, and a proxy gate; they were
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
  `X-Sapportly-Timestamp` + `X-Sapportly-Signature` over `"{timestamp}.{body}"`
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
- **Reconnecting realtime** — `SapportlyRealtime` mints a fresh ticket per
  reconnect, since tickets are single-use.
- `client.rateLimit`, `setApiKey()`, per-request `timeoutMs` / `retry` /
  `signal` overrides.

### Changed

- Package is now part of the pnpm workspace; tests run on the monorepo's
  vitest, and the dual ESM/CJS build uses esbuild like `@sapportly/widget-sdk`
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
- `client.realtime.issueTicket()`, `SapportlyRealtime.connect()` (`ws:connect`).
- `MessageDeduper`, `extractMessageId()` for dual-delivery dedup.
- Subpath export `@sapportly/sdk/realtime`.

## 0.1.0 — 2026-07-14

- Initial release: REST coverage, webhook HMAC verification, WebSocket URL
  helper, ESM + CJS build.
