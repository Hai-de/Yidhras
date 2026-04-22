# 数据库边界治理第一阶段设计

## 1. 背景

当前服务端已经形成了两套实际存在的持久化边界：

1. **kernel-side Prisma / SQLite 宿主库**
   - 承载 workflow、scheduler、plugin governance、memory working layer、identity/access、social/audit evidence 等数据。
2. **pack-owned runtime sqlite**
   - 承载 world governance core，即 pack runtime 的实体、状态、authority、mediator、rule execution 等数据。

从架构文档看，这个方向本身是成立的；当前主要问题不是“数据库选型错误”，而是：

- `AppContext.prisma` 作为全局大水管暴露给大量业务代码；
- 存在 `context.sim.prisma` 一类运行时穿透访问；
- 一部分模块已经有 store/repository 雏形，另一部分仍在 service / runtime 中散射 Prisma 查询；
- schema 虽在同一个 Prisma datasource 下，但逻辑边界、写模型边界、审计边界、读模型边界没有完全收口。

因此，第一阶段不做“多 ORM 抽象”，也不做“数据库切换工程”，而是先完成：

- 边界盘点；
- 访问收口；
- 核心域 repository/store/facade 化；
- 禁止继续扩大 Prisma 散射面；
- 阶段收尾时删除不再需要的兼容代码。

---

## 2. 目标

### 2.1 本阶段目标

1. 盘点 `context.prisma` / `sim.prisma` / `new PrismaClient()` 的直接依赖点，并按模块分组。
2. 明确以下四类存储边界：
   - kernel-side 数据
   - pack-owned 数据
   - read model / projection 数据
   - audit / evidence 数据
3. 为高频核心域补 repository / store / facade 收口，避免业务层继续直接散射 Prisma 查询。
4. 消除 `context.sim.prisma` 这类运行时穿透访问。
5. 让 Prisma 继续可用，但使 schema / migration / repository 结构清晰，降低未来迁移与替换成本。
6. 在阶段收尾时，**清理兼容性代码**；项目未上线，不保留对历史数据形态和旧服务路径的长期兼容负担。

### 2.2 非目标

本阶段**不做**：

- 多 ORM 抽象层；
- 数据库类型切换（如 SQLite -> PostgreSQL）的正式适配工程；
- pack runtime 存储系统重做；
- 全量重写所有 service；
- 为旧数据、旧 API、旧运行路径保留长期兼容层。

---

## 3. 当前状态判断

## 3.1 当前已确认的 Prisma 入口

### `new PrismaClient()`

- `apps/server/src/core/simulation.ts`
- `apps/server/src/cli/plugin_cli.ts`
- `apps/server/src/db/seed.ts`
- `apps/server/src/db/seed_identity.ts`

### `sim.prisma` / `context.sim.prisma`

- `apps/server/src/index.ts`
- `apps/server/src/inference/context_builder.ts`

### 已存在 store/repository 雏形

- `apps/server/src/plugins/store.ts`
- `apps/server/src/context/overlay/store.ts`
- `apps/server/src/memory/blocks/store.ts`
- `apps/server/src/memory/long_term_store.ts`
- `apps/server/src/app/services/inference_workflow/repository.ts`

### 直接散射 Prisma 较重的模块

- `apps/server/src/app/services/action_dispatcher.ts`
- `apps/server/src/app/runtime/scheduler_ownership.ts`
- `apps/server/src/app/runtime/scheduler_lease.ts`
- `apps/server/src/app/runtime/scheduler_rebalance.ts`
- `apps/server/src/app/services/audit.ts`
- `apps/server/src/app/services/agent.ts`
- `apps/server/src/app/services/social.ts`
- `apps/server/src/app/services/identity.ts`
- `apps/server/src/app/services/relational/*`
- `apps/server/src/app/services/scheduler_observability.ts`

## 3.2 当前根问题

### 问题 A：业务层直接依赖 Prisma model

表现形式：

- `context.prisma.xxx.findMany(...)`
- `context.prisma.xxx.update(...)`
- `context.prisma.$transaction(...)`

直接出现在 service / runtime / query 逻辑中。

### 问题 B：运行时对象与数据库句柄耦合

`SimulationManager` 既承担：

- pack 初始化；
- clock/runtime 管理；
- SQLite pragma 初始化；
- PrismaClient 暴露。

