# Публикация `@supportly/sdk`

Канонический публичный репозиторий: **https://github.com/Supportly-Tech/supportly-sdk**

В монорепо Supportly те же файлы лежат в `sdks/`. Релизы npm идут **из публичного репозитория** по git-тегу `vX.Y.Z`.

Пакет на npm ещё не публиковался — первая публикация создаёт `@supportly/sdk`.

## Semver

Версия живёт в `typescript/package.json` и `typescript/src/version.ts`. Она **не** связана с календарным `VERSION` продукта.

| Изменение | Bump |
|-----------|------|
| Ломающий публичный API | `major` (2.0.0) |
| Новый метод / совместимое поле | `minor` (1.3.0) |
| Багфикс, типы, доки | `patch` (1.2.2) |

## Релиз

1. Из корня этого репозитория (`sdks/`):

   ```bash
   pnpm release:patch   # или :minor / :major
   ```

2. Допишите `typescript/CHANGELOG.md`.
3. Коммит, тег, пуш:

   ```bash
   git add -A
   git commit -m "release: v1.2.2"
   git tag v1.2.2
   git push origin main --tags
   ```

4. Тег запускает [`.github/workflows/publish.yml`](.github/workflows/publish.yml): typecheck → test → build → `npm publish` через **OIDC** (без `NPM_TOKEN`).
5. Проверьте [npm](https://www.npmjs.com/package/@supportly/sdk) и GitHub Release.

Dry-run без публикации: Actions → Publish → `workflow_dispatch` с `dry_run=true`.

### Вручную (если CI недоступен)

```bash
cd typescript
pnpm install
pnpm test
pnpm build
pnpm publish --access public
```

Нужен `npm login` под аккаунтом с правом писать в org **`@supportly`**.

## Первый раз: npm Trusted Publishing (без токена)

Секрет `NPM_TOKEN` **не нужен**. CI публикует по OIDC. Обычный granular-токен с 2FA даёт `403` — так и было.

1. Войти на [npmjs.com](https://www.npmjs.com/) в аккаунт с правом писать в org **`supportly`** (`@supportly/sdk`).
2. Если пакета ещё нет — один раз с ноутбука (интерактивно, с 2FA):

   ```bash
   cd typescript
   pnpm build
   npm login
   npm publish --access public
   ```

3. На странице пакета: **Settings → Trusted Publisher → GitHub Actions**:
   - Organization or user: `Supportly-Tech`
   - Repository: `supportly-sdk`
   - Workflow filename: `publish.yml` (только имя файла)
   - Allowed actions: **npm publish**
4. Дальше релизы только тегом `vX.Y.Z`. `NPM_TOKEN` в GitHub можно удалить.

Локальный `npm publish` без логина не используйте.

## Что попадает в tarball

`files` в `typescript/package.json`: `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`. Исходники и тесты остаются на GitHub.

Проверка до релиза:

```bash
cd typescript && pnpm build && pnpm pack --dry-run
node -e "require('./dist/index.cjs')"
node --input-type=module -e "import('./dist/index.js')"
```

## После релиза

1. `npm install @supportly/sdk@<version>` ставит новую версию.
2. Если изменился публичный surface — обновить `apps/docs`.
3. Запись в `CHANGELOG.md` (пакет) и при необходимости в корневой `sdks/CHANGELOG.md`.

Метаданные лендинга/docs: `packages/config` → `SDK_PACKAGES.typescript`.
