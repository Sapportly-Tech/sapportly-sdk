# Changelog

## 1.3.0 — 2026-09-08

**Rebrand release** (npm `1.2.0` still pointed at Supportly / `supportly.cc`).

- Product + defaults: **Sapportly**, `api.sapportly.pro`, `cdn.sapportly.pro`, `window.Sapportly`.
- Public exports: `Sapportly*` / `getSapportly` / `loadSapportly` / `installWidget` (breaking vs npm 1.2.0 `Supportly*` names).
- Site ID env: canon `SAPPORTLY_SITE_ID` / `NEXT_PUBLIC_SAPPORTLY_SITE_ID` / `VITE_*` / `PUBLIC_*`; legacy `SUPPORTLY_*` still accepted.
- WASM/glue hashes synced with `packages/config`: `36da946d2c75` / `fa75b82c5535`.
- Docs: GitHub `Sapportly-Tech/sapportly-sdk`, panel `app.sapportly.pro`.
- CDN shell filename remains `supportly.widget.js`; DOM events remain `supportly:*` (wire compatibility).

## 1.2.0 — 2026-08-20

Первая публикация как **`@sapportly/widget-sdk`** (npm org **sapportly**).
На npm в этой версии ещё были defaults `supportly.cc` и `window.Supportly` — заменены в **1.3.0**.

- Loader, сниппет, env-хелперы, обёртки React / Vue / Svelte / Next.js.
- Экспорт `./api` убран: headless REST — `@sapportly/sdk` (`client.widget`).
- Репозиторий: [Sapportly-Tech/sapportly-sdk](https://github.com/Sapportly-Tech/sapportly-sdk) (`widget/`).