这会模糊 runtime boundary 与 persistence boundary。

### 问题 C：读写职责混杂

例如某些模块同时承担：

- domain write；
- audit append；
- operator-facing read aggregation；
- runtime orchestration。

这使后续想拆 read model、换 schema、改 migration 时，影响面过大。

### 问题 D：兼容兜底代码开始出现并扩散

当前已有一些“表不存在则返回空 / 抛特殊提示”的兼容写法。这在阶段中可接受，但项目未上线，不应在阶段结束后长期保留过多历史兼容层，否则将持续抬高维护成本。

---

## 4. 存储边界定义

## 4.1 Kernel-side 数据

由 kernel Prisma 宿主库承载，属于系统运行时治理与工作层数据。

### 范围

- workflow persistence
  - `InferenceTrace`
  - `DecisionJob`
  - `ActionIntent`
  - `AiInvocationRecord`
- identity / access
  - `Agent`
  - `Identity`
  - `IdentityNodeBinding`
  - `Policy`
  - `Circle`
  - `CircleMember`
  - `AtmosphereNode`
- scheduler ownership / observability
  - `SchedulerLease`
  - `SchedulerCursor`
  - `SchedulerPartitionAssignment`
  - `SchedulerOwnershipMigrationLog`
  - `SchedulerWorkerRuntimeState`
  - `SchedulerRebalanceRecommendation`
  - `SchedulerRun`
  - `SchedulerCandidateDecision`
- memory working layer
  - `ContextOverlayEntry`
  - `MemoryBlock`
  - `MemoryBlockBehavior`
  - `MemoryBlockRuntimeState`
  - `MemoryBlockDeletionAudit`
  - `MemoryCompactionState`
- plugin governance
  - `PluginArtifact`
  - `PluginInstallation`
  - `PluginActivationSession`
  - `PluginEnableAcknowledgement`
- social / audit evidence 宿主
  - `Post`
  - `Event`
  - `Relationship`
  - `RelationshipAdjustmentLog`
  - `SNRAdjustmentLog`

### 边界语义

- 这些数据属于系统宿主治理层，不属于 pack runtime source-of-truth。
- 即便与 world 行为有关，也应视作 kernel-hosted runtime / governance / evidence objects。

## 4.2 Pack-owned 数据

由 pack runtime sqlite 承载，属于 world governance core。

### 范围

当前以 `apps/server/src/packs/storage/*` 为边界，核心包括：

- world entities
- entity states
- authority grants
- mediator bindings
- rule execution records
- 未来 pack 自有治理集合

### 边界语义

- 这些数据的 source-of-truth 在 pack runtime 存储。
- 不应回流到 kernel Prisma 中伪装成同层事务数据。
- 应继续通过 `packs/storage/*` 与相应 repo 访问，不纳入本阶段 Prisma 收口重点。

## 4.3 Read model / projection 数据

分两类处理。

### A. 持久化 projection / observability read model

- `SchedulerRun`
- `SchedulerCandidateDecision`
- 后续若新增 operator-facing summary tables，也归此类

### B. 查询时拼装的聚合 read model

- agent overview
- audit feed/detail
- relational graph view
- workflow detail/list
- scheduler operator summary

### 边界语义

- read model 可以继续放在 kernel Prisma，但语义上应与事务写模型区分；
- query service 不直接承担写入状态推进职责；
- 后续如需改成物化视图或独立读库，迁移成本应可控。

## 4.4 Audit / evidence 数据

作为独立语义层明确标记。

### 范围

- `Event`
- `Post`
- `RelationshipAdjustmentLog`
- `SNRAdjustmentLog`
- `AiInvocationRecord`
- 部分 `InferenceTrace`

### 边界语义

- 它们是证据宿主，不是 pack-owned narrative source-of-truth；
- 允许被 workflow、memory、projection、operator view 消费；
- 写入路径应经 evidence repository / audit repository 收口。

---

## 5. 分层策略

本阶段采用 **“Prisma 保留、访问收口、模块化 repository/store/facade”** 的策略。

## 5.1 分层原则

### 原则 1：业务服务不再直接拥有 Prisma model 细节

业务服务应依赖：

- repository
- store
- query facade
- domain-oriented persistence service

而不是直接写 `context.prisma.modelName.*`。

### 原则 2：读写分离优先于 ORM 抽象

先把：

