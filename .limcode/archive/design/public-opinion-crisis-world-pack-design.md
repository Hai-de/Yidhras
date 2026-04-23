# 舆论危机公关模拟器 world pack 从零创建设计

## 1. 背景与目标

本设计面向一次**从零创建具体 world pack** 的验证性工作，源材料来自已获授权的外部角色扮演平台草稿《新世界包草稿.md》。该草稿原本依赖：

- `<user>` 用户替换宏
- EJS 风格条件与变量读取
- 面向 AI 的长提示词式状态说明

本轮不追求兼容原平台运行时，而是要验证：

1. Yidhras 是否能容纳这种“现实题材 / 危机管理 / 舆论博弈”世界观。
2. Yidhras 的 world pack contract 是否足以承接该类题材的核心机制。
3. Yidhras 的 prompt workflow / AI task 组装链路，在失去 EJS 后是否仍能表达足够复杂的状态说明。
4. 从草稿到具体 pack 的语义迁移路径是否可重复。

### 1.1 本轮确认的边界

- 至少完成**中等链路验证**。
- 采用**语义迁移**，不兼容原 EJS。
- `<user>` 统一映射为 `actor` 语义，不保留角色扮演平台式占位结构。
- 产出的是**具体世界包**，不是抽象模板。
- 原草稿允许做**结构化裁剪**。
- 能用代码/结构表达的内容不再保留为松散 AI 提示；保留给 AI 的文案可尽量维持原稿语气。
- 中途若发现实现链路存在问题，需要暂停并显式告知用户，便于后续记录。

---

## 2. 拟创建的世界包定位

### 2.1 世界包名称

- 中文名：**舆论危机公关模拟器**
- 建议 Pack ID：`world-public-opinion-crisis`
- 建议目录：`data/world_packs/public_opinion_crisis/`

### 2.2 题材定位

这是一个：

- 现实取向
- 跨时代语境
- 事件驱动
- 多方博弈
- 资源/压力管理
- 舆论危机处置

世界包。

### 2.3 核心张力

玩家/主体并不是传统角色扮演中的“英雄”，而是在危机系统中承担某个位置的行动者。世界的中心不是主角，而是：

- 已经发生或即将发生的危机事件
- 舆论温度与公众情绪
- 组织协作与利益冲突
- 传播渠道与信息失真
- 预算、压力、时间窗口与错误决策

这类题材非常适合检验 Yidhras 对以下内容的承载能力：

- 抽象但复杂的世界状态
- 非超自然、非战斗型 action schema
- 事件状态机
- narrativized internal actions 与 objective world mutations 的边界
- task-aware prompt 组装是否足以替代外部 EJS 模板

---

## 3. 源草稿到 Yidhras 的迁移原则

## 3.1 迁移总原则

采用**三层拆分**：

1. **正式 contract 层**：写入 `config.yaml`
2. **人类可读说明层**：写入 `README.md`
3. **迁移与语义说明层**：写入 `docs/`

## 3.2 放弃的原平台机制

以下内容**不做兼容**：

- `<% if %>` / `<% const %>` / `getvar(...)`
- 原平台变量树访问方式
- 原平台基于 EJS 的模板执行逻辑
- `<user>` 作为文本宏或字段名的一部分

## 3.3 保留的原草稿资产

以下内容将保留其**语义与风格**：

- 危机阶段划分
- 世界宏观状态
- 主体压力 / 团体压力 / 协调效率等阈值语义
- 沟通渠道 / 组织 / 利益相关者 / 多方行动列表
- 战役模式与非战役模式
- 危机公关题材的叙事语气
- 具有原稿味道的 system/developer append 文案

## 3.4 `<user>` 的正式映射

统一映射为 `actor`。

推荐映射：

- `<user>履历` → actor 的长期经历 / 世界外延记录
- `<user>当前` → actor 当前状态 / 资源 / 所属关系
- `<user>` 在文本里出现时 → `{{ actor.display_name }}` 或 actor 相关 prompt 文本

结论：

- **数据语义以 actor 为主事实源**。
- **文案渲染用 actor 命名空间，不保留 `<user>`**。

---

## 4. 世界包信息架构

草稿原始结构可以重组为以下几组。

## 4.1 世界级状态 `world_state`

来自草稿中的 `[世界]` 与 `[舆论危机]` 一部分：

