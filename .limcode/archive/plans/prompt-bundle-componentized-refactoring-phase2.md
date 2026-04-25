<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/prompt-bundle-componentized-refactoring-design.md","contentHash":"sha256:3086d016ac4a2b4d0282cba2640105714755b149551a247d531f0c426c603a22"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 编写新适配器单元测试 (ai_gateway 测试文件中追加)  `#P2-T1`
- [x] 实现 PromptBundleToAiMessages 新适配器 (ai/adapters/prompt_tree_adapter.ts)  `#P2-T2`
- [x] 新增 buildAiTaskRequestFromInferenceContextV2 (ai/task_prompt_builder.ts)  `#P2-T3`
- [x] task_service.ts 支持新旧 Bundle 双路径  `#P2-T4`
- [x] gateway_backed provider 按 feature flag 切换新旧路径  `#P2-T5`
- [x] 运行全部测试验证  `#P2-T6`
<!-- LIMCODE_TODO_LIST_END -->

# Prompt Bundle 组件化重构 — Phase 2 实施计划

> 来源设计文档：`.limcode/design/prompt-bundle-componentized-refactoring-design.md`
> 
> **Q&A 对齐**:
> - Q1: 严格按 `message_role` 分组（即使改变了 system_policy 的旧行为）
> - Q2: 同 role 内按 `default_priority` 降序排列
> - Q3: 新建 `buildAiTaskRequestFromInferenceContextV2()`，旧函数不变
> - Q4: 先写单元测试覆盖新适配器

## 目标

Phase 2 完成 `PromptBundleV2 → AiMessage[]` 新适配器，使新 Slot 系统能产出最终发送给 AI provider 的消息格式。新旧路径通过 feature flag 切换，旧适配器保留并标记 `@deprecated`。

---

## 任务清单

### P2-T1: 编写新适配器单元测试

**产出**: `apps/server/tests/unit/ai_gateway.spec.ts`（追加测试）

- 测试 1：`system_core(p=100,system) + system_policy(p=95,system)` → 1 个 system message，system_core 在前
- 测试 2：`role_core(p=90,developer)` → 1 个 developer message
- 测试 3：`output_contract(p=50,user) + post_process(p=60,user)` → 1 个 user message，post_process 在前（优先级更高）
- 测试 4：`combined_heading: null` 的 slot 不显示标题
- 测试 5：`taskConfig.prompt.system_append / developer_append / user_prefix` 正确追加
- 测试 6：workflow metadata（profile_id/step_keys）透传到每个 message

**验收**: 6 个测试全部通过。

---

### P2-T2: 实现 PromptBundleV2 → AiMessage 新适配器

**产出**: `apps/server/src/ai/adapters/prompt_tree_adapter.ts`

- [x] 实现 `adaptPromptTreeToAiMessages(bundle: PromptBundleV2, taskConfig: AiResolvedTaskConfig): AiMessage[]`
- [x] 算法：
  1. 从 `bundle.tree.slot_registry` 获取每个 slot 的 `message_role`（默认 `'user'`）和 `default_priority`
  2. 按 `message_role` 分组（system/developer/user）
  3. 同组内按 `default_priority` 降序排列
  4. 拼接内容：`combined_heading` 非空时前面追加 `"## heading\n"`，多个 slot 间用 `"\n\n"` 分隔
  5. system message：`preset` + slot 内容 + `system_append`
  6. developer message：slot 内容 + `developer_append` + `examples`
  7. user message：`user_prefix` + slot 内容
  8. 每个 message 携带 workflow metadata（从 `bundle.metadata` 提取）
- [x] 空 slot 跳过，空 message 不产出
- [x] 接口签名：
  ```typescript
  export function adaptPromptTreeToAiMessages(
    bundle: PromptBundleV2,
    taskConfig: AiResolvedTaskConfig
  ): AiMessage[]
  ```

**验收**: 通过 P2-T1 的所有测试。

---

### P2-T3: 新增 buildAiTaskRequestFromInferenceContextV2

