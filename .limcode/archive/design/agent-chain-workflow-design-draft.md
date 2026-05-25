# Agent Chain / Workflow 设计草案

本文档分析在 Yidhras 中实现 agent 间串行链、并行 fan-out 和 DAG 工作流的问题与方案，作为讨论起点。

**前提**: 项目未上线，无重要生产数据，无需和他人协作开发，接受大范围重构/重写，不接受向后兼容。

**当前方向**: 方案 C（Workflow Engine）作为主线，方案 F 已放弃。

**已闭合的 Phase 1 决策**:
- Workflow 触发机制：Phase 1 仅支持声明式 workflow（pack YAML 预定义，`manual` / `event` 触发）；模型不能动态创建 workflow，后续只预留“模型触发已声明 workflow”的扩展方向。`manual` 仅表示外部/调试/API 显式触发，不由模型自由构造 DAG。
- Action 落地策略：同 tick 内多 step 的 ActionIntent 暂存，step5 统一 dispatch；跨 tick 时每个 tick 完成的 step 在该 tick step5 正常落地；Phase 1 不支持“全成功才落地”的事务模式，失败走 narrativized fallback，不回滚。
- Partition 策略：Phase 1 支持跨 partition workflow；采用中心化 Workflow Engine 编排，partition 仅作为 agent/job 的执行归属。
- 同 tick 快速路径：Phase 1 支持同 tick 跨 partition 快速路径，但必须受 workflow advance budget 限制。
- Lock 策略：Phase 1 YAML schema 只接受 `lock_policy: active_steps`；内部 TypeScript 类型可以预留 `whole_workflow`，但 pack validation 必须拒绝 `whole_workflow`，避免半支持状态。
- Condition：Phase 1 仅支持单字段 `eq` / `neq`；内部类型预留 `all_of` / `any_of`，但 Phase 1 validation 拒绝组合条件。缺失字段一律是 `condition_error`，不是 false，也不能被当作 `neq` 成功。

---

## 1. 问题定义

### 1.1 当前能做什么

世界包作者目前可以让多个 agent 协调工作，但只能通过**间接机制**：

- **跨 tick 事件循环**: Agent A 在 tick N 行动 → 世界状态变更 + 事件发出 → 调度器在 tick N+1 检测到事件信号 → 激活 Agent B。这是目前唯一的结构化多步协调路径。
- **跨 agent 工具调用** (`cross_agent_tool.ts`): Agent A 在 tool loop 中向 Agent B 发起单次请求-响应查询。这是模型驱动的（模型自己决定调用），非结构性保证。
- **世界状态作为隐式通信通道**: Agent A 写入 entity state → Agent B 通过 context assembly 读到该状态。

### 1.2 当前不能做什么

- **结构性串行链**: 无法声明 "Agent A 执行完后，Agent B 必须以 A 的输出为输入执行"。目前只能靠调度器的启发式信号检测，不保证 B 一定在 A 之后激活。
- **并行 fan-out / gather**: 无法声明 "A 和 B 同时执行，两者都完成后 C 执行"。
- **条件分支**: 无法声明 "如果 A 的输出满足条件 X，则执行 B；否则执行 C"。
- **数据流**: 无法声明 "A 的推理结果直接作为 B 的 context assembly 输入"。目前 B 只能通过世界状态或事件的间接方式感知 A 的行为。
- **事务性**: 无法声明 "A → B → C 全成功或全回滚"。

### 1.3 典型场景

1. **商议/投票**: 多个 agent 独立决策 → 汇总 → 产生集体决议
2. **审批链**: Agent A 提议 → Agent B 审核 → Agent C 批准/否决
3. **分工协作**: Agent A 收集信息 → Agent B 分析 → Agent C 执行
4. **对峙/谈判**: Agent A 提出条件 → Agent B 回应 → Agent A 再回应（同 tick 内多轮）
5. **复合仪式**: 多步骤、多角色的结构化流程

---

## 2. 现状分析：相关模块解剖

### 2.1 模拟循环 (PackSimulationLoop.ts)

```
每 tick 7 步串行:
  step1_expireBindings  — 过期身份绑定
  step2_worldEngine      — Rust sidecar 世界状态更新
  step3_agentScheduler   — 决定哪些 agent 在本 tick 激活
  step4_decisionJobs     — 为已激活 agent 并发运行推理 (runWithConcurrency)
  step5_actionDispatch   — 处理已确定的动作
  step6_perception       — 感知管线
  step7_projection       — 投影计算
```

关键事实：
- 步骤之间是串行的，步骤内部可以并发
- step4 是所有 agent 决策的唯一入口
- 同一 tick 内，所有 agent 看到相同的世界状态快照（step3 之后的快照）
- step4 内部没有 agent 间依赖——所有 job 独立并发执行
- 同实体 single-flight 约束：同一实体不能同时有多个活跃 workflow
- overlap guard：如果上一 tick 仍在执行（`in_flight=true`），当前 tick 跳过

### 2.2 调度器 (agent_scheduler.ts)

调度器是 agent 激活的守门人。当前调度逻辑（由 Rust sidecar `scheduler_decision_kernel` 执行）：

- **periodic_tick**: 每个 agent 有 cooldown，冷却结束后可被周期性激活
- **event_driven**: 事件信号触发 agent 激活（event_followup、relationship_change_followup、snr_change_followup、overlay_change_followup、memory_change_followup）
- **recovery**: replay_recovery / retry_recovery 窗口
- **抑制机制**: pending job 去重、active workflow 检测、per-tick activation budget、entity single-flight limit

调度器是 **per-partition** 运行的（`SCHEDULER_PARTITION_COUNT` 可配置，默认 4），partition 之间并发执行。调度器不知道 agent 之间的依赖关系——它独立评估每个 agent 是否应该激活。

### 2.3 Job Runner (job_runner.ts)

```
listRunnableDecisionJobs → runWithConcurrency(jobs, concurrency, async job => {
  claimDecisionJob → hasActiveWorkflowForActor(双重检查) → inferenceService.executeDecisionJob
})
```

关键事实：
- 并发数由 `scheduler_runner.decision_job.concurrency` 配置控制
- 每个 job 在 claim 成功后还会二次复核同实体是否有其他活跃 workflow
- job 之间完全独立，无数据传递

### 2.4 跨 Agent 工具 (cross_agent_tool.ts)

```
Agent A (tool loop) → query_agent(target=B, query) → AiTaskService.runTask() → Agent B 推理 → 返回结果给 A
```