- 当前时间
- 舆情温度
- 经济景气度
- 政治活动
- 信息传播速度
- 公众情绪基调
- 行业新闻
- 危机类型
- 危机触发源
- 危机影响面
- 危机影响范围
- 危机阶段

这些应落在：

- `bootstrap.initial_states` 中的 `__world__ / world`
- 以及必要时的 `variables` 默认说明

## 4.2 actor 当前状态 `actor_state`

来自草稿中的 `[<user>当前]`：

- 人脉
- 战役模式
- 所在组织
- 战略目标
- 个人压力
- 担任身份位置
- 剩余预算
- 临时资源
- 所在小团体
  - 协调效率
  - 整体压力
  - 人员

这些适合落在：

- `entities.actors[].state`
- `identities[]`
- 少量共性说明进入 `prompts.agent_initial_context`

## 4.3 actor 历史状态 `actor_history`

来自 `[<user>履历]`：

- 历史绯闻
- 曾担任身份
- 曾经历事件
- 历史成就
- 模拟次数
- 达成目标次数

这一组更像**长程记录**，不一定适合全部塞入实体 state。建议：

- 第一版先作为 actor 的 state 内部字段保留最小可用版本
- 若后续需要长期沉淀与查询，再扩展到 `storage.pack_collections`

## 4.4 扩展性对象组

来自原草稿中的 extensible 结构：

- 沟通渠道
- 组织
- 利益相关者
- 多方行动列表
- 本局模拟挑战词条

建议迁移方式：

| 草稿结构 | 建议落点 |
|---|---|
| 沟通渠道 | `entities.artifacts` 或 `entities.institutions` 的简化表达；第一版更建议 world state 附属列表 |
| 组织 | `entities.institutions` |
| 利益相关者 | `entities.actors` 或 `entities.institutions`，视对象类型而定 |
| 多方行动列表 | 第一版先放 `bootstrap` 默认状态或 narrativized event 载荷 |
| 挑战词条 | `variables.challenge_pool` + AI task metadata / prompts |

结论：第一版不强求把所有 extensible 项都建成完全可操作实体；优先保留**世界表达力**，再决定哪些进入正式 capability 体系。

---

## 5. 第一版 contract 设计

## 5.1 metadata

建议字段：

```yaml
metadata:
  id: "world-public-opinion-crisis"
  name: "舆论危机公关模拟器"
  version: "0.1.0"
  description: "一个围绕舆情危机、组织协作、利益博弈、资源消耗与多方传播展开的现实取向模拟世界。"
  tags: ["public-opinion", "crisis-management", "modern", "governance", "simulation"]
  compatibility:
    yidhras: ">=0.5.0"
    schema_version: "world-pack/v1"
```

## 5.2 variables

`variables` 适合放：

- 题材常量
- 阈值说明文案
- 阶段枚举说明
- 默认挑战词条池
- 默认经济/传播/情绪标签集合

示例：

- `pack.variables.genre`
- `pack.variables.crisis_stage_catalog`
- `pack.variables.public_opinion_thresholds`
- `pack.variables.challenge_pool`
- `pack.variables.default_campaign_mode_note`

## 5.3 prompts

第一版最重要的两个 prompt：

- `global_prefix`
- `agent_initial_context`

建议用途：

### `prompts.global_prefix`
负责告诉模型：

- 这是什么世界
- 世界中心是危机事件而不是英雄叙事
- 世界的客观状态由舆论、传播、组织、利益博弈构成
- 模型必须尊重阶段、预算、压力、协作效率等条件

### `prompts.agent_initial_context`
负责告诉模型：

- 当前 actor 的身份位置
- 战略目标
- 压力、预算、人脉、临时资源
- 团体状态
- 当前危机概况

这里将承担原稿中大量 EJS 条件输出的替代功能，但改用 Yidhras 的受控模板语法与已有上下文装配能力。

## 5.4 ai

第一版建议显式配置以下 task：

- `agent_decision`
- `intent_grounding_assist`
- `context_summary`
- `memory_compaction`
- 可选：`classification`

用途：

### `agent_decision`
输出开放语义意图，例如：

- 稳定舆情口径
- 联系某利益相关者试探态度
- 使用某渠道发布声明
- 组织内部协调会议
- 投放误导信息
- 申请预算
- 争取缓冲时间

### `intent_grounding_assist`
把开放语义意图映射到当前世界包已声明的 capability 或 narrativized fallback。

### `context_summary` / `memory_compaction`
压缩长局模拟中的状态与事件摘要。

### `classification`
给危机事件打标签，例如：

