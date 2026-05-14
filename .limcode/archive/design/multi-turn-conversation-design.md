# 多轮对话（Multi-Turn Conversation）设计文档

## 状态

本文档定义多轮对话系统的完整设计：跨推理请求的对话持久化、增量上下文构建、消息组装和压缩机制。
所有设计决策已确认。阶段一实现完成（2026-05-05）。

**阶段一已完成**：持久化 + 组装引擎 + 一对一对话、ConversationStore (Prisma/SQLite)、ConversationAssembler（全路径取代旧 adapter）、conversation_history 轨道、静态 profile（chat-first-turn / chat-follow-up）、推理管线接入（task_service + executeRunInternal writeback）、双向事务写入。
详见 `.limcode/plans/multi-turn-conversation-phase1.md`。

**已废弃**：`adaptPromptTreeToAiMessages` 已删除，向后兼容负担已清理（项目未上线，无意义）。

**2026-05-05 设计修订**：
- **多 agent transcript 嵌入提升为默认模式**：一对一角色映射降级为可配置的简化选项。多 agent 场景下所有发言者以各自身份出现在 transcript 文本中，不再做 "对方 = user" 的角色映射。
- **Jailbreak 模式移除**：伪 role 格式注入（未闭合符号等）从设计中移除。该模式依赖模型补全倾向而非显式指令，不可靠且增加了不必要的配置复杂度。
- **AI 摘要压缩方案确认**：Hybrid 方案 — 非 AI 截断兜底 + AI 摘要增量（独立压缩路径，agent 级别 opt-in，软归档）。

**阶段一已完成**（同上）。
**阶段二已完成**（2026-05-05）：多 agent transcript 嵌入 + per-speaker 覆盖、消息级别注入点（多位置/索引定位）、AI 摘要压缩（含 `CompactionInference` 独立路径 + `ConversationCompactionService` + `CompactionAuditEntry` 审计日志）、压缩到单一 role 组装逻辑、因果图查询（双向追溯 + 影响分析）、YAML 配置更新。
详见 `.limcode/plans/multi-turn-conversation-phase2.md`。

**阶段三已完成**（2026-05-05）：自适应轨道选择（`ProfileResolver` 接口 + 默认实现）、per-conversation 配置覆盖（A+C 混合方案 — `resolveEffectiveFormatConfig`）、阶段二遗留事项（`maybeCompact` 接入推理管线、`enable_ai_summary` per-agent metadata 覆盖、显式 `conversation_id` 支持 — `getById`/`listByAgent`/`create`）。
详见 `.limcode/plans/multi-turn-conversation-phase3.md`。

**Tag 系统推迟**：类型/Prisma schema 已就位，用途尚在讨论中，待决定后激活。
**因果图查询无需追加**：阶段二 `CausalGraphQuery` + 重放 API 已覆盖当前需求。

**`SlotFunctionRegistry`（插槽函数）已移出阶段三**：涉及图灵完备执行核心、双模块架构（声明式 pipeline + 插槽函数核心）等根本性架构变更（详见 `TODO.md` "插槽函数（链表）" 项）。此项作为独立设计项目，另起设计文档，不与当前多轮对话分期耦合。

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
- **项目保证可审计性（auditability）**：所有对话记忆变更都有操作者记录，但**不保证操作者身份的可信验证**。`EntryProvenance` 是审计日志，不是权限栅栏。权限控制由上层（推理流程调用约束）保证

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

### 1.3 对话模式范围

- **一对一 agent 对话**：阶段一实现
- **一对多 / 多对多 agent 对话**：阶段一类型设计预留扩展点，阶段二/三实现

在一对多和多对多场景中，不存在"对方 = user"的角色映射。所有 agent 以各自身份发言，
整个对话 transcript 作为一个整体结构嵌入模型消息中（见 §2.2）。

### 1.4 `conversation_id` 生命周期

阶段一采用确定性三元组。一对一场景下 `conversation_id` 由 `(agent_a_id, agent_b_id, simulation_id)` 唯一确定：

- **创建**：`getOrCreate` 按三元组查找或创建，无显式创建步骤
- **作用域**：per agent-pair + simulation（阶段一只支持一对一）
- **并发**：同一 agent-pair 同时只有一个活跃对话
- **销毁**：随 simulation 清理级联删除，无 TTL
- **阶段二/三**：引入显式 `conversation_id` 支持多对话和对话生命周期管理

---

## 2. 发往模型时的消息组装

### 2.1 核心思路：可配置的对话结构组装引擎

对话记忆（`AgentConversationMemory`）不直接按固定规则映射为 `AiMessage[]`。
而是通过一个**可配置的组装引擎**，根据 YAML 配置决定：

- 对话 transcript 如何格式化（每个 speaker 的前缀/后缀、轮次分隔符、嵌套结构）
- 格式化后的内容如何映射到模型消息序列（消息级别 placement）
- AI 在消息序列的哪个位置填充输出
- 如何利用格式技巧（未闭合符号等）引导模型在指定位置续写

### 2.2 默认模式：Transcript 嵌入

多轮对话的**默认**组装方式是将整个对话 transcript 作为文本嵌入消息序列内部。
所有发言者以各自身份出现在 transcript 文本中，不做 "对方 = user" 的角色映射。

**这意味着嵌入其中的大模型最终接受到的所有内容和标记都是可以被更改捏造**

原始对话记忆：

```
turn 1: assistant9: "你好，我是assistant9"
turn 1: assistant2: "好久不见，我是assistant2"
turn 2: assistant4: "今天天气如何？"
turn 2: assistant7: "今天天气非常好"
```

发往模型时，整个 transcript 嵌入一条消息内部（默认嵌入 `user` 角色，可通过 `slot → target_role` 映射配置）。

### 2.3 一对一简化模式（配置门控）

当对话参与方恰好为两个 agent 时，可通过配置启用传统角色映射：
当前 agent 自己的发言 → `assistant` 角色，对方 agent 的发言 → `user` 角色。

```
turn 1: assistant: "你好，我是assistant1"
turn 1: user: "好久不见，我是assistant2"
turn 2: assistant: "今天天气如何？"
turn 2: user: "今天天气非常好"
```

此模式为可选的简化路径，由 `ConversationFormatConfig` 中的显式配置开关控制。默认不使用。

### 2.4 消息级别 Placement：AI 在指定位置填充

消息序列本身支持类似 slot placement 的定位能力。配置决定消息序列的结构，
其中 `assistant` 角色的消息是**空槽位**，等待模型填充：

