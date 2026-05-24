<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/agent-chain-workflow-design-draft.md","contentHash":"sha256:dadbc9bd0233888bfdcf5293aeb35d5d93fe98aee29b4083ef8b98fb985e5e3a"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 扩展 inference trace sink 与 ActionIntent workflow source metadata  `#workflow-action-source`
- [x] 实现 workflow DAG、condition、budget 纯逻辑模块及 unit tests  `#workflow-core-logic`
- [x] 实现 app/services/workflow Workflow Engine create/recover/advance 核心流程  `#workflow-engine`
- [x] 新增 WorkflowRun / WorkflowStepRun Prisma 模型、ActionIntent 来源字段与 repository  `#workflow-persistence`
- [x] 接入 previous_agent_output context source 与 prompt slot 数据  `#workflow-previous-output`
- [x] 实现 pack workflows schema 与 validation，并更新 WORLD_PACK 文档  `#workflow-schema`
- [x] 扩展 global single-flight 覆盖 running WorkflowStepRun  `#workflow-single-flight`
- [x] 将 PackSimulationLoop step4 改为 workflow-aware 单入口 runWorkflowDecisionStep  `#workflow-step4-runtime`
- [x] 补齐 workflow unit/integration/e2e 测试与文档  `#workflow-tests-docs`
- [x] 集成 scheduler manual/event trigger，保持 DAG 推进权在中心化 engine  `#workflow-trigger-scheduler`
<!-- LIMCODE_TODO_LIST_END -->

# Agent Chain / Workflow Engine Phase 1 实施计划

## 来源设计

- Source design: `.limcode/design/agent-chain-workflow-design-draft.md`
- 计划依据：设计文档中已闭合的 Phase 1 决策，以及第 7 节“Phase 1 落地规格补充”。
- 关键约束：项目未上线，可接受大范围重构/重写；不做含糊兼容。半支持状态必须通过 validation 拒绝。

## 目标

实现声明式 Agent Workflow Phase 1：

1. 在 world pack 顶层支持 `workflows` 定义。
2. 新增中心化 Workflow Engine，作为 step4 的 workflow-aware 单入口。
3. 支持 DAG 串行链、fan-out/gather、单字段 condition、跨 partition step 推进。
4. 支持同 tick 快速路径，但受 workflow advance budget 限制。
5. 使用 `WorkflowRun` + `WorkflowStepRun` 持久化运行状态和 step 状态。
6. 扩展 single-flight，使普通 DecisionJob / ActionIntent / WorkflowStepRun 统一裁决 actor 活跃状态。
7. 支持 `previous_agent_output` 作为 workflow step 间数据通道。
8. 扩展 ActionIntent 来源字段以支持 workflow recovery 幂等与追踪。
9. 补齐 unit / integration / e2e 测试。

## 非目标

Phase 1 不实现：

- 模型动态创建任意 workflow DAG。
- `whole_workflow` lock 行为。YAML validation 必须拒绝该值。
- 事务型“全成功才落地”或回滚。
- condition 组合条件 `all_of` / `any_of`。内部类型可预留，但 YAML validation 必须拒绝。
- BT `llm_decision` wiring。
- workflow 可视化 UI。仅预留 API/trace 扩展位置。

## 架构位置与边界

当前架构边界由 `apps/server/eslint.config.mjs` 定义。Phase 1 不新增未被 boundary 识别的 `src/app/workflow/**`。

新增模块位置：

```text
apps/server/src/app/runtime/workflow_decision_step.ts
apps/server/src/app/services/workflow/workflow_engine.ts
apps/server/src/app/services/workflow/workflow_types.ts
apps/server/src/app/services/workflow/workflow_dag.ts
apps/server/src/app/services/workflow/workflow_condition.ts
apps/server/src/app/services/workflow/workflow_budget.ts
apps/server/src/app/services/workflow/workflow_run_repository.ts
apps/server/src/app/services/workflow/workflow_step_repository.ts
```

