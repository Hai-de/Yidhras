# 插槽函数高级功能 — Phase 5 实现计划

> 关联设计: `.limcode/design/slot-function-advanced-design.md`
> 关联实现: Phase 1–4（已完成）、插件拓展系统、DataCleaner 注册表
> 日期: 2026-05-07

## 总览

Phase 5 开放两个插件接口：`SlotConditionEvaluator`（门控型）和 `SlotContentTransformer`（变换型），允许世界包插件注册自定义条件评估器和内容变换器。

**架构决策**：

| 决策 | 选择 |
|------|------|
| 内置评估器去留 | 重构为系统包插件（DataCleaner 风格：manifest.yaml + server.ts + activate） |
| 注册表架构 | 严格 per-pack（`Map<packId, Map<key, evaluator>>`，命名空间隔离） |
| content_transform 管线位置 | 独立管线步骤，`behavior_control` → `content_transform` → `permission_filter` |

## 关键约定

- 所有新建源文件在 `apps/server/src/` 下
- 服务端导入必须使用 `.js` 扩展名，分号必需
- 禁止 `any` 类型，除非有注释说明的不可避场景
- Zod schema 放在 `packages/contracts/src/`，无构建步骤
- 插件接口遵循 DataCleaner 模式：`activate(host)` → `host.registerXxx()`

---

## 变更范围

### 1. `packages/contracts/src/slot_condition_evaluator.ts` — 共享合约（新建）

定义 Zod schema + TypeScript 类型：

```typescript
// 能力声明（插件 manifest 的 provides 字段）
slotConditionEvaluatorCapabilitySchema → { key: "slot_condition.<name>", version: "1.0.0" }

// 门控型 — 条件评估器
slotConditionContextSchema → { slot_id, variables, conversation_meta, token_budget,
  current_tick, last_user_message, options? }
slotConditionResultSchema → { active: boolean, reason?: string, confidence?: number }

// 变换型 — 内容变换器
slotTransformContextSchema → { ...slotConditionContextSchema,
  original_content: string, activation_decision: slotConditionResultSchema }
slotTransformResultSchema → { transformed: string, metadata?: Record<string, unknown> }
```

所有返回类型 JSON 可序列化 — 为 Phase 6+ WASM 沙箱预留兼容性。

### 2. `packages/contracts/src/index.ts` — 重新导出（修改）

新增 `slot_condition_evaluator.ts` 的导出。

### 3. `plugins/extensions/slot_condition_registry.ts` — 条件评估器注册表（新建）

**接口**：

```typescript
interface SlotConditionEvaluator {
  readonly key: string;       // 格式: "slot_condition.<name>"
  readonly version: string;
  evaluate(context: SlotConditionContext): Promise<SlotConditionResult>;
}
```

**注册表类 `SlotConditionRegistry`**：
- 内部存储：`Map<string, Map<string, SlotConditionEvaluator>>`（`packId → (key → evaluator)`）
- `register(packId, evaluator)` — 同 pack 内 key 冲突抛错；不同 pack 允许同名
- `get(packId, key)` — 按 pack + key 查找
- `list(packId)` — 列出指定 pack 的所有评估器
- `evaluate(packId, key, context)` — 快捷调用
- 内置全局默认：`registerBuiltin(packId, evaluator)` — 标记为 builtin，pack 级可覆盖

**模块级单例**：`export const slotConditionRegistry = new SlotConditionRegistry()`

### 4. `plugins/extensions/slot_content_transformer.ts` — 内容变换器注册表（新建）

**接口**：

```typescript
interface SlotContentTransformer {
  readonly key: string;       // 格式: "slot_transform.<name>"
  readonly version: string;
  transform(content: string, context: SlotTransformContext): Promise<SlotTransformResult>;
}
```

**注册表类 `SlotContentTransformRegistry`**：
- 与 `SlotConditionRegistry` 相同的 per-pack 架构
- `register(packId, transformer)`、`get(packId, key)`、`list(packId)`、`transform(packId, key, content, context)`
- 模块级单例：`export const slotContentTransformRegistry = new SlotContentTransformRegistry()`

### 5. `plugins/runtime.ts` — ServerPluginHostApi 扩展（修改）

`ServerPluginHostApi` 新增两个方法：

```typescript
registerSlotConditionEvaluator(evaluator: SlotConditionEvaluator, capabilityKey?: string): void;
registerSlotContentTransformer(transformer: SlotContentTransformer, capabilityKey?: string): void;
```

实现模式与 `registerDataCleaner` 一致：
1. `hasCapability` 守卫检查 `capabilityKey`
2. 通过守卫 → 委托给 `slotConditionRegistry.register(packId, evaluator)` / `slotContentTransformRegistry.register(packId, transformer)`
3. `packId` 从当前激活上下文获取（`getActivePackId()` 或通过 `ServerPluginHostApi` 内部闭包传递）

