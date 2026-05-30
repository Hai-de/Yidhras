# AppInfrastructure → AppContext 签名谎言修复

## 范围

- `apps/server/src/app/context.ts` — `AppInfrastructure` 和 `AppContext` 接口定义
- `apps/server/src/packs/runtime/projections/pack_projection_metadata_resolver.ts` — `as unknown as AppContext`
- `apps/server/src/packs/snapshots/snapshot_restore.ts` — `as unknown as AppContext`
- `apps/server/src/plugins/worker/contribution_proxy.ts` — Zod `.loose()` 双重断言
- `apps/server/src/inference/slot_condition_evaluators.ts` — `as unknown as SlotLogicExpr`
- `apps/server/src/context/workflow/executors/fragment_assembly.ts` — `as unknown as Record<string, string>`
- `apps/server/src/ai/tool_loop_runner.ts` — `as unknown as { model_entry?: ... }`
- `apps/server/src/ai/registry.ts` — `deepMerge(...) as unknown as T`

不保留向后兼容。所有调用方同步修改。

---

## 一、问题诊断

### 1.1 `AppInfrastructure` → `AppContext`：接受窄类型，使用宽类型

```typescript
// pack_projection_metadata_resolver.ts:27-31
export const createPackProjectionMetadataResolver = (
  context: AppInfrastructure  // ← 声明只需要 AppInfrastructure
): PackProjectionMetadataResolver => {
  const ctx = context as unknown as AppContext;  // ← 实际需要 AppContext
```

`AppContext extends AppInfrastructure`，但反之不成立。函数签名声称只需要 `AppInfrastructure`，实现却调用了 `AppContext` 独有的方法（`getPackRuntimeHandle`、`packScope`）。

这是**签名在说谎**。不是类型系统的限制——纯粹是开发者选择了错误的参数类型。

`schema/` 中的情况相同：

```typescript
// pack_projection_metadata_resolver.ts（同一文件中还有类似模式）
```

以及 `snapshot_restore.ts:388`：

```typescript
{
  packStorageAdapter,
  getPackRuntimeHandle
} as unknown as import('../../app/context.js').AppContext
```

这里甚至更糟——构造了一个只有两个字段的普通对象，然后断言为完整的 `AppContext`。如果 `AppContext` 的其他方法在此上下文中被调用（通过任何间接路径），将是运行时崩溃。

### 1.2 Zod `.loose()` 双重断言

```typescript
// plugins/worker/contribution_proxy.ts:95
z.object({...}).loose() as unknown as z.ZodType<ContextNode>

// plugins/worker/contribution_proxy.ts:123
z.object({...}).loose() as unknown as z.ZodType<PromptWorkflowState>
```

`z.object({...}).loose()` 创建了索引签名类型（允许任意额外属性）。`z.ZodType<ContextNode>` 没有索引签名（严格类型）。TypeScript 不允许此赋值，所以需要 `as unknown as` 绕行。

根本问题：宽松 schema 的 `z.infer<>` 类型与严格目标类型不兼容。

### 1.3 `deepMerge` 的泛型断言

```typescript
// ai/registry.ts:616
return deepMerge(a, b) as unknown as T;
```

`deepMerge` 函数的返回类型不够精确，调用方被迫在每次使用时断言。这是工具函数的类型签名缺陷。

### 1.4 杂项断言

```typescript
// slot_condition_evaluators.ts:325
condition.expression as unknown as SlotLogicExpr

// fragment_assembly.ts:113
(context as unknown as Record<string, string>)['inference_id']

// tool_loop_runner.ts:104
input.task_config as unknown as { model_entry?: { model_name?: string; ... } }
```

这些都是"我知道这里的数据形状，但类型系统不知道"的实例。每一处都是一个微小的类型设计缺陷。

---

## 二、目标架构与修复方案

### 2.1 `AppInfrastructure` → `AppContext`：接受正确的类型

**修复**：将参数类型改为 `AppContext`。

```typescript
// pack_projection_metadata_resolver.ts

import type { AppContext } from '../../app/context.js';

export const createPackProjectionMetadataResolver = (
  context: AppContext  // ← 直接声明实际需要的类型
): PackProjectionMetadataResolver => {
  // 不再需要 as unknown as AppContext
  return {
    resolve(packId: string, feature: string): Promise<PackProjectionResolution> {
      const resolvedPackId = assertPackScope(context, packId, feature);
      const handle = context.getPackRuntimeHandle(resolvedPackId);
      // ...
    }
  };
};
```

`snapshot_restore.ts:388` 的情况更严重。当前代码：

```typescript
const fakeContext = {
  packStorageAdapter,
  getPackRuntimeHandle
} as unknown as import('../../app/context.js').AppContext;
```

**修复**：定义最小依赖接口，让 `snapshot_restore.ts` 的函数仅接收它实际需要的字段：

```typescript
// snapshot_restore.ts

interface SnapshotRestoreContext {
  packStorageAdapter: PackStorageAdapter;
  getPackRuntimeHandle: (packId: string) => PackRuntimeHandle | null;
}

// 调用方传入真实 AppContext 或实现了此接口的对象
```