关键事实：
- 同步请求-响应模式（A 等待 B 完成）
- 模型驱动（A 的模型决定何时调用、查询什么）；从当前 `cross_agent_tool.ts` 看，`target_agent_id` 只是工具参数/返回元数据，不创建目标 agent 的调度器 DecisionJob，也不建立结构化 workflow step。
- 无结构性保证（模型可以不调用）
- B 的推理结果直接返回给 A 的 tool loop，不走世界状态
- 这是一次性的信息交换，不是工作流编排

### 2.5 行为树 (behavior_tree/)

当前支持的组合节点：
- `Selector`: 优先级 OR，子节点依次求值，首个成功即返回
- `Sequence`: AND，子节点依次求值，全部成功才成功。当前 registry 递归校验 sequence 子树；每个 sequence 直接子节点中最多一个 `action` 或 `llm_decision` 叶子（多 action 链式执行被推迟）。
- `llm_decision` 在 schema 类型中存在，但当前 registry 明确拒绝，直到 AI Gateway wiring 完成。

明确不支持的：
- `type: parallel` — 在 schema 验证阶段被拒绝
- 跨 agent 节点 — 不存在此概念

### 2.6 推理工作流 (inference_workflow/)

`inference_workflow.ts` 和 `inference_workflow/` 目录是**单 agent** 决策的持久化层，管理 DecisionJob 和 ActionIntent 的生命周期。不是多 agent 编排。

### 2.7 现有崩溃恢复机制

DecisionJob 有 `lock_ticks`、worker ID、lock expiry 和 recovery window（replay_recovery / retry_recovery）。幂等键格式：`sch:{agentId}:{tick}:{kind}:{reason}`（per-agent per-tick 粒度）。

---

## 3. 核心架构挑战

### 3.1 Tick 模型的根本张力

当前模拟循环的核心假设是：**每个 tick 内，世界状态是一致的只读快照**。所有 agent 在同一 tick 内基于相同的世界状态做出决策。这保证了可重复性和可调试性。

Agent 链的核心需求——"B 以 A 的输出为输入"——直接挑战了这个假设。如果 A 和 B 在同 tick 内串行执行，B 看到的世界状态应该包含 A 刚刚产生的效果，但这意味着 tick 内部状态在变化。

**这是最根本的设计冲突。** 解决方向：同 tick 内链式 agent 共享世界状态快照（不落地中间状态），仅通过 DecisionResult 做数据传递。世界状态的实际推进发生在 step5 action dispatch（tick 结束时统一落地）。

### 3.2 调度器角色的重新定义

当前调度器是"独立评估每个 agent 是否激活"。如果引入 agent 链，调度器需要理解：
- 依赖关系：B 依赖于 A 的完成
- 数据流：B 需要 A 的输出来组装 context
- 条件激活：B 是否激活取决于 A 的输出内容

这会让调度器从"启发式激活判断器"变成"工作流编排器"——职责变化很大。

### 3.3 失败语义

链式执行的失败处理：
- 如果 A → B → C，B 失败了，C 怎么办？
- 如果 B 失败是因为模型返回了无法接地（ground）的意图，这是技术失败还是语义失败？
- 是否需要事务性回滚？回滚什么？A 已经产生的世界状态变更？

当前系统通过 `narrativized fallback` 处理语义失败——失败本身成为叙事的一部分。链式工作流应复用这个语义：某步失败 → 后续步骤 narrativized，已落地的世界效果不回滚。

### 3.4 并发控制

当前的 single-flight 约束是简单的：同实体不能同时有多个活跃 workflow。agent 链引入的问题：

- 如果 Agent A 在一个链中，另一个链也想激活 Agent A，怎么办？
- 如果 Agent A 在等待 Agent B（跨 tick），A 算"活跃"吗？
- 循环依赖检测：A 依赖 B，B 依赖 A？

### 3.5 数据传递机制

Agent A 的输出如何成为 Agent B 的输入：

a. **通过世界状态**: A 的 action 落地为 entity state 变更 → B 通过 context assembly 读到（跨 tick 可用，tick 内不可用）
b. **通过事件**: A 的 action 产生事件 → B 的 context 包含该事件（跨 tick，异步）
c. **直接传递**: A 的 DecisionResult 直接注入 B 的 context assembly（tick 内可用）
d. **通过共享 overlay**: A 写入临时 overlay → B 读取（单 agent 工作层）

### 3.6 前端/可观测性

- 当前 projection 系统按 entity 聚合。链式工作流的中间状态如何展示？
- workflow trace 是单 agent 的。链需要跨 agent 的 trace。
- 如果链跨多个 tick，前端如何展示进度？

### 3.7 分区感知

调度器是 per-partition 运行的（默认 4 个 partition）。如果 Agent A 在 partition 1、Agent B 在 partition 2，chain A → B 跨 partition：
- 是否需要 co-locate chain 成员到同一 partition？partition 分配算法需要感知 chain 成员关系。
- 如果不 co-locate，跨 partition 的 chain 如何保证执行顺序（partition 之间是并发执行的）？

### 3.8 崩溃恢复语义

chain/workflow 跨 tick 执行意味着中间状态必须持久化：
- 进程在 chain 执行到第 2 步时崩溃，重启后从哪步恢复？
- chain 状态持久化到哪——扩展 DecisionJob 表还是新建表？
- 如何避免重启后重复执行？现有幂等键是 per-agent per-tick 的，chain 需要自己的幂等键命名空间。

### 3.9 overlap guard 与 tick 耗时

当前 loop 有 overlap guard：如果上一 tick 还在执行，下一 tick 跳过。chain 可能延长 step4 耗时，增加 overlap skip 频率，影响 tick 推进速率和虚拟时钟语义。

---

## 4. 选定方案

### 4.1 方案 C: Workflow Engine — 独立编排层（主线）

**思路**: 在 step4 内部引入独立的 Workflow Engine。Workflow 是 pack YAML 中声明的一等概念，有独立的生命周期（创建、执行、完成、失败）。

#### 4.1.1 核心模型

