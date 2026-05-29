# Scheduler 查询层破坏性重构计划

## 范围

- `apps/server/src/app/services/scheduler/` — queries.ts, helpers.ts, types.ts, writes.ts
- `apps/server/src/packs/storage/SchedulerStorageAdapter.ts` — adapter 接口
- `apps/server/src/packs/storage/internal/SqliteSchedulerStorageAdapter.ts` — SQLite 实现
- `apps/server/src/app/runtime/runtime_kernel_service.ts` — 移除 observation 代理
- `apps/server/src/app/runtime/runtime_kernel_ports.ts` — 移除 SchedulerObservationPort
- `apps/server/src/app/routes/scheduler.ts` — 路由直接调用 query 函数
- `apps/server/src/app/routes/agent.ts` — 同上

不保留向后兼容。所有调用方同步修改。所有测试同步更新。

---

## 一、问题诊断

### 1.1 类型黑洞：`Record<string, unknown>`

`SchedulerStorageAdapter.listRuns()` 和 `listCandidateDecisions()` 返回 `Record<string, unknown>[]`。queries.ts 通过 `as unknown as RawSchedulerRunRow` 强制转换。全文共 61 处 `@typescript-eslint/no-unsafe-type-assertion` 禁用注释。

根源：adapter 的 `where`/`orderBy` 参数也是 `Record<string, unknown>`，SQLite 实现用 `Object.entries(input.where).forEach` 动态拼接 SQL。类型安全在 adapter 边界彻底丢失。

### 1.2 三层类型体系

同一实体存在三套类型：

| 层 | 示例类型 | 时间戳类型 |
|---|---|---|
| Adapter 接口 | `SchedulerPartitionRecord` | `bigint` |
| queries Raw 行 | `RawSchedulerPartitionRow` | `number` |
| API Read Model | `SchedulerPartitionOwnershipReadModel` | `string` |

`types.ts` 594 行 ~40 个 interface。Raw 类型层是冗余的——它存在仅因为 adapter 返回 `Record<string, unknown>` 而非类型化记录。

### 1.3 内存过滤替代 SQL

每个 list 函数的模式：`adapter.listAll(packId) → JS 中 filter → JS 中 sort → JS 中 slice`。

`listSchedulerRuns` 从 SQLite 取 `limit + 1` 行，然后在 JS 中逐行检查 `worker_id`、`partition_id`、`from_tick`、`to_tick`、`cursor`。分页在过滤之后做，意味着一页数据可能从 SQLite 取了几百行才筛出 20 行。

原因：adapter 的 `where: Record<string, unknown>` 只能表达 `key = value` 等值条件，无法表达 `tick > fromTick AND tick < toTick` 范围查询。

### 1.4 packId 循环反模式

每个函数遍历 `getFilteredPackIds(context, packId)`。`listOpenPackIds()` 返回的 pack 集合取决于运行时哪些 pack 被 `open()` 过——一个 `Map<string, DatabaseSync>` 的 keys。如果某个 pack 的模拟未启动，它的调度数据静默缺席所有查询结果，调用方无法区分"无数据"和"未打开"。

### 1.5 RuntimeKernelService 代理

`runtime_kernel_service.ts` 包装了 4 个 query 函数，但路由层调用不一致——有些路由直接 import queries，有些通过 `createRuntimeKernelService`。该服务同时混入生命周期方法（start/stop）和所有权变更（reconcileBootstrapOwnership），违反单一职责。

### 1.6 writes.ts 空壳

91 行，3 个函数。`writeDetailedSnapshot` 完全委托给 adapter。`recordSchedulerRunSnapshot` 仅检查 packId 是否存在。`emitAggregatedMetrics` 是标注 `Phase 3 stub` 的空函数。无独立存在价值。

### 1.7 helpers.ts 杂物堆

623 行包含：常量定义、cursor 编解码、11 个 filter parser、5 个 read-model 转换器、2 个跨模块链接构建器（其中一个查 Prisma）、packId 辅助函数。没有内聚性。

---

## 二、目标架构

### 2.1 核心原则

