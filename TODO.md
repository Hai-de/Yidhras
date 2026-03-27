# Yidhras Milestones / 里程碑计划

本文件用于里程碑优先级管理，不用于记录 lint 历史问题。
This file tracks milestone priorities, not lint debt details.

## M0 - Engineering Baseline / 工程基线 (Highest Priority)

Status: Completed / 已完成

- [x] Add repo-level ESLint + Prettier baseline for `apps/server` and `apps/web`.
- [x] Add scripts: `lint` and `typecheck` in both app package manifests.
- [x] Run lint/typecheck, record current warnings in `记录.md`.
- [x] Mark temporary exceptions and cleanup window before feature sprint.

## M1 - Runtime Stability / 运行稳定性

Status: Completed / 已完成

### Currently Implemented / 当前已实现

- [x] Chronos engine with BigInt ticks and multi-calendar conversion.
- [x] Narrative resolver with nested variable resolution and permission filtering.
- [x] Value dynamics manager with pinning and pluggable algorithm support.
- [x] Basic global notification queue and API endpoints.
- [x] Unified API error envelope with request-id tracing in middleware.
- [x] Resilient startup preflight checks (`/api/health`, `/api/status`) with degraded mode support.
- [x] End-to-end smoke scripts for startup and key endpoints, integrated into CI.
- [x] Centralized startup preparation command (`prepare:runtime`) reused by dev scripts and CI.
- [x] Runtime-not-ready API consistency aligned (`503` + `WORLD_PACK_NOT_READY`) for world-pack-gated endpoints.
- [x] Unified runtime speed policy (single source for effective step ticks, loaded at init, observable via `/api/status.runtime_speed`).
- [x] Time stepping follow-up: add explicit runtime override control path (API/ops) on top of current unified policy when variable speed modes are needed.
### Notes / 说明

- No open M1-scoped gaps are currently tracked; future runtime expansion should be captured under M2.

## M2 - Core Simulation Features / 核心模拟功能

Status: In Progress / 进行中

### Currently Implemented / 当前已实现

- [x] Identity Layer: define policy order (deny > allow, priority tie-break), field wildcard rules, and ABAC-ready claims/conditions.
- [x] Identity Layer: active node and atmosphere node lifecycle policies (baseline delivered: bind/query/unbind/expire APIs, uniqueness guard for active binding, runtime auto-expire, seed with atmosphere node).
- [x] Formalize official delivery route: move from temporary B exploration to explicit B→D transition plan.
- [x] Inference Interface Phase B (D-ready): unified inference service, context/prompt builder, strategy injection, hardcoded prompt channel, preview/run APIs, normalized decision contract, trace metadata with pluggable sink, and inference-specific smoke coverage are now delivered as the current stable baseline.
- [x] Workflow Persistence Phase D (minimal baseline): persisted `InferenceTrace` / `ActionIntent` / `DecisionJob` models, Prisma-backed persistence sink, read APIs for trace/intent/job inspection, and `POST /api/inference/jobs` idempotency replay support.

### In Progress / 进行中

- [~] Workflow Persistence Phase D: minimal persisted `InferenceTrace` / `ActionIntent` / `DecisionJob` baseline, async `pending` job queue + loop runner, aggregate workflow read APIs, `POST /api/inference/jobs` replay semantics with `result_source + workflow_snapshot`, failed-job retry API, and structured failure-stage persistence are now landed; richer replay orchestration and broader runtime state progression remain to be completed.
- [~] Memory Core: short-term context adapter, noop long-term store contract, fragment-friendly prompt pipeline, chained prompt processors (`memory-injector` / `policy-filter` / `memory-summary` / `token-budget-trimmer`), and trace-side `memory_selection` / `prompt_processing_trace` observability are now landed; richer long-term retrieval/storage and more advanced policy/summarization/trimming strategies remain to be completed.
- [~] Action Dispatcher: first-pass `post_message` dispatch is now loop-driven and writes to social posts; minimal L4 transmission delay/drop semantics plus heuristic transmission-policy derivation are landed, while broader world-action mapping remains to be completed.

### Planned / 规划中

- [ ] Workflow Persistence Phase D: add richer replay orchestration, durable scheduling/locking semantics, and broader runtime workflow progression beyond the current single-process loop baseline.
- [ ] Memory Core: add real long-term retrieval/storage and stronger summarization/policy-aware trimming strategies on top of the current baseline.
- [ ] Action Dispatcher / L4: extend beyond current `post_message` delivery with broader world-action mapping and richer transmission/system simulation.

## M3 - Frontend Capability / 前端能力完善

Status: Pending Review / 待讨论

### Notes / 说明

- [ ] Layout is not finalized; UI will be redesigned after team discussion.
- [ ] 当前前端布局尚未确定，待讨论后再统一重写前端 UI。

## M4 - Content and Data Packs / 内容与世界包

Status: Planned / 规划中

- [ ] Formalize world-pack schema contract and validation checklist.
- [ ] Expand sample world packs and scenario coverage.
- [ ] Define native noise generation policy and balancing knobs.

## Milestone Rules / 里程碑规则

- Keep this file milestone-oriented and bilingual.
- Mark each section with `Currently Implemented`, `In Progress`, or `Planned` where relevant.
- Put lint debt and warnings only in `记录.md`.

Last Updated / 最后更新: 2026-03-27
