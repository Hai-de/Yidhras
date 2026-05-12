# 通用能力开发草案

> 基于: `.limcode/design/generic-capability-gap-analysis.md` (2026-05-12 复审)
> 状态: 草案
>
> **已确认决策:**
> - Manifest 类型系统: 方案 B — 完全结构化 + 判别联合，允许破坏性变更,无需向后兼容
> - 跨包通信: 暂不实施（当前无需求）
> - 可观测性: 方案 B — Prometheus + 指标端点
> - 其余缺口: 按默认推荐方案

---

## 一、插件贡献类型接入 Sim Loop（P0）

### 背景

5 种贡献类型已在 `PluginRuntimeRegistry` 注册、Host API 可用，但无运行时消费者：
- `step_contributors` → `PackSimulationLoop.stepPackWorldEngine()` 不调用 `getStepContributors()`
- `rule_contributors` / `query_contributors` → 规则求值/状态查询无桥接
- `prompt_workflow_steps` → `getPromptWorkflowStepExecutors()` 无外部调用者，存在两套注册表
- `data_cleaner` → `DataCleanerRegistry` 无消费者

关联文件:
- `apps/server/src/app/runtime/PackSimulationLoop.ts:189-190` — step 2 仅调用 `executeWorldEnginePreparedStep`
- `apps/server/src/app/runtime/world_engine_persistence.ts:346-484` — TS 侧注入点（`evaluateStateTransforms` 在 :376-433）
- `apps/server/src/plugins/runtime.ts:210-221` — `getStepContributors()` 等方法已存在但无人调用
- `apps/server/src/app/runtime/world_engine_contributors.ts:48-55` — `StepContributor` 接口已定义

### StepContributor 接入

**采用方案:** 在 `executeWorldEnginePreparedStep` 内部调用。

在 Rust 边车返回 delta 后、持久化前，遍历 `getStepContributors()` 并合并 delta operations。

具体位置: `world_engine_persistence.ts:376-433`，紧接 `evaluateStateTransforms` 之后。

```
流程:
  1. worldEngine.prepareStep(input)           // Rust 边车返回 base delta
  2. evaluateStateTransforms(...)              // 现有 TS 侧注入
  3. for c of getStepContributors():           // 新增: 遍历已注册贡献者
       contribution = c.contributePrepare(input, sessionContext)
       prepared.state_delta.operations.push(...contribution.delta_operations)
  4. persistence.persistPreparedStep(...)      // 合并持久化
  5. worldEngine.commitPreparedStep(...)       // 提交
```

**优点:** 利用已有 TS 注入点，不改 Rust 协议；不破坏边车原子性；实现量约 30 行；`evaluateStateTransforms` 已在同一位置验证可行。
**缺点:** StepContributor 受限于 step 2 内部，不能影响其他步骤；所有 contributor 串行执行。

**注意:** `evaluateStateTransforms` 已经在 :377-380 查询了 `worldEntities` 和 `entityStates`。构建 `WorldEngineSessionContext` 时必须复用这些查询结果，避免重复 DB 访问。将查询提取到 StepContributor 循环之前，共享一份数据。

**后续验证:** P2 将 `state_transform_evaluator` 本身迁移为第一个 StepContributor。消除专有代码路径（`evaluateStateTransforms` 硬编码在 :376-433），验证 StepContributor 接口的实际可用性。迁移时需验证接口是否足够表达 `state_transform_evaluator` 的特殊逻辑（需 actorStates、transformDefs）。

### RuleContributor / QueryContributor 接入

**采用方案:** 新增独立的适配层。

创建 `PluginRuleEngineAdapter` 和 `PluginQueryEngineAdapter`，包装 `PluginRuntimeRegistry`，供 `enforcement_engine.ts` 和状态查询管线调用。保持 enforcement_engine 不直接依赖插件系统。

```typescript
// 新文件: apps/server/src/app/runtime/plugin_rule_adapter.ts
export const createPluginRuleAdapter = (packId: string) => ({
  getContributors: () => pluginRuntimeRegistry.getRuleContributors(packId),
  getQueryContributors: () => pluginRuntimeRegistry.getQueryContributors(packId)
});
```