1. **Adapter 返回类型化记录**——消除 `Record<string, unknown>`，消除 `Raw*` 类型层
2. **过滤下推到 SQL**——adapter 接受类型化 filter 参数，SQLite 实现生成完整 WHERE 子句
3. **packId 必传**——所有查询函数的 packId 参数改为 required；消除 `getFilteredPackIds` 循环
4. **两层类型**——Storage Record（adapter 返回，bigint 时间戳）→ Read Model（API 返回，string 时间戳）
5. **路由直接调用查询**——消除 RuntimeKernelService 的 observation 代理层
6. **按领域拆分文件**——每个查询领域一个文件，消除 helpers.ts 杂物堆

### 2.2 目标文件结构

```
apps/server/src/app/services/scheduler/
  types.ts                 — 仅保留 Read Model + Input/Output 类型（≤200 行）
  constants.ts             — SCHEDULER_KINDS, REASONS, SKIP_REASONS, 错误码
  cursor.ts                — encode/decode/parse cursor
  filter-parsers.ts        — 所有 parse* 函数
  read-models.ts           — 所有 to*ReadModel 转换器
  cross-links.ts           — buildRunCrossLinkSummary, buildSchedulerDecisionWorkflowLinks
  agent-queries.ts         — getAgentSchedulerProjection, listAgentSchedulerDecisions
  run-queries.ts           — getLatestRun, getRunById, listRuns
  decision-queries.ts      — listDecisions
  ownership-queries.ts     — listAssignments, listMigrations
  worker-queries.ts        — listWorkers
  rebalance-queries.ts     — listRecommendations
  summary-queries.ts       — getSummarySnapshot, getTrendsSnapshot, getOperatorProjection

  [删除] queries.ts        → 拆分为上述 7 个 query 文件
  [删除] helpers.ts        → 拆分为 constants.ts + cursor.ts + filter-parsers.ts + read-models.ts + cross-links.ts
  [删除] writes.ts         → 逻辑并入 adapter
```

### 2.3 Adapter 接口变更

**删除的方法：**
- `listRuns(packId, { where?, orderBy?, take?, cursor?, skip? }): Record<string, unknown>[]`
- `listCandidateDecisions(packId, { where?, orderBy?, take?, cursor?, skip? }): Record<string, unknown>[]`
- `getAgentDecisions(packId, actorId, limit?): Record<string, unknown>[]`

**新增的类型化方法：**

```ts
// ---- Observability: Runs ----
getRunById(packId: string, runId: string): SchedulerRunRecord | null

listRuns(packId: string, input: {
  tickFrom?: bigint;
  tickTo?: bigint;
  workerId?: string;
  partitionId?: string;
  cursorCreatedAt?: bigint;
  cursorId?: string;
  orderBy: 'created_at_desc' | 'created_at_asc' | 'tick_desc';
  take: number;
}): SchedulerRunRecord[]

// ---- Observability: Candidate Decisions ----
listDecisionsForRun(packId: string, runId: string): SchedulerCandidateDecisionRecord[]

listCandidateDecisions(packId: string, input: {
  actorId?: string;
  kind?: string;
  chosenReason?: string;
  skippedReason?: string;
  partitionId?: string;
  tickFrom?: bigint;
  tickTo?: bigint;
  cursorCreatedAt?: bigint;
  cursorId?: string;
  orderBy: 'created_at_desc' | 'created_at_asc';
  take: number;
}): SchedulerCandidateDecisionRecord[]

getAgentDecisions(packId: string, actorId: string, limit: number): SchedulerCandidateDecisionRecord[]

// ---- Observability: Write (从 writes.ts 迁移) ----
writeRunSnapshot(packId: string, input: {
  id: string;
  workerId: string;
  partitionId: string;
  leaseHolder: string | null;
  leaseExpiresAtSnapshot: bigint | null;
  tick: bigint;
  summary: Record<string, unknown>;
  startedAt: bigint;
  finishedAt: bigint;
}): SchedulerRunRecord

writeCandidateDecision(packId: string, schedulerRunId: string, input: {
  id: string;
  partitionId: string;
  actorId: string;
  kind: string;
  candidateReasons: unknown;
  chosenReason: string;
  scheduledForTick: bigint;
  priorityScore: number;
  skippedReason: string | null;
  createdJobId: string | null;
  createdAt: bigint;
}): SchedulerCandidateDecisionRecord
```

**新增的 Storage Record 类型（在 adapter 接口文件中定义）：**