```json
[
  {"role": "system", "content": "系统提示词1"},
  {"role": "system", "content": "系统提示词2"},
  {"role": "system", "content": "系统提示词3"},
  {"role": "system", "content": "系统提示词4"},
  {"role": "user", "content": "<嵌套了整个多 agent 对话 transcript>"},
  {"role": "assistant", "content": "<AI 在此填充>"},
  {"role": "user", "content": "<后续追加的更多需求>"}
]
```

配置项：

- 同 role 连续消息是否合并为一条（`merge_consecutive_same_role: true/false`）
- AI 填充位置（`ai_fill_position`: 最后一条 assistant 消息 / 指定索引 / 匹配标记）
- 每条消息的 `prefix` / `suffix` 定制

### 2.5 压缩到单一 Role

对话 transcript 可以从 `user` 角色折叠到 `system` 角色，释放 user 位置给新的输入：

```
压缩前:
  system: (系统提示词)
  user: (对话 transcript + 新输入)
  assistant: (AI 填充)

压缩后:
  system: (系统提示词 + 压缩后的整个对话 transcript)
  user: (继续)
  assistant: (AI 填充)
```

旧的对话被折叠进 system 消息中，user 位置空出来接受新的操控输入。
这是纯格式化操作，等价于消息数组前缀压缩。

---

## 3. 架构：对话结构组装引擎

### 3.1 核心组件

```
                      ConversationFormatConfig (YAML 配置)
                        │
                        ├── transcript_format       ← 多 agent 对话如何渲染为文本
                        │     ├── per_speaker_prefix / suffix
                        │     ├── turn_delimiter
                        │     └── nesting (可选，transcript 包裹在标记内)
                        │
                        ├── message_assembly        ← 格式化后内容如何映射到 AiMessage[]
                        │     ├── slot → message_role 映射
                        │     ├── merge_consecutive_same_role
                        │     ├── ai_fill_position
                        │     ├── message_prefix / suffix (per role)
                        │     └── injection_points  (多位置、索引、自定义 placement)
                        │
                        └── compression             ← 压缩策略
                              ├── window_turns (滑动窗口截断，视图层)
                              ├── summary_trigger_turns (AI 摘要触发阈值)
                              ├── compacted_target_role (折叠到 system/user/developer)
                              └── preserve_recent (压缩时保留最近 N 轮全量)
```

### 3.2 数据流

```
AgentConversationMemory (per-agent, 持久化)
  │
  ├── entries: ConversationEntry[]
  ├── conversation_id
  ├── owner_agent_id
  └── metadata
       │
       ▼
ConversationAssembler
  │
  ├── 1. 加载 ConversationFormatConfig
  ├── 2. 渲染 transcript: entries → 格式化文本 (按 transcript_format 规则)
  ├── 3. 压缩 (如果需要): 超出窗口 → 摘要 → 折叠到目标 role
  ├── 4. 消息组装: 格式化文本 + slot 内容 → AiMessage[] (按 message_assembly 规则)
  ├── 5. 注入点处理: 在配置的注入位置插入空的 assistant 槽位
  └── 6. 产出 AiMessage[]
       │
       ▼
AI Gateway (现有，不变)
```

**写入回程**：推理成功后，`ConversationEntry` 以事务方式同步写入双方 agent 的 memory（详见 §5.1）。

### 3.3 与现有 System B 的关系

`ConversationAssembler` 取代 `adaptPromptTreeToAiMessages`，但是一个超集：

- 现有适配器逻辑 = `ConversationAssembler` 的一种特定配置（3 条消息，按 slot role 分组）
- 多轮对话逻辑 = 另一种配置（多消息、transcript 嵌入、注入点）
- 两种配置共存，由 `PromptWorkflowProfile` 选择

### 3.4 对结构化语法解析器的依赖

结构化语法解析器（`apps/server/src/parser/`，详见 `docs/capabilities/STRUCTURED_PARSER.md`）
已实现，是 `ConversationAssembler` 格式模板渲染的基础设施。

解析器提供的三种 API 在组装引擎中的角色：

- **`render(template, variables)`**（一步渲染）— `ConversationAssembler` 的主要调用方式。
  用于 `speaker_format` 的 prefix/suffix 渲染、`role_format` 的消息级 prefix/suffix、
  `turn_delimiter` 等简单模板替换。
- **`createParser(config)`**（工厂模式，含自定义修饰符/块处理器）— 当组装引擎需要扩展
  语法时使用，例如注册 `conversation` 命名空间的专用修饰符。
- **`parseTemplate() → renderAst()`**（两步操作）— 为 Slot 函数系统预留。宏引用
  `{{macro_name}}` 在标准渲染时输出空字符串，由 Slot 函数系统通过操作 AST 消费。

`ConversationFormatConfig` 中内嵌的 `parser_syntax` 字段直接映射到 `ParserSyntaxConfig`
（`STRUCTURED_PARSER.md` §6.2），每个配置可独立覆盖默认语法：

```yaml
conversation_format:
  transcript:
    speaker_format:
      default:
        prefix: '"{speaker_id}": "'
        suffix: '"\n'
  parser_syntax:           # 可选，不传则用默认 {{...}} / {...} 语法
    delimiters:
      variable:
        open: "{"
        close: "}"
```

解析器当前约束在组装引擎中的影响：

- 变量缺失不报错 — transcript 模板中未提供的变量渲染为空字符串，适合可选字段场景
- 修饰符缺失静默跳过 — 不会因配置中的拼写错误导致组装中断
- 最大递归深度 32 — 嵌套 speaker_format 模板应避免递归引用

### 3.5 职责划分：轨道、管线、组装引擎

| 层 | 职责 | 数据产出 | 是否渲染文本 |
|---|---|---|---|
| Track | 选哪些 entries 可见（window_turns）、标记 per-entry metadata（role、kind） | `PromptSectionDraft[]`（per entry） | 是（单条 entry 的文本，含 speaker prefix/suffix） |
| Pipeline | 排序、裁剪（budget_trim 按 entry 粒度，permission filter） | `PromptTree`（per-entry fragments，带 denial 标记） | 否 |
| BundleFinalize | 渲染 text、聚合 metadata | `PromptBundleV2`（slots 扁平文本 + tree 结构） | 是（`renderSlotText`） |
| Assembler | 读取 fragment tree，按 `entry_role` 组装为 `AiMessage[]` | `AiMessage[]` | 否（读已有 rendered text） |

