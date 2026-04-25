<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/prompt-bundle-componentized-refactoring-design.md","contentHash":"sha256:3086d016ac4a2b4d0282cba2640105714755b149551a247d531f0c426c603a22"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 定义 PromptBlock 类型 (inference/prompt_block.ts)  `#T1`
- [x] 定义 PromptFragmentV2 树结构版 (inference/prompt_fragment_v2.ts)  `#T2`
- [x] 定义 PromptSlotConfig + PromptSlotRegistry (inference/prompt_slot_config.ts)  `#T3`
- [x] 定义 PromptTree + walker/渲染工具 (inference/prompt_tree.ts)  `#T4`
- [x] 定义 PromptBundleV2 + toLegacyPromptBundle 兼容转换 (inference/prompt_bundle_v2.ts)  `#T5`
- [x] 编写内置默认 7 槽 YAML 配置 (ai/schemas/prompt_slots.default.yaml)  `#T6`
- [x] 实现 Slot 配置加载与合并 (ai/registry.ts 新增函数)  `#T7`
- [x] 实现 PromptTree 构建器 buildPromptTree + buildPromptBundleV2 (inference/prompt_builder_v2.ts)  `#T8`
- [x] 添加 feature flag (config/runtime_config.ts)  `#T9`
- [x] InferenceService 集成新旧管线切换 (inference/service.ts)  `#T10`
- [x] 更新 Context Workflow State 支持 PromptTree (context/workflow/)  `#T11`
- [x] 编写端到端验证测试 (tests/unit/prompt_bundle_v2.spec.ts, 6 个用例)  `#T12`
<!-- LIMCODE_TODO_LIST_END -->

# Prompt Bundle 组件化重构 — Phase 1 实施计划

