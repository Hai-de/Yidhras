# Prompt Slot 配置指南

PromptBundleV2 将原先硬编码的 6 个固定 prompt 字段替换为声明式 YAML 驱动的 Slot 配置系统。你可以通过配置文件自由增减 prompt 插槽，控制每个 slot 的优先级、模板内容、消息角色和可见性。

> 设计文档：`.limcode/archive/design/prompt-bundle-componentized-refactoring-design.md`
> 实施计划：`.limcode/archive/plans/prompt-bundle-组件化重构-phase-2-推进.plan.md`

## 1. 功能状态

PromptBundleV2 是当前唯一活跃的 prompt 组装系统（V1 已完全移除）。Slot 配置系统始终启用：

```yaml
# data/configw/default.yaml
features:
  experimental:
    prompt_slot_permissions: false  # 启用 Slot 权限管理（实验性，默认关闭）
```

**当前实现状态**：全部 Phase 已完成。系统始终：

- 模板中的 `{{ }}` 宏变量在模板轨（`runTemplateTrack`）中通过 `renderNarrativeTemplate` 自动展开，产出时文本已确定
- `system_core`、`role_core`、`world_context` 等 slot 按 YAML 配置生成
- 权限过滤（`applyPermissionFilter`）在管线末端执行
- `PromptBundleV2` 是 `InferenceProvider.run()` 的唯一输入类型

## 2. 核心概念

```
PromptSlotConfig (.yaml)
  └─ slot_id (如 system_core, role_core)
       ├─ default_template (宏变量模板文本)
       ├─ position (绝对排位数值，数值越大越靠前)
       ├─ anchor (相对定位锚点，声明式语法：{ ref, relation })
       ├─ default_priority (token budget trim 优先级)
       ├─ message_role (映射到 AiMessage 的 role)
       ├─ include_in_combined (是否出现在 combined_prompt)
       ├─ combined_heading (在 combined_prompt 中的标题)
       └─ permissions (实验性)
```

每个 slot 在渲染后成为 `PromptBundleV2.slots[slot_id]` 中的一个条目，key 就是 slot 的 `id` 字段。

**排序机制**：`position`（绝对位置）和 `anchor`（相对锚点）共同决定插槽在 `combined_prompt` 中的排列顺序，`resolveSlotPositions()` 将其解析为统一的 `resolved_position` 降序序列。详见 `.limcode/design/slot-positioning-system-design.md`。

## 3. 配置位置

| 配置文件 | 优先级 | 说明 |
|----------|--------|------|
| `apps/server/src/ai/schemas/prompt_slots.default.yaml` | 基础 | 内置默认 7 槽配置，随项目发布 |
| `<workspace>/<ai_models_config_dir>/prompt_slots.yaml` | 覆盖 | 用户自定义覆盖文件，与 `ai_models.yaml` 同目录 |

合并规则：
- 内置默认 YAML 先加载
- 用户覆盖 YAML 中的 slot 会**整个替换**同 `id` 的内置 slot
- 用户覆盖 YAML 中不存在的 slot 保持不变

## 4. Slot 字段参考

每个 slot 定义包含以下字段：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | Slot 唯一标识，在 `PromptBundleV2.slots` map 中作为 key |
| `display_name` | string | ✅ | 人类可读名称 |
| `description` | string | ❌ | 描述文本 |
| `default_priority` | number | ✅ | token budget trim 优先级（数值越低越先被裁剪） |
| `position` | number | ❌ | 绝对排位数值，决定插槽在 combined_prompt 中的排列顺序。数值越大越靠前。未指定时回退到 `default_priority` |
| `anchor` | object | ❌ | 相对定位锚点 `{ ref: string, relation: 'after' \| 'before' }`。声明此插槽排在 ref 插槽的 after/before 方向。优先级高于 `position` |
| `default_template` | string | ❌ | 默认模板文本（宏变量语法），无 fragment 注入时使用 |
| `template_context` | enum | ❌ | 模板上下文来源：`inference` / `world_prompts` / `pack_state` / `none` |
| `message_role` | enum | ❌ | 映射到的 AI message role：`system` / `developer` / `user` |
| `include_in_combined` | boolean | ✅ | 是否在 `combined_prompt` 中包含此 slot |
| `combined_heading` | string | ❌ | 在 `combined_prompt` 中的标题（`null` 表示无标题） |
| `permissions` | object | ❌ | 权限默认值（实验性，Phase 3），结构见 §6 |
| `enabled` | boolean | ✅ | 是否启用此 slot（`false` 时完全跳过） |
| `metadata` | object | ❌ | 扩展元数据 |

### 4.1 `template_context` 行为

- `inference`（默认）：使用 `default_template` 字段的文本
- `world_prompts`：从当前 InferenceContext 的 `world_prompts.global_prefix` 获取模板
- `pack_state`：从 pack 状态获取模板（预留）
- `none`：不生成模板，完全依赖外部 fragment 注入

