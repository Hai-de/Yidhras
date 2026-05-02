# Death Note 世界包专属动作、Intent Grounder 与叙事失败回退设计

## 1. 背景

当前项目已经具备以下基础：

- runtime loop：`step -> scheduler -> decision runner -> action dispatcher`
- workflow persistence：`DecisionJob / InferenceTrace / ActionIntent`
- capability / authority / mediator / objective enforcement 主线
- `death_note` world-pack 已有最小媒介表达：
  - `artifact-death-note`
  - `mediator-death-note`
  - `invoke.claim_death_note`
  - `invoke.form_murderous_intent`

但当前仍存在三个核心缺口：

1. Death Note 世界包的专属动作/规则只到“拿到笔记 / 形成杀意”，还未覆盖获取信息、选择目标、执行裁决、调查对抗与协作。
2. inference provider 当前主要输出固定的少量动作，缺少面向 world-pack 语义的决策落地层。
3. unexpected action（如“跳大神”）当前若不属于显式支持动作，容易直接走到 unsupported / dispatch fail，而不是“失败但真实发生”的叙事事件。

因此需要一个新的设计：

> **思考保持开放，落地由世界解释，真正执行仍严格受显式 capability 约束。**

---

## 2. 目标

### 2.1 核心目标

1. 完善 Death Note world-pack 的专属动作/规则集合。
2. 引入一个正式的 **Intent Grounder**，负责把 Agent 的开放意图落地为：
   - 可执行 capability
   - 可翻译的近似动作
   - 可叙事化但失败的真实事件
   - 或保留阻断
3. 明确 unexpected action 的处理原则：
   - **允许存在**
   - **允许被记录**
   - **允许成为叙事事件**
   - **不允许绕过 capability 直接产生客观世界效果**
4. 在当前阶段 **不引入专门的 world-governor/admin agent**，但代码与模型要允许未来某些 pack 以普通 actor/institution 形式加入此类角色。
5. 为多 Agent 协作提供统一路径：
   - 共享证据
   - 显式协作 capability
   - event-driven follow-up

### 2.2 非目标

当前阶段不优先做：

- 枚举世界中的所有微动作
- 任意 LLM 裁判式“世界管理员”
- 通用脚本 VM
- 所有 pack 都共用的复杂动作 DSL
- 一次性完成所有前端专题页产品化

---

## 3. 设计原则

### 3.1 开放意图、受限执行

- Agent 可以提出开放式想法与方法。
- 世界引擎负责解释这些想法在当前 pack 中意味着什么。
- 真正能改变客观世界的，只能是显式 capability + objective rules。

### 3.2 不列出所有动作，只列出可治理 affordance

不应把所有可能动作都做成枚举菜单。

应由 world-pack 只声明：

- 重要 affordance（世界承认的高层行动语义）
- 可执行 capability（世界真正允许的客观动作）
- invocation grounding / fallback policy

### 3.3 unexpected action 可叙事化，但不可越权

若 action 不属于显式可执行能力：

- 可以被翻译成近似动作
- 可以被叙事化为失败但真实发生的事件
- 可以被记录为尝试/误判/无效行为
- 不能直接跳过 capability 校验去改世界状态

### 3.4 多 Agent 协作应通过显式证据与协作动作完成

协作不应依赖隐式共享脑。
应通过：

- Event
- Post
- RuleExecutionRecord
- pack state
- 显式协作 capability

形成可追踪协作。

### 3.5 不在第一阶段引入专门 governor agent

当前阶段，world governance 的最终裁决者仍是：

- authority resolver
- invocation grounding
- objective enforcement engine

未来若某个 pack 需要“管理员/裁决者/制度中枢”，应优先建模为：

- ordinary institution actor
- system identity
- mediator/institution entity

而不是新增一条专门绕过治理主线的隐藏后门。

---

## 4. 三层模型

建议正式采用三层架构：

### Layer 1：开放意图层（Agent Thought / Proposed Intent）

Agent 输出的不是“最终一定可执行的动作列表”，而是：

- 我想做什么
- 为什么这么做
- 我希望达到什么效果
- 我建议采用什么方式

例如：

- “我想确认这个人是否值得裁决”
- “我想通过某种神秘方式确认目标命运”
- “我想误导警方”
- “我想请求他人协助调查”

### Layer 2：Intent Grounder（世界解释 / affordance grounding）

Intent Grounder 负责：

