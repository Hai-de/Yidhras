# TODO


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

### Context Module MVP / 当前阶段说明

- 当前完成的是 Context Module MVP + policy/overlay deepening，而不是完整 Prompt Workflow Engine
- 当前 orchestrator 仍是固定线性阶段：memory injection / policy filter / summary compaction / token budget trim
- 当前不包含可视化节点编排、插件执行平台、Agent 自主 context directives 执行路径
- 当前 overlay 属于 kernel-side working-layer object，不属于 pack runtime world governance core
- 当前 `memory_context` 仍然保留，但仅作为 compatibility surface

- [ ] 同步更多设计/实现细节到 docs/ 与根文档，减少新读者理解 Intent Grounder 与 narrativized failure 的成本
- [ ] 继续观察 `SimulationManager` / runtime facade 边界，决定是否需要下一轮收口
- [ ] 评估是否需要进一步补针对 Death Note semantic path 的专门 review 文档
- [x] 已新增 `AiInvocationRecord` 的查询/read-model/API surface（`/api/inference/ai-invocations*`）

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
