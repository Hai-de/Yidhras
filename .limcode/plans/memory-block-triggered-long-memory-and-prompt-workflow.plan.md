<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md","contentHash":"sha256:bafa975535ef236d315de32b94726d4fed8271f18436330d3e048a7a06e7a604"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 扩展 memory 类型与持久化模型，引入 MemoryBlock / MemoryBehavior / MemoryRuntimeState、Prisma schema 草案与 TypeScript 类型草案  `#mblm-plan-p1`
- [x] 实现 memory block trigger engine、logic DSL 与受权限限制的 recent trace/intent/event 评估上下文  `#mblm-plan-p2`
- [x] 将 memory block materialization 接入 Context Source Adapter / ContextRun / Policy 主线，并把 activation 结果带入 diagnostics  `#mblm-plan-p3`
- [x] 增强 PromptFragment 与 orchestrator 排序/插入语义，支持 memory block 的 slot + anchor + depth + order 排序  `#mblm-plan-p4`
- [x] 补齐 trace/debug、删除语义、测试与文档同步，验证与现有 inference/workflow 链兼容，并收口 lint/import 排序问题  `#mblm-plan-p5`
<!-- LIMCODE_TODO_LIST_END -->

# Memory Block 触发式长记忆与提示词工作流实施计划

> Source Design: `.limcode/design/memory-block-triggered-long-memory-and-prompt-workflow-design.md`
>
> 状态说明（2026-04-10）：本文档对应的主要实现工作已完成，但正文仍保留部分**实现前背景**与**未实际交付的扩展目标**，因此不应被直接阅读为“当前代码现状”。
>
> 当前需要特别注意的差异：
>
> - `LongTermMemoryStore` 已不再是 noop；当前服务端已存在 Prisma-backed compatibility store
> - `PromptFragment` 已正式支持 `anchor / placement_mode / depth / order`
> - 当前 memory block diagnostics 的实际已交付字段为：`evaluated / inserted / delayed / cooling / retained / inactive`
> - 正文 Phase E 中提到的 `memory_blocks_deleted`、`permission_filtered` 等更丰富 trace/debug 字段，并未全部作为稳定 diagnostics 交付
> - 计划中多处提到“世界包可声明 memory block 行为”，但当前 pack schema 尚未提供正式的 memory block pack-level 声明入口

> 结论：本文档主要用于保留实施拆解与范围决策历史；当前现状请以 `docs/*`、contracts 与代码实现为准。

## 1. 目标

基于已确认的 Memory Block 设计，将当前仍以 `MemoryEntry[] -> memory_context -> memory_injector` 为主的记忆链路，升级为正式的：

```text
Memory Block Store
  -> Trigger Engine
  -> Runtime State
  -> Context Source Adapter
  -> ContextNode
  -> Context Policy Engine
  -> Prompt Orchestrator
  -> PromptFragment
```

本轮实施目标聚焦于 **MVP 可运行闭环**，即：

- 让长记忆不再是 noop store，而是正式持久化对象
- 让每条长记忆具备块级静态配置与运行时状态
- 让世界包可声明默认触发与放置策略
- 让最近 `trace / intent / event` 可在权限限制下参与触发评估
- 让长记忆以 `ContextNode` 与 `PromptFragment` 的方式进入现有推理主线
- 让系统对记忆激活、延迟、保留、冷却、删除拥有可观测证据

### 本轮明确不做

- embedding / vector retrieval
- 自动 rewrite / 自动 summarize into new block
- 通用图结构记忆网络
- 前端记忆可视化工作台
- 任意脚本执行式 trigger

---

## 2. 当前代码状态与切入点

### 2.1 已有可复用基础

当前代码已经具备以下重要基础：

- `apps/server/src/memory/types.ts`
  - 已有 `MemoryEntry / MemorySelectionResult / LongTermMemoryStore`
  - 但仍停留在“材料列表”层
- `apps/server/src/memory/service.ts`
  - 已串起 short-term / long-term / summary 的入口
  - 当前 `long_term_store` 与 `summarizer` 仍为 noop
- `apps/server/src/context/*`
  - 已有 `ContextNode / ContextRun / diagnostics / source adapters / policy engine`
- `apps/server/src/context/source_registry.ts`
  - 已支持 source adapter 注册，是接入 memory block runtime 的合适入口
