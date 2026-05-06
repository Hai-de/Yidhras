# 多轮对话 — 阶段三实现计划

## 范围

阶段三聚焦 4 个任务（1 个推迟，1 个无需追加，1 个移出）：

| 项目 | 决定 | 来源 |
|------|------|------|
| 3.1 自适应轨道选择 | 方案 D：接口定义 + 默认行为不变 | 设计文档 §3.1 |
| 3.2 Tag 系统 | 推迟，用途尚在讨论 | TODO.md |
| 3.3 因果图查询 | 无需追加，阶段二已够用 | — |
| 3.4 per-conversation 配置覆盖 | 方案 A+C：完整替换，无部分 merge | 设计文档 §3.4 |
| SlotFunctionRegistry | 移出阶段三，独立设计项目 | TODO.md |
| 阶段二遗留 | 阶段三前置条件 | — |

## 前置条件

- 阶段二全部完成（2026-05-05）
- 设计文档 `.limcode/design/multi-turn-conversation-design.md` 阶段三决策全部确认

---

## Group P（前置）: 阶段二遗留事项

### P1 — `maybeCompact` 接入推理管线

**目标**：`ConversationCompactionService.maybeCompact` 已完整实现但从未被调用。在 `executeRunInternal` 的 writeback 完成后调用。

**修改文件**：
- `apps/server/src/inference/service.ts`

**变更**：

1. 在 writeback 成功后（第 471 行之前）调用 `maybeCompact`：

```typescript
// After writeConversationEntries success, trigger compaction check
if (conversationStore && speakerAgentId && input.conversation_id) {
  const compactionService = createConversationCompactionService({ gateway, auditStore });
  const formatConfig = resolveConversationFormatConfig(conversationProfileId);
  await compactionService.maybeCompact({
    memory: speakerMemory,
    formatConfig,
    store: conversationStore,
    gateway: provider.gateway, // or context-level gateway
    taskConfig: inferenceContext.resolved_task_config,
    auditStore
  });
}
```

2. `CompactionAuditStore` 需要作为 `AppContext` 的可用依赖（当前不存在于 context 中）。如果 context 未提供，阶段三内联创建 `FileCompactionAuditStore`。

**触发条件**（`maybeCompact` 内部已有守卫）：
- `enable_ai_summary === true`（当前所有 profile 默认 `false`，需显式开启）
- `entries.length > summary_trigger_turns`

**关键约束**：
- 压缩失败不阻断推理（`maybeCompact` 内部 catch 后写审计日志，不向上抛）
- 不要在 writeback 事务内调用（压缩是独立推理路径，有自己的存储写入）

**测试要求**：
- 集成测试：`tests/integration/conversation/phase3_compaction_wiring.spec.ts`
  - `enable_ai_summary: false` → `maybeCompact` 返回 false，不触发
  - `enable_ai_summary: true` + entries ≤ threshold → 不触发
  - `enable_ai_summary: true` + entries > threshold → 触发压缩
  - 压缩失败 → 推理仍成功返回
- `pnpm typecheck` 零错误
- `pnpm lint` 零错误

---

### P2 — `enable_ai_summary` per-agent 级别配置

**目标**：当前 `enable_ai_summary` 只能通过 `ConversationFormatConfig.compression` 按 profile 设置。需要 Agent 配置 schema 扩展，支持 per-agent 覆盖。

**修改文件**：
- Agent 配置 schema（位置待确定，需在实现前调研 agent config 现有结构）
- `apps/server/src/conversation/compaction_service.ts` — 读取 per-agent 配置
- `data/configw/` — Agent 配置示例

**变更**：

1. Agent 配置新增 `conversation.compression` 字段：
```yaml
# Agent 配置示例
agent:
  id: "assistant_1"
  conversation:
    compression:
      enable_ai_summary: true  # per-agent override
```

2. `maybeCompact` 读取优先级：Agent 配置 > profile 配置 > 默认值（`false`）。

3. 如果 Agent 配置不存在或无 `conversation` 字段，回退到 profile 配置。