依赖方向：

- `app/runtime` 可以调用 `app/services/workflow`。
- `app/services/workflow` 可以依赖 `inference` 类型/服务接口、`packs` workflow definition 类型、`config`、`clock`、`context` 等 infra。
- `packs` 只负责 schema/load/materialize workflow definitions，不依赖 workflow engine。
- `inference` 不依赖 workflow engine；workflow source metadata 通过参数/类型传入。
- `core` 不放 workflow engine。
- `transport` 如新增 API，仅调用 app service/facade。

## 分阶段实施

### 阶段 1：Schema 与类型基础

#### 1.1 Pack workflow schema

修改：

- `apps/server/src/packs/schema/constitution_schema.ts`
- `apps/server/src/packs/manifest/loader.ts`
- `apps/server/src/packs/openings/applicator.ts`
- `docs/specs/WORLD_PACK.md`

实现：

- 顶层新增可选 `workflows`。
- 定义 `PackWorkflowDefinition`、`WorkflowStepDefinition`、`WorkflowConditionDefinition` 等类型。
- validation 规则：
  - `steps` 非空。
  - step id 唯一。
  - `depends_on` / `input_from` 引用必须存在。
  - `depends_on` 必须为 DAG。
  - `input_from` 只能引用当前 step 之前可完成的 step。
  - `manual` trigger 不允许 `event_types`。
  - `event` trigger 必须有非空 `event_types`。
  - `failure_policy` 只接受缺省或 `narrativize`。
  - `lock_policy` 只接受缺省或 `active_steps`；`whole_workflow` 必须拒绝。
  - condition 只接受 `{ field, op, value }`。
  - provider 只接受当前已有 `behavior_tree` / `openai_compatible` / `anthropic`。

#### 1.2 Workflow 通用类型

新增：

- `apps/server/src/app/services/workflow/workflow_types.ts`

包含：

- run / step status union。
- `WorkflowAdvanceInput` / `WorkflowAdvanceResult`。
- `WorkflowAdvanceBudget`。
- `TriggerWorkflowInput`。
- `WorkflowConditionEvaluationResult`。
- `WorkflowStepResultJson`。
- `PreviousAgentOutputSource`。
- `WorkflowActionIntentSource`。

验收：

- 类型不使用 `any`。
- 相对 import 后缀符合 NodeNext `.js` 规则。
- 不引入 boundary 违规路径。

### 阶段 2：持久化与 repository

#### 2.1 Prisma schema 与 migration

修改：

- `apps/server/prisma/schema.prisma`
- 新增 Prisma migration

新增模型：

- `WorkflowRun`
- `WorkflowStepRun`

扩展模型：

- `ActionIntent` 新增：
  - `source_workflow_run_id String?`
  - `source_workflow_step_id String?`
  - `source_step_attempt Int?`

关键索引：

- `WorkflowRun.idempotency_key @unique`
- `WorkflowStepRun.idempotency_key @unique`
- `WorkflowStepRun @@unique([workflow_run_id, step_id, attempt])`
- `WorkflowStepRun @@index([agent_id, status])`
- `ActionIntent` workflow source indexes。

#### 2.2 Repository 实现

新增：

- `apps/server/src/app/services/workflow/workflow_run_repository.ts`
- `apps/server/src/app/services/workflow/workflow_step_repository.ts`

实现接口：

- create/get/list/claim/update run。
- create/list/listRunnable/claim/complete/narrativize/fail step。
- lock expiry 查询。
- idempotency key 查询。

修改：

- `apps/server/src/app/context.ts`
- 如现有 repository registry 需要扩展，则修改 `apps/server/src/app/services/repositories/*`。
- 测试 helper / test context 支持 workflow repository。

验收：

- claim 操作为原子语义。
- completed step 不会被重复 claim。
- lock 过期 step 可被 recovery 扫描。