- write path
- audit append path
- query aggregation path
- projection path

拆清楚，再谈底层存储替换。

### 原则 3：运行时对象不直通数据库内部

`SimulationManager` 只保留 runtime 职责；业务代码不得再通过 `context.sim.prisma` 读取/写入数据库。

### 原则 4：新代码禁止扩大 Prisma 散射面

从本阶段开始：

- 新增业务逻辑不得直接写 Prisma model 调用；
- 必须经 repository/store/facade；
- 仅 infra/store 层允许直接接触 Prisma。

### 原则 5：兼容代码只作为阶段过渡，不作为长期资产

项目未上线，因此：

- 可在迁移中临时保留最小兼容桥；
- 阶段收尾必须删除历史兼容路径、旧 fallback、过时中转代码；
- 不为旧数据形态和旧服务接口维持长期双轨。

---

## 6. 目标分层结构

建议形成如下结构语义（文件组织可微调，但职责应稳定）：

## 6.1 Kernel transactional repositories

负责事务写入与状态迁移。

建议候选：

- `workflow_job_repository`
- `action_intent_repository`
- `relationship_repository`
- `agent_repository`
- `identity_repository`
- `policy_repository`
- `plugin_governance_repository`
- `scheduler_ownership_repository`
- `scheduler_lease_repository`
- `scheduler_rebalance_repository`

## 6.2 Evidence / audit repositories

负责证据追加与证据读取。

建议候选：

- `event_evidence_repository`
- `social_evidence_repository`
- `mutation_audit_repository`
- `ai_invocation_repository`

## 6.3 Memory / overlay stores

当前已有良好雏形，继续沿此方向。

建议保留/增强：

- `context_overlay_store`
- `memory_block_store`
- `long_term_memory_store`

## 6.4 Query / projection repositories

负责 operator-facing 或 API-facing 聚合查询。

建议候选：

- `workflow_query_repository`
- `audit_query_repository`
- `relational_query_repository`
- `agent_read_repository`
- `scheduler_observability_repository`

## 6.5 Pack-owned storage boundary

继续独立，不纳入 kernel Prisma repository 体系。

建议继续保持：

- `packs/storage/*`
- `pack runtime sqlite`
- pack-specific repo

---

## 7. 第一阶段优先改造范围

本阶段不追求“一次改完全部文件”，而是先改造高频核心域。

## 7.1 第一批：workflow / scheduler 主链路

### 当前问题

`apps/server/src/app/services/inference_workflow/repository.ts` 已具备 repository 雏形，但职责偏大，既负责：

- job persistence
- trace / intent 读取
- scheduler signal 查询
- event / overlay / memory followup signal 聚合

### 目标拆分

建议拆成：

#### `workflow_job_repository`
负责：

- `DecisionJob` create / claim / release / update
- `ActionIntent` 与 workflow job 的基础关系维护
- `InferenceTrace` 基础查找

#### `scheduler_signal_repository`
负责：

- recent signal tick
- event / relationship / snr / overlay / memory followup signal 收集

#### `workflow_query_repository`
负责：

- workflow detail
- workflow list
- trace / intent / job 只读聚合

### 收益

- runtime loop 与 scheduler 不再依赖一个巨型 repository；
- 读写语义更清楚；
- 后续迁移 scheduler 或 workflow 读模型时影响更小。

## 7.2 第二批：action dispatcher / mutation write path

### 当前问题

`apps/server/src/app/services/action_dispatcher.ts` 同时处理：

- action intent claim / release / 状态推进
- relationship 读取/更新
- snr 更新
- event 写入
- audit log 写入
- dispatch 业务规则

这是典型的业务与持久化混写。

### 目标拆分

#### `action_intent_repository`
负责：

- list dispatchable
- claim / release
- mark dispatching / completed / failed / dropped
- fetch for reflection

#### `relationship_mutation_repository`
负责：

- relationship get/create/update
- relationship adjustment audit append

#### `agent_signal_repository`
负责：

- target agent existence read
- snr update
- snr adjustment audit append
- event evidence append

### 收益

- action dispatcher 回到 orchestration/application service 角色；
- mutation write path 更可测；
- audit append 与业务决策解耦。

## 7.3 第三批：scheduler ownership / lease / rebalance

### 当前问题

- `scheduler_ownership.ts`
- `scheduler_lease.ts`
- `scheduler_rebalance.ts`

