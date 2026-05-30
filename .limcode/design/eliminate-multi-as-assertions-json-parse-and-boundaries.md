# JSON.parse / 边车 IPC / 存储边界断言收敛

## 范围

- `apps/server/src/ai/providers/*.ts` — `JSON.parse(text) as unknown` 和 `response.json() as unknown`（约 10 处）
- `apps/server/src/ai/task_decoder.ts` — `JSON.parse(text) as unknown`
- `apps/server/src/context/overlay/store.ts` — `JSON.parse(value) as unknown`
- `apps/server/src/config/loader.ts` — YAML 解析
- `apps/server/src/memory/blocks/store.ts` — `JSON.parse(value) as unknown`
- `apps/server/src/memory/blocks/evaluation_context.ts` — JSON 解析
- `apps/server/src/memory/long_term_store.ts` — JSON 解析
- `apps/server/src/packs/storage/internal/PostgresPackStorageAdapter.ts` — 3 处 JSON 解析
- `apps/server/src/packs/snapshots/snapshot_locator.ts` — JSON 解析
- `apps/server/src/packs/snapshots/snapshot_restore.ts` — JSON 解析
- `apps/server/src/packs/storage/pack_collection_repo.ts` — JSON 解析
- `apps/server/src/packs/runtime/projections/pack_narrative_projection_service.ts` — JSON 解析
- `apps/server/src/plugins/discovery.ts` — `YAML.parse(...) as unknown`
- `apps/server/src/plugins/store.ts` — `JSON.parse(value) as unknown`
- `apps/server/src/plugins/system_pack_init.ts` — `YAML.parse(...) as unknown`
- `apps/server/src/app/services/scheduler/cursor.ts` — JSON 解析
- `apps/server/src/app/services/social/social.ts` — JSON 解析 + `as unknown[]`
- `apps/server/src/app/services/audit/audit.ts` — `as unknown[]`
- `apps/server/src/app/services/inference_workflow/*.ts` — JSON 解析（3 处）
- `apps/server/src/app/services/workflow/workflow_trigger_scheduler.ts` — JSON 解析

不保留向后兼容。所有使用点同步修改。

---

## 一、问题诊断

### 1.1 `JSON.parse` 返回 `any`：TypeScript 标准库的设计缺陷

```typescript
// TypeScript 标准库签名
interface JSON {
  parse(text: string, reviver?: ...): any;
  //                                   ^^^ 这里是一切问题的根源
}
```

`JSON.parse` 声明返回 `any`，意味着：
- `const x = JSON.parse(s)` 之后，`x` 可以是任何类型
- 对 `x` 的任何操作都不会触发编译错误
- 如果实际 JSON 结构与预期不符，错误只能在运行时发现

全仓库的 `JSON.parse(value) as unknown` 模式是社区公认的最佳防御实践：
1. 将 `any` 立即转为 `unknown`
2. 通过类型守卫（`isRecord()`、`Array.isArray()`、Zod schema）窄化
3. 窄化后的代码在编译期是类型安全的

**这不是"绕过编译器"——这是修复 TypeScript 标准库的设计缺陷。** 约 30 处 `as unknown` 属于此模式，它们是防御性代码，不是问题。

### 1.2 但每处重复同样的样板代码

虽然每处 `JSON.parse(x) as unknown` 是安全的，但它们构成了 ~30 处散布整个仓库的重复样板。每处都需要 `eslint-disable @typescript-eslint/no-unsafe-type-assertion` 注释。

### 1.3 `as unknown[]` 的模式

```typescript
// audit/audit.ts:91
query['kinds'] as unknown[]

// PostgresPackStorageAdapter.ts:239
value as unknown[]

// plugins/discovery.ts:96
value as unknown[]
```

这些是数组类型擦除：将可能是 `any` 或具体类型的值断言为 `unknown[]`，以便进行 `Array.isArray()` 检查。与 JSON.parse 模式同类——防御性类型擦除。

### 1.4 边车 IPC 缺少序列化契约

```typescript
// memory/blocks/rust_sidecar_client.ts:126
input as unknown as Record<string, unknown>

// scheduler_decision_sidecar_client.ts:106
input as unknown as Record<string, unknown>
```

