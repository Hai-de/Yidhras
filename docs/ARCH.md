# Yidhras 架构说明

## 总览

Yidhras 当前采用“kernel + world-pack runtime”双层架构：

- **kernel** 负责 workflow、social、audit、operator summary、shared evidence bridge 等全局宿主职责
- **world-pack runtime** 负责 pack 内世界治理核心对象、authority / mediator / rule execution 与 pack-local projection 证据

## Kernel / Pack 分层

### Kernel-side Prisma（当前保留）

当前继续由 kernel-side Prisma 宿主的核心对象包括：

- `Post`
- `Event`
- `ActionIntent`
- `InferenceTrace`
- `DecisionJob`
- `Relationship` / `RelationshipAdjustmentLog`
- `SNRAdjustmentLog`
- `Identity` / `IdentityNodeBinding` / `Policy`
- scheduler / worker runtime state / operator summary 所依赖的内核表

### Pack Runtime DB

- 每个 pack 使用独立路径：`data/world_packs/<pack_id>/runtime.sqlite`
- 当前由 `packs/storage/pack_storage_engine.ts` materialize
- 同时生成 sidecar：`${runtimeDbPath}.storage-plan.json`
- **sidecar 仅保存 storage install / compile 元数据与 pack collection schema 快照，不再作为 engine-owned runtime data 主宿主**
- engine-owned runtime collections 当前 materialize 到真实 `runtime.sqlite` 表：
  - `world_entities`
  - `entity_states`
  - `authority_grants`
  - `mediator_bindings`
  - `rule_execution_records`
  - `projection_events`
- `pack_storage_engine.ts` 会在安装时：
  1. 创建/确保 `runtime.sqlite`
  2. materialize engine-owned SQLite tables
  3. 如检测到旧版 sidecar 中仍包含 engine-owned collection 数组，则执行一次向 SQLite 的兼容迁移
  4. 将 `${runtimeDbPath}.storage-plan.json` 收敛为纯 metadata/schema 快照

### Current Ownership Matrix Snapshot

当前已明确 pack-owned 的世界治理核心对象：

- `WorldEntity`
- `EntityState`
- `AuthorityGrant`
- `MediatorBinding`
- `RuleExecutionRecord`

当前明确保留在 kernel-side Prisma 的对象：

- `Post`
- `ActionIntent`
- `InferenceTrace`
- `DecisionJob`
- relationship runtime evidence

当前横跨两侧的 bridge 对象：

- `Event`
  - 产生源头可以来自 pack objective enforcement
  - 也可以来自 workflow / action dispatcher 等 kernel-side 流程
  - 当前通过 `impact_data.pack_id` 等 bridge metadata 承担 pack-scoped evidence 关联
  - 但消费面仍横跨 audit / memory / workflow follow-up / narrative projection
  - 当前仍属于 kernel-hosted shared evidence bridge

## Runtime Activation

当前 runtime activation / bootstrap 主流程已经从 `SimulationManager` 中抽离到：

- `apps/server/src/core/runtime_activation.ts`

`SimulationManager` 当前主要承担：

- runtime facade
- active pack 引用
- tick/calendar facade
- runtime speed facade
- graph query facade

## Unified Governance Contract

当前 unified governance canonical contract 已收敛为：

- `metadata`
- `constitution`
- `variables`
- `prompts`
- `time_systems`
- `simulation_time`
- `entities`
- `identities`
- `capabilities`
- `authorities`
- `rules`
- `storage`
- `bootstrap`

Current semantic execution architecture additionally includes a server-side **Intent Grounder** layer:

- provider output may be direct action or open semantic intent
- active-pack `rules.invocation` are loaded into inference runtime context
- the Grounder resolves semantic intent into executable capability, translated kernel action, or narrativized fallback
- only explicit capability execution proceeds into objective mutation

This keeps the public inference strategy surface unchanged while allowing pack-specific semantic behavior.

### Death Note first working loop status

`world-death-note` is now the first pack that uses this semantic grounding path end-to-end.

Current implemented loop covers:

- notebook acquisition
- notebook rule learning
- murderous intent formation
- target intel gathering
- target selection
- judgement execution
- investigation follow-up
- case intel sharing / publish-style communication fallback

Unexpected semantic action is not forced into a closed action list; it can become a narrativized failed attempt.


### Context Module MVP status

Current inference runtime now also includes a first-stage **Context Module MVP**.

Current structure:

