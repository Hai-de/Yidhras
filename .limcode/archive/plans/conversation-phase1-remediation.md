# 阶段一代码质量整改计划

> **⚠️ 此计划已完成实施 (2026-05-05)。本文件仅作历史记录保留，不再反映当前代码状态。**

基于对阶段一全部实现代码的严格审查，以下按严重程度分级列出所有发现的问题及整改方案。

---

## P0 — 严重（必须修复，影响数据正确性）

### R01. 写入非事务性，违反设计文档 §5.1

**文件**: `apps/server/src/conversation/writeback.ts:128-129`

**现状**: 两个 `appendEntry` 是顺序 `await`，非 Prisma `$transaction`。如果第一个写入成功、第二个失败，speaker 侧有 entry 而 listener 侧没有，数据不一致。

**设计文档要求**: "A 和 B 的 entry 在同一事务中写入，失败则整次推理标记失败"

**整改**:
- 使用 `store` 暴露的 Prisma client 或在 `writeback` 层接受一个 transaction client 参数
- 将两个 `appendEntry` 包裹在 `prisma.$transaction` 中
- `ConversationStore` 接口新增 `appendEntriesInTransaction(entries: Array<{memoryId, entry}>)` 方法，或 `writeback` 直接接受 `PrismaClient`/`PrismaTransaction` 参数
- 在 `ConversationStore` 接口层标注事务语义（至少需要在同一事务中批量操作的能力）

**验证**: 中断第二个写入后，第一个写入也被回滚（集成测试）

---

### R02. Profile 匹配歧义 — chat profile 可能永远不会被选用

**文件**: `apps/server/src/context/workflow/profiles.ts`

**现状**: `chat-first-turn`、`chat-follow-up` 与 `agent-decision-default` 三者的 `applies_to.task_types` 均为 `['agent_decision']`，特异性分数相同。`selectPromptWorkflowProfile` 按特异性 + `id.localeCompare` 排序，`'agent-decision-default'` 的 id 排在 `'chat-first-turn'` 和 `'chat-follow-up'` 之前。当不显式传 `profile_id` 时，会永远选择 `agent-decision-default`。

同时，`service.ts:252-254` 设置了 `inferenceContext.conversation_profile` 但没有设置 `profileId`。`buildWorkflowPromptBundle` 调用 `selectPromptWorkflowProfile` 时没有传入 `profileId`，会退回到默认 profile。这意味着对话功能在推理服务主路径中无法生效。

**整改**:
- 方案 A（推荐）: 在 `executeRunInternal` 中，当 `conversation_profile` 被设置后，显式传 `profileId` 给 `buildWorkflowPromptBundle`：
  ```typescript
  const { bundle: prompt } = await buildWorkflowPromptBundle({
    context: inferenceContext,
    taskType: 'agent_decision',
    profileId: inferenceContext.conversation_profile
      ? (speakerMemory.entries.length === 0 ? 'chat-first-turn' : 'chat-follow-up')
      : undefined
  });
  ```
- 方案 B: 修改 `selectPromptWorkflowProfile`，当 `conversation_profile` 在 context 中存在时优先选择 chat profile
- 确保 `conversation_profile` 和 `profileId` 不再脱节

**验证**: 单元测试验证带 `conversation_id` 的推理流程选择了 chat profile

---

### R03. `modifyEntry` 归档逻辑错误 — 超过上限时最终记录数仍可能超限

**文件**: `apps/server/src/conversation/store_prisma.ts:165-178`

**现状**: 当 `modifications.length >= 50` 时：
1. `splice(0, length - 49)` → 取 `splice(0, 1)`，删除 1 条，剩 49 条
2. `unshift(archived)` → 50 条
3. `push(modification)` → 51 条

最终 `modifications` 数组有 51 条，超过 `MAX_MODIFICATIONS_PER_ENTRY = 50` 的上限。

**设计文档要求**: "保留最近 N 条，旧 modifications 折叠为一条归档摘要"

**整改**:
```typescript
if (modifications.length >= MAX_MODIFICATIONS_PER_ENTRY) {
  // 将旧的 modifications 折叠为一条归档摘要
  const archived: EntryModification = { ... }; // 同上
  // 保留最近 (MAX_MODIFICATIONS_PER_ENTRY - 1) 条，加一条归档摘要
  const retained = modifications.slice(-(MAX_MODIFICATIONS_PER_ENTRY - 1));
  modifications.length = 0;
  modifications.push(archived, ...retained);
}
modifications.push(modification);
// 现在 modifications.length <= MAX_MODIFICATIONS_PER_ENTRY + 1 (归档 + 上限 - 1 + 新增)
// 但更精确：归档1条 + 49条原始 + 1条新增 = 51 条……
// 正确做法是：归档1条替换所有旧记录，保留 MAX_MODIFICATIONS_PER_ENTRY 条：
const archived = ...;
const recentCount = MAX_MODIFICATIONS_PER_ENTRY - 1;
modifications.splice(0, modifications.length - recentCount, archived);
```

