# Prompt Bundle 组件化重构设计

> **状态：进行中。** 原文档曾误归档至 `.limcode/archive/design/`，因重构未完成，现移回活跃设计目录。
> 
> **当前进度**：Phase 1（类型定义 + builder + feature flag）已部分落地，Phase 2-4 待推进。详见末尾 §12 实现现状核查。

## 概述

将 Prompt Bundle 从 6 个硬编码固定字段重构为声明式、可配置、AST 化的三层树结构（Slot → Fragment → Block），引入宿主级 Agent 权限管理（读/写/调整/可见性），作为实验性功能默认关闭。

---

## 1. 问题陈述

### 1.1 当前架构的 6 个硬约束

| 约束点 | 位置 | 表现 |
|--------|------|------|
| Slot 类型固定 9 个字面量 | `prompt_fragments.ts` L1-10 | `type PromptFragmentSlot = 'system_core' \| ...` （9 个值） |
| Fragment 生成硬编码 6 个 | `prompt_builder.ts` L329-342 | `buildPromptFragments()` 中 6 个 `buildFragment(...)` 调用 |
| Bundle 字段固定 6 个 | `inference/types.ts` L370-378 | `PromptBundle` 接口 `system_prompt / role_prompt / ...` |
| Bundle → Slot 映射硬编码 | `prompt_builder.ts` L378-384 | `system_prompt: buildSlotPrompt(fragments, 'system_core')` |
| Bundle → AiMessage 映射硬编码 | `prompt_bundle_adapter.ts` L114-170 | 6 字段压入 3 个 message |
| 无权限控制 | — | 任何调用者都能操作所有 slot |

### 1.2 用户诉求

- 自由增减插槽数量，不需要改代码
- 6 个固定槽位仅作为默认配置文件提供
- 槽位可被宏变量指代（在模板中 `{{ slots.xxx }}` 引用）
- 引入权限管理：读取 / 写入 / 调整 / 可见性
- 权限范围：仅限项目宿主级 agent
- 实验性功能，默认关闭
- 采用 AST 化三层结构：Slot → Fragment（片）→ Block（块）

---

## 2. 核心接口设计（接口优先）

### 2.1 最小编译单元：PromptBlock

```typescript
// --- prompt_block.ts ---

export type PromptBlockKind =
  | 'text'          // 纯文本
  | 'macro_ref'     // 宏变量引用 {{ ... }}
  | 'conditional'   // #if / #unless 条件块
  | 'loop'          // #each 循环块
  | 'json';         // 结构化 JSON 数据

export interface PromptBlock {
  id: string;
  kind: PromptBlockKind;
  rendered?: string | null;
  content: PromptBlockContent;
  metadata?: Record<string, unknown>;
}

export type PromptBlockContent =
  | { kind: 'text'; text: string }
  | { kind: 'macro_ref'; path: string; default_value?: string | null }
  | { kind: 'conditional'; predicate_path: string; children: PromptBlock[]; else_children?: PromptBlock[] }
  | { kind: 'loop'; iterator_path: string; item_alias: string; children: PromptBlock[] }
  | { kind: 'json'; value: Record<string, unknown> };
```

### 2.2 可嵌套中间节点：PromptFragment（片）

```typescript
// --- prompt_fragment.ts ---

import type { PromptBlock } from './prompt_block.js';

export type PromptFragmentPlacementMode = 'prepend' | 'append' | 'before_anchor' | 'after_anchor';
export type PromptFragmentAnchorKind = 'slot_start' | 'slot_end' | 'source' | 'tag' | 'fragment_id';

export interface PromptFragmentAnchor {
  kind: PromptFragmentAnchorKind;
  value: string;
}

export interface PromptFragment {
  id: string;
  slot_id: string;
  priority: number;
  source: string;
  removable: boolean;
  replaceable: boolean;
  children: Array<PromptBlock | PromptFragment>;
  anchor?: PromptFragmentAnchor | null;
  placement_mode?: PromptFragmentPlacementMode | null;
  depth?: number | null;
  order?: number | null;
  permissions?: PromptFragmentPermissions | null;
  metadata?: Record<string, unknown>;
}

export interface PromptFragmentPermissions {
  read?: string[];
  write?: string[];
  adjust?: string[];
  visible: boolean;
  visible_to?: string[];
}
```

