# 核心执行逻辑 / Logic

本文档用于说明 Yidhras 中**业务执行主线、状态转移语义、领域规则与可见性语义**。

> 公共 HTTP contract 见 `API.md` · 系统分层与宿主关系见 `ARCH.md` · 专题细节见 `docs/capabilities/`

## 核心术语

| 术语 | 含义 |
|------|------|
| Actor | 参与推理的主体（agent 或绑定了 identity 的实体） |
| Inference | 从上下文组装到模型调用的推理过程 |
| Intent Grounder | 把模型开放语义映射为系统可执行结果的组件，产出 exact/translated/narrativized/blocked 四类结果 |
| Narrativized fallback | 语义上表现为失败尝试的正式结果，而非简单异常 |
| Overlay | 临时、可写入的上下文补充，不是世界状态的 source-of-truth |
| Memory Block | 可触发（always/keyword/logic/recent-source）的长期记忆片段，触发后物化为上下文节点 |
| Projection | 数据的只读聚合视图（entity overview、pack timeline 等），面向前端/operator |
| Canonical read surface | 稳定的公开只读 API 端点，如 `/api/packs/:packId/overview` |
| Objective enforcement | Rust sidecar 执行的世界规则匹配与状态变更 |
| Action dispatch | 把 grounded intent 落地为客观执行（社交、关系调整、能力调用等） |

## 1. 推理与执行主线

当前 inference / workflow / world enforcement 主线可概括为：

1. `buildInferenceContext()` 组装 actor / identity / pack_state / policy / memory / context_run
2. inference provider 产出 decision 或 intermediate semantic intent
3. `Intent Grounder` 将开放语义映射为：
   - capability execution
   - translated kernel intent
   - narrativized fallback
4. `ActionIntentDraft` 持久化为 `ActionIntent`
5. `ActionDispatcher` / `InvocationDispatcher` / `EnforcementEngine` 落地客观执行
6. `InferenceTrace.context_snapshot` / workflow / audit / projections 提供可观测证据

语义重点：

- provider 不必直接产出最终可执行世界动作
- server-side grounder 负责把开放语义收束到受控执行路径
- workflow 的”技术完成”与语义上的”成功完成”不是同一件事
- 当模型启用 tool calling 时，tool loop 在 grounder 之前执行，允许模型在做出最终决策前收集额外信息（包括跨 agent 查询）

### 1.1 Tool Calling 执行子路径

当 task config 启用 `tool_policy.mode != 'disabled'` 时，推理主线在步骤 2 之后插入 tool loop：

1. provider 返回 `finish_reason='tool_call'` + `tool_calls[]`
2. `ToolLoopRunner` 接管：
   a. 对每个 tool_call 执行 `ToolPermissionPolicy` 校验
   b. `ToolRegistry.execute(name, args)` 执行工具
   c. 将 tool result 以 `role='tool'` 消息追加到对话历史
   d. 重新调用 gateway（携带完整消息历史）
3. 循环直到 `finish_reason='stop'` 或达到 max_rounds/timeout
4. 最终 response 继续进入步骤 3（Intent Grounder）

Cross-agent tool 允许 agent 在 tool loop 中查询另一个 agent 的推理结果，形成结构化的 agent-to-agent 信息交换。

## 2. Intent Grounder 语义

`Intent Grounder` 的核心职责，是把开放语义映射为系统可执行或可叙述的结果。

当前 grounding 结果类别包括：

- `exact`
- `translated`
- `narrativized`
- `blocked`

它们分别意味着：

- `exact`：开放语义可直接映射到既有能力 / 规则路径
- `translated`：原始意图需要先被翻译成受控执行动作
- `narrativized`：不直接执行客观动作，而以叙事失败 / 尝试结果落地
- `blocked`：不允许继续进入执行链

## 3. Narrativized fallback 语义

narrativized fallback 的关键点是：

- workflow 在技术上可能仍然完成
- 但语义结果表现为失败尝试、未达成或被叙事化处理
- 相关证据仍然通过现有 surfaces 可见

当前语义表达方式包括：

- metadata 中的 `semantic_outcome='failed_attempt'`
- `history` event
- workflow / audit evidence
- pack timeline
- entity overview 聚合读面

