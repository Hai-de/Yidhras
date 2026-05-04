# 多轮对话 — 阶段一实现计划

## Progress

| Group | 步骤 | 状态 | 完成日期 |
|-------|------|------|----------|
| A 基础层 | A1 核心类型定义 | ⬜ 待开始 | — |
| | A2 Prisma Schema + 迁移 | ⬜ 待开始 | — |
| | A3 ConversationStore 接口 + Prisma 实现 | ⬜ 待开始 | — |
| | A4 ConversationFormatConfig 类型 + YAML 配置域 | ⬜ 待开始 | — |
| | A5 PromptFragmentSlot 扩展 | ⬜ 待开始 | — |
| B 核心引擎 | B1 ConversationAssembler 实现 | ⬜ 待开始 | — |
| | B2 runConversationHistoryTrack 轨道 | ⬜ 待开始 | — |
| | B3 token_budget_trim 反转裁剪 | ⬜ 待开始 | — |
| C 集成层 | C1 InferenceContext 扩展 | ⬜ 待开始 | — |
| | C2 PromptWorkflowProfile 扩展 | ⬜ 待开始 | — |
| | C3 buildWorkflowPromptBundle 集成 | ⬜ 待开始 | — |
| | C4 静态 profile + 轻量路径 | ⬜ 待开始 | — |
| | C5 推理成功双向事务写入 | ⬜ 待开始 | — |
| | C6 因果链字段写入捕获 | ⬜ 待开始 | — |
| D 验收 | D1 向后兼容验收测试 | ⬜ 待开始 | — |
| | D2 端到端集成测试 | ⬜ 待开始 | — |

---

## 前置条件

- 结构化语法解析器 (`apps/server/src/parser/`) 已完成
- System B 多轨汇合架构 (Phase 1-6) 全部完成
- `PromptWorkflowState.ai_messages` 字段已定义但未使用

---

## Group A: 基础层

### A1 — 核心类型定义

**目标**：定义 `ConversationEntry`、`AgentConversationMemory`、`EntryProvenance`、`EntryModification`、`EntryToolTrace` 等核心类型。

**新建文件**：
- `apps/server/src/conversation/types.ts`

**类型清单**（按设计文档 §6.1、§6.2）：

```typescript
// ConversationEntry — 对话条目的完整类型
// AgentConversationMemory — per-agent 对话记忆容器
// EntryProvenance — 溯源追踪（operator + capability）
// EntryModification — 修改历史记录
// EntryToolTrace — 工具调用摘要
```

**决策要点**：
- `original_content` + `current_content` 双字段，前者不可变
- `kind: 'original' | 'summary'` 区分原始/摘要 entry
- `turn_range` 为 summary entry 专用
- `modifications` 上限 `MAX_MODIFICATIONS_PER_ENTRY = 50`（常量导出，可配置）
- 超限时旧 modifications 折叠为一条归档摘要（`operator.kind = 'data_cleaner'`）

**测试要求**：
- 单元测试：`tests/unit/conversation/types.spec.ts`
  - `EntryModification` 追加不超过上限
  - 超过 50 条时触发归档折叠逻辑
  - `turn_range` 仅在 `kind === 'summary'` 时有意义（不强制但文档化）
- `pnpm typecheck` 零错误

---

### A2 — Prisma Schema + 迁移

**目标**：新增 `ConversationMemory` 和 `ConversationEntryRecord` 两张表。

**修改文件**：
- `apps/server/prisma/schema.prisma`

**表结构**：

