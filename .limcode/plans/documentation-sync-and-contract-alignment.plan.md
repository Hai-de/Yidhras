<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"review","path":".limcode/review/documentation-code-consistency-review.md","contentHash":"sha256:69819df43dc3fc4f44973e3519f8eeba50b4072c08d66ab5f457450d9de9e8a9"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 修订稳定 API 文档，消除 AiInvocation 公开边界自相矛盾，并补入系统通知接口说明  `#doc-plan-p1`
- [x] 更新 README 与前端/系统概览描述，补充当前系统通知与观测能力的稳定入口  `#doc-plan-p2`
- [x] 补齐 packages/contracts 中 entity overview 相关契约，或明确扩展字段的稳定性边界  `#doc-plan-p3`
- [x] 为 memory block 相关 design/plan 文档补充“现状差异/历史资产”标识，避免被误读为当前实现说明  `#doc-plan-p4`
- [x] 完成一次文档交叉复核，确认稳定文档、过程文档与代码实现表述一致  `#doc-plan-p5`
<!-- LIMCODE_TODO_LIST_END -->

# 文档同步与契约对齐修订计划

> Source Review: `.limcode/review/documentation-code-consistency-review.md`

## 1. 目标

基于本轮审查结果，优先修复当前项目文档中已经确认的同步滞后问题，使文档重新满足以下标准：

- **中立**：只描述当前真实实现与明确边界，不把目标态写成现状
- **客观**：删除过时结论，避免文档内部自相矛盾
- **直接**：让读者能快速知道哪些是稳定现状、哪些是过程资产、哪些仍未正式开放
- **可对照**：稳定文档、共享 contracts、服务端实际返回结构尽量一致

本计划分为两条主线：

1. **稳定文档修订**：`README.md`、`docs/*`、必要的应用级说明
2. **契约与过程资产收口**：`packages/contracts` 与 `.limcode/design|plans/*`

---

## 2. 本轮问题收敛范围

### 2.1 需要立即修复的稳定文档问题

1. `docs/API.md` 中关于 `AiInvocationRecord` 公开查询接口的描述前后矛盾
2. 系统通知接口 `/api/system/notifications`、`/api/system/notifications/clear` 已被代码与前端使用，但未进入稳定 API 文档与 README 概览
3. entity overview 文档描述与 `packages/contracts` 的 schema 未完全同步，`context_governance` 与 `memory.latest_blocks` 的稳定性边界不清晰

### 2.2 需要收口的过程文档问题

1. memory block 设计稿仍保留“LongTermMemoryStore 是 noop”等已过时背景
2. memory block 计划文档 TODO 已完成，但正文仍保留未交付的 trace/debug 范围，容易造成误读
3. 过程文档把“世界包可声明 memory block 行为”写得过于接近现状，但代码尚未提供对应 pack-level schema 入口

---

## 3. 工作分解

## 3.1 Phase A：稳定 API 文档修订

### 目标

让 `docs/API.md` 重新成为对外接口的可信入口。

### 修改点

1. 统一 `AiInvocationRecord` 的公开边界说明：
   - 明确 `GET /api/inference/ai-invocations`
   - 明确 `GET /api/inference/ai-invocations/:id`
   - 删除“尚未公开 dedicated public query API”之类旧结论
2. 在 System 章节补入：
   - `GET /api/system/notifications`
   - `POST /api/system/notifications/clear`
3. 重新审视 entity overview 小节：
   - 明确 `memory.summary`
   - 明确 `memory.latest_blocks`
   - 明确 `context_governance`
   - 若其为稳定读面，则让文档与 contracts 对齐
   - 若其为观察性扩展，则在文档中明确说明稳定性级别

### 预期结果

- API 文档内部不再自相矛盾
- 公开可调用接口完整可见
- entity overview 的读面边界更清晰

---

## 3.2 Phase B：README 与现状概览修订

### 目标

让仓库入口文档准确反映当前系统能力，而不是遗漏已经上线的可见能力。

### 修改点

1. 更新根 `README.md` 的“当前实现概览”
2. 补入系统通知/壳层通知观测面的存在
3. 必要时同步 `apps/web/README.md` 中与当前系统能力相关的简述
4. 保持 README 只做入口级概览，不把细节堆回根文档

