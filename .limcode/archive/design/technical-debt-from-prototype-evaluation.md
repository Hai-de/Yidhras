# 技术债务处理草案

> 来源：`TODO.md` 已知技术债务 + 原型世界包实施暴露问题
> 创建：2026-05-09
> 关联：`.limcode/plans/foundation-enhancements-from-prototype-evaluation.md`（平台基础设施已完成）
> 不覆盖：flaky test (`death-note-memory-loop.spec.ts`) — 单独排查修复，不在此草案范围

## 1. 问题总览

原型世界包实施（F1-F11）完成后，暴露出 9 项已知技术债务。按处理策略分三类：

| 类别 | 问题 | 处理方式 |
|------|------|----------|
| 地基缺陷 | #3 variables 无数组、#4 subject_entity 缺 entity_id、#5 无批量授权 | 直接修 schema/解析器 |
| 插件能力缺口 | #6 StepContributor 仅 hook step 2、#7 无 AI 推理接口、#8 无 registerPerceptionResolver | 扩展 Host API |
| 非阻塞留后 | #1 ConversationEntry 归档、#9 manifest 声明式登记 | 长期改进，不在本次范围 |

---

## 2. 地基缺陷（直接修复）

### 2.1 #3 — variables schema 不支持数组

**现状：**

`constitution_schema.ts:48-49`:
```typescript
const worldPackVariableValueSchema: z.ZodType<WorldPackVariableValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), worldPackVariableValueSchema)])
);
```

注意 `worldPackValueSchema`（第 52-61 行）已经支持 `z.array()`，但 `variables` 段用的是 `WorldPackVariableValue` 类型，缺少数组。`snowbound_mansion` 的 trait 池被迫用逗号分隔字符串 `"偏执,勇敢,狡诈"` 绕过。

**修复方案：**

在 `WorldPackVariableValue` 的 union 中增加 `z.array()`，支持递归：

```typescript
const worldPackVariableValueSchema: z.ZodType<WorldPackVariableValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(worldPackVariableValueSchema),
    z.record(z.string(), worldPackVariableValueSchema)
  ])
);
```

同时更新 TypeScript 类型：

```typescript
export type WorldPackVariableValue =
  | string
  | number
  | boolean
  | WorldPackVariableValue[]      // 新增
  | { [key: string]: WorldPackVariableValue };
```

**影响范围：**
- `apps/server/src/packs/schema/constitution_schema.ts` — schema + 类型定义
- `packages/contracts/src/` — 如有独立的类型导出也需同步
- `snowbound_mansion/config.yaml` — trait 池可从逗号字符串改为原生 YAML 数组
- 所有读取 `variables` 的代码 — `WorldPackVariableValue` 类型收窄处需处理数组分支

**兼容性：** 向后兼容。现有 `string | number | boolean | Record` 不受影响。

**工作量：** 小。单文件 schema 改动 + 已有世界包 variables 段验证。

---

### 2.2 #4 — `subject_entity` target_selector 仅支持 `identity_id`

**现状：**

`resolver.ts:109-112`:
```typescript
if (kind === 'subject_entity' && typeof targetSelector.identity_id === 'string') {
  const currentIdentityId = (context as AppInfrastructure & { identity?: { id?: string } }).identity?.id;
  return targetSelector.identity_id === currentIdentityId ? 'subject_entity' : null;
}
```

`subject_entity` 只匹配 caller 的 `identity_id`，无法通过 `entity_id` 直接对实体授权。原型世界包中的黑幕/特殊角色需要对特定 entity 而非 identity 授权时，必须改用 `direct_entity` 逐个列出所有可能的 entity_id。

**修复方案：**

`subject_entity` 的 `target_selector` 同时支持 `identity_id` 和 `entity_id`：

```typescript
if (kind === 'subject_entity') {
  // 优先 entity_id 匹配（直接对实体授权）
  if (typeof targetSelector.entity_id === 'string') {
    return candidateEntityIds.includes(targetSelector.entity_id) ? 'subject_entity' : null;
  }
  // 回退 identity_id 匹配（对用户身份授权）
  if (typeof targetSelector.identity_id === 'string') {
    const currentIdentityId = (context as AppInfrastructure & { identity?: { id?: string } }).identity?.id;
    return targetSelector.identity_id === currentIdentityId ? 'subject_entity' : null;
  }
  return null;
}
```

**影响范围：**
- `apps/server/src/domain/authority/resolver.ts` — `resolveTargetSelectorMatch`
- `packages/contracts/src/world_engine.ts` — `target_selector_json` 的 schema（如已有约束）
- 已有使用 `subject_entity` + `identity_id` 的 authority grant 行为不变

