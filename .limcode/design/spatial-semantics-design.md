# 空间语义层设计草案

> 状态: 草案 · A 层 Phase 1 实现完成
> 关联: TODO.md — 上层语义变迁 · 空间语义层
> 前置: world pack constitution schema、PackSimulationLoop、context assembly pipeline、enforcement engine、模板引擎宏处理器（P0）
> 评估时间: 2026-05-08
> 最近评审: 2026-05-09 — A 层 Phase 1 完成，见 `.limcode/plans/foundation-enhancements-from-prototype-evaluation.md`

## 1. 问题陈述

Yidhras 当前有成熟的时间维度（ChronosEngine tick-based 调度）和拓扑关系维度（L2 Relationship 有向加权图），但**零空间基础设施**：

| 维度 | 现有能力 | 缺失能力 |
|------|----------|----------|
| 时间 | ChronosEngine tick + 日历 + 调度 | — |
| 关系 | Relationship 有向加权图 + Cytoscape 可视化 | — |
| 空间 | ❌ | 坐标、距离、邻近、空间事件、空间上下文 |

TODO.md 明确了架构目标：L1 从纯社交层变为"社交 + 空间层"。空间语义需要作为**可插拔领域层**，由 world pack 声明其空间模型，不同世界可选用不同抽象层级。

### 当前代码中的隐含缺口

1. **无空间数据模型** — `EntityState.state_json` 虽为 schemaless JSON，可存坐标，但无 schema 约束、无索引、无查询机制
2. **无距离/邻近函数** — `Relationship.weight` 是关系强度，不是空间距离；仅有 `recent_distance_from_latest_message` 是时序距离
3. **无空间索引** — 实体查询按 `entity_kind` / `entity_type` / `state_namespace`，无法按位置范围查询
4. **无空间事件流** — `Event` 有 `tick` 时间戳但无空间作用域；`impact_data` 可传 JSON 但无空间约定
5. **无空间推理上下文** — context assembly pipeline 无"附近实体"、"同地点事件"等空间上下文源
6. **无空间规则谓词** — enforcement engine 的 `when` 条件无 `location_within` / `proximity_to`
7. **L4 传输层缺空间驱动** — `transmission_delay_ticks` / `transmission_drop_chance` 是静态配置，无基于空间距离的动态计算

## 2. 设计目标

1. **可插拔** — 空间语义是 world pack 的可选声明，无空间配置的世界包行为不变
2. **渐进抽象** — 从离散位置（A）到连续几何（B）到抽象度量空间（C），逐层递进，每层可独立使用
3. **与现有架构兼容** — 扩展而非重构；sim loop 增步、context pipeline 增源、enforcement 增谓词
4. **规模感知** — 当前规模（百级实体）用纯 TS + SQLite JSON 即可；十万级时再引入专用索引
5. **原型验证优先** — 先用具体世界包跑通 A 层全链路，再扩展 B/C

## 3. 抽象层级定义

### A 层：离散位置（命名地点 + 邻接图）

最小可用空间语义。实体属于命名地点，地点之间有邻接关系。

**空间模型**：
- 地点（Location）是命名实体，有 id、label、描述
- 邻接关系用 `LocationEdge` 表示：`{from, to, type, weight}`
- 实体的空间状态：`{location: location_id}`
- 距离 = 图跳数（BFS 最短路径长度）

**适用场景**：文字 MUD、推理游戏、房间探索

**World pack 声明示例**：

```yaml
spatial:
  model: discrete
  locations:
    - id: tavern
      label: 红狮酒馆
      description: 昏暗的酒馆，空气中弥漫着麦芽酒的气味
      tags: [indoor, public]
    - id: market
      label: 集市广场
      description: 喧闹的露天集市
      tags: [outdoor, public]
    - id: alley
      label: 后巷
      description: 潮湿阴暗的小巷
      tags: [outdoor, hidden]
  edges:
    - from: tavern
      to: market
      type: bidirectional
      weight: 1
      meta: {travel_time_ticks: 2}
    - from: market
      to: alley
      type: bidirectional
      weight: 1
      meta: {travel_time_ticks: 1}
  # 地点级规则（可选）
  rules: []
```