1. 把开放意图映射到当前 pack 的 affordance
2. 判断需要的 capability
3. 检查当前 actor 是否具备能力
4. 选择以下落地模式之一：
   - `exact`
   - `translated`
   - `decomposed`
   - `narrativized`
   - `blocked`

### Layer 3：显式能力执行层（Capability Execution）

最终能执行并产生 objective effect 的，只能是：

- `invoke.*` capability
- 或现有 kernel 通用 intent（`post_message` / `adjust_relationship` / `adjust_snr` / `trigger_event`）

---

## 5. World-Pack 合同扩展策略

## 5.1 capability 仍是最终执行合同

继续保持：

- capability = 可执行客观动作的最小权力单位
- authority = capability 的授予方式
- mediator = capability 生效媒介
- objective rule = capability 的世界效果

即：

> **没有 capability，就没有 objective execution。**

## 5.2 `rules.invocation` 作为 Intent Grounder 的 pack 声明层

当前 schema 已有：

- `rules.invocation: []`

但主线尚未实际承担语义动作解释职责。

建议将其正式提升为：

> **world-pack 对开放意图进行 grounding / translation / narrativization 的声明层。**

### 设计意图

`rules.invocation[*]` 不直接承担 world mutation；它负责说明：

- 哪类 semantic intent 对应哪个 affordance
- 哪类 affordance 需要哪个 capability
- 若 capability 不足，应翻译、叙事化还是阻断
- unexpected action 的默认回退事件模板

### 建议语义（逻辑层，不要求第一步改 schema 很重）

可在现有通用 `when/then` 结构中约定使用：

#### `when`
- `semantic_intent.kind`
- `semantic_intent.tags[]`
- `semantic_intent.desired_effect`
- `semantic_intent.target.kind`
- `subject_role`
- `subject_state.*`

#### `then`
- `affordance_key`
- `requires_capability`
- `resolution_mode`
- `translate_to_capability`
- `translate_to_kernel_intent`
- `narrativize_event`
- `explanation`

### Resolution Modes

- `exact`：直接命中 capability
- `translated`：翻译为最近似的 capability / kernel intent
- `decomposed`：拆成多个步骤（后续阶段）
- `narrativized`：变成失败但真实发生的叙事事件
- `blocked`：保留为结构化拒绝（保留为少数场景）

---

## 6. Death Note Pack：第一批专属 affordance / capability

当前阶段不追求穷尽，只做最小但完整闭环。

## 6.1 Notebook Possession / Rule Access

### affordance
- `claim_notebook`
- `transfer_notebook`
- `relinquish_notebook`
- `learn_notebook_rules`

### capability
- `invoke.claim_death_note`
- `invoke.transfer_death_note`
- `invoke.relinquish_death_note`
- `invoke.learn_notebook_rules`

## 6.2 Intent Formation / Judgement Preparation

### affordance
- `form_judgement_intent`
- `choose_target`

### capability
- `invoke.form_murderous_intent`
- `invoke.select_judgement_target`

## 6.3 Intelligence Gathering

### affordance
- `gather_target_intel`
- `confirm_target_name`
- `confirm_target_face`
- `observe_investigation_reaction`

### capability
- `invoke.collect_target_intel`
- `invoke.confirm_target_name`
- `invoke.confirm_target_face`
- `invoke.observe_case_pressure`

## 6.4 Judgement Execution

### affordance
- `execute_judgement`

### capability
- `invoke.execute_death_note`

## 6.5 Concealment / Counterplay

### affordance
- `conceal_identity`
- `mislead_investigation`
- `stage_normality`

### capability / kernel intents
- `invoke.conceal_notebook_linkage`
- `invoke.raise_false_suspicion`
- 或落地为 `post_message` / `adjust_relationship`

## 6.6 Investigation / Collaboration

### affordance
- `investigate_death_cluster`
- `share_case_intel`
- `request_joint_observation`
- `publish_case_update`

### capability / kernel intents
- `invoke.investigate_suspicious_death`
- `invoke.share_case_intel`
- `invoke.request_joint_observation`
- `invoke.publish_case_update`

---

## 7. Death Note Pack：状态模型建议

建议避免第一阶段就引入过重 relational schema，优先复用现有 state namespace。

## 7.1 Actor `core` namespace

用于：

- `knows_notebook_power`
- `murderous_intent`
- `suspicion_level`
- `risk_tolerance`
- `investigation_focus`
- `current_target_id`
- `desperation_level`

