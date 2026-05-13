# 统一感知层：`rules.perception` 驱动的事件感知 + 环境感知

> 状态: 审核通过 · 待实施
> 创建: 2026-05-13 · 重写: 2026-05-14
> 关联计划: `.limcode/plans/perception-pipeline-location-integration.md`

---

## 动机

当前感知系统是三条完全独立、无共享抽象的路径：

```
Event   → perception_pipeline.ts (step 6) → overlay entry   → context node
State   → domain/perception/resolver.ts    → visibility filter
Location → spatial_proximity.ts            → context node
```

各自有独立的接口、独立的门控逻辑、独立的扩展机制。问题：
- `perception_pipeline.ts` 的解析器来自插件注册或硬编码默认值，不读 pack 配置
- `spatial_proximity.ts` 用 `hasInvestigated` 做二进制门控，不感知能力系统
- `domain/perception/resolver.ts` 做实体状态可见性，与空间和事件感知完全隔离
- `rules.perception` 已在 schema 中定义（`rulesSchema.perception: worldRuleDefinitionSchema[]`），但**零运行时消费**
- `PerceptionLevel` 定义了 `'partial'` 但从未被任何解析器返回

目标：`rules.perception` 成为**唯一的感知行为配置来源**，事件感知和环境感知共享同一个规则引擎。

---

## 目标架构

```
rules.perception (pack config)
       ↓
PerceptionRuleEngine (单一求值器)
       ↓
    ┌──────────────────────────────────────────┐
    ↓                                          ↓
Event perception (step 6)            Environment perception (context assembly)
- 对每个 event+agent:                - 对每个 agent 的当前位置:
  engine.evaluate({                    engine.evaluate({
    event, agent_capabilities,           location_state, agent_capabilities,
    spatial_proximity                    investigation_count
  })                                   })
- 输出: overlay entry                 - 输出: context node content
    (level: full|partial|none)           (level: full|partial|none)
```

优先级链：**pack `rules.perception` > 插件注册 `PerceptionResolver` > 内置默认规则**

三条路径被压缩为一条：`PerceptionRuleEngine`。事件感知管线、环境感知 context source、域感知解析器都消费同一个 engine，只是传入的输入不同。

---

## 核心设计

### 1. 感知规则引擎 `PerceptionRuleEngine`

```typescript
// apps/server/src/perception/rule_engine.ts

interface PerceptionRuleInput {
  // 事件感知用
  event?: {
    eventId: string;
    eventType: string;
    locationId: string | null;
    visibility: string | null;
    actorEntityId: string | null;
  };
  // 环境感知用
  location?: {
    locationId: string;
    publicDescription: string | null;
    hiddenDetails: string | string[] | null;
    tags: string[];
  };
  // 通用
  observerEntityId: string;
  observerLocationId: string | null;
  agentCapabilities: string[];
  investigationCount: number;   // 该 observer 在相关地点的调查次数
}

interface PerceptionRuleOutput {
  level: PerceptionLevel;       // 'full' | 'partial' | 'none'
  visibleDescription: string;   // 基于 level 生成的描述文本
  hiddenDescription: string;    // 基于 level 隐藏的描述文本（存 overlay/structured）
  matchedRuleId: string | null; // 命中的规则 id（审计用）
}
```

### 2. 感知规则 DSL（扩展 `rules.perception` schema）

```yaml
rules:
  perception:
    - id: "observe-same-location"
      when:
        observer_at: "same"          # same | adjacent | any
        event_visibility: "public"   # public | private
      then:
        level: "full"

    - id: "observe-private-own"
      when:
        observer_at: "same"
        event_visibility: "private"
        observer_is_actor: true
      then:
        level: "full"

    - id: "observe-private-other"
      when:
        observer_at: "same"
        event_visibility: "private"
        observer_is_actor: false
      then:
        level: "none"

    - id: "environment-progressive"
      when:
        observer_at: "same"
        investigation_count_min: 0
      then:
        level: "partial"
        reveal_public: true

    - id: "environment-investigated"
      when:
        observer_at: "same"
        investigation_count_min: 1
      then:
        level: "full"
        reveal_hidden: true
```

**类型化 schema**（替代泛型 `worldRuleDefinitionSchema` 用于 perception）：

```typescript
// constitution_schema.ts
const perceptionWhenSchema = z.object({
  observer_at: z.enum(['same', 'adjacent', 'any']).optional(),
  event_visibility: z.enum(['public', 'private']).optional(),
  observer_is_actor: z.boolean().optional(),
  investigation_count_min: z.number().int().min(0).optional(),
  observer_has_capability: z.string().optional()
}).passthrough();

const perceptionThenSchema = z.object({
  level: z.enum(['full', 'partial', 'none']),
  reveal_public: z.boolean().optional(),
  reveal_hidden: z.boolean().optional(),
  max_hidden_segments: z.number().int().min(0).optional()
}).passthrough();
```

### 3. 内置默认规则

当 pack 未声明 `rules.perception`（或声明为 `[]`）时，`PerceptionRuleEngine` 自动注入内置规则集，行为与当前硬编码逻辑等价：

- 同一位置公开事件 → `full`
- 同一位置私密事件且观察者是参与者 → `full`
- 私密事件且观察者不是参与者 → `none`
- 不同位置 → `none`
- 环境感知：无调查 → `partial`（仅 public_description）
- 环境感知：有调查 → `full`（含 hidden_details）

### 4. 插件扩展机制

