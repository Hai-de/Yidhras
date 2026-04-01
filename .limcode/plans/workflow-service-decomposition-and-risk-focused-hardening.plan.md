## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 为 SimulationManager 制定分层重构路径，避免继续吸附职责  `#decompose-simulation-manager`
- [ ] 收敛前端 route/store/composable 多重镜像，明确 URL state / server snapshot / ephemeral UI state 边界  `#reduce-frontend-state-mirroring`
- [ ] 只为最脆弱模块补测试，不追求覆盖率数字，并评估可用 Zod 收敛高风险输入/快照校验  `#risk-focused-tests`
- [ ] 拆分 relational.ts 的 graph projection / filter parsing / traversal / read model 组装职责  `#shrink-relational-service`
- [ ] 拆分 apps/server/src/app/services/inference_workflow.ts，优先消除 N+1、职责混杂与重复校验  `#split-inference-workflow`
- [ ] 记录 contracts response schema 统一化方向，暂不立即实施  `#track-contracts-direction`
<!-- LIMCODE_TODO_LIST_END -->

# Workflow Service Decomposition and Risk-Focused Hardening Plan

## 1. 背景与目标

当前代码库的主要风险已从“边界未建立”转向“核心实现膨胀后开始侵蚀维护性与健壮性”。其中最高风险点是：

- `apps/server/src/app/services/inference_workflow.ts` 已达 1700+ 行；
- `apps/server/src/app/services/relational.ts` 已达 700+ 行；
- 前端部分 feature 存在 `route -> store -> composable` 状态镜像；
- 项目已引入 `zod`，但在 workflow 内部高风险输入/持久化快照归一化上尚未充分利用；
- 测试主要覆盖 store/setter 等低风险层，尚未覆盖最易碎的行为链路；
- `SimulationManager` 正在变成“凡是与运行时有关都可继续往里塞”的核心吸附点；
- `packages/contracts` 方向正确，但目前尚未覆盖高价值 response schema。

本计划目标不是一次性“全量大重构”，而是：

1. 先处理最危险的大文件与潜在性能问题；
2. 通过职责切分和批量读取消除 N+1 风险；
3. 只给最脆弱模块补测试；
4. 在不扩大变更面的前提下，利用 Zod 收敛高风险 parse/normalize 边界；
4. 把 contracts 统一 response schema 作为明确方向记录下来，但不在这一轮强推；
5. 为后续 SimulationManager 与前端状态模型收敛留出稳定演进路径。

---

## 2. 总体优先级

### P0：立即进入计划并优先处理

1. `apps/server/src/app/services/inference_workflow.ts`
2. `apps/server/src/app/services/relational.ts`
3. 薄弱行为链路测试补强（仅限最脆弱模块）
4. workflow 高风险 parse/normalize 场景的 Zod 化收敛

### P1：随后处理

4. 前端 route/store/composable 状态镜像收敛
5. `SimulationManager` 分解设计与第一阶段落地

### P2：记录方向，不立即落地

6. `packages/contracts` 补齐 response schema，逐步成为前后端单一契约源

---

## 3. inference_workflow.ts 重构计划

## 3.1 现状判断

`inference_workflow.ts` 当前同时承担了以下职责：

- Prisma record type 定义；
- workflow / trace / job / intent snapshot 转换；
- workflow derived state 计算；
- cursor / filter parsing；
- list API 的分页、过滤、统计；
- 单条 job 的 claim / release / retry / update；
- scheduler 相关聚合查询；
- replay / retry / submit result 组装；
- request_input 的手动校验与归一化；
- workflow snapshot 查询与 lineage 拼装。

这已经明显违反单一职责，且 `listInferenceJobs()` 存在高概率 N+1：

- 先查一批 `decisionJob`
- 再对每个 job 调 `getWorkflowSnapshotByJobId()`
- 而 `getWorkflowSnapshotByJobId()` 又会触发多次 Prisma 查询

在筛选条件导致 `shouldFetchAllInferenceJobs(filters) === true` 时，这种模式尤其危险。

### Zod 可用性评估

当前项目已经引入 `zod`，且 `packages/contracts` 中已有 query schema 基线，说明：

- **技术上完全可用**；
- **工程上应谨慎使用**，只放在高风险输入/持久化快照归一化边界，不要把本轮重构扩展成“大规模类型体系迁移”。

本轮建议使用 Zod 的场景：

- `normalizeStoredRequestInput()`：把持久化 `request_input` 的对象形状收敛成正式 schema；
- `normalizeReplayInput()`：把 replay override 输入收敛成正式 schema；
- 可选：workflow list filter/cursor payload 的 parse schema 化。