```
ConversationMemory:
  - id (String, @id, uuid)
  - owner_agent_id (String)
  - conversation_id (String)
  - summary (String?, @default(null))
  - metadata_json (String?, @default(null))  // JSON 序列化的 metadata
  - created_at (DateTime, @default(now()))
  - updated_at (DateTime, @updatedAt)
  - entries (ConversationEntryRecord[], 1:n)
  - @@unique([owner_agent_id, conversation_id])

ConversationEntryRecord:
  - id (String, @id, uuid)
  - memory_id (String, FK → ConversationMemory, cascade delete)
  - turn_number (Int)
  - speaker_agent_id (String)
  - kind (String, @default("original"))  // 'original' | 'summary'
  - original_content (String)
  - current_content (String)
  - provenance_json (String)  // JSON 序列化的 EntryProvenance
  - modifications_json (String, @default("[]"))  // JSON 序列化的 EntryModification[]
  - recorded_at (DateTime, @default(now()))
  - source_inference_id (String?)
  - derived_from_entry_ids_json (String?)  // JSON 序列化的 string[]
  - turn_range_start (Int?)
  - turn_range_end (Int?)
  - tool_trace_json (String?)  // JSON 序列化的 EntryToolTrace
  - tags_json (String?)  // JSON 序列化的 string[]
  - metadata_json (String?)  // JSON 序列化的 Record<string, unknown>
  - memory (ConversationMemory, relation)
  - @@index([memory_id, turn_number])
```

**决策要点**：
- entry 独立表，规避 JSON 列膨胀
- `provenance`、`modifications`、`tool_trace` 等结构化字段用 JSON 序列化存储（SQLite 无原生 JSON 类型）
- `derived_from_entry_ids` 同样 JSON 序列化
- 不建外键约束到 `InferenceTrace`（因果链是最佳努力引用，§6.10）
- `conversation_id` 不建独立表（阶段一三元组确定性唯一，无独立生命周期）

**测试要求**：
- 集成测试：`tests/integration/conversation/prisma_crud.spec.ts`
  - 创建 `ConversationMemory` + 追加 `ConversationEntryRecord`
  - 级联删除：删 memory → entries 一并删除
  - unique 约束：同一 `(owner_agent_id, conversation_id)` 重复创建报错
- 迁移可逆：`prisma migrate reset` 正常
- `pnpm typecheck` 零错误

---

### A3 — ConversationStore 接口 + Prisma 实现

**目标**：定义 `ConversationStore` 抽象接口，首版用 Prisma + SQLite 实现。

**新建文件**：
- `apps/server/src/conversation/store.ts` — 接口定义
- `apps/server/src/conversation/store_prisma.ts` — Prisma 实现

**接口**（按设计文档 §6.3）：

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

**实现要点**：
- `getOrCreate` 按 `(ownerAgentId, conversationId)` 查找或创建
- `appendEntry` 将 `ConversationEntry` 映射到 `ConversationEntryRecord` 并写入，JSON 字段序列化
- `modifyEntry` 追加 `EntryModification` 到 `modifications_json`，更新 `current_content`，触发上限检查
- `getEntries` 支持分页（`limit` + `before` turn_number 游标）
- Prisma client 通过依赖注入传入（便于测试 mock）

**测试要求**：
- 单元测试：`tests/unit/conversation/store.spec.ts`（mock Prisma client）
  - `getOrCreate` 不存在时创建、存在时返回
  - `appendEntry` 正确序列化 JSON 字段
  - `modifyEntry` 追加修改记录且更新 `current_content`
  - `getEntries` 分页正确（`limit`、`before` 游标）
  - `deleteMemory` 级联删除 entries
- 集成测试：`tests/integration/conversation/store_prisma.spec.ts`
  - 端到端 CRUD，真实 SQLite
  - 事务回滚验证
- `pnpm test:unit` 通过
- `pnpm --filter yidhras-server test:integration` 通过

---

### A4 — ConversationFormatConfig 类型 + YAML 配置域

**目标**：定义 `ConversationFormatConfig` 的 Zod schema + TypeScript 类型，创建配置域，写默认 YAML 配置。

**新建文件**：
- `apps/server/src/conversation/format_config.ts` — Zod schema + TS 类型
- `apps/server/src/config/domains/conversation.ts` — 配置域注册
- `data/configw/conf.d/conversation.yaml` — YAML 配置

**Schema 范围**（阶段一只暴露阶段一字段，§6.4）：

```yaml
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
      # ... 所有现有 slot 的映射
      - slot: conversation_history
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
  compression:
    window_turns: 20
    summary_trigger_turns: 30
    preserve_recent: 5
```

