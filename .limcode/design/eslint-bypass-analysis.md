# ESLint 旁路排查 — 逐项判定

**日期**: 2026-05-24
**关联草案**: `eslint-bypass-investigation.md`

---

## 判定标准

| 分类 | 含义 |
|------|------|
| **误报** | 看似的"旁路"实际有合理解释，风险可忽略 |
| **逻辑断裂** | 设计意图明确但执行不完整，或设计本身有内在矛盾 |
| **盲点** | 无人注意到的遗漏，造成真实风险 |

---

## #1 — tsconfig / ESLint 覆盖范围仅限 `src/**`

**判定: 逻辑断裂 (builtin/) + 盲点 (tests/ / scripts/)**

分三层分析：

**`tests/` — 盲点。** 测试 helper/fixture 不在 tsconfig include 中，这是常见做法（测试不参与 production build，vitest 有自己的 ts 处理链）。但 ESLint 也不覆盖 `tests/` 就不合理了——测试代码同样受益于 import sort、`.js` 扩展名、边界规则。AGENTS.md 中明确写了测试文件必须使用 `.js` 扩展名导入，但没有自动化检查来强制执行。当前 `tests/helpers/determinism.ts` 确实手动遵循了 `.js` 扩展名约定，但这全靠开发者自觉。

**`scripts/` (1011 行) — 盲点。** 这些是手动 demo/调试脚本。不需要进 production build，所以 tsconfig 排除合理。但 ESLint 排除意味着 import 顺序、eslint-plugin-security（`detect-non-literal-fs-filename` 等）规则完全不生效。`scripts/profile_ipc.ts`(291行) 和 `scripts/debug_agent_scheduler.ts`(275行) 规模不小，应当被 lint 覆盖。

**`builtin/system_pack/plugins/` — 逻辑断裂。** 这是唯一一个"似乎有意设计但执行断裂"的案例：
- 四个运行时插件(`string-methods`, `regex-engine`, `template-engine`, `slot-condition-builtin`)位于 `builtin/` 下，处于 tsconfig include 和 ESLint files 之外
- 插件 manifest 声明的入口是 `server.js`，但磁盘上只存在 `server.ts`
- 项目没有编译 `builtin/` 的 build step
- 因此插件**只能在 dev 模式(tsx)下运行**，在 production 下会直接加载失败
- 这不是刻意绕过 ESLint，而是插件打包流水线未完成的结果

**实际风险**：`slot-condition-builtin/server.ts` 中存在 `as unknown as` 转换，将未类型化的 `context.options` 强制转为特定结构，缺少运行时校验。如果 ESLint+TypeScript 覆盖到这些文件，这些转换会被标记。

---

## #2 — builtin/ 插件脱离检查

**判定: 逻辑断裂**

四个插件详情：

| 插件 | 行数 | 注册项 | 类型安全问题 |
|------|------|--------|------------|
| `string-methods` | 48 | 1 个 DataCleaner | `as string`/`as number` 替代运行时 coercion |
| `regex-engine` | 101 | 1 个 DataCleaner | ReDoS 检测前未校验 `pattern` 是否为 string |
| `template-engine` | 36 | 1 个 DataCleaner | 模板渲染错误被静默吞掉(`catch { rendered = text }`) |
| `slot-condition-builtin` | 55 | 4 个 SlotConditionEvaluator | `as unknown as` 双转换绕过类型检查 |

这些是**生产运行时代码**——插件在 `apps/server/src/plugins/system_pack_init.ts` 被自动注册并启用（`trust_mode: 'trusted'`），在 `apps/server/src/plugins/runtime.ts` 被动态 `import()` 并激活。但它们完全不受静态分析保护。

**关键发现**：`regex-engine` 中 `(options?.pattern as string)` 如果收到非 string 值，会在 ReDoS 检测之前就崩溃——类型断言不是运行时 coercion。这种 bug 如果有 TypeScript 严格检查，在 dev 阶段就会被发现。