**关键变更**：`createServerPluginHostApi` 需要接收 `packId` 参数。当前实现中 `registerDataCleaner` 使用全局单例注册表，不需要 pack 上下文。Phase 5 的 per-pack 注册表需要 pack 标识。需要在 `ServerPluginHostApi` 工厂中注入 `packId`。

**`createServerPluginHostApi` 签名变更**：

```typescript
// 当前
function createServerPluginHostApi(runtime, capabilities?): ServerPluginHostApi

// Phase 5
function createServerPluginHostApi(runtime, packId: string, capabilities?): ServerPluginHostApi
```

影响范围：`runtime.ts` 中 `createRuntimeForManifest` 调用 `createServerPluginHostApi` 时已有 `packId` 可用（来自 `manifest` 或调用上下文），改动量小。

### 6. `builtin/system_pack/plugins/slot-condition-builtin/` — 内置评估器插件（新增）

将 Phase 1 的 4 个纯函数评估器重构为系统包插件：

**目录结构**：

```
builtin/system_pack/plugins/slot-condition-builtin/
├── plugin.manifest.yaml
└── server.ts
```

**`plugin.manifest.yaml`**：

```yaml
id: "slot-condition-builtin"
name: "Slot Condition Built-in Evaluators"
version: "1.0.0"
kind: "slot_condition"
system: true
load:
  priority: 100
provides:
  - key: "slot_condition.keyword_match"
    version: "1.0.0"
  - key: "slot_condition.logic_match"
    version: "1.0.0"
  - key: "slot_condition.conversation_turn"
    version: "1.0.0"
  - key: "slot_condition.context_length"
    version: "1.0.0"
```

**`server.ts`**：

```typescript
export async function activate(host: ServerPluginHostApi): Promise<void> {
  host.registerSlotConditionEvaluator({
    key: 'slot_condition.keyword_match',
    version: '1.0.0',
    evaluate: async (ctx) => evaluateKeywordMatch(ctx)
  });

  host.registerSlotConditionEvaluator({
    key: 'slot_condition.logic_match',
    version: '1.0.0',
    evaluate: async (ctx) => evaluateLogicMatch(ctx)
  });

  host.registerSlotConditionEvaluator({
    key: 'slot_condition.conversation_turn',
    version: '1.0.0',
    evaluate: async (ctx) => evaluateConversationTurn(ctx)
  });

  host.registerSlotConditionEvaluator({
    key: 'slot_condition.context_length',
    version: '1.0.0',
    evaluate: async (ctx) => evaluateContextLength(ctx)
  });
}
```

评估逻辑从 `inference/slot_condition_evaluators.ts` 导入复用，不重复实现。

### 7. `builtin/system_pack/plugins/order.yaml` — 加载顺序（修改）

在现有 `order` 列表末尾追加 `"slot-condition-builtin"`。

### 8. `plugins/system_pack_init.ts` — 自动初始化（修改）

系统包插件目录扫描会自动发现新插件。如果当前 `initSystemPackPlugins` 只扫描已知目录，需要确保 `slot-condition-builtin/` 被纳入扫描范围。

### 9. `inference/slot_condition_evaluators.ts` — 内置评估器保留（修改）

保留 `evaluateBuiltinCondition`、`evaluateKeywordMatch`、`evaluateLogicMatch`、`evaluateContextLength`、`evaluateConversationTurn` 函数实现。它们作为：
- 插件 `server.ts` 的底层实现（插件是薄封装层）
- 无插件运行时的回退（Phase 1 的 `custom` 条件类型兜底）

新增 `custom` 条件类型支持调用插件注册表：

```typescript
// custom 条件类型 — Phase 5 支持插件评估器
case 'custom': {
  const evaluator = slotConditionRegistry.get(packId, condition.evaluator_key);
  if (!evaluator) {
    return { active: false, reason: `custom evaluator '${condition.evaluator_key}' not found` };
  }
  // 调用插件评估器（带 3s 超时）
  const result = await withTimeout(evaluator.evaluate(ctx), 3000);
  return result;
}
```

`evaluateBuiltinCondition` 需要改为 `async`，或新增 `evaluateCustomCondition` 函数。

### 10. `context/workflow/executors/content_transform.ts` — 内容变换执行器（新建）

新的独立管线步骤 executor：

```typescript
export const createContentTransformExecutor = (): PromptWorkflowStepExecutor => ({
  kind: 'content_transform',
  async execute({ context, state, spec }) {
    // 加载 content transformers（从 registry 或 behavior_profiles）
    // 遍历激活的插槽，调用 transformer.transform()
    // 更新 tree.fragments_by_slot[slotId] 中 fragment 的内容
    // 记录 trace
  }
});
```

