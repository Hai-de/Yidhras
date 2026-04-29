# 消灭 getPrisma() — 逐 Repository 清理清单

> 状态：`pnpm typecheck` 零错误，`pnpm lint` 零错误。

## 已完成

| Repository | getPrisma 调用 | 状态 |
|---|---|---|
| MemoryRepository | 1 | ✅ 已清理 |
| NarrativeEventRepository | 3 | ✅ 已清理 |
| SocialRepository | 5 | ✅ 已清理 |

## 待处理

| Repository | 剩余调用 | 涉及文件 |
|---|---|---|
| AgentRepository | 4 | `relational/graph_projection.ts:73`, `relational/queries.ts` (已替换部分) |
| RelationshipGraphRepository | 8 | `agent.ts:311,322,631`, `relational/graph_projection.ts:68`, `relational/queries.ts:73`, `audit.ts:256,319`, `short_term_adapter.ts:234` |
| IdentityOperatorRepository | 10 | `capability.ts:29,56`, `operators.ts:65`, `evaluation_context.ts:23`, `agent.ts:300`, `graph_projection.ts:83`, `simulation_loop.ts:77` |
| SchedulerRepository | 14 | `scheduler_observability.ts` (全部 14 个) |
| InferenceWorkflowRepository | 26 | `ai_invocations.ts`, `entity_activity_query.ts`, `agent.ts:345`, `audit.ts`, `evaluation_context.ts:115,169`, `short_term_adapter.ts`, `enforcement_engine.ts:205`, `system.ts:131`, `workflow_query.ts` |

## 清理步骤（每 Repository 重复）

1. 找到该 Repository 的所有 `getPrisma()` 调用：`grep -rn "repos.<name>.getPrisma" --include="*.ts" src/`
2. 分析每个调用需要的 Prisma 操作，在 Repository 接口中新增类型化方法
3. 实现方法（使用 `this.prisma`），替换调用方
4. 从接口和实现中删除 `getPrisma()`
5. `pnpm typecheck` 确认零错误

## 模式参考

已在 MemoryRepository / NarrativeEventRepository / SocialRepository 中建立了模式：

- 简单查询 → 专用方法（`findXxxById`, `listXxx`）
- 复杂查询（多条件 where / include / orderBy）→ `queryXxx(input)` 接收 Prisma 参数子集

## 最后一步

全部 Repository 的 `getPrisma()` 清除完毕后：
- 从 `AppInfrastructure` 删除 `prisma: PrismaClient`
- 从 `index.ts` / `plugin_cli.ts` 删除 `prisma` 注入
- 20 个委托目标文件内部的 `context.prisma` 保持不变（它们是底层实现）
