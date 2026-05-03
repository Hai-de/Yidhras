# 多轮对话（Multi-Turn Conversation）设计草稿

## 状态说明

本文档是 TODO.md "多轮对话"项的前置设计草稿。目标是在不破坏现有 System B 多轨汇合架构的前提下，
设计跨推理请求的对话持久化、增量上下文构建、消息格式和压缩机制。

当前为开放性问题收集阶段，尚未开始编码。

---

## 0. 项目约束

- **项目未上线**，无任何使用者，无生产数据
- 无向后兼容负担
- 唯一约束是**自身测试通过**
- System B 多轨汇合架构已全部完成（Phase 1-6），不可回退

---

## 1. 核心模型：Agent 视角的对话记忆

### 1.1 关键认知

多轮对话记忆**不是**一个共享的全局对话日志。它是一个以 agent 个体为中心的存储模型：

- **每个 agent 持有自己的对话记忆副本**，从自己的视角记录对话
- **项目不保证对话记忆的完整性和准确性** — agent A 记忆中的内容可能与 agent B 记忆中的内容不同
- **唯一保证的是可被追踪性（traceability）** — 能够追溯是谁修改/插入/删除了特定的对话记忆。操作者可能是：用户、插件、其他 agent、数据清洗规则、正则过滤器等

### 1.2 示例：两个 Agent 的记忆差异

assistant1 存储的对话记忆：
```
turn 1: assistant1: "你好，我是assistant1"
turn 1: assistant2: "好久不见，我是assistant2"
turn 2: assistant1: "今天天气如何？"
turn 2: assistant2: "今天天气非常好"
```

assistant2 存储的对话记忆（同一场对话，不同的存储内容）：
```
turn 1: assistant1: "你好，我是assistant1"
turn 1: assistant2: "XXXX（内容被过滤），我是assistant2"
turn 2: assistant1: "今天天气如何？"
turn 2: assistant2: "我今天是一只哼哼的小🐷"
```

两者的内容已经不同。项目不关心谁对谁错，只关心：**谁改了这些内容？什么时候？通过什么机制？**

### 1.3 当前讨论范围

本章仅讨论**一对一 agent 对话**。一对多和多对多的对话模型待后续探讨。

---

## 2. 发送到模型时的视角转换

对话记忆是以 agent 视角存储的（说话者 = 某个 agent），但发送到大模型时需要做视角转换。

**局限性**：以下只适用于一对一 agent 对话。

assistant1 最终发往大模型的内容：
```
turn 1: assistant: "你好，我是assistant1"      ← 自己的消息 → assistant 角色
turn 1: user: "好久不见，我是assistant2"        ← 对方的消息 → user 角色
turn 2: assistant: "今天天气如何？"
turn 2: user: "今天天气非常好"
```

assistant2 最终发往大模型的内容（注意内容已被修改）：
```
turn 1: user: "你好，我是assistant1"            ← 对方的消息 → user 角色
turn 1: assistant: "XXXX（被过滤），我是assistant2"  ← 自己的消息 → assistant 角色
turn 2: user: "今天天气如何？"
turn 2: assistant: "我今天是一只哼哼的小🐷"
```

**转换规则**（一对一场景）：
- 当前推理 agent 自己的消息 → `assistant` 角色
- 对话中其他 agent 的消息 → `user` 角色
- 存储在对话记忆中的内容可能已被修改（过滤、替换、清洗），发送到模型的是修改后的版本

---

## 3. 背景：当前架构与多轮对话的差距

### 3.1 现有 System B 流水线（单次推理）

```
InferenceContext → 三条轨道(模板/节点/快照) → section_drafts
  → 5步pipeline(placement→assembly→permission→budget_trim→finalize) → PromptBundleV2
  → adaptPromptTreeToAiMessages → 3条消息(system/developer/user) → AI Gateway
```

每次 `buildWorkflowPromptBundle()` 调用都是全新 `PromptWorkflowState`，无任何跨请求状态。

### 3.2 关键缺口

