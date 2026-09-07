# Публикация Sapportly SDK

Два пакета npm в org **sapportly**. Продукт и API при этом Sapportly.

| Пакет | Каталог | Тег | Workflow |
|-------|---------|-----|----------|
| **`@sapportly/sdk`** | `typescript/` | `vX.Y.Z` | [`publish.yml`](.github/workflows/publish.yml) |
| **`@sapportly/widget-sdk`** | `widget/` | `widget-vX.Y.Z` | [`publish-widget.yml`](.github/workflows/publish-widget.yml) |

Канонический публичный репозиторий: **https://github.com/Sapportly-Tech/supportly-sdk**

В монорепо Sapportly те же файлы лежат в `sdks/`. Релизы npm идут **из публичного репозитория** по git-тегу.

Имён `@sapportly/sdk` и `@sapportly/widget-sdk` на npm нет: scope `supportly` для публичных SDK недоступен.

## Semver (`@sapportly/sdk`)

Версия живёт в `typescript/package.json` и `typescript/src/version.ts`. Она **не** связана с календарным `VERSION` продукта и **не** связана с версией виджета.

| Изменение | Bump |
|-----------|------|
| Ломающий публичный API | `major` (2.0.0) |
| Новый метод / совместимое поле | `minor` (1.4.0) |
| Багфикс, типы, доки | `patch` (1.3.1) |

Треды `custom:shop:{uuid}` и `identity.external_id` — **1.3.0** (minor): новые поля,
legacy-ingest без identity не ломается.

## Semver (`@sapportly/widget-sdk`)

Версия живёт в `widget/package.json`. Хеши cache-bust WASM (`WIDGET_WASM_ASSET_VERSION`) штампует сборка виджета в монорепо — их **не** bump-ит этот скрипт.

| Изменение | Bump |
|-----------|------|
| Ломающий публичный API loader/хуков | `major` |
| Новая обёртка / совместимое поле | `minor` |
| Багфикс, типы, доки, актуальный WASM hash | `patch` |

Первая публичная версия — **1.2.0** (тот же surface, что был внутренним `@sapportly/widget-sdk`, без экспорта `./api`).

Теги `v*` и `widget-v*` **нельзя** смешивать: `v1.2.0` публикует REST SDK и сверится с `typescript/package.json` (сейчас 1.3.0).

## Релиз REST SDK

1. Из корня этого репозитория (`sdks/`):

   ```bash
   pnpm release:patch   # или :minor / :major
   ```

2. Допишите `typescript/CHANGELOG.md`.
3. Коммит, тег, пуш:

   ```bash
   git add -A
   git commit -m "release: v1.3.1"
   git tag v1.3.1
   git push origin main --tags
   ```

4. Тег запускает [`.github/workflows/publish.yml`](.github/workflows/publish.yml): typecheck → test → build → `npm publish` через **OIDC** (без `NPM_TOKEN`).
5. Проверьте [npm](https://www.npmjs.com/package/@sapportly/sdk) и GitHub Release.

Dry-run без публикации: Actions → Publish → `workflow_dispatch` с `dry_run=true`.

### Вручную (если CI недоступен)

```bash
cd typescript
pnpm install
pnpm test
pnpm build
pnpm publish --access public
```

Нужен `npm login` под аккаунтом с правом писать в org **`sapportly`**.

## Релиз Widget SDK

1. Из корня:

   ```bash
   pnpm release:widget:patch   # или :minor / :major
   ```

2. Допишите `widget/CHANGELOG.md`. Если сменился WASM на CDN — убедитесь, что `widget/src/constants.ts` проштампован сборкой `packages/widget/build.ps1`.
3. Коммит, тег, пуш:

   ```bash
   git add -A
   git commit -m "release(widget): v1.2.0"
   git tag widget-v1.2.0
   git push origin main --tags
   ```

4. Тег запускает [`.github/workflows/publish-widget.yml`](.github/workflows/publish-widget.yml).
5. Проверьте [npm](https://www.npmjs.com/package/@sapportly/widget-sdk).

### Вручную

```bash
cd widget
pnpm install
pnpm test
pnpm build
npm login
npm whoami
npm publish --access public
```

Если CLI спросит OTP — `npm publish --access public --otp=123456`.

#### `E404` на первый `PUT` (`@sapportly/widget-sdk` ещё нет)

Это **не** «пакет не собран». npm отвечает 404, когда текущие credentials не могут **создать** новое имя в org. Частые причины:

1. В `~/.npmrc` лежит **granular-токен**, выписанный только на `@sapportly/sdk`. Он не умеет заводить второй пакет.
2. Аккаунт не Owner org **sapportly** (или команда без права создавать пакеты).
3. Токен без **Bypass 2FA**, а аккаунт требует 2FA на publish.

Что делать:

1. [npmjs.com/org/sapportly](https://www.npmjs.com/org/sapportly) → Members: ваш логин — **Owner**.
2. Не публиковать GAT, привязанным к одному пакету. Либо `npm login` (браузер), либо новый granular token:
   - Permission: **Read and write**
   - **Packages and scopes:** scope `@sapportly` (не только пакет `@sapportly/sdk`)
   - **Bypass 2FA:** включить, либо всегда передавать `--otp`
   - Срок: несколько дней, потом отозвать
3. Снова:

   ```bash
   npm login
   npm whoami
   cd widget
   npm publish --access public --otp=XXXXXX
   ```

После того как пакет появился на npm — Trusted Publisher (`publish-widget.yml`), токен из `.npmrc` удалить. Дальше только тег `widget-vX.Y.Z`.

## Первый раз: npm Trusted Publishing (без токена)

Секрет `NPM_TOKEN` **не нужен**. CI публикует по OIDC. Обычный granular-токен с 2FA даёт `403` — так и было.

Trusted Publisher настраивается **на каждый пакет отдельно**.

1. Войти на [npmjs.com](https://www.npmjs.com/) в аккаунт с правом писать в org **`sapportly`**.
2. Если пакета ещё нет — один раз с ноутбука (интерактивно, с 2FA):

   ```bash
   cd typescript   # или widget
   pnpm build
   npm login
   npm publish --access public
   ```

   Provenance с ноутбука не генерируется (`provider: null`). В CI его делает Trusted Publishing.

3. На странице пакета: **Settings → Trusted Publisher → GitHub Actions**:
   - Organization or user: `Sapportly-Tech`
   - Repository: `supportly-sdk`
   - Workflow filename: `publish.yml` для `@sapportly/sdk`, **`publish-widget.yml`** для `@sapportly/widget-sdk` (только имя файла)
   - Allowed actions: **npm publish**
4. Дальше релизы только тегом. `NPM_TOKEN` в GitHub можно удалить.

Локальный `npm publish` без логина не используйте.

## Что попадает в tarball

`files` в `package.json`: `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`. Исходники и тесты остаются на GitHub.

Проверка до релиза:

```bash
cd typescript && pnpm build && pnpm pack --dry-run
cd ../widget && pnpm build && pnpm pack --dry-run
```

У `@sapportly/widget-sdk` в tarball **не** должно быть зависимости на `@sapportly/api` и экспорта `./api`. Headless REST — `@sapportly/sdk`.

## После релиза

1. `npm install @sapportly/sdk@<version>` / `npm install @sapportly/widget-sdk@<version>`.
2. Если изменился публичный surface — обновить `apps/docs`.
3. Запись в `CHANGELOG.md` пакета и при необходимости в корневой `sdks/CHANGELOG.md`.

Метаданные лендинга/docs для REST SDK: `packages/config` → `SDK_PACKAGES.typescript`.
