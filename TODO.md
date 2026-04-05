# TODO

## M1 - Backend and Runtime / 后端与运行时

Status: In Progress / 进行中

- [x] 基础 Express + Prisma 服务骨架、统一 envelope、错误码与最小 status/clock API
- [x] 最小 inference / timeline / graph / social / workflow 读写链路
- [x] inference / graph / relational / timeline / social contracts + Zod 运行时边界
- [x] workflow query / detail / retry baseline
- [~] Agent Scheduler / Replay / Durable Workflow runtime 深化
  - 已有：pending job queue、loop runner、Agent Scheduler v1/v2/v3/v3c/p4a/p4s/p4r-baseline/p4r-fine/p4c-baseline/dynamic-ownership-baseline/automatic-rebalance-baseline（durable scheduling + event-driven policy baseline + scheduler stats + scheduler observability read model + lease/cursor leader-only safety + runs/decisions/summary/trends/operator projection + partition ownership/migration + worker runtime state + automatic rebalance read surface）
  - 待补：richer replay orchestration、operator-facing scheduler panel / deeper cross-linking、更强 automatic rebalance 策略（更丰富 guardrails / recommendation policy / apply linkage）、更明确的 operator-forced workflow semantics
- [~] Memory Core
  - 已有：MemoryTrace persistence、recent trace read、agent overview memory summary
  - 待补：更长期/分层 memory read model 与可能的 retrieval/aggregation
- [~] Audit / Review Surfaces
  - 已有：统一 audit feed、detail read、基础过滤、cursor、workflow related-record aggregation、replay-lineage detail
  - 待补：更完整 operator 视图与更强关联观测
- [~] Mutation Semantics
  - 已有：`relationship_adjustment` / `snr_adjustment` 的 resolved-intent detail shape
  - 待补：更广的写路径规范化与未来 delta-capable world actions

### Next / 下一步

- [ ] 基于 Agent Scheduler 现有 p4a/p4c/dynamic-ownership/automatic-rebalance baseline 继续补齐 operator 联动视图、scheduler timeline/read projection 与更强 automatic rebalance 语义
- [ ] 继续补齐 richer scheduler/operator query surfaces（更深的 partition / worker breakdown、deeper highlights、ownership history、worker health、rebalance recommendation / suppress reason、cross-link drill-down）
- [ ] 补齐 richer replay orchestration 与更 durable 的 job scheduling 语义

## M2 - Frontend Operator Console / 前端控制台

Status: In Progress / 进行中

- [x] `apps/web` 完成目录重构 Phase 1–9：CSR、theme foundation、Operator shell、data fetching、route-state、Overview / Workflow / Graph / Social / Timeline / Agent 基线
- [x] 旧前端壳与遗留入口已清理：`stores/clock.ts`、`stores/system.ts`、`utils/api.ts` 等退出主线
- [x] 核心 store 单测已补齐：`runtime / shell / workflow / graph`
- [x] Operator UI polish 第一阶段已完成：
  - 统一页面骨架与反馈态
  - 来源上下文 banner / return_to_source
  - Graph focus/root/result feedback
  - freshness 与轻量通知反馈
- [x] Graph 深化与 Timeline / Social 语义映射增量已完成：
  - Graph quick roots、search context、inspector 分组与动作解释增强
  - Timeline → Social intent-first / tick-scoped context
  - Social → Timeline slice-based context，移除误导性的 `post.id -> event_id` 假设
  - mapping context banner 与 string-first tick compare 已落地
- [~] 继续推进 shell 级 runtime / notification 联动，以及更丰富的 operator-facing semantic mapping read model
  - 已有：TopRuntimeBar 全局状态摘要、refresh all、dock toggle、notifications 聚合 getters、ShellContext 聚合层、Sidebar context 区块、shell 级 return_to_source、recent targets 与 BottomDock jobs/traces 最小回看层
  - 待补：notifications center 深化（code/details/clear actions）、BottomDock traces/jobs 更真实的数据模型、可选 recent target 持久化 / command palette
- [~] Scheduler operator workspace Phase 4B 已进入主线
  - 已有：Overview 直接消费 `/api/runtime/scheduler/operator`、Agent 页面直接消费 `/api/agent/:id/scheduler/projection`、独立 `pages/scheduler.vue` + `features/scheduler/*`、shell `scheduler` workspace、recent runs / decisions / ownership / workers / rebalance 基础 drill-down
  - 待补：更深 decision detail、worker/actor hot spots、更强 cross-linking 到 workflow/audit/graph
- [ ] 视需要补更多 UI 层测试或 feature-level store/composable tests

## M4 - Content and Data Packs / 内容与世界包

Status: Planned / 规划中

- [ ] Formalize world-pack schema contract and validation checklist
- [ ] 增加 pack-level metadata / registry / docs tooling
- [ ] 完善 provider-owned presentation/theme/data authoring 示例与校验路径