**配置域注册**：遵循现有模式（参考 `prompt_workflow.ts`），`conversation.yaml` 以 conversation profile 形式组织：

```yaml
# data/configw/conf.d/conversation.yaml
conversation:
  profiles:
    chat-first-turn:
      transcript: ...
      message_assembly: ...
      compression: ...
    chat-follow-up:
      transcript: ...
      message_assembly: ...
      compression: ...
```

以及一个 `default` profile 等价于当前 3 消息行为（向后兼容基准）。

**阶段一排除的字段**：`nesting`、`jailbreak_patterns`、`compacted_target_role`、per-speaker format override。

**测试要求**：
- 单元测试：`tests/unit/conversation/format_config.spec.ts`
  - 默认配置 schema 验证通过
  - 缺少必填字段 schema 验证失败
  - 阶段二/三字段不在 schema 中，传入时被 strip 或报错
  - `chat-first-turn` 和 `chat-follow-up` profile 分别验证通过
- YAML 加载集成测试：配置域正确挂载到 config loader
- `pnpm typecheck` 零错误

---

### A5 — PromptFragmentSlot 扩展

**目标**：将 `'conversation_history'` 加入 `PromptFragmentSlot` 联合类型。

**修改文件**：
- `apps/server/src/inference/prompt_slot_config.ts`

**变更**：
```typescript
export type PromptFragmentSlot =
  | 'system_core'
  | 'system_policy'
  | 'role_core'
  | 'world_context'
  | 'memory_short_term'
  | 'memory_long_term'
  | 'memory_summary'
  | 'output_contract'
  | 'post_process'
  | 'conversation_history';  // 新增
```

**级联影响**：需在 slot registry 中注册 `conversation_history` slot 的默认配置（`message_role: 'user'`，作为 transcript 默认嵌入位置，§6.5）。

**测试要求**：
- `pnpm typecheck` 零错误（新增 union 成员后，所有 exhaustiveness check 需覆盖新成员）
- `pnpm lint` 零错误
- 确认 slot registry 中 `conversation_history` 注册正确

---

## Group B: 核心引擎

### B1 — ConversationAssembler 实现

**目标**：实现 `ConversationAssembler`，从 `PromptBundleV2.tree.fragments_by_slot` 读取已处理 fragment，按配置组装 `AiMessage[]`。取代 `adaptPromptTreeToAiMessages`。

**新建文件**：
- `apps/server/src/conversation/assembler.ts`

**修改文件**：
- `apps/server/src/ai/adapters/prompt_tree_adapter.ts` — 标记 deprecated，内部委托给 `ConversationAssembler` 的默认配置实例

**接口**（按设计文档 §6.7）：

```typescript
interface ConversationAssembler {
  assemble(input: {
    bundle: PromptBundleV2;
    memory: AgentConversationMemory;
    formatConfig: ConversationFormatConfig;
    currentAgentId: string;
    taskConfig: AiResolvedTaskConfig;
  }): AiMessage[];
}
```

**组装流程**（9 步，§6.7）：
1. 从 `bundle.tree.fragments_by_slot` 读取 fragment（不做二次渲染）
2. 过滤 `permission_denied` fragment，按 `turn_number` 升序排列
3. Non-conversation slot 按现有行为分组到对应 `message_role`
4. Conversation entries 按 `entry_role` metadata 映射到对应 role 的消息
5. 按 `formatConfig.message_assembly` 合并/排序消息序列
6. 按 `injection` 确定 AI 填充位置
7. 按 `role_format` 添加每条消息的 prefix/suffix
8. 如配置 `merge_consecutive_same_role`，合并相邻同 role 消息
9. 注入 `taskConfig.prompt` 的 `system_append`、`developer_append`、`user_prefix`、`include_sections`、few-shot examples

**向后兼容关键点**：
- 默认配置实例产出的 `AiMessage[]` 必须与当前 `adaptPromptTreeToAiMessages` 逐字段一致
- `taskConfig.prompt` 的特殊处理（preset、append、examples）在组装阶段注入，不在 format config 中处理
- 无 conversation_history fragment 时行为完全退化到现有行为

