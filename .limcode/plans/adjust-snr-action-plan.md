## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 设计 adjust_snr 的 dispatcher 执行路径与 replay/幂等语义  `#plan-adjust-snr-dispatcher`
- [ ] 定义 adjust_snr 的 payload / target / actor / resolved intent 约束  `#plan-adjust-snr-payload`
- [ ] 设计 adjust_snr 所需的数据模型、审计记录与最小迁移方案  `#plan-adjust-snr-schema`
- [ ] 规划 adjust_snr 的专项测试与文档同步  `#plan-adjust-snr-tests-docs`
<!-- LIMCODE_TODO_LIST_END -->

# adjust_snr 动作实现方案（Action Dispatcher 下一类 constrained mutation）

## 1. 为什么现在优先做 `adjust_snr`

基于当前代码状态，`adjust_snr` 是比 `set_world_variable` 更合适的下一步：

- 当前 Prisma `Agent` 模型已经有 `snr: Float` 字段。
- `apps/server/src/dynamics/manager.ts` 已经具备 `ValueDynamicsManager.applyChange(...)` 以及 clamp 到 `[0,1]` 的逻辑。
- `apps/server/src/core/simulation.ts#getGraphData()` 已经把 `Agent.snr` 暴露到关系图节点渲染数据里，意味着一旦后端更新 `Agent.snr`，前端未来接实时图数据时天然可见。
- 它是一个典型的 world mutation action，很适合作为 **Resolved Intent 模式** 的第一块正式试验田。

相较之下，`set_world_variable` 虽然也好做，但更像全局配置写入，不如 `adjust_snr` 能直接验证：

- mutation semantics
- auditability
- replay stability
- graph-visible world effect

---

## 2. 当前代码里能直接复用的基础

### 2.1 Agent 模型已有 `snr`
`apps/server/prisma/schema.prisma`

```prisma
model Agent {
  ...
  snr       Float   @default(0.5)
  is_pinned Boolean @default(false)
  ...
}
```

### 2.2 图谱读取已经暴露 `snr`
`apps/server/src/core/simulation.ts`

```ts
snr: a.snr
```

这意味着 `adjust_snr` 不需要先改前端协议，就已经能影响图谱节点数据。

### 2.3 dynamics manager 已有现成值更新逻辑
`apps/server/src/dynamics/manager.ts`

```ts
applyChange(nodeId, rawDelta, reason, currentTick)
```

并且它已经：

- 支持 pin 拦截贬值
- 支持算法映射
- clamp 到 `[0,1]`

### 2.4 当前还没有正式持久化的 SNR 审计记录
也就是说，`adjust_snr` 如果现在直接写 `Agent.snr`，还没有像 `RelationshipAdjustmentLog` 那样的最小审计闭环。

因此这次实现建议顺手补一个 **SNRAdjustmentLog**。

---

## 3. MVP 目标

## 3.1 第一版 `adjust_snr` 的目标

- 新增 `intent_type = adjust_snr`
- actor 必须是 **active agent**
- target 只支持：
  - `target_ref.agent_id`
- 第一版只支持：
  - `operation = set`
  - `target_snr`
- `target_snr` clamp 到 `[0,1]`
- 写入时直接更新 `Agent.snr`
- 同时写入 `SNRAdjustmentLog`
- replay 为真实 world-side replay，但因为第一版是 `set`，所以不会漂移

## 3.2 第一版明确不实现的内容

- `delta`
- world-pack 驱动的 algorithm selection
- 对 atmosphere actor / atmosphere node 的 SNR 调整
- 自动联动 narrative / event / relationship
- 统一 mutation framework

---

## 4. Resolved Intent 模式：第一块正式试验田

你已经明确：

> 面对 delta 引入后的漂移风险，先使用一种 Resolved Intent 模式：每一笔变更，同时记录 意图、基线、结果，且结果是绝对值。

我认为 `adjust_snr` 非常适合把这件事正式做起来。

## 4.1 第一版建议语义

虽然第一版只支持 `set`，仍然建议日志和审计字段按 Resolved Intent 的思路设计：

- **intent**：请求要把 SNR 设成多少
- **baseline**：执行前实际 SNR 是多少
- **result**：最终写入后的绝对 SNR 是多少

这样以后即使引入：

- `delta`
- pin / policy rewrite
- algorithm transform

