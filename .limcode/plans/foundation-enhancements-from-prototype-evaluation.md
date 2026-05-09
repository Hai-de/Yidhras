# 地基增强实施计划

> 来源: `.limcode/design/prototype-world-pack-implementation.md` §11 评审结论
> 状态: Stage 1-4 完成
> 创建: 2026-05-08
> 最后更新: 2026-05-09

## 目标

从原型世界包草案中提炼出项目地基应吸纳的通用能力，按依赖顺序实施。
仅实施平台级基础设施，领域逻辑（传播规则、trait 池、任务生成等）留给包作者。

## 实施项与依赖关系

```
F1 宏处理器基础设施
 │
 ▼
F8 PRNG seed 可复现
 │
 ├─► F9 Constitution schema spatial 段
 │    ├─► F10 EntityState spatial namespace
 │    │    └─► F5 move intent + 邻接合法性
 │    │         └─► F6 空间上下文源
 │    ├─► F11 Sim loop 第 6 步（感知管线）
 │    │    └─► F4 PerceptionResolver 接口
 │    └─► F7 空间规则谓词
 │
 └─► F3 Event spatial scope ──► F4, F6, F11
```

## Stage 1: 宏处理器（F1 + F8）

前置: 无

### F1 — MacroHandlerFn + 内置宏

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/template_engine/core/types.ts` | 添加 `MacroHandlerFn` 类型、`macroHandlers` 到 `RenderScope` / `RenderContext` |
| `apps/server/src/template_engine/defaults.ts` | 新增 `BUILTIN_MACRO_HANDLERS`：roll、pick、int、float、seed |
| `apps/server/src/template_engine/core/renderer.ts` | `case 'macro'` 分支从输出空字符串改为调用 `macroHandlers` |
| `apps/server/src/template_engine/frontends/narrative/resolver.ts` | 同上，确保叙事前端也调用宏 |
| `apps/server/src/template_engine/frontends/narrative/types.ts` | 如需要，扩展叙事上下文宏类型 |

**MacroHandlerFn 签名:**

```typescript
type MacroHandlerFn = (
  name: string,
  args: Record<string, string>,
  scope: RenderScope,
) => string;
```

**内置宏:**

- `roll` — `count`（默认 1）、`sides`，求和返回字符串
- `pick` — `from`（逗号分割）、`count`（默认 1），不放回随机选取
- `int` — `min`、`max`，返回区间内随机整数
- `float` — `min`、`max`，返回区间内随机浮点数
- `seed` — `value`，设定 PRNG 种子，返回空字符串（副作用宏）

### F8 — PRNG seed 可复现

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/template_engine/core/prng.ts` | 新文件：mulberry32 或 xoshiro128** 实现 |
| `apps/server/src/template_engine/core/types.ts` | `RenderScope` 增加 `prng` 字段 |
| `apps/server/src/packs/runtime/materializer.ts` | 物化前：创建 PRNG（优先用 pack seed，否则 crypto.randomUUID 生成并记录）、展开 bootstrap 模板中的宏、展开结果写入 entity_states |

**幂等性保证:** 物化记录含 `materialized_at` 时间戳。重试时检测到已有物化记录则跳过宏展开。

**验证:** 单元测试覆盖——相同 seed 产生相同结果；不同 seed 产生不同结果；无 seed 时生成并记录种子。

**完成状态 (2026-05-08):**

| 文件 | 变更 |
|------|------|
| `apps/server/src/template_engine/core/prng.ts` | 新增 — mulberry32 PRNG + string seed hashing |
| `apps/server/src/template_engine/core/types.ts` | `MacroHandlerFn` 类型、`macroHandlers?`/`prng?` 加到 `RenderScope` |
| `apps/server/src/template_engine/defaults.ts` | `BUILTIN_MACRO_HANDLERS`：roll/pick/int/float/seed（seed 只读输出当前种子） |
| `apps/server/src/template_engine/core/renderer.ts` | `case 'macro'` 调用 `scope.macroHandlers[name]`，未命中回退空字符串 |
| `apps/server/src/template_engine/frontends/narrative/resolver.ts` | `case 'macro'` 先查 handler，未命中回退变量解析路径 |
| `apps/server/src/packs/runtime/template_expander.ts` | 新增 — macro-only 语法递归展开 `state_json` 中的 `{{macro}}` |
| `apps/server/src/packs/runtime/materializer.ts` | 物化前创建 PRNG（优先 `variables.seed`，否则 `randomUUID`），展开 bootstrap 模板，种子写入 meta state |
| `apps/server/tests/unit/template_engine_macro.spec.ts` | 新增 30 个测试：PRNG 确定性、5 个宏、展开器、core renderer 兼容性 |

