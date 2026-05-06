# 插槽定位系统设计

> 状态: 草案
> 关联: TODO.md — 插槽函数 · 内置slot定位；`apps/server/src/inference/prompt_slot_config.ts`；`apps/server/src/context/workflow/executors/placement_resolution.ts`
> 前置: 模板引擎统一（`.limcode/design/template-engine-unification-design.md`，已完成）
> 约束: 本设计仅涉及插槽层定位与片段层锚定，不涉及模板引擎渲染层（`slot-ref` 块处理器已由模板引擎统一设计覆盖）

## 1. 问题陈述

### 1.1 当前缺陷

当前系统有两个独立的排序机制——插槽间排序和片段内排序——但两者都有结构性缺陷：

**插槽间排序（Slot-level）**：

1. **无显式排序字段** — `buildPromptBundleV2` 按 `Object.keys(tree.slot_registry)` 遍历（即 YAML 键声明顺序），`default_priority` 仅用于 token budget trim 优先级（`token_budget_trim.ts`），不控制渲染顺序
2. **禁用即消失** — `buildPromptTree` 跳过 `enabled=false` 的插槽（`prompt_builder_v2.ts:123-126`），禁用插槽从 `fragments_by_slot` 中完全移除，其他插槽/片段无法以它为锚点定位
3. **动态插槽无插入机制** — 世界包或插件无法在现有插槽之间声明新插槽；当前 `pack.ai.slots` 仅为类型注释中的占位（`prompt_slot_config.ts:20-21`），无运行时代码

**片段内排序（Fragment-level）**：

4. **锚点解析未实现** — `placement_resolution.ts:61-69` 对 `before_anchor`/`after_anchor` 只计入统计 (`resolvedWithAnchor++`)，实际降级为 `middle` 组按 `order` 排序；`PromptFragmentAnchor` 的 5 种 `kind` 均未实现查找逻辑
5. **`slot_start`/`slot_end` 无真实消费者** — 类型上定义了，但无任何片段声称锚定到这些锚点

### 1.2 TODO 原文

> 内置的slot可以被关闭，但始终存在用来定位，slot 定义加入绝对位置和相对位置的动态定位功能，方便其他的动态的slot在slot之间插入和移除

三个核心需求：
1. 禁用插槽保留定位能力
2. 绝对位置 + 相对位置
3. 动态插入和移除

## 2. 设计决策

### D1: 位置模型 — 数值 + 相对引用混合

**决策**：保留数值 `position` 作为稳定排序基础，新增声明式 `anchor` 语法糖用于相对定位。解析时 anchor 覆盖 position。

**理由**：
- 纯数值（A）: 碰撞需要重整，10/20/30 的间距策略不直观但已验证
- 纯引用（B）: 需要拓扑排序，环形引用检测增加复杂度，且无法表达"所有插槽都未声明时"的默认排序
- 混合（C）: 声明时用 `after: 'system_core'` 更自文档化，解析后转换为数值；已排序的内置插槽直接用数值，无需替换。两个体系通过"锚点解析→数值计算"统一

**权衡**：anchor 依赖 ref 插槽存在（包括禁用状态）；ref 指向不存在的插槽需降级策略。混合模型增加了 position 和 anchor 的优先级规则，但规则清晰（anchor > position > default_priority）。

### D2: 禁用插槽 — 结构性锚点

**决策**：`enabled=false` 的插槽保留在位置图中，只是不产出内容。

**理由**：TODO 原文"始终存在用来定位"明确要求。实现上只需两处变更：(a) 遍历插槽时不过滤 `enabled=false`；(b) 渲染时跳过内容产出但不从位置图移除。

**权衡**：`buildPromptBundleV2` 和 `buildPromptTree` 中 `if (!config.enabled) continue` 需要改为"保留位置，跳过内容"。`conversation/format_config.ts` 中的 slot→role 映射也需要处理禁用插槽。变更面积有限。

### D3: 动态注册 — YAML + 运行时 API 双通道

**决策**：扩展 YAML 覆盖机制（世界包可声明 `pack_slots`）并新增运行时 `SlotRegistry.registerSlot()` API。

**理由**：
- 纯 YAML（A）: 世界包声明静态，但运行时上下文节点无法动态注入插槽
- 纯 API（B）: 失去声明式配置的可见性，回放和调试困难
- 双通道（C）: YAML 适合已知插槽的声明式配置，API 适合运行时动态需求（如插件运行时注册临时插槽）。合并时 YAML 优先（同名覆盖运行时）

**权衡**：双通道需要定义合并优先级和生命周期（运行时注册的插槽在热重载 YAML 后是否保留？→ 答案在 §4.4）。增加了注册表 API 的维护成本。

### D4: 分层定位 — 插槽层与片段层独立

**决策**：插槽层用 `position` + `anchor` 排序；片段层补全已有的 `placement_mode` + `anchor` 锚定机制。两套机制独立但命名对齐。

**理由**：插槽间是粗粒度排序（10 个插槽的线性序列），片段内是细粒度锚定（同一插槽内多个片段的精确排列）。两层语义不同：
- 插槽 A"排在 system_policy 之后"是插入顺序语义
- 片段 X"锚定到 source='memory.summary' 之前"是相对位置语义
- 用同一套接口会引入不必要的复杂度（插槽不是片段的容器以外的概念角色）

**权衡**：类型命名需对齐（`SlotAnchor` vs `PromptFragmentAnchor`）避免概念混淆，但避免强行合并。

## 3. 类型设计

### 3.1 新增类型