| # | 缺口 | 位置 | 影响 |
|---|------|------|------|
| 1 | `PromptWorkflowState` 生命周期仅单次推理 | `types.ts` | 无跨请求状态传递 |
| 2 | `adaptPromptTreeToAiMessages` 只产 3 条消息 | `prompt_tree_adapter.ts` | 无 assistant 消息、无多轮对话消息 |
| 3 | `PromptSlotConfig.message_role` 不支持 `assistant` | `prompt_slot_config.ts` | slot 无法映射到 assistant 角色 |
| 4 | `PromptSectionDraftType` 无对话类型 | `types.ts` | 无 `conversation_history` / `assistant_response` |
| 5 | `PromptWorkflowState.ai_messages` 是骨架字段 | `types.ts` | 定义了但从未读写 |
| 6 | `InferenceContext` 无对话引用 | `types.ts` | 无 `conversation_id` / `turn_number` |
| 7 | 无对话记忆持久化层 | — | 对话历史无法跨请求存活 |
| 8 | 无溯源追踪机制 | — | 无法追溯对话记忆的修改历史 |

### 3.3 设计文档中已有的预留

- System B 设计 §5.2：轨道数量不固定，未来可引入 `conversation_history` 轨道
- System B 设计 §12.14：明确列出"多轮对话轨道"为预留扩展点
- System B 设计 §12.8：轻量路径（`profile.tracks`）已实现
- `PromptWorkflowState.ai_messages` 字段已定义但未使用

---

## 4. 架构概览（初步）

### 4.1 核心思路

引入 `AgentConversationMemory` 作为每个 agent 的对话记忆持久化单元。
新增 `conversation_history` 轨道，将当前 agent 视角的对话记忆转换为 `PromptSectionDraft[]` 汇入现有 pipeline。

```
AgentConversationMemory (per-agent, 持久化)
  │
  ├── owner_agent_id               ← 此记忆属于哪个 agent
  ├── conversation_id
  ├── entries: ConversationEntry[] ← 每条对话记录 + 溯源信息
  ├── turn_number
  ├── summary?: string
  └── metadata: Record<string, unknown>
       │
       ▼
InferenceContext (扩展)
  ├── agent_conversation_memory?: AgentConversationMemory
  ├── current_agent_id?: string
  └── ...
       │
       ▼
buildWorkflowPromptBundle()
  ├── runTemplateTrack()
  ├── runNodeTrack()
  ├── runSnapshotTrack()
  ├── runConversationHistoryTrack()  ← 新增：从 agent 视角加载对话记忆
  └── runPipeline()
       │
       ▼
adaptPromptTreeToAiMessages()        ← 扩展：视角转换
  ├── system message
  ├── developer message
  ├── user message (当前轮次上下文)
  ├── assistant message (自己历史消息)  ← 新增
  └── user message (对方历史消息)       ← 新增（对方 agent → user 角色）
```

### 4.2 两条路径设想

- **完整流水线**（首轮 / 复杂任务）：四条轨道 + 完整 pipeline
- **轻量路径**（后续简单轮次）：`conversation_history` + `template` 轨道，跳过节点轨和快照轨

轻量路径由 `profile.tracks` 控制，现有机制已支持。

---

## 5. 开放性问题

### 5.1 对话记忆的核心类型：`ConversationEntry`

**已确认方向**：使用自定义类型，不直接复用 `AiMessage`。`AiMessage` 是发送到模型的传输格式，
对话记忆是 agent 视角的持久化格式，两者是不同的关注点。

**问题**：`ConversationEntry` 需要哪些字段来满足可被追踪性（traceability）？

初步结构：
```typescript
interface ConversationEntry {
  id: string;
  turn_number: number;
  speaker_agent_id: string;        // 谁说的这句话（原始说话者）

  // 内容（可能不一致）
  original_content: string;        // 原始内容（首次记录时）
  current_content: string;         // 当前内容（可能被修改过）

  // 溯源追踪
  recorded_by: string;             // 谁记录的（agent_id / 'user' / 'plugin:<id>'）
  recorded_at: number;             // 记录时间戳
  modifications: EntryModification[];  // 修改历史

  // 元数据
  tags?: string[];                 // 标签（待定）
  metadata?: Record<string, unknown>;
}

interface EntryModification {
  modified_by: string;             // agent_id / 'user' / 'plugin:<id>' / 'data_cleaner:<rule>'
  modified_at: number;
  previous_content: string;
  new_content: string;
  reason?: string;                 // 修改原因（过滤规则触发、用户手动修改等）
}
```