### 2.3 声明式插槽定义：PromptSlotConfig

```typescript
// --- prompt_slot_config.ts ---

export interface PromptSlotConfig {
  id: string;
  display_name: string;
  description?: string;
  default_priority: number;
  default_template?: string | null;
  template_context?: 'inference' | 'world_prompts' | 'pack_state' | 'none';
  message_role?: 'system' | 'developer' | 'user';
  include_in_combined: boolean;
  combined_heading?: string | null;
  permissions?: PromptFragmentPermissions | null;
  enabled: boolean;
  metadata?: Record<string, unknown>;
}

export interface PromptSlotRegistry {
  version: number;
  slots: Record<string, PromptSlotConfig>;
  metadata?: {
    workspace_root?: string;
    config_path?: string;
    loaded_from_file?: boolean;
  };
}
```

### 2.4 Prompt 树：PromptTree

```typescript
// --- prompt_tree.ts ---

export interface PromptTree {
  inference_id: string;
  task_type: string;
  fragments_by_slot: Record<string, PromptFragment[]>;
  slot_registry: Record<string, PromptSlotConfig>;
  metadata: PromptTreeMetadata;
}

export interface PromptTreeMetadata {
  prompt_version: string;
  profile_id: string | null;
  profile_version: string | null;
  source_prompt_keys: string[];
  workflow?: PromptWorkflowMetadata;
  processing_trace?: PromptProcessingTrace;
}
```

### 2.5 最终产物：PromptBundleV2

```typescript
// --- prompt_bundle_v2.ts ---

export interface PromptBundleV2 {
  slots: Record<string, string>;
  combined_prompt: string;
  metadata: PromptBundleMetadata;
  tree: PromptTree;
}

export interface PromptBundleToAiMessagesAdapter {
  adapt(bundle: PromptBundleV2, taskConfig: AiResolvedTaskConfig): AiMessage[];
}

// 向后兼容转换（Phase 4 清理时移除）
export function toLegacyPromptBundle(v2: PromptBundleV2): PromptBundle {
  return {
    system_prompt: v2.slots['system_core'] ?? '',
    role_prompt: v2.slots['role_core'] ?? '',
    world_prompt: v2.slots['world_context'] ?? '',
    context_prompt: v2.slots['post_process'] ?? '',
    output_contract_prompt: v2.slots['output_contract'] ?? '',
    combined_prompt: v2.combined_prompt,
    metadata: v2.metadata
  };
}
```

---

## 3. 权限模型

### 3.1 设计原则

```
权限范围：仅限项目宿主级 agent（host-level agent）
         ≠ 任意 world pack agent

默认状态：features.experimental.prompt_slot_permissions = false
         关闭时所有 perms 字段被忽略，全通

四级权限：
  read     — 该主体能否读取 slot/fragment 的渲染文本
  write    — 该主体能否在 slot 内创建/注入 fragment 或 block
  adjust   — 该主体能否改变优先级、顺序、锚点
  visibility — 该 slot 在 combined_prompt 中是否对特定主体可见
```

### 3.2 权限数据流

```
YAML 配置 (PromptSlotConfig.permissions)
  └─ 合并 PromptFragment.permissions（fragment 可 override）
       └─ 在 PromptWorkflowRuntime 的以下步骤生效：
            ┌─ read check:    宏展开之前——决定是否给该主体渲染内容
            ├─ write check:   fragment 注入阶段——决定是否允许注入
            ├─ adjust check:  placement_resolution 阶段——决定是否调整顺序
            └─ visibility check: bundle_finalize 阶段——决定 combined_prompt 中是否出现
```

### 3.3 权限决议算法

```typescript
export function resolveSlotPermission(input: PermissionCheckInput): PermissionCheckResult {
  const featureEnabled = getRuntimeConfig().features?.experimental?.prompt_slot_permissions;
  if (!featureEnabled) {
    return { allowed: true };
  }

  const allowedList =
    input.fragment.permissions?.[input.permission_kind]
    ?? input.slot_config.permissions?.[input.permission_kind]
    ?? null;

  if (allowedList === null) {
    return { allowed: true };
  }

  const subjectIds = [
    ...input.host_agent_ids,
    input.actor_ref.identity_id,
    input.actor_ref.agent_id
  ].filter((id): id is string => id !== null);

  const allowed = allowedList.some(id => subjectIds.includes(id));
  return { allowed, reason: allowed ? undefined : `actor not in ${input.permission_kind} allowlist` };
}
```