### 预期结果

- 根文档能正确引导读者理解当前系统表面能力
- 避免“代码里有、README 没提”的入口级遗漏

---

## 3.3 Phase C：共享 contracts 与服务端返回结构对齐

### 目标

降低“文档写了、服务端返回了，但 contracts 没声明”的割裂感。

### 修改点

1. 审查 `packages/contracts/src/projections.ts` 中 `entityOverviewDataSchema`
2. 根据实际稳定边界做二选一：
   - **方案 A：补齐稳定字段**
     - `memory.latest_blocks`
     - `context_governance`
   - **方案 B：保守声明**
     - 继续只保留最小 schema
     - 但在文档里明确这些字段属于扩展观察字段
3. 保证 README / API / contracts 三者在“是否稳定公开”这个问题上口径一致

### 决策标准

- 若前端或外部调用面已经依赖这些字段，应倾向方案 A
- 若这些字段仍被视为诊断增强面，应倾向方案 B，并在文档中降级表述

---

## 3.4 Phase D：过程文档现状差异标注

### 目标

不删除历史设计资产，但阻止它们继续被误读为当前现状说明。

### 修改点

针对以下文档：

- `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md`
- `.limcode/plans/memory-block-triggered-long-memory-and-prompt-workflow.plan.md`

补充：

1. 文首状态标识：
   - 历史设计意图 / 已部分落地 / 与当前实现存在差异
2. 当前实现差异摘要：
   - `LongTermMemoryStore` 已非 noop
   - `PromptFragment` 已支持 `anchor / placement_mode / depth / order`
   - 当前 memory block diagnostics 实际已落地字段范围
   - 当前未提供 pack-level memory block 声明入口
3. 对已完成计划增加“实际交付结果 / 未纳入交付项”回写段

### 预期结果

- 保留设计历史价值
- 同时避免它们继续误导后来阅读者

---

## 3.5 Phase E：最终交叉复核

### 目标

完成一次轻量复核，确认修订后的文档系统重新收敛。

### 复核点

1. `docs/API.md` 与服务端 route 是否一致
2. `README.md` 的现状概览是否与实现匹配
3. `packages/contracts` 与服务端返回结构口径是否一致
4. `.limcode/design` / `.limcode/plans` 是否已明确标注历史属性与现状差异
5. 同一能力是否还存在“文档 A 说已公开、文档 B 说未公开”的冲突

### 验收标准

- 审查中已记录的 6 个文档问题均有明确处理结果
- 不再存在公开边界自相矛盾
- 稳定文档与过程文档的职责边界更清晰

---

## 4. 实施顺序建议

建议按以下顺序执行：

1. `docs/API.md`
2. `README.md`
3. `packages/contracts/src/projections.ts`
4. `.limcode/design/...memory-block...`
5. `.limcode/plans/...memory-block...`
6. 最终交叉复核

这样可以先修正最容易误导调用方的稳定表面，再处理过程资产。

---

## 5. 风险与注意事项

### 风险 1：把观察性字段误升级为稳定契约

缓解：
- 在改 `packages/contracts` 前先以现有前端消费面为准判断是否稳定依赖
- 若未稳定，不要过度承诺，只在文档中明确“扩展观察字段”

### 风险 2：过程文档修改过度，丢失历史语境

缓解：
- 不重写历史设计全文
- 以“新增现状差异说明”替代“抹平历史记录”

### 风险 3：README 重新膨胀

缓解：
- README 只保留入口级信息
- 细节继续下沉到 `docs/API.md` 与专项文档

---

## 6. 完成定义

本计划完成时，应满足：

- `docs/API.md` 中不再存在公开接口说明冲突
- 系统通知接口已进入稳定文档
- entity overview 的文档、contracts、实现边界明确一致
- memory block 相关 design/plan 明确标识为历史/过程资产，并补充当前实现差异说明
- 审查结论可回溯为“问题已被修正或已被明确降级说明”

---

## 7. 计划结论

本轮不应直接把所有文档都大改，而应优先完成一件更重要的事：

> **重新建立“稳定现状文档”与“历史设计/计划资产”的边界。**

只要先把公开边界、自相矛盾、契约未对齐这几类问题修掉，文档系统就能重新恢复为一个可信的代码入口。
