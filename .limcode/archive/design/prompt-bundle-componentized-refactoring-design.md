# Prompt Bundle 组件化重构设计

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

/**
 * 块是 prompt 树的最小内容单元。
 * 类比 AST 中的叶子节点：文本字面量、宏引用、条件语句、循环语句、JSON 数据。
 */
export type PromptBlockKind =
  | 'text'          // 纯文本
  | 'macro_ref'     // 宏变量引用 {{ ... }}
  | 'conditional'   // #if / #unless 条件块
  | 'loop'          // #each 循环块
  | 'json';         // 结构化 JSON 数据

export interface PromptBlock {
  /** 块唯一标识 */
  id: string;
  /** 块类型 */
  kind: PromptBlockKind;
  /** 渲染后的缓存纯文本（由宏展开阶段填充） */
  rendered?: string | null;
  /** 类型相关的具体内容 */
  content: PromptBlockContent;
  /** 元数据（来源、诊断等） */
  metadata?: Record<string, unknown>;
}

export type PromptBlockContent =
  | { kind: 'text'; text: string }
  | { kind: 'macro_ref'; path: string; default_value?: string | null }
  | { kind: 'conditional'; predicate_path: string; children: PromptBlock[]; else_children?: PromptBlock[] }
  | { kind: 'loop'; iterator_path: string; item_alias: string; children: PromptBlock[] }
  | { kind: 'json'; value: Record<string, unknown> };
```

**设计决策**：
- `rendered` 字段由宏展开阶段写入，后续阶段不再重复展开
- Block 不直接持有权限 —— 权限属于其父 Fragment/Slot
- `conditional` 和 `loop` 天然支持嵌套子 Block，形成递归树

---

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

/**
 * Fragment 是 Slot 内部的中间节点。
 * 可以是 Block 的容器，也可以嵌套其他 Fragment。
 * 类比 AST 中的非叶子节点：分组、排序、锚定。
 */
export interface PromptFragment {
  /** 唯一标识 */
  id: string;
  /** 所属 Slot 的 id */
  slot_id: string;
  /** 优先级（同 slot 内排序用，数值越大越靠前） */
  priority: number;
  /** 来源标识（如 'system.core'、'world_prompts.global_prefix'） */
  source: string;
  /** 是否可被 budget trimming 移除 */
  removable: boolean;
  /** 是否可被同名 source 的 fragment 替换 */
  replaceable: boolean;

  // --- 嵌套子节点（核心变化） ---
  /** 子节点：Block 或嵌套 Fragment */
  children: Array<PromptBlock | PromptFragment>;

  // --- 放置语义 ---
  anchor?: PromptFragmentAnchor | null;
  placement_mode?: PromptFragmentPlacementMode | null;
  depth?: number | null;
  order?: number | null;

  // --- 权限标记（实验性） ---
  permissions?: PromptFragmentPermissions | null;

  metadata?: Record<string, unknown>;
}

/**
 * Fragment 级别的权限声明。
 * 该 fragment 及其所有子 Block 继承此权限。
 * 仅在 features.experimental.prompt_slot_permissions 启用时生效。
 */
export interface PromptFragmentPermissions {
  /** 允许读取内容的主体 id 列表（host_agent / agent:xxx） */
  read?: string[];
  /** 允许创建/注入子节点的主体 id 列表 */
  write?: string[];
  /** 允许调整优先级/顺序/锚点的主体 id 列表 */
  adjust?: string[];
  /** 该 fragment 在最终 prompt 中是否可见 */
  visible: boolean;
  /** 可见性 checker：无 → 始终可见；有 → 需匹配主体才会渲染到 combined_prompt */
  visible_to?: string[];
}
```

**设计决策**：
- `children` 使用 `Array<PromptBlock | PromptFragment>` 实现嵌套
- 叶子 Fragment 的 children 里全是 Block
- 非叶子 Fragment 可包含子 Fragment（用于分组和共享权限）
- `permissions` 字段可选，`null` 表示沿用父级或系统默认

---

### 2.3 声明式插槽定义：PromptSlotConfig