### 4.2 `message_role` 行为

决定该 slot 渲染后的内容在适配为 AiMessage[] 时归属哪个 role。仅在 `PromptBundleToAiMessagesAdapter` 中使用（Phase 2）。

## 5. 内置默认 Slot 清单

当前内置 10 个 slot（含 Phase 4 补全的 `memory_long_term` 和 `memory_short_term`）：

| slot_id | position | message_role | 说明 |
|---------|----------|-------------|------|
| `system_core` | 100 | system | 系统核心指令 |
| `system_policy` | 90 | system | 系统策略 |
| `role_core` | 80 | developer | 角色上下文 |
| `world_context` | 70 | system | 世界设定上下文 |
| `memory_summary` | 60 | user | 记忆摘要 |
| `memory_long_term` | 55 | user | 长期记忆（memory_block_fact/reflection/plan 节点注入） |
| `memory_short_term` | 52 | user | 短期记忆（manual_note/overlay 节点及未映射节点默认注入） |
| `post_process` | 50 | user | 上下文快照 |
| `output_contract` | 40 | user | 输出格式约定 |
| `conversation_history` | 30 | user | 多轮对话 transcript |

## 6. 权限字段（实验性，Phase 3）

```yaml
permissions:
  read: [host_agent]         # 允许读取 slot 内容的主体 id
  write: [host_agent]        # 允许注入 fragment 的主体 id
  adjust: [host_agent]       # 允许调整优先级/顺序/锚点的主体 id
  visible: true              # 是否可见
  visible_to: [host_agent]   # 可见性白名单（空 = 对所有主体可见）
```

> **注意**：权限系统当前仅定义了类型接口，实际执行逻辑将在 Phase 3 实现。
> 即使配置了 `permissions` 字段，在 `features.experimental.prompt_slot_permissions: false` 时也会被忽略。

## 7. 自定义 Slot 示例

### 7.1 通过锚点定位声明新插槽

```yaml
# prompt_slots.yaml（与 ai_models.yaml 同目录）
version: 1
slots:
  custom_world_rules:
    id: custom_world_rules
    display_name: "自定义世界规则"
    description: "项目特有的世界规则补充"
    default_priority: 85
    anchor:
      ref: "system_policy"
      relation: "after"       # ← 排在 system_policy 之后
    default_template: |
      本世界特有以下规则:
      {{#each pack.custom_rules as rule}}
      - {{ rule }}
      {{/each}}
    message_role: system
    include_in_combined: true
    combined_heading: "Custom World Rules"
    enabled: true
```

### 7.2 世界包动态插槽声明

世界包可在 `config.yaml` 的 `ai.slots` 中声明专属插槽，包激活时自动注册，切换/停用时自动注销。插槽 id 由 YAML key 提供（值中无需重复 `id` 字段）：

```yaml
# 世界包 config.yaml
ai:
  slots:
    custom_safety_layer:
      display_name: "安全层"
      description: "追加在世界策略之后的包专属安全约束"
      default_priority: 85
      anchor:
        ref: "system_policy"
        relation: "after"
      default_template: |
        世界包安全规则：
        1. 上述策略为本世界包的强制约束。
      message_role: "system"
      include_in_combined: true
      combined_heading: "Safety Layer"
      enabled: true
```

### 7.3 禁用内置 Slot（保留定位）

禁用后的插槽仍然存在于位置图中（`resolved_positions`），其他插槽的 `anchor.ref` 可以引用它；渲染时跳过内容产出。

```yaml
version: 1
slots:
  system_policy:
    id: system_policy
    display_name: "系统策略"
    default_priority: 95
    message_role: system
    include_in_combined: true
    combined_heading: "System Policy Prompt"
    enabled: false   # ← 禁用但保留定位
```

### 7.4 覆盖内置 Slot 的默认模板

```yaml
version: 1
slots:
  role_core:
    id: role_core
    display_name: "角色核心"
    default_priority: 90
    default_template: |
      角色名称: {{ actor.display_name }}
      角色类型: {{ actor.role }}
      所属 Agent ID: {{ actor.agent_id | default("无") }}
      当前 Tick: {{ runtime.current_tick }}
    message_role: developer
    include_in_combined: true
    combined_heading: "Role Prompt"
    enabled: true
```

## 8. 模板宏变量语法

Slot 的 `default_template` 使用现有 Prompt Workflow 的宏变量语法，详见 `PROMPT_WORKFLOW.md` §7。

### 8.1 基础插值

```txt
{{ actor.display_name }}
{{ request.strategy }}
{{ pack.metadata.name }}
```

### 8.2 默认值

```txt
{{ actor.agent_id | default("none") }}
```

### 8.3 条件块

```txt
{{#if actor.has_bound_artifact}}
当前主体持有关键媒介。
{{/if}}
```