**优点:** 隔离插件系统与规则引擎；可独立测试。
**缺点:** 多一层间接。

### PromptWorkflowStep 注册表合并

两套注册表：`pluginRuntimeRegistry.getPromptWorkflowStepExecutors()` 与独立的 `PromptWorkflowStepRegistry`。

**采用方案:** 先调研独立 `PromptWorkflowStepRegistry` 是否有非插件来源的注册。如无，统一到 `PluginRuntimeRegistry`，删除独立 registry。如有（如内置 workflow steps），改为 `PluginRuntimeRegistry` 在激活时将 executor 推入独立 registry（feeder 模式）。

### DataCleaner 接入

`DataCleanerRegistry` 在 `apps/server/src/plugins/extensions/data_cleaner_registry.ts` 中定义，`host.registerDataCleaner()` 已接入注册表，但无消费者。

**接入点:** 在 sim loop 的 step 6（perception pipeline）之后，或在 pack unload / sim loop stop 时调用 `dataCleanerRegistry.runCleaners(packId)`。

```typescript
// PackSimulationLoop.runIteration() 中，step 6 之后:
const cleaners = dataCleanerRegistry.getForPack(this.packId);
for (const cleaner of cleaners) {
  try {
    await cleaner.clean();
  } catch (err) {
    // 单个 cleaner 失败不影响其他
  }
}
```

**待确认:** DataCleaner 的调用时机 — 每个 tick 运行还是仅在 pack 卸载时运行？需根据 `DataCleaner` 接口的设计意图确定。

---

## 二、Sim Loop 生命周期钩子（P1）

### 背景

`PackSimulationLoop.runIteration()` 的 6 步间无钩子，只有全局 catch + 两个被动回调（`onDegraded`、`onStepError`）。

关联文件:
- `apps/server/src/app/runtime/PackSimulationLoop.ts:154-258` — `runIteration()`

### 采用方案: 步骤级钩子数组

在 `PackSimulationLoopOptions` 中增加 `hooks?: PackLoopHooks`，每个步骤有 `before`/`after` 回调数组。

```typescript
interface HookContext {
  packId: string;
  tick: string;
  diagnostics: PackLoopDiagnostics;
}

interface PackLoopHooks {
  beforeStep1?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep1?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep2?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep2?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep3?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep3?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep4?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep4?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep5?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep5?: Array<(ctx: HookContext) => Promise<void>>;
  beforeStep6?: Array<(ctx: HookContext) => Promise<void>>;
  afterStep6?: Array<(ctx: HookContext) => Promise<void>>;
  onLoopStateChange?: Array<(from: string, to: string) => void>;
}
```

每个钩子独立 try/catch，单个钩子失败不阻塞后续钩子也不阻塞步骤执行。错误记录到 diagnostics。

**优点:** 简单直接，零依赖；每个钩子独立失败隔离；世界包作者可直接在 pack config 中声明钩子脚本路径；不需要事件总线基础设施。

**缺点:** 钩子签名固定，扩展需改接口；钩子之间无法通信；无法中止执行流。

**不引入事件总线的原因:** 跨包通信需求已确认不存在。仅为本地的 before/after 钩子引入 EventEmitter/pub-sub 是过度设计。如未来需要跨包事件，可在当时引入事件总线并迁移钩子到事件上（钩子数组 → 事件监听的迁移成本低）。

### 错误隔离（部分 tick 恢复）

当前 `runIteration()` 的单体 try/catch（:185-258）导致 step 2 失败时 step 3-6 整个跳过。

**改进:** 将每个步骤包裹在独立的 try/catch 中。单个步骤失败 → 记录错误 + 继续下一步骤。`consecutiveFailures` 计数仅在全 tick 失败或某步骤连续失败时递增。

