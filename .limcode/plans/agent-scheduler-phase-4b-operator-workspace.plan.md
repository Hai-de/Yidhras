## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 补齐 web 侧 scheduler API client 与类型，对齐 operator/agent projection、ownership/workers/rebalance 等现有服务端读面  `#p4b1`
- [ ] 将 Overview 页面从散装 scheduler 接口拼接切换为 `/api/runtime/scheduler/operator` 聚合 projection 消费  `#p4b2`
- [ ] 将 Agent 页面从 `listAgentDecisions` 切换为 `/api/agent/:id/scheduler/projection`，复用服务端 summary/breakdown/linkage  `#p4b3`
- [ ] 新增独立 Scheduler Workspace（page + features/scheduler/*），承载系统级 highlights、summary/trends、ownership/workers/rebalance、recent activity  `#p4b4`
- [ ] 补齐 Scheduler Workspace 的 drill-down 与导航联动，包括 run/detail、decision 到 workflow/agent、partition/worker 过滤入口  `#p4b5`
- [ ] 补齐前端单测/联调验证，并同步 README/API/TODO/记录 等文档说明当前 operator 主观测面边界  `#p4b6`
<!-- LIMCODE_TODO_LIST_END -->

# Agent Scheduler Phase 4B Operator Workspace 实施计划

> Source Design: `.limcode/design/agent-scheduler-phase-4-roadmap.md`

## 1. 目标

在当前 scheduler observability 后端能力已经具备 `operator projection + agent projection + ownership/workers/rebalance query surfaces` 的前提下，优先把 scheduler 从“后端可读能力”升级为“前端可消费的 operator 主观测面”。

本阶段不继续优先扩展新的 scheduler runtime 内核语义，而是先完成：

- web 侧 scheduler API client / 类型与现有后端读模型对齐
- Overview 改为消费 `/api/runtime/scheduler/operator`
- Agent 改为消费 `/api/agent/:id/scheduler/projection`
- 新增独立 Scheduler Workspace，作为系统级主观测面入口
- 建立 run / decision / worker / partition 级 drill-down 基线

## 2. 背景与判断

当前代码状态显示：

- 服务端已具备 `GET /api/runtime/scheduler/operator`，返回 `latest_run / summary / trends / recent_runs / recent_decisions / ownership / workers / rebalance / highlights`
- 服务端已具备 `GET /api/agent/:id/scheduler/projection`，返回 `summary / reason_breakdown / skipped_reason_breakdown / timeline / linkage`
- 前端 Overview 仍在分别拉取 `runs + decisions + summary + trends`
- 前端 Agent 仍在消费 `listAgentDecisions()`，尚未切换到 agent projection
- 当前 `apps/web/features/*` 下尚无独立 `scheduler/` 工作区，`shell` 也没有 scheduler workspace

因此，本阶段的主线不是再发明新的观测数据，而是：

1. 先把已有 projection 变成稳定、统一、前端可直接消费的主观测面
2. 再在此基础上补充 drill-down 与更强解释能力

## 3. 实施范围

### 3.1 Web API / 类型对齐

扩展 `apps/web/composables/api/useSchedulerApi.ts`，新增并对齐以下读面：

- `getOperatorProjection()`
- `getAgentProjection(agentId)`
- `listOwnershipAssignments()`
- `listOwnershipMigrations()`
- `listWorkers()`
- `listRebalanceRecommendations()`

同时同步增强现有前端 DTO，覆盖后端已经返回但前端尚未消费的字段，例如：

- run 侧：`partition_id`、`lease_holder`、`lease_expires_at_snapshot`、`cross_link_summary`
- decision 侧：`scheduler_run_id`、`partition_id`、`workflow_link`、`coalesced_secondary_reason_count`、`has_coalesced_signals`
- projection 侧：`ownership`、`workers`、`rebalance`、`highlights`、`linkage`

如有必要，可继续把 scheduler response schema 补进 `packages/contracts/src/scheduler.ts`，减少 server/web 手写类型漂移。

### 3.2 Overview 接入 operator projection

改造 `apps/web/features/overview/composables/useOverviewPage.ts`，将当前散装调用：

- `listRuns()`
- `listDecisions()`
- `getSummary()`
- `getTrends()`

收敛为以 `/api/runtime/scheduler/operator` 为主的数据入口。

Overview 在本阶段只承担 scheduler 总览预览，不承载全部深度诊断。建议保留：

- highlights / key metrics
- recent runs preview
- recent decisions preview
- 进入独立 Scheduler Workspace 的入口

### 3.3 Agent 接入 agent projection

改造 `apps/web/features/agents/composables/useAgentPage.ts`，由 `listAgentDecisions()` 切换到 `/api/agent/:id/scheduler/projection`。

目标是让 Agent 页面直接复用服务端已聚合好的：

- actor summary
- top reason / top skipped reason
- breakdowns
- timeline
- recent related runs / recent created jobs linkage

Agent 页的 adapter 主要承担 view-model 映射，不再重复做 summary 聚合逻辑。

### 3.4 新增独立 Scheduler Workspace

新增：

- `apps/web/pages/scheduler.vue` 或 `pages/scheduler/index.vue`
- `apps/web/features/scheduler/*`
- `apps/web/stores/shell.ts` 中的 `scheduler` workspace 注册

Workspace 首屏建议由以下板块组成：

1. **Health / Highlights Strip**
   - latest partition
   - latest created/skipped
   - top reason / workflow state
   - stale worker
   - migration in progress
   - latest rebalance status / suppress reason

2. **Summary / Trends**
   - sampled runs
   - created/skipped/signals totals
   - periodic vs event-driven
   - top reasons / skipped reasons / intent classes
   - recent trend points

3. **Topology / Ownership**
   - partition ownership table
   - worker runtime health
   - recent migrations
   - rebalance recommendations / suppressions / applies

4. **Recent Activity**
   - recent runs
   - recent decisions
   - clear entry points to run detail / workflow / agent

### 3.5 Drill-down 基线

本阶段至少建立以下 drill-down：

- `SchedulerRun -> run detail`
- `CandidateDecision -> workflow job / agent context`
- `partition -> ownership/migration/rebalance filtered view`
- `worker -> worker runtime / owned partitions / rebalance related view`

注意：

- `/api/runtime/scheduler/operator` 负责首页聚合
- 深查仍应依赖已有细分接口，而不是继续无限膨胀 operator projection

## 4. 非目标

本阶段不优先处理以下事项：

- 新的 scheduler runtime 调度策略
- 更复杂 automatic rebalance policy 的核心算法升级
- decision 级新持久化模型重构
- 大量新增 operator projection 字段来替代 drill-down 接口
- 完整的 operator-forced workflow control plane

这些属于后续阶段，可在 Scheduler Workspace 稳定后再推进。

## 5. 技术设计要点

### 5.1 以 projection 为主、query surface 为辅

建议采用两层读面策略：

- **projection**：面向首屏与 overview，总览化、聚合化、轻量解释
- **query/detail surfaces**：面向深查与 drill-down，保留过滤、列表、详情能力

对应关系：

- 首页/总览：`/api/runtime/scheduler/operator`
- 运行历史：`/api/runtime/scheduler/runs`
- 单次 run：`/api/runtime/scheduler/runs/:id`
- 决策列表：`/api/runtime/scheduler/decisions`
- actor 视角：`/api/agent/:id/scheduler/projection`
- ownership / migrations / workers / rebalance：各自 query API

### 5.2 前端只做 view-model 映射，不重复做核心聚合

服务端既然已经提供：

- summary
- breakdown
- highlights
- linkage

前端应尽量直接消费这些字段，只做：

- 展示文案映射
- tone / badge / card 组装
- 页面级导航与 source-context 传递

避免在多个页面里重复写一套本地汇总逻辑，导致 server/web 语义漂移。

### 5.3 独立 Scheduler Workspace 应成为主入口

Overview 可继续保留 scheduler 卡片，但定位应调整为：

- 首屏预览
- 异常提示
- 快速跳转

真正的系统级 scheduler 观测和调试，应进入独立 Scheduler Workspace 完成。

### 5.4 优先建立导航闭环

需要保证以下路径用户可连续操作：

- overview -> scheduler workspace
- scheduler recent decision -> workflow / agent
- workflow / agent detail -> return to scheduler source
- partition / worker 相关条目 -> filtered scheduler views

这部分应复用现有 `source-context` / `operator navigation` 体系，避免再发明新路由语义。

## 6. 验证与测试

### 6.1 前端单测

建议至少覆盖：

- `useSchedulerApi` 新增接口 query 拼接与返回类型
- Overview scheduler projection adapter / composable
- Agent scheduler projection adapter / composable
- Scheduler Workspace 的关键 view-model builder
- navigation / source-context 对 scheduler 来源参数的构造与回跳逻辑

### 6.2 联调验证

至少验证以下场景：

1. Overview 首屏能稳定显示 scheduler highlights 与 recent activity
2. Agent 页面能显示 projection summary + breakdown + timeline
3. Scheduler Workspace 能显示 ownership/workers/rebalance 三类系统级观测信息
4. recent decision 点击后能正确跳到 workflow 或 agent
5. stale worker / migration / rebalance 信息在 UI 上可直接识别

### 6.3 文档同步

按实际交付同步：

- `apps/web/README.md`
- `docs/API.md`
- `TODO.md`
- `记录.md`

如新增前端 workspace 或导航入口，也应更新相应 README/说明文档。

## 7. 风险与控制

### 风险 1：继续把 Overview 做成 scheduler 全功能页

影响：

- 页面职责继续膨胀
- scheduler 无法形成独立 operator 心智入口

控制：

- Overview 只保留预览
- 深度观测统一进入 Scheduler Workspace

### 风险 2：前端重复聚合服务端已有数据

影响：

- summary / breakdown 语义漂移
- 不同页面出现不一致解释

控制：

- 优先消费服务端 projection 字段
- adapter 仅承担展示映射

### 风险 3：把 operator projection 当成唯一接口

影响：

- 首页载荷持续膨胀
- 深查能力反而变差

控制：

- operator projection 仅做首屏
- 深查使用 runs / decisions / ownership / workers / rebalance 等细分接口

### 风险 4：做了页面但没有 drill-down 闭环

影响：

- 只能看摘要，无法真正定位问题

控制：

- 以“能从 summary 点到 detail，再回到来源”为验收标准之一

## 8. 验收标准

- web 侧已补齐 operator/agent projection 与 ownership/workers/rebalance API client
- Overview 以 `/api/runtime/scheduler/operator` 为主完成 scheduler 预览接入
- Agent 页面已切换为 `/api/agent/:id/scheduler/projection`
- 新增独立 Scheduler Workspace，能展示 highlights、summary/trends、ownership/workers/rebalance、recent activity
- 至少具备 run / decision / worker / partition 四类 drill-down 入口
- 相关单测、联调验证通过
- README / API / TODO / 记录 已同步当前 operator 主观测面边界

## 9. 建议实施顺序

1. 先做 `useSchedulerApi` 与前端类型对齐
2. 再改 Overview 与 Agent，尽快验证 projection 是否足够支撑 UI
3. 然后新增独立 Scheduler Workspace
4. 最后补 drill-down、测试与文档

这个顺序可以最大化复用现有后端读面，避免在前端结构未成型前就继续追加新的服务端聚合字段。