### B 层：连续几何（坐标 + 度量函数）

实体有连续坐标，距离由度量函数计算。

**空间模型**：
- 实体空间状态：`{position: {x, y, z?}, region?: region_id}`
- 地点可以是区域（多边形 / 圆），实体可以在区域间连续移动
- 距离 = 度量函数（默认欧氏距离，可配置曼哈顿 / 切比雪夫 / 自定义）
- 支持 "半径 R 内的所有实体" 查询

**适用场景**：战术地图、物理模拟、城市仿真

**World pack 声明示例**：

```yaml
spatial:
  model: continuous
  dimensions: 2
  metric: euclidean  # euclidean | manhattan | chebyshev | custom:<plugin_id>
  regions:
    - id: city_center
      label: 市中心
      polygon: [[0,0],[100,0],[100,100],[0,100]]
  bounds: {min: [0,0], max: [1000,1000]}
```

### C 层：抽象度量空间（属性维度向量空间）

空间位置泛化为任何可度量属性的向量，距离由自定义度量定义。

**空间模型**：
- 实体空间状态：`{vector: [v1, v2, ...vn]}`，每个维度对应一个可度量属性
- 度量函数完全可定制（余弦距离、Jaccard、自定义插件）
- "邻近" 不一定是地理的，可以是语义上的（社会距离、认知距离）
- 支持降维投影可视化

**适用场景**：社会网络距离、语义空间、多维影响域

**World pack 声明示例**：

```yaml
spatial:
  model: abstract
  dimensions:
    - id: authority
      label: 权力
      range: [0, 1]
    - id: wealth
      label: 财富
      range: [0, 1]
    - id: reputation
      label: 声望
      range: [-1, 1]
  metric: cosine  # cosine | euclidean | custom:<plugin_id>
```

## 4. 核心设计

### 4.1 Constitution Schema 扩展

在 world pack constitution schema 中添加 **可选** `spatial` 段：

```typescript
// apps/server/src/packs/schema/constitution_schema.ts 扩展

const SpatialDiscreteSchema = z.object({
  model: z.literal('discrete'),
  locations: z.array(LocationSchema),
  edges: z.array(LocationEdgeSchema),
  rules: z.array(SpatialRuleSchema).optional(),
})

const SpatialContinuousSchema = z.object({
  model: z.literal('continuous'),
  dimensions: z.number().int().min(1).max(3),
  metric: z.enum(['euclidean', 'manhattan', 'chebyshev']).or(z.string().regex(/^custom:.+$/)),
  regions: z.array(RegionSchema).optional(),
  bounds: z.object({ min: z.array(z.number()), max: z.array(z.number()) }).optional(),
  rules: z.array(SpatialRuleSchema).optional(),
})

const SpatialAbstractSchema = z.object({
  model: z.literal('abstract'),
  dimensions: z.array(DimensionSchema),
  metric: z.enum(['cosine', 'euclidean']).or(z.string().regex(/^custom:.+$/)),
  rules: z.array(SpatialRuleSchema).optional(),
})

const SpatialSchema = z.discriminatedUnion('model', [
  SpatialDiscreteSchema,
  SpatialContinuousSchema,
  SpatialAbstractSchema,
])

// Constitution 根对象中新增可选字段
// spatial: SpatialSchema.optional()
```

不声明 `spatial` 段的世界包，行为完全不变（零空间语义）。

### 4.2 空间运行时模型

新增 `SpatialRuntime` 模块，由 `SimulationManager` 持有：