```typescript
// 伪代码
for (const step of [step1, step2, step3, step4, step5, step6]) {
  try {
    await runHooks('before', step);
    await step.fn();
    await runHooks('after', step);
  } catch (err) {
    this.diagnostics.last_step_errors.push({ step: step.name, error: getErrorMessage(err) });
    // 不 return，继续下一步骤
  }
}
```

这与钩子数组方案一并实施。

---

## 三、Action Dispatch 扩展机制（P2）

### 背景

`dispatchActionIntent` (`action_dispatcher.ts:308-357`) 是硬编码 if-else 链：
`trigger_event` | `adjust_snr` | `adjust_rel` | `move` | `post_message` | → throw

`invoke.*` 走 `dispatchInvocationFromActionIntent` (invocation pipeline)。

关联文件:
- `apps/server/src/app/services/action_dispatcher.ts:308-357`
- `apps/server/src/domain/invocation/invocation_dispatcher.ts`

### 采用方案: 注册表驱动的 dispatch

将 if-else 链替换为注册表。

```typescript
const intentDispatcherRegistry = new Map<string, IntentHandler>();

export const registerIntentHandler = (intentType: string, handler: IntentHandler) => {
  // 拒绝覆盖内核 intent 类型
  const KERNEL_INTENTS = new Set([
    'trigger_event', 'adjust_snr', 'adjust_relationship', 'move', 'post_message'
  ]);
  if (KERNEL_INTENTS.has(intentType)) {
    throw new Error(`Cannot override kernel intent type: ${intentType}`);
  }
  intentDispatcherRegistry.set(intentType, handler);
};

// dispatchActionIntent 内部:
// 1. 先走 invocation pipeline (invoke.*)
// 2. 再查注册表
// 3. 最后 fallback 到内核类型
const invocationResult = await dispatchInvocationFromActionIntent(...);
if (invocationResult) return invocationResult;

const handler = intentDispatcherRegistry.get(intent.intent_type);
if (handler) return handler(context, intent, packRuntime);

// 内核类型
switch (intent.intent_type) {
  case 'trigger_event': ...
  case 'adjust_snr': ...
  // ...
}
```

**意图类型命名空间规则:**

| 前缀 | 处理路径 | 可扩展 |
|------|---------|--------|
| `invoke.*` | Invocation pipeline（authority 检查 → 执行） | 是 — pack config 声明 |
| 内核类型 (`trigger_event`, `adjust_snr`, `adjust_relationship`, `move`, `post_message`) | 硬编码 dispatch | 否 |
| 其他自定义 | 注册表 dispatch | 是 — `registerIntentHandler()` |

**优点:** 消除硬编码 if-else；插件可注册自定义 intent；注册表拒绝覆盖内核类型；明确三条处理路径的职责边界。

**缺点:** 注册表全局可变 — 需按 pack 隔离（注册时关联 packId，dispatch 时按 packId 过滤）。

---

## 四、Manifest 类型系统升级（P1）

### 背景

Server 端 `pluginServerContributionsSchema` 全部 8 个字段为 `z.array(nonEmptyStringSchema)`。Web 端 `panels` 已是 `{ target, panel_id }` 结构化对象。项目未上线，无需向后兼容。

`kind` 字段无枚举约束。`intent_grounders` 和 `pack_projections` 零引用（无 Host API、无消费者）。

关联文件:
- `packages/contracts/src/plugins.ts:66-75` — `pluginServerContributionsSchema`
- `packages/contracts/src/plugins.ts:113` — `kind: nonEmptyStringSchema`

### 采用方案: 完全结构化 + 判别联合

每个贡献类型有独立的完整 schema。

```typescript
// packages/contracts/src/plugins.ts

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

const promptWorkflowStepContributionSchema = contributionBaseSchema.extend({
  stepKind: z.enum(['bundle_finalize', 'pre_inference', 'post_inference']),
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

const pluginServerContributionsSchema = z.object({
  context_sources: z.array(contextSourceContributionSchema).default([]),
  prompt_workflow_steps: z.array(promptWorkflowStepContributionSchema).default([]),
  api_routes: z.array(apiRouteContributionSchema).default([]),
  step_contributors: z.array(stepContributorContributionSchema).default([]),
  rule_contributors: z.array(ruleContributorContributionSchema).default([]),
  query_contributors: z.array(queryContributorContributionSchema).default([]),
  data_cleaners: z.array(dataCleanerContributionSchema).default([])
  // intent_grounders 和 pack_projections 已删除
});
```

