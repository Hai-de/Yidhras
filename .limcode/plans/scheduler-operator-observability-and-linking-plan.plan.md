## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 梳理现有 scheduler API / 前端消费面与 operator 联动缺口，冻结本轮范围  `#sched-op-1`
- [ ] 设计 Scheduler/Operator 前端信息架构：Overview / Workflow / Agent / Shell 的观测与 drill-down 路径  `#sched-op-2`
- [ ] 设计导航/source-context 扩展方案，纳入 scheduler run / decision 来源语义  `#sched-op-3`
- [ ] 制定实施顺序、文件改动清单、验收标准与测试计划  `#sched-op-4`
<!-- LIMCODE_TODO_LIST_END -->

# Scheduler / Operator 观测与联动开发计划

> 目标：在不打断当前前端主架构（CSR / Operator Shell / feature composables / route-state）的前提下，把现有 scheduler 数据从“最小读取能力”升级为“operator 可理解、可跳转、可回溯”的前端观测与联动能力，为下一轮正式开发做冻结计划。

## 1. 当前基线

### 1.1 已有后端查询面
根据 `docs/API.md`、`apps/web/composables/api/useSchedulerApi.ts` 与 server e2e，可确认当前 scheduler 相关 API 已具备：

- `GET /api/runtime/scheduler/runs`
- `GET /api/runtime/scheduler/runs/latest`
- `GET /api/runtime/scheduler/runs/:id`
- `GET /api/runtime/scheduler/decisions`
- `GET /api/runtime/scheduler/summary`
- `GET /api/runtime/scheduler/trends`
- `GET /api/agent/:id/scheduler`

当前前端已正式接入的仅包括：

- Overview：`listRuns({ limit: 5 })`、`listDecisions({ limit: 5 })`
- Agent：`listAgentDecisions(agentId)`
- Workflow / Graph / Social / Timeline：尚未形成 scheduler projection 级消费
- 前端 API client 中尚未消费 `summary` 与 `trends`

### 1.2 已有前端联动基线
当前已有：

- `features/shared/navigation.ts`：已支持 `sourceRunId` / `sourceDecisionId` query 拼装
- `features/shared/source-context.ts`：目前仅识别 `social | timeline | graph`，尚未识别 `overview | workflow | agent`
- Overview：已可从 run / decision 列表 drill-down 到 workflow / agent
- Agent：已可从 scheduler decision 跳到 workflow job
- Workflow：已有 `SourceContextBanner`，但缺少 scheduler context 展示与回跳

### 1.3 当前缺口

1. **没有正式的 Scheduler Operator Panel / Workspace**
2. **Overview / Agent 对 scheduler 的展示仍偏 recent list，不够解释型**
3. **Workflow detail 未暴露 scheduler 来源上下文**
4. **source-context 对 scheduler 来源不完整，return-to-source 不能覆盖 overview/workflow/agent**
5. **尚未消费 `summary` / `trends` 这类更 operator-friendly 的 projection**
6. **缺少 scheduler / navigation / source-context 的 feature-level 测试**

---

## 2. 本轮目标

本轮聚焦 **Phase 4B（Operator Projection）前端侧**，不改动 scheduler 并发语义，不要求新增 server contract。

### 2.1 核心目标

1. 让 scheduler 成为前端可消费的 operator 观测面
2. 让 Overview / Agent / Workflow 形成 scheduler drill-down 闭环
3. 把 scheduler 来源语义纳入统一 source-context / navigation contract
4. 为后续更独立的 scheduler workspace 保留演进空间

### 2.2 非目标

本轮不纳入：

- server 端 partitioned scheduling / stronger multi-worker semantics
- replay-aware policy 的新增后端语义
- SSR / hydration 方向变更
- 大规模 UI 自动化测试
- Graph / Social / Timeline 的二次产品化大改版

---

## 3. 信息架构与交互方案

## 3.1 Overview：作为 scheduler 总入口

### 目标
把现有 Overview 中的 scheduler 区域从“最近 5 条列表”增强为“operator 可扫读的入口区”。

### 交付

#### A. 接入 summary / trends
在 `useOverviewPage.ts` 中额外读取：

- `schedulerApi.getSummary(sampleRuns)`
- `schedulerApi.getTrends(sampleRuns)`

前提：先扩展 `useSchedulerApi.ts` 增加类型与 client 方法。

#### B. Overview 新增 scheduler summary 区块
新增组件建议：

- `features/overview/components/SchedulerSummaryCard.vue`
- `features/overview/components/SchedulerTrendsCard.vue`

展示内容：