**测试要求**：
- 单元测试：`tests/unit/conversation/assembler.spec.ts`
  - **向后兼容精确复现**（验收条件）：用默认 YAML 配置调用 assembler，输出与 `adaptPromptTreeToAiMessages` 完全一致。覆盖以下场景：
    - 无 conversation_history fragment 的标准 PromptBundleV2
    - `merge_consecutive_same_role: true` 合并行为一致
    - `system_append` / `developer_append` / `user_prefix` 注入位置一致
    - few-shot examples 注入一致
    - `include_sections` 过滤一致
  - 有 conversation_history fragment 时，entry_role 正确映射到消息 role
  - `merge_consecutive_same_role: false` 时同 role 消息不合并
  - `ai_fill_position` 控制 assistant 槽位位置
  - role_format prefix/suffix 正确添加
  - `permission_denied` fragment 被过滤
- 集成测试：`tests/integration/conversation/assembler.spec.ts`
  - 完整 PromptBundleV2 输入 → AiMessage[] 输出
- `pnpm test:unit` 通过
- `pnpm --filter yidhras-server test:integration` 通过

---

### B2 — runConversationHistoryTrack 轨道

**目标**：实现 `runConversationHistoryTrack`，为每条可见 `ConversationEntry` 产出一条 `PromptSectionDraft`。包含 `getVisibleEntries` 截断逻辑和 `renderEntryText` 渲染函数。

**新建文件**：
- `apps/server/src/context/workflow/tracks/conversation_history_track.ts`
- `apps/server/src/conversation/entry_renderer.ts` — `renderEntryText` 函数

**函数签名**（按设计文档 §6.6）：

```typescript
function runConversationHistoryTrack(input: {
  memory: AgentConversationMemory;
  slotRegistry: Record<string, PromptSlotConfig>;
  formatConfig: ConversationFormatConfig;
  currentAgentId: string;
}): TrackResult<PromptSectionDraft[]>
```

**核心逻辑**：

1. `getVisibleEntries(memory, compression)`：
   - `summaryEntries` 始终包含（不受 `window_turns` 截断）
   - `recentEntries`（`kind !== 'summary'`）受 `window_turns` 截断：取最近 N 条
   - 返回 `[...summaryEntries, ...visibleRecent]`，按 `turn_number` 升序

2. `resolveEntryRole(entry, currentAgentId, formatConfig)`：
   - 一对一场景：`entry.speaker_agent_id === currentAgentId` → `'assistant'`，否则 → `'user'`

3. `renderEntryText(entry, transcriptConfig)`：
   - 调用解析器 `render()` API，用 `speaker_format` 渲染 prefix/suffix
   - 模板变量：`speaker_id`、`turn_number`、`content`
   - 默认 format：`'{speaker_id}": "{content}"'`

4. 每条 entry → 一条 `PromptSectionDraft`：
   - `track: 'conversation_history'`
   - `section_type: 'conversation_history'`
   - `slot: 'conversation_history'`
   - `priority: entry.turn_number`
   - `removable: true`
   - `metadata.entry_role`、`metadata.speaker_agent_id`、`metadata.conversation_entry_kind`

**测试要求**：
- 单元测试：`tests/unit/conversation/conversation_history_track.spec.ts`
  - `getVisibleEntries`：只有 original entries → 截断到 `window_turns`
  - `getVisibleEntries`：有 summary + original entries → summary 全部保留，original 截断
  - `getVisibleEntries`：entries 数 ≤ `window_turns` → 全部返回
  - `getVisibleEntries`：`window_turns` 未设 → 全部返回
  - `resolveEntryRole`：自己发言 → assistant，对方发言 → user
  - `renderEntryText`：默认 format 正确渲染
  - `renderEntryText`：自定义 prefix/suffix 正确应用
  - 轨道产出 draft 数量正确，metadata 字段正确
  - `removable: true`，`priority = turn_number`
- 集成测试：`tests/integration/conversation/track_integration.spec.ts`
  - 完整 input → TrackResult 验证
