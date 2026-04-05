## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 定义 world-pack scenario YAML contract，并补充 loader/schema 校验边界  `#p1-pack-contract`
- [x] 新增 ScenarioEntityState 等最小运行时状态承载模型与迁移  `#p2-scenario-state`
- [x] 实现 world-pack scenario materializer，把 agents/relationships/artifacts/state 幂等落库  `#p3-materializer`
- [x] 把 pack actor/artifact/world state 注入 inference context 与 prompt  `#p4-context-injection`
- [x] 实现 pack decision rule evaluator，并接入 rule_based provider 前置判断  `#p5-pack-rules`
- [x] 扩展 action dispatcher，支持 pack action registry 与 claim_artifact/set_actor_state/emit_event executors  `#p6-pack-actions`
- [x] 重写 death_note.yaml，声明 3 个角色、死亡笔记实体、事件模板、动作与规则  `#p7-death-note-pack`
- [x] 补 focused e2e / walkthrough 验证，并同步 TODO/记录/ARCH/LOGIC/API 文档  `#p8-verify-and-docs`
<!-- LIMCODE_TODO_LIST_END -->

# World-Pack 场景驱动 Demo 实施计划

## 1. 目标

把当前 `death_note` world-pack 从“背景变量 + prompt + 时间配置”升级为“可声明剧情实体与行为规则的 scenario pack”，并让现有引擎把这些声明消化成可运行状态，最终跑通一次最小剧情闭环：

1. 3 个 Agent 由 world-pack 定义并进入运行时。
2. `Death Note` 作为 pack 定义的物理实体进入运行时初始状态。
3. 通过 pack 定义的动作与规则，跑通：
   - 捡到笔记
   - 产生杀意
   - 写入 narrative timeline
   - 在 Overview / Timeline / Agent / Scheduler 等前端控制台观察到结果
4. 复用现有 workflow / scheduler / action dispatcher / timeline / web console 基础设施，不再另起一套临时 demo 管线。

---

## 2. 范围

### 2.1 本次实施范围

- 为 world-pack 增加结构化场景声明：
  - `scenario.agents`
  - `scenario.relationships`
  - `scenario.artifacts`
  - `event_templates`
  - `actions`
  - `decision_rules`
- 新增最小运行时状态承载层，用于保存 pack 驱动的 actor/artifact/world state。
- 在 world-pack 初始化阶段把 scenario materialize 到数据库。
- 在 inference context 中注入 pack actor/artifact state，使 provider/rule evaluator 可感知。
- 在 `rule_based` 推理路径前增加 pack rule evaluator，使 YAML 规则可决定动作。
- 在 action dispatcher 中增加 pack action registry + 内置 executor。
- 更新 `death_note.yaml`，写入本次 demo 所需的 3 个角色、死亡笔记实体、事件模板、动作和规则。
- 增加 focused e2e / smoke 验证，证明整条链路成立。

### 2.2 非目标

本轮不处理以下内容：

- 完整 inventory / item system
- 任意脚本 DSL / 自定义表达式语言
- 真正的“写名字杀人”“死亡结算”“尸体/调查系统”全套规则
- 通用内容作者工具链 / 可视化编辑器
- 大规模多 world-pack 协作与注册中心
- 生产级复杂权限矩阵与剧情分支系统

本轮只做**足够支撑该 demo 的最小通用机制**。

---

## 3. 总体设计思路

采用“**YAML 声明 + 引擎内置原语执行器**”方案：

- YAML 只负责声明：实体、初始状态、事件模板、动作映射、规则。
- 引擎只实现少量固定 executor，例如：
  - `claim_artifact`
  - `set_actor_state`
  - `emit_event`
- pack 中的 `actions.*.executor` 只能引用这些引擎内置 executor，而不是执行任意脚本。

这样可以保证：

- pack 足够灵活，可表达 demo 所需剧情；
- 引擎仍保持稳定、安全、可测试；
- 后续可继续扩展 executor，而不需要推翻格式。

---

## 4. 分阶段实施

## Phase 1：定义 YAML contract 与校验边界

### 目标

给 world-pack 增加可声明剧情场景的结构，并为其建立解析/校验边界。

### 需要落地