**关键变更:**
1. `intent_grounders` 和 `pack_projections` 从 schema 删除（零引用、零实现）
2. `data_cleaner` 重命名为 `data_cleaners`（与其他字段复数形式一致）
3. `registerManifestContributions`（`runtime.ts:266-337`）需重写 — 不再生成 stub executor，而是将结构化元数据传递给 Host API，在 `activate()` 中按 name 关联实际实现

**manifest 声明与 activate() 关联机制:**

manifest 声明贡献的元数据（name、priority、config），`activate()` 通过 Host API 注册实际 executor。两者通过 `name` 字段关联：

```typescript
// manifest 中:
contributions:
  server:
    step_contributors:
      - name: "daily_loop"
        priority: 10
        config:
          interval_tick: 24

// activate() 中:
host.registerStepContributor({
  name: "daily_loop",  // 与 manifest 中的 name 匹配
  priority: 10,
  async contributePrepare(input, context) {
    // 实际逻辑
  }
});
```

### kind 字段枚举化

```typescript
const pluginKindSchema = z.enum([
  'game_loop',
  'context_provider',
  'rule_engine',
  'perception',
  'ui_panel',
  'tool_provider',
  'other'
]);
```

由于无需向后兼容，未知 `kind` 直接拒绝加载并写入 `last_error`。

### 其他类型安全缺口（gap §11.7）

以下区域的裸字符串同样需要枚举化/注册表化，与 manifest 升级同步进行：

| 位置 | 字段 | 文件 | 修复方式 |
|------|------|------|---------|
| 能力键 | `requested_capabilities` / `granted_capabilities` | `contracts.ts`, `types.ts`, `runtime.ts` | 定义 `CAPABILITY_KEY` 枚举/常量注册表 |
| Prompt 片段槽位 | `PromptFragmentSlot = string` | `prompt_slot_config.ts:8` | 改为枚举或模板字面量类型 |
| 上下文节点 | `node_type: string` | `context/types.ts:70` | 改为 `z.enum([...])` |
| 世界引擎实体 | `entity_kind`, `entity_type`, `grant_type`, `binding_kind` | `contracts/src/world_engine.ts` | 改为枚举 |

能力键注册表将在 §五（权限统一）中定义，可被此处复用。

---

## 五、权限系统统一（P2）

### 背景

两层权限互不关联：
- **沙箱级别**: `readonly` / `pack_scoped` / `full` — 控制整个插件能访问 AppContext 的哪些面
- **能力键**: `granted_capabilities` 数组 — 每个 Host API 方法独立门控

`readonly` 级别插件如果持有 `server.api_route.register` 键，仍可注册路由。

关联文件:
- `apps/server/src/plugins/context.ts:13-124` — `PluginCapabilityLevel` + `createPluginContext`
- `apps/server/src/plugins/runtime.ts:71-77` — `hasCapability()`

### 采用方案: 分层优先级模型

沙箱级别是硬上限，能力键在此上限内细粒度控制。

```
full:        所有 capability key 可用
pack_scoped: 只能使用标记为 pack_scoped 安全的能力键
readonly:    只能使用标记为 readonly 安全的能力键
```

**能力键注册表**（同时解决 §四中能力键无枚举的问题）：