因此，系统不会把所有未能直接执行的开放语义都粗暴处理为“完全不可见”。

## 4. 事件驱动 world-pack 语义闭环

一个具备 capability、objective enforcement 与事件反馈机制的 world-pack，可以形成最小可重复语义循环。

典型闭环结构如下：

1. actor 先形成开放语义意图或 capability-driven decision
2. intent grounder / dispatcher / enforcement engine 负责把它收束到受控执行路径
3. objective execution 产生世界状态变化与 emitted events
4. emitted events 再通过 scheduler follow-up、memory、workflow evidence 与 projections 回流到下一轮 actor 推理

这意味着系统支持的是一种**事件驱动的连续语义回流**，而不是一次性的静态剧情模板。

在单 world-pack 并发语义下，当前补充边界如下：

- pack 级虚拟时钟仍由 runtime loop 串行推进
- 不同实体的 decision / action workflow 可以受控并发执行
- 同一实体默认保持 single-flight，不并行推进多条 writer workflow
- scheduler 会结合 active workflow、per-tick activation budget 与 periodic cooldown 做前置抑制
- runner 在 claim 成功后仍会再次复核同实体是否已有其他 active workflow

如果某个具体 world-pack 已形成特定题材下的完整闭环，应把这类 pack-specific 语义说明收口在该包目录内，而不是在项目逻辑文档中展开。

## 5. Projection / visibility 语义

当前系统的 projection / visibility 语义可概括为：

### 5.1 pack projection

pack runtime projection 当前覆盖：

- entity overview projection
- pack narrative timeline projection

其可见证据包括：

- entities
- entity states
- authority grants
- mediator bindings
- rule execution records
- event timeline

### 5.2 kernel projection

kernel projection 当前覆盖：

- operator overview projection
- global projection index extraction

### 5.3 canonical read surfaces

当前 canonical 读接口已形成：

- `/api/packs/:packId/overview`
- `/api/packs/:packId/projections/timeline`
- `/api/entities/:id/overview`

语义含义：

- narrative timeline 的 pack 读面已经固定到 pack projection surface
- entity overview 的聚合读面已经固定到 entity-centric surface
- 旧的 `/api/narrative/timeline` 与 `/api/agent/:id/overview` 已退出主调用面

具体世界包如何利用这些可见性读面，应由对应 pack 的文档说明，而不是在项目级逻辑文档中绑定到某个单独题材。

## 6. Context / memory 的业务语义

### 6.1 Context Module 的业务角色

Context Module 的业务意义不是替代世界状态，而是：

- 从多种上下文来源收集候选信息
- 根据 policy / visibility / working set 规则决定最终上下文
- 为下游 inference / prompt 流水线提供结构化输入

### 6.2 overlay 语义

overlay 当前是 kernel-side working-layer object，语义上代表：

- 临时、工作层、可写入的上下文补充
- 不是 pack runtime source-of-truth
- 不直接覆盖世界客观状态

### 6.3 Memory Block 语义

Memory Block Runtime 当前形成最小闭环：

1. `MemoryBlock` 持久化在 kernel Prisma
2. 读取候选块
3. 基于 evaluation context 执行触发判断
4. 更新 runtime state
5. materialize 为 `ContextNode`
6. 经由 prompt 相关路径进入下游消费

触发语义支持：

- `always`
- `keyword`
- `logic`
- `recent_source`

逻辑 DSL 当前支持：

- `and`
- `or`
- `not`
- `eq`
- `in`
- `gt`
- `lt`
- `contains`
- `exists`

### 6.4 recent-source 语义

当前 recent-source 的业务边界：

- 默认按同一 agent 的历史输出筛 recent traces / intents / events
- recent source 在进入 trigger 前必须经过 field-level access policy 裁剪
- 当前 memory resource actions：
  - `read_recent_trace`
  - `read_recent_intent`
  - `read_recent_event`

## 7. Context trace observability 语义

当前 `InferenceTrace.context_snapshot` 已增强为同时承载：

- `context_run`
- `context_module`
- `context_debug`
- `memory_context`
- `memory_selection`
- `prompt_workflow`
- `prompt_processing_trace`
- `memory_blocks`

其业务意义是：

- 不只记录“模型最后看到了什么文本”
- 还记录“系统为什么选择这些上下文、如何组织、哪些内容被裁剪或保留”

