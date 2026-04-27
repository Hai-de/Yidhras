/**
 * Repository 抽象层。
 *
 * 本目录下的每个 Repository 封装一个聚合根的 Prisma 数据访问。
 * 工厂函数接收最小依赖（{ prisma }），返回类型化接口。
 *
 * 已建立模式（保留原有实现，暂未迁移）：
 *   - PluginStore (plugins/store.ts)
 *   - ContextOverlayStore (context/overlay/store.ts)
 *   - LongMemoryBlockStore (memory/blocks/store.ts)
 *   - LongTermMemoryStore (memory/long_term_store.ts)
 *   - InferenceTraceSink (inference/sinks/prisma.ts)
 *
 * 待新增的 Repository（下一阶段）：
 *   - InferenceWorkflowRepository — DecisionJob / InferenceTrace / ActionIntent / AiInvocationRecord
 *   - IdentityOperatorRepository — Identity / Operator / IdentityNodeBinding / OperatorSession / OperatorGrant 等
 *   - MemoryRepository — MemoryBlock / MemoryCompactionState
 *   - NarrativeEventRepository — Event
 *   - RelationshipGraphRepository — Relationship / RelationshipAdjustmentLog
 */