关键设计原则：**transcript 文本只渲染一次**。轨道层为每条 entry 产出独立的 `PromptSectionDraft`，管线在 entry 粒度裁剪，组装引擎从 `PromptBundleV2.tree.fragments_by_slot` 读取已处理的 fragment 构建消息序列，不做二次渲染。

---

## 4. 背景：当前架构与多轮对话的差距

### 4.1 现有 System B 流水线（单次推理）

```
InferenceContext → 三条轨道(模板/节点/快照) → section_drafts
  → 5步pipeline(placement→assembly→permission→budget_trim→finalize) → PromptBundleV2
  → adaptPromptTreeToAiMessages → 3条消息(system/developer/user) → AI Gateway
```

### 4.2 关键缺口

| # | 缺口 | 位置 | 影响 |
|---|------|------|------|
| 1 | `PromptWorkflowState` 生命周期仅单次推理 | `types.ts` | 无跨请求状态传递 |
| 2 | `adaptPromptTreeToAiMessages` 只产 3 条固定消息 | `prompt_tree_adapter.ts` | 无多消息序列、无注入点 |
| 3 | 无可配置的消息组装引擎 | — | 格式规则硬编码 |
| 4 | 无对话记忆持久化层 | — | 对话历史无法跨请求存活 |
| 5 | 无溯源追踪机制 | — | 无法追溯对话记忆修改历史 |
| 6 | `InferenceContext` 无对话引用 | `types.ts` | 无 `conversation_id` / `owner_agent_id` |
| 7 | ~~无结构化语法解析器~~ 已完成 | `apps/server/src/parser/` | — |

### 4.3 设计文档中已有的预留

- System B 设计 §5.2：轨道数量不固定，可引入 `conversation_history` 轨道
- System B 设计 §12.14：多轮对话轨道为预留扩展点
- System B 设计 §12.8：轻量路径（`profile.tracks`）已实现
- `PromptWorkflowState.ai_messages` 字段已定义但未使用
- `SectionDraft.metadata: Record<string, unknown>` 可作为组装配置的扩展点

---

## 5. 架构概览

### 5.1 核心思路

```
AgentConversationMemory (per-agent, 持久化)
  │
  ├── owner_agent_id
  ├── conversation_id
  ├── entries: ConversationEntry[]
  ├── summary?: string
  └── metadata
       │
       ▼
InferenceContext (扩展)
  ├── agent_conversation_memory?: AgentConversationMemory
  └── current_agent_id?: string
       │
       ▼
buildWorkflowPromptBundle()
  ├── runTemplateTrack()
  ├── runNodeTrack()
  ├── runSnapshotTrack()
  ├── runConversationHistoryTrack()   ← 新增：加载对话记忆 → section_drafts
  └── runPipeline()
       │
       ▼
PromptBundleV2 (现有，不变)
       │
       ▼
ConversationAssembler (新增，取代 adaptPromptTreeToAiMessages)
  ├── 消费 PromptBundleV2 + AgentConversationMemory + ConversationFormatConfig
  ├── 读取 fragment tree + 消息序列组装
  └── 产出 AiMessage[]
       │
       ▼
AI Gateway (现有，不变)
       │
       ▼
推理完成，写入回程：
  ├── 推理成功 → 事务同步写入双方 agent 的 ConversationEntry
  └── 推理失败 → 不写入（entry 写入是最后一步，无需回滚）
```

**写入细节**：

```typescript
// 推理响应处理流程
const result = await inferencePipeline.run(context);
if (result.status === 'success') {
  await db.$transaction([
     db.conversationEntry.create({ data: entryForAgentA }),
     db.conversationEntry.create({ data: entryForAgentB }),
  ]);
}
return result;
```

- **同步写入**：写入双方 memory 是推理响应流程的一部分，不是异步的
- **事务原子性**：A 和 B 的 entry 在同一事务中写入，失败则整次推理标记为失败
- **无回滚语义**：只在推理成功后写入，写入是最后一步。如果写入 DB 本身失败，整次推理标记为失败，不存在 dangling entry 问题
- **SQLite WAL 模式**：写事务互斥，读不阻塞写，适合顺序写入场景
- Agent B 的 entry 的 `provenance.operator.kind = 'agent'`，`capability = 'conversation.record'`

### 5.2 两条路径

- **完整流水线**（首轮 / 复杂任务）：四条轨道 + 完整 pipeline
- **轻量路径**（后续简单轮次）：`conversation_history` + `template` 轨道，跳过节点轨和快照轨

轻量路径由 `profile.tracks` 控制，现有机制已支持。

---

## 6. 设计决策

### 6.1 核心类型：`ConversationEntry`

自定义类型，不复用 `AiMessage`。`AiMessage` 是模型传输格式，`ConversationEntry` 是持久化格式。

```typescript
interface ConversationEntry {
  id: string;
  turn_number: number;
  speaker_agent_id: string;          // 原始说话者
  kind: 'original' | 'summary';      // 原始 entry 或 AI 摘要压缩产生的 entry

  // 内容
  original_content: string;          // 首次记录时的不可变快照
  current_content: string;           // 经过修改链后的当前值

  // 溯源追踪
  provenance: EntryProvenance;       // 记录者身份与操作能力
  recorded_at: number;
  modifications: EntryModification[]; // 修改历史，默认上限 50 条，超限归档

  // 因果链
  source_inference_id?: string;      // 产生此 entry 的推理 ID
  derived_from_entry_ids?: string[]; // 摘要场景：此 entry 衍生自哪些原始 entry

  // summary entry 专用：被折叠的 turn 范围
  turn_range?: { start: number; end: number };

  // 工具调用摘要
  tool_trace?: EntryToolTrace;       // 仅最终回复携带，中间工具消息不入记忆

  // 压缩状态
  archived?: boolean;                // 软归档标记，AI 摘要压缩后设为 true。getVisibleEntries 过滤

  // 元数据
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface EntryProvenance {
  operator: {
    kind: 'agent' | 'user' | 'plugin' | 'data_cleaner';
    id: string;
  };
  capability: 'conversation.insert' | 'conversation.modify' | 'conversation.delete' | 'conversation.record';
  rule?: string;                     // data_cleaner 场景下的规则标识
}

interface EntryModification {
  modified_by: EntryProvenance;
  modified_at: number;
  previous_content: string;
  new_content: string;
  reason?: string;
}

interface EntryToolTrace {
  tools_called: string[];            // 被调用的工具名称列表
  total_rounds: number;              // 工具循环轮数
  total_tool_calls: number;          // 累计工具调用次数
}
```

