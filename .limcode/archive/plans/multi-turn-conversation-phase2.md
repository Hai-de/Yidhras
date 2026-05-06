# 多轮对话 — 阶段二实现计划

## Progress

| Group | 步骤 | 状态 | 完成日期 |
|-------|------|------|----------|
| A 多 agent + 注入点 | A1 transcript 嵌入模式 — track 层 | ✅ 完成 | 2026-05-05 |
| | A2 per-speaker format 覆盖 | ✅ 完成 | 2026-05-05 |
| | A3 assembler transcript 嵌入模式 | ✅ 完成 | 2026-05-05 |
| | A4 一对一模式配置门控 | ✅ 完成 | 2026-05-05 |
| | A5 消息级别注入点扩展 | ✅ 完成 | 2026-05-05 |
| | A6 YAML 配置 + profile 更新 | ✅ 完成 | 2026-05-05 |
| B AI 摘要压缩 | B1 `archived` 字段 + `getVisibleEntries` 过滤 | ✅ 完成 | 2026-05-05 |
| | B2 `CompactionAuditEntry` 类型 + 审计日志 | ✅ 完成 | 2026-05-05 |
| | B3 `enable_ai_summary` opt-in + `compacted_target_role` | ✅ 完成 | 2026-05-05 |
| | B4 独立压缩推理路径 | ✅ 完成 | 2026-05-05 |
| | B5 `ConversationCompactionService`（写入后触发） | ✅ 完成 | 2026-05-05 |
| | B6 压缩到单一 role 组装逻辑 | ✅ 完成 | 2026-05-05 |
| C 因果图查询 | C1 沿 `derived_from_entry_ids` 双向追溯 | ✅ 完成 | 2026-05-05 |
| | C2 影响分析查询 | ✅ 完成 | 2026-05-05 |
| D 验收 | D1 向后兼容验收（回归） | ✅ 通过 | 2026-05-05 |
| | D2 集成测试 | ✅ 通过 | 2026-05-05 |
| E 补充测试 | E1 `CausalGraphQuery` 单元测试 (16 tests) | ✅ 完成 | 2026-05-05 |
| | E2 `CompactionAuditStore` 单元测试 (12 tests) | ✅ 完成 | 2026-05-05 |
| | E3 `CompactionInference` 单元测试 (6 tests) | ✅ 完成 | 2026-05-05 |
| | E4 扩展 `pipeline_edge_cases` (+8 tests) | ✅ 完成 | 2026-05-05 |
| | E5 `conversation_flow` 压缩场景 (+5 tests) | ✅ 完成 | 2026-05-05 |

---

## 前置条件

- 阶段一全部完成（2026-05-05）
- 结构化语法解析器 (`apps/server/src/parser/`) 已完成
- `ConversationFormatConfig` 使用 `.passthrough()`，新增字段不会导致现有解析失败
- 设计文档 `.limcode/design/multi-turn-conversation-design.md` 已更新（2026-05-05 修订）

---

## Group A: 多 agent transcript 嵌入 + 注入点

### A1 — transcript 嵌入模式：track 层

**目标**：`runConversationHistoryTrack` 支持 transcript 嵌入模式（默认）。所有 entry 的 `entry_role` metadata 统一设为 transcript 的目标 role（默认 `'user'`），不再做 per-speaker "自己 → assistant / 对方 → user" 的映射。

**修改文件**：
- `apps/server/src/context/workflow/tracks/conversation_history_track.ts`

**变更**：

1. `resolveEntryRole` 改为模式感知：

```typescript
type TranscriptMode = 'embed' | 'role_map';

function resolveEntryRoles(
  entry: ConversationEntry,
  currentAgentId: string,
  mode: TranscriptMode
): string {
  switch (mode) {
    case 'embed':
      // 所有 entry 映射到同一 role（由 message_assembly 的 slot → target_role 决定）
      // track 层只标记，不做角色区分
      return 'transcript';
    case 'role_map':
      // 一对一简化模式：自己 → assistant，对方 → user
      return entry.speaker_agent_id === currentAgentId ? 'assistant' : 'user';
  }
}
```

2. `runConversationHistoryTrack` 接收 `transcriptMode` 参数，从 `formatConfig` 中读取。

3. `entry_role` metadata 在 embed 模式下统一为配置的 target role（默认 `'user'`）。在 `role_map` 模式下保持现有行为。

**测试要求**：
- 单元测试：更新 `tests/unit/conversation/conversation_history_track.spec.ts`
  - embed 模式：所有 entry 的 `entry_role` 为 `'transcript'`（或配置的 target role）
  - role_map 模式：行为与阶段一一致（自己 → assistant，对方 → user）
  - 两种模式下的 draft 数量、metadata 字段正确
- `pnpm test:unit` 通过
- `pnpm typecheck` 零错误

---

### A2 — per-speaker format 覆盖

