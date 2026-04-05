# TODO

## M1 - Backend and Runtime / 后端与运行时

Status: In Progress / 聚焦最小 Demo 收口中

- [x] 基础 Express + Prisma 服务骨架、统一 envelope、错误码与最小 status/clock API
- [x] 最小 inference / timeline / graph / social / workflow 读写链路
- [x] inference / graph / relational / timeline / social contracts + Zod 运行时边界
- [x] workflow query / detail / retry baseline
- [x] Agent Scheduler / Replay / Durable Workflow runtime 最小主线已具备
  - 已有：pending job queue、loop runner、Agent Scheduler v1/v2/v3/v3c/p4a/p4s/p4r-baseline/p4r-fine/p4c-baseline/dynamic-ownership-baseline/automatic-rebalance-baseline（durable scheduling + event-driven policy baseline + scheduler stats + scheduler observability read model + lease/cursor leader-only safety + runs/decisions/summary/trends/operator projection + partition ownership/migration + worker runtime state + automatic rebalance read surface）
  - 延后：更深 scheduler/operator 读面、richer replay orchestration、更强 automatic rebalance 策略、operator-forced workflow semantics 已转入 `docs/ENHANCEMENTS.md`
- [x] Memory Core baseline
  - 已有：MemoryTrace persistence、recent trace read、agent overview memory summary
  - 延后：更长期/分层 memory read model 与 retrieval/aggregation 已转入 `docs/ENHANCEMENTS.md`
- [x] Audit / Review Surfaces baseline
  - 已有：统一 audit feed、detail read、基础过滤、cursor、workflow related-record aggregation、replay-lineage detail
  - 延后：更完整 operator 视图与更强关联观测 已转入 `docs/ENHANCEMENTS.md`
- [x] Mutation Semantics baseline
  - 已有：`relationship_adjustment` / `snr_adjustment` 的 resolved-intent detail shape
  - 延后：更广的写路径规范化与未来 delta-capable world actions 已转入 `docs/ENHANCEMENTS.md`

### Next / 下一步

- [ ] 围绕现有 runtime / workflow / scheduler / operator console 闭环整理最小 demo 路径，并用 smoke / walkthrough 方式确认“流程流通”已成立
- [ ] 在 `death_note` world-pack scenario-driven 主线下，继续收口“notebook_discovered -> claim_death_note -> murderous_intent_formed -> timeline/operator evidence” 的完整 walkthrough 与验证说明

## M2 - Frontend Operator Console / 前端控制台

Status: In Progress / 聚焦最小 Demo 收口中

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
- [x] shell 级 runtime / notification 联动 baseline 已具备
  - 已有：TopRuntimeBar 全局状态摘要、refresh all、dock toggle、notifications 聚合 getters、ShellContext 聚合层、Sidebar context 区块、shell 级 return_to_source、recent targets 与 BottomDock jobs/traces 最小回看层
  - 延后：notifications center 深化（code/details/clear actions）、BottomDock traces/jobs 更真实的数据模型、可选 recent target 持久化 / command palette 已转入 `docs/ENHANCEMENTS.md`
- [x] Scheduler operator workspace Phase 4B baseline 已进入主线
  - 已有：Overview 直接消费 `/api/runtime/scheduler/operator`、Agent 页面直接消费 `/api/agent/:id/scheduler/projection`、独立 `pages/scheduler.vue` + `features/scheduler/*`、shell `scheduler` workspace、recent runs / decisions / ownership / workers / rebalance 基础 drill-down
  - 延后：更深 decision detail、worker/actor hot spots、更强 cross-linking 到 workflow/audit/graph 已转入 `docs/ENHANCEMENTS.md`
- [x] 当前 operator console 已具备支撑最小 demo 的基础页面与导航闭环
  - 范围：Overview / Workflow / Graph / Social / Timeline / Agent / Scheduler
  - 延后：更多 UI 层测试或 feature-level store/composable tests 已转入 `docs/ENHANCEMENTS.md`

## M4 - Content and Data Packs / 内容与世界包

Status: Deferred to Enhancements / 当前已转入增强池

- 当前最小 demo 继续复用现有 world-pack / configw baseline。
- world-pack schema contract、pack-level metadata / registry / docs tooling、provider-owned presentation/theme/data authoring 示例与校验路径 已转入 `docs/ENHANCEMENTS.md`
