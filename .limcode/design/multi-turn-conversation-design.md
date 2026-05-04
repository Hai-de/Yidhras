# 多轮对话（Multi-Turn Conversation）设计草稿

## 状态说明

本文档是 TODO.md "多轮对话"项的前置设计草稿。目标是设计跨推理请求的对话持久化、增量上下文构建、
消息格式和压缩机制。

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

### 1.3 对话模式范围

- **一对一 agent 对话**：阶段一实现
- **一对多 / 多对多 agent 对话**：阶段一类型设计预留扩展点，阶段二/三实现

在一对多和多对多场景中，不存在"对方 = user"的角色映射。所有 agent 以各自身份发言，
整个对话 transcript 作为一个整体结构嵌入模型消息中（见 §2.2）。

---

## 2. 发往模型时的消息组装

### 2.1 核心思路：可配置的对话结构组装引擎

对话记忆（`AgentConversationMemory`）不直接按固定规则映射为 `AiMessage[]`。
而是通过一个**可配置的组装引擎**，根据 YAML/JSON 配置决定：
- 对话 transcript 如何格式化（每个 speaker 的前缀/后缀、轮次分隔符、嵌套结构）
- 格式化后的内容如何映射到模型消息序列（消息级别 placement）
- AI 在消息序列的哪个位置填充输出
- 如何利用格式技巧（未闭合符号等）引导模型在指定位置续写

### 2.2 一对一场景：传统角色映射

assistant1 发往模型：
```
turn 1: assistant: "你好，我是assistant1"
turn 1: user: "好久不见，我是assistant2"
turn 2: assistant: "今天天气如何？"
turn 2: user: "今天天气非常好"
```

对方 agent → `user` 角色，自己 → `assistant` 角色。这是最简单的配置。

### 2.3 多 agent 场景：Transcript 嵌入

操控员没空一个个和 agent 聊天。多个 agent 的对话直接作为 transcript 嵌入一条消息内部：

原始对话记忆：
```
turn 1: assistant9: "你好，我是assistant9"
turn 1: assistant2: "好久不见，我是assistant2"
turn 2: assistant4: "今天天气如何？"
turn 2: assistant7: "今天天气非常好"
```

发往模型时，整个 transcript 嵌入 `user` 消息内部。不再有单一的"对方 = user"映射。

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

### 2.5 伪 Role 格式注入（越狱工程）

通过在 transcript 中故意留下未闭合的语法结构，利用模型补全下一个 token 的倾向，
引导模型在指定位置续写内容：

```
user content:
    "assistant9": "你好，我是assistant9"
    "assistant2": "好久不见，我是assistant2"
    "assistant4": "今天天气如何？"
    "assistant7": "今天天气非常好"
    {
```

故意留下未闭合的 `{`。模型倾向于补全 `}` 以及其内部的内容，
这恰好是当前 agent 需要输出的回复。assistant 角色的消息内容从 `}` 开始。

**这不需要模型侧的特殊支持，是纯 token 预测行为。** 唯一代价是 user 消息内塞入了超长上下文。

### 2.6 压缩到单一 Role

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
                        │     ├── nesting_rules
                        │     └── jailbreak_patterns (未闭合符号等)
                        │
                        ├── message_assembly        ← 格式化后内容如何映射到 AiMessage[]
                        │     ├── slot → message_role 映射
                        │     ├── merge_consecutive_same_role
                        │     ├── ai_fill_position
                        │     ├── message_prefix / suffix (per role)
                        │     └── injection_points
                        │
                        └── compression             ← 压缩策略
                              ├── window_size (轮数或 token 数)
                              ├── summary_trigger_threshold
                              ├── compacted_target_role (折叠到 system/user/developer)
                              └── compaction_preserve_recent_n
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
ConversationAssembler (新增)
  │
  ├── 1. 加载 ConversationFormatConfig
  ├── 2. 渲染 transcript: entries → 格式化文本 (按 transcript_format 规则)
  ├── 3. 压缩 (如果需要): 超出窗口 → 摘要 → 折叠到目标 role
  ├── 4. 消息组装: 格式化文本 + slot 内容 → AiMessage[] (按 message_assembly 规则)
  ├── 5. 注入点处理: 在 ai_fill_position 处插入空的 assistant 槽位
  └── 6. 产出 AiMessage[]
       │
       ▼