也不需要重新设计审计模型。

---

## 5. 数据模型设计

## 5.1 新增 `SNRAdjustmentLog`

建议在 Prisma 中新增：

```prisma
model SNRAdjustmentLog {
  id               String       @id @default(uuid())
  action_intent_id String
  agent_id         String
  operation        String
  requested_value  Float
  baseline_value   Float
  resolved_value   Float
  reason           String?
  created_at       BigInt

  action_intent    ActionIntent @relation(fields: [action_intent_id], references: [id])
  agent            Agent        @relation(fields: [agent_id], references: [id])

  @@index([action_intent_id, created_at])
  @@index([agent_id, created_at])
}
```

## 5.2 为什么不直接复用 `ValueDynamicsManager` 的结果对象作为日志

因为当前 `ValueUpdateResult` 是内存返回值，不是持久化审计对象。

而且它记录的是：

- `old_snr`
- `new_snr`
- `delta`
- `reason`

它不显式区分：

- requested absolute value
- baseline
- resolved final absolute value

所以如果你要正式实践 Resolved Intent，最好单独落一个 `SNRAdjustmentLog`。

---

## 6. ActionIntent 契约设计

## 6.1 `intent_type`

新增：

```ts
intent_type = 'adjust_snr'
```

## 6.2 target_ref

第一版只支持：

```json
{
  "agent_id": "agent-002"
}
```

不支持：

- atmosphere node
- self/多 target
- 泛化 selector

### 是否允许 target=self？
建议：

- **允许**

原因：
- `adjust_snr` 很多情况下就是 actor 自身的状态变化
- 和 `adjust_relationship` 不同，自调本身并不奇怪

---

## 6.3 payload 结构

建议第一版 payload：

```json
{
  "operation": "set",
  "target_snr": 0.72,
  "reason": "manual calibration"
}
```

### 字段说明

- `operation`
  - 第一版只允许 `set`
- `target_snr`
  - number
  - 最终 clamp 到 `[0,1]`
- `reason`
  - 可选 string

---

## 7. actor 规则

第一版建议：

- **只允许 active actor**
- 不允许 system actor
- 不允许 atmosphere actor

原因：
- `trigger_event` 可以放宽到 system，因为它是 append-only 记录动作
- `adjust_snr` 是直接改节点值，更接近实体世界状态
- 所以应比 `trigger_event` 更严格

---

## 8. dispatcher 实现建议

目标文件：

- `apps/server/src/app/services/action_dispatcher.ts`

## 8.1 新增 `dispatchAdjustSnrIntent(...)`

建议新增独立内部函数，职责如下：

1. 校验 ActionIntent 锁归属
2. 解析 actor（active only）
3. 解析 target_ref.agent_id
4. 校验 payload
5. 查询 target agent
6. 读取 baseline SNR
7. clamp 目标值
8. 更新 `Agent.snr`
9. 写 `SNRAdjustmentLog`
10. 返回 `{ outcome: 'completed' }`

---

## 8.2 是否直接用 `prisma.agent.update`，还是接 `ValueDynamicsManager`

### 我建议第一版：

> **直接使用 `prisma.agent.update` 写绝对值。**

### 原因

- 你当前明确只做 `set`
- 直接写绝对值最贴近当前语义
- replay 语义稳定
- 不会把 `ValueDynamicsManager.applyChange(delta)` 硬拧成 set 语义

### `ValueDynamicsManager` 何时适合接入？
等以后你要做：

- `delta`
- algorithm-based transformations
- pin + algorithm + clamp 的正式业务路径

那时再把 `adjust_snr` 与 dynamics manager 深耦合更合理。

所以第一版建议：

- `adjust_snr(set)` 先走直接写库
- dynamics manager 以后再接 `delta` 版

---

## 9. payload 校验建议

建议新增：

```ts
resolveAdjustSnrPayload(payload)
```

返回结构：

```ts
{
  operation: 'set';
  target_snr: number;
  reason: string | null;
}
```

校验规则：

- payload 必须是 object
- `operation` 必须是 `set`
- `target_snr` 必须是 finite number
- 最终统一 clamp `[0,1]`

---

## 10. 错误语义建议

建议内部细分：

- `ACTION_SNR_INVALID`
  - payload 非法 / actor 非法 / target 非法
- `SNR_TARGET_NOT_FOUND`
  - 目标 agent 不存在

