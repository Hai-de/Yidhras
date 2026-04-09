<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/death-note-intent-grounder-design.md","contentHash":"sha256:b1fb4d18c7f57e1ff2e5acef5e3dbd4278891b09b2a963f90e7fcb0e918ace88"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 补齐 Death Note world-pack 的 affordance/capability/state/objective rules，并同步模板与运行副本配置  `#dnig-p1`
- [x] 新增 Intent Grounder 运行时模块，消费 rules.invocation 并实现 exact/translated/narrativized 三类主路径  `#dnig-p2`
- [x] 将 Intent Grounder 接入 inference→ActionIntent 主链，保留现有 rule_based 策略并写入 grounding metadata  `#dnig-p3`
- [x] 实现 narrativized failure 经由 trigger_event/history 落地，并保证 workflow/audit/timeline/agent 视图可观察  `#dnig-p4`
- [x] 补齐 Death Note 最小多 Agent 协作动作与 event-followup 回流，不引入专门 governor/admin agent  `#dnig-p5`
- [x] 补齐 unit/integration/e2e 与文档同步，验证 Death Note 闭环与 unexpected action 叙事失败回退  `#dnig-p6`
<!-- LIMCODE_TODO_LIST_END -->

# Death Note 世界包专属动作与 Intent Grounder 实施计划

> Source Design: `.limcode/design/death-note-intent-grounder-design.md`

## 1. 目标

基于已确认的设计，先把 Death Note 世界包从“拿到笔记 / 形成杀意”的最小媒介样板扩展为可运行的题材动作链，再把开放意图接入 inference→workflow 主链，让 unexpected action 可以被解释、翻译或叙事化，而不是直接把 Agent 固定死在手写动作菜单上。

本计划优先完成：

- Death Note pack 的第一批题材化 capability / state / objective rules
- `rules.invocation` 的实际消费路径
- inference 后置 `Intent Grounder`
- narrativized failure 通过 `trigger_event/history` 落地
- 最小多 Agent 协作动作与 follow-up 回流
- 与现有 Event / Audit / Timeline / Agent overview 的可观测闭环

## 2. 当前代码状态与切入点

### 2.1 已有基础

当前代码已具备以下可复用基础：

- `apps/server/src/app/runtime/simulation_loop.ts`
  - 已串联 `runAgentScheduler()` → `runDecisionJobRunner()` → `runActionDispatcher()`
- `apps/server/src/inference/service.ts`
  - 已负责 `normalizeDecision()`、`buildActionIntentDraft()`、workflow persistence
- `apps/server/src/domain/invocation/invocation_dispatcher.ts`
  - 已把 `invoke.*` / objective rule 匹配的 intent 桥接为 `InvocationRequest`
- `apps/server/src/domain/rule/enforcement_engine.ts`
  - 已负责 capability 校验、mediator 校验、objective mutation、事件发射、`RuleExecutionRecord`
- `apps/server/templates/world-pack/death_note.yaml`
  - 已有 `invoke.claim_death_note`、`invoke.form_murderous_intent` 与最小 objective rules
- `apps/server/src/app/services/action_dispatcher.ts`
  - 已支持 `trigger_event`、`post_message`、`adjust_relationship`、`adjust_snr`
- `apps/server/src/memory/short_term_adapter.ts`
  - 已会把 recent trace / job / intent / post / event 回流成 short-term memory
- 现有投影/前端接口
  - `Event`、timeline、entity overview、agent scheduler projection 已能消费一般性 evidence

### 2.2 当前缺口

从实现角度，主要缺口集中在四处：

1. `death_note` pack 还没有第一批完整的题材化动作链（信息获取、目标选择、执行裁决、调查协作）
2. `rules.invocation` 虽已存在于 schema，但当前未作为真正的 grounding 层被 runtime 消费
3. `InferenceService` 当前会直接把 provider decision 变成 `ActionIntentDraft`，中间没有 Grounder
4. unexpected action 目前缺少“失败但真实发生”的正式落地路径

### 2.3 约束判断

为控制首轮范围，建议坚持以下约束：