```typescript
// ── apps/server/src/inference/prompt_slot_config.ts ──

/** 插槽级相对定位锚点 */
export interface SlotAnchor {
  /** 参照插槽 id（必须存在于位置图中，包括禁用插槽） */
  ref: string;
  /** 相对关系 */
  relation: 'after' | 'before';
}

/** 插槽定位解析结果（内部使用，不持久化） */
export interface ResolvedSlotPosition {
  slot_id: string;
  /** 解析后的绝对位置数值，用于排序 */
  resolved_position: number;
  /**
   * 解析来源：
   * - 'explicit': position 字段显式指定
   * - 'anchor': 由 anchor.ref 计算
   * - 'default': 降级为 default_priority
   */
  resolution_source: 'explicit' | 'anchor' | 'default';
  /** 插槽是否启用（不参与内容渲染，但保留定位） */
  enabled: boolean;
}
```

### 3.2 对 `PromptSlotConfig` 的扩展

```typescript
export interface PromptSlotConfig {
  id: string;
  display_name: string;
  description?: string;

  // ═══ 定位（新增） ═══

  /**
   * 绝对位置数值。决定插槽在组合提示词中的排列顺序。
   * 数值越大越靠前。内置插槽默认使用 10 的倍数（100, 90, 80...）以预留插入空间。
   *
   * 向后兼容：若未指定，回退到 default_priority 的值。
   * 优先级低于 anchor（当 anchor 被指定时，anchor 解析结果覆盖 position）。
   */
  position?: number | null;

  /**
   * 相对定位锚点。声明式语法：此插槽排在 ref 插槽的 after/before 方向。
   * 优先级高于 position：当 anchor 被指定时，解析器根据 ref 插槽的实际位置计算本插槽的 resolved_position。
   *
   * 示例：{ ref: 'system_core', relation: 'after' } → 此插槽排在 system_core 之后。
   *
   * 若 ref 插槽不存在，降级为 position → default_priority 排序，并写入 diagnostics。
   */
  anchor?: SlotAnchor | null;

  // ═══ 已有字段 ═══

  /**
   * token budget trim 优先级（数值越低越先被裁剪）。
   *
   * 语义变更：之前同时承担排序和 trim 优先级；
   * 引入 position 后，default_priority 仅用于 trim 优先级。
   * 向后兼容：若 position 未指定，position 回退到 default_priority。
   */
  default_priority: number;
  default_template?: string | null;
  template_context?: 'inference' | 'world_prompts' | 'pack_state' | 'none';
  message_role?: 'system' | 'developer' | 'user';
  include_in_combined: boolean;
  combined_heading?: string | null;
  permissions?: PromptFragmentPermissions | null;

  /**
   * 插槽启用状态。
   *
   * 语义变更：enabled=false 时，插槽仍然存在于位置图中——
   * 其他插槽的 anchor.ref 可以引用它（它仍有 resolved_position）；
   * 但渲染时跳过内容产出（不纳入 combined_prompt、不参与 message assembly）。
   */
  enabled: boolean;
  metadata?: Record<string, unknown>;
}
```

### 3.3 Zod Schema 扩展

`apps/server/src/ai/registry.ts` 中的 `promptSlotConfigSchema` 新增字段：

```typescript
// ── 嵌入到 promptSlotConfigSchema ──
position: z.number().int().nullable().optional(),
anchor: z.object({
  ref: z.string().min(1),
  relation: z.enum(['after', 'before'])
}).nullable().optional(),
```

### 3.4 默认 YAML 变更

`apps/server/src/ai/schemas/prompt_slots.default.yaml` 为每个内置插槽显式声明 `position`：

```yaml
slots:
  system_core:
    id: "system_core"
    position: 100
    default_priority: 100
    # ...

  system_policy:
    id: "system_policy"
    position: 90
    default_priority: 95
    # ...

  role_core:
    id: "role_core"
    position: 80
    default_priority: 90
    # ...

  world_context:
    id: "world_context"
    position: 70
    default_priority: 80
    # ...

  memory_summary:
    id: "memory_summary"
    position: 60
    default_priority: 70
    # ...

  post_process:
    id: "post_process"
    position: 50
    default_priority: 60
    # ...

  output_contract:
    id: "output_contract"
    position: 40
    default_priority: 50
    # ...

  conversation_history:
    id: "conversation_history"
    position: 30
    default_priority: 50
    # ...
```

### 3.5 片段层锚点解析补全

现有 `PromptFragmentAnchor` 和 `PromptFragmentPlacementMode` 类型不变，仅补全 `placement_resolution.ts` 的实现。

## 4. 位置解析算法

### 4.1 核心算法

```
resolveSlotPositions(configs: PromptSlotConfig[]): ResolvedSlotPosition[]

输入: 注册表中所有插槽配置（含禁用插槽）
输出: 按 resolved_position 降序排列的 ResolvedSlotPosition[]

步骤:
1. 构建位置图 positionMap: Map<slotId, number>
2. 构建锚点依赖图 anchorMap: Map<slotId, SlotAnchor>
3. 第一遍：处理显式 position（无 anchor 的插槽）
   → positionMap.set(id, config.position ?? config.default_priority)
4. 第二遍：拓扑排序处理有 anchor 的插槽
   → 构建有向图 G: slotId → anchor.ref
   → 检测环路（BFS/DFS），环路中的 anchor 标记为错误
   → 按拓扑序逐个解析：
     a. 获取 ref 的已解析位置 P
     b. 获取 ref 的相邻位置 nextP（positionMap 中小于 P 的最大值）
     c. 如无 nextP：ref 是最末尾
        - after  → position = P - step
        - before → position = P + step （invalid — before 最末尾是首位，降级）
     d. 如有 nextP：
        - after  → position = (P + nextP) / 2   （ref 和下一位的中点）
        - before → position = (ref.prev + P) / 2  （ref 前一位和 ref 的中点）
   → step 机制：步长 = max(1, min(floor(|P - nextP| / 4), 5))
     避免位间距耗尽
5. 第三遍：anchor 错误降级
   → 环路中的插槽或 ref 不存在的插槽：
     使用 anchor.ref 不存在 → 降级为 fallback position（position ?? default_priority）
     写入 diagnostics.warnings
6. 按 resolved_position 降序排列
7. 禁用插槽保留在结果中（enabled=false），不剔除
```

