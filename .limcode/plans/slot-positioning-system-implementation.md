# 插槽定位系统 — 实现记录

> 关联设计: `.limcode/design/slot-positioning-system-design.md`
> 完成日期: 2026-05-06
> 状态: ✅ 全部完成（Phase 1–4）

## 总览

| Phase | 范围 | 状态 |
|-------|------|------|
| Phase 1 | 类型与解析器（零行为变更） | ✅ |
| Phase 2 | 消费方适配（行为变更） | ✅ |
| Phase 3 | 片段级锚点补全 | ✅ |
| Phase 4 | 动态注册 API + PromptFragmentSlot 开放 | ✅ |

## Phase 1 — 类型与解析器

新增 `PromptSlotConfig.position` 和 `anchor` 字段（均可选/nullable），新建核心解析器，为内置插槽 YAML 添加显式 `position`。**零运行时行为变更**。

### 类型定义

**`apps/server/src/inference/prompt_slot_config.ts`**:
- `SlotAnchor` — `{ ref: string; relation: 'after' | 'before' }`
- `ResolvedSlotPosition` — `{ slot_id, resolved_position, resolution_source, enabled }`
- `SlotPositionDiagnostics` — `{ warnings[], resolution_map[] }`
- `PromptSlotConfig` 新增 `position?: number | null` 和 `anchor?: SlotAnchor | null`

### 核心解析器

**`apps/server/src/ai/slot_position_resolver.ts`** — 纯函数 `resolveSlotPositions()`:
1. 分类插槽（显式 position vs anchor）
2. DFS 环路检测（三色标记法）
3. 缺失 ref 降级 + diagnostic
4. 迭代拓扑解析锚点（中点分配：`(lo + hi) / 2`）
5. 环路/未解析锚点降级
6. 碰撞检测 + 降序稳定排序（position 降序 → slot_id 字母序）

### Zod Schema

**`apps/server/src/ai/registry.ts`** — `promptSlotConfigSchema` 新增 `position` 和 `anchor` 字段。

### 默认 YAML

**`apps/server/src/ai/schemas/prompt_slots.default.yaml`** — 10 个内置插槽添加 `position`（100, 90, 80, 70, 60, 55, 52, 50, 40, 30）。

### 测试

**`tests/unit/slot_position_resolver.spec.ts`** — 27 个测试：纯数值排序、纯锚点排序、混合、禁用插槽锚点、环路检测、不存在 ref、碰撞处理、深度细分极限（线性探测）、向后兼容。

---

## Phase 2 — 消费方适配

将 Phase 1 的类型与解析器接入运行时。`buildPromptTree` 调用 `resolveSlotPositions()`，所有消费方按 `resolved_positions` 排序。

### 类型扩展

**`apps/server/src/inference/prompt_tree.ts`** — `PromptTree` 新增 `resolved_positions: ResolvedSlotPosition[]`

**`apps/server/src/inference/prompt_bundle_v2.ts`** — `PromptBundleV2` 新增 `slot_order: string[]`

**`apps/server/src/context/workflow/types.ts`**:
- `PromptWorkflowState` 新增 `resolved_positions?: ResolvedSlotPosition[]`
- `PromptWorkflowDiagnostics` 新增 `slot_position_diagnostics?: SlotPositionDiagnostics`
- `createInitialPromptWorkflowState` 传播 `tree.resolved_positions`

### 构建函数

**`apps/server/src/inference/prompt_builder_v2.ts`**:
- `buildPromptTree()` — 调用 `resolveSlotPositions(slotRegistry)`，按 `resolved_positions` 遍历；禁用插槽赋 `fragments_by_slot[id] = []`
- `buildPromptBundleV2()` — 按 `resolved_positions` 遍历，生成 `slot_order`，输出 `slots` + `combined_prompt` 按解析顺序

### 工作流流水线

**`apps/server/src/context/workflow/orchestrator.ts`** — tracks 执行前调用 `resolveSlotPositions()` 并赋值 `state.resolved_positions` 和 `state.diagnostics.slot_position_diagnostics`；传递 `resolved_positions` 给 `runTemplateTrack` 和 `runConversationHistoryTrack`

**`apps/server/src/context/workflow/executors/fragment_assembly.ts`** — `tree.resolved_positions` 从 `state.resolved_positions` 传播

### 轨道适配

**`apps/server/src/context/workflow/tracks/template_track.ts`**:
- 签名新增 `resolvedPositions: ResolvedSlotPosition[]`
- 遍历 `resolvedPositions` 替代 `Object.values(slotRegistry)`
- `placement.order` 使用 `resolved.resolved_position`

