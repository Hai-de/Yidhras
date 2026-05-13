# 通用能力开发草案

> 基于: `.limcode/design/generic-capability-gap-analysis.md` (2026-05-12 复审)
> 状态: P0-P3 全部实施完成。AI gateway 埋点、Worker 隔离未实施
>
> **已确认决策:**
> - Manifest 类型系统: 方案 B — 完全结构化 + 判别联合，允许破坏性变更，无需向后兼容
> - 跨包通信: 暂不实施（当前无需求）
> - 可观测性: 方案 B — Prometheus + 指标端点
> - 其余缺口: 按默认推荐方案

---

## 一、插件贡献类型接入 Sim Loop（P0）✓

### 背景

5 种贡献类型已在 `PluginRuntimeRegistry` 注册、Host API 可用，但无运行时消费者。全部已接入。

### StepContributor 接入 ✓

**实施:** 在 `executeWorldEnginePreparedStep` 中，Rust 边车返回后、持久化前，统一迭代 builtin + plugin 贡献者。

文件: `apps/server/src/app/runtime/world_engine_persistence.ts`

实际流程（已实现）:
1. 并行查询 `worldEntities`, `entityStates`, `authorityGrants`, `mediatorBindings`, `ruleExecutionRecords`
2. 构建 `WorldEngineSessionContext`
3. `allContributors = [StateTransformContributor, ...getStepContributors(packId)]`
4. 依次调用 `contributePrepare(input, sessionContext)`，合并 delta_operations/emitted_events/observability
5. 每个 contributor 独立 try/catch，单个失败不阻塞其他
6. `persistPreparedStep` → `commitPreparedStep`

另外 P2 将 `state_transform_evaluator` 迁移为 `StateTransformContributor`（`apps/server/src/app/runtime/StateTransformContributor.ts`），消除了专有代码路径并验证了 StepContributor 接口。

### RuleContributor / QueryContributor 接入 ✓

**实施:** 新建 `apps/server/src/app/runtime/plugin_contributor_adapter.ts`，提供 `PluginRuleAdapter` 和 `PluginQueryAdapter` 接口，隔离插件系统与规则引擎。

### PromptWorkflowStep 注册表合并 ✓

**实施:** `apps/server/src/context/workflow/orchestrator.ts` 在 `buildWorkflowPromptBundle` 中从 `pluginRuntimeRegistry.getPromptWorkflowStepExecutors(packId)` 注册插件 executor 到 pipeline registry。内置 executor 优先，插件 executor 可覆盖同 kind 步骤。

### DataCleaner 接入 ✓

**实施:** `PackSimulationLoop.runIteration()` 在 step 6 之后遍历 `dataCleanerRegistry.list()` 并执行 `clean()`。每个 cleaner 独立 try/catch。

---

## 二、Sim Loop 生命周期钩子（P1）✓

### 背景

`PackSimulationLoop.runIteration()` 的 6 步间无钩子，只有全局 catch + 两个被动回调。已通过钩子数组 + per-step 错误隔离解决。

### 实施: 步骤级钩子数组 + 错误隔离 ✓

**文件:** `apps/server/src/app/runtime/PackSimulationLoop.ts`

- `PackLoopHooks` 接口: `beforeStep1-6` / `afterStep1-6` / `onLoopStateChange`
- `HookContext`: `{ packId, tick, diagnostics }`
- `runIteration()` 重构: 6 步定义为 `Array<{ name, fn }>`，每步独立 try/catch
- 步骤前后调用 `runHooks()`，单钩子失败不阻塞
- `last_step_errors` 诊断字段记录每步错误
- 单步失败不阻塞后续步骤（部分 tick 恢复）

未引入事件总线 — 跨包通信需求已确认不存在。

---

## 三、Action Dispatch 扩展机制（P2）✓

### 背景

`dispatchActionIntent` 原是硬编码 if-else 链。已替换为注册表驱动 + 三条明确处理路径。

### 实施: 注册表驱动的 dispatch ✓

**文件:** `apps/server/src/app/services/action_dispatcher.ts`