- `rumor`
- `evidence_leak`
- `internal_conflict`
- `stakeholder_pressure`
- `media_escalation`
- `policy_intervention`

## 5.5 entities

建议第一版保持**适中复杂度**。

### actors
至少包含：

- `actor-player`：当前主体
- 若需要示范多方博弈，可加入 1~2 个关键 actor
  - 调查记者 / 竞争对手 / 组织上级 / 核心盟友

### institutions
建议包含：

- 所在组织
- 主要媒体系统
- 监管/政府机构
- 公众舆论场（也可抽象为 domain）

### domains
建议包含：

- 舆论域
- 组织内部域
- 非正式传播域
- 政策与监管域

### artifacts
现实题材下 artifact 不一定是物品，也可作为“媒介化工具”抽象使用。第一版可选：

- 官方声明渠道
- 匿名爆料渠道
- 内部通报系统
- 私人关系网络

如果 artifact 化会让结构更清晰，则使用；否则先放进 actor/world state。

## 5.6 identities

第一版至少给 `actor-player` 配置 identity，确保 actor 视角可进入 prompt 链路。

## 5.7 capabilities

这是第一版的关键设计点。为了验证世界观容纳性，不能只靠叙事文本，至少要声明一组**现实题材 action capability**。

建议第一版 capability 集：

- `invoke.issue_public_statement`
- `invoke.coordinate_internal_team`
- `invoke.contact_stakeholder`
- `invoke.allocate_budget`
- `invoke.use_channel`
- `invoke.collect_public_feedback`
- `invoke.seed_counter_narrative`
- `invoke.request_policy_support`
- `invoke.pause_and_recover`

另加一组只做 narrativized grounding 的“内部动作”：

- `record_private_assessment`
- `revise_strategy_note`
- `review_stakeholder_map`

## 5.8 authorities

第一版授权策略应尽量简单：

- actor-player 对一组核心 capability 有 intrinsic grant
- 某些 capability 需绑定 institution / channel / role
- 某些高权限行为可通过 `conditions_json` 约束
  - 如预算不足不可投放高成本动作
  - 团队协调效率过低时，协同类动作效果受限

## 5.9 rules.invocation

第一版 invocation rule 是整包可玩性的核心。

建议支持三种 resolution 模式：

1. **exact**：开放意图直接落到 capability
2. **translated**：多种近义行为翻译到同一 capability
3. **narrativized**：只保留叙事痕迹，不改变客观世界

示例映射：

| semantic intent | resolution |
|---|---|
| 发布公开回应 | `invoke.issue_public_statement` |
| 组织开会统一口径 | `invoke.coordinate_internal_team` |
| 找记者放风 | `translated -> invoke.use_channel` |
| 私下复盘 | narrativized |
| 重写应对方案 | narrativized |
| 试探利益相关者底线 | `invoke.contact_stakeholder` |
| 花钱压热度 | `invoke.allocate_budget` 或 narrativized fallback |

## 5.10 rules.objective_enforcement

第一版 objective_enforcement 负责把能力执行结果写回：

- actor 压力
- 团队压力
- 协调效率
- 剩余预算
- 危机阶段
- 舆情温度
- 公众情绪
- 关键利益相关者态度
- 媒体放大程度

重要原则：

- 不是所有 action 都必须立刻改变客观世界
- 一部分 action 可以只产生事件记录
- 需要客观变更的 action，优先修改少量高价值状态字段

## 5.11 bootstrap

第一版 bootstrap 建议初始化：

- 世界状态：处于 `日常监测` 或 `危机爆发` 前夜
- actor-player：有一个明确身份和有限预算
- 所在组织：存在明显协作问题
- 危机对象：已有潜伏风险或初始舆情
- 若要验证中等链路，最好自带一个可推进的初始事件

---

## 6. 原草稿字段的建议映射表

