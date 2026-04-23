<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/public-opinion-crisis-world-pack-design.md","contentHash":"sha256:623d934d307f7e4f9e2f9218e1580d8be422354fe35ce86bbae3036b36119a64"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 设计现实题材 capability、authority、invocation 与 objective_enforcement 的首版最小闭环  `#plan-capabilities-rules`
- [x] 规划 README 与 docs 文档，记录迁移映射、状态模型与链路发现  `#plan-docs-migration`
- [x] 创建世界包目录骨架与最小项目化交付物范围，明确 config/README/CHANGELOG/docs/examples 的首版边界  `#plan-pack-skeleton`
- [x] 设计 prompts 与 ai.tasks 配置，验证 actor 命名空间替代 <user>、受控模板替代 EJS 的方案  `#plan-prompts-ai`
- [x] 把草稿重构为 world_state、actor_state、actor_history 及关键扩展对象的首版字段模型  `#plan-state-model`
- [x] 修正 objective_enforcement invocation_type 与实际 dispatch 链路不一致的问题，并继续验证 loader / prompt bundle / grounding-enforcement 链路，记录需向用户报告的结构性边界  `#plan-validation-checkpoints`
<!-- LIMCODE_TODO_LIST_END -->

# 舆论危机公关模拟器 world pack 实施计划

## 来源设计

- 源设计文档：`.limcode/design/public-opinion-crisis-world-pack-design.md`
- 本计划严格以已确认设计为准，不再回退到原平台 EJS 兼容路线。

## 目标

在不兼容原平台 EJS、统一以 `actor` 替代 `<user>` 的前提下，创建一个具体的 `舆论危机公关模拟器` world pack，并至少完成**中等链路验证**：

1. world pack 合约合法、可被识别与加载。
2. 草稿的核心世界机制完成语义迁移。
3. prompt workflow / AI task 组装链路可承接该题材的关键提示信息。
4. 发现的项目边界被显式记录，而不是被实现细节掩盖。

---

## 实施范围

### 包含

- `data/world_packs/public_opinion_crisis/` 下的首版世界包项目化结构
- `config.yaml` 首版 contract
- `README.md`、`CHANGELOG.md`
- `docs/` 下的迁移说明、状态模型说明、链路发现说明
- 至少一轮中等链路验证所需的配置与检查步骤

### 不包含

- 原平台 EJS 运行时兼容
- 自动化“草稿 -> world pack”转换器
- 完整 campaign 多阶段系统
- 全量动态 extensible 对象图的实体化
- 为所有次要对象补齐复杂 storage / projection / perception 规则

---

## 阶段拆解

## Phase 1：包骨架与最小项目化交付物

### 目标

先建立一个可持续演进的 world pack 项目骨架，而不是直接堆砌 YAML。

### 计划内容

1. 在 `data/world_packs/public_opinion_crisis/` 下建立首版结构：
   - `config.yaml`
   - `README.md`
   - `CHANGELOG.md`
   - `docs/`
   - `examples/`
2. 先写入最小 metadata、compatibility、tags、作者信息。
3. 在 README 中明确：
   - 这是现实题材危机公关世界包
   - 不兼容原平台 EJS
   - 本包的目标是验证 Yidhras 对该世界观的容纳性与链路边界

### 产出

- 一个结构完整但内容可逐步填充的 world pack 项目目录

### 验收点

- 目录结构符合仓库 world-pack 规范
- `config.yaml` 具备最小可解析骨架

---

## Phase 2：状态模型重构

### 目标

把《新世界包草稿.md》的 AI 提示词型数据，重构为 Yidhras 可承接的 world/actor 状态结构。

### 计划内容

1. 设计并落地 `world_state`：
   - `current_time`
   - `public_opinion_temperature`
   - `public_opinion_stage`
   - `economic_cycle`
   - `political_activity`
   - `information_velocity`
   - `public_mood`
   - `industry_news`
   - `crisis_type`
   - `crisis_trigger`
   - `crisis_impact_dimensions`
   - `crisis_impact_scope`
   - `crisis_stage`