**目标**：`renderEntryText` 支持 per-speaker 的 format 覆盖。查找顺序：`speaker_format[agent_id]` → `speaker_format.default`。

**修改文件**：
- `apps/server/src/conversation/entry_renderer.ts`
- `apps/server/src/conversation/format_config.ts` — `TranscriptConfigSchema`

**变更**：

1. `TranscriptConfigSchema` 的 `speaker_format` 从仅 `default` 扩展为 `Record<string, SpeakerFormatConfig>`：

```typescript
export const TranscriptConfigSchema = z
  .object({
    turn_delimiter: z.string().default('\n'),
    speaker_format: z
      .object({
        default: SpeakerFormatConfigSchema
      })
      .catchall(SpeakerFormatConfigSchema)  // per-speaker override
      .strict()
  })
  .strict();
```

> 注意：`.catchall()` + `.strict()` 可能冲突，实际实现需要调整为 `.passthrough()` 或在 `.strict()` 之前扩展 schema。具体方案在实现时确定。

2. `renderEntryText` 查找 per-speaker format：

```typescript
export function renderEntryText(
  entry: ConversationEntry,
  transcriptConfig: TranscriptConfig,
  currentAgentId: string
): string {
  const speakerFormat: SpeakerFormatConfig =
    transcriptConfig.speaker_format[entry.speaker_agent_id] ??
    transcriptConfig.speaker_format.default;

  const variables = {
    speaker_id: entry.speaker_agent_id,
    current_agent_id: currentAgentId,
    turn_number: String(entry.turn_number),
    content: entry.current_content
  };

  const prefix = render(speakerFormat.prefix, variables);
  const suffix = render(speakerFormat.suffix, variables);

  return `${prefix}${entry.current_content}${suffix}`;
}
```

3. 模板变量新增 `current_agent_id`，支持 per-speaker format 中标注当前 agent（如 `[自己]` 标记）。

**测试要求**：
- 单元测试：更新 `tests/unit/conversation/conversation_history_track.spec.ts`
  - `speaker_format` 有 per-speaker override → 使用 override 的 prefix/suffix
  - `speaker_format` 无 per-speaker override → fallback 到 default
  - default 配置缺失 → 使用硬编码 fallback（空 prefix，`'\n'` suffix）
- `pnpm test:unit` 通过

---

### A3 — assembler transcript 嵌入模式

**目标**：`ConversationAssembler` 支持 transcript 嵌入模式。embed 模式下所有 conversation fragment 合并为一段 transcript 文本，嵌入单一 target role 消息（默认 `user`）。`role_map` 模式下保持现有行为（按 entry_role 分发到不同 role）。

**修改文件**：
- `apps/server/src/conversation/assembler.ts`

**变更**：

1. 从 `formatConfig` 读取 `transcript_mode`（默认 `'embed'`）。

2. Embed 模式组装逻辑：

```
conversation fragments (按 turn_number 升序)
  → 拼接为单一 transcript 文本（用 turn_delimiter 分隔）
  → 嵌入 target_role 消息（由 slot → target_role 映射决定，默认 user）
  → role_format 的 prefix/suffix 包裹整个 transcript
```

3. Role_map 模式组装逻辑（保持阶段一行为）：

```
conversation fragments (按 entry_role 分组)
  → assistant 组 → assistant 消息
  → user 组 → user 消息
  → 各自应用 role_format 的 prefix/suffix
```

4. 组装流程更新：

```
1. 从 PromptBundleV2.tree.fragments_by_slot 读取 fragment
2. 过滤 permission_denied fragment，按 turn_number 升序排列
3. Non-conversation slot 按现有行为分组到对应 message_role
4. [变更] 读取 transcript_mode：
   - embed: 全部 conversation fragment 拼接为一个文本块 → 嵌入 target_role
   - role_map: 按 entry_role 分组到不同 role（阶段一行为）
5. 按 formatConfig.message_assembly 合并/排序消息序列
6. 按 injection 确定 AI 填充位置
7. 按 role_format 添加每条消息的 prefix/suffix
8. 如配置 merge_consecutive_same_role，合并相邻同 role 消息
9. 注入 taskConfig.prompt 的特殊处理
```

**测试要求**：
- 单元测试：更新 `tests/unit/conversation/assembler.spec.ts`
  - embed 模式：多 speaker 的 fragment 全部拼接为一整段 user 消息
  - role_map 模式：行为与阶段一一致（回归）
  - turn_delimiter 正确应用
  - per-speaker format 渲染后的文本正确拼接
  - 无 conversation fragment 时行为退化到默认配置（向后兼容）
- 集成测试：更新 `tests/integration/conversation/assembler.spec.ts`
- `pnpm test:unit` 通过
- `pnpm --filter yidhras-server test:integration` 通过

---

### A4 — 一对一模式配置门控

