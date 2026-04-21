<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/death-note-world-pack-content-expansion-design.md","contentHash":"sha256:0b7ab39645dac6cc77073b5b4f43c81af8a658252e6d5c119e7333271930d101"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 补齐 death_note 正式 pack 的状态字段、认知动作与最小 invocation 扩展  `#phase-a-pack-contract`
- [x] 为 revise_judgement_plan 补齐 runtime 记录承接与必要测试  `#phase-a-runtime-support`
- [x] 扩展 pack.ai.tasks 与 memory_loop 对应配置和验证  `#phase-b-ai-memory`
- [x] 补充 institutions / domains 并细化 objective side effects  `#phase-b-governance-entities`
- [x] 评估并按门禁引入 pack storage collections 初始模型  `#phase-c-storage-gate`
- [x] 补充测试、文档与变更说明并完成回归验证  `#validation-and-docs`
<!-- LIMCODE_TODO_LIST_END -->

# Death Note 世界包内容扩展实施计划

## 来源设计

- 设计文档：`.limcode/design/death-note-world-pack-content-expansion-design.md`
- 本计划严格以该设计为来源，覆盖其中确认纳入范围的内容：
  - 认知型语义动作链
  - actor/world state 扩展
  - invocation / objective_enforcement 增量扩展
  - AI task / memory loop 扩展
  - institutions / domains 扩展
  - storage.pack_collections 的条件式第二阶段落地
- 明确排除项：封面、图标、主题、前端 UI 具体实现、multi-pack 稳定化、任意脚本执行能力。

---

## 1. 目标

将 `data/world_packs/death_note/config.yaml` 从“已有最小治理主线的 world pack”推进为“具备认知动作、AI/记忆治理、机构/领域结构”的更完整世界包，并补齐其与当前 runtime 的最短实现闭环。

完成后应达到：

1. `death_note` 正式 pack 与模板的关键状态字段差异被收口。
2. `revise_judgement_plan` 不再只是 pack 语义占位，而有 runtime 记录承接。
3. world pack 能显式影响 `agent_decision` 之外的 AI task 行为。
4. world pack 中的调查机构、领域结构、压力传播语义更完整。
5. 可选 storage 模型被拆成单独门禁阶段，不阻塞主线闭环。

---

## 2. 实施范围与阶段划分

## Phase A · 最短闭环（必须完成）

目标：让 pack contract 与 runtime 对认知动作链形成稳定闭环。

包含：

- `death_note/config.yaml` 状态字段补齐
- `rules.invocation` 中认知动作与少量新语义动作扩展
- runtime 对 `revise_judgement_plan` 的记录承接补口
- 最小单元/集成测试

## Phase B · 世界解释层增强（建议完成）

目标：把 pack 对 AI、记忆、治理结构的影响从局部能力扩展为正式 contract 内容。

包含：

- `pack.ai.tasks` 扩展
- `pack.ai.memory_loop` 校准与验证
- institutions / domains 入包
- 现有 objective side effects 细化

## Phase C · 领域存储模型（条件式阶段）

目标：在不破坏主线的前提下，按门禁评估并引入初始 `storage.pack_collections`。

包含：

- `target_dossiers`
- `judgement_plans`
- `investigation_threads`

该阶段只有在前两阶段稳定后才进入。

---

## 3. 详细任务拆解

## 3.1 Phase A-1：收口正式 pack 状态模型

### 目标

同步模板与正式 pack 的关键状态字段，让 `death_note` 正式 pack 具备承载认知动作链的状态基础。

### 主要修改对象

- `data/world_packs/death_note/config.yaml`
- 对照参考：`apps/server/templates/world-pack/death_note.yaml`

### 计划动作

1. 为适用 actor 补齐第一批高信息密度字段：
   - `last_reflection_kind`
   - `judgement_strategy_phase`
   - `exposure_risk`
   - `last_dossier_update_tick`
   - `last_plan_revision_tick`
   - `last_postmortem_tick`
   - `current_hypothesis`
   - `pressure_response_mode`
