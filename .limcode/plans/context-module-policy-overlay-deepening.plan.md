<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/context-module-policy-overlay-deepening-design.md","contentHash":"sha256:639942b5ea8c273a6f1c9311c569ee4351a023aed5690e6716f4120c1bff633f"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 引入 Context Policy Engine 最小版，定义 visibility / operation / placement 的节点级决策模型、reason codes 与执行入口  `#cmpo-p1`
- [x] 将现有 policy_gate / visibility_blocked 过滤从 fragment 级兼容逻辑上移到 ContextNode / working-set 级治理，同时保持 orchestrator-lite 与 memory_context 兼容  `#cmpo-p2`
- [x] 引入 ContextOverlayEntry 最小持久化模型与 kernel-side overlay store，并实现 overlay source adapter materialization 为 writable_overlay 节点  `#cmpo-p3`
- [x] 将 overlay 与 policy 决策接入 ContextService / ContextRun / trace snapshot，增强 workflow debug、agent overview 所需的 overlay/policy 可观测字段  `#cmpo-p4`
- [x] 预留 future ContextDirective schema、拒绝原因与 trace 结构，但不开放模型直接自写上下文操作  `#cmpo-p5`
- [x] 补齐 unit/integration/e2e 与文档同步，验证 Death Note、scheduler、workflow debug 链在 policy/overlay 深化后无回归，并明确仍未进入通用 DAG 工作流引擎阶段  `#cmpo-p6`
<!-- LIMCODE_TODO_LIST_END -->

# Context Module Policy / Overlay 深化实施计划

> Source Design: `.limcode/design/context-module-policy-overlay-deepening-design.md`

## 1. 目标

基于已经完成的 **Context Module MVP**，本轮不进入“通用 Prompt Workflow Engine / DAG / 可视化编排器”建设，而是继续补齐上下文系统真正可治理的两条主线：

- **Context Policy Engine**：让 `visibility / mutability / placement` 从描述性 metadata 升级为真正的运行时节点治理输入
- **Context Overlay 子系统**：让 agent-owned / system-generated 工作层资产拥有正式持久化与 materialization 路径，而不再只是临时 memory 材料

当前阶段的目标不是：

- 通用 DAG prompt workflow 引擎
- 前端节点编辑器
- 插件执行平台
- 直接开放 Agent 自主 `ContextDirective` 执行

而是：

> **在保持 Context Module MVP 稳定的前提下，把 policy 从 fragment-level 提升到 node-level，并把 overlay 从概念推进为最小可实现的 kernel-side 工作层对象。**

---

## 2. 当前代码状态与切入点

### 2.1 已有基础

当前代码已经具备以下可直接延展的基础：

- `apps/server/src/context/types.ts`
  - 已定义 `ContextNode / ContextRun / ContextRunDiagnostics`
  - 已有等级与元信息：
    - `hidden_mandatory`
    - `visible_fixed`
    - `visible_flexible`
    - `writable_overlay`
    - `immutable / fixed / flexible / overlay`
- `apps/server/src/context/service.ts`
  - 已将 legacy memory selection 与 runtime state materialize 为统一 context nodes
- `apps/server/src/context/source_registry.ts`
  - 已具备 context source adapter 注册入口
- `apps/server/src/context/compat.ts`
  - 已将 `ContextRun` 向下派生为 legacy `memory_context`
- `apps/server/src/context/workflow/orchestrator.ts`
  - 已具备线性 orchestrator-lite
- `apps/server/src/inference/processors/policy_filter.ts`
  - 当前仍承担 fragment-level 过滤兼容逻辑
- `apps/server/src/inference/sinks/prisma.ts`
  - 已把 `context_module / context_debug / prompt_assembly` 写入 `InferenceTrace.context_snapshot`
- `apps/server/src/app/services/agent.ts`
  - 已经能从 `InferenceTrace.context_snapshot` 读取 memory / prompt diagnostics，用于 agent overview

### 2.2 当前缺口

从实现角度，当前最主要的缺口集中在四处：

1. **Context Policy Engine 还不存在**
   - 当前 policy 决策没有独立模块
   - `policy_gate === deny` 仍停留在 fragment-level filter