### 阶段 3：DAG、condition、budget 纯逻辑

新增：

- `apps/server/src/app/services/workflow/workflow_dag.ts`
- `apps/server/src/app/services/workflow/workflow_condition.ts`
- `apps/server/src/app/services/workflow/workflow_budget.ts`

实现：

#### DAG

- 拓扑排序。
- 循环检测。
- ready step 计算。
- fan-out/gather 依赖满足判断。
- `input_from` 引用顺序校验。

#### Condition

三态结果：

```ts
{ outcome: 'true' }
{ outcome: 'false' }
{ outcome: 'condition_error'; code: string; message: string }
```

规则：

- `field` 格式 `<step_id>.<path...>`。
- step 必须 completed。
- 字段缺失为 `condition_error`。
- 中间路径非 object 为 `condition_error`。
- `eq` / `neq` 使用 JSON scalar 严格比较。
- `condition_error` 不进入 skipped，后续按 narrativized fallback。

#### Budget

- `max_rounds_per_tick`
- `max_steps_per_tick`
- `max_wall_time_ms_per_tick`
- advance round 过程中实时检查 wall time。

验收：

- 这些模块尽量纯函数化，便于 unit test。
- 不依赖 Prisma。

### 阶段 4：Workflow Engine 核心

新增：

- `apps/server/src/app/services/workflow/workflow_engine.ts`

实现：

#### 4.1 triggerWorkflow

- 根据 workflow name 从 pack runtime 获取 definition。
- 构造 run idempotency key：
  - `wf:{pack_id}:{workflow_name}:{trigger_type}:{trigger_tick}:{trigger_ref}`
- 若 idempotency key 已存在，返回已有 run。
- 创建 `WorkflowRun`。
- 根据 YAML steps 创建初始 `WorkflowStepRun`。
- 起始 step 初始状态可为 `pending`，由 advance 统一转 ready。

#### 4.2 recoverExpiredRuns

- 扫描 lock 过期的 running run / step。
- completed step 不重跑。
- 过期 running step 根据 attempt/max attempts 策略转回 ready 或 narrativized/failed。
- recovery 不重复创建 ActionIntent。

#### 4.3 advance

每 tick 执行：

1. 中心化扫描 active workflow run。
2. 对每个 run 读取 step 状态。
3. 计算 ready step。
4. claim step，检查 global single-flight。
5. 执行 step inference。
6. 写入 `WorkflowStepRun.result_json`、`action_intent_ids`。
7. 根据 DAG 继续下一 round。
8. 达到 budget 时停止，未执行 ready step 留到后续 tick。
9. 所有终态满足后更新 run status。

终态：

- completed
- failed
- narrativized
- timed_out

验收：

- 同 tick 多 round 生效。
- budget exhaustion 不丢状态。
- 跨 partition step 不要求 co-location。
- engine 只在 `app/services/workflow`。

### 阶 5：step4 runtime 单入口改造

新增：

- `apps/server/src/app/runtime/workflow_decision_step.ts`

修改：

- `apps/server/src/app/runtime/PackSimulationLoop.ts`
- `apps/server/src/app/runtime/job_runner.ts`

实现：

- `PackSimulationLoop` step4 不再直接调用 `runDecisionJobRunner()`，改为 `runWorkflowDecisionStep()`。
- `runWorkflowDecisionStep()` 固定顺序：
  1. `workflowEngine.recoverExpiredRuns()`
  2. `workflowEngine.advance()`
  3. 处理普通 DecisionJob 直通逻辑
- 普通 DecisionJob 不得绕过 actor single-flight。
- 保留当前普通 DecisionJob 行为，确保无 workflow 的 pack 行为兼容。

验收：

- 无 workflows 的 pack 行为与当前一致。
- 有 workflow 的 pack 在 step4 通过 engine 推进。

### 阶段 6：Scheduler trigger 集成

修改：

- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/runtime/scheduler_decision_kernel_port.ts`（仅在需要扩展 snapshot/输入时）

实现：

- `event` trigger：检测事件后创建 workflow run，而不是让 partition scheduler 拥有 DAG 推进权。
- `manual` trigger：预留 service/API 调用入口。
- 起始 step agent 仍受 scheduler cooldown 与 single-flight 约束。
- 后续 step 由 engine 直接推进，不受 cooldown，但受 global single-flight。

验收：

- event trigger 幂等。
- workflow 起始 step 不绕过当前抑制机制。
- partition scheduler 不包含 DAG 推进逻辑。

### 阶段 7：single-flight 扩展

修改：

- `apps/server/src/app/runtime/entity_activity_query.ts`
- `apps/server/src/app/runtime/action_dispatcher_runner.ts`
- `apps/server/src/app/runtime/job_runner.ts`

实现：

- `listActiveWorkflowActors()` 继续查 active DecisionJob + ActionIntent。
- 新增查询 running `WorkflowStepRun`。
- 支持 exclude 当前 claimed job/intent/step，避免自冲突。
- `hasActiveWorkflowForActor()` 覆盖普通 job、pending/dispatching ActionIntent、running workflow step。

验收：

- 普通 DecisionJob 与 WorkflowStepRun 同 actor 冲突时其中一个等待。
- ActionIntent dispatch 与 WorkflowStepRun 同 actor 冲突时遵守现有 actor active 语义。

### 阶段 8：Inference / ActionIntent source metadata

修改：

- `apps/server/src/inference/types.ts`
- `apps/server/src/inference/trace_sink.ts`
- `apps/server/src/inference/sinks/prisma.ts`
- `apps/server/src/inference/service.ts`

实现：

- `InferenceService.executeDecisionJob()` 或其 request metadata 支持 workflow source。
- ActionIntent upsert 保留 `source_inference_id` 幂等，同时写入：
  - `source_workflow_run_id`
  - `source_workflow_step_id`
  - `source_step_attempt`
- step complete 时写回 `action_intent_ids`。

验收：

- recovery 重跑同一 step 不重复落地 ActionIntent。
- action trace 能关联 workflow run / step。
- inference 层不 import workflow engine。

### 阶段 9：previous_agent_output context source

修改：

- `apps/server/src/app/services/context/context_assembler.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/conversation/assembler.ts`（如 prompt bundle 需要承载）
- `apps/server/src/template_engine/*`（如 slot 注入由模板引擎负责）
- `docs/subsystems/PROMPT_WORKFLOW.md`

实现：

- Workflow step 根据 `input_from` 读取当前 run 内 completed step result。
- 生成 `PreviousAgentOutputSource`。
- slot 对象形状：`previous_agent_output[step_id]`。
- 支持：`{{previous_agent_output.review.reasoning}}`。
- 未 completed 的 input step 不注入；当前 step 不能 ready。

验收：

- step B 可收到 step A 的 `reasoning` / `decision_summary` / `grounding_result_type` / `semantic_intent`。
- 同 tick 快速路径中 B 通过 result_json 读取 A 输出，而不是读取 step5 后世界状态。

### 阶段 10：Action dispatch ordering 与 workflow action 语义

修改：

- `apps/server/src/app/runtime/action_dispatcher_runner.ts`
- 可能涉及 action repository ordering 查询

实现：

- workflow action 与普通 DecisionJob action 统一进入 step5。
- workflow 内 ordering：DAG 拓扑层级、YAML step 声明顺序、step 内 action 顺序。
- workflow 不获得天然优先级。
- 同 entity 同属性冲突仍由现有/后续 dispatch 冲突规则处理。

验收：

- integration test 验证 deterministic ordering。
- workflow 与普通 action 混合时排序稳定。

### 阶段 11：API / 可观测性最小实现

Phase 1 最小可选，但建议实现轻量查询：

- manual trigger API。
- workflow run / step run read model。

可能影响：

- `apps/server/src/app/http/*`
- `docs/specs/API.md`

如果暂不做前端 UI，需要明确 docs 中标记“后端可查，UI 后续”。

### 阶段 12：测试与文档

新增测试：

- `apps/server/tests/unit/workflow/workflow-schema.spec.ts`
- `apps/server/tests/unit/workflow/workflow-condition.spec.ts`
- `apps/server/tests/unit/workflow/workflow-dag.spec.ts`
- `apps/server/tests/unit/workflow/workflow-budget.spec.ts`
- `apps/server/tests/unit/workflow/workflow-single-flight.spec.ts`
- `apps/server/tests/unit/workflow/previous-agent-output.spec.ts`
- `apps/server/tests/integration/workflow-engine.spec.ts`
- `apps/server/tests/integration/workflow-cross-partition.spec.ts`
- `apps/server/tests/integration/workflow-recovery.spec.ts`
- `apps/server/tests/integration/workflow-action-dispatch.spec.ts`
- `apps/server/tests/integration/workflow-scheduler-trigger.spec.ts`
- `apps/server/tests/e2e/workflow-pack.spec.ts`

更新文档：

- `docs/specs/WORLD_PACK.md`
- `docs/subsystems/PROMPT_WORKFLOW.md`
- `docs/LOGIC.md`
- `docs/ARCH.md`
- 如新增 API：`docs/specs/API.md`

## 验收标准

### 功能验收

- 可通过 pack YAML 声明 workflow。
- manual / event trigger 可创建 workflow run。
- workflow 可执行 A -> B 串行链。
- workflow 可执行 A+B fan-out 后 C gather。
- condition `eq` / `neq` 生效。
- 缺失字段产生 `condition_error`，进入 narrativized fallback。
- 同 tick 快速路径可跨 partition 推进。
- budget 到达后未执行 step 留待下 tick。
- step 输出通过 `previous_agent_output` 传入后续 step。
- workflow step action 在 step5 统一 dispatch。
- recovery 不重复执行 completed step，不重复创建 ActionIntent。

### 架构验收

- 不新增 `src/app/workflow/**`。
- workflow engine 位于 `src/app/services/workflow/**`。
- runtime glue 位于 `src/app/runtime/workflow_decision_step.ts`。
- `packs` 不依赖 workflow engine。
- `inference` 不依赖 workflow engine。
- `core` 不依赖 workflow engine。
- ESLint boundaries 无新增 warning/error。

### 测试验收

- 所有新增 unit test 通过。
- 所有新增 integration test 通过。
- 原有 scheduler / inference / action dispatcher 测试通过。
- `pnpm --filter server lint` 通过。
- `pnpm --filter server test` 或对应 vitest workspace 测试通过。

## 风险与处理

| 风险 | 处理 |
|---|---|
| step4 耗时变长导致 overlap skip 增加 | budget 强制限制；记录 advance result；测试 wall time budget |
| recovery 重复落地 ActionIntent | 保留 `source_inference_id` upsert，新增 workflow source 字段，测试重复 advance |
| condition 语义漂移 | 三态 evaluator 固定；缺失字段测试覆盖 |
| workflow 与普通 job actor 冲突 | 扩展 global single-flight；覆盖 unit/integration 测试 |
| boundary 违规 | 所有 engine 文件放 `app/services/workflow`；runtime 只放 glue |
| pack schema 半支持 | validation 拒绝 `whole_workflow`、组合条件、未知 provider |

## 建议执行顺序

1. Schema/types + DAG/condition/budget unit tests。
2. Prisma/repository + repository tests。
3. Workflow Engine 最小 create/advance。
4. step4 runtime 单入口接入。
5. single-flight 与 inference/action metadata。
6. previous_agent_output。
7. event/manual trigger。
8. recovery 与 cross-partition integration。
9. docs/API/可观测性。
10. 全量 lint/test 回归。
