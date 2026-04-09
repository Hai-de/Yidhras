# Yidhras Logic / 业务逻辑说明

本文件只记录当前已经成立的业务规则、领域边界与实现约束，不记录阶段叙事。

> 优先级请看 `TODO.md`；验证记录请看 `记录.md`。

## 1. Core Behavior Loop / 核心行为闭环

当前已成立的主链路可概括为：

1. world-pack 被加载、校验并 materialize
2. inference context 基于 actor / authority / perception / pack state 组装
3. inference 产生 decision / ActionIntent
4. ActionIntent 优先桥接为 InvocationRequest
5. enforcement engine 执行客观规则并写入 rule execution evidence
6. projection layer 为 operator / narrative / entity 读取提供聚合视图

说明：

- `inference`、`workflow persistence`、`invocation/enforcement`、`projection` 是相关但分层的职责。
- 正式成功响应继续遵循统一 envelope：`{ success: true, data, meta? }`。

## 2. World-Pack Governance Rules / World-Pack 治理规则

### World-pack 作为声明式世界契约

当前 world-pack 可声明：

- `entities`
- `identities`
- `capabilities`
- `authorities`
- `rules`
- `storage`
- `bootstrap`

当前 world-pack 输入契约不再接受：

- `scenario`
- `event_templates`
- `actions`
- `decision_rules`

### Capability-centered model

当前系统的治理模型已从“字段 ACL”转向 capability / authority / mediator：

- authority resolver 负责能力解析
- perception resolver 负责可见性解析
- objective enforcement engine 负责客观执行

这意味着：

- 字段级 policy 仍存在，但其角色更接近 read/write projection policy
- pack 世界规则执行不再以旧 `action_dispatcher` executor 分支为中心

## 3. Pack Runtime Rules / Pack Runtime 运行规则

### Pack-local runtime storage

当前每个 pack 具有自己的 runtime database 路径：

- `data/world_packs/<pack_id>/runtime.sqlite`

pack runtime 当前包含以下核心数据：

- `world_entities`
- `entity_states`
- `authority_grants`
- `mediator_bindings`
- `rule_execution_records`

### Materialization rules

启动时当前会执行：

- `installPackRuntime(...)`
- `materializePackRuntimeCoreModels(...)`

当前状态如下：

- pack runtime core models 已成为主要运行宿主
- 启动流程不再依赖 legacy scenario materialization

### Bootstrap state rules

当前 world 状态初始化通过 `bootstrap.initial_states` 完成：

- 每条记录都必须包含：
  - `entity_id`
  - `state_namespace`
  - `state_json`
- 世界级状态统一使用：
  - `entity_id='__world__'`
  - `state_namespace='world'`

## 4. Authority Rules / 授权规则

### Authority resolution

当前 authority resolver 已支持最小能力解析：

- 读取 pack runtime `authority_grants`
- 根据 `target_selector` 匹配主体
- 基于最小条件约束判断能力是否生效
- 产出 `resolved_capabilities` 与 `blocked_authority_ids`

当前已支持的 selector/match 语义包括：

- `direct_entity`
- `holder_of`
- `subject_entity`

### Provenance

当前解析结果会保留最小 provenance：

- authority 来源
- mediated_by_entity_id
- matched_via

这使 capability 不再只是“有没有”，而是可以解释“为什么有”。

### Mediator-first sample status

当前默认 `death_note` 样板已显式展示 mediator-first 表达：

- `artifact-death-note` 作为 artifact
- `mediator-death-note` 作为 `artifact_vessel`
- authority 从 `mediator-death-note` 发出
- objective enforcement 对 `mediator-death-note` 显式匹配

## 5. Perception Rules / 感知规则

### Perception resolution

当前 perception resolver 已独立于旧 policy 路径，负责：

- 从 pack runtime `entity_states` 读取状态
- 计算 `visible_state_entries`
- 计算 `hidden_state_entries`

当前 perception 规则仍属于第一版实现，更多是感知窗口式可见性，而非完整 actor-scoped materialized perception system。

### Template rendering

`NarrativeResolver` 当前更适合作为 template renderer 使用：

- 当前权限/可见性判断主要发生在 perception / projection 层
- resolver 更多消费“已过滤的变量与状态”

