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

## Remaining Non-Core Surfaces / 剩余非主线表面

以下内容仍保留，但已不属于 world-pack 输入、运行时兼容桥或治理主线核心：

- `/api/access-policy/*` 的独立 access-policy 子系统接口
- `apps/server/src/core/simulation.ts` 仍未拆成更细的 runtime manager / pack instance 边界

## Suggested Next Work / 建议后续工作

### Death Note Intent Grounder / 第一阶段收尾状态

- [x] Death Note pack 第一版题材动作链已落地：notebook acquisition / rule learning / murderous intent / intel / target / judgement / investigation / intel sharing
- [x] `rules.invocation` 已成为运行时 grounding 层，而不再只是 schema 占位
- [x] Intent Grounder 已接入 inference → workflow 主链
- [x] `ritual_divination` 等 unexpected action 已支持 narrativized failed-attempt fallback
- [x] scheduler 已消费事件桥接 metadata（如 `followup_actor_ids`）形成最小协作回流
- [x] server 侧 typecheck / unit / integration / e2e 已全部通过

### 当前后续重点

- [x] 已引入 Context Module MVP：`ContextNode / ContextRun / ContextService / Context Orchestrator Lite`
- [x] inference context 已先走 Context Module，再向下派生 legacy `memory_context`
- [x] `InferenceTrace.context_snapshot` 已包含 `context_module / context_debug / prompt_assembly` 等上下文诊断字段
- [x] prompt 主线已通过线性 orchestrator-lite 收口既有 processors
- [x] 已将 policy 从 fragment-level 上移到 node-level / working-set 治理，并保留 `policy_filter` 作为 compatibility fallback
- [x] 已引入 kernel-side overlay store / `ContextOverlayEntry` / overlay source adapter，并 materialize 为 `writable_overlay` 节点
- [x] `InferenceTrace.context_snapshot`、workflow debug 读取层与 entity overview 已可观察 policy / overlay 摘要
- [x] 已预留 future `ContextDirective` schema 与 trace 字段：`submitted/approved/denied_directives`
- [x] 继续补文档同步与阶段性收尾，明确当前 **仍未** 开放 directive 执行、通用 DAG workflow engine、visual editor 与 plugin runtime

### Context Module MVP / 当前阶段说明

- 当前完成的是 Context Module MVP + policy/overlay deepening，而不是完整 Prompt Workflow Engine
- 当前 orchestrator 仍是固定线性阶段：memory injection / policy filter / summary compaction / token budget trim
- 当前不包含可视化节点编排、插件执行平台、Agent 自主 context directives 执行路径
- 当前 overlay 属于 kernel-side working-layer object，不属于 pack runtime world governance core
- 当前 `memory_context` 仍然保留，但仅作为 compatibility surface

- [ ] 同步更多设计/实现细节到 docs/ 与根文档，减少新读者理解 Intent Grounder 与 narrativized failure 的成本
- [ ] 继续观察 `SimulationManager` / runtime facade 边界，决定是否需要下一轮收口
- [ ] 评估是否需要进一步补针对 Death Note semantic path 的专门 review 文档

### A. 子系统边界收口
- [x] 完成 access-policy 子系统独立化，当前正式入口为 `/api/access-policy/*`
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