- `apps/server/src/context/workflow/orchestrator.ts`
  - 已有线性 Orchestrator Lite，可承接后续 fragment 排序增强
- `apps/server/src/inference/processors/memory_injector.ts`
  - 已承担 memory -> fragment 注入，但职责需要收敛
- `apps/server/src/inference/prompt_fragments.ts`
  - 已定义 `PromptFragment`，但当前对 anchor / depth / order 支持不足
- `apps/server/src/inference/sinks/prisma.ts`
  - 已能写 `context_snapshot`，适合扩充 memory-block debug 信息

### 2.2 当前主要缺口

1. 没有正式 `MemoryBlock / MemoryBehavior / MemoryRuntimeState` 模型
2. 没有受控的 long-memory 持久化存储实现
3. 没有 trigger engine 与 DSL 执行器
4. 没有 recent trace / intent / event 的 memory-activation 评估上下文
5. 没有 memory block source adapter
6. `PromptFragment` 还无法稳定表达 anchor / depth / order
7. trace 中还没有 memory activation / insertion / deletion 证据

---

## 3. 实施分期

## 3.1 Phase A：Memory Block 数据模型与存储落地

### 目标

建立 MVP 所需的正式长记忆数据层，替代当前 noop long-term store。

### 建议涉及文件

- `apps/server/src/memory/types.ts`
- 建议新增：
  - `apps/server/src/memory/blocks/types.ts`
  - `apps/server/src/memory/blocks/store.ts`
  - `apps/server/src/memory/blocks/runtime_state.ts`
- 以及对应 Prisma / schema / migration 文件

### 计划内容

1. 保留现有 `MemoryEntry` 兼容层，但新增正式类型：
   - `MemoryBlock`
   - `MemoryBehavior`
   - `MemoryRuntimeState`
   - `MemoryActivationRule`
   - `MemoryPlacementRule`
   - `MemoryRetentionRule`
2. 定义最小存储接口：
   - `listCandidateBlocks(...)`
   - `upsertBlock(...)`
   - `updateRuntimeState(...)`
   - `hardDeleteBlock(...)`
3. 为 MemoryBlock 建立最小持久结构：
   - block 主体表
   - behavior 配置表（可拆或 JSON 存）
   - runtime state 表
4. 支持用户明确要求的硬删除语义：
   - block / behavior / runtime state 一并删除
   - 但保留最小系统审计事件或操作日志
5. 在不破坏现有 `LongTermMemoryStore` 接口消费者的前提下，保留兼容过渡层

### 范围控制

- 优先保证数据模型稳定，不在此阶段加入自动 rewrite / graph relation
- 若 Prisma 调整成本高，可先采用最小 JSON 列承载 `behavior`，避免 schema 爆炸

---

## 3.2 Phase B：Trigger Engine 与受限 recent-source 评估上下文

### 目标

让 MemoryBlock 能基于世界包声明的规则，在当前轮被安全评估为 active / delayed / retained / cooling / inactive。

### 建议涉及文件

- 建议新增：
  - `apps/server/src/memory/blocks/trigger_engine.ts`
  - `apps/server/src/memory/blocks/logic_dsl.ts`
  - `apps/server/src/memory/blocks/evaluation_context.ts`
- 可复用：
  - `apps/server/src/access_policy/*`
  - `apps/server/src/context/policy_engine.ts`
  - `apps/server/src/app/services/inference_workflow/repository.ts`

### 计划内容

1. 实现默认激活语义：
   - `mode='always'`
   - `trigger_rate=1`
   - `min_score=0`
2. 实现第一批 trigger：
   - `keyword`
   - `logic`
   - `recent_source(trace|intent|event)`
3. 实现安全 DSL 执行器：
   - `and / or / not / eq / in / gt / lt / contains / exists`
4. 构造受权限限制的 activation evaluation context：
   - `pack_state.actor_state`
   - `pack_state.world_state`
   - `pack_state.latest_event`
   - 若授权则加入 recent `trace / intent / event`
5. recent-source 读取必须经过裁剪：
   - 同一 agent 默认可读自身 recent traces/intents/events
   - 跨 agent / 跨 identity 明确拒绝或仅暴露空值
6. 产出统一 `MemoryActivationEvaluation`：
   - `status`
   - `activation_score`
   - `matched_triggers`
   - `recent_distance_from_latest_message`
   - `reason`