```yaml
workflows:
  proposal_review:
    trigger:
      type: manual           # manual | event（后续版本可扩展其他触发类型）
    steps:
      - id: draft
        agent: proposer
        inference:
          provider: behavior_tree
          behavior_tree: draft_proposal
      - id: review
        agent: reviewer
        depends_on: [draft]
        input_from: [draft]         # reviewer 的 context 包含 proposer 的 DecisionResult
      - id: approve
        agent: approver
        depends_on: [review]
        input_from: [review]
        condition:                   # 条件分支（初期仅支持单字段 eq/neq，schema 预留 all_of/any_of 组合条件扩展位置）
          field: review.grounding_result.type
          op: eq
          value: exact               # 字段缺失 => condition_error，不是 false/neq 成功
      - id: fallback_narrate
        agent: narrator
        depends_on: [review]
        condition:
          field: review.grounding_result.type
          op: neq
          value: exact
    failure_policy: narrativize  # 某步失败时，后续步骤转为叙事化失败
    max_ticks: 10                # 超时后强制结束
```

#### 4.1.2 与模拟循环的关系

Workflow Engine 在 step4 内部运行，不替换 tick 循环：

```
step3_agentScheduler  → 为独立 agent 创建 DecisionJob（同现在）
                       → 为 workflow 起始 step 的 agent 创建 DecisionJob（如果触发条件满足）
step4_decisionJobs    → WorkflowEngine.advance(tick):
                       1. 中心化扫描所有活跃 workflow run 和 step run
                       2. 对每个 workflow，找出当前就绪的 step（依赖已满足 + 条件通过）
                       3. 按 step 所属 agent/partition 下发执行；partition 只作为执行归属，不拥有编排权
                       4. 并发执行同一 workflow 内同轮次的所有就绪 step
                       5. 每轮完成后，如果下一轮依赖已满足，继续推进（支持同 tick 跨 partition 快速路径）
                       6. 受 workflow advance budget 限制；超过预算的 ready step 延后到下 tick
                       7. 跨 tick：本轮无法完成的 step，标记状态，下个 tick 继续
                       → 独立 agent 的 DecisionJob 并发执行（同现在）
                       → 单 tick 快速路径：当 workflow 所有 step 的 depends_on 在同 tick 内已满足，
                         engine 可在一次 step4 期间全部执行完毕，不拆分到多 tick；该快速路径允许跨 partition
step5_actionDispatch  → workflow step 产生的 ActionIntent 和独立 agent 的 ActionIntent 统一处理
```

**关于"方案 E 双路径"问题的处理**：不维护两条代码路径。step4 只有一条路径——由 Workflow Engine 统一驱动。不使用 workflow 的 pack，Workflow Engine 退化为直通模式：调度器产生的 DecisionJob 直接执行，行为与现在完全一致。

**Workflow advance budget**：跨 partition 快速路径会延长 step4，因此 Phase 1 必须引入 workflow 推进预算。至少需要配置 `max_rounds_per_tick`、`max_steps_per_tick`、`max_wall_time_ms_per_tick`。超过预算时，已完成 step 的 ActionIntent 仍进入本 tick step5，未执行的 ready step 保持 ready/running 状态并在后续 tick 继续推进。


#### 4.1.3 数据传递（吸收方案 A/G 的 `input_from` 和事件信封思路）

Agent A 的输出传递给 Agent B 的机制：

- **`input_from`（直接传递，同 tick 内）**: A 的 DecisionResult（reasoning、decision、grounding_result）序列化为结构化 JSON，作为 B 的 context assembly 的一个 source（`source_type: previous_agent_output`）。这是主要数据通道。
- **事件信封（跨 tick 传递）**: 当 workflow 跨 tick 时，前一步的 DecisionResult 摘要写入 workflow state 表。下一步激活时从 state 表读取——不依赖事件系统（事件路径仅用于触发新 workflow 的起始，不用于 step 间数据传递）。
- **世界状态（间接传递）**: A 的 action 落地后的世界效果，B 通过正常的 context assembly 路径读到。跨 tick 自动可用；同 tick 内，B 只看到本 tick 开始时的世界快照（A 的 action 尚未在 step5 落地）。

**选择"先暂存"**：同 tick 内多 step 执行时，中间 step 的 action 暂存（不落地世界状态），仅 DecisionResult 向下传递。世界状态在 step5 统一落地。这避免了方案 B 的核心矛盾——tick 内世界状态一致性得以保持。

**同 tick 内 action 排序语义**：暂存的 ActionIntent 保留 deterministic ordering。workflow 内部按 DAG 拓扑层级、YAML step 声明顺序、step 内 action 顺序排序。workflow action 与普通 DecisionJob action 一起进入 step5 的统一 deterministic dispatch ordering；workflow 不获得天然覆盖优先级。同 entity 同属性冲突不通过 workflow 特权解决，应由现有/后续 action adjudication、authority 或 dispatch 冲突规则处理。

#### 4.1.4 调度器集成（选择"分层"关系）

调度器与 Workflow Engine 的关系采用**分层**模式：

- **调度器（step3）**: 负责"哪些 agent 参与本 tick"。对 workflow 参与的 agent，调度器仍然按现有逻辑评估（cooldown、信号），但只对 workflow 的**起始 step agent** 创建 DecisionJob。
- **Workflow Engine（step4）**: 负责"agent 以什么顺序和依赖执行"。当起始 step 完成后，Engine 自动为后续 step 创建 DecisionJob（不经过调度器）。

这意味着：
- workflow 起始 step 的 agent 仍受调度器 cooldown 和 single-flight 约束——workflow 不会让 agent 绕过抑制机制
- 后续 step 的 agent 由 Workflow Engine 直接调度——不受 cooldown 限制（它们已在链中），但仍受 single-flight 约束（如果该 agent 有其他活跃 workflow，新 step 等待）

#### 4.1.5 分区策略

Phase 1 支持 **跨 partition workflow**。

实现方式：采用**中心化 Workflow Engine** 编排所有 workflow run。调度器 partition 仍然决定 agent/job 的执行归属与并发边界，但不拥有 workflow DAG 的推进权。跨 partition step 的依赖、condition、ready/running/completed 状态由中心化 Workflow Engine 统一判断。

关键语义：
- workflow 不要求 step agent co-locate 到同一 partition。
- A 在 partition 1、B 在 partition 2 时，A 完成后 B 可以在同一个 tick 的后续 workflow advance round 中执行。
- 同 tick 跨 partition 快速路径仍然共享 tick 开始时的世界状态快照，step 间只通过 `previous_agent_output` 传递中间结果。
- partition 间不通过互相发信号推进 workflow；所有 step 状态以 WorkflowRun / WorkflowStepRun 持久化状态为事实源。

#### 4.1.6 持久化与崩溃恢复