- latest run 概览
- run_totals
- top reasons
- top skipped reasons
- top actors
- intent class breakdown
- 最近趋势点（最小 sparkline 或列表化 trend）

#### C. 保留 recent runs / decisions 列表，但增加解释字段
通过 `features/overview/adapters.ts` 增强 list item subtitle / badges：

- run：created / skipped / worker / signals
- decision：actor / chosen_reason / kind / skipped_reason / created_job_id

### Drill-down 方向

- Scheduler Run → Workflow（带 `scheduler_run_id`）
- Scheduler Decision → Workflow Job（若有 `created_job_id`）
- Scheduler Decision → Agent（若没有 created job）

### 涉及文件

- `apps/web/pages/overview.vue`
- `apps/web/features/overview/composables/useOverviewPage.ts`
- `apps/web/features/overview/adapters.ts`
- `apps/web/composables/api/useSchedulerApi.ts`
- 可新增 `apps/web/features/overview/components/SchedulerSummaryCard.vue`
- 可新增 `apps/web/features/overview/components/SchedulerTrendsCard.vue`

---

## 3.2 Workflow：增加 scheduler 来源解释层

### 目标
让 Workflow detail 能回答：

- 这个 job 是 scheduler 触发的吗？
- 来自哪个 run / decision？
- 为什么会创建？
- 当前页是从 overview / agent / scheduler source 打开的吗？

### 交付

#### A. 解析 route/source 中的 scheduler context
在 `useWorkflowPage.ts` 中读取并暴露：

- `scheduler_run_id`（已有导航入口）
- `source_run_id`
- `source_decision_id`
- `source_agent_id`

#### B. 在 WorkflowDetailPanel 增加 Scheduler Context 区块
新增/增强展示字段：

- scheduler run id
- scheduler decision id
- actor id
- chosen reason
- skipped reason（若来自 decision 上下文）
- job source / intent class（若 workflow job detail 中已有可见字段）

#### C. 增加回跳与来源提示
若当前由：

- overview → workflow
- agent → workflow
- workflow 内部追踪打开

则 `SourceContextBanner` 与 return 行为需要稳定工作。

### 数据策略
本轮优先使用 **route/source context + 已有 job/request_input 可见字段** 完成首轮解释；
若现有 workflow detail API 不足，再评估后续追加 server contract，而不是本轮先改后端。

### 涉及文件

- `apps/web/pages/workflow.vue`
- `apps/web/features/workflow/composables/useWorkflowPage.ts`
- `apps/web/features/workflow/components/WorkflowDetailPanel.vue`
- `apps/web/features/shared/source-context.ts`
- `apps/web/features/shared/navigation.ts`

---

## 3.3 Agent：把 scheduler timeline 从附属卡片提升为分析入口

### 目标
让 Agent 页能清晰回答：

- 该 agent 最近为什么被调度
- 最近为什么被跳过
- 最近是否创建了相关 job
- 能否继续 drill-down 到 workflow

### 交付

#### A. 丰富 AgentSchedulerCard
增强展示：

- chosen reason
- skipped reason / outcome
- scheduled_for_tick
- created job linkage
- cadence kind

#### B. Agent 页增加 scheduler summary 辅助信息
基于 `schedulerDecisions` 生成：

- total recent decisions
- created vs skipped count
- top reason
- latest scheduled tick

可直接在 `[id].vue` 页面右侧 summary 区块或 AgentSchedulerCard header 展示。

#### C. drill-down 统一化
`openSchedulerDecision` 行为修正为：

- 若有 `created_job_id` → `goToWorkflowJob(created_job_id, sourcePage='agent', sourceAgentId=...)`
- 若无 created_job_id 但 decision 本身存在 → 不应错误复用 `goToWorkflowWithSchedulerRun(decisionId)` 当作 runId

当前 `useAgentPage.ts` 存在这个语义问题，需要修正。推荐改为：

- 跳到 Agent 自身 tab / 保持不动并提示无 job
- 或跳到 Workflow 并附带 `source_decision_id` / `source_agent_id` 上下文（若 workflow 将支持 decision context）

### 涉及文件

- `apps/web/pages/agents/[id].vue`
- `apps/web/features/agents/composables/useAgentPage.ts`
- `apps/web/features/agents/components/AgentSchedulerCard.vue`
- `apps/web/features/agents/adapters.ts`
- `apps/web/features/shared/navigation.ts`

---

## 3.4 Shell：最小 scheduler presence，而不是独立大面板

### 目标
本轮先不单独创建重型 `/scheduler` 页面，但要让 shell 层感知 scheduler 运行状态。