三条处理路径:
1. `invoke.*` → invocation pipeline（authority 检查 → 执行）
2. 插件注册的自定义 handler → `intentHandlerRegistry.get(intent_type)`
3. 内核类型 fallback → switch(`trigger_event` | `adjust_snr` | `adjust_relationship` | `move` | `post_message`)

`registerIntentHandler()` 拒绝覆盖内核类型和 `invoke.*` 前缀。

---

## 四、Manifest 类型系统升级（P1）✓

### 背景

Server 端 `pluginServerContributionsSchema` 全部字段原为 `z.array(nonEmptyStringSchema)`。已全部升级为结构化 schema。

### 实施: 完全结构化 + 判别联合 + kind 枚举化 ✓

**文件:** `packages/contracts/src/plugins.ts`

```typescript
const contributionBaseSchema = z.object({
  name: nonEmptyStringSchema,
  priority: z.number().int().default(0)
});

const contextSourceContributionSchema = contributionBaseSchema.extend({
  adapterType: z.enum(['entity_state', 'world_state', 'relationship', 'custom']).default('custom'),
  config: z.record(z.string(), z.unknown()).default({})
});

const stepContributorContributionSchema = contributionBaseSchema.extend({
  config: z.record(z.string(), z.unknown()).default({})
});

const ruleContributorContributionSchema = contributionBaseSchema.extend({
  supportsRuleIds: z.array(nonEmptyStringSchema).default([]),
  config: z.record(z.string(), z.unknown()).default({})
});

const queryContributorContributionSchema = contributionBaseSchema.extend({
  supportsQueryNames: z.array(nonEmptyStringSchema).default([]),
  config: z.record(z.string(), z.unknown()).default({})
});

// stepKind aligned with PromptWorkflowStepKind in context/workflow/types.ts
const promptWorkflowStepContributionSchema = contributionBaseSchema.extend({
  stepKind: z.enum([
    'memory_projection', 'node_working_set_filter', 'node_grouping',
    'summary_compaction', 'token_budget_trim', 'placement_resolution',
    'fragment_assembly', 'behavior_control', 'content_transform',
    'permission_filter', 'bundle_finalize'
  ]),
  config: z.record(z.string(), z.unknown()).default({})
});

const apiRouteContributionSchema = contributionBaseSchema.extend({
  path: nonEmptyStringSchema,
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('GET')
});

const dataCleanerContributionSchema = contributionBaseSchema.extend({
  trigger: z.enum(['on_tick', 'on_unload']).default('on_tick'),
  config: z.record(z.string(), z.unknown()).default({})
});

const pluginKindSchema = z.enum([
  'game_loop', 'context_provider', 'rule_engine', 'perception',
  'ui_panel', 'tool_provider', 'other'
]);

const pluginServerContributionsSchema = z.object({
  context_sources: z.array(contextSourceContributionSchema).default([]),
  prompt_workflow_steps: z.array(promptWorkflowStepContributionSchema).default([]),
  api_routes: z.array(apiRouteContributionSchema).default([]),
  step_contributors: z.array(stepContributorContributionSchema).default([]),
  rule_contributors: z.array(ruleContributorContributionSchema).default([]),
  query_contributors: z.array(queryContributorContributionSchema).default([]),
  data_cleaners: z.array(dataCleanerContributionSchema).default([])
});
```

**关键变更:**
1. `intent_grounders` 和 `pack_projections` 从 schema 删除（零引用、零实现）
2. `kind` 字段枚举化 — 未知值直接拒绝加载
3. `registerManifestContributions`（`runtime.ts`）重写为基于结构化元数据
4. Manifest `compatibility` 增加 `host_api` 字段
5. 所有 YAML 和测试文件已更新为结构化格式

### 类型安全缺口（gap §11.7）✓

全部已处理：