新增 `WorkflowRun` 与 `WorkflowStepRun` 表（kernel-side Prisma）。跨 partition Phase 1 不使用 `WorkflowRun.step_results` JSON blob 承载全部 step 状态；step 级状态必须独立持久化。

```typescript
interface WorkflowRun {
  id: string;
  workflow_name: string;
  pack_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'narrativized' | 'timed_out';
  created_tick: bigint;
  last_advance_tick: bigint;
  max_ticks: number;
  trigger_type: 'manual' | 'event';
  trigger_ref: string | null;
  // 崩溃恢复字段
  lock_worker_id: string | null;
  lock_expires_at: bigint | null;
  // 幂等键
  idempotency_key: string;      // wf:{pack_id}:{workflow_name}:{trigger_type}:{trigger_tick}:{trigger_ref}
}

interface WorkflowStepRun {
  id: string;
  workflow_run_id: string;
  step_id: string;
  agent_id: string;
  partition_id: number;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'failed' | 'skipped' | 'narrativized' | 'timed_out';
  dependency_step_ids: string[];
  input_step_ids: string[];
  result_json: unknown | null;
  error_json: unknown | null;
  action_intent_ids: string[];
  started_tick: bigint | null;
  completed_tick: bigint | null;
  lock_worker_id: string | null;
  lock_expires_at: bigint | null;
  idempotency_key: string;      // wfstep:{workflow_run_id}:{step_id}:{attempt}
}
```

Step 状态机：
- `pending -> ready`: 依赖 step 全部 completed 且 condition 为 true。
- `pending -> skipped`: 依赖满足但 condition 为 false。
- `pending -> narrativized`: condition evaluation error（包括字段缺失、路径类型错误、引用未 completed step），Phase 1 固定按 `failure_policy: narrativize` 处理；不进入 skipped。
- `ready -> running`: claim 成功并获得 agent single-flight。
- `running -> completed`: 推理、grounding 与 ActionIntent 生成成功。
- `running -> failed/narrativized/timed_out`: 技术失败、语义失败或超时，按 `failure_policy` 处理。

崩溃恢复：
- 进程崩溃后重启，Workflow Engine 扫描 `status='running'` 且 run/step lock 过期的 workflow run / step run。
- 根据 WorkflowStepRun 的状态恢复：过期 `running` step 回到可重试/失败处理路径，`completed` step 不重复执行。
- WorkflowStepRun 的幂等键避免同一 step 被重复触发。
- ActionIntent 需要记录 `source_workflow_run_id`、`source_workflow_step_id`、`source_step_attempt`，避免 recovery 重跑时重复落地。

#### 4.1.7 single-flight 与 workflow 锁定

- Phase 1 在 YAML schema 中提供 `lock_policy` 配置入口，但只接受 `active_steps`。
- Phase 1 默认并实现 `active_steps`：只有已 claim 的 `running` step 锁定其 agent；`pending`、未 claim 的 `ready`、`completed`、`skipped`、`failed` step 不锁定 agent。
- `whole_workflow` 表示 workflow 生命周期内锁定所有参与 agent。该枚举只允许存在于内部 TypeScript 类型和文档说明中；Phase 1 pack YAML validation 必须拒绝它，避免 pack 作者以为该行为已实现。
- `hasActiveWorkflowForActor` 需要升级为全局 single-flight 检查，覆盖普通 DecisionJob 与 WorkflowStepRun，不能只在 partition 内判断。
- 每个 workflow step 产生的 ActionIntent，其 `adjudging_entity` 是该 step 声明的真实 agent（不是 workflow 虚拟实体）
- 如果另一个 workflow 或普通 DecisionJob 想激活同一个 agent，只有在该 agent 已被 running step 或其他活跃 workflow job 锁定时才等待。

#### 4.1.8 context assembly 扩展

新增 context source type `previous_agent_output`：

```typescript
interface PreviousAgentOutputSource {
  source_type: 'previous_agent_output';
  step_id: string;
  agent_id: string;
  content: {
    reasoning: string | null;
    decision_summary: string | null;
    grounding_result_type: 'exact' | 'translated' | 'narrativized' | 'blocked';
    semantic_intent: string | null;
  };
}
```

这个 source 在 context assembly 的 source resolution 阶段注入（与 perception rules、entity state、events、overlays 平行）。Prompt template 通过 slot 引用：`{{previous_agent_output.review.reasoning}}`。

---

## 5. 已放弃方案

### 5.1 方案 F: 虚拟 Agent / Macro Agent — 已放弃

**放弃原因**：方案 F 的核心优势（零 tick 循环改动、零调度器改动、复用现有 crash recovery）在方案 C 中已通过以下方式部分覆盖或更明确地替代：

1. Workflow Engine 在 step4 内部运行，不替代 tick 循环
2. 调度器分层集成——只管起始 step，后续 step 由 Engine 接管
3. WorkflowRun / WorkflowStepRun 提供 workflow 级与 step 级恢复事实源
4. 全局 single-flight 统一裁决普通 DecisionJob 与 WorkflowStepRun 的 agent 冲突
5. 单 tick 快速路径保证简单链的性能，并允许跨 partition

方案 F 不支持 fan-out / DAG / 条件分支 / 跨 tick 执行，且虚拟 agent 的 action 归属问题需要额外设计（action 以谁的名义落地？），这些在方案 C 中自然解决——每个 step 以真实 agent 名义产生 ActionIntent。

---

## 6. 已闭合的架构决策

以下决策作为进入详细设计的 Phase 1 基线：

1. **Workflow 的触发机制**
   - Phase 1 仅支持声明式 workflow：YAML 预定义，pack 加载时注册。
   - Phase 1 trigger 支持 `manual` / `event`。
   - 模型不能动态创建 workflow。
   - 后续仅预留“模型触发已声明 workflow”的扩展方向，不预留模型生成任意 workflow 结构。

2. **Chain 内 agent 的 action 落地策略**
   - 同 tick 内多 step：中间 step 的 ActionIntent 暂存，不落地世界状态；tick 结束时在 step5 统一 dispatch。
   - 跨 tick：每个 tick 的 step 完成后正常进入 step5 action dispatch；下一个 tick 的后续 step 可以看到已更新的世界。
   - Phase 1 不支持“全成功才落地”的事务模式。
   - 失败走 `failure_policy: narrativize` 等策略，不回滚已落地世界效果。
   - workflow 内部 action 排序按 DAG 拓扑层级、YAML step 声明顺序、step 内 action 顺序确定；workflow 与普通 DecisionJob action 不设天然优先级。