- `apps/server/src/context/types.ts`
- `apps/server/src/context/service.ts`
- `apps/server/src/context/source_registry.ts`
- `apps/server/src/context/workflow/orchestrator.ts`

Current responsibilities:

- collect unified `ContextNode`s from legacy memory selection and runtime state snapshots
- materialize a `ContextRun`
- expose compatibility `memory_context` for existing prompt consumers
- persist context selection / orchestration evidence into `InferenceTrace.context_snapshot`

Current policy / overlay deepening status:

- node-level policy governance is now handled in `ContextService` + `Context Policy Engine`
- fragment-level `policy_filter` remains only as compatibility/fallback guard inside orchestrator-lite
- overlay is now a formal **kernel-side working-layer object**:
  - `apps/server/src/context/overlay/types.ts`
  - `apps/server/src/context/overlay/store.ts`
  - `apps/server/src/context/sources/overlay.ts`
- `ContextOverlayEntry` is persisted in kernel Prisma, then re-materialized into `ContextNode(source_kind='overlay', visibility.level='writable_overlay')`
- overlay is intentionally not moved into pack runtime because it belongs to inference/workflow working memory, not world governance source-of-truth
- current diagnostics already expose:
  - `policy_decisions`
  - `blocked_nodes`
  - `locked_nodes`
  - `visibility_denials`
  - `overlay_nodes_loaded`
  - `overlay_nodes_mutated`
  - reserved directive arrays

Important boundary note:

- current `memory_context` is still present
- but it is now a **compatibility projection**, not the new canonical upstream abstraction
- current implementation is still intentionally linear, not a general DAG workflow engine
- current overlay does not bypass source-of-truth and does not replace pack runtime state
- current future `ContextDirective` support is schema/trace reservation only; execution is still disabled

## Projection 层

当前后端已具备：

- entity overview projection
- pack narrative timeline projection
- operator overview projection
- global projection index

### Pack Projection Contract（当前状态）

在当前单 active-pack 运行模式下：

- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`

都要求：

- 请求的 `packId` 必须与当前 active pack 一致
- 若不一致，返回 `409 / PACK_ROUTE_ACTIVE_PACK_MISMATCH`

这表示 pack projection API 目前明确采用 **single-active-pack** 合同。

Current read-model visibility for semantic grounding includes:

- workflow/audit metadata carrying `semantic_intent` and `intent_grounding`
- pack timeline visibility for `history` events emitted by narrativized fallback
- entity/agent overview visibility through existing aggregated evidence surfaces

### Access-Policy Subsystem Contract

- `/api/access-policy/*`
  - access / projection policy 的独立子系统接口
  - 不属于 unified governance canonical API
  - 负责 projection access / write policy 的显式管理与评估

### Operator 高级视图后端合同

当前后端已具备 Authority Inspector / Rule Execution Timeline / Perception Diff 所需的基础证据面：

- `authority_context`
- `perception_context`
- `mediator_bindings`
- `recent_rule_executions`
- pack narrative timeline 中的 `rule_execution` / `event` bridge 数据

Current scheduler/event collaboration path now also consumes event bridge metadata such as:

- `followup_actor_ids`
- semantic target hints carried in `impact_data.semantic_intent.target_ref`

This is the current minimum multi-agent follow-up path for Death Note-style investigation/collaboration loops without introducing a privileged governor/admin agent.

并已新增：

- `apps/server/src/app/services/operator_contracts.ts`

作为前端 handoff 所依赖的后端合同整理层。

### Context Orchestrator Lite backend status

Current prompt pipeline is now explicitly routed through a linear **Context Orchestrator Lite**.

Current fixed stages:

1. `memory_injection`
2. `policy_filter`
3. `summary_compaction`
4. `token_budget_trim`

Current architectural meaning:

- legacy `PromptProcessor` implementations still exist
- but orchestration order is no longer only an implicit list inside prompt builder
- prompt assembly now happens after an explicit context orchestration pass
- node-level working-set policy is already decided before this fragment pipeline runs
- `policy_filter` is no longer the primary policy authority

This is intentionally a transitional architecture:

- enough to formalize the context pipeline
- not yet a full prompt workflow engine

Explicitly out of scope in the current stage:

- general DAG prompt workflow engine
- front-end node editor / visual workflow canvas
- plugin execution runtime
- model-driven directive execution
- direct model-side overlay writing

Operator 高级视图（Authority Inspector / Rule Execution Timeline / Perception Diff）的前端页面、交互、布局、状态管理与可视化属于前端实现范围；后端仅负责相应 evidence / contract / projection 能力。