2. 设计并落地 `actor-player.state`：
   - `campaign_mode`
   - `organization_id`
   - `strategy_goal`
   - `personal_pressure`
   - `personal_pressure_stage`
   - `role_position`
   - `remaining_budget`
   - `networks`
   - `temporary_resources`
   - `team.coordination_efficiency`
   - `team.coordination_stage`
   - `team.overall_pressure`
   - `team.overall_pressure_stage`
   - `team.members`
3. 设计 `actor_history` 的首版保留方式：
   - 暂放 actor state 内部字段，避免第一版被 storage 复杂度拖住
4. 对 extensible 对象组做首版分层：
   - 关键组织 -> `entities.institutions`
   - 关键利益相关者 -> 精选 actor / institution
   - 沟通渠道 / 多方行动 / 挑战词条 -> 先列表化或状态化

### 关键策略

- 把复杂阈值判断前置为 stage 字段，不在模板里重算。
- 只保留中等链路验证必须的高价值字段。

### 产出

- `bootstrap.initial_states`
- `entities.actors`
- `entities.institutions`
- 必要的 `variables`

### 验收点

- 草稿核心状态已能以结构化方式表达
- 不再依赖 `<user>` 或 `getvar(...)`

---

## Phase 3：prompts 与 AI task 迁移

### 目标

验证 Yidhras 的 prompt workflow / AI task 组装链路能否取代原稿中的 EJS 拼装职责。

### 计划内容

1. 设计 `prompts.global_prefix`：
   - 说明世界中心是危机事件而非角色扮演
   - 强化现实题材、组织博弈、舆情传播、资源消耗的约束
2. 设计 `prompts.agent_initial_context`：
   - 读取 actor 当前身份、预算、压力、团队、危机信息
   - 保留原稿的危机公关语气
3. 设计 `ai.defaults` 与以下 task override：
   - `agent_decision`
   - `intent_grounding_assist`
   - `context_summary`
   - `memory_compaction`
   - 可选 `classification`
4. 在 task override 中优先使用：
   - `system_append`
   - `developer_append`
   - `user_prefix`
   - 少量 `metadata`
5. 明确不把 `include_sections` 当作强控制面使用，只把它当成提示信息。

### 特别验证项

- `prompts.global_prefix` 是否进入 world prompt
- `prompts.agent_initial_context` 是否进入 role prompt
- `system_append` / `developer_append` / `user_prefix` 是否进入最终消息
- `workflow_task_type` / `workflow_profile_id` 等元数据是否可观察

### 产出

- world prompts
- ai task config
- 首版用于现实题材的 task 文案

### 验收点

- actor 命名空间可自然替代 `<user>`
- 不需要 EJS 即可表达关键上下文
- 已显式记录 `include_sections` 的弱约束边界

---

## Phase 4：capability / authority / invocation / objective_enforcement 闭环

### 目标

为这个现实题材世界包建立一个最小但真实的 action 闭环，避免整个世界只停留在静态提示词层。

### 计划内容

1. 定义首版 capability 集：
   - `invoke.issue_public_statement`
   - `invoke.coordinate_internal_team`
   - `invoke.contact_stakeholder`
   - `invoke.allocate_budget`
   - `invoke.use_channel`
   - `invoke.collect_public_feedback`
   - `invoke.seed_counter_narrative`
   - `invoke.request_policy_support`
   - `invoke.pause_and_recover`
2. 定义最小 authority：
   - `actor-player` 的 intrinsic grant
   - 基于组织/渠道/条件的受限 grant
3. 定义 invocation rules：
   - exact：公开回应、协调团队、联系利益相关者
   - translated：放风、找媒体、借渠道表态等近义行为
   - narrativized：复盘、私下评估、重写方案、试探局势
4. 定义 objective_enforcement：
   - 变更 `world_state.crisis_stage`
   - 变更 `world_state.public_opinion_temperature`
   - 变更 `actor.state.personal_pressure`
   - 变更 `actor.state.remaining_budget`
   - 变更 `actor.state.team.*`
   - 记录关键事件
5. 尽量用少量高价值状态变更形成可观测闭环，避免第一版 objective_enforcement 爆炸。

### 设计原则