---

## 4. 配置 Schema

### 4.1 内置默认配置（等价于当前 6 个硬编码 slot）

```yaml
# 内置默认: apps/server/src/ai/schemas/prompt_slots.default.yaml
version: 1
slots:
  system_core:
    display_name: "系统核心指令"
    description: "推理服务的系统级指令与身份声明"
    default_priority: 100
    default_template: |
      你是 Yidhras 推理服务，运行在 workflow baseline。
      当前策略: {{ request.strategy }}
    message_role: system
    include_in_combined: true
    combined_heading: "System Prompt"
    enabled: true

  system_policy:
    display_name: "系统策略"
    description: "访问控制与策略约束"
    default_priority: 95
    message_role: system
    include_in_combined: true
    combined_heading: "System Policy Prompt"
    enabled: true
    permissions:
      read: []
      write: []
      adjust: []
      visible: true
      visible_to: []

  role_core:
    display_name: "角色核心"
    description: "当前 Actor 的角色定义与上下文"
    default_priority: 90
    default_template: |
      角色: {{ actor.display_name }}
      角色类型: {{ actor.role }}
      所属 Agent: {{ actor.agent_id | default("none") }}
    message_role: developer
    include_in_combined: true
    combined_heading: "Role Prompt"
    enabled: true

  world_context:
    display_name: "世界上下文"
    description: "World Pack 提供的世界观与规则说明"
    default_priority: 80
    template_context: world_prompts
    message_role: system
    include_in_combined: true
    combined_heading: "World Prompt"
    enabled: true

  memory_summary:
    display_name: "记忆摘要"
    description: "短期/长期记忆的摘要注入"
    default_priority: 70
    message_role: user
    include_in_combined: true
    combined_heading: "Memory Summary Prompt"
    enabled: true

  output_contract:
    display_name: "输出契约"
    description: "预期输出格式与约束"
    default_priority: 50
    default_template: |
      返回归一化的 decision 对象。
      字段: action_type, target_ref, payload, confidence, delay_hint_ticks, reasoning, meta
    message_role: user
    include_in_combined: true
    combined_heading: "Output Contract Prompt"
    enabled: true

  post_process:
    display_name: "上下文快照"
    description: "当前推理上下文的 JSON 快照"
    default_priority: 60
    message_role: user
    include_in_combined: true
    combined_heading: "Post Process Prompt"
    enabled: true
```

---

## 5. 渲染管线

### 5.1 新管线概览

```
Phase A: 配置加载
  prompt_slots.yaml (内置默认 + 文件覆盖 + World Pack 覆盖)
    → PromptSlotRegistry

Phase B: 树构建
  InferenceContext + PromptSlotRegistry
    → SlotConfig.default_template → 宏展开 → Block[]
    → 外部注入 Fragment[]（来自 memory/providers/plugins）
    → 组装 PromptTree

Phase C: 权限过滤（实验性）
  PromptTree + ActorRef
    → 遍历所有 Fragment
    → resolveSlotPermission() 检查
    → 移除无权读取的 Fragment
    → 对有 visible: false 的 Fragment 标记

Phase D: Processor 管线
  PromptTree → PromptWorkflowRuntime
    → memory_projection → node_working_set_filter
    → summary_compaction → token_budget_trim
    → placement_resolution → bundle_finalize
  （processor 现在操作树而非平面列表）

Phase E: 最终渲染
  PromptTree → PromptBundleV2
    → 遍历每个 slot → 拼接其 Fragment 下所有 Block.rendered
    → slots: Record<string, string>
    → combined_prompt（只含 visible 且 include_in_combined 的 slot）
```

---

## 6. Processor 接口变更

### 6.1 当前签名（旧）

```typescript
export interface PromptProcessor {
  name: string;
  process(input: PromptProcessorInput): Promise<PromptFragment[]>;
}
// input.fragments 是平面 PromptFragment[]
```

### 6.2 新签名（目标）

