# 位置描述感知门控 — 实施计划

> 来源: `.limcode/design/location-perception-gating.md`
> 关联: `.limcode/design/spatial-semantics-design.md` §4.5
> 创建: 2026-05-13
> 实施: 2026-05-13 — 已完成
> 背景: 项目未上线，无向后兼容负担

---

## 目标

agent 进入一个地点后：
- 始终看到 `public_description`（房间外观、氛围等公开信息）
- 仅在对该地点执行过 `invoke.investigate` 后，才看到 `hidden_details`（暗门、隐藏线索等）

同时修复 `spatial_proximity` 上下文源**从未注入任何 location 描述文本**的缺失。

---

## 当前状态

`spatial_proximity.ts` 当前输出：

```
你当前在: storage
邻接地点: kitchen, laundry
```

**不包含任何描述文本。** `config.yaml` 中 location 的 `state.description` 从未进入 prompt。这意味着 agent 不知道所处房间长什么样——这本身就是一个 bug。

---

## 实施步骤

### Step 1 — 拆分 snowbound location 描述

**文件：** `data/world_packs/snowbound_mansion/config.yaml`
**位置：** `entities.domains` 段，每个 location 的 `state`

对全部 15 个 location 执行拆分。`description` 中公开可见的内容保留为 `public_description`，隐藏线索移入 `hidden_details`。

**示例（`storage`）：**

```yaml
# 改前
- id: storage
  state:
    description: "阴暗潮湿的房间，堆满了杂物、备用发电机和工具箱。角落里有一扇通向地下室的暗门。"
    tags: [indoor, hidden, ground_floor]

# 改后
- id: storage
  state:
    public_description: "阴暗潮湿的房间，堆满了杂物、备用发电机和工具箱。"
    hidden_details: "角落里有一扇通向地下室的暗门。铰链最近被上过油，有人近期使用过。"
    tags: [indoor, hidden, ground_floor]
```

需要拆分的 location（含隐藏信息或潜在隐藏信息）：

| location | 隐藏线索 |
|---|---|
| `storage` | 通向地下室的暗门 |
| `attic` | 蒙尘的箱子（可能含线索） |
| `library` | 泛黄的报纸（可能含线索） |
| `kitchen` | 剁骨刀（武器线索） |
| `laundry` | 漂白剂味道（可能含线索） |

其余 10 个 location 没有明显隐藏信息，可将整个 `description` 复制为 `public_description`，`hidden_details` 留空或不定义。

---

### Step 2 — Constitution schema 添加 `hidden_details` 字段

**文件：** `apps/server/src/packs/schema/constitution_schema.ts`

Location entity state 的 schema 需要接受 `hidden_details` 字段。找到 location/domain entity 的 state schema 定义，确保 `public_description` 和 `hidden_details` 均为可选字符串（缺省回退到 `description`）。

```typescript
// 在 entity state 的 schema 中（或 location domain schema）
state: z.object({
  description: z.string().optional(),
  public_description: z.string().optional(),
  hidden_details: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // ... 其他已有字段
}).passthrough()
```

`passthrough()` 保证已有字段不被 `.strict()` 拦截。

---

### Step 3 — `SpatialRuntime` 新增 `getLocationState()`

**文件：** `apps/server/src/packs/runtime/spatial_runtime.ts`

`SpatialRuntime` 已有 `storageAdapter` 和 `packId`，可以查询 entity state。

```typescript
// 新增接口方法
export interface LocationState {
  label: string;
  publicDescription: string | null;
  hiddenDetails: string | null;
  tags: string[];
}

export interface SpatialRuntime {
  // ... 已有方法
  getLocationState(locationId: string): Promise<LocationState | null>;
}
```

实现逻辑：
1. 用 `listPackEntityStates(storageAdapter, packId)` 获取 pack 的全部 entity state
2. 过滤 `entity_id === locationId && state_namespace === 'core'`
3. 从 `state_json` 中提取 `public_description`（回退 `description`）、`hidden_details`、`tags`
4. 从 entity 定义（`entities.domains`）获取 `label`

注意：SpatialRuntime 当前只有 `SpatialDiscreteConfig`（含 `locations: [{id, label}]`），label 可以从这里取。描述文本从 entity state 取。

---

### Step 4 — `ContextSourceAdapterInput` 新增 `investigated_location_ids`

**文件：** `apps/server/src/context/source_registry.ts`

```typescript
export interface ContextSourceAdapterInput {
  // ... 已有字段
  /** agent 已调查过的 location_id 列表，由 context service 预计算 */
  investigated_location_ids?: string[];
}
```

---

### Step 5 — Context service 预计算调查历史

**文件：** `apps/server/src/context/service.ts`

在 `buildContextRun()` 中，调用 `buildContextNodesFromSources()` 之前：

