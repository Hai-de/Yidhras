<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/ai-three-layer-directory-refactoring.md","contentHash":"sha256:d4a312179335250e51269fbbbb921569211d56eb2b569c12e0c68346b976717f"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] B1 — 编写集成测试 gateway_backed_inference.spec.ts（1-2 用例，覆盖 model_routed 链路）  `#B1`
- [ ] B2 — 修复 gateway_backed.ts fallback bug（移除无 context 的默认值）  `#B2`
- [ ] B3 — 提取共享类型到 packages/contracts/src/ai_shared.ts（PromptBundleMetadata 等 7 个类型）  `#B3`
- [ ] B4 — 移动 gateway_backed.ts 到 ai/providers/（消除 inference/ → ai/ 反向物理依赖）  `#B4`
- [ ] B5 — 消除 domain/inference/ 单文件目录（context_assembler 移至 app/services/）  `#B5`
- [ ] B6 — 更新文档（ARCH.md, AI_GATEWAY.md, TODO.md）  `#B6`
<!-- LIMCODE_TODO_LIST_END -->

# AI 三层目录边界渐进重构 — 实施计划

## 概述

Phase B 六步渐进重构：先补集成测试，再修 bug、搬类型、拆循环、消目录，最后更新文档。

## 前置确认

- [x] 设计文档已确认：`.limcode/design/ai-three-layer-directory-refactoring.md`
- [x] 死代码 `ai_invocation_query.ts` 已删除
- [x] 空目录 `ai/schemas/` 已填充

---

## B1 — 编写集成测试  `pending`

**文件**：`apps/server/tests/integration/gateway_backed_inference.spec.ts`

**步骤**：
1. 参考 `tests/fixtures/isolated-db.ts` 和 `tests/fixtures/app-context.ts` 了解 AppContext 构造模式
2. 用 `vitest.integration.config.ts` 配置运行环境
3. 编写测试用例：
   - 用例 1：创建 `aiTaskService` + `gateway_backed` provider → 调用 `provider.run(inferenceContext, promptBundle)` → 断言返回 `status: 'completed'`
   - 用例 2：模拟 `aiTaskService.runTask` 抛出异常 → 断言降级返回 `FALLBACK_DECISION`
4. 关键约束：显式传入 `aiTaskService`，不依赖 `gateway_backed.ts` 的 fallback 默认值
5. 运行测试，确认通过

---

## B2 — 修复 gateway_backed.ts fallback bug  `pending`

**文件**：`apps/server/src/inference/providers/gateway_backed.ts`

**步骤**：
1. 定位 L24：`aiTaskService = createAiTaskService()` 默认参数
2. 移除该默认值，改为必传参数（函数签名从 `{ aiTaskService = createAiTaskService() }` 改为 `{ aiTaskService }`）
3. 验证组装根 `inference/service.ts:460` 已显式传入 `aiTaskService`，改动无影响
4. 运行 B1 集成测试确认通过

---

## B3 — 提取共享类型到 contracts 包  `pending`

**目标文件**：`packages/contracts/src/ai_shared.ts`
**原文件**：`apps/server/src/inference/types.ts`

**步骤**：
1. 从 `inference/types.ts` 中复制以下类型到 `contracts/src/ai_shared.ts`（原封不动）：
   - `PromptWorkflowMetadata` (L288-297)
   - `PromptWorkflowStepTraceSnapshot` (L260-267)
   - `PromptWorkflowPlacementSummarySnapshot` (L269-273)
   - `PromptWorkflowSnapshot` (L275-286)
   - `PromptProcessingTrace` (L299-361)
   - `PromptBundleMetadata` (L364-368)
   - `PromptBundle` (L370-378)
2. 在 `contracts/src/index.ts` 中添加 `export * from './ai_shared.js'`
3. 在 `inference/types.ts` 中：将原类型定义替换为 `export { PromptWorkflowMetadata, ... } from '@yidhras/contracts'`（或相对路径）再导出，保持向后兼容
4. 更新以下文件的 import（改为直接从 contracts 导入）：
   - `ai/types.ts:1` — `PromptBundleMetadata`
   - `ai/adapters/prompt_bundle_adapter.ts:1` — `PromptBundle`, `PromptWorkflowSnapshot`
   - `ai/task_prompt_builder.ts:5` — `PromptBundle`（`InferenceContext` 保留从 `inference/types.ts`）
5. 运行全量单元测试 + B1 集成测试，确认无回归

---

## B4 — 移动 gateway_backed.ts 到 ai/providers/  `pending`

**文件**：`apps/server/src/inference/providers/gateway_backed.ts` → `apps/server/src/ai/providers/gateway_backed.ts`

**步骤**：
1. 移动文件到 `apps/server/src/ai/providers/gateway_backed.ts`
2. 更新文件内部的 import 路径（`../../ai/task_service.js` → `../task_service.js`，`../../ai/task_prompt_builder.js` → `../task_prompt_builder.js`）
3. 更新引用方：`inference/service.ts:35` — import 路径改为 `../../ai/providers/gateway_backed.js`
4. 全局搜索 `inference/providers/gateway_backed` 确认无遗漏引用
5. 运行测试确认通过

---

## B5 — 消除 domain/inference/ 单文件目录  `pending`

**文件**：`apps/server/src/domain/inference/context_assembler.ts` → `apps/server/src/app/services/context_assembler.ts`

**步骤**：
1. 移动文件到 `apps/server/src/app/services/context_assembler.ts`
2. 更新文件内部的 import 路径（`../../app/context.js` → `../context.js`，`../../inference/context_builder.js` → `../../inference/context_builder.js`，`../authority/resolver.js` → `../../domain/authority/resolver.js`，`../perception/resolver.js` → `../../domain/perception/resolver.js`）
3. 更新引用方：`app/services/operator_contracts.ts:1` — import 路径改为 `./context_assembler.js`
4. 删除空目录 `domain/inference/`
5. 运行测试确认通过

---

## B6 — 更新文档  `pending`

**步骤**：
1. 更新 `docs/ARCH.md` §6.2：在 AI Gateway 边界说明中补充三层目录职责：
   - `ai/` — 新 AI 网关（gateway, task_service, route_resolver, observability, providers, adapters, schemas）
   - `inference/` — 旧推理流水线（context_builder, prompt builders, processors, tokenizers, types）
   - `packages/contracts/src/ai_shared.ts` — 两者共享的 prompt/bundle/metadata 类型契约
2. 更新 `docs/capabilities/AI_GATEWAY.md` §10：在相关文档中补充 contracts/ai_shared.ts 引用
3. 更新 `TODO.md`：
   - `[x]` 清理死代码 `ai_invocation_query.ts`
   - `[x]` 清理空目录 `ai/schemas/`
   - `[x]` 梳理三层 AI 目录边界
   - `[-]` 删除旧 `token_budget_trimmer` → 标注为「非死代码，仍被 context/workflow/runtime.ts 引用，含 @deprecated 指向 createTreeTokenBudgetTrimmer，后续迁移后删除」

---

## 执行顺序

```
B1 ──► B2 ──► B3 ──► B4 ──► B5 ──► B6
 │       │      │       │       │       │
 测试    修bug  搬类型   拆循环   消目录   文档
```

- B1 先于 B2 确保当前行为可验证
- B2 先于 B4 避免带着 bug 移动文件
- B3 先于 B4 确保共享类型就位后再移动文件
- B4、B5 顺序可交换

## 验证方式

每步完成后运行：
```bash
pnpm --filter server test:unit
pnpm --filter server test:integration
pnpm --filter contracts build
```