**字段决策**：

- `original_content` 和 `current_content` 双字段 — 前者是不可变快照，后者是修改链后的当前值
- `kind: 'original' | 'summary'` — 区分原始 entry 和 AI 摘要压缩产生的 summary entry
- `turn_range` — summary entry 专用，记录被折叠的原始 turn 范围
- `modifications` 保留修改历史，默认上限 `MAX_MODIFICATIONS_PER_ENTRY = 50`（可配置）。超限时保留最近 N 条，旧 modifications 折叠为一条归档摘要（`operator.kind = 'data_cleaner'`，`reason = 'archived_modifications'`）
- content 为字符串，结构化附属数据通过 `metadata` 扩展
- `source_inference_id` + `derived_from_entry_ids` 构成因果链（详见 §6.10）
- `archived` 软归档标记 — AI 摘要压缩后设为 `true`。条目不物理删除，保留完整审计链。无限增长问题记录在 TODO.md

### 6.2 溯源追踪粒度

`EntryProvenance` 使用结构化类型，`operator` 标注操作者身份，`capability` 标注操作能力。

场景对应：

| 场景 | operator.kind | capability |
|------|:---:|:---:|
| Agent 记录自己或对方的发言 | `agent` | `conversation.record` |
| Agent 插入伪造对话 | `agent` | `conversation.insert` |
| 用户 CLI 手动修改 | `user` | `conversation.modify` |
| 正则过滤器匹配替换 | `data_cleaner` | `conversation.modify` |
| 插件 hook 修改 | `plugin` | `conversation.modify` |
| AI 摘要压缩（summary entry） | `agent` | `conversation.record` |

> **注意**：AI 摘要压缩的详细审计信息（模型、token 用量、耗时等）写入专用 `CompactionAuditEntry`，不通过 `EntryProvenance` 承载。Summary entry 的 `provenance` 仅记录触发压缩的 agent 身份，完整审计链见压缩审计日志。

### 6.3 持久化方案

`ConversationStore` 抽象接口 + 独立 entry 表实现。

```typescript
interface ConversationStore {
  getOrCreate(ownerAgentId: string, conversationId: string): Promise<AgentConversationMemory>;
  appendEntry(memoryId: string, entry: ConversationEntry): Promise<void>;
  modifyEntry(entryId: string, modification: EntryModification): Promise<void>;
  getEntries(memoryId: string, opts?: { limit?: number; before?: number }): Promise<ConversationEntry[]>;
  updateSummary(memoryId: string, summary: string): Promise<void>;
  deleteMemory(memoryId: string): Promise<void>;
}
```

- 接口聚焦对话记忆操作边界，不做泛型 store
- 首版实现用 Prisma + SQLite：`ConversationMemory` 表存元数据，`ConversationEntryRecord` 表存独立 entry
- entry 拆分为独立表规避 JSON 列膨胀，支持 DB 层查询和分页
- 单元测试可传 mock store，后续切 PostgreSQL 对上层透明

**并发**：SQLite 单写者模型天然序列化写操作，阶段一不需要额外锁机制。
压缩操作是原子的（旧 entries 替换为 summary entry 在同一写事务中完成），新 entry 追加在数组尾部不影响压缩。
阶段二如需更细粒度控制，引入 `CompactionLock`。

### 6.4 `ConversationFormatConfig` 配置格式

**YAML**，遵循项目现有的 Zod schema → TypeScript type → YAML 序列化模式。

```yaml
# 多 agent transcript 嵌入 + AI 摘要压缩的配置示例
conversation_format:
  transcript:
    turn_delimiter: "\n"
    speaker_format:
      default:
        prefix: '"{speaker_id}": "'
        suffix: '"\n'

  message_assembly:
    merge_consecutive_same_role: false
    slots:
      - slot: system_core
        target_role: system
      - slot: conversation_history
        target_role: user
    injection:
      ai_fill_role: assistant
      ai_fill_position: after_last_user
    role_format:
      user:
        prefix: ""
        suffix: ""
      assistant:
        prefix: ""
        suffix: ""

  compression:
    enable_ai_summary: false        # Agent 级别 opt-in，默认关闭
    window_turns: 20                # AI 摘要可用时的视图窗口
    summary_trigger_turns: 30       # 触发 AI 摘要的阈值
    compacted_target_role: system   # 压缩后 transcript 折叠到哪个 role
    preserve_recent: 5              # AI 摘要不可用时的截断兜底
```

- `enable_ai_summary` — agent 级别开关，默认 `false`。关闭时仅使用 `window_turns` + `preserve_recent` 截断兜底，不触发 AI 摘要压缩
- `compacted_target_role` — 压缩后对话 transcript 从 `user` 角色折叠到的目标角色（详见 §2.5）
- YAML 描述声明式结构（transcript 格式、消息映射、压缩参数）
- 插槽函数留给独立的 `SlotFunctionRegistry`，格式配置通过函数名引用
- 格式配置和函数走不同通道：YAML 配置可热加载，函数注册是低频代码操作
- `parser_syntax` 为可选字段，不传时解析器使用默认 `{...}` / `{{...}}` 语法

**阶段二 schema 范围**：阶段二新增 `compacted_target_role` 和 `enable_ai_summary` 字段。

**配置位置**：`data/configw/conf.d/conversation.yaml`，以 conversation profile 形式组织
（`chat-first-turn`、`chat-follow-up` 等）。

**与 `PromptWorkflowProfile` 的关联**：profile 的 `tracks` 字段启用 `conversation_history` 轨道，
`conversation_profile` 字段引用格式配置名。

**阶段一配置覆盖**：阶段一只做 profile 名称引用，不支持 per-conversation 覆盖。配置解析路径为 `profile 名称 → 查找 YAML → 加载 ConversationFormatConfig`，不需要动态合并。per-conversation 覆盖推迟到阶段三。

### 6.5 新增 slot：`conversation_history`

新增 `'conversation_history'` 到 `PromptFragmentSlot` 联合类型。

该 slot 不通过 `message_role` 做单值路由。`ConversationAssembler` 直接从
`AgentConversationMemory` 构建多角色消息序列。slot 的 `message_role` 设为 `user`
（作为 transcript 的默认嵌入位置），实际组装由 `ConversationFormatConfig` 控制。

