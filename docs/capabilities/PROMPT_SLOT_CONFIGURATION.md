# Prompt Slot 配置指南

Prompt Bundle V2 将原先硬编码的 6 个固定 prompt 字段替换为声明式 YAML 驱动的 Slot 配置系统。你可以通过配置文件自由增减 prompt 插槽，控制每个 slot 的优先级、模板内容、消息角色和可见性。

> 设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md`
> 实施计划：`.limcode/plans/prompt-bundle-componentized-refactoring-phase1.md`

## 1. 功能状态

Prompt Bundle V2 当前通过 feature flag 控制，**默认关闭**：

```yaml
# data/configw/default.yaml
features:
  experimental:
    prompt_bundle_v2: true       # 启用新的 Slot 系统
    prompt_slot_permissions: false  # 启用 Slot 权限管理（Phase 3，尚未实现）
```

- `prompt_bundle_v2: false` → 系统使用旧版 6 字段 PromptBundle，行为不变
- `prompt_bundle_v2: true` → 系统使用新版 Slot 配置驱动的 PromptBundleV2

## 2. 核心概念

```
PromptSlotConfig (.yaml)
  └─ slot_id (如 system_core, role_core)
       ├─ default_template (宏变量模板文本)
       ├─ default_priority (数值越大越靠前)
       ├─ message_role (映射到 AiMessage 的 role)
       ├─ include_in_combined (是否出现在 combined_prompt)
       ├─ combined_heading (在 combined_prompt 中的标题)
       └─ permissions (实验性，Phase 3)
```

每个 slot 在渲染后成为 `PromptBundleV2.slots[slot_id]` 中的一个条目，key 就是 slot 的 `id` 字段。

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
| `default_priority` | number | ✅ | 默认优先级，同 slot 内数值越大越靠前 |
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

当前内置 7 个 slot，完全等价于旧版 6 字段 PromptBundle：

| slot_id | priority | message_role | 对应旧字段 |
|---------|----------|-------------|-----------|
| `system_core` | 100 | system | `system_prompt`（前半部分） |
| `system_policy` | 95 | system | 仅 `combined_prompt` |
| `role_core` | 90 | developer | `role_prompt` |
| `world_context` | 80 | system | `world_prompt` |
| `memory_summary` | 70 | user | 仅 `combined_prompt` |
| `output_contract` | 50 | user | `output_contract_prompt` |
| `post_process` | 60 | user | `context_prompt` |

向后兼容映射（通过 `toLegacyPromptBundle()`）：

```
V2 slots                    →  Legacy PromptBundle
─────────────────────────────────────────────────
system_core                 →  system_prompt
role_core                   →  role_prompt
world_context               →  world_prompt
post_process                →  context_prompt
output_contract             →  output_contract_prompt
system_policy + memory_*    →  仅在 combined_prompt 中
```

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

### 7.1 新增一个自定义世界规则 Slot

```yaml
# prompt_slots.yaml（与 ai_models.yaml 同目录）
version: 1
slots:
  custom_world_rules:
    id: custom_world_rules
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
```

### 7.2 禁用内置 Slot

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
    enabled: false   # ← 禁用
```

### 7.3 覆盖内置 Slot 的默认模板

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

Slot 的 `default_template` 使用现有 Prompt Workflow 的宏变量语法，详见 `docs/capabilities/PROMPT_WORKFLOW.md` §7。

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

## 9. 与旧系统的关系

### 9.1 双管线并存

当 `prompt_bundle_v2: false`（默认）时，系统完全走旧路径：

```
InferenceContext → buildPromptFragments() → 6 个硬编码 Fragment
  → buildPromptBundle() → PromptBundle（6 固定字段）
```

当 `prompt_bundle_v2: true` 时，走新路径：

```
InferenceContext + PromptSlotRegistry
  → buildPromptTree() → PromptTree（AST）
  → buildPromptBundleV2() → PromptBundleV2（slots map）
  → toLegacyPromptBundle() → PromptBundle（向后兼容）
```

### 9.2 迁移建议

1. **测试阶段**：在开发环境开启 `prompt_bundle_v2: true`，观察 prompt 行为是否一致
2. **自定义 Slot**：根据项目需要添加自定义 slot
3. **稳定后**：将 `prompt_bundle_v2: true` 设为生产配置（等待充分验证）

## 10. 相关文档

- Prompt Workflow Runtime：`docs/capabilities/PROMPT_WORKFLOW.md`
- 系统架构边界：`docs/ARCH.md`
- 设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md`
- 实施计划：`.limcode/plans/prompt-bundle-componentized-refactoring-phase1.md`
