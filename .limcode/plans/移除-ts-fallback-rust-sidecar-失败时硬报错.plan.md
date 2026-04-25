## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] Phase 1: 修改 scheduler_decision_kernel_provider.ts — 删除 fallback，catch 改为 throw  `#P1-1`
- [x] Phase 1: 修改 scheduler_decision_kernel_port.ts — 删除 SchedulerDecisionKernelObservability  `#P1-2`
- [x] Phase 1: 修改 agent_scheduler.ts — 删除 attachKernelMetadataToSummary  `#P1-3`
- [x] Phase 1: 删除 scheduler_decision_kernel.ts + 2 个测试文件  `#P1-4`
- [x] Phase 2: 修改 memory/blocks/provider.ts — 删除 evaluateWithTs，catch 改为 throw  `#P2-1`
- [x] Phase 2: 修改 memory/blocks/types.ts — 简化 MemoryTriggerEngineEvaluationMetadata  `#P2-2`
- [x] Phase 2: 修改 context/source_registry.ts + context/sources/memory_blocks.ts  `#P2-3`
- [x] Phase 2: 删除 trigger_engine.ts + 3 个孤儿依赖 + 2 个测试文件  `#P2-4`
- [x] Phase 3: 修改 templates/configw/default.yaml — mode: ts → rust_primary  `#P3-1`
- [x] Phase 4: typecheck + unit + integration + e2e 全量验证  `#P4-1`
<!-- LIMCODE_TODO_LIST_END -->

# 移除 TS fallback — Rust sidecar 失败时硬报错

## 目标

删除 scheduler decision kernel 和 memory trigger engine 两个模块中的 TS fallback 路径。
Rust sidecar 调用失败时，包装原始错误直接抛出（`throw new Error('Rust sidecar failed: ...')`），不再静默降级到 TS 实现。

## 影响范围总览

| 类别 | 数量 | 说明 |
|------|------|------|
| 删除源文件 | 5 | scheduler_decision_kernel.ts + trigger_engine.ts + 3 个孤儿依赖 |
| 删除测试文件 | 4 | 覆盖 fallback/TS 实现的测试 |
| 修改源文件 | 7 | Provider、类型、消费者 |
| 修改配置文件 | 1 | 默认模板 default.yaml |

---

## Phase 1: Scheduler 模块

### 1.1 修改 `scheduler_decision_kernel_provider.ts`

- 删除 `import { createTsSchedulerDecisionKernel } from './scheduler_decision_kernel.js'`
- 删除 `private readonly fallbackKernel = createTsSchedulerDecisionKernel()`
- 删除 `TS_FALLBACK_DEPRECATION_WARNING` 常量
- catch 块改为 `throw new Error(...)` 包装原始错误
- 简化 `SchedulerDecisionKernelEvaluationMetadata`：只保留 `provider: 'rust_primary'`

### 1.2 修改 `scheduler_decision_kernel_port.ts`

- 删除 `SchedulerDecisionKernelObservability` 接口
- `AgentSchedulerRunResult` 不再 extends `SchedulerDecisionKernelObservability`

### 1.3 修改 `agent_scheduler.ts`

- 删除 `SchedulerDecisionKernelEvaluationMetadata` 类型导入
- 删除 `attachKernelMetadataToSummary` 函数及其调用

### 1.4 删除源文件

- `apps/server/src/app/runtime/scheduler_decision_kernel.ts`

### 1.5 删除测试文件

- `apps/server/tests/unit/runtime/scheduler_decision_kernel.spec.ts`
- `apps/server/tests/integration/scheduler-decision-sidecar-failure-fallback.spec.ts`

---

## Phase 2: Memory Trigger 模块

### 2.1 修改 `memory/blocks/provider.ts`

- 删除 `evaluateMemoryBlockActivation` 和 `applyMemoryActivationToRuntimeState` 导入
- 删除 `evaluateWithTs` 函数（约 70 行）和 `TS_FALLBACK_DEPRECATION_WARNING`
- catch 块改为 `throw new Error(...)` 包装原始错误

### 2.2 修改 `memory/blocks/types.ts`

- `MemoryTriggerEngineEvaluationMetadata`：删除 `fallback`、`fallback_reason`、`parity_status`、`parity_diff_count`
- `provider` 固定为 `'rust_primary'`

### 2.3 修改 `context/source_registry.ts`

- `engine_owner` 固定为 `'rust_sidecar'`
- `engine_mode` 固定为 `'rust_primary'`

### 2.4 修改 `context/sources/memory_blocks.ts`

- 更新 `evaluation_metadata` 类型引用（简化的接口）

### 2.5 删除源文件（4 个）

- `apps/server/src/memory/blocks/trigger_engine.ts`
- `apps/server/src/memory/blocks/logic_dsl.ts`（孤儿 — 仅被 trigger_engine.ts 引用）
- `apps/server/src/memory/blocks/trigger_rate_gate.ts`（孤儿 — 仅被 trigger_engine.ts 引用）
- `apps/server/src/memory/blocks/runtime_state.ts`（孤儿 — 仅被 trigger_engine.ts 引用）

> 注：Rust 侧有独立的 `logic_dsl` / `sampling` 实现，不受影响。

### 2.6 删除测试文件

- `apps/server/tests/unit/memory_block_trigger_engine.spec.ts`
- `apps/server/tests/unit/memory_trigger_engine_provider.spec.ts`

---

## Phase 3: 配置清理

### 3.1 修改 `templates/configw/default.yaml`

- L78-79：`decision_kernel.mode: "ts"` → `"rust_primary"`

---

## Phase 4: 验证

- [ ] `pnpm typecheck` 无新增错误
- [ ] `pnpm test:unit` 全部通过（删除 3 个旧测试后，预计约 186 个测试）
- [ ] `pnpm test:integration` 全部通过（删除 1 个 fallback 测试后）
- [ ] `pnpm test:e2e` 全部通过

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Rust sidecar 崩溃导致调度/触发器不可用 | 这是明确的设计意图 — 静默降级掩盖真实故障。通过 sidecar `auto_restart: true` + 监控告警保证可用性 |
| `runtime_state.ts` 删除是否影响 `store.ts` | 已验证：`store.ts` 使用的 `MemoryRuntimeState` 类型定义在 `types.ts`，`runtime_state.ts` 仅导出 `createInitialMemoryRuntimeState`，无其他引用 |
| `logic_dsl.ts` 是否被其他模块使用 | 已验证：TS 侧仅有 `trigger_engine.ts` 引用（+ 其测试），Rust 侧独立实现不受影响 |
