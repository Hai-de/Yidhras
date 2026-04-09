<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/agent-context-module-prompt-workflow-orchestrator-design.md","contentHash":"sha256:2a1bf4574bae9a529e545848cdee6bfd97cd4b001298d73364674801c7ff4c2c"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 引入 ContextNode / ContextRun / 基础 visibility-mutability-placement 模型，并建立独立 context 模块目录边界  `#acm-p1`
- [x] 实现首批 context source adapters，将现有 memory、trace/job/intent/event/post、policy/pack state 映射为统一上下文节点  `#acm-p2`
- [x] 将 inference context builder 接入 ContextService，保留 legacy memory_context 兼容层，避免现有 provider 与 prompt builder 立刻失效  `#acm-p3`
- [x] 实现 Context Orchestrator Lite，将现有 memory injector / policy filter / summary / token budget 处理迁移为线性上下文编排步骤  `#acm-p4`
- [x] 将上下文节点选择、裁剪与编排诊断写入 InferenceTrace.context_snapshot / prompt trace，并保持 workflow 调试链可读  `#acm-p5`
- [x] 补齐 unit/integration/regression 测试与文档，验证 Death Note 闭环、scheduler 链路与现有 inference workflow 无回归，同时明确通用工作流引擎仍属后续阶段  `#acm-p6`
<!-- LIMCODE_TODO_LIST_END -->

# Agent Context Module MVP 实施计划

> Source Design: `.limcode/design/agent-context-module-prompt-workflow-orchestrator-design.md`

## 1. 目标

基于已确认的长期设计方向，本计划不把“通用提示词工作流引擎”作为当前交付目标，而是先完成一个**可落地的 Context Module MVP**：

- 将当前分散在 `memory/*`、`inference/context_builder.ts`、`inference/processors/*`、`prompt_builder.ts`、`InferenceTrace.context_snapshot` 中的上下文逻辑，收口为正式模块
- 为未来的 Prompt Workflow Orchestrator、插件接入、节点可视化和 Agent 受限上下文控制预留结构边界
- 在当前阶段保持现有 `mock | rule_based` provider、Intent Grounder、scheduler、workflow persistence 与 Death Note semantic path 兼容

当前阶段的目标不是：

- 通用 DAG / 循环工作流引擎
- 前端节点可视化
- 插件热插拔执行平台
- 完整的 Agent context directives 权限控制系统

而是：

> **先把 Context Module 正式化，再用一个线性 orchestrator-lite 收口现有 prompt 处理链。**

---

## 2. 当前代码状态与切入点

### 2.1 已有可复用基础

当前后端已经具备以下可直接收编的能力：

- `apps/server/src/memory/types.ts`
  - 已定义 `MemoryEntry / MemoryContextPack / MemorySelectionDiagnostics`
- `apps/server/src/memory/service.ts`
  - 已负责从短期记忆、长期记忆、summary 构建 `memory_context`
- `apps/server/src/memory/short_term_adapter.ts`
  - 已把 trace / job / intent / post / event 映射为短期记忆材料
- `apps/server/src/inference/context_builder.ts`
  - 已组装 `memory_context / pack_state / policy_summary / visible_variables / transmission_profile`
- `apps/server/src/inference/prompt_builder.ts`
  - 已构建 fragment、按 slot 排序、运行 prompt processors 并输出 `PromptBundle`
- `apps/server/src/inference/processors/*`
  - `memory_injector`
  - `policy_filter`
  - `memory_summary`
  - `token_budget_trimmer`
- `apps/server/src/inference/sinks/prisma.ts`
  - 已将 `context_snapshot`、`prompt_processing_trace`、`semantic_intent`、`intent_grounding` 持久化到 `InferenceTrace`

这意味着：

- **上下文原料已经存在**
- **处理流水线已经存在**
- **诊断和持久化钩子也已经存在**

当前缺的不是“能力从零实现”，而是：

- 统一模型
- 正式模块边界
- 兼容迁移层
- 面向未来扩展的抽象命名

### 2.2 当前结构性缺口

从实施角度，主要缺口集中在五处：

1. `memory_context` 仍然是 memory 视角的数据包，而不是统一的 `ContextNode` 集合
2. prompt processors 已经像工作流节点，但仍缺少正式 `Context Orchestrator` 边界
3. `policy_filter` 目前对 fragment 做过滤，而不是对“上下文节点/工作集”做治理
4. `InferenceTrace.context_snapshot` 已记录上下文，但还没有统一的 node-selection / node-drop / orchestrator-step 语义
5. 当前 provider / prompt builder / workflow 调试面都依赖现有 `memory_context` 形状，因此必须有兼容层，不能硬切

### 2.3 范围约束