| 原草稿 | Yidhras 第一版落点 | 说明 |
|---|---|---|
| `<user>履历` | actor state / 后续 storage | 第一版先简化保留 |
| 世界.当前时间 | bootstrap.world_state | 如需时钟再配 time_systems |
| 世界.舆情温度 | world_state.public_opinion_temperature | 可作为主指标 |
| 世界.经济景气度 | world_state.economic_cycle | 枚举值 |
| 世界.政治活动 | world_state.political_activity | 字符串/枚举 |
| 世界.信息传播速度 | world_state.information_velocity | 枚举值 |
| 世界.公众情绪基调 | world_state.public_mood | 枚举值 |
| 世界.行业新闻 | world_state.industry_news | 列表 |
| `<user>当前.人脉` | actor.state.networks | 列表 |
| 战役模式 | actor.state.campaign_mode | 布尔 |
| 所在组织 | actor.state.organization_id | 关联 institution |
| 战略目标 | actor.state.strategy_goal | 字符串 |
| 个人压力 | actor.state.personal_pressure | 数值 |
| 担任身份位置 | identity / actor.state.role_position | 文本 + identity |
| 剩余预算 | actor.state.remaining_budget | 数值 |
| 临时资源 | actor.state.temporary_resources | 列表 |
| 所在小团体 | actor.state.team | 嵌套对象 |
| 危机.* | world_state.crisis_* | 第一版统一 world state 承载 |
| 沟通渠道 | institution/artifact/world list | 第一版不强求 fully entityized |
| 组织 | entities.institutions | 适合正式实体 |
| 利益相关者 | actors/institutions/list | 视复杂度决定 |
| 多方行动列表 | world_state / narrativized events | 第一版先保表达，不强求自动执行 |
| 本局模拟挑战词条 | variables.challenge_pool / bootstrap.current_challenges | 适合作为 AI 限制上下文 |

---

## 7. 提示词组装策略

## 7.1 为什么不再需要 EJS

原稿中的 EJS 主要承担两件事：

1. 读变量
2. 根据阈值输出说明性文案

Yidhras 当前具备：

- namespaced 变量上下文
- `{{ ... }}` 插值
- `default(...)`
- `#if`
- `#each`
- task-aware prompt workflow
- AI task 的 system/developer/user append

因此**语义上足以替代 EJS**，但要接受一个前提：

> 复杂的数值区间判断，不应继续依赖模板本身完成，而应尽量前置为结构化状态、规则结果或准备好的文案字段。

## 7.2 本包的提示词策略

### A. 结构优先
把原稿中“0~20%、20~40%”这类阈值判断，尽量转成：

- 直接写入状态阶段字段
- 或由 objective_enforcement / bootstrap 初始化写入

例如：

- `actor.state.personal_pressure_stage = "紧张期"`
- `actor.state.team_pressure_stage = "重压期"`
- `world_state.public_opinion_stage = "媒体瞄准"`

这样 prompt 只负责读，不负责算。

### B. 文案保留原稿语气
对关键说明段，尽量保留原文气质，放进：

- `prompts.global_prefix`
- `ai.tasks.agent_decision.prompt.system_append`
- `ai.tasks.intent_grounding_assist.prompt.developer_append`

### C. 内部动作与客观动作分离
原稿里有很多“思考、试探、复盘、估计”类行为，这类不一定适合世界客观变更。

策略：

- 客观动作进入 capability + objective_enforcement
- 内部动作走 narrativized event

---

## 8. 本轮已发现的链路边界与风险

这是本设计最关键的部分，需要显式记录。

## 8.1 已确认可用的链路

从当前代码看，以下链路是成立的：

1. world pack schema 支持 `ai.defaults / ai.tasks` 配置。
2. `agent_decision`、`intent_grounding_assist`、`context_summary`、`memory_compaction` 可走 task-aware prompt workflow。
3. `prompts.global_prefix` 与 `prompts.agent_initial_context` 会被渲染进 prompt bundle。
4. AI task 配置中的 `system_append`、`developer_append`、`user_prefix` 会在消息适配阶段进入最终消息。
5. `intent_grounding_assist` 是正式 task type，可用于世界包的开放语义意图落地。

## 8.2 已发现的明显边界：`include_sections` 目前更像提示而非强约束

当前代码路径显示：

- `include_sections` 能进入 `AiResolvedTaskConfig`
- 能在 `prompt_bundle_adapter` 中进入 developer message 的 “Included Context Sections Hint”
- 但**没有看到它直接驱动 prompt workflow 实际选择或裁剪 sections 的实现**

这意味着：

> 对 pack 作者而言，`ai.tasks.*.prompt.include_sections` 目前更像“给模型/调用链看的提示元数据”，而不是严格的上下文装配控制器。

这会影响本次“拷打项目提示词组装链路”的结论，必须记录。

### 对本轮设计的影响

- 第一版 world pack 不能过度依赖 `include_sections` 实现精密上下文裁剪。
- 真正关键的信息仍应放在：
  - `prompts.global_prefix`
  - `prompts.agent_initial_context`
  - AI task 的 `system_append` / `developer_append`
  - inference context 中天然可见的 actor/world 状态

