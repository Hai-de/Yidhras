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

## 9. Projection Rules / 投影规则

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

兼容读接口当前只剩：

- `/api/policy/*`

当前阶段可归纳为：

- canonical pack/entity projection surface 已形成
- `/api/narrative/timeline` 已退出代码库
- `/api/agent/:id/overview` 已退出代码库

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

当前 `/api/policy/*` 更准确的定位是：

- projection/access policy debug surface
- 不是 world-pack governance framework 的核心入口

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

当前仍保留的兼容面只剩：

- `/api/policy/*` 的历史调试/访问策略接口

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
