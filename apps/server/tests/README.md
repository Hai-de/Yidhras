# Server 测试重构工作区

本目录承接 `apps/server/src/e2e/*.ts` 向 Vitest 的渐进迁移。

## 规范入口

- `pnpm --filter yidhras-server test`
- `pnpm --filter yidhras-server test:unit`
- `pnpm --filter yidhras-server test:integration`
- `pnpm --filter yidhras-server test:e2e`
- `pnpm --filter yidhras-server test:watch`

## 目录约定

```text
tests/
  helpers/      # 轻量工具与共享断言/进程封装
  fixtures/     # 测试上下文、资源装配
  unit/         # 纯逻辑与快速反馈层
  integration/  # Prisma / service / runtime 模块集成
  e2e/          # 真实服务进程与关键 HTTP 链路
```

## 并发与隔离策略（当前版）

- `unit`：允许默认并行。
- `integration`：当前先串行执行（`fileParallelism: false`）。
- `e2e`：当前先串行执行（`fileParallelism: false`）。
- server `e2e` 现在优先使用 `tests/helpers/runtime.ts` 提供的隔离环境：
  - 为每个测试会话创建临时数据库文件
  - 通过 `DATABASE_URL` 注入 Prisma/服务端
  - 禁用 `DEV_RUNTIME_RESET_ON_START`，避免共享全局库被误清理
  - 在独立环境中运行 `prepare:runtime`
- `integration` 目前仍以进程内 Prisma 为主，先串行；等临时数据库夹具进一步普及后再评估提升并发。
- 在独立临时数据库与独立 runtime 目录完全普及前，不要把 server 的 integration / e2e 提升为并行默认值。

## 已迁移模板

### integration

- `tests/integration/action-intent-locking.spec.ts`
- `tests/integration/scheduler-lease.spec.ts`
- `tests/integration/workflow-locking.spec.ts`
- `tests/integration/relational-graph-core.spec.ts`
- `tests/integration/inference-workflow-core.spec.ts`
- `tests/integration/scheduler-failover.spec.ts`
- `tests/integration/scheduler-ownership-migration.spec.ts`
- `tests/integration/scheduler-rebalance-handoff.spec.ts`
- `tests/integration/scheduler-rebalance-recommendation.spec.ts`
- `tests/integration/scheduler-rebalance-suppression.spec.ts`
- `tests/integration/scheduler-worker-runtime-state.spec.ts`
- `tests/integration/scheduler-automatic-rebalance-apply.spec.ts`
- `tests/integration/scheduler-automatic-rebalance-failover-compatibility.spec.ts`
- `tests/integration/scheduler-migration-failover-compatibility.spec.ts`
- `tests/integration/scheduler-multi-worker-partitioning.spec.ts`
- `tests/integration/scheduler-operator-projection.spec.ts`
- `tests/integration/scheduler-run-level-aggregation.spec.ts`
- `tests/integration/scheduler-crosslink-projection.spec.ts`
- `tests/integration/agent-scheduler-projection.spec.ts`
- `tests/integration/agent-scheduler.spec.ts`

### e2e

- `tests/e2e/scheduler-runtime-status.spec.ts`
- `tests/e2e/scheduler-loop-serialization.spec.ts`
- `tests/e2e/smoke-startup.spec.ts`
- `tests/e2e/scheduler-queries.spec.ts`
- `tests/e2e/smoke-endpoints.spec.ts`
- `tests/e2e/overview-summary.spec.ts`
- `tests/e2e/agent-overview.spec.ts`
- `tests/e2e/graph-view.spec.ts`
- `tests/e2e/relational-endpoints.spec.ts`
- `tests/e2e/adjust-relationship.spec.ts`
- `tests/e2e/adjust-snr.spec.ts`
- `tests/e2e/trigger-event.spec.ts`
- `tests/e2e/audit-feed.spec.ts`
- `tests/e2e/workflow-retry-semantics.spec.ts`
- `tests/e2e/workflow-replay.spec.ts`
- `tests/e2e/audit-workflow-lineage.spec.ts`
- `tests/e2e/workflow-replay-scheduler-suppression.spec.ts`
- `tests/e2e/social-feed-filters.spec.ts`
- `tests/e2e/policy-contracts.spec.ts`

这些文件作为第一批模板，目标是先把：

- 手写 `main()` + `process.exitCode`
- 手写 `try/catch`
- 重复的服务启动/停止逻辑

收敛到 Vitest 的 `describe / it / beforeAll / afterAll` 结构中。

## 当前 `src/e2e` 剩余资产

当前 `apps/server/src/e2e/` 已不再保留业务测试脚本；已迁移场景已进入 `apps/server/tests/**`，演示型场景已改造到 `apps/server/scripts/manual/**`。

### 支撑文件（不作为独立迁移目标）

- `config.ts`
- `helpers.ts`
- `status_helpers.ts`

## Legacy 说明

`apps/server/package.json` 中已不再保留 legacy `test:*` 单文件脚本入口。

原 `world_pack_scenario_demo` 已降级为 `manual:world-pack-scenario-demo`，作为演示/验收入口而不是主线自动化测试。

### 已移除的 legacy 脚本入口

以下场景已经由 Vitest 正式接管，因此对应的单文件 `test:*` 脚本已移除：

- `test:action-intent-locking`
- `test:scheduler-lease`
- `test:scheduler-runtime-status`
- `test:scheduler-loop-serialization`
- `test:scheduler-queries`
- `test:overview-summary`
- `test:agent-overview`
- `test:graph-view`
- `test:adjust-relationship`
- `test:adjust-snr`
- `test:trigger-event`
- `test:audit-feed`
- `test:workflow-retry-semantics`
- `test:workflow-replay`
- `test:audit-workflow-lineage`
- `test:workflow-replay-scheduler-suppression`
- `test:social-feed-filters`
- `test:workflow-locking`
- `test:relational-graph-core`
- `test:inference-workflow-core`
- `test:scheduler-failover`
- `test:scheduler-ownership-migration`
- `test:scheduler-rebalance-handoff`
- `test:scheduler-rebalance-recommendation`
- `test:scheduler-rebalance-suppression`
- `test:scheduler-worker-runtime-state`
- `test:scheduler-automatic-rebalance-apply`
- `test:scheduler-automatic-rebalance-failover-compatibility`
- `test:scheduler-migration-failover-compatibility`
- `test:scheduler-multi-worker-partitioning`
- `test:scheduler-operator-projection`
- `test:scheduler-run-level-aggregation`
- `test:scheduler-crosslink-projection`
- `test:agent-scheduler-projection`
- `test:agent-scheduler`
- `test:world-pack-scenario-demo`
- `smoke:startup`
- `smoke:endpoints`

当前 canonical smoke 入口：

- `smoke`

当前 manual/demo 入口示例：

- `manual:world-pack-scenario-demo`
