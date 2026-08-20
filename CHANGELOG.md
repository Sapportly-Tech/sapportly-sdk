# Supportly SDKs — Changelog

Canonical contract: [`SPEC.md`](./SPEC.md).

Публичный клиент на npm — **Sapportly TypeScript SDK** `@sapportly/sdk` и **Sapportly Widget SDK** `@sapportly/widget-sdk` (org **sapportly**).
Пакетов `@supportly/sdk` / `@supportly/widget-sdk` нет: эти имена на npm недоступны.

## Unreleased

- **`@sapportly/widget-sdk` 1.2.0** — публичный embed SDK в `widget/` (тот же GitHub-репо). Экспорт `./api` убран; headless REST — `@sapportly/sdk`.

## 2.0.0 — 2026-07-30

### TypeScript is the only SDK

- Archived `csharp`, `go`, `java`, `kotlin`, `php`, `python`, `rust`, and
  `swift`: deleted from the working tree, preserved in git history. Nine
  hand-written clients drifted from the API faster than they could be
  corrected, and an out-of-date webhook verifier is a security bug rather than
  a missing feature.
- Anyone needing another language generates a client from
  `packages/api/openapi.json` and implements the four behaviours a generator
  cannot infer — webhook verification, idempotency, retry policy, keyset
  pagination. See [`README.md`](./README.md).
- `@sapportly/sdk` 1.0.0 rebuilt to reference quality: timestamped webhook
  verification, automatic idempotency keys, retries with backoff and jitter, a
  typed error hierarchy, and pagination iterators. Panel/dashboard endpoints
  removed from the public surface. See
  [`typescript/CHANGELOG.md`](./typescript/CHANGELOG.md).
- `scripts/test-all-sdks.sh` replaced by `scripts/test-sdk.sh`; the
  `publish-sdk` workflow now publishes npm only.

## 1.2.0 — 2026-07-20

### Contract (all SDKs)

- **SPEC v1.2.0** — delivery contract, dual delivery, new API key scopes.
- **OpenAPI 1.2.0** — schemas `OutboundDelivery`, `DeliveryChannel`, `ApiKeyScope`.
- **Events** — optional `delivery` field on `EventEnvelope` with `message_id`, `idempotency_key`, `delivery_id`, `source` (`webhook` | `ws` | `rest`).
- JSON Schema: `contracts/events/outbound_delivery.schema.json`.
- **MSG-02** — WS `message_deliver` + webhook HTTP payloads populate canonical `message_id` / `delivery`.

### New scopes (documented; routes roll out in MSG-06+)

_None — all v1.2 scopes are live._

### MSG-03 — Public Attachments API

- Scope `attachments:write` (legacy `messages:write` accepted on attachment routes).
- Routes: `POST /v1/attachments/intent`, `POST /v1/attachments/{id}/complete`, `GET /v1/attachments/{id}`.
- OpenAPI documents attachment schemas; `upload-intent` alias remains for backward compatibility.

### MSG-04 — Integrator WebSocket ticket

- Scope `ws:connect` on `POST /v1/ws/ticket` (public API key route).
- Response includes `ticket`, `ws_url`, `expires_in_secs`; panel JWT path unchanged behind `X-Slc`.
- Integrator connections use stable routing identity per API key (`integrator_ws_user_id`).

### MSG-05 — Headless Conversations API

- Scopes `conversations:read` / `conversations:write` on public routes.
- `GET /v1/conversations`, `GET/POST /v1/conversations/{channel}/messages` (panel JWT + API key).
- Agent reply supports `widget:{visitor_id}` channels (same semantics as panel).

### Dual delivery

- Canonical dedup key: **`message_id`** (not `metadata.event_id`).
- SDKs SHOULD ship `MessageDeduper` helper (TS first in MSG-06).

### Planned SDK modules (subsequent MSG tasks)

_None — TypeScript v0.2.0 ships attachments, conversations, and realtime (MSG-06)._

### MSG-06 — TypeScript SDK v1.2 modules

- `client.conversations.list/messages/reply` with API key auth.
- `client.attachments.upload()` — full presigned upload flow.
- `client.realtime.issueTicket()` + `SupportlyRealtime.connect()` (`@sapportly/sdk/realtime`).
- `MessageDeduper`, `extractMessageId`, `websocketTicketUrl` (ADR-003).

## 1.1.0 — 2026-07-14

- Public ingest: `POST /v1/ingest/messages` (replaces legacy `POST /v1/messages`).
- Widget session, messages, events.
- Webhook HMAC-SHA256 verification helpers.

## 1.0.0

- Initial public SDK surface.