---

## 3.2 重构原则

- **先拆职责，再优化 SQL / Prisma 读取路径**，避免“边修性能边改结构”导致验证困难；
- **保持现有 API 输出结构稳定**，不要把重构和 contract 变更耦合；
- **优先把批量列表路径改成批量装配**，单条详情路径可后续复用相同 assembler；
- **把手写校验收敛到 parse/normalize 层**，避免业务函数里重复分散；
- **把 snapshot / derived state 逻辑变成纯函数模块**，以便测试。
- **优先在高风险边界使用 Zod，而不是在全文件机械替换手写判断。**

---

## 3.3 推荐拆分模块

建议把 `inference_workflow.ts` 拆成以下几个文件（可先落在同目录下的 `inference_workflow/` 子目录）：

### A. `inference_workflow/types.ts`
集中放：
- `DecisionJobRecord`
- `InferenceTraceRecord`
- `ActionIntentRecord`
- cursor / filter 内部类型

目标：把 record shape 与业务逻辑分离，减少主文件噪声。

### B. `inference_workflow/parsers.ts`
集中放：
- `parseInferenceJobListLimit`
- `parseOptionalFilterId`
- `parseOptionalCreatedAtFilter`
- `parseInferenceJobStatuses`
- `parseInferenceJobsCursor`
- `parseInferenceJobsFilters`
- `ensureNonEmptyId`
- `normalizeReplayInput`
- `normalizeStoredRequestInput`

其中优先考虑使用 Zod 重写或包裹：
- `normalizeStoredRequestInput`
- `normalizeReplayInput`
- `parseInferenceJobsCursor`（如改为 schema 化 cursor payload）

目标：把“手动数据校验/归一化”从业务逻辑里剥离。

### C. `inference_workflow/snapshots.ts`
集中放：
- `toInferenceJobSnapshot`
- `toWorkflowDecisionJobSnapshot`
- `toInferenceTraceRecordSnapshot`
- `toInferenceActionIntentSnapshot`
- `buildWorkflowSnapshot`
- `deriveWorkflowDispatchStage`
- `deriveWorkflowFailureStage`
- `deriveWorkflowOutcomeSummary`
- replay lineage snapshot helpers

目标：形成纯函数 read model / snapshot builder 层。

### D. `inference_workflow/repository.ts`
集中放单条/批量 Prisma 读取与更新：
- `getDecisionJobById`
- `getDecisionJobByInferenceId`
- `getInferenceTraceById`
- `getActionIntentByInferenceId`
- `getDecisionJobByIdempotencyKey`
- `listRunnableDecisionJobs`
- `claimDecisionJob`
- `releaseDecisionJobLock`
- `updateDecisionJobState`
- `createPendingDecisionJob`
- `createReplayDecisionJob`
- scheduler 相关批量查询函数

目标：把“数据库访问”从“业务派生和输出组装”中分离。

### E. `inference_workflow/workflow_query.ts`
集中放：
- `getWorkflowSnapshotByInferenceId`
- `getWorkflowSnapshotByJobId`
- `listInferenceJobs`
- 相关批量查询装配逻辑

目标：让 workflow 读模型查询成为单独的 query service。

### F. `inference_workflow/results.ts`
集中放：
- `buildInferenceJobSubmitResult`
- `buildInferenceJobRetryResult`
- `buildInferenceJobReplaySubmitResult`
- `buildInferenceJobReplayResult`
- `resolveInferenceIdForSubmitResult`
- `resolveResultSource`
- `getDecisionResultFromWorkflowSnapshot`
- `buildInferenceRunResultFromTrace`

目标：把提交/重试/重放返回结果组装独立出去。

---

## 3.4 N+1 与性能处理顺序

### 第一阶段：先做“批量装配骨架”

在 `listInferenceJobs()` 中，不再对每个 job 调单条 `getWorkflowSnapshotByJobId()`，而是改成：

1. 批量查出 `decisionJob`；
2. 从 jobs 中提取：
   - `source_inference_id`
   - `action_intent_id`
   - `replay_of_job_id`
   - 当前 job ids
3. 批量查询：
   - `inferenceTrace where id in (...)`
   - `actionIntent where id in (...)` 或 `source_inference_id in (...)`
   - `decisionJob where id in replay_of_job_ids`
   - `decisionJob where replay_of_job_id in current_job_ids`
4. 在内存中建立 map：
   - `traceById`
   - `intentById`
   - `parentJobById`
   - `childJobsByReplayParentId`
5. 用 assembler 为每个 job 构建 workflow snapshot。

这样即使还保留一部分现有逻辑，也能先把最严重的 N+1 降掉。