### 交付

可选最小增强：

- 在 `TopRuntimeBar.vue` 增加 scheduler badge：
  - latest run status / last sample freshness
  - 或来自 overview summary 的轻量状态 pill
- 不单独引入大查询交互，避免本轮范围膨胀

### 涉及文件

- `apps/web/features/shell/components/TopRuntimeBar.vue`
- `apps/web/stores/runtime.ts`（若需要全局缓存）
- `apps/web/composables/app/useOperatorBootstrap.ts`（仅在必要时）

---

## 4. 导航与 Source Context 统一方案

## 4.1 现状问题
`navigation.ts` 已经支持：

- `sourceRunId`
- `sourceDecisionId`
- `sourceAgentId`

但 `source-context.ts` 还没有完整消费这些 query，也未识别：

- `overview`
- `workflow`
- `agent`

这会导致 source banner 与 return-to-source 在 scheduler/operator 场景不完整。

## 4.2 方案

### A. 扩展合法 source page
在 `source-context.ts` 中让 `normalizeSourcePage` 支持：

- `overview`
- `workflow`
- `agent`
- 保持 `social | timeline | graph`

### B. 扩展 source query 解析
新增 route query：

- `source_run_id`
- `source_decision_id`
- `source_agent_id`

并纳入 `source` computed。

### C. 扩展 summary 文案
增加：

- Opened from overview scheduler view
- Opened from workflow console
- Opened from agent <id>
- Opened from scheduler run <id>
- Opened from scheduler decision <id>

### D. return-to-source 规则统一
各 feature composable 的 `returnToSource()` 优先级建议：

1. social post
2. timeline event
3. graph root/node
4. agent detail
5. workflow console（保留已知 query）
6. overview

其中 workflow / overview 回跳只恢复主定位，不恢复纯临时 UI 状态。

### 涉及文件

- `apps/web/features/shared/navigation.ts`
- `apps/web/features/shared/source-context.ts`
- `apps/web/features/workflow/composables/useWorkflowPage.ts`
- `apps/web/features/agents/composables/useAgentPage.ts`
- `apps/web/features/overview/composables/useOverviewPage.ts`

---

## 5. API Client 扩展计划

当前 `useSchedulerApi.ts` 缺少 `summary` 与 `trends` client。

## 5.1 新增类型
建议增加：

- `SchedulerSummarySnapshot`
- `SchedulerTrendPoint`
- `SchedulerTrendsSnapshot`

字段以 `docs/API.md` 为准：

- summary: `latest_run, run_totals, top_reasons, top_skipped_reasons, top_actors, intent_class_breakdown`
- trends: `points[]`

## 5.2 新增方法
建议增加：

- `getSummary(input?: { sampleRuns?: number })`
- `getTrends(input?: { sampleRuns?: number })`

### 涉及文件
- `apps/web/composables/api/useSchedulerApi.ts`

---

## 6. 实施拆分

## Phase B1 — Scheduler API Consumption & Overview Projection

### 目标
先把现有 API 在前端完整消费起来，并在 Overview 上形成新的 operator summary。

### 工作项
1. 扩展 `useSchedulerApi.ts` 的 summary / trends client 与类型
2. 在 `useOverviewPage.ts` 中并行拉取 summary / trends
3. 新增 Overview scheduler summary / trends 组件
4. 增强 run / decision list adapters
5. 完成 overview 页面编排

### 验收
- Overview 上可见 scheduler summary / trends / recent lists
- 点击 recent run / decision drill-down 正常
- 不破坏 overview 现有刷新与 freshness

---

## Phase B2 — Source Context / Navigation Contract 收口

### 目标
把 scheduler/operator 来源语义纳入统一 contract。

### 工作项
1. 扩展 `source-context.ts` 支持 overview/workflow/agent/scheduler ids
2. 调整各 feature composable 的 returnToSource 分支
3. 校正 navigation 中 scheduler 来源字段的使用方式
4. 修正 Agent decision → workflow 的错误 runId 语义

### 验收
- workflow / agent / overview 间 drill-down 都能稳定 return
- source banner 文案对 scheduler/operator 场景可解释
- 不再把 decisionId 当作 runId 使用

---

## Phase B3 — Workflow / Agent Scheduler Context UI

### 目标
让 Workflow / Agent 真正消费 scheduler source，而不是只保留入口。

### 工作项
1. WorkflowDetailPanel 新增 scheduler context 区块
2. `useWorkflowPage.ts` 暴露 scheduler source view model
3. AgentSchedulerCard 增强展示字段与 summary
4. `[id].vue` 增加 scheduler summary metrics