```typescript
// 查询当前 agent 的调查事件历史，提取已调查的 location_id 集合
const investigationEvents = await context.prisma.event.findMany({
  where: {
    entity_id: input.resolved_agent_id,
    location_id: { not: null }
  },
  select: {
    id: true,
    location_id: true,
    impact_data: true
  },
  orderBy: { created_at: 'desc' }
});

const investigatedLocationIds = investigationEvents
  .filter(e => {
    if (!e.impact_data) return false;
    try {
      const parsed = JSON.parse(e.impact_data);
      return parsed?.semantic_type === 'investigation_conducted';
    } catch {
      return false;
    }
  })
  .map(e => e.location_id)
  .filter((id): id is string => id !== null);

// 去重
const uniqueInvestigatedLocationIds = [...new Set(investigatedLocationIds)];
```

传入 `buildContextNodesFromSources`：
```typescript
const built = await buildContextNodesFromSources(adapters, {
  // ... 已有参数
  investigated_location_ids: uniqueInvestigatedLocationIds
});
```

---

### Step 6 — `spatial_proximity.ts` 注入描述 + 调查门控

**文件：** `apps/server/src/context/sources/spatial_proximity.ts`

修改 `buildSpatialProximityContextNodes` 输入类型和渲染逻辑：

```typescript
export const buildSpatialProximityContextNodes = async (input: {
  entityId: string;
  spatialRuntime: SpatialRuntime;
  tick: string;
  investigatedLocationIds?: string[];
}): Promise<ContextNode[]> => {
  const { entityId, spatialRuntime, tick, investigatedLocationIds } = input;

  const location = await spatialRuntime.getLocation(entityId);
  if (!location) return [];

  const locationState = await spatialRuntime.getLocationState(location);
  const neighbors = spatialRuntime.neighbors(location);
  const hasInvestigated = investigatedLocationIds?.includes(location) ?? false;

  const lines: string[] = [];

  // 地点名称
  const label = locationState?.label ?? location;
  lines.push(`你当前在: ${label}`);

  // 公开描述（始终可见）
  const publicDesc = locationState?.publicDescription ?? '';
  if (publicDesc) {
    lines.push(publicDesc);
  }

  // 隐藏细节（仅调查后可见）
  if (hasInvestigated) {
    const hiddenDetails = locationState?.hiddenDetails;
    if (hiddenDetails) {
      lines.push(`[调查发现] ${hiddenDetails}`);
    }
  }

  if (neighbors.length > 0) {
    lines.push(`邻接地点: ${neighbors.join(', ')}`);
  }

  // ... 后续 ContextNode 构建不变
};
```

**关键点：** `getLocationState()` 内部已处理 `public_description` → `description` 的回退，此处不重复回退逻辑。

---

### Step 7 — `source_registry.ts` adapter 透传 `investigated_location_ids`

**文件：** `apps/server/src/context/source_registry.ts`

`createSpatialProximitySourceAdapter` 中调用 `buildSpatialProximityContextNodes` 时传入新参数：

```typescript
return buildSpatialProximityContextNodes({
  entityId,
  spatialRuntime,
  tick: input.tick.toString(),
  investigatedLocationIds: input.investigated_location_ids
});
```

---

### Step 8 — 验证

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm --filter yidhras-server test:integration
```

手动验证（启动 dev server）：
```bash
pnpm prepare:runtime --reset-db
pnpm dev:server &
# 检查 agent 的 spatial_proximity context node 是否包含 location 描述
pnpm --filter yidhras-server sim:dump snowbound-mansion --type agent
# 预期：初次进入 storage 的 agent 看到 public_description 但看不到暗门
# 调查后再次进入 → 看到 [调查发现] hidden_details
```

---

## 文件变更清单

| 文件 | 操作 | 变更内容 |
|---|---|---|
| `data/world_packs/snowbound_mansion/config.yaml` | 修改 | 15 个 location 拆分 `description` → `public_description` + `hidden_details` |
| `apps/server/src/packs/schema/constitution_schema.ts` | 修改 | location entity state schema 支持 `public_description` / `hidden_details` |
| `apps/server/src/packs/runtime/spatial_runtime.ts` | 修改 | 新增 `getLocationState()` 方法 + `LocationState` 接口 |
| `apps/server/src/context/source_registry.ts` | 修改 | `ContextSourceAdapterInput` 新增 `investigated_location_ids`；adapter 透传 |
| `apps/server/src/context/service.ts` | 修改 | 查询调查事件历史，计算 `investigatedLocationIds` |
| `apps/server/src/context/sources/spatial_proximity.ts` | 修改 | 注入 `public_description` + 调查门控 `hidden_details` |

---

## 不变的部分

- `PerceptionResolver` 接口 — 不改动。Plan D 的环境感知通过 context source adapter 实现，不走事件感知管线
- `perception_pipeline.ts` — 不改动。继续只处理事件感知
- `SpatialRuntime.neighbors()` / `distance()` / `moveEntity()` — 不改动

---

## 与 spatial-semantics-design.md 的关系

该文档 §4.5 已更新为：

> 当前地点公开描述：`location.public_description`（始终可见）。若未定义则回退到 `location.description`
> 当前地点隐藏细节：`location.hidden_details`，仅在 agent 已对该地点执行过 `invoke.investigate` 时注入

Plan D 是 spatial design 的自然延伸——将 perception 概念从事件扩展到静态环境，但实现上保持两条独立路径（事件走 perception pipeline step 6，环境走 context source adapter）。
