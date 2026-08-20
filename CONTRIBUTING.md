# Как участвовать

Репозиторий **Sapportly SDKs**: `@sapportly/sdk` (REST) и `@sapportly/widget-sdk` (embed).

Имена `@supportly/sdk` / `@supportly/widget-sdk` на npm **не используются**: scope `supportly` недоступен. Продукт — Supportly; npm-org — **sapportly**.

## Граница продукта

REST SDK — **только** public API (`api.supportly.cc`, ключ `sk_live_…`). Не добавляйте маршруты панели, admin или BFF. Контракт поведения — [`SPEC.md`](SPEC.md).

Widget SDK — только публичный Site ID (`wgt_…`) и загрузка embed shell. Не тащите сюда `@supportly/api` и не экспортируйте headless REST: это `@sapportly/sdk` → `client.widget`.

## Локально

```bash
cd typescript   # или widget
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Нужен Node 18+. Live-тесты REST SDK (`test/live.test.ts`) идут только если задан `SUPPORTLY_API_KEY` — в обычном CI они пропускаются.

## Релиз

Semver REST: `typescript/package.json`, тег `vX.Y.Z`.
Semver виджета: `widget/package.json`, тег `widget-vX.Y.Z`.

```bash
pnpm release:patch          # REST 1.3.0 → 1.3.1
pnpm release:widget:patch   # widget 1.2.0 → 1.2.1
```

Допишите CHANGELOG пакета, затем коммит + тег и `git push --tags`. Подробности — [`PUBLISHING.md`](PUBLISHING.md).
