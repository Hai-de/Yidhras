## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 列出需要同步更新的 API/README/TODO 文档点  `#plan-d1-docs`
- [ ] 设计 job runner 与 inference service 的 workerId / claim 执行改造  `#plan-d1-runner`
- [ ] 为 DecisionJob 设计轻量锁字段与最小迁移方案  `#plan-d1-schema`
- [ ] 设计 inference_workflow.ts 中的 claim/lock/release 服务接口与状态流转  `#plan-d1-service`
<!-- LIMCODE_TODO_LIST_END -->

# Workflow D 强化第一批实现方案（DecisionJob Locking + Claim）

## 1. 背景与目标

当前 Workflow D 已具备最小可运行基线：

- `DecisionJob / InferenceTrace / ActionIntent` 持久化链路已落地。
- `POST /api/inference/jobs` 已作为正式入队入口。
- runtime loop 已能消费 `pending/running` job。
- `retry`、`workflow snapshot`、`stored-trace replay` 基线已存在。

但当前实现仍明显依赖单进程、无锁扫描与弱调度语义：

- `listRunnableDecisionJobs()` 通过 `findMany` 扫描 `pending/running` 任务。
- `executeDecisionJob()` 将 `running` 当作“正在执行”的描述状态，但不具备 worker 独占 claim 语义。
- 没有 `locked_by / lock_expires_at` 等最小锁字段，无法支持多 worker 场景。
- 服务异常退出时，`running` 任务的 orphan recovery 语义不明确。

因此第一批强化目标应聚焦于 **DecisionJob 轻量锁与 claim 机制**，在尽量少破坏现有业务模型的前提下，让 Workflow D 从“单 loop 可跑”升级为“可安全调度的正式工作流基线”。

---

## 2. 本批次范围（D1）

### 2.1 目标范围

本批次只做以下内容：

1. 为 `DecisionJob` 增加轻量锁字段。
2. 引入 `claim runnable jobs` 语义，替代现有纯扫描后直接执行模式。
3. 为 `job_runner.ts` 增加 `workerId` 概念。
4. 为 `executeDecisionJob()` 增加持锁校验与释放逻辑。
5. 增补文档，使 Workflow D 当前状态与实现一致。

### 2.2 明确不在本批次范围内

以下能力暂不纳入本批次，以避免方案膨胀：

- 正式的 replay/orchestration API（例如 `/replay`）
- `WorkflowReplay` 新模型
- `ActionIntent` 锁机制
- heartbeat / lease renewal
- 多级 backoff / scheduler policy
- 更复杂的 worker registry / leader election

这些内容应在本批次完成并稳定后进入下一阶段（D2/D3）。

---

## 3. 设计原则

### 3.1 不扩大状态机，先叠加锁语义

`DecisionJob.status` 暂时保持不变：

- `pending`
- `running`
- `completed`
- `failed`

锁语义不通过新增 `claimed` / `leased` 等状态表达，而是通过附加字段描述。这样可以：

- 减少 HTTP / snapshot / workflow derived 逻辑改动范围。
- 保持现有 `decision_stage` 推导逻辑基本稳定。
- 降低对现有 `retry` / `workflow_snapshot` / trace sink 的侵入。

### 3.2 以“最小足够安全”为目标

由于当前使用 SQLite，不追求复杂数据库级调度能力，而是构建一个：

- 单机多进程可用
- 多 worker 重复执行概率显著降低
- orphan job 可恢复

的轻量锁方案。

### 3.3 claim 优先于 execute

runner 不应再通过“先列出任务，再直接执行”驱动工作流，而应明确区分：

1. 发现 claimable job
2. 尝试 claim（带条件更新）
3. claim 成功后再执行
4. 完成或失败后释放锁

---

## 4. 数据模型改造

## 4.1 Prisma Schema 改动

目标文件：`apps/server/prisma/schema.prisma`

在 `DecisionJob` 中新增以下字段：

```prisma
locked_by       String?
locked_at       BigInt?
lock_expires_at BigInt?
```

### 字段语义

- `locked_by`
  - 当前持有任务执行权的 worker 标识。
  - 未锁定时为 `null`。

- `locked_at`
  - 本次锁建立的 tick。
  - 用于审计与排查。

- `lock_expires_at`
  - 锁过期 tick。
  - 若服务崩溃、worker 失联，其他 worker 可在过期后重新 claim。

### 索引建议

现有：

```prisma
@@index([status, created_at])
```

建议新增：