- **不新增 governor/admin agent 主线**；未来兼容性只保留在模型与 capability 侧
- **不新增 Prisma 表作为前置条件**；优先把 grounding metadata 写进现有 workflow/event 链路
- **不新增新的公开 inference strategy 枚举**；保留 `mock | rule_based`，把 Death Note pack-specific 逻辑收进 `rule_based` 内部 helper，避免 API/contracts 大面积扩散
- **不把 `buildInferenceContextV2()` 整体推入 prompt 主链**；首轮 Grounder 优先在服务侧单独解析 authority/middleware/pack invocation rules，减少 prompt 与 contract 震荡

## 3. 实施范围

## 3.1 Phase A：补齐 Death Note world-pack 专属动作/规则

### 目标

把 Death Note pack 扩展为一套最小但完整的题材动作链，让引擎至少能表达：

- 持有/转移笔记
- 学会笔记规则
- 形成裁决意图
- 收集目标信息
- 选择目标
- 执行裁决
- 进行调查/协作/误导

### 代码范围

优先涉及：

- `apps/server/templates/world-pack/death_note.yaml`
- `data/configw/templates/world-pack/death_note.yaml`
- `data/world_packs/death_note/config.yaml`

### 计划内容

1. 补齐第一批 capability：
   - `invoke.learn_notebook_rules`
   - `invoke.collect_target_intel`
   - `invoke.confirm_target_name`
   - `invoke.confirm_target_face`
   - `invoke.select_judgement_target`
   - `invoke.execute_death_note`
   - `invoke.investigate_suspicious_death`
   - `invoke.share_case_intel`
   - `invoke.request_joint_observation`
   - `invoke.publish_case_update`
   - 可选最小误导动作：`invoke.raise_false_suspicion`
2. 为 actor / artifact / world 增加最小 state：
   - actor `core`: `knows_notebook_power`、`murderous_intent`、`current_target_id`、`suspicion_level`、`investigation_focus`
   - actor `intel`: `targets.*.name_known / face_known / confidence / eligibility`
   - artifact `core`: `holder_agent_id`、`location`、可选 `visibility_level`
   - world `world`: `kira_case_phase`、`investigation_heat`、`public_fear_level`、`death_pattern_visibility`
3. 在 `rules.objective_enforcement` 中补齐：
   - 学习规则
   - 收集目标信息
   - 选择目标
   - 执行裁决
   - 调查/协作产生的状态变化与事件
4. 在 `rules.invocation` 中引入 Death Note 的 grounding 规则约定：
   - semantic intent → affordance
   - affordance → required capability
   - translation / narrativization fallback
5. 明确三份 pack 文件的同步策略：
   - 版本管理模板
   - runtime scaffold 模板
   - 本地 active pack 副本
   计划实施时应避免只改其中一份导致启动后行为漂移

### 交付判断

Phase A 完成后，pack 至少在声明层具备“拿笔记→学规则→收集信息→执行裁决→调查回响”的完整题材主线。

## 3.2 Phase B：新增 Intent Grounder 运行时模块

### 目标

让系统在 provider 给出开放 decision 后，先执行“世界解释”，再生成最终 `ActionIntentDraft`。

### 推荐新增文件

建议新增：

- `apps/server/src/domain/invocation/intent_grounder.ts`
- 可选拆分：
  - `apps/server/src/domain/invocation/intent_grounding_rules.ts`
  - `apps/server/src/domain/invocation/intent_grounding_types.ts`

### 核心职责

1. 解析 provider decision 中的开放意图表示
2. 读取当前 pack 的 `rules.invocation`
3. 获取当前 actor 的 authority / capability / mediator 上下文
4. 产出 grounding result，至少支持：
   - `exact`
   - `translated`
   - `narrativized`
5. 为后续扩展预留：
   - `decomposed`
   - 少量 `blocked`

### 运行时策略建议

首轮优先采用“轻集成”而不是大改 inference context：

- Grounder 直接在服务层读取：
  - active pack
  - `rules.invocation`
  - `resolveAuthorityForSubject(...)`
  - `resolveMediatorBindingsForPack(...)`
- 避免第一轮把 `buildInferenceContextV2()` 全量推入主 prompt contract

这样可以减少：

- `InferenceContext` 类型爆炸
- prompt 变更过大
- 与现有 operator contracts 的职责重叠

### 兼容策略

Grounder 需要同时兼容两种输入：

1. **旧式直接动作**
   - provider 已输出 `invoke.*` 或 `post_message` 等明确 action
   - Grounder 应将其视为 `exact` 或直通，不破坏现有链路