```ts
interface SchedulerRunRecord {
  id: string;
  worker_id: string;
  partition_id: string;
  lease_holder: string | null;
  lease_expires_at_snapshot: bigint | null;
  tick: bigint;
  summary: string;        // JSON string, 调用方自行 parse
  started_at: bigint;
  finished_at: bigint;
  created_at: bigint;
}

interface SchedulerCandidateDecisionRecord {
  id: string;
  scheduler_run_id: string;
  partition_id: string;
  actor_id: string;
  kind: string;
  candidate_reasons: string;  // JSON string
  chosen_reason: string;
  scheduled_for_tick: bigint;
  priority_score: number;
  skipped_reason: string | null;
  created_job_id: string | null;
  created_at: bigint;
}
```

### 2.4 查询函数签名变更

**Before（所有函数）：**
```ts
export const listSchedulerRuns = (
  context: AppContext,
  input: ListSchedulerRunsInput
): ListSchedulerRunsResult => {
  const adapter = context.schedulerStorage;
  if (!adapter) return emptyResult;
  const packIds = getFilteredPackIds(context, filters.pack_id);
  for (const pid of packIds) { ... }
}
```

**After：**
```ts
export const listSchedulerRuns = (
  context: AppContext,
  packId: string,
  input: ListSchedulerRunsInput
): ListSchedulerRunsResult => {
  const adapter = context.schedulerStorage;
  if (!adapter) return emptyResult(filters);
  const runs = adapter.listRuns(packId, toRunQueryInput(filters));
  // 所有过滤已在 SQL 中完成，此处只做 read-model 转换
  return buildResult(runs, filters);
}
```

核心变化：
- `packId: string` 变为必传参数（不再从 input.pack_id 中提取）
- 消除 `getFilteredPackIds` 调用和 for 循环
- adapter 方法接受类型化查询输入
- 消除 JS 侧过滤

### 2.5 RuntimeKernelService 变更

**移除的方法：**
- `getSummary`
- `getOperatorProjection`
- `getOwnershipAssignments`
- `getWorkers`

**保留的方法：**
- `start` / `stop` / `isRunning`
- `getLoopDiagnostics` / `getHealthSnapshot`
- `reconcileBootstrapOwnership` / `getOwnershipSnapshot`

**变更后 `createRuntimeKernelService`：**
```ts
export const createRuntimeKernelService = (
  context: AppContext, 
  packId: string
): RuntimeKernelFacade & SchedulerControlPort => {
  return {
    start() { context.setPaused(false); },
    stop() { context.setPaused(true); },
    isRunning() { return !context.isPaused(); },
    getLoopDiagnostics() { ... },
    getHealthSnapshot() { ... },
    async reconcileBootstrapOwnership(input) { ... },
    async getOwnershipSnapshot(input) { ... },
  };
};
```

**删除 `runtime_kernel_ports.ts` 中的 `SchedulerObservationPort`。**

### 2.6 路由层变更

`scheduler.ts` 路由不再通过 `RuntimeKernelService` 代理，改为直接调用 query 函数：

```ts
// Before:
const runtimeKernel = createRuntimeKernelService(context, packId)
const summary = await runtimeKernel.getSummary?.({ sampleRuns: query.sample_runs })

// After:
const summary = await getSchedulerSummarySnapshot(context, packId, { sampleRuns: query.sample_runs })
```

---

## 三、分步执行计划

### Step 1：在 Adapter 接口中新增类型化 Record 和方法签名

**文件：** `SchedulerStorageAdapter.ts`

1. 新增 `SchedulerRunRecord` 和 `SchedulerCandidateDecisionRecord` interface
2. 新增类型化方法签名（`getRunById`、`listRuns`（新签名）、`listDecisionsForRun`、`listCandidateDecisions`（新签名）、`getAgentDecisions`（新签名）、`writeRunSnapshot`）
3. **保留**旧方法签名（`listRuns` 旧版、`listCandidateDecisions` 旧版、`writeDetailedSnapshot` 旧版）标记 `@deprecated`——Step 4 一并删除
4. 新增 `ListRunsInput` 和 `ListDecisionsInput` 类型

### Step 2：实现 SQLite adapter 新方法

**文件：** `SqliteSchedulerStorageAdapter.ts`