全量测试通过：948 unit + 227 integration，零回归。

文档同步：
- `docs/specs/WORLD_PACK.md` §2.3.1 — 内置宏函数（修正 seed 语法与行为）
- `docs/ARCH.md` §5.2 — 从"预留扩展点"改为"已实现"，修正 RenderContext → RenderScope
- `docs/subsystems/PROMPT_WORKFLOW.md` §6.5 — 加载时宏展开 vs 运行时变量解析区分表

---

## Stage 2: 空间数据模型与基础运行时（F9 + F10 + F3）

前置: 无（可与 Stage 1 并行，但 F5/F6/F11 依赖此阶段）

### F9 — Constitution schema spatial 段

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/packs/schema/constitution_schema.ts` | 添加可选 `spatial` discriminated union（A/B/C 三层）|
| `packages/contracts/src/spatial.ts` | 新文件：空间模型 transport 类型定义 |

**A 层 schema（原型阶段只实现此层）:**

```typescript
const SpatialDiscreteSchema = z.object({
  model: z.literal('discrete'),
  locations: z.array(LocationSchema),
  edges: z.array(LocationEdgeSchema).optional(),
  rules: z.array(SpatialRuleSchema).optional(),
})
```

**关键约束:** 不声明 `spatial` 段的世界包，行为完全不变。

### F10 — EntityState spatial namespace

**约定（非 schema 强制，documented convention）:**

A 层: entity state namespace `spatial` → `{ location: location_id }`

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/packs/runtime/materializer.ts` | 物化时为 location entity 创建 `spatial` namespace state，为 actor entity 设置初始 location |
| `apps/server/src/packs/runtime/spatial_runtime.ts` | 新文件：A 层 SpatialRuntime 实现（邻接图 + BFS + location 查询） |

**SpatialRuntime 接口:**

```typescript
interface SpatialRuntime {
  readonly model: 'discrete' | 'continuous' | 'abstract'
  getLocation(entityId: string): string | null
  neighbors(locationId: string): string[]
  distance(a: string, b: string): number | null  // A 层 = BFS 跳数
  moveEntity(entityId: string, targetLocation: string): void
}
```

### F3 — Event spatial scope

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/prisma/schema.sqlite.prisma` | Event 模型增加 `location_id String?` 和 `visibility String?`（可选字段，向后兼容）|
| `apps/server/prisma/schema.pg.prisma` | 同上 |
| `apps/server/src/app/services/action_dispatcher.ts` | `trigger_event` 分支写入 `location_id` 和 `visibility` |
| `apps/server/src/packs/runtime/materializer.ts` | bootstrap initial_events 增加 location/visibility |

**字段语义:**

- `location_id`: 事件发生的位置实体 ID，null 表示全局事件
- `visibility`: `public` | `private` | null（null 表示向所有人可见，等价于当前的隐式行为）

---

## Stage 3: 空间运行时接入（F5 + F7 + F6）

前置: Stage 2

### F5 — move intent + 邻接合法性检查

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/services/action_dispatcher.ts` | 新增 `move` intent 分支，检查邻接合法性 |
| `apps/server/src/app/services/inference/types.ts` | `ActionIntentDraft` 兼容 move intent 类型 |
| `apps/server/src/domain/invocation/intent_grounder.ts` | 识别 `move` 语义 |

**move intent 类型:**

```typescript
{ type: 'move', entity_id: string, target_location: string }
```

