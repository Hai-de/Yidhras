# World Engine 边界类型擦除重构

## 范围

- `packages/contracts/src/world_engine_contributors.ts` — `WorldEngineSessionContext` 接口定义
- `apps/server/src/domain/rule/enforcement_engine.ts` — 7 处 `as unknown as`（规则执行引擎）
- `apps/server/src/app/runtime/world_engine_persistence.ts` — 5 处 `as unknown as`（步骤协调器）
- `apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts` — 1 处（边车传输）
- `apps/server/src/memory/blocks/rust_sidecar_client.ts` — 1 处（边车传输）
- `apps/server/src/plugins/worker/contribution_proxy.ts` — 2 处（Zod loose schema 断言）

不保留向后兼容。所有 StepContributor / RuleContributor / QueryContributor 实现同步修改。

---

## 一、问题诊断

### 1.1 合约层的类型自毁

`packages/contracts/src/world_engine_contributors.ts` 定义了插件协议的核心接口：

```typescript
export interface WorldEngineSessionContext {
  readonly world_entities: ReadonlyArray<Record<string, unknown>>;
  readonly entity_states: ReadonlyArray<Record<string, unknown>>;
  readonly authority_grants: ReadonlyArray<Record<string, unknown>>;
  readonly mediator_bindings: ReadonlyArray<Record<string, unknown>>;
  readonly rule_execution_records: ReadonlyArray<Record<string, unknown>>;
}
```

五个领域集合全部擦除为 `ReadonlyArray<Record<string, unknown>>`。这意味着：
- 贡献者（插件）对数据的结构一无所知，只能通过字符串键访问
- 提供者（引擎）持有精确类型但被迫在传入时销毁类型信息
- 任何一方如果对字段名或值类型做出错误假设，错误只能在运行时被发现

### 1.2 上游持有精确类型

数据源函数返回的就是精确类型：

```typescript
// apps/server/src/packs/storage/entity_repo.ts
listPackWorldEntities(adapter, packId): Promise<PackRuntimeWorldEntityRecord[]>

// apps/server/src/packs/storage/entity_state_repo.ts
listPackEntityStates(adapter, packId): Promise<PackRuntimeEntityStateRecord[]>

// ...其余三个同理
```

`PackRuntimeWorldEntityRecord` 有 12 个精确类型化的字段（`id: string`、`entity_kind: string`、`created_at: bigint` 等）。这些类型信息在传入 `WorldEngineSessionContext` 时被主动丢弃：

```typescript
// world_engine_persistence.ts:403
world_entities: worldEntities as unknown as ReadonlyArray<Record<string, unknown>>,
```

### 1.3 下游用字符串键访问

`enforcement_engine.ts` 中，插件适配器通过 `Record<string, unknown>` 访问数据：

```typescript
// enforcement_engine.ts:123
const prismaCandidate = context.prisma as unknown;
// 然后通过 isRecord() 守卫和字符串键访问
```

插件贡献者（`StepContributor.contributePrepare()`）收到的 `WorldEngineSessionContext` 中的这些数组，只能通过 `['field_name']` 访问，没有任何自动补全或编译期验证。

### 1.4 边车 IPC 的类型擦除

```typescript
// scheduler_decision_sidecar_client.ts:106
input as unknown as Record<string, unknown>
```

边车客户端将类型化的输入擦除为 `Record<string, unknown>` 再序列化发送给 Rust 边车进程。反序列化回来的数据同样没有类型保证。这是跨进程通信的固有边界，但当前实现连基本的序列化契约类型都没有定义。

### 1.5 Zod `.loose()` + 双重断言

```typescript
// plugins/worker/contribution_proxy.ts:95
z.object({...}).loose() as unknown as z.ZodType<ContextNode>

// plugins/worker/contribution_proxy.ts:123
z.object({...}).loose() as unknown as z.ZodType<PromptWorkflowState>
```

使用 `.loose()` 创建宽松 schema（允许额外属性），然后断言为严格类型。`z.looseObject()` 的 `z.infer<>` 类型与目标类型不兼容（loose 允许额外属性），所以需要 `as unknown as` 桥接。

---

## 二、目标架构

### 2.1 核心原则

1. **合约层定义具体类型**——`WorldEngineSessionContext` 使用精确的 snapshot 类型，而非 `Record<string, unknown>`
2. **内部路径零断言**——`world_engine_persistence.ts` 和 `enforcement_engine.ts` 不再需要任何类型断言来适配数据
3. **插件边界为唯一转换点**——类型擦除仅在插件工作线程的序列化边界发生
4. **边车 IPC 定义传输契约**——每个边车方法定义明确的输入/输出 Zod schema

