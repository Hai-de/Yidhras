# Yidhras Milestones / 里程碑计划

本文件用于里程碑优先级管理，不用于记录 lint 历史问题。
This file tracks milestone priorities, not lint debt details.

## M0 - Engineering Baseline / 工程基线 (Highest Priority)

Status: In Progress / 进行中

- [x] Add repo-level ESLint + Prettier baseline for `apps/server` and `apps/web`.
- [x] Add scripts: `lint` and `typecheck` in both app package manifests.
- [x] Run lint/typecheck, record current warnings in `记录.md`.
- [ ] Mark temporary exceptions and cleanup window before feature sprint.

## M1 - Runtime Stability / 运行稳定性

Status: In Progress / 进行中

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

### Planned / 规划中

 - [x] Time stepping follow-up: add explicit runtime override control path (API/ops) on top of current unified policy when variable speed modes are needed.

## M2 - Core Simulation Features / 核心模拟功能

Status: In Progress / 进行中

### Currently Implemented / 当前已实现

- [x] Identity Layer: define policy order (deny > allow, priority tie-break), field wildcard rules, and ABAC-ready claims/conditions.

### Planned / 规划中

- [x] Identity Layer: active node and atmosphere node lifecycle policies (baseline delivered: bind/query/unbind/expire APIs, uniqueness guard for active binding, runtime auto-expire, seed with atmosphere node).
- [ ] Inference Interface: strategy injection and hardcoded prompt channel.
- [ ] Memory Core: short-term context + long-term storage contract.
- [ ] Action Dispatcher: map decisions to world actions with delay modeling.

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
- Mark each section with `Currently Implemented` or `Planned` where relevant.
- Put lint debt and warnings only in `记录.md`.

Last Updated / 最后更新: 2026-03-22