```typescript
// apps/server/src/spatial/runtime.ts (新文件)

interface SpatialRuntime {
  readonly model: 'discrete' | 'continuous' | 'abstract'

  // 查询
  getLocation(entityId: string): string | null          // A 层: location_id
  getPosition(entityId: string): Vec | null              // B 层: 坐标向量
  getVector(entityId: string): Vec | null                // C 层: 属性向量

  // 邻近
  neighbors(locationId: string): string[]                 // A 层: 邻接地点
  withinRadius(center: Vec, radius: number): string[]     // B/C 层: 半径内实体
  nearestNeighbors(entityId: string, k: number): string[] // B/C 层: K 近邻

  // 移动（由 action dispatch 或 world engine 驱动）
  moveEntity(entityId: string, target: string | Vec): void

  // 距离
  distance(a: string, b: string): number | null
}
```

### 4.3 EntityState 空间状态约定

A 层（离散位置）:

```typescript
// entity state namespace: 'spatial'
{
  location: string  // location_id，引用 spatial.locations 中的 id
}
```

B 层（连续几何）:

```typescript
{
  position: { x: number, y: number, z?: number },
  region?: string  // 可选，当前所在区域 id
}
```

C 层（抽象度量空间）:

```typescript
{
  vector: number[],  // 各维度值，顺序对应 spatial.dimensions 定义
}
```

### 4.4 Sim Loop 扩展

当前 5 步循环变为 6 步：

```
1. Expire stale leases
2. World engine step (prepare/commit)
3. Scheduler (partition/assign)
4. Decision jobs (inference)
5. Action dispatcher (ground intents)
6. Perception pipeline  ← 新增
```

**第 6 步：感知管线** — 遍历当前 tick 产生的事件，对每个 observer 实体运行 `PerceptionResolver`，确定每个事件对该实体的可见性级别（full | partial | none）。过滤结果注入下一 tick 的 context assembly。

- 管线约束是平台级的：**每个事件必须经过感知过滤后才进入 context assembly**，防止信息泄漏
- 过滤规则是包级的：世界包通过 YAML 声明或插件提供 `PerceptionResolver` 实现（见 4.4.1）
- 事件需要携带 `location_id` 和 `visibility`（public | private）以支持感知过滤（见 4.4.2）

#### 4.4.1 PerceptionResolver 接口

感知解析器是平台定义的插槽接口，世界包可通过声明式配置或插件提供实现：

```typescript
// apps/server/src/spatial/perception.ts (新文件)

interface PerceptionResolver {
  resolve(
    event: PackRuntimeEvent,
    observerState: PackRuntimeEntityState,
    ctx: PackRuntimeContext
  ): PerceptionResult;
}

type PerceptionResult =
  | { level: 'full' }                                           // 完整感知
  | { level: 'partial'; description: string }                   // 降级感知（如"听到闷响"）
  | { level: 'none' };                                          // 不可感知
```

**平台提供默认实现**（`spatial_proximity`），包通过 YAML 声明式配置：

```yaml
perception:
  resolver: spatial_proximity  # 平台内置，或 custom:plugin_id
  rules:
    - match: { visibility: public }
      same_location: full
      adjacent: { level: partial, template: "你隐约听到{source_location}方向传来{event_summary}" }
      distant: none
    - match: { visibility: private }
      only_target: full
      others: none
```

`spatial_proximity` 解析器根据事件的 `location_id` 和 observer 的当前位置计算图距离：
- `same_location`：observer 与事件同位置
- `adjacent`：observer 在事件位置的邻接节点上
- `distant`：图距离 ≥ 2

包作者可完全替换解析器（`perception.resolver: custom:my_plugin_id`），实现社交网络传播、光速延迟、维度梯度等完全不同的感知模型。平台只保证管线约束（事件必经感知过滤），不规定传播规则。

#### 4.4.2 Event 空间作用域

Event 模型新增两个字段以支持感知过滤：

```typescript
// Event 的 impact_data JSON 中新增约定字段
{
  location_id?: string;     // 事件发生的空间位置
  visibility?: 'public' | 'private';  // 可见性，默认 'public'
}
```