```typescript
export interface PromptTreeProcessor {
  name: string;
  process(input: PromptTreeProcessorInput): Promise<PromptTree>;
}

export interface PromptTreeProcessorInput {
  context: InferenceContext;
  tree: PromptTree;
  workflow?: {
    task_type: string;
    profile_id: string;
    profile_version: string;
    selected_step_keys: string[];
    profile_defaults?: { token_budget?: number; section_policy?: string };
  };
}
```

---

## 7. 影响范围

### 7.1 新增文件

| 文件 | 职责 | 状态 |
|------|------|------|
| `inference/prompt_block.ts` | `PromptBlockContent` 类型定义 | ✅ 已实现 |
| `inference/prompt_fragment_v2.ts` | `PromptFragmentV2`（树结构版）、`PromptFragmentPermissions` | ✅ 已实现 |
| `inference/prompt_slot_config.ts` | `PromptSlotConfig`、`PromptSlotRegistry` | ✅ 已实现 |
| `inference/prompt_tree.ts` | `PromptTree`、`PromptTreeMetadata`、walker 工具函数 | ✅ 已实现 |
| `inference/prompt_bundle_v2.ts` | `PromptBundleV2`、`PromptBundleToAiMessagesAdapter`、兼容转换函数 | ✅ 已实现 |
| `ai/schemas/prompt_slots.default.yaml` | 内置默认 slot 配置 | ✅ 已实现 |
| `inference/prompt_builder_v2.ts` | `buildPromptTree()`、`buildPromptBundleV2()` | ✅ 已实现 |
| `inference/prompt_permissions.ts` | `resolveSlotPermission()` 等权限工具 | ✅ 已实现 |
| `ai/adapters/prompt_tree_adapter.ts` | `PromptTree → AiMessage[]` 新适配器 | ✅ 已实现 |

### 7.2 修改文件

| 文件 | 设计目标变更 | 实际状态 |
|------|-------------|---------|
| `inference/prompt_fragments.ts` | 保留旧版，标记 `@deprecated` | 保留，未标记 deprecated |
| `inference/types.ts` | 保留旧 `PromptBundle`，新增 `PromptBundleV2` | 已新增 |
| `inference/prompt_builder.ts` | 保留旧函数 | 仍为活跃路径 |
| `context/workflow/types.ts` | `PromptWorkflowState` 增加 `tree?: PromptTree` | ✅ 已增加 |
| `context/workflow/runtime.ts` | `runPromptWorkflow` 支持 `PromptTree` 模式 | ❌ 仍使用旧平面 processor（含旧 token_budget_trimmer） |
| `ai/adapters/prompt_bundle_adapter.ts` | 保留旧适配器，标记 `@deprecated` | 保留，未标记 deprecated |
| `inference/service.ts` | feature flag 驱动选择新旧管线 | ✅ 已实现（`prompt_bundle_v2` flag） |
| `ai/task_service.ts` | 可选接收 `PromptBundleV2` 并适配 | ✅ 已实现 |
| `config/runtime_config.ts` | 新增 `features.experimental.prompt_slot_permissions` | ✅ 已实现 |
| `ai/registry.ts` | 新增 `loadPromptSlotRegistry()` | ✅ 已实现 |

### 7.3 不变文件

- `ai/gateway.ts` / `route_resolver.ts` — 不感知 prompt 组装细节
- `narrative/resolver.ts` — 宏展开逻辑不变
- `context/workflow/placement_resolution.ts` — placement 算法逻辑保留

---

## 8. Feature Flag 设计

```typescript
// config/runtime_config.ts 已实现
export interface ExperimentalFeatures {
  prompt_slot_permissions?: boolean;  // 默认 false
  prompt_bundle_v2?: boolean;         // 默认 false
}
```

### 8.1 新旧管线切换（当前实现）

```typescript
// inference/service.ts (L251-258)
if (runtimeConfig.features?.experimental?.prompt_bundle_v2) {
  const registry = getPromptSlotRegistry();
  const tree = buildPromptTree(inferenceContext, registry.slots);
  applyPermissionFilter(tree, inferenceContext);
  const v2 = buildPromptBundleV2(tree, inferenceContext);
  prompt = toLegacyPromptBundle(v2);  // ← 临时桥接，V2 → 旧 PromptBundle
} else {
  prompt = await buildPromptBundle(inferenceContext, { ... });
}
```