### 6.6 压缩策略：非 AI 截断兜底 + AI 摘要增量（Hybrid）

**核心思路**：截断是必要条件（保证推理不超 context window），AI 摘要是可选增强（改善截断后的上下文质量）。两者走不同执行路径：

| 策略 | 路径 | 性质 | 触发 | 说明 |
|------|------|------|------|------|
| `window_turns`（滑动窗口） | 轨道内 | 无损视图层截取 | 每次推理 | 渲染参数，不影响持久化 |
| 截断兜底 | 轨道内 | 无持久化副作用 | entries 超过 `summary_trigger_turns` 且 AI 摘要不可用/未启用 | `getVisibleEntries` 按 `preserve_recent` 取尾部 |
| AI 摘要 | 独立推理路径 | 有损持久化压缩 | 写入后触发，检查阈值 | 独立压缩路径，标记旧 entry 为 `archived` |

**触发时机**：写入后触发（post-append）。每次 `appendEntry` / `appendEntriesInTransaction` 写入后检查 entries 数量。若超过 `summary_trigger_turns` 且 agent 启用了摘要功能，则异步触发 AI 摘要压缩。

**Agent 级别 opt-in**：AI 摘要压缩默认关闭。每个 agent 通过配置显式启用。未启用摘要的 agent 仅依赖 `window_turns` + 截断兜底，不调用 AI 压缩。

**专用压缩路径（Dedicated Compaction Path）**：

摘要压缩绕过正常推理管线，使用独立的极简 AI 调用路径：
- 不走 `conversation_history` track（消除递归依赖）
- 不加载模板、slot、world context、persona
- 不触发 tool loop
- 构造单一 summarize prompt：被压缩的 entries + 指令 → 生成摘要文本
- 摘要推理的 trace 写入专用 compaction audit log（独立于 `InferenceTrace`）

```
ConversationEntry 写入
  │
  ├── entries 数量 ≤ summary_trigger_turns → 不触发
  │
  └── entries 数量 > summary_trigger_turns
        │
        ├── agent 未启用摘要 → 不触发（仅依赖截断兜底）
        │
        └── agent 已启用摘要
              │
              ├── 1. 非 AI 截断兜底：getVisibleEntries 按 preserve_recent 截断（保证当前推理可用）
              │
              └── 2. 异步 AI 摘要压缩（独立路径）：
                    ├── 选取待压缩的旧 entry（按 preserve_recent 之外的条目）
                    ├── 构造 summarize prompt → 直接调用 AI Gateway
                    ├── 生成 summary entry（kind: 'summary', turn_range 覆盖被压缩范围）
                    ├── 标记旧 entry 为 archived: true
                    ├── 写入 compaction audit log
                    └── 下次推理时 getVisibleEntries 看到 summary entry + 未归档的 recent entries
```

**Entry 替换模型：软归档（Soft Archive）**：

`ConversationEntry` 新增 `archived: boolean` 字段（默认 `false`）。AI 摘要压缩将旧 entry 标记为 `archived: true`，不物理删除。

- 保留完整审计链（`modifications`、`source_inference_id`、`derived_from_entry_ids` 均不受影响）
- `getVisibleEntries` 过滤掉 `archived: true` 的条目
- entries 数组无限增长问题记录在 TODO.md，日后处理（如定期物理归档到冷存储）

**Summary of summary**：接受渐进信息失真。若 agent 需要保留确切数据，应使用工具调用写入独立存储（如 world state 或专用记忆块），而非依赖对话摘要的保真度。对话摘要的职责是维持上下文连贯性，不是充当数据库。

**压缩审计日志**：

压缩专用路径使用独立的 audit log（区别于 `InferenceTrace`）：

```typescript
interface CompactionAuditEntry {
  id: string;
  agent_id: string;
  conversation_id: string;
  triggered_at: number;
  source_entry_ids: string[];      // 被压缩的原始 entry ID
  summary_entry_id: string;         // 生成的 summary entry ID
  summary_model: string;            // 使用的 AI 模型
  summary_prompt_tokens: number;
  summary_completion_tokens: number;
  summary_duration_ms: number;
  status: 'success' | 'failed';
  error_message?: string;
}
```

**`getVisibleEntries` 更新**：

```typescript
function getVisibleEntries(
  memory: AgentConversationMemory,
  compression: CompressionConfig
): ConversationEntry[] {
  const { window_turns, preserve_recent } = compression;
  
  // Filter out archived entries
  const active = memory.entries.filter(e => !e.archived);
  const sorted = [...active].sort((a, b) => a.turn_number - b.turn_number);

  const summaryEntries = sorted.filter(e => e.kind === 'summary');
  const originalEntries = sorted.filter(e => e.kind !== 'summary');

  // AI summary available: show summary + window_turns recent originals
  // AI summary not available (fallback): truncate to preserve_recent
  const effectiveWindow = summaryEntries.length > 0
    ? (window_turns && window_turns > 0 ? window_turns : undefined)
    : (preserve_recent && preserve_recent > 0 ? preserve_recent : undefined);

  const visibleRecent = effectiveWindow
    ? originalEntries.slice(-effectiveWindow)
    : originalEntries;

  return [...summaryEntries, ...visibleRecent];
}
```

关键变化：
- 过滤 `archived` 条目
- 无 AI 摘要时用 `preserve_recent` 截断（兜底），有摘要时用 `window_turns`
- 其余逻辑不变（summary 始终包含，recent 在后，按 turn_number 升序）

### 6.7 `ConversationAssembler` 接口

```typescript
interface ConversationAssembler {
  assemble(input: {
    bundle: PromptBundleV2;
    memory: AgentConversationMemory;
    formatConfig: ConversationFormatConfig;
    currentAgentId: string;
  }): AiMessage[];
}
```

组装流程：

1. 从 `PromptBundleV2.tree.fragments_by_slot` 读取经过管线处理的 fragment（不做二次渲染）
2. 过滤掉 `permission_denied` 的 fragment，按 `turn_number` 升序排列
3. Non-conversation slot 按现有行为分组到对应 message_role
4. Conversation entries 按 `entry_role` metadata 映射到对应 role 的消息
5. 同 role 的多条 conversation entries 用 `formatConfig.transcript.turn_delimiter` 拼接（默认 `'\n'`）
6. 按 `formatConfig.message_assembly` 合并/排序消息序列
7. 按 `formatConfig.message_assembly.injection` 确定 AI 填充位置
8. 按 `formatConfig.message_assembly.role_format` 添加每条消息的前缀/后缀
9. 如配置 `merge_consecutive_same_role`，合并相邻同 role 消息
10. 产出最终 `AiMessage[]`