2. **Overlay 还不存在正式持久化结构**
   - 没有 `ContextOverlayEntry`
   - 没有 overlay store
   - 没有 overlay source adapter
3. **Working set 治理还缺少 operation-level 语义**
   - 还无法正式表达 summarize / reorder / hide / pin 的 allow/deny
4. **future directives 还没有正式 schema 与 trace 预留**
   - 后续开放 Agent context control 时还缺少稳定落点

### 2.3 约束判断

为控制本轮范围，建议坚持以下约束：

- **不引入 DAG / 通用工作流引擎**；继续沿用 orchestrator-lite
- **不把 overlay 放进 pack runtime**；overlay 继续作为 kernel-side inference/workflow working-layer object
- **不删除现有 `memory_context`**；继续保留 compatibility layer
- **不开放模型直接写 overlay / directives**；本轮只预留 schema、store、trace 与系统侧写入能力
- **不要求前端马上做 overlay/policy 可视化页面**；优先保证后端契约与 trace 完整
- **尽量少改数据库主干表**；若新增持久化模型，优先新增最小内核表而不是大面积重构现有 workflow 表

---

## 3. 实施范围

## 3.1 Phase A：引入 Context Policy Engine 最小版

### 目标

建立一个正式的 node-level policy 决策模块，让节点治理不再只是 fragment metadata 兼容判断。

### 推荐新增文件

建议新增：

- `apps/server/src/context/policy_engine.ts`
- 可选拆分：
  - `apps/server/src/context/policy_types.ts`
  - `apps/server/src/context/policy_reasons.ts`

### 计划内容

1. 定义 node-level policy decision 结构，例如：
   - `visibility_decision`
   - `operation_decision`
   - `placement_decision`
   - `reason_codes[]`
2. 定义最小 reason codes，例如：
   - `hidden_mandatory`
   - `fixed_slot_locked`
   - `transform_denied`
   - `overlay_only_mutation`
   - `policy_gate_deny`
3. 把当前节点等级的“静态标签”正式映射为策略语义：
   - `hidden_mandatory`
   - `visible_fixed`
   - `visible_flexible`
   - `writable_overlay`
4. 将 policy engine 的输入限制在当前最小必要范围：
   - `ContextNode[]`
   - 当前 actor / identity
   - policy summary
   - optional overlay state
5. 输出应先满足以下用例：
   - 某节点是否可见
   - 某节点是否可进入 working set
   - 某节点是否允许 summarize/hide/reorder
   - 某节点是否允许 placement 改写

### 范围控制

本阶段不追求一次性做满所有权限矩阵，只先固化：

- read / visible
- transform / summarize
- placement / locked-or-not
- hide / allowed-or-not

---

## 3.2 Phase B：把 policy 从 fragment-level 上移到 ContextNode / working-set 级

### 目标

让节点治理发生在 Context Module 侧，而不是主要依赖 `policy_filter.ts` 对 prompt fragments 的补救式过滤。

### 代码范围

优先涉及：

- `apps/server/src/context/service.ts`
- `apps/server/src/context/workflow/orchestrator.ts`
- `apps/server/src/inference/processors/policy_filter.ts`
- 如有必要：`apps/server/src/context/source_registry.ts`

### 计划内容

1. 在 ContextService / working-set 选择阶段引入 policy engine 判定
2. 将 `policy_filter.ts` 的职责收敛为：
   - compatibility guard
   - 最后一层 fragment safety fallback
   而不是主要治理逻辑
3. 让 `ContextRun.diagnostics` 明确记录：
   - `policy_decisions`
   - `blocked_nodes`
   - `locked_nodes`
   - `visibility_denials`
4. 保证当前 `Prompt Orchestrator Lite` 仍然保持线性和兼容，不因 policy 上移导致 prompt 主链回归

### 特别注意

这里的关键不是“删掉 `policy_filter`”，而是：

> **把真正的 policy 判断前移到 node-level，`policy_filter` 仅保留兼容与兜底语义。**

---

## 3.3 Phase C：引入 Overlay Store 最小版

### 目标