AI Gateway (现有，不变)
```

### 3.3 与现有 System B 的关系

`ConversationAssembler` 取代了 `adaptPromptTreeToAiMessages` 的角色，
但不是完全替换 — 它是一个超集：

- 现有适配器逻辑 = `ConversationAssembler` 的一种特定配置（3 条消息，按 slot role 分组）
- 多轮对话逻辑 = 另一种配置（多消息、transcript 嵌入、注入点）
- 两种配置可共存，由 `PromptWorkflowProfile` 或 task_type 选择

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
| 7 | ~~无结构化语法解析器~~ ✅ 已完成 | `apps/server/src/parser/` | `STRUCTURED_PARSER.md` §2-§6 |

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
  ├── 渲染 transcript + 压缩 + 消息序列组装
  └── 产出 AiMessage[]
       │
       ▼
AI Gateway (现有，不变)
```

### 5.2 两条路径

- **完整流水线**（首轮 / 复杂任务）：四条轨道 + 完整 pipeline
- **轻量路径**（后续简单轮次）：`conversation_history` + `template` 轨道，跳过节点轨和快照轨

轻量路径由 `profile.tracks` 控制，现有机制已支持。

---

## 6. 开放性问题

### 6.1 对话记忆的核心类型：`ConversationEntry`

**已确认方向**：自定义类型，不复用 `AiMessage`。

```typescript
interface ConversationEntry {
  id: string;
  turn_number: number;
  speaker_agent_id: string;        // 谁说的（原始说话者）

  // 内容
  original_content: string;        // 首次记录的内容
  current_content: string;         // 当前内容（可能被修改过）

  // 溯源追踪
  recorded_by: string;             // agent_id / 'user' / 'plugin:<id>'
  recorded_at: number;
  modifications: EntryModification[];

  // 元数据
  tags?: string[];
  metadata?: Record<string, unknown>;
}

interface EntryModification {
  modified_by: string;             // agent_id / 'user' / 'plugin:<id>' / 'data_cleaner:<rule>'
  modified_at: number;
  previous_content: string;
  new_content: string;
  reason?: string;
}
```

**待讨论**：
- `original_content` 和 `current_content` 是否都需要，还是只保留 content + modifications 链？
- `modifications` 保留完整历史还是最近 N 次？
- content 是纯文本还是支持结构化？

---

### 6.2 溯源追踪粒度

场景：
- 用户 CLI 手动修改 → `modified_by: 'user'`
- 正则过滤器匹配替换 → `modified_by: 'data_cleaner:regex'`
- Agent 插入伪造对话 → `recorded_by: 'agent:<id>'`
- 插件 hook 修改 → `modified_by: 'plugin:<plugin_id>'`

选项：

- **A. 字符串约定**：`agent:<id>` / `user` / `plugin:<id>` / `data_cleaner:<rule_id>`
- **B. 结构化类型**：`{ kind: 'agent'|'user'|'plugin'|'data_cleaner'; id: string; rule?: string }`
- **C. 操作者 + 能力**：附加 `capability: 'conversation.insert' | 'conversation.modify' | 'conversation.delete'`

---

### 6.3 持久化方案

- **A. Prisma + SQLite 新表**：`ConversationMemory` 模型，entries 为 JSON 列
- **B. ConversationStore 抽象**：接口 + SQLite 实现，后续可替换
- **C. 复用 Memory 系统**：对话记忆作为特殊 ContextNode 类型

---

### 6.4 `ConversationFormatConfig` 的配置格式

**问题**：组装引擎的配置用什么格式？YAML 还是 TypeScript 类型？

