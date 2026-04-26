# AI 三层目录边界渐进重构设计

## 概述

解决 `domain/inference/`（1文件）、`inference/`（~30文件）、`ai/`（~12文件）三层 AI 目录之间的循环依赖、边界模糊和单文件目录问题。采用**先 B 后 C** 渐进策略：先拆循环 + 搬类型 + 补测试，再深度重构。

## 前置审计发现总结

### 依赖关系现状

```
ai/ ───────────────────► inference/
  (types.ts, adapters/,        (gateway_backed.ts,
   task_service.ts)               service.ts)
        import types                import services
         ◄───────────────────
```

**循环依赖**：
- `ai/` → `inference/`（types.ts, adapters/, task_service.ts 均引用 inference types）
- `inference/` → `ai/`（gateway_backed.ts 引用 ai/task_service.js, ai/task_prompt_builder.js）

### Composition Root

`inference/service.ts` 的 `createInferenceService()` 是唯一组装根：
- L455：创建 `aiTaskService = createAiTaskService({ context })`
- L460：注入 `createGatewayBackedInferenceProvider({ aiTaskService })`

`gateway_backed.ts` 存在 fallback bug（L24）：`createAiTaskService()` 无 context，Prisma/时钟均失效。

### 序列化边界

- `PromptBundleMetadata`（及嵌套 `PromptProcessingTrace`、`PromptWorkflowMetadata`、`PromptBundle`）在 `inference/service.ts` 中通过 `toJsonSafe()` 参与 API 响应序列化
- 最终持久化到 Prisma `InferenceTraceRecord.prompt_bundle` JSON 列
- 无 Zod schema、无 Redis、无 DB Entity 直接映射
- `InferenceContextV2` 不直接序列化，但其 `base` 字段（`InferenceContext`）被序列化

### 动态导入

全项目零动态导入，所有依赖均为静态 ES module import。

### 测试覆盖

整条链路 `gateway_backed → ai/task_service → inference/context_builder → domain/inference/context_assembler` 的测试覆盖为零。

### 其他发现

- `token_budget_trimmer.ts` 不是死代码，当前仍被 `context/workflow/runtime.ts` 活跃引用（4处），内部有 `@deprecated` 标记指向 `createTreeTokenBudgetTrimmer`

---

## Phase B：拆循环 + 搬类型 + 补测试（本次）

### B1 — 编写集成测试（1-2 个）

**目标**：覆盖 `gateway_backed → ai/task_service` 链路，验证 model_routed 策略可成功返回结果。

**关键约束**：测试必须**显式传入 `aiTaskService`**，不能依赖 `gateway_backed.ts` 的 fallback 默认值（其 `createAiTaskService()` 无 context）。

**测试文件**：`apps/server/tests/integration/gateway_backed_inference.spec.ts`

**测试用例**：
1. `it('executes model_routed inference through gateway_backed provider and returns completed result')` — 验证链路能跑通并返回 `status: 'completed'`
2. `it('falls back to FALLBACK_DECISION when ai task service throws')` — 验证异常路径降级行为

**依赖组装**：参考 `tests/fixtures/isolated-db.ts` + `tests/fixtures/app-context.ts` 的 AppContext 构造模式。

### B2 — 修复 gateway_backed.ts fallback bug

**文件**：`apps/server/src/inference/providers/gateway_backed.ts`

**问题**：L24 的默认参数 `createAiTaskService()` 无 context，导致：
- Prisma 写入（`recordAiInvocation`）静默跳过（`if (context)` 守卫）
- 模拟时钟不可用

**修复**：移除默认值，使 `aiTaskService` 成为必传参数，或移除此 fallback 逻辑。由于组装根 `inference/service.ts:460` 已显式传入，此改动零影响。

### B3 — 提取共享类型到 contracts 包

**目标文件**：`packages/contracts/src/ai_shared.ts`

**搬移内容**（原封不动，保持结构）：
- `PromptWorkflowMetadata` (inference/types.ts:288-297)
- `PromptWorkflowStepTraceSnapshot` (inference/types.ts:260-267)
- `PromptWorkflowPlacementSummarySnapshot` (inference/types.ts:269-273)
- `PromptWorkflowSnapshot` (inference/types.ts:275-286)
- `PromptProcessingTrace` (inference/types.ts:299-361) — 含嵌套 `token_budget_trimming`、`policy_filtering`、`summary_compaction` 子结构
- `PromptBundleMetadata` (inference/types.ts:364-368)
- `PromptBundle` (inference/types.ts:370-378)

