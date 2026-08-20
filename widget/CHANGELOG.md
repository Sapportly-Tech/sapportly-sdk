# Changelog

## 1.2.0 — 2026-08-20

Первая публичная публикация как **`@sapportly/widget-sdk`** (npm org **sapportly**).
Пакета `@supportly/widget-sdk` на npm нет: scope `supportly` для публичных SDK недоступен.
Продукт, Site ID (`wgt_…`), CDN (`cdn.supportly.cc`) и `window.Supportly` — Supportly.

- Loader, сниппет, env-хелперы, обёртки React / Vue / Svelte / Next.js.
- Хеши cache-bust WASM/glue синхронизированы с `packages/config` (`322a4f989216` / `56e303416791`).
- Экспорт `./api` убран: headless REST — `@sapportly/sdk` (`client.widget`), не внутренний `@supportly/api`.
- В хуках появился `identify()` — те же traits, что у `window.Supportly.identify` (`external_id` / `externalId`).
- Репозиторий: [Supportly-Tech/supportly-sdk](https://github.com/Supportly-Tech/supportly-sdk) (`widget/`).