```typescript
// apps/server/src/plugins/capability_keys.ts

export const PLUGIN_CAPABILITY_KEY = {
  CONTEXT_SOURCE_REGISTER: 'server.context_source.register',
  PROMPT_WORKFLOW_REGISTER: 'server.prompt_workflow.register',
  API_ROUTE_REGISTER: 'server.api_route.register',
  INFERENCE_REQUEST: 'server.inference.request',
  STEP_CONTRIBUTOR_REGISTER: 'server.step_contributor.register',
  RULE_CONTRIBUTOR_REGISTER: 'server.rule_contributor.register',
  QUERY_CONTRIBUTOR_REGISTER: 'server.query_contributor.register',
  DATA_CLEANER_REGISTER: 'server.data_cleaner.register',
  SLOT_CONDITION_REGISTER: 'server.slot_condition.register',
  SLOT_CONTENT_TRANSFORM_REGISTER: 'server.slot_content_transform.register',
  PERCEPTION_RESOLVER_REGISTER: 'server.perception_resolver.register'
} as const;

export type PluginCapabilityKey = (typeof PLUGIN_CAPABILITY_KEY)[keyof typeof PLUGIN_CAPABILITY_KEY];

// 每个能力键的所需最低沙箱级别
export const CAPABILITY_KEY_MIN_LEVEL: Record<PluginCapabilityKey, PluginCapabilityLevel> = {
  [PLUGIN_CAPABILITY_KEY.CONTEXT_SOURCE_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.PROMPT_WORKFLOW_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.STEP_CONTRIBUTOR_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.RULE_CONTRIBUTOR_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.QUERY_CONTRIBUTOR_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.SLOT_CONDITION_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.SLOT_CONTENT_TRANSFORM_REGISTER]: 'pack_scoped',
  [PLUGIN_CAPABILITY_KEY.PERCEPTION_RESOLVER_REGISTER]: 'pack_scoped'
};
```

`hasCapability()` 增加 sandbox 级别检查：

```typescript
const hasCapability = (
  grantedCapabilities: string[],
  sandboxLevel: PluginCapabilityLevel,
  capabilityKey: PluginCapabilityKey | undefined
): boolean => {
  if (!capabilityKey) return true;
  if (!grantedCapabilities.includes(capabilityKey)) return false;
  const requiredLevel = CAPABILITY_KEY_MIN_LEVEL[capabilityKey] ?? 'pack_scoped';
  const levels: PluginCapabilityLevel[] = ['readonly', 'pack_scoped', 'full'];
  return levels.indexOf(sandboxLevel) >= levels.indexOf(requiredLevel);
};
```

**优点:** 两套机制建立明确层级关系；`readonly` 插件即使持 `server.api_route.register` 键也无法注册路由；能力键注册表提供编译期检查，消除拼写错误风险。

**缺点:** 新增能力键时需同步更新 `CAPABILITY_KEY_MIN_LEVEL`。

---

## 六、插件生命周期修复（P1）

### 背景

- 无 `deactivate()` 钩子 — `clearRuntimes()` 仅清空注册表映射，插件模块永驻 Node.js 缓存
- `activate()` 失败静默 — `runtime.ts:455-457` 的 catch 块为空
- `PluginInstallation.last_error` 字段存在但从不在 activate 失败路径写入
- 无热重载

关联文件:
- `apps/server/src/plugins/runtime.ts:188-196` — `clearRuntimes()`
- `apps/server/src/plugins/runtime.ts:455-457` — 空 catch 块
- `apps/server/src/plugins/runtime.ts:339-348` — `activatePluginEntrypoint`
- `packages/contracts/src/plugins.ts:189` — `last_error` 字段

### deactivate() 钩子

`activate()` 可选返回 `deactivate` 函数：

```typescript
export type PluginActivateResult = void | (() => void | Promise<void>) | {
  deactivate?: () => void | Promise<void>;
};
```

在 `activatePluginEntrypoint` 中：

```typescript
const result = await module.activate(host);
if (typeof result === 'function') {
  runtime.deactivate = result;
} else if (result && typeof result.deactivate === 'function') {
  runtime.deactivate = result.deactivate;
}
```

`clearRuntimes()` 在清空注册表前调用每个 runtime 的 `deactivate()`，`deactivate` 失败不阻塞清空（try/catch 包裹）。

**优点:** 符合 JS 生态惯例；不改变 `activate()` 签名；不需要 manifest schema 变更。

