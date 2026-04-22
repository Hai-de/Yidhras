# Context Module policy / overlay 深化设计

## 1. 背景

当前项目已经完成了 **Context Module MVP** 的第一阶段落地，现状包括：

- 已存在正式 `context/` 模块：
  - `ContextNode`
  - `ContextRun`
  - `ContextService`
  - `Context Orchestrator Lite`
- inference 上下文已改为：
  - 先通过 `ContextService.buildContextRun(...)` 生成统一上下文节点集合
  - 再向下派生 legacy `memory_context`
- 当前 `InferenceTrace.context_snapshot` 已能记录：
  - `context_run`
  - `context_module`
  - `context_debug`
  - `prompt_processing_trace`
  - `prompt_assembly`
- 当前 prompt 主线已通过线性 orchestrator-lite 收口：
  - `memory_injection`
  - `policy_filter`
  - `summary_compaction`
  - `token_budget_trim`

这说明系统已经有了“上下文模块”与“最小编排器”的基础宿主。

但当前 Context Module 仍然只是第一阶段：

- `visibility / mutability / placement` 目前主要是**描述性 metadata**
- 当前真正的拦截规则仍主要停留在：
  - `policy_gate === 'deny'`
  - fragment-level filtering
- 当前并不存在正式的 overlay 持久化子系统
- 当前也没有正式的 context policy engine 来处理：
  - read / reference / summarize / reorder / hide / pin / delete
- 当前尚未形成 Agent-owned notes / dossier / hypothesis / reminder 等 overlay 结构
- 当前未来要用到的 `ContextDirective` 仍只是长期概念，还没有设计到可落地的数据与权限边界

因此，需要在 MVP 之上进入下一层设计：

> **把 Context Module 从“统一节点 + 线性编排”提升为“具备明确 policy / overlay 边界的上下文治理模块”。**

---

## 2. 当前问题

## 2.1 节点等级已命名，但尚未形成真正治理模型

当前代码中已有：

- `hidden_mandatory`
- `visible_fixed`
- `visible_flexible`
- `writable_overlay`

以及：

- `immutable`
- `fixed`
- `flexible`
- `overlay`

但这些字段当前更多承担的是：

- 静态标签
- trace/debug 语义
- 未来边界预留

而不是完整的运行时决策机制。

## 2.2 当前 policy 仍偏 fragment 级，而非 node / working-set 级

当前 `policy_filter` 仍以 fragment 为操作对象，并根据：

- `metadata.policy_gate`
- `metadata.visibility_blocked`

进行过滤。

这意味着：

- policy 还没有真正上移到 `ContextNode` / `ContextRun` / working-set selection
- 还无法正式表达：
  - 这个节点能不能被总结
  - 这个节点能不能被降权
  - 这个节点能不能临时隐藏
  - 这个节点能不能被排序移动

## 2.3 Overlay 还没有正式建模

当前系统虽已允许“manual / summary-like”材料作为 memory 来源存在，但没有正式 overlay 概念去表达：

- agent private self note
- target dossier
- hypothesis / suspicion board
- reminder / plan fragment
- system-generated but actor-owned summary

而这些恰恰是未来 Agent 连续主体感最重要的结构。

## 2.4 未来 Agent 的上下文控制仍缺少治理边界

之前的长期设计已经指出：

- Agent 可以有上下文意志
- 但不能拥有上下文主权

要做到这一点，必须先定义：

- 哪些节点是 source of truth
- 哪些节点是 working set
- 哪些节点是 overlay
- 哪些操作属于建议
- 哪些操作属于受限允许
- 哪些操作永远禁止

目前这套边界尚未固化为正式设计。

---

## 3. 目标

### 3.1 核心目标

本设计希望在 Context Module MVP 基础上，新增以下正式能力：

1. 引入正式 `Context Policy Engine` 概念
2. 将现有 `visibility / mutability / placement` 从描述性 metadata 升级为运行时治理输入
3. 引入正式 `ContextOverlay` 模型，用于承载 agent-owned / system-generated overlay 信息
4. 明确 source of truth / working set / overlay 三者关系
5. 为未来 `ContextDirective` 建立受限执行边界
6. 让 trace / audit / workflow 读面能清晰解释 policy 与 overlay 的作用结果
7. 保持当前 MVP 的渐进演化特征，不直接跳入通用 DAG / 可视化工作流平台

