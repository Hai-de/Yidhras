## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 定义 adjust_relationship 的 payload / target_ref / actor 约束与权重规则  `#plan-adjust-relationship-payload`
- [ ] 规划 adjust_relationship 的专项测试、replay 验证与文档同步  `#plan-adjust-relationship-tests`
- [ ] 设计 dispatcher 对 adjust_relationship 的执行路径、错误语义与幂等行为  `#plan-dispatcher-implementation`
- [ ] 设计 Relationship 唯一约束、updated_at 字段与去重迁移策略  `#plan-relationship-schema`
<!-- LIMCODE_TODO_LIST_END -->

# adjust_relationship 动作实现方案（Action Dispatcher 第二类 world action）

## 1. 结论

你的 7 条想法整体上是对的，而且和当前 Yidhras 的工程状态非常契合。它们形成了一个相对稳的 MVP 边界：

1. 对 `[from_id, to_id, type]` 加唯一约束
2. 当前先做单向边
3. `weight` 使用标准化区间限制
4. 当前只做 `set`，后续再支持 `delta` 与 `set`
5. `Relationship` 先加 `updated_at`，日志表后补
6. actor 仅按 active agent 语义处理
7. 前端先不跟进，先把后端工作流与 dispatcher 做稳

我没有本质反对意见。唯一建议再补 3 个工程细节，否则实现时会反复返工：

### 1.1 还需要再明确的 3 个点

#### A. 关系不存在时怎么处理？
需要明确：

- 默认失败？
- 还是允许 `create_if_missing=true` 自动创建？

建议：

- **MVP 默认失败**
- 可选支持 `create_if_missing=true`

用户: 默认失败，需要在主动配置允许自动创建

这样更安全，不会悄悄扩图。

#### B. `relationship_type` 是否先白名单？
建议第一版不要完全放开 string，而是先用现有模型和数据可接受的白名单，例如：

- `friend`
- `enemy`
- `command`
- `transfer`

后面如果要配置化，再挪到 world-pack 或配置表。

用户：后面配置化放到world-pack来处理 

#### C. `weight` 标准化区间建议先定为 `[0, 1]`
因为当前已经有 `type` 字段表达语义类别，`weight` 更适合作为**强度**而不是正负语义。

也就是说：

- `friend + 0.8` = 高强度友好关系
- `enemy + 0.8` = 高强度敌对关系

这样比 `[-1, 1]` 更不容易和 `type` 的语义冲突。

用户： 按你的建议来

---

## 2. 为什么选 `adjust_relationship`

在当前代码基线下，`adjust_relationship` 比 `trigger_event` 更适合作为 dispatcher 的第二类动作：

- 已有 `Relationship` 模型，落点清晰
- 结果直接体现在 L2 图谱，便于验证
- 不需要先设计完整的叙事事件体系
- 与现有 Workflow D / Replay / Locking 结构对接成本更低

但它的脆弱点也很明确：

> 它是“状态增量/状态覆盖型修改”，不是 append-only 记录，所以比 `post_message` 更怕语义不清、重复执行与 replay 误解。

所以本方案的原则是：

> 不追求一开始就灵活，而是先把语义收紧。

---

## 3. MVP 范围定义

## 3.1 第一版要实现的范围

- 新增 `intent_type = adjust_relationship`
- 只支持 **单向边** 更新
- actor 必须能解析为 **active agent**
- target 只支持：
  - `target_ref.agent_id`
- payload 只支持：
  - `operation = set`
  - `target_weight`
  - `relationship_type`
  - `create_if_missing?`
  - `reason?`
- `weight` 统一 clamp 到 `[0, 1]`
- replay 当前按真实 world-side replay 处理，但由于第一版只支持 `set`，所以**不会产生 delta 累加漂移**

## 3.2 第一版明确不实现的内容

- 双向/镜像关系联动
- `delta` 模式
- atmosphere node relation
- actor/target 的复杂多形态支持
- Relationship change log 表
- 前端图谱动态呈现
- world-pack 驱动 relation schema

---

## 4. 数据模型改造

目标文件：`apps/server/prisma/schema.prisma`

## 4.1 Relationship 模型调整

当前：

```prisma
model Relationship {
  id         String @id @default(uuid())
  from_id    String
  to_id      String
  type       String
  weight     Float  @default(1.0)
  created_at BigInt
}
```

建议改成：

```prisma
model Relationship {
  id         String @id @default(uuid())
  from_id    String
  to_id      String
  type       String
  weight     Float  @default(1.0)
  created_at BigInt
  updated_at BigInt

  @@unique([from_id, to_id, type])
}
```

### 说明

- `updated_at`：支持覆盖型写入后的审计最小观测
- `@@unique([from_id, to_id, type])`：避免 dispatcher/update 语义模糊

---

## 4.2 迁移策略

SQLite 下这会是一次 `RedefineTable`。

### 需要处理的迁移细节

#### 1) 旧数据回填
- 给已有记录补 `updated_at`
- 建议回填为：`created_at`

