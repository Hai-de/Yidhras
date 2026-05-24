# ESLint 覆盖范围与执行修复计划

**日期**: 2026-05-24
**关联分析**: `.limcode/design/eslint-bypass-analysis.md`
**关联排查**: `.limcode/design/eslint-bypass-investigation.md`
**依赖计划**: `.limcode/plans/builtin-plugin-compilation-pipeline.plan.md`（阶段 2）

---

## 决策记录

| 问题 | 决策 |
|------|------|
| builtin/ 插件编译流水线方案 | 方案 C（完整独立编译流水线），独立计划文件 |
| `no-unsafe-type-assertion` 引入时机 | 延后至阶段 0-2 全部完成后 |
| pre-commit 工具 | simple-git-hooks |

---

## 阶段 0: 立即修复

### 0.1 修复 `snapshot_restore.ts` 的 CalendarConfig → TimeFormatted 类型转换 bug

**文件**: `apps/server/src/packs/snapshots/snapshot_restore.ts`

**当前代码** (line 365):
```typescript
calendars: (pack.time_systems ?? []) as unknown as TimeFormatted[],
```

**问题**: `CalendarConfig` 和 `TimeFormatted` 字段名不兼容（`id` ≠ `calendar_id`，`name` ≠ `calendar_name`），`display` 字段在 `CalendarConfig` 上不存在。正确路径 `rebuildFromRuntimeSeed`（`runtime_clock_projection.ts:139`）通过 `ChronosEngine.getAllTimes()` 做转换，但快照恢复路径绕过了该转换。

**修复步骤**:

1. 在 `snapshot_restore.ts` 顶部增加导入:
   ```typescript
   import { ChronosEngine } from '../../clock/engine.js';
   ```

2. 将 lines 357-369 替换为:
   ```typescript
   const tick = parseBigInt(metadata.captured_at_tick);
   await materializePackRuntime({ instanceId: packId, pack, prisma, packStorageAdapter, initialTick: tick, appliedOpeningId: appliedOpeningId ?? undefined });

   const engine = new ChronosEngine({
     calendarConfigs: pack.time_systems ?? [],
     initialTicks: tick
   });
   const clockSnapshot: RuntimeClockProjectionSnapshot = {
     pack_id: packId,
     current_tick: metadata.captured_at_tick,
     current_revision: metadata.captured_at_revision,
     calendars: engine.getAllTimes(),
     source: 'host_projection',
     updated_at_ms: Date.now(),
     generation: 1
   };
   ```

   原局部变量 `tick`（用于 `materializePackRuntime`）保留。

3. 验证: `engine.getAllTimes()` 返回 `TimeFormatted[]`，与 `rebuildFromRuntimeSeed` 中的用法一致。

**验证方式**: 运行现有快照相关集成测试确认无回归。

---

### 0.2 删除孤儿文件 `test_boundaries.mjs`

**文件**: `apps/server/test_boundaries.mjs`

- 提交 `3bc7a51` (2026-05-01) 引入后从未被引用
- 未完成的工具化尝试，当前无任何执行路径

```bash
git rm apps/server/test_boundaries.mjs
```

---

### 0.3 CI 添加 `pnpm lint` 门禁

**文件**: `.github/workflows/server-tests.yml`、`.github/workflows/server-smoke.yml`

两个 workflow 均未运行 lint。

**server-tests.yml** — 在 `Install workspace dependencies` 步骤之后添加:

server-integration job:
```yaml
- name: Lint server
  run: pnpm --filter yidhras-server lint
```

web-unit job:
```yaml
- name: Lint web
  run: pnpm --filter web lint
```

**server-smoke.yml** — 在 `Install workspace dependencies` 步骤之后添加:
```yaml
- name: Lint server
  run: pnpm --filter yidhras-server lint
```

lint 不依赖运行时，放在 install 之后、测试之前实现快速失败。

---

### 0.4 添加 `no-non-null-assertion` 规则

**文件**: `apps/server/eslint.config.mjs`

在 `rules` 块（line 134-167 区域）中添加:
```typescript
'@typescript-eslint/no-non-null-assertion': 'error',
```

当前 `src/` 中零使用 `x!.prop`，添加后零噪音。

---

## 阶段 1: ESLint 覆盖范围扩展

### 1.1 将 `tests/` 纳入 ESLint 覆盖

**文件**: `apps/server/eslint.config.mjs`、`apps/server/package.json`

**约束**: 测试文件不应用 boundaries 规则（测试需从任意层导入），但需其他所有规则。

**修复步骤**:

1. 在 `eslint.config.mjs` 中新增配置条目（放在 boundaries 配置块之后）:

```typescript
// Tests — 不含 boundaries 约束，其余规则与 src 对齐
{
  files: ['tests/**/*.ts'],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname
    }
  },
  plugins: {
    'simple-import-sort': simpleImportSort
  },
  rules: {
    'no-console': 'off',
    'prefer-const': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-prototype-builtins': 'error',
    'no-path-concat': 'error',
    'import-x/no-named-as-default-member': 'off',
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'import-x/extensions': 'off',
    'no-restricted-syntax': [
      'error',
      {
        selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
        message: 'NodeNext relative imports in tests must end with .js'
      },
      {
        selector: "ExportNamedDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
        message: 'NodeNext relative exports in tests must end with .js'
      },
      {
        selector: "ExportAllDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
        message: 'NodeNext relative exports in tests must end with .js'
      }
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_' }
    ]
  }
}
```