### 3.2 非目标

当前设计**不**直接要求：

- 完整实现 Agent 自主 context directives
- 引入通用可配置 DAG 工作流引擎
- 前端节点编辑器
- 插件执行运行时
- 一次性完成所有细粒度权限矩阵落地
- 将所有上下文对象持久化为复杂图数据库结构

这是一份 **policy / overlay 深化设计**，不是完整下一轮实现计划本身。

---

## 4. 设计原则

## 4.1 Source of Truth 不可被 Agent 直接修改

必须继续坚持：

- 事件
- pack/world state
- rule execution evidence
- system guardrails
- constitution / bias anchors

这些都是事实源，不属于 Agent 可直接编辑对象。

## 4.2 Overlay 是 Agent 的工作层，而不是事实层

Overlay 的职责是：

- 承载 Agent 的私有工作笔记
- 承载系统为 Agent 生成的压缩摘要
- 承载目标 dossier / hypothesis / reminder

Overlay 只能影响：

- 下一轮上下文工作集
- 提示词组织方式
- 自我反思与策略连续性

不能反向覆盖事实源。

## 4.3 Policy 必须作用于“节点”和“操作”，而不是只作用于字段可见性

当前最重要的扩展是：

> **从“这个字段看不看得到”，升级到“这个节点能不能被怎么操作”。**

## 4.4 Agent 未来只能提交请求，不直接改 prompt

后续若开放 `ContextDirective`，其路径必须是：

1. Agent 产出 request
2. policy engine 校验
3. overlay / working-set 更新
4. orchestrator 消费结果

而不是：

- Agent 直接删除某个系统节点
- Agent 直接修改 prompt slot 顺序
- Agent 直接覆盖某个固定锚点

## 4.5 一切 policy / overlay 操作都必须可解释

trace 中必须能解释：

- 哪个节点被隐藏
- 哪个节点被禁止移动
- 哪个 overlay 被载入
- 哪个 directive 被拒绝
- 最终 prompt 为什么这样组装

---

## 5. 三层模型：Facts / Working Set / Overlay

建议正式引入以下三层心智模型。

## 5.1 Layer A：Source of Truth

包括：

- `Event`
- `Post`
- `InferenceTrace`
- `DecisionJob`
- `ActionIntent`
- pack/world/entity state
- authority / mediator / rule execution
- constitution / immutable system nodes

特点：

- 由系统或世界产生
- 不允许 Agent 直接改写
- 作为 context source adapters 的输入材料

## 5.2 Layer B：Context Working Set

包括：

- 本轮选中的上下文节点集合
- 经 policy / relevance / budget / summary 处理后的节点子集
- 其最终输出为 prompt fragments

特点：

- 每轮动态生成
- 可被策略、预算、总结、排序影响
- 不直接代表持久事实

## 5.3 Layer C：Overlay

包括：

- self note
- dossier
- suspicion board
- reminder
- system-generated actor-owned summaries

特点：

- 作为持久或半持久的“工作层资产”存在
- 可以被系统或未来 Agent 受限创建
- 会在下一轮通过 source adapter 重新 materialize 成 ContextNode

---

## 6. Policy 模型深化

## 6.1 建议正式区分三种 policy 维度

### A. Visibility Policy
回答：

- 这个节点看不看得到？
- 是完全不可见，还是只知道存在，还是可读内容？

### B. Operation Policy
回答：

- 这个节点能不能被：
  - summarize
  - reorder
  - hide
  - pin
  - reference
  - transform

### C. Placement Policy
回答：

- 这个节点应进入哪个 slot？
- 能不能改 slot？
- 是否锁定位置？

## 6.2 建议的节点等级语义正式化

### 1）`hidden_mandatory`

适用对象：

- system hidden guardrails
- hidden provider constraints
- 内部系统裁剪规则

语义：

- Agent 不可见
- 不能被引用
- 不能被隐藏
- 不能被移动
- 可参与最终 prompt
- 通常由系统固定插入

### 2）`visible_fixed`

适用对象：

- 人格锚点
- bias anchor
- constitution summary
- 核心身份设定
- 某些 pack rule anchors

语义：

- Agent 可见
- 可引用
- 通常可被总结但不可删除
- 不可随意改 slot
- 不可被 hide/deprioritize 为 0