**管线位置**：`behavior_control`（激活决策）→ `content_transform`（内容变换）→ `permission_filter`（权限过滤）

### 11. 管线步骤注册（修改 4 个文件）

| 文件 | 变更 |
|------|------|
| `context/workflow/types.ts` | `PromptWorkflowStepKind` 新增 `'content_transform'` |
| `context/workflow/profiles.ts` | 所有 5 个 Profile 在 `behavior_control` 与 `permission_filter` 之间插入 `{ key: 'transform', kind: 'content_transform' }` |
| `context/workflow/registry.ts` | `createPromptWorkflowStepRegistry` 新增 `createContentTransformExecutor()` |
| `context/workflow/orchestrator.ts` | 同 registry.ts |

### 12. `context/workflow/executors/behavior_control.ts` — custom 条件支持（修改）

- `evaluateSlotActivation` 中对 `custom` 类型条件的处理从"Phase 1 默认激活"改为"调用插件注册表查找评估器"
- 需要从 `state` 获取 `pack_id` 以查询 per-pack 注册表
- 3s 超时 + `evaluator_failure_policy` 处理

---

## 与原设计文档的差异

| 项目 | 原设计 | 本计划 |
|------|--------|--------|
| 内置评估器 | 作为插件新建 | 保留现有函数实现，插件为薄封装 |
| `packages/contracts/src/slot_content_transformer.ts` | 独立文件 | 合并到 `slot_condition_evaluator.ts`（门控型 + 变换型在同一文件） |
| `plugins/extensions/slot_content_transformer.ts` | 独立注册表文件 | 独立文件，与 condition registry 对称 |
| 注册表全局 key | 未明确格式 | `slot_condition.<name>` / `slot_transform.<name>` — 与 DataCleaner 的 `data_cleaner.<name>` 格式对齐 |

---

## 实现顺序

```
1. packages/contracts/src/slot_condition_evaluator.ts  ← 共享 Zod schema（无依赖）
                        ↓
2. plugins/extensions/slot_condition_registry.ts        ← 条件评估器注册表
3. plugins/extensions/slot_content_transformer.ts       ← 内容变换器注册表
                        ↓
4. plugins/runtime.ts                                   ← ServerPluginHostApi 扩展
   (需修改 createServerPluginHostApi 注入 packId)
                        ↓
5. builtin/system_pack/plugins/slot-condition-builtin/   ← 内置评估器插件
6. builtin/system_pack/plugins/order.yaml                ← 加载顺序
                        ↓
7. inference/slot_condition_evaluators.ts               ← custom 条件接入注册表
                        ↓
8. context/workflow/types.ts                            ← PromptWorkflowStepKind 新增 'content_transform'
9. context/workflow/executors/content_transform.ts      ← 内容变换执行器
10. context/workflow/profiles.ts                         ← 插入 content_transform 步骤
11. context/workflow/registry.ts                         ← 注册执行器
12. context/workflow/orchestrator.ts                     ← 注册执行器
                        ↓
13. context/workflow/executors/behavior_control.ts       ← custom 条件查询插件注册表
                        ↓
测试
```

步骤 1-3 可并行；步骤 5-6 可并行；步骤 8-12 可并行；步骤 13 依赖步骤 4。

---

## 测试范围

### 单元测试

**`tests/unit/slot_condition_registry.spec.ts`**：
- per-pack 注册与隔离（同 key 不同 pack 不冲突）
- 同 pack 同 key 冲突抛错
- get/list/evaluate 基本操作
- 内置默认 + pack 级覆盖

**`tests/unit/slot_content_transform_registry.spec.ts`**：
- 同 condition registry 的 per-pack 隔离测试
- transform 调用链

**`tests/unit/slot_condition_evaluators.spec.ts`（扩展）**：
- custom 条件类型查询注册表
- 插件未找到 → 返回 false
- 插件超时（3s）
- 插件抛异常 → evaluator_failure_policy 处理

### 集成测试

**`tests/integration/slot_condition_plugin.spec.ts`**：
- 系统包插件自动注册（启动时 discover → enable）
- 内置评估器插件 evaluate 调用
- 世界包插件注册自定义评估器
- per-pack 命名空间隔离验证

**`tests/integration/content_transform_pipeline.spec.ts`**：
- content_transform 执行器在管线中正确执行
- transformer 修改 fragment 内容
- 变换后内容流经 permission_filter
- 无 transformer 时跳过步骤

---

## 不在此次范围

- Phase 6+：Rust sidecar + wasmtime WASM 沙箱
- 功能性 B：双重模块设置（决策仍推迟）
- `group_mode: 'priority' | 'budget'`（Phase 4 仅实现 exclusive）
- 通配符路径解析（仍在 Phase 2+）
