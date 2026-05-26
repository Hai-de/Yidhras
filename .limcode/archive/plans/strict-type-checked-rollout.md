# strictTypeChecked 分步推进计划

## 目标

从当前的 `recommendedTypeChecked` 逐步向 `strictTypeChecked` 迁移，避免一次性引入 582 errors。

## 最终状态

- TypeScript `strict: true` — 已全局开启
- Server: **0 errors, 476 warnings**
  - 224 warnings 来自 pre-existing（security/detect-object-injection 等）
  - 252 warnings 来自 `no-unnecessary-condition`（评估后决定仅 warn）
- Web: 0 errors, 0 warnings（干净）

## 已加入 eslint.config.mjs 的 strict 规则

| 规则 | 级别 | 状态 |
|------|------|------|
| `use-unknown-in-catch-callback-variable` | error | ✅ |
| `no-unnecessary-type-parameters` | error | ✅ |
| `no-unnecessary-boolean-literal-compare` | error | ✅ |
| `no-unnecessary-type-conversion` | error | ✅ |
| `no-unnecessary-template-expression` | error | ✅ |
| `no-useless-default-assignment` | error | ✅ |
| `no-confusing-void-expression` | error | ✅ |
| `no-deprecated` | error | ✅ |
| `no-non-null-assertion` | error | ✅（从 warn 升级） |
| `no-unnecessary-condition` | warn | ⚠️ 高噪声，仅 warn |

## 已完成步骤

### Step 1 — 修复 baseline 18 errors ✅
修复了 6 个文件中的 18 个 error。策略：
- Zod schema 边界断言使用 `/* eslint-disable */` 块
- Worker 消息边界使用 `eslint-disable-next-line`
- 冗余类型约束直接消除

### Step 2 — use-unknown-in-catch-callback-variable（8 errors）✅
8 个 catch/then 回调参数添加 `: unknown` 注解。

### Step 3 — no-unnecessary-type-parameters（6 errors）✅
5 处 eslint-disable（合法泛型参数），1 处消除泛型（`jsonClone`），1 处类型收窄（`toJsonSafe`）。

### Step 4 — 小规则组（11 errors）✅
布尔比较（5）、类型转换（4）、模板字面量（1）、默认赋值（1）。

### Step 5 — no-confusing-void-expression（17 errors）✅
所有箭头简写 `() => voidFn()` 改为 `() => { voidFn(); }`。

### Step 6 — no-deprecated（48 errors）✅
- `.passthrough()` → `.loose()`（10 处）
- `z.ZodIssueCode.custom` → `"custom"`（37 处）
- `z.string().url()` → `z.url()`（1 处）

### Step 7 — no-non-null-assertion: warn → error（69 errors）✅
- 11 处 parser.ts `peek()!` → `peek()?.`（可选链）
- 12 处 queries.ts Map.get 重复调用 → 变量提取
- 3 处 openai_compatible.ts → sampling 变量提取
- 43 处 eslint-disable-next-line（guarded access 模式）

### Step 8 — no-unnecessary-condition（252 warnings）⚠️ warn
保持 warn 级别。主要原因：
- "value is always truthy/falsy" — 大量防御性检查，运行时值可能与编译时类型不同（API、DB、用户输入）
- "unnecessary optional chain" — 有意为之的防御性编码
- 高噪声比，不适合作为 error 阻塞开发

## 不在此计划中

- `restrict-template-expressions` — 已在 recommendedTypeChecked 中（151 warnings），属既有负债
- Web 端 — 当前 0 errors，无需处理