**不搬移**：`InferenceContext`、`InferenceContextV2`、其他 inference 专用类型。

**原位置处理**：`inference/types.ts` 中改为 `export { ... } from 'contracts/ai_shared.js'` 再导出，保持向后兼容。

**更新 import 的三处引用**：
- `ai/types.ts:1` — `PromptBundleMetadata`
- `ai/adapters/prompt_bundle_adapter.ts:1` — `PromptBundle`, `PromptWorkflowSnapshot`
- `ai/task_prompt_builder.ts:5` — `InferenceContext`, `PromptBundle`（后者改为从 contracts 导入）

### B4 — 移动 gateway_backed.ts 到 ai/providers/

**文件**：`apps/server/src/inference/providers/gateway_backed.ts` → `apps/server/src/ai/providers/gateway_backed.ts`

**理由**：`gateway_backed.ts` 的依赖方向是 `ai/` ←（它 import `ai/task_service.js`、`ai/task_prompt_builder.js`），物理位置应与依赖方向一致。移到 `ai/providers/` 后消除了 `inference/ → ai/` 的反向物理依赖。

**更新引用**：
- `inference/service.ts:35` — import 路径从 `./providers/gateway_backed.js` 改为 `../../ai/providers/gateway_backed.js`

**效果**：循环依赖从物理层面被打破。`ai/` 仍然通过 type import 依赖 `inference/` 的共享类型（B3 已提取到 contracts），但不再是循环。

### B5 — 消除 domain/inference/ 单文件目录

**文件**：`apps/server/src/domain/inference/context_assembler.ts` → `apps/server/src/app/services/context_assembler.ts`

**理由**：该文件的唯一消费者是 `app/services/operator_contracts.ts`。将它与消费者放在同一目录下，减少 import 路径跨度。

**更新引用**：
- `app/services/operator_contracts.ts:1` — import 路径改为 `./context_assembler.js`

**后续**：`domain/inference/` 目录变为空，删除之。

### B6 — 更新文档

- `docs/ARCH.md` §6.2：补充 AI 网关的三层目录边界说明（ai/、inference/、contracts/ai_shared.ts）
- `docs/capabilities/AI_GATEWAY.md` §10：补充 `packages/contracts/src/ai_shared.ts` 作为共享类型契约
- `TODO.md`：更新相关条目状态

---

## Phase C：深度重构（后续）

### C1 — ai/adapters/ 去 inference 依赖

当前 `ai/adapters/prompt_bundle_adapter.ts` 和 `ai/adapters/prompt_tree_adapter.ts` 仍引用 `inference/types.js`。B3 已将 `PromptBundle` 等类型提取到 contracts，但 adapter 文件可能还引用了其他 inference 类型（如 `InferenceContext` 的部分字段）。需逐个审查并替换。

### C2 — 类型层级整理

`PromptBundleMetadata → PromptProcessingTrace → token_budget_trimming` 的深度嵌套结构在序列化和日志记录时产生冗余。评估是否需要扁平化或分层拆分。

### C3 — Composition Root 正式化

考虑在 `app/composition/` 或类似位置建立正式的组装根，将 `createInferenceService()` 中的 DI 逻辑（providers 组合、aiTaskService 创建与注入）收口到一处，替代当前散落在 `inference/service.ts`、`gateway_backed.ts` 的隐式默认值。

---

## 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 共享类型位置 | `packages/contracts/src/ai_shared.ts` | 与现有 contracts 包统一，跨包可见，最大解耦 |
| context_assembler 去向 | `app/services/` | 唯一消费者在同目录，最小跨度 |
| gateway_backed 去向 | `ai/providers/` | 依赖方向与物理位置一致化 |
| gateway_backed fallback bug | B2 立即修复 | 一行改动，零影响 |

## 风险

- **测试先行**：B1 在重构前执行，确保当前链路行为可验证。后续每一步重构后重新跑测试确认无回归。
- **API 序列化兼容**：B3 搬移类型时保持结构不变，`toJsonSafe()` 序列化结果不受影响。Prisma JSON 列无 schema 校验，不会导致写入失败。
- **Import 路径更新**：B4-B5 涉及跨目录移动文件，需全局搜索 import 引用确保无遗漏。

## 未包含

- `token_budget_trimmer` 删除（非本设计范围，当前不是死代码）
- Streaming/SSE、熔断器/速率限制（全局问题，另开分析）
- Tool calling 入口开启（P2 独立讨论）
- `model_routed` 公共 contract 补全（P3，依赖设计意图确认）