- `pnpm test:unit` 通过
- `pnpm --filter yidhras-server test:integration` 通过

---

### B3 — token_budget_trim 反转裁剪

**目标**：`token_budget_trim` 管线步骤对 `conversation_history` slot 采用反转裁剪（从最旧 entry 开始裁，保留最近的）。

**修改文件**：
- `apps/server/src/context/workflow/steps/token_budget_trim.ts`（或对应的管线步骤文件）

**逻辑**：
- `conversation_history` slot 的 `default_priority` 设为 50（中等，§6.6）
- 裁剪按 priority 升序（低先裁），对于 conversation_history 这意味着低 turn_number（旧）先裁
- 这是自然行为（`priority = turn_number`，旧条目 priority 低），但需要确认管线裁剪方向是否正确
- 如果管线默认按 priority 降序保留（高先留），则 conversation_history 无需特殊处理
- 如果管线有其他逻辑，需增加 slot 识别特殊分支

**测试要求**：
- 单元测试：`tests/unit/conversation/token_budget_trim.spec.ts`
  - conversation_history fragments：超预算时最旧条目先被裁
  - 非 conversation_history fragments：裁剪行为不变（回归测试）
  - 混合场景：预算不足时 conversation_history 先被裁（priority=50 低于 system/role 的 priority）
- `pnpm test:unit` 通过

---

## Group C: 集成层

### C1 — InferenceContext 扩展

**目标**：`InferenceContext` 增加 `agent_conversation_memory`、`current_agent_id`、`conversation_profile` 字段。

**修改文件**：
- `apps/server/src/inference/types.ts`

**新增字段**：
```typescript
interface InferenceContext {
  // ... 现有字段
  agent_conversation_memory?: AgentConversationMemory;
  current_agent_id?: string;
  conversation_profile?: string;  // 引用 ConversationFormatConfig profile 名称
}
```

**级联影响**：构造 `InferenceContext` 的调用点需传入新字段（可选，阶段一仅对话型推理传入）。

**测试要求**：
- `pnpm typecheck` 零错误（所有构造 InferenceContext 的调用点编译通过）
- 现有测试全部通过（新字段 optional，不破坏现有行为）

---

### C2 — PromptWorkflowProfile 扩展

**目标**：`PromptWorkflowProfile` 增加 `conversation_profile` 字段和 `tracks.conversation_history`。

**修改文件**：
- `apps/server/src/context/workflow/types.ts`
- `apps/server/src/context/workflow/profiles.ts`

**新增字段**：
```typescript
interface PromptWorkflowProfile {
  // ... 现有字段
  tracks?: {
    template?: boolean;
    node?: boolean;
    snapshot?: boolean;
    conversation_history?: boolean;  // 新增
  };
  conversation_profile?: string;  // 新增，引用 YAML profile 名称
}
```

**级联影响**：profile 校验逻辑、profile 选择逻辑。

**测试要求**：
- `pnpm typecheck` 零错误
- 现有 profile 定义不设 `conversation_profile` 时行为不变（回归）
- 单元测试：profile schema 验证包含新字段

---

### C3 — buildWorkflowPromptBundle 集成

**目标**：编排器集成新轨道和 assembler。当 profile 启用 `conversation_history` 轨道时，调用 `runConversationHistoryTrack`。assembler 根据是否有 `conversation_profile` 选择配置。

**修改文件**：
- `apps/server/src/context/workflow/orchestrator.ts`

**变更**：
1. `buildWorkflowPromptBundle` 输入增加 `memory?`、`currentAgentId?`、`conversationProfile?`
2. 当 `profile.tracks.conversation_history === true` 且 `memory` 存在：
   - 调用 `runConversationHistoryTrack({ memory, slotRegistry, formatConfig, currentAgentId })`
   - 结果追加到 `state.section_drafts`
