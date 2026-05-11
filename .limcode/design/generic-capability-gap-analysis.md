# 项目通用能力缺口分析

> 评估时间: 2026-05-11
> 触发: TODO.md 原型世界包插件问题审查 — StepContributor 未接入 sim loop、manifest 字段全为 `string[]`
> 关联: `.limcode/design/prototype-world-pack-implementation.md`、`.limcode/design/spatial-semantics-design.md`、`TODO.md`

## 一、发现的缺口总览

审计了 sim loop 扩展点、插件系统完整链路、可观测性/测试基础设施三个维度，共识别出 **8 大类、24 个具体缺口**。

---

## 二、插件贡献类型：5 个已声明但未接入

以下贡献类型在 manifest schema 中存在、Host API 可注册、但没有任何运行时管线消费它们：

| 贡献类型 | 注册路径 | 未接入位置 |
|----------|----------|-----------|
| `step_contributors` | `host.registerStepContributor()` → `PluginRuntimeRegistry` | `PackSimulationLoop.stepPackWorldEngine()` 走 Rust 边车，从不调用 `getStepContributors()` |
| `rule_contributors` | `host.registerRuleContributor()` → `PluginRuntimeRegistry` | 规则求值无桥接到 PluginRuntimeRegistry |
| `query_contributors` | `host.registerQueryContributor()` → `PluginRuntimeRegistry` | 状态查询无桥接到 PluginRuntimeRegistry |
| `prompt_workflow_steps` | `host.registerPromptWorkflowStep()` → `PluginRuntimeRegistry` | `getPromptWorkflowStepExecutors()` 无外部调用者；管线使用独立的 `PromptWorkflowStepRegistry`，两套注册表未合并 |
| `data_cleaner` | `host.registerDataCleaner()` → `DataCleanerRegistry` | `DataCleanerRegistry` 无消费者；无管线读取它 |

另外两个字段（`intent_grounders`、`pack_projections`）存在于 schema 中但连 Host API 注册方法都没有——全代码库零引用。

**现状影响:** `snowbound_mansion` 的 `snowbound-game-loop` 插件注册了一个每日循环 StepContributor，该逻辑永远不会执行。

---

## 三、Sim Loop 生命周期：6 步循环零钩子

`PackSimulationLoop.ts` 的 6 步之间没有任何 `beforeStepN` / `afterStepN` 钩子：

```
Step 1  expirePackIdentityBindings     ← 无钩子
Step 2  stepPackWorldEngine            ← 无钩子
Step 3  runAgentScheduler              ← 无钩子
Step 4  runDecisionJobRunner           ← 无钩子
Step 5  runActionDispatcher            ← 无钩子
Step 6  runPerceptionPipeline          ← 无钩子
```

全局只有一个捕获所有错误的 `catch` 块 + 两个被动通知回调（`onDegraded`、`onStepError`），不能拦截或修改执行流程。

缺失的通用能力：
- **步骤级钩子**: 世界包作者无法在"AI 推理前"注入逻辑（如修改 context）、无法在"action dispatch 后"执行游戏规则检查
- **循环状态变更通知**: `start()`/`stop()`/`pause()`/`resume()` 不触发任何外部回调
- **错误隔离**: 步骤 2 失败会导致步骤 3-6 整个跳过，无法做部分 tick 恢复
- **无事件总线**: 全代码库没有 EventEmitter / pub-sub 机制

---

## 四、Action Dispatch：无自定义 intent 注册机制

`action_dispatcher.ts` 的 `dispatchActionIntent` 是一个硬编码的 if-else 链：

```
trigger_event → dispatchTriggerEventIntent
adjust_snr    → dispatchAdjustSnrIntent
adjust_rel    → dispatchAdjustRelationshipIntent
move          → dispatchMoveIntent
post_message  → createSocialPost
default       → throw error
```

无法注册自定义 intent 类型。设计文档中已确定 `invoke.*` 走 invocation pipeline 而不污染 kernel intent 层，但 dispatch 端没有 `beforeDispatch`/`afterDispatch` 钩子来扩展行为。

---