#### 4.1.1 相邻位置计算

```
getInsertionRange(positionMap, refPosition, relation):
  sortedPositions = [...positionMap.values()].sort((a,b) => b - a)  // 降序

  if (relation === 'after'):
    // "排在 ref 之后" = 在 ref 和下一个低位之间
    refIndex = sortedPositions.indexOf(refPosition)
    nextPosition = sortedPositions[refIndex + 1] ?? 0
    return { lo: nextPosition, hi: refPosition }

  if (relation === 'before'):
    // "排在 ref 之前" = 在 ref 和上一个高位之间
    refIndex = sortedPositions.indexOf(refPosition)
    prevPosition = sortedPositions[refIndex - 1] ?? refPosition + 10
    return { lo: refPosition, hi: prevPosition }
```

#### 4.1.2 位置分配策略

当在 `{ lo, hi }` 范围内分配中点位置时：

```
allocationPosition = (lo + hi) / 2
```

如果 `lo` 和 `hi` 差距小于 `1`（最极端细分），使用更精细的浮点插值。在实践中，内置插槽间距为 10，允许约 4 次二分细分（10 → 5 → 2.5 → 1.25 → 0.625）后触底，对于动态插槽注册足够使用。

**极端情况处理**：如果同一位置范围被过度细分（超过 5 次二分），算法退化为线性探测——在该范围内按 0.01 间距搜索第一个空位。

### 4.2 解析的诊断信息

```typescript
export interface SlotPositionDiagnostics {
  warnings: Array<{
    slot_id: string;
    code: 'anchor_ref_not_found' | 'anchor_cycle_detected' | 'position_collision';
    message: string;
    fallback_position: number;
  }>;
  resolution_map: Array<{
    slot_id: string;
    resolved_position: number;
    source: 'explicit' | 'anchor' | 'default';
  }>;
}
```

### 4.3 片段级锚点解析算法

补全 `placement_resolution.ts` 中 `before_anchor`/`after_anchor` 的实际锚定逻辑：

```
resolveFragmentAnchors(drafts: PromptSectionDraft[]): PromptSectionDraft[]

对每个插槽的 drafts:
1. 分三组：prepend, anchored, append
2. 对 anchored 组，按 anchor.kind 查找目标位置：
   - 'slot_start': 目标位置 = 片段列表头部
   - 'slot_end':   目标位置 = 片段列表尾部
   - 'fragment_id': 目标 = id 字段匹配的片段
   - 'source':     目标 = source 字段匹配的片段
   - 'tag':        目标 = metadata.tag 匹配的片段（未来扩展）
3. 查找成功 → 在目标前（before）或后（after）插入
4. 查找失败 → 降级为 middle 组按 order 排序 + 诊断警告
5. 重组顺序：[prepend, ...middle(按order降序), ...anchored(按锚定位置), append]
```

## 5. 运行时 API

### 5.1 扩展 Slot 注册表

当前 `getPromptSlotRegistry()` 返回 `{ version, slots }` 不带定位元数据。新增 `resolveSlotPositions()` 作为独立解析步骤：

```typescript
// ── apps/server/src/ai/registry.ts（扩展） ──

export interface ResolvedSlotRegistry {
  version: number;
  /** 原始配置，含 anchor/position */
  slots: Record<string, ParsedPromptSlotConfig>;
  /** 解析后的定位序列（已排序） */
  resolved_positions: ResolvedSlotPosition[];
  /** 解析诊断信息 */
  diagnostics: SlotPositionDiagnostics;
}

export const resolveSlotPositions = (
  configs: Record<string, ParsedPromptSlotConfig>
): ResolvedSlotRegistry => { ... };
```

### 5.2 动态注册 API

```typescript
// ── apps/server/src/ai/registry.ts（新增） ──

/** 运行时注册新插槽。同名插槽不会覆盖 YAML 声明（YAML 优先）。 */
export const registerDynamicSlot = (config: PromptSlotConfig): boolean => { ... };

/** 运行时注销动态插槽。YAML 声明的插槽不可注销。 */
export const unregisterDynamicSlot = (slotId: string): boolean => { ... };

/** 启用/禁用插槽（禁用时保留为结构性锚点）。 */
export const setSlotEnabled = (slotId: string, enabled: boolean): boolean => { ... };

/** 触发位置重解析（注册/注销后自动触发，也可手动调用）。 */
export const invalidatePositionCache = (): void => { ... };
```

动态插槽存储在 `PromptSlotRegistryCache` 中的独立字段：

```typescript
interface PromptSlotRegistryCache {
  config: { version: number; slots: Record<string, ParsedPromptSlotConfig> };
  metadata: PromptSlotRegistryMetadata;
  dynamic_slots: Map<string, ParsedPromptSlotConfig>;  // 新增
  resolved_positions_cache: ResolvedSlotPosition[] | null;  // 新增：惰性计算
}
```

### 5.3 生命周期与合并规则

**YAML 热重载**（`registry_watcher.ts` 检测到 `prompt_slots.yaml` 变更）：
1. 重新解析 YAML（默认 + 覆盖）
2. 与 `dynamic_slots` 合并：YAML 同名覆盖动态插槽
3. 清除 `resolved_positions_cache`
4. 动态插槽中非 YAML 同名的保留

**世界包声明**（`pack.ai.slots` 或世界包配置中 `slots` 字段）：
1. 加载世界包时，`pack.ai.slots` 中的插槽通过 `registerDynamicSlot()` 注册
2. 合并优先级：内置默认 YAML > 本地覆盖 YAML > 运行时动态注册
3. 世界包卸载时，其注册的动态插槽通过 `unregisterDynamicSlot()` 清理

**决策点**：世界包声明的插槽是否应该有独立的生命周期钩子（`onActivate`/`onDeactivate`），还是简化为"加载时注册、卸载时注销"？→ 当前选择简化方案，未来可扩展。