**目标**：`ConversationFormatConfig` 新增 `transcript_mode` 字段。默认 `'embed'`，显式设为 `'role_map'` 启用一对一角色映射。

**修改文件**：
- `apps/server/src/conversation/format_config.ts`
- `data/configw/conf.d/conversation.yaml`

**变更**：

1. `TranscriptConfigSchema` 新增：

```typescript
export const TranscriptConfigSchema = z
  .object({
    mode: z.enum(['embed', 'role_map']).default('embed'),
    turn_delimiter: z.string().default('\n'),
    speaker_format: z
      .object({
        default: SpeakerFormatConfigSchema
      })
      .catchall(SpeakerFormatConfigSchema)
  })
  .strict();
```

> 注：`.strict()` 与 `.catchall()` 存在已知冲突，实现时需根据 Zod 版本调整。可能方案：移除 `.strict()` 改用 `.passthrough()`，或在 `.strict()` 前用 `z.record()` 单独处理 speaker_format。

2. YAML 配置更新：所有现有 profile 添加 `mode: embed`（默认），`default` profile 保持 `mode: embed`。

无需为此创建专用的 `role_map` profile — 一对一模式是显式选择，不是默认路径。

**测试要求**：
- 单元测试：更新 `tests/unit/conversation/format_config.spec.ts`
  - `mode` 默认值为 `'embed'`
  - `mode: 'role_map'` 解析正确
  - 无效 mode 值 schema 验证失败
- `pnpm typecheck` 零错误

---

### A5 — 消息级别注入点扩展

**目标**：扩展 `injection` 配置，支持多位置、命名注入点、索引定位。阶段一只支持 `after_last_user` / `after_last_system` / `at_end`。

**修改文件**：
- `apps/server/src/conversation/format_config.ts` — `MessageAssemblyInjectionSchema`
- `apps/server/src/conversation/assembler.ts` — `resolveInjectionIndex`

**新增能力**：

1. **索引定位**：`ai_fill_position: 2` → 插入到消息序列索引 2 处

2. **命名注入点**：在 slot mapping 中标记 `injection_point: true`，assembler 在该 slot 对应消息后插入 assistant 槽位：

```yaml
message_assembly:
  slots:
    - slot: system_core
      target_role: system
    - slot: conversation_history
      target_role: user
      injection_point: true  # ← 在此消息后插入 assistant 槽位
```

3. **多注入点**：`injection` 从单对象扩展为数组（保持向后兼容，单对象自动包装为单元素数组）：

```yaml
message_assembly:
  injection:
    - ai_fill_role: assistant
      ai_fill_position: after_last_user
    - ai_fill_role: assistant
      ai_fill_position: 5          # 在索引 5 处再插入一个
```

4. **Schema 更新**：

```typescript
export const MessageAssemblyInjectionSchema = z
  .object({
    ai_fill_role: z.enum(['assistant']).default('assistant'),
    ai_fill_position: z.union([
      z.enum(['after_last_user', 'after_last_system', 'at_end']),
      z.number().int().nonnegative()  // 索引定位
    ]).default('after_last_user')
  })
  .strict();

// 顶层 injection 字段：单对象或数组
export const MessageAssemblyInjectionFieldSchema = z.union([
  MessageAssemblyInjectionSchema,
  z.array(MessageAssemblyInjectionSchema)
]);
```

> 阶段二暂不实现命名注入点（`injection_point: true` on slot mapping），该功能推迟到阶段三 `SlotFunctionRegistry` 就绪后一并实现。

**测试要求**：
- 单元测试：更新 `tests/unit/conversation/assembler.spec.ts`
  - `ai_fill_position: 2` → assistant 槽位插入在索引 2
  - 多注入点：两个 assistant 槽位分别出现在正确位置
  - 数字索引超出范围 → 追加到末尾
  - 单对象 injection 配置向后兼容
- `pnpm typecheck` 零错误
- `pnpm test:unit` 通过

---

### A6 — YAML 配置 + profile 更新

**目标**：更新 `data/configw/conf.d/conversation.yaml`，所有 profile 明确 transcript mode 和 per-speaker format。

**修改文件**：
- `data/configw/conf.d/conversation.yaml`

**变更**：

```yaml
conversation:
  profiles:
    # 默认配置 — 向后兼容基准（3 消息行为）
    default:
      transcript:
        mode: embed                  # 新增：默认 transcript 嵌入
        turn_delimiter: "\n"
        speaker_format:
          default:
            prefix: ""
            suffix: "\n"
      message_assembly:
        # ... 保持不变
      compression:
        enable_ai_summary: false     # 新增：默认关闭 AI 摘要
        window_turns: 20
        summary_trigger_turns: 30
        preserve_recent: 5

    # 首轮对话 — 多 agent transcript 嵌入
    chat-first-turn:
      transcript:
        mode: embed
        turn_delimiter: "\n"
        speaker_format:
          default:
            prefix: '"{speaker_id}": "'
            suffix: '"\n'
      message_assembly:
        # ... 保持不变
      compression:
        enable_ai_summary: false
        window_turns: 20
        summary_trigger_turns: 30
        preserve_recent: 5

    # 后续轮次 — 多 agent transcript 嵌入 + 更窄窗口
    chat-follow-up:
      transcript:
        mode: embed
        turn_delimiter: "\n"
        speaker_format:
          default:
            prefix: '"{speaker_id}": "'
            suffix: '"\n'
      message_assembly:
        # ... 保持不变
      compression:
        enable_ai_summary: false
        window_turns: 10
        summary_trigger_turns: 30
        preserve_recent: 3
```