为了避免把 MVP 膨胀成“提示词操作系统”，本计划建议坚持以下约束：

- **不引入通用 DAG/workflow engine**；当前只做线性 orchestrator-lite
- **不新增前端节点编辑器**；当前只做服务端抽象与 trace
- **不把插件执行平台作为前置条件**；只预留注册与节点类型边界
- **不要求 Agent context directives 在首轮真正开放给模型自写**；本轮只预留 schema / policy 位点，最多实现系统侧 overlay 能力
- **不强制引入新的 Prisma 表**；优先复用 `InferenceTrace.context_snapshot` 与现有 diagnostics
- **不破坏现有 `memory_context` 字段契约**；通过兼容层过渡，避免现有 prompt/processors/provider 大面积回归

---

## 3. 实施范围

## 3.1 Phase A：引入 Context Module 基础模型与目录边界

### 目标

正式定义 Context Module 的核心类型，把“上下文节点”从 memory entry 概念中拆出来。

### 推荐新增目录

建议新增：

- `apps/server/src/context/types.ts`
- `apps/server/src/context/service.ts`
- `apps/server/src/context/source_registry.ts`
- 可选：
  - `apps/server/src/context/policy_engine.ts`
  - `apps/server/src/context/compat.ts`
  - `apps/server/src/context/workflow/`

### 计划内容

1. 定义 `ContextNode` 最小模型
   - `id`
   - `node_type`
   - `scope`
   - `source_kind / source_ref`
   - `content.text / content.structured`
   - `tags / importance / salience`
   - `visibility`
   - `mutability`
   - `placement_policy`
   - `provenance`
2. 定义 `ContextRun` / `ContextSelectionResult` / `ContextDiagnostics`
3. 定义最小策略枚举
   - visibility level
   - mutability level
   - placement tier / prompt slot preference
4. 明确与现有 `MemoryEntry` 的关系：
   - `MemoryEntry` 继续作为 legacy source material
   - `ContextNode` 成为新统一节点模型
5. 建立 context 模块目录边界，避免后续继续把上下文逻辑散落回 `memory/*` 与 `inference/*`

### 交付判断

Phase A 完成后，应能在类型层明确区分：

- memory entry
- context node
- prompt fragment

这三个概念不再混杂。

---

## 3.2 Phase B：实现首批 Context Source Adapters

### 目标

将现有上下文来源映射为统一上下文节点，而不是直接塞进 `memory_context`。

### 代码范围

优先涉及：

- `apps/server/src/memory/short_term_adapter.ts`
- `apps/server/src/memory/service.ts`
- 新增 `apps/server/src/context/sources/*`
- `apps/server/src/inference/context_builder.ts`

### 首批建议覆盖的来源

1. trace -> `recent_trace`
2. job -> `recent_job`
3. intent -> `recent_intent`
4. post -> `recent_post`
5. event -> `recent_event`
6. summary -> `memory_summary`
7. policy summary -> `policy_summary`
8. pack state snapshot -> `pack_state_snapshot`
9. world state snapshot -> `world_state_snapshot`

### 计划内容

1. 新增 source adapter 层，而不是继续直接输出 `MemoryEntry[]`
2. 为每种 source 统一分配：
   - node_type
   - source_kind
   - tags
   - visibility / mutability 缺省策略
3. 将现有 short-term memory adapter 调整为：
   - 先构建 source material
   - 再统一映射为 context nodes
4. 针对 pack state / policy summary 增加 node materialization
   - 避免这些关键信息永远只以裸 JSON 埋在 `context_snapshot` 里
5. 为未来 plugin source 保留 registry 接口，但本轮不实现动态插件运行时

### 特别注意

这里不要试图一次性穷举所有 node 类型。

首轮只需要把当前实际进入 prompt/trace 的主要信息源统一化，尤其是：

- trace / event / policy / pack state

因为它们最能体现上下文模块的价值。

---

## 3.3 Phase C：将 ContextService 接入 inference context builder，并保留兼容层

### 目标

让 `buildInferenceContext()` 正式从 Context Module 构建上下文，同时不打断现有 `memory_context` 消费方。

### 代码范围

优先涉及：

- `apps/server/src/inference/context_builder.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/context/service.ts`
- `apps/server/src/context/compat.ts`

### 计划内容

1. 引入新的 `ContextService.buildContextRun(...)`
2. 在 `InferenceContext` 中新增新的上下文字段，例如：
   - `context_run`
   - 或 `context_module`
   - 或 `context_nodes + context_diagnostics`
3. 保留现有 `memory_context` 字段，但改为由 Context Module 派生
4. 通过 compatibility adapter 保证当前依赖方仍可继续读取：
   - `context.memory_context.short_term`
   - `context.memory_context.long_term`
   - `context.memory_context.summaries`
