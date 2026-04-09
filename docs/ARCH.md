# Yidhras 架构说明

## 总览

Yidhras 当前采用“kernel + world-pack runtime”双层架构：

- **kernel** 负责 workflow、social、audit、operator summary、shared evidence bridge 等宿主职责
- **world-pack runtime** 负责 pack 内世界治理对象、authority / mediator / rule execution 与 pack-local projection 证据

## Kernel / Pack 分层

### Kernel-side Prisma

当前由 kernel-side Prisma 宿主的核心对象包括：

- `Post`
- `Event`
- `ActionIntent`
- `InferenceTrace`
- `DecisionJob`
- `AiInvocationRecord`
- `Relationship` / `RelationshipAdjustmentLog`
- `SNRAdjustmentLog`
- `Identity` / `IdentityNodeBinding` / `Policy`
- scheduler / worker runtime state / operator summary 所依赖的内核表

### Pack Runtime DB

- 每个 pack 使用独立路径：`data/world_packs/<pack_id>/runtime.sqlite`
- 由 `packs/storage/pack_storage_engine.ts` materialize
- 同时生成 sidecar：`${runtimeDbPath}.storage-plan.json`
- sidecar 仅保存 storage install / compile 元数据与 pack collection schema 快照
- engine-owned runtime collections materialize 到 `runtime.sqlite` 表：
  - `world_entities`
  - `entity_states`
  - `authority_grants`
  - `mediator_bindings`
  - `rule_execution_records`
  - `projection_events`
- `pack_storage_engine.ts` 安装时会：
  1. 创建或确保 `runtime.sqlite`
  2. materialize engine-owned SQLite tables
  3. 如检测到旧版 sidecar 中仍包含 engine-owned collection 数组，则执行一次兼容迁移
  4. 将 `${runtimeDbPath}.storage-plan.json` 收敛为 metadata/schema 快照

### Ownership Matrix

当前已明确 pack-owned 的世界治理核心对象：

- `WorldEntity`
- `EntityState`
- `AuthorityGrant`
- `MediatorBinding`
- `RuleExecutionRecord`

当前保留在 kernel-side Prisma 的对象：

- `Post`
- `ActionIntent`
- `InferenceTrace`
- `DecisionJob`
- `AiInvocationRecord`
- relationship runtime evidence

当前横跨两侧的 bridge 对象：

- `Event`
  - 产生源头可以来自 pack objective enforcement
  - 也可以来自 workflow / action dispatcher 等 kernel-side 流程
  - 通过 `impact_data.pack_id` 等 bridge metadata 承担 pack-scoped evidence 关联
  - 消费面横跨 audit / memory / workflow follow-up / narrative projection
  - 当前仍属于 kernel-hosted shared evidence bridge

## Runtime Activation

runtime activation / bootstrap 主流程已从 `SimulationManager` 中抽离到：

- `apps/server/src/core/runtime_activation.ts`

`SimulationManager` 主要承担：

- runtime facade
- active pack 引用
- tick/calendar facade
- runtime speed facade
- graph query facade

## Unified Governance Contract

当前 unified governance canonical contract 为：

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

语义执行链包含服务端 `Intent Grounder`：

- provider 输出既可以是直接 action，也可以是开放语义 intent
- active-pack `rules.invocation` 会被加载到 inference runtime context
- Grounder 会将语义 intent 解析为可执行 capability、翻译后的 kernel action，或 narrativized fallback
- 只有显式 capability execution 会继续进入 objective mutation

该层不改变公开的 inference strategy surface。

### Death Note pack 语义执行路径

`world-death-note` 已接入上述语义 grounding 路径。当前实现覆盖：

- notebook acquisition
- notebook rule learning
- murderous intent formation
- target intel gathering
- target selection
- judgement execution
- investigation follow-up
- case intel sharing / publish-style communication fallback

未命中的语义动作会转为 narrativized failed attempt，而不是强制映射到固定动作集合。

### Context Module

当前 inference runtime 包含 Context Module。相关代码位于：

- `apps/server/src/context/types.ts`
- `apps/server/src/context/service.ts`
- `apps/server/src/context/source_registry.ts`
- `apps/server/src/context/workflow/orchestrator.ts`

当前职责：

- 从 legacy memory selection 与 runtime state snapshots 收集统一 `ContextNode`
- materialize `ContextRun`
- 为既有 prompt 消费方暴露兼容 `memory_context`
- 将 context selection / orchestration evidence 持久化到 `InferenceTrace.context_snapshot`

policy / overlay 相关实现：

- node-level policy governance 由 `ContextService` 与 `Context Policy Engine` 处理
- fragment-level `policy_filter` 仅保留为 orchestrator-lite 内的兼容/兜底机制
- overlay 作为 kernel-side working-layer object 存在：
  - `apps/server/src/context/overlay/types.ts`
  - `apps/server/src/context/overlay/store.ts`
  - `apps/server/src/context/sources/overlay.ts`