### 8.4 列表展开

```txt
{{#each runtime.owned_artifacts as artifact}}
- {{ artifact.id }}
{{/each}}
```

### 8.5 Slot 内引用其他 Slot

当前版本不支持在模板中引用其他 slot 的内容（如 `{{ slots.system_core }}`）。
此功能留待后续版本评估。

## 9. 当前管线

System B 多轨汇合是唯一活跃路径：

```
InferenceContext + PromptSlotRegistry
  → resolveSlotPositions() → resolved_positions
  → 模板轨 / 节点轨 / 快照轨 / 对话历史轨 → PromptSectionDraft[]
  → placement_resolution → fragment_assembly → behavior_control
    → content_transform → permission_filter → token_budget_trim
    → bundle_finalize
  → PromptBundleV2（slots map + slot_order）
  → assembler（按 resolved_position 组装 AiMessage[]）
  → InferenceProvider.run(context, bundle)
```

> 完整管线细节见 `PROMPT_WORKFLOW.md`。

## 10. 插槽行为控制（Slot Behavior Control）

每个插槽可以声明行为控制元数据，在 `behavior_control` 管线步骤中决定插槽的激活/禁用、递归约束、token 预算行为。

### 10.1 配置位置

```yaml
# data/configw/default.yaml
slot_behaviors:
  system_core:
    always_active: true
    no_recursion: true
    ignore_context_length: true

  memory_summary:
    trigger_probability: 0.8
    conditions:
      - type: conversation_turn
        operator: gt
        value: 3
    sticky:
      max_activations: 5
    cooldown:
      ticks: 10
    max_depth: 2
    state_scope: conversation
```

### 10.2 行为控制字段

| 类别 | 字段 | 说明 |
|------|------|------|
| **激活控制** | `always_active` | 跳过所有条件检查，始终激活 |
| | `trigger_probability` | 0.0–1.0，FNV-1a 确定性采样 |
| | `conditions` | 条件列表（AND/OR 语义） |
| | `condition_combination` | `and`（默认）或 `or` |
| | `evaluator_failure_policy` | 评估失败策略：`activate`（默认）、`deactivate`、`abort` |
| **深度/递归** | `max_depth` | slot-ref 嵌套最大深度 |
| | `no_recursion` | 禁止自引用 |
| | `prevent_further_recursion` | 被引用时不再解析子 slot-ref |
| **顺序/群组** | `group_id` / `group_weight` | 群组标识与权重（互斥选择） |
| | `group_mode` | `exclusive`（默认）、`priority`、`budget` |
| | `render_order` | 排序优先级覆盖 |
| **状态性规则** | `sticky` | 触发后保留指定次数激活（`max_activations`） |
| | `cooldown` | 触发后冷却指定世界 tick 数（`ticks`） |
| | `delayed_trigger` | 条件满足后延迟指定 tick 数才激活（`delay_ticks`） |
| **上下文控制** | `ignore_context_length` | 不参与 token budget trim（80% 硬上限保护） |
| **状态生命周期** | `state_scope` | `conversation`（默认）、`inference`、`persistent` |
| **插件扩展** | `condition_evaluator` | 自定义条件评估器 key（per-pack 注册） |

### 10.3 内置条件类型

| 类型 | 字段 | 说明 |
|------|------|------|
| `keyword_match` | `keywords`, `match_mode` | 匹配 `last_user_message` 中的关键字 |
| `logic_match` | `expression` | DSL 逻辑表达式（eq/neq/gt/lt/gte/lte/contains/exists/and/or/not） |
| `context_length` | `operator`, `value` | 对比 `token_budget.remaining` |
| `conversation_turn` | `operator`, `value` | 对比 `conversation_meta.turn_count` |
| `custom` | `evaluator_key`, `options` | 通过插件注册表查询 per-pack 评估器 |

### 10.4 状态机

5 状态模型（对齐 memory_trigger sidecar）：

```
Pending → [条件满足] → Active → [sticky] → Retained → [cooldown] → Cooling → Pending
Pending → [条件满足+delay] → Delayed → [delay_elapsed] → Active
```

Cooling 优先级最高：即使 sticky 仍有次数，冷却期也不激活。

### 10.5 配置约束

- `always_active` + `conditions` → 配置错误（加载时拒绝）
- `always_active` + `group_id` → 配置错误（加载时拒绝）
- 所有 `ignore_context_length` 插槽的 token 总和不超过模型上下文窗口 80%

> 完整设计见 `.limcode/design/slot-function-advanced-design.md`。

## 11. 相关文档

- Prompt Workflow Runtime：`PROMPT_WORKFLOW.md`
- 系统架构边界：`../ARCH.md`
- 设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md`
- 实施计划：`.limcode/archive/plans/prompt-bundle-componentized-refactoring-phase1.md`
