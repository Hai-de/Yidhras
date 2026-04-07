# Frontend Theme Development Guide

本文档描述 `apps/web` 前端主题系统的文件职责、解析链路与常见改动入口。

> 相关文档：`apps/web/README.md` · `docs/ARCH.md` · `docs/ENHANCEMENTS.md`

---

## 1. Scope

本文档只覆盖 `apps/web` 前端主题开发。

- 平台维护一套默认主题（当前为 VSCode-like dark workbench）
- World-pack provider 可通过 `presentation.theme` 提供自定义主题
- 平台负责：默认主题、稳定 token contract、runtime resolve/apply、validate/clamp/fallback/diagnostics
- Provider 可定义自己的视觉风格，平台不对 provider 主题做审美调整

---

## 2. Mental Model

```
DEFAULT_APP_THEME + world_pack.presentation.theme (optional)
  → resolveThemeWithDiagnostics()     // merge + validate + clamp + fallback
  → applyResolvedTheme()              // CSS variables on :root
  → Tailwind / theme-default.css / App* primitives / feature pages 消费
```

四层结构：

| 层 | 职责 |
|---|---|
| **Contract** | token 类型、CSS variable key、source descriptor |
| **Resolution** | 合并默认主题与 provider override，产出 final theme |
| **Apply** | 写入 CSS variables 与 root dataset |
| **Consumption** | Tailwind、`theme-default.css`、`App*` primitives、feature 页面 |

---

## 3. File Map

### Contract / Resolver / Apply

| 文件 | 职责 |
|---|---|
| `lib/theme/tokens.ts` | token 类型、CSS variable key、`AppThemeDefinition` 等类型 |
| `lib/theme/default-theme.ts` | 平台默认主题定义 |
| `lib/theme/resolver.ts` | 主题合并、validate/clamp/fallback |
| `lib/theme/apply-css-vars.ts` | resolved theme → CSS variables |
| `lib/theme/validate.ts` | 合法性校验与 fallback 诊断 |
| `lib/theme/clamp.ts` | 布局值安全 clamp |
| `lib/theme/source.ts` | world-pack 主题来源解析 |
| `lib/theme/provider-theme.example.ts` | provider 主题示例 |

### Runtime / CSS / Tailwind

| 文件 | 职责 |
|---|---|
| `plugins/theme.ts` | 监听 worldPack 变化，重新解析并应用主题 |
| `assets/css/tokens.css` | CSS variable fallback layer |
| `assets/css/theme-default.css` | 默认主题语义类（surface / separator / dock / list row 等） |
| `assets/css/base.css` | 全局基础样式 |
| `tailwind.config.ts` | CSS variables → Tailwind token 映射 |

### Semantic Primitives

`components/ui/` 下的 `AppPanel` / `AppButton` / `AppTabs` / `AppAlert` / `AppBadge` / `AppInput` / `AppSelect` 等。

### Consumers

- `features/shell/components/*` — workbench shell
- `features/shared/components/*` — 共享展示组件
- `features/*` — 业务工作区

---

## 4. Resolution Flow

来源优先级：

```
presentation.theme > platform registry theme > DEFAULT_APP_THEME
```

### 关键函数

**`resolveThemeWithDiagnostics()`**（`resolver.ts`）
- 合并默认主题与 override → validate → clamp → 返回 `{ theme, issues, source }`

**`applyResolvedTheme()`**（`apply-css-vars.ts`）
- 写入 CSS variables，设置 `data-theme-id` / `data-theme-scheme` / `data-theme-source` 等 dataset

**`plugins/theme.ts`**
- worldPack 变化时重新解析并应用；dev 模式下打印 diagnostics

---

## 5. Token Contract

### meta

`id` · `name` · `colorScheme ('dark' | 'light')`

### core

- **colors.bg** — `app` · `panel` · `elevated` · `overlay`
- **colors.border** — `strong` · `muted`
- **colors.text** — `primary` · `secondary` · `muted` · `inverse`
- **colors.state** — `success` · `warning` · `danger` · `info` · `accent`
- **colors.graph** — `agent` · `atmosphere` · `relay` · `container` · `edge` · `selected`
- **colors.grid** — `line`
- **typography** — `fontSans` · `fontMono`
- **radius** — `sm` · `md` · `lg`
- **border** — `width`
- **shadow** — `panel` · `elevated`

### layout

- **app** — `minWidth` · `maxContentWidth` · `pagePaddingX` · `pagePaddingY` · `sectionGap` · `cardGap`
- **shell** — `railWidth` · `sidebarWidth` · `dock.minHeight` · `dock.defaultHeight` · `dock.maxHeight`

### components

- **panel** — `backdropBlur`

### 新增 token 时的考量

新增 token 需要同步多个位置（类型、默认值、CSS fallback、apply、validate、Tailwind）。建议先评估是否可以通过已有 token 组合实现。

---

## 6. Provider Theme

Provider 通过 `world_pack.presentation.theme` 提供主题 override。只需提供想覆盖的字段，缺失字段回退到 `DEFAULT_APP_THEME`。

最小示例（详见 `provider-theme.example.ts`）：

```ts
presentation: {
  theme: {
    meta: { id: 'my-theme', name: 'My Theme', colorScheme: 'dark' },
    core: {
      colors: {
        bg: { app: '#0f1115', panel: '#171a21' },
        state: { accent: '#c084fc' }
      }
    }
  }
}
```

平台对 provider 主题只做 merge → validate → clamp → diagnostics，不做审美调整。

---

## 7. Common Changes

| 我想… | 优先看… |
|---|---|
| 改默认颜色 | `default-theme.ts` → `tokens.css` |
| 改 panel/dock/separator 默认样式 | `theme-default.css` 中的 `yd-*` 语义类 |
| 让 UI 组件更好地消费主题 | `components/ui/App*.vue` |
| 让页面跟随主题 | 先看能否复用已有 primitives / shared 组件 |
| 新增 token | 同步 `tokens.ts` · `default-theme.ts` · `tokens.css` · `apply-css-vars.ts` · `validate.ts`（如需）· `tailwind.config.ts`（如需） |
| 新增 provider 可覆盖字段 | 确认是稳定 contract 而非默认主题细节，考虑 validate/clamp/fallback |
| 改 shell/dock/splitter | `AppShell.vue` · `BottomDock.vue` · `stores/shell.ts` · `theme-default.css` |

---

## 8. Debugging

### 查看当前主题来源

```js
document.documentElement.dataset.themeId
document.documentElement.dataset.themeSource
document.documentElement.dataset.themeSourceLabel
```

### 排查顺序

1. runtime `worldPack` 是否存在
2. `presentation.theme` 是否传入
3. `resolveThemeWithDiagnostics()` 输出（dev console 有日志）
4. CSS variables 是否写到 `:root`
5. 页面是否有硬编码颜色覆盖了 token

---

## 9. Change Checklist

- [ ] 判断改动属于 token / grammar / primitive / 页面哪一层
- [ ] 新增 token 时同步了所有相关文件
- [ ] 新增 provider 字段时考虑了 validate / clamp / fallback
- [ ] 运行 `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test:unit`
- [ ] 如变更了稳定约定，同步相关文档

---

## 10. Summary

主题系统的 source of truth 在 `lib/theme/*`，默认视觉语法在 `theme-default.css`，`App*` primitives 提供语义化的主题消费方式。Provider 可定义自己的视觉风格，平台负责 contract、resolve 和 fallback。