1. 实现 `getRunById`——`SELECT * FROM scheduler_run WHERE id = ?`
2. 实现新 `listRuns`——基于类型化 input 构建完整 WHERE + ORDER BY + LIMIT 的 SQL
3. 实现 `listDecisionsForRun`——`SELECT * FROM scheduler_candidate_decision WHERE scheduler_run_id = ? ORDER BY created_at ASC`
4. 实现新 `listCandidateDecisions`——基于类型化 input 构建完整 SQL
5. 实现新 `getAgentDecisions`——已有逻辑，改为返回 `SchedulerCandidateDecisionRecord[]`
6. 实现 `writeRunSnapshot`——已有 `writeDetailedSnapshot` 逻辑，使用新类型
7. 补全 row mapper（`toRunRecord`、`toCandidateDecisionRecord`）

关键：`listRuns` 的 SQL 构建必须支持范围查询和复合条件。不用 `Object.entries` 动态拼接，用显式的条件构建：

```ts
listRuns(packId: string, input: ListRunsInput): SchedulerRunRecord[] {
  const db = this.getDb(packId);
  const conditions: string[] = [];
  const params: SqlitePrimitive[] = [];

  if (input.tickFrom !== undefined) {
    conditions.push('tick >= ?');
    params.push(Number(input.tickFrom));
  }
  if (input.tickTo !== undefined) {
    conditions.push('tick <= ?');
    params.push(Number(input.tickTo));
  }
  if (input.workerId !== undefined) {
    conditions.push('worker_id = ?');
    params.push(input.workerId);
  }
  // ... cursor-based pagination
  if (input.cursorCreatedAt !== undefined && input.cursorId !== undefined) {
    conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
    params.push(Number(input.cursorCreatedAt), Number(input.cursorCreatedAt), input.cursorId);
  }
  // ... partition filter

  let sql = 'SELECT * FROM scheduler_run';
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  
  const orderMap = { created_at_desc: 'created_at DESC, id DESC', ... };
  sql += ' ORDER BY ' + orderMap[input.orderBy];
  sql += ' LIMIT ?';
  params.push(input.take);

  return db.prepare(sql).all(...params).map(row => this.toRunRecord(row));
}
```

### Step 3：重写 queries 层

按新文件结构逐个创建。每个 query 文件遵循统一模式：

```ts
// 以 run-queries.ts 为例
import type { AppContext } from '../../context.js';
import type { SchedulerRunRecord } from '../../../packs/storage/SchedulerStorageAdapter.js';
import { parseRunFilters } from './filter-parsers.js';
import { toRunReadModel } from './read-models.js';
import { encodeSchedulerCursor } from './cursor.js';
import type { ListSchedulerRunsInput, ListSchedulerRunsResult, SchedulerRunReadModel } from './types.js';

const emptyRunListResult = (filters: ReturnType<typeof parseRunFilters>): ListSchedulerRunsResult => ({
  items: [],
  page_info: { has_next_page: false, next_cursor: null },
  summary: { returned: 0, limit: filters.limit, filters: { ... } }
});

export const listSchedulerRuns = (
  context: AppContext,
  packId: string,
  input: ListSchedulerRunsInput
): ListSchedulerRunsResult => {
  const filters = parseRunFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) return emptyRunListResult(filters);

  const records = adapter.listRuns(packId, {
    tickFrom: filters.from_tick ?? undefined,
    tickTo: filters.to_tick ?? undefined,
    workerId: filters.worker_id ?? undefined,
    partitionId: filters.partition_id ?? undefined,
    cursorCreatedAt: filters.cursor ? BigInt(filters.cursor.created_at) : undefined,
    cursorId: filters.cursor?.id,
    orderBy: 'created_at_desc',
    take: filters.limit + 1,
  });

  const hasNextPage = records.length > filters.limit;
  const pageRecords = records.slice(0, filters.limit);
  const items = pageRecords.map(r => toRunReadModel(r));

  const nextCursor = hasNextPage && items.length > 0
    ? encodeSchedulerCursor({ created_at: items[items.length - 1].created_at, id: items[items.length - 1].id })
    : null;

  return {
    items,
    page_info: { has_next_page: hasNextPage, next_cursor: nextCursor },
    summary: { returned: items.length, limit: filters.limit, filters: { ... } }
  };
};
```