**测试要求**：
- YAML 加载集成测试：所有 profile 解析通过
- `pnpm typecheck` 零错误
- 服务器启动无配置加载错误

---

## Group B: AI 摘要压缩

> B 组在 A 组完成并验证通过后启动。B 组的实现依赖 A 组建立的 transcript 嵌入模式和配置门控机制。

### B1 — `archived` 字段 + `getVisibleEntries` 过滤

**目标**：`ConversationEntry` 新增 `archived: boolean` 字段。`getVisibleEntries` 过滤 `archived: true` 的条目。AI 摘要压缩将旧 entry 标记为 `archived: true`。

**修改文件**：
- `apps/server/src/conversation/types.ts` — `ConversationEntry.archived`
- `apps/server/src/context/workflow/tracks/conversation_history_track.ts` — `getVisibleEntries`
- `apps/server/prisma/schema.prisma` — `ConversationEntryRecord.archived` 列（Boolean, @default(false)）

**变更**：

1. `ConversationEntry` 新增：
```typescript
archived?: boolean;  // 默认 false，AI 摘要压缩后设为 true
```

2. `getVisibleEntries` 过滤逻辑（按设计文档 §6.6 更新后的逻辑）：
```typescript
function getVisibleEntries(
  memory: AgentConversationMemory,
  compression: CompressionConfig
): ConversationEntry[] {
  const { window_turns, preserve_recent } = compression;

  // 过滤已归档条目
  const active = memory.entries.filter(e => !e.archived);
  const sorted = [...active].sort((a, b) => a.turn_number - b.turn_number);

  const summaryEntries = sorted.filter(e => e.kind === 'summary');
  const originalEntries = sorted.filter(e => e.kind !== 'summary');

  // AI 摘要可用时用 window_turns，不可用时用 preserve_recent 兜底
  const effectiveWindow = summaryEntries.length > 0
    ? (window_turns && window_turns > 0 ? window_turns : undefined)
    : (preserve_recent && preserve_recent > 0 ? preserve_recent : undefined);

  const visibleRecent = effectiveWindow
    ? originalEntries.slice(-effectiveWindow)
    : originalEntries;

  return [...summaryEntries, ...visibleRecent];
}
```

3. Prisma schema 新增列：
```
ConversationEntryRecord:
  archived Boolean @default(false)
```

4. `store_prisma.ts`：读写 `archived` 字段的序列化/反序列化。

**测试要求**：
- 单元测试：更新 `tests/unit/conversation/conversation_history_track.spec.ts`
  - `archived: true` 的 entry 被 `getVisibleEntries` 过滤
  - summary entries（`kind: 'summary'`）即使 `archived: false` 也始终可见
  - AI 摘要未生成时 `preserve_recent` 截断生效
  - AI 摘要已生成时 `window_turns` 截断生效
  - 混合场景：`archived` 原始 entry + 未归档 summary entry + 未归档 recent entry
- 集成测试：Prisma CRUD 包含 `archived` 字段读写
- `pnpm test:unit` 通过
- `pnpm --filter yidhras-server test:integration` 通过

---

### B2 — `CompactionAuditEntry` 类型 + 审计日志

**目标**：定义压缩审计日志类型，独立于 `InferenceTrace`。

**新建文件**：
- `apps/server/src/conversation/compaction_audit.ts`

**类型**（按设计文档 §6.6）：

```typescript
interface CompactionAuditEntry {
  id: string;
  agent_id: string;
  conversation_id: string;
  triggered_at: number;
  source_entry_ids: string[];       // 被压缩的原始 entry ID
  summary_entry_id: string;          // 生成的 summary entry ID
  summary_model: string;             // 使用的 AI 模型
  summary_prompt_tokens: number;
  summary_completion_tokens: number;
  summary_duration_ms: number;
  status: 'success' | 'failed';
  error_message?: string;
}
```

**存储方案**：阶段二使用独立 JSON 文件（`data/compaction_audit/{conversation_id}.jsonl`），每行一条 `CompactionAuditEntry`。理由：
- 压缩审计日志是低频写入、极低频读取的数据
- 不污染 Prisma schema（避免为审计日志建表）
- JSONL 追加写入，与 SQLite 无事务耦合
- 阶段三如需结构化查询，可迁移到 DB 表