3. **跨 partition support**
   - Phase 1 支持跨 partition workflow。
   - 不要求同一 workflow 的 step agent 位于同一 partition。
   - 采用中心化 Workflow Engine 编排，partition 只作为 agent/job 执行归属。
   - 支持同 tick 跨 partition 快速路径：A 在 partition 1 完成后，B 可以在同一个 tick 的后续 advance round 于 partition 2 执行。
   - 快速路径必须受 workflow advance budget 限制。

4. **single-flight / lock_policy**
   - Phase 1 YAML schema 提供 `lock_policy` 配置入口，但只接受 `active_steps`。
   - Phase 1 默认并实现 `active_steps`。
   - `whole_workflow` 表示 workflow 生命周期内锁定所有参与 agent，但该行为仅作为内部类型/文档预留；Phase 1 validation 必须拒绝。
   - single-flight 必须升级为全局检查，覆盖普通 DecisionJob 与 WorkflowStepRun。

5. **Condition 扩展路径**
   - Phase 1 仅支持单字段 `eq` / `neq` 条件。
   - 内部类型预留 `all_of` / `any_of` 组合条件，但 Phase 1 validation 拒绝组合条件。
   - condition 只读取当前 workflow run 内 completed step 的 result，不读取实时世界状态或其他 workflow 状态。
   - 缺失字段一律产生 `condition_error`，按 `failure_policy: narrativize` 处理；不能被当作 false，也不能被当作 `neq` 成功。

6. **持久化与恢复**
   - Phase 1 使用 `WorkflowRun` + `WorkflowStepRun`。
   - 不把 step 状态全部塞进 `WorkflowRun.step_results` JSON blob。
   - step 级幂等键、step lock、ActionIntent 来源字段是跨 partition 恢复的必要组成。

---

## 7. Phase 1 落地规格补充

本节把前文架构主张收敛为实现时必须遵守的文件范围、接口定义和测试清单。项目当前未上线且接受大范围重构/重写，因此 Phase 1 不保留含糊兼容语义：遇到半支持状态一律通过 validation 拒绝，而不是静默降级。

### 7.1 当前代码基线与不一致点

以下基线来自当前代码，作为后续实现的改造入口：

| 主题 | 当前代码事实 | Phase 1 改造要求 |
|---|---|---|
| tick loop | `PackSimulationLoop.ts` step4 当前直接调用 `runDecisionJobRunner()` | step4 必须改为 workflow-aware 单入口；不能并存“普通 job runner 路径”和“workflow runner 路径”两套语义 |
| 普通 DecisionJob | `job_runner.ts` 通过 `listRunnableDecisionJobs -> claimDecisionJob -> inferenceService.executeDecisionJob` 执行 | 普通 job 执行逻辑可复用，但必须被 Workflow Engine 统一调度/包装 |
| scheduler partition | `agent_scheduler.ts` 按 partition lease/filter agent | workflow DAG 推进权不能放进 partition scheduler；partition 只保留执行归属 |
| single-flight | `entity_activity_query.ts` 当前只查 active `DecisionJob` + `ActionIntent` | 必须加入 `WorkflowStepRun(status='running')`，形成全局 actor active 检查 |
| cross-agent tool | `cross_agent_tool.ts` 的 `target_agent_id` 不创建目标 agent DecisionJob | 不作为 workflow 实现基础，只作为现有一次性工具能力保留 |
| behavior tree | `llm_decision` schema 存在但 registry 拒绝；`parallel` 被拒绝 | workflow 示例不得依赖未实现 BT `llm_decision`；workflow DAG 自己支持 fan-out/gather |
| context source | 当前代码中不存在 `previous_agent_output` | 必须新增 typed source，并接入 context assembly 与 prompt slot 输入 |
| persistence | 当前 Prisma schema 没有 `WorkflowRun` / `WorkflowStepRun` | 必须新增表和 repository；不能用单个 JSON blob 承载全部 step 状态 |

### 7.2 World Pack YAML schema

Phase 1 在 world pack 顶层新增可选字段 `workflows`。工作流只能由 pack 声明；模型不能创建任意 workflow 结构。

```typescript
export interface PackWorkflowMap {
  [workflowName: string]: PackWorkflowDefinition;
}

export interface PackWorkflowDefinition {
  trigger: WorkflowTriggerDefinition;
  steps: WorkflowStepDefinition[];
  failure_policy?: WorkflowFailurePolicy; // Phase 1 default: narrativize
  max_ticks: number;
  lock_policy?: WorkflowLockPolicy;       // Phase 1 accepts only active_steps
}

export type WorkflowTriggerDefinition =
  | {
      type: 'manual';
    }
  | {
      type: 'event';
      event_types: string[];
    };

export type WorkflowFailurePolicy = 'narrativize';

export type WorkflowLockPolicy = 'active_steps' | 'whole_workflow';

export interface WorkflowStepDefinition {
  id: string;
  agent: string;
  depends_on?: string[];
  input_from?: string[];
  condition?: WorkflowConditionDefinition;
  inference: WorkflowStepInferenceDefinition;
}

export type WorkflowStepInferenceDefinition =
  | {
      provider: 'behavior_tree';
      behavior_tree: string;
    }
  | {
      provider: 'openai_compatible';
      model: string;
    }
  | {
      provider: 'anthropic';
      model: string;
    };

export interface WorkflowConditionDefinition {
  field: string;
  op: 'eq' | 'neq';
  value: string | number | boolean | null;
}
```

Validation 规则：

- `workflowName`、`step.id`、`step.agent` 必须是非空字符串。
- `steps` 必须非空。
- `step.id` 在同一 workflow 内必须唯一。
- `depends_on` / `input_from` 引用的 step 必须存在。
- `depends_on` 图必须是 DAG；任何循环依赖都拒绝加载 pack。
- `input_from` 的 step 必须在 DAG 上可达且必须能在当前 step 之前完成；引用后置 step 拒绝加载 pack。
- `trigger.type='event'` 时 `event_types` 必须是非空数组。
- `trigger.type='manual'` 时不得配置 `event_types`。
- `failure_policy` Phase 1 只接受 `narrativize`；其他值拒绝加载 pack。
- `lock_policy` Phase 1 只接受缺省或 `active_steps`；`whole_workflow` 虽在内部类型预留，但 YAML validation 必须拒绝。
- condition Phase 1 只接受 `{ field, op, value }`；`all_of` / `any_of` 组合条件一律拒绝加载 pack。
- `inference.provider` 必须使用当前已有 provider：`behavior_tree` / `openai_compatible` / `anthropic`。`model_routed` 不在当前代码 schema 中，Phase 1 不使用该值。

