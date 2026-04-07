# World-Pack 通用治理与规则媒介框架设计

## 1. 背景

当前项目已经完成从旧 `scenario / event_templates / actions / decision_rules` 体系向 **world-pack unified governance framework** 的主线迁移。

这意味着本文档不再讨论“是否继续保留旧输入兼容层”，而是同步当前真实代码状态，并记录当前已经完成的一轮边界收口结果。

当前已经成立的事实如下：

- world-pack 的 canonical contract 已收敛为：
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
- schema 已不再接受：
  - `scenario`
  - `event_templates`
  - `actions`
  - `decision_rules`
- runtime 已能 materialize：
  - entities
  - identities
  - authorities
  - mediators
  - `bootstrap.initial_states`
- inference context 已能注入 pack state、authority、perception 与 runtime contract
- invocation / objective enforcement 已替代旧 pack action executor 世界治理主线
- pack-local runtime storage 已稳定落地到：
  - `data/world_packs/<pack_id>/runtime.sqlite`
- `world/schema.ts`、`world/loader.ts` 与 `/api/narrative/timeline` 已退出代码主线
- `death_note` 默认样板已显式使用 mediator 表达
- `SimulationManager` 已完成第一轮 runtime facade 收口：
  - activation/bootstrap 主流程已抽离到 `apps/server/src/core/runtime_activation.ts`
  - 生产代码中的 `context.sim.prisma` 已清零
  - tick/calendar 读取已优先经由 facade，而不是继续要求调用方直连内部 `clock`
- ownership matrix 已完成第一轮决策：
  - world governance core -> pack runtime
  - `Post / ActionIntent / InferenceTrace / DecisionJob / relationship evidence` -> kernel-side Prisma
  - `Event` -> kernel-hosted shared evidence bridge
- `/api/agent/:id/overview` 已删除；web 默认调用面已统一到 `/api/entities/:id/overview`
- `/api/policy/*` 已明确为 access / projection policy debug surface，而不是 unified governance 主接口
- 当前 typecheck / unit / integration / e2e 验证均已通过

因此，本次文档修订的重点不是“框架是否成立”，而是：

1. 记录当前已完成的 unified governance 主线
2. 标记设计旧表述中已经被代码超越的部分
3. 记录当前已经完成的一轮 runtime boundary / ownership / compat API 收口
4. 保留仍值得后续演进的长期问题

---

## 2. 目标

### 2.1 核心目标

建立一套统一框架，使以下对象都能由 world-pack 声明并由 runtime 泛化执行：

- 死亡笔记
- 贵族头衔 / 封地合法性
- 神授印记 / 契约资格
- 魔法书 / 圣遗物 / 仪式媒介
- 特殊组织权限 / 域内司法权 / AI root authority

### 2.2 设计目标

1. **统一抽象**：字段权限、身份绑定、artifact 特权、世界规则使用同一套框架表达
2. **媒介优先**：将“死亡笔记”这类对象提升为正式的 rule mediator / authority vessel
3. **能力优先**：从“字段是否可读写”升级为“主体拥有哪些 capability”
4. **世界优先**：规则源头来自 world-pack，而不是散落在代码硬逻辑中
5. **客观执行**：不可抵抗的制度/超自然效果由世界规则引擎负责
6. **可观测性**：operator console 能看到 authority chain、rule execution、mediator linkage 的证据
7. **可泛化性**：不为 Death Note 写特例；未来世界包应通过声明复用能力
8. **存储隔离**：每个 pack 可拥有自己的运行时数据库与扩展 collection

### 2.3 非目标

本轮不追求：

- 完整脚本语言 / DSL VM
- 任意用户脚本执行
- 生产级多租户内容治理
- 一次性做完所有前端视图
- 一次性把全部 kernel-side 读模型迁入 pack-owned runtime

本轮优先建立 **正确的统一领域模型、稳定运行时边界与可继续收口的迁移方向**。

---

## 3. 核心设计原则

### 3.1 World-Pack = 世界宪法，而非剧情配置包

world-pack 负责声明：

- 世界允许存在什么实体
- 世界承认什么身份
- 世界有哪些能力
- 哪些媒介可授予/转移/放大/阻断能力
- 哪些客观规则会在满足条件时被执行
- 这些规则与数据如何被持久化、投影与观测