### activate() 错误处理

修复 `runtime.ts:455-457` 的空 catch 块，写入 `last_error`：

```typescript
try {
  const entrypointPath = path.join(artifact.source_path, serverEntrypoint.source);
  const host = createServerPluginHostApi(runtime);
  await activatePluginEntrypoint(entrypointPath, host);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  runtimeLogger.error(`Plugin ${installation.plugin_id} activate() failed: ${message}`);
  // 更新 PluginInstallation.last_error
  await context.repos.plugin.updateInstallationError?.(
    installation.installation_id, message
  );
}
```

**注意:** 需要先验证 `context.repos.plugin` 是否有 `updateInstallationError` 方法。如无，则使用通用的 `updateInstallation` 方法设置 `{ last_error: message }`。如两者均无，先用 `runtimeLogger.error` 记录，P2 补全 repo 方法。

### 热重载

先实施手动 CLI 命令：

```bash
pnpm --filter yidhras-server plugin reload <packId>
```

在 Worker 线程隔离（§七）就绪后再考虑文件监视 + 自动重载。当前 `import()` 缓存使得自动重载需要额外处理模块缓存清除，不值得在无隔离环境下投入。

---

## 七、插件隔离（P2-P3）

### 背景

插件在主进程运行，无 CPU 超时、内存限制、DB 查询配额、推理调用配额。插件可调用 `process.exit()`。

关联文件:
- `apps/server/src/plugins/runtime.ts:339-348` — `activatePluginEntrypoint` 直接 `import()` 在主线程

### 短期方案 (P2): 资源限制 + 超时

不引入进程隔离，仅添加超时保护：

- `activate()` 超时: `Promise.race([activate(), timeout(30000)])`
- `requestInference()` 超时: `Promise.race([inference(), timeout(60000)])`
- 超时后抛出错误并写入 `last_error`，不阻塞 sim loop

**优点:** 实现量小（1-2 天）；不改变 Host API 签名。
**局限:** 无法阻止 `process.exit()`、`while(true){}` 等恶意代码。依赖 trust_mode 审核机制作为主要安全边界。

### 长期方案 (P3): Worker Threads 隔离

每个插件在独立 `worker_threads` 中运行，通过 MessagePort 与主线程通信。

```
主线程                              Worker 线程
┌──────────────────────┐      ┌─────────────────────┐
│ PluginRuntimeRegistry │◄───MessagePort──►│ PluginSandbox        │
│ ServerPluginHostApi   │      │  - plugin code       │
│                       │      │  - activate()        │
│                       │      │  - inference req     │
└──────────────────────┘      └─────────────────────┘
```

Host API 方法通过消息传递，Worker 侧提供 proxy。`ContextSourceAdapter`、`StepContributor` 等不可序列化对象通过 "proxy by reference" 模式：主线程持有真实对象，Worker 侧通过消息触发调用。

**优点:** CPU 隔离；内存隔离（`resourceLimits.maxOldGenerationSizeMb`）；可通过 `worker.terminate()` 强制杀死；插件无法调用 `process.exit()` 影响主进程。
**缺点:** 实现量大（2-3 周）；Host API 从同步调用变为异步消息；调试困难。

---

## 八、可观测性（P2）

### 采用方案: Prometheus + 指标端点

引入 `prom-client`，暴露 `GET /metrics` 端点（在 Express app 上注册，可绑定到独立端口或通过 capability 保护）。

**核心指标:**

| 指标 | 类型 | 标签 |
|------|------|------|
| `yidhras_tick_duration_ms` | Histogram | pack_id, step |
| `yidhras_tick_total` | Counter | pack_id, status (success/failed) |
| `yidhras_inference_duration_ms` | Histogram | pack_id, model, task_type |
| `yidhras_inference_total` | Counter | pack_id, model, status |
| `yidhras_action_intents_dispatched` | Counter | pack_id, intent_type, outcome |
| `yidhras_plugins_active` | Gauge | pack_id |
| `yidhras_sidecar_health` | Gauge | sidecar_name (0/1) |
| `yidhras_scheduler_jobs_claimed` | Counter | pack_id, partition_id |