- `ContextOverlayEntry` 持久化在 kernel Prisma 中，再 re-materialize 为 `ContextNode(source_kind='overlay', visibility.level='writable_overlay')`
- overlay 不作为 pack runtime source-of-truth
- 当前 diagnostics 已输出：
  - `policy_decisions`
  - `blocked_nodes`
  - `locked_nodes`
  - `visibility_denials`
  - `overlay_nodes_loaded`
  - `overlay_nodes_mutated`
  - reserved directive arrays

边界：

- `memory_context` 仍保留，但属于 compatibility projection
- 当前实现为线性流程，不是通用 DAG workflow engine
- overlay 不绕过 source-of-truth，也不替代 pack runtime state
- `ContextDirective` 目前仅保留 schema / trace reservation，执行仍关闭

### Unified AI task / gateway

服务端已形成内部 AI 执行层：

- `apps/server/src/ai/task_service.ts`
- `apps/server/src/ai/route_resolver.ts`
- `apps/server/src/ai/gateway.ts`
- `apps/server/src/ai/providers/mock.ts`
- `apps/server/src/ai/providers/openai.ts`

当前分层：

- `AiTaskService`
- `RouteResolver`
- `ModelGateway`
- provider adapters

当前约束：

- kernel-side canonical AI contract 由服务端内部类型维护
- world pack 只能通过声明式 `pack.ai` 覆盖：
  - prompt organization
  - output schema
  - parse/decoder behavior
  - route hints
- world pack 不能直接写 raw provider payload
- world pack 不能注入任意可执行 parser/composer 代码
- 更复杂的行为应通过 server-side registered extension 实现

当前默认 registry 提供 OpenAI provider / model / route，`ModelGateway` 默认注册 `mock` 与 `openai` adapters。缺少 `OPENAI_API_KEY` 时不会影响 `mock / rule_based` 主线启动。

### AI invocation observability

kernel-side Prisma 包含 `AiInvocationRecord`，记录：

- provider / model / route
- fallback / attempted models
- usage / safety / latency
- request / response audit payload（按 audit level 控制）
- 与 `InferenceTrace.source_inference_id` 的关联

## Projection 层

当前后端已具备：

- entity overview projection
- pack narrative timeline projection
- operator overview projection
- global projection index

### Pack Projection Contract

在当前单 active-pack 运行模式下：

- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`

都要求：

- 请求的 `packId` 必须与当前 active pack 一致
- 若不一致，返回 `409 / PACK_ROUTE_ACTIVE_PACK_MISMATCH`

语义 grounding 的可见性目前通过以下读面暴露：

- workflow / audit metadata 中的 `semantic_intent` 与 `intent_grounding`
- narrativized fallback 产生的 `history` event 在 pack timeline 中可见
- entity / agent overview 可见聚合后的相关证据

### Access-Policy Subsystem Contract

- `/api/access-policy/*`
  - access / projection policy 的独立子系统接口
  - 不属于 unified governance canonical API
  - 负责 projection access / write policy 的显式管理与评估

### Operator 高级视图后端合同

后端已具备 Authority Inspector / Rule Execution Timeline / Perception Diff 所需的基础证据面：

- `authority_context`
- `perception_context`
- `mediator_bindings`
- `recent_rule_executions`
- pack narrative timeline 中的 `rule_execution` / `event` bridge 数据

scheduler / event 协作路径会消费以下 event bridge metadata：

- `followup_actor_ids`
- `impact_data.semantic_intent.target_ref` 中的语义目标提示

AI 调用观测的只读接口为：

- `GET /api/inference/ai-invocations`
- `GET /api/inference/ai-invocations/:id`

这些接口将 `AiInvocationRecord` 暴露为只读观测面，不改变公开 inference 执行契约。

另有：

- `apps/server/src/app/services/operator_contracts.ts`

用于整理前端 handoff 所依赖的后端合同。

### Context Orchestrator Lite backend

当前 prompt pipeline 通过线性的 Context Orchestrator Lite 执行。固定阶段为：

1. `memory_injection`
2. `policy_filter`
3. `summary_compaction`
4. `token_budget_trim`

当前含义：

- legacy `PromptProcessor` 实现仍然存在
- 编排顺序不再只隐含在 prompt builder 内
- prompt assembly 在显式 context orchestration 之后执行
- node-level working-set policy 会先于 fragment pipeline 决定
- `policy_filter` 不再是主要 policy authority

当前不在范围内：

- general DAG prompt workflow engine
- front-end node editor / visual workflow canvas
- plugin execution runtime
- model-driven directive execution
- direct model-side overlay writing

Operator 高级视图（Authority Inspector / Rule Execution Timeline / Perception Diff）的前端页面、交互、布局、状态管理与可视化属于前端实现范围；后端仅负责相应 evidence / contract / projection 能力。