### 3.2 权限只是能力系统的一种投影

新系统以 **capability** 为中心：

- `perceive.*`
- `invoke.*`
- `mutate.*`
- `bind.*`
- `govern.*`
- `override.*`

字段 ACL 只是 capability 在 API / projection 上的一个投影，而不再是世界治理的最高抽象。

### 3.3 媒介是正式的一等公民

artifact / seal / title / contract / vessel 应正式参与：

- capability 授予
- authority 传播
- perception 放大/屏蔽
- objective rule execution

### 3.4 主观意图与客观规则分离

系统必须明确区分：

- **Subjective Decision**：agent 想做什么
- **Objective Enforcement**：世界允许什么、实际执行什么

### 3.5 一切重要链路都要有 provenance

每个 capability / authority / execution 都必须能追溯：

- 来源是谁
- 通过什么 mediator 获得
- 受哪些条件约束
- 为什么生效 / 失效

### 3.6 存储能力必须是声明式、可编译、可治理的

world-pack 可以声明自己的逻辑存储结构，但平台负责：

- validate
- compile
- materialize
- migrate
- observe

### 3.7 文档必须区分“已完成实现”与“剩余长期问题”

当前代码已经越过概念验证阶段，因此文档必须明确区分：

- 哪些内容已经在代码中成立
- 哪些边界已经完成一轮稳定收口
- 哪些问题仍然属于后续长期演进项

---

## 4. 当前实现快照 / Current Implementation Snapshot

### 4.1 已完成的主线模块

当前 unified governance framework 主线已落地到以下模块：

1. **Schema / Manifest**
   - `apps/server/src/packs/schema/constitution_schema.ts`
   - `apps/server/src/packs/schema/storage_schema.ts`
   - `apps/server/src/packs/manifest/constitution_loader.ts`
   - `apps/server/src/packs/manifest/loader.ts`
2. **Storage / Install**
   - `apps/server/src/packs/compiler/compile_pack_storage.ts`
   - `apps/server/src/packs/storage/pack_storage_engine.ts`
   - `apps/server/src/kernel/install/install_pack.ts`
3. **Pack runtime core**
   - `apps/server/src/packs/runtime/core_models.ts`
   - `apps/server/src/packs/runtime/materializer.ts`
   - `apps/server/src/packs/storage/*.ts`
4. **Authority / Perception / Inference**
   - `apps/server/src/domain/authority/resolver.ts`
   - `apps/server/src/domain/perception/resolver.ts`
   - `apps/server/src/domain/perception/template_renderer.ts`
   - `apps/server/src/domain/inference/context_assembler.ts`
5. **Invocation / Objective Enforcement**
   - `apps/server/src/domain/invocation/invocation_dispatcher.ts`
   - `apps/server/src/domain/rule/objective_rule_resolver.ts`
   - `apps/server/src/domain/rule/enforcement_engine.ts`
   - `apps/server/src/domain/rule/execution_recorder.ts`
6. **Projection / Evidence**
   - `apps/server/src/packs/runtime/projections/entity_overview_service.ts`
   - `apps/server/src/packs/runtime/projections/narrative_projection_service.ts`
   - `apps/server/src/kernel/projections/operator_overview_service.ts`
   - `apps/server/src/kernel/projections/projection_extractor.ts`
7. **样板与验证**
   - `apps/server/templates/world-pack/death_note.yaml`
   - `data/configw/templates/world-pack/death_note.yaml`
   - `data/world_packs/death_note/config.yaml`
   - typecheck / unit / integration / e2e 已通过

### 4.2 已移除的旧兼容层

以下输入或运行桥已退出 world-pack 主线：

- `scenario`
- `event_templates`
- `actions`
- `decision_rules`
- `world/materializer.ts`
- `world/state.ts`
- `world/event_templates.ts`
- `world/schema.ts`
- `world/loader.ts`
- `/api/narrative/timeline`
- enforcement engine 对 `ScenarioEntityState` 的兼容回写
- inference 对 legacy `decision_rules` 的主线依赖
- invocation / objective rule 对 `pack.actions` 的 bridge

### 4.3 当前仍保留但已完成降级定位的兼容/边界对象

