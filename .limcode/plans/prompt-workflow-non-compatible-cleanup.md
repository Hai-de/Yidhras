<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/technical-debt-from-prototype-evaluation.md","contentHash":"sha256:d7f58b12e396afa1116450472f94193a78f96fb4b46bb4c02961f7b5135a0560"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 清点并迁移旧 prompt builder 引用，确立 buildWorkflowPromptBundle 为唯一入口  `#pw-clean-1`
- [x] 移除 profile 静默 fallback，并补充 intent_grounding_assist 显式 profile  `#pw-clean-2`
- [x] 修复 behavior_control 对话上下文来源，移除 state.ai_messages 依赖  `#pw-clean-3`
- [x] 新增统一 token budget resolver，移除 8192 硬编码并收敛 budget trim  `#pw-clean-4`
- [x] 清理 AiTaskService direct messages 旁路，强制 PromptBundleV2 输入  `#pw-clean-5`
- [x] 删除或内聚旧 prompt_builder.ts 及相关旧类型/fixture  `#pw-clean-6`
- [x] 补齐 profile、orchestrator、behavior、budget、task builder 单测  `#pw-clean-7`
- [x] 更新 PROMPT_WORKFLOW、PROMPT_SLOT_CONFIGURATION、ARCH、TODO 文档  `#pw-clean-8`
- [x] 运行 prompt 局部测试、typecheck、lint 并记录非 prompt 历史失败  `#pw-clean-9`
<!-- LIMCODE_TODO_LIST_END -->

# Prompt Workflow 非兼容式收敛升级计划

## 0. 背景与决策

当前项目尚未上线，用户明确要求：**不允许为了向后兼容继续保留旧债务；旧的东西该清理就清理。**

基于前序代码分析，当前提示词组装体系已经存在 `Prompt Workflow V2` 主体：

- `apps/server/src/context/workflow/orchestrator.ts` — `buildWorkflowPromptBundle()` 当前正式入口
- `apps/server/src/context/workflow/profiles.ts` — 内置 workflow profile
- `apps/server/src/context/workflow/tracks/*` — template / node / snapshot / conversation_history 轨道
- `apps/server/src/context/workflow/executors/*` — placement / assembly / behavior / transform / permission / budget / finalize
- `apps/server/src/inference/prompt_builder_v2.ts` — PromptTree/PromptBundleV2 渲染
- `apps/server/src/ai/task_service.ts` + `apps/server/src/conversation/assembler.ts` — PromptBundleV2 → AiMessage[]

但存在以下债务：

1. 旧 `prompt_builder.ts` 仍被 V2 依赖，边界不清。
2. 文档与代码不一致：文档称 chat profile 未生产启用，但代码已可能启用。
3. `behavior_control` 中 token context window 硬编码 `8192`。
4. `behavior_control` 依赖 `state.ai_messages`，但消息是在 bundle 之后才组装，导致对话条件语义不可靠。
5. `task_prompt_builder.spec.ts` 中关键 task-aware 测试被 `skip`。
6. prompt 模块缺少针对 orchestrator/profile/conversation/budget 的主路径测试。

本计划采取**破坏式清理**策略：统一正式入口，删除或重命名旧接口，修复语义，不保留兼容 wrapper。

## 1. 目标

### 1.1 功能目标

- `buildWorkflowPromptBundle()` 成为服务端唯一提示词组装入口。
- `PromptBundleV2` 成为唯一 prompt bundle 结构。
- 旧 prompt builder 不再作为可被业务调用的模块存在。
- workflow 中的 profile、track、executor、bundle finalize 语义一致。
- behavior control 能正确读取对话上下文、预算信息和当前推理上下文。
- task-aware prompt workflow 对 `agent_decision`、`context_summary`、`memory_compaction`、`intent_grounding_assist` 有明确行为。

### 1.2 清债目标

- 删除旧的兼容性入口，而不是保留 deprecated wrapper。
- 删除或内聚旧 builder 中只为 V2 服务的辅助函数。
- 消除文档与实际代码冲突。
- 补齐测试，让未来修改 prompt workflow 时能快速发现破坏。

### 1.3 非目标

本次不做：

- 双重 prompt 模块并存。
- 新增第二套“更复杂插槽函数核心”。
- 为历史 API 或旧 prompt 结构保留兼容层。
- 引入 WASM/wasmtime sandbox。
- 大规模重写 AI Gateway。

## 2. 破坏式架构决策

### 2.1 唯一入口

保留并强化：