需要仔细确定归档折叠后的精确数量上限。推荐：归档为 1 条 + 最近 `MAX_MODIFICATIONS_PER_ENTRY - 1` 条 + 新增 1 条 = `MAX_MODIFICATIONS_PER_ENTRY + 1` 条。或更严格：归档 1 条替换 k 条旧记录，使总数 = `MAX_MODIFICATIONS_PER_ENTRY`。

**验证**: 单元测试 — 构造刚好 50 条、51 条、100 条 modifications，断言 `modifications.length <= MAX_MODIFICATIONS_PER_ENTRY + 1`（归档摘要 + 最近 N 条）

---

## P1 — 高风险（影响功能正确性或可维护性）

### R04. Assembler 在无对话内容时不注入 assistant 槽位 — 与旧路径行为可能不一致

**文件**: `apps/server/src/conversation/assembler.ts:344-351`

**现状**: `if (injection.ai_fill_role === 'assistant' && hasConversationContent)` — 只有当 `hasConversationContent` 为 true 时才注入空 assistant 消息。无对话内容时不注入。

**潜在问题**: 旧推理路径中，如果使用默认配置（`ai_fill_position: after_last_user`），是否也应该在最后一条 user 消息后插入空 assistant 消息来引导模型输出？这取决于 AI provider 的行为。OpenAI 等 provider 不需要预置空 assistant 消息，但某些 provider 可能依赖它。

**整改**: 确认旧 adapter 行为。如果旧 adapter 从未预置空 assistant 消息，当前行为是正确的。如果旧 adapter 有此行为，需要移除 `hasConversationContent` 条件或在默认配置中标记是否始终注入。

**当前动作**: 先记录，如旧路径无此行为则降级为 P2。

---

### R05. `turn_number` 竞态 — 从内存快照计算而非数据库

**文件**: `apps/server/src/conversation/writeback.ts:49-55`

**现状**: `nextTurnNumber` 从 `memory.entries` 的快照计算 `max(turn_number) + 1`。`getOrCreate` 读取数据库后缓存到 `inferenceContext.agent_conversation_memory`。如果两次推理并发（如同一 agent 的两个推理），两个 `writeConversationEntries` 调用各自从自己的内存快照计算 turn_number，可能产生重复的 turn_number。

**影响**: SQLite 单写者模型下并发写入确实会被序列化，但 turn_number 不由 DB 自增、没有 unique 约束（只有 `(memory_id, turn_number)` 的索引），可能产生同 memory_id 下的重复 turn_number。

**整改**:
- 短期（阶段一）：在 `ConversationEntryRecord` 上为 `(memory_id, turn_number)` 添加 unique 约束，让 DB 拒绝重复
- 中期（阶段二）：改为 DB 层面 `MAX(turn_number) + 1` 查询，在写入事务内执行
- 当前可暂时接受，因为阶段一推理是序列化的（`simulation_loop` 单线程），并发写入可能性低

**验证**: 集成测试 — 连续向同一 memory 追加多条 entry，确认 turn_number 递增且无重复

---

### R06. `loadConversationFormatConfig` 重复实现

**文件**:
- `apps/server/src/context/workflow/orchestrator.ts:25-36`
- `apps/server/src/ai/task_service.ts:107-127`

**现状**: 两处独立的函数逻辑完全相同（从 `runtimeConfig.conversation.profiles` 查找 profile，fallback 到默认）。代码重复违反 DRY 原则。

**整改**: 提取为 `apps/server/src/conversation/format_config.ts` 中的导出函数：
```typescript
export function resolveConversationFormatConfig(profileName?: string | null): ConversationFormatConfig {
  if (!profileName) return DEFAULT_CONVERSATION_FORMAT_CONFIG;
  try {
    const config = getRuntimeConfig();
    const profiles = config?.conversation?.profiles;
    if (profiles?.[profileName]) return profiles[profileName];
  } catch { /* fallthrough */ }
  return DEFAULT_CONVERSATION_FORMAT_CONFIG;
}
```
两处改为 import 此函数。