以下内容仍然存在，但已经不再承担 unified governance 主线职责：

- `apps/server/src/core/simulation.ts`
  - 已完成第一轮 runtime facade 收口
  - activation/bootstrap 主流程已抽离到 `apps/server/src/core/runtime_activation.ts`
- `POST /api/policy`
- `POST /api/policy/evaluate`
  - 当前保留为 access / projection policy debug surface
  - 不再是 unified governance framework 中心接口
- `apps/server/src/world/bootstrap.ts`
  - 当前只是 bootstrap CLI/入口，不是 canonical schema/loader 命名桥

这意味着：

- 命名纯化主线已经完成
- compat API 已完成第一轮降级定位
- 仍存在少量长期边界问题可以继续演进，但不再属于“主线未成立”

---

## 5. 当前 World-Pack Contract（代码实际状态）

### 5.1 顶层结构

当前 world-pack 顶层 contract 为：

```yaml
metadata:
constitution:
variables:
prompts:
time_systems:
simulation_time:
entities:
identities:
capabilities:
authorities:
rules:
storage:
bootstrap:
```

其中 `rules` 当前包含：

- `perception`
- `capability_resolution`
- `invocation`
- `objective_enforcement`
- `projection`

### 5.2 已移除的旧顶层输入

以下字段已退出公开 contract：

- `scenario`
- `event_templates`
- `actions`
- `decision_rules`

### 5.3 `bootstrap.initial_states`

当前 `bootstrap.initial_states` 使用显式结构：

```yaml
bootstrap:
  initial_states:
    - entity_id: __world__
      state_namespace: world
      state_json:
        opening_phase: notebook_unclaimed
```

世界级状态统一使用：

- `entity_id='__world__'`
- `state_namespace='world'`

### 5.4 objective event contract

当前 `rules.objective_enforcement[*].then.emit_events[*]` 已使用**内联事件声明**，而不再依赖 template-key / registry bridge。

事件字段当前至少包括：

- `type`
- `title`
- `description`
- `impact_data`
- 可选 `artifact_id`

---

## 6. 新领域模型（当前完成度）

### 6.1 已明确 pack-owned 的核心模型

当前已进入 pack runtime 主线的核心模型：

- `WorldEntity`
- `EntityState`
- `AuthorityGrant`
- `MediatorBinding`
- `RuleExecutionRecord`

这些对象已经是当前 world-pack runtime 的正式宿主。

### 6.2 当前 ownership matrix 结论

#### 已 pack-owned

- `WorldEntity`
- `EntityState`
- `AuthorityGrant`
- `MediatorBinding`
- `RuleExecutionRecord`

#### 当前明确保留在 kernel-side Prisma

- `Post`
- `ActionIntent`
- `InferenceTrace`
- `DecisionJob`
- relationship runtime evidence

#### 当前 bridge-between-both 的对象

- `Event`
  - 产生源头可以来自 pack objective enforcement
  - 但消费面横跨 audit / memory / workflow follow-up / narrative projection
  - 当前更准确地属于 **kernel-hosted shared evidence bridge**

#### 当前结论

- world governance core 已经 pack-owned
- social / workflow / audit / relational evidence 当前大部分继续留在 kernel-side Prisma
- `Event` 当前承担 pack objective rule 与 kernel evidence/read model 之间的桥接角色
- 当前未引入正式 `PackOutboxEvent`

---

## 7. 运行时架构（当前状态）

### 7.1 当前模块分工

#### A. `packs/manifest/constitution_loader.ts` 与 `packs/manifest/loader.ts`
负责：

- 加载并解析 canonical world-pack contract
- schema validation
- 输出 canonical pack object

#### B. `packs/runtime/materializer.ts`
负责：

- materialize entities
- materialize identities
- materialize authorities
- materialize mediators
- materialize `bootstrap.initial_states`

并且当前已**不再读取 `pack.scenario`**。

#### C. `domain/authority/resolver.ts`
负责：

- 按 subject / context 解析有效 capability 集
- 解析 authority provenance / mediation chain

#### D. `domain/perception/resolver.ts`
负责：

- 当前主体能看见哪些 state / projection
- 替代旧 NarrativeResolver 中分散权限逻辑