5. 明确过渡阶段策略：
   - 新模块是 source of truth
   - `memory_context` 是兼容投影，而不是继续作为上游事实源

### 为什么必须保留兼容层

因为当前以下模块都还依赖 `memory_context`：

- `prompt_builder.ts`
- `memory_injector.ts`
- `memory_summary.ts`
- `policy_filter.ts`
- `token_budget_trimmer.ts`
- `InferenceTrace.context_snapshot` 的现有结构

如果硬切，会造成较大范围回归。

---

## 3.4 Phase D：实现 Context Orchestrator Lite，收口现有 prompt processors

### 目标

把当前隐式 prompt processor 流程提升为一个正式但轻量的上下文编排器。

### 代码范围

优先涉及：

- `apps/server/src/context/workflow/orchestrator.ts`
- `apps/server/src/context/workflow/nodes/*`
- `apps/server/src/inference/prompt_builder.ts`
- `apps/server/src/inference/processors/*`

### 计划内容

1. 定义 orchestrator-lite 的固定线性阶段，例如：
   - source normalize
   - policy filter
   - summary compaction
   - token budget trim
   - placement
   - fragment assembly
2. 将现有 processors 迁移为 context workflow step，或通过 adapter 挂接：
   - `memory_injector`
   - `policy_filter`
   - `memory_summary`
   - `token_budget_trimmer`
3. 保持现有 slot 语义不变：
   - `system_core`
   - `role_core`
   - `world_context`
   - `memory_short_term`
   - `memory_long_term`
   - `memory_summary`
   - `output_contract`
   - `post_process`
4. 将 `prompt_builder.ts` 的职责收敛为：
   - 基础 fragment seed 生成
   - 调用 orchestrator-lite
   - 最终 assembly
5. 明确：
   - 当前阶段不支持通用 DAG
   - 当前阶段不支持任意用户可配置节点图
   - 当前阶段不支持插件任意重排流程

### 设计收益

这样做之后：

- 现有行为大体不变
- 但“为什么这些处理顺序存在”会变得结构化、可替换、可 trace
- 未来想支持 plugin node / variable templating / slot override，就有了落点

---

## 3.5 Phase E：把节点选择、裁剪与编排诊断写入 InferenceTrace

### 目标

让 Context Module 的运行结果正式进入 trace，而不是只留下 memory diagnostics 的碎片。

### 代码范围

优先涉及：

- `apps/server/src/inference/sinks/prisma.ts`
- `apps/server/src/inference/types.ts`
- `apps/server/src/inference/service.ts`
- 如有必要：相关 workflow debug read models

### 计划内容

1. 扩展 `InferenceTrace.context_snapshot` 中的上下文字段，至少包括：
   - selected node summaries
   - dropped node ids / reasons
   - policy decisions
   - orchestration steps
   - final slot allocation summary
2. 扩展 `PromptProcessingTrace`，使其更贴近 context workflow，而不只描述 fragment diff
3. 保持现有 workflow detail API 不破坏，但让 debug 面能读取到更多结构化上下文信息
4. 在 `InferenceTrace.trace_metadata` 中补充 context module 版本/phase 标识

### 推荐策略

第一阶段仍不新增新表，优先复用：

- `InferenceTrace.context_snapshot`
- `InferenceTrace.trace_metadata`
- `PromptBundle.metadata.processing_trace`

这样风险最小。

---

## 3.6 Phase F：基础 policy 模型收口与 MVP 权限边界

### 目标

先给 Context Module 建立最小治理边界，避免未来 Agent/插件接入时没有规则可依。

### 范围控制

本阶段不实现完整细粒度权限矩阵，但建议至少明确以下等级：

1. `hidden_mandatory`
2. `visible_fixed`
3. `visible_flexible`
4. `writable_overlay`

### 计划内容

1. 将当前 `policy_gate === deny` 的 fragment 过滤逻辑上移到 node / working-set 层
2. 在 node metadata 中显式标出：
   - visibility level
   - mutability level
   - placement lock / preference
3. 对当前来自系统、policy、world 的上下文材料先赋予保守默认值
4. 明确本阶段暂不向模型开放真正的 `context_directives` 自写能力，但允许：
   - 预留 schema
   - 在 trace 中保留 future directive slots
5. 若需要自建 overlay，优先从系统侧 note / summary materialization 开始，而不是先做 Agent 自主编辑

### 这样做的意义

它能保证当前阶段不会把“Context Module 正式化”错误演化成“Agent 已经可以自由操纵 prompt”。

---

## 3.7 Phase G：测试、回归与文档同步

### 测试建议

#### Unit