2. 按角色区别补齐执行者/调查者偏特化字段，但控制在设计草案的最小集内。
3. 为 `__world__` 初始状态加入：
   - `investigation_coordination_level`
   - `media_amplification_level`
   - `false_lead_density`
   - `supernatural_signal_visibility`
   - `institutional_alert_stage`
4. 保持新增字段为增量兼容，不破坏现有解析与运行逻辑。

### 验收标准

- pack schema 解析通过。
- 正式 pack 与模板在关键状态字段层面不再明显脱节。
- 现有 decision provider 读取这些字段时不会得到缺失/未定义导致的异常路径。

---

## 3.2 Phase A-2：扩展 invocation 规则并收口认知动作

### 目标

让认知动作和少量新语义动作正式进入 `death_note` 的 invocation 层，而不是停留在零散示例状态。

### 主要修改对象

- `data/world_packs/death_note/config.yaml`

### 计划动作

1. 明确保留并正式化四类认知动作：
   - `record_private_reflection`
   - `update_target_dossier`
   - `revise_judgement_plan`
   - `record_execution_postmortem`
2. 为下列动作新增最小 invocation 规则：
   - `assess_execution_window`
   - `probe_investigator_reaction`
   - `seed_unofficial_rumor`
3. 选择性加入一个 translated 规则示例，例如：
   - `split_investigation_attention` → `invoke.raise_false_suspicion`
4. 统一这些规则的边界：
   - 非客观执行类默认为 `resolution_mode: narrativized`
   - translated 类必须映射到现有 capability，避免凭空新增宿主执行面
5. 为新增 narrativized 规则补充 `semantic_type`，便于后续 memory / projection / classification 使用。

### 验收标准

- 新增 invocation 规则能通过 pack schema 校验。
- 认知动作与社会噪声/探测动作的分层清晰，不误入 objective_enforcement。
- 新增 translated 规则不依赖未实现 capability。

---

## 3.3 Phase A-3：为 revise_judgement_plan 补齐 runtime 承接

### 目标

补上设计中最明确的宿主缺口：`revise_judgement_plan` 不能只在 pack 中声明，还要能被 runtime 记录。

### 主要修改对象

- `apps/server/src/app/runtime/action_dispatcher_runner.ts`
- `apps/server/src/memory/recording/service.ts`
- 如有必要，相关 memory / overlay 类型定义与测试文件

### 计划动作

1. 在 action dispatch 完成后的 semantic intent 分支中加入 `revise_judgement_plan` 分流。
2. 在 memory recording service 中新增与其对应的记录入口，要求：
   - 有稳定 `record_kind`
   - 有清晰 tags
   - 默认进入 overlay
   - 若当前实现允许，则以 plan 语义进入 memory block；若暂不适合，则先只保留 overlay + trace 记录
3. 与 `record_private_reflection` / `update_target_dossier` / `record_execution_postmortem` 保持结构一致，减少新分支形态。
4. 如需最小状态反馈，可在后续 dispatch 结果或相关规则中为 `last_reflection_kind` / `last_plan_revision_tick` 留出口，但避免在宿主层写入过多 pack 特化逻辑。

### 验收标准

- `revise_judgement_plan` 语义动作在 dispatch 后能留下记录。
- 记录结果至少能在 overlay / trace 侧观察到。
- 不引入对其他 semantic intent 的回归破坏。

---

## 3.4 Phase A-4：补齐最小验证

### 目标

确保 Phase A 形成真正闭环，而不是只改 YAML。

### 计划测试

1. pack schema / loader 验证：
   - 新增字段与规则可被 `parseWorldPackConstitution` 正常解析。
2. action dispatcher / memory recording 验证：
   - `revise_judgement_plan` 触发后产生预期记录。