## 6. 消费方变更

### 6.1 `buildPromptBundleV2` 变更

```typescript
// 当前（prompt_builder_v2.ts:194-224）:
for (const slotId of Object.keys(tree.slot_registry)) {  // 隐式 YAML 键序
  const config = tree.slot_registry[slotId];
  if (!config || !config.enabled) continue;              // 禁用即消失
  // ...
}

// 变更后:
for (const resolved of tree.resolved_positions) {           // 显式解析序列
  const config = tree.slot_registry[resolved.slot_id];
  if (!config) continue;

  if (!resolved.enabled) {                                  // 禁用但保留位置
    fragmentsBySlot[resolved.slot_id] = [];                // 空片段列表
    continue;
  }

  const fragments = tree.fragments_by_slot[resolved.slot_id] ?? [];
  // ... 渲染逻辑不变，但顺序由 resolved_positions 决定
}
```

### 6.2 `PromptTree` 类型扩展

```typescript
export interface PromptTree {
  inference_id: string;
  task_type: string;
  fragments_by_slot: Record<string, PromptFragmentV2[]>;
  slot_registry: Record<string, PromptSlotConfig>;
  /** 新增：解析后的插槽定位序列（降序） */
  resolved_positions: ResolvedSlotPosition[];
  metadata: PromptTreeMetadata;
}
```

### 6.3 `buildPromptTree` 变更

```typescript
// 当前（prompt_builder_v2.ts:116-189）:
// 直接遍历 Object.values(slotRegistry)，跳过 enabled=false

// 变更后:
// 1. 在构建开始时调用 resolveSlotPositions(slotRegistry)
// 2. 按 resolved_positions 的顺序遍历
// 3. 禁用插槽赋空片段列表，不断跳过
```

### 6.4 `conversation/assembler.ts` 变更

当前 `sortByPriority` 使用 `slot.priority`（来自 `PromptSlotConfig.default_priority`）。变更后应使用 `resolved_position` 降序排列。

### 6.5 `format_config.ts` 变更

`DEFAULT_CONVERSATION_FORMAT_CONFIG.slots` 数组当前硬编码了 10 个插槽顺序。变更后应从 `resolved_positions` 动态构建 slot→role 映射，而非硬编码列表顺序。

映射逻辑：
```typescript
// slot → role 查表仍使用 config.message_role
// 但遍历顺序使用 resolved_positions 而非硬编码数组
```

### 6.6 Orchestrator 变更

`context/workflow/orchestrator.ts` 在 `state.slot_registry` 赋值后，新增 `state.resolved_positions` 赋值：

```typescript
const slotRegistry = getPromptSlotRegistry();
const { resolved_positions, diagnostics: posDiagnostics } = resolveSlotPositions(slotRegistry.slots);
state.slot_registry = slotRegistry.slots;
state.resolved_positions = resolved_positions;  // 新增
state.diagnostics.slot_position_diagnostics = posDiagnostics;  // 新增
```

### 6.7 `token_budget_trim.ts` 变更

当前使用 `slot_registry[id].default_priority` 决定 trim 顺序。设计意图是 **`default_priority` 语义从"排序 + trim"降级为仅"trim 优先级"**。

但如果 `position` 回退到 `default_priority`，当 `position` 未指定时，trim 优先级和排序使用同一值——这符合预期。无需变更 `token_budget_trim.ts`。

### 6.8 `template_track.ts` 变更

当前按 `Object.values(slotRegistry)` 生成 section drafts。变更后按 `resolved_positions` 顺序生成，确保模板轨道产出的 section drafts 顺序与最终渲染一致。

## 7. 测试策略

### 7.1 单元测试

| 测试类 | 描述 | 文件 |
|--------|------|------|
| 位置解析 — 纯数值 | 所有插槽使用 `position`，验证降序排列 | `slot_position_resolver.spec.ts` |
| 位置解析 — 纯锚点 | 所有插槽使用 `anchor`，验证拓扑排序 + 中点计算 | 同上 |
| 位置解析 — 混合 | 部分 position、部分 anchor，验证 anchor 覆盖 position | 同上 |
| 位置解析 — 禁用插槽锚点 | `anchor.ref` 指向禁用插槽，验证解析成功 | 同上 |
| 位置解析 — 环路检测 | A→B→C→A 环路，验证降级为 default_priority | 同上 |
| 位置解析 — 不存在 ref | `anchor.ref` 指向不存在的插槽，验证降级 + 诊断 | 同上 |
| 位置解析 — 碰撞处理 | 多个插槽 position 相同，验证稳定排序（fallback 到 id 字母序） | 同上 |
| 位置解析 — 深度细分极限 | 同一区间二分 >5 次，验证退化为线性探测 | 同上 |
| 位置解析 — 向后兼容 | 无 `position`/`anchor` 字段的旧配置，验证回退到 `default_priority` | 同上 |

### 7.2 片段级锚点测试

| 测试类 | 描述 | 文件 |
|--------|------|------|
| `slot_start` 锚定 | draft 锚定到 slot_start，验证排在最前 | `placement_resolution.spec.ts` |
| `slot_end` 锚定 | draft 锚定到 slot_end，验证排在最后 | 同上 |
| `fragment_id` 锚定 | draft 锚定到指定 fragment id，验证 before/after | 同上 |
| `source` 锚定 | draft 锚定到指定 source 字符串，验证 before/after | 同上 |
| 锚点降级 | anchor.ref 不匹配任何片段，验证降级到 order 排序 | 同上 |
| 混合 — prepend + anchored + append + middle | 全四组混合，验证最终顺序 | 同上 |

### 7.3 集成测试