**为什么是逻辑断裂而非盲点**：`system_pack_init.ts` 的设计清楚地表明团队有意让 builtin plugins 成为一等公民（自动发现、SHA-256 校验、idempotent 注册）。但编译流水线没有跟上——manifest 写 `server.js` 却没有生成 `server.js` 的 step。这不是"忘了加 tsconfig include"，而是"打包流水线还在设计迭代中"。

---

## #3 — CI 中无 lint 执行

**判定: 盲点**

两个 GitHub Actions workflow (`server-tests.yml`, `server-smoke.yml`) 都未包含 `pnpm lint`。ESLint 配置投入了大量工程努力（boundaries 插件含 23 个元素定义、`no-restricted-syntax` 的 `.js` 扩展名规则、`@typescript-eslint/no-explicit-any: error`），但 CI 完全不强制执行。

对比：CI 会跑 Rust 的 `cargo check`、单元测试、集成测试、web 测试。加一行 `pnpm lint` 难度为零。

**AGENTS.md 的 CI 基线段落只记录了测试，没有提到 lint 被排除或有意只在本地运行。** 这纯粹是遗漏。

---

## #4 — 无 pre-commit hook

**判定: 盲点**

根目录无 `.husky/`、无 `lint-staged`、无 `simple-git-hooks`。结合 #3（CI 也无 lint），lint 完全是自愿行为。开发者可以提交任何代码而不触发 ESLint 检查。

这种"配置齐全但无一处强制执行"的模式在原型向产品转型期常见——lint 规则是写了，但执行基础设施排在后面。但这个盲点会让所有新增的 ESLint 规则形同虚设。

---

## #5 — 孤儿文件 `test_boundaries.mjs`

**判定: 逻辑断裂**

Git log:
- **提交**: `3bc7a51` (2026-05-01)
- **作者**: Hai-de
- **消息**: "巩固架构边界，清理升级依赖发现的各种错误"

该文件是在从 `.eslintrc.cjs` 迁移到 `eslint.config.mjs` 的同一提交中引入的。它定义了一个"禁止一切跨文件依赖"的极端规则集（`default: 'disallow'`），但从未被任何 script、CI workflow、或 package.json 引用。

**意图很清楚**：有人想用一个更严格的二级检查来验证边界规则的正确性——将主配置中所有 `'warn'` 的边界规则临时变成 `'error'` 并全局 disallow。但这一步从未完成——可能是被其他任务打断了。

**不是旁路**：该文件即使被激活也不会绕过任何检查，反而会加强它们。它是一个未完成的工具化尝试。

---

## #6 — `src/ai/token_counter.ts` 的 `require()` + eslint-disable

**判定: 误报**

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

这是对可选依赖 `tiktoken` 的**惰性、容错加载**。ESM 的 `await import()` 也可以做到这一点，但 `require()` 在同步上下文（token counter 可能在非 async 路径中被调用）中更方便。

- `eslint-disable-next-line` 带明确的规则名，是精确禁用而非宽泛的 `eslint-disable`
- 该禁用仅限于一行，不是文件级别
- 有 try-catch 保护
- `tiktoken` 是 `package.json` 的 `dependencies`（非 dev），属于合法运行时依赖

**这是 eslint-disable 的正当用途，不是旁路。**

---

## #7 — `as unknown as T` 模式

**判定: 盲点 (规则缺口) + 一个真实 bug**

全仓库 45 处 `as unknown as` 使用，经逐项分类：

| 子类别 | 数量 | 说明 |
|--------|------|------|
| 合法边界穿越 | 28 | DB 行、Rust sidecar 序列化、API 解析、YAML→Zod boundary、通用工具函数 |
| 潜在可疑 | 16 | 结构匹配但跨模块类型不可直接赋值(`time_systems → CalendarConfig`)、不必要的 `Record` 擦除、反射访问未声明字段 |
| 很可能是 bug | 1 | `CalendarConfig` → `TimeFormatted` 在 `snapshot_restore.ts:365` |