3. 最终组装：不再调用 `adaptPromptTreeToAiMessages`，改为：
   ```typescript
   const assembler = new ConversationAssembler();
   const formatConfig = conversationProfile
     ? loadFormatConfig(conversationProfile)  // 从 YAML 加载
     : DEFAULT_FORMAT_CONFIG;                  // 向后兼容默认配置
   return assembler.assemble({ bundle, memory, formatConfig, currentAgentId, taskConfig });
   ```

**加载 `ConversationFormatConfig`**：通过 config domain 读取 YAML，按 profile 名称查找。

**测试要求**：
- 集成测试：`tests/integration/conversation/orchestrator.spec.ts`
  - profile 未启用 conversation_history → 行为完全不变（回归）
  - profile 启用 conversation_history + 提供 memory → track 被调用，assembler 产出多消息序列
  - 无 memory 时启用 track → 空 conversation_history drafts，不报错
- 现有集成测试全部通过（回归）
- `pnpm typecheck` 零错误

---

### C4 — 静态 profile + 轻量路径

**目标**：定义 `chat-first-turn` 和 `chat-follow-up` 两个 prompt workflow profile，实现轻量路径。

**修改文件**：
- `apps/server/src/context/workflow/profiles.ts`

**Profile 定义**：

```typescript
// chat-first-turn: 完整上下文
{
  id: 'chat-first-turn',
  tracks: {
    template: true,
    node: true,
    snapshot: true,
    conversation_history: true
  },
  conversation_profile: 'chat-first-turn',
  steps: [/* 标准 5 步管线 */]
}

// chat-follow-up: 轻量路径（仅 template + conversation_history）
{
  id: 'chat-follow-up',
  tracks: {
    template: true,
    node: false,
    snapshot: false,
    conversation_history: true
  },
  conversation_profile: 'chat-follow-up',
  steps: [/* 标准 5 步管线 */]
}
```

**Profile 选择逻辑**（按 §6.8）：

```typescript
const profileName = conversation.entries.length === 0
  ? 'chat-first-turn'
  : 'chat-follow-up';
```

该逻辑在调用方（inference service），不在 profile 系统内部。

**测试要求**：
- 单元测试：`tests/unit/conversation/profiles.spec.ts`
  - `chat-first-turn` 启用全部 4 条轨道
  - `chat-follow-up` 仅启用 template + conversation_history
  - `conversation_profile` 字段正确关联到 YAML profile 名
- `pnpm typecheck` 零错误

---

### C5 — 推理成功双向事务写入

**目标**：推理成功后，以事务方式向双方 agent 的 memory 同步写入 `ConversationEntry`。

**修改文件**：
- `apps/server/src/inference/service.ts`（推理响应处理）

**变更**：

```typescript
// 推理响应处理（§5.1）
const result = await inferencePipeline.run(context);
if (result.status === 'success') {
  const entryA = buildConversationEntry({ /* agent A 视角 */ });
  const entryB = buildConversationEntry({ /* agent B 视角 */ });
  await conversationStore.appendEntry(memoryA.id, entryA);
  await conversationStore.appendEntry(memoryB.id, entryB);
  // 注意：两个 appendEntry 需在同一事务中。阶段一 SQLite 单写者模型下，
  // 可用 WAL 模式的串行写入，或包装在 Prisma $transaction 中
}
return result;
```

**关键决策**：
- 写入是推理流程最后一步，写入失败 → 推理标记失败（无需回滚推理结果）
- Agent B entry 的 `provenance.operator.kind = 'agent'`，`capability = 'conversation.record'`
- 双方 entry 写入原子性：阶段一可用 Prisma `$transaction` 包装

**`buildConversationEntry` 辅助函数**：
- 输入：推理结果、speaker/owner agent ID、turn_number、inference_id
- 输出：完整的 `ConversationEntry`（含 `original_content`、`current_content`、`provenance`）

**测试要求**：
- 集成测试：`tests/integration/conversation/writeback.spec.ts`
  - 模拟推理成功 → 双方 memory 各追加一条 entry
  - 事务失败（如 DB 写入错误）→ 双方 memory 均无新 entry
  - turn_number 自动递增
  - `provenance` 字段正确（record 场景）
  - `tool_trace` 摘要正确（如有工具调用）