#### E. `domain/rule/enforcement_engine.ts`
负责：

- 接收 `InvocationRequest`
- 校验 capability / mediator / target constraints
- 执行 objective effects
- 记录 `RuleExecutionRecord`
- 发射 narrative/operator 所需事件证据

#### F. `packs/runtime/projections/*`
负责：

- entity overview projection
- pack narrative timeline projection
- 为 operator projection 提供 pack-side evidence

### 7.2 当前新执行链

1. subject 形成意图（inference / workflow）
2. intent 指向某个 capability invocation
3. authority resolver 解析：
   - 是否具备 capability
   - 是否通过某 mediator 获得
   - 是否满足前置条件
4. enforcement engine 执行：
   - 解析 objective rule
   - 应用 state mutation
   - 发射事件
   - 写入 `RuleExecutionRecord`
5. projection layer 派生：
   - operator evidence
   - pack narrative timeline
   - actor/entity overview

### 7.3 当前 `SimulationManager` 状态

`apps/server/src/core/simulation.ts` 当前仍然持有：

- Prisma 初始化
- SQLite runtime pragma 初始化
- active pack runtime facade
- ChronosEngine 与 tick/calendar facade
- runtime speed facade
- graph query facade

但 pack activation/bootstrap 细节已经抽离到：

- `apps/server/src/core/runtime_activation.ts`

当前 `SimulationManager` 已显式提供：

- `getCurrentTick()`
- `getAllTimes()`
- `getStepTicks()`
- `getRuntimeSpeedSnapshot()`
- `getActivePack()`
- `resolvePackVariables()`

因此，当前更准确的表述是：

> `SimulationManager` 已完成第一轮 runtime facade 收口，但未来仍可继续向更细的 runtime bootstrapper / runtime facade / pack instance 边界演进。

---

## 8. 存储归属与 Pack 本地数据库

### 8.1 已实现的 storage contract

当前 `storage` 已支持：

- `strategy`
- `runtime_db_file`
- `projection_db_file`
- `engine_owned_collections`
- `pack_collections`
- `projections`
- `install.compile_on_activate`
- `install.allow_pack_collections`
- `install.allow_raw_sql`

### 8.2 已实现的治理边界

#### 允许

- 声明 `pack_collections`
- 声明字段类型、主键、索引 hint
- 声明 projection collection
- 声明 collection 的可见性与用途

#### 不允许

- 提交任意原始 SQL DDL
- 创建 trigger / pragma / arbitrary function
- 改写 kernel-owned tables
- 直接修改其他 pack 的 runtime database
- 绕过平台 compiler 执行 schema 变更
- `allow_raw_sql=true`

### 8.3 当前已成立的 pack runtime 边界

已成立：

- pack runtime database 路径：`data/world_packs/<pack_id>/runtime.sqlite`
- engine-owned collection 基线：
  - `world_entities`
  - `entity_states`
  - `authority_grants`
  - `mediator_bindings`
  - `rule_execution_records`
  - `projection_events`
- pack-specific schema 通过 compiler + storage engine materialize

### 8.4 当前关于 `PackOutboxEvent` 的判断

当前尚未引入正式 `PackOutboxEvent` 主线模型。

#### 当前结论

- 本轮不引入 `PackOutboxEvent`
- 现阶段继续使用：
  - objective enforcement 直接写 kernel `Event`
  - projection extraction / audit aggregation / workflow follow-up bridge

#### 不立即引入的理由

1. 当前 bridge 已足够支撑 narrative / audit / memory / workflow follow-up
2. 当前更重要的是边界澄清，而不是再引入新事件基础设施层
3. 过早引入 outbox 会把“边界收口”问题升级成更大的基础设施重构

---

## 9. Death Note 在新框架中的标准表达（当前状态）

在新框架中，Death Note 当前已经被表达为：

1. 一个 `WorldEntity(kind=artifact)`
2. 一个显式 `entities.mediators[*]`
3. 若干 `AuthorityGrant`
4. 一条或多条 `ObjectiveEnforcementRule`
5. 对应 projection / narrative evidence

### 9.1 当前默认样板已做到的部分

当前三份默认样板：

- `apps/server/templates/world-pack/death_note.yaml`
- `data/configw/templates/world-pack/death_note.yaml`
- `data/world_packs/death_note/config.yaml`

