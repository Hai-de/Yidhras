# 消灭 getPrisma() — 逐 Repository 清理清单

> 状态：`pnpm typecheck` 零错误，`pnpm lint` 预存 283 个问题与本次清理无关。
> 全部 6 个 Repository 的 `getPrisma()` 已移除 (2026-05-01)。

## 已完成

| Repository | getPrisma 调用 | 状态 |
|---|---|---|
| MemoryRepository | 1 | ✅ 已清理 |
| NarrativeEventRepository | 3 | ✅ 已清理 |
| SocialRepository | 5 | ✅ 已清理 |
| AgentRepository | 4 | ✅ 已清理 (2026-05-01) |
| RelationshipGraphRepository | 8 | ✅ 已清理 (2026-05-01) |
| IdentityOperatorRepository | 10 | ✅ 已清理 (2026-05-01) |
| InferenceWorkflowRepository | 26 | ✅ 已清理 (2026-05-01) |
| PluginRepository | 0 (无外部调用) | ✅ 已清理 (2026-05-01) |

## 待后续处理

全部 Repository 的 `getPrisma()` 已清除完毕，但 `AppInfrastructure.prisma` 字段暂保留。`context.prisma` 仍有约 20 处直接引用（`IdentityService`、`AccessPolicyService`、`createPluginStore` 等底层实现），这些是内部委托目标，不影响 Repository 抽象边界。

## 清理模式

- 简单查询 → 专用方法（`findXxxById`, `listXxx`）
- 复杂查询（多条件 where / include / orderBy）→ `queryXxx(input)` 接收 Prisma 参数子集
- 返回类型使用 `any` 或内联记录类型，避免依赖 Prisma 生成的类型
- $transaction 调用 → `transaction<T>(fn)` 泛型方法