插件通过现有的 `registerPerceptionResolver` 注册**自定义规则集**或**完全替代 resolver**。注册的 resolver 接收 `PerceptionRuleInput` 并返回 `PerceptionRuleOutput`。规则合并策略：

- pack `rules.perception` 声明 → 优先级最高
- 插件注册的自定义 `PerceptionResolver` → 中等优先级（覆盖默认规则）
- 内置默认规则 → 回退

`PerceptionRuleEngine.evaluate()` 对外部只暴露一个纯函数接口，规则来源由工厂注入。

### 5. 环境感知：`spatial_proximity.ts` 接入

当前 `buildSpatialProximityContextNodes` 的硬编码逻辑：

```typescript
// 当前: 硬编码
const hasInvestigated = investigatedLocationIds?.includes(location) ?? false;
if (publicDesc) lines.push(publicDesc);
if (hasInvestigated && hiddenDetails) lines.push(`[调查发现] ${hiddenDetails}`);
```

替换为 `PerceptionRuleEngine.evaluate()` 调用：

```typescript
// 目标: 规则驱动
const perception = await ruleEngine.evaluate({
  location: { locationId: location, publicDescription, hiddenDetails, tags },
  observerEntityId: entityId,
  observerLocationId: location,
  agentCapabilities: input.agentCapabilities ?? [],
  investigationCount: input.investigationCounts?.[location] ?? 0
});
// 根据 perception.level 构建文本和 structured
```

### 6. `investigationCount` 替代 `hasInvestigated`

- `ContextSourceAdapterInput` 新增 `investigation_counts?: Record<string, number>`
- `context/service.ts` 中去重逻辑从 `[...new Set(ids)]` 改为 `Map<string, number>` 计数
- `take: 500` 限制改为基于 tick 窗口的过滤（最近 N tick），避免静默截断

### 7. 性能缓存

`SpatialRuntime.getLocationState()` 内部加 tick 级缓存——`listPackEntityStates` 同一 tick 仅调用一次，后续调用读缓存。缓存随 tick 递增失效。

---

## 不变的部分

- `PerceptionLevel` 类型定义 — 保留 `'full' | 'partial' | 'none'`
- 插件 `registerPerceptionResolver` API — 保留但 resolver 签名统一
- `SpatialRuntime` 接口 — 保留，内部加缓存
- `domain/perception/resolver.ts` — 保留，实体状态可见性仍是独立子系统
- 感知 overlay 的 `persistence_mode: 'sticky'` 和标签 — 保留

---

## 文件变更清单

| 文件 | 操作 | 变更内容 |
|---|---|---|
| `apps/server/src/perception/types.ts` | 重写 | 新增 `PerceptionRuleInput`、`PerceptionRuleOutput`、统一 `PerceptionResolver` 签名 |
| `apps/server/src/perception/rule_engine.ts` | 新建 | `createPerceptionRuleEngine`: 规则加载、匹配、求值 |
| `apps/server/src/perception/default_rules.ts` | 新建 | 内置默认感知规则集（等价当前硬编码行为） |
| `apps/server/src/perception/default_resolver.ts` | 重写 | 改为调用 `PerceptionRuleEngine` 的薄包装 |
| `apps/server/src/perception/index.ts` | 修改 | 导出新类型和 engine |
| `apps/server/src/packs/schema/constitution_schema.ts` | 修改 | 扩展 `perception` 规则 schema 为类型化 `perceptionWhenSchema`/`perceptionThenSchema` |
| `apps/server/src/app/runtime/perception_pipeline.ts` | 修改 | 从 pack config 读取 `rules.perception`，注入 engine |
| `apps/server/src/context/sources/spatial_proximity.ts` | 修改 | 替换硬编码为 `PerceptionRuleEngine.evaluate()` 调用 |
| `apps/server/src/context/service.ts` | 修改 | `Set→Map` 计数 + `take:500` 改 tick 窗口 + 透传 rules config |
| `apps/server/src/context/source_registry.ts` | 修改 | `ContextSourceAdapterInput` 新增 `investigation_counts`、`perception_rules` |
| `apps/server/src/packs/runtime/spatial_runtime.ts` | 修改 | `getLocationState` 加 tick 级缓存 |
| `apps/server/src/plugins/runtime.ts` | 修改 | `PerceptionResolver` 签名更新为统一形式 |
| `data/world_packs/snowbound_mansion/config.yaml` | 修改 | `rules.perception` 从 `[]` 改为具体规则声明 |
| `tests/unit/perception_rule_engine.spec.ts` | 新建 | 规则匹配、优先级、默认规则回退 |
| `tests/unit/perception_resolver.spec.ts` | 重写 | 统一接口测试，覆盖事件 + 环境两条路径 |
| `tests/unit/spatial_proximity.spec.ts` | 修改 | 适配 `investigation_counts` + engine 注入 |
| `tests/integration/perception_pipeline.spec.ts` | 新建 | 端到端: 事件→感知→overlay→context node |

---

## 不变的部分

- `perception_pipeline.ts` 步骤位置 — 仍在 step 6
- `PerceptionResolver` 接口名 — 保留，签名统一为接收 `PerceptionRuleInput`
- `SpatialRuntime` 公开接口 — 保留，内部加缓存
- `domain/perception/resolver.ts` — 保留，实体状态可见性是独立子系统
- 感知 overlay 的 `persistence_mode: 'sticky'` 和标签 — 保留