该组件取代现有的 `adaptPromptTreeToAiMessages`，但向后兼容 —
现有行为是 `ConversationAssembler` 的一个默认配置实例。当前 adapter 的特殊处理（`preset`、`system_append`、`developer_append`、`user_prefix`、`include_sections`、few-shot examples）不在 `ConversationFormatConfig` 中处理，而是由 `ConversationAssembler` 在组装阶段从 `AiResolvedTaskConfig` 注入，保证格式配置只管结构映射。

向后兼容的精确复现验证为阶段一实现的**验收条件**。对应的默认 YAML 配置如下：

```yaml
# 默认配置 — 等价于当前 3 消息行为
conversation_format:
  transcript:
    turn_delimiter: "\n"
    speaker_format:
      default:
        prefix: ""
        suffix: "\n"
  message_assembly:
    merge_consecutive_same_role: true
    slots:
      - slot: system_core
        target_role: system
      - slot: system_policy
        target_role: system
      - slot: role_core
        target_role: developer
      - slot: world_context
        target_role: developer
      - slot: memory_short_term
        target_role: developer
      - slot: memory_long_term
        target_role: developer
      - slot: memory_summary
        target_role: developer
      - slot: output_contract
        target_role: user
      - slot: conversation_history
        target_role: user
      - slot: post_process
        target_role: user
    injection:
      ai_fill_role: assistant
      ai_fill_position: after_last_user
    role_format:
      system:
        prefix: ""
        suffix: ""
      developer:
        prefix: ""
        suffix: ""
      user:
        prefix: ""
        suffix: ""
      assistant:
        prefix: ""
        suffix: ""
```

> **注意**: 默认 profile 的 `speaker_format.default` 使用空 prefix 和 `"\n"` suffix（无对话历史时无需 speaker 标注），而 `chat-first-turn`/`chat-follow-up` profile 使用 `'"{{speaker_id}}": "...'` 格式（多 agent transcript 需要 speaker 标注以区分发言者）。

### 6.8 轻量路径与轨道选择

阶段一使用静态 profile。调用方根据"是否为对话首轮"显式选择：

```typescript
const profileName = conversation.entries.length === 0
  ? 'chat-first-turn'
  : 'chat-follow-up';
```

| 场景 | 轨道 | 说明 |
|------|------|------|
| 首轮 | 全部 4 条 | 完整上下文 |
| 简单追问 | template + conversation_history | 世界未变 |
| 世界状态变更 | template + conversation_history + snapshot | — |
| memory compaction | template + node + conversation_history | — |

- profile 名称决定轨道组合，选择逻辑只有一行，不会散落到各调用点
- 阶段二/三如需自适应检测，插入 `resolveConversationProfile(memory, worldState): string` 函数 — 返回 profile 名称，不改 profile 体系

### 6.9 与 `tool_loop_runner` 的关系

**分层 + 轻量 trace annotation。**

核心原则：**工具调用链是推理的执行过程，不是对话的交流内容。** 不应将工具中间消息与 agent 发言混入同一 transcript。

```
ToolLoopRunner (内存中迭代 AiMessage[], 不变)
  │
  ├── 中间 round: assistant(tool_calls) + tool(JSON 结果) → 仅 AiMessage[] 暂存
  │
  └── 最终 round: assistant(文本回复) → 写入 ConversationEntry
                                           │
                                           └── tool_trace: {
                                                 tools_called: ['get_entity', 'query_memory_blocks'],
                                                 total_rounds: 3,
                                                 total_tool_calls: 5
                                               }
```

- `ConversationEntry.tool_trace` 记录工具调用摘要（工具名和次数，不含完整 JSON 结果）。阶段一保持摘要格式，不扩展。Agent 可通过 `current_content` 自然引用工具结果
- 完整的工具调用参数和返回值通过 `InferenceTrace` 追溯（已有 `input` 和 `prompt_bundle` 字段）
- `ToolLoopRunner` 保持现有设计：纯内存迭代，不受对话压缩策略影响
- 最终回复作为一条 `ConversationEntry` 写入，transcript 保持干净
- 阶段二可扩展 `EntryToolTrace.result_summaries`，阶段一不实现

### 6.10 跨推理因果链

**引用链，分两期实现。**

每条 `ConversationEntry` 通过 `source_inference_id` 追溯到产生它的推理，
通过 `derived_from_entry_ids` 追溯到它衍生自哪些原始 entry。两条链正交但互补：
`modifications` 追踪修改链，`source_inference_id` 追踪生成链。

三种写入场景：

| 场景 | source_inference_id | derived_from_entry_ids |
|------|:---:|:---:|
| 模型生成回复 | 当前 inference_id | 不设 |
| AI 摘要压缩 | compaction 的 inference_id | 被折叠的原始 entry ID 列表 |
| 用户/插件手动修改 | 不设（`modifications` 已追溯操作者） | 不设 |

不新建表，不建外键约束。`InferenceTrace` 已存在，entry 只存引用。
`source_inference_id` 视为**最佳努力引用**——如果 trace 存在则可追溯，不存在则标记为不可追溯。
`InferenceTrace` 的清理策略无需检查 conversation entry 引用。

**阶段一**：写入时捕获两个可选字段。不建索引、不建查询 API、不做图遍历。

**阶段二**：构建因果关系查询能力（沿 `derived_from_entry_ids` 双向追溯、影响分析、重放验证）。

**Agent 可获得的能力**：

1. **调试模型行为**：追溯到两次推理的 `prompt_bundle`，定位输出差异根因
2. **摘要有效性验证**：被压缩后若 agent 出现信息丢失，回溯是哪条原始 entry 的内容被折叠
3. **审计闭环**：从"谁改了什么"扩展到"哪次推理产出了什么"
4. **影响分析（阶段二）**：删除 entry → 反向查询哪些摘要依赖它
5. **重放验证（阶段二）**：给定 `source_inference_id` 查出 `prompt_bundle`，用新模型重跑比对

### 6.11 Transcript 嵌入模式与 Per-Speaker 覆盖

所有对话均默认使用 transcript 嵌入模式（§2.2）。一对一角色映射（§2.3）为配置门控的简化选项。
`ConversationFormatConfig.transcript.speaker_format` 支持 per-speaker 覆盖：