---

### R07. `PrismaConversationStore` 每次推理新建实例

**文件**: `apps/server/src/inference/service.ts:238-239`

**现状**: `new PrismaConversationStore(context.prisma)` 在每次推理调用中创建新实例。计划文档 A3 要求 "Prisma client 通过依赖注入传入（便于测试 mock）"，但 store 本身也应该被共享或通过 DI 注入。

**整改**: 将 `PrismaConversationStore` 作为 singleton 或通过 `AppInfrastructure` (context) 注册。在 `AppContext` 中添加 `conversationStore` 属性，移除 `service.ts` 中的 `new` 调用。

---

### R08. `Date.now()` 未对接时钟抽象

**文件**:
- `apps/server/src/conversation/writeback.ts:66`
- `apps/server/src/conversation/store_prisma.ts:87,99,105,123,149,177,212`

**现状**: 直接使用 `Date.now()` 和 `BigInt(Date.now())`，不经过 `context.clock` 时钟抽象。在时间模拟场景（测试、回放）中无法控制时间。

**整改**: 
- `writeback.ts`: 接受 `clock` 参数或从 context 获取
- `store_prisma.ts`: 构造函数接受可选的 `nowProvider: () => number` 参数（默认 `Date.now`，测试时可注入）
- 短期可暂不处理，但需在代码中加 `// TODO(clock)` 注释标记

**优先级**: P1（可维护性），不阻塞阶段一

---

## P2 — 中等（代码质量、一致性、可扩展性）

### R09. `convEntriesByRole` 用 `'\n'` 硬编码而非 `turn_delimiter`

**文件**: `apps/server/src/conversation/assembler.ts:267,290,323`

**现状**: 对话条目按 role 分组后用 `convEntriesByRole.system.join('\n')` / `.join('\n')` 连接，硬编码了 `'\n'` 作为分隔符。但 `ConversationFormatConfig.transcript.turn_delimiter` 定义了可配置的分隔符（当前值为 `'\n'`）。

**影响**: 虽然 `'\n'` 当前是默认值，但如果配置修改了 `turn_delimiter`（如改为 `'\n\n'`），assembler 不会使用配置值。设计文档 §3.5 要求 "transcript 只渲染一次"，assembler 从 `FragmentTree` 读取已渲染文本，此处 `join` 应使用配置的 delimiter。

**整改**: 将 `turn_delimiter` 传入 assembler 并在 `join` 时使用。

---

### R10. `ConversationFormatConfigSchema.strict()` 阻止配置扩展

**文件**: `apps/server/src/conversation/format_config.ts`

**现状**: 所有 schema 都使用 `.strict()`，任何未在阶段一 schema 中定义的字段会导致解析失败。YAML 配置中出现阶段二/三字段（如 `nesting`、`jailbreak_patterns`）将报错。

**影响**: 阶段二/三需要修改 schema，但更严重的是：运维如果误加字段，整个配置加载失败。

**整改**: 将顶层 schema 改为 `.passthrough()`，子 schema 保持 `.strict()`。这样未知字段被保留但不报错，阶段二/三可以按需升级子 schema。

---

### R11. `entryRecordToDomain` 无类型安全保障

**文件**: `apps/server/src/conversation/store_prisma.ts:32-76`

**现状**: `row.kind as ConversationEntryKind` 直接断言。`entryRecordToDomain` 的输入参数是手动声明的匿名类型，不引用 Prisma 生成的类型。如果 Prisma schema 变更，此函数不会在编译时报错。

**整改**: 使用 Prisma 生成的 `ConversationEntryRecord` 类型作为输入，或在函数入口添加 `kind` 值验证。

---

### R12. 测试覆盖不完整

**现状**:
- 无 `tests/unit/conversation/` 目录下的任何单元测试
- 无 e2e 测试目录 `tests/e2e/` 下的 conversation 文件
- 当前只有 2 个 integration 测试文件

**缺失的测试**（参考计划文档）:
- `tests/unit/conversation/types.spec.ts` — `MAX_MODIFICATIONS_PER_ENTRY`、`turn_range` 类型约束
- `tests/unit/conversation/store.spec.ts` — mock Prisma client 的单元测试
- `tests/unit/conversation/format_config.spec.ts` — Zod schema 验证
- `tests/unit/conversation/assembler.spec.ts` — assembler 输出验证
- `tests/unit/conversation/conversation_history_track.spec.ts` — 轨道函数
- `tests/unit/conversation/token_budget_trim.spec.ts` — 反转裁剪
- `tests/integration/conversation/writeback.spec.ts` — 事务写入（修复 R01 后需要）
- `tests/e2e/conversation_flow.spec.ts` — 端到端完整流程