2. **新式开放意图**
   - provider 输出 semantic intent / desired effect / proposed method
   - Grounder 负责映射、翻译或叙事化

这样能保证迁移是渐进式，而不是一次性重写全部 provider。

## 3.3 Phase C：接入 inference→workflow 主链并写入 grounding metadata

### 目标

把 Grounder 插入到当前主链中，同时保留 workflow / replay / retry / scheduler 可观测性。

### 代码范围

优先涉及：

- `apps/server/src/inference/service.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/inference/providers/rule_based.ts`
- 可选：`apps/server/src/inference/providers/mock.ts`
- `apps/server/src/inference/prompt_builder.ts`（如需补充 semantic intent 输出约束）

### 计划内容

1. 在 `normalizeDecision()` 后、`buildActionIntentDraft()` 前插入：
   - `IntentGrounder.resolve(...)`
2. 增加 grounding 相关 transport / runtime 类型：
   - `semantic_intent`
   - `resolution_mode`
   - `matched_affordance_key`
   - `required_capability_key`
   - `objective_effect_applied`
   - `semantic_outcome`
   - `failure_kind`
3. 改造 `buildActionIntentDraft()`：
   - 输入不再只依赖原始 decision
   - 而是依赖 grounded result
4. 保留 `rule_based` 作为公开 strategy，不新增对外 strategy 枚举；内部通过 helper 在 `world-death-note` pack 下产出：
   - 直接 capability 意图
   - 或开放 semantic intent
5. 把 grounding metadata 写入现有持久化链：
   - `DecisionJob.request_input.attributes`
   - `InferenceTrace.context_snapshot` / `trace_metadata` / `decision.meta`
   - `ActionIntent.payload` / `target_ref` 附加 `intent_grounding.*`
6. 确保 replay / retry / scheduler 创建的 job 在读模型中仍可区分其 `intent_class`，同时新增 semantic grounding 解释字段而不破坏现有 workflow 语义

### 特别注意

需要明确把“系统层失败”和“语义层失败”分开：

- infrastructure / provider / normalization failure = 继续沿用 `failed`
- narrativized failed attempt = workflow 正常完成，但 `objective_effect_applied=false`

## 3.4 Phase D：unexpected action 的 narrativized failure 回退

### 目标

让 unexpected action 在没有相应 capability 时，仍能以“失败但真实发生”的 narrative event 形式存在。

### 推荐落地策略

首轮推荐直接复用现有内核动作，而不是新增专门失败表：

- Grounder 输出 `narrativized`
- 最终转译为 `trigger_event`
- `event.type = history`
- `impact_data` 附带：
  - `semantic_type`
  - `failed_attempt=true`
  - `objective_effect_applied=false`
  - `grounding_mode=narrativized`
  - 原始 `semantic_intent`

### 代码范围

- `apps/server/src/domain/invocation/intent_grounder.ts`
- `apps/server/src/app/services/action_dispatcher.ts`
- `apps/server/src/domain/rule/enforcement_engine.ts`（必要时补 bridge metadata 一致性）
- 与 timeline / audit 读取链路有关的最小字段映射

### 语义处理建议

- `ActionIntent.status`：保持 `completed`
- 但通过 metadata 表达：
  - 这是一次失败尝试
  - 不产生 objective mutation
  - 是 narrativized fallback

这样可以保证：

- timeline/audit 能看到“真实发生过”
- workflow 不会被误判成系统出错
- 多 Agent 后续可对该事件产生反应

## 3.5 Phase E：最小多 Agent 协作与 follow-up 回流

### 目标

不引入 governor/admin agent，但让多 Agent 协作在 Death Note 世界中具备最小正式路径。

### 核心做法

1. 通过 collaboration affordance/capability 表达协作：
   - `share_case_intel`
   - `request_joint_observation`
   - `publish_case_update`
   - `raise_false_suspicion`
2. 通过 `Event / Post / RuleExecutionRecord / state` 共享结果
3. 让协作结果进入 short-term memory 与 scheduler event-followup 信号

### 代码范围

- `death_note.yaml` 中的 capability / objective rules
- scheduler signal 读取链（若需要新增语义类型识别）
- 现有 short-term memory 已会吃 event/post，优先复用，不额外引入共享脑模型

### 约束

本阶段不实现：

- institution-specific special worker
- admin agent
- 新的“系统裁判”执行支路