```prisma
@@index([status, lock_expires_at])
```

如需保守，可暂时不加额外索引；但随着 job 数量增长，`status + lock_expires_at` 会成为 claim 路径的重要筛选条件。

---

## 4.2 数据迁移策略

新增 Prisma migration，命名建议：

- `20260328xxxxxx_decision_job_lock_fields`

迁移 SQL 需满足：

- 新字段允许 `NULL`
- 不破坏已有数据
- 已存在 `running` 记录默认视为“无锁运行中的历史遗留记录”，下次扫描时可按 lock 为空规则重新 claim

---

## 5. 服务层改造

目标文件：`apps/server/src/app/services/inference_workflow.ts`

---

## 5.1 扩展 `DecisionJobRecord`

在 `DecisionJobRecord` 接口中增加：

```ts
locked_by: string | null;
locked_at: bigint | null;
lock_expires_at: bigint | null;
```

并在需要对外输出时，评估是否在 workflow snapshot 中暴露。

### 本批次建议

- `GET /api/inference/jobs/:id` 暂不强制暴露锁字段（可选）。
- `workflow_snapshot.records.job` 可视情况增加只读观测字段：
  - `locked_by`
  - `locked_at`
  - `lock_expires_at`

若本批次希望降低 API 破坏面，也可先只在服务层内部使用，不立即纳入公开 API 文档。

---

## 5.2 新增常量与配置

建议在 `inference_workflow.ts` 中引入：

```ts
export const DEFAULT_DECISION_JOB_LOCK_TICKS = 5n;
```

作为最小 lease duration。

说明：

- 单位与现有 workflow 调度时间统一，使用 simulation tick。
- 后续若需要，可再外提到配置层。

---

## 5.3 claimable 判断规则

新增 claim 语义时，job 应满足：

1. `status in ('pending', 'running')`
2. `next_retry_at is null OR next_retry_at <= now`
3. 并且满足以下任一：
   - `locked_by is null`
   - `lock_expires_at is null`
   - `lock_expires_at <= now`
   - `locked_by == currentWorker`（便于同 worker 恢复执行）

其中第 4 条可选；如果希望严格，首批可只允许：

- 未锁
- 已过期

---

## 5.4 新增服务函数

建议新增以下函数：

### `listClaimableDecisionJobs(...)`

用途：列出候选任务，不保证已 claim。

建议签名：

```ts
export const listClaimableDecisionJobs = async (
  context: AppContext,
  options: {
    now?: bigint;
    limit?: number;
  }
): Promise<DecisionJobRecord[]>
```

逻辑：

- 基于 `status + next_retry_at + lock_expires_at` 查询候选。
- 排序建议仍用：
  - `updated_at asc`
  - 或 `created_at asc`

### `claimDecisionJob(...)`

用途：尝试让某个 worker 独占一个任务。

建议签名：

```ts
export const claimDecisionJob = async (
  context: AppContext,
  input: {
    job_id: string;
    worker_id: string;
    now?: bigint;
    lock_ticks?: bigint;
  }
): Promise<DecisionJobRecord | null>
```

核心逻辑：

1. 读取当前 job。
2. 校验是否仍符合 claim 条件。
3. 使用 `updateMany` 做条件更新：
   - where 中包含：
     - `id`
     - `status in pending/running`
     - `next_retry_at` 条件
     - 锁可抢占条件（空锁 / 已过期）
4. 若 `count === 0`，说明 claim 失败，返回 `null`。
5. 若成功，重新读取并返回最新 job。

写入字段：

- `locked_by = worker_id`
- `locked_at = now`
- `lock_expires_at = now + lock_ticks`
- `status = running`
- `started_at = now`（如果原来为空）
- `updated_at = now`
- `attempt_count`：
  - 仅当从 `pending -> running` 或从失败后重新入队到真正执行时增加
  - 若是“同一 job 已 running 但锁过期被重新 claim”，需明确是否重复记 attempt

### attempt 计数建议

本批次建议采用保守规则：

- 只有当 worker 成功 claim 且原状态是 `pending` 时，`attempt_count += 1`
- 若原状态已是 `running` 但锁过期重领，不额外加 attempt

理由：

- 避免“worker 崩溃 → 被恢复 claim”被算成一次全新业务重试
- `attempt_count` 更接近“真正开始的业务尝试次数”

### `releaseDecisionJobLock(...)`

用途：显式清锁。

建议签名：

```ts
export const releaseDecisionJobLock = async (
  context: AppContext,
  input: {
    job_id: string;
    worker_id?: string;
  }
): Promise<DecisionJobRecord>
```