受影响文件：

- `apps/server/src/packs/schema/constitution_schema.ts`
- `apps/server/src/packs/manifest/loader.ts`
- `apps/server/src/packs/openings/applicator.ts`（如果 opening 允许覆盖 workflow，需要明确 merge 规则；Phase 1 默认不允许 opening 修改 workflow）
- `docs/specs/WORLD_PACK.md`

### 7.3 Workflow Engine 接口

Phase 1 新增中心化 engine。step4 只调用一个 workflow-aware 入口。

```typescript
export interface WorkflowEngine {
  advance(input: WorkflowAdvanceInput): Promise<WorkflowAdvanceResult>;
  triggerWorkflow(input: TriggerWorkflowInput): Promise<WorkflowRunRecord>;
  recoverExpiredRuns(input: WorkflowRecoveryInput): Promise<WorkflowRecoveryResult>;
}

export interface WorkflowAdvanceInput {
  context: AppContext;
  inferenceService: InferenceService;
  packRuntime: PackRuntimePort;
  workerId: string;
  tick: bigint;
  budget: WorkflowAdvanceBudget;
}

export interface WorkflowAdvanceBudget {
  max_rounds_per_tick: number;
  max_steps_per_tick: number;
  max_wall_time_ms_per_tick: number;
}

export interface WorkflowAdvanceResult {
  advanced_run_count: number;
  executed_step_count: number;
  completed_run_count: number;
  failed_run_count: number;
  narrativized_run_count: number;
  budget_exhausted: boolean;
}

export interface TriggerWorkflowInput {
  context: AppContext;
  packRuntime: PackRuntimePort;
  workflow_name: string;
  trigger_type: 'manual' | 'event';
  trigger_ref: string | null;
  trigger_tick: bigint;
}

export interface WorkflowRecoveryInput {
  context: AppContext;
  packRuntime: PackRuntimePort;
  workerId: string;
  tick: bigint;
}

export interface WorkflowRecoveryResult {
  expired_run_count: number;
  expired_step_count: number;
  recovered_step_count: number;
  failed_step_count: number;
}
```

step4 改造目标：

```typescript
step4_decisionJobs -> runWorkflowDecisionStep({
  context,
  inferenceService,
  workerId,
  packRuntime,
  workflowEngine
})
```

`runWorkflowDecisionStep` 内部顺序固定为：

1. `workflowEngine.recoverExpiredRuns(...)`
2. `workflowEngine.advance(...)`
3. 执行不属于 workflow 的普通 DecisionJob，或由 engine 的直通模式执行普通 DecisionJob。

不允许普通 DecisionJob 绕过同一个 actor single-flight 检查。

受影响文件：

- `apps/server/src/app/runtime/PackSimulationLoop.ts`
- `apps/server/src/app/runtime/job_runner.ts`
- 新增 `apps/server/src/app/runtime/workflow_decision_step.ts`
- 新增 `apps/server/src/app/services/workflow/workflow_engine.ts`

### 7.4 Workflow repository 与 Prisma model

Phase 1 新增 Prisma model，字段命名使用当前数据库风格的 snake_case。

```prisma
model WorkflowRun {
  id                String   @id @default(cuid())
  workflow_name     String
  pack_id           String
  status            String
  created_tick      BigInt
  last_advance_tick BigInt
  max_ticks         Int
  trigger_type      String
  trigger_ref       String?
  lock_worker_id    String?
  lock_expires_at   BigInt?
  idempotency_key   String   @unique
  created_at        BigInt
  updated_at        BigInt

  steps             WorkflowStepRun[]

  @@index([pack_id, status])
  @@index([status, lock_expires_at])
}

model WorkflowStepRun {
  id                  String   @id @default(cuid())
  workflow_run_id     String
  workflow_run        WorkflowRun @relation(fields: [workflow_run_id], references: [id], onDelete: Cascade)
  step_id             String
  agent_id            String
  partition_id        Int
  status              String
  dependency_step_ids Json
  input_step_ids      Json
  result_json         Json?
  error_json          Json?
  action_intent_ids   Json
  attempt             Int      @default(1)
  started_tick        BigInt?
  completed_tick      BigInt?
  lock_worker_id      String?
  lock_expires_at     BigInt?
  idempotency_key     String   @unique
  created_at          BigInt
  updated_at          BigInt

  @@unique([workflow_run_id, step_id, attempt])
  @@index([workflow_run_id, status])
  @@index([agent_id, status])
  @@index([status, lock_expires_at])
}
```

`ActionIntent` 扩展字段：

```prisma
source_workflow_run_id  String?
source_workflow_step_id String?
source_step_attempt     Int?

@@index([source_workflow_run_id])
@@index([source_workflow_step_id])
```

Repository 接口：

```typescript
export interface WorkflowRunRepository {
  createRun(input: CreateWorkflowRunInput): Promise<WorkflowRunRecord>;
  getRunById(id: string): Promise<WorkflowRunRecord | null>;
  getRunByIdempotencyKey(idempotencyKey: string): Promise<WorkflowRunRecord | null>;
  listActiveRuns(input: ListActiveWorkflowRunsInput): Promise<WorkflowRunRecord[]>;
  claimRun(input: ClaimWorkflowRunInput): Promise<WorkflowRunRecord | null>;
  updateRunStatus(input: UpdateWorkflowRunStatusInput): Promise<void>;
}

export interface WorkflowStepRunRepository {
  createStepRuns(input: CreateWorkflowStepRunsInput): Promise<WorkflowStepRunRecord[]>;
  listStepRuns(workflowRunId: string): Promise<WorkflowStepRunRecord[]>;
  listRunnableSteps(input: ListRunnableWorkflowStepsInput): Promise<WorkflowStepRunRecord[]>;
  claimStep(input: ClaimWorkflowStepInput): Promise<WorkflowStepRunRecord | null>;
  completeStep(input: CompleteWorkflowStepInput): Promise<void>;
  narrativizeStep(input: NarrativizeWorkflowStepInput): Promise<void>;
  failStep(input: FailWorkflowStepInput): Promise<void>;
}
```

受影响文件：