本质上已经是独立子系统，但仍直接暴露 Prisma model。

### 目标拆分

#### `scheduler_ownership_repository`
- partition assignment
- migration log
- worker runtime state

#### `scheduler_lease_repository`
- lease acquire/renew/release
- cursor read/write

#### `scheduler_rebalance_repository`
- recommendation create/update/list
- apply linkage persistence

### 收益

- runtime 调度层不再直接耦合 schema 表名；
- 为未来更复杂的 ownership / rebalance 逻辑留出空间；
- 后续多 worker / 多 partition 演进更稳定。

---

## 8. 明确需要立即治理的点

## 8.1 消除 `context.sim.prisma`

已确认典型问题点：

- `apps/server/src/inference/context_builder.ts`

### 治理要求

- 任何业务/应用层代码不得再使用 `context.sim.prisma`；
- 所需读取应迁移到对应 repository，例如 `event_evidence_repository` 或专门 reader；
- `SimulationManager.prisma` 不再被视作业务侧数据库入口。

## 8.2 控制 `AppContext.prisma`

### 第一阶段策略

- 暂不强制立即删除 `AppContext.prisma` 字段；
- 但将其视作过渡依赖；
- 新增逻辑不得继续直接依赖；
- 改造过的模块应改为依赖 repository/store/facade。

### 后续方向

在更多核心域完成收口后，再考虑将 `AppContext` 由“暴露 Prisma”转为“暴露 repositories / stores / query services”。

## 8.3 控制 `new PrismaClient()` 扩散

### 分类处理

- `core/simulation.ts`：需要重新评估其 runtime/persistence 边界角色；
- `cli/plugin_cli.ts`：CLI 可保留独立 client，但应通过 plugin governance repo/store 使用；
- `db/seed.ts` / `db/seed_identity.ts`：seed 脚本允许直接使用 Prisma，但需标记为脚本层，不参与业务架构边界。

---

## 9. 文件级改造建议

## 9.1 建议优先改造的文件

### 第一优先级

- `apps/server/src/app/services/inference_workflow/repository.ts`
- `apps/server/src/app/services/action_dispatcher.ts`
- `apps/server/src/app/runtime/scheduler_ownership.ts`
- `apps/server/src/app/runtime/scheduler_lease.ts`
- `apps/server/src/app/runtime/scheduler_rebalance.ts`
- `apps/server/src/inference/context_builder.ts`

### 第二优先级

- `apps/server/src/app/services/audit.ts`
- `apps/server/src/app/services/scheduler_observability.ts`
- `apps/server/src/app/services/agent.ts`
- `apps/server/src/app/services/social.ts`
- `apps/server/src/app/services/identity.ts`
- `apps/server/src/app/services/relational/*`

### 第三优先级

- `apps/server/src/index.ts`
- `apps/server/src/core/simulation.ts`
- `apps/server/src/cli/plugin_cli.ts`

## 9.2 建议保留并增强的文件方向

- `apps/server/src/plugins/store.ts`
- `apps/server/src/context/overlay/store.ts`
- `apps/server/src/memory/blocks/store.ts`
- `apps/server/src/memory/long_term_store.ts`
- `apps/server/src/packs/storage/*`

这些模块已经较接近目标方向，应以“增强一致性”而非“推翻重来”为主。

---

## 10. 迁移策略

## 10.1 总体策略

采用 **低风险渐进迁移**：

1. 先新增 repository/store/facade；
2. 再把调用方切过去；
3. 再删除旧直连 Prisma 逻辑；
4. 阶段末统一清理兼容层与废弃代码。

## 10.2 具体步骤

### Step 1：盘点表与访问点

产出清单，字段至少包括：

- 文件路径
- 模块归属
- 使用方式（`new PrismaClient` / `context.prisma` / `context.sim.prisma`）
- 涉及表
- 类型（transactional / audit / projection / memory / plugin）
- 目标 repository/store

### Step 2：先建立 repository contract

对第一批核心域建立文件和接口，不要求一次抽象完美，但要求：

- 语义稳定；
- 业务命名优先；
- 隔离 Prisma 查询细节。

### Step 3：替换调用点

把高频核心服务逐步替换为经 repository/store 访问。

### Step 4：去掉运行时穿透

优先清理 `context.sim.prisma` 与其他明显越层调用。