### 第二阶段：把批量装配抽为通用 assembler

新增类似：

- `buildWorkflowSnapshotBundleForJobs(jobs)`
- `buildWorkflowSnapshotFromBundle(job, bundle)`

让：
- 列表接口
- 单 job 详情接口
- replay / retry result 组装

都复用相同装配器，避免逻辑分叉。

### 第三阶段：评估是否需要更进一步的 DB 层优化

若列表仍慢，再考虑：

- 更强 select 裁剪，只拿 snapshot builder 所需字段；
- 增加特定索引；
- 将部分 request_input / actor_ref 可过滤字段冗余成显式列，减少 JSON 解析过滤。

### Zod 介入边界说明

本轮**不建议**：
- 把所有 `toRecord/isRecord` 全面替换成 Zod；
- 把所有 Prisma record 都 schema 化；
- 把 contracts response schema 与 workflow 重构强耦合。

本轮**建议**：
- 仅在高风险 parse/normalize 入口使用 Zod，降低手动判断出错率；
- 将 Zod schema 作为 parser 层的护栏，而不是侵入所有业务函数。

注意：**这一步应在职责拆分完成后再做**，否则容易把结构问题和数据库问题缠在一起。

---

## 3.5 单一职责收敛目标

重构完成后，应让 `inference_workflow` 形成清晰分层：

- parser：输入校验与归一化
- repository：DB 读写
- snapshot builder：纯函数派生
- workflow query：读模型装配
- result builder：submit/retry/replay 输出

其中任何一个文件都不应再同时承担：
- parse + prisma + snapshot derive + API result build 四种以上职责。

---

## 3.6 inference_workflow 的测试优先级

不要追求“全覆盖”，只补最虚的地方：

### 必测 1：`listInferenceJobs()` 的高风险行为
覆盖：
- 状态过滤
- `agent_id / identity_id / strategy` 过滤
- cursor 分页正确性
- `has_error` 分支
- `action_intent_id` 过滤
- replay lineage 字段存在时的 snapshot 组装

### 必测 2：workflow derived state 纯函数
覆盖：
- `decision_pending`
- `decision_running`
- `decision_failed`
- `dispatch_pending`
- `dispatching`
- `workflow_completed`
- `workflow_dropped`
- `workflow_failed`

### 必测 3：锁语义
覆盖：
- `claimDecisionJob()` 并发条件失败
- 锁过期后重新 claim
- 非 owner release 不生效
- `assertDecisionJobLockOwnership()` 错误路径

### 必测 4：replay / retry 结果组装
覆盖：
- fresh run
- replayed stored trace
- replay submit with no result
- retry result

---

## 4. relational.ts 重构计划

## 4.1 当前问题

`relational.ts` 同时混合：
- graph query 解析
- graph traversal
- node/edge read model 组装
- relational log / atmosphere list 其他查询

这是典型的“同名 service 容纳过多不同读模型”的问题。

## 4.2 建议拆分

- `relational/graph_filters.ts`：view/depth/kinds/search parsing
- `relational/graph_traversal.ts`：`getNeighborhoodNodeIds` 等 traversal
- `relational/graph_projection.ts`：nodes/edges/snapshot 组装
- `relational/queries.ts`：atmosphere / relationship logs 等非 graph 查询

## 4.3 优先级

先拆 graph projection 相关部分，因为这是前端高频 operator read path，且最容易继续膨胀。

---

## 5. 前端 route/store/composable 状态镜像收敛计划

## 5.1 当前问题

Graph 等 feature 中存在：
- route query 保存一份状态
- store 镜像一份状态
- composable 再组装一份派生状态

这会带来：
- 状态源不唯一
- 新字段扩展改动面大
- 调试时难判断谁是 authoritative source

## 5.2 收敛原则

对每个 feature 明确三类状态：

### A. URL state
用于：
- 可分享
- 可刷新恢复
- 与 drill-down 语义有关

例如：
- selected item id
- root id
- filters
- tab

### B. server snapshot state
用于：
- 当前请求结果
- loading / error / last synced
- polling mode

### C. ephemeral UI state
用于：
- 仅局部组件交互
- 不值得进 URL
- 不需要跨页面保留

## 5.3 处理顺序

先从 Graph 做试点：
- 尽量移除 store 中与 route 完全同构的字段；
- store 只保留真正非 URL 状态，如 `autoRefreshMode / isFetching / lastSyncedAt`；
- route composable 成为过滤条件唯一来源；
- page composable 只负责 fetch 与 derived view model。

之后再推广到 workflow / timeline / social。

---

## 6. 测试策略：只补“最虚的模块”