### 验收
- 从 Overview / Agent 打开的 workflow 能解释 scheduler 来源
- Agent 页面能一眼看出最近调度原因与结果
- 跨页联动闭环可用

---

## Phase B4 — 测试与质量门禁

### 目标
对关键 operator 联动逻辑建立最小可回归测试。

### 建议新增测试

#### 1. `tests/unit/navigation.spec.ts`
覆盖：
- `goToWorkflowJob`
- `goToWorkflowWithSchedulerRun`
- `goToAgent`
- source query 拼装

#### 2. `tests/unit/source-context.spec.ts`
覆盖：
- source_page 解析
- scheduler source summary
- social/timeline semantic hint 不回退

#### 3. `tests/unit/overview.scheduler.spec.ts`
覆盖：
- scheduler summary/trends adapter
- recent run/decision item adapter

#### 4. `tests/unit/agent.page.spec.ts`
覆盖：
- `openSchedulerDecision` 正确分支
- 无 job 的 decision 行为

#### 5. `tests/unit/workflow.page.spec.ts`
覆盖：
- scheduler source context 暴露
- returnToSource 分支

### 质量门禁

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test:unit
```

---

## 7. 文件改动清单

### 必改
- `apps/web/composables/api/useSchedulerApi.ts`
- `apps/web/pages/overview.vue`
- `apps/web/features/overview/composables/useOverviewPage.ts`
- `apps/web/features/overview/adapters.ts`
- `apps/web/pages/workflow.vue`
- `apps/web/features/workflow/composables/useWorkflowPage.ts`
- `apps/web/features/workflow/components/WorkflowDetailPanel.vue`
- `apps/web/pages/agents/[id].vue`
- `apps/web/features/agents/composables/useAgentPage.ts`
- `apps/web/features/agents/components/AgentSchedulerCard.vue`
- `apps/web/features/agents/adapters.ts`
- `apps/web/features/shared/navigation.ts`
- `apps/web/features/shared/source-context.ts`

### 可选新增
- `apps/web/features/overview/components/SchedulerSummaryCard.vue`
- `apps/web/features/overview/components/SchedulerTrendsCard.vue`
- `apps/web/tests/unit/navigation.spec.ts`
- `apps/web/tests/unit/source-context.spec.ts`
- `apps/web/tests/unit/overview.scheduler.spec.ts`
- `apps/web/tests/unit/agent.page.spec.ts`
- `apps/web/tests/unit/workflow.page.spec.ts`

---

## 8. 风险与控制

### 风险 1：前端过度依赖尚不稳定的 workflow-scheduler 细节契约
控制：
- 本轮优先使用已有 query/source/job metadata 做解释
- 不足部分先做 nullable UI，而不是立刻扩后端

### 风险 2：source-context 规则继续分散
控制：
- 本轮统一在 `navigation.ts` / `source-context.ts` 收口
- 页面 composable 仅消费统一 source model

### 风险 3：Overview 变得过重
控制：
- summary / trends 保持轻量卡片
- 不在本轮做独立复杂筛选器和大表格

### 风险 4：Agent decision drill-down 语义错误继续扩散
控制：
- 本轮优先修正 `decisionId -> runId` 的错误用法
- 相关测试补齐

---

## 9. 完成定义

当以下条件同时满足时，本轮计划可视为完成：

1. Overview 已正式消费 scheduler `summary + trends + recent runs + recent decisions`
2. Workflow detail 能展示 scheduler 来源上下文
3. Agent 页面具备更完整的 scheduler timeline / summary 能力
4. `navigation.ts` / `source-context.ts` 对 scheduler/operator 来源语义完成统一收口
5. 不再存在把 `decisionId` 当作 `runId` 的跳转语义错误
6. `typecheck / lint / test:unit` 持续通过

---

## 10. 推荐开发顺序

1. **先做 API client 扩展 + Overview scheduler projection**
2. **再做 source-context / navigation 收口**
3. **然后做 Workflow / Agent scheduler context UI**
4. **最后补测试与质量门禁**

---

## 11. 本轮结论

本轮开发不建议先开一个重型独立 Scheduler 页面，而应优先把：

- Overview
- Workflow
- Agent
- shared navigation/source-context

这四个点串成最小闭环。

这样做的好处是：

- 最大化复用现有 operator shell 架构
- 风险低，不依赖新的后端 contract
- 能最快把现有 scheduler observability 转化为真正可用的 operator 能力
- 为未来独立 `features/scheduler/*` 工作区保留清晰演进路径