逻辑：

- 清空：
  - `locked_by`
  - `locked_at`
  - `lock_expires_at`
- 若传入 `worker_id`，可做附加保护：仅清理自己持有的锁。

### `assertDecisionJobLockOwnership(...)`

用途：执行前校验某 worker 是否仍持有锁。

建议签名：

```ts
export const assertDecisionJobLockOwnership = (
  job: DecisionJobRecord,
  workerId: string,
  now: bigint
): void
```

失败时抛出 `ApiError(409/500, ...)` 或返回布尔值。

---

## 5.5 调整已有状态更新函数

### `createPendingDecisionJob(...)`

创建时应默认写入：

- `locked_by = null`
- `locked_at = null`
- `lock_expires_at = null`

### `updateDecisionJobState(...)`

建议新增可选输入字段：

```ts
locked_by?: string | null;
locked_at?: bigint | null;
lock_expires_at?: bigint | null;
```

这样在以下场景可统一更新：

- 完成后清锁
- 失败后清锁
- retry reset 时清锁

建议规则：

- job 完成：清锁
- job 失败：清锁
- job reset 到 `pending`：清锁

---

## 6. Runner 改造

目标文件：`apps/server/src/app/runtime/job_runner.ts`

---

## 6.1 新增 workerId

当前 runner 无身份概念，应扩展：

```ts
export interface RunDecisionJobRunnerOptions {
  context: AppContext;
  inferenceService: InferenceService;
  workerId: string;
  limit?: number;
  lockTicks?: bigint;
}
```

---

## 6.2 runner 改为“列候选 → claim → execute”

建议流程：

1. `listClaimableDecisionJobs(...)`
2. 遍历候选 job
3. 对每个 job 调用 `claimDecisionJob(...)`
4. 只有 claim 成功的 job 才执行
5. 执行调用：

```ts
inferenceService.executeDecisionJob(claimedJob.id, { workerId })
```

6. 统计本轮实际 claim 并执行的数量

这样能把“重复扫描”与“重复执行”分离开。

---

## 7. InferenceService 改造

目标文件：`apps/server/src/inference/service.ts`

---

## 7.1 扩展 `executeDecisionJob` 签名

当前：

```ts
executeDecisionJob(jobId: string): Promise<InferenceRunResult | null>
```

建议调整为：

```ts
executeDecisionJob(
  jobId: string,
  options: { workerId: string }
): Promise<InferenceRunResult | null>
```

---

## 7.2 执行前做锁归属校验

执行前步骤建议为：

1. 读取 job
2. 校验：
   - `job.status === 'running'`
   - `job.locked_by === workerId`
   - `job.lock_expires_at !== null && job.lock_expires_at >= now`
3. 若不满足，直接返回 `null` 或抛出业务错误

建议这里返回 `null` 更稳妥，避免 runner 报系统异常。

---

## 7.3 完成 / 失败时释放锁

### 成功执行后
在 trace sink / workflow 持久化成功后，应确保最终 `DecisionJob`：

- `status = completed`
- `completed_at = now`
- `locked_by = null`
- `locked_at = null`
- `lock_expires_at = null`

### 失败执行后
当前失败路径已会更新：

- `status = failed`
- `last_error_*`
- `next_retry_at`

应补充：

- `locked_by = null`
- `locked_at = null`
- `lock_expires_at = null`

避免失败后仍持有僵尸锁。

---

## 7.4 retry reset 时清锁

`retryInferenceJob(...)` 中把 job 重置为 `pending` 时，应同时清锁，确保该 job 后续由 runner 重新 claim：

- `locked_by = null`
- `locked_at = null`
- `lock_expires_at = null`

同时，建议 `retryInferenceJob()` 不再同步直接执行，而是只 reset 后重新入队，或者保留现状但通过 claim 流程执行。

### 推荐做法

本批次为了减少行为变化，可保留“retry API 内部立即再执行”语义，但要先显式 claim 再执行。

如果实现复杂度偏高，也可以顺势把 retry API 改成：

- 仅重置为 `pending`
- 返回最新 workflow snapshot
- 实际执行由 loop 完成

这是一个产品语义变化点，若改动，需要同步文档。

本批次建议：**先保留原语义，后续再讨论是否异步化 retry API。**

---

## 8. 应用启动与 runtime 接线

目标文件：`apps/server/src/index.ts`

---

## 8.1 生成 workerId