**关键变化：**
- `packId: string` 是第二个参数，必传
- 过滤在 adapter 层完成，query 函数只负责类型转换和分页包装
- `RawSchedulerRunRow` 不再存在——adapter 返回 `SchedulerRunRecord`
- `as unknown as` 类型断言全部消除

### Step 4：统一 to*ReadModel 转换器

**文件：** `read-models.ts`

所有转换器接受 adapter 返回的 Storage Record，输出 Read Model：

```ts
export const toRunReadModel = (record: SchedulerRunRecord): SchedulerRunReadModel['run'] => ({
  id: record.id,
  worker_id: record.worker_id,
  partition_id: record.partition_id,
  lease_holder: record.lease_holder,
  lease_expires_at_snapshot: record.lease_expires_at_snapshot?.toString() ?? null,
  tick: record.tick.toString(),
  summary: parseSummaryJson(record.summary),
  started_at: record.started_at.toString(),
  finished_at: record.finished_at.toString(),
  created_at: record.created_at.toString(),
  cross_link_summary: null  // 由调用方填充
});

export const toCandidateDecisionReadModel = (
  record: SchedulerCandidateDecisionRecord,
  workflowLink?: SchedulerDecisionWorkflowLink | null
): SchedulerCandidateDecisionReadModel => ({ ... });
```

输入类型是 adapter 的 `Scheduler*Record`，输出类型是 API 的 `Scheduler*ReadModel`。不再有中间 `Raw*` 类型。

### Step 5：重写 types.ts

从 594 行砍到 ≤200 行。只保留：

1. **Read Model 类型**（API 返回给前端的）
2. **Input 类型**（前端传过来的查询参数）
3. **Result 类型**（分页包装 + summary）
4. **Composite 类型**（SummarySnapshot、TrendsSnapshot、OperatorProjection）
5. **内部类型**（SchedulerListCursor、filter types）

删除所有 `Raw*` 类型（`RawSchedulerRunRow`、`RawSchedulerCandidateDecisionRow`、`RawSchedulerPartitionRow`、`RawSchedulerMigrationRow`）。

### Step 6：删除 adapter 旧方法，清理 SqliteSchedulerStorageAdapter

1. 删除旧 `listRuns`、`listCandidateDecisions`、`getAgentDecisions`、`writeDetailedSnapshot`、`writeCandidateDecision`（旧签名）
2. 删除对应的旧 row mapper 方法
3. 保留 Lease、Cursor、Partition、Migration、Worker、Rebalance 方法不变——它们已经是类型化的

### Step 7：更新 RuntimeKernelService 和 Ports

1. `runtime_kernel_ports.ts`——删除 `SchedulerObservationPort`
2. `runtime_kernel_service.ts`——删除 4 个 observation 方法，删除对 queries.ts 的 import；返回类型改为 `RuntimeKernelFacade & SchedulerControlPort`
3. `runtime_kernel_service.ts` 的 `createRuntimeKernelService` 不再需要 import queries

### Step 8：更新路由层

**`scheduler.ts`：**
- 删除 `createRuntimeKernelService` import
- 直接 import 需要的 query 函数
- `resolvePackIdFromRequest` 保持不变——`packId` 传给 query 函数作为必传参数
- summary/operator/ownership/workers 路由改为直接调用 query 函数

**`agent.ts`：**
- import 路径改为新的 query 文件

### Step 9：更新 snapshot writer 的调用方

当 `agent_scheduler.ts` 写快照时，原来调用 `writes.ts` 的 `recordSchedulerRunSnapshot`，改为直接调用 adapter 的新方法 `writeRunSnapshot` + `writeCandidateDecision`。

`writes.ts` 完全删除。

### Step 10：更新所有测试文件

需要更新的测试：
- `tests/integration/scheduler_queries_*.spec.ts`
- `tests/unit/scheduler_queries.spec.ts`
- 任何 mock `schedulerStorage` adapter 的测试

主要变化：
- mock adapter 需要实现新方法签名
- 测试调用需要传 `packId` 作为必传参数
- 不再需要 mock `Raw*` 类型的返回值

---

## 四、文件变更清单

### 新建文件（11 个）