## 7.2 Actor `intel` namespace

建议为 actor 增加单独 namespace：`intel`

例如：

```yaml
state_namespace: intel
state_json:
  targets:
    agent-l:
      name_known: true
      face_known: false
      confidence: 0.7
      eligibility: false
      last_updated_tick: "1000000000010"
```

这样能表达：

- 某个主体对某个目标掌握了哪些信息
- 是否具备执行 Death Note 的前置条件

## 7.3 Artifact `core` namespace

继续维护：

- `holder_agent_id`
- `location`
- 可选：`visibility_level`
- 可选：`rule_pages_known_by`

## 7.4 World `world` namespace

建议增加：

- `kira_case_phase`
- `investigation_heat`
- `public_fear_level`
- `death_pattern_visibility`

---

## 8. Intent Grounder 运行时设计

## 8.1 插入位置

建议放在：

- `provider.run(...)` 产出 decision 之后
- `buildActionIntentDraft(...)` 之前

即流程变为：

1. provider 输出开放 decision
2. normalize decision
3. `IntentGrounder.resolve(...)`
4. 得到 grounded result
5. 再生成最终 `ActionIntentDraft`

## 8.2 Grounder 输入

建议输入包括：

- normalized decision
- inference context
- authority_context（建议让主链也可读到）
- pack `rules.invocation`
- active pack capabilities / authorities / mediator bindings

## 8.3 Grounder 输出

建议输出结构至少包括：

- `resolution_mode`
- `semantic_intent`
- `matched_affordance_key`
- `required_capability_key`
- `resolved_action_type`
- `resolved_target_ref`
- `resolved_payload`
- `objective_effect_applied`（boolean）
- `failure_kind`（若为 narrativized / blocked）
- `explanation`

### 示例 resolution mode

- `exact`
- `translated`
- `decomposed`
- `narrativized`
- `blocked`

## 8.4 持久化策略

第一阶段建议不急着加新表，优先将 grounding trace 写入：

- `DecisionJob.request_input.attributes`
- `InferenceTrace.context_snapshot`
- `ActionIntent.payload` 或 `ActionIntent.target_ref` 附加 metadata

建议至少记录：

- `semantic_intent.kind`
- `semantic_intent.text`
- `intent_grounding.resolution_mode`
- `intent_grounding.affordance_key`
- `intent_grounding.required_capability`
- `intent_grounding.objective_effect_applied`
- `intent_grounding.explanation`

---

## 9. unexpected action 的正式处理路径

## 9.1 处理总原则

unexpected action 不应直接报系统失败。

应按以下顺序处理：

1. 尝试精确命中
2. 尝试翻译为最近似 affordance/capability
3. 若不能执行但可叙事化，则生成 **失败但真实发生** 的 narrative event
4. 仅在极少数完全不允许场景中保留 `blocked`

## 9.2 “跳大神”示例

假设 Agent 想：

> “我想跳大神确认这个人是不是该死。”

在 Death Note pack 中：

- 世界并没有 `invoke.ritual_divination`
- 若也无相应超自然授权
- 则默认不产生客观世界效果

但它可以被 grounding 为：

### 结果 A：translated
若 pack 认为这是“想获取目标信息”的拙劣表达，可翻译为：

- `invoke.collect_target_intel`

### 结果 B：narrativized（默认优先）
若 pack 不承认这种方法能获得客观真相，则生成 narrative event：

- title：`{{ actor.id }} 试图通过民间仪式确认目标命运`
- description：`{{ actor.id }} 进行了一次近乎荒诞的仪式尝试，但世界规则没有给出客观回应。`
- semantic_type：`failed_ritual_attempt`
- `objective_effect_applied = false`

## 9.3 narrativized 的落地方式

建议第一阶段尽量复用现有链路，而不是新增很多专门状态。

### 推荐做法

将 narrativized failure 落地为：

- 一个正常的 `ActionIntent`
- 其最终被 Grounder 转译成现有 kernel 通用 intent：`trigger_event`
- event type 可使用 `history`
- event impact_data 中明确记录：
  - `semantic_type`
  - `grounding_mode=narrativized`
  - `failed_attempt=true`
  - `objective_effect_applied=false`
  - 原始 `semantic_intent`

### 为什么推荐这样做

因为这样可以：

- 继续复用现有 dispatcher / event / audit / timeline 主线
- 不需要额外专门失败事件表
- 前端可直接在 timeline / agent overview 中显示
- 从 actor 视角是“失败”，从系统视角是“成功记录了一次失败尝试”