**优点:** 业界标准；Grafana 可视化；支持聚合和告警；`prom-client` 成熟稳定。
**缺点:** 引入外部依赖；需要运维配置 Prometheus server（本地开发可选跳过）。

### 运行时状态 Dump

CLI 命令：

```bash
pnpm --filter yidhras-server sim dump <packId> --type agent|relation|memory|all
```

读取已有 repos，输出 JSON 到 stdout 或写入 `data/dumps/`。

### 边车健康暴露

在 health API 响应中增加边车状态字段。`StdioJsonRpcTransport` 已有心跳检测，暴露即可。

```typescript
sidecar: {
  world_engine: { alive: boolean; latency_ms: number };
  scheduler_decision: { alive: boolean; latency_ms: number };
  memory_trigger: { alive: boolean; latency_ms: number };
}
```

---

## 九、API 版本管理（P2）

### 背景

`ServerPluginHostApi` 接口（`runtime.ts:40-52`）没有版本字段。向它添加任何方法都是对现有插件的静默破坏性变更。

- `manifest_version` 硬编码为 `z.literal('plugin/v1')`，无法表达 Host API 兼容性范围
- `compatibility.yidhras` 只检查核心服务器版本，不检查 Host API 版本
- `WORLD_ENGINE_PROTOCOL_VERSION`（`world_engine.ts:8`）已用于边车协议协商，但插件 Host API 无对应机制

关联文件:
- `apps/server/src/plugins/runtime.ts:40-52` — `ServerPluginHostApi`
- `packages/contracts/src/plugins.ts:23` — `manifest_version: z.literal('plugin/v1')`

### 采用方案: Host API 版本号 + manifest 兼容性声明

```typescript
// 当前 Host API 版本
export const PLUGIN_HOST_API_VERSION = '1.0.0';

// manifest 中增加 host_api 兼容性声明
compatibility: z.object({
  yidhras: nonEmptyStringSchema,
  host_api: semverStringSchema  // 新增: 如 ">=1.0.0 <2.0.0"
})
```

`refreshPackPluginRuntime` 在激活前检查 `manifest.compatibility.host_api` 是否匹配 `PLUGIN_HOST_API_VERSION`。不匹配则拒绝激活并写入 `last_error`。

规则：
- 新增可选参数 → minor bump，兼容
- 新增 Host API 方法 → minor bump，兼容
- 修改/删除现有方法签名 → major bump，不兼容

**优点:** 参照 `WORLD_ENGINE_PROTOCOL_VERSION` 的既定模式；实现量小（约 20 行）；为 P3 的 Worker 隔离（Host API 重大变更）奠定基础。

---

## 十、数据迁移（P3）

### 背景

包本地 `runtime.sqlite` 无 schema 版本控制。Prisma 迁移仅覆盖服务器 DB。宪法 schema 对 `scenario`、`actions`、`decision_rules` 等已废弃字段直接报错拒绝加载，无升级/转换路径。

### 采用方案: Pack schema version + 迁移函数

在 pack `config.yaml` 中增加 `schema_version: 1` 字段。`PackManifestLoader` 加载时检测版本，如有迁移路径则执行：

```typescript
const migrations: Record<number, (config: unknown) => unknown> = {
  // 示例：未来版本 1 → 2 的迁移
  // 1: (config) => migrateV1ToV2(config)
};

const migrateConfig = (config: any, targetVersion: number) => {
  let current = config.schema_version ?? 0;
  let data = config;
  while (current < targetVersion) {
    const migrate = migrations[current];
    if (migrate) data = migrate(data);
    current++;
  }
  return data;
};
```

当前版本从 0（无 `schema_version` 字段）开始。第一版宪法格式即为 version 0。未来格式变更时添加迁移函数。

---

## 十一、测试基础设施（P3）

### 时间操控

在 `TestHarness` 中添加 `advanceTicks(n: number)` 辅助函数，使用模拟时钟。