**唯一确认为 bug 的实例** — `src/packs/snapshots/snapshot_restore.ts:365`：

```typescript
calendars: (pack.time_systems ?? []) as unknown as TimeFormatted[],
```

`CalendarConfig` 和 `TimeFormatted` 结构不兼容：

| 字段 | CalendarConfig | TimeFormatted |
|------|---------------|---------------|
| id | `id: string` | `calendar_id: string` |
| name | `name: string` | `calendar_name: string` |
| tick_rate | 有 | 无 |
| units | `TimeUnit[]` | `Record<string, bigint\|number>` |
| display | 无 | `display: string` |

运行时字段名对不上（`id` ≠ `calendar_id`，`name` ≠ `calendar_name`），`display` 在 `CalendarConfig` 上不存在。

**为什么是盲点**：`no-explicit-any: error` 禁止了显式 `any`，但没有配置 `@typescript-eslint/no-unsafe-type-assertion`。`unknown` 中转成了合法的"洗白"路径。团队显然重视类型安全（any 是 error 级别），但可能不知道 `no-unsafe-type-assertion` 这条规则的存在。加上 #3（CI 不跑 lint）和 #4（无 pre-commit），这类问题在代码审查环节也可能被遗漏。

---

## #8 — 缺少 `no-non-null-assertion` 规则

**判定: 盲点**

当前 `src/` 中 `x!.prop` 使用量为零——开发者已经自觉避免了这种模式。但没有规则禁止，任何人都可以引入。

建议：如果团队已有"不使用 non-null assertion"的隐性共识，就应该固化为显性规则。添加 `'@typescript-eslint/no-non-null-assertion': 'error'` 成本为零，能防止未来的意外。

---

## #9 — `@ts-ignore` / `@ts-expect-error`

**判定: 误报**

`src/` 中零使用。typecheck 是干净的。

---

## #10 — 嵌套 eslint 配置覆盖

**判定: 误报**

ESLint flat config 不支持 `.eslintrc` 式的级联继承。`apps/server/` 下仅存在根级 `eslint.config.mjs`，无子目录覆盖。此风险对 flat config 不适用。

---

## 总览

| # | 问题 | 判定 | 严重程度 | 可修复性 |
|---|------|------|---------|---------|
| 1 | 覆盖范围仅限 `src/` | 逻辑断裂+盲点 | **高** (builtin) / 低 (tests/scripts) | 可修复 |
| 2 | builtin/ 插件脱离检查 | 逻辑断裂 | **高** | 需补完打包流水线 |
| 3 | CI 无 lint | 盲点 | **高** | 一行 CI 改动 |
| 4 | 无 pre-commit | 盲点 | 中 | 加 husky/lint-staged |
| 5 | `test_boundaries.mjs` 孤儿 | 逻辑断裂 | 低 | 删除或集成 |
| 6 | `require()` + disable | 误报 | 无 | 无需处理 |
| 7 | `as unknown as T` | 盲点 + 1 个 bug | **高** (bug) / 中 (规则缺口) | 修 bug + 考虑规则 |
| 8 | 缺少 `non-null-assertion` | 盲点 | 低 | 一行 ESLint 改动 |
| 9 | `@ts-ignore` | 误报 | 无 | 无需处理 |
| 10 | 嵌套配置覆盖 | 误报 | 无 | N/A (flat config) |

**四个高严重度项的核心原因相互关联**：
- ESLint 规则写得很全面（boundaries、no-explicit-any、no-restricted-syntax 等）
- 但执行端(CI + pre-commit)完全缺失
- 覆盖范围缺口(builtin/ 不在 files 中)让规则连"本地手动跑"都管不到
- 规则配置也有缺口（无 no-unsafe-type-assertion），让 `as unknown as` 可以无声地藏 bug