```ts
buildWorkflowPromptBundle({ context, taskType, profileId? })
```

禁止新业务直接使用：

- `buildPromptTree(context, registry)`
- 旧 `prompt_builder.ts` 的 prompt 拼接函数
- 手写 `combined_prompt`

`buildPromptTree()` 若仍保留，应移动为 workflow 内部 finalize/assembly 辅助，不再作为跨模块公共 API 暴露。

### 2.2 唯一输出结构

保留：

- `PromptTree`
- `PromptBundleV2`
- `AiMessage[]` assembled from `PromptBundleV2`

删除或停止暴露旧 prompt bundle/payload 概念。

### 2.3 profile 显式化

当前 profile 选择存在 fallback 到第一个内置 profile 的行为：

```ts
return matching[0] ?? listBuiltInPromptWorkflowProfiles()[0] ?? getBuiltInWorkflowProfiles()[0];
```

本次应改为：

- explicit `profileId` 找不到：直接抛错。
- task/strategy/pack 找不到匹配 profile：直接抛错或返回明确 `ApiError`。
- 不再静默 fallback 到 `agent-decision-default`。

原因：项目未上线，不需要容忍错误配置。静默 fallback 会掩盖 prompt 配置错误。

### 2.4 task type 映射显式化

当前 `intent_grounding_assist` 文档写无专属 profile，会 fallback 到 `agent-decision-default`。本次应改为二选一：

- 给 `intent_grounding_assist` 添加专属 profile；或
- 如果不需要该任务走 prompt workflow，则调用侧不得请求该 task type。

推荐：添加轻量 profile：

```ts
id: 'intent-grounding-assist-default'
tracks: { template: true, node: true, snapshot: false }
steps: placement → assembly → behavior → transform → permission → budget_trim → finalize
```

避免隐式 fallback。

## 3. 实施阶段

## Phase 1：入口与旧代码清理

### 1.1 搜索并锁定旧入口

检查并分类所有 prompt 相关调用：

- `buildPromptTree`
- `buildPromptBundleV2`
- `buildContextPromptPayload`
- `buildOutputContractPrompt`
- `PromptResolvableContext`
- `combined_prompt`
- `prompt_builder.ts`

预期处理：

- 业务层只能调用 `buildWorkflowPromptBundle()`。
- `buildPromptBundleV2()` 只能由 `bundle_finalize` executor 调用。
- 旧 `prompt_builder.ts` 中仍有用的函数迁移到新位置。

### 1.2 迁移旧辅助函数

当前 `prompt_builder_v2.ts` 从 `prompt_builder.ts` 引入：

```ts
import { buildContextPromptPayload, buildOutputContractPrompt } from './prompt_builder.js';
```

处理方案：

- 将 `buildOutputContractPrompt()` 移到新文件，例如：
  - `apps/server/src/inference/output_contract_prompt.ts`
- 将 `buildContextPromptPayload()` 如果只用于 snapshot/dynamic fragment，则移动到：
  - `apps/server/src/context/workflow/prompt_payload.ts`
  或并入 `snapshot_track.ts` / `template_track.ts`
- 删除 `apps/server/src/inference/prompt_builder.ts`，如果无剩余引用。

### 1.3 降低 `prompt_builder_v2.ts` 的公共性

将 `buildPromptTree()` 从“外部可调用 builder”改为 workflow 内部工具：

推荐新结构：

```txt
apps/server/src/context/workflow/rendering/
  prompt_tree_builder.ts
  prompt_bundle_renderer.ts
```

或保留文件名但明确只供 workflow executor 使用。

非兼容策略：不保留旧 import path。修改所有引用。

## Phase 2：profile 选择语义收敛

### 2.1 移除静默 fallback

修改 `selectPromptWorkflowProfile()`：

- `profile_id` 存在但找不到 → throw `PromptWorkflowProfileNotFoundError`
- 没有匹配 profile → throw `PromptWorkflowProfileSelectionError`
- 不再返回第一个内置 profile

错误信息至少包含：

- `task_type`
- `strategy`
- `pack_id`
- `profile_id`

### 2.2 添加 intent grounding profile

新增内置 profile：

```ts
{
  id: 'intent-grounding-assist-default',
  version: '1',
  applies_to: { task_types: ['intent_grounding_assist'] },
  defaults: { token_budget: ..., safety_margin_tokens: ... },
  tracks: { template: true, node: true, snapshot: false },
  steps: [...]
}
```

如果 runtime config 中没有对应默认值，可先在 `PromptWorkflowConfigSchema` 中新增：

