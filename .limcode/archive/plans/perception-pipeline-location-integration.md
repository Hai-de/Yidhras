# 实施计划：统一感知层

> 关联设计: `.limcode/design/perception-pipeline-location-integration.md`
> 创建: 2026-05-14 · 完成: 2026-05-14
> 状态: **已完成** — 全部 7 个 Phase 实施完毕
> 原则: 测试先行 → 接口定义 → 实现 → 接入

---

## 文件变更范围

```
apps/server/src/perception/
  types.ts              — 重写: 统一接口定义
  rule_engine.ts        — 新建: PerceptionRuleEngine
  default_rules.ts      — 新建: 内置默认规则集
  default_resolver.ts   — 重写: 基于 engine 的薄包装
  index.ts              — 修改: 导出新类型和 factory

apps/server/src/packs/schema/
  constitution_schema.ts — 修改: perception 规则 schema 类型化

apps/server/src/packs/runtime/
  spatial_runtime.ts     — 修改: tick 级缓存 + hiddenDetails 类型扩展

apps/server/src/app/runtime/
  perception_pipeline.ts — 修改: 接入 PerceptionRuleEngine

apps/server/src/context/
  service.ts              — 修改: Set→Map 计数 + take 限制改 tick 窗口
  source_registry.ts      — 修改: ContextSourceAdapterInput 扩展
  sources/spatial_proximity.ts — 修改: 硬编码替换为 engine.evaluate()

apps/server/src/plugins/
  runtime.ts              — 修改: PerceptionResolver 签名更新

data/world_packs/snowbound_mansion/
  config.yaml             — 修改: rules.perception 声明具体规则

tests/unit/
  perception_rule_engine.spec.ts  — 新建: 核心规则引擎测试 (先写)
  perception_resolver.spec.ts     — 重写: 统一接口测试
  spatial_proximity.spec.ts       — 修改: 适配新参数

tests/integration/
  perception_pipeline.spec.ts     — 新建: 端到端感知测试 (后写)
```

---

## 执行步骤

### Phase 0 — 测试先行 (先写，全部 FAIL)

#### Step 0.1: 新建 `tests/unit/perception_rule_engine.spec.ts`

测试用例（全部基于纯函数，不依赖 DB）：

```
describe('PerceptionRuleEngine')
  describe('event perception')
    it('同一位置公开事件 → full')
    it('同一位置私密事件 + 观察者是参与者 → full')
    it('同一位置私密事件 + 观察者非参与者 → none')
    it('不同位置事件 → none')
    it('无 locationId 的全局事件 → full')
    it('agent 缺少能力时 → 规则中 observer_has_capability 不匹配 → 回退到下一优先级规则')

  describe('environment perception')
    it('无调查次数 → partial (仅 public_description)')
    it('调查 1 次 + 单段 hidden_details → full (含 hidden_details)')
    it('调查 1 次 + 多段 hidden_details → 揭示第 1 段')
    it('调查 2 次 + 多段 hidden_details → 揭示第 2 段')
    it('调查次数 >= hidden_details 段数 → 揭示全部')
    it('无 hidden_details → 调查后级别为 full 但无隐藏信息')

  describe('rule priority')
    it('pack 规则优先于内置默认规则')
    it('pack 规则未匹配时回退到内置默认规则')
    it('多条 pack 规则按数组顺序匹配，命中即停止')

  describe('PerceptionLevel.partial')
    it('partial 级别事件 → overlay 创建但带 partial 标记')
    it('partial 级别环境 → context node 仅含 public_description')
```

#### Step 0.2: 新建 `tests/unit/perception_resolver.spec.ts`（重写现有）

将现有 `perception_resolver.spec.ts` 的 5 个用例整合，并扩展：

```
describe('PerceptionResolver (unified)')
  describe('event perception (通过 engine)')
    (保留现有 5 个用例，适配新接口)

  describe('environment perception (通过 engine)')
    it('返回 level + visibleDescription + hiddenDescription')
    it('investigationCount=0 时 hiddenDescription 为 null')
    it('investigationCount=1 时 hiddenDescription 被揭示')
    it('hidden_details 为 string[] 时按 count 分段揭示')
    it('LocationState 为 null 时优雅降级')
```

#### Step 0.3: 新建 `tests/integration/perception_pipeline.spec.ts`