```yaml
speaker_format:
  default:
    prefix: '"{speaker_id}": "'
    suffix: '"\n'
  assistant9:
    prefix: '[助理9] '
    suffix: '\n'
```

当前 agent 自己的消息在 transcript 中如何标记（高亮、加粗、注入点前）也由配置决定。

---

## 7. 优先级与分期

### 阶段一（核心：持久化 + 组装引擎 + 一对一对话） ✅ 完成

1. `ConversationEntry` + `AgentConversationMemory` 类型定义（含 `kind`、`turn_range` 字段，`modifications` 上限 50）
2. `ConversationStore` 接口 + Prisma 实现（`ConversationMemory` + `ConversationEntryRecord` 表）
3. `ConversationFormatConfig` 类型 + YAML schema 定义（阶段一只暴露阶段一字段）
4. `ConversationAssembler` 实现（从 FragmentTree 读取，取代 `adaptPromptTreeToAiMessages`）
5. `runConversationHistoryTrack` 轨道（per-entry draft，`getVisibleEntries` 截断逻辑）
6. `InferenceContext` 扩展（`agent_conversation_memory` + `current_agent_id` + `conversation_profile`）
7. 静态 profile（`chat-first-turn`、`chat-follow-up`）+ 轻量路径
8. 滑动窗口截断（`window_turns`，轨道内视图层）+ 双层 token 约束（`token_budget_trim` 优先）
9. `source_inference_id` + `derived_from_entry_ids` 写入捕获
10. 推理成功后的双向事务写入（§5.1 写入回程）
11. 向后兼容验收：现有 3 消息行为可被默认 YAML 配置精确复现

### 阶段二（多 agent transcript 嵌入 + 注入点 + AI 摘要压缩）

1. 多 agent transcript 嵌入（默认模式，取代一对一角色映射）
2. 消息级别注入点（多位置、命名注入点、索引定位）
3. 一对一角色映射降级为配置门控的简化选项
4. `ConversationEntry.archived` 字段 + `getVisibleEntries` 过滤逻辑
5. AI 摘要压缩 — Hybrid 方案（截断兜底 + 独立压缩路径 + 写入后触发 + 软归档）
6. `CompactionAuditEntry` 类型 + 压缩审计日志
7. `enable_ai_summary` agent 级别 opt-in + `compacted_target_role` 配置
8. 压缩到单一 role（详见 §2.5）
9. 因果图查询 API（沿 `derived_from_entry_ids` 双向追溯）

### 阶段三（高级特性）— ✅ 已完成 (2026-05-05)

> 详见 `.limcode/plans/multi-turn-conversation-phase3.md`

#### 3.1 自适应轨道选择（`resolveConversationProfile`）— ✅ 已实现

**决策**：方案 D — 先定义 `ProfileResolver` 函数签名，默认实现保持当前行为不变。
后续可通过 A（world state mutation 事件）+ C（agent 显式请求重载）混合方案扩展。

**实现**：
- 新建 `apps/server/src/conversation/profile_resolver.ts` — `ProfileResolver` 类型 + `defaultProfileResolver`
- `inference/service.ts` 中两处硬编码选择逻辑替换为 `defaultProfileResolver(memory, ctx)` 调用
- `AppContext` 可注入自定义 `profileResolver`（可选，不设则用默认）

**函数签名**（实际实现）：
```typescript
export type ProfileResolverContext = {
  worldStateChanged: boolean;
  agentRequestedProfile?: string;
};

export type ProfileResolver = (
  memory: AgentConversationMemory,
  ctx: ProfileResolverContext
) => string;
```

#### 3.2 Tag 系统 — ⏸ 推迟

**决策**：跳过。类型定义、Prisma 列、序列化/反序列化代码均已就位（阶段一预留），
待有明确用途时激活只需在 `buildEntry` 加一行 `tags: [...]`。用途尚在讨论中，记录于 `TODO.md`。

#### 3.3 完整因果图查询（含重放验证）— ✅ 无需追加

**决策**：现有实现已够用。阶段二 `CausalGraphQuery` 四方法 + 重放 API（`replayInferenceJob`）
覆盖了当前需求。不追加独立工作项。

#### 3.4 per-conversation 配置覆盖 — ✅ 已实现

**决策**：A + C 混合方案，无中间态。

**实现**：
- `format_config.ts` 新增 `resolveEffectiveFormatConfig(memory, profileName)` 函数
- 优先级：`conversation_profile_override`（方案 C）> `conversation_format_override`（方案 A）> profile 名称 → YAML 查找 → 默认
- 无论哪个路径，最终结果经过 `ConversationFormatConfigSchema.parse()` 校验，缺少必需字段抛错不静默回退
- inference/service.ts 中 compaction 调用已使用 `resolveEffectiveFormatConfig`
- `ConversationMemoryMetadata`（`types.ts`）承载 `conversation_profile_override` 和 `conversation_format_override` 字段

#### 3.5 阶段二遗留事项 — ✅ 已实现

| # | 事项 | 实现方式 |
|---|------|----------|
| 1 | `maybeCompact` 未接入管线 | `inference/service.ts` writeback 后调用，compaction 失败不阻断推理（独立 try-catch） |
| 2 | `CompactionAuditEntry` 用量字段失败路径默认值 | 文档化已知限制 |
| 3 | `enable_ai_summary` per-agent 级别 | `ConversationMemoryMetadata.enable_ai_summary` + `summary_trigger_turns`；`maybeCompact` 读取优先级 metadata > profile config |
| 4 | `conversation_id` 显式多对话支持 | `ConversationStore` 新增 `getById`/`listByAgent`/`create`；Prisma schema 新增 `display_name`；推理管线仍用三元组创建，显式 API 已可用 |

### 前置依赖

- **结构化语法解析器**（`apps/server/src/parser/`，`docs/capabilities/STRUCTURED_PARSER.md`）：
  已完成实现。`render()` 一步渲染 API 覆盖阶段一所需的全部模板能力（speaker_format
  prefix/suffix、role_format、turn_delimiter 等）。`createParser()` 工厂模式为阶段二的
  自定义修饰符/块处理器提供扩展点。不再有阻塞阶段一的解析器缺口。

---

## 8. 决策记录

### 全部已确认