```yaml
# 示例：多 agent transcript 嵌入 user 消息的配置
conversation_format:
  transcript:
    turn_delimiter: "\n"
    speaker_format:
      default:
        prefix: '"{speaker_id}": "'
        suffix: '"'
    nesting:
      open_marker: "{"
      close_marker: "}"
      # 可以故意不闭合 open_marker 来实现 jailbreak 注入
      auto_close: false

  message_assembly:
    merge_consecutive_same_role: false  # system 消息是否合并
    slots:
      - slot: system_core
        target_role: system
      - slot: conversation_history
        target_role: user              # transcript 嵌入 user 消息
        placement: before_assistant    # 放在 assistant 消息之前
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
    strategy: summary_window           # summary | window | summary_window
    window_turns: 20
    summary_trigger_turns: 30
    compacted_target_role: system      # 折叠到 system 消息
    preserve_recent: 5                 # 压缩时保留最近 N 轮全量
```

`parser_syntax` 字段直接映射到 `ParserSyntaxConfig`（`STRUCTURED_PARSER.md` §6.2），
为可选字段 — 不传时解析器使用默认 `{...}` / `{{...}}` 语法。

**待讨论**：
- 配置存在哪里？（`data/configw/` 还是独立的 conversation profile？）
- 是全局配置还是 per-conversation 可覆盖？
- 配置如何关联到 `PromptWorkflowProfile`？

---

### 6.5 新增 slot：`conversation_history`

建议新增 `'conversation_history'` 到 `PromptFragmentSlot` 联合类型。

与 §5.4 旧版讨论不同：该 slot 不再面临 `message_role` 矛盾。
`ConversationAssembler` 直接从 `AgentConversationMemory` 构建多角色消息序列，
不通过 slot 的 `message_role` 做单值路由。slot 的 `message_role` 可设为
`user`（作为 transcript 的默认嵌入位置），但实际组装由 `ConversationFormatConfig` 控制。

---

### 6.6 `runConversationHistoryTrack` 轨道

```typescript
function runConversationHistoryTrack(input: {
  memory: AgentConversationMemory;
  slotRegistry: Record<string, PromptSlotConfig>;
  formatConfig: ConversationFormatConfig;
  currentAgentId: string;
}): TrackResult<PromptSectionDraft[]>;
```

轨道职责：
1. 从 `AgentConversationMemory` 加载对话记忆
2. 根据 `formatConfig.transcript` 规则渲染 transcript 文本
3. 根据 `formatConfig.compression` 规则决定是否需要压缩/截断
4. 产出一个或多个 `PromptSectionDraft`（section_type: `'conversation_history'`）

**子问题**：压缩逻辑在轨道内还是轨道外？
- 轨道内：压缩后的内容直接进入 section_draft，后续 pipeline 无感知
- 轨道外（独立 compaction 步骤）：可追踪压缩操作本身作为 `EntryModification`

---

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
1. 从 `PromptBundleV2` 提取 slot 文本（system_core, role_core 等）
2. 按 `formatConfig.message_assembly.slots` 将 slot 映射到对应 role 的消息
3. 从 `AgentConversationMemory` 渲染 transcript，注入到目标 role 的消息
4. 按 `formatConfig.message_assembly.injection` 确定 AI 填充位置
5. 按 `formatConfig.message_assembly.role_format` 添加每条消息的前缀/后缀
6. 如配置 `merge_consecutive_same_role`，合并相邻同 role 消息
7. 产出最终 `AiMessage[]`

该组件取代现有的 `adaptPromptTreeToAiMessages`，但向后兼容 —
现有行为是 `ConversationAssembler` 的一个默认配置实例。

---

### 6.8 轻量路径与轨道选择

| 场景 | 轨道 | 说明 |
|------|------|------|
| 首轮 | 全部 4 条 | 完整上下文 |
| 简单追问 | template + conversation_history | 世界未变 |
| 世界状态变更 | template + conversation_history + snapshot | — |
| memory compaction | template + node + conversation_history | — |

选项：
- **A. 多个静态 profile**：`chat-first-turn`、`chat-follow-up`
- **B. 调用方动态选择**
- **C. 自适应检测**

---

### 6.9 与 `tool_loop_runner` 的关系

- **A. 统一写入 `AgentConversationMemory`**：工具调用中间消息作为 ConversationEntry
- **B. 分层**：tool_loop_runner 保持单次循环，最终回复批量写入
- **C. 废弃 tool_loop_runner**：完全由多轮对话承载

