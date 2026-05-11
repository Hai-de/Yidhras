# State Transform 预计算设计

## 问题

包作者需要在模板中使用复杂的条件表达式，但叙事模板引擎仅支持插值、`default()`、`#if` 和 `#each`。没有原生的区间映射能力（如"若 public_opinion 在 31-70 之间，标记为 medium"）。

这迫使包作者在模板中写深度嵌套的 `{{#if}}` 链，脆弱、难维护、错误信息不透明。

## 与宏引擎 / Objective Engine 的关系

项目已实现宏引擎（`template_engine/`），它在**物化期**将 `{{roll count=2 sides=6}}` 展开为确定值写入 `state_json`。宏仅在 bootstrap 时运行一次，不参与运行时状态计算。

`state_transforms` 解决的是**运行期**问题：每个 tick 根据 actor 当前状态值推导派生标签。两者生命周期不同，不可互相替代。

与 objective enforcement 引擎的关系：`state_transforms` 本质是一种简化的、声明式的批量规则——"对所有 actor，当 source 值在 [min, max] 区间时，设 target 为 label"。用通用 objective rule 表达同样逻辑会过于冗长（需要逐区间写规则），且逐 actor 遍历的批量求值用通用引擎性能差。`state_transforms` 应作为独立的轻量通道存在，不并入 rule 引擎。

## 方案：`state_transforms` 声明

在 world-pack 顶层 constitution 中新增 `state_transforms` 字段，声明从数值型 source state key 到标签型 target state key 的区间映射。

### Schema 定义

```yaml
state_transforms:
  - source: public_opinion        # 源 state key（数值型），位于 actor state_json
    ranges:
      - min: 0
        max: 30
        label: "low"
      - min: 31
        max: 70
        label: "medium"
      - min: 71
        max: 100
        label: "high"
    target: public_opinion_stage   # 目标 state key，写入同一 actor 的 state_json
```

### Zod Schema

```typescript
const stateTransformRangeSchema = z.object({
  min: z.number(),
  max: z.number(),
  label: nonEmptyStringSchema
}).strict();

const stateTransformSchema = z.object({
  source: nonEmptyStringSchema,
  ranges: z.array(stateTransformRangeSchema),
  target: nonEmptyStringSchema
}).strict().superRefine((value, ctx) => {
  // 校验 min <= max、label 唯一性
});
```

### 设计决策

- **包级声明，逐 actor 求值**：transform 在包级别定义，每个 tick 对所有 actor 应用。同一条规则跨 actor 复用。
- **source / target 语义**：`source` 是当前 actor `state_json` 中的 key（namespace `core`），`target` 是写入同一 actor `state_json` 的 key。actor 必须持有 source 值；派生标签与源值共处同一 state_json。
- **仅处理数值型 source**：source 值不是 number 时跳过，记录 debug 日志。
- **无匹配区间**：source 值落在所有区间之外（含区间间隙）时，target key 保持不变，记录 warning。
- **重复 target 视为 schema 错误**：pack constitution 校验拒绝同 target 的重复 transform。
- **`upsert_entity_state` 语义**：delta 操作替换整个 `state_json`。实现需读取当前 actor state、展开、覆盖 target key、写回合并后的对象。

### 求值引擎（per-tick，Rust 侧）

求值在 world engine sidecar 的 step prepare 阶段执行，而非 TS 侧。理由：

1. objective enforcement 已在 Rust 侧执行规则匹配，区间映射是同类的计算密集型任务
2. 利用 world engine 的 `(packId, tick)` 缓存实现幂等，多 worker 重复调用不会导致双重变更
3. 避免 TS 侧逐 actor 读取 state 的 IO 开销

执行流程：

1. Step prepare 时加载 pack 的 `state_transform` 实体（`entity_kind = 'state_transform'`）
2. 枚举所有 actor 实体，读取当前 `state_json`
3. 对每个 transform × actor：读 `state_json[transform.source]`，匹配区间，写 `state_json[transform.target] = range.label`
4. 变更合并到 step delta 的 `upsert_entity_state` 操作中
5. 随 step commit 持久化

### 物化

`materializePackRuntimeCoreModels` 期间，每个 `state_transform` 存储为 `PackWorldEntity`：

- `entity_kind`: `'state_transform'`
- `entity_id`: `target` 字段值
- `payload`: 完整 transform 定义（source, ranges, target）
- 不创建 entity state —— transform 是定义，不是状态

### 模板使用

求值后，包作者使用标准插值——无需模板引擎改动：

```
{{actor_state.public_opinion_stage}}
```

`resolvePackVariables` 中的 `actor_state` namespace layer 已读取 actor 的 `state_json` keys，求值引擎写入的任何 target key 自动可用。

### 校验规则

1. `ranges[].min` 必须 <= `ranges[].max`
2. `ranges[].label` 在同一 transform 内必须唯一
3. `source` 和 `target` 必须是非空字符串
4. 跨 transform 的重复 `target` 在 schema 层拒绝
5. source 值必须为数值型——非数值跳过并记录 debug 日志
6. 无匹配区间跳过并记录 warning（覆盖区间间隙和越界）
7. transform 是声明式的——无运行时表达式求值

### 实现状态

- [x] Schema 定义与校验（min <= max、label 唯一）
- [x] Zod 类型导出（`WorldPackStateTransform`）
- [x] 物化：存储为 `PackWorldEntity`，`entity_kind = 'state_transform'`
- [x] 物化结果中的摘要计数（`state_transform_count`）
- [x] 跨 transform 的重复 `target` 校验
- [ ] 求值引擎：Rust sidecar step prepare 阶段的 per-tick 求值
- [x] 模板变量解析：`{{actor_state.<target>}}` 通过现有插值解析（无需引擎改动）