## 五、Manifest 类型系统：Server 端落后于 Web 端

`packages/contracts/src/plugins.ts` 中 Server 贡献全部是 `z.array(nonEmptyStringSchema)`：

```typescript
context_sources: z.array(nonEmptyStringSchema)    // 只是一个名字
step_contributors: z.array(nonEmptyStringSchema)   // 只是一个名字
// ...全部 8 个字段都是 string[]
```

Web 端已经有结构化类型: `panels: z.array(pluginWebPanelContributionSchema)` 其中 `{ target: string, panel_id: string }`。

缺失的通用能力:
- manifest 声明即真实注册（而非 stub 占位 + `activate()` 覆盖）
- manifest 字段携带类型安全的元数据（priority、config、target）
- `kind` 字段无枚举约束，拼写错误只在运行时暴露

---

## 六、两层权限系统互不连通

存在两套独立的权限机制：

| 层级 | 机制 | 控制粒度 |
|------|------|---------|
| 沙箱级别 | `capability_level`: `readonly` / `pack_scoped` / `full` | 整个插件能访问 AppContext 的哪些面 |
| 能力键 | `granted_capabilities` 数组 + Host API 方法上的 `capabilityKey?` | 每个注册方法独立门控 |

两套机制互不关联 — `readonly` 级别的插件如果持有 `server.api_route.register` 键，仍可注册路由。没有跨层级的权限模型统一。

---

## 七、可观测性：指标和追踪几乎空白

| 能力 | 现状 |
|------|------|
| **结构化指标** | `emitAggregatedMetrics()` 是空函数体 stub。无 Prometheus/StatsD |
| **分布式追踪** | 无 OpenTelemetry。仅推理追踪（inference trace）存在，限于 AI 调用 |
| **日志传输** | 仅 `console.*`。无文件输出、无轮转、无日志投递 |
| **实时事件流** | 无 WebSocket/SSE。所有状态查询是轮询式 REST |
| **全模拟可复现** | 仅单推理任务可 replay。无 tick 级确定性、无 seed 传播、无回归重放 |
| **运行时内存转储** | 无 API/CLI 可 dump agent 记忆、关系图、推理队列 |
| **边车健康暴露** | 心跳检测存在于 `StdioJsonRpcTransport` 但未通过 health API 暴露 |
| **自动快照** | 仅手动触发。无定时调度 |

---

## 八、测试基础设施缺口

- 无 mock AI provider（推理测试依赖真实模型或手动 mock）
- 无时间操控辅助函数（不能快进 tick）
- 无快照种子化测试（必须从模板 pack 复制）
- 无基于属性的测试 / 模糊测试基础设施
- 无性能基准套件

---

## 九、缺口优先级建议

### P0 — 阻塞原型世界包验证

1. **StepContributor 接入 sim loop**: 在 `stepPackWorldEngine` 中调用 `getStepContributors()` 并执行 `contributePrepare()`
2. **RuleContributor / QueryContributor 接入**: 桥接 PluginRuntimeRegistry 到世界引擎规则/查询执行

### P1 — 原型世界包需要的通用能力

3. **Sim loop 步骤间钩子**: 最少需要 `beforeDecisionJobs`（推理前注入逻辑）和 `afterActionDispatch`（游戏规则校验）
4. **Manifest `contributions.server.*` 升级到结构化类型**: 至少 `step_contributors` 携带 priority + config
5. **`kind` 字段枚举化**: 防止拼写错误和未支持的类型静默通过

### P2 — 平台健康运行需要

6. **结构化指标基础设施**: tick 延迟、推理吞吐、错误率。最小可用即可
7. **边车健康暴露到 health API**
8. **dispatch 端 `afterDispatch` 钩子**: 或在确定不扩展 kernel intent 的前提下提供扩展点

### P3 — 规模化和调试需要

9. 全模拟 seed 传播 + 确定性
10. 运行时状态 dump API/CLI
11. 日志传输层（文件轮转 + 外部投递）
12. OpenTelemetry 追踪集成
13. Mock AI provider + 时间操控测试辅助

---

## 十、与已有设计文档的关系