### 2.2 合约层的具体类型

`packages/contracts` 中已有对应的 snapshot 类型。将 `WorldEngineSessionContext` 改为使用它们：

```typescript
// packages/contracts/src/world_engine_contributors.ts

import type {
  WorldEntitySnapshot,
  WorldEntityStateSnapshot,
  WorldAuthorityGrantSnapshot,
  WorldMediatorBindingSnapshot,
  WorldRuleExecutionRecordSnapshot
} from './world_engine.js';

export interface WorldEngineSessionContext {
  readonly pack_id: string;
  readonly mode: 'active' | 'experimental';
  readonly current_tick: string;
  readonly current_revision: string;
  readonly world_entities: ReadonlyArray<WorldEntitySnapshot>;
  readonly entity_states: ReadonlyArray<WorldEntityStateSnapshot>;
  readonly authority_grants: ReadonlyArray<WorldAuthorityGrantSnapshot>;
  readonly mediator_bindings: ReadonlyArray<WorldMediatorBindingSnapshot>;
  readonly rule_execution_records: ReadonlyArray<WorldRuleExecutionRecordSnapshot>;
}
```

需要验证 snapshot 类型与 `PackRuntime*Record` 类型之间的兼容性。如果 snapshot 类型是 Zod 推导的（`z.infer<>`），它们应该与手写的 `PackRuntime*Record` 在结构上兼容。如果存在字段差异（如 `bigint` vs `string`），需要在类型层面处理。

### 2.3 内部路径：从 `PackRuntime*Record` 到 snapshot 的转换

`world_engine_persistence.ts` 当前将 `PackRuntimeWorldEntityRecord[]` 强制转换为 `ReadonlyArray<Record<string, unknown>>`。改为：

**方案 A（首选）：统一为 snapshot 类型**

如果 `WorldEntitySnapshot` 与 `PackRuntimeWorldEntityRecord` 结构兼容（字段名和值类型一致），直接将 `listPackWorldEntities()` 的返回值传给 `WorldEngineSessionContext`，无需转换。

**方案 B（如 bigint vs string 不兼容）：创建转换函数**

```typescript
// apps/server/src/domain/rule/snapshot_mapping.ts (新文件)

import type { WorldEntitySnapshot } from '@yidhras/contracts';
import type { PackRuntimeWorldEntityRecord } from '../../packs/runtime/core_models.js';

export function toWorldEntitySnapshot(record: PackRuntimeWorldEntityRecord): WorldEntitySnapshot {
  return {
    id: record.id,
    pack_id: record.pack_id,
    entity_kind: record.entity_kind,
    entity_type: record.entity_type,
    label: record.label,
    tags: record.tags,
    static_schema_ref: record.static_schema_ref,
    payload_json: record.payload_json,
    created_at: record.created_at.toString(),  // bigint → string
    updated_at: record.updated_at.toString()
  };
}
```

这比当前的 `as unknown as ReadonlyArray<Record<string, unknown>>` 更冗长，但**多了实际的类型安全**——如果上游类型增加字段，此函数会编译报错而非静默通过。

### 2.4 插件边界：序列化层处理擦除

插件运行在独立工作线程中。贡献代理（`contribution_proxy.ts`）负责将 `WorldEngineSessionContext` 序列化传递给插件。

在此边界处，将 snapshot 类型转换为插件可消费的格式。使用 Zod schema 定义传输格式：

```typescript
// packages/contracts/src/world_engine_contributors.ts (新增)

import { z } from 'zod';

/** 插件工作线程传输用的 session context schema */
export const worldEngineSessionContextTransportSchema = z.object({
  pack_id: z.string(),
  mode: z.enum(['active', 'experimental']),
  current_tick: z.string(),
  current_revision: z.string(),
  world_entities: z.array(z.record(z.string(), z.unknown())),
  entity_states: z.array(z.record(z.string(), z.unknown())),
  authority_grants: z.array(z.record(z.string(), z.unknown())),
  mediator_bindings: z.array(z.record(z.string(), z.unknown())),
  rule_execution_records: z.array(z.record(z.string(), z.unknown()))
});

export type WorldEngineSessionContextTransport = z.infer<
  typeof worldEngineSessionContextTransportSchema
>;
```

此 schema 在**唯一需要 `Record<string, unknown>` 的地方**使用 `z.record(z.string(), z.unknown())`——插件工作线程的序列化边界。内部代码全部使用 `WorldEngineSessionContext`（强类型版本）。

### 2.5 Zod `.loose()` 问题