边车进程间通信需要序列化数据。当前的 `as unknown as Record<string, unknown>` 既是序列化（擦除类型）又是类型绕过。序列化本身不可避免，但可以：
1. 定义传输契约 schema（Zod）
2. 在发送前验证（`schema.parse(input)`）
3. 在接收后验证（`schema.parse(response)`）

---

## 二、目标架构

### 2.1 `safeJsonParse`：收敛 JSON.parse 断言

创建单一工具函数，将 `JSON.parse` 的 `any` 返回类型问题限制在一处：

```typescript
// apps/server/src/utils/safe_json.ts (新文件)

/**
 * 类型安全的 JSON.parse 替代。
 * 将 JSON.parse 的 any 返回值立即转为 unknown，
 * 强制调用方进行运行时类型验证。
 */
export function safeJsonParse(input: string): unknown {
  return JSON.parse(input) as unknown;
}

/**
 * 带 Zod 验证的 JSON.parse。
 * 一行完成 parse + validate，消除所有中间样板。
 */
export function safeJsonParseWith<T>(input: string, schema: { parse: (v: unknown) => T }): T {
  return schema.parse(JSON.parse(input) as unknown);
}
```

所有调用方从：

```typescript
// 变更前
const parsed = JSON.parse(value) as unknown;
if (!isRecord(parsed)) throw new Error('expected object');
const id = String(parsed['id']);
```

变为：

```typescript
// 变更后（方案 A：仅收敛断言）
import { safeJsonParse } from '../../utils/safe_json.js';
const parsed = safeJsonParse(value);
if (!isRecord(parsed)) throw new Error('expected object');

// 变更后（方案 B：使用 Zod schema，推荐）
import { safeJsonParseWith } from '../../utils/safe_json.js';
const schema = z.object({ id: z.string() });
const { id } = safeJsonParseWith(value, schema);
```

方案 B 进一步消除了手写类型守卫样板。

### 2.2 `safeYamlParse`：YAML 解析的同样处理

YAML 解析库可能也存在返回类型不明确的问题：

```typescript
// apps/server/src/utils/safe_yaml.ts (新文件或扩展现有 utils)

import YAML from 'yaml';

export function safeYamlParse(input: string): unknown {
  return YAML.parse(input) as unknown;
}
```

### 2.3 边车 IPC：类型化序列化层

为每个边车方法定义明确的契约：

```typescript
// apps/server/src/app/runtime/sidecar/sidecar_transport.ts (新文件)

/**
 * 边车传输层的类型化包装。
 * 每个边车方法应定义一个此类型的契约。
 */
export interface SidecarMethod<Input, Output> {
  readonly method: string;
  readonly inputSchema: z.ZodType<Input>;
  readonly outputSchema: z.ZodType<Output>;
}

/**
 * 发送类型化的边车请求。
 * 自动验证输入和输出，消除所有手动断言。
 */
export async function invokeSidecarMethod<Input, Output>(
  client: SidecarClient,  // 底层 stdio 客户端
  method: SidecarMethod<Input, Output>,
  input: Input
): Promise<Output> {
  const serialized = method.inputSchema.parse(input);  // 验证输入
  const raw = await client.send(method.method, serialized);
  return method.outputSchema.parse(raw);                // 验证输出
}
```

边车客户端从：

```typescript
// 变更前
const rawResult = await sidecar.send('decide', input as unknown as Record<string, unknown>);
return rawResult as unknown as DecisionResult;
```

变为：

```typescript
// 变更后
const decideMethod: SidecarMethod<DecisionInput, DecisionOutput> = {
  method: 'decide',
  inputSchema: decisionInputSchema,
  outputSchema: decisionOutputSchema
};

const result = await invokeSidecarMethod(sidecar, decideMethod, input);
// result 类型为 DecisionOutput，无需断言
```

### 2.4 `as unknown[]`：使用类型守卫替代

```typescript
// 变更前
const kinds = query['kinds'] as unknown[];
if (Array.isArray(kinds) && kinds.every(k => typeof k === 'string')) { ... }

// 变更后（通用工具函数）
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(v => typeof v === 'string');
}

if (isStringArray(query['kinds'])) { ... }
```

