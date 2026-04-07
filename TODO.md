# TODO

## Current Status / 当前状态

当前 `world-pack unified governance framework` 相关实施计划（见 `.limcode/plans/world-pack-unified-governance-framework.plan.md`）已完成：

- [x] `p1` 固化 world-pack schema 与 storage schema
- [x] `p2` 建立 kernel db / pack db / install/materialize 生命周期边界
- [x] `p3` 引入 pack runtime 核心模型
- [x] `p4` 重写 authority resolver / perception resolver / inference context assembler
- [x] `p5` 以 objective enforcement engine 替换旧 action_dispatcher 世界规则中心职责
- [x] `p6` 迁移 API/read model 到 kernel projection 与 pack projection 结构
- [x] `p7` 补齐 install/integration/e2e 验证与清理 legacy 主线
- [x] 移除 world-pack 输入兼容层：`scenario / event_templates / actions / decision_rules`
- [x] 以 `bootstrap.initial_states` 替代 `scenario.world_state`
- [x] 以 objective rule 内联事件声明替代 `event_templates`
- [x] 明确 ownership matrix 当前中间态：world governance core -> pack runtime；social/narrative/workflow evidence -> kernel-side Prisma
- [x] 将 `death_note` 默认样板重构为显式 mediator 表达
- [x] 删除 `/api/narrative/timeline`
- [x] 删除 `/api/agent/:id/overview`
- [x] 删除 `world/schema.ts` 与 `world/loader.ts`，统一 imports 到 `packs/*`

## Current Architecture Snapshot / 当前架构概览

当前已形成的核心结构包括：

- pack schema：`packs/schema/**`
- pack manifest loader：`packs/manifest/constitution_loader.ts` + `packs/manifest/loader.ts`
- pack runtime materializer：`packs/runtime/materializer.ts`
- pack runtime repositories：`packs/storage/**`
- authority / perception / inference context assembler：`domain/authority/**`、`domain/perception/**`、`domain/inference/**`
- invocation / objective enforcement：`domain/invocation/**`、`domain/rule/**`
- kernel + pack projections：`kernel/projections/**`、`packs/runtime/projections/**`

## Remaining Compatibility Surfaces / 剩余兼容面

以下内容仍保留，但已不属于 world-pack 输入或运行时兼容桥：

- `/api/policy/*` 的 access/policy debug surface
- `apps/server/src/core/simulation.ts` 仍未拆成更细的 runtime manager / pack instance 边界

## Suggested Next Work / 建议后续工作

### A. 最终兼容表面清除
- [ ] 评估 `/api/policy/*` 是否继续保留为 debug surface，或进一步内聚到 access/perception 子系统
- [ ] 继续推动 `SimulationManager` 向更清晰的 runtime manager / pack instance 边界演进

### B. 文档与契约同步深化
- [x] 同步 `docs/ARCH.md`
- [x] 同步 `docs/LOGIC.md`
- [x] 同步 `docs/API.md`
- [x] 同步 `TODO.md`
- [x] 同步 `记录.md`
- [ ] 如有需要，继续补 shared contracts 对 canonical pack/entity endpoint 的正式 schema

### C. ownership matrix 深化
- [ ] 评估 `Event / Post / ActionIntent / InferenceTrace / DecisionJob` 是否存在进一步 pack-owned 化的必要
- [ ] 若引入 `PackOutboxEvent`，明确与当前 projection extraction 的替换关系
- [ ] 评估 relationship runtime evidence 的最终归属边界

## Notes / 说明

- 当前文档描述应区分“已实现”和“仍保留的兼容表面”，避免将设计目标写成已完成实现。
- scheduler、operator console、frontend workspace 等既有能力保持不变，后续工作应避免无关回归。