`contribution_proxy.ts` 中的模式：

```typescript
z.object({...}).loose() as unknown as z.ZodType<ContextNode>
```

**根因**：使用了 `.loose()`（允许额外属性），但 `z.infer<typeof looseSchema>` 与目标类型不兼容（loose schema 的推断类型包含索引签名）。

**修复**：使用 `z.object({...}).passthrough()` 或重构为两步：
1. 用严格 schema 验证已知字段
2. 显式声明输出类型

```typescript
// 变更前
const schema = z.object({
  id: z.string(),
  label: z.string()
}).loose() as unknown as z.ZodType<ContextNode>;

// 变更后
const schema = z.object({
  id: z.string(),
  label: z.string()
}).passthrough();  // .passthrough() 的 z.infer<> 更接近目标类型

// 在解析时显式声明目标类型
function parseContextNode(input: unknown): ContextNode {
  return schema.parse(input) as ContextNode;
  // 此断言合理：.passthrough() 保留了所有额外字段，
  // parse 已验证已知字段类型正确
}
```

---

## 三、实施步骤

### 步骤 1：审查 snapshot 类型与 Record 类型的一致性

对比 `packages/contracts/src/world_engine.ts` 中的 snapshot 类型和 `apps/server/src/packs/runtime/core_models.ts` 中的 Record 类型：

- 确认字段名一致
- 确认 `bigint` vs `string` 差异（Record 用 `bigint`，snapshot 用 `string`）
- 确认 `Record<string, unknown>` vs 具体类型的差异

### 步骤 2：重定义 `WorldEngineSessionContext`

在 `packages/contracts/src/world_engine_contributors.ts` 中：
- 将五个数组的类型改为具体 snapshot 类型
- 更新所有 `StepContributor`、`RuleContributor`、`QueryContributor` 接口签名
- 导出新的传输层 schema（`worldEngineSessionContextTransportSchema`）

### 步骤 3：修复内部调用方

按顺序修改：

1. `apps/server/src/app/runtime/world_engine_persistence.ts`——移除 5 处 `as unknown as`，添加 snapshot 转换（如需要）
2. `apps/server/src/domain/rule/enforcement_engine.ts`——移除 7 处 `as unknown as`，更新 `buildSidecarObjectiveExecutionRequest` 的类型
3. 任何自定义 `StepContributor` / `RuleContributor` 实现

### 步骤 4：修复插件代理层

修改 `apps/server/src/plugins/worker/contribution_proxy.ts`：
- 在向插件工作线程发送数据前，使用传输 schema 进行序列化
- 修复 `.loose()` 断言

### 步骤 5：修复边车 IPC

修改边车客户端文件，为每个边车方法定义明确的输入/输出 Zod schema：

```typescript
// scheduler_decision_sidecar_client.ts
const decideRequestSchema = z.object({
  // ... 具体字段
});
const decideResponseSchema = z.object({
  // ... 具体字段
});

async decide(input: DecideInput): Promise<DecideOutput> {
  const request = decideRequestSchema.parse(input);   // 验证而非断言
  const raw = await this.send(request);
  return decideResponseSchema.parse(raw);             // 验证而非断言
}
```

### 步骤 6：类型检查与测试

```bash
pnpm typecheck
pnpm --filter yidhras-server test:unit
pnpm --filter yidhras-server test:integration
```

---

## 四、影响面评估

| 变更点 | 文件数 | 风险等级 | 理由 |
|--------|--------|---------|------|
| `WorldEngineSessionContext` 类型重定义 | 1 | 低 | 合约层变更，类型收窄，调用方被迫适配 |
| `world_engine_persistence.ts` 转换 | 1 | 中 | 涉及 bigint→string 转换逻辑 |
| `enforcement_engine.ts` 解除断言 | 1 | 中 | 最大单文件断言集中地（7 处） |
| 插件代理层 | 1 | 中 | 跨线程序列化边界 |
| 边车客户端 | 2 | 低 | 添加 Zod 验证层 |
| StepContributor 实现 | 不确定 | 低 | 类型收窄后调用方获得更好的自动补全 |

---

## 五、验证标准

```bash
# world_engine_persistence.ts 中零 as unknown as
grep -n "as unknown as" apps/server/src/app/runtime/world_engine_persistence.ts
# 预期：空

# enforcement_engine.ts 中零 as unknown as
grep -n "as unknown as" apps/server/src/domain/rule/enforcement_engine.ts
# 预期：空

# 类型检查通过
pnpm typecheck

# 世界引擎相关测试通过
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts tests/integration/world_engine

# 启动正常
pnpm dev:server
```
