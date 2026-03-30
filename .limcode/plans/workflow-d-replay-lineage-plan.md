## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 设计 Replay API 路由与输入输出契约  `#plan-replay-route`
- [ ] 设计 DecisionJob replay lineage 字段与最小迁移方案  `#plan-replay-schema`
- [ ] 设计 replay 服务接口、状态语义与 workflow snapshot 扩展  `#plan-replay-service`
- [ ] 规划 replay 场景的专项测试与 smoke 覆盖  `#plan-replay-test`
<!-- LIMCODE_TODO_LIST_END -->

# Workflow D 第二批实现方案（Replay API + Lineage 基线）

## 1. 背景

当前 Workflow D 第一批已经完成并验证通过的内容包括：

- `DecisionJob` 轻量锁字段：`locked_by / locked_at / lock_expires_at`
- loop runner 的 claim → execute 执行模型
- retry 路径的 claim 语义接入
- workflow locking 专项测试
- smoke / prepare:runtime / lint / typecheck 全部通过

这意味着当前系统已经不再只是“单进程同步推理”，而是具备了一个能安全驱动的最小 persisted workflow baseline。

但目前仍有一个核心缺口：

> 系统已有 duplicate-submit replay（同一 `idempotency_key` 返回已有 job / trace），但还没有真正的 replay orchestration 能力。

也就是说，现在所谓 replay 更接近“复用已有执行结果”，而不是“基于历史 workflow 再派生一次新的 workflow 执行”。

---

## 2. 本批次目标

本批次目标是引入 **Replay API + lineage 基线**，让系统从：

- 已有结果可回放查看

升级为：

- 可从已有 `DecisionJob` 或 `InferenceTrace` 派生新的 replay job
- 可观察 replay 来源与 lineage 关系
- 可在 workflow snapshot 中看到 replay lineage 基本信息

---

## 3. 设计边界

### 3.1 本批次要做的

1. 新增 replay lineage 最小数据字段。
2. 提供 `POST /api/inference/jobs/:id/replay` API。
3. replay 默认从历史 `request_input` 派生一个新的 `pending` job。
4. 新 job 拥有全新的 `idempotency_key`、独立执行状态、独立 trace / intent / job 记录。
5. workflow read 能看出该 job 是否 replay 派生、来源是谁。

### 3.2 本批次不做的

以下内容先不做，避免爆炸：

- 通用 replay 模式矩阵（比如 `fork_input`, `fork_trace`, `fork_decision`, `re-dispatch-only`）
- 单独的 `WorkflowReplay` 表
- replay diff / decision compare UI
- 批量 replay / replay campaign
- 针对 `ActionIntent` 的 replay 级别编排
- 基于 trace 的“仅重派发”能力

本批次只做一个最小正式版本：

> **从已有 DecisionJob 派生一个新的 inference job**。

---

## 4. 当前实现现状判断

从现有代码看：

### 已有基础
- `DecisionJob.request_input` 已持久化。
- `createPendingDecisionJob(...)` 已能创建标准 pending workflow entry。
- `submitInferenceJob(...)` 已有去重和结果封装逻辑。
- `buildInferenceJobSubmitResult(...)` / `buildInferenceJobReplayResult(...)` 已能输出统一 envelope。
- `getWorkflowSnapshotByJobId(...)` 已具备聚合读取能力。

### 当前缺口
- `DecisionJob` 没有 lineage 字段。
- 没有 replay route。
- 没有 replay 专用 service。
- `WorkflowSnapshot` 不包含 lineage 信息。
- API 文档里 replay 仍停留在“duplicate idempotency replay”层面。

这说明第二批实现并不需要推倒，只需要在现有 job-creation path 上增加“派生来源”的表达与入口。

---

## 5. 数据模型设计

## 5.1 推荐方案：直接扩展 `DecisionJob`

优先推荐先不建新表，而是给 `DecisionJob` 增加以下字段：

```prisma
replay_of_job_id      String?
replay_source_trace_id String?
replay_reason         String?
```

### 含义

- `replay_of_job_id`
  - 该 job 是从哪个历史 `DecisionJob` 派生出来的。
  - 是 replay lineage 的主键线索。

- `replay_source_trace_id`
  - replay 时参考的原始 trace id。
  - 有些 job 尚未落 trace 时，此字段可为空。

- `replay_reason`
  - 为什么 replay。
  - 第一批可以允许固定值或自由字符串，例如：
    - `operator_manual_replay`
    - `audit_replay`
    - `post_fix_validation`

