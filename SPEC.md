# Supportly Public SDK Specification

**Version:** 2.1.1  
**API base URL:** `https://api.supportly.cc`  
**OpenAPI:** [docs.supportly.cc/openapi.json](https://docs.supportly.cc/openapi.json)

This document is the **canonical behavioural contract** for any client of the
public API — the maintained Sapportly TypeScript SDK (`@sapportly/sdk`), a
generated client, or a hand-written one. The OpenAPI spec defines the wire
format; this document defines what a correct client does with it.

**Package name:** `@sapportly/sdk` (npm org **sapportly**). There is no
`@supportly/sdk` — that scope is unavailable for this SDK. The product and API
remain Supportly.

**Reference implementation:** [`typescript/src`](typescript/src). The eight
other SDKs were archived in v2.0.0 — see [`README.md`](README.md).

---

## 1. Scope

### In scope (public SDK)

| Area | Auth | Endpoints |
|------|------|-----------|
| Ops | none | `GET /health`, `GET /ready`, `GET /metrics` |
| Status | none | `GET /v1/status` |
| Ingest | API key (`messages:write`) | `POST /v1/ingest/messages` |
| Widget | API key (browser: none) + visitor JWT | `POST /v1/widget/bootstrap` (browser), `POST /v1/widget/embed-session` (server BFF), `POST/GET /v1/widget/messages`, `POST /v1/widget/events`, `POST /v1/widget/identify`, `GET/POST /v1/widget/capability-confirm` |
| Attachments | API key (`attachments:write`) | `POST /v1/attachments/intent`, `POST /v1/attachments/{id}/complete`, `GET /v1/attachments/{id}` |
| WebSocket | API key (`ws:connect`) or widget session | `POST /v1/ws/ticket`, connect `{ws_url}?ticket=` |
| Conversations | API key (`conversations:read` / `conversations:write` / `conversations:assign`) | `GET /v1/conversations`, `GET/POST /v1/conversations/{channel_key}/messages`, assignment |
| Contacts | API key (`conversations:read` / `conversations:write`) | `GET /v1/contacts`, `GET/PUT /v1/contacts/{channel}` |
| Channels | API key (`channels:read` / `channels:write`) | `GET/POST /v1/channels`, `GET/PATCH/DELETE /v1/channels/{id}` |
| Team | API key (`team:read`) | `GET /v1/team/roles` |
| Analytics | API key (`analytics:write`) | `POST /v1/analytics/track` |
| Knowledge | API key (`attachments:write` to write; `conversations:read` or `attachments:write` to list) | `GET/POST /v1/rag/documents`, `DELETE /v1/rag/documents/{id}` |
| Webhooks (config) | API key (`conversations:read` / `conversations:write`) | `GET/PUT /v1/webhooks`, `POST /v1/webhooks/test` |
| Webhooks (verify) | local HMAC | no HTTP — `verifyWebhook(secret, rawBody, { timestamp, signature })` |

### Out of scope (public SDK)

- **Panel-only routes** (`/v1/auth/*`, panel JWT conversations on BFF, `/v1/api-keys`, billing, …) — via `app.supportly.cc` with `X-Slc`, not `api.supportly.cc`.
- **Panel JWT helpers.** `GET /v1/inbox/unread` and `POST /v1/conversations/{channel}/read` are mounted on the public router but authenticate with a panel session, not an API key. A public SDK MUST NOT expose them; per-agent unread state is meaningless for an API key. (`@sapportly/sdk` dropped `client.dashboard.*` in 1.0.0 for this reason.)

---

## 2. Authentication

| Mode | Header | Credential |
|------|--------|--------------|
| `none` | — | Public probes, status |
| `apiKey` | `Authorization: Bearer sk_live_…` | Ingest, widget, attachments, conversations, WS ticket |
| `visitor` | `X-Visitor-Token: <jwt>` | Widget chat history (with API key) |

All requests: `Content-Type: application/json` (except empty bodies).

### API key scopes

The complete set, mirroring `ALL_API_KEY_SCOPES` in
`backend/crates/common/src/api_key_scopes.rs`. Any other string is rejected at
key creation.

| Scope | Purpose |
|-------|---------|
| `messages:write` | `POST /v1/ingest/messages` |
| `widget:embed:issue` | `POST /v1/widget/embed-session` (server BFF) |
| `attachments:write` | Public attachment upload (`POST /v1/attachments/*`) |
| `ws:connect` | `POST /v1/ws/ticket` for integrator WebSocket |
| `conversations:read` | List conversations and message history |
| `conversations:write` | Agent reply without panel |
| `conversations:assign` | `PUT /v1/conversations/{channel}/assignment`, `POST .../transfer` |
| `team:read` | `GET /v1/team/roles` |
| `channels:read` | `GET /v1/channels`, `GET /v1/channels/{id}` |
| `channels:write` | `POST /v1/channels`, `PATCH /v1/channels/{id}`, `DELETE /v1/channels/{id}` |
| `analytics:write` | `POST /v1/analytics/track` (custom KPI ingest) |

The full-access preset grants all eleven; the read-only preset grants
`conversations:read` and `channels:read`.

> Removed in SPEC 2.0.0: `widget:messages:write`, `widget:messages:read`, and
> `widget:events:write`. They were never valid — `is_valid_api_key_scope`
> rejects them, so a key requesting one cannot be created. Those widget routes
> authenticate with a **visitor token**, not an API key.

---

## 3. Client shape

```
SupportlyClient(baseUrl, apiKey)
├── status()                          → StatusResponse
├── ingest
│   └── send(body)                    → MessageAccepted
├── widget
│   ├── createEmbedSession(opts)      → WidgetSession        (API key)
│   ├── bootstrap(opts)               → WidgetSession        (browser, Site ID)
│   ├── sendMessage(visitorToken, …)  → WidgetSendResponse   (visitor token)
│   ├── identify(visitorToken, …)     → { ok: true }         (visitor token; no PII echo)
│   └── history(visitorToken, …)      → Message[]            (visitor token)
├── attachments
│   └── upload({ channel, file, ... }) → AttachmentMeta
├── conversations
│   ├── list(opts)                    → ConversationSummary[]
│   ├── messages(channelKey, opts)    → Message[]
│   ├── reply(channelKey, body, opts) → ConversationReplyAccepted
│   ├── assign(channelKey, body)      → AssignmentResponse
│   └── transfer(channelKey, body)    → AssignmentResponse
├── contacts
│   ├── list(opts)                    → Contact[]
│   ├── get(channel)                  → Contact
│   └── upsert(channel, body)         → Contact
├── team
│   └── listRoles()                   → TeamRole[]
├── channels
│   ├── list(opts)                    → ChannelRegistryItem[]
│   ├── create(body)                  → ChannelRegistryItem
│   ├── get(id)                       → ChannelRegistryItem
│   ├── update(id, body)              → ChannelRegistryItem
│   └── archive(id)                   → { archived: boolean }
├── analytics
│   └── track({ metric_key, value, channel? }) → { accepted, metric_key, value }
├── realtime
│   └── createTicket()                → WsTicketResponse
├── rag
│   ├── list() / upload() / delete()  → knowledge documents
├── webhooks (HTTP config)
│   ├── get() / update() / test()     → WebhookConfig
└── webhooks (separate module — no HTTP client dependency)
    ├── verify(secret, rawBody, { timestamp, signature }) → void | throws
    └── sign(secret, timestamp, rawBody)  → "sha256={hex}"   (tests/simulators)
```

Integrator inbox (separate entry `@sapportly/sdk/realtime`): `SupportlyInbox` — tickets, reconnect, `onVisitor` / `onAgent` / `onAi`, `reply`.

Webhook verification MUST be importable without the HTTP client, so a webhook
route pulls in only the crypto path.

Optional helpers:

- `websocketUrl(wsBase, ticket)` → URL with `?ticket=` (never `?token=` on production — ADR-003).
- `MessageDeduper` → deduplicate by `message_id` when using dual delivery.
- Channel-key helpers for the `widget:{visitor_id}` namespace.

### Defaults

```text
DEFAULT_BASE_URL = "https://api.supportly.cc"
DEFAULT_WS_URL   = "wss://ws.supportly.cc/ws"
```

### Injectable HTTP

Every SDK MUST allow injecting the HTTP client (tests, custom TLS, timeouts).

---

## 4. Errors

```json
{
  "error": "human-readable message",
  "type": "invalid_request_error",
  "code": "validation_error",
  "message": "human-readable message",
  "request_id": "req_…",
  "docs_url": "https://docs.supportly.cc/docs/api/errors#validation_error"
}
```

`error` remains for older clients. A client MUST prefer `message`, then `error`.
It SHOULD expose `code`, `type`, `docsUrl`, and `requestId` (header `X-Request-Id`
or body `request_id`).

SDK error type (name may vary):

```text
SupportlyError / SupportlyException
  message: string
  status: number   // HTTP status; 0 = network/config
```

String form: `supportly: {message} (status {status})`

A client SHOULD expose distinguishable error types so callers can branch on
auth failure, missing scope, validation, rate limit, and server error without
inspecting status codes by hand. Each error SHOULD carry the HTTP status, the
request id (`X-Request-Id` when present), and the parsed error body.

### Retry policy

> **Supersedes SPEC 1.x**, which said "no automatic retries in SDK v1". That
> rule pushed backoff, jitter, and `Retry-After` parsing onto every integrator,
> and most implementations either skipped it or retried non-idempotent writes.

A client MUST:

1. Retry on **429, 5xx, 408, 425, and network errors**, and on nothing else.
   A 4xx describes a caller mistake and will not fix itself.
2. Use **exponential backoff with jitter** — synchronised retries turn one
   rate-limit event into a second outage.
3. Honour **`Retry-After`** (seconds or HTTP-date) in preference to its own
   backoff, and cap how long it will wait before failing instead.
4. Cap total attempts (3 is a reasonable default).
5. **Never retry a write that lacks an idempotency key.** `GET` is always
   safe. `POST /v1/conversations/{channel}/transfer`,
   `POST /v1/analytics/track`, and `POST /v1/attachments/intent` are not, and
   MUST NOT be retried: each one appends an audit row, increments a counter, or
   reserves a row.
6. Reuse the **same idempotency key across retries** of one logical write, so
   the server can deduplicate.

---

## 5. Idempotency

Write endpoints accept an optional `idempotency_key` (1–128 chars).

| Who | What happens |
|-----|----------------|
| `@sapportly/sdk` | Always mints a UUID per call if you omit the field. HTTP retries reuse that key. Also sends `Idempotency-Key` header with the same value. |
| Gateway | Body `idempotency_key` wins; else header `Idempotency-Key`; else mints a UUID. A raw curl retry without a key creates a **new** message. |
| You, optionally | Pass a stable key to dedupe a retried external event: `shop:{order_id}:{comment_id}`. |

| Endpoint | Field |
|----------|-------|
| `POST /v1/ingest/messages` | `idempotency_key` optional |
| `POST /v1/widget/messages` | `idempotency_key` optional |
| `POST /v1/conversations/{channel}/messages` | `idempotency_key` optional |

Duplicate requests with the **same** key return success with the same logical message (`duplicate: true` where applicable).

---

## 5a. Pagination

List endpoints use **keyset (cursor) pagination**, not OFFSET. Default wire
format is still a **bare JSON array** (compat). Opt in to an envelope with
`?envelope=true` or `X-Supportly-List-Envelope: 1`:

```json
{ "data": [ … ], "has_more": true, "next_cursor": { "before_at": "…", "before_channel": "…" } }
```

`@sapportly/sdk` always sends the envelope header and unwraps `data`, so
callers still iterate over items. The next page is requested by echoing fields
from the edge item of the page you already hold.

| Endpoint | Order | Cursor comes from | Parameters |
|----------|-------|-------------------|------------|
| `GET /v1/conversations` | `last_message_at DESC, channel DESC` | **last** item | `before_at`, `before_channel` |
| `GET /v1/conversations/{channel}/messages` | chronological within the page, pages backwards in time | **first** item | `before_message_at`, `before_message_id`, `before_channel_sequence` |
| `GET /v1/widget/messages` | same as above | **first** item | `before_at`, `before_id`, `before_sequence` |

Rules:

- **A page shorter than `limit` is the last page.** That is the only
  termination signal available.
- Omit a null `channel_sequence` from the cursor rather than sending `null` —
  rows written before sequencing have none.
- `GET /v1/channels` is **not** paginated; `limit` clamps at 200.
- Clients SHOULD expose iteration (async iterators, generators, or a callback
  loop) so callers never assemble cursors by hand.

---

## 6. Ingest channels

A **source** is a registry/analytics key (`custom:shop`, `email:support`). One
source per connector. Do **not** mint a channel per visitor.

A **thread** is the 1:1 tape in the panel and for AI: `namespace:slug:{uuid}`
(widget stays `widget:{uuid}`, registry `widget:web`).

On ingest, pass `identity.external_id` or `thread_id`. The gateway binds a
stable UUID v5 (`THREAD_ID_NAMESPACE` = `a1f0c3e8-7b2d-4e91-9c54-6d8e0b1a2c3d`,
name = `"{source}\0{external_id}"`). The accept body returns `channel` (tape),
`source_channel`, `thread_id`. Without either field, ingest writes the shared
source tape (legacy).

Format: `namespace:identifier`, or `namespace:identifier:{uuid}`, or register a
channel and use `channel_slug` + optional `channel_namespace`.

| Namespace | Identifier | Example | Notes |
|-----------|------------|---------|-------|
| `custom` | slug | `custom:telegram` | Source for the whole bot / CRM; people are threads |
| `api` | slug | `api:crm` | Same idea |
| `telegram`, `email`, `slack`, `discord` | slug | `telegram:shop` | Namespace of the source, not a chat id |
| `widget` | UUID | `widget:{visitor_uuid}` | **Exception:** 1:1 operator threads. Registry row is `widget:web` |

**Invalid:** bare `widget` without UUID; `widget:web:{uuid}` (three-part widget).
For visitor chat use **Widget API** (`POST /v1/widget/messages`).

Reply (`POST /v1/conversations/{channel}/messages`) addresses the **thread**
key. Integrator `onAgent` / `agent.reply` includes `external_id` so you can
deliver to the person. Panel replies on custom channels do not fan out to the
visitor themselves.

---

## 7. Request / response types

See OpenAPI `components.schemas`. Core types:

### `IngestMessageRequest`

```json
{
  "channel": "custom:orders",
  "channel_slug": "orders",
  "channel_namespace": "custom",
  "body": "Hello",
  "idempotency_key": "uuid",
  "attachment_ids": [],
  "content_encoding": "plain",
  "thread_id": "uuid",
  "identity": { "external_id": "crm-42" }
}
```

Provide either `channel` or (`channel_slug` + optional `channel_namespace`). When tenant `ingest_strict_channels` is enabled, only registered active channels are accepted.

### `MessageAccepted`

```json
{
  "accepted": true,
  "message_id": "uuid",
  "event_id": "uuid",
  "correlation_id": "uuid",
  "duplicate": false,
  "channel": "custom:orders:{uuid}",
  "source_channel": "custom:orders",
  "thread_id": "uuid"
}
```

### `OutboundDelivery` (v1.2 — canonical dedup)

Present on **webhook** JSON (`delivery` plus top-level `message_id`). Client
WebSocket frames (wire v2) do **not** wrap this object: the same `message_id`
lives at `payload.message_id`. Internal NATS envelopes are not a public
contract.

```json
{
  "message_id": "uuid",
  "idempotency_key": "uuid",
  "delivery_id": "uuid",
  "source": "webhook"
}
```

| Field | Purpose |
|-------|---------|
| `message_id` | **Canonical dedup key** — same across webhook, WS, and REST |
| `idempotency_key` | Write idempotency from ingest/reply |
| `delivery_id` | Unique per delivery attempt (do not dedup on this) |
| `source` | `webhook` \| `ws` \| `rest` — delivery channel (not the publishing service) |

> `metadata.source` on internal NATS events is the **service name** (e.g. `flow-engine`). Do not confuse with `delivery.source`. Do not parse NATS on the client socket.

### `WidgetSessionResponse`

```json
{
  "visitor_id": "uuid",
  "token": "jwt",
  "ws_ticket": "uuid",
  "ws_url": "wss://ws.supportly.cc/ws"
}
```

---

## 8. Webhook signature

> **Supersedes SPEC 1.x**, which signed the body alone. A body-only signature
> is valid forever, so any captured request can be replayed indefinitely. The
> timestamp closes that hole and is covered by the same MAC, so it cannot be
> swapped for a fresh one. Reference:
> [`typescript/src/webhooks.ts`](typescript/src/webhooks.ts).

Two headers arrive with every delivery:

| Header | Value |
|--------|-------|
| `X-Supportly-Timestamp` | Unix seconds at signing time |
| `X-Supportly-Signature` | `sha256={lowercase-hex}` |

Verification, in order:

1. Read both headers; a missing one is a rejection.
2. Parse the timestamp; reject if it is not a number.
3. Reject if `abs(now - timestamp) > 300` seconds — in **both** directions, so
   a skewed sender fails closed.
4. Compute `HMAC-SHA256(secret, "{timestamp}.{raw_body}")` over the **raw body
   bytes before JSON parsing**. Re-serialising a parsed object changes key
   order and whitespace, and the MAC will not match.
5. Compare against the header with a **constant-time** equality check. An
   early-exit comparison leaks how many leading characters matched, which is
   enough to forge a signature byte by byte.

A client MUST ship this as a helper. It is the single most security-sensitive
piece of code an integrator would otherwise write by hand, and a subtle mistake
is a real vulnerability rather than a bug.

---

## 9. WebSocket

The **client** contract is wire v2 JSON on a ticketed socket. The internal NATS
envelope (`metadata` / `kind` / `delivery`) is **not** sent to integrators.
Do not parse NATS frames in a public SDK.

### 9.1 Tickets

1. Obtain a ticket:
   - **Widget (browser):** `POST /v1/widget/bootstrap` → `ws_ticket`, `ws_url`
   - **Widget (server BFF):** `POST /v1/widget/embed-session` → `ws_ticket`, `ws_url`
   - **Integrator:** `POST /v1/ws/ticket` with API key (`ws:connect`) → `ticket`, `ws_url`, `expires_in_secs`
2. Connect within the ticket TTL: `{ws_url}?ticket={ticket}`.
   Integrator tickets last **~60 s** and are **single-use**. Widget tickets last **~120 s**.
3. Do **not** put an API key or JWT in the query string on production (ADR-003).
4. After redeem, the integrator session JWT lasts **3600 s**. The socket closes
   with code **4401** (`token expired`). A correct client mints a **new ticket**
   and reconnects — the spent ticket URL cannot be reused.
5. The SDK wrapper (`SupportlyRealtime` / `SupportlyInbox`) does (4) for you.

### 9.2 Client wire v2

Every application frame:

```json
{
  "v": 2,
  "type": "message.delivered",
  "event_id": "uuid",
  "payload": {
    "type": "message.delivered",
    "message_id": "uuid",
    "role": "visitor",
    "channel": "custom:shop",
    "body": "text",
    "content_encoding": "plain"
  }
}
```

`payload.type` historically duplicates the outer `type`. Switch on the outer
`type` (or `classifyWireEvent`). Frames that omit `event_id` MUST still be
accepted — proxies sometimes drop it.

| Outer `type` | Meaning | Typical `payload.role` |
|--------------|---------|------------------------|
| `message.delivered` | Persisted message in the channel transcript | `visitor` (inbound), `agent` or `assistant` (outbound), rarely `system` |
| `ai.draft` | Streaming / final AI suggestion. **Not** a stored agent message | — (`partial: true` then `partial: false`) |

Canonical dedup key on `message.delivered` is `payload.message_id`.
**Do not** dedup `ai.draft` against that id: drafts reuse the inbound
`message_id` of the visitor message they answer.

Role mapping for an integrator inbox:

- `visitor` (or missing) → inbound from the customer / connector
- `agent` **or** `assistant` → outbound from an operator, the public reply API, or AI auto-reply
- `system` → neither; surface only on a raw event handler

### 9.3 Session behaviour

- The socket is **receive-only**. Client application frames are ignored.
- The server sends a WebSocket ping every **25 s**. Honour pong at the protocol
  layer; do not invent an application-level ping flood. Exceeding ~60 client
  pings per minute closes the socket with **1008**.
- Close **4403** is a forced drop (revoke / outbound buffer full). Reconnect
  with a new ticket.
- Integrator sessions **do not replay missed events**. `pending_ws` exists for
  offline **widget visitors**, not API-key sockets. After reconnect, catch up
  with REST (`GET /v1/conversations/{channel}/messages`).
- Optional channel filter: drop frames whose `payload.channel` is set and not
  in the allow-list. Frames without a channel still pass.

### 9.4 Node runtimes

Node 18/20 have no global `WebSocket`. Node 22+, Bun, Deno, and browsers do.
A client MUST accept an injectable constructor (`ws` package or
`nodeWebSocketFactory()`).

### 9.5 Reference helper

`SupportlyInbox` (`@sapportly/sdk/realtime`) mints tickets, reconnects on
4401, classifies frames, marks `inbox.reply` echoes, and skips `ai.draft` in
the dual-delivery deduper. Integrators SHOULD use it instead of raw tickets.

---

## 10. Dual delivery (webhook + WebSocket)

Integrators may enable **both** webhooks and a persistent WebSocket. The same logical message can arrive on both channels.

### Rules

| Rule | Detail |
|------|--------|
| Dedup key | Always `message_id` (not NATS `metadata.event_id`, not `delivery_id`) |
| `ai.draft` | **Not** a second copy of the message. Same inbound `message_id` as the visitor frame — skip it in the seen-set |
| Ordering | Not guaranteed across channels; webhook may arrive before DB persist |
| Source of truth | REST message history (`GET /v1/conversations/.../messages`) for reconciliation |
| SDK helper | `SupportlyInbox` (default) or `MessageDeduper.seen(message_id)` with TTL ≥ 24h |

Webhooks never carry `ai.draft`. Drafts are WebSocket-only.

### Example (TypeScript)

```typescript
import { SupportlyInbox } from "@sapportly/sdk/realtime";

const inbox = new SupportlyInbox(client, { channels: ["custom:shop"] });
inbox.onVisitor((m) => handleInbound(m));
inbox.onAgent((m) => {
  if (m.echo) return;
  handleOutbound(m);
});
await inbox.connect();
```

---

## 11. Removed endpoints

Do **not** implement in new SDKs:

| Removed | Use instead |
|---------|-------------|
| `POST /v1/messages` | `POST /v1/ingest/messages` |
| `POST /v1/widget/reply` | `POST /v1/conversations/widget:{id}/messages` (panel or public API) |

---

## 12. Packaging

| Language | Package | Registry | Status |
|----------|---------|----------|--------|
| TypeScript | `@sapportly/sdk` | npm | Maintained |
| Anything else | — | — | Generate from OpenAPI |

Generation instructions are in [`README.md`](README.md). The previously
reserved names (`supportly` on crates.io and PyPI, `Supportly.Sdk` on NuGet,
`com.supportly:*` on Maven Central, `supportly/sdk` on Packagist) are not
published; do not treat them as available clients.

---

## 13. Transport requirements

A client MUST:

1. Allow injecting the HTTP layer — tests, proxies, custom TLS.
2. Support a configurable base URL and per-request timeouts with cancellation.
3. Implement the retry policy in §4.
4. Send `Authorization: Bearer sk_live_…` and never accept a caller-supplied
   header that overrides it.
5. Keep request bodies under **2 MiB** (`MAX_REQUEST_BODY_BYTES`); larger files
   go through the attachment intent flow, which uploads to storage directly.
6. Surface rate-limit headers when present, without depending on them.

---

## 14. Testing requirements

Minimum CI for any maintained client:

1. **Webhook verification** — valid signature, tampered body, wrong secret,
   stale timestamp, future timestamp, malformed header, and a cross-language
   vector matching the Rust signer.
2. **Retry behaviour** — retries 429/5xx/network, does not retry 4xx, respects
   `Retry-After`, never replays a non-idempotent write.
3. **Error mapping** — every status maps to the documented error type and
   carries status, request id, and parsed body.
4. **Pagination** — cursor derived from the correct edge item, terminates on a
   short page.
5. Build / typecheck.
6. Optional: live integration against `api.supportly.cc`.

---

## 15. Reference implementation

| What | Where |
|------|-------|
| Client | [`typescript/src/client.ts`](typescript/src/client.ts) |
| Transport, retries, error mapping | [`typescript/src/transport.ts`](typescript/src/transport.ts) |
| Webhook verification | [`typescript/src/webhooks.ts`](typescript/src/webhooks.ts) |
| Keyset pagination | [`typescript/src/pagination.ts`](typescript/src/pagination.ts) |
| Wire types | [docs.supportly.cc/openapi.json](https://docs.supportly.cc/openapi.json) |
| Integrator inbox / WS wire v2 | [`typescript/src/inbox.ts`](typescript/src/inbox.ts), [`typescript/src/wire.ts`](typescript/src/wire.ts) |

When in doubt, match the TypeScript public surface.

---

## Changelog

| Version | Date | Summary |
|---------|------|---------|
| 2.1.1 | 2026-08-19 | Client WS contract is wire v2 (not the internal NATS envelope); `assistant` is an agent role; `ai.draft` is excluded from dual-delivery dedup; agent reply is valid on any source channel (`custom:…`), not only `widget:{uuid}` |
| 2.1.0 | 2026-08-19 | Structured errors; list envelope (opt-in); `Idempotency-Key` header; Contacts; public RAG JSON; webhook config on public API |
| 2.0.0 | 2026-07-30 | TypeScript-only; timestamped webhook signature (supersedes body-only); retries now required (supersedes "no automatic retries"); keyset pagination documented; removed three widget scopes the backend never accepted |
| 1.4.0 | 2026-07-29 | Custom analytics track (`analytics:write`, `POST /v1/analytics/track`) |
| 1.2.0 | 2026-07-20 | Delivery contract (`OutboundDelivery`), dual delivery dedup, v1.2 scopes, public attachments/conversations/WS, TypeScript SDK v0.2 |
| 1.1.0 | 2026-07-14 | Public ingest path, widget API, webhook verify |
| 1.0.0 | — | Initial |