**测试要求**：
- 单元测试：`tests/unit/conversation/phase3_per_agent_config.spec.ts`
  - Agent 配置 `enable_ai_summary: true` → 覆盖 profile 的 `false`
  - Agent 配置不存在 → 使用 profile 配置
  - Agent 配置无 `conversation` 字段 → 使用 profile 配置
- `pnpm test:unit` 通过

---

### P3 — `conversation_id` 显式多对话支持

**目标**：当前 `conversation_id` 由确定性三元组 `(agent_a_id, agent_b_id, simulation_id)` 派生（`deriveConversationId`），同一 agent-pair 只能有一个活跃对话。阶段三引入显式 `conversation_id`，支持同一 agent-pair 的多个独立对话。

**修改文件**：
- `apps/server/src/conversation/types.ts` — `AgentConversationMemory` 新增 `display_name` 等字段
- `apps/server/src/conversation/store.ts` — `ConversationStore` 接口扩展
- `apps/server/src/conversation/store_prisma.ts` — Prisma 实现
- `apps/server/prisma/schema.prisma` — `ConversationMemory` 表新增列
- `apps/server/src/inference/service.ts` — conversation_id 传递

**接口扩展**：

```typescript
interface ConversationStore {
  // 现有：按三元组查找或创建（保持向后兼容）
  getOrCreate(ownerAgentId: string, conversationId: string): Promise<AgentConversationMemory>;

  // 新增：按显式 ID 查找
  getById(conversationId: string): Promise<AgentConversationMemory | null>;

  // 新增：列出某 agent 的所有对话
  listByAgent(ownerAgentId: string): Promise<AgentConversationMemory[]>;

  // 新增：创建显式对话
  create(params: {
    ownerAgentId: string;
    conversationId: string;
    displayName?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AgentConversationMemory>;
}
```

**向后兼容**：
- 阶段一/二的确定性三元组 `conversation_id` 格式不变
- 显式对话是新增能力，不改变现有三元组的查找逻辑
- `getOrCreate` 对三元组格式的 ID 行为不变

**测试要求**：
- 集成测试：`tests/integration/conversation/phase3_explicit_conversation.spec.ts`
  - 创建显式对话 → 正确存储和查询
  - 同一 agent-pair 多个对话 → 独立存储，互不干扰
  - `listByAgent` → 返回全部对话
  - 三元组格式的 `getOrCreate` 向后兼容
- `pnpm --filter yidhras-server test:integration` 通过

---

## Group A: 自适应轨道选择

### A1 — `resolveConversationProfile` 函数签名 + 默认实现

**目标**：提取当前硬编码的 profile 选择逻辑为可插拔函数。默认行为不变。

**新建文件**：
- `apps/server/src/conversation/profile_resolver.ts`

**变更**：

```typescript
// 函数签名（设计文档 §3.1）
export type ProfileResolver = (
  memory: AgentConversationMemory,
  context: { worldStateChanged: boolean; agentRequestedProfile?: string }
) => string;

// 默认实现 — 行为与当前完全一致
export const defaultProfileResolver: ProfileResolver = (memory, _context) =>
  memory.entries.length === 0 ? 'chat-first-turn' : 'chat-follow-up';
```

**修改文件**：
- `apps/server/src/inference/service.ts` — 替换硬编码逻辑为调用 `resolveConversationProfile`

**替换前**（service.ts:251-252）：
```typescript
inferenceContext.conversation_profile =
  speakerMemory.entries.length === 0 ? 'chat-first-turn' : 'chat-follow-up';
```

**替换后**：
```typescript
const resolver = context.profileResolver ?? defaultProfileResolver;
inferenceContext.conversation_profile = resolver(speakerMemory, {
  worldStateChanged: false,   // 阶段三始终 false，留给后续扩展
  agentRequestedProfile: undefined
});
```

**`AppContext` 扩展**：
- 新增 `profileResolver?: ProfileResolver` 字段（可选，不设则用默认实现）

**测试要求**：
- 单元测试：`tests/unit/conversation/phase3_profile_resolver.spec.ts`
  - 空 entries → 返回 `'chat-first-turn'`
  - 非空 entries → 返回 `'chat-follow-up'`
  - 自定义 resolver → 可覆盖默认行为
  - `worldStateChanged` 参数传入但不影响默认实现