7. 在 trigger engine 内处理 retention/cooldown/delay 的状态流转

### 特别注意

- `trigger_rate` MVP 可以先按确定性实现，并预留字段；不要让随机性破坏回放一致性
- `recent_distance_from_latest_message` 应动态计算，不持久写死在 block 主体里

---

## 3.3 Phase C：Memory Block -> ContextNode materialization 接入 Context Module

### 目标

让被激活的长记忆成为正式 `ContextNode` 来源，而不是旁路注入 prompt。

### 建议涉及文件

- `apps/server/src/context/source_registry.ts`
- 建议新增：
  - `apps/server/src/context/sources/memory_blocks.ts`
  - `apps/server/src/memory/blocks/materializer.ts`
- 可能涉及：
  - `apps/server/src/context/types.ts`
  - `apps/server/src/context/service.ts`

### 计划内容

1. 新增 `memory-block-runtime` source adapter
2. 将 active / retained 状态的 memory block materialize 为 `ContextNode`
3. node metadata 至少包含：
   - `memory_id`
   - `memory_kind`
   - `activation_score`
   - `triggered_by`
   - `placement_depth`
   - `placement_order`
   - `anchor`
   - `recent_distance_from_latest_message`
4. 接入 `ContextService.buildContextRun()`：
   - 让 memory block nodes 与 legacy memory / runtime state / overlay 一起进入 working set
5. 让 `Context Policy Engine` 可以像治理 overlay 一样治理 memory block nodes：
   - visibility
   - placement lock
   - summarize/hide/reorder 是否允许
6. 在 `ContextRun.diagnostics` 中增加 memory block 评估摘要字段

### 范围控制

- 本轮不把 memory block 直接合并进 overlay 体系
- 优先让其成为与 overlay 平行的独立 source kind

---

## 3.4 Phase D：PromptFragment 与 Orchestrator 排序/插入增强

### 目标

让记忆块进入 prompt 时不再只有 `slot + priority`，而能表达 `anchor + depth + order`。

### 建议涉及文件

- `apps/server/src/inference/prompt_fragments.ts`
- `apps/server/src/inference/processors/memory_injector.ts`
- `apps/server/src/context/workflow/orchestrator.ts`
- `apps/server/src/inference/prompt_builder.ts`

### 计划内容

1. 先以兼容方式增强 `PromptFragment.metadata`：
   - `memory_id`
   - `memory_kind`
   - `activation_score`
   - `anchor`
   - `depth`
   - `order`
   - `placement_mode`
2. 调整 `memory_injector`：
   - 不再做规则求值
   - 仅消费已 materialized 的 memory nodes 并转 fragment
3. 强化 orchestrator 内部排序：
   - 在 slot 内不再只按 priority
   - 引入 anchor/depth/order 排序逻辑
4. 兼容当前 `priority` 体系：
   - 将 `priority` 视为最终 tie-breaker 或过渡字段
5. 评估是否需要在 `PromptFragment` 正式扩字段：
   - 若 metadata 方案已足够，可本轮先不破坏公共结构
   - 若排序逻辑变复杂，再在下一轮上移为一等字段

### 特别注意

- `token_budget_trimmer` 要理解新 metadata，避免把关键长记忆过早裁掉
- `memory_summary` 不应错误摘要掉被锁定或 placement 固定的记忆块

---

## 3.5 Phase E：Trace / Debug / 删除语义 / 测试与文档收口

### 目标

让 Memory Block 子系统具备完整的可观测性、可回放性与回归保障。

### 建议涉及文件

- `apps/server/src/inference/sinks/prisma.ts`
- `apps/server/src/app/services/agent.ts`
- `apps/server/src/app/services/audit.ts`
- `docs/ARCH.md`
- `docs/LOGIC.md`
- `docs/API.md`
- tests 相关目录

### 计划内容

1. 扩展 trace/context snapshot：
   - `memory_block_evaluations`
   - `memory_blocks_triggered`
   - `memory_blocks_delayed`
   - `memory_blocks_cooled_down`
   - `memory_blocks_inserted`
   - `memory_blocks_deleted`
   - `permission_filtered`