### 为什么先扩展 `DecisionJob`

原因：

1. 当前 replay 是“派生新 job”，核心主体就是 `DecisionJob`。
2. 关系简单，读 API 可以快速聚合。
3. 不引入新表就能完成 lineage 基线。
4. 后续若 replay 复杂度增加，再升级到独立 `WorkflowReplay` 表也不迟。

---

## 5.2 关系与约束建议

Prisma 中建议增加自引用关系：

```prisma
replay_of_job_id       String?
replay_of_job          DecisionJob? @relation("DecisionJobReplayLineage", fields: [replay_of_job_id], references: [id])
replayed_jobs          DecisionJob[] @relation("DecisionJobReplayLineage")
```

以及普通字段：

```prisma
replay_source_trace_id String?
replay_reason          String?
```

索引建议：

```prisma
@@index([replay_of_job_id, created_at])
```

这样方便后续查 lineage children。

---

## 6. API 设计

## 6.1 新增接口

### `POST /api/inference/jobs/:id/replay`

#### 说明
从已有 `DecisionJob` 派生一个新的 replay job。

#### 最小输入

```json
{
  "reason": "operator_manual_replay"
}
```

#### 可选输入

```json
{
  "reason": "operator_manual_replay",
  "idempotency_key": "custom-replay-key-001"
}
```

### 本批次是否允许 overrides？

建议：**第一版不允许** `agent_id / strategy / attributes` overrides。

原因：

- 先把 replay 与 resubmit 的语义分开。
- replay 第一版就是“复用原 request_input 再派生一单”。
- 如果一开始就允许 overrides，就会迅速变成 fork workflow，而不是 replay baseline。

后续可在 D2.1/D2.2 再增加：

- `overrides.attributes`
- `overrides.strategy`

---

## 6.2 返回结构

建议尽量复用现有 `InferenceJobSubmitResult` 风格，减少前端和测试心智负担。

返回：

```json
{
  "success": true,
  "data": {
    "replayed": false,
    "inference_id": "pending_<new-key>",
    "job": { ...newJobSnapshot },
    "result": null,
    "result_source": "not_available",
    "workflow_snapshot": { ... },
    "replay": {
      "source_job_id": "old-job-id",
      "source_trace_id": "old-trace-id-or-null",
      "reason": "operator_manual_replay"
    }
  }
}
```

### 为什么不继续复用 `replayed=true/false` 的老语义？

这里要区分两个概念：

- **duplicate submit replay**：同 idempotency key，返回历史 job
- **workflow replay orchestration**：基于旧 job 创建一个新的 job

所以：

- 新 API 返回 `replayed: false` 是合理的，因为它创建的是一个新 workflow。
- 但应额外带一个 `replay` 字段来说明 lineage 来源。

---

## 7. 服务层设计

目标文件：

- `apps/server/src/app/services/inference_workflow.ts`
- `apps/server/src/inference/service.ts`

---

## 7.1 新增 replay 输入类型

建议在 `inference/types.ts` 增加：

```ts
export interface InferenceJobReplayInput {
  reason?: string;
  idempotency_key?: string;
}

export interface InferenceJobReplayMetadata {
  source_job_id: string;
  source_trace_id: string | null;
  reason: string | null;
}

export interface InferenceJobReplaySubmitResult extends InferenceJobSubmitResult {
  replay: InferenceJobReplayMetadata;
}
```

---

## 7.2 新增 service：构建 replay 输入

建议在 `inference_workflow.ts` 增加：

### `buildReplayRequestInputFromJob(...)`

签名：

```ts
export const buildReplayRequestInputFromJob = (
  job: DecisionJobRecord
): InferenceRequestInput
```

逻辑：

- 直接复用 `getDecisionJobRequestInput(job)`
- 但后续如果想做 replay 专用字段剥离，也有单独入口

---

## 7.3 新增 service：创建 replay pending job

建议新增：

```ts
export const createReplayDecisionJob = async (
  context: AppContext,
  input: {
    source_job: DecisionJobRecord;
    source_trace_id: string | null;
    request_input: InferenceRequestInput;
    idempotency_key: string;
    reason?: string | null;
    max_attempts?: number;
  }
): Promise<DecisionJobRecord>
```

逻辑：

- 复用 `createPendingDecisionJob` 的基础字段
- 但额外写入：
  - `replay_of_job_id`
  - `replay_source_trace_id`
  - `replay_reason`

### 注意
这意味着当前 `createPendingDecisionJob(...)` 可考虑做两种方式之一：