**兼容性：** 完全向后兼容。新增 `entity_id` 路径，不改动已有 `identity_id` 分支。

**工作量：** 极小。单函数改动 + 单元测试。

---

### 2.3 #5 — 无批量/wildcard 授权机制

**现状：**

`resolver.ts:93-113` 只处理三种 `target_selector.kind`：
- `direct_entity` — 指定单个 entity_id
- `holder_of` — 持有指定物品的实体
- `subject_entity` — 指定 identity_id

缺失批量子：12 个角色 × 1 个能力 = 12 条 authority 声明。无 `kind: all_actors` 或 `kind: entity_type_is` 做批量匹配。

**修复方案：**

新增两种 target_selector kind：

```typescript
// kind: 'all_actors' — 匹配所有 actor entity
if (kind === 'all_actors') {
  // 验证 subject 是否为 actor（通过 entity state 或 entity kind 判断）
  const states = await listPackEntityStates(context.packStorageAdapter, packId);
  const isActor = states.some(
    s => candidateEntityIds.includes(s.entity_id) && s.entity_kind === 'actor'
  );
  return isActor ? 'all_actors' : null;
}

// kind: 'entity_type_is' — 匹配指定 entity_type 的所有实体
if (kind === 'entity_type_is' && typeof targetSelector.entity_type === 'string') {
  const states = await listPackEntityStates(context.packStorageAdapter, packId);
  const matches = states.some(
    s => candidateEntityIds.includes(s.entity_id) && s.entity_type === targetSelector.entity_type
  );
  return matches ? 'entity_type_is' : null;
}
```

`matched_via` 类型扩展：

```typescript
matched_via: 'direct_actor_ref' | 'holder_of' | 'subject_entity' | 'all_actors' | 'entity_type_is';
```

**使用示例（world pack config.yaml）：**

```yaml
authority_grants:
  # 替换 12 条逐角色声明：
  - capability_key: "invoke.daily_task"
    grant_type: allow
    source_entity_id: "$system"
    target_selector:
      kind: all_actors
    priority: 10
```

**影响范围：**
- `apps/server/src/domain/authority/resolver.ts` — `resolveTargetSelectorMatch` + `ResolvedCapabilityItem` 类型
- `packages/contracts/src/world_engine.ts` — `target_selector_json` schema 放宽
- `docs/specs/WORLD_PACK.md` — 文档

**兼容性：** 完全新增，不影响已有三种 kind 的行为。

**工作量：** 小。`resolver.ts` 加两个分支 + schema 放宽 + 单元测试。

---

## 3. 插件能力缺口（扩展 Host API）

### 3.1 问题分析

原型世界包暴露了三个插件系统的结构性问题：

| # | 问题 | 根因 |
|---|------|------|
| 6 | 插件只能 hook sim loop step 2 | `StepContributor` 注册到 `WorldEngineContributorRegistry`，该 registry 只在 `stepWorldEngine()` 调用 |
| 7 | 插件无法触发 AI 推理 | `ServerPluginHostApi` 未暴露 AI 推理接口，plugin 无法在 `activate()` 中获得推理能力 |
| 8 | 插件无法注册自定义感知解析器 | `PerceptionResolver` 创建在 `materializer.ts` 中，通过 `perception.type` YAML 字段选型，无插件注册路径 |

这三个问题本质相同：**插件生命周期只在 world pack 激活时运行一次**，后续的 sim loop 感知/推理/调度阶段对插件不可见。

### 3.2 设计决策

**不引入通用 sim loop 生命周期钩子。**

当前 sim loop 有 6 个步骤，每个步骤职责清晰、执行顺序固定。引入通用钩子（如 `onStepStart` / `onStepEnd` / `afterDispatch`）会增加以下风险：
- 钩子执行顺序与 sim loop 内部状态耦合，插件可能依赖未初始化的状态
- 钩子可中断/延迟 sim loop（如果插件执行慢或抛错），破坏 tick 时序保证
- 每个钩子都需要定义输入/输出契约，当前没有足够的用例来验证设计的正确性

**替代方案：逐个扩展 `ServerPluginHostApi`，为已验证的需求添加专用注册方法。**

三个缺口分别处理：

1. **`registerPerceptionResolver`** — 直接加一个 API 方法，因为 `PerceptionResolver` 接口已明确定义（`perception/types.ts`），插件注册的 resolver 与平台默认的 `spatial_proximity` 遵循同一接口。