### Step 5：删除旧桥接/兼容代码

当调用方已全部切换后：

- 删除旧 helper；
- 删除中转函数；
- 删除临时 fallback；
- 删除多余的“兼容旧路径”判断。

---

## 11. 兼容性与清理策略

这是本设计的明确约束。

## 11.1 基本原则

项目未上线，因此本阶段**不追求对过去数据和过去服务路径的长期兼容**。

可接受：

- 为分批重构临时保留小范围桥接；
- 为迁移过程中保证测试可跑保留短暂兼容层。

不可接受：

- 长期同时保留旧 repository 与新 repository；
- 长期保留旧 schema shape 的双写 / 双读；
- 长期保留“如果新表不存在就走旧逻辑”的隐藏 fallback；
- 长期保留旧 API 语义映射层，只为兼容尚未上线的历史实现。

## 11.2 阶段收尾必须执行的清理项

第一阶段结束时，必须统一清理：

1. **删除旧调用路径**
   - 已迁移模块中残留的 `context.prisma.xxx` 直连调用；
   - `context.sim.prisma` 访问。
2. **删除临时兼容桥**
   - 旧 helper 转发层；
   - 仅为迁移过渡存在的 adapter。
3. **删除无意义 fallback**
   - 已正式纳入主干表结构后，不再继续保留旧缺表兼容路径（除部署初始化阶段明确需要的最小提示外）。
4. **删除旧服务语义映射**
   - 已由新 repository / facade 承接的旧路径函数若无保留价值，直接删除。
5. **同步更新测试**
   - 删除针对旧兼容行为的测试；
   - 保留新边界下的测试资产。

## 11.3 唯一允许保留的“最小兼容”

仅允许保留以下两类最小兼容：

- `prisma migrate deploy` 前的明确报错提示；
- 测试 / CLI / seed 运行所需的清晰初始化校验。

也就是说，允许“初始化失败时给出明确错误”，但不允许“长期用兼容逻辑偷偷兜底旧世界”。

---

## 12. 风险与回归点

## 12.1 风险

1. repository 切分过快，导致接口重复或命名混乱；
2. 迁移过程中事务边界被打散；
3. runtime loop / scheduler 主链路回归；
4. query service 在拆分中丢失字段或排序语义；
5. 收尾时删除兼容代码不彻底，导致新旧双轨继续并存。

## 12.2 需要重点回归的能力

- inference job claim / retry / replay；
- action intent claim / dispatch / completion / failure / dropped；
- scheduler ownership / lease / rebalance；
- audit feed/detail；
- plugin governance 基本流；
- memory block / overlay 读写；
- runtime startup / bootstrap。

---

## 13. 验收标准

满足以下条件时，可认为第一阶段基本完成：

1. 已形成明确的边界文档与模块映射。
2. `context.sim.prisma` 访问已消除。
3. workflow / scheduler、action dispatcher、scheduler ownership 三个核心域已通过 repository/store/facade 收口。
4. 新增业务代码不再直接散射 Prisma model 调用。
5. `AppContext.prisma` 虽可暂存，但已不是核心业务模块的主要依赖入口。
6. 阶段收尾已删除迁移期间产生的兼容桥、旧路径与多余 fallback。
7. 测试基线已切换到新的边界模型，不再验证无意义的历史兼容行为。

---

## 14. 后续阶段衔接

完成本阶段后，后续可以顺延推进：

1. Prompt Workflow 宏 / 变量系统正式化；
2. YAML 配置治理；
3. 单 pack 多实体并发；
4. 多 world pack runtime registry。

而数据库边界治理完成后，上述阶段会获得两个直接收益：

- schema / migration 影响面更清晰；
- runtime / workflow / scheduler / plugin / memory 等横切能力更容易分别演进。

---

## 15. 设计结论

本阶段的核心不是“把 Prisma 隐藏到看不见”，而是：

- 把 Prisma **限制在 infra/store/repository 边界内**；
- 把业务层恢复为 **orchestration / domain rule / query composition**；
- 把 kernel-side、pack-owned、projection、audit 四类存储职责明确下来；
- 在阶段末**主动删除兼容代码**，不为未上线项目背负历史包袱。

最终目标是：

> 继续使用 Prisma，但不再让业务层直接散射 Prisma；继续使用现有 schema/migration 体系，但让边界、职责与后续迁移成本都明显下降。