---

### 6.10 跨推理因果链

- **A. 引用链**：`ConversationEntry.source_inference_id`
- **B. 延迟**：首版只记录 inference_id，不做完整因果图

---

### 6.11 一对多 / 多对多对话

多 agent 场景下不再有 "对方 = user" 的映射。所有 agent 以各自身份出现在 transcript 中。
`ConversationFormatConfig.transcript.speaker_format` 支持 per-speaker 覆盖：

```yaml
speaker_format:
  default:
    prefix: '"{speaker_id}": "'
    suffix: '"\n'
  assistant9:                          # 特定 agent 的自定义格式
    prefix: '[助理9] '
    suffix: '\n'
```

当前 agent 自己的消息在 transcript 中如何标记（高亮？加粗？注入点前？）也由配置决定。

---

## 7. 优先级与分期

### 阶段一（核心：持久化 + 组装引擎 + 一对一）

1. `ConversationEntry` + `AgentConversationMemory` 类型定义
2. 持久化（方案待 §6.3 结论）
3. `ConversationFormatConfig` 类型 + YAML schema 定义
4. `ConversationAssembler` 实现（取代 `adaptPromptTreeToAiMessages`）
5. `runConversationHistoryTrack` 轨道
6. `InferenceContext` 扩展
7. 轻量路径 profile
8. 基础压缩（滑动窗口）

### 阶段二（多 agent + 注入点 + 摘要）

1. 多 agent transcript 嵌入
2. 消息级别 placement（AI 注入点）
3. 伪 role 格式注入（jailbreak 模式）
4. 摘要压缩
5. 压缩到单一 role

### 阶段三（高级特性）

1. 自适应轨道选择
2. 与 `tool_loop_runner` 统一
3. Tag 系统
4. 完整的跨推理因果图

### 前置依赖

- **结构化语法解析器**（`apps/server/src/parser/`，`docs/capabilities/STRUCTURED_PARSER.md`）：
  已完成实现。`render()` 一步渲染 API 覆盖阶段一所需的全部模板能力（speaker_format
  prefix/suffix、role_format、turn_delimiter 等）。`createParser()` 工厂模式为阶段二的
  自定义修饰符/块处理器提供扩展点。不再有阻塞阶段一的解析器缺口。

---

## 8. 决策记录

### 已确认

- [x] **消息存储格式**（§6.1）：自定义 `ConversationEntry` 类型。`AiMessage` 是传输格式，`ConversationEntry` 是持久化格式
- [x] **Agent 中心化**（§1）：每个 agent 持有自己的对话记忆副本。项目不保证完整性，只保证可被追踪性
- [x] **可配置组装引擎**（§2-3）：`ConversationFormatConfig` + `ConversationAssembler` 取代硬编码的 `adaptPromptTreeToAiMessages`
- [x] **多 agent 场景不映射 user 角色**（§2.3）：多 agent transcript 直接嵌入消息内部，不做 agent→user 映射
- [x] **ConversationAssembler 向后兼容**（§6.7）：现有 3 条消息行为是默认配置实例
- [x] **结构化语法解析器**（§3.4）：`apps/server/src/parser/` 已完成实现，`render()` /
  `createParser()` / `parseTemplate() → renderAst()` 三种 API 覆盖阶段一至阶段二的模板需求。
  `ConversationFormatConfig.parser_syntax` 直接映射到 `ParserSyntaxConfig`。

### 待确认

- [ ] §6.1 `ConversationEntry` 字段细节（original_content 必要性、modifications 深度、content 类型）
- [ ] §6.2 溯源追踪粒度（字符串 vs 结构化 vs 能力标注）
- [ ] §6.3 持久化方案（Prisma JSON vs ConversationStore 抽象 vs Memory 系统）
- [ ] §6.4 `ConversationFormatConfig` 配置位置和 scope（全局 vs per-conversation）
- [ ] §6.6 压缩逻辑在轨道内还是轨道外
- [ ] §6.8 轻量路径策略（静态 profile vs 动态 vs 自适应）
- [ ] §6.9 tool_loop_runner 关系
- [ ] §6.10 因果链复杂度