1. `ContextNode` 映射与序列化
2. 各 source adapter 的 node materialization
3. compatibility adapter：`ContextRun -> MemoryContextPack`
4. orchestrator-lite 线性步骤
5. policy filtering / summary compaction / token trimming 的 node-level 断言

#### Integration

1. `buildInferenceContext()` 改为走 `ContextService` 后，现有 prompt bundle 仍能生成
2. `InferenceTrace.context_snapshot` 能看到 selected/dropped nodes
3. Death Note semantic path 在新上下文模块下仍能完成 inference -> grounding -> ActionIntent
4. scheduler 触发的 job 不因 context 重构而失去可执行性

#### Regression

至少覆盖：

1. `mock` provider 基线
2. `rule_based` provider 基线
3. Death Note pack 主链
4. narrativized failure 路径
5. workflow detail / trace read 不回归

### 文档同步

建议同步：

- `docs/LOGIC.md`
- `docs/ARCH.md`
- `docs/API.md`
- `README.md`
- `TODO.md`
- `记录.md`

尤其要明确：

- 当前已引入 Context Module MVP
- 仍未引入通用 DAG / 可视化工作流引擎
- 现有 prompt processing 已通过 orchestrator-lite 收口
- `memory_context` 目前属于 compatibility surface

---

## 4. 风险与控制

### 风险 1：MVP 被做成半个通用工作流平台

影响：
- 范围膨胀
- 工期失控
- 偏离当前 Agent loop 目标

控制：
- 只做线性 orchestrator-lite
- 不做 DAG
- 不做前端可视化
- 不做动态插件执行平台

### 风险 2：直接替换 `memory_context` 破坏现有主链

影响：
- prompt builder / processors / providers 大面积回归

控制：
- Context Module 作为新 source of truth
- `memory_context` 保留兼容投影
- 渐进迁移，不做硬切

### 风险 3：上下文节点与 prompt fragment 边界仍然混杂

影响：
- 后续权限和变量系统很难落地

控制：
- 明确三层：
  - context node
  - workflow step
  - prompt fragment

### 风险 4：没有足够 trace，重构后难以 debug

影响：
- 很难判断 prompt 变化为何发生

控制：
- 强制持久化 selected/dropped nodes 与 orchestration steps
- 让 workflow / trace 读面对上下文重构保持可解释

### 风险 5：提前开放 Agent 上下文控制导致治理边界失效

影响：
- Agent 可能绕过固定约束

控制：
- 首阶段只预留 directive schema
- 不在 MVP 中开放模型自写上下文操作
- 先做系统侧 policy level 和 overlay 边界

---

## 5. 验收标准

本计划实施完成后，应满足：

1. 服务端已经存在正式 `Context Module` 边界，而不是只依赖 `memory_context`
2. 当前主要上下文来源能够统一映射为 `ContextNode`
3. `buildInferenceContext()` 已通过 `ContextService` 构建上下文
4. 现有 `memory_context` 仍可作为兼容表面被 prompt builder / processors 消费
5. `prompt_builder.ts` 已接入线性 `Context Orchestrator Lite`
6. `InferenceTrace.context_snapshot` 能看到 selected nodes、dropped reasons、orchestration diagnostics
7. `mock`、`rule_based`、Death Note semantic path、scheduler workflow 不发生明显回归
8. 文档已明确：当前完成的是 Context Module MVP，不是完整通用工作流引擎

---

## 6. 建议实施顺序

1. 先定义 `ContextNode` / `ContextRun` 模型与 context 模块目录（Phase A）
2. 再把现有 memory / policy / pack state 映射为统一节点（Phase B）
3. 接着把 `context_builder.ts` 改为接入 `ContextService`，保留 compatibility layer（Phase C）
4. 然后把 prompt processor 主线收口为 orchestrator-lite（Phase D）
5. 再把上下文节点选择与诊断写入 trace（Phase E）
6. 最后补 policy 边界、测试与文档（Phase F/G）

这个顺序的好处是：

- 先把“数据模型和边界”钉住
- 再做运行时接入
- 最后再做调试与治理补强

从而避免出现“流程先重构了，但上下文模型仍然说不清”的倒挂。

---

## 7. 结论

当前最合理的计划不是立即去做一个庞大的 Prompt Workflow Engine，而是：

> **先把当前分散的 memory / context / prompt processing 主线收口为一个正式的 Context Module MVP，并以线性 orchestrator-lite 承担现有编排职责。**

这样既能：

- 为未来插件与节点可视化留出边界
- 为 Agent 受限上下文控制打基础
- 保持当前 inference / workflow / Death Note 主链稳定

又能避免：

- 过早进入通用工作流平台建设
- 在当前阶段引入不必要的系统复杂度
