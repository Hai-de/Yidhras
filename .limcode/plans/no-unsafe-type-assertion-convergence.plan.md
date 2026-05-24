# no-unsafe-type-assertion 渐进收敛计划

**日期**: 2026-05-24
**关联分析**: `.limcode/design/eslint-bypass-analysis.md` #7
**前置**: `.limcode/plans/eslint-coverage-and-enforcement.plan.md` 阶段 0-2 已全部完成

---

## 背景

`@typescript-eslint/no-unsafe-type-assertion` 试跑在 `src/` 下产生 **514 条警告**。按模式分布：

| 模式 | 数量 | 占比 | 修复难度 |
|------|------|------|---------|
| `as Record<string, unknown>` | ~70 | 14% | 中 |
| `as string` / `as number` / `as boolean` | ~60 | 12% | 低 |
| `from any` (从 any 类型断言) | ~30 | 6% | 高 |
| `as never` | ~19 | 4% | 低 |
| 领域特定类型（AppContext, SchedulerRow 等） | ~35 | 7% | 中 |
| 枚举/字面量联合窄化 | ~20 | 4% | 低 |
| 其他杂项窄化断言 | ~280 | 55% | 中 |

**当前状态**: 规则不在 `eslint.config.mjs` 中。试跑通过 CLI 临时覆盖完成。工作进程中规则通过 `--rule` CLI flag 验证，不写入配置文件，避免误提交。最终阶段 6 才将规则固化到配置。

**核心原则**: 不追求一次性清零。按模式分批处理，每批完成后 lint 确认该模式数量归零。最后一次性将规则以 `error` 加入配置。

---

## 验证方法（全阶段统一）

不改动 `eslint.config.mjs`。使用 CLI `--rule` 覆盖进行验证：

```bash
# 全量检查
pnpm --filter yidhras-server exec eslint --rule '@typescript-eslint/no-unsafe-type-assertion: warn' src/

# 按模式统计
pnpm --filter yidhras-server exec eslint --rule '@typescript-eslint/no-unsafe-type-assertion: warn' src/ 2>&1 | grep -c "no-unsafe-type-assertion"

# 每个阶段完成后验证
pnpm typecheck
pnpm --filter yidhras-server test:unit
```

此方法：
- 不产生配置文件变更，无意外提交风险
- CI 完全不受影响（CI 不执行此命令）
- 各阶段可独立验证

---

## 阶段划分

### 阶段 0: 建立基础设施（~10 分钟）

**目标**: 创建 `boundaryCast` 工具和单元测试，为后续所有阶段提供统一的边界穿越入口。

**文件**:
- `apps/server/src/utils/type_guards.ts` — 新增
- `apps/server/tests/unit/type_guards.spec.ts` — 新增

```typescript
// src/utils/type_guards.ts

/** 运行时校验 value 是普通对象记录（非 null、非数组） */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 边界穿越：将 unknown 值断言为目标类型。
 * 仅用于系统边界不可消除的断言点（JSON.parse 返回值、Prisma JSON 列、外部 API 响应）。
 * 调用点不会被 no-unsafe-type-assertion 标记——断言集中在函数体内用 eslint-disable 管理。
 */
export function boundaryCast<T>(_value: unknown): T {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return _value as unknown as T;
}
```

**测试覆盖**:
- `isRecord`: 普通对象返回 true；null、数组、string、number 返回 false
- `boundaryCast`: 返回原始值引用（透传），泛型编译期正确

**验证**: `pnpm typecheck && pnpm --filter yidhras-server test:unit`

---

### 阶段 1: 原始类型断言替换（~60 条，最低难度）

**目标模式**: `as string`、`as number`、`as boolean`

**问题**: 代码使用 `x as string` 替代 `typeof x === 'string' ? x : defaultValue`，在运行时无保护。

**修复策略**: 逐个替换为运行时类型守卫：

| 断言 | 替换为 |
|------|--------|
| `x as string` | `typeof x === 'string' ? x : defaultString` |
| `x as number` | `typeof x === 'number' ? x : defaultNumber` |
| `x as boolean` | `typeof x === 'boolean' ? x : defaultBoolean` |