这为调试、回放、验收与后续解释提供了连续读面。

## 8. AI task / gateway 的业务语义边界

从业务语义上，AI gateway 是内部执行底座与观测层，而非正式公开的 provider-specific contract。当前对外只稳定承诺 `mock | rule_based`；`model_routed` 为内部 / 受控能力。

Tool calling 使模型能够在单次推理中进行多轮工具调用（包括跨 agent 查询），但它属于 host-side 受控执行能力，不作为对外公开 contract。Tool loop 由 `ToolLoopRunner` 驱动，受 `ToolPermissionPolicy` 约束，模型无法绕过权限校验或无限循环。

完整分层与 public boundary 说明见 → [`AI_GATEWAY.md`](capabilities/AI_GATEWAY.md)

## 9. Prompt Workflow 与 Plugin Runtime 的专题说明

以下两类高耦合主题已拆到专题文档：

- Prompt Workflow Runtime -> `docs/capabilities/PROMPT_WORKFLOW.md`
- Pack-local Plugin Runtime -> `docs/capabilities/PLUGIN_RUNTIME.md`

在 Logic 中只保留其业务语义结论：

- Prompt Workflow 决定上下文如何被组织为模型可消费结构
- Plugin Runtime 决定插件能力如何在受控治理前提下进入系统执行与前端承接

## 10. 当前业务语义结论

当前可以认为稳定成立的业务语义包括：

1. 开放语义必须经由 grounder 收束到受控执行结果
2. narrativized fallback 是正式语义结果，而不是简单异常分支
3. 事件 / workflow / projection / audit 共同构成连续可观察语义链
4. overlay / memory block 属于工作层语义，不替代世界客观状态
5. canonical pack/entity read surfaces 已形成

## 11. Operator-Subject 权限语义

Operator-Subject 统一权限模型将人类操作员作为一等 subject 融入现有 capability/authority 体系。

### 11.1 Pack Access (L1)

Operator 必须通过 `OperatorPackBinding` 显式绑定到 Pack 才能访问其资源。root 操作员不自动拥有所有 Pack 访问权 — 必须有显式绑定记录以确保审计可追溯。

### 11.2 Subject 解析

Operator 操作 Agent 时，系统通过 `resolveSubjectForOperator()` 解析为对应 subject entity：

1. 显式指定 `targetAgentId` → 检查 Operator 是否绑定该 Agent
2. 若未指定 → 使用 Operator 在该 Pack 中的默认 Agent 绑定
3. 无任何绑定 → 回退到 Operator 自身的 `identity_id`

Agent 自主行为时，通过 `resolveSubjectForAgentAction()` 查找控制 Operator：若存在 type='user' 的 IdentityNodeBinding → 以 Operator identity 校验 capability；否则以 agent 自身为 subject（纯 NPC）。

### 11.3 OperatorGrant 临时委托

Operator 可将 capability 临时委托给其他 identity（Operator 或 Agent），支持：
- TTL（`expires_at`）：委托过期后自动失效
- 不可转授（`revocable`）：默认 true，委托不可被接收方再次转授
- 作用域（`scope_json`）：限制委托的 target entity 范围

### 11.4 Agent 自主行为权限

Agent 自主产生的 ActionIntent 不再自动视为 root：
- Scheduler 驱动 Agent 产生 ActionIntent 时，`invocation_dispatcher` 调用 `resolveSubjectForAgentAction` 解析 subject
- 若 Agent 有控制 Operator → 以 Operator identity 校验 capability
- 若为纯 NPC → 以 agent 自身为 subject
- Capability 拒绝时 ActionIntent 状态变为 `dropped`，记录 `drop_reason='CAPABILITY_DENIED'`
- 同一 tick 内同一 agent 的 subject 解析结果被缓存，避免重复查询 `IdentityNodeBinding`

---

## 12. 相关文档

- 系统边界：`ARCH.md`
- 公共接口：`API.md`
- Prompt Workflow：`docs/capabilities/PROMPT_WORKFLOW.md`
- AI Gateway：`docs/capabilities/AI_GATEWAY.md`
- Plugin Runtime：`docs/capabilities/PLUGIN_RUNTIME.md`