```
describe('Perception Pipeline (integration)')
  it('完整 step 6 pipeline: 事件 → 感知 → overlay 创建')
  it('同一地点多个 agent 各自获得独立感知')
  it('插件注册 resolver 覆盖默认规则')
  it('pack rules.perception 覆盖插件 resolver')
  it('context assembly 使用 engine 生成位置 context node')
```

---

### Phase 1 — 接口定义 (编译通过，测试仍 FAIL)

#### Step 1.1: 重写 `apps/server/src/perception/types.ts`

```typescript
// 保留
export type PerceptionLevel = 'full' | 'partial' | 'none';

// 事件感知输入 (从旧 ResolvePerceptionInput 重构)
export interface PerceptionEventInput {
  eventId: string;
  eventTitle: string;
  eventDescription: string;
  locationId: string | null;
  visibility: string | null;
  actorEntityId: string | null;
}

// 环境感知输入
export interface PerceptionLocationInput {
  locationId: string;
  publicDescription: string | null;
  hiddenDetails: string | string[] | null;
  tags: string[];
}

// 统一输入 — 事件和环境二选一，或两者都提供
export interface PerceptionRuleInput {
  event?: PerceptionEventInput;
  location?: PerceptionLocationInput;
  observerEntityId: string;
  observerLocationId: string | null;
  agentCapabilities: string[];
  investigationCount: number;
}

// 统一输出
export interface PerceptionRuleOutput {
  level: PerceptionLevel;
  visibleDescription: string;
  hiddenDescription: string | null;
  matchedRuleId: string | null;
}

// 统一解析器接口
export interface PerceptionResolver {
  resolve(input: PerceptionRuleInput): Promise<PerceptionRuleOutput>;
}
```

#### Step 1.2: 重写 `apps/server/src/perception/index.ts`

导出所有新类型 + 旧类型别名（过渡用）。

---

### Phase 2 — 规则引擎实现

#### Step 2.1: 新建 `apps/server/src/perception/default_rules.ts`

定义内置默认规则集常量 `BUILTIN_PERCEPTION_RULES`，行为等价当前硬编码逻辑：

```typescript
export const BUILTIN_PERCEPTION_RULES: PerceptionRuleDef[] = [
  // 事件感知
  { id: "event-global", when: { /* event.locationId === null */ },
    then: { level: "full" } },
  { id: "event-same-location-public", when: { observer_at: "same", event_visibility: "public" },
    then: { level: "full" } },
  { id: "event-same-location-private-actor", when: { observer_at: "same", event_visibility: "private", observer_is_actor: true },
    then: { level: "full" } },
  { id: "event-same-location-private-other", when: { observer_at: "same", event_visibility: "private", observer_is_actor: false },
    then: { level: "none" } },
  { id: "event-different-location", when: { observer_at: "any" },
    then: { level: "none" } },
  // 环境感知
  { id: "environment-no-investigation", when: { observer_at: "same", investigation_count_min: 0 },
    then: { level: "partial", reveal_public: true } },
  { id: "environment-investigated", when: { observer_at: "same", investigation_count_min: 1 },
    then: { level: "full", reveal_hidden: true } },
];
```

#### Step 2.2: 新建 `apps/server/src/perception/rule_engine.ts`

实现 `createPerceptionRuleEngine(rules: PerceptionRuleDef[]): PerceptionRuleEngine`：

```typescript
export interface PerceptionRuleEngine {
  evaluate(input: PerceptionRuleInput): PerceptionRuleOutput;
}

export function createPerceptionRuleEngine(
  packRules: PerceptionRuleDef[] | undefined,
  pluginResolver?: PerceptionResolver | null
): PerceptionRuleEngine {
  const rules = packRules && packRules.length > 0 ? packRules : BUILTIN_PERCEPTION_RULES;
  // 如果有 pluginResolver，在 pack 规则不匹配时回退到 pluginResolver
  // 再回退到内置规则
  return {
    evaluate(input) {
      // 1. 依序匹配 pack 规则
      // 2. 命中 → 返回对应 output
      // 3. 未命中 + pluginResolver → 调用 pluginResolver.resolve(input)
      // 4. 否则回退到内置规则匹配
    }
  };
}
```