2. **AI 推理接口** — 不暴露原始 AI 调用（这会让插件绕过 circuit breaker / rate limiter），而是暴露一个受限的 `requestInference(input)` 方法，内部走 `InferenceWorkflow` 的完整管线。这样插件获得推理能力但不绕过平台的保护层。

3. **StepContributor 扩展** — 不改变 `StepContributor` 当前的定义（它仍然是 world engine step 的扩展点）。`PerceptionResolver` 的注册路径独立于 `StepContributor`，这是正确的——感知解析不是 world engine 的一部分。

### 3.3 #8 — registerPerceptionResolver

**新增 Host API 方法：**

```typescript
// ServerPluginHostApi 新增
registerPerceptionResolver(resolver: PerceptionResolver, capabilityKey?: string): void;
```

**实现路径：**

```
pack config.yaml perception.type: custom:<plugin_id>
  → materializer 解析 perception 配置
  → 查 pluginRuntimeRegistry 获取该插件注册的 PerceptionResolver
  → 创建感知管线时调用插件 resolver
```

具体步骤：

1. `ServerPluginHostApi` 加 `registerPerceptionResolver`，`RegisteredServerPluginRuntime` 加 `perception_resolvers: PerceptionResolver[]`
2. `pluginRuntimeRegistry` 加 `getPerceptionResolvers(packId)` 查询方法
3. `PerceptionResolver` 类型从 `perception/types.ts` 移动到公共位置（或 `pluginRuntimeRegistry` 直接 import）
4. `materializer.ts` 或 sim loop 初始化时：如果 `perception.type` 为 `custom:plugin_id`，从 plugin runtime 获取对应 resolver

**声明式 manifest 注册（可选，原型阶段不实现）：**

```json
{
  "contributions": {
    "server": {
      "perception_resolvers": ["my_custom_resolver"]
    }
  }
}
```

插件的 `activate()` 中调用 `host.registerPerceptionResolver(myResolver)` 完成实际注册。manifest 声明只是便于 introspection，不做功能耦合。

**影响范围：**
- `apps/server/src/plugins/runtime.ts` — `ServerPluginHostApi` + `RegisteredServerPluginRuntime` + `pluginRuntimeRegistry`
- `apps/server/src/perception/types.ts` — 无改动（接口已存在）
- `apps/server/src/app/runtime/perception_pipeline.ts` 或 `materializer.ts` — 查询插件 resolver
- `apps/server/src/plugins/context.ts` 或 `pluginRuntimeRegistry` — getter

**工作量：** 中。新 API + 注册表扩展 + 管线集成。

---

### 3.4 #7 — AI 推理接口

**设计约束：**

插件通过 Host API 获得的推理能力必须：
1. 走平台的 `InferenceWorkflow` 管线（circuit breaker、rate limiter、retry、observability）
2. 不绕过 `ai/gateway.ts` 的模型路由
3. 有 token 预算限制（防止插件滥用推理）
4. 响应是结构化的（不返回裸 AI text，返回解析后的结果）

**新增 Host API 方法：**

```typescript
interface PluginInferenceRequest {
  /** 推理用途标识，用于 observability / 限流 */
  purpose: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户提示词 */
  userPrompt: string;
  /** 可选的响应格式约束 */
  responseFormat?: { schema: Record<string, unknown> };
  /** 最大 token 数 */
  maxTokens?: number;
}

interface PluginInferenceResult {
  content: string;
  parsed?: unknown;
  usage: { inputTokens: number; outputTokens: number };
}

// ServerPluginHostApi 新增
requestInference(input: PluginInferenceRequest): Promise<PluginInferenceResult>;
```

**内部实现：**

```
requestInference(input)
  → InferenceWorkflow.runInference({
      mode: 'plugin',          // 新的 workflow mode
      pluginId: runtime.plugin_id,
      packId: runtime.pack_id,
      ...input
    })
  → ai/gateway.ts 路由
  → 返回结果
```

`InferenceWorkflow` 需要新增一个 `plugin` 模式，区别于常规的 agent 推理（`entity_decision`）。`plugin` 模式有独立的 rate limit 配置和 token 预算。

**影响范围：**
- `apps/server/src/plugins/runtime.ts` — `ServerPluginHostApi` 加 `requestInference`
- `apps/server/src/app/services/inference_workflow.ts` — 新增 `plugin` 模式
- `apps/server/src/ai/gateway.ts` — 可能需要 plugin 专用 route（可选，原型阶段共享 route）
- `apps/server/src/plugins/context.ts` — 传递 `InferenceWorkflow` 引用到 Host API 工厂