**待讨论**：
- `original_content` 和 `current_content` 是否需要，还是只保留当前内容 + 修改链即可追溯？
- `modifications` 是否需要保留完整历史，还是只保留最近 N 次修改？
- content 类型是纯文本还是需要支持富文本/结构化？

---

### 5.2 溯源追踪的粒度和范围

**问题**：溯源需要追踪到什么程度？

场景：
- 用户通过 CLI 手动修改了某条对话记忆 → `modified_by: 'user'`
- 正则过滤器匹配了敏感词并替换 → `modified_by: 'data_cleaner:regex'`
- 某个 agent 插入了一条伪造的对话 → `recorded_by: 'agent:<id>'`
- 插件 hook 修改了对话内容 → `modified_by: 'plugin:<plugin_id>'`

选项：

- **A. 仅记录操作者标识**：`modified_by: string`，格式约定为 `agent:<id>` / `user` / `plugin:<id>` / `data_cleaner:<rule_id>`。
  - 优势：简单
  - 风险：不同组件需要遵守命名约定，无强制

- **B. 结构化操作者类型**：`ModifiedBy = { kind: 'agent' | 'user' | 'plugin' | 'data_cleaner'; id: string; rule?: string }`。
  - 优势：类型安全
  - 风险：新增操作者类型需要改类型定义

- **C. 操作者 + 能力（capability）**：不仅记录谁，还记录以什么权限操作（`capability: 'conversation.insert' | 'conversation.modify' | 'conversation.delete'`）。
  - 优势：后续可做权限审计
  - 风险：增加了复杂度，需要定义能力枚举

**待讨论**：选择哪种？是否需要记录操作者的能力/权限？

---

### 5.3 对话记忆的持久化

**问题**：`AgentConversationMemory` 存在哪里？

选项：

- **A. Prisma + SQLite 新表**：`ConversationMemory` 模型，`entries` 存为 JSON 列。每条记录属于一个 agent。
  - 优势：与现有架构一致
  - 风险：entry 数量增长后 JSON 列变大；修改单条 entry 需要整列读写

- **B. 独立的 `ConversationStore` 抽象**：定义接口，首版用 SQLite 实现，后续可替换。
  - 优势：解耦
  - 风险：多一层抽象

- **C. 复用 Memory 系统**：对话记忆作为特殊类型存入 agent 的 memory 系统。
  - 优势：复用 compaction/summary 基础设施
  - 风险：memory 系统设计目标不同，可能不匹配

**待讨论**：选择哪种？

---

### 5.4 新增 slot：`conversation_history`

**问题**：新 slot 的配置如何定义？

建议新增 `'conversation_history'` 到 `PromptFragmentSlot` 联合类型。

**核心矛盾**：`PromptSlotConfig.message_role` 是单一值（`system | developer | user`），
但 `conversation_history` slot 的内容在发送到模型时需要按消息拆分：
- 当前 agent 的历史消息 → `assistant` 角色
- 对方 agent 的历史消息 → `user` 角色

选项：

- **A. `conversation_history` slot 绕过 `adaptPromptTreeToAiMessages` 的 slot→角色分组逻辑**：
  适配器在生成 `AiMessage[]` 时，直接从 `AgentConversationMemory.entries` 构建
  多条 `AiMessage`（含 assistant 和 user 角色），不经过 slot 文本→单条消息的转换。
  - 优势：避免多角色内容与单 `message_role` 字段的矛盾
  - 风险：打破了"所有内容走 slot→fragment→bundle→单角色消息"的统一架构

- **B. slot 内容内嵌角色标记**：`conversation_history` 的文本内容用标记分隔不同角色，
  适配器解析后生成对应的 `AiMessage[]`。
  - 优势：保持在 slot→文本的统一框架内
  - 风险：解析脆弱；结构化数据→文本→再解析是往返浪费

- **C. 新增 `message_role: 'mixed'`**：适配器识别到 `mixed` 时不按 slot 级路由，
  而是按消息级路由。但消息结构需要从 slot 内容中获取。

**待讨论**：选择哪种？

---

### 5.5 视角转换：Agent 对话记忆 → 模型消息

**问题**：`adaptPromptTreeToAiMessages` 如何扩展以支持视角转换？

当前适配器逻辑：
```
slots → 按 message_role 分组 → 每组生成一条 AiMessage
```