如果你不想对外加新错误码，也可以先统一落入：

- `ACTION_DISPATCH_FAIL`

但我建议内部至少明确区分，方便以后做统一 audit view。

---

## 11. Replay 语义

你已经决定：

- replay 是真实 world-side replay

所以这里第一版只要继续保持：

- **`set` only**

就没有漂移问题。

### 具体语义

- baseline 可能变化
- replay 重新执行时会再次把 target 设到同一个绝对值
- `resolved_value` 仍是绝对值

因此：
- replay 不会累计失真
- 但 audit log 会显示多次执行记录

这正是你想要的结果。

---

## 12. 审计模型设计

## 12.1 为什么 `SNRAdjustmentLog` 很有必要

如果只改 `Agent.snr`，你未来会失去：

- 谁改了它
- 当时基线是多少
- 是用户动作、replay、还是后续自动动作

而你现在又明确说：

- 将来要统一审计视图
- 要上 Resolved Intent 模式

所以 `SNRAdjustmentLog` 这次应该一起做，不要拖。

## 12.2 推荐日志内容

最小字段：

- `action_intent_id`
- `agent_id`
- `operation`
- `requested_value`
- `baseline_value`
- `resolved_value`
- `reason`
- `created_at`

这已经足够支撑：
- replay
- compare
- unified audit view

---

## 13. 测试方案

建议新增：

- `apps/server/src/e2e/adjust_snr.ts`

## 13.1 必测场景

### 场景 1：更新指定 agent 的 snr
- 预置 `agent-002.snr = 0.5`
- 派发 `adjust_snr(set -> 0.8)`
- 验证：
  - `Agent.snr = 0.8`
  - workflow completed
  - `SNRAdjustmentLog` 写入
  - baseline=0.5, resolved=0.8

### 场景 2：clamp 到 1
- `target_snr = 99`
- 验证最终值为 `1`

### 场景 3：clamp 到 0
- `target_snr = -5`
- 验证最终值为 `0`

### 场景 4：system actor 拒绝
- system identity 派发 `adjust_snr`
- 验证 dispatch fail

### 场景 5：非法 payload
- 无 `target_snr`
- 非 number
- operation ≠ set
- 验证 dispatch fail

### 场景 6：replay 不漂移
- 先执行一次 `set -> 0.6`
- replay
- 验证最终值仍是 `0.6`
- 但日志新增一条记录

---

## 14. 文档同步

需要同步：

- `API.md`
- `ARCH.md`
- `LOGIC.md`
- `TODO.md`

建议文档中明确：

- `adjust_snr` 是下一类 constrained world mutation
- 第一版是 `set` only
- replay 为真实重放，但因使用绝对值不漂移
- `SNRAdjustmentLog` 用于最小审计

---

## 15. 涉及文件清单

### 数据层
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/<new_migration>/migration.sql`

### dispatcher / service
- `apps/server/src/app/services/action_dispatcher.ts`

### 可能涉及
- `apps/server/src/inference/providers/mock.ts`
- `apps/server/src/core/simulation.ts`（如果你想增加调试读取）

### 测试
- `apps/server/src/e2e/adjust_snr.ts`
- `apps/server/package.json`

### 文档
- `API.md`
- `ARCH.md`
- `LOGIC.md`
- `TODO.md`

---

## 16. 实施顺序建议

### Step 1
先补 `SNRAdjustmentLog`

### Step 2
在 dispatcher 中新增 `adjust_snr`

### Step 3
mock provider 支持 `adjust_snr`

### Step 4
补专项测试

### Step 5
同步文档

---

## 17. 验收标准

完成本批次后，应满足：

1. `adjust_snr` 能通过 dispatcher 正常执行
2. 第一版仅支持 `operation = set`
3. `target_snr` clamp 到 `[0,1]`
4. actor 只允许 active agent
5. replay 为真实 world-side replay，但不漂移
6. `SNRAdjustmentLog` 正确记录：
   - requested
   - baseline
   - resolved
7. 专项测试 / lint / typecheck 全通过

---

## 18. 最终建议

`adjust_snr` 应当被实现为：

> **一个基于绝对值写入、带最小审计记录、可 replay 但不漂移的节点状态 mutation action。**

它会是你提出的 **Resolved Intent 模式** 第一块最自然、最值得做的试验田。