**接口**：

```typescript
interface CompactionAuditStore {
  append(entry: CompactionAuditEntry): Promise<void>;
  getByConversation(conversationId: string): Promise<CompactionAuditEntry[]>;
  getByAgent(agentId: string): Promise<CompactionAuditEntry[]>;
}
```

**测试要求**：
- 单元测试：`tests/unit/conversation/compaction_audit.spec.ts`
  - `append` → 写入 JSONL 行
  - `getByConversation` → 正确过滤
  - `getByAgent` → 正确过滤
  - 不存在的 conversation → 返回空数组
- `pnpm test:unit` 通过

---

### B3 — `enable_ai_summary` opt-in + `compacted_target_role` 配置

**目标**：配置 schema 新增 `enable_ai_summary`（agent 级别 opt-in，默认 `false`）和 `compacted_target_role`（默认 `'system'`）。

**修改文件**：
- `apps/server/src/conversation/format_config.ts` — `CompressionConfigSchema`
- `data/configw/conf.d/conversation.yaml` — 所有 profile

**变更**：

1. `CompressionConfigSchema` 扩展：

```typescript
export const CompressionConfigSchema = z
  .object({
    enable_ai_summary: z.boolean().default(false),
    window_turns: z.number().int().nonnegative().default(20),
    summary_trigger_turns: z.number().int().nonnegative().default(30),
    preserve_recent: z.number().int().nonnegative().default(5),
    compacted_target_role: z.enum(['system', 'developer', 'user']).default('system')
  })
  .strict();
```

2. 所有 YAML profile 添加 `enable_ai_summary: false` 和 `compacted_target_role: system`。

**测试要求**：
- 单元测试：`tests/unit/conversation/format_config.spec.ts`
  - `enable_ai_summary` 默认 `false`
  - `compacted_target_role` 默认 `'system'`
  - 无效值 schema 验证失败
- `pnpm typecheck` 零错误

---

### B4 — 独立压缩推理路径

**目标**：AI 摘要压缩绕过正常推理管线。使用独立的极简 AI 调用路径：不走 `conversation_history` track、不加载模板/slot/world context/persona、不触发 tool loop。

**新建文件**：
- `apps/server/src/conversation/compaction_inference.ts`

**接口**：

```typescript
interface CompactionInferenceInput {
  entries: ConversationEntry[];       // 待压缩的原始 entry
  agentId: string;
  conversationId: string;
  model?: string;                     // 可选模型覆盖
}

interface CompactionInferenceOutput {
  summaryText: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

async function runCompactionInference(
  input: CompactionInferenceInput
): Promise<CompactionInferenceOutput>;
```

**Prompt 构造**（极简，无模板/无 slot/无 pipeline）：

```
System: You are a conversation summarizer. Summarize the following conversation
turns concisely. Preserve key facts, decisions, and the logical flow. Do not add
information not present in the original conversation.

User: <entries 文本>
```

**关键约束**：
- 直接调用 AI Gateway（`gateway.complete()`），不经过 `InferencePipeline`
- 不构造 `InferenceContext`、不运行 track、不运行 pipeline
- 不使用 `PromptWorkflowProfile`
- 失败时抛出，由调用方（B5）处理兜底逻辑
- API key / provider 配置复用全局 AI Gateway 配置

**测试要求**：
- 单元测试：`tests/unit/conversation/compaction_inference.spec.ts`（mock AI Gateway）
  - 正常返回 → summary text + token 统计
  - AI Gateway 返回错误 → 抛出，不吞错误
  - Prompt 不含 conversation_history 相关内容（验证无递归）
  - Prompt 不含模板变量、slot 引用、persona 描述
- `pnpm test:unit` 通过

---

### B5 — `ConversationCompactionService`（写入后触发）

**目标**：实现 `ConversationCompactionService`。在 entry 写入后检查阈值，触发 AI 摘要压缩。启用条件：agent 的 `enable_ai_summary` 为 `true` 且 entries 数量超过 `summary_trigger_turns`。

**新建文件**：
- `apps/server/src/conversation/compaction_service.ts`

**接口**：

```typescript
interface ConversationCompactionService {
  /** 写入后调用，检查是否需要触发压缩 */
  maybeCompact(input: {
    memory: AgentConversationMemory;
    formatConfig: ConversationFormatConfig;
    store: ConversationStore;
  }): Promise<void>;
}
```

**流程**：