3. 若已有适合的 rule-based provider 测试入口：
   - 覆盖其在新字段存在时仍能产出稳定决策。

### 验收标准

- 定位性单测通过。
- 至少一条针对 `revise_judgement_plan` 的回归测试存在。

---

## 3.5 Phase B-1：扩展 pack.ai.tasks

### 目标

让 `death_note` 不只定制 `agent_decision`，而能显式影响多类 AI task。

### 主要修改对象

- `data/world_packs/death_note/config.yaml`
- 如必要，AI task 相关测试或文档

### 计划动作

1. 在 `pack.ai.tasks` 中补充最小配置：
   - `intent_grounding_assist`
   - `context_summary`
   - `memory_compaction`
   - `classification`
2. 对每个 task 给出 Death Note 语义偏好：
   - grounding：优先翻译为已有 capability 或 narrativized fallback
   - summary：强调调查热度、证据链、目标信息完整度、公开通报
   - memory_compaction：强调目标确认、资格确认、压力升级、复盘
   - classification：引入 `execution_window` / `false_lead` / `pressure_escalation` 等标签
3. 保持配置尽量 declarative，不要求新 task runner 才能生效。

### 验收标准

- AI task config 能被 pack schema 正常解析。
- 相关任务在读取 pack AI override 时不会报错。
- 配置命名与已有 task type 保持一致，不引入未注册 task 名称。

---

## 3.6 Phase B-2：校准 memory_loop 与记忆治理语义

### 目标

让 pack 对记忆保留策略的影响更可见，但不在本阶段大改底层 memory 架构。

### 计划动作

1. 审视并按设计调整 `pack.ai.memory_loop` 的阈值表达。
2. 在 pack 文本与 task config 中强化以下记忆对象的优先级：
   - `reflection`
   - `dossier`
   - `plan`
   - `execution_postmortem`
   - `investigation_pressure`
   - `false_lead`
3. 若现有测试允许，增加对 memory compaction 读取 pack 配置的针对性验证。

### 验收标准

- `memory_loop` 配置与设计一致。
- 记忆治理偏好在配置层可读、可解释。
- 不要求本阶段就实现完整的 dossier/plan 专属 memory block 体系。

---

## 3.7 Phase B-3：补 institutions / domains

### 目标

把世界中的机构与领域结构正式纳入 pack，而不再长期留空。

### 主要修改对象

- `data/world_packs/death_note/config.yaml`

### 计划动作

1. 增加最小 institutions：
   - `institution-npa-taskforce`
   - `institution-global-investigation-network`
   - `institution-public-media`
2. 增加最小 domains：
   - `domain-investigation`
   - `domain-public-opinion`
   - `domain-private-planning`
3. 为这些对象提供最小 state/tag，避免成为纯空壳。
4. 仅把它们纳入 pack canonical contract，不强求本阶段所有 runtime 分支都消费这些对象。

### 验收标准

- pack schema 校验通过。
- institutions / domains 至少具备后续可扩展的最小语义状态。

---

## 3.8 Phase B-4：细化现有 objective_enforcement 副作用

### 目标

不大量新增新 capability，而是在已有客观动作上补强更细的世界反馈。

### 主要修改对象

- `data/world_packs/death_note/config.yaml`

### 计划动作

1. 细化 `invoke.collect_target_intel`：
   - 更新 `target_profile_completeness`
   - 更新 `execution_window_confidence`
2. 细化 `invoke.raise_false_suspicion`：
   - 更新 `false_lead_density`
   - 轻微提升 `media_amplification_level`
3. 细化 `invoke.publish_case_update`：
   - 推进 `institutional_alert_stage`
   - 必要时同步 `investigation_coordination_level`
4. 保持 rule 语义为客观世界反馈，避免把内部认知动作塞进 objective 层。

### 验收标准

- 规则仍可被现有 objective 执行链理解。
- 副作用字段与 world/actor 初始状态字段一致。