#### 方案 A
直接扩展 `createPendingDecisionJob(...)` 入参，支持 replay 字段。

#### 方案 B
保留原函数，新增 `createReplayDecisionJob(...)`。

推荐：**方案 B**。

原因：
- replay 是带 lineage 的特殊 entry
- 保持基础 submit path 简单清晰

---

## 7.4 新增 service：读取 replay lineage

建议新增：

```ts
export const getReplayMetadataForJob = async (
  context: AppContext,
  job: DecisionJobRecord
): Promise<InferenceJobReplayMetadata | null>
```

逻辑：

- 若 `job.replay_of_job_id` 为空，返回 `null`
- 否则返回：
  - `source_job_id`
  - `source_trace_id`
  - `reason`

后续如果要返回 parent job snapshot / children list，可在此处继续扩展。

---

## 8. InferenceService 设计

目标：`apps/server/src/inference/service.ts`

### 新增接口

```ts
replayInferenceJob(jobId: string, input?: InferenceJobReplayInput): Promise<InferenceJobReplaySubmitResult>
```

### 推荐流程

1. 读取 source job：`getDecisionJobById(...)`
2. 从 job 中恢复 `request_input`
3. 生成新的 replay idempotency key：
   - 优先使用用户传入
   - 否则自动生成：
     - `replay_${sourceJob.id}_${Date.now()}`
4. 若该 idempotency key 已存在，则返回冲突错误或直接复用

### 这里的关键语义建议
我建议：

- `POST /jobs/:id/replay` **必须创建一个新 job**
- 因此 replay API 如果传入已存在的 `idempotency_key`，应报 `409 INFERENCE_INPUT_INVALID` 或新专用错误

不要让 replay API 退化成 duplicate-submit replay。

### 后续步骤

5. 创建 replay pending job
6. 构建 workflow snapshot
7. 返回 `InferenceJobReplaySubmitResult`

---

## 9. WorkflowSnapshot 扩展建议

当前 `WorkflowSnapshot` 只有：

- `records.trace`
- `records.job`
- `records.intent`
- `derived.*`

建议最小扩展：

```ts
lineage?: {
  replay_of_job_id: string | null;
  replay_source_trace_id: string | null;
  replay_reason: string | null;
}
```

或者放在：

```ts
records.job_lineage
```

### 推荐位置
建议放在顶层：

```ts
workflow_snapshot.lineage
```

理由：

- 它是整个 workflow 的元信息，不只是 job record 的原始字段。
- 后续也容易加入 `child_replay_job_ids`、`root_job_id` 等派生结果。

---

## 10. 路由层设计

目标文件：`apps/server/src/app/routes/inference.ts`

新增：

```ts
app.post('/api/inference/jobs/:id/replay', ...)
```

### 请求解析
新增一个小 parser：

```ts
const parseReplayInput = (body: unknown): InferenceJobReplayInput => { ... }
```

只解析：

- `reason`
- `idempotency_key`

### handler

```ts
const result = await inferenceService.replayInferenceJob(req.params.id, parseReplayInput(req.body));
res.json({ success: true, data: result });
```

---

## 11. 错误语义建议

建议新增错误码：

- `DECISION_JOB_REPLAY_INVALID`
  - 源 job 不允许 replay（例如 request_input 缺失或结构无效）
- `DECISION_JOB_REPLAY_DUPLICATE_KEY`
  - replay API 指定的 idempotency_key 已存在

如果不想新增太多错误码，首版也可先用：

- `INFERENCE_INPUT_INVALID`
- `DECISION_JOB_NOT_FOUND`

但从可维护性来说，建议加专用 replay 错误码。

---

## 12. 测试策略

## 12.1 新增专项测试

建议新增：

- `apps/server/src/e2e/workflow_replay.ts`

覆盖：

### 场景 1：从 completed job replay
- 创建一个正常 job
- 等它完成
- 调用 replay API
- 验证新 job 创建成功
- 验证 lineage 字段正确
- 验证新 job 的 id 不同于旧 job

### 场景 2：从 failed job replay
- 创建一个失败 job
- 调用 replay API
- 验证允许 replay
- 验证 replay job 是新的 pending job

### 场景 3：重复 replay key 冲突
- 指定一个 replay `idempotency_key`
- 第一次成功
- 第二次相同 key 调用 replay API 报冲突

### 场景 4：workflow snapshot 暴露 lineage
- `GET /api/inference/jobs/:id/workflow`
- 验证 `lineage.replay_of_job_id` / `replay_source_trace_id` / `replay_reason`