让 overlay 成为正式持久化工作层对象，并通过 source adapter 进入 Context Module。

### 推荐新增文件

建议新增：

- `apps/server/src/context/overlay/store.ts`
- `apps/server/src/context/overlay/types.ts`
- `apps/server/src/context/sources/overlay.ts`

如需持久化，可新增最小 Prisma/存储表（名称以最终 schema 为准）：

- `ContextOverlayEntry`

### 建议字段

最小字段可先覆盖：

- `id`
- `actor_id`
- `pack_id`
- `overlay_type`
- `title`
- `content_text`
- `content_structured`
- `tags`
- `status`
- `persistence_mode`
- `source_node_ids`
- `created_by`
- `created_at_tick`
- `updated_at_tick`

### 首轮 overlay 类型建议

首轮只做最小集合：

- `self_note`
- `target_dossier`
- `system_summary`

后续再考虑：

- `hypothesis`
- `reminder`

### 计划内容

1. 新增 overlay store 读写接口
2. 新增 overlay source adapter，将 overlay materialize 为：
   - `scope='agent' | 'system'`
   - `visibility.level='writable_overlay'`
3. 在 ContextService 中把 overlay source 接入到 source registry
4. 初期先支持系统侧创建 overlay，不要求模型直接生成

### Ownership 判断

overlay 建议继续保留在 kernel-side，而不是 pack runtime，理由：

- 更接近 inference / workflow / actor memory working layer
- 不属于 world governance core state
- 与 `InferenceTrace / DecisionJob / ActionIntent` 更同域

---

## 3.4 Phase D：将 overlay 与 policy 决策接入 trace / workflow debug / agent overview

### 目标

让 policy / overlay 的效果不仅存在于内部逻辑中，而且能被 workflow debug 与 operator 读面观察。

### 代码范围

优先涉及：

- `apps/server/src/inference/sinks/prisma.ts`
- `apps/server/src/app/services/inference_workflow/snapshots.ts`
- `apps/server/src/app/services/agent.ts`
- 如有必要：相关 API contract / web DTO

### 计划内容

1. 在 `InferenceTrace.context_snapshot` 中新增：
   - `policy_decisions`
   - `overlay_nodes_loaded`
   - `overlay_nodes_mutated`
   - `locked_nodes`
2. 在 `context_module / context_debug` 中增加 overlay/policy 摘要
3. 让 agent overview 可观察：
   - overlay count
   - latest overlay items
   - latest policy denials / locked nodes（轻量摘要即可）
4. 保持现有 workflow trace/detail 契约兼容，不强制前端立即全面改造

### 为什么这一步重要

如果 policy / overlay 只存在于内部逻辑中，后续会出现：

- 无法 debug 为什么某个节点被隐藏
- 无法解释为什么某个 summary 没进 prompt
- 无法判断某个 overlay 是否被载入

所以 trace/debug 面必须同步深化。

---

## 3.5 Phase E：预留 future ContextDirective schema 与拒绝链

### 目标

为未来 Agent 受限上下文控制预留正式落点，但本轮不开放真正的模型自写执行。

### 推荐新增文件

建议新增：

- `apps/server/src/context/directives/types.ts`
- 可选：`apps/server/src/context/directives/policy.ts`

### 首轮内容

1. 定义 `ContextDirective` schema
2. 定义允许的 future directive 类型：
   - `create_self_note`
   - `pin_node`
   - `deprioritize_node`
   - `summarize_cluster`
   - `archive_overlay`
3. 定义拒绝原因结构：
   - `directive_denied_reason`
   - `directive_denied_code`
4. 在 trace 中预留：
   - `submitted_directives`
   - `approved_directives`
   - `denied_directives`

### 范围控制

本阶段只做 schema / trace / deny path 预留：

- 不让模型直接产出后被自动执行
- 不新增真正开放的 API surface
- 不在 inference 主链中默认开启 directive 消费

---

## 3.6 Phase F：测试、回归与文档同步

### 测试建议

#### Unit

1. policy engine 节点等级判定
2. working-set policy decisions
3. overlay materialization
4. overlay lifecycle / persistence mode
5. future directive schema / denial mapping

