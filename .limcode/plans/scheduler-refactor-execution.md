# Scheduler 查询层破坏性重构 — 执行清单

基于 `.limcode/design/scheduler-queries-destructive-refactor.md`

---

## Phase 1: Adapter 类型化

- [ ] **1.1** 在 `SchedulerStorageAdapter.ts` 中新增 `SchedulerRunRecord` 和 `SchedulerCandidateDecisionRecord` interface
- [ ] **1.2** 新增类型化方法签名：`getRunById`、新 `listRuns`、`listDecisionsForRun`、新 `listCandidateDecisions`、新 `getAgentDecisions`、`writeRunSnapshot`；旧方法标记 `@deprecated`
- [ ] **1.3** 新增 `ListRunsInput` 和 `ListDecisionsInput` 类型
- [ ] **1.4** 在 `SqliteSchedulerStorageAdapter.ts` 中实现所有新方法（含 row mapper）；保留旧方法
- [ ] **1.5** Typecheck 验证 adapter 层无错误

## Phase 2: 新建 scheduler 工具模块

- [ ] **2.1** 创建 `constants.ts` — 从 helpers.ts 迁移 SCHEDULER_KINDS/REASONS/SKIP_REASONS/SCHEDULER_QUERY_INVALID
- [ ] **2.2** 创建 `cursor.ts` — 从 helpers.ts 迁移 encode/decode/parse cursor
- [ ] **2.3** 创建 `filter-parsers.ts` — 从 helpers.ts 迁移所有 parse* 函数
- [ ] **2.4** 创建 `read-models.ts` — 从 helpers.ts 迁移所有 to*ReadModel 转换器 + parseSummaryJson + buildSchedulerOwnershipSummary
- [ ] **2.5** 创建 `cross-links.ts` — 从 helpers.ts 迁移 buildRunCrossLinkSummary + buildSchedulerDecisionWorkflowLinks
- [ ] **2.6** Typecheck 验证工具模块无错误

## Phase 3: 重写 types.ts

- [ ] **3.1** 删除所有 `Raw*` 类型（RawSchedulerRunRow, RawSchedulerCandidateDecisionRow, RawSchedulerPartitionRow, RawSchedulerMigrationRow）
- [ ] **3.2** 保留 Read Model、Input、Result、Composite、Filter 类型
- [ ] **3.3** 确保所有类型引用新的 adapter Record 类型（而非 Raw* 类型）
- [ ] **3.4** Typecheck 验证

## Phase 4: 重写 query 文件

- [ ] **4.1** 创建 `agent-queries.ts`
- [ ] **4.2** 创建 `run-queries.ts`
- [ ] **4.3** 创建 `decision-queries.ts`
- [ ] **4.4** 创建 `ownership-queries.ts`
- [ ] **4.5** 创建 `worker-queries.ts`
- [ ] **4.6** 创建 `rebalance-queries.ts`
- [ ] **4.7** 创建 `summary-queries.ts`
- [ ] **4.8** Typecheck 验证

## Phase 5: 更新 RuntimeKernelService + Ports

- [ ] **5.1** 从 `runtime_kernel_ports.ts` 删除 `SchedulerObservationPort`
- [ ] **5.2** 重写 `runtime_kernel_service.ts`：删除 observation 方法，删除 queries import
- [ ] **5.3** Typecheck 验证

## Phase 6: 更新路由层

- [ ] **6.1** 更新 `routes/scheduler.ts`：直接 import query 函数，删除 RuntimeKernelService 代理
- [ ] **6.2** 更新 `routes/agent.ts`：更新 import 路径
- [ ] **6.3** Typecheck 验证

## Phase 7: 更新 writes 调用方 + 清理

- [ ] **7.1** 找到所有调用 writes.ts 的代码，改为直接调用 adapter 新方法
- [ ] **7.2** 删除 `helpers.ts`、`queries.ts`、`writes.ts`
- [ ] **7.3** 删除 adapter 旧方法（deprecated 标记的）
- [ ] **7.4** 全局搜索残留的旧 import 路径，全部更新
- [ ] **7.5** Typecheck 验证全项目无错误

## Phase 8: 测试更新 + 验证

- [ ] **8.1** 更新所有 scheduler 测试文件的 mock adapter + import 路径
- [ ] **8.2** 运行 `pnpm typecheck`
- [ ] **8.3** 运行 `pnpm test:unit`
- [ ] **8.4** 运行 `pnpm --filter yidhras-server test:integration`
- [ ] **8.5** 运行 `pnpm lint`
