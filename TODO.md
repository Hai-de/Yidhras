# Yidhras Milestones / 里程碑计划

本文件只用于里程碑优先级管理与当前阶段状态，不记录 lint 历史、验收证据或详细技术设计。
This file tracks milestone priorities and current stage status only; it is not the place for lint history, verification evidence, or detailed technical design.

## M0 - Engineering Baseline / 工程基线

Status: Completed / 已完成

- [x] 建立前后端 ESLint + Prettier 工程基线
- [x] 为两个应用补齐 `lint` / `typecheck` 脚本
- [x] 跑通基础质量检查并完成首轮清理
- [x] 将历史 lint/验证结果收敛到 `记录.md`

## M1 - Runtime Stability / 运行稳定性

Status: Completed / 已完成

- [x] Chronos engine + BigInt ticks + multi-calendar conversion
- [x] Narrative resolver + permission filtering
- [x] Value dynamics manager baseline
- [x] 全局通知队列与基础 API
- [x] 统一错误包络与 request-id tracing
- [x] `/api/health` / `/api/status` 与 degraded mode 启动基线
- [x] 统一运行前置准备命令 `prepare:runtime`
- [x] world-pack-gated 接口统一 `503/WORLD_PACK_NOT_READY`
- [x] 统一运行时速度策略与状态暴露
- [x] 启动流程与关键端点冒烟脚本接入

## M2 - Core Simulation Features / 核心模拟功能

Status: In Progress / 进行中

### Done / 已完成

- [x] Identity Layer：deny > allow、wildcard field、ABAC-ready claims/conditions 基线
- [x] Identity Binding：bind/query/unbind/expire API、active 唯一性约束、runtime auto-expire
- [x] 正式路线从临时探索切换为明确的 B → D 工程推进路径
- [x] Inference Phase B：统一推理服务入口、context/prompt builder、strategy injection、preview/run API、normalized decision contract、trace metadata 基线
- [x] Workflow Phase D 最小基线：`InferenceTrace` / `ActionIntent` / `DecisionJob`、Prisma 持久化、trace/intent/job 读取能力、jobs 正式入口

### In Progress / 进行中

- [~] Workflow Persistence Phase D
  - 已有：pending job queue、loop runner、Agent Scheduler v1/v2/v3/v3c/p4a/p4s/p4r-baseline/p4r-fine（durable scheduling + event-driven policy baseline + scheduler stats + scheduler observability read model + lease/cursor leader-only safety + filtered/paginated scheduler runs/decisions query API + scheduler summary/trend projections + replay/retry recovery-window periodic suppression baseline + fine-grained priority-aware replay/retry suppression） 、workflow snapshot、retry、idempotency replay、replay lineage baseline、DecisionJob intent_class / job_source baseline
  - 待补：richer replay orchestration、operator-facing scheduler panel / cross-linking、partitioned scheduling / stronger multi-worker semantics、更细 actor readiness / recovery policy
- [~] Memory Core
  - 已有：short-term adapter、fragment-friendly prompt pipeline、memory selection / processing trace observability
  - 待补：real long-term retrieval/storage、更强 summarization / trimming 策略
- [~] Action Dispatcher
  - 已有：`post_message`、`adjust_relationship`、`adjust_snr`、`trigger_event` 最小路径与基础审计能力
  - 待补：更广的 world-action mapping 与更丰富的 L4 语义
- [~] Contract / Validation Baseline
  - 已有：`packages/contracts`、server-side Zod boundary helper、已交付路由批次接入、前端 clock 路径最小接入
  - 待补：更广的前端消费收敛、更多 response/runtime contract enforcement
- [~] Audit / Observability
  - 已有：统一 audit feed、detail read、基础过滤、cursor、workflow related-record aggregation、replay-lineage detail
  - 待补：更完整 operator 视图与更强关联观测
- [~] Mutation Semantics
  - 已有：`relationship_adjustment` / `snr_adjustment` 的 resolved-intent detail shape
  - 待补：更广的写路径规范化与未来 delta-capable world actions

### Next / 下一步

- [ ] 基于 Agent Scheduler 现有 p4a baseline 继续补齐 operator 联动视图、scheduler timeline/read projection 与更强 multi-worker / partitioned scheduling 语义
- [ ] 继续补齐 richer scheduler/operator query surfaces（summary projection、trend、top actors/reasons）
- [ ] 补齐 richer replay orchestration 与更 durable 的 job scheduling 语义
- [ ] 扩展更多 constrained world mutation actions 与 local-variable primitives
- [ ] 补齐 long-term memory 与更强 prompt strategy
- [ ] 在 L4 上继续扩展 transmission / system simulation

## M3 - Frontend Capability / 前端能力完善

Status: Graph + Mapping Increment Completed / Graph 与语义映射增量已完成

### Delivered / 已交付

- [x] `apps/web` 完成目录重构 Phase 1–9：CSR、theme foundation、Operator shell、data fetching、route-state、Overview / Workflow / Graph / Social / Timeline / Agent 基线
- [x] 旧前端壳与遗留入口已清理：`stores/clock.ts`、`stores/system.ts`、`utils/api.ts` 等退出主线
- [x] 核心 store 单测已补齐：`runtime / shell / workflow / graph`
- [x] Operator UI polish 第一阶段已完成：
  - 统一页面骨架与反馈态
  - drill-down 来源上下文与回跳
  - Graph focus / root / result feedback
  - freshness 与轻量通知机制
- [x] 前端已形成冻结版 Guardrails 与验收标准，见 `.limcode/plans/frontend-operator-ui-polish-and-interaction-enhancement.plan.md`
- [x] 第二阶段产品增强首批已完成：
  - Workflow detail panel 强化
  - Social detail 信息密度与相关入口增强
  - Timeline 双栏结构与 detail pane 落地
  - 第二阶段手动验证链路与质量门禁已冻结
- [x] Graph 深化与 Timeline / Social 语义映射增量已完成：
  - Graph quick roots、search context、inspector 分组与动作解释增强
  - Timeline → Social intent-first / tick-scoped context
  - Social → Timeline slice-based context，移除误导性的 `post.id -> event_id` 假设
  - mapping context banner 与 string-first tick compare 已落地

### Next / 下一步

- [ ] 继续推进 shell 级 runtime / notification 联动，以及更丰富的 operator-facing semantic mapping read model
- [~] 补齐 scheduler operator projection（recent runs / recent decisions / agent timeline）并继续向 workflow/audit/graph cross-linking 扩展
- [ ] 视需要补更多 UI 层测试或 feature-level store/composable tests

## M4 - Content and Data Packs / 内容与世界包

Status: Planned / 规划中

- [ ] Formalize world-pack schema contract and validation checklist
- [ ] Expand sample world packs and scenario coverage
- [ ] Define native noise generation policy and balancing knobs

## 使用规则 / Rules

- 当前阶段状态以本文件为主。
- 详细接口/架构/逻辑说明放在 `docs/`。
- 验证证据、验收边界、历史快照放在 `记录.md`。
- 过程性拆解与执行计划放在 `.limcode/plans/`，不作为当前正式状态总表。

Last Updated / 最后更新: 2026-04-xx
