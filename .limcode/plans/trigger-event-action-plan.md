## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 设计 trigger_event 的 dispatcher 执行路径、错误语义与 replay 语义  `#plan-trigger-event-dispatcher`
- [ ] 设计 Event/source_action_intent_id 等数据模型与迁移方案  `#plan-trigger-event-schema`
- [ ] 整理 trigger_event MVP 的边界与默认约束  `#plan-trigger-event-scope`
- [ ] 规划 trigger_event 的专项测试与文档同步  `#plan-trigger-event-tests-docs`
<!-- LIMCODE_TODO_LIST_END -->

# trigger_event 动作实现方案（Action Dispatcher 第三类 world action）

## 1. 已对齐的 MVP 决策

根据当前讨论，`trigger_event` 第一版已经有了足够清晰的边界：

1. **第一版只写记录，不带副作用**
2. **`Event.type` 第一版只允许白名单三种：`history | interaction | system`**
3. **payload 采用结构化设计**
4. **是否产生 `trigger_event` 由上游 inference 直接生成，不由其它动作隐式派生**
5. **允许 `system` actor**
6. **第一版不允许自定义 tick，统一使用当前 dispatch tick**
7. **replay 会再次写入一条 event**
8. **这条动作有实际价值，值得做**

这意味着我们现在不需要再讨论“要不要做”，而应该直接把它收敛成一个 append-only 的正式 world action。

---

## 2. 本方案的总体定位

`trigger_event` 第一版的定位非常明确：

> **它是一个叙事记录型 world action，而不是世界联动入口。**

也就是说，第一版只负责：

- 落一条 `Event`
- 结构化记录事件语义
- 保证 replay / audit / workflow 可追溯

它**不负责**：

- 自动修改关系
- 自动修改 SNR
- 自动派生别的 `ActionIntent`
- 自动通知前端/系统模块

这让它和 `adjust_relationship` 形成良好互补：

- `post_message`: L1 append-only 内容输出
- `adjust_relationship`: L2 状态覆盖型修改
- `trigger_event`: L3 append-only 叙事事件输出

---

## 3. MVP 范围定义

## 3.1 第一版要实现的范围

- 新增 `intent_type = trigger_event`
- payload 使用结构化 schema
- `Event.type` 仅允许：
  - `history`
  - `interaction`
  - `system`
- dispatch 时写入 `Event`
- `tick` 一律取当前 dispatch tick
- replay 重新写一条 event
- event 能追溯到触发它的 `ActionIntent`

## 3.2 第一版明确不实现的内容

- 事件触发 SNR / Relationship / Variable 联动
- 事件驱动其它 action 自动派生
- 自定义/历史/未来 tick 注入
- world-pack 驱动的 event schema
- atmosphere actor 事件生成
- 事件比较/聚合分析视图

---

## 4. 数据模型设计

目标文件：`apps/server/prisma/schema.prisma`

当前 `Event` 模型：

```prisma
model Event {
  id          String   @id @default(uuid())
  title       String
  description String
  tick        BigInt
  type        String
  impact_data String?
}
```

## 4.1 第一版建议改造

建议扩展为：

```prisma
model Event {
  id                     String   @id @default(uuid())
  title                  String
  description            String
  tick                   BigInt
  type                   String
  impact_data            String?
  source_action_intent_id String?
  created_at             BigInt

  source_action_intent   ActionIntent? @relation(fields: [source_action_intent_id], references: [id])

  @@index([tick])
  @@index([type, tick])
  @@index([source_action_intent_id, tick])
}
```

## 4.2 为什么要加 `source_action_intent_id`

这是第一版里最值得补的字段，原因如下：

- replay 时会再次写 event
- 如果没有这个字段，无法区分：
  - 普通流程写出的 event
  - replay 重放写出的 event
- workflow / audit / debug 也无法从结果对象回溯到 action

所以我建议这次一并补上，而不是等将来返工。

## 4.3 是否要加 `updated_at`

第一版可以**不加**。

原因：

- `Event` 目前是 append-only
- 不做更新型语义
- `created_at` 足够表达记录创建时间

因此第一版建议：

- 加 `created_at`
- 不加 `updated_at`

---

## 5. ActionIntent 契约设计

## 5.1 `intent_type`

新增：

```ts
intent_type = 'trigger_event'
```

## 5.2 target_ref

第一版建议：

- **不强制 target_ref**
- 可为 `null`

因为事件是叙事记录型动作，不一定总有单一 target。

如果需要表达 source/target，建议通过 `impact_data` 承载，而不是强制 target_ref 成为必要字段。

---

## 5.3 payload 结构

建议第一版 payload 为：

```json
{
  "event_type": "interaction",
  "title": "Agent-001 与 Agent-002 发生公开冲突",
  "description": "双方在底座区发生争执，周围节点开始围观。",
  "impact_data": {
    "source_agent_id": "agent-001",
    "target_agent_id": "agent-002",
    "reason": "public_disagreement"
  }
}
```

### 字段说明

- `event_type`
  - 必填
  - 仅允许：`history | interaction | system`
- `title`
  - 必填非空字符串
- `description`
  - 必填非空字符串
- `impact_data`
  - 可选 object
  - 最终写入数据库时转为 JSON string

---

## 6. actor 规则

这是 `trigger_event` 和 `adjust_relationship` 最大的差异之一。

## 6.1 第一版允许的 actor

- **active actor**
- **system identity**

## 6.2 第一版暂不允许

- atmosphere actor
- 没有 identity 的匿名 actor

## 6.3 system actor 的实现建议

你已经明确允许 `system actor`。这里建议采用最小实现：