### Mock AI Provider 增强

在已有 `ai/providers/mock.ts` 中添加：
- **网络分区**: 模拟连接超时（不响应而非返回错误）
- **部分响应**: 返回不完整 JSON
- **Token 限制触发**: 响应超过模型 token 限制

### 快照种子化测试

创建测试辅助：从模板 pack 的快照复制出独立测试 DB，而非每次从头运行 sim loop。

### 属性测试

引入 `fast-check`，为关键纯函数（权限检查、authority 解析）编写属性测试。

---

## 十二、汇总与排序

### 推荐实施顺序

| 阶段 | 内容 | 方案 | 估计 |
|------|------|------|------|
| **P0** | StepContributor 接入 | §一 — executeWorldEnginePreparedStep 内部调用 | 1-2d |
| **P0** | activate() 错误处理修复 | §六 — 空 catch 块 + last_error 写入 | 0.5d |
| **P0** | intent_grounders + pack_projections 删除 | §四 — 从 schema 移除 | 0.5d |
| **P1** | Sim loop 步骤钩子 + 错误隔离 | §二 — 钩子数组 + per-step try/catch | 2-3d |
| **P1** | Manifest 完全结构化 + 判别联合 | §四 | 2-3d |
| **P1** | kind 枚举化（拒绝未知值） | §四 | 0.5d |
| **P1** | deactivate() 钩子 | §六 | 1d |
| **P1** | DataCleaner 消费者接入 | §一 | 1d |
| **P1** | 能力键注册表 + 枚举类型 | §五 | 1d |
| **P2** | 权限层级统一（hasCapability 改修） | §五 | 1-2d |
| **P2** | Action dispatch 注册表 | §三 | 2d |
| **P2** | Prometheus 指标 + 边车健康暴露 | §八 | 2d |
| **P2** | state_transform_evaluator → StepContributor | §一后续验证 | 1-2d |
| **P2** | RuleContributor / QueryContributor 适配层 | §一 | 2-3d |
| **P2** | PromptWorkflowStep 注册表合并 | §一 | 1d |
| **P2** | Host API 版本管理 | §九 | 1d |
| **P2** | 插件超时保护（短期隔离） | §七短期方案 | 1-2d |
| **P2** | 运行时状态 dump CLI | §八 | 1d |
| **P3** | Worker 线程插件隔离 | §七长期方案 | 2-3w |
| **P3** | 数据迁移框架 | §十 | 1w |
| **P3** | 测试辅助（时间操控/属性测试） | §十一 | 1w |
| **P3** | 其他类型安全缺口枚举化 | §四末尾表 | 1w |

### 方案选择总结

| 缺口 | 方案 | 核心理由 |
|------|------|---------|
| StepContributor 接入 | executeWorldEnginePreparedStep 内部调用 | 利用已有 TS 注入点，不改 Rust 协议 |
| Sim loop 钩子 | 步骤级钩子数组 + per-step 错误隔离 | 简单直接，无跨包需求时不引入事件总线 |
| Action dispatch 扩展 | 注册表驱动 + 拒绝内核类型覆盖 | 消除硬编码，三条处理路径边界明确 |
| Manifest 类型 | 完全结构化 + 判别联合 | 项目无上线数据，无需向后兼容 |
| 权限统一 | 分层优先级 + 能力键注册表 | 消除两层矛盾，同时解决能力键无枚举问题 |
| 插件生命周期 | activate 返回值 deactivate + 空 catch 修复 | JS 生态惯例 |
| 插件隔离 | 短期超时 + 长期 Worker | Worker 是唯一真正隔离方案 |
| 可观测性 | Prometheus + 指标端点 | 业界标准，skip 内存指标阶段 |
| API 版本管理 | Host API 版本号 + manifest 兼容性声明 | 参照 WORLD_ENGINE_PROTOCOL_VERSION 既定模式 |
| 数据迁移 | Pack schema version + 迁移函数 | 最小可用，按需扩展 |
| 跨包通信 | 暂不实施 | 当前无需求 |