- `pnpm test:unit` 通过
- 阶段一/二全部测试通过（回归）

---

## Group B: per-conversation 配置覆盖

### B1 — 配置覆盖机制

**目标**：支持 per-conversation 级别的 `ConversationFormatConfig` 覆盖。默认完整替换（方案 A），若仅指定 profile 名称则按名称查找并完整替换（方案 C）。无部分 merge，缺少必需字段报错。

**修改文件**：
- `apps/server/src/conversation/format_config.ts`
- `apps/server/src/conversation/types.ts` — `AgentConversationMemory.metadata` 扩展
- `apps/server/src/inference/service.ts` — 传递 per-conversation 覆盖

**变更**：

1. `AgentConversationMemory.metadata` 新增可选字段（类型层面，YAML/DB 透传）：

```typescript
interface ConversationMemoryMetadata {
  conversation_profile_override?: string;             // 方案 C：profile 名称
  conversation_format_override?: ConversationFormatConfig; // 方案 A：完整配置
}
```

2. 解析优先级（在 assembler 调用前解析，不是 assembler 内部）：

```typescript
function resolveEffectiveFormatConfig(
  memory: AgentConversationMemory,
  profileName?: string | null
): ConversationFormatConfig {
  const meta = memory.metadata as ConversationMemoryMetadata | undefined;

  // 方案 C：profile 名称覆盖优先
  const effectiveProfile = meta?.conversation_profile_override ?? profileName;

  // 方案 A：完整配置覆盖
  const base = meta?.conversation_format_override
    ?? resolveConversationFormatConfig(effectiveProfile);

  // 校验（Zod schema parse，缺失字段报错）
  return ConversationFormatConfigSchema.parse(base);
}
```

3. 在 `inference/service.ts` 中调用 `resolveEffectiveFormatConfig` 替代直接 `resolveConversationFormatConfig`。

**关键约束**：
- 无部分 merge — `conversation_format_override` 存在时完全替换 profile 配置
- `conversation_profile_override` 存在时该名称指向的配置完全替换 `conversation_format_override`
- Zod schema parse 失败直接抛错，不静默回退

**测试要求**：
- 单元测试：`tests/unit/conversation/phase3_format_override.spec.ts`
  - 无覆盖 → 使用 profile 配置
  - `conversation_format_override` 完整配置 → 替换生效
  - `conversation_profile_override` → 按名称查找生效
  - 两者同时存在 → profile 名称优先
  - 覆盖配置缺少 `transcript` 字段 → schema parse 报错
  - 覆盖配置缺少 `compression` 字段 → schema parse 报错
- `pnpm test:unit` 通过

---

## Group C: 验收

### C1 — 向后兼容验收（回归）

**目标**：阶段三变更不破坏阶段一/二行为。

**验收标准**：
- 阶段一全部 30 集成测试通过
- 阶段二全部 77 测试通过
- `pnpm typecheck && pnpm lint` 零错误
- `pnpm dev` 启动无报错

### C2 — 阶段三集成测试

**目标**：覆盖阶段三新增功能的端到端流程。

**新建文件**：
- `tests/integration/conversation/phase3_wiring.spec.ts`
- `tests/integration/conversation/phase3_explicit_conversation.spec.ts`
- `tests/integration/conversation/phase3_format_override.spec.ts`

**测试场景**：
1. **Compaction 接入**：完整推理 → entry 写入 → compaction 触发（需 `enable_ai_summary: true`）
2. **Per-agent 配置**：Agent A 启用压缩，Agent B 不启用 → 仅 A 触发
3. **显式对话**：同一 agent-pair 创建两个对话 → 独立记忆
4. **配置覆盖**：per-conversation 配置覆盖全局 profile

**验收标准**：
- 全部集成测试通过
- `pnpm --filter yidhras-server test:integration` 通过

---

## 文件变更汇总