```ts
intent_grounding_assist_default
```

并在 `PROMPT_WORKFLOW_DEFAULTS` 中给默认 budget。

### 2.3 chat profile 文档与代码统一

因为项目未上线，选择“代码为准”：

- `chat-first-turn`
- `chat-follow-up`

视为正式 profile。

文档改为说明：

- 何时由 `defaultProfileResolver()` 选择。
- 首轮和后续轮次分别启用哪些 track。
- conversation_history 轨道如何进入 `conversation_history` slot。

## Phase 3：behavior_control 语义修复

### 3.1 移除 `state.ai_messages` 依赖

当前问题：`behavior_control` 在 prompt bundle 生成前执行，但 `AiMessage[]` 在之后才 assemble。

处理方案：从 `InferenceContext` 和 `PromptWorkflowState` 中构建条件上下文。

替代来源：

- turn count：`context.agent_conversation_memory?.entries.length`
- last user/current message：
  - 如果是 conversation inference，从 `agent_conversation_memory.entries` 中按 turn_number 找最近可见 entry。
  - 如果是非 conversation inference，从 `InferenceRequestInput` 不一定可得，因此应允许为空。
- conversation profile：`context.conversation_profile`
- current agent：`context.current_agent_id`

修改 executor 接口使用已有 `context` 参数：

```ts
async execute({ context, profile, spec, state })
```

`buildSlotConditionContext()` 应接收 `InferenceContext`。

### 3.2 统一 token budget 来源

删除：

```ts
const total = 8192;
```

改为从以下顺序解析：

1. step config：`spec.config.model_context_window` 或 `spec.config.token_budget`
2. profile defaults：`profile.defaults.token_budget`
3. runtime config profile defaults
4. 最后才使用内部默认值

并确保 `behavior_control` 和 `token_budget_trim` 使用同一个 resolver，例如新增：

```ts
apps/server/src/context/workflow/token_budget.ts
```

导出：

```ts
resolvePromptWorkflowBudget({ profile, spec })
```

返回：

```ts
{
  tokenBudget: number;
  safetyMarginTokens: number;
  effectiveBudget: number;
  modelContextWindow: number;
}
```

### 3.3 slot behavior diagnostics 增强

当前 `state.slot_behavior_diagnostics` 已存在类型，但需要确认完整写入 bundle metadata。

要求：

- 激活 slot 列表
- 禁用 slot 列表
- evaluation errors
- 使用的 budget source
- conversation condition source

这些信息应进入：

- `state.diagnostics.step_traces[].notes`
- `bundle.metadata.workflow_*`

## Phase 4：budget trim 收敛

### 4.1 使用统一 budget resolver

修改 `token_budget_trim.ts`：

- 使用 Phase 3 新增的 `resolvePromptWorkflowBudget()`。
- 删除本文件内重复默认常量，或统一由 resolver 导出。

### 4.2 明确超预算失败策略

当前逻辑中不可裁剪 fragment 即使超预算也可能继续保留。

项目未上线，建议采用严格模式：

- 如果裁剪所有 removable fragment 后仍超过 budget：
  - 记录 `budget_exceeded_after_trim: true`
  - 对于 `agent_decision` 可继续但 metadata 标记严重警告；或
  - 直接抛错，让调用方修配置。

推荐第一阶段先记录严重诊断，不直接抛错，避免把已有世界包全部打断。但由于用户要求不留债，最终应在测试确认后切换为严格错误。

可以用 runtime config 控制：

```yaml
prompt_workflow:
  strict_budget: true
```

由于未上线，默认 `true`。

### 4.3 conversation_history 裁剪测试固定化

保留当前策略：conversation_history 旧轮次优先裁剪。

必须用单测固定：

- 新轮次在预算紧张时比旧轮次更容易保留。
- summary entry 的裁剪策略明确。

## Phase 5：AiMessage assembly 边界整理

### 5.1 明确组装顺序

正式链路应为：

```txt
InferenceContext
  → buildWorkflowPromptBundle()
  → PromptBundleV2
  → assembleConversationMessages()
  → AiMessage[]
  → AI Gateway
```

文档和代码注释都按此顺序表达。

### 5.2 删除绕过 PromptBundleV2 的 messages 输入

当前 `AiTaskService.runTask()` 支持：

```ts
const messages = request.prompt_context.messages
  ?? (request.prompt_context.prompt_bundle_v2 ? assembleConversationMessages(...) : null);
```

非兼容清理建议：