| 测试类 | 描述 | 文件 |
|--------|------|------|
| 端到端 — 禁用插槽保留位置 | system_policy 禁用，custom_slot 声明 `after: system_policy`，验证 custom_slot 排在正确位置 | `prompt_builder_v2.integration.spec.ts` |
| 端到端 — 动态插槽注册 | 运行时注册新插槽，验证出现在 combined_prompt 中 | 同上 |
| 端到端 — 世界包插槽合并 | 加载含 `pack_slots` 的世界包，验证与内置插槽合并后位置正确 | 同上 |
| 回归 — 现有 test 通过 | 所有现有 integration/e2e 测试无变更地通过 | 现有测试 |

## 8. 实现顺序

### Phase 1: 类型与解析器（无行为变更）

1. `prompt_slot_config.ts`：新增 `SlotAnchor`、`ResolvedSlotPosition`、`SlotPositionDiagnostics` 类型
2. `prompt_slot_config.ts`：扩展 `PromptSlotConfig` 增加 `position`、`anchor` 字段（均可选/nullable，向后兼容）
3. `ai/registry.ts`：扩展 Zod schema 增加 `position`、`anchor` 字段
4. 新建 `ai/slot_position_resolver.ts`：实现 `resolveSlotPositions()` 核心算法
5. 新建测试文件，覆盖 §7.1 所有测试类
6. `prompt_slots.default.yaml`：为内置插槽添加 `position` 字段

此阶段不改变任何现有行为——新增字段均可选/nullable，`position` 默认回退到 `default_priority`。

### Phase 2: 消费方适配（行为变更）

7. `prompt_builder_v2.ts`：`buildPromptTree` 使用 `resolveSlotPositions()` 替代 `Object.values()` 遍历
8. `prompt_builder_v2.ts`：`buildPromptBundleV2` 按 `resolved_positions` 顺序遍历，禁用插槽保留位置但不渲染
9. `orchestrator.ts`：在 state 中存储 `resolved_positions` 和诊断信息
10. `PromptTree` 类型扩展：增加 `resolved_positions` 字段
11. `template_track.ts`：按 `resolved_positions` 顺序生成 section drafts
12. `conversation/assembler.ts`：`sortByPriority` 改为使用 `resolved_position` 降序
13. `format_config.ts`：移除硬编码 slots 数组顺序，改为从 `resolved_positions` 动态构建

### Phase 3: 片段级锚点补全

14. `placement_resolution.ts`：实现 `before_anchor`/`after_anchor` 的真实锚定逻辑
15. 补全 §7.2 所有片段级测试

### Phase 4: 动态注册 API

16. `ai/registry.ts`：新增 `registerDynamicSlot()`、`unregisterDynamicSlot()`、`setSlotEnabled()`、`invalidatePositionCache()`
17. 世界包加载路径中调用 `registerDynamicSlot()` 注册世界包插槽
18. 热重载时合并策略（YAML 同名覆盖动态）

## 9. 向后兼容性

| 维度 | 当前行为 | Phase 1 后 | Phase 2 后 |
|------|---------|-----------|-----------|
| 无 `position`/`anchor` 的 YAML | 排序 = YAML 键序 | 不变（position 回退到 default_priority） | 显式按 resolved_position 排序 |
| `enabled=false` 的插槽 | 跳过 | 不变 | 保留在位置图，空片段 |
| `default_priority` | 排序 + trim 双重语义 | 排序回退值 + trim | 仅 trim（position 存在时） |
| `PromptFragmentPlacementMode` | `before_anchor`/`after_anchor` 降级为 middle | 不变 | 真实锚定 |
| `conversation_history` 在 YAML 末尾 | 排在最后（键序） | position=30 排在最后 | 由 resolved_position 决定 |

关键兼容点：Phase 1 可以单独部署而不改变任何行为，因为所有新字段都可选。Phase 2 才是行为变更边界。

## 10. 与插槽函数（slot-ref）的关系

本设计（插槽定位系统）与模板引擎统一设计（`.limcode/design/template-engine-unification-design.md`）中的 `slot-ref` 块处理器是**不同层面**的能力：

| 层 | 本设计 | slot-ref |
|----|--------|----------|
| 关注点 | 插槽间/片段间的排列顺序 | 模板内引用其他插槽的内容 |
| 作用时机 | 构建时（prompt tree assembly） | 渲染时（template rendering） |
| 数据流向 | 控制插槽在 combined_prompt 中的位置 | 将其他插槽的渲染内容嵌入当前模板 |

两者的交互点：当 `slot-ref` 引用禁用插槽时，当前行为是"返回空字符串或渲染 fallback body"。本设计不改变这一行为——禁用插槽在位置图中存在，但其内容为空（`fragments_by_slot[disabled_slot_id] = []`），因此 slot-ref 获取到的内容为空字符串。

## 11. 盲点与待决事项

### 11.1 已识别盲点

#### B1: `PromptBundleV2.slots` 无序问题 — 中等

**问题**：`PromptBundleV2.slots: Record<string, string>` 是无序 map，类型层面不保证顺序。`buildPromptBundleV2` 当前按 `Object.keys(slot_registry)` 插入键（YAML 键序），`combined_prompt` 是正确的。但下游消费者若直接迭代 `bundle.slots` 而非读 `combined_prompt`，顺序由插入顺序隐式保证——这在 JavaScript 中对字符串键有效但类型不安全。

**方案**：
- A) 在 `PromptBundleV2` 中新增 `slot_order: string[]` 字段，显式声明渲染顺序。`combined_prompt` 仍按此顺序拼接，`slots` map 仅做随机查找。
- B) 维持现状，`slots` map 的键插入顺序与 `resolved_positions` 一致，依赖 JS 规范保证。在文档和注释中明确 `slots` 不应被直接迭代用于排序。

**推荐**：方案 A——显式优于隐式。`slot_order: string[]` 使排序意图类型安全。消费方如 `assembler.ts` 应从 `slot_order` 而非 `Object.keys(slots)` 获取顺序。

#### B2: `PromptWorkflowState` 缺少 `resolved_positions` 类型定义 — 高