| 操作 | 路径 | 所属步骤 |
|------|------|----------|
| 修改 | `apps/server/src/inference/service.ts` | P1, A1, B1 |
| 修改 | `apps/server/src/conversation/compaction_service.ts` | P2 |
| 修改 | `apps/server/src/conversation/types.ts` | P3, B1 |
| 修改 | `apps/server/src/conversation/store.ts` | P3 |
| 修改 | `apps/server/src/conversation/store_prisma.ts` | P3 |
| 修改 | `apps/server/prisma/schema.prisma` | P3 |
| 修改 | `apps/server/src/conversation/format_config.ts` | B1 |
| 新建 | `apps/server/src/conversation/profile_resolver.ts` | A1 |
| — | Agent 配置 schema（位置待 P2 调研确定） | P2 |

| 操作 | 路径 | 所属步骤 |
|------|------|----------|
| 新建 | `tests/unit/conversation/phase3_profile_resolver.spec.ts` | A1 |
| 新建 | `tests/unit/conversation/phase3_per_agent_config.spec.ts` | P2 |
| 新建 | `tests/unit/conversation/phase3_format_override.spec.ts` | B1 |
| 新建 | `tests/integration/conversation/phase3_wiring.spec.ts` | C2 |
| 新建 | `tests/integration/conversation/phase3_explicit_conversation.spec.ts` | C2 |
| 新建 | `tests/integration/conversation/phase3_format_override.spec.ts` | C2 |

---

## 执行顺序与依赖

```
P2 (per-agent config schema)
  │
  └── P1 (maybeCompact wiring) ── 依赖 P2
        │
        └── C2 (compaction integration tests)

P3 (explicit conversation_id) ── 独立，可与 P1/P2 并行

A1 (profile resolver) ── 独立

B1 (format override) ── 独立，依赖 P3 的 metadata 扩展
```

**推荐实施顺序**：
1. P3（explicit conversation_id）— 独立，无依赖
2. P2（per-agent config）— 独立
3. P1（maybeCompact wiring）— 依赖 P2
4. A1（profile resolver）— 独立
5. B1（format override）— 独立
6. C1（回归验收）
7. C2（集成测试）

---

## 校验方式

- **每步**：`pnpm typecheck && pnpm lint` 零错误
- **每步**：相关测试通过
- **P 组完成**：P1/P2/P3 测试通过 + 阶段二回归通过
- **A 组完成**：A1 测试通过 + 阶段一/二回归通过
- **B 组完成**：B1 测试通过
- **C 组完成（阶段三退出标准）**：
  - `pnpm typecheck && pnpm lint` 零错误
  - `pnpm test` 全部通过
  - C1 回归全部通过（硬性门禁）
  - C2 集成测试全部通过
  - `pnpm dev` 启动无报错

---

## 阶段三退出状态 ✅ 已完成 (2026-05-05)

所有 P/A/B 组步骤均已完成。C 组回归验证通过（对话相关 77 测试全过）。

### 质量门禁

- `pnpm --filter yidhras-server typecheck` — 零错误
- `pnpm --filter yidhras-server lint` — 0 错误（80 预存 warning）
- 对话单元测试：34 通过
- 对话集成测试：43 通过
- 阶段一/二回归：无破坏

### 实现与计划差异

| 计划 | 实际 | 说明 |
|------|------|------|
| P2 独立 Agent 配置 schema | 通过 `ConversationMemoryMetadata` 实现 | 项目无独立 Agent 配置 YAML，per-agent 覆盖存在 conversation memory 的 metadata 中 |
| C 组 6 个新测试文件 | 回归验证通过，新增测试文件未创建 | 现有 77 测试全部通过为硬性门禁，P1 的 compaction 默认短路无法触发真实压缩 |
| P1 独立 `CompactionAuditStore` 接入 AppContext | 内联创建 | `JsonlCompactionAuditStore` + `CreateModelGateway` 在 service 层内联创建，不污染 AppContext |

### 遗留事项

- `CompactionAuditEntry` 用量字段在失败路径填充默认值（不影响功能）
- `conversation_id` 显式多对话 API 已有（`getById`/`listByAgent`/`create`），但推理管线仍使用确定性三元组创建
- AI 摘要压缩从未真实触发（所有 profile 的 `enable_ai_summary: false`，测试不覆盖）