1. 扩展 `WorldPack` 类型，允许显式识别以下字段：
   - `scenario`
   - `event_templates`
   - `actions`
   - `decision_rules`
2. 新增 schema 校验模块，对 `death_note.yaml` 中的新结构做最小合法性校验。
3. 保持 loader 的职责清晰：
   - 读取 YAML
   - 解析为 pack object
   - 执行结构校验
   - 不在 loader 中做业务 materialize

### 建议 contract（最小版）

#### `scenario.agents`

- id
- name
- type
- identity
- roles[]
- state

#### `scenario.relationships`

- from_id
- to_id
- type
- weight

#### `scenario.artifacts`

- id
- kind
- label
- state

#### `event_templates`

- template key
- `type`
- `title`
- `description`
- `impact_data`

#### `actions`

- action key
- `executor`
- `defaults`

#### `decision_rules`

- id
- priority
- when
- decide

### 验收标准

- `death_note.yaml` 能通过 schema 校验。
- 非法字段或缺失必填项时，world-pack 初始化报错清晰。
- 不破坏现有只包含 `variables/prompts/simulation_time` 的 world-pack 载入链路。

---

## Phase 2：增加 scenario runtime state 承载层

### 目标

为 pack 声明的 artifact / actor state 提供最小但正式的运行时存储，而不是把所有状态散落在 event 或变量池里。

### 建议新增模型

新增一个最小通用表，例如：`ScenarioEntityState`。

建议字段：

- `id`
- `pack_id`
- `entity_type`（`actor | artifact | world`）
- `entity_id`
- `state_json`
- `created_at`
- `updated_at`

### 原因

- 本次 demo 需要表达：
  - 死亡笔记当前持有者
  - actor 是否已经形成杀意
- 这些都属于“运行时状态”，不适合只存在于 event 文本里。
- 该表比完整 inventory system 轻很多，但足够支撑 demo。

### 验收标准

- 能保存 `artifact-death-note` 的 holder state。
- 能保存 `agent-light` 等 actor state。
- 同一 pack 下实体状态有稳定唯一索引，不会重复插入多份脏数据。

---

## Phase 3：实现 world-pack scenario materializer

### 目标

在 world-pack 初始化后，把 scenario 的角色、关系和状态 materialize 进数据库。

### 需要落地

1. 新增 `world/materializer.ts`（或等价模块）。
2. 由 `SimulationManager.init()` 在 active pack 加载完成后调用 materializer。
3. materializer 负责：
   - upsert `scenario.agents` -> `Agent`
   - upsert `scenario.agents[*].identity` -> `Identity`
   - 建立 `IdentityNodeBinding`
   - upsert `scenario.relationships` -> `Relationship`
   - upsert `scenario.artifacts` / actor state -> `ScenarioEntityState`
4. materializer 应支持幂等重复执行，避免每次重启都制造重复数据。

### 特别要求

- 本轮 demo 的 3 个角色应由 `death_note.yaml` 主导，而不是继续完全依赖 `seed.ts` / `seed_identity.ts`。
- 如需保留通用 seed，应仅保留 `system`、可能的 `user-001` 等基础身份，不再把 demo 核心角色写死在仓库 seed 中。

### 验收标准

- 启动后数据库中出现 pack 定义的 3 个 agent。
- pack 定义的初始关系存在。
- `artifact-death-note` 与 actor state 成功落地。
- 重启不会重复插入无穷多份同一状态。

---

## Phase 4：把 pack state 注入 inference context

### 目标

让 provider / prompt / pack rule evaluator 能看到当前 actor 的 scenario state，而不是只能看到基础 agent/profile/variables。

### 需要落地

在 `buildInferenceContext()` 中补充 pack state 注入，至少包含：

- 当前 actor 的 `roles`
- 当前 actor 的 `state`
- 当前 actor 持有的 artifacts
- 必要的 world state
- 可选：最近相关 pack semantic event 摘要

### 对 prompt builder 的影响

把上述 state 纳入 `context_prompt`，让后续：

- `rule_based` provider
- 未来真实 LLM provider

都能消费一致上下文。

### 验收标准