---

## 12.2 smoke 是否纳入

建议：

- 第一版先做独立 e2e 脚本，不一定马上塞进 `smoke:endpoints`
- 等 replay 语义稳定后，再纳入 smoke

原因：

- smoke 本来已经很长
- replay 逻辑更适合独立专项测试

---

## 13. 涉及文件清单

### 数据层
- `apps/server/prisma/schema.prisma`
- `apps/server/prisma/migrations/<new_migration>/migration.sql`

### 类型/契约
- `apps/server/src/inference/types.ts`

### 服务层
- `apps/server/src/app/services/inference_workflow.ts`
- `apps/server/src/inference/service.ts`

### 路由层
- `apps/server/src/app/routes/inference.ts`

### 测试
- `apps/server/src/e2e/workflow_replay.ts`
- `apps/server/package.json`

### 文档
- `API.md`
- `README.md`
- `ARCH.md`
- `TODO.md`

---

## 14. 实施顺序建议

### Step 1
扩 Prisma schema：

- `replay_of_job_id`
- `replay_source_trace_id`
- `replay_reason`
- 自引用 relation
- 索引

### Step 2
扩 `DecisionJobRecord` 与 `WorkflowSnapshot` lineage 结构

### Step 3
在 `inference_workflow.ts` 中新增 replay 创建与 lineage 读取函数

### Step 4
在 `InferenceService` 中新增 `replayInferenceJob(...)`

### Step 5
在 `routes/inference.ts` 新增 `POST /api/inference/jobs/:id/replay`

### Step 6
新增 `workflow_replay.ts` 专项测试

### Step 7
更新 API / README / ARCH / TODO

---

## 15. 验收标准

完成本批次后，应满足：

1. 可以通过 `POST /api/inference/jobs/:id/replay` 创建新的 replay job。
2. replay job 拥有独立的新 `id` 与新的 `idempotency_key`。
3. replay job 能复用原 `request_input` 入队并正常执行。
4. replay lineage 字段会记录来源 job / source trace / reason。
5. `GET /api/inference/jobs/:id/workflow` 可观察 replay lineage。
6. replay 不会覆盖原 job、原 trace、原 intent。
7. replay 专项测试通过，且不破坏现有 smoke / locking test。

---

## 16. 最终建议

第二批不应直接冲向“复杂 replay 编排系统”，而应该继续延续第一批的策略：

> 先把 replay 做成一个正式、可审计、可扩展的最小版本。

因此最合理的落点是：

- **先以 `DecisionJob -> new DecisionJob` 的 replay 派生模型切入**
- **先把 lineage 写对、接口做稳、测试补齐**
- 之后再逐步扩展为 richer replay orchestration


## 17. Replay 第二小步补充：Overrides 设计边界（暂不实现）

为避免 replay 与 resubmit/fork workflow 语义混淆，当前已经落地的 replay API 仍然只支持：

- 复用原 `DecisionJob.request_input`
- 派生一个新的 replay job
- 记录 lineage（`replay_of_job_id` / `replay_source_trace_id` / `replay_reason`）

下一小步若要引入 overrides，建议仅开放以下受控能力：

### 17.1 建议开放的 overrides

```json
{
  "reason": "operator_manual_replay",
  "idempotency_key": "optional-new-key",
  "overrides": {
    "strategy": "mock|rule_based",
    "attributes": { }
  }
}
```

### 17.2 第一批 overrides 明确不开放的字段

以下字段建议继续禁止覆盖：

- `agent_id`
- `identity_id`
- `source_job_id`
- 任意 lineage 字段

原因：

- 覆盖 actor 会让 replay 退化成“跨 actor resubmit”
- lineage 必须由系统生成，不能由外部请求伪造

### 17.3 语义规则建议

- 无 `overrides`：视为标准 replay
- 仅覆盖 `attributes` / `strategy`：视为 replay-with-overrides
- 如果未来要覆盖 actor，则应升级为新的 fork workflow API，而不是继续塞进 replay API

### 17.4 实施建议

当实现 overrides 时，推荐新增：

- [x] `replay_override_snapshot`（当前已持久化到 `DecisionJob`）
- [x] `workflow_snapshot.lineage.override_applied`
- [x] replay 专项测试：
  - [x] strategy override 生效
  - [x] attributes override 生效
  - [ ] actor override 被拒绝

这样可以保证 replay 继续保持“以 lineage 为中心的审计语义”，而不是重新滑回一次普通 submit。
