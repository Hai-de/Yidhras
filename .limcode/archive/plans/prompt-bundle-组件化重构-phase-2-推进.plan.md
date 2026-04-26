<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/prompt-bundle-componentized-refactoring-design.md","contentHash":"sha256:f0b8ab0865288a97bac8cf9f70f14fdf033f53ae91a8e416a53b683e9aacd06b"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] prompt_builder_v2.ts 移除对 buildPromptFragments 的兼容桥接  `#1`
- [x] 更新 InferenceProvider 接口 + 三个 provider 消费 PromptBundleV2  `#2`
- [x] 删除 toLegacyPromptBundle  `#3`
- [x] context/workflow/runtime.ts 接入 createTreeTokenBudgetTrimmer（adapter wrapper）  `#4`
- [x] 删除旧 createTokenBudgetTrimmerPromptProcessor  `#5`
- [x] 更新 TODO.md 相关条目  `#6`
<!-- LIMCODE_TODO_LIST_END -->

# Prompt Bundle 组件化重构 Phase 2 推进

> 源设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md` §12.3

## 目标

完成 Phase 2/3 的遗留重构：使 `prompt_bundle_v2` 路径自给自足，更新 provider 接口，将 `token_budget_trimmer` 切换到 tree 版本，删除 `toLegacyPromptBundle` 和旧代码。

---

## 任务拆解

### Task 1：`prompt_builder_v2.ts` 去旧依赖

**文件**：`apps/server/src/inference/prompt_builder_v2.ts`

**现状**：L105-116 调用 `buildPromptFragments(context)` 将旧 fragment 合并进 V2 tree。这使 V2 builder 依赖旧 builder。

**改动**：移除 `buildPromptFragments` 调用及其兼容桥接逻辑。V2 builder 仅基于 `slot_registry` 的 slot config 生成 tree 内容。

**约束**：
- 6 个内置 slot 的 `default_template` 已在 `prompt_slots.default.yaml` 中定义，移除旧桥接后内容等价
- `template_context: world_prompts` 的 slot（如 `world_context`）已在 `resolveTemplate()` 中处理
- 确认 `context/post_process`（JSON 快照）和 `output_contract` 的生成逻辑已迁入 slot template 或 `resolveTemplate`

**验证**：开启 `prompt_bundle_v2` flag 后，生成的 prompt 内容与旧路径等价。

---

### Task 2：更新 `InferenceProvider` 接口消费 `PromptBundleV2`

**文件**：
- `apps/server/src/inference/provider.ts` — 接口定义
- `apps/server/src/inference/providers/mock.ts` — mock provider
- `apps/server/src/inference/providers/rule_based.ts` — rule_based provider
- `apps/server/src/ai/providers/gateway_backed.ts` — gateway_backed provider
- `apps/server/src/inference/service.ts` — 调用方

**改动**：

1. **`provider.ts`**：`InferenceProvider.run()` 签名改为接受 `PromptBundleV2`（或联合类型 `PromptBundle | PromptBundleV2`，Phase 4 再收窄）。为安全起见，Phase 2 使用联合类型：

```typescript
export interface InferenceProvider {
  readonly name: string;
  readonly strategies: InferenceStrategy[];
  run(context: InferenceContext, prompt: PromptBundle | PromptBundleV2): Promise<ProviderDecisionRaw>;
}
```

2. **`mock.ts`**：从 `prompt.slots` 读取 slot 内容，不再依赖 `prompt.system_prompt` 等旧字段。增加类型守卫判断是新还是旧 Bundle。

3. **`rule_based.ts`**：同上。

4. **`gateway_backed.ts`**：V2 路径已使用 `buildAiTaskRequestFromInferenceContextV2`（L34），旧路径使用 `buildAiTaskRequestFromInferenceContext`（L37）。统一为 V2 路径即可。

5. **`service.ts`**：移除 `toLegacyPromptBundle()` 调用（L256），`prompt` 直接传递 `PromptBundleV2`。

---

### Task 3：移除 `toLegacyPromptBundle`

**文件**：`apps/server/src/inference/prompt_bundle_v2.ts`

**前提**：Task 2 完成后，`toLegacyPromptBundle` 零引用。

**改动**：删除 `toLegacyPromptBundle` 函数。`PromptBundle` import 可一并移除。

---

### Task 4：`context/workflow/runtime.ts` 接入 `createTreeTokenBudgetTrimmer`

**文件**：
- `apps/server/src/context/workflow/runtime.ts`
- `apps/server/src/inference/processors/token_budget_trimmer.ts`

**现状**：`runtime.ts` 的 `buildDefaultLegacySteps()` 硬编码 `createTokenBudgetTrimmerPromptProcessor()`（旧平面版本）。新 tree 版本 `createTreeTokenBudgetTrimmer` 已实现但零引用。

**方案**：不走"在 runtime.ts 中新增完整 tree pipeline"的路线（太重），而是写一个轻量 **adapter wrapper**：

在 `token_budget_trimmer.ts` 中新增函数：

```typescript
export const createTreeTokenBudgetTrimmerAsLegacy = (): PromptProcessor => {
  const treeTrimmer = createTreeTokenBudgetTrimmer();
  return {
    name: 'token-budget-trimmer-tree',
    async process({ context, fragments, workflow }) {
      // 将平面 fragments 组装为临时 PromptTree
      const tree = buildTempTreeFromFragments(fragments, context);
      const processed = await treeTrimmer.process({ context, tree, workflow });
      // 展开为平面 fragments
      return flattenTreeToFragments(processed);
    }
  };
};
```

然后在 `runtime.ts:69` 替换引用。

**注意**：这个 adapter 是临时桥接，完整的 tree pipeline 在 Phase 3 中完成。但 adapter 使新 trimmer 能立即工作，且旧 trimmer 可以被删除。

---

### Task 5：删除旧 `createTokenBudgetTrimmerPromptProcessor`

**文件**：`apps/server/src/inference/processors/token_budget_trimmer.ts`

**前提**：Task 4 完成后，旧 processor 零引用。

**改动**：
1. 删除 `createTokenBudgetTrimmerPromptProcessor` 函数及其 `@deprecated` 注释
2. 删除 `BASE_SLOT_PRIORITY`、`buildSlotPriority` 等仅被旧 processor 使用的私有函数
3. 删除 `estimateCost`、`scoreFragment`、`shouldAlwaysKeep` 等旧裁剪算法辅助函数（如仅被旧 processor 使用）
4. 更新 TODO.md 中 `token_budget_trimmer` 条目为已完成

**注意**：保留所有 tree trimmer 及其依赖的 `PromptTreeProcessor` 类型、`prompt_tokenizer.ts` 等。

---

### Task 6：更新 TODO.md

将以下条目标记为完成：
- 删除旧 `token_budget_trimmer`
- 相关 PromptBundle 重构条目

---

## 依赖关系

```
Task 1 (builder 去旧依赖)
  │
  ▼
Task 2 (更新 InferenceProvider 接口)
  │
  ├──────────────────────┐
  ▼                      ▼
Task 3 (删 toLegacy)   Task 4 (tree trimmer adapter)
                          │
                          ▼
                       Task 5 (删旧 trimmer)
                          │
                          ▼
                       Task 6 (更新 TODO)
```

Task 1 和 Task 2 可并行推进。Task 3 必须等 Task 2 完成。Task 4→5 是独立链路，可与 Task 2→3 并行。

---

## 风险

| 风险 | 缓解 |
|------|------|
| 移除 `buildPromptFragments` 桥接后，V2 生成的 prompt 与 V1 不等价 | Task 1 后手动对比 `prompt_bundle_v2` flag 开关时的输出 |
| `InferenceProvider` 联合类型导致 provider 内部类型守卫增多 | 仅 Phase 2 临时使用，Phase 4 收窄为纯 V2 |
| tree trimmer adapter 的平面↔树转换有性能开销 | adapter 作为临时方案，完整 tree pipeline (Phase 3) 会彻底消除 |
