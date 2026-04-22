<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/database-boundary-governance-phase1-design.md","contentHash":"sha256:969fc9726169b799895f4a4b8f15b13ee5d0cd6bb6822f9965bd737ee2d4ebf4"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 为 action dispatcher / mutation write path 建立 action intent、relationship mutation、agent signal 仓储边界  `#phase1-action-dispatcher`
- [x] 阶段收尾删除临时兼容桥、旧路径与无意义 fallback，并同步测试  `#phase1-cleanup-compat`
- [x] 建立第一阶段治理护栏：workflow / scheduler 已拆分到 workflow_job_repository 与 scheduler_signal_repository，并以 inference_workflow.ts 作为过渡导出入口，禁止在新增业务逻辑继续扩大 Prisma 散射  `#phase1-guardrails`
- [x] 移除 context.sim.prisma 等运行时穿透访问，并减少核心业务对 AppContext.prisma 的直接依赖  `#phase1-remove-runtime-penetration`
- [x] 为 scheduler ownership / lease / rebalance 建立独立 repository，并替换 runtime 调用  `#phase1-scheduler-runtime`
- [x] 拆分 workflow / scheduler 主链路 repository：job、signal、query 三类职责  `#phase1-workflow-scheduler`
<!-- LIMCODE_TODO_LIST_END -->

# 数据库边界治理第一阶段实施计划

> Source Design: `.limcode/design/database-boundary-governance-phase1-design.md`

## 1. 目标

基于已确认设计，在不引入多 ORM 抽象、不重做 pack runtime 的前提下，完成 kernel-side Prisma 访问收口，优先治理高频核心域，并在阶段收尾时删除迁移过程中产生的兼容代码。

本计划重点落实以下结果：

- 明确 kernel-side / pack-owned / projection / audit 边界在代码中的落点。
- workflow / scheduler、action dispatcher、scheduler ownership 三个核心域不再由 service/runtime 直接散射 Prisma。
- 消除 `context.sim.prisma` 访问。
- 为后续继续收紧 `AppContext.prisma` 创造条件。
- 项目未上线，因此本阶段结束时主动删除兼容桥、旧路径和无意义 fallback。

---

## 2. 实施原则

### 2.1 保持低风险渐进迁移

采用“先新增 repository/store/facade -> 再切调用方 -> 再删旧逻辑”的顺序，避免一次性大改。

### 2.2 先治理高频主链路

优先处理：

1. workflow / scheduler 主链路
2. action dispatcher / mutation write path
3. scheduler ownership / lease / rebalance

### 2.3 新逻辑禁止继续扩大 Prisma 散射面

从本计划执行开始：

- 新增业务逻辑不得直接写 `context.prisma.model.*`
- 新增读取/写入必须落到 repository/store/facade
- 允许脚本层和明确 infra 层继续直接接触 Prisma

### 2.4 兼容代码只短暂存在

项目未上线，因此：

- 迁移中允许保留临时桥接
- 阶段末必须集中删除
- 不保留长期双轨实现

---

## 3. 目录与职责建议

以下是建议的代码落点，具体命名可结合现有目录微调，但职责边界应保持一致。

### 3.1 workflow / scheduler

建议在 `apps/server/src/app/services/inference_workflow/` 下拆分：

- `workflow_job_repository.ts`
- `scheduler_signal_repository.ts`
- `workflow_query_repository.ts`

保留已有 `repository.ts` 作为短期迁移壳文件仅可接受于迁移中，最终应删除或降为纯 re-export，阶段收尾时清理。

### 3.2 action dispatcher / mutation

建议在 `apps/server/src/app/services/` 下新增或拆分：

- `action_intent_repository.ts`
- `relationship_mutation_repository.ts`
- `agent_signal_repository.ts`

`action_dispatcher.ts` 最终应只保留 orchestration、校验和业务流程编排。

### 3.3 scheduler runtime persistence

建议在 `apps/server/src/app/runtime/` 下拆分：

- `scheduler_ownership_repository.ts`
- `scheduler_lease_repository.ts`
- `scheduler_rebalance_repository.ts`

原有 runtime 文件应逐步退回为调度行为逻辑，而不是表操作聚合点。

### 3.4 evidence / audit readers

如在迁移中需要承接 `context.sim.prisma.event` 等读取，可补：

- `event_evidence_repository.ts`
- 或更轻量的 `event_evidence_reader.ts`

目标是先消除穿透访问，再决定是否继续扩展为完整 evidence repository 族。

---

## 4. 分阶段实施

## Phase 0：治理护栏与落点准备

### 目标

在正式拆分前先建立一致的实现规则，避免边改边散。

### 任务