应用启动时生成进程级 workerId，例如：

```ts
const workflowWorkerId = `server:${process.pid}:${Date.now()}`;
```

更稳一点可拼入 hostname，但当前不是必须。

---

## 8.2 loop 启动时传入 workerId

`startSimulationLoop(...)` → `runDecisionJobRunner(...)` 时透传：

- `workerId`
- （可选）`lockTicks`

这会把 worker 身份引入到整个 claim 流程中。

---

## 9. API 与文档同步

目标文件：

- `API.md`
- `README.md`
- `ARCH.md`
- `TODO.md`

---

## 9.1 API.md

需要在 Phase D 当前语义中补充：

- Decision job runner 已引入最小轻量锁语义
- 当前 baseline 支持 orphan `running` job 的过期重领
- 当前仍非完整 durable scheduler，但已不再是纯无锁扫描执行

如决定暴露 job 锁字段，还需补充：

- `GET /api/inference/jobs/:id` 返回字段新增：
  - `locked_by?`
  - `locked_at?`
  - `lock_expires_at?`

---

## 9.2 README.md / ARCH.md

更新措辞，避免继续写成：

- “single-process loop baseline only”

而应改为：

- “single-process loop baseline with minimal job locking / claim semantics”

同时明确：

- 仍未实现真正 multi-worker durable scheduler
- 但已具备轻量锁与 orphan recovery 基线

---

## 9.3 TODO.md

建议把 M2 中 Workflow Persistence Phase D 的描述更新为：

- 已落地：轻量 job locking / claim baseline
- 仍待完成：replay orchestration、durable scheduling、broader workflow progression

---

## 10. 建议修改文件清单

本批次高概率涉及以下文件：

### 数据层
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/<new_migration>/migration.sql`

### 服务层
- `apps/server/src/app/services/inference_workflow.ts`
- `apps/server/src/inference/service.ts`

### runtime
- `apps/server/src/app/runtime/job_runner.ts`
- `apps/server/src/app/runtime/simulation_loop.ts`
- `apps/server/src/index.ts`

### 类型/契约（按需）
- `apps/server/src/inference/types.ts`

### 文档
- `API.md`
- `README.md`
- `ARCH.md`
- `TODO.md`

---

## 11. 实施顺序建议

### Step 1
先改 Prisma schema + migration：

- 增加锁字段
- 准备最小索引

### Step 2
改 `inference_workflow.ts`：

- 扩展 `DecisionJobRecord`
- 增加 `listClaimableDecisionJobs`
- 增加 `claimDecisionJob`
- 增加 `releaseDecisionJobLock`
- 调整 `updateDecisionJobState`

### Step 3
改 `job_runner.ts`：

- 引入 `workerId`
- 改为 claim 后执行

### Step 4
改 `inference/service.ts`：

- 扩展 `executeDecisionJob(...)`
- 加锁归属校验
- 成功/失败释放锁

### Step 5
改 `simulation_loop.ts` / `index.ts`：

- 生成并透传 workerId

### Step 6
补文档：

- API / README / ARCH / TODO

---

## 12. 验收标准

本批次完成后，应满足以下验收条件：

1. `DecisionJob` 持久化字段中存在轻量锁信息。
2. runner 不再对扫描出的所有 job 直接执行，而是先 claim。
3. 同一个 job 在并发 runner 下，不应被多个 worker 同时成功 claim。
4. 已过期锁的 `running` job 能被重新 claim。
5. job 执行成功后会清锁并进入 `completed`。
6. job 执行失败后会清锁并进入 `failed`（必要时带 `next_retry_at`）。
7. retry path 不会遗留脏锁。
8. 文档能准确反映“已引入轻量 job locking，而非完整 durable scheduler”的当前状态。

---

## 13. 下一阶段预留（非本批次）

完成本批次后，建议下一阶段继续推进：

### D2
- replay API
- replay lineage（`replay_of_job_id` / `replay_source_trace_id`）
- richer audit tooling

### D3
- scheduler/backoff policy
- ActionIntent locking
- heartbeat / lease renewal
- multi-worker safety 的更正式化实现

---

## 14. 最终建议

本批次实现应坚持一个原则：

> 不急着把 Workflow D 做“很大”，而是先把它做“稳”。

也就是说，第一步不是扩更多业务动作，也不是扩更多 API，而是把 **DecisionJob 的调度安全性** 建起来。只有把 claim/lock/orphan recovery 打牢，后续 replay、dispatcher 扩展、多 worker 化才有可靠基础。