```typescript
// --- prompt_slot_config.ts ---

/**
 * 单个 Slot 的声明式配置。
 * 来自 YAML 配置文件（如 prompt_slots.yaml）或 World Pack 的 pack.ai.slots。
 */
export interface PromptSlotConfig {
  /** Slot 唯一标识，在 PromptBundle.slots map 中作为 key */
  id: string;
  /** 人类可读名称 */
  display_name: string;
  /** 描述 */
  description?: string;
  /** 默认优先级（可被 fragment 覆盖） */
  default_priority: number;
  /** 默认模板（宏变量语法），未提供 fragment 时使用 */
  default_template?: string | null;
  /** 模板使用的变量上下文来源 */
  template_context?: 'inference' | 'world_prompts' | 'pack_state' | 'none';
  /** 该 slot 生成的 prompt 映射到哪个 AiMessage role */
  message_role?: 'system' | 'developer' | 'user';
  /** 是否在 combined_prompt 中包含（false → 仅 slots map 可访问） */
  include_in_combined: boolean;
  /** combined_prompt 中的标题（null → 不显示标题） */
  combined_heading?: string | null;
  /** 权限默认值（可被 fragment 覆盖） */
  permissions?: PromptFragmentPermissions | null;
  /** 是否启用 */
  enabled: boolean;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 完整的 Slot 配置注册表。
 * 支持 YAML 文件加载 + World Pack 覆盖 + 内置默认合并。
 */
export interface PromptSlotRegistry {
  /** 配置版本 */
  version: number;
  /** slot_id → 配置 */
  slots: Record<string, PromptSlotConfig>;
  /** 加载元数据 */
  metadata?: {
    workspace_root?: string;
    config_path?: string;
    loaded_from_file?: boolean;
  };
}
```

**设计决策**：
- `id` 是通用 string，不再受字面量联合类型限制
- `default_template` 使用现有宏变量语法（`{{ actor.display_name }}`、`{{#if}}`、`{{#each}}`）
- `message_role` 决定渲染后的 slot 内容归属哪个 AI message
- `include_in_combined` 解决 "system_policy 只在 combined_prompt 出现" 的需求
- `permissions` 是 slot 级别的默认权限，fragment 可以覆盖

---

### 2.4 Prompt 树：PromptTree

```typescript
// --- prompt_tree.ts ---

import type { PromptFragment } from './prompt_fragment.js';

/**
 * PromptTree 是单次推理的完整 prompt AST。
 * 顶层是 Slot → Fragment 的映射。
 */
export interface PromptTree {
  /** 本次推理的唯一标识 */
  inference_id: string;
  /** task type */
  task_type: string;
  /** slot_id → 该 slot 的顶层 fragment 列表（已排序、已 placement 解析） */
  fragments_by_slot: Record<string, PromptFragment[]>;
  /** 所有 slot 的配置快照 */
  slot_registry: Record<string, PromptSlotConfig>;
  /** 树级别元数据 */
  metadata: PromptTreeMetadata;
}

export interface PromptTreeMetadata {
  prompt_version: string;
  profile_id: string | null;
  profile_version: string | null;
  /** 所有 fragment 的扁平 source 列表（向后兼容） */
  source_prompt_keys: string[];
  /** workflow 诊断信息 */
  workflow?: PromptWorkflowMetadata;
  /** 处理 trace */
  processing_trace?: PromptProcessingTrace;
}
```

---

### 2.5 最终产物：PromptBundleV2

```typescript
// --- prompt_bundle_v2.ts ---

/**
 * PromptBundleV2 是重构后的最终产物。
 * 与旧版 PromptBundle 并存，通过 feature flag 切换。
 */
export interface PromptBundleV2 {
  /** Slot → 渲染后纯文本 的映射 */
  slots: Record<string, string>;
  /** 所有 slot 拼接的完整 prompt */
  combined_prompt: string;
  /** 元数据 */
  metadata: PromptBundleMetadata;
  /** 原始树（调试/观测用） */
  tree: PromptTree;
}

/**
 * 将 PromptBundleV2 适配为 AiMessage[] 的函数签名。
 * 替代当前 adaptPromptBundleToAiMessages。
 */
export interface PromptBundleToAiMessagesAdapter {
  adapt(bundle: PromptBundleV2, taskConfig: AiResolvedTaskConfig): AiMessage[];
}
```

**向后兼容性**：

```typescript
// 旧版 PromptBundle 可通过此函数从 V2 派生
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
export interface PermissionCheckInput {
  slot_config: PromptSlotConfig;
  fragment: PromptFragment;
  actor_ref: InferenceActorRef;
  host_agent_ids: string[];
  permission_kind: 'read' | 'write' | 'adjust' | 'visibility';
}

export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * 层级回退：fragment 权限 > slot 默认权限 > 全通（feature off）
 */
export function resolveSlotPermission(input: PermissionCheckInput): PermissionCheckResult {
  const featureEnabled = getRuntimeConfig().features?.experimental?.prompt_slot_permissions;
  if (!featureEnabled) {
    return { allowed: true };  // 功能关闭 → 全通
  }

  const allowedList =
    input.fragment.permissions?.[input.permission_kind]
    ?? input.slot_config.permissions?.[input.permission_kind]
    ?? null;

  // null 表示未配置该权限 → 允许
  if (allowedList === null) {
    return { allowed: true };
  }

  // host_agent 是最高权限主体
  const subjectIds = [
    ...input.host_agent_ids,
    input.actor_ref.identity_id,
    input.actor_ref.agent_id
  ].filter((id): id is string => id !== null);

  const allowed = allowedList.some(id => subjectIds.includes(id));
  return {
    allowed,
    reason: allowed ? undefined : `actor not in ${input.permission_kind} allowlist`
  };
}
```