- 当前 actor 拿到 death note 后，推理上下文中能看到持有状态。
- 当前 actor 已形成杀意后，推理上下文中能看到对应状态。
- prompt bundle 中能反映这些上下文，不需要手工在 attributes 中塞临时字段。

---

## Phase 5：实现 pack decision rule evaluator

### 目标

让 `rule_based` 路径在默认 fallback 行为之前，先尝试命中 pack 定义的 `decision_rules`。

### 第一版建议支持的条件

最小支持：

- `actor_has_artifact`
- `actor_state`
- `world_state`
- `latest_event.semantic_type`（可选，若代价适中）

### 第一版建议行为

- 按 `priority` 排序
- 命中第一条规则后返回 pack 定义动作
- 未命中则 fallback 到原有 `rule_based` 逻辑

### Demo 关键规则

至少包含：

1. `claim_death_note` 触发后，持有者在后续推理中命中：
   - 若持有 `artifact-death-note`
   - 且 `murderous_intent=false`
   - 则输出 `form_murderous_intent`

### 验收标准

- `rule_based` provider 在持有笔记前后能输出不同动作。
- pack 规则命中时，不再退回普通 `post_message`。
- 未命中规则时，原有 `rule_based` fallback 仍可工作。

---

## Phase 6：扩展 action dispatcher，支持 pack action registry + executor

### 目标

让 dispatcher 不只认硬编码 `intent_type`，还能识别 pack 定义动作。

### 建议机制

当收到 `ActionIntent.intent_type` 时：

1. 先检查是否是内置 intent：
   - `post_message`
   - `trigger_event`
   - `adjust_relationship`
   - `adjust_snr`
2. 若不是内置 intent，则去 active pack 的 `actions` 查找
3. 读取其 `executor`
4. 调用对应内置 executor 完成实际执行

### 本轮至少实现的 executor

#### 1. `claim_artifact`
- 更新 artifact state：`holder_agent_id`
- 可选清理 location
- 自动触发 pack event template，例如 `notebook_claimed`

#### 2. `set_actor_state`
- patch actor state
- 可选触发 pack event template，例如 `murderous_intent_formed`

#### 3. `emit_event`
- 根据 pack `event_templates` 渲染 `title/description/impact_data`
- 落到现有 `Event` 表

### 验收标准

- `claim_death_note` 能成功改写 artifact 持有状态，并写入 timeline event。
- `form_murderous_intent` 能成功改写 actor state，并写入 timeline event。
- 所有 pack action 都会通过现有 workflow / action intent / dispatcher 链路，而不是旁路落库。

---

## Phase 7：编写 Death Note demo world-pack

### 目标

把这次 demo 需要的内容真实写入 `apps/server/templates/world-pack/death_note.yaml`。

### 至少包含

#### 角色
- `agent-light`（或继续沿用 `agent-001`，但建议语义化）
- `agent-l`
- `agent-ryuk`

#### 物理实体
- `artifact-death-note`

#### 初始状态
- 笔记初始无人持有，位于某 location
- 主角初始 `murderous_intent = false`

#### 事件模板
- `notebook_claimed`
- `murderous_intent_formed`

#### 动作
- `claim_death_note`
- `form_murderous_intent`

#### 规则
- 持有笔记且未产生杀意 -> 形成杀意

### 可选

- opening scripted action / bootstrap trigger
- investigator / observer 的后续规则占位，但不要求本轮完成

### 验收标准

- 仅靠该 pack 定义，就能构成 demo 所需最小剧情素材。
- 不需要再在代码中为 Death Note 场景硬编码角色名、笔记 id、事件文案。

---

## Phase 8：验证、前端观察与文档同步

### 目标

证明整条链路真正成立，而不是只有后端局部逻辑通了。

### 建议验证链路

1. 启动 runtime，确认 materializer 生效。
2. 通过 workflow/action 触发 `claim_death_note`。
3. 检查：
   - artifact state 已变更
   - timeline 中出现 `notebook_claimed`
4. 运行 scheduler / wait for followup。
5. 检查：
   - `rule_based` / pack rule 触发 `form_murderous_intent`
   - timeline 中出现 `murderous_intent_formed`
6. 前端检查：
   - Overview recent events 可见
   - Timeline 页面可见并能点开
   - Agent 页面能看到 recent events / workflows
   - Scheduler 页面能观察到中间调度痕迹