这比断言为完整 `AppContext` 更安全——类型明确声明了此上下文中可用的方法，不会意外调用未提供的方法。

### 2.2 Zod `.loose()` → `.passthrough()` + 显式解析函数

```typescript
// plugins/worker/contribution_proxy.ts

// 变更前
const contextNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  // ...
}).loose() as unknown as z.ZodType<ContextNode>;

// 变更后
const contextNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  // ...
}).passthrough();  // .passthrough() 保留额外属性，.z.infer<> 类型更接近目标

// 显式声明解析函数，隔离断言
function parseContextNode(input: unknown): ContextNode {
  return contextNodeSchema.parse(input) as ContextNode;
  // 此断言安全：parse 已验证已知字段，passthrough 保留额外字段
}
```

关键变化：断言从 schema 定义处移到解析函数处。Schema 定义本身是类型安全的（`.passthrough()` 不需要断言），唯一的断言在受控的解析函数中，且有明确注释说明其安全性。

### 2.3 `deepMerge` 修复类型签名

当前可能的签名：

```typescript
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown>;
```

修复为：

```typescript
function deepMerge<T extends Record<string, unknown>, U extends Record<string, unknown>>(
  a: T,
  b: U
): T & U;
```

或者更精确地（处理嵌套对象的递归合并）：

```typescript
type DeepMerge<T, U> = T extends Record<string, unknown>
  ? U extends Record<string, unknown>
    ? { [K in keyof T | keyof U]: K extends keyof U ? U[K] : K extends keyof T ? T[K] : never }
    : T & U
  : T & U;

function deepMerge<T, U>(a: T, b: U): DeepMerge<T, U>;
```

如果 `deepMerge` 的实际实现比简单合并更复杂（如递归合并嵌套对象），使用函数重载声明精确类型：

```typescript
function deepMerge<T extends Record<string, unknown>>(a: T, b: Partial<T>): T;
function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  // 实现
}
```

### 2.4 杂项：逐个修复

**`slot_condition_evaluators.ts`**：

```typescript
// 变更前
condition.expression as unknown as SlotLogicExpr

// 方案：为 condition 的 expression 字段提供正确的 Zod schema，
// 或者如果 expression 来自 YAML 解析，使用 Zod 验证而非断言
const expr = slotLogicExprSchema.parse(condition.expression);
```

**`fragment_assembly.ts`**：

```typescript
// 变更前
(context as unknown as Record<string, string>)['inference_id']

// 方案：为 context 添加 inference_id 的类型声明，
// 或使用类型守卫安全访问
const inferenceId = typeof context === 'object' && context !== null && 'inference_id' in context
  ? String(context.inference_id)
  : undefined;
```

**`tool_loop_runner.ts`**：

```typescript
// 变更前
input.task_config as unknown as { model_entry?: { model_name?: string; ... } }

// 方案：为 task_config 定义具体类型（可能在 contracts 包中）
interface TaskConfig {
  model_entry?: {
    model_name?: string;
    provider?: string;
  };
}
```

---

## 三、实施步骤

### 步骤 1：修复 `AppInfrastructure` → `AppContext`

1. `pack_projection_metadata_resolver.ts`：参数类型 `AppInfrastructure` → `AppContext`，删除断言
2. 向上追溯调用链：确保调用方传入的是 `AppContext` 而非 `AppInfrastructure`
3. `snapshot_restore.ts`：替换 `as unknown as AppContext` 为最小接口 `SnapshotRestoreContext`

### 步骤 2：修复 Zod `.loose()` 断言

1. `contribution_proxy.ts`：`.loose()` → `.passthrough()`，添加显式解析函数
2. 验证插件工作线程中的类型仍然兼容

### 步骤 3：修复 `deepMerge`

1. 审查 `deepMerge` 的实际实现行为
2. 添加泛型重载签名
3. 移除 `registry.ts` 中的所有 `as unknown as T` 断言

### 步骤 4：逐个修复杂项断言

每处独立修复，按影响范围从小到大排序：
1. `fragment_assembly.ts`（最简单的类型守卫）
2. `tool_loop_runner.ts`（定义缺失的类型）
3. `slot_condition_evaluators.ts`（添加 Zod 验证）

### 步骤 5：类型检查与测试

```bash
pnpm typecheck
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
```

---

## 四、验证标准

```bash
# AppInfrastructure 签名谎言清除
grep -n "as unknown as AppContext" apps/server/src/packs/runtime/projections/pack_projection_metadata_resolver.ts
grep -n "as unknown as.*AppContext" apps/server/src/packs/snapshots/snapshot_restore.ts
# 预期：空

# Zod .loose() 断言清除
grep -n "as unknown as z.ZodType" apps/server/src/plugins/worker/contribution_proxy.ts
# 预期：空

# deepMerge 调用方无断言
grep -rn "deepMerge.*as unknown as" apps/server/src/
# 预期：空

# 类型检查通过
pnpm typecheck
```