### 3）`visible_flexible`

适用对象：

- recent events
- recent traces
- recent posts
- pack/world state snapshots
- system-generated transient summaries

语义：

- Agent 可见
- 可被排序
- 可被压缩
- 可被本轮或下轮降权/隐藏
- 不能篡改其事实内容

### 4）`writable_overlay`

适用对象：

- self note
- target dossier
- reminder
- hypothesis

语义：

- Agent 可见
- 可由 Agent 或系统创建
- 允许修改/归档/删除
- 不直接等同事实源

## 6.3 建议正式拆分的操作权限

### Read
- `visible`
- `exists_only`
- `hidden`

### Reference
- `allow_reference`
- `allow_implicit_summary_only`
- `deny_reference`

### Transform
- `allow_summarize`
- `allow_compress`
- `allow_regex_clean`
- `deny_transform`

### Placement
- `locked_slot`
- `preferred_slot`
- `movable_within_tier`
- `fully_movable`

### Lifecycle
- `persist_required`
- `hide_allowed_current_run`
- `hide_allowed_next_run`
- `delete_allowed`
- `archive_only`

---

## 7. 建议引入 Context Policy Engine

## 7.1 模块职责

建议新增正式模块：

- `apps/server/src/context/policy_engine.ts`

其职责不是“替代 orchestrator”，而是：

> **为 context nodes 与 future directives 提供统一的 policy 判断。**

## 7.2 输入

建议输入至少包括：

- `ContextNode[]`
- actor identity / role
- pack id
- policy summary
- optional overlay state
- optional directive requests

## 7.3 输出

建议输出至少包括：

- allowed visible nodes
- hidden nodes
- nodes blocked from transform
- nodes blocked from movement
- directive approvals / denials
- structured reason codes

## 7.4 执行阶段建议

建议 policy engine 在 Context Module 内部至少作用于三个阶段：

### Stage 1：Node Admission
- 某节点是否进入 working set 候选

### Stage 2：Node Operation Guard
- 某节点是否允许被 summarize/reorder/hide

### Stage 3：Placement Guard
- 某节点是否允许被移动到别的 slot/tier

---

## 8. Overlay 子系统设计

## 8.1 为什么 Overlay 必须单独建模

如果 overlay 不单独建模，而只是混进 memory entries，会带来问题：

- 无法区分“系统事实”与“Agent 工作笔记”
- 无法定义持久/临时生命周期
- 无法定义 owner
- 无法表达 future directives 对 overlay 的增删改

所以建议正式引入：

> **ContextOverlay 作为独立持久层对象，再通过 source adapter 转成 ContextNode。**

## 8.2 建议的数据结构

```ts
interface ContextOverlayEntry {
  id: string;
  actor_id: string;
  pack_id: string | null;
  overlay_type:
    | 'self_note'
    | 'target_dossier'
    | 'hypothesis'
    | 'reminder'
    | 'system_summary';
  title?: string | null;
  content_text: string;
  content_structured?: Record<string, unknown> | null;
  tags: string[];
  status: 'active' | 'archived' | 'deleted';
  persistence_mode: 'run_local' | 'sticky' | 'persistent';
  source_node_ids?: string[];
  created_by: 'system' | 'agent';
  created_at_tick: string;
  updated_at_tick: string;
}
```

## 8.3 Overlay 的 ownership 建议

建议 overlay 保持在 **kernel-side**，而不是 pack runtime。

原因：

- overlay 更接近 inference / workflow / actor memory 工作层
- 它不是 pack-governance core state
- 它服务于推理与上下文组织，而不是世界客观状态

## 8.4 Overlay 的 materialization 路径

建议：

1. overlay store 持久化 `ContextOverlayEntry`
2. overlay source adapter 每轮读取相关 overlay
3. materialize 为 `ContextNode(scope='agent' | 'system', level='writable_overlay')`
4. 进入 policy / selection / orchestration 主线

## 8.5 Overlay 的生命周期建议

### `run_local`
- 只对当前/下一轮短期有用
- 可快速过期

### `sticky`
- 应在若干轮中保留
- 如怀疑对象 dossier

### `persistent`
- 长期保留，直到显式归档或删除
- 如 Agent 长期使命总结

---

## 9. 与 future ContextDirective 的关系