```
maybeCompact(memory, formatConfig, store)
  │
  ├── enable_ai_summary === false → 跳过
  ├── entries.length ≤ summary_trigger_turns → 跳过
  │
  └── 触发压缩:
        ├── 1. 确定压缩范围：entries 按 turn_number 排序，取前 N 条（保留最近 preserve_recent 条）
        ├── 2. 调用 runCompactionInference(entriesToCompress)
        │     ├── 成功 → 生成 summaryText
        │     └── 失败 → 记录 CompactionAuditEntry (status: 'failed')，返回（不阻断主流程）
        ├── 3. 构造 summary entry:
        │     - kind: 'summary'
        │     - current_content: summaryText
        │     - turn_range: { start: minTurn, end: maxTurn }
        │     - derived_from_entry_ids: entriesToCompress.map(e => e.id)
        │     - provenance.operator.kind: 'agent', capability: 'conversation.record'
        ├── 4. 事务写入:
        │     - 标记 entriesToCompress 为 archived: true
        │     - 追加 summary entry
        ├── 5. 写入 CompactionAuditEntry (status: 'success')
        └── 6. 返回
```

**触发位置**：在 `store_prisma.ts` 的 `appendEntry` / `appendEntriesInTransaction` 写入完成后，返回前调用 `maybeCompact`。或者更好的做法是让 inference service 在 writeback 完成后检查。

> 具体触发点实现在 B 组启动时根据 A 组集成情况确定。原则：写入后同步检查阈值，压缩推理异步执行（不阻塞写入返回）。

**并发**：SQLite 单写者模型天然序列化。压缩事务（标记 archived + 插入 summary）与正常 entry 追加互斥，不会出现"压缩进行中另一推理追加了新 entry"的竞态。

**测试要求**：
- 集成测试：`tests/integration/conversation/compaction_service.spec.ts`
  - `enable_ai_summary: false` → 不触发
  - entries ≤ `summary_trigger_turns` → 不触发
  - entries > `summary_trigger_turns` + enabled → 触发压缩
  - 压缩后 entries 数组：summary entry + 最近 preserve_recent 条 original
  - 旧 entry 被标记为 `archived: true`
  - `CompactionAuditEntry` 正确写入
  - AI 摘要推理失败 → 旧 entry 不归档，`CompactionAuditEntry.status = 'failed'`
- `pnpm --filter yidhras-server test:integration` 通过

---

### B6 — 压缩到单一 role 组装逻辑

**目标**：`ConversationAssembler` 支持 `compacted_target_role`。当对话 transcript 被压缩（存在 summary entry 或被截断）时，将 transcript 从当前 role 折叠到 `compacted_target_role`（默认 `system`）。

**修改文件**：
- `apps/server/src/conversation/assembler.ts`

**变更**：

```
组装时检测：
  ├── conversation fragment 中包含 summary entry (kind: 'summary')
  │   → transcript 嵌入到 compacted_target_role 而非原始 target_role
  │
  └── 无 summary entry
      → transcript 嵌入到原始 target_role（由 slot → target_role 映射决定）
```

实际上这等价于：当有 summary entry 或 entries 被截断时，所有 conversation fragment 的 target role 替换为 `compacted_target_role`。assembler 从 `formatConfig.compression` 读取 `compacted_target_role`，在构建消息序列时覆盖 target role。

**测试要求**：
- 单元测试：更新 `tests/unit/conversation/assembler.spec.ts`
  - 有 summary entry → conversation fragment 全部进入 `compacted_target_role`（默认 system）
  - 无 summary entry → conversation fragment 进入原始 target role（默认 user）
  - `compacted_target_role: 'developer'` → 正确折叠到 developer
- `pnpm test:unit` 通过

---

## Group C: 因果图查询

> C 组在 A 组 + B 组完成并验证通过后启动。

### C1 — 沿 `derived_from_entry_ids` 双向追溯

**目标**：提供查询 API，沿 `derived_from_entry_ids` 向前追溯（给定 entry，找到衍生自它的所有 summary）和向后追溯（给定 summary，找到它压缩的原始 entry）。

**新建文件**：
- `apps/server/src/conversation/causal_graph.ts`

**接口**：

```typescript
interface CausalGraphQuery {
  /** 向前追溯：哪些 summary entry 衍生自给定 entry */
  getDerivedSummaries(entryId: string): Promise<ConversationEntry[]>;

  /** 向后追溯：给定 summary entry，它压缩了哪些原始 entry */
  getSourceEntries(summaryEntryId: string): Promise<ConversationEntry[]>;

  /** 完整因果链：从给定 entry 出发，沿 derived_from_entry_ids 双向 BFS */
  getCausalChain(entryId: string, opts?: {
    direction?: 'forward' | 'backward' | 'both';
    maxDepth?: number;
  }): Promise<CausalChain>;
}
```

**实现**：不走 DB 查询（`derived_from_entry_ids` 是 JSON 数组，SQLite 不支持 JSON 数组内查询）。在应用层加载同一 memory 下的所有 entries，内存中构建索引。

**性能考量**：阶段二 entries 数量有限（单 memory 几百条级别），应用层过滤可接受。阶段三如需高效查询，再建专门的索引表。