2. 为硬删除语义记录最小操作审计
3. 补齐单测：
   - trigger DSL
   - recent source 权限裁剪
   - retention/cooldown/delay 状态机
   - materializer
   - fragment 排序
4. 补齐集成测试：
   - 从 memory block store 到 ContextRun
   - 从 ContextRun 到 PromptFragment
   - inference trace 中可见 memory-block 证据
5. 文档同步：
   - `docs/ARCH.md`
   - `docs/LOGIC.md`
   - `docs/API.md`
6. 明确兼容性边界：
   - 现有 short-term / legacy memory selection 不应在本轮被破坏
   - world-death-note 等现有 pack 在未声明 memory block 时应维持原样工作

---

## 4. 关键实现判断

### 4.1 先兼容扩展，不立刻推翻现有 memory_context

建议继续保留：

- `MemoryEntry`
- `MemorySelectionResult`
- `memory_context`

但把它们逐步降级为兼容层，而不是未来长记忆主抽象。

### 4.2 先把 placement 放在 metadata，后续再决定是否提升为一等字段

因为当前 `PromptFragment` 已经被较多代码使用，建议：

- 第一轮先走 metadata 扩展
- 只有当 orchestrator 和 processors 的复杂度明显提高，再做结构提升

### 4.3 先让世界包配置 memory behavior，避免在系统层写死语义

系统默认只提供：

- `always`
- `keyword`
- `logic`
- `recent_source`
- `slot/depth/order`
- `retain/cooldown/delay`

而具体哪个 agent 用什么规则，应尽量由世界包声明。

---

## 5. 风险与缓解

### 风险 1：Memory 子系统与 Overlay 子系统边界混淆

缓解：

- 明确 source kind
- 明确 store 分层
- 不在本轮把二者混表或混语义

### 风险 2：recent trace / intent / event 读取引入越权

缓解：

- 先做权限裁剪层，再做 trigger engine
- 未授权即不给上下文，不在 DSL 内兜底读取原始数据

### 风险 3：排序语义侵入现有 processors 太深

缓解：

- 先集中在 orchestrator / memory_injector 内处理
- 尽量不让每个 processor 各自重写排序逻辑

### 风险 4：trace 字段快速膨胀

缓解：

- 优先存结构化摘要与 ids
- 避免重复写整份 memory content 到多个 snapshot 段

---

## 6. 里程碑建议

### Milestone 1：数据层可用

标志：

- MemoryBlock 可增删改查
- RuntimeState 可更新
- 替代 noop long-term store

### Milestone 2：触发与上下文接入可用

标志：

- trigger engine 可评估 always/keyword/logic/recent_source
- memory blocks 能 materialize 成 ContextNode

### Milestone 3：prompt 组装闭环可用

标志：

- memory block node 能稳定进入 PromptFragment
- slot + depth + order 生效
- trace 可观测

### Milestone 4：回归验证完成

标志：

- 不破坏现有 inference/workflow/context 主线
- tests/doc 同步完成

---

## 7. 计划结论

本轮实施应坚持一个核心原则：

> **不要把长记忆做成“更复杂的 MemoryEntry metadata”，而要把它提升为正式的 Memory Block Runtime 子系统，并通过 ContextNode 与 PromptFragment 主线接入现有架构。**

按上述 Phase A ~ E 推进，可以在不推翻当前 `Context Module / Orchestrator / Trace` 体系的前提下，逐步让 Memory 成为真正可配置、可触发、可插入、可审计的长记忆系统。

---

## 8. 实际交付结果回写（2026-04-10）

本计划对应实现已完成的稳定结果包括：

- Memory Block / Behavior / RuntimeState 的 Prisma schema、store、runtime state 更新与硬删除审计
- logic DSL、trigger engine、recent trace/intent/event 评估上下文
- `memory-block-runtime` Context Source Adapter 与 `ContextRun.diagnostics.memory_blocks`
- `PromptFragment` 与 orchestrator 对 `anchor / placement_mode / depth / order` 的支持
- entity overview、workflow trace/context snapshot 中对 memory block diagnostics 的读面暴露

当前**未作为稳定现状交付**、仍应视为后续候选或扩展目标的内容包括：

- pack-level memory block 声明入口
- `memory_blocks_deleted` / `permission_filtered` 等更细粒度稳定 diagnostics 字段
- 更深入的自动 rewrite / summarize / retrieval / graph memory 能力