## 6. Invocation and Objective Enforcement / 调用与规则执行

### Invocation bridging

当前 `ActionIntent` 不再直接等同于最终世界执行语义。

当前执行路径为：

- `ActionIntent` -> `InvocationRequest` -> `Objective Enforcement`

bridge 规则：

- 若 intent 能映射到 pack capability 或 objective rule，则优先进入 invocation 路径
- 若不能映射，则仍由 action dispatcher 处理保留分支

### Intent Grounder / Semantic intent grounding

The current inference chain now includes an explicit **Intent Grounder** between decision normalization and `ActionIntentDraft` creation.

Current runtime behavior:

1. provider outputs either a direct action or an open semantic intent
2. `rules.invocation` from the active pack runtime are loaded into inference context
3. the Grounder resolves the decision into one of:
   - `exact`
   - `translated`
   - `narrativized`
   - `blocked` (reserved, still rare)
4. only explicit capability execution can proceed into objective world mutation

Current direct passthrough actions include:

- `invoke.*`
- `trigger_event`
- `post_message`
- `adjust_relationship`
- `adjust_snr`

Current persisted grounding evidence includes:

- `semantic_intent`
- `intent_grounding`
- `semantic_outcome`
- `objective_effect_applied`

These fields are now present in trace/workflow evidence and are consumed by audit-oriented read models.

### Narrativized failure rules

Unexpected action is no longer forced into an enumerated action menu.

Current rule:

- if semantic intent cannot be objectively executed by granted capability,
- and pack invocation rules allow fallback,
- the system records a **narrativized failed attempt** instead of treating it as infrastructure failure.

Current narrativized fallback semantics:

- workflow remains technically successful
- semantic result is represented as `failed_attempt`
- a `trigger_event` / `history` event is emitted
- `objective_effect_applied=false`
- the failed attempt remains visible to timeline / audit / agent read models

This is the current canonical interpretation for Death Note examples such as `ritual_divination`.

### Objective enforcement

当前 enforcement engine 会：

1. 校验 capability
2. 校验 mediator binding
3. 解析 objective rule plan
4. 执行 mutation
5. 写入 `RuleExecutionRecord`
6. 必要时按规则内联声明发射事件

### Objective event declaration

当前 `rules.objective_enforcement[*].then.emit_events[*]` 使用统一内联声明：

- `type`
- `title`
- `description`
- `impact_data`
- 可选 `artifact_id`

Current event bridge metadata may also carry follow-up semantics, including:

- `semantic_type`
- `failed_attempt`
- `grounding_mode`
- `objective_effect_applied`
- `followup_actor_ids`

事件渲染规则：

- 占位值首先通过 invocation 上下文替换
- 字符串模板随后按事件上下文渲染
- enforcement engine 直接写入 kernel `Event`

### RuleExecutionRecord

当前 `RuleExecutionRecord` 是规则执行的主要证据，至少承载：

- `rule_id`
- `capability_key`
- `mediator_id`
- `subject_entity_id`
- `target_entity_id`
- `execution_status`
- payload / emitted event evidence

## 7. Remaining Dispatcher Semantics / 剩余 dispatcher 语义

在当前代码中，`action_dispatcher` 仍保留以下分支：

- `trigger_event`
- `adjust_snr`
- `adjust_relationship`
- `post_message`

这些分支仍在运行，但不再代表 pack 世界规则的主要执行路径。

可归纳为：

- pack governance / world rule execution 已由 invocation + enforcement 路径接管
- dispatcher 仍承担部分通用 intent 消费职责

## 8. Inference Context Rules / 推理上下文规则

### Context Module MVP

当前推理上下文已开始从“memory-only 数据包”演化为正式的 **Context Module MVP**。

当前成立的实现规则：

- `buildInferenceContext()` 仍返回 `memory_context`
- 但其上游已经先经由 `ContextService.buildContextRun(...)`
- `ContextRun` 当前统一收编：
  - legacy memory selection
  - policy summary
  - pack actor/world/runtime state snapshots
  - kernel-side overlay working-layer nodes
- 当前 `memory_context` 已降级为 **compatibility surface**，主要用于兼容：
  - `memory_injector`
  - `memory_summary`
  - `policy_filter`
  - `token_budget_trimmer`
  - 以及现有 provider / trace 持久化逻辑

