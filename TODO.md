# Yidhras Milestones / 里程碑计划

本文件用于里程碑优先级管理，不用于记录 lint 历史问题。
This file tracks milestone priorities, not lint debt details.

## M0 - Engineering Baseline / 工程基线 (Highest Priority)

Status: In Progress / 进行中

- [x] Add repo-level ESLint + Prettier baseline for `apps/server` and `apps/web`.
- [x] Add scripts: `lint` and `typecheck` in both app package manifests.
- [ ] Run lint/typecheck, record current warnings in `记录.md`.
- [ ] Mark temporary exceptions and cleanup window before feature sprint.

## M1 - Runtime Stability / 运行稳定性

Status: Partially Implemented / 部分已实现

### Currently Implemented / 当前已实现

- [x] Chronos engine with BigInt ticks and multi-calendar conversion.
- [x] Narrative resolver with nested variable resolution and permission filtering.
- [x] Value dynamics manager with pinning and pluggable algorithm support.
- [x] Basic global notification queue and API endpoints.

### Planned / 规划中

- [ ] Harden API error boundaries and standardize error payloads.
- [ ] Add resilient startup checks (world-pack and database readiness).
- [ ] Add end-to-end smoke scripts for startup and key endpoints.
- [ ] Time stepping polish: introduce a unified runtime speed policy (config load once at init + optional dynamic override path), avoid scattered tick-rate reads when future variable speed modes are added.

## M2 - Core Simulation Features / 核心模拟功能

Status: Planned / 规划中

- [ ] Identity Layer: active node and atmosphere node lifecycle policies.
- [ ] Inference Interface: strategy injection and hardcoded prompt channel.
- [ ] Memory Core: short-term context + long-term storage contract.
- [ ] Action Dispatcher: map decisions to world actions with delay modeling.

## M3 - Frontend Capability / 前端能力完善

Status: Partially Implemented / 部分已实现

### Currently Implemented / 当前已实现

- [x] Three-column layout and layer switcher.
- [x] L2 graph visualization with Cytoscape.
- [x] Basic clock synchronization store.

### Planned / 规划中

- [ ] Replace mock graph data with server-driven data flow.
- [ ] Add slot/plugin-based panel composition.
- [ ] Add system notification UI wired to backend APIs.

## M4 - Content and Data Packs / 内容与世界包

Status: Planned / 规划中

- [ ] Formalize world-pack schema contract and validation checklist.
- [ ] Expand sample world packs and scenario coverage.
- [ ] Define native noise generation policy and balancing knobs.

## Milestone Rules / 里程碑规则

- Keep this file milestone-oriented and bilingual.
- Mark each section with `Currently Implemented` or `Planned` where relevant.
- Put lint debt and warnings only in `记录.md`.

Last Updated / 最后更新: 2026-03-20