本设计不直接实现 directives，但必须为其铺路。

## 9.1 建议的最小指令类型

未来建议只在 policy / overlay 完成后，开放有限类型：

- `create_self_note`
- `pin_node`
- `deprioritize_node`
- `summarize_cluster`
- `archive_overlay`

## 9.2 建议的拒绝原则

以下操作默认拒绝：

- 删除 `hidden_mandatory`
- 重排 `visible_fixed` 的核心 system slot
- 修改任何 source-of-truth node 内容
- 让 Agent 隐藏对其必须生效的 system guard node
- 覆盖 constitution / bias anchors

## 9.3 建议的 trace 结构

未来若 directives 落地，trace 中至少应记录：

- submitted directives
- approved directives
- denied directives
- denial reason codes
- resulting overlay mutations

---

## 10. Trace / Audit / Workflow Debug 的深化方向

## 10.1 当前已具备的基础

当前 `InferenceTrace.context_snapshot` 已有：

- `context_module`
- `context_debug`
- `selected_node_summaries`
- `dropped_nodes`
- `prompt_assembly`

## 10.2 后续建议新增的 policy / overlay trace

建议未来增加：

- `policy_decisions[]`
- `locked_nodes[]`
- `overlay_nodes_loaded[]`
- `overlay_nodes_mutated[]`
- `directive_decisions[]`

## 10.3 读面建议

后续 workflow debug / agent overview 可以直接消费：

- overlay count / latest overlay items
- policy denials
- fixed nodes present in prompt
- hidden mandatory node count

---

## 11. 演进建议

## Phase A：Policy Engine 最小版

目标：

- 将当前 `policy_gate === deny` 的过滤逻辑正式上移到 node-level policy engine
- 对固定/隐藏/灵活节点形成统一判定结果

验收：

- fragment 过滤不再只是散落在 `policy_filter`
- trace 中能看到 node-level policy decisions

## Phase B：Overlay Store 最小版

目标：

- 引入 `ContextOverlayEntry`
- 允许系统侧生成并持久化少量 overlay

验收：

- overlay source adapter 能把 overlay materialize 为 ContextNode
- context snapshot 能看到 overlay nodes

## Phase C：Working Set Policy 深化

目标：

- 将 summarize / reorder / hide / pin 等操作约束正式纳入 policy engine

验收：

- 节点操作不再只靠约定，而有明确 allow/deny 结构

## Phase D：Future Directives 接口准备

目标：

- 预留 `ContextDirective` schema
- 系统能记录并拒绝非法 directive request

验收：

- future Agent context control 有稳定落点

---

## 12. 风险与控制

### 风险 1：Overlay 变成第二套事实系统

影响：
- 事实与工作笔记边界混乱

控制：
- Overlay 永远不覆盖 source of truth
- overlay 只通过 adapter 进入 working set

### 风险 2：Policy 复杂度过快膨胀

影响：
- 系统难维护
- trace 难解释

控制：
- 先固化 4 类节点等级
- 先做少量操作维度
- 逐步深化矩阵

### 风险 3：Agent 未来获得过多上下文权力

影响：
- 系统规则被绕开

控制：
- 先有 policy / overlay，再谈 directives
- 所有 future directives 都只能通过 policy engine 生效

### 风险 4：重复建设 workflow engine

影响：
- 与当前 MVP 路线冲突

控制：
- 本设计只深化 policy / overlay
- 不把 DAG / plugin runtime / editor 混进当前阶段

---

## 13. 结论

当前 Context Module MVP 已经解决了：

- 统一节点模型的起点
- context builder 的正式边界
- orchestrator-lite 的第一版落地
- trace 诊断的基本可视化基础

下一步最值得推进的，不是立刻冲向通用工作流引擎，而是：

> **补上 Context Policy Engine 与 ContextOverlay 子系统，让“节点可被如何操作”与“Agent 拥有哪些工作层资产”拥有正式的治理边界。**

也就是说，建议下一阶段主线是：

- 先把 policy 从 fragment-level 提升到 node-level
- 先把 overlay 从临时 memory 材料提升为正式持久化对象
- 再为 future directives 留执行入口

这样可以在不引入通用 DAG/可视化平台的前提下，真正把 Context Module 从“可运行的 MVP”推进为“可治理、可扩展、可持续演化的上下文系统”。