### 建议测试资产

- focused backend e2e：world-pack scenario flow
- 必要时增加 web walkthrough / smoke 说明

### 文档同步

至少同步：

- `TODO.md`
- `记录.md`
- `docs/ARCH.md`
- `docs/LOGIC.md`
- 如有必要，补充 `docs/API.md` 中对新行为的说明

### 验收标准

- 至少存在 1 条 focused e2e，证明 pack-driven flow 成立。
- 前端控制台上能看到完整剧情闭环证据。
- 文档能说明 world-pack 新增 contract 与运行时责任边界。

---

## 5. 建议改动文件范围

### 后端
- `apps/server/prisma/schema.prisma`
- `apps/server/src/world/loader.ts`
- `apps/server/src/core/simulation.ts`
- `apps/server/src/inference/context_builder.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/inference/prompt_builder.ts`
- `apps/server/src/inference/providers/rule_based.ts`
- `apps/server/src/app/services/action_dispatcher.ts`
- 新增：
  - `apps/server/src/world/schema.ts`
  - `apps/server/src/world/materializer.ts`
  - `apps/server/src/world/state.ts`（或等价 service）
  - `apps/server/src/inference/pack_rules.ts`
  - `apps/server/src/world/event_templates.ts`（如需）
  - focused e2e 文件

### world-pack
- `apps/server/templates/world-pack/death_note.yaml`

### 前端（大概率无需大改主框架）
- 以现有页面复用为主，必要时仅调整细节展示
- 若需更明确语义展示，再增量改：
  - `apps/web/composables/api/useAgentApi.ts`
  - `apps/web/composables/api/useTimelineApi.ts`
  - `apps/web/features/timeline/*`
  - `apps/web/pages/overview.vue`
  - `apps/web/pages/agents/[id].vue`

### 文档
- `TODO.md`
- `记录.md`
- `docs/ARCH.md`
- `docs/LOGIC.md`
- `docs/API.md`（如接口/行为可见性变化较大）

---

## 6. 风险与控制

### 风险 1：把 world-pack 做成任意脚本系统

**控制：**
- YAML 只声明，不执行任意代码
- action 只能映射到引擎内置 executor
- decision rule 第一版只支持少量固定条件

### 风险 2：为 demo 直接硬编码 Death Note 特例

**控制：**
- pack 定义角色、artifact、事件模板、规则
- 引擎不写死 `death_note` 名称、角色名、artifact id

### 风险 3：一次性做成完整 inventory / simulation DSL，范围失控

**控制：**
- 只做 `ScenarioEntityState` 最小状态承载
- 只做 3 个 executor
- 只做该 demo 所需规则条件

### 风险 4：前端看不出“剧情活起来”

**控制：**
- 以 timeline / overview / agent / scheduler 四个视图作为验收面
- 事件模板中必须携带足够清晰的标题和 semantic impact_data

---

## 7. 验收标准

本计划完成时，应满足：

1. Death Note pack 能在 YAML 中声明角色、物理实体、事件模板、动作和规则。
2. 引擎启动后能把 pack scenario materialize 到数据库。
3. `claim_death_note` 可通过 workflow/action 链路执行，并改写 artifact state。
4. 事件 `notebook_claimed` 能进入 timeline，并被现有 scheduler 视为 followup signal。
5. 后续调度中，持有笔记的 actor 能依据 pack rule 自动形成 `murderous_intent`。
6. `murderous_intent_formed` 事件能进入 timeline。
7. 前端控制台能观察到整条链路：Overview / Timeline / Agent / Scheduler 至少可见其一组完整证据。
8. 整套实现仍基于现有 workflow / scheduler / dispatcher 主线，不另起临时 demo 管线。

---

## 8. 建议实施顺序

1. 先定义 world-pack contract + schema
2. 再加 `ScenarioEntityState` 与 materializer
3. 然后把 pack state 注入 inference context
4. 再做 pack rule evaluator
5. 再扩 action dispatcher 的 pack action executor
6. 最后编写 `death_note.yaml` + focused e2e + 文档同步

这样可以保证每一步都能独立验证，并避免先把动作执行层做重，再发现 pack contract 还不稳。