- `location_id`：引用 `spatial.locations` 中的地点 id。不携带 `location_id` 的事件视为全局事件（所有 observer 均为 `full`），保证向后兼容
- `visibility: private`：仅事件涉及的 entity（通过 `subject_entity_id` / `target_entity_id` 关联）可完整感知，其余 observer 根据 `PerceptionResolver` 规则处理

### 4.5 Context Assembly 扩展

在 `context/` pipeline 中新增空间上下文源。注意：**事件级感知过滤由 sim loop 第 6 步的 `PerceptionResolver` 管线处理**（见 4.4.1），context assembly 的空间源负责注入环境上下文（位置描述、同地点实体、邻接地点），而非事件可见性判定。

```typescript
// context assembly 新增 source 类型
interface SpatialContextSource {
  type: 'spatial_proximity'
  entity_id: string
  radius?: number          // B/C 层: 距离阈值
  include_adjacent?: boolean // A 层: 是否包含邻接地点的实体
}
```

注入内容（A 层）：
- 当前地点描述：`location.label` + `location.description`
- 同地点实体列表：通过 `SpatialRuntime` 查询，只列 entity label 和公开状态
- 邻接地点列表：`neighbors(locationId)` 的结果，标注地点名称
- 不注入跨地点事件内容——事件感知由 `PerceptionResolver` 结果单独渲染

B/C 层同理，基于坐标/向量空间查询附近实体。

### 4.6 Enforcement Engine 谓词扩展

新增空间谓词：

```typescript
// 离散位置 (A 层)
when:
  - location: { in: [location_id, ...] }           // 实体在指定地点
  - location: { adjacent_to: location_id }         // 实体在指定地点的邻接地点

// 连续几何 (B 层)
when:
  - position: { within: { center: [x,y], radius: R } }  // 位置在范围内
  - position: { near: entity_id, distance: D }            // 在指定实体附近

// 抽象度量 (C 层)
when:
  - vector: { within: { center: [...], radius: R } }     // 向量在范围内
  - vector: { near: entity_id, distance: D }              // 在指定实体附近
```

### 4.7 Action Dispatch 扩展

新增 kernel intent `move`——移动实体在空间中的位置。这是唯一的空间相关 kernel intent。

```typescript
// 新增:
| { type: 'move'; entity_id: string; target: string | Vec }
```

移动语义因 spatial model 不同而异：
- A 层：`target` 是 location_id，dispatch 时检查邻接合法性（只能移到邻接地点，`SpatialRuntime.neighbors()` 校验）
- B 层：`target` 是坐标 `{x, y}`，可连续移动
- C 层：移动 = 向量变更，由维度变更规则驱动

**不在 kernel intent 中新增 `investigate`、`use_item` 等操作。** 这些是领域动作，包作者通过 `invoke.investigate` / `invoke.use_item` + enforcement 规则 + capability 授权实现，走已有 invocation pipeline，不污染 kernel intent 层。

原有的 `trigger_event`、`post_message`、`adjust_relationship`、`adjust_snr` 不变。`post_message` 通过 `PerceptionResolver` 自动获得空间感知特性（消息事件携带 `location_id`，接收者的感知级别由管线判定）。

### 4.8 L4 传输层扩展

`transmission_delay_ticks` 和 `transmission_drop_chance` 从静态配置变为**可由空间距离驱动**：

```yaml
# world pack 配置示例
transmission:
  # 现有静态配置仍可用
  base_delay_ticks: 1
  base_drop_chance: 0.0
  # 新增：空间距离驱动（可选）
  spatial_delay:
    enabled: true
    # A 层: 每跳增加 delay
    delay_per_hop: 1
    # B/C 层: 距离的线性函数
    delay_per_unit_distance: 0.5
  spatial_drop:
    enabled: true
    # 距离越远丢包越高
    base_drop_chance: 0.0
    drop_per_hop: 0.05        # A 层
    drop_per_unit_distance: 0.01  # B/C 层
```

### 4.9 前端可视化