或者如果 `query` 的来源有已知类型，直接在类型定义中修复。

### 2.5 `safe_fs.ts` 的 `as any`

```typescript
// utils/safe_fs.ts:34
fs.readdirSync(path, options as any)
```

这是 Node.js `fs` API 的类型兼容性问题。如果 `options` 是 Node.js 版本间有差异的类型，可以通过 `@types/node` 版本更新或显式类型声明修复：

```typescript
// 方案：定义精确的 options 类型
const readdirOptions: { withFileTypes: true } = { withFileTypes: true };
fs.readdirSync(path, readdirOptions);
```

---

## 三、实施分级

### 优先级 1：JSON.parse 收敛（低风险，高收益）

创建 `safeJsonParse` / `safeJsonParseWith`，逐步替换所有 `JSON.parse(x) as unknown`。

不影响运行时行为——仅是包装层。可以渐进式替换（每次替换一个调用方，运行测试确认无回归）。

### 优先级 2：边车 IPC 契约化（中风险）

为每个边车方法添加 Zod schema，建立类型化的 `invokeSidecarMethod` 包装器。

影响运行时——如果 schema 定义与实际边车响应不匹配，会导致运行时验证失败。需要在添加 schema 前审查边车 Rust 代码的响应结构。

### 优先级 3：`as unknown[]` 清理（低风险）

逐个替换为类型守卫函数。纯类型层面变更。

### 优先级 4：`safe_fs.ts` 的 `as any`（低风险，低优先级）

单文件单行，影响面最小。可在任意阶段处理。

---

## 四、特别说明：`JSON.parse as unknown` 保留方案

如果全面替换 `JSON.parse(x) as unknown` 为 `safeJsonParse(x)` 的工作量过大（~30 处），可接受一个"不做"决策：

**保留现有 `JSON.parse(x) as unknown`，但统一注释和 lint 规则**：

```typescript
// 在 eslint 配置中为特定文件/模式禁用 no-unsafe-type-assertion
// 或在每处添加标准注释：
const parsed = JSON.parse(value) as unknown; // boundary: JSON.parse returns any
```

这不是理想的类型安全状态，但每处 `JSON.parse as unknown` 后面都跟着运行时类型守卫，实际风险极低。与 DI 容器、WorldEngineSessionContext、CalendarConfig 等问题不同——那些是类型架构缺陷；`JSON.parse as unknown` 是 TypeScript 标准库缺陷的标准化防御。

**如果选择此方案，重心应放在确保每处 `JSON.parse as unknown` 后都紧跟适当的运行时验证（类型守卫或 Zod schema），而非消除 `as unknown` 本身。**

---

## 五、实施步骤

### 步骤 1：创建 `safe_json.ts`

在 `apps/server/src/utils/` 下创建 `safe_json.ts`，导出 `safeJsonParse` 和 `safeJsonParseWith`。

### 步骤 2：逐步替换 JSON.parse 调用方

按目录优先级替换：

1. `ai/providers/`（最关键的边界——外部 API 响应）
2. `packs/storage/`（存储层 JSON）
3. `plugins/`（插件系统）
4. 其余

每次替换后运行相关测试确认无回归。

### 步骤 3：添加边车 IPC 契约

1. 审查每个 Rust 边车的实际输入/输出格式
2. 定义对应的 Zod schema
3. 创建 `invokeSidecarMethod` 包装器
4. 修改边车客户端使用新包装器

### 步骤 4：类型检查与测试

```bash
pnpm typecheck
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
```

---

## 六、验证标准

```bash
# 直接 JSON.parse(x) as unknown 的数量减少
grep -rn "JSON.parse.*as unknown" --include="*.ts" apps/server/src/ | wc -l
# 预期：显著减少（如使用了 safeJsonParse）或保持不变（如选择保留方案且有文档记录）

# 边车客户端中无 as unknown as Record
grep -rn "as unknown as Record<string, unknown>" apps/server/src/app/runtime/sidecar/
grep -rn "as unknown as Record<string, unknown>" apps/server/src/memory/blocks/rust_sidecar_client.ts
# 预期：空

# 类型检查通过
pnpm typecheck
```