- `apps/server/prisma/schema.prisma`
- 新增 Prisma migration
- 新增 `apps/server/src/app/services/workflow/workflow_run_repository.ts`
- 新增 `apps/server/src/app/services/workflow/workflow_step_repository.ts`
- `apps/server/src/app/context.ts`
- `apps/server/src/app/services/repositories/*`（如果 repository 统一从 context 暴露）
- `apps/server/tests/helpers/*`（测试上下文需要 workflow repo mock 或 test database 支持）

### 7.5 Workflow step 执行结果与 ActionIntent 来源

Workflow step 的 `result_json` 只存可传递、可恢复的结构化摘要，不存任意 provider 原始对象。

```typescript
export interface WorkflowStepResultJson {
  reasoning: string | null;
  decision_summary: string | null;
  grounding_result: {
    type: 'exact' | 'translated' | 'narrativized' | 'blocked';
    semantic_intent: string | null;
  };
  inference_id: string | null;
  action_intent_ids: string[];
}

export interface WorkflowActionIntentSource {
  source_workflow_run_id: string;
  source_workflow_step_id: string;
  source_step_attempt: number;
}
```

写入规则：

- `inferenceService.executeDecisionJob()` 产生 ActionIntent 时，workflow step 必须把 `WorkflowActionIntentSource` 传入 sink。
- `apps/server/src/inference/sinks/prisma.ts` 当前用 `source_inference_id` upsert ActionIntent；Phase 1 保留该幂等基础，同时写入 workflow 来源字段。
- recovery 重跑同一 step attempt 时不得重复落地 ActionIntent；`source_inference_id` 与 `source_workflow_*` 字段必须能共同追踪来源。
- workflow step 的 `action_intent_ids` 必须在 step complete 时写回 `WorkflowStepRun.action_intent_ids`。

受影响文件：

- `apps/server/src/inference/types.ts`
- `apps/server/src/inference/trace_sink.ts`
- `apps/server/src/inference/sinks/prisma.ts`
- `apps/server/src/inference/service.ts`

### 7.6 `previous_agent_output` context source

新增 context source type：

```typescript
export interface PreviousAgentOutputSource {
  source_type: 'previous_agent_output';
  workflow_run_id: string;
  step_id: string;
  agent_id: string;
  content: {
    reasoning: string | null;
    decision_summary: string | null;
    grounding_result_type: 'exact' | 'translated' | 'narrativized' | 'blocked';
    semantic_intent: string | null;
  };
}
```

注入规则：

- 只允许读取当前 workflow run 内 `status='completed'` 的 step result。
- `input_from` 中列出的 step 每个生成一个 `previous_agent_output` source。
- prompt slot 对象形状固定为：`previous_agent_output[step_id]`。
- 示例：`{{previous_agent_output.review.reasoning}}`。
- 如果 `input_from` 引用的 step 未 completed，当前 step 不得进入 ready。

受影响文件：

- `apps/server/src/app/services/context/context_assembler.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/conversation/assembler.ts`（如果 prompt bundle 需要承载该 source）
- `apps/server/src/template_engine/*`（如果 slot 注入由模板引擎完成）
- `docs/subsystems/PROMPT_WORKFLOW.md`

### 7.7 Condition 精确定义

Phase 1 condition evaluator 返回固定三态：

```typescript
export type WorkflowConditionEvaluationResult =
  | { outcome: 'true' }
  | { outcome: 'false' }
  | { outcome: 'condition_error'; code: string; message: string };
```

规则：

- `field` 路径格式为 `<step_id>.<path...>`。
- `<step_id>` 必须是当前 workflow run 内已 completed step。
- 字段路径缺失：`condition_error`。
- 中间路径不是 object：`condition_error`。
- 引用不存在 step：validation 阶段拒绝；运行时遇到则 `condition_error`。
- 引用未 completed step：当前 step 保持 `pending`，不求值。
- `eq` 使用 JSON scalar 严格相等。
- `neq` 使用 JSON scalar 严格不相等；但字段缺失不等于 `neq` 成功。
- `condition_error` 固定进入 narrativized fallback，不进入 skipped。

### 7.8 架构边界位置

当前 server 架构边界由 `apps/server/eslint.config.mjs` 的 `boundaries/elements` 定义。Workflow 模块必须落在已有边界内；Phase 1 不新增 `src/app/workflow/**` 这种未被 boundary 识别的目录，除非同步修改 eslint boundary 配置。

当前 boundary 分类：

| boundary type | 当前匹配规则 | 与 workflow 的关系 |
|---|---|---|
| `app` | `src/app/services/**` | workflow engine、repository、condition、DAG、budget、pack workflow registry 放这里 |
| `app` | `src/app/runtime/**` | tick loop step4 glue / runner 放这里 |
| `app` | `src/app/context.*` | 如需暴露 workflow repos，从 AppContext 接入 |
| `packs` | `src/packs/**` | 只负责 pack schema/load/materialize workflow definitions，不执行 workflow |
| `inference` | `src/inference/**` | 只负责单次推理执行、trace sink、ActionIntent draft/source metadata，不编排 workflow DAG |
| `domain` | `src/domain/**` | 保持领域能力/调用分发，不承载 workflow engine |
| `core` | `src/core/**` | 不放 workflow engine；core 对 `app` value import 被 eslint 禁止，且 workflow engine 需要 AppContext / InferenceService |
| `transport` | `src/app/routes/**`, `src/app/http/**`, `src/app/middleware/**` | 只暴露 manual trigger / trace API，经 app service 调用，不直接 import domain/ai/core |

Phase 1 文件放置规则：

```text
apps/server/src/app/runtime/workflow_decision_step.ts
  - app/runtime 边界
  - PackSimulationLoop step4 的唯一入口 glue
  - 可调用 app/services/workflow 与现有 job_runner 复用函数

apps/server/src/app/services/workflow/workflow_engine.ts
apps/server/src/app/services/workflow/workflow_condition.ts
apps/server/src/app/services/workflow/workflow_dag.ts
apps/server/src/app/services/workflow/workflow_budget.ts
apps/server/src/app/services/workflow/workflow_run_repository.ts
apps/server/src/app/services/workflow/workflow_step_repository.ts
apps/server/src/app/services/workflow/workflow_types.ts
  - app/services 边界
  - 承载 workflow 编排、状态机、condition、DAG、budget、repository
```

依赖方向：