**邻接合法性:** 只有 `target_location` 与当前 `location` 邻接（或为同一地点）时才允许移动。

### F7 — Enforcement 空间谓词

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/domain/rule/enforcement_engine.ts` | `when` 条件判断增加 `location.in` 和 `location.adjacent_to` |

**A 层谓词:**

```yaml
when:
  - location: { in: [kitchen, library] }      # 实体在指定地点
  - location: { adjacent_to: kitchen }          # 实体在指定地点的邻接地点
```

### F6 — 空间上下文源 spatial_proximity

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/context/types.ts` | `ContextSourceKind` 增加 `spatial_proximity` |
| `apps/server/src/context/source_registry.ts` | 注册 `spatial_proximity` source adapter |
| 新文件 `apps/server/src/context/sources/spatial_proximity.ts` | 实现：查询 agent 当前 location → 同 location 实体列表 → 邻接 location 列表 → 组装 ContextNode |

**注入内容:**

- "你当前在 {location_label}"
- "邻接地点有: {adjacent_locations}"

**完成状态 (2026-05-09):**

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/context.ts` | `AppContext` 增加 `getSpatialRuntime?()` 可选方法 |
| `apps/server/src/index.ts` | 注入 `getSpatialRuntime: () => sim.getSpatialRuntime()` |
| `apps/server/src/app/services/action_dispatcher.ts` | 新增 `move` intent 分支 + `dispatchMoveIntent` + `resolveMovePayload` + 邻接合法性校验 |
| `apps/server/src/context/types.ts` | `ContextNodeSourceKind` 增加 `spatial_proximity` |
| `apps/server/src/context/sources/spatial_proximity.ts` | 新增 — context source 注入"当前地点 + 邻接地点"到推理上下文 |
| `apps/server/src/context/source_registry.ts` | 新增 `createSpatialProximitySourceAdapter`，注册到默认 adapter 列表 |
| `apps/server/src/context/service.ts` | `CreateContextServiceOptions` 增加 `spatialRuntime` 参数，转发至 source adapters |
| `apps/server/src/app/services/context_memory_ports.ts` | `createContextAssemblyPort` 传递 `spatialRuntime` |

**延后项:**
- F7 空间谓词（`location.in` / `location.adjacent_to`）→ Stage 4，与感知管线统一处理
- `move` intent 接地逻辑（AI 输出 → `move` intent 解析）→ 后续 prompt 工程

---

## Stage 4: 感知管线（F11 + F4 + F7）

前置: Stage 2 + Stage 3

### F11 — Sim loop 第 6 步

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/app/runtime/PackSimulationLoop.ts` | 5 步循环变为 6 步，新增 step 6: spatial event propagation |

**step 6 逻辑:**

1. 收集当前 tick 产生的所有 Events
2. 过滤出有 `location_id` 的事件
3. 对每个 agent，调用 `PerceptionResolver.resolve()` 确定感知级别
4. 将感知结果注入下一 tick 的 context pipeline

### F4 — PerceptionResolver 接口 + 默认实现

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/perception/types.ts` | 新文件：`PerceptionResolver` 接口、`PerceptionResult` 类型 |
| `apps/server/src/perception/default_resolver.ts` | 新文件：默认实现——同 location + public → full；private → 仅 target；其他 → none |
| `apps/server/src/perception/index.ts` | 新文件：导出 + 工厂函数 |

**接口:**

```typescript
interface PerceptionResolver {
  resolve(
    event: Event & { location_id?: string | null; visibility?: string | null },
    observerState: EntityState,
    ctx: PackRuntimeContext,
  ): PerceptionResult;
}

type PerceptionResult =
  | { level: 'full' }
  | { level: 'partial'; description: string }
  | { level: 'none' };