### 3.4 宿主 Agent 的识别

```typescript
/**
 * 宿主 Agent 来源：
 * 1. 在项目 constitution 中声明为 host_agents 的 identity
 * 2. 通过 Operator binding 绑定到 type='user' IdentityNode 的 Agent
 *
 * 这些信息在 buildInferenceContext 阶段已解析为 InferenceContext，
 * 不需要额外 DB 查询。
 */
export function getHostAgentIds(context: InferenceContext): string[] {
  // 当前简化实现：有 Operator 控制的 Agent 即为宿主 Agent
  const bindingAgentId = context.binding_ref?.agent_id;
  // 从 world_pack 配置读取
  const packHostAgents: string[] = 
    context.world_pack.host_agent_ids ?? [];
  return [
    ...packHostAgents,
    ...(bindingAgentId ? [bindingAgentId] : [])
  ];
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

### 4.2 用户覆盖示例

```yaml
# 用户项目目录: workspace/prompt_slots.override.yaml
version: 1
slots:
  custom_world_rules:
    display_name: "自定义世界规则"
    description: "项目特有的世界规则补充"
    default_priority: 85
    default_template: |
      本世界特有以下规则:
      {{#each pack.custom_rules as rule}}
      - {{ rule }}
      {{/each}}
    message_role: system
    include_in_combined: true
    combined_heading: "Custom World Rules"
    enabled: true
    permissions:
      read: [host_agent]
      write: [host_agent]
      adjust: [host_agent]
      visible: true
      visible_to: [host_agent]

  memory_long_term:
    display_name: "长期记忆"
    description: "覆盖内置 memory_summary，提供独立长期记忆插槽"
    default_priority: 73
    message_role: user
    include_in_combined: true
    combined_heading: "Long-Term Memory"
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

### 5.2 树遍历工具

```typescript
/**
 * 深度优先遍历 PromptTree 中的所有 Block。
 * 权限过滤后的 Fragment 不进入遍历。
 */
export function walkPromptBlocks(
  tree: PromptTree,
  visitor: (block: PromptBlock, ancestors: Array<PromptFragment | PromptBlock>) => void
): void {
  for (const fragments of Object.values(tree.fragments_by_slot)) {
    for (const fragment of fragments) {
      walkFragment(fragment, [fragment], visitor);
    }
  }
}

function walkFragment(
  fragment: PromptFragment,
  ancestors: Array<PromptFragment | PromptBlock>,
  visitor: (block: PromptBlock, ancestors: Array<PromptFragment | PromptBlock>) => void
): void {
  for (const child of fragment.children) {
    if ('kind' in child) {
      // Block
      visitor(child, [...ancestors, child]);
      // 递归进入 Block 的子节点（conditional/loop 的 children）
      if (child.kind === 'conditional' || child.kind === 'loop') {
        const nested = (child.content as { children?: PromptBlock[] }).children;
        if (nested) {
          for (const nestedBlock of nested) {
            visitor(nestedBlock, [...ancestors, child, nestedBlock]);
          }
        }
      }
    } else {
      // Fragment
      walkFragment(child, [...ancestors, child], visitor);
    }
  }
}

/**
 * 将树中所有 Block 的 rendered 文本拼接为单个 slot 的渲染结果。
 */
export function renderSlotText(tree: PromptTree, slotId: string): string {
  const fragments = tree.fragments_by_slot[slotId] ?? [];
  const lines: string[] = [];
  walkPromptBlocks(
    { ...tree, fragments_by_slot: { [slotId]: fragments } } as PromptTree,
    (block) => {
      if (block.rendered) lines.push(block.rendered);
    }
  );
  return lines.join('\n');
}
```

---

## 6. Processor 接口变更

### 6.1 当前签名

```typescript
// 当前
export interface PromptProcessor {
  name: string;
  process(input: PromptProcessorInput): Promise<PromptFragment[]>;
}
// input.fragments 是平面 PromptFragment[]
```

### 6.2 新签名

```typescript
// 新
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

Processor 现在接收/返回完整 `PromptTree`，内部自行遍历 `fragments_by_slot` 树结构。这使 processor 可以：
- 跨 slot 操作（如 memory_injector 往多个 slot 注入）
- 在特定 Fragment 层级添加/删除子节点
- 基于 `ancestors` 上下文做决策

---

## 7. 影响范围

### 7.1 新增文件

| 文件 | 职责 |
|------|------|
| `inference/prompt_block.ts` | `PromptBlockContent` 类型定义 |
| `inference/prompt_fragment.ts` | `PromptFragment`（树结构版）、`PromptFragmentPermissions` |
| `inference/prompt_slot_config.ts` | `PromptSlotConfig`、`PromptSlotRegistry` |
| `inference/prompt_tree.ts` | `PromptTree`、`PromptTreeMetadata`、walker 工具函数 |
| `inference/prompt_bundle_v2.ts` | `PromptBundleV2`、`PromptBundleToAiMessagesAdapter`、兼容转换函数 |
| `ai/schemas/prompt_slots.default.yaml` | 内置默认 slot 配置 |
| `inference/prompt_builder_v2.ts` | `buildPromptTree()`、`buildPromptBundleV2()` |
| `inference/prompt_permissions.ts` | `resolveSlotPermission()` 等权限工具 |
| `ai/adapters/prompt_tree_adapter.ts` | `PromptTree → AiMessage[]` 新适配器 |

### 7.2 修改文件

| 文件 | 变更 |
|------|------|
| `inference/prompt_fragments.ts` | 保留旧版 `PromptFragment`（平面），标记 `@deprecated` |
| `inference/types.ts` | 保留旧 `PromptBundle`，新增 `PromptBundleV2` |
| `inference/prompt_builder.ts` | 保留旧函数，新增 `buildPromptBundleV2` 入口 |
| `context/workflow/types.ts` | `PromptWorkflowState` 增加 `tree?: PromptTree` |
| `context/workflow/runtime.ts` | `runPromptWorkflow` 支持 `PromptTree` 模式 |
| `ai/adapters/prompt_bundle_adapter.ts` | 保留旧适配器，标记 `@deprecated` |
| `inference/service.ts` | feature flag 驱动选择新旧管线 |
| `ai/task_service.ts` | 可选接收 `PromptBundleV2` 并适配 |
| `config/runtime_config.ts` | 新增 `features.experimental.prompt_slot_permissions` |
| `ai/registry.ts` | 新增 `loadPromptSlotRegistry()` |

### 7.3 不变文件

- `inference/processors/*` — 保留旧 `PromptProcessor` 接口用于兼容
- `ai/gateway.ts` / `route_resolver.ts` — 不感知 prompt 组装细节
- `narrative/resolver.ts` — 宏展开逻辑不变，只是调用入口从 `prompt_builder` 移到 Block 渲染阶段
- `context/workflow/placement_resolution.ts` — placement 算法逻辑保留，适配树结构遍历

---

## 8. Feature Flag 设计

```typescript
// config/runtime_config.ts 新增
export interface ExperimentalFeatures {
  // ... existing ...
  /** 启用 Prompt Slot 权限管理（默认关闭） */
  prompt_slot_permissions?: boolean;
  /** 启用 PromptBundleV2 新的树形结构（默认关闭） */
  prompt_bundle_v2?: boolean;
}
```

### 8.1 新旧管线切换

```typescript
// inference/service.ts
async function runPromptBundle(...): Promise<PromptBundle | PromptBundleV2> {
  const config = getRuntimeConfig();
  if (config.features?.experimental?.prompt_bundle_v2) {
    const tree = await buildPromptTree(context);
    const filtered = await applyPermissions(tree, context);  // 仅当 prompt_slot_permissions 开启
    const orchestrated = await runPromptWorkflowV2(context, filtered, options);
    return buildPromptBundleV2(orchestrated.tree, context);
  }
  // 旧管线
  return buildPromptBundle(context, options);
}
```

---

## 9. 迁移策略

```
Phase 1: 新接口并置（不影响现有功能）
  ├─ 定义所有新接口（BlockFragment/PromptTree/PromptBundleV2）
  ├─ 编写默认 slot 配置（等价于当前 6 个硬编码 slot）
  ├─ 实现 buildPromptTree() 和 buildPromptBundleV2()
  ├─ 旧代码标记 @deprecated 但完全保留
  └─ feature flag prompt_bundle_v2 默认 false

Phase 2: 适配器层切换
  ├─ 实现 PromptTree → AiMessage 新适配器
  ├─ task_service.ts 同时支持新旧 Bundle
  └─ gateway_backed provider 切换到新适配器

Phase 3: 权限管理（实验性）
  ├─ features.experimental.prompt_slot_permissions 默认 false
  ├─ 实现 resolveSlotPermission
  └─ 在 PromptWorkflowRuntime 中挂载权限过滤步骤

Phase 4: 清理（未来）
  ├─ 移除旧 PromptBundle 和旧 adapter
  └─ 删除 @deprecated 代码
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
- TODO：`TODO.md` → 「提示词组装（Prompt Bundle）重构」条目