- [x] **消息存储格式**（§6.1）：自定义 `ConversationEntry` 类型。`AiMessage` 是传输格式，`ConversationEntry` 是持久化格式。`original_content` + `current_content` 双字段，`kind: 'original' | 'summary'` 区分原始/摘要 entry，`turn_range` 记录被折叠的 turn 范围，`modifications` 上限 50 条
- [x] **Agent 中心化**（§1.1）：每个 agent 持有自己的对话记忆副本。项目保证可审计性（auditability），不保证操作者身份的可信验证
- [x] **可配置组装引擎**（§2-3）：`ConversationFormatConfig` + `ConversationAssembler` 取代硬编码的 `adaptPromptTreeToAiMessages`
- [x] **Transcript 嵌入为默认模式**（§2.2）：多 agent transcript 直接嵌入消息内部，不做 "对方 = user" 的角色映射。一对一角色映射为配置门控的简化选项
- [x] **Jailbreak 模式移除**（2026-05-05 修订）：伪 role 格式注入（未闭合符号）从设计中移除，依赖模型补全倾向不可靠且增加不必要的配置复杂度
- [x] **ConversationAssembler 向后兼容**（§6.7）：现有 3 条消息行为是默认配置实例，精确复现为阶段一验收条件
- [x] **结构化语法解析器**（§3.4）：`apps/server/src/parser/` 已完成实现
- [x] **溯源追踪粒度**（§6.2）：结构化 `EntryProvenance`（`operator` + `capability`）
- [x] **持久化方案**（§6.3）：`ConversationStore` 抽象接口 + 独立 entry 表实现。SQLite WAL 模式下读不阻塞写，单写者模型天然序列化并发操作
- [x] **配置格式**（§6.4）：YAML + 函数引用，存在 `data/configw/conf.d/conversation.yaml`，通过 `PromptWorkflowProfile.conversation_profile` 关联。阶段一 schema 只暴露阶段一字段，阶段一只做 profile 名称引用不支持 per-conversation 覆盖
- [x] **新增 slot**（§6.5）：`conversation_history` 加入 `PromptFragmentSlot` 联合类型
- [x] **压缩逻辑位置**（§6.6）：混合方案 — 滑动窗口截断在轨道内（视图层，`getVisibleEntries`），AI 摘要在轨道外（独立 `ConversationCompactionService`，持久化 + 溯源）。压缩后 entries 采用"头部摘要 + 尾部原始"结构，summary 不受 `window_turns` 截断
- [x] **令牌预算双层约束**（§6.6）：`token_budget_trim`（细粒度）优先于 `window_turns`（粗粒度）。`conversation_history` slot 采用反转裁剪（从最旧 entry 开始裁），`default_priority` 设为中等（50）
- [x] **轨道与组装引擎职责划分**（§3.5）：轨道产出 per-entry draft，transcript 只渲染一次，组装引擎从 `FragmentTree` 读取已处理 fragment 不做二次渲染
- [x] **跨 agent 记忆同步**（§5.1）：推理成功后以事务方式同步写入双方 memory，写入是推理流程最后一步，失败不需要回滚
- [x] **`conversation_id` 生命周期**（§1.4）：阶段一用确定性三元组 `(agent_a_id, agent_b_id, simulation_id)`，同一 agent-pair 只有一个活跃对话
- [x] **轻量路径策略**（§6.8）：阶段一用静态 profile（`chat-first-turn`、`chat-follow-up`），阶段二/三可插 `resolveConversationProfile` 自适应选择器
- [x] **tool_loop_runner 关系**（§6.9）：分层 + 轻量 trace annotation — 工具调用链在内存中迭代，仅最终回复写入 `ConversationEntry` + `tool_trace` 摘要。阶段一保持摘要格式不扩展
- [x] **因果链**（§6.10）：引用链分两期 — 阶段一写入时捕获 `source_inference_id` + `derived_from_entry_ids`（最佳努力引用，不建外键约束），阶段二构建因果关系查询能力
- [x] **AI 摘要压缩方案**（§6.6，2026-05-05 确认）：Hybrid 方案 — 非 AI 截断兜底（`preserve_recent` 截尾）+ AI 摘要增量（独立压缩路径，不走推理管线）。写入后触发（post-append），agent 级别 opt-in（`enable_ai_summary`，默认关闭）。软归档（`archived: true`）保留审计完整性，无限增长问题记录 TODO.md
- [x] **压缩专用路径**（§6.6）：AI 摘要使用独立推理路径 — 绕过 conversation_history track、不加载模板/slot/world context/persona、不触发 tool loop。审计走专用 `CompactionAuditEntry` 日志
- [x] **Summary of summary**（§6.6）：接受渐进信息失真。需保留确切数据时 agent 应使用工具写入独立存储（world state / 记忆块），对话摘要的职责是维持上下文连贯性而非充当数据库
- [x] **压缩到单一 role**（§2.5）：对话 transcript 折叠到 `compacted_target_role`（默认 `system`），释放 `user` 位置给新输入
- [x] **自适应轨道选择**（§3.1，2026-05-05）：采用方案 D — 定义 `ProfileResolver` 函数签名，默认实现保持当前行为。后续通过 A（world state mutation）+ C（agent 显式请求）混合方案扩展
- [x] **`SlotFunctionRegistry` 移出阶段三**（§3，2026-05-05）：插槽函数涉及图灵完备执行核心、双模块架构等根本性变更，作为独立设计项目另起文档，不与多轮对话分期耦合
- [x] **`maybeCompact` 接入推理管线**（§3.5，2026-05-05）：在 `executeRunInternal` writeback 后调用，compaction 失败不阻断推理（独立 try-catch），所有 profile 的 `enable_ai_summary: false` 保证默认短路
- [x] **`enable_ai_summary` per-agent 级别**（§3.5，2026-05-05）：通过 `ConversationMemoryMetadata` 覆盖，优先级 metadata > profile config。无独立 Agent 配置 YAML，per-agent 设置存在 conversation memory 的 metadata 中
- [x] **显式 `conversation_id` 支持**（§3.5，2026-05-05）：`ConversationStore` 新增 `getById`/`listByAgent`/`create`；Prisma `ConversationMemory` 新增 `display_name`；推理管线仍用三元组创建，显式 API 已可用
- [x] **per-conversation 配置覆盖**（§3.4，2026-05-05）：A + C 混合方案 — `resolveEffectiveFormatConfig` 函数，优先级 C > A > profile，Zod 校验必填字段
- [x] **Tag 系统推迟**（§3.2，2026-05-05）：Schema 已就位，用途尚在讨论中
- [x] **因果图查询无需追加**（§3.3，2026-05-05）：阶段二 `CausalGraphQuery` + 重放 API 已覆盖需求