## 8.3 第二个边界：复杂阈值计算并非模板强项

Prompt Workflow 支持 `#if` / `#each`，但不支持任意 JS 表达式。

因此像原草稿这种：

- `舆情温度 0~1000` 分十段
- `个人压力 / 团体压力 / 协调效率` 多区间描述

不能原样搬入模板执行。

### 对本轮设计的结论

必须把一部分“区间解释逻辑”转成：

- 预先计算好的 stage 字段
- 或更少层级、更少分段的世界状态

## 8.4 第三个边界：extensible 对象组缺少现成高阶治理语义

原稿里：

- 沟通渠道
- 组织
- 利益相关者
- 多方行动列表

都有强烈的动态扩展特征。

Yidhras contract 能容纳这些数据，但第一版若把它们全部做成深度对象图，会显著增加：

- capability 设计复杂度
- objective_enforcement 数量
- actor/world state 的同步难度

### 对本轮设计的结论

第一版应采用：

- **关键对象实体化**
- **次要对象列表化 / 状态化**

而不是全量实体化。

---

## 9. 第一版实现建议

## 9.1 推荐最小可运行内容

第一版建议最少包含：

- 1 个玩家 actor
- 2~4 个 institution / domain
- 5~9 个 capability
- 6~12 条 invocation rule
- 4~8 条 objective_enforcement rule
- 2 条核心 prompts
- 4 个 AI task override
- 1 个明确初始危机场景

## 9.2 不建议第一版就做的内容

- 把所有 extensible 结构都做成完整实体
- 自动生成多方行动列表
- 完整 campaign 多关卡系统
- 复杂 storage schema
- 大量 projection / perception rule
- 完整跨时代差异系统

这些会稀释本轮“验证项目容纳性”的主目标。

---

## 10. 中等链路验收标准

本轮至少达到以下验收标准：

### 10.1 Pack 合法性

- world pack 能通过 schema 校验
- 能放入 `data/world_packs/<pack-dir>/`
- 运行时能识别并加载

### 10.2 世界表达能力

- 能表达危机阶段
- 能表达 actor 当前状态
- 能表达组织/传播/利益相关者中的核心部分
- 能表达至少一组现实题材 capability

### 10.3 Prompt 链路验证

- `prompts.global_prefix` 与 `agent_initial_context` 成功进入 prompt bundle
- `ai.tasks.agent_decision` 与 `intent_grounding_assist` 成功带上 pack 级 override
- 能观察到 task-aware prompt workflow metadata
- 能确认 `include_sections` 的实际边界

### 10.4 语义迁移完成度

- 不再依赖 `<user>` 与 EJS
- actor 命名空间可承接主体语义
- 原稿关键阈值逻辑被转为结构状态或更适配的描述方式

### 10.5 可记录的不足

若实现中发现以下现象，应视为“项目边界发现”，而非本包失败：

- task prompt include_sections 无法实质控制 section 选择
- 某些现实题材 action 很难优雅映射为 capability
- 复杂动态对象图需要额外宿主支持
- world state 的派生阶段缺少自动计算面

---

## 11. 拟输出物

若进入实现阶段，建议生成：

```text
data/world_packs/public_opinion_crisis/
├─ config.yaml
├─ README.md
├─ CHANGELOG.md
├─ docs/
│  ├─ migration-notes.md
│  ├─ state-model.md
│  └─ chain-findings.md
└─ examples/
   └─ overrides.example.yaml
```

其中：

- `config.yaml`：正式合约
- `README.md`：玩法、背景、边界
- `migration-notes.md`：原草稿到 actor/world/capability 的映射
- `state-model.md`：状态字段说明
- `chain-findings.md`：本轮发现的提示词组装链路边界

---

## 12. 建议的下一步

在本设计获确认后，再进入实现计划阶段。

建议实施顺序：

1. 先搭出最小目录与 metadata
2. 先定义 world/actor/bootstrap 基础状态
3. 再补 prompts 与 ai.tasks
4. 再补 capabilities / authorities / invocation rules
5. 最后补 objective_enforcement、README 与迁移说明

在实现过程中，只要碰到：

- `include_sections` 无法满足预期
- 某类现实动作没有合适落点
- actor/world state 的可见性不满足 prompt 需要

应立即暂停并向用户报告，作为链路观察记录。