## 9.4 workflow 状态建议

第一阶段建议：

- `ActionIntent.status` 仍可记为 `completed`
- 但在 metadata 中明确：
  - `objective_effect_applied=false`
  - `semantic_outcome=failed_attempt`
  - `grounding_mode=narrativized`

这样：

- 避免把系统正常记录行为误判为 infra failure
- 同时能在产品/运营语义上表达“这个动作没真正成功达成其意图”

---

## 10. 多 Agent 协作设计（无 governor agent）

## 10.1 协作原则

当前阶段，多 Agent 协作通过以下对象实现：

- Event
- Post
- RuleExecutionRecord
- actor/world state
- 显式 collaboration capability

而不是通过隐藏的管理员统一调度每个细节。

## 10.2 协作 affordance

建议第一批增加：

- `share_case_intel`
- `request_joint_observation`
- `publish_case_update`
- `raise_false_suspicion`
- `coordinate_cover_story`

这些 affordance 可以分别落到：

- `invoke.*`
- `post_message`
- `adjust_relationship`
- `trigger_event`

## 10.3 协作结果如何回流

协作结果应通过以下方式进入下一轮：

- 作为 `Event` 被其他 Agent 的 short-term memory 感知
- 作为 `Post` 进入公共信息流
- 作为 pack state / intel state 更新
- 作为 scheduler event-followup signal 触发相关 actor 再思考

---

## 11. 关于“世界观管理员 Agent”

## 11.1 当前阶段结论

- **不在 Death Note 当前设计中引入专门 governor/admin agent**
- 不让任何 LLM 角色直接担任超越 objective rule engine 的世界裁判

## 11.2 代码层未来兼容原则

若未来其他 pack 需要类似角色，应允许其以以下形式进入：

- institution actor
- system identity
- mediator-backed actor

但其仍应：

- 通过 scheduler / decision job / action intent 主线运行
- 通过显式 capability 影响世界
- 通过 objective enforcement 生效

即：

> **允许出现“管理员风格角色”，但不新增“管理员捷径”。**

---

## 12. 实施顺序建议

## Phase 1：补齐 Death Note pack 的专属 capability / state / objective rules

至少完成：

1. `invoke.learn_notebook_rules`
2. `invoke.collect_target_intel`
3. `invoke.confirm_target_name`
4. `invoke.confirm_target_face`
5. `invoke.select_judgement_target`
6. `invoke.execute_death_note`
7. investigation / collaboration 第一批动作

## Phase 2：引入 Intent Grounder

至少完成：

1. provider 输出开放意图
2. Grounder 读取 `rules.invocation`
3. 产出 `exact / translated / narrativized` 三种主路径
4. grounding metadata 写入 workflow trace

## Phase 3：unexpected action 的 narrativized failure

至少完成：

1. 无 capability 的意图可转为 `trigger_event`
2. impact_data 带 `failed_attempt=true`
3. 前端 timeline / agent view 可见

## Phase 4：多 Agent 协作

至少完成：

1. `share_case_intel`
2. `request_joint_observation`
3. collaboration 事件回流 scheduler follow-up

---

## 13. 验收标准

完成后应满足：

1. Death Note actor 能从“拿到笔记”走到“形成杀意 / 收集信息 / 执行裁决”的正式 capability 链。
2. Agent 不需要从固定菜单中挑动作，也可提出开放意图。
3. 开放意图会先经过 Intent Grounder，而不是直接执行。
4. 只有显式 capability 才能产生 objective world mutation。
5. unexpected action 可以被叙事化为 **失败但真实发生** 的事件。
6. narrativized failure 可进入 Event / Audit / Timeline / Agent 视图。
7. 多 Agent 协作通过共享证据与显式协作动作完成，而不是通过隐藏 governor agent。
8. 当前不需要 governor/admin agent 也能让 Death Note 主循环成立。

---

## 14. 结论

当前最合适的方向不是：

- 列出所有动作
- 或只暴露一堆裸接口
- 或引入一个 LLM 世界裁判

而是：

> **开放意图 + world-pack invocation grounding + 显式 capability 执行 + narrativized failure 回退**

这条路线能同时满足：

- Agent 灵活性
- 世界观约束
- 可解释性
- 可审计性
- 多 Agent 扩展性
- 未来 pack 引入“管理员风格角色”的兼容空间