- `.limcode/design/prototype-world-pack-implementation.md` §11 评审结论中 F1-F11 的平台基础设施项均已在代码中实现。本分析发现的缺口位于**上一层**: 插件贡献类型的运行时接入、sim loop 生命周期钩子、可观测性。
- `.limcode/design/spatial-semantics-design.md` 的 PerceptionResolver 是少数完整接入的插件扩展点（`registerPerceptionResolver` → `perception_pipeline.ts` 消费），可作为其他贡献类型接入的参考模式。
- `TODO.md` 中"原型世界包问题"的两项（StepContributor 阶段限制、manifest string[]）是本分析 P0/P1 的子集。

---

## 十一、审核反馈（2026-05-11）

对上述分析的交叉验证发现了一处事实性错误、两处夸大表述、以及若干文档未覆盖的重大盲点。

### 11.1 事实性错误

**"无 mock AI provider"（第八节）不成立。** 代码库中存在两个完整的 mock 实现：

- `apps/server/src/ai/providers/mock.ts` — 完整 `AiProviderAdapter`，支持 `agent_decision`、`semantic_intent`、`embedding`、`free_text`、`mock_json` 等任务类型，支持 `force_provider_fail` 注入故障，并在 `adapter_registry.ts:16` 注册为内置适配器
- `apps/server/src/inference/providers/mock.ts` — 完整 `InferenceProvider`，支持 `post_message`、`semantic_intent`、`trigger_event` 等，含传输策略模拟（可靠/尽力而为/脆弱/阻断）

应为"mock AI provider 已存在"，或改为指出 mock provider 缺失的特定能力（如有）。

### 11.2 夸大/不精确的表述

**"Web 端已经有结构化类型"（第五节）夸大。** 实际上 `pluginWebContributionsSchema` 的三个字段中只有 `panels` 是结构化对象 `{ target, panel_id }`，`routes` 和 `menu_items` 同样是 `z.array(nonEmptyStringSchema)`。Server 端 7 个字段全部是 `string[]`，Web 端 3 个字段 1 个结构化。对比应精确为"Web 端 panels 已结构化 vs Server 端全部未结构化"，不宜暗示 Web 端已全面领先。

**第十节称 PerceptionResolver 是"少数完整接入的插件扩展点"。** 实际还有两个同样完整接入的扩展点被遗漏：

- `SlotConditionRegistry` — `apps/server/src/inference/slot_condition_evaluators.ts:417` 消费
- `SlotContentTransformRegistry` — `apps/server/src/context/workflow/executors/content_transform.ts:65` 消费

这两个是已验证可工作的正面参考模式，应一并列出。

### 11.3 重大盲点：插件生命周期

**无 `deactivate()` 钩子。** 插件只有 `activate()` 入口，卸载时从不调用清理钩子。`clearRuntimes()`（`runtime.ts:188`）仅清空注册表映射，插件模块永驻 Node.js 模块缓存（`import()` 无对应 `delete require.cache`）。

**`activate()` 失败静默。** `runtime.ts:455-457` 的 try/catch 块是**空的**——损坏的插件入口点加载失败时零诊断输出（无 console.warn，无日志，无 DB 写入）。`PluginInstallation.last_error` 字段（`contracts.ts:189`）存在但从不在 activate 失败路径上写入。

**无热重载。** 配置监视器（`config/watcher.ts`）会调用 `resetRuntimeConfigCache()` 但不触发插件重新初始化。无 HMR、无基于文件变更的插件重载。

### 11.4 重大盲点：插件隔离

插件在**主进程**中运行——无 `worker_threads`、`child_process`、`vm` 沙箱。风险：

- 无 CPU 超时（`activate()` 或 `requestInference()` 可无限阻塞）
- 无内存限制、无 DB 查询配额、无推理调用配额
- 插件可调用 `process.exit()` 拖垮整个服务器
- Web 插件通过 `@vite-ignore` 注释的 `import()` 绕过模块安全（`loader.ts:24`）

已存在的硬性限制仅限静态配置：清单大小（1MB）、路由数（16）、上下文源数（32），不覆盖运行时行为。