> 来源设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md`

## 目标

Phase 1 完成新接口定义、默认配置、树构建器，新旧管线通过 feature flag 并置运行，不影响现有功能。

---

## 任务清单

### T1: 定义 PromptBlock 类型

**产出**: `apps/server/src/inference/prompt_block.ts`

- [x] 定义 `PromptBlockKind` 联合类型（`'text' | 'macro_ref' | 'conditional' | 'loop' | 'json'`）
- [x] 定义 `PromptBlock` 接口（id / kind / rendered / content / metadata）
- [x] 定义 `PromptBlockContent` 判别联合类型，5 种变体各含自己的 payload
- [x] 导出所有类型

**验收**: TypeScript 编译通过，类型可从其他模块 import。

---

### T2: 定义 PromptFragment（树结构版）

**产出**: `apps/server/src/inference/prompt_fragment_v2.ts`

- [x] 定义 `PromptFragmentV2` 接口（含 `children: Array<PromptBlock | PromptFragmentV2>`）
- [x] 复用当前 `PromptFragmentPlacementMode`、`PromptFragmentAnchorKind`、`PromptFragmentAnchor`（从 `prompt_fragments.ts` import）
- [x] 定义 `PromptFragmentPermissions` 接口（read/write/adjust/visible/visible_to）
- [x] 在旧 `prompt_fragments.ts` 的 `PromptFragment` 上添加 `@deprecated` JSDoc 注释

**验收**: 新旧 Fragment 并存，互不冲突。

---

### T3: 定义 PromptSlotConfig 和 PromptSlotRegistry

**产出**: `apps/server/src/inference/prompt_slot_config.ts`

- [x] 定义 `PromptSlotConfig` 接口（全部字段见设计 §2.3）
- [x] 定义 `PromptSlotRegistry` 接口（version / slots map / metadata）
- [x] 导出所有类型

**验收**: 接口定义与设计文档一致。

---

### T4: 定义 PromptTree

**产出**: `apps/server/src/inference/prompt_tree.ts`

- [x] 定义 `PromptTree` 接口（inference_id / task_type / fragments_by_slot / slot_registry / metadata）
- [x] 定义 `PromptTreeMetadata` 接口
- [x] 实现 `walkPromptBlocks()` 深度优先遍历器
- [x] 实现 `renderSlotText()` 按 slot 拼接渲染文本
- [x] 编写单元测试：单层 Fragment → 正确拼接；嵌套 Fragment → 遍历顺序正确；conditional/loop → 子 Block 被访问

**验收**: walker 和 render 函数通过测试。

---

### T5: 定义 PromptBundleV2 + 兼容转换

**产出**: `apps/server/src/inference/prompt_bundle_v2.ts`

- [x] 定义 `PromptBundleV2` 接口（slots / combined_prompt / metadata / tree）
- [x] 定义 `PromptBundleToAiMessagesAdapter` 接口（adapt 签名）
- [x] 实现 `toLegacyPromptBundle(v2)` 兼容转换函数（7 个 slot → 6 个固定字段映射）
- [x] 编写单元测试：V2 → Legacy 转换 round-trip 一致性

**验收**: 转换函数在默认 7 槽配置下输出与当前 `PromptBundle` 兼容的结构。

---

### T6: 编写内置默认 Slot 配置 YAML

**产出**: `apps/server/src/ai/schemas/prompt_slots.default.yaml`

- [x] 按设计 §4.1 编写 7 个默认 slot：
  - `system_core`（priority 100, message_role system）
  - `system_policy`（priority 95, 含空白权限标记）
  - `role_core`（priority 90, message_role developer, 含 default_template）
  - `world_context`（priority 80, template_context world_prompts）
  - `memory_summary`（priority 70, message_role user）
  - `output_contract`（priority 50, 含 default_template）
  - `post_process`（priority 60, message_role user）
- [x] 每个 slot 的字段与设计 §4.1 完全一致

**验收**: YAML 可用 Zod schema 成功解析（T7 验证）。

---

### T7: 实现 Slot 配置加载与合并

**产出**: `apps/server/src/ai/registry.ts`（新增函数）

- [x] 定义 `promptSlotConfigSchema`（Zod schema，校验 `PromptSlotConfig` 所有字段）
- [x] 定义 `promptSlotRegistrySchema`（Zod schema，校验 `PromptSlotRegistry`）
- [x] 实现 `loadPromptSlotRegistry()`：读取内置默认 YAML → 读用户覆盖 YAML → 深度合并
- [x] 合并逻辑：用户覆盖的 slot 整个替换同 id 的内置 slot
- [x] 复用 `registry.ts` 中已有的 `readYamlFileIfExists`、`deepMerge` 工具
- [x] 添加缓存机制（与 `aiRegistryCache` 一致的模式）
- [x] 实现 `getPromptSlotRegistry()` 和 `resetPromptSlotRegistryCache()`
- [x] 编写单元测试：默认配置加载 → 用户覆盖合并 → 新增 slot → 禁用 slot

**验收**: 配置加载/合并通过测试。

---

### T8: 实现 PromptTree 构建器

**产出**: `apps/server/src/inference/prompt_builder_v2.ts`

- [x] 实现 `buildPromptTree(context, registry)`：
  1. 遍历 `registry.slots`，对每个 enabled slot
  2. 如果有 `default_template`，调用 `renderNarrativeTemplate` 宏展开为 Block
  3. 如果有 `template_context === 'world_prompts'`，从 `context.world_prompts` 获取模板
  4. 组装 `PromptFragment`（树结构），挂到 `fragments_by_slot[slotId]`
  5. 附加来自旧 `buildPromptFragments()` 的外部 fragment（兼容桥接）
- [x] 实现 `buildPromptBundleV2(tree, context)`：
  1. 遍历所有 slot，调用 `renderSlotText()`
  2. 只对 `include_in_combined === true` 的 slot 组装 `combined_prompt`
  3. 填充 metadata
- [x] 编写单元测试：默认 7 槽 → V2 bundle slots 有 7 个 key → combined_prompt 非空

**验收**: 默认配置下 `buildPromptBundleV2` 输出与 `toLegacyPromptBundle` 兼容。

---

### T9: 添加 Feature Flag

**产出**: `apps/server/src/config/runtime_config.ts`（修改）

- [x] 在 `ExperimentalFeatures` 接口中新增两个可选布尔字段：
  - `prompt_bundle_v2?: boolean`
  - `prompt_slot_permissions?: boolean`
- [x] 两个字段默认值为 `false`
- [x] 更新 schema 和配置加载逻辑

**验收**: 配置文件中设置 `features.experimental.prompt_bundle_v2: true` 后可在运行时读取。

---

### T10: InferenceService 集成新旧管线切换

**产出**: `apps/server/src/inference/service.ts`（修改）

- [x] 在 `CreateInferenceServiceOptions` 中新增可选的 `promptSlotRegistry` 参数
- [x] 在 `executeRunInternal` 和 `previewInference` 中：
  - 检查 `features.experimental.prompt_bundle_v2`
  - 若 true：调用 `buildPromptTree()` → `runPromptWorkflow`（当前保持旧接口）→ `buildPromptBundleV2()` → `toLegacyPromptBundle()`
  - 若 false：走旧 `buildPromptBundle()` 路径
- [x] 确保 `InferencePreviewResult` 的 `prompt: PromptBundle` 字段仍正常工作
- [x] 编写集成测试：feature flag off → 旧行为不变；feature flag on → 新管线执行

**验收**: 两个路径都能通过现有集成测试。

---

### T11: 更新 Context Workflow State 以支持 PromptTree

**产出**: `apps/server/src/context/workflow/types.ts`（修改）

- [x] `PromptWorkflowState` 新增可选字段 `tree?: PromptTree`
- [x] 不影响现有字段

**产出**: `apps/server/src/context/workflow/runtime.ts`（修改）

- [x] `runPromptWorkflow()` 参数新增可选 `tree?: PromptTree`
- [x] 当 tree 存在时，将 tree 写入 state
- [x] 当 tree 不存在时，保持现有行为

**验收**: 编译通过，现有测试不因新增可选字段而失败。

---

### T12: 编写端到端验证脚本

**产出**: `apps/server/tests/unit/prompt_bundle_v2.spec.ts`

- [x] 测试 1：加载默认配置 → buildPromptTree → buildPromptBundleV2 → slots 有 7 个 key
- [x] 测试 2：toLegacyPromptBundle 输出与旧 PromptBundle 结构一致
- [x] 测试 3：用户覆盖 YAML → 新增 slot → tree 中有该 slot
- [x] 测试 4：权限字段存在但 feature flag off → 不影响渲染
- [x] 测试 5：walkPromptBlocks 遍历嵌套 conditional Block
- [x] 测试 6：旧 `buildPromptBundle()` 路径不受影响

**验收**: 6 个测试全部通过。

---

## 文件变更汇总

| 操作 | 文件 | 行数估算 |
|------|------|---------|
| 新增 | `inference/prompt_block.ts` | ~40 |
| 新增 | `inference/prompt_fragment_v2.ts` | ~80 |
| 新增 | `inference/prompt_slot_config.ts` | ~90 |
| 新增 | `inference/prompt_tree.ts` | ~120 |
| 新增 | `inference/prompt_bundle_v2.ts` | ~100 |
| 新增 | `inference/prompt_builder_v2.ts` | ~200 |
| 新增 | `ai/schemas/prompt_slots.default.yaml` | ~120 |
| 新增 | `tests/unit/prompt_bundle_v2.spec.ts` | ~250 |
| 修改 | `inference/prompt_fragments.ts` | +5（@deprecated） |
| 修改 | `inference/types.ts` | +10 |
| 修改 | `config/runtime_config.ts` | +8 |
| 修改 | `ai/registry.ts` | +100 |
| 修改 | `inference/service.ts` | +30 |
| 修改 | `context/workflow/types.ts` | +3 |
| 修改 | `context/workflow/runtime.ts` | +15 |
| **合计** | | **~1171 行** |

---

## 不在此 Phase 的内容

- ❌ `PromptTree → AiMessage[]` 新适配器（Phase 2）
- ❌ 权限过滤逻辑 `resolveSlotPermission`（Phase 3）
- ❌ `PromptTreeProcessor` 接口和 Processor 迁移（Phase 2）
- ❌ 删除旧代码（Phase 4）

---

## 执行顺序

```
T1 → T2 → T3 → T4 ──┐
                     ├→ T8 → T10 → T11 → T12
T6 → T7 ────────────┘
      │
T5 ───┤
      │
T9 ───┘
```

T1-T4（类型定义）可并行；T6-T7（配置加载）可并行；T5、T9 可并行。最终在 T8 汇合。