不启用 `eslint-plugin-security` — 测试的临时文件操作会触发 `detect-non-literal-fs-filename` 噪音。

2. 更新 `apps/server/package.json` lint 脚本:
```json
"lint": "eslint \"src/**/*.ts\" \"tests/**/*.ts\""
```

---

### 1.2 将 `scripts/` 纳入 ESLint 覆盖

**文件**: `apps/server/eslint.config.mjs`、`apps/server/package.json`

与 tests 逻辑相同。scripts 需要 security 规则（`profile_ipc.ts` 和 `debug_agent_scheduler.ts` 涉及进程操作），security 已在顶层 `security.configs.recommended` 全局启用。

1. 在 `eslint.config.mjs` 中新增:

```typescript
// Scripts — 不含 boundaries 约束，启用 security 规则
{
  files: ['scripts/**/*.ts'],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname
    }
  },
  plugins: {
    'simple-import-sort': simpleImportSort
  },
  rules: {
    'no-console': 'off',
    'prefer-const': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-prototype-builtins': 'error',
    'no-path-concat': 'error',
    'simple-import-sort/imports': 'error',
    'simple-import-sort/exports': 'error',
    'no-restricted-syntax': [
      'error',
      {
        selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/(?!.*\\.js$).+/]",
        message: 'NodeNext relative imports must end with .js'
      }
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-non-null-assertion': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
  }
}
```

2. 更新 lint 脚本:
```json
"lint": "eslint \"src/**/*.ts\" \"tests/**/*.ts\" \"scripts/**/*.ts\""
```

---

## 阶段 2: builtin/ 插件编译流水线

**→ 独立计划文件**: `.limcode/plans/builtin-plugin-compilation-pipeline.plan.md`

方案 C：每个插件独立 `tsconfig.json` + 编译脚本，产物输出到各插件目录的 `dist/` 下，清单引用编译产物。与主构建流水线集成，dev 模式提供 watch 编译。

---

## 阶段 3: `no-unsafe-type-assertion` 规则引入

**延后执行**，等待阶段 0、1、2 全部完成后，在干净的基准上执行。

届时三步走:
1. 以 `'warn'` 级别添加规则，运行 lint 确认命中数量
2. 28 个合法边界穿越加 `eslint-disable-next-line` 注释，16 个可疑项逐个重构，1 个已知 bug（阶段 0.1）已修复
3. 全部清理后将规则从 `'warn'` 升为 `'error'`

---

## 阶段 4: pre-commit hook

**工具**: simple-git-hooks + lint-staged

**依赖**: 阶段 1.1 和 1.2 必须先完成（lint-staged 传绝对路径给 eslint，需 eslint config 的 `files` glob 匹配 `tests/` 和 `scripts/` 下的文件）。

**步骤**:

1. 安装依赖:
```bash
pnpm add -D -w simple-git-hooks lint-staged
```

2. 在根 `package.json` 添加:
```json
{
  "simple-git-hooks": {
    "pre-commit": "pnpm exec lint-staged"
  },
  "lint-staged": {
    "apps/server/src/**/*.ts": [
      "pnpm --filter yidhras-server exec eslint --fix"
    ],
    "apps/server/tests/**/*.ts": [
      "pnpm --filter yidhras-server exec eslint --fix"
    ],
    "apps/server/scripts/**/*.ts": [
      "pnpm --filter yidhras-server exec eslint --fix"
    ],
    "apps/web/**/*.{ts,vue}": [
      "pnpm --filter web exec eslint --fix"
    ]
  }
}
```

3. 在根 `package.json` 的 `scripts` 中添加:
```json
"prepare": "simple-git-hooks"
```

首次安装后运行 `pnpm prepare` 初始化钩子。

---

## 执行顺序

```
阶段 0.1 (bug 修复, 1 文件)
  ↓
阶段 0.2 (删除孤儿文件, 1 命令)
  ↓
阶段 0.3 (CI lint) + 阶段 0.4 (no-non-null-assertion)  [可并行]
  ↓
阶段 1.1 (tests/ ESLint 覆盖)
  ↓
阶段 1.2 (scripts/ ESLint 覆盖)
  ↓
阶段 4 (pre-commit, 依赖 1.1+1.2)
  ↓
阶段 2 (builtin 编译流水线, 独立计划)
  ↓
阶段 3 (no-unsafe-type-assertion)
```

阶段 0.3 + 0.4 可并行执行。

---

## 未纳入本次计划的误报项

| # | 问题 | 分类 | 不处理理由 |
|---|------|------|-----------|
| 6 | `token_counter.ts` 的 `require()` + eslint-disable | 误报 | 可选依赖的正当容错加载 |
| 9 | `@ts-ignore` / `@ts-expect-error` | 误报 | src/ 中零使用 |
| 10 | 嵌套 eslint 配置覆盖 | 误报 | flat config 不支持级联继承 |