```

**默认实现（A 层）:**

- 事件 `visibility === 'public'` 且 observer 在同 location → `{ level: 'full' }`
- 事件 `visibility === 'private'` 且 observer 是 target → `{ level: 'full' }`
- 其他 → `{ level: 'none' }`

**扩展点:** Pack 作者可通过 `perception.type` 配置选择感知策略（`spatial_proximity` / `social_network` / `custom:plugin_id`），未来可通过插件注册自定义 `PerceptionResolver`。

### F7 — Enforcement 空间谓词（从 Stage 3 延后）

**延后原因:** `when` 条件当前由 Rust world engine 侧车求值，侧车不认 `location.in` / `location.adjacent_to`。Stage 4 的 `PerceptionResolver` 管线为空间谓词提供了自然的求值位置 — 在 TS 端 `enforcement_engine.ts` 调用侧车前，用 `SpatialRuntime` 做预过滤。

**变动文件:**

| 文件 | 变更 |
|------|------|
| `apps/server/src/domain/rule/enforcement_engine.ts` | `enforceInvocationRequest` 增加空间条件预检查：`location.in` / `location.adjacent_to` |

**实现方向:**
- 从 invocation 的 subject entity 获取当前位置（通过 `SpatialRuntime.getLocation()`）
- 遍历 objective enforcement rules，对 `when.location.in` / `when.location.adjacent_to` 做预过滤
- 不满足条件的 rule 跳过，不发送到侧车
- 需要 `SpatialRuntime` 注入到 `EnforcementContext`

**完成状态 (2026-05-09):**

| 文件 | 变更 |
|------|------|
| `apps/server/src/perception/types.ts` | 新增 — `PerceptionResolver` 接口 + `ResolvePerceptionInput` + `PerceptionResult` |
| `apps/server/src/perception/default_resolver.ts` | 新增 — `createSpatialProximityResolver()` 默认实现 |
| `apps/server/src/perception/index.ts` | 新增 — 导出 barrel |
| `apps/server/src/app/runtime/perception_pipeline.ts` | 新增 — `runPerceptionPipeline()`：查询空间事件 → 枚举 agent → 逐对解析感知 → 写入 overlay entry |
| `apps/server/src/app/runtime/simulation_loop.ts` | 循环增加 step 6：`runPerceptionPipeline(context)` |
| `apps/server/src/domain/rule/enforcement_engine.ts` | 新增 `spatialPredicateMatches()` + 在 `enforceInvocationRequest` 中预过滤规则 |
| `apps/server/src/domain/rule/sidecar_objective_execution.ts` | `buildSidecarObjectiveExecutionRequest` 接受可选 `filteredRules` |
| `apps/server/prisma/schema.prisma` | Event 模型增加 `location_id`/`visibility`（与 SQLite/PG schema 同步） |
| `apps/server/prisma/migrations/20260508233605_add_spatial_fields_to_event/` | 迁移文件 |
| `apps/server/tests/unit/perception_resolver.spec.ts` | 新增 6 个测试 |
| `apps/server/tests/unit/spatial_predicate.spec.ts` | 新增 10 个测试 |

全量测试通过：980 unit + 0 回归。

---

## 验证顺序

每个 Stage 完成后应独立可验证:

1. **Stage 1 验证**: 编写模板引擎宏测试 → `pnpm test:unit` 通过 → 手动测试 seed 可复现性
2. **Stage 2 验证**: 配置含 `spatial` 段的 world pack → 加载成功 → 物化后 entity_states 包含 `spatial` namespace → Event 表含 `location_id` 字段
3. **Stage 3 验证**: AI agent 发出 `move` intent → dispatch 成功 → entity spatial state 更新 → enforcement 空间谓词生效 → context 包含空间信息
4. **Stage 4 验证**: 同一 tick 多 agent 产生事件 → 感知管线按 visibility + location 过滤 → 不同 agent 看到不同事件子集

---

## 不在本计划范围内

以下内容由包作者在原型世界包中定义，不是平台基础设施:

- 声学衰减传播规则（PerceptionResolver 的 pack 级实现）
- `investigate` / `use_item` intent（用 `invoke.*` + enforcement 规则）
- Trait 池设计（包作者业务内容）
- 每日任务生成系统（包级叙事规则）
- 黑幕全知特权（authority grant + capability）
- AI 二次角色加工（推理层配置）
- 前端可视化（按需后续）