当上下文已通过类型守卫确保类型时（`if (typeof x === 'string') { x as string }`），直接移除断言。

**执行步骤**:
1. `grep -rn " as string\b" src/ --include="*.ts"` 列出全部
2. 按文件逐个替换，每个文件改完跑 `pnpm typecheck` 确认
3. 对 `as number` / `as boolean` 重复
4. 验证：CLI lint 确认这些模式归零

**涉及文件估计**: 40-50 个文件
**预计工作量**: 中等（模板化替换）

---

### 阶段 2: never 断言清理（~19 条，低难度）

**目标模式**: `as never`

**分类标准**（扩展后）:

| 类别 | 模式 | 处理方式 |
|------|------|---------|
| a) 穷尽检查 | `default: const _exhaustive: never = x` 或 `throw new Error(...)` | 加 `eslint-disable-next-line` 注释 |
| b) 类型压制 | `x as never as TargetType` | 替换为 `boundaryCast<TargetType>(x)` |
| c) 泛型约束 | `arr.reduce<T>((acc, item) => acc, [] as never[])` | 替换为 `[] as T[]` 或显式类型注解 |
| d) 函数返回占位 | `return undefined as never` (用于 stub) | 加 `eslint-disable-next-line` 注释 |

**执行步骤**:
1. `grep -rn "as never" src/ --include="*.ts"` 列出全部
2. 逐个分类为 a/b/c/d
3. a/d 类：加 `// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- exhaustive check`
4. b 类：替换为 `boundaryCast<T>(x)`
5. c 类：修复类型参数
6. 验证：CLI lint 确认 `as never` 全部消失或被 disable 覆盖

**涉及文件估计**: ~15 个文件
**预计工作量**: 低

---

### 阶段 3: Record<string, unknown> 断言系统化（~70 条，中等难度）

**目标模式**: `as Record<string, unknown>` 及其变体

**问题**: 最高频单一模式。数据跨越 JSON 边界、DB 列、动态属性访问时类型信息丢失。大部分使用是合法边界穿越。

**修复策略**:

对每个 `as Record<string, unknown>` 使用点分类处理：

| 上下文 | 处理方式 |
|--------|---------|
| JSON.parse / YAML.parse / 外部 API 返回值 | `boundaryCast<Record<string, unknown>>(x)` |
| Prisma JSON 列（`manifest_json` 等） | `boundaryCast<Record<string, unknown>>(x)` |
| 已有运行时守卫保护（`typeof x === 'object'`） | 保留断言并加 `eslint-disable-next-line` |
| `as unknown as Record<string, unknown>` 双断言 | 直接替换为 `boundaryCast<Record<string, unknown>>(x)` |

**执行步骤**:
1. `grep -rn "as Record<string, unknown>" src/ --include="*.ts"` 列出全部
2. 逐个文件判断上下文，应用对应策略
3. `grep -rn "as unknown as" src/ --include="*.ts"` 列出全部，替换为 `boundaryCast<T>(x)`
4. 验证：CLI lint 确认 `Record<string, unknown>` 警告全部消除或已 disable

**涉及文件估计**: 50-70 个文件
**预计工作量**: 中高

---

### 阶段 4: from-any 断言清理（~30 条，高难度）

**目标模式**: `assertion from 'any' detected`

**问题**: 断言源类型是 `any`，上游已丢失类型信息。修复需追溯到 `any` 源头。

**源头分类及策略**:

| 源头 | 策略 |
|------|------|
| `JSON.parse()` / `YAML.parse()` | 在解析点引入 Zod schema 或 `isRecord()` 守卫，消除 `any` |
| Prisma `manifest_json` 等动态列 | 使用 `boundaryCast<T>()` |
| 上游 `as any` 压制 | 修复上游类型压制 |
| 无类型声明第三方库 | 使用 `boundaryCast<T>()` 包装，加注释标注库名 |
| 不可追溯或遗留代码 | 加 `eslint-disable-next-line` 注释，标注 `-- from-any: dead-end, <原因>` |

**死胡同处理**: 当 `any` 源无法修复（无类型第三方库、遗留代码依赖链过长），使用带注释的 eslint-disable 而非强行重构引入风险。

