# Публикация `@supportly/sdk`

Канонический публичный репозиторий: **https://github.com/belurgas/supportly-sdk**

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

4. Тег запускает [`.github/workflows/publish.yml`](.github/workflows/publish.yml): typecheck → test → build → `pnpm publish --access public --provenance`.
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

## Первый раз: npm org и GitHub secret

1. [npmjs.com](https://www.npmjs.com/) → создать (или войти в) org **`supportly`**. Scope пакета — `@supportly/sdk`.
2. Включить 2FA на аккаунте, который публикует.
3. Automation token: npm → Access Tokens → Granular / Classic **Automation** (не publish-with-2FA prompt).
4. GitHub repo → Settings → Secrets → Actions → `NPM_TOKEN`.
5. Опционально: npm → пакет → Trusted Publisher → GitHub Actions, репозиторий `belurgas/supportly-sdk`, workflow `publish.yml`. Тогда provenance работает через OIDC; `NPM_TOKEN` всё равно оставляют как запасной.

Локально `publishConfig.provenance` требует OIDC (GitHub Actions). С ноутбука лучше не публиковать — только тег.

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