**整改**: 不阻塞阶段一，但应在阶段二开始前补充。事务写入测试（R01）必须优先补充。

---

### R13. `listenerProvenance` 的修改方式不够清晰

**文件**: `apps/server/src/conversation/writeback.ts:103-106`

**现状**:
```typescript
const speakerProvenance = buildProvenance(speakerAgentId);
const listenerProvenance = buildProvenance(speakerAgentId);
listenerProvenance.operator.id = speakerAgentId;
```

两行创建完全相同的 provenance 对象，然后第三行"重复赋值"相同的 `speakerAgentId` 到 `listenerProvenance.operator.id`。代码意图是 listener entry 的 provenance 也是 speaker 记录的（"recorded by the speaker agent"），但写法令人困惑——第二次赋值看起来像是 bug（同一个值赋了两次）。

**整改**: 如果 speaker 和 listener 的 provenance 完全相同，直接写：
```typescript
const recordProvenance = buildProvenance(speakerAgentId);
// 两个 entry 共用同一 provenance
const speakerEntry = buildEntry({ ..., provenance: recordProvenance, ... });
const listenerEntry = buildEntry({ ..., provenance: recordProvenance, ... });
```
或如果意图不同，添加注释说明。

---

### R14. `getEntries` 使用 `Record<string, unknown>` 而非 Prisma 类型安全的 where

**文件**: `apps/server/src/conversation/store_prisma.ts:195`

**现状**: `const where: Record<string, unknown> = { memory_id: memoryId }` 失去了 Prisma 的类型安全。

**整改**: 使用 Prisma 生成的 `ConversationEntryRecordWhereInput` 类型。

---

## P3 — 低（文档一致性、小改进）

### R15. 设计文档 `§6.7 组装流程` 步骤 8 与实现不一致

设计文档步骤 8 "如配置 `merge_consecutive_same_role`，合并相邻同 role 消息"。实现中 assembler 没有 merge 逻辑——当 `merge_consecutive_same_role: true`（默认配置），assembler 仍然产出 3 条合并后的消息（system/developer/user），但这是通过 "按 target_role 分组到 groups，然后 `buildJoinText` 合并组内文本" 实现的，不是通过 "先产出多条再合并"。

这不是 bug，但文档描述与实现机制不同。建议更新文档或添加注释说明 assembler 的合并策略是 "分组-合并" 而非 "产出-合并"。

### R16. 设计文档提到 `adaptPromptTreeToAiMessages` 已废弃删除，但 A5 计划步骤要求修改它

计划文档 A5/B1 提到 `prompt_tree_adapter.ts` 应标记为 deprecated 或内部委托。但该文件已不存在。这是计划文档过时，无需代码修改。建议在阶段二计划中更新文件变更列表。

### R17. `default` profile 的 `speaker_format` 与 chat profiles 差异

`default` profile 用空 prefix/suffix（`prefix: ""`, `suffix: "\n"`），而 `chat-first-turn`/`chat-follow-up` 用 `'"{speaker_id}": "...'` 格式。这是设计意图（默认 profile 无对话历史不需要 speaker 标注），但文档可更明确标注。

---

## 执行优先级

| 优先级 | 编号 | 预估工时 | 依赖 |
|--------|------|----------|------|
| P0 | R01 | 2h | 无 |
| P0 | R02 | 1h | 无 |
| P0 | R03 | 0.5h | 无 |
| P1 | R04 | 1h | 需确认旧 adapter 行为 |
| P1 | R05 | 1h | 无（短期加 unique 约束） |
| P1 | R06 | 0.5h | 无 |
| P1 | R07 | 1h | 依赖 AppContext 改造 |
| P1 | R08 | 1h | 无 |
| P2 | R09 | 0.5h | 无 |
| P2 | R10 | 0.5h | 无 |
| P2 | R11 | 0.5h | 无 |
| P2 | R12 | 4h | R01 事务测试优先 |
| P2 | R13 | 0.5h | 无 |
| P2 | R14 | 0.5h | 无 |
| P3 | R15 | 0.5h | 无 |
| P3 | R16 | 0.5h | 无 |
| P3 | R17 | 0.5h | 无 |

**建议执行顺序**: R01 → R02 → R03 → R05(short) → R06 → R09 → 其余按需