**`apps/server/src/context/workflow/tracks/conversation_history_track.ts`** — 签名新增 `resolvedPositions?: ResolvedSlotPosition[]`

### 消息组装

**`apps/server/src/conversation/assembler.ts`**:
- `extractNonConversationSlots` — 遍历优先使用 `slot_order`，回退 `Object.keys(registry)`
- `priority` 使用 `resolved_position`（优先），回退 `default_priority`
- 隐式角色回退：`format_config.slots` 未覆盖时使用 `PromptSlotConfig.message_role`

### 测试适配

| 文件 | 变更 |
|------|------|
| `tests/unit/template_track.spec.ts` | 新增 `resolveSlotPositions(registry).resolved_positions` 参数 |
| `tests/unit/prompt_bundle_v2.spec.ts` | 新增 `position` 字段；T4 验证禁用插槽在 tree 中保留 |
| `tests/unit/post_merge_executors.spec.ts` | `buildTree` 新增 `resolved_positions` |
| `tests/integration/slot_positioning.spec.ts` | 新建 — 3 个集成测试 |

---

## Phase 3 — 片段级锚点补全

补全 `placement_resolution.ts` 中 `before_anchor` / `after_anchor` 的真实锚定逻辑。

### 锚点解析

**`apps/server/src/context/workflow/executors/placement_resolution.ts`**:

- `findAnchorTarget()` — 按 `anchor.kind` 查找目标：
  - `slot_start` → index 0
  - `slot_end` → index `working.length - 1`
  - `fragment_id` → 匹配 `PromptSectionDraft.id`（注释说明命名由来）
  - `source` → 匹配 `source_node_ids` 或 `metadata.source`
  - `tag` → 始终返回 -1（支架，降级 + `tag_not_implemented` diagnostic）
- `insertByOrder()` — 降级时按 `placement.order` 降序插入
- 算法：prepend → middle(sorted) → append 骨架，anchored draft 按 order 降序逐个解析并 splice 到目标位置

### 类型扩展

**`apps/server/src/context/workflow/types.ts`**:
- `AnchorDiagnostic` — `{ draft_id, slot_id, anchor_kind, anchor_value, code, message? }`
- `PromptWorkflowPlacementSummary.anchor_diagnostics?: AnchorDiagnostic[]`

### 测试

**`tests/unit/placement_resolution.spec.ts`** — 新建，8 个测试：slot_start、slot_end、fragment_id before/after、source 锚定、目标未找到降级、tag 支架降级、prepend+anchored+middle+append 混合。

### 已知限制

当前无 track 产出 `before_anchor`/`after_anchor` 的 section draft，锚点解析逻辑仅通过单元测试覆盖。

---

## Phase 4 — 动态注册 API

### PromptFragmentSlot 开放

**`apps/server/src/inference/prompt_slot_config.ts`** — `PromptFragmentSlot` 从闭合联合类型（10 字面量）改为 `string`

**`apps/server/src/memory/blocks/types.ts`** — `MemoryPlacementSlot` 同步从 `Extract<PromptFragmentSlot, ...>` 改为 `string`

### 运行时 API

**`apps/server/src/ai/registry.ts`**:

- `BUILTIN_SLOT_IDS` — 10 个内置插槽 ID 的 `Set`
- `registerDynamicSlot(config): boolean` — 运行时注册；内置 ID 拒绝；YAML 同名拒绝
- `unregisterDynamicSlot(slotId): boolean` — 注销动态插槽；内置/YAML 插槽不可注销
- `setSlotEnabled(slotId, enabled): boolean` — 启用/禁用任意插槽
- `listDynamicSlots(): ParsedPromptSlotConfig[]` — 仅动态插槽
- `PromptSlotRegistryCache` 扩展 `dynamic_slots: Map<string, ParsedPromptSlotConfig>`
- `getPromptSlotRegistry()` 合并 YAML + 动态插槽（YAML 优先）

### YAML 补全

**`apps/server/src/ai/schemas/prompt_slots.default.yaml`** — 新增 `memory_long_term`（position: 55）和 `memory_short_term`（position: 52），解决 node_track 产出无对应 slot registry 条目的遗漏问题。

### 测试

**`tests/unit/dynamic_slot_registry.spec.ts`** — 新建，12 个测试：注册、YAML 覆盖保护、内置保护、注销、注销被拒、注销不存在、启用切换动态/内置/setEnabled 拒绝不存在、resolveSlotPositions 集成、禁用保留位置、listDynamicSlots。