**问题**：设计 §6.6 提到 orchestrator 赋值 `state.resolved_positions`，但 `PromptWorkflowState` 和 `PromptWorkflowDiagnostics` 类型中缺少对应字段。同样，`createInitialPromptWorkflowState` 和 `createPromptWorkflowDiagnostics` 工厂函数需更新。

**修复**：在 §3 类型设计中补充：

```typescript
// context/workflow/types.ts 扩展
export interface PromptWorkflowState {
  // ... 已有字段 ...
  resolved_positions?: ResolvedSlotPosition[];       // 新增
}

export interface PromptWorkflowDiagnostics {
  // ... 已有字段 ...
  slot_position_diagnostics?: SlotPositionDiagnostics; // 新增
}
```

#### B3: `fragment_assembly` 传播 `resolved_positions` 的数据流缺口 — 高

**问题**：`fragment_assembly.ts` 构建 `PromptTree` 时从 `state.section_drafts` 和 `state.slot_registry` 构建，但没有 `state.resolved_positions`。如果 `PromptTree.resolved_positions` 是必需字段，`fragment_assembly` 需要传播它。

**方案**：`fragment_assembly` 从 `state.resolved_positions` 读取（orchestrator 在轨道执行前已赋值），直接赋给 `tree.resolved_positions`。

```typescript
// fragment_assembly.ts 变更
const tree: PromptTree = {
  // ... 已有字段 ...
  resolved_positions: state.resolved_positions ?? [],  // 新增
};
```

#### B4: 工作流流水线缺少位置解析步骤 — 高

**问题**：当前 orchestrator 流程为 `buildPromptTree → tracks → executors`，没有显式的 slot 位置解析步骤。`resolveSlotPositions()` 需要在轨道执行之前就绪（template track 和 node track 都需要按 resolved 顺序遍历），但当前 `steps` 列表不包含位置解析。

**方案**：位置解析在 orchestrator 初始化阶段执行（在轨道运行之前），而非作为 executor 步骤。因为 `resolveSlotPositions()` 是纯函数，输入是 `slot_registry`，输出是 `ResolvedSlotPosition[]`——它不依赖 section drafts 或任何轨道产出。

```
当前 orchestrator 流程:
  getPromptSlotRegistry() → runTemplateTrack() → ... → executors

变更后:
  getPromptSlotRegistry()
    → resolveSlotPositions(slots)     ← 新增：在轨道之前
    → state.resolved_positions = ...
    → runTemplateTrack()
    → runNodeTrack()
    → ...
    → executors（placement_resolution 等）
```

#### B5: `PromptFragmentSlot` 闭合联合类型阻碍动态插槽 — 高

**问题**：`PromptFragmentSlot` 是闭合联合类型：

```typescript
type PromptFragmentSlot =
  | 'system_core' | 'system_policy' | 'role_core' | 'world_context'
  | 'memory_short_term' | 'memory_long_term' | 'memory_summary'
  | 'output_contract' | 'post_process' | 'conversation_history';
```

动态注册的插槽（如 `custom_safety_layer`）无法赋值给 `PromptFragmentSlot`。这阻塞了：
- `ContextPlacementPolicy.preferred_slot: PromptFragmentSlot | null` 无法引用动态插槽
- `PromptSectionDraft.slot: PromptFragmentSlot` 无法容纳动态插槽
- `PromptFragmentV2.slot_id: string`（已经是 `string`，不受影响）

**方案**：
- A) 将 `PromptFragmentSlot` 改为 `string`。简单但丢失类型约束。
- B) 将 `PromptFragmentSlot` 保持为联合类型，新增 `DynamicSlotId = string` 品牌类型，联合为 `PromptFragmentSlot | DynamicSlotId`。类型信息仍在但动态插槽需品牌转换。
- C) 分阶段处理：Phase 1-3 保持闭合联合类型（只支持内置插槽的定位），Phase 4 引入动态注册时再扩展为 `string`。这是最安全的渐进路线。

**推荐**：方案 C。动态注册是 Phase 4 的功能，在 Phase 1-3 范围内只有内置插槽参与定位。将 `PromptFragmentSlot → string` 的变更推迟到 Phase 4 启动时决策，Phase 1-3 的类型变更有意不触及此联合类型。

#### B6: 世界包插槽的 schema 缺口 — 高

**问题**：设计 §5.3 提到"世界包声明 `pack.ai.slots`"作为动态注册来源，但：
1. `constitution_schema.ts` 的 `WorldPack` schema 没有 `slots` 字段
2. `PackManifestLoader` 没有插槽提取逻辑
3. 设计未指定 schema 扩展和加载路径

**修复**：在 Phase 4 实现计划中补充：
- `constitution_schema.ts` 新增 `pack_slots` 字段（可选，类型为 `Record<string, PromptSlotConfigSchema>`）
- `PackManifestLoader` 加载世界包时提取 `pack.ai.slots` 或顶层 `pack_slots`
- 调用 `registerDynamicSlot()` 注册到 slot registry

#### B7: 遗留 `buildPromptTree` 路径 — 中等

**问题**：`buildPromptTree()`（`prompt_builder_v2.ts:116-189`）是非 workflow 路径的构建函数，被 `buildPromptBundleV2` 直接调用。设计 §6.1 只修改了 workflow 路径。遗留路径仍然使用 `Object.values(slotRegistry)` 并跳过禁用插槽。

**方案**：
- A) 遗留路径也使用 `resolveSlotPositions()` — 保持一致
- B) 标记遗留路径为 deprecated，所有消费者转向 workflow pipeline — 理想但可能超出 Phase 2 范围

**推荐**：方案 A——遗留路径调用 `resolveSlotPositions(Object.values(slotRegistry))` 并将 `resolved_positions` 传入 `PromptTree`，确保所有消费路径一致。

#### B8: `assembler.ts` 的 `sortByPriority` 与 `enabled` 检查 — 中等

