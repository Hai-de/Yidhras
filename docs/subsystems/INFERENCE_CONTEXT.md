# Inference Context Assembly

推理上下文组装子系统。负责将推理请求输入（`InferenceRequestInput`）转换为完整的推理上下文（`InferenceContext`），供 inference provider 和 prompt builder 消费。

## 入口

```typescript
import { buildInferenceContext } from './inference/context/builder.js';

const context = await buildInferenceContext(appContext, input, packId);
```

`buildInferenceContext` 是便捷入口，内部创建 builder 并执行 pipeline。

## 目录结构

```
inference/
  helpers.ts                        — extractSemanticType 等纯工具函数
  mappers.ts                        — Prisma 查询结果 → Domain 类型映射
  context/
    types.ts                        — 阶段输入/输出类型、ResolvedActor、ContextAssemblyError
    actor_resolver.ts               — Actor 解析（策略模式，4 种策略）
    state_snapshot_builder.ts       — Pack 状态快照构建
    policy_summary_builder.ts       — 访问策略评估
    transmission_profile.ts         — 传输可靠性配置（纯函数）
    variable_context_assembler.ts   — Prompt 变量上下文组装
    authority_adapter.ts            — Authority 解析薄包装
    config_loader.ts                — 配置加载（实例级缓存）
    pipeline.ts                     — ContextAssemblyPipeline（13 阶段编排）
    builder.ts                      — 公开 API 入口
```

## Pipeline 执行顺序

```
1. validatePackAvailable       — 校验 world pack 已就绪
2. resolveTick                 — 解析当前 tick
3. selectStrategy              — 选择推理策略（mock / model_routed / behavior_tree）
4. normalizeAttributes         — 规范化 attributes
5. resolveActor                — 解析 actor（4 种策略按优先级）
6. applyActorOverride          — 应用 actor 级 strategy 覆盖（behavior_tree / model_routed）
7. buildPackStateSnapshot      — 构建 pack 状态快照（actor state、world state、artifacts、events）
8. resolveAuthority            — 解析 actor 的 capability grants
9. buildPolicySummary          — 评估访问策略（social_post read/write）
10. buildTransmissionProfile   — 计算传输可靠性配置（SNR + policy → drop_chance）
11. buildContextRun            — 构建 context_run + memory_context（context assembly 服务）
12. assembleVariableContext    — 组装 prompt 变量上下文（命名空间分层）
13. assembleFinalContext       — 组装最终 InferenceContext
```

## Actor 解析策略

Actor 解析按优先级依次尝试：

| 优先级 | 策略 | 触发条件 | 行为 |
|--------|------|---------|------|
| 1 | `AgentIdStrategy` | `input.agent_id` 存在 | 查 agent → 构建 snapshot |
| 2 | `IdentityIdStrategy` | `input.identity_id` 存在 | 查 identity → 查 binding → 返回 bound agent |
| 3 | `ActorEntityIdStrategy` | `input.actor_entity_id` + `packId` | 构造 bridged ID → 查 pack entity → 合成 identity |
| 4 | `SystemFallbackStrategy` | 兜底 | 返回系统 identity |

每个策略仅依赖其需要的 repository 接口（`ActorResolutionContext`），不依赖全局 context。

## 配置

配置由 `InferenceContextConfigLoader` 实例管理（消除旧全局可变缓存）：

- 内置默认值 → `data/configw/inference_context.yaml` → `data/configw/inference_context.d/{deploymentId}.yaml` → 环境变量 override
- 每个 loader 实例独立缓存，测试间不互相污染
- 便捷函数 `getInferenceContextConfig(deploymentId?)` 保留旧签名

## 错误处理

Pipeline 阶段异常通过 `wrapStage()` 统一包装为 `ContextAssemblyError`，包含阶段名和原始错误。

## 扩展

- 新增 actor 解析策略：实现 `ActorResolutionStrategy` 接口并注册到 `STRATEGIES` 数组
- 新增 pipeline 阶段：在 `execute()` 中添加阶段调用，更新 `PipelineOptions` 的 graceful 配置
- 自定义配置：传入 `PipelineOptions` 到 `createInferenceContextBuilder(options)`