### 11.5 重大盲点：API 版本管理

`ServerPluginHostApi` 接口（`runtime.ts:40-52`）**没有版本字段**。向它添加任何方法都是对现有插件的静默破坏性变更。

- `manifest_version` 硬编码为 `z.literal('plugin/v1')`，无法表达 Host API 兼容性范围
- `compatibility.yidhras` 只检查核心服务器版本（如 `>=0.5.0`），不检查 Host API 版本
- 对比：`WORLD_ENGINE_PROTOCOL_VERSION`（`world_engine.ts:8`）已用于边车协议协商，但插件 Host API 无对应机制

### 11.6 重大盲点：多包交互

`MultiPackLoopHost` 维护独立的 `PackSimulationLoop` 实例映射（`loops = new Map()`），包之间**零通信机制**：

- 无事件总线、消息队列、RPC
- 包不能共享实体状态或跨包调用操作
- 包无法在 manifest 中声明对另一个包的依赖
- 唯一的跨包能力是叙事投影服务（`pack_narrative_projection_service.ts`）对其它包数据的只读视图

### 11.7 重大盲点：类型安全缺口比描述的更广

第五节只聚焦 manifest schema，以下区域同样是裸字符串无枚举约束：

| 位置 | 字段 | 文件 |
|------|------|------|
| 世界引擎实体 | `entity_kind`、`entity_type`、`grant_type`、`binding_kind` | `packages/contracts/src/world_engine.ts` |
| 能力键 | `requested_capabilities` / `granted_capabilities` 全程 `string[]` | `contracts.ts`、`types.ts`、`runtime.ts` |
| Prompt 片段槽位 | `PromptFragmentSlot` 定义为 `type ... = string` | `apps/server/src/inference/prompt_slot_config.ts:8` |
| 上下文节点 | `node_type: string` | `apps/server/src/context/types.ts:70` |
| 宪法实体 | `entity_type`、`kind`（领域/角色）为自由文本 | `apps/server/src/packs/schema/constitution_schema.ts` |

能力键无注册表——拼写错误只在运行时暴露，无编译期检查。

### 11.8 重大盲点：数据迁移

世界包数据格式无迁移机制。Prisma 迁移仅覆盖服务器 DB（`apps/server/prisma/`），包本地 `runtime.sqlite` 无 schema 版本控制。宪法 schema 对 `scenario`、`actions`、`decision_rules` 等已废弃字段直接报错拒绝加载（`constitution_schema.ts:578-698`），无升级/转换路径。

### 11.9 文档内部逻辑断裂

**P0→P1 递进存在架构张力未讨论。** P0 要接入 StepContributor 到 sim loop，而 StepContributor 的 `contributePrepare()` 调用的自然位置是 step 2（Rust 边车步）。这就产生了一个选择：在 Rust 边车前后插入 JS 贡献者（破坏边车原子性），还是让 Rust 边车回调 JS（需新增 IPC 协议）。文档未讨论这个架构决策。

**`kind` 字段枚举化的向后兼容未处理。** 第五节提了、P1 列了 `kind` 枚举化，但已有插件如果 `kind: "game_loop"` 不在新枚举中怎么办——拒绝加载还是静默映射？未说明。

**dispatch 扩展策略存在内部矛盾。** 第四节说 `invoke.*` 走 invocation pipeline 不污染 kernel intent 层，P2 又说要在 dispatch 端加 `afterDispatch` 钩子。这两个扩展策略的关系未澄清——如果 invocation pipeline 是正确路径，为什么 dispatch 端还需要钩子？

**优先级排序缺少可观测性前置。** P2 的"结构化指标基础设施"是验证 P0/P1 改动效果的前提——没有 tick 延迟指标，接入 StepContributor 后无法评估性能影响。可观测性通常应先于功能改动或用同一批次交付。

**`intent_grounders` 和 `pack_projections` 未给出处置建议。** 第二节末尾指出它们"全代码库零引用"（连 Host API 注册方法都没有），但在优先级建议中完全消失。应明确：删除、实现、还是标记为预留字段暂缓？