**产出**: `apps/server/src/ai/task_prompt_builder.ts`（新增函数）

- [x] 实现 `buildAiTaskRequestFromInferenceContextV2(context, options): Promise<AiTaskRequest>`
- [x] 内部调用 `buildPromptTree()` + `buildPromptBundleV2()`（来自 `prompt_builder_v2.ts`）
- [x] `prompt_context` 字段改为写入 V2 的 slots map 信息：
  - `prompt_context.prompt_bundle` 仍填充（通过 `toLegacyPromptBundle` 向后兼容）
  - 额外新增 `prompt_context.prompt_bundle_v2?: PromptBundleV2` 字段（可选，Phase 2 暂用 metadata 透传）
- [x] 旧 `buildAiTaskRequestFromInferenceContext` 保留不变

**验收**: 编译通过，旧函数调用不受影响。

---

### P2-T4: task_service.ts 支持新旧 Bundle 双路径

**产出**: `apps/server/src/ai/task_service.ts`（修改）

- [x] 在 `AiTaskService.runTask()` 中：
  - 检查 `request.prompt_context` 中是否有 V2 bundle 信息
  - 若有 `prompt_bundle_v2` → 调用 `adaptPromptTreeToAiMessages()` 生成 messages
  - 若无 → 走旧 `adaptPromptBundleToAiMessages()` 路径
- [x] 当前 `AiTaskRequest.prompt_context.prompt_bundle_v2` 字段在 `ai/types.ts` 中新增：
  ```typescript
  prompt_context: {
    messages?: AiMessage[];
    prompt_bundle?: AiTaskPromptBundleSnapshot | null;
    prompt_bundle_v2?: PromptBundleV2 | null;  // 新增
  };
  ```

**验收**: 新旧路径均可正常工作，编译通过。

---

### P2-T5: gateway_backed provider 按 feature flag 切换

**产出**: `apps/server/src/inference/providers/gateway_backed.ts`（修改）

- [x] 在 `createGatewayBackedInferenceProvider()` 中：
  - 读取 `getRuntimeConfig().features?.experimental?.prompt_bundle_v2`
  - 若 true → 调用 `buildAiTaskRequestFromInferenceContextV2()` + 使用新适配器
  - 若 false → 走旧路径（当前行为）
- [x] 旧路径保持不变，不引入 breaking change

**验收**: feature flag off → 旧行为；feature flag on → 新管线执行，gateway 正常收到 AiMessage[]。

---

### P2-T6: 运行全部测试验证

- [x] `npx vitest run --config apps/server/vitest.unit.config.ts` — 单元测试全部通过
- [x] 确认现有 `ai_gateway.spec.ts` 旧测试仍然通过
- [x] 确认新增 P2-T1 测试全部通过

---

## 文件变更汇总

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `ai/adapters/prompt_tree_adapter.ts` | PromptBundleV2 → AiMessage[] 适配器 |
| 修改 | `tests/unit/ai_gateway.spec.ts` | 追加 6 个新适配器测试 |
| 修改 | `ai/task_prompt_builder.ts` | 新增 `buildAiTaskRequestFromInferenceContextV2()` |
| 修改 | `ai/types.ts` | `AiTaskRequest.prompt_context` 新增 `prompt_bundle_v2` 字段 |
| 修改 | `ai/task_service.ts` | 支持新旧双路径 |
| 修改 | `inference/providers/gateway_backed.ts` | feature flag 切换 |

---

## 执行顺序

```
P2-T1 (测试先行) → P2-T2 (实现适配器) → P2-T3 (V2 request builder)
                                            → P2-T4 (task_service)
                                            → P2-T5 (gateway_backed)
                                            → P2-T6 (全量验证)
```

---

## 不在此 Phase 的内容

- ❌ 权限过滤逻辑 `resolveSlotPermission`（Phase 3）
- ❌ `PromptTreeProcessor` 接口和 Processor 迁移（Phase 2 范围外）
- ❌ 旧适配器删除（Phase 4）