**问题**：`conversation/assembler.ts` 的 `extractNonConversationSlots` 函数（lines 135-163）迭代 `Object.keys(registry)` 并跳过 `enabled=false` 的插槽。Phase 2 变更后，禁用插槽应保留在位置图但不渲染内容。`assembler.ts` 需要：
1. 使用 `resolved_position` 排序而非 `default_priority`
2. 不跳过 `enabled=false` 的插槽（但跳过其内容）

但 assembler 的职责是构建 AI 消息列表——禁用插槽的内容为空，不会产生消息片段。更精确地说，禁用插槽不应产生消息。因此 assembler **应跳过禁用插槽的内容**，但可能需要知道其位置以理解相邻插槽的角色分配。

**方案**：assembler 仍跳过 `enabled=false` 的插槽，但遍历顺序由 `resolved_positions` 决定。

#### B9: 现有测试回归 — 中等

以下测试文件需要适应 Phase 2 行为变更：

| 测试文件 | 需要变更 |
|----------|---------|
| `tests/unit/prompt_bundle_v2.spec.ts` | 禁用插槽断言从"不存在"改为"存在但内容为空"；`PromptTree` 构建需添加 `resolved_positions` |
| `tests/unit/post_merge_executors.spec.ts` | `fragment_assembly` 构建 `PromptTree` 需添加 `resolved_positions` |
| `tests/unit/template_track.spec.ts` | 禁用插槽断言需调整；遍历顺序依赖 `resolved_positions` |
| `tests/integration/conversation/` | `sortByPriority` 改为 `resolved_position` 排序 |
| 所有手动构建 `SLOT_REGISTRY` 的测试 | 添加 `position` 字段或确保 `resolveSlotPositions` 回退到 `default_priority` |

**策略**：Phase 1 无回归（仅新增可选字段）。Phase 2 需要批量更新测试，但所有变更都有清晰的模式（添加 `resolved_positions`、调整禁用插槽断言）。

#### B10: `format_config` 的 slot→role 映射动态化机制 — 中等

**问题**：`DEFAULT_CONVERSATION_FORMAT_CONFIG.slots` 是硬编码数组。Phase 4 动态插槽注册后，这个硬编码列表无法覆盖新插槽的 `message_role`。

**方案**：`assembler.ts` 的角色分配逻辑分两层：
1. **显式映射**（`format_config` 中的 `slots` 数组）：优先级高，用于精确控制 `slot→role` 映射
2. **隐式回退**（`PromptSlotConfig.message_role`）：当 `format_config` 无显式映射时，使用 slot config 的 `message_role` 字段

动态插槽只需声明 `message_role`，assembler 的回退逻辑即可处理其角色分配。`format_config` 的硬编码列表仅用于覆盖内置插槽的默认角色，并非唯一角色来源。

这一回退逻辑当前未实现——assembler 只读 `format_config.slots`。Phase 4 需要补充。

### 11.2 开放决策项

#### O1: `PromptFragmentSlot` 类型演进时机

**决策点**：Phase 4 引入动态插槽时，`PromptFragmentSlot` 是改为 `string` 还是引入品牌类型？

**选项与优劣**：

| 选项 | 优势 | 劣势 |
|------|------|------|
| A) 改为 `string` | 最简单；所有上下文节点和 section draft 立即可引用动态插槽 | 丢失类型安全——打字错误不再被 TypeScript 捕获 |
| B) 品牌类型 `DynamicSlotId = string & {__brand: 'DynamicSlotId'}` | 内置插槽保留类型检查，动态插槽需显式转换 | 品牌类型模式增加模板代码；联合类型 `PromptFragmentSlot \| DynamicSlotId` 在模式匹配时冗长 |
| C) 延迟到 Phase 4 开工时决策 | Phase 1-3 不受影响；避免过度设计 | Phase 4 可能发现类型约束模式需要更根本的变更 |

**推荐**：选项 C。Phase 1-3 只处理内置插槽的定位，`PromptFragmentSlot` 保持闭合联合。Phase 4 启动时根据实际动态插槽需求量再决策类型演进方向。

#### O2: `PromptBundleV2.slots` 排序保障

**决策点**：`PromptBundleV2.slots` 是否需要从 `Record<string, string>` 变更为有序结构？

**选项与优劣**：

| 选项 | 优势 | 劣势 |
|------|------|------|
| A) 新增 `slot_order: string[]` 字段 | 类型安全；零歧义；消费方可按序迭代 | 增加序列化/反序列化负担；`slots` map 成为纯查找结构 |
| B) 维持 `Record<string, string>`，依赖插入顺序 | 零变更 | JavaScript 规范虽保证字符串键插入顺序，但类型不强制排序意图；`JSON.stringify` 不保证顺序 |
| C) 合并为有序数组 `Array<{slot_id, text}>` | 强类型排序；消除 map + order 冗余 | 破坏所有 `bundle.slots[slotId]` 查找；需同步更新所有消费方 |

**推荐**：选项 A。新增 `slot_order` 字段改变最小，`slots` map 保留随机查找能力，`slot_order` 提供显式排序。Phase 2 实施时一并完成。

#### O3: 位置解析算法的精度策略

**决策点**：中点细分法的精度与步进策略。

**选项与优劣**：

| 选项 | 优势 | 劣势 |
|------|------|------|
| A) 纯浮点中点（§4.1.2） | 无限细分；代码简单 | 浮点精度在极端嵌套时可能退化（约 50+ 次细分后）；排序需要特殊处理浮点比较 |
| B) 整数间距 + 重编号 | 无浮点问题；排序稳定 | 重编号需遍历所有插槽分配新整数位；改变用户声明的 position 值 |
| C) 逻辑序号（排序后赋予 1, 2, 3...） | 最简单；无碰撞 | 丢失绝对位置语义；动态注册后需要整表重编 |

