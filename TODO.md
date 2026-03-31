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
  - 已有：pending job queue、loop runner、workflow snapshot、retry、idempotency replay、replay lineage baseline
  - 待补：richer replay orchestration、durable scheduling、multi-worker safety
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

- [ ] 补齐 richer replay orchestration 与更 durable 的 job scheduling 语义
- [ ] 扩展更多 constrained world mutation actions 与 local-variable primitives
- [ ] 补齐 long-term memory 与更强 prompt strategy
- [ ] 在 L4 上继续扩展 transmission / system simulation

## M3 - Frontend Capability / 前端能力完善

Status: Pending Review / 待讨论

- [ ] 前端布局与产品化交互待统一讨论后重写
- [~] Frontend contract/client baseline 已从 clock 路径起步，后续继续扩到更多 product-facing 视图
- [ ] `apps/web/components/L2Graph.vue` 的 Nuxt/Vue/Cytoscape DOM typing 兼容问题保留为前端后续项

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

Last Updated / 最后更新: 2026-03-30
