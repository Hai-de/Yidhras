# 位置描述全知视角 — 设计草案

> 来源: `.limcode/design/prompt-permission-filtering-gap-analysis.md` W6
> 状态: 已实施 — 统一感知层（Tier 3），方案 D 全覆盖 A+B
> 源码验证: 2026-05-13，问题确认存在
> 实施: 2026-05-14，见 `.limcode/design/perception-pipeline-location-integration.md`
> 实施计划: `.limcode/plans/perception-pipeline-location-integration.md`

---

## 前置依赖：Rule engine `location_id` 写入缺失

`emitObjectiveEvents`（`enforcement_engine.ts:209-219`）创建 Event 时不写 `location_id`。`ObjectiveEventEffect` 接口（`objective_rule_resolver.ts:15-21`）也不含此字段。这导致所有规则引擎产生的事件都没有空间锚定。

这是系统级缺陷，优先于感知门控本身。必须在任何感知门控步骤之前修复：

1. `ObjectiveEventEffect` 增加可选 `location_id`
2. `emitObjectiveEvents` 从 invocation 上下文获取当前位置并填充
3. YAML `emit_events` 格式支持可选 `location_id`（或自动从上下文继承）

不修复此前置依赖，第二步的调查事件查询无法按 location 过滤，感知门控不可实现。

---

## 问题

每个 location 的 `state.description` 是静态全量文本。agent 只要进入该地点，全量描述即注入上下文——无论是否调查过、是否第一次进入。例如 `storage` 的"角落里有一扇通向地下室的暗门"，踏进储藏室的 agent 和调查过一次的 agent 看到的信息完全相同。

**这违背了空间语义 A 层的设计目标：** agent 对空间的感知应该有层次，而非全知。

---

## 方案分析

### A. 拆 schema：`public_description` + `hidden_details`

pack config 每个 location 拆两段，空间上下文源默认只注入 `public_description`。agent 执行 `invoke.investigate` 后追加 `hidden_details`。

```yaml
- id: storage
  state:
    public_description: "阴暗潮湿的房间，堆满了杂物、备用发电机和工具箱。"
    hidden_details: "角落里有一扇通向地下室的暗门。"
```

**优：** 简单声明式，包作者完全控制；schema 改动最小；无需新平台能力
**劣：** 只有两层（0/1），无渐进发现；"调查一次永久可见"的语义可能过于简化

### B. Context source adapter 动态注入

不改 location schema，新增 adapter。查询 agent 在此地点执行过的调查事件次数，按次数分级注入描述（0 次 → 基础 / 1 次 → 发现暗门 / 2+ 次 → 发现铰链被上过油）。

**优：** 支持渐进发现；利用已有事件系统（`semantic_type: 'investigation_conducted'`）
**劣：** 描述文本与 location 定义分离——基础描述在 config.yaml，增强描述在 adapter 代码；每 tick 多一次事件查询

### C. Capability 模型

每个 location 的隐藏段走 `capability:perceive.hidden_details:<location_id>`。执行调查成功后动态授予。跟已实现的 `perceive.mastermind` 机制统一。

**优：** 概念统一；capability 跨 tick 持久
**劣：** 每个 location 一个 capability key（15 个 location × 1 key = 15 个 key）；authority 系统需要支持"action 成功后动态授权"（当前只有静态 `conditions_json`）；对解决当前问题过于重量级

### D. 感知管线接入

location 描述从静态 state 中移出，改为 perception resolver 根据 agent 感知等级 + 调查状态动态生成。

**优：** 统一感知模型；天然支持渐进、多维度
**劣：** 相当于重做空间上下文的组装方式；当前 perception pipeline 只处理 event，不处理静态 location；改动量大

---

## 推荐路径

**A（拆 schema）+ B（adapter 动态注入），分两步：**

### 第一步（立即可做）：拆 schema

每个 `entities.domains` 条目的 `state` 增加 `hidden_details` 字段（可选，缺省为空字符串）。`spatial_proximity` context source 只注入 `public_description`。现有 `description` 字段保留作为 `public_description` 的回退（向后兼容未拆分的 pack）。

**改动范围：**
- `spatial_proximity.ts` — context node 文本组装改为 `state.public_description ?? state.description ?? ''`
- domain entity state 的 namespace 是 `'domain'`（`materializer.ts:130`），非 `'core'`，查询 location state 时须用正确 namespace

**效果：** 包作者可以立即拆分描述。未拆分的 pack 行为不变。snowbound 的所有暗门/隐藏空间信息移到 `hidden_details`，agent 不再自动看到。

### 第二步（后续）：调查感知 adapter

新增 context source adapter（或扩展现有 `spatial_proximity` adapter），查询 agent 在当前地点的 `invoke.investigate` 事件历史。有调查记录 → 注入 `hidden_details`。无记录 → 不注入。

