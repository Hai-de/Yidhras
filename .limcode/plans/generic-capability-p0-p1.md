# 通用能力实施计划

> 基于: `.limcode/design/generic-capability-development-draft.md`
> 状态: P0-P2 全部完成 + P3 测试基础设施完成。剩余 P3 大型基础设施未实施

---

## P0 — 阻塞原型世界包验证 ✓

- [x] StepContributor 接入 sim loop — `world_engine_persistence.ts`
- [x] activate() 错误处理修复 — `runtime.ts`
- [x] intent_grounders + pack_projections 删除 — `contracts/src/plugins.ts`

## P1 — 原型世界包需要的通用能力 ✓

- [x] 能力键注册表 + 枚举类型 — `capability_keys.ts`
- [x] Manifest 完全结构化 + 判别联合 + kind 枚举化 — `contracts/src/plugins.ts`, `runtime.ts`
- [x] Sim loop 步骤钩子 + 错误隔离 — `PackSimulationLoop.ts`
- [x] deactivate() 钩子 — `runtime.ts`
- [x] DataCleaner 消费者接入 — `PackSimulationLoop.ts`

## P2 — 平台健康运行需要 ✓

- [x] 权限层级统一 — `capability_keys.ts`, `runtime.ts`
- [x] Action dispatch 注册表驱动 — `action_dispatcher.ts`
- [x] state_transform_evaluator → StepContributor — `StateTransformContributor.ts`, `world_engine_persistence.ts`
- [x] RuleContributor / QueryContributor 适配层 — `plugin_contributor_adapter.ts`
- [x] PromptWorkflowStep 注册表合并 — `orchestrator.ts`
- [x] Host API 版本管理 — `capability_keys.ts`, `contracts/src/plugins.ts`, `runtime.ts`
- [x] 插件超时保护（短期隔离） — `runtime.ts`
- [x] 类型安全缺口枚举化 — `context/types.ts`, `world_engine.ts`, `prompt_slot_config.ts`

## P3 — 测试基础设施 ✓

- [x] 时间操控辅助函数 — `tests/helpers/clock.ts`
- [x] Mock AI Provider 故障场景增强 — `ai/providers/mock.ts`
- [x] 快照种子化测试辅助 — `tests/helpers/snapshot.ts`
- [x] 属性测试 fast-check 集成 — `tests/unit/property_based.spec.ts`

## P3 — 未实施（长期基础设施）

- [ ] Prometheus 指标端点 (prom-client + GET /metrics)
- [ ] 边车健康暴露到 health API
- [ ] 运行时状态 dump CLI (sim dump)
- [ ] Worker 线程插件隔离
- [ ] 数据迁移框架 (pack schema version)

## 新建/修改文件清单

| 文件 | 类型 |
|------|------|
| `apps/server/src/plugins/capability_keys.ts` | 新建 |
| `apps/server/src/app/runtime/StateTransformContributor.ts` | 新建 |
| `apps/server/src/app/runtime/plugin_contributor_adapter.ts` | 新建 |
| `apps/server/tests/helpers/clock.ts` | 新建 |
| `apps/server/tests/helpers/snapshot.ts` | 新建 |
| `apps/server/tests/unit/property_based.spec.ts` | 新建 |
| `packages/contracts/src/plugins.ts` | 修改 |
| `packages/contracts/src/world_engine.ts` | 修改 |
| `apps/server/src/plugins/runtime.ts` | 修改 |
| `apps/server/src/plugins/context.ts` | 间接 |
| `apps/server/src/app/runtime/PackSimulationLoop.ts` | 修改 |
| `apps/server/src/app/runtime/world_engine_persistence.ts` | 修改 |
| `apps/server/src/app/services/action_dispatcher.ts` | 修改 |
| `apps/server/src/ai/providers/mock.ts` | 修改 |
| `apps/server/src/context/workflow/orchestrator.ts` | 修改 |
| `apps/server/src/context/types.ts` | 修改 |
| `apps/server/src/inference/prompt_slot_config.ts` | 修改 |
| 多个测试文件 + YAML manifest | 修改 |
