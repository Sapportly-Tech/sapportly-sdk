# Как участвовать

Репозиторий публичного `@supportly/sdk`. Пакет npm — каталог `typescript/`.

## Граница продукта

SDK — **только** public API (`api.supportly.cc`, ключ `sk_live_…`). Не добавляйте маршруты панели, admin или BFF. Контракт поведения — [`SPEC.md`](SPEC.md).

## Локально

```bash
cd typescript
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

Нужен Node 18+. Live-тесты (`test/live.test.ts`) идут только если задан `SUPPORTLY_API_KEY` — в обычном CI они пропускаются.

## Релиз

Semver в `typescript/package.json`. Из корня репозитория:

```bash
pnpm release:patch   # 1.2.1 → 1.2.2
pnpm release:minor   # 1.2.1 → 1.3.0
pnpm release:major   # 1.2.1 → 2.0.0
```

Допишите `typescript/CHANGELOG.md`, затем коммит + тег `vX.Y.Z` и `git push --tags`. Тег запускает публикацию на npm. Подробности — [`PUBLISHING.md`](PUBLISHING.md).