所有协作仍走统一 workflow / objective execution 主线。

## 3.6 Phase F：验证、观测与文档同步

### 测试建议

#### Unit

1. Grounder exact path
   - 直接 capability / kernel intent 保持兼容
2. Grounder translated path
   - 例如 ritual-like intent -> `invoke.collect_target_intel`
3. Grounder narrativized path
   - 例如 `ritual_divination` -> `trigger_event/history`
4. objective enforcement
   - 新增 Death Note capability 的 state mutation / emitted event 断言

#### Integration

1. Death Note actor 从持有笔记到执行裁决的中段链路
2. investigation/collaboration 事件能进入 memory / read model
3. unexpected action 会产生 event 但不产生 objective mutation

#### E2E

至少覆盖两条：

1. **主链闭环**
   - scheduler 触发
   - provider 输出 Death Note 意图
   - Grounder 落地 capability
   - dispatcher/enforcement 执行
   - event / rule execution / agent view 可见
2. **unexpected action 闭环**
   - provider 输出 ritual-like intent
   - Grounder 走 narrativized
   - workflow 完成
   - history event 出现在 timeline / agent activity 中
   - 目标状态未被错误修改

### 文档同步

建议同步：

- `docs/LOGIC.md`
- `docs/API.md`
- `docs/ARCH.md`
- `README.md`
- `TODO.md`
- `记录.md`

尤其要明确：

- `rules.invocation` 已成为 grounding 层的正式用途
- unexpected action 支持 narrativized failure
- 当前没有专门 governor/admin agent 主线

## 4. 风险与控制

### 风险 1：Grounder 变成第二套“隐形世界引擎”

影响：

- capability / objective enforcement 失去唯一客观裁决地位

控制：

- Grounder 只负责解释和翻译
- 任何 objective mutation 仍只能经由 capability + enforcement engine

### 风险 2：过早把所有开放意图都变成复杂 DSL

影响：

- 实施成本爆炸
- pack authoring 复杂度急升

控制：

- 首轮仅支持 Death Note 第一批 affordance
- `rules.invocation` 复用现有 `when/then` 结构
- 只实现 `exact / translated / narrativized`

### 风险 3：语义失败与系统失败混淆

影响：

- 用户看到大量 `failed` workflow，无法分辨是真失败还是叙事失败

控制：

- narrativized failure 保持 workflow 技术成功
- 用 metadata / event semantic_type 表达“意图未达成”

### 风险 4：pack 三份副本漂移

影响：

- 模板、runtime scaffold、active pack 实际不一致

控制：

- 明确同步三份 `death_note.yaml`
- 在实施与验证中加入 pack content 对齐检查

### 风险 5：为了引入题材语义而破坏现有通用 provider/intent 行为

影响：

- 当前 mock/rule_based 冒烟与现有 workflow 回归

控制：

- Grounder 保持对旧 action_type 的 exact/直通兼容
- Death Note 逻辑以 pack-aware helper 方式接入

## 5. 验收标准

本计划实施完成后，应满足：

1. Death Note pack 具备第一批正式 capability / affordance / state / objective rules
2. `rules.invocation` 被 runtime 真正消费，而不再只是 schema 占位
3. `InferenceService` 在 provider decision 与 `ActionIntentDraft` 之间新增 Grounder 层
4. unexpected action 可以被 narrativized 为失败但真实发生的 history event
5. narrativized failure 不会错误修改 objective state
6. Event / Audit / Timeline / Agent overview 至少能看到失败尝试与主链 evidence
7. 多 Agent 协作通过共享证据与显式协作动作回流，不需要 governor/admin agent
8. 回放、重试、scheduler observability 不因引入 Grounder 而失去现有 `intent_class`/workflow 解释能力

## 6. 建议实施顺序

1. 先扩 Death Note pack 能力与状态（Phase A）
2. 再做 Intent Grounder 模块与类型（Phase B）
3. 接着接入 inference 主链与 metadata（Phase C）
4. 然后完成 narrativized failure 回退（Phase D）
5. 再补协作动作与 follow-up 回流（Phase E）
6. 最后补测试与文档（Phase F）

这个顺序能先把题材语义底座补齐，再把开放意图引入主链，避免出现“Grounder 已经能解释，但 pack 根本没有对应世界能力”的倒挂。