- 删除 `request.prompt_context.messages` 优先路径。
- 要求所有任务都提供 `prompt_bundle_v2`。
- 如有测试或调用方直接传 messages，应改为构造 PromptBundleV2。

这会强制所有 AI task 都进入统一 prompt workflow。

如果某些低级测试需要直接测 gateway，应绕过 `AiTaskService`，不要污染业务入口。

### 5.3 task_prompt_builder 强制 bundle

`buildAiTaskRequestFromInferenceContextV2()` 当前使用：

```ts
const bundle = options.prompt_bundle!;
```

改为显式校验：

- 没传 `prompt_bundle` 直接抛错。
- 错误码明确，例如 `PROMPT_BUNDLE_REQUIRED`。

## Phase 6：测试补齐

### 6.1 profile 选择测试

新增或修改测试覆盖：

- `agent_decision` → `agent-decision-default`
- `context_summary` → `context-summary-default`
- `memory_compaction` → `memory-compaction-default`
- `intent_grounding_assist` → `intent-grounding-assist-default`
- explicit profile id：`chat-first-turn`
- explicit profile id 不存在 → 抛错
- 无匹配 profile → 抛错，不 fallback

### 6.2 orchestrator 测试

新增 `apps/server/tests/unit/prompt_workflow_orchestrator.spec.ts`，覆盖：

- template/node/snapshot 三轨输出进入 bundle。
- conversation_history track 在 chat profile 下进入 `conversation_history` slot。
- `bundle.metadata.workflow_profile_id` 正确。
- `bundle.metadata.workflow_task_type` 正确。
- diagnostics 包含 track traces 和 step traces。

### 6.3 behavior_control 测试

新增或扩展测试：

- 不再依赖 `state.ai_messages`。
- conversation_turn 条件从 `agent_conversation_memory` 计算。
- keyword_match 使用可解释的 last message 来源。
- budget 使用 profile/spec config，而不是 8192。

### 6.4 budget trim 测试

覆盖：

- 低优先级 removable fragment 先裁剪。
- 非 removable fragment 不被普通裁剪删除。
- strict budget 下裁剪后仍超预算会产生错误或严重诊断。
- conversation_history 旧轮次优先裁剪。
- `ignore_context_length` hard limit 生效。

### 6.5 task builder 测试恢复

处理 `apps/server/tests/unit/task_prompt_builder.spec.ts` 中的：

```ts
it.skip(...)
```

要求：

- 删除 `.skip`。
- 修正测试以适配新强制 bundle 语义。
- 覆盖 context_summary 和 memory_compaction。

### 6.6 局部测试命令修正

前序尝试指定测试文件时仍跑了全量 server unit。需要确认 Vitest 参数传递方式。

目标是在文档中提供可运行命令，例如：

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.unit.config.ts tests/unit/prompt_workflow_orchestrator.spec.ts
```

或修正 package script，使局部测试不误跑全量。

## Phase 7：文档更新

更新：

- `docs/subsystems/PROMPT_WORKFLOW.md`
- `docs/subsystems/PROMPT_SLOT_CONFIGURATION.md`
- `docs/ARCH.md` 中涉及 prompt workflow 的段落
- `TODO.md`

重点修正：

1. Prompt Workflow 是唯一提示词组装路径。
2. `chat-first-turn` / `chat-follow-up` 是正式 profile。
3. `intent_grounding_assist` 不再 fallback。
4. slot 数量描述一致：不要同时出现“7 槽”和“10 槽”。
5. slot behavior 配置来源按实际 runtime config 描述。
6. 删除“权限字段预留但执行层未接入”这类过时表述，如当前执行层已通过 feature flag 接入，应准确说明。
7. 记录非兼容变更：不再支持直接传 messages 绕过 PromptBundleV2。

## Phase 8：删除与最终清理

### 8.1 删除废弃文件/符号

候选：

- `apps/server/src/inference/prompt_builder.ts`
- 只服务旧 prompt 结构的类型
- 测试中旧 builder 专用 fixture
- 文档中旧 Prompt Tree/Prompt Builder 双轨说法

删除前必须用搜索确认无引用。

### 8.2 TypeScript 与 lint 收尾

运行：

```bash
pnpm --filter yidhras-server typecheck
pnpm --filter yidhras-server lint
```

如全量 lint 因历史问题失败，应至少保证修改文件 lint clean，并记录剩余非本次问题。

### 8.3 测试收尾

至少运行：

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.unit.config.ts tests/unit/prompt_bundle_v2.spec.ts
pnpm --filter yidhras-server exec vitest run --config vitest.unit.config.ts tests/unit/task_prompt_builder.spec.ts
pnpm --filter yidhras-server exec vitest run --config vitest.unit.config.ts tests/unit/prompt_workflow_orchestrator.spec.ts
```