---

## 9. 迁移策略

```
Phase 1: 新接口并置（不影响现有功能）       ✅ 已完成
  ├─ 定义所有新接口（Block/PromptTree/PromptBundleV2）
  ├─ 编写默认 slot 配置
  ├─ 实现 buildPromptTree() 和 buildPromptBundleV2()
  ├─ 旧代码保留
  └─ feature flag prompt_bundle_v2 默认 false

Phase 2: 适配器层切换                         ✅ 已完成
  ├─ PromptTree → AiMessage 新适配器（prompt_tree_adapter.ts）
  ├─ task_service.ts 同时支持新旧 Bundle
  ├─ gateway_backed provider 统一走 V2 路径
  ├─ InferenceProvider 接口更新为 PromptBundleV2
  ├─ token_budget_trimmer 切换到 tree 版本（adapter wrapper）
  ├─ 删除旧 createTokenBudgetTrimmerPromptProcessor
  ├─ 宏展开 processor 落地（macro_expansion.ts）
  └─ 删除 toLegacyPromptBundle

Phase 3: Processor 管线树化                    ✅ 已完成
  ├─ context/workflow/runtime.ts 新增 runPromptWorkflowV2
  ├─ memory_injector / policy_filter / memory_summary 提供 PromptTreeProcessor（tree→flat adapters）
  ├─ service.ts V2 路径改用 runPromptWorkflowV2
  └─ 旧 runPromptWorkflow 仍使用 adapter（Phase 4 退役）

Phase 4: 清理                                  ✅ 已完成
  ├─ 移除旧 prompt_bundle_adapter.ts
  ├─ 移除旧 prompt_builder.ts ~350 行死代码（buildPromptBundle / buildPromptFragments / buildPromptBundleFromFragments 等）
  ├─ 移除旧 runtime.ts 平面 pipeline ~500 行（runPromptWorkflow / buildDefaultLegacySteps / buildExecutorRegistry 等）
  ├─ 移除 createTreeTokenBudgetTrimmerAsLegacy adapter
  ├─ 移除 feature flag prompt_bundle_v2，V2 为唯一路径
  ├─ 收窄 InferenceProvider.run() 签名为 PromptBundleV2
  └─ service.ts 仅保留 V2 路径（移除 V1 else 分支和 extractIncludeSections）
```

---

## 10. 不在此次设计范围内的内容

| 项目 | 状态 |
|------|------|
| 超长 context（100K+ tokens）实时 token 预算裁剪 | 留待以后评估 |
| Rust sidecar 宏展开 / token 计数 | 留待 Phase 3 后评估 |
| 将 SectionDraft 合并到 PromptTree | 当前保持 SectionDraft 独立，仅调整接口 |
| ProcessingTrace 的树形化 | 当前保持扁平 fragment 诊断格式，tree 作为附加字段 |
| Plugin 注入 slot 权限 | 当前仅支持 YAML 声明 |

---

## 11. 相关文档

- 当前 Prompt Workflow 文档：`docs/capabilities/PROMPT_WORKFLOW.md`
- AI Gateway 文档：`docs/capabilities/AI_GATEWAY.md`
- 架构边界：`docs/ARCH.md`
- 接口契约：`docs/API.md`

---

## 12. 实现现状核查（2025-06）

### 12.1 Phase 1（已完成）

| 组件 | 文件 | 说明 |
|------|------|------|
| Block 类型 | `inference/prompt_block.ts` | `PromptBlock`, `PromptBlockKind`, `PromptBlockContent` |
| Fragment V2 | `inference/prompt_fragment_v2.ts` | 树结构 `PromptFragmentV2`，含 children + permissions |
| Slot 配置 | `inference/prompt_slot_config.ts` | `PromptSlotConfig`, `PromptSlotRegistry` |
| Prompt Tree | `inference/prompt_tree.ts` | `PromptTree`, walker, `renderSlotText` |
| Bundle V2 | `inference/prompt_bundle_v2.ts` | `PromptBundleV2` |
| Builder V2 | `inference/prompt_builder_v2.ts` | `buildPromptTree`, `buildPromptBundleV2` |
| 权限 | `inference/prompt_permissions.ts` | `resolveSlotPermission`, `applyPermissionFilter` |
| 树适配器 | `ai/adapters/prompt_tree_adapter.ts` | `adaptPromptTreeToAiMessages` |
| YAML 配置 | `ai/schemas/prompt_slots.default.yaml` | 7 内置 slot |
| Registry | `ai/registry.ts` | `getPromptSlotRegistry`, `resetPromptSlotRegistryCache` |
| Feature flag | `config/runtime_config.ts`, `config/schema.ts` | `prompt_bundle_v2`, `prompt_slot_permissions` |