> 不扩全局 actor role 枚举，只在 `trigger_event` dispatcher 里特判 `identity_id === "system"`。

这样不会引入更大范围的 role 模型改造。

---

## 7. tick 规则

## 7.1 第一版固定规则

`Event.tick = current dispatch tick`

### 不允许：
- payload 指定历史 tick
- payload 指定未来 tick
- 手工 backfill

## 7.2 原因

这样可以避免：

- timeline 顺序歧义
- replay 时 tick 重算争议
- “插入过去事件”导致 narrative timeline 异常

---

## 8. dispatcher 实现方式

目标文件：

- `apps/server/src/app/services/action_dispatcher.ts`

## 8.1 dispatcher 分发结构

当前 dispatcher 已支持：

- `post_message`
- `adjust_relationship`

建议继续沿用同样结构：

```ts
switch (intent.intent_type) {
  case 'post_message':
    ...
  case 'adjust_relationship':
    ...
  case 'trigger_event':
    ...
  default:
    throw ...
}
```

## 8.2 新增 `dispatchTriggerEventIntent(...)`

建议新增内部函数，职责：

1. 校验 ActionIntent 锁归属
2. 解析 actor：
   - active agent 或 system identity
3. 校验 payload
4. 规范化 `impact_data`
5. 写入 `Event`
6. 返回 `{ outcome: 'completed' }`

---

## 9. payload 校验建议

建议新增一组校验函数：

### `resolveTriggerEventPayload(...)`

返回结构可为：

```ts
{
  event_type: 'history' | 'interaction' | 'system';
  title: string;
  description: string;
  impact_data: Record<string, unknown> | null;
}
```

### 校验规则

- `event_type` 必须在白名单中
- `title` 必须为非空字符串
- `description` 必须为非空字符串
- `impact_data` 如存在，必须为 object

---

## 10. 错误语义建议

建议新增/细分内部错误码：

- `ACTION_EVENT_INVALID`
  - payload 非法
- `EVENT_TYPE_UNSUPPORTED`
  - event_type 不在白名单中
- `ACTION_EVENT_ACTOR_INVALID`
  - actor 不符合 active/system 约束

如果你暂时不想扩太多错误码，也可以统一纳入：

- `ACTION_DISPATCH_FAIL`

但我建议内部尽量细分，便于后续审计。

---

## 11. replay 语义

## 11.1 当前规则

你已经明确：

> replay 会再写一条 event

这意味着第一版 trigger_event 应当视为：

- **append-only 且 replay 可重放**

## 11.2 为什么这在第一版是合理的

因为当前 `trigger_event` 没有副作用，只是写记录。

所以 replay 再写一条 event，虽然会多一条记录，但：

- 不会改世界状态
- 不会引入数值漂移
- 可通过 `source_action_intent_id` 追溯来源

这是可接受的。

---

## 12. 测试方案

建议新增：

- `apps/server/src/e2e/trigger_event.ts`

## 12.1 必测场景

### 场景 1：active actor 触发 interaction event
- 提交 job
- dispatcher 生成 `Event`
- 验证：
  - title/description/type/tick 正确
  - `source_action_intent_id` 存在

### 场景 2：system actor 触发 system event
- 使用 system identity
- 提交 replay/job path
- 验证 event 可落地

### 场景 3：非法 event_type 拒绝
- 提交 `event_type = narrative_custom`
- 验证 dispatch fail

### 场景 4：非法 payload 拒绝
- 空 title / 空 description / impact_data 非 object
- 验证 dispatch fail

### 场景 5：不允许自定义 tick
- 即使 payload 里塞 tick，也应忽略或报错（建议报错更稳）

### 场景 6：replay 再写一条 event
- replay 同一 source job
- timeline 中新增一条 event
- 两条 event 可通过 `source_action_intent_id` 区分来源链路

---

## 13. 文档同步

需要同步：

- `API.md`
- `ARCH.md`
- `LOGIC.md`
- `TODO.md`

### 文档中应明确：

- `trigger_event` 第一版是 append-only 记录动作
- 不自动带副作用
- `Event.type` 只支持 `history | interaction | system`
- replay 会再写一条 event
- event 可通过 `source_action_intent_id` 追溯

---

## 14. 涉及文件清单

### 数据层
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/<new_migration>/migration.sql`

### dispatcher / service
- `apps/server/src/app/services/action_dispatcher.ts`
- 可能涉及 `apps/server/src/inference/providers/mock.ts`

### 测试
- `apps/server/src/e2e/trigger_event.ts`
- `apps/server/package.json`

### 文档
- `API.md`
- `ARCH.md`
- `LOGIC.md`
- `TODO.md`

---

## 15. 实施顺序建议

### Step 1
先改 Event schema：

- `source_action_intent_id`
- `created_at`
- 索引

### Step 2
在 dispatcher 中增加 `trigger_event` 路径

### Step 3
补 payload / actor / tick 校验

### Step 4
补 replay 场景测试

### Step 5
同步文档

---

## 16. 验收标准

完成本批次后，应满足：

1. `trigger_event` 能通过 dispatcher 正常落一条 `Event`
2. 第一版不带副作用
3. `Event.type` 严格限制为 `history | interaction | system`
4. `tick` 一律取当前 dispatch tick
5. active actor 与 system actor 都能按规则工作
6. replay 会再写一条 event
7. event 能通过 `source_action_intent_id` 回溯来源
8. 专项测试 / lint / typecheck 全通过

---

## 17. 最终建议

这版 `trigger_event` 最适合被实现为：

> **一个 append-only、结构化、可 replay、可追溯但不带副作用的叙事记录动作。**

这是在当前 Yidhras 基线下最稳、最清晰、最不容易返工的做法。