| 层级 | 可视化方式 |
|------|-----------|
| A | 地点邻接图（节点 = 地点，边 = 邻接关系，实体头像标注在当前地点） |
| B | 2D/3D 地图（散点图 + 区域底图，实体位置实时更新） |
| C | 降维投影（t-SNE / UMAP → 2D 平面，语义方向探针） |

L2 已有 Cytoscape.js 图谱可视化，A 层可复用同一组件渲染地点邻接图。

## 5. 文件变动预估

| 区域 | 新增/修改 | 说明 |
|------|-----------|------|
| `packages/contracts/src/spatial.ts` | 新增 | 空间模型 transport 类型 |
| `apps/server/src/packs/schema/constitution_schema.ts` | 修改 | 添加 `spatial` 可选段 + `perception` 声明 |
| `apps/server/src/packs/runtime/materializer.ts` | 修改 | 物化空间配置 + 展开 bootstrap 宏 |
| `apps/server/src/spatial/` | 新增目录 | SpatialRuntime + PerceptionResolver + 距离函数 |
| `apps/server/src/core/simulation.ts` | 修改 | 持有 SpatialRuntime |
| `apps/server/src/app/runtime/simulation_loop.ts` | 修改 | 增加第 6 步（感知管线） |
| `apps/server/src/context/` | 修改 | 新增空间上下文源 |
| `apps/server/src/domain/rule/enforcement_engine.ts` | 修改 | 空间谓词支持 |
| `apps/server/src/app/services/action_dispatcher.ts` | 修改 | 支持 move intent |
| `apps/server/src/packs/runtime/core_models.ts` | 修改 | EntityState 空间状态约定 + Event 空间作用域字段 |
| `apps/server/src/template_engine/` | 修改 | 宏处理器基础设施（`MacroHandlerFn` + 内置宏） |
| `docs/specs/WORLD_PACK.md` | 修改 | 记录 spatial + perception 配置格式 |
| `docs/ARCH.md` | 修改 | 记录空间语义架构边界 |

## 6. 实施路径

### Phase 0: 宏处理器 (P0)

- 模板引擎 `MacroHandlerFn` 注册机制
- 5 个内置宏：`roll`、`pick`、`int`、`float`、`seed`
- `materializer.ts` 加载时展开 bootstrap 中的宏
- 补完模板引擎已有扩展点（MacroNode + renderer 空分支 → 宏处理器调用）

### Phase 1: A 层实现 ✅ (完成于 2026-05-09)

1. [x] Constitution schema 添加 `spatial` 可选段（`model: discrete`）+ `perception` 声明
2. [x] `SpatialRuntime` 基础实现（邻接图 + BFS 距离）
3. [x] EntityState `spatial` namespace 约定 + Event `location_id`/`visibility` 字段
4. [x] `PerceptionResolver` 接口 + 平台默认 `spatial_proximity` 实现
5. [x] Sim loop 增加第 6 步（感知管线，产出 overlay entry）
6. [x] Context assembly 空间上下文源（位置描述 + 邻接地点）
7. [x] Action dispatch 支持 `move` intent（A 层：地点间移动 + 邻接合法性检查）
8. [x] Enforcement engine 添加 `location.in` / `location.adjacent_to` 谓词（侧车预过滤）

### Phase 2: 原型世界包

- 编写 `data/world_packs/snowbound_mansion/config.yaml`
- 结构化随机角色生成（trait 池 + pick 宏）
- 端到端验证：加载 → 物化展开 → AI 角色扮演 → 多日模拟

### Phase 3: B 层实现（需求驱动）

1. Constitution schema 支持 `model: continuous`
2. 距离函数实现（欧氏 / 曼哈顿 / 切比雪夫）
3. 半径查询 + K 近邻
4. Action dispatch `move` 扩展到连续坐标

### Phase 4: C 层实现（需求驱动）

1. Constitution schema 支持 `model: abstract`
2. 自定义维度 + 度量函数注册