- `pnpm --filter yidhras-server test:integration` 通过

---

### C6 — 因果链字段写入捕获

**目标**：写入 `ConversationEntry` 时捕获 `source_inference_id` 和 `derived_from_entry_ids`。

**修改文件**：
- `apps/server/src/conversation/store_prisma.ts`（或在 C5 `buildConversationEntry` 中处理）

**变更**：
- `source_inference_id`：来自当前推理的 `inference_id`
- `derived_from_entry_ids`：阶段一仅 AI 摘要压缩场景设置（压缩暂未实现，字段预留）。当前写入时 `undefined`
- 不建索引、不建查询 API、不建外键约束（§6.10）

**测试要求**：
- 集成测试：追加 C5 测试
  - `source_inference_id` 正确写入
  - `derived_from_entry_ids` 为 null（阶段一无压缩）
- `pnpm --filter yidhras-server test:integration` 通过

---

## Group D: 验收

### D1 — 向后兼容验收测试

**目标**：通过专用测试套件验证 `ConversationAssembler` 默认配置与旧 `adaptPromptTreeToAiMessages` 输出精确一致。

**新建文件**：
- `tests/unit/conversation/backward_compat.spec.ts`

**测试策略**：
1. 构造相同的 `PromptBundleV2` 输入
2. 分别调用 `adaptPromptTreeToAiMessages(bundle, taskConfig)` 和 `ConversationAssembler.assemble({ bundle, emptyMemory, defaultFormatConfig, '', taskConfig })`
3. 逐字段比较输出 `AiMessage[]`（role、parts、name、metadata）
4. 覆盖现有 adapter 的所有特殊处理路径：
   - `preset` 选择
   - `system_append` / `developer_append` 追加
   - `user_prefix` 前缀
   - `include_sections` 过滤
   - few-shot examples
   - `merge_consecutive_same_role`
   - heading 前缀格式（`## section_type`）
   - slot grouping 顺序

**验收标准**：
- 所有对比 case 的 `AiMessage[]` 输出完全一致（`expect(actual).toEqual(expected)`）
- 这是阶段一的**硬性门禁**，不通过不可进入阶段二

**测试要求**：
- `pnpm test:unit` 通过（含此套件）

---

### D2 — 端到端集成测试

**目标**：验证完整流程 — memory 创建 → entry 追加 → track 运行 → pipeline 处理 → assembler 组装 → AiMessage[] 产出。

**新建文件**：
- `tests/e2e/conversation_flow.spec.ts`

**测试场景**：
1. **首轮对话**：空 memory → `chat-first-turn` profile → 4 条轨道 → 标准消息序列（含 conversation_history slot 但无实际 entry）
2. **多轮对话**：memory 含 5 条 entries → `chat-follow-up` profile → 2 条轨道 → 多角色消息序列（user/assistant 交替）
3. **滑动窗口截断**：memory 含 30 条 entries，`window_turns: 10` → 仅最近 10 条出现在 fragment 中
4. **双向写入**：模拟推理成功 → 双方 memory 都有新 entry
5. **事务原子性**：写入中途失败 → 双方 memory 均无 partial 数据
6. **向后兼容路径**：无 conversation_profile → 行为与现有推理完全一致

**测试要求**：
- `pnpm --filter yidhras-server test:e2e` 通过
- 每个场景的 `AiMessage[]` 结构可验证（role 序列、content 包含关键文本）

---

## 文件变更汇总