**依赖：** 需要该 agent 的调查事件已生成并持久化（当前 snowbound 已有 `rule-investigate` 规则在调查时生成事件，`semantic_type: 'investigation_conducted'`）。

**查询方式：** 利用现有事件查询 API，按 `impact_data → subject_entity_id = agent_id` + `impact_data → semantic_type = 'investigation_conducted'` + `location_id = 当前位置` 过滤。注意：Event 模型无 `entity_id` 字段，需通过 `impact_data` JSON 中的 `subject_entity_id` 关联 agent（`enforcement_engine.ts:166` 注入）。

---

## 与现有系统的关系

| 系统 | 关系 |
|---|---|
| `spatial_proximity` context source | 第一步修改的目标：组装 location 上下文时不注入 `hidden_details` |
| `invoke.investigate` + `rule-investigate` | 第二步的数据源：调查事件已生成，adapter 只需查询 |
| `perceive.mastermind` capability | 概念参考：C 方案想复用，但粒度不匹配 |
| `pack_world_state_snapshot` visibility | 同类问题：都是"系统注入的 context node 无过滤"。W3 已用 capability 解决，W6 用 adapter 模式解决 |

---

## 已决策（2026-05-13）

1. **渐进发现语义：** 第一步做 0/1 两层。后续可扩展为多级调查深度，届时 `hidden_details` 可升级为分段结构。
2. **`hidden_details` 的结构：** 单段文本。多段可在需要时扩展 schema 为 `hidden_details: string[]` 或 `Record<string, string>`，无需现在处理。
3. **adapter 的实现位置：** 扩展现有 `spatial_proximity` adapter。一个 adapter 承担空间上下文组装是合理的职责内聚。
4. **label 获取路径：** 通过 `listPackWorldEntities` 查询 domain 实体的 label，在 `createSpatialRuntime` 内构建 lazy-loaded `Map<string, string>`。无需修改 `SpatialLocation` contract。
5. **`description` 字段保留策略：** `getLocationState()` 内部回退链 `public_description ?? description`，同时支持已拆分和未拆分的 pack。`description` 不删除。
6. **`content.structured` 同步：** `content.structured` 包含 `current_location`、`current_location_id`、`adjacent_locations`（label 数组）、`adjacent_location_ids`、`public_description`、`hidden_details`、`has_investigated`。
7. **邻接地点显示：** 显示 label。通过 `getLocationState()` 并发查询所有邻接地点获取 label，未找到时回退到 ID。

## 实施偏离

- **Step 2（schema 改动）无需执行：** `entityDefinitionSchema.state` 已是 `z.record(z.string(), worldPackValueSchema).optional()`，自动接受 `public_description` / `hidden_details`
- **Event 查询不使用 `entity_id`：** Event 模型无此列。改为查询全 pack interaction event，解析 `impact_data` JSON 匹配 `semantic_type === 'investigation_conducted'` + `subject_entity_id`
- **Namespace 修正：** domain entity state 的实际 namespace 是 `'domain'`（materializer.ts:130），非 `'core'`
- **前置依赖（rule engine `location_id` 写入缺失）延后：** 不影响当前实施——调查事件已有 `location_id`（由 Event 创建路径的其他环节填入）

---

## 最终实施（2026-05-14）：统一感知层

原方案 D（感知管线接入）被采纳为最终路径，且升级为 **Tier 3 统一感知层**——不拆分不并行，`rules.perception` 成为事件感知 + 环境感知的单一配置来源。

**实施内容：**
- `PerceptionRuleEngine` — 统一规则求值器（`perception/rule_engine.ts`）
- 内置默认规则集 — 等价旧硬编码行为（`perception/default_rules.ts`）
- `rules.perception` schema 类型化 — `perceptionWhenSchema`/`perceptionThenSchema` 替代泛型 `worldRuleDefinitionSchema`
- 事件感知管线（step 6）+ 环境感知（context assembly）共享同一 engine
- `investigationCount` 替代二值 `hasInvestigated`，`Set→Map` 计数，`take:500→tick` 窗口
- `hiddenDetails: string | string[] | null` 支持分段揭示
- `SpatialRuntime` 加 tick 级缓存，adapter 循环加 try-catch
- 插件 `PerceptionResolver` 接口统一为 `resolve(input: PerceptionRuleInput): Promise<PerceptionRuleOutput>`

**原方案对比：**
- A（拆 schema）→ 已纳入：`public_description`/`hidden_details` 继续使用
- B（adapter 动态注入）→ 已纳入：`investigationCount` 驱动渐进揭示
- D（感知管线接入）→ **全量实施为统一感知层**

**不变的部分：**
- `spatial_proximity` context source 仍负责组装空间上下文节点
- 邻接地点仅显示 label
- `description` → `public_description` 回退链保留
- `content.structured` 字段保留并增加 `perception_level`、`matched_rule_id`