### Phase 5: 规模升级（十万级实体时）

1. 评估 pgvector / LanceDB 替代 brute-force 空间查询
2. 空间索引结构（R-tree / KD-tree）

## 7. 开放问题

1. **实体能否同时在多个地点？** A 层建议单地点归属（简化推理）；B/C 层不限。是否需要在 A 层也支持多地点？→ **待决定**
2. **地点作为 entity 还是独立概念？** 建议地点也用 `EntityState` 表示（`entity_type: 'location'`），复用现有 entity 体系。→ **已确定**：复用 EntityState，避免平行模型
3. **空间事件传播的 tick 延迟** — 已实现为 `PerceptionResolver` 管线（sim loop step 6），每 tick 处理一次空间事件感知。感知结果以 overlay entry 持久化。→ **已解决**
4. **空间与 Authority 的交互** — `AuthorityGrant.scope_json` 是否可以引用空间范围？建议先不支持，Phase 2 再评估。→ **待决定**
5. **C 层是否需要语义嵌入（embedding）维度？** 当前 VectorStore 已有 embedding infra，C 层的向量可以是 embedding 维度，也可以是手定义的属性维度。→ **待决定**，A 层原型完成后评估
6. **原型世界包的空间规模** — 10-20 地点、10-15 agent，已确认。→ **已解决**

## 8. 决策记录

| 日期 | 决策 | 理由 |
|------|------|------|
| 2026-05-08 | 空间语义分 A/B/C 三层渐进 | 降低初始复杂度，原型先跑通最小层 |
| 2026-05-08 | 空间作为 world pack 可选声明 | 保证无空间配置的世界包行为不变 |
| 2026-05-08 | A 层用地点邻接图而非自由坐标 | 文字叙事 / MUD 场景最常见需求，实现最简 |
| 2026-05-08 | 地点复用 EntityState 体系 | 避免平行模型，利用现有 entity/state/authority 机制 |
| 2026-05-08 | 事件必须经过感知过滤后才进入 context assembly | 管线约束是平台级的，保证信息不对称由系统控制而非依赖 AI 自律 |
| 2026-05-08 | 感知规则通过 `PerceptionResolver` 插槽实现，不硬编码传播层级 | 传播逻辑因世界类型而异（声音衰减、社交网络、光速延迟、维度梯度），平台只保证管线约束，内部规则由包作者声明或实现 |
| 2026-05-08 | `move` 为 kernel intent，`investigate`/`use_item` 等不提升为 kernel | 移动是空间模拟原子操作；领域动作用 `invoke.*` + pack enforcement 规则即可 |
| 2026-05-08 | 声学衰减传播（Layer 2）是 pack 级实现，不是平台级 | 不同世界包需要完全不同的传播模型，`PerceptionResolver` 由包配置或插件提供 |
| 2026-05-08 | 宏处理器（roll/pick/int/float/seed）为平台基础设施 | 补完模板引擎已有扩展点（MacroNode + renderer 空分支），所有世界包均需"加载时确定随机状态" |
| 2026-05-09 | 感知结果以 overlay entry 持久化 | 要求可追溯；`runPerceptionPipeline()` 每 tick 写入 `system_summary` overlay，现有 overlay context source 自动消费 |
| 2026-05-09 | 空间谓词在 TS 端 enforcement engine 做预过滤 | `when` 条件由 Rust 侧车求值，侧车不认 `location.in`/`adjacent_to`。TS 端在调用侧车前用 `SpatialRuntime` 过滤规则，满足条件的才发送到侧车 |
| 2026-05-09 | A 层 Phase 1 全部完成 | spatial schema + SpatialRuntime + Event scope + PerceptionResolver + sim loop step 6 + context source + move intent + enforcement predicates |
| 2026-05-09 | 后续事项：原型世界包 Phase 2 — 编写 `snowbound_mansion/config.yaml`，端到端验证 | 平台基础设施已就位，下一步是包作者侧的内容实现 |