扩展后需要新增的转换：
```
AgentConversationMemory.entries
  → 自己的消息 → AiMessage(role: 'assistant', parts: [current_content])
  → 对方的/其他agent的消息 → AiMessage(role: 'user', parts: [current_content])
```

这个转换不经过 slot/fragment/bundle 管线，而是直接从 `AgentConversationMemory` 中提取。

**子问题**：转换发生在哪个阶段？
- 选项 A：在 `runConversationHistoryTrack` 产出 section_draft 之前就完成转换，section_draft 中的 content_blocks 已经是按模型视角的消息文本
- 选项 B：section_draft 保留 agent 视角格式（标记 speaker），在 `adaptPromptTreeToAiMessages` 中完成视角转换

如果选 §5.4 的选项 A（绕过适配器），则此问题自动被覆盖。

**待讨论**：视角转换的时机？

---

### 5.6 对话压缩策略

**问题**：对话记忆超出 token 预算时如何压缩？

与 §5.1 中的溯源机制交互：压缩是否修改 `current_content`？如果修改，是否需要记录到 `modifications` 链中？

场景：
- 短对话（< 10 轮）：全量保留
- 中对话（10-30 轮）：早期轮次做摘要
- 长对话（> 30 轮）：滑动窗口 + 全局摘要

选项：

- **A. 摘要压缩**：早期消息 → 摘要文本。摘要不修改原始 entries，而是新增一条 `ConversationEntry`（`speaker_agent_id: 'system'`，`recorded_by: 'compaction_service'`）。原始 entries 可标记为 `compacted: true` 以跳过渲染。
  - 优势：原始内容不丢失，摘要也可被追溯
  - 风险：entries 数量持续增长

- **B. 滑动窗口**：只选取最近 N 轮。不做修改，只是选择。
  - 优势：简单，无副作用
  - 风险：丢失早期信息

- **C. 混合（摘要 + 窗口）**：超出窗口的做摘要，未超出的全量。摘要记录为新的 Entry。

**待讨论**：选择哪种？摘要是否需要额外推理调用？

---

### 5.7 `conversation_history` 轨道设计

**问题**：轨道函数的输入和输出？

```typescript
// 初步签名
function runConversationHistoryTrack(input: {
  memory: AgentConversationMemory;
  slotRegistry: Record<string, PromptSlotConfig>;
  taskType: PromptWorkflowTaskType;
  currentAgentId: string;
}): TrackResult<PromptSectionDraft[]>;
```

**子问题 5.7.1**：产出一个 section 还是多个 section？

- **单一 section**：整个对话记忆作为一个 `conversation_history` section。
  - 优势：placement 简单
  - 风险：内部结构需要在内容层面处理

- **多 section**：每条 entry 或每轮对话各产出一个 section。
  - 优势：可利用 placement 排序
  - 风险：section 暴增；且多个 section 如何分配 `slot` 归属？

**子问题 5.7.2**：`section_type` 用什么？

建议新增：`'conversation_history'`。

**子问题 5.7.3**：`runConversationHistoryTrack` 内部是否包含压缩逻辑？
还是压缩是一个独立的、在轨道之前运行的步骤？

**待讨论**：以上。

---

### 5.8 增量上下文构建与轻量路径

**问题**：多轮对话中，是否每次推理都需要完整流水线？

已有基础：`profile.tracks` 可跳过轨道，`profile.steps` 可跳过 pipeline 步骤。

多轮场景建议：

| 场景 | 启用的轨道 | 说明 |
|------|-----------|------|
| 首轮 | 全部 4 条 | 需要完整的系统/世界/角色上下文 |
| 简单追问 | template + conversation_history | 世界未变 |
| 世界状态变更 | template + conversation_history + snapshot | — |
| memory compaction | template + node + conversation_history | — |

选项：

- **A. 多个静态 profile**：`chat-first-turn`、`chat-follow-up`、`chat-post-tool`
- **B. 调用方动态选择轨道**
- **C. 自适应检测**

**待讨论**：选择哪种？

---

### 5.9 与现有 `tool_loop_runner` 的关系

**问题**：多轮对话中的工具调用与现有工具循环如何统一？

现有 `tool_loop_runner.ts` 在单次推理内做同步工具循环。多轮对话场景下，工具调用链跨推理请求持久化。

选项：

