# i18n Multilingual Support — Implementation Plan

Ref: `.limcode/design/i18n-multilingual-support-design.md`

## Task graph

```
1. Install & config ──┬── 2. en.json keys ──┬── 4. zh-CN/zh-TW/ja translations
                      │                     ├── 5. Refactor packs.vue
                      │                     └── 6. Refactor remaining components
                      └── 3. Locale switcher component
```

## 1. Install @nuxtjs/i18n and configure

- `pnpm --filter yidhras-web add @nuxtjs/i18n`
- Create `apps/web/i18n/i18n.config.ts`
- Update `apps/web/nuxt.config.ts`: add module, i18n block with 4 locales, lazy loading, `prefix_except_default`, cookie detection
- File: `apps/web/nuxt.config.ts`

## 2. Create en.json

- Extract every hardcoded English string from the codebase into `apps/web/locales/en.json`
- Key convention: `feature.section.element` (e.g., `packs.summary.total`)
- Cover: packs.vue, login.vue, shell, overview, graph, scheduler, timeline, workflow, shared, social

## 3. Build locale switcher

- New component: `apps/web/features/shared/components/LocaleSwitcher.vue`
- Dropdown displaying current locale in native script
- On select → `setLocale(code)`, cookie auto-updated by module

## 4. Translate locale files

- `zh-CN.json` — Simplified Chinese
- `zh-TW.json` — Traditional Chinese (falls back to zh-CN where identical)
- `ja.json` — Japanese
- Machine translation acceptable for first pass; review later

## 5. Refactor packs.vue

- Replace all text nodes, button labels, placeholders with `$t()` calls
- Status values: `$t(`packs.status.${pack.runtime_status}`)`

## 6. Refactor remaining components

Apply same `$t()` migration across all touched files.