#### 2) 去重策略
如果历史数据中已存在重复 `[from_id, to_id, type]`，迁移前要去重。

建议规则：

- **保留 `created_at` 最大（最新）的那一条**
- 删除其它重复记录

原因：
- 在没有 `updated_at` 历史的前提下，最新创建记录最接近当前有效状态

### 建议额外执行的预检查
在真正 apply migration 前，建议先执行查询检查是否有重复边：

```sql
SELECT from_id, to_id, type, COUNT(*)
FROM Relationship
GROUP BY from_id, to_id, type
HAVING COUNT(*) > 1;
```

---

## 5. ActionIntent 契约设计

当前 dispatcher 已支持 `post_message`，现在扩到第二类动作。

## 5.1 `intent_type`

第一版新增：

```ts
intent_type = 'adjust_relationship'
```

## 5.2 target_ref

第一版只支持：

```json
{
  "agent_id": "agent-002"
}
```

不支持：

- `atmosphere_node_id`
- 多 target
- 泛化 target selector

---

## 5.3 payload 结构

建议第一版 payload 定义为：

```json
{
  "relationship_type": "friend",
  "operation": "set",
  "target_weight": 0.65,
  "create_if_missing": false,
  "reason": "manual calibration"
}
```

### 字段说明

- `relationship_type: string`
  - 第一版建议白名单校验
- `operation: 'set'`
  - 第一版仅允许 `set`
- `target_weight: number`
  - 写入前 clamp 到 `[0, 1]`
- `create_if_missing?: boolean`
  - 默认 `false`
- `reason?: string`
  - 暂时用于 payload 审计，可先不单独落库

---

## 6. 业务语义规则

## 6.1 actor 规则

沿用你同意的约束：

- actor 必须解析为 **active agent**
- 若是 atmosphere / unresolved actor / identity-only but no active agent
  - 直接 dispatch fail

这和 `post_message` 不同：

- `post_message` 更容易通过 identity 上下文发出
- `adjust_relationship` 是 L2 图谱变更，必须更严格

---

## 6.2 target 规则

- `target_ref.agent_id` 必须存在
- 不允许 target 为空
- 不允许 target = self（建议第一版直接禁止）

若缺失或非法：
- 返回 dispatch failure

---

## 6.3 relationship 更新规则

### 若边存在
执行：

- `weight = clamp(target_weight, 0, 1)`
- 更新 `updated_at`

### 若边不存在
- `create_if_missing = false` → 失败
- `create_if_missing = true` → 创建：
  - `from_id = actor.agent_id`
  - `to_id = target_ref.agent_id`
  - `type = relationship_type`
  - `weight = clamped target_weight`
  - `created_at = now`
  - `updated_at = now`

---

## 6.4 单向边规则

第一版明确：

- 只修改 `from_id = actor` 指向 `to_id = target` 的边
- **绝不自动写反向边**

也就是说：

- `A -> B` 更新，不影响 `B -> A`

这能显著降低语义复杂度。

---

## 7. dispatcher 实现方式

目标文件：

- `apps/server/src/app/services/action_dispatcher.ts`

## 7.1 建议先小幅重构 dispatcher 分发结构

当前 `dispatchActionIntent(...)` 里是硬编码：

- `post_message`

既然要加第二类动作，建议把内部逻辑整理成：

```ts
switch (intent.intent_type) {
  case 'post_message':
    return dispatchPostMessageIntent(...)
  case 'adjust_relationship':
    return dispatchAdjustRelationshipIntent(...)
  default:
    throw ...
}
```

不需要大重构，但至少让第二类动作进入独立函数。

---

## 7.2 新增 `dispatchAdjustRelationshipIntent(...)`

建议新增一个内部函数，职责如下：

1. 校验 action intent 锁归属
2. 解析 actor → active agent
3. 校验 target_ref.agent_id
4. 解析 payload
5. 校验 relation type / operation / target_weight
6. 查找 `Relationship`
7. 执行 set / create_if_missing 逻辑
8. 返回 `{ outcome: 'completed' }`

---

## 7.3 错误语义建议

建议新增错误码（至少 dispatcher 内部区分）：

- `ACTION_RELATIONSHIP_INVALID`
  - payload / target_ref / actor 非法
- `RELATIONSHIP_NOT_FOUND`
  - 边不存在且未允许创建
- `RELATIONSHIP_TYPE_UNSUPPORTED`
  - relation type 不在白名单中
- `RELATIONSHIP_WEIGHT_INVALID`
  - weight 非 number 或非法

第一版如果不想新增过多错误码，也可以统一落为：

- `ACTION_DISPATCH_FAIL`

但我建议内部至少先细分，哪怕对外仍只映射到 dispatch failure 体系，也便于后续审计。

---

## 8. Replay / Retry / 幂等语义

这是 `adjust_relationship` 最关键的部分之一。

## 8.1 为什么第一版先做 `set`

因为在当前 replay 模型下：

- replay 会创建一个新的 workflow
- dispatcher 会真实再执行一次 world-side action

如果第一版用 `delta`：