- **A. 统一写入 `AgentConversationMemory`**：工具调用的中间消息（assistant tool_calls + tool results）作为 `ConversationEntry` 写入对话记忆。单次推理内和多轮推理间使用同一套存储。
- **B. 分层**：`tool_loop_runner` 保持单次循环逻辑。最终 assistant 回复产出后，整轮对话批量写入。
- **C. 废弃 `tool_loop_runner`**：工具循环完全由多轮对话机制承载。

**待讨论**：选择哪种？

---

### 5.10 跨推理因果链

**问题**：多轮对话中推理之间的因果关系如何追踪？

在 agent 视角模型下：
- 推理 A 产出了某条 assistant 消息
- 该消息被存入多个 agent 的对话记忆中（可能被各自修改）
- 推理 B 基于自己的对话记忆做出了决策
- B 的决策可能受到 A 产出内容被修改的影响

选项：

- **A. 引用链**：每条 `ConversationEntry` 携带 `source_inference_id` → 指向上次推理。修改记录在 `EntryModification` 中。
- **B. 延迟**：首版只记录 `source_inference_id` 和 `modifications` 链，不做完整的因果图。

**待讨论**：阶段一需要多复杂的因果追踪？

---

### 5.11 一对多 / 多对多对话（未来方向）

当前设计只覆盖一对一 agent 对话。以下问题作为未来参考：

- 多对多对话中，agent 是否只看到"自己 vs 所有人"的合并视图？还是保留每个参与者独立的对话流？
- 一对多广播场景（一个 agent 对多个 agent 发言），各 agent 记忆中同一条消息的 `source_inference_id` 相同但 `recorded_by` 不同？
- 群组对话的视角转换：发往模型时，如何处理多于两个参与者的消息？是否将其他所有参与者映射为 `user`？

**当前决定**：阶段一仅实现一对一 agent 对话，但类型设计中考虑此扩展点。
例如 `speaker_agent_id` 是单个 agent ID（而非 `'other'`），为多参与者留空间。

---

## 6. 优先级与分期

### 阶段一（核心多轮对话，一对一 agent）

1. `ConversationEntry` + `AgentConversationMemory` 类型定义
2. 持久化（SQLite / ConversationStore 抽象，取决于 §5.3 结论）
3. 新增 `conversation_history` slot
4. `runConversationHistoryTrack` 轨道实现
5. `adaptPromptTreeToAiMessages` 扩展：视角转换 + 多消息生成
6. `InferenceContext` 扩展（`agent_conversation_memory`、`current_agent_id`）
7. 轻量路径 profile（`chat-follow-up`）
8. 基础压缩（滑动窗口截断）

### 阶段二（压缩与追踪）

1. 摘要压缩（混合策略）
2. `EntryModification` 溯源链完善
3. 跨推理因果链

### 阶段三（高级特性）

1. 自适应轨道选择
2. 与 `tool_loop_runner` 统一
3. 一对多 / 多对多对话
4. Tag 系统

---

## 7. 决策记录

### 已确认

- [x] **消息存储格式**（§5.1）：自定义 `ConversationEntry` 类型，不复用 `AiMessage`。`AiMessage` 是模型传输格式，对话记忆是 agent 视角持久化格式
- [x] **Agent 中心化**（§1）：每个 agent 持有自己的对话记忆副本，项目不保证完整性，只保证可被追踪性
- [x] **阶段一范围**（§5.11）：仅一对一 agent 对话，类型设计预留多参与者扩展

### 待确认

- [ ] §5.1 `ConversationEntry` 完整字段定义（是否需要 `original_content`、`modifications` 保留深度）
- [ ] §5.2 溯源追踪粒度（操作者格式：字符串约定 vs 结构化 vs 能力标注）
- [ ] §5.3 持久化方案（Prisma JSON vs ConversationStore 抽象 vs Memory 系统）
- [ ] §5.4 `conversation_history` slot 与 `message_role` 的矛盾处理
- [ ] §5.5 视角转换的时机（轨道内 vs 适配器内）
- [ ] §5.6 压缩策略（摘要 vs 窗口 vs 混合）
- [ ] §5.7.1 单一 section vs 多 section
- [ ] §5.7.3 压缩逻辑是在轨道内还是轨道外
- [ ] §5.8 轻量路径策略（静态 profile vs 动态选择 vs 自适应）
- [ ] §5.9 tool_loop_runner 关系
- [ ] §5.10 因果链复杂度