| 操作 | 路径 | 所属步骤 |
|------|------|----------|
| 新建 | `apps/server/src/conversation/types.ts` | A1 |
| 修改 | `apps/server/prisma/schema.prisma` | A2 |
| 新建 | `apps/server/src/conversation/store.ts` | A3 |
| 新建 | `apps/server/src/conversation/store_prisma.ts` | A3 |
| 新建 | `apps/server/src/conversation/format_config.ts` | A4 |
| 新建 | `apps/server/src/config/domains/conversation.ts` | A4 |
| 新建 | `data/configw/conf.d/conversation.yaml` | A4 |
| 修改 | `apps/server/src/inference/prompt_slot_config.ts` | A5 |
| 新建 | `apps/server/src/conversation/assembler.ts` | B1 |
| 修改 | `apps/server/src/ai/adapters/prompt_tree_adapter.ts` | B1 |
| 新建 | `apps/server/src/conversation/entry_renderer.ts` | B2 |
| 新建 | `apps/server/src/context/workflow/tracks/conversation_history_track.ts` | B2 |
| 修改 | `apps/server/src/context/workflow/steps/token_budget_trim.ts` | B3 |
| 修改 | `apps/server/src/inference/types.ts` | C1 |
| 修改 | `apps/server/src/context/workflow/types.ts` | C2 |
| 修改 | `apps/server/src/context/workflow/profiles.ts` | C2, C4 |
| 修改 | `apps/server/src/context/workflow/orchestrator.ts` | C3 |
| 修改 | `apps/server/src/inference/service.ts` | C5, C6 |

| 操作 | 路径 | 所属步骤 |
|------|------|----------|
| 新建 | `tests/unit/conversation/types.spec.ts` | A1 |
| 新建 | `tests/integration/conversation/prisma_crud.spec.ts` | A2 |
| 新建 | `tests/unit/conversation/store.spec.ts` | A3 |
| 新建 | `tests/integration/conversation/store_prisma.spec.ts` | A3 |
| 新建 | `tests/unit/conversation/format_config.spec.ts` | A4 |
| 新建 | `tests/unit/conversation/assembler.spec.ts` | B1 |
| 新建 | `tests/integration/conversation/assembler.spec.ts` | B1 |
| 新建 | `tests/unit/conversation/conversation_history_track.spec.ts` | B2 |
| 新建 | `tests/integration/conversation/track_integration.spec.ts` | B2 |
| 新建 | `tests/unit/conversation/token_budget_trim.spec.ts` | B3 |
| 新建 | `tests/integration/conversation/orchestrator.spec.ts` | C3 |
| 新建 | `tests/unit/conversation/profiles.spec.ts` | C4 |
| 新建 | `tests/integration/conversation/writeback.spec.ts` | C5, C6 |
| 新建 | `tests/unit/conversation/backward_compat.spec.ts` | D1 |
| 新建 | `tests/e2e/conversation_flow.spec.ts` | D2 |

---

## 执行顺序与依赖

```
A1 ──→ A2 ──→ A3
               │
A4 ───────────┼──→ B1 ──→ C3 ──→ C5 ──→ C6
               │                  │
A5 ───────────┼──→ B2 ──────────┘
               │
               └──→ B3 ──────────┘

C1 ──→ C2 ──→ C3
C4 (依赖 C2, A4)

D1 (依赖 B1, 可与 C 并行)
D2 (依赖 C3, C5, C6)
```

**推荐实施顺序**：
1. A1 + A4 + A5 → 可并行（无内部依赖）
2. A2 → 依赖 A1 类型定义
3. A3 → 依赖 A1 + A2
4. B1 + B2 + B3 → 可并行（依赖 A 组完成）
5. C1 + C2 → 可并行
6. C3 → 依赖 B1 + B2 + C1 + C2
7. C4 → 依赖 C2 + A4
8. C5 + C6 → 依赖 C3 + A3
9. D1 → 依赖 B1
10. D2 → 依赖 C5 + C6

---

## 校验方式

- **每步**：`pnpm typecheck && pnpm lint` 零错误
- **每步**：相关测试通过
- **A 组完成**：`pnpm test:unit` 全部通过
- **B 组完成**：`pnpm test:unit && pnpm --filter yidhras-server test:integration` 全部通过
- **C 组完成**：同上 + 手动 e2e 烟雾测试
- **D 组完成（阶段一退出标准）**：
  - `pnpm typecheck && pnpm lint` 零错误
  - `pnpm test` 全部通过
  - D1 向后兼容套件全部通过（硬性门禁）
  - D2 e2e 套件全部通过
  - `pnpm dev` 启动无报错，现有功能无回归