**执行步骤**:
1. `pnpm --filter yidhras-server exec eslint --rule '@typescript-eslint/no-unsafe-type-assertion: warn' src/ 2>&1 | grep "from 'any'"` 列出全部
2. 按源头分类
3. 可修复的从源头修复；不可修复的加 disable 注释
4. 验证：from-any 警告归零

**涉及文件估计**: 25-30 个文件
**预计工作量**: 高（需追溯 any 来源）

---

### 阶段 5: 领域特定和杂项断言（~335 条，中等难度）

**目标模式**: 剩余所有 `no-unsafe-type-assertion` 警告

**子阶段拆分**:

#### 5a: 枚举/字面量联合窄化（~20 条，低难度）
- 模式: `as IdentityBindingStatus`、`as SomeEnum` 等
- 策略: Zod enum parse 或运行时值校验
- 涉及文件: ~15 个

#### 5b: 领域类型断言（~35 条，中难度）
- 模式: `as AppContext`、`as RawSchedulerRow`、`as SimulationManager` 等
- 策略: DB rows 和 sidecar transport 类使用 `boundaryCast<T>()`；Express `req` 扩展属性使用 `eslint-disable-next-line`（Express 类型系统的已知限制）
- 涉及文件: ~25 个

#### 5c: 类型窄化补充（~40 条，低难度）
- 模式: `as HTMLElement`、`as Error`、`as Date` 等内置类型窄化
- 策略: `instanceof` 检查或运行时守卫，无法守卫的加 disable 注释
- 涉及文件: ~30 个

#### 5d: 数组/泛型窄化（~50 条，中难度）
- 模式: `as string[]`、`as T[]`、`as Map<K,V>` 等泛型容器窄化
- 策略: `Array.isArray` + 元素类型守卫；泛型容器使用 `boundaryCast`
- 涉及文件: ~35 个

#### 5e: 杂项（~190 条，中难度）
- 其余未能归类到上述子模式的断言
- 策略: 逐案判断。优先级：运行时守卫 > `boundaryCast` > eslint-disable 注释
- 涉及文件: ~80 个

**执行步骤**:
1. 按子模式依次进行，每批完成后 CLI lint 验证
2. 每批 20-30 个文件
3. 5e（杂项）按目录分批：`ai/` → `domain/` → `app/` → `packs/` → 其他

**涉及文件估计**: 100+ 个文件
**预计工作量**: 中等（批量操作，模板化）

---

### 阶段 6: 收尾 — 将规则固化到配置

**前置条件**: 阶段 1-5 全部完成，CLI lint 零命中。

**执行步骤**:
1. `pnpm --filter yidhras-server exec eslint --rule '@typescript-eslint/no-unsafe-type-assertion: error' src/` 确认零错误
2. 在 `eslint.config.mjs` 的 `src/**/*.ts` rules 块中新增：
   ```js
   '@typescript-eslint/no-unsafe-type-assertion': 'error',
   ```
3. 在 AGENTS.md 中添加该规则说明
4. 验证 `pnpm lint` 通过

---

## 执行优先级排序

```
阶段 0 (基础设施) ──→ 创建 boundaryCast + 测试
  ↓
阶段 1 (原始类型, ~60条) + 阶段 2 (as never, ~19条) ──→ 可并行
  ↓
阶段 3 (Record<string, unknown>, ~70条) ──→ 依赖阶段 0 的工具
  ↓
阶段 4 (from-any, ~30条) ──→ 依赖阶段 0 的工具
  ↓
阶段 5a → 5b → 5c → 5d → 5e (领域+杂项, ~335条) ──→ 分批扫尾
  ↓
阶段 6 (固化到配置)
```

---

## 不在此计划内的项

- **`@typescript-eslint/no-unsafe-*` 系列规则**：`no-unsafe-assignment`、`no-unsafe-member-access` 等。需 `projectService`，开启后警告量远超 514。留待未来计划。
- **tests/ 和 scripts/ 质量规则从 warn 升 error**：预存的 no-explicit-any 和 no-unused-vars 违规分散在 40+ 文件中。留待未来计划。
- **builtin/ 目录**：不在本次收敛范围，`projectService` 未覆盖该目录。