---

## 3.9 Phase C：按门禁评估 storage.pack_collections

### 目标

在主线稳定后，再考虑是否引入领域存储模型。

### 进入条件

必须全部满足：

1. Phase A 已完成并验证通过。
2. Phase B 至少完成 AI task 与 institutions/domains 的 contract 扩展。
3. 团队确认当前阶段接受“先声明 schema、后逐步写入”的策略。

### 主要修改对象

- `data/world_packs/death_note/config.yaml`
- 如必要，相关 storage 测试/安装验证文件

### 计划动作

1. 引入最小 `storage.pack_collections`：
   - `target_dossiers`
   - `judgement_plans`
   - `investigation_threads`
2. 第一轮只要求：
   - schema 合法
   - storage plan 可编译/物化
   - 不强依赖 runtime 已把这些表真实写满
3. 若验证发现当前 runtime 对这类声明仍过早，则把本阶段延期，不阻塞主计划收尾。

### 验收标准

- storage schema 合法。
- 若执行此阶段，pack install / storage materialization 不报错。
- 若决定不进入此阶段，计划记录明确门禁结论与原因。

---

## 4. 文档、测试与回归要求

## 4.1 测试

实施时至少覆盖：

1. pack schema / loader 测试
2. memory recording / action dispatcher 针对 `revise_judgement_plan` 的测试
3. 如修改 AI task config 合并逻辑或依赖边界，则补对应单测
4. 若进入 Phase C，则补 storage compile/materialize 验证

## 4.2 文档

至少同步：

- `docs/WORLD_PACK.md`：若实际可声明能力边界发生收口变化
- `data/world_packs/death_note/README.md`：补充新增认知动作、机构结构、AI/记忆治理说明
- 如必要，补 `CHANGELOG.md`

## 4.3 验证顺序

建议实现后按以下顺序检查：

1. `typecheck`
2. 针对性 unit tests
3. pack 解析/加载验证
4. 若涉及 dispatch 语义，做最小 integration 验证

---

## 5. 风险与缓解

## 风险 1：pack 语义先行，runtime 承接不足

重点风险点：`revise_judgement_plan`、plan 语义 memory block、storage collections。

缓解：

- 先完成 Phase A 的 runtime 最短补口
- 对 Phase C 设显式门禁
- 不在 pack 中声明依赖未实现宿主能力的 objective 路径

## 风险 2：状态字段扩张过快

缓解：

- 仅先引入设计中最小高信息密度字段
- 后续新增字段必须说明消费方与更新来源

## 风险 3：objective 与 narrativized 边界混乱

缓解：

- 认知动作、社会噪声、失败尝试默认留在 `rules.invocation` + `resolution_mode: narrativized`
- 只有明确改变世界事实的能力才进入 `objective_enforcement`

---

## 6. 计划完成定义

满足以下条件时，可认为本计划主线完成：

1. Phase A 全部完成。
2. Phase B 中 AI task 扩展、institutions/domains 扩展、objective side effects 细化已完成。
3. `death_note` 正式 pack 可以稳定表达认知动作链。
4. `revise_judgement_plan` 在 runtime 中已有最小记录闭环。
5. 新增改动有测试与文档支撑。
6. Phase C 已被执行并验证，或被明确记录为暂缓且不影响主线闭环。

---

## 7. 建议执行顺序

1. Phase A-1 状态模型补齐
2. Phase A-2 invocation 扩展
3. Phase A-3 runtime 承接补口
4. Phase A-4 测试闭环
5. Phase B-1 AI tasks
6. Phase B-2 memory_loop / 记忆治理
7. Phase B-3 institutions / domains
8. Phase B-4 objective side effects
9. Phase C 门禁评估与可选执行
10. 文档与最终回归

---

## 8. 执行备注

- 本计划创建后不直接实施代码修改。
- 等待用户确认并执行该计划后，再进入实现阶段。