都已明确包含：

- `entities.artifacts`
- `entities.mediators`
- `authorities`
- `rules.objective_enforcement`
- `bootstrap.initial_states`

并且 authority / rule 已显式引用：

- `mediator-death-note`
- `artifact-death-note`
- `holder_of` target selector

### 9.2 当前结论

因此，下面这件事已经不再属于尾项：

> **Death Note 显式 mediator 化：已完成。**

当前剩余工作不再是样板表达缺失，而是更长期的 runtime boundary / operator / API 演进问题。

---

## 10. Projection / API / Operator 视角

### 10.1 当前已具备的后端基础

后端已经具备：

- entity overview projection
- pack narrative timeline projection
- operator overview projection
- global projection index
- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`
- `/api/entities/:id/overview`

### 10.2 当前仍保留但已完成降级定位的兼容接口

- `/api/policy/*`
  - 当前只应视为 access / projection policy debug surface
  - 不再是 unified governance framework 的中心接口
  - 本轮继续保留，不做删除

### 10.3 已移除的兼容接口

- `/api/narrative/timeline`
  - 已删除
  - narrative timeline 主线已统一到 `/api/packs/:packId/projections/timeline`
- `/api/agent/:id/overview`
  - 已删除
  - entity overview 主线已统一到 `/api/entities/:id/overview`

### 10.4 当前仍未完全达到的最终目标

设计原始目标里包含更强的 operator 视角：

- Authority Inspector
- Rule Execution Timeline 专项视图
- Perception Diff
- 更纯粹的 pack/entity-centric API surface

当前状态应客观表述为：

- 后端基础证据层已经建立
- API 主线路径已经 pack / entity 化
- 在当前单 active-pack 模式下，`/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 已完成显式语义收口：
  - 请求 `packId` 必须与当前 active pack 一致
  - 不一致时返回 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`
- `Event` bridge 当前已补齐最小 pack-scoped evidence metadata：
  - `impact_data.pack_id`
  - 以及 invocation / actor / source intent 等 bridge 字段
- compat API 已进入冻结阶段：
  - `/api/policy/*` -> access / projection policy debug surface only
- operator 产品形态仍有进一步演进空间；前端产品化明确由前端完成

---

## 11. 当前阶段的收口结论

### 11.1 已完成的阶段性收口

#### A. `SimulationManager`

已完成：

- activation/bootstrap 主流程抽离
- runtime tick/calendar facade 增加
- narrative variable resolve facade 增加
- 生产代码中的 `context.sim.prisma` 清零
- 生产代码优先通过 facade 读取 tick/calendar

#### B. Ownership Matrix

已完成第一轮边界决策：

- pack-owned：world governance core
- kernel-retained：`Post / ActionIntent / InferenceTrace / DecisionJob / relationship evidence`
- bridge-between-both：`Event`
- 不引入 `PackOutboxEvent`

#### C. Compat API

已完成第一轮收口：

- `/api/agent/:id/overview` -> 已删除
- web 默认调用面 -> `/api/entities/:id/overview`
- `/api/policy/*` -> debug surface 明确化

#### D. Pack API / Event bridge

已完成：

- `/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 的单 active-pack 语义收口
- `packId` 不匹配时显式返回 `PACK_ROUTE_ACTIVE_PACK_MISMATCH`
- objective enforcement / trigger_event 已补齐 `Event.impact_data.pack_id` 等 bridge metadata

### 11.2 当前仍值得继续推进的长期问题

1. `SimulationManager` 是否继续拆分为更清晰的 runtime bootstrapper / runtime facade / pack instance boundary？
2. `getGraphData()` 是否继续保留在 `SimulationManager` facade 中，还是外提到更独立的 query service？
3. `Event` 的 bridge 模型是否未来需要更显式的 outbox/extractor contract？
4. `/api/policy/*` 是否长期保留为 debug surface，还是迁移到更独立的 access-policy 子系统？
5. operator 高级视图（Authority Inspector / Perception Diff / Rule Execution Timeline）的前端产品化如何排期？

---

## 12. 风险与控制

### 风险 1：`SimulationManager` 再次长回“组合巨石”

**控制：**

- 避免把新编排逻辑继续堆入 `SimulationManager`
- 继续优先增加 facade / seam，而不是暴露更多内部对象

### 风险 2：ownership matrix 结论被后续实现再次模糊化

**控制：**

- 对 `Event / Post / ActionIntent / InferenceTrace / DecisionJob / relationship evidence` 继续保持文档与代码边界一致
- 若未来发生迁移，需先更新 design / ARCH / API 再实施

### 风险 3：compat API 虽已降级但仍被外部继续当主线

**控制：**

- 继续在 route 响应、文档与 web 调用面中保持 canonical/compat 的区分
- 为后续删除 compat route 保留可验证条件

### 风险 4：文档再次落后于代码

**控制：**

- design / plan / progress / ARCH / API 需要一起更新
- 不再保留已被代码淘汰的旧叙述

---

## 13. 验收标准（当前阶段）

### 当前已经满足

1. world-pack 可声明能力、媒介、授权、客观规则，而不仅是剧情动作
2. capability 已成为统一中心，字段权限不再是最高抽象
3. runtime 可解析 authority chain 与 mediator provenance
4. objective effect 由 enforcement engine 执行，而不是由 agent 主观决定
5. operator / projection 已能看到 entity / rule execution 等基础证据
6. per-pack runtime storage 已落地到 `data/world_packs/<pack_id>/runtime.sqlite`
7. storage 已是声明式、可编译、受治理接口
8. `death_note` 默认样板已显式使用 mediator 表达
9. `world/schema.ts`、`world/loader.ts` 与 `/api/narrative/timeline` 已退出主线
10. `SimulationManager` 已完成第一轮 runtime facade 收口
11. ownership matrix 已完成第一轮稳定决策
12. `/api/agent/:id/overview` 已删除，`/api/policy/*` 已完成第一轮降级定位
13. `/api/packs/:packId/overview` 与 `/api/packs/:packId/projections/timeline` 已完成单 active-pack 语义收口
14. `Event` bridge 已具备最小 pack-scoped metadata contract（`impact_data.pack_id` 等）

### 当前仍未完全满足

1. `SimulationManager` 进一步演化为更清晰的长期 runtime boundary 形态
2. `Event` bridge 是否未来需要更显式 outbox/extractor 契约
3. `/api/policy/*` 是否长期独立为 debug/access-policy surface
4. operator 高级视图前端产品化与更纯粹的 pack/entity-centric API surface 进一步演进

---

## 14. 开放问题

1. `SimulationManager` 最终是保留薄壳形式，还是继续拆成 runtime bootstrapper / runtime facade / pack instance boundary？
2. `Event` / `Post` 是否长期保留在 kernel-side 统一宿主，还是进一步细分为更严格的 evidence/event contract？
3. `ActionIntent` / `InferenceTrace` / `DecisionJob` 是否应继续永久属于 workflow kernel？
4. 是否需要正式 `PackOutboxEvent` 模型来替代当前较轻的 projection extraction / bridge 方式？
5. `/api/policy/*` 是否长期保留为 debug surface，还是应迁移到更独立的 access-policy 子系统？
6. 当前单 active pack 假设是否会在后续多 pack activation 下带来 API 语义调整？

---

## 15. 推荐下一步

基于当前代码状态，下一阶段最值得推进的已不再是“让 unified governance framework 成立”，而是继续做更长期的纯化与产品化：

1. **长期 runtime boundary 演进**
   - 继续评估 `SimulationManager` 的更细拆分
   - 决定 `getGraphData()` 等 query facade 是否进一步外提
2. **Event / bridge 合同演进**
   - 评估是否需要更显式的 outbox / extractor contract
   - 在不破坏现有 evidence 链的前提下提升边界清晰度
3. **Compat API 最终退场策略**
   - 评估 `/api/policy/*` 是否长期保留
4. **Operator 高级视图**
   - 后端继续稳定 authority / perception / rule execution evidence contract
   - 前端推进 Authority Inspector / Rule Execution Timeline / Perception Diff 等产品形态

当前 unified governance framework 应被视为：

> **主线已经成立，runtime facade / ownership matrix / compat API 已完成第一轮收口，当前进入长期边界纯化与 operator 产品化阶段。**