**安全性：**
- 插件 `requested_capabilities` 必须包含 `server.inference.request` 才能调用
- token 预算通过 `ai_models.yaml` 的 `plugin_monthly_token_budget` 控制
- 所有 plugin 推理调用记录 audit log

**工作量：** 中-大。InferenceWorkflow 新模式 + Host API + 限流。

---

### 3.5 #6 — StepContributor 约束

**当前状态：**

`StepContributor` 注册到 `WorldEngineContributorRegistry`，在 `stepWorldEngine()` (sim loop step 2) 中被调用。`StepContribution` 接口输出 `delta_operations`、`emitted_events`、`observability`，这些都是 world engine step 的语义。

**不做的事情：**

不引入通用 sim loop 钩子系统。理由见 §3.2。

**做的事情：**

`PerceptionResolver` 的插件注册（§3.3）已经解决了"无法在感知阶段介入"的问题。`registerPerceptionResolver` 让插件在 sim loop step 6（感知管线）中拥有扩展点，这是原型世界包明确需要的 hook point。

`StepContributor` 保持在 step 2 是合理的 — world engine step 是状态变更的核心阶段，在此注入 delta 操作是正确的架构。如果后续有其他 step 的 hook 需求，按需添加专用 API（如 `registerPerceptionResolver` 的模式），不提前设计通用系统。

**结论：** #6 的约束本质由 #8 解决。不额外行动。

---

## 4. 非阻塞留后

### 4.1 #1 — ConversationEntry.archived 归档

软归档后 entries 数组无限增长。当前规模（原型阶段）不构成问题。长期方案：
- 按年份物理归档到独立表（`conversation_entries_2025`）
- 或导出 JSON 文件 + 删除 DB 行
- 在 conversation 查询层加 `archived_at IS NULL` 过滤

**不纳入本次处理。** 原型阶段不需要。

### 4.2 #9 — manifest contributions 声明式登记

`contributions.server.*` 字段为 `string[]`，实际注册在 `activate()` 中调用 Host API。`registerManifestContributions()` 生成的 context source / prompt workflow step 是空实现桩。

这是当前设计的特性而非缺陷——manifest 声明用于 introspection 和 capability 验证，实际逻辑在 `activate()` 中注册。当前不需要改变。

**不纳入本次处理。**

---

## 5. 实施顺序建议

```
Phase A: 地基缺陷（无依赖，可并行）
  ├── A1: variables schema 支持数组 (#3)
  ├── A2: subject_entity 支持 entity_id (#4)
  └── A3: 批量/wildcard 授权 (#5: all_actors + entity_type_is)

Phase B: 插件能力（依赖 A 完成后统一测试）
  ├── B1: registerPerceptionResolver (#8)
  └── B2: AI 推理接口 (#7)
```

**Phase A 预计工作量：** 半日。三个独立改动，互不依赖。

**Phase B 预计工作量：** 1-2 日。`registerPerceptionResolver` 涉及 plugin runtime → perception pipeline 的集成路径；`requestInference` 涉及 InferenceWorkflow 新模式。

## 6. 与原型世界包的关系

Phase A 直接减轻 `snowbound_mansion` 的配置负担：

| 改动 | snowbound_mansion 受益 |
|------|----------------------|
| #3 数组支持 | trait 池从 `"偏执,勇敢,狡诈"` 改为原生 `["偏执", "勇敢", "狡诈"]` |
| #4 entity_id 授权 | 黑幕/特殊角色可直接按 entity_id 授权，不需要 identity 映射 |
| #5 all_actors | 12 条逐角色 authority 声明合并为 1 条 |

Phase B 的 `registerPerceptionResolver` 使黑幕感知逻辑可从包配置 YAML 移到插件实现（如果需要复杂感知规则），或保持在 YAML 声明（`perception.type: spatial_proximity` 满足原型需求）。AI 推理接口为后续每日任务生成的插件化提供基础。

## 7. 不处理项

| 项 | 原因 |
|----|------|
| ConversationEntry 归档 (#1) | 原型阶段规模不触发问题 |
| flaky test (#2) | 单独排查 memory overlay 记录逻辑 |
| manifest 声明式 (#9) | 当前设计合理，无需改动 |
| 通用 sim loop 钩子 | 无足够用例验证设计，按需添加专用 API |
| Rust WASM 沙箱 | 需求驱动，原型不需要 |
| 双重模块设置 | 决策已推迟 |