本轮不要追求 coverage 数字，而是只补以下高风险区域：

### 第一优先级（必须补）

1. `apps/server/src/app/services/inference_workflow.ts` 拆分后核心模块
   - parser
   - snapshot derive
   - list query assembly
   - lock semantics

2. `apps/server/src/app/services/relational.ts` 拆分后的 graph projection 核心逻辑
   - kinds/depth/search filters
   - root neighborhood
   - counts / active roots / returned nodes

3. `apps/web/lib/http/client.ts`
   - envelope success/failure
   - empty body / mismatch / unknown error

4. `apps/web/features/*/route.ts`
   - query normalize
   - boolean/string default semantics

### 第二优先级（有余力再补）

5. `apps/web/features/*/adapters.ts`
   - Graph focus summary
   - inspector actions enable/disable
   - search explainer 边界

6. `source-context` / `navigation`
   - 跨页来源 query 构造与 summary 语义

不补：
- 纯 setter store 测试的机械堆叠
- 只验证赋值的低价值断言

---

## 7. SimulationManager 分解计划

## 7.1 当前问题

`SimulationManager` 正在吸附：
- Prisma 初始化
- world pack 加载
- clock/resolver/dynamics 初始化
- runtime speed
- graph data provider
- 时间恢复逻辑
- step loop 入口

这意味着未来任何“和模拟有关”的东西都可能继续塞进去。

## 7.2 目标边界

建议逐步收敛为：

- `SimulationBootstrap`：负责 world pack + runtime object 初始化
- `RuntimeClockService`：时间与 step ticks
- `WorldStateFacade`：面向 app/service 的统一访问入口
- `GraphReadModelProvider`：独立提供 graph 基础数据
- `RuntimeSpeedService`：运行速度配置

## 7.3 本轮只做什么

本轮不直接做大拆，只做：

1. 明确 `SimulationManager` 的非目标：不再继续加入新的 read model / service orchestration；
2. 把新增逻辑优先放到独立 service/provider；
3. 若在 `inference_workflow` / `relational` 重构中需要读取 graph/runtime 数据，避免继续扩展 `SimulationManager` public API。

---

## 8. contracts 方向记录（本轮先记不动）

需要明确记录但不立即执行的方向：

- `packages/contracts` 未来需要逐步接管高价值 response schema；
- 优先级最高的是：
  - `graph view`
  - `overview summary`
  - `scheduler summary / trends`
  - `workflow snapshots / inference job list`

本轮只做：
- 在计划/文档中记录这是后续方向；
- 新增接口时优先考虑从 query schema 迈向 response schema；
- 不把这一项与当前 service 拆分绑定，避免任务面过大。

---

## 9. 建议执行顺序

### Phase 1：先控最大风险

1. 为 `inference_workflow.ts` 建立子目录并迁出纯函数与 parser
2. 给 `listInferenceJobs()` 做批量装配，消除明显 N+1
3. 为 workflow query / snapshot derive / lock semantics 补测试

### Phase 2：处理第二个大文件

4. 拆 `relational.ts` 的 graph projection 子模块
5. 为 graph projection 关键路径补测试

### Phase 3：收敛前端状态模型

6. 以 Graph 为试点削减 route/store 镜像
7. 为 route normalize 与 API client 补行为测试

### Phase 4：运行时核心收口

8. 为 `SimulationManager` 写一页边界说明或小设计文档
9. 后续增量迭代中避免继续往其中塞新职责

### Phase 5：后续方向

10. 逐步把高价值 response schema 纳入 `packages/contracts`

### Phase 1.5：Zod 护栏落位（可并入 Phase 1）

在 `inference_workflow/parsers.ts` 完成拆分后：

1. 为 `request_input` 持久化归一化新增 schema；
2. 为 replay input / override 新增 schema；
3. 评估 cursor payload 是否一并 schema 化；
4. 仅在 parser 层接入，不扩散到 repository / snapshot builder。

---

## 10. 完成标准

满足以下条件可视为本轮计划完成：

- `inference_workflow.ts` 明显降体积，至少拆出 parser / snapshot / repository / query/result 中的多数职责；
- `listInferenceJobs()` 不再对每个 job 单独做多次查询；
- `relational.ts` 的 graph projection 已脱离杂项 relational 查询；
- Graph feature 的状态源边界更清楚，减少重复镜像；
- 新增测试主要覆盖最脆弱的行为路径，而非简单 store setter；
- 若引入 Zod，则仅限高风险 parser 边界，且不破坏当前错误语义与兼容路径；
- `contracts response schema` 方向已被显式记录；
- `SimulationManager` 的继续膨胀趋势被工程规则或设计边界抑制。