- 现实题材 action 允许大量 translated / narrativized 模式共存。
- 不强求每个动作都立刻改变客观世界。
- 行为结果优先落到“危机阶段 / 舆情 / 压力 / 预算 / 协作”五类核心指标。

### 产出

- capabilities
- authorities
- rules.invocation
- rules.objective_enforcement

### 验收点

- 至少存在一条从开放语义意图到 capability 再到世界状态变更的闭环
- 至少存在一条 narrativized fallback 闭环

---

## Phase 5：文档与迁移记录

### 目标

把“做了什么”与“为什么这样做”分开记录，方便用户后续整理项目解读。

### 计划内容

1. `README.md`：
   - 世界前提
   - 核心机制
   - 目录结构
   - 使用方式
   - 设计边界
   - 已知限制
2. `CHANGELOG.md`：
   - 记录 0.1.0 初始化内容
3. `docs/migration-notes.md`：
   - 记录草稿字段到 actor/world/capability 的映射
4. `docs/state-model.md`：
   - 记录核心字段及其语义
5. `docs/chain-findings.md`：
   - 记录本轮发现的提示词组装链路边界
   - 尤其标记 `include_sections` 当前只是 hint

### 验收点

- pack 既可供 runtime 读取，也可供人类维护与复盘
- 后续用户可以直接引用 docs 做项目解读与缺口记录

---

## Phase 6：中等链路验证与暂停机制

### 目标

确保本轮不是“写完配置即结束”，而是有明确验证面与暂停上报条件。

### 计划内容

1. 进行最小合法性检查：
   - schema 可通过
   - pack 可被运行时识别
2. 进行 prompt 链路检查：
   - world prompt / role prompt 是否正确进入 bundle
   - AI task override 是否进入消息构造
3. 进行规则闭环检查：
   - 至少一条现实题材 action 的 invocation -> enforcement 闭环成立
4. 记录发现：
   - 不能实质控制 section 选择的地方
   - 现实题材动作不易能力化的地方
   - 需要宿主补强的地方

### 强制暂停条件

实现中一旦发现以下情况，应暂停并向用户报告，而不是继续硬写：

1. `include_sections` 的行为与预期严重不符，影响中等链路判断。
2. actor/world state 在 inference context 中不可见，导致 prompts 无法读到关键状态。
3. 现实题材关键动作无法稳定映射为 capability / invocation 规则。
4. schema 或 loader 对本题材表达存在结构性阻碍，需要调整建模路线。

### 验收点

- 有一份清晰的“可实现性 + 边界发现”记录
- 用户能据此继续做项目层分析

---

## 实施顺序建议

1. 先搭项目骨架与 metadata
2. 再建 world/actor/bootstrap 状态
3. 再写 prompts 与 ai.tasks
4. 再补 capabilities / authorities / rules
5. 最后补 README / docs / CHANGELOG
6. 最后做中等链路检查与边界记录

---

## 风险清单

### 风险 1：`include_sections` 不是强控制面

- 现状：更像 developer message 中的 hint
- 应对：核心信息放在 prompts 与 append，不依赖该字段精准裁剪

### 风险 2：模板无法承接复杂数值区间逻辑

- 现状：不支持任意 JS 表达式
- 应对：把区间解释固化成 stage 字段

### 风险 3：extensible 对象全量实体化会显著抬高复杂度

- 现状：草稿动态对象很多
- 应对：第一版只实体化关键对象，其余列表化

### 风险 4：现实题材 action 容易沦为纯叙事

- 现状：若 capability 设计过弱，会失去“世界包”的结构价值
- 应对：强制保留至少一条真实 objective_enforcement 闭环

---

## 计划完成定义

当以下条件同时满足时，本计划视为完成：

1. `舆论危机公关模拟器` world pack 的首版项目骨架与 config 完成。
2. 草稿核心机制已完成 actor/world 语义迁移。
3. prompts 与 ai.tasks 能覆盖中等链路验证所需信息。
4. 至少一条 capability -> invocation -> objective_enforcement 闭环可成立。
5. README 与 docs 已记录迁移方式和链路边界。
6. 已将发现的实现问题明确整理，必要时向用户暂停汇报。