1. 约定 repository/store/facade 的命名与目录落点。
2. 明确哪些文件允许直接依赖 Prisma：
   - infra/store/repository
   - CLI 脚本层
   - seed 脚本层
3. 明确哪些文件不允许继续直接依赖 Prisma：
   - application service
   - runtime orchestration
   - query composition service
4. 给第一批迁移文件建立目标映射：
   - 旧文件 -> 新 repository -> 最终保留职责

### 完成标志

- 核心改造文件的目标职责明确。
- 后续改动不再新增新的 Prisma 散射点。

---

## Phase 1：workflow / scheduler 主链路收口

### 目标

把当前 `inference_workflow/repository.ts` 里混合的 job、signal、query 职责拆开。

### 任务

#### 1. 拆出 `workflow_job_repository`

负责：

- `DecisionJob` create / claim / release / update
- `ActionIntent` 与 workflow job 的基础关系读取
- `InferenceTrace` 的基础读取
- 供 job runner / runtime loop 使用的事务性操作

#### 2. 拆出 `scheduler_signal_repository`

负责：

- latest scheduler signal tick
- event / relationship / snr / overlay / memory followup signal 收集
- scheduler 所需最近窗口读取

#### 3. 拆出 `workflow_query_repository`

负责：

- workflow detail/list
- trace / intent / job 聚合只读查询
- API-facing 的 query 语义

#### 4. 替换调用方

重点替换：

- `job_runner.ts`
- `agent_scheduler.ts`
- `scheduler_observability.ts` 中相关读取
- 其他直接依赖旧巨型 repository 的调用点

#### 5. 保持事务边界稳定

迁移时要确认：

- claim/update 的原子性不被打散
- retry/replay 相关状态推进不变
- 旧排序、过滤、窗口逻辑不丢失

### 风险点

- `DecisionJob` 状态流被拆坏
- scheduler signal 结果与旧逻辑不一致
- workflow query 字段缺失

### 完成标志

- workflow / scheduler 主链路不再依赖一个混合 repository 文件。
- job、signal、query 三类职责分离。

---

## Phase 2：action dispatcher / mutation write path 收口

### 目标

让 `action_dispatcher.ts` 从“业务+持久化混写”回到 application service/orchestration 角色。

### 任务

#### 1. 拆出 `action_intent_repository`

负责：

- dispatchable intent 列表
- claim / release
- mark dispatching / completed / failed / dropped
- reflection 所需 intent 基础读取

#### 2. 拆出 `relationship_mutation_repository`

负责：

- relationship get/create/update
- relationship adjustment log append

#### 3. 拆出 `agent_signal_repository`

负责：

- agent existence read
- SNR 更新
- SNR audit append
- Event evidence append

#### 4. 收缩 `action_dispatcher.ts`

迁移后仅保留：

- payload/actor/target 校验
- dispatch 路由
- 业务编排
- repository 调用组合

#### 5. 校验事务边界

特别关注：

- `adjust_snr` 的读-改-审计写入关系
- `adjust_relationship` 的创建/更新/日志关系
- `trigger_event` 写入的证据一致性

### 风险点

- mutation audit 与状态更新顺序变化
- transaction 被拆散造成中间态
- reflection 查询字段退化

### 完成标志

- `action_dispatcher.ts` 中的 Prisma 直连大幅消失。
- mutation write path 通过 repository 承接。

---

## Phase 3：scheduler ownership / lease / rebalance 收口

### 目标

把 scheduler runtime 的持久化操作从 runtime 逻辑中剥离出来。

### 任务

#### 1. 拆出 `scheduler_ownership_repository`

负责：

- partition assignment 读取/更新
- migration log create/update/list
- worker runtime state read/upsert/update

#### 2. 拆出 `scheduler_lease_repository`

负责：

- lease acquire/renew/release
- cursor upsert/read

#### 3. 拆出 `scheduler_rebalance_repository`

负责：

- recommendation create/update/list
- apply linkage persistence
- 与 migration log 的关联写入

#### 4. 替换 runtime 文件中的 Prisma 直连

目标覆盖：

- `scheduler_ownership.ts`
- `scheduler_lease.ts`
- `scheduler_rebalance.ts`

### 风险点

- lease/cursor 原子行为被改变
- ownership migration 状态推进错位
- rebalance recommendation 与 apply linkage 不一致

### 完成标志

- scheduler runtime 层主要处理调度流程，不再自己拼 Prisma 表操作。

---

## Phase 4：移除运行时穿透访问并收紧上下文边界

### 目标

优先消除 `context.sim.prisma`，并让核心模块减少直接依赖 `AppContext.prisma`。

### 任务

#### 1. 移除 `inference/context_builder.ts` 的 `context.sim.prisma`

引入专门 repository/reader 承接对应 event 读取。