**推荐**：选项 A（纯浮点中点），附加精度保护条款：
- 内置插槽使用 10 的倍数（100, 90, 80...），提供约 4 次二分细分空间
- 当同一区间被细分为间距 < 1 时，使用精度保护：排序前将所有 `resolved_position` 乘以 `10 ** max(0, ceil(-log10(min_gap))) + 1` 并取整，确保整数排序安全
- `resolved_position` 存储 `number` 类型（可以是浮点），消费方排序使用 `resolved_position` 降序

#### O4: 世界包插槽声明的位置

**决策点**：世界包声明插槽的 YAML 字段位置。

**选项与优劣**：

| 选项 | 优势 | 劣势 |
|------|------|------|
| A) `ai.slots` 嵌套在 AI 配置下 | 与 `ai.defaults`、`ai.memory_loop` 等在一起；语义清晰 | AI 配置膨胀 |
| B) 顶层 `slots` 字段 | 独立于 AI 配置；世界包可能有非 AI 插槽 | 与现有 schema 的 `pack` 字段结构不一致 |
| C) 推迟到 Phase 4 | 避免过早设计 YAML 结构 | Phase 4 启动时才确定 |

**推荐**：选项 C。世界包插槽注册是 Phase 4 功能，YAML 结构依赖 Phase 1-3 的类型系统稳定后再设计。Phase 4 设计文档应包含此决策。

#### O5: 位置解析的缓存时机

**决策点**：`resolveSlotPositions()` 的调用时机与缓存策略。

**选项与优劣**：

| 选项 | 优势 | 劣势 |
|------|------|------|
| A) 惰性缓存（读取时解析，缓存直到 invalidate） | 按需计算；注册/注销/热重载时 `invalidatePositionCache()` 清除 | 需要 cache 字段和 invalidation 链路 |
| B) 每次推理时解析（在 orchestrator 中） | 无缓存一致性问题；推理频率低（每次推理几毫秒） | 每次推理都重新计算（但开销极小——10 个插槽的拓扑排序） |
| C) 启动时解析 + 事件驱动失效 | 响应最快；缓存命中率高 | 需要监听 YAML 变更、动态注册、enabled 切换等多事件 |

**推荐**：选项 B（每次推理时解析）。理由：10 个插槽的拓扑排序成本 < 0.01ms，缓存带来的复杂度（invalidation chain、事件监听、race condition）远超收益。Orchestrator 按推理请求执行，每次请求的开头调用 `resolveSlotPositions()` 即可。

#### O6: 遗留 `buildPromptTree` 路径处理

**决策点**：`buildPromptTree()` 和 `buildPromptBundleV2()` 的非 workflow 调用路径如何处理。

**选项与优劣**：

| 选项 | 优势 | 劣势 |
|------|------|------|
| A) 统一修改，遗留路径也调用 `resolveSlotPositions()` | 所有路径一致；无行为差异 | `buildPromptTree` 当前不返回 `PromptTree` 时携带 `resolved_positions`，需修改签名 |
| B) 遗留路径标记为 deprecated，限制使用 | 逐步收敛到 workflow pipeline | 短期内两种路径共存 |
| C) 遗留路径忽略位置解析，仅 workflow 路径使用 | 最小变更 | 两种路径输出不同排序行为 |

**推荐**：选项 A。`buildPromptTree()` 内部调用 `resolveSlotPositions()` 并赋值到 `PromptTree.resolved_positions`，签名不变化（`resolved_positions` 是 `PromptTree` 的字段而非参数）。`buildPromptBundleV2()` 从 `tree.resolved_positions` 读取顺序。这样遗留路径和 workflow 路径行为一致。

### 11.3 方案优劣总结

**混合定位模型（D1 选择 C）的优劣**：

| 维度 | 优势 | 劣势 |
|------|------|------|
| 声明可读性 | `after: 'system_core'` 比 `position: 85` 自文档化 | 锚点依赖需要 ref 插槽存在 |
| 插入灵活性 | 新插槽可插入任意间隔，无需知道相邻数值 | 环形依赖需要检测和降级策略 |
| 向后兼容 | `position` 回退到 `default_priority`，旧配置零变更 | `default_priority` 的双重语义在过渡期易混淆 |
| 调试 | `resolved_position` 数值在诊断中明确可见 | `anchor` 链可能需要追踪多级间接引用 |

**结构性锚点（D2 选择 A）的优劣**：

| 维度 | 优势 | 劣势 |
|------|------|------|
| 可预测性 | 禁用插槽始终在同一位置，其他插槽的锚点不会突然失效 | 禁用插槽的空片段列表需要消费方正确处理 |
| 实现简单 | `if (!enabled) { fragments = []; continue; }` 替代 `if (!enabled) continue` | `fragments_by_slot[disabled_id] = []` 增加了 map 表面积 |
| 语义一致性 | 禁用 ≠ 删除，与 CSS `display: none` vs `visibility: hidden` 类比 | 需要在所有消费方中统一"跳过内容但不跳过位置"的行为 |

**YAML + 运行时双通道（D3 选择 C）的优劣**：

| 维度 | 优势 | 劣势 |
|------|------|------|
| 灵活性 | 静态配置和运行时动态均支持 | 合并优先级规则增加认知负担 |
| 调试 | YAML 声明可读；运行时注册可追踪 | 热重载时 YAML 覆盖动态插槽可能导致意外行为 |
| 实现成本 | 注册表缓存 + 失效链路 + 合并逻辑 | 比单通道复杂 |

**分层定位（D4 选择 B）的优劣**：

| 维度 | 优势 | 劣势 |
|------|------|------|
| 关注点分离 | 插槽排序和片段锚定各自最优化 | 两套类型（`SlotAnchor` vs `PromptFragmentAnchor`）需要概念对齐 |
| 复杂度 | 插槽排序是简单线性序列；片段锚定是二维（mode + target） | 学习成本略高（两组定位概念） |
| 可组合性 | 插槽层变更不影响片段层；反之亦然 | 跨层交互（如"将片段从 A 插槽移动到 B 插槽的锚点旁"）需要在两层之间传递数据 |