规则匹配逻辑：
- `observer_at: 'same'` → `input.observerLocationId === input.event?.locationId` 或 `input.observerLocationId === input.location?.locationId`
- `observer_at: 'adjacent'` → 需要通过 SpatialRuntime 查邻接关系（需要 SpatialRuntime 作为 engine 构造参数或 evaluate 可选参数）
- `event_visibility` → 匹配 `input.event?.visibility`
- `observer_is_actor` → 匹配 `input.observerEntityId === input.event?.actorEntityId`
- `investigation_count_min` → 匹配 `input.investigationCount >= count_min`
- `observer_has_capability` → 匹配 `input.agentCapabilities.includes(cap)`

#### Step 2.3: 重写 `apps/server/src/perception/default_resolver.ts`

变为 `createRuleBasedPerceptionResolver(engine: PerceptionRuleEngine): PerceptionResolver`：

```typescript
export function createRuleBasedPerceptionResolver(
  engine: PerceptionRuleEngine
): PerceptionResolver {
  return {
    async resolve(input: PerceptionRuleInput): Promise<PerceptionRuleOutput> {
      return engine.evaluate(input);
    }
  };
}
```

---

### Phase 3 — Schema 类型化

#### Step 3.1: 修改 `apps/server/src/packs/schema/constitution_schema.ts`

在 `rulesSchema` 中，将 `perception` 从泛型改为类型化 schema：

```typescript
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

const perceptionRuleSchema = z.object({
  id: nonEmptyStringSchema,
  when: perceptionWhenSchema,
  then: perceptionThenSchema
}).strict();

// 在 rulesSchema 中:
perception: z.array(perceptionRuleSchema).default([]),
```

验证旧有 pack 的 `perception: []` 声明能通过新 schema（空数组通过）。

---

### Phase 4 — 接入感知管线

#### Step 4.1: 修改 `apps/server/src/app/runtime/perception_pipeline.ts`

变更点：
1. `runPerceptionPipeline` 读取 `packRuntime.getPack().rules.perception`（通过 pack config 获取规则）
2. 构造 `PerceptionRuleEngine`（`createPerceptionRuleEngine(packRules, pluginResolver)`）
3. 对每个 event+agent 构造 `PerceptionRuleInput`，调用 `resolver.resolve(input)`
4. 基于返回的 `PerceptionRuleOutput.level` 决定 overlay 创建

关键改动行：`117-119`（解析器选择）→ 替换为 engine 构造；`130-142`（`ResolvePerceptionInput` 构造）→ 替换为 `PerceptionRuleInput` 构造。

处理 `SpatialRuntime` 依赖：`observerLocationId` 通过对 `entityId` 调用 `spatialRuntime.getLocation(entityId)` 获取。需要提前对所有 agent 做一次批量位置查询。

#### Step 4.2: 修改 `apps/server/src/context/sources/spatial_proximity.ts`

变更点：
1. `buildSpatialProximityContextNodes` 签名新增参数:
   - `perceptionRuleEngine: PerceptionRuleEngine`
   - `agentCapabilities?: string[]`
   - `investigationCounts?: Record<string, number>`（替代 `investigatedLocationIds`）
2. 第 29-52 行硬编码文本构建 → 调用 `engine.evaluate({ location: {...}, ... })`
3. 基于 `PerceptionRuleOutput` 构建 `content.text` 和 `content.structured`
4. `content.structured` 新增字段: `perception_level`, `matched_rule_id`

#### Step 4.3: 修改 `apps/server/src/context/service.ts`

变更点：
1. 第 123 行: `[...new Set(investigatedLocationIds)]` → `Map<string, number>` 计数
   ```typescript
   const investigationCounts = new Map<string, number>();
   for (const locId of investigatedLocationIds) {
     investigationCounts.set(locId, (investigationCounts.get(locId) ?? 0) + 1);
   }
   ```
2. 第 101 行: `take: 500` → 改为基于 tick 窗口的过滤:
   ```typescript
   where: {
     // ... existing filters
     tick: { gte: currentTick - MAX_INVESTIGATION_LOOKBACK_TICK }
   }
   take: undefined  // 去掉硬截断
   ```
   `MAX_INVESTIGATION_LOOKBACK_TICK` 设为合理值（如 `2000n`），基于 `input.tick` 计算。
3. 加载 pack `rules.perception`，构造 `PerceptionRuleEngine`，传入 `createDefaultContextSourceAdapters`
4. `buildContextRun` 中构造 `BuildContextRunInput` 时传入 `investigationCounts` 和 `perceptionRuleEngine`

#### Step 4.4: 修改 `apps/server/src/context/source_registry.ts`