- `app/runtime` 可以依赖 `app/services/workflow`。
- `app/services/workflow` 可以依赖 `inference` 的类型/服务接口、`packs` 的 workflow definition 类型、`config` 的 runtime config、`clock`/`context` 等 infra。
- `packs` 不得依赖 `app/services/workflow`；pack 层只产出 validated workflow definitions。
- `inference` 不得依赖 `app/services/workflow`；workflow 来源字段通过类型/metadata 传入 sink，不让 inference 反向知道 engine。
- `core` 不得依赖 workflow engine。
- `transport` 如新增 API，只调用 `app/services/workflow` 或 app facade，不直接调用 `domain`/`ai`/`core`。

因此，本文所有 “workflow engine” 新文件统一放在 `apps/server/src/app/services/workflow/**`；runtime 只新增 `apps/server/src/app/runtime/workflow_decision_step.ts`。

### 7.9 受影响文件总表

| 范围 | 文件 |
|---|---|
| runtime loop | `apps/server/src/app/runtime/PackSimulationLoop.ts` |
| step4 runner | `apps/server/src/app/runtime/job_runner.ts`, 新增 `apps/server/src/app/runtime/workflow_decision_step.ts` |
| scheduler | `apps/server/src/app/runtime/agent_scheduler.ts`, `apps/server/src/app/runtime/scheduler_decision_kernel_port.ts` |
| single-flight | `apps/server/src/app/runtime/entity_activity_query.ts`, `apps/server/src/app/runtime/action_dispatcher_runner.ts` |
| workflow engine | 新增 `apps/server/src/app/services/workflow/workflow_engine.ts`, `workflow_condition.ts`, `workflow_dag.ts`, `workflow_budget.ts`, `workflow_types.ts` |
| persistence | `apps/server/prisma/schema.prisma`, 新增 migration, 新增 `apps/server/src/app/services/workflow/*` |
| inference | `apps/server/src/inference/service.ts`, `apps/server/src/inference/types.ts`, `apps/server/src/inference/trace_sink.ts`, `apps/server/src/inference/sinks/prisma.ts` |
| context/prompt | `apps/server/src/app/services/context/context_assembler.ts`, `apps/server/src/conversation/assembler.ts`, `apps/server/src/template_engine/*` |
| pack schema | `apps/server/src/packs/schema/constitution_schema.ts`, `apps/server/src/packs/manifest/loader.ts`, `docs/specs/WORLD_PACK.md` |
| docs | `docs/subsystems/PROMPT_WORKFLOW.md`, `docs/LOGIC.md`, `docs/ARCH.md` |
| frontend/API（如展示 workflow trace） | `apps/server/src/app/http/*`, `docs/specs/API.md`, `apps/web/*` |

### 7.10 测试文件清单

现有相关测试文件：

| 文件 | 当前关联范围 |
|---|---|
| `apps/server/tests/integration/agent-scheduler.spec.ts` | scheduler 基本行为 |
| `apps/server/tests/integration/scheduler-multi-worker-partitioning.spec.ts` | 多 worker / partition |
| `apps/server/tests/integration/scheduler-rebalance-handoff.spec.ts` | scheduler rebalance handoff |
| `apps/server/tests/integration/scheduler-automatic-rebalance-apply.spec.ts` | 自动 rebalance |
| `apps/server/tests/integration/scheduler-automatic-rebalance-failover-compatibility.spec.ts` | failover 兼容 |
| `apps/server/tests/integration/death-note-memory-loop.spec.ts` | scheduler + action dispatcher + memory loop |
| `apps/server/tests/unit/storage/SchedulerStorageAdapter.spec.ts` | scheduler storage adapter |

Phase 1 必须新增测试文件：

| 新测试文件 | 必测内容 |
|---|---|
| `apps/server/tests/unit/workflow/workflow-schema.spec.ts` | YAML `workflows` schema、trigger、steps、condition、lock_policy validation；`whole_workflow` 必须被拒绝 |
| `apps/server/tests/unit/workflow/workflow-condition.spec.ts` | `eq` / `neq`、缺失字段 => `condition_error`、组合条件拒绝 |
| `apps/server/tests/unit/workflow/workflow-dag.spec.ts` | depends_on、拓扑排序、循环依赖检测、fan-out/gather ready 计算 |
| `apps/server/tests/unit/workflow/workflow-budget.spec.ts` | `max_rounds_per_tick`、`max_steps_per_tick`、`max_wall_time_ms_per_tick` |
| `apps/server/tests/unit/workflow/workflow-single-flight.spec.ts` | active_steps 锁、普通 DecisionJob 与 WorkflowStepRun actor 冲突 |
| `apps/server/tests/unit/workflow/previous-agent-output.spec.ts` | completed step result 到 context source 的转换；未 completed step 不注入 |
| `apps/server/tests/integration/workflow-engine.spec.ts` | 创建 run、推进 step、完成 workflow |
| `apps/server/tests/integration/workflow-cross-partition.spec.ts` | A/B 不同 partition，同 tick 快速路径 |
| `apps/server/tests/integration/workflow-recovery.spec.ts` | running step lock 过期恢复、completed step 不重复执行 |
| `apps/server/tests/integration/workflow-action-dispatch.spec.ts` | workflow ActionIntent 与普通 ActionIntent 统一 step5 dispatch 和 deterministic ordering |
| `apps/server/tests/integration/workflow-scheduler-trigger.spec.ts` | manual/event trigger 创建起始 run/step；event trigger 幂等 |
| `apps/server/tests/e2e/workflow-pack.spec.ts` | world pack 声明 workflow 后端到端执行 |

测试判定规则：

- 每个新增语义必须有 unit test；跨模块行为必须有 integration test。
- 文档中标记为 Phase 1 validation 拒绝的配置必须有负向测试。
- recovery / idempotency 必须测试重复 advance 不重复创建 ActionIntent。

---

## 8. 开放问题

以下问题现阶段不需要闭合，但需要在实现过程中持续评估：

1. Agent 链的主要使用场景是"仪式/流程"（确定性结构）还是"涌现行为"（模型自主决定）？
2. 一个世界包通常有多少 agent？链的规模预期多大？
3. 对性能的敏感度？LLM 调用延迟是主要瓶颈还是 tick 频率是主要瓶颈？
4. 是否需要支持"一个 agent 同时参与多个 workflow"？
5. 行为树的跨 agent 节点（behavior tree 中引用另一个 agent 的推理）与 workflow 的关系——是互补还是互相替代？
