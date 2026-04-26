<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/prompt-bundle-componentized-refactoring-design.md","contentHash":"sha256:dfe017d63fb38cdd28aff711db136b537f2e7bf3d1517f92a9ce31df04a49336"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] runtime.ts 新增 runPromptWorkflowV2（PromptTree 载体）  `#p3-1`
- [x] memory_injector/policy_filter/memory_summary 提供 PromptTreeProcessor  `#p3-2`
- [x] service.ts V2 路径改用 runPromptWorkflowV2  `#p3-3`
- [ ] 移除 token_budget_trimmer adapter wrapper（推迟到 Phase 4）  `#p3-4`
- [x] 更新设计文档 §12 标记 Phase 3 完成  `#p3-5`
<!-- LIMCODE_TODO_LIST_END -->

# Prompt Bundle 组件化重构 Phase 3: Processor 管线树化

> 源设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md` §12.4

## 目标

- `context/workflow/runtime.ts` 新增 `runPromptWorkflowV2`，以 `PromptTree` 为载体
- 为 memory_injector / policy_filter / memory_summary 提供 `PromptTreeProcessor` 实现
- `service.ts` V2 路径改为调用 `runPromptWorkflowV2`
- 移除 `token_budget_trimmer` adapter wrapper

## 管线变更

```
Before (service.ts ad-hoc):
  buildPromptTree → MacroExpansion → PermissionFilter → buildPromptBundleV2

After (runtime.ts tree pipeline):
  runPromptWorkflowV2(tree)
    → MacroExpansionProcessor
    → MemoryProjectionProcessor
    → PolicyFilterProcessor
    → SummaryCompactionProcessor
    → TokenBudgetTrimProcessor (native tree)
    → PlacementResolution (tree-aware)
    → bundle finalize
```

## 任务拆解

### P3.1 — `runtime.ts` 新增 `runPromptWorkflowV2`

新增函数签名：
```typescript
export interface RunPromptWorkflowV2Input {
  tree: PromptTree;
  context: InferenceContext;
  profile?: PromptWorkflowProfile;
  steps?: PromptTreeProcessor[];
}

export interface RunPromptWorkflowV2Result {
  tree: PromptTree;
  diagnostics: PromptWorkflowDiagnostics;
}

export async function runPromptWorkflowV2(input: RunPromptWorkflowV2Input): Promise<RunPromptWorkflowV2Result>;
```

默认 steps 使用 `PromptTreeProcessor` 实现：
1. `createMacroExpansionTreeProcessor()` — 宏展开
2. `createMemoryInjectorTreeProcessor()` — 记忆注入
3. `createPolicyFilterTreeProcessor()` — 策略过滤
4. `createMemorySummaryTreeProcessor()` — 摘要压缩
5. `createTreeTokenBudgetTrimmer()` — token 裁剪
6. placement resolution（tree-aware）

### P3.2 — memory_injector/policy_filter/memory_summary 的 `PromptTreeProcessor` 实现

为每个 processor 新增 tree 版本。关键原则：
- 平面 `PromptProcessor` 遍历 `fragments[]` 并返回过滤后的列表
- `PromptTreeProcessor` 接收完整 tree，可跨 slot 操作，按需修改 `fragment.permission_denied` 或注入新 fragment

**memory_injector tree 版本**：
- 遍历 tree 中所有 slot 的 fragments
- 对每个 fragment 的 children 检查是否需要注入记忆块
- 注入：向 memory_summary slot 的 fragment 追加 block

**policy_filter tree 版本**：
- 遍历所有 fragments/blocks
- 检查权限（复用 `policy_filter.ts` 核心逻辑）
- 将无权访问的块标记为 filtered

**memory_summary tree 版本**：
- 遍历所有 slot
- 检查 token 预算，压缩/截断低优先级 fragment
- 标记过长的 fragment.children 为 trimmed

### P3.3 — `service.ts` 改用 `runPromptWorkflowV2`

```typescript
// Before:
const tree = buildPromptTree(...);
await createMacroExpansionTreeProcessor().process({...});
applyPermissionFilter(tree, ...);
prompt = buildPromptBundleV2(tree, ...);

// After:
const tree = buildPromptTree(...);
const workflowResult = await runPromptWorkflowV2({ tree, context: inferenceContext });
prompt = buildPromptBundleV2(workflowResult.tree, inferenceContext);
```

### P3.4 — 移除 adapter wrapper

`createTreeTokenBudgetTrimmerAsLegacy` (平面 adapter) 在 `runtime.ts` 中的引用替换为 `runPromptWorkflowV2` 中的原生 tree processor。确认零引用后，从 `token_budget_trimmer.ts` 删除 adapter 代码和 `PromptBlock`/`PromptSlotConfig` import。

### P3.5 — 更新文档

设计文档 §12 标记 Phase 3 完成，§9 迁移策略更新。