当前 Context Module 已进一步深化为 policy / overlay 阶段，当前成立的规则包括：

- policy 判定已正式进入 node-level / working-set 级治理，而不再主要依赖 fragment-level filter
- `policy_filter` 仍保留，但其角色已收敛为 compatibility guard / fragment safety fallback
- `hidden_mandatory` 节点不会进入最终 working set，但会在 trace 中保留 hidden/denial 语义
- overlay 已成为 **kernel-side working-layer object**，通过 source adapter materialize 为 `writable_overlay` 节点
- overlay 不覆盖 source of truth，也不进入 pack runtime world governance core

当前 Context Module 最小模型已经包括：

- `ContextNode`
- `ContextRun`
- `ContextSelectionResult`
- `ContextRunDiagnostics`

当前 `ContextRunDiagnostics` 可稳定输出：

- `policy_decisions`
- `blocked_nodes`
- `locked_nodes`
- `visibility_denials`
- `overlay_nodes_loaded`
- `overlay_nodes_mutated`
- `submitted_directives`
- `approved_directives`
- `denied_directives`

当前 future directive 仅完成 schema / trace reservation：

- `create_self_note`
- `pin_node`
- `deprioritize_node`
- `summarize_cluster`
- `archive_overlay`
- 当前 **未开放** 模型直接执行 directive，也未开放自动 overlay mutation

当前并未引入：

- 通用 DAG workflow engine
- 节点可视化编排器
- 插件执行 runtime
- Agent 自主上下文 directive 执行

### Current context assembly

当前 inference 主上下文仍通过 `buildInferenceContext()` 生成基础结构，随后可由 `buildInferenceContextV2()` 扩展为：

- `subject_context`
- `authority_context`
- `perception_context`
- `world_rule_context`

### Pack state source

当前 inference pack state 已主要来自 pack runtime projection，而不是旧 `ScenarioEntityState` 主读取路径。

当前会组装：

- `actor_state`
- `owned_artifacts`
- `world_state`
- `latest_event`（部分情况下仍是 synthetic latest event）

### Rule-based provider

当前 `rule_based` provider 不再消费 legacy `decision_rules`，而只执行通用 fallback 行为。

For `world-death-note`, the current rule-based provider now emits semantic decisions for the first working thematic loop, including:

- notebook claim
- notebook rule learning
- murderous intent formation
- target intel gathering
- target selection
- judgement execution

This semantic output is intentionally intermediate and must be grounded before it reaches final workflow dispatch.

## 9. Projection Rules / 投影规则

### Context Orchestrator Lite

当前 prompt 处理主线已从“隐式 processor 串联”收口为一个线性的 **Context Orchestrator Lite**。

当前编排阶段固定为：

1. `memory_injection`
2. `policy_filter`
3. `summary_compaction`
4. `token_budget_trim`

说明：

- 当前 orchestrator-lite 仍内部复用既有 processors
- 当前真正的 policy 治理已前移到 `ContextService` / `ContextRun` / working-set
- `policy_filter` 当前只保留 compatibility fallback 语义
- 当前阶段顺序仍固定，不支持节点图、分支 DAG 或用户可编排 workflow engine
- `PromptProcessor` 接口仍保留，但其角色已变为 compatibility surface
- `prompt_builder.ts` 当前负责：
  - 基础 fragment seed
  - 调用 orchestrator-lite
  - 最终 prompt assembly

这意味着当前 prompt pipeline 已具备：

- 显式阶段顺序
- 可观测的 orchestrator trace
- 面向未来 plugin / variable / slot 扩展的落点

### Pack projections

当前 pack runtime projection 已覆盖：

- entity overview projection
- pack narrative timeline projection

可读取的主要证据包括：

- entities
- entity states
- authority grants
- mediator bindings
- rule execution records
- event timeline

### Kernel projections

当前 kernel projection 已覆盖：

- operator overview projection
- global projection index extraction

### API-level projection surface

当前读接口已经出现 canonical pack/entity endpoint：

- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`
- `/api/entities/:id/overview`

已独立外提的相关读写策略子系统：

- `/api/access-policy/*`

当前阶段可归纳为：

- canonical pack/entity projection surface 已形成
- `/api/narrative/timeline` 已退出代码库
- `/api/agent/:id/overview` 已退出代码库

Current Death Note visibility guarantee:

- narrativized failure is visible in workflow/audit evidence
- related `history` events are visible in pack timeline
- entity overview / agent overview can observe those events through existing read-model surfaces
- follow-up actors can be scheduled from emitted event metadata

### Context trace observability

当前 `InferenceTrace.context_snapshot` 已增强为同时承载：

- `context_run`
- `context_module`
- `context_debug`
- `memory_context`
- `memory_selection`
- `prompt_processing_trace`
- `prompt_assembly`

当前可观察语义包括：

- selected node ids
- selected node summaries
- dropped node reasons
- policy decisions / blocked nodes / locked nodes / visibility denials
- overlay nodes loaded / overlay mutation results（当前 mutation 默认多为空）
- submitted / approved / denied directives（当前为 schema reservation，默认空数组）
- node counts by type
- orchestrator step trace
- prompt assembly summary

因此当前 workflow / audit / operator 调试链已经可以观察：

- 上下文是如何被选择的
- 哪些节点被 policy 拒绝或锁定
- 哪些 overlay 被载入到当前 working set
- 哪些 directive 只是被保留为 trace reservation
- 上下文是如何被过滤/压缩的
- prompt 是如何被组装的

当前 `/api/entities/:id/overview` 也已能从最近 trace 中读取轻量治理摘要：

- `context_governance.latest_policy`
- `context_governance.overlay`

这使 agent overview 不再只能观察 legacy memory diagnostics，也能观察 policy / overlay 对上下文组织的影响。

## 10. Identity and Policy Rules / 身份与策略规则

### Identity binding lifecycle

已成立规则仍包括：

- identity 可绑定到 active / atmosphere 节点
- binding 带有 role 与 status
- binding 支持显式 unbind / expire
- runtime loop 会在 `expires_at` 到达后自动过期 binding
- 非法 actor 组合返回显式输入错误

### Policy role after refactor

当前 policy 仍用于：

- social post 字段读写过滤
- 一些 API/read model 的 projection access 判断

但 policy 当前不再适合作为世界治理中心的描述。

当前 `/api/access-policy/*` 更准确的定位是：

- 独立 access-policy 子系统接口
- 不是 world-pack governance framework 的核心入口，但也不再属于 compat/debug surface

## 11. Ownership Matrix Status / 当前归属矩阵状态

当前已明确的归属结论如下：

### Pack-owned world governance core

- `WorldEntity`
- `EntityState`
- `AuthorityGrant`
- `MediatorBinding`
- `RuleExecutionRecord`

### Kernel-side Prisma retained

- `Event`
- `Post`
- `ActionIntent`
- `InferenceTrace`
- `DecisionJob`
- relationship runtime evidence
- identity / policy / scheduler / operator metadata

当前结论：

- ownership matrix 已从“未定义”进入“明确中间态”
- 当前阶段不要求把所有 narrative / social / workflow 对象全部迁入 pack runtime
- 后续是否继续迁移，应基于稳定边界和 operator/audit 成本继续评估

## 12. Compatibility Status / 当前兼容状态

以下 world-pack 输入与运行桥已经移除：

1. schema 不再接受 `scenario / event_templates / actions / decision_rules`
2. `world/event_templates.ts` 已删除
3. pack runtime materializer 不再读取 `pack.scenario`
4. `world/materializer.ts` 与 `world/state.ts` 已删除
5. `rule_based` provider 已不再消费 legacy `decision_rules`
6. `world/schema.ts` 与 `world/loader.ts` 已删除，imports 已统一到 `packs/*`
7. `/api/narrative/timeline` 已删除

当前仍值得持续观察的非治理主线边界对象包括：

- `/api/access-policy/*` 的独立 access-policy 子系统接口

## 13. Contributor Rules / 贡献者规则

- 只把已经成立的业务规则写进本文件。
- 不把“设计目标”写成“已完成实现”。
- 若描述兼容层，请明确写出它属于读接口或调试接口，而不是 world-pack 输入主线。
- 若新增规则，请说明它属于：
  - authority
  - perception
  - invocation/enforcement
  - projection
  - compatibility read surface