| 位置 | 字段 | 修复方式 |
|------|------|---------|
| 能力键 | `requested_capabilities` / `granted_capabilities` | `PLUGIN_CAPABILITY_KEY` 常量注册表（`capability_keys.ts`） |
| Prompt 片段槽位 | `PromptFragmentSlot = string` | 添加已知内置插槽文档注释（设计上需保持 string 支持动态注册） |
| 上下文节点 | `node_type: string` | `KNOWN_CONTEXT_NODE_TYPES` 常量 + `ContextNodeType` 联合类型（`context/types.ts`） |
| 世界引擎实体 | `entity_kind` | `worldEntityKindSchema` — `.refine()` 校验已知基础种类，允许 `actor:player` 子类型 |
| 世界引擎实体 | `grant_type` | `worldGrantTypeSchema` — `z.enum(['mediated', 'intrinsic'])` |
| 世界引擎实体 | `binding_kind` | `worldBindingKindSchema` — `z.enum(['direct_entity', 'holder_of', 'subject_entity', 'all_actors', 'entity_type_is'])` |

---

## 五、权限系统统一（P2）✓

### 实施: 分层优先级模型 ✓

**文件:** `apps/server/src/plugins/capability_keys.ts` + `runtime.ts`

- `PLUGIN_CAPABILITY_KEY` — 11 个能力键常量，编译期类型安全
- `CAPABILITY_KEY_MIN_LEVEL` — 每个能力键标记所需最低 sandbox 级别
- `hasCapability()` — 同时检查 granted_capabilities 包含 + sandbox 级别满足
- 所有 `ServerPluginHostApi` 方法硬编码默认能力键

---

## 六、插件生命周期修复（P1）✓

### deactivate() 钩子 ✓

`activate()` 可选返回 `() => void | Promise<void>` 或 `{ deactivate: ... }`。`clearRuntimes()` 在清空前调用 deactivate，deactivate 失败不阻塞。

### activate() 错误处理 ✓

空 catch 块已修复：`runtimeLogger.error` 日志 + `last_error` 写入（通过 `upsertInstallation`）。

### 热重载

CLI 命令和文件监视尚未实施。在 Worker 隔离就绪后再做。

---

## 七、插件隔离（P2-P3）

### 短期方案 (P2): 超时保护 ✓

**文件:** `apps/server/src/plugins/runtime.ts`

- `activate()` → `withTimeout(promise, 30000)`
- `requestInference()` → `withTimeout(promise, 60000)`

### 长期方案 (P3): Worker Threads 隔离 — 未实施

---

## 八、可观测性（P2-P3）✓

### Prometheus 指标 ✓

- `apps/server/src/observability/metrics.ts` — 7 个指标定义 + 记录函数
- `apps/server/src/observability/metrics_server.ts` — 独立 HTTP server（默认 :9090）
- `apps/server/src/index.ts` — server 启动后 `startMetricsServer()`
- 环境变量: `OBSERVABILITY_METRICS_PORT`

### 边车健康暴露 ✓

- `apps/server/src/app/routes/system.ts` — health API 增加 `sidecars` 字段

### 运行时 Dump CLI ✓

- `apps/server/src/cli/dump_cli.ts` — 直接 DB 读取，JSON 到 stdout
- `pnpm --filter yidhras-server sim:dump <packId> --type agent|relation|memory|all`

---

## 九、API 版本管理（P2）✓

### 实施: Host API 版本号 + manifest 兼容性声明 ✓

**文件:** `apps/server/src/plugins/capability_keys.ts` + `contracts/src/plugins.ts` + `runtime.ts`

- `PLUGIN_HOST_API_VERSION = '1.0.0'`
- Manifest `compatibility.host_api` 字段
- `isHostApiCompatible()` — 同大版本 + server >= required
- `refreshPackPluginRuntime` 激活前检查，不兼容则拒绝 + `last_error`

---

## 十、数据迁移（P3）✓

### Schema version ✓

- `constitution_schema.ts` — `worldPackConstitutionSchema` 增加 `schema_version: z.number().int().nonnegative().default(0)`

### 迁移注册表 ✓

- `apps/server/src/packs/migrations/registry.ts` — `migrateConfig()` 链式执行迁移

### CLI ✓

- `apps/server/src/cli/migrate_pack_cli.ts` — 加载 config → 检测版本 → 执行迁移 → 备份 + 写回
- `pnpm --filter yidhras-server db:migrate-pack <packId> [--target-version <n>]`

---

## 十一、测试基础设施（P3）✓

### 时间操控 ✓

