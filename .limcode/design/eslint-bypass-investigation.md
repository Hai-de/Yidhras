# ESLint 配置旁路风险排查报告

**日期**: 2026-05-24
**范围**: `apps/server/eslint.config.mjs` 及其周边

---

## 排查清单总览

| # | 问题 | 初始判定 |
|---|------|---------|
| 1 | tsconfig / ESLint 覆盖范围仅限 `src/**`，tests/ scripts/ builtin/ 裸奔 | 待分析 |
| 2 | `builtin/system_pack/plugins/` 生产代码完全脱离静态检查 | 待分析 |
| 3 | CI 中无 lint 执行 | 待分析 |
| 4 | 无 pre-commit hook | 待分析 |
| 5 | 孤儿文件 `test_boundaries.mjs` | 待分析 |
| 6 | `src/ai/token_counter.ts` 的 `require()` + eslint-disable | 待分析 |
| 7 | `as unknown as T` 模式大量使用（规避 `no-explicit-any`） | 待分析 |
| 8 | 缺少 `no-non-null-assertion` 规则 | 待分析 |
| 9 | `@ts-ignore` / `@ts-expect-error` 使用情况 | 待分析 |
| 10 | 嵌套 eslint 配置覆盖（flat config 下不存在此机制） | 待分析 |

---

## 详细发现

### 1. 覆盖范围缺口

**配置现状**:

- `tsconfig.json`: `"include": ["src/**/*"]`
- `eslint.config.mjs`: `files: ['src/**/*.ts']`
- `package.json` lint 脚本: `eslint "src/**/*.ts"`

**未覆盖的 TypeScript 文件**:

| 目录 | 文件数 | 总行数 | 性质 |
|------|--------|--------|------|
| `tests/` | ~30+ | ~3000+ | 测试 helper / fixture |
| `scripts/manual/` | 8 | ~700 | 手动 demo 脚本 |
| `scripts/` | 2 | ~566 | 调试/性能分析脚本 |
| `builtin/system_pack/plugins/` | 4 | ~150 | **生产运行时插件** |
| 根级别 `.ts` 配置 | 5 | ~30 | vitest/prisma 配置 |

实际影响：所有这些文件使用 `moduleResolution: NodeNext` 时均无 `.js` 扩展名校验，无 `any` 使用限制，无边界规则。

### 2. builtin/ 插件脱离检查

`builtin/system_pack/plugins/` 下的四个插件在运行时由 pack 加载并执行，属于生产路径。它们从 `src/` 导入，但自身不受类型检查或 lint 约束。

### 3. CI 无 lint 门禁

`.github/workflows/` 中无任何 workflow 执行 `pnpm lint`。仅有的两个 workflow (`server-tests.yml`, `server-smoke.yml`) 分别跑集成测试和冒烟测试。

### 4. 无 pre-commit hook

项目根没有 `.husky/`、`lint-staged` 配置或 `simple-git-hooks`。代码可以在本地完全绕过 lint 提交。

### 5. `test_boundaries.mjs`

```js
import boundaries from 'eslint-plugin-boundaries';
export default [
  {
    plugins: { boundaries },
    settings: { 'boundaries/elements': [{ type: 'everything', pattern: 'src/**' }] },
    rules: { 'boundaries/dependencies': ['error', { default: 'disallow', rules: [] }] }
  }
];
```

未被任何 package.json script、CI 配置或文档引用。功能上是一个"禁止一切跨文件依赖"的极端规则集，但从未被执行。

### 6. `require()` in ESM

`src/ai/token_counter.ts:37-45`:
```typescript
const safeRequire = (id: string): unknown => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(id);
  } catch {
    return null;
  }
};
```

在 `module: NodeNext` 模块中使用 CJS `require()`，并显式禁用 ESLint 规则。

### 7. `as unknown as T` 模式

全仓库约 25+ 处。示例：
```typescript
const calendars = (pack.time_systems ?? []) as unknown as CalendarConfig[];
```

`no-explicit-any` 被设为 error，但没有配置 `@typescript-eslint/no-unsafe-type-assertion`，使得 `unknown` 中转成为合法的"洗白"路径。

### 8. 未配置 `no-non-null-assertion`

当前代码中无 `x!.prop` 使用，但规则未配置，不设防。

### 9. `@ts-ignore` / `@ts-expect-error`

在 `src/` 中零使用。

### 10. 嵌套配置覆盖

ESLint flat config 不支持 `.eslintrc` 式的级联继承。`apps/server/` 下不存在子目录 eslint 配置文件。此风险不适用。

---

## 待逐项分析

以上每项的最终判定（误报 / 逻辑断裂 / 盲点）将在单独的分析文档中展开。