### 12.2 Phase 2（已完成）

| 任务 | 说明 |
|------|------|
| Builder 去旧依赖 | `buildDynamicSlotFragments` 替代旧 `buildPromptFragments` 桥接；`buildContextPromptPayload` / `buildOutputContractPrompt` 导出供 V2 复用 |
| InferenceProvider 接口更新 | `run(context, prompt: PromptBundle \| PromptBundleV2)`；`gateway_backed` 统一走 V2 路径 |
| 删除 `toLegacyPromptBundle` | 零引用后从 `prompt_bundle_v2.ts` 移除 |
| Token budget trimmer 切换 | 新增 `createTreeTokenBudgetTrimmerAsLegacy` adapter wrapper；`runtime.ts` 三处引用已替换 |
| 删除旧 trimmer | `createTokenBudgetTrimmerPromptProcessor` 及其 ~260 行辅助代码已删除 |
| 宏展开 processor | 新增 `inference/processors/macro_expansion.ts`（`PromptTreeProcessor`）；接入 V2 pipeline（tree 构建后、权限过滤前） |
| YAML 模板 | `system_core` 宏路径修复；`role_core` 新增 `pack_actor_roles` / `owned_artifacts` 宏 |
| Trace sink 类型 | `InferenceTraceEvent.prompt` 扩展为 `PromptBundle \| PromptBundleV2` |

### 12.3 Phase 3（已完成）

| 任务 | 说明 |
|------|------|
| `runPromptWorkflowV2` | `context/workflow/runtime.ts` 新增 tree pipeline 函数 |
| Tree processors | `memory_injector.ts`, `policy_filter.ts`, `memory_summary.ts` 新增 `PromptTreeProcessor` 版本（tree→flat adapters） |
| `service.ts` 收口 | V2 路径改为单行调用 `runPromptWorkflowV2`，移除 ad-hoc 编排 |
| 默认 steps | `macro_expansion → memory_injection → policy_filter → summary_compaction → token_budget_trim → permission_filter` |

### 12.4 Phase 4（已完成）

| 任务 | 说明 |
|------|------|
| 移除 feature flag | `prompt_bundle_v2` 从 schema 和 defaults 中删除，V2 唯一路径 |
| 删除旧 builder | `prompt_builder.ts` `buildPromptBundle`/`buildPromptFragments`/`buildPromptBundleFromFragments` 及其辅助函数 ~350 行 |
| 删除旧 adapter | `prompt_bundle_adapter.ts` 整体删除 |
| 删除旧 runtime pipeline | `runPromptWorkflow`/`buildDefaultLegacySteps`/`buildExecutorRegistry` 等 ~500 行 |
| 删除 adapter wrapper | `createTreeTokenBudgetTrimmerAsLegacy` 从 `token_budget_trimmer.ts` 移除 |
| 收窄 provider 接口 | `InferenceProvider.run()` 签名从 `PromptBundle \| PromptBundleV2` 收窄为 `PromptBundleV2` |
| service.ts 简化 | 移除 V1 else 分支、`extractIncludeSections`、`getRuntimeConfig` flag 检查 |

### 12.5 后续（未纳入本轮设计）



1. **`context/workflow/runtime.ts` 新增 `runPromptWorkflowV2`** — 以 `PromptTree` 为载体的 pipeline
2. **为 memory_injector / policy_filter / memory_summary 提供 `PromptTreeProcessor` 实现**
3. **将 `service.ts` 中的 ad-hoc 编排迁移到 `runPromptWorkflowV2`**
4. **移除 token_budget_trimmer adapter** — 所有 processor 原生支持 tree 后不再需要