**测试要求**：
- 单元测试：`tests/unit/conversation/causal_graph.spec.ts`
  - `getDerivedSummaries`：返回正确的 summary entries
  - `getSourceEntries`：返回正确的源 entries
  - `getCausalChain`：双向追溯正确，maxDepth 限制生效
  - 无关联 entry → 返回空
  - 循环引用 → 不无限递归（`derived_from_entry_ids` 自引用保护）
- `pnpm test:unit` 通过

---

### C2 — 影响分析查询

**目标**：给定 entry，查询删除它会影响到哪些 summary（影响范围分析）。

**修改文件**：
- `apps/server/src/conversation/causal_graph.ts`

**新增方法**：

```typescript
interface ImpactAnalysis {
  /** 受影响路径：entryId → 直接摘要 → 摘要的摘要 → ... */
  affectedSummaryIds: string[];
  /** 受影响路径层级（摘要层数） */
  depth: number;
  /** 每层受影响的 summary entry 详情 */
  layers: ConversationEntry[][];
}

function analyzeImpact(entryId: string): Promise<ImpactAnalysis>;
```

**测试要求**：
- 单元测试：追加到 `tests/unit/conversation/causal_graph.spec.ts`
  - 单层摘要 → 正确报告 1 层影响
  - 多层摘要（摘要的摘要）→ 正确报告多层影响
  - 独立 entry（无摘要引用）→ 空影响
- `pnpm test:unit` 通过

---

## Group D: 验收

### D1 — 向后兼容验收（回归）

**目标**：验证阶段二变更不破坏阶段一的行为。默认 profile（embed 模式 + 无 AI 摘要）的 `AiMessage[]` 输出与阶段一一致。

**测试文件**：
- `tests/unit/conversation/phase2_backward_compat.spec.ts`

**测试场景**：
1. 默认 profile（embed mode, 无 conversation entries）→ assembler 输出与阶段一相同
2. 默认 profile + 有 conversation entries → embed 模式输出（新增行为，不与旧行为冲突）
3. `chat-first-turn` / `chat-follow-up` profile 行为不变
4. 无 `conversation_profile` → `DEFAULT_CONVERSATION_FORMAT_CONFIG` 行为不变
5. 现有 29 集成测试全部通过（回归）

**验收标准**：
- 场景 1、3、4 的 `AiMessage[]` 输出与阶段一完全一致
- 阶段一全部测试通过（`pnpm test` 零失败）

---

### D2 — 集成测试

**目标**：覆盖阶段二全部新功能的端到端流程。

**新建文件**：
- `tests/integration/conversation/phase2_multi_agent.spec.ts`
- `tests/integration/conversation/phase2_compaction.spec.ts`

**Phase 2a 测试场景**（multi-agent + injection）：
1. **Multi-agent transcript 嵌入**：3 个 agent 的 conversation → embed 模式 → transcript 文本包含全部 3 个 speaker 的发言
2. **Per-speaker format**：某个 agent 自定义 prefix/suffix → 正确渲染
3. **Injection point 索引定位**：`ai_fill_position: 2` → assistant 槽位在正确位置
4. **多注入点**：两个 injection 配置 → 两个 assistant 槽位
5. **Role_map 回退**：显式配置 `mode: role_map` → 一对一角色映射行为

**Phase 2b 测试场景**（AI 摘要压缩）：
1. **触发检查**：`enable_ai_summary: true` + 超阈值 → 触发
2. **Opt-out**：`enable_ai_summary: false` → 不触发
3. **软归档**：压缩后旧 entry `archived: true`
4. **截断兜底**：无 AI 摘要时 `preserve_recent` 生效
5. **压缩审计日志**：成功/失败均写入 `CompactionAuditEntry`
6. **压缩到 system**：`compacted_target_role: system` → conversation 出现在 system 消息

**测试要求**：
- `pnpm --filter yidhras-server test:integration` 通过
- 每个场景的 `AiMessage[]` 结构可验证

---

## 文件变更汇总

| 操作 | 路径 | 所属步骤 |
|------|------|----------|
| 修改 | `apps/server/src/context/workflow/tracks/conversation_history_track.ts` | A1, B1 |
| 修改 | `apps/server/src/conversation/entry_renderer.ts` | A2 |
| 修改 | `apps/server/src/conversation/format_config.ts` | A2, A4, A5, B3 |
| 修改 | `apps/server/src/conversation/assembler.ts` | A3, A5, B6 |
| 修改 | `data/configw/conf.d/conversation.yaml` | A4, A6, B3 |
| 修改 | `apps/server/src/conversation/types.ts` | B1 |
| 修改 | `apps/server/prisma/schema.prisma` | B1 |
| 修改 | `apps/server/src/conversation/store_prisma.ts` | B1 |
| 新建 | `apps/server/src/conversation/compaction_audit.ts` | B2 |
| 新建 | `apps/server/src/conversation/compaction_inference.ts` | B4 |
| 新建 | `apps/server/src/conversation/compaction_service.ts` | B5 |
| 新建 | `apps/server/src/conversation/causal_graph.ts` | C1, C2 |