| 文件 | 说明 |
|---|---|
| `services/scheduler/constants.ts` | SCHEDULER_KINDS/REASONS/SKIP_REASONS/错误码 |
| `services/scheduler/cursor.ts` | encode/decode/parse cursor |
| `services/scheduler/filter-parsers.ts` | 所有 parse* 函数 |
| `services/scheduler/read-models.ts` | to*ReadModel 转换器 + parseSummaryJson |
| `services/scheduler/cross-links.ts` | buildRunCrossLinkSummary + buildSchedulerDecisionWorkflowLinks |
| `services/scheduler/agent-queries.ts` | getAgentSchedulerProjection + listAgentSchedulerDecisions |
| `services/scheduler/run-queries.ts` | getLatestRun + getRunById + listRuns |
| `services/scheduler/decision-queries.ts` | listDecisions |
| `services/scheduler/ownership-queries.ts` | listAssignments + listMigrations |
| `services/scheduler/worker-queries.ts` | listWorkers |
| `services/scheduler/rebalance-queries.ts` | listRecommendations |
| `services/scheduler/summary-queries.ts` | getSummarySnapshot + getTrendsSnapshot + getOperatorProjection |

### 删除文件（3 个）

| 文件 | 说明 |
|---|---|
| `services/scheduler/queries.ts` | 拆分为 7 个 query 文件 |
| `services/scheduler/helpers.ts` | 拆分为 5 个工具文件 |
| `services/scheduler/writes.ts` | 逻辑并入 adapter |

### 修改文件（7 个）

| 文件 | 变更 |
|---|---|
| `services/scheduler/types.ts` | 删除所有 `Raw*` 类型，砍到 ≤200 行 |
| `packs/storage/SchedulerStorageAdapter.ts` | 新增 Record 类型 + 新方法签名；旧方法标记 deprecated 后删除 |
| `packs/storage/internal/SqliteSchedulerStorageAdapter.ts` | 实现新方法；删除旧方法 |
| `runtime/runtime_kernel_ports.ts` | 删除 SchedulerObservationPort |
| `runtime/runtime_kernel_service.ts` | 删除 observation 方法；删除 queries import |
| `routes/scheduler.ts` | 删除 RuntimeKernelService 代理；直接调用 query 函数 |
| `routes/agent.ts` | 更新 import 路径 |

### 受影响的调用方（非本模块，需同步更新）

| 文件 | 变更 |
|---|---|
| `runtime/agent_scheduler.ts` 或调用 writes.ts 的代码 | 改为直接调用 adapter.writeRunSnapshot |
| 所有 scheduler 测试文件 | 更新 mock adapter 签名 + 传 packId |

---

## 五、破坏性变更摘要

1. **所有 query 函数签名变更**——`packId` 从 `input.pack_id?` 变为必传的第二参数
2. **`ListSchedulerRunsInput.pack_id` 等字段删除**——`packId` 不再是 input 的一部分
3. **adapter 方法签名变更**——`listRuns`/`listCandidateDecisions`/`getAgentDecisions` 参数和返回类型完全改变
4. **`SchedulerStorageAdapter` 接口新增 7 个方法，删除 5 个旧方法**
5. **`RuntimeKernelService` 不再实现 `SchedulerObservationPort`**——调用方不能通过 kernel service 查询调度数据
6. **`writes.ts` 全部函数删除**——调用方改为直接使用 adapter
7. **所有 `Raw*` 类型删除**——`RawSchedulerRunRow` 等在代码库中不再存在
8. **`types.ts` 重新组织**——import 路径不变但导出的类型集合大幅缩减

---

## 六、不在本次重构范围内

以下模块虽然与 queries.ts 耦合，但本次不做结构性改变：

- **`agent_scheduler.ts`**（运行时引擎）——仅消费其类型，不做改动
- **`scheduler_ownership.ts`**——`listSchedulerWorkerRuntimeStates` 函数签名保持不变
- **`scheduler_rebalance.ts`**——`listRecentSchedulerRebalanceRecommendations` 函数签名保持不变
- **`inference_workflow.ts`** / **`InferenceWorkflowRepository`**——`findDecisionJobs` 保持不变
- **`runtime_config.ts`** / **`domains/scheduler.ts`**——配置结构不变
- **Adapter 的非 observability 方法**（Lease/Cursor/Partition/Migration/WorkerState/Rebalance）——这些已经是类型化的，保持不变