- replay 一次就会多改一次
- retry / 重放会累加漂移

而如果第一版用 `set`：

- replay 重新执行时，只是再次写到同一个 `target_weight`
- 语义更稳

### 结论
这也是为什么你选择 `set` 非常正确。

---

## 8.2 当前语义建议

明确写入文档：

- replay 是真实 world-side replay，不是 dry-run
- 但 `adjust_relationship(set)` 的 replay 由于是覆盖式写入，因此结果相对稳定

---

## 9. 权重区间设计

## 9.1 推荐区间

第一版建议：

```ts
weight ∈ [0, 1]
```

## 9.2 clamp 规则

- `< 0` → 写成 `0`
- `> 1` → 写成 `1`

## 9.3 为什么不用 `[-1, 1]`

因为当前已有：

- `type`

所以关系正负语义最好由 `type` 承担，而不是由 `weight` 再承担一次。

否则后面容易出现：

- `enemy + (-0.5)`
- `friend + (-0.2)`

这种解释很混乱。

---

## 10. API / 文档层面影响

虽然 `adjust_relationship` 是通过 workflow / dispatcher 执行的，不一定需要新增公共 API，但以下文档需要同步：

- `API.md`
- `ARCH.md`
- `LOGIC.md`（建议补）
- `TODO.md`

### API.md 建议补充
在 Phase D 当前语义中增加：

- dispatcher 已支持 `intent_type = adjust_relationship`
- 第一版只支持：
  - active actor
  - target agent
  - single-direction edge
  - `operation = set`
  - weight clamp `[0,1]`

---

## 11. 测试方案

## 11.1 必做专项测试

建议新增：

- `apps/server/src/e2e/adjust_relationship.ts`

或者如果你想更贴近现有风格，也可以并入 dispatcher 相关专项测试文件。

### 场景 1：更新已存在关系边
- 预置 `A -> B, type=friend, weight=0.2`
- 生成 `adjust_relationship(set -> 0.8)` intent
- dispatcher 消费
- 验证：
  - `weight = 0.8`
  - `updated_at` 更新
  - intent -> completed

### 场景 2：单向边不影响反向边
- 同时有 `A -> B` 和 `B -> A`
- 只派发 `A -> B`
- 验证 `B -> A` 不变

### 场景 3：weight clamp
- 输入 `target_weight = 99`
- 验证结果被写为 `1`

### 场景 4：缺边但不允许创建
- 边不存在
- `create_if_missing = false`
- 验证 dispatch failed

### 场景 5：缺边允许创建
- 边不存在
- `create_if_missing = true`
- 验证创建成功

### 场景 6：非 active actor 拒绝
- atmosphere actor / 无 active agent
- 验证 dispatch fail

### 场景 7：replay 语义稳定
- 对同一 source job replay 两次
- 若 payload 为 `set 0.6`
- 验证最终 weight 仍是 `0.6`，而不是漂移

---

## 11.2 迁移相关测试建议

如果要加唯一约束，建议在真正上线前至少执行一次：

- 检查 DB 是否存在重复 `[from_id, to_id, type]`
- 若存在，验证 dedupe SQL 生效

---

## 12. 涉及文件清单

### 数据层
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/<new_migration>/migration.sql`

### dispatcher / service
- `apps/server/src/app/services/action_dispatcher.ts`
- `apps/server/src/app/runtime/action_dispatcher_runner.ts`

### 可能涉及的业务读取层
- `apps/server/src/app/services/relational.ts`（如果需要额外验证图谱输出）

### 测试
- `apps/server/src/e2e/adjust_relationship.ts`（或同类专项测试脚本）
- `apps/server/package.json`

### 文档
- `API.md`
- `ARCH.md`
- `LOGIC.md`
- `TODO.md`

---

## 13. 实施顺序建议

### Step 1
先改 `Relationship` schema：

- `updated_at`
- 唯一约束
- migration 去重策略

### Step 2
给 dispatcher 增加第二类动作：

- `adjust_relationship`
- 单向 set 逻辑

### Step 3
补 clamp / validation / create_if_missing 逻辑

### Step 4
补 replay 稳定性测试

### Step 5
同步文档

---

## 14. 验收标准

完成本批次后，应满足：

1. `adjust_relationship` 能通过 dispatcher 正常执行。
2. 仅影响单向边，不会自动更新反向边。
3. `weight` 始终被约束在 `[0,1]`。
4. 第一版仅支持 `operation = set`。
5. actor 必须为 active agent。
6. `Relationship` 唯一性稳定，dispatcher 不会因重复边产生歧义。
7. replay 不会因为使用 `set` 而导致关系值累积漂移。
8. 专项测试与 lint/typecheck 均通过。

---

## 15. 最终建议

你当前定下的这套约束非常适合做一个“稳的第二类 world action”。

如果要再用一句话概括这版方案：

> **先把 `adjust_relationship` 做成“单向、active-only、set-only、clamped、可 replay 但不漂移”的关系边覆盖动作。**

这是当前阶段最适合 Yidhras 的实现方式。
