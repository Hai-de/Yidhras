# i18n Multilingual Support Design

## Scope

Web frontend only (`apps/web`). Server and contracts remain English-only (internal APIs, logs, DB).

## Target locales

| Code    | Label        | Fallback |
| ------- | ------------ | -------- |
| `en`    | English      | — (default) |
| `zh-CN` | 简体中文       | `en`     |
| `zh-TW` | 繁體中文       | `zh-CN`  |
| `ja`    | 日本語         | `en`     |

Default locale: `en`. The codebase is written in English; English is the source of truth for all translation keys.

## Library

**`@nuxtjs/i18n`** (v10.x, `vue-i18n` v10.x under the hood).

Rationale:
- First-party Nuxt module, maintained by the intlify team
- Auto-imports `useI18n()`, `$t()`, `<NuxtLink>` locale-aware routing
- Lazy-load locale messages so only the active locale ships to the client
- Locale detection via browser `Accept-Language`, cookie, or path prefix
- Compatible with Nuxt 4.x and CSR-only mode (`ssr: false`)

## Routing strategy

`prefix_except_default` — URLs get a locale prefix for non-default locales, English stays clean:

| Locale | URL pattern            |
| ------ | ---------------------- |
| `en`   | `/packs`               |
| `zh-CN`| `/zh-CN/packs`         |
| `zh-TW`| `/zh-TW/packs`         |
| `ja`   | `/ja/packs`            |

Locale is persisted in a cookie so returning users land on their last choice. On first visit, `Accept-Language` header determines the initial locale.

## File structure

```
apps/web/
  locales/
    en.json          # source-of-truth keys
    zh-CN.json       # Simplified Chinese
    zh-TW.json       # Traditional Chinese
    ja.json          # Japanese
  i18n/
    i18n.config.ts   # @nuxtjs/i18n module configuration
```

`en.json` is the authoritative key list. Other locale files mirror the same key structure. Missing keys in a locale fall back through the chain defined above.

## Configuration (`i18n/i18n.config.ts`)

```ts
export default defineI18nConfig(() => ({
  legacy: false,
  locale: 'en',
  fallbackLocale: {
    'zh-TW': ['zh-CN', 'en'],
    'zh-CN': ['en'],
    'ja': ['en'],
    default: 'en'
  },
  messages: {} // loaded lazily via locale files
}))
```

nuxt.config.ts additions:

```ts
// modules
'@nuxtjs/i18n',

// i18n config
i18n: {
  lazy: true,
  strategy: 'prefix_except_default',
  defaultLocale: 'en',
  locales: [
    { code: 'en', file: 'en.json', name: 'English' },
    { code: 'zh-CN', file: 'zh-CN.json', name: '简体中文' },
    { code: 'zh-TW', file: 'zh-TW.json', name: '繁體中文' },
    { code: 'ja', file: 'ja.json', name: '日本語' }
  ],
  langDir: 'locales',
  detectBrowserLanguage: {
    useCookie: true,
    cookieKey: 'yd_locale',
    redirectOnRoot: true
  }
}
```

## Translation key conventions

Flat keys with dot-separated namespacing by page/feature:

```json
{
  "common.refresh": "Refresh",
  "common.logout": "Logout",
  "common.loading": "Loading...",
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",

  "packs.title": "Pack Operations",
  "packs.subtitle": "Manage world pack lifecycle, runtime state, and diagnostics.",
  "packs.actions.enter": "Enter",
  "packs.actions.load": "Load",
  "packs.actions.unload": "Unload",
  "packs.actions.reloadSoon": "Reload Soon",
  "packs.actions.delete": "Delete",
  "packs.status.loaded": "loaded",
  "packs.status.not_loaded": "not loaded",
  "packs.summary.total": "Total",
  "packs.summary.loaded": "Loaded",
  "packs.summary.notLoaded": "Not Loaded",
  "packs.summary.issues": "Issues",
  "packs.field.instance": "Instance",
  "packs.field.type": "Type",
  "packs.field.folder": "Folder",
  "packs.field.version": "Version",
  "packs.empty": "No world packs found.",
  "packs.error.list": "Pack list unavailable",

  "login.title": "Operator Login",
  "login.password": "Password",
  "login.submit": "Authenticate",
  "login.error": "Authentication failed",

  "shell.workspace": "Workspace",
  "shell.overview": "Overview",
  "shell.graph": "Graph",
  "shell.timeline": "Timeline",
  "shell.scheduler": "Scheduler",
  "shell.workflow": "Workflow"
}
```

Key naming rules:
- Keys are English, lowercase, dot-separated
- Status/runtime values that come from the API are wrapped via `$t()` but the key matches the raw value
- No interpolation unless the value has dynamic parts

## Usage in components

Template:

```vue
<button>{{ $t('common.refresh') }}</button>
<h1>{{ $t('packs.title') }}</h1>
```

Script:

```ts
const { t, locale, setLocale } = useI18n()
const label = t('packs.actions.load')
```

Status values from API (e.g., `runtime_status`):

```ts
// In template:
{{ $t(`packs.status.${pack.runtime_status}`) }}
// Falls back to raw value if key is missing — acceptable for enum display.
```

## Locale switcher component

A small dropdown in the header area. Each page that wants it imports the component.

```
[EN ▾]  →  English | 简体中文 | 繁體中文 | 日本語
```

Behavior:
- Displays current locale code in native script
- On select: `setLocale(code)` + cookie auto-update
- Instant client-side switch — no page reload needed (CSR mode)

## Date / number formatting

Use `Intl` API via computed locale. Not wrapping in translation files:

```ts
const { locale } = useI18n()
const formattedDate = computed(() =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(date)
)
```

## Implementation order

1. Install `@nuxtjs/i18n`, add module config to `nuxt.config.ts`
2. Create `i18n/i18n.config.ts`
3. Create `locales/en.json` with all current UI strings extracted
4. Add locale switcher component
5. Translate `en.json` → `zh-CN.json`, `zh-TW.json`, `ja.json`
6. Refactor pages/components to replace hardcoded strings with `$t()` calls

Pages touched per step 6:
- `pages/packs.vue`
- `pages/login.vue`
- `pages/packs/[packId].vue` (shell pages)
- `features/shell/components/*.vue`
- `features/overview/components/*.vue`
- `features/graph/components/*.vue`
- `features/scheduler/components/*.vue`
- `features/timeline/components/*.vue`
- `features/workflow/components/*.vue`
- `features/shared/components/*.vue`
- `features/social/components/*.vue`

## Non-goals

- Server-side API messages remain English-only
- No RTL support (none of the target locales require it)
- No per-world-pack localization (pack content is separate from UI chrome)
- No pluralization engine beyond `vue-i18n` built-in (`|` pipe syntax for simple plurals)