如果可行，再运行：

```bash
pnpm --filter yidhras-server test:unit
```

注意：当前全量 unit 已存在非 prompt 模块失败，不能把这些历史失败混入本计划验收。需要区分：

- 本次新增/修改 prompt 测试必须通过。
- 既有 clock route projection 等失败另立任务处理。

## 4. 文件级变更清单

### 重点修改

- `apps/server/src/context/workflow/orchestrator.ts`
- `apps/server/src/context/workflow/profiles.ts`
- `apps/server/src/context/workflow/types.ts`
- `apps/server/src/context/workflow/executors/behavior_control.ts`
- `apps/server/src/context/workflow/executors/token_budget_trim.ts`
- `apps/server/src/context/workflow/executors/bundle_finalize.ts`
- `apps/server/src/ai/task_service.ts`
- `apps/server/src/ai/task_prompt_builder.ts`
- `apps/server/src/conversation/assembler.ts`
- `apps/server/src/config/domains/prompt_workflow.ts`

### 可能新增

- `apps/server/src/context/workflow/token_budget.ts`
- `apps/server/src/context/workflow/errors.ts`
- `apps/server/src/context/workflow/rendering/prompt_tree_builder.ts`
- `apps/server/src/context/workflow/rendering/prompt_bundle_renderer.ts`
- `apps/server/tests/unit/prompt_workflow_profiles.spec.ts`
- `apps/server/tests/unit/prompt_workflow_orchestrator.spec.ts`
- `apps/server/tests/unit/prompt_workflow_budget.spec.ts`
- `apps/server/tests/unit/prompt_workflow_behavior_control.spec.ts`

### 可能删除

- `apps/server/src/inference/prompt_builder.ts`
- 与旧 prompt builder 绑定的测试 fixture
- 文档中旧兼容说明

## 5. 验收标准

### 5.1 代码验收

- 没有业务代码直接调用旧 prompt builder。
- `prompt_builder.ts` 被删除，或只剩无业务引用的迁移前临时状态；最终不得保留。
- `selectPromptWorkflowProfile()` 不再静默 fallback。
- `intent_grounding_assist` 有显式 profile 或显式禁止路径。
- `behavior_control` 不再使用 `state.ai_messages` 作为主要对话条件来源。
- token budget 不再硬编码 `8192`。
- `AiTaskService` 不再优先接受 direct messages 绕过 PromptBundleV2。

### 5.2 测试验收

- `task_prompt_builder.spec.ts` 不再包含相关 `.skip`。
- 新增 profile/orchestrator/budget/behavior 测试通过。
- prompt 相关单测可用局部命令单独运行。

### 5.3 文档验收

- `PROMPT_WORKFLOW.md` 与代码行为一致。
- `PROMPT_SLOT_CONFIGURATION.md` slot 数量、权限、配置来源描述一致。
- `TODO.md` 中“提示词流水线升级”状态更新，删除已过时“决策推迟”或补充新决策结果。

## 6. 风险与控制

### 风险 1：删除旧 builder 牵出隐性引用

控制：先用搜索确认引用，再删除；不做兼容 wrapper，但允许在同一提交内批量迁移引用。

### 风险 2：强制 PromptBundleV2 导致部分 AI task 构造失败

控制：所有 `AiTaskRequest` 构造点统一走 `buildWorkflowPromptBundle()`，测试覆盖 context summary / memory compaction / agent decision。

### 风险 3：strict profile selection 暴露现有错误配置

控制：这是期望结果。项目未上线，应让错误尽早失败。

### 风险 4：全量测试已有非 prompt 失败干扰验收

控制：本计划验收以 prompt 局部测试、typecheck、修改文件 lint 为准；全量已有失败另立任务。

## 7. 推荐执行顺序

1. 先改 profile selection，移除 fallback。
2. 新增 intent grounding profile。
3. 新增统一 budget resolver。
4. 修 behavior_control 对话条件来源。
5. 修 token_budget_trim 使用统一 resolver。
6. 清理 `AiTaskService` direct messages 旁路。
7. 迁移并删除旧 `prompt_builder.ts`。
8. 补测试。
9. 更新文档和 TODO。
10. 跑局部测试/typecheck/lint。
