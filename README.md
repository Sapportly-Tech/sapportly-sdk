# Sapportly SDKs

[![npm](https://img.shields.io/npm/v/@sapportly/sdk.svg)](https://www.npmjs.com/package/@sapportly/sdk)
[![npm](https://img.shields.io/npm/v/@sapportly/widget-sdk.svg)](https://www.npmjs.com/package/@sapportly/widget-sdk)
[![CI](https://github.com/Supportly-Tech/supportly-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/Supportly-Tech/supportly-sdk/actions/workflows/ci.yml)

Публичный репозиторий двух пакетов npm (org **sapportly**):

| Пакет | Каталог | Назначение |
|-------|---------|------------|
| **[`@sapportly/sdk`](https://www.npmjs.com/package/@sapportly/sdk)** | [`typescript/`](typescript/) | REST-клиент публичного API Supportly |
| **[`@sapportly/widget-sdk`](https://www.npmjs.com/package/@sapportly/widget-sdk)** | [`widget/`](widget/) | Embed виджета (Site ID, React/Vue/Next/Svelte) |

**Имена на npm — `@sapportly/sdk` и `@sapportly/widget-sdk`, не `@supportly/*`.** Продукт, хост API (`api.supportly.cc`), классы (`SupportlyClient`) и `window.Supportly` — Supportly. Scope и организация `supportly` на npm для этих SDK недоступны. `@supportly/api` — внутренний пакет монорепо, на npm не публикуется.

**GitHub (клонировать в GitHub Desktop):** https://github.com/Supportly-Tech/supportly-sdk

```bash
npm install @sapportly/sdk
npm install @sapportly/widget-sdk
```

Документация: [docs.supportly.cc/docs/sdk/typescript](https://docs.supportly.cc/docs/sdk/typescript), [гайд по виджету](https://docs.supportly.cc/docs/guides/widget). С **1.3.0** REST SDK custom-каналы дают треды 1:1 (`custom:shop:{uuid}`) из `identity.external_id`. Виджет по-прежнему живёт на ленте `widget:{uuid}`.

**TypeScript is the single supported reference SDK.** For every other language,
generate a client from the OpenAPI spec — see [below](#generating-a-client-for-another-language).

| Language | Package | Folder | Status |
|----------|---------|--------|--------|
| **TypeScript / JavaScript** | `@sapportly/sdk` | [`typescript/`](typescript/) | Supported |
| **Widget embed** | `@sapportly/widget-sdk` | [`widget/`](widget/) | Supported |
| Python, Go, Rust, C#, PHP, Kotlin, Java, Swift | — | — | Archived — generate from OpenAPI |

The eight hand-written SDKs were archived in v2.0.0. A wrong client is worse
than no client — particularly for webhook signature verification. Generate from
OpenAPI instead.

## Contract and specification

| What | Where |
|------|-------|
| OpenAPI 3.1 spec | [docs.supportly.cc/openapi.json](https://docs.supportly.cc/openapi.json) |
| SDK behaviour contract | [`SPEC.md`](SPEC.md) |
| API reference | [docs.supportly.cc/docs/api/reference](https://docs.supportly.cc/docs/api/reference) |
| Publishing | [`PUBLISHING.md`](PUBLISHING.md) |

`SPEC.md` describes the behaviour a client needs beyond the endpoint list —
idempotency, retry policy, pagination, dual-delivery deduplication, webhook
signature verification. A generated client gives you the endpoints; `SPEC.md`
tells you what a good client does with them.

## Two APIs, one of them public

| Surface | Host | Credential | In SDK scope |
|---------|------|------------|--------------|
| Public API | `api.supportly.cc` | API key `sk_live_…` with scopes | Yes |
| Widget (visitor) | `api.supportly.cc` | Visitor token (`X-Visitor-Token`) | Yes |
| Platform / panel | `app.supportly.cc` | Panel JWT + `panel_gate` + RBAC | **No** |

Panel endpoints (login, API-key management, webhook configuration, billing,
team administration) are deliberately absent from the SDK and from the OpenAPI
spec. They are internal to the dashboard and are not a supported integration
surface.

## Public API surface

Every route below is reachable with an API key. The scope column is what the
gateway checks.

| Endpoint | Scope |
|----------|-------|
| `GET /v1/status`, `/health`, `/ready` | none |
| `POST /v1/ingest/messages` | `messages:write` |
| `GET /v1/conversations` | `conversations:read` |
| `GET /v1/conversations/{channel}/messages` | `conversations:read` |
| `POST /v1/conversations/{channel}/messages` | `conversations:write` |
| `GET /v1/conversations/{channel}/assignment` | `conversations:read` |
| `PUT /v1/conversations/{channel}/assignment` | `conversations:assign` |
| `POST /v1/conversations/{channel}/transfer` | `conversations:assign` |
| `GET /v1/conversations/{channel}/assignment/history` | `conversations:read` |
| `GET /v1/channels`, `GET /v1/channels/{id}` | `channels:read` |
| `POST /v1/channels`, `PATCH`/`DELETE /v1/channels/{id}` | `channels:write` |
| `POST /v1/attachments/intent` | `attachments:write` |
| `POST /v1/attachments/{id}/complete` | `attachments:write` |
| `GET /v1/attachments/{id}`, `GET /v1/attachments/{id}/download` | `attachments:write` |
| `GET /v1/team/roles` | `team:read` |
| `POST /v1/analytics/track` | `analytics:write` |
| `POST /v1/ws/ticket` | `ws:connect` |
| `POST /v1/widget/embed-session` | `widget:embed:issue` |
| `POST /v1/widget/bootstrap` | none (Site ID + `Origin` allow-list) |
| `/v1/widget/messages`, `/events`, `/canned-prompt`, `/channel-security` | visitor token |

## Generating a client for another language

The spec is OpenAPI 3.1. Both of the common generators work:

```bash
# openapi-generator — widest language coverage
npx @openapitools/openapi-generator-cli generate \
  -i https://docs.supportly.cc/openapi.json \
  -g python \
  -o ./supportly-python

# oapi-codegen — idiomatic Go
oapi-codegen -package supportly \
  -generate types,client \
  https://docs.supportly.cc/openapi.json > supportly.go
```

Generated code covers request and response shapes. Add these four things by
hand — they are behaviour, not schema, and no generator infers them:

1. **Webhook signature verification.** HMAC-SHA256 over `"{timestamp}.{body}"`,
   headers `X-Supportly-Timestamp` and `X-Supportly-Signature`
   (`sha256=<hex>`), 300-second tolerance, constant-time comparison. The
   reference implementation is [`typescript/src/webhooks.ts`](typescript/src/webhooks.ts).
2. **Idempotency.** Generate an `idempotency_key` for every message write so a
   retry cannot duplicate a message.
3. **Retry policy.** Exponential backoff with jitter on 429/5xx/network errors,
   honouring `Retry-After`; never retry a non-idempotent write.
4. **Keyset pagination.** List endpoints return a bare JSON array and take
   `before_*` cursor parameters. A page shorter than `limit` is the last page.

Read [`typescript/src`](typescript/src) for a worked example of all four; it is
kept deliberately small and dependency-free so it can be read as a
specification rather than only used as a library.

## Limits and conventions

- Request bodies are capped at **2 MiB** — upload files through the attachment
  intent flow rather than inline.
- Rate limiting is a Redis sliding window; a throttled request answers **429**,
  sometimes with `Retry-After`.
- Message bodies are capped at 65 535 bytes; `idempotency_key` at 128
  characters.
- Timestamps are RFC 3339 / ISO 8601 in UTC.

## License

MIT. See [`LICENSE`](LICENSE).

---

## Русский

Это **Sapportly SDK**: на npm пакеты **`@sapportly/sdk`** (REST) и **`@sapportly/widget-sdk`** (embed), не `@supportly/*`.
Scope `supportly` для этих SDK недоступен; org npm — **sapportly**. Продукт и API —
Supportly (`api.supportly.cc`, классы `SupportlyClient`, Site ID `wgt_…`).

TypeScript — единственный поддерживаемый SDK. Остальные восемь клиентов
переведены в архив: удалены из рабочего дерева, история git сохранена.

Для любого другого языка сгенерируйте клиент из
[OpenAPI-спеки](https://docs.supportly.cc/openapi.json) и допишите четыре вещи
вручную: проверку подписи webhook, идемпотентность, ретраи с backoff и keyset-
пагинацию. Что именно должен делать клиент — в [`SPEC.md`](SPEC.md), рабочий
пример — в [`typescript/src`](typescript/src).

Панель оператора (`app.supportly.cc`) в публичный API не входит.