变更点：
1. `ContextSourceAdapterInput` 新增字段:
   ```typescript
   investigation_counts?: Record<string, number>;
   perception_rule_engine?: PerceptionRuleEngine;
   ```
   保留 `investigated_location_ids?: string[]` 为 deprecated（一个版本后移除）。
2. `createSpatialProximitySourceAdapter` 接收 `perceptionRuleEngine` 参数（通过闭包或 `option` 对象），透传给 `buildSpatialProximityContextNodes`
3. adapter 循环第 216-228 行加 try-catch，失败适配器记录到 diagnostics 并继续

---

### Phase 5 — 基础设施改进

#### Step 5.1: 修改 `apps/server/src/packs/runtime/spatial_runtime.ts`

变更点：
1. `LocationState.hiddenDetails` 类型从 `string | null` 改为 `string | string[] | null`
2. 第 149-150 行解析逻辑支持数组:
   ```typescript
   const raw = stateJson.hidden_details;
   let hiddenDetails: string | string[] | null = null;
   if (typeof raw === 'string') hiddenDetails = raw;
   else if (Array.isArray(raw) && raw.every((d: unknown) => typeof d === 'string'))
     hiddenDetails = raw;
   ```
3. tick 级缓存 `listPackEntityStates`:
   ```typescript
   let cachedStates: PackEntityState[] | null = null;
   let cachedTick: bigint | null = null;
   ```
   在 `getLocationState` 内检查缓存，传入 `currentTick` 参数或通过 `setCurrentTick` 更新。

#### Step 5.2: 修改 `apps/server/src/plugins/runtime.ts`

变更点：
1. `PerceptionResolver` 引用更新为新统一接口（`resolve(input: PerceptionRuleInput): Promise<PerceptionRuleOutput>`）
2. `registeredServerPluginRuntime.perception_resolvers` 类型随之更新
3. `registerPerceptionResolver` 参数签名更新

---

### Phase 6 — Pack 配置更新

#### Step 6.1: 修改 `data/world_packs/snowbound_mansion/config.yaml`

将 `rules.perception: []` 替换为具体规则声明：

```yaml
rules:
  perception:
    - id: "observe-event-same-location"
      when:
        observer_at: "same"
        event_visibility: "public"
      then:
        level: "full"

    - id: "observe-event-private-own"
      when:
        observer_at: "same"
        event_visibility: "private"
        observer_is_actor: true
      then:
        level: "full"

    - id: "observe-event-private-other"
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

保留已有的 `objective_enforcement` 和 `invocation` 规则不变。

---

### Phase 7 — 验证

```bash
# 顺序执行
pnpm typecheck          # 类型检查
pnpm lint               # ESLint
pnpm test:unit          # 单元测试 (含新增/重写的用例)
pnpm --filter yidhras-server test:integration  # 集成测试

# 手动验证
pnpm dev                # 启动 dev server
# 检查 agent context node 中的 spatial_proximity 内容
# 触发一次 investigate 操作，确认 hidden_details 揭示
# 确认 perception overlay 条目正确创建
```

---

## 阶段依赖关系

```
Phase 0 (测试)        — 无依赖，可立即开始
Phase 1 (接口)        — 无依赖，与 Phase 0 并行
Phase 2 (engine)      — 依赖 Phase 1
Phase 3 (schema)      — 依赖 Phase 1
Phase 4 (接入)        — 依赖 Phase 2 + Phase 3
  Step 4.1 (pipeline)   — 依赖 Phase 2
  Step 4.2 (spatial)    — 依赖 Phase 2
  Step 4.3 (service)    — 依赖 Phase 2
  Step 4.4 (registry)   — 依赖 Phase 2
Phase 5 (基础设施)    — 无依赖，与 Phase 2-4 并行
Phase 6 (pack config) — 依赖 Phase 3
Phase 7 (验证)        — 依赖 Phase 1-6 全部完成
```

Phase 0 和 Phase 1 可同时启动。Phase 2 和 Phase 5 可并行。Phase 4 的四个 step 也互不依赖可并行推进。

---

## 回滚策略

如实施中遇到阻塞问题，回滚路径：
1. `git revert` 所有 commit
2. `rules.perception: []` 声明在新 schema 下仍合法（空数组 → 使用内置默认规则）
3. `PerceptionResolver` 接口名保留，插件生态无需改动
4. `SpatialRuntime` 公开接口未变，下游兼容