**文件:** `apps/server/tests/helpers/clock.ts`
- `advanceTicks(clock, n)` — 快进 tick
- `createMockClock(initialTicks)` — 创建模拟时钟

### Mock AI Provider 增强 ✓

**文件:** `apps/server/src/ai/providers/mock.ts`
- `force_timeout` — 模拟网络分区（可配置延迟）
- `force_partial_response` — 模拟不完整 JSON
- `force_token_limit` — 模拟 token 限制触发

### 快照种子化测试 ✓

**文件:** `apps/server/tests/helpers/snapshot.ts`
- `seedPackFromSnapshot(worldPacksDir, packDirName, snapshotPath)`
- `seedPackWithConfigAndSnapshot(...)`

### 属性测试 ✓

**文件:** `apps/server/tests/unit/property_based.spec.ts`
- `evaluateStateTransforms` — 5 个属性（空输入、操作类型、不修改输入、target keys、一致性）
- `isHostApiCompatible` — 4 个属性（自反、单调、跨大版本拒绝、畸形输入）
- `findMatchingLabel` — 4 个属性（全上/全下无匹配、匹配返回合法 label、首匹配稳定）

---

## 十二、汇总与排序

### 实施状态总表

| 阶段 | 内容 | 状态 |
|------|------|------|
| **P0** | StepContributor 接入 | ✓ |
| **P0** | activate() 错误处理修复 | ✓ |
| **P0** | intent_grounders + pack_projections 删除 | ✓ |
| **P1** | Sim loop 步骤钩子 + 错误隔离 | ✓ |
| **P1** | Manifest 完全结构化 + 判别联合 | ✓ |
| **P1** | kind 枚举化 | ✓ |
| **P1** | deactivate() 钩子 | ✓ |
| **P1** | DataCleaner 消费者接入 | ✓ |
| **P1** | 能力键注册表 + 枚举类型 | ✓ |
| **P2** | 权限层级统一 | ✓ |
| **P2** | Action dispatch 注册表 | ✓ |
| **P2** | state_transform_evaluator → StepContributor | ✓ |
| **P2** | RuleContributor / QueryContributor 适配层 | ✓ |
| **P2** | PromptWorkflowStep 注册表合并 | ✓ |
| **P2** | Host API 版本管理 | ✓ |
| **P2** | 插件超时保护 | ✓ |
| **P2** | 类型安全缺口（§四末尾表） | ✓ |
| **P3** | 测试基础设施（时间操控/属性测试/Mock增强/快照） | ✓ |
| **P3** | Prometheus 指标 + 边车健康暴露 | ✓ |
| **P3** | 运行时状态 dump CLI | ✓ |
| **P3** | 数据迁移框架 | ✓ |
| **P3** | Worker 线程插件隔离 | ✗ 未实施 |

### 方案选择总结

| 缺口 | 方案 | 核心理由 |
|------|------|---------|
| StepContributor 接入 | executeWorldEnginePreparedStep 内统一迭代 builtin + plugin | 利用 TS 注入点，不改 Rust 协议 |
| Sim loop 钩子 | 步骤级钩子数组 + per-step 错误隔离 | 简单直接，无跨包需求时不引入事件总线 |
| Action dispatch 扩展 | 注册表驱动 + 拒绝内核类型覆盖 | 消除硬编码，三条处理路径边界明确 |
| Manifest 类型 | 完全结构化 + 判别联合 | 项目无上线数据，无需向后兼容 |
| 权限统一 | 分层优先级 + 能力键注册表 | 消除两层矛盾，同时解决能力键无枚举问题 |
| 插件生命周期 | activate 返回值 deactivate + 空 catch 修复 | JS 生态惯例 |
| 插件隔离 | 短期超时 + 长期 Worker | Worker 是唯一真正隔离方案 |
| 可观测性 | Prometheus + 指标端点 | 业界标准（尚未实施） |
| API 版本管理 | Host API 版本号 + manifest 兼容性声明 | 参照 WORLD_ENGINE_PROTOCOL_VERSION 既定模式 |
| 数据迁移 | Pack schema version + 迁移函数 | 最小可用，按需扩展（尚未实施） |
| 跨包通信 | 暂不实施 | 当前无需求 |