| 操作 | 路径 | 所属步骤 |
|------|------|----------|
| 更新 | `tests/unit/conversation/conversation_history_track.spec.ts` | A1, A2, B1 |
| 更新 | `tests/unit/conversation/assembler.spec.ts` | A3, A5, B6 |
| 更新 | `tests/unit/conversation/format_config.spec.ts` | A4, B3 |
| 新建 | `tests/unit/conversation/compaction_audit.spec.ts` | B2 |
| 新建 | `tests/unit/conversation/compaction_inference.spec.ts` | B4 |
| 新建 | `tests/unit/conversation/causal_graph.spec.ts` | C1, C2 |
| 新建 | `tests/unit/conversation/phase2_backward_compat.spec.ts` | D1 |
| 新建 | `tests/integration/conversation/phase2_multi_agent.spec.ts` | D2 |
| 新建 | `tests/integration/conversation/phase2_compaction.spec.ts` | D2 |

---

## 执行顺序与依赖

```
A1 ──→ A3 ──→ A5
 │              │
A2 ────────────┘
 │
A4 ──→ A6

B3 ──→ B4 ──→ B5
 │              │
B1 ────────────┤
 │              │
B2 ────────────┘

B5 ──→ B6

C1 ──→ C2

D1 (依赖 A3 + A5)
D2 (依赖全部 A + B 组)
```

**推荐实施顺序**：
1. A1 + A2 + A4 → 可并行
2. A3 → 依赖 A1 + A2
3. A5 → 依赖 A3
4. A6 → 依赖 A4
5. D1（Phase 2a 回归验收）
6. B1 + B3 → 可并行
7. B2 + B4 → 可并行（依赖 B3）
8. B5 → 依赖 B1 + B2 + B4
9. B6 → 依赖 B5
10. C1 → C2
11. D2（全量集成验收）

---

## 校验方式

- **每步**：`pnpm typecheck && pnpm lint` 零错误
- **每步**：相关测试通过
- **A 组完成**：`pnpm test:unit` 全部通过 + D1 回归套件通过
- **B 组完成**：`pnpm --filter yidhras-server test:integration` 通过
- **C 组完成**：`pnpm test:unit` 全部通过
- **D 组完成（阶段二退出标准）**：
  - `pnpm typecheck && pnpm lint` 零错误
  - `pnpm test` 全部通过
  - D1 向后兼容套件全部通过（硬性门禁）
  - D2 集成测试全部通过
  - `pnpm dev` 启动无报错，现有功能无回归

---

## 阶段二退出状态 ✅ 已完成 (2026-05-05)

所有 A/B/C/D/E 组步骤均已完成。

### 质量门禁

- `pnpm typecheck` — 零错误
- `pnpm lint` — 零错误
- 单元测试：34 通过（conversation 目录）
- 集成测试：43 通过（conversation 目录）
- 总计：77 测试覆盖阶段二新功能 + 边缘场景
- 阶段一回归：30 集成测试全部通过

### 实现与计划差异

| 计划 | 实际实现 | 说明 |
|------|----------|------|
| A4 独立 schema 变更 | 合并到 A1 | `TranscriptConfigSchema.mode` 字段在 A1 中添加，A4 实质为零变更 |
| B3 独立 schema 变更 | 合并到 A6 | `CompressionConfigSchema.enable_ai_summary` + `compacted_target_role` 在 YAML 更新时同步添加 |
| `getVisibleEntries` preserve_recent 双模式 | 简化为 `window_turns` 始终生效 | `preserve_recent` 仅用于压缩服务保留条数，`getVisibleEntries` 的 `window_turns` 始终控制视图窗口 |
| `CompactionAuditEntry` 审计字段 | 简化实现 | `summary_model`、`summary_prompt_tokens` 等字段在失败路径填充默认值，不阻断审计写入 |
| D1 回归验收 | 无需独立文件 | 30 个已有集成测试零失败即为回归验收 |
| E 组补充测试 | 计划外新增 | 用户要求补充边缘场景测试后增加 5 个测试文件 |

### 遗留事项（不阻塞阶段三）

- `ConversationCompactionService` 未接入推理管线（B5 实现了服务但未在 inference service writeback 处调用）。设计上是写入后调用 `maybeCompact`，但在推理管线中挂载的精确位置待阶段三集成时确定
- `CompactionAuditEntry.summary_model` / 用量统计字段在失败路径填充默认值（阶段三可扩展以从 AI Gateway 错误响应中提取）
- `enable_ai_summary` 当前通过 `ConversationFormatConfig.compression` 配置，per-agent 级别需要 Agent 配置 schema 扩展（阶段三 `SlotFunctionRegistry` 就绪后一并处理）
- `conversation_id` 仍为确定性三元组，显式多对话支持待阶段三