#### 2. 审查 `sim.prisma` 暴露方式

短期允许 `index.ts` 仍通过 `sim.prisma` 初始化 `appContext.prisma`，但不再允许业务模块通过 `sim` 访问数据库。

#### 3. 收紧核心模块依赖

第一批已迁移模块应改为依赖：

- repository
- store
- facade

而不是直接依赖 `AppContext.prisma`。

#### 4. 评估 `SimulationManager` 的后续演进

本阶段不必彻底重构 `SimulationManager`，但需要把它从“业务侧数据库入口”降级为“runtime 初始化宿主”。

### 完成标志

- `context.sim.prisma` 被消除。
- 核心域不再把 `sim` 视为数据库访问入口。

---

## Phase 5：阶段收尾与兼容代码清理

### 目标

删除迁移过程中的兼容桥、旧路径与无意义 fallback，避免未上线项目背历史包袱。

### 必做任务

#### 1. 删除旧调用路径

- 已迁移模块里残留的 `context.prisma.model.*`
- 已替代的旧 helper / wrapper
- 旧 repository 汇总壳文件（若只剩转发价值）

#### 2. 删除临时兼容桥

包括但不限于：

- 迁移期 adapter
- 仅为新旧接口并存而存在的中转函数
- 临时 re-export 壳

#### 3. 删除无意义 fallback

对已进入主干 schema 且部署前提明确的模块：

- 删除“新表不存在则静默返回空”的历史兼容逻辑
- 保留仅限初始化失败时的明确错误提示

重点审查：

- workflow 相关 repository
- scheduler runtime repository
- 已迁移的 mutation / evidence 路径

#### 4. 同步测试

- 删除验证旧兼容行为的测试
- 补新边界下的 repository/service 测试
- 校正 integration/e2e 测试对旧直连行为的假设

#### 5. 文档同步

- 更新开发约束：新增业务逻辑不得散射 Prisma
- 如必要，补部署者迁移说明和数据库初始化说明

### 完成标志

- 没有明显的新旧双轨逻辑共存
- 主链路不再依赖迁移临时桥
- 未上线项目的兼容包袱已被主动清理

---

## 5. 交叉检查与验证

## 5.1 单元与集成回归重点

### workflow / scheduler

- decision job claim/release/update
- retry / replay 语义
- signal 收集窗口逻辑

### action dispatcher

- action intent claim/dispatch/completion/failure/dropped
- adjust_snr 与 adjust_relationship 的事务一致性
- trigger_event 证据写入

### scheduler runtime

- lease acquire/renew/release
- cursor 读写
- ownership migration create/in-progress/completed
- rebalance recommendation apply linkage

### 其他

- audit feed/detail
- plugin governance 基线不回归
- memory overlay / block store 不被误伤
- startup/bootstrap 仍可正常运行

## 5.2 人工检查清单

在阶段收尾前，人工复核：

- 是否仍存在 `context.sim.prisma`
- 是否仍存在新增的业务层 `context.prisma.xxx`
- 是否还有仅为兼容迁移保留的旧中转代码
- 是否存在“新旧逻辑都能跑”的隐性双轨

---

## 6. 里程碑定义

### 里程碑 M1：护栏建立

- 命名、目录、边界规则明确
- 核心改造文件目标映射完成

### 里程碑 M2：workflow / scheduler 收口完成

- job、signal、query 拆分落地
- 主链路回归通过

### 里程碑 M3：action dispatcher 收口完成

- mutation write path 进入 repository 边界
- action dispatcher 不再混写 Prisma

### 里程碑 M4：scheduler runtime 收口完成

- ownership / lease / rebalance 独立 repository 落地
- runtime 文件职责收缩

### 里程碑 M5：兼容清理完成

- 删除旧桥接、旧路径、无意义 fallback
- 测试与文档同步完成

---

## 7. 预期结果

完成本计划后，代码库应达到以下状态：

- Prisma 仍继续使用，但主要集中在 infra/store/repository 边界。
- 核心业务服务回归 orchestration / rule / query composition 职责。
- kernel-side、pack-owned、projection、audit 的边界在代码与文档中都可见。
- 后续做 schema 调整、migration 收口、文档补充、甚至更换持久化策略时，影响面显著变小。
- 阶段末不会遗留未上线项目不需要承担的兼容负担。

---

## 8. 暂不在本计划内展开的事项

以下工作与本阶段相关，但不在本计划内深挖：

- 将 `AppContext` 全量改造为 repository container
- 重构 `SimulationManager` 的实例创建方式
- 多数据库后端适配
- pack runtime 存储系统重做
- 全量 service/query 模块一次性统一迁移

这些内容应在本阶段完成后，再基于新的边界继续推进。
