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

并已新增：

- `apps/server/src/app/services/operator_contracts.ts`

作为前端 handoff 所依赖的后端合同整理层。

Operator 高级视图（Authority Inspector / Rule Execution Timeline / Perception Diff）的前端页面、交互、布局、状态管理与可视化属于前端实现范围；后端仅负责相应 evidence / contract / projection 能力。