#### Integration

1. ContextService 在接入 overlay + policy 后仍能生成稳定 `ContextRun`
2. prompt orchestrator-lite 在 policy 上移后行为不回归
3. Death Note semantic path 不因 overlay/policy 深化而中断
4. scheduler 驱动的 inference workflow 不受影响

#### E2E / Regression

至少覆盖：

1. inference trace detail 能看到 policy / overlay 摘要
2. agent overview 在有 overlay 时仍能稳定返回
3. smoke endpoints / workflow replay / scheduler queries 无回归

### 文档同步

建议同步：

- `docs/LOGIC.md`
- `docs/ARCH.md`
- `docs/API.md`
- `TODO.md`
- `记录.md`

尤其要明确：

- policy 已从 fragment-level 向 node-level 深化
- overlay 已成为 kernel-side working-layer object
- 当前仍未进入通用 DAG / plugin runtime / visual editor 阶段

---

## 4. 风险与控制

### 风险 1：Overlay 变成第二套事实系统

影响：

- Source of Truth 与工作笔记边界模糊

控制：

- overlay 永远不覆盖事实源
- overlay 只能通过 source adapter 进入 working set
- trace 中必须保留 overlay provenance

### 风险 2：policy engine 过快变复杂

影响：

- 维护困难
- trace 难解释

控制：

- 首轮只实现最小判定矩阵
- 先覆盖 read/transform/placement/hide 的关键路径
- 逐步深化，不一次性做满

### 风险 3：过早开放 Agent context control

影响：

- 系统规则可能被绕开

控制：

- 先有 policy / overlay，再谈 directives
- 本轮 directives 仅做 schema 和 deny path
- 不开放自动执行

### 风险 4：重复建设工作流引擎

影响：

- 范围膨胀
- 偏离当前目标

控制：

- 所有设计与实现都继续围绕 Context Module MVP 递进
- 不把 DAG / visual editor / plugin runtime 混进本轮实施

---

## 5. 验收标准

本计划实施完成后，应满足：

1. 存在正式 `Context Policy Engine` 最小实现，而不是只靠 fragment metadata 过滤
2. 节点等级（hidden/fixed/flexible/overlay）已经能转化为真实运行时决策
3. 已存在最小 `ContextOverlayEntry` 持久化模型与 overlay source adapter
4. ContextService 可以在 context run 中装配 overlay nodes
5. `InferenceTrace.context_snapshot` 能记录 policy / overlay 摘要
6. 现有 `memory_context` 与 orchestrator-lite 主链保持兼容
7. Death Note、scheduler、workflow debug 链不发生明显回归
8. 文档已明确：当前完成的是 policy / overlay 深化，不是通用工作流引擎阶段

---

## 6. 建议实施顺序

1. 先做 Context Policy Engine 最小版（Phase A）
2. 再把 policy 判定上移到 node-level / working-set（Phase B）
3. 接着实现 Overlay Store 与 overlay source adapter（Phase C）
4. 再把 overlay / policy trace 接入 workflow debug 与 agent overview（Phase D）
5. 最后预留 future directives schema，并补测试/文档（Phase E/F）

这个顺序的优势是：

- 先固定治理规则
- 再引入工作层资产
- 最后再为 future directives 留接口

从而避免出现“overlay 已经能写，但 policy 还没决定谁能动它”的倒挂。

---

## 7. 结论

Context Module MVP 下一步最合理的实施方向，不是去做更大的 workflow engine，而是：

> **先把 policy 提升为 node-level 治理能力，再把 overlay 提升为正式的工作层持久对象，并为 future directives 预留受限执行边界。**

这样可以：

- 真正建立 Context Module 的治理能力
- 提升 Agent 连续主体感的后端基础
- 让未来上下文自主控制有安全落点
- 同时继续保持当前系统复杂度可控

因此，推荐下一阶段的实施主线是：

- `Context Policy Engine`
- `ContextOverlayEntry / Overlay Store`
- `working-set policy 深化`
- `future directives schema + denial trace`

而不是直接跳入通用 DAG / visual editor / plugin runtime 阶段。