---

## 完整文件变更清单

| 文件 | Phase | 说明 |
|------|-------|------|
| `apps/server/src/inference/prompt_slot_config.ts` | 1, 4 | 新增 SlotAnchor/ResolvedSlotPosition/SlotPositionDiagnostics；PromptSlotConfig 新增 position/anchor；PromptFragmentSlot → string |
| `apps/server/src/ai/slot_position_resolver.ts` | 1 | 新建 — resolveSlotPositions() 核心算法 |
| `apps/server/src/ai/registry.ts` | 1, 4 | promptSlotConfigSchema 扩展；新增 registerDynamicSlot/unregisterDynamicSlot/setSlotEnabled/listDynamicSlots/BUILTIN_SLOT_IDS；PromptSlotRegistryCache 扩展 dynamic_slots |
| `apps/server/src/ai/schemas/prompt_slots.default.yaml` | 1, 4 | 10 个内置插槽添加 position；新增 memory_long_term/memory_short_term |
| `apps/server/src/inference/prompt_tree.ts` | 2 | PromptTree 新增 resolved_positions |
| `apps/server/src/inference/prompt_bundle_v2.ts` | 2 | PromptBundleV2 新增 slot_order |
| `apps/server/src/inference/prompt_builder_v2.ts` | 2 | buildPromptTree 调用 resolveSlotPositions；buildPromptBundleV2 按 resolved_positions 遍历 |
| `apps/server/src/context/workflow/types.ts` | 2, 3 | PromptWorkflowState 新增 resolved_positions；PromptWorkflowDiagnostics 新增 slot_position_diagnostics；PromptWorkflowPlacementSummary 新增 anchor_diagnostics；新增 AnchorDiagnostic 类型 |
| `apps/server/src/context/workflow/orchestrator.ts` | 2 | tracks 前调用 resolveSlotPositions；传播 resolved_positions |
| `apps/server/src/context/workflow/executors/fragment_assembly.ts` | 2 | 传播 resolved_positions 到 PromptTree |
| `apps/server/src/context/workflow/executors/placement_resolution.ts` | 3 | 补全锚点查找逻辑（findAnchorTarget/insertByOrder） |
| `apps/server/src/context/workflow/tracks/template_track.ts` | 2 | 签名新增 resolvedPositions；按解析顺序遍历 |
| `apps/server/src/context/workflow/tracks/conversation_history_track.ts` | 2 | 签名新增 resolvedPositions |
| `apps/server/src/conversation/assembler.ts` | 2 | 使用 slot_order 遍历；resolved_position 优先级；隐式角色回退 |
| `apps/server/src/memory/blocks/types.ts` | 4 | MemoryPlacementSlot → string |
| `tests/unit/slot_position_resolver.spec.ts` | 1 | 新建 — 27 个测试 |
| `tests/unit/placement_resolution.spec.ts` | 3 | 新建 — 8 个测试 |
| `tests/unit/dynamic_slot_registry.spec.ts` | 4 | 新建 — 12 个测试 |
| `tests/integration/slot_positioning.spec.ts` | 2 | 新建 — 3 个集成测试 |
| `tests/unit/template_track.spec.ts` | 2 | 适配 — resolvedPositions 参数 |
| `tests/unit/prompt_bundle_v2.spec.ts` | 2 | 适配 — position 字段 + 禁用插槽断言 |
| `tests/unit/post_merge_executors.spec.ts` | 2, 3 | 适配 — resolved_positions + 锚点测试更新 |

## 测试统计

| 文件 | 测试数 |
|------|--------|
| `slot_position_resolver.spec.ts` | 27 |
| `placement_resolution.spec.ts` | 8 |
| `dynamic_slot_registry.spec.ts` | 12 |
| `slot_positioning.spec.ts` (integration) | 3 |
| 适配的现有测试 | 21 |
| **总计** | **71** |

## 已知情况

1. Phase 3 锚点解析无 track 消费 — `before_anchor`/`after_anchor` 仅通过单元测试覆盖
2. `conversation_history_track` 接受 `resolvedPositions` 但未使用 — 对话历史记录按 turn_number 排序，不依赖位置
3. `tag` 锚点类型仅支架 — 待 `metadata.tag` 标准化后激活
4. 世界包插槽 schema 与加载集成延后 — 待首个需要动态插槽的世界包出现
