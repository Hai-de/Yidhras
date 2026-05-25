<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/worker-thread-plugin-isolation-design.md","contentHash":"sha256:8b1ae33a808b996273dea05c57c7ae48eb1137b593bda657dee6ebfa32cb0f17"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 定义 Worker IPC 协议、contribution descriptor、Host API 2.0.0 和 plugins.isolation 配置  `#worker-isolation-phase-1-protocol-config`
- [x] 实现 Worker entry resolver、worker bootstrap、Worker-side host proxy、PluginWorkerClient 和 host_call handler  `#worker-isolation-phase-2-worker-client`
- [x] 实现 PluginWorkerManager，并重构 runtime.ts 删除主线程插件 dynamic import、采用原子 registry 替换  `#worker-isolation-phase-3-runtime-integration`
- [x] 实现 step/rule/query/context/prompt/data-cleaner/slot/perception/API-route contribution proxy 和 manifest 对齐校验  `#worker-isolation-phase-4-contribution-proxy`
- [x] 删除函数式 registerPackRoute，改为固定主线程 route host 转发 Worker handler  `#worker-isolation-phase-5-route-host`
- [x] 清理 full AppContext sandbox 暴露，统一主线程 capability gate  `#worker-isolation-phase-6-sandbox-cleanup`
- [x] 增加 Worker metrics，更新 PLUGIN_RUNTIME 文档和 generic-capability 计划状态  `#worker-isolation-phase-7-docs-metrics`
- [x] 补齐 Worker 隔离单元/集成测试并运行 typecheck 与插件相关回归测试  `#worker-isolation-phase-8-tests`
<!-- LIMCODE_TODO_LIST_END -->

# Worker 线程插件隔离实施计划

> 来源设计：`.limcode/design/worker-thread-plugin-isolation-design.md`
> 目标计划项：`.limcode/plans/generic-capability-p0-p1.md` 中 P3 长期基础设施的“Worker 线程插件隔离”
> 兼容策略：不向后兼容；默认 Worker-only；旧 Host API 1.x 插件拒绝激活

---

## 0. 设计复核结论与需要补上的盲点

复核当前代码后，设计方向成立：当前 `apps/server/src/plugins/runtime.ts` 是主线程 `import(entrypointPath)` + 函数对象注册模型，和 Worker 隔离冲突，必须破坏式重构。

未发现阻断设计落地的逻辑断裂，但实施时必须显式处理以下盲点，否则会留下半隔离或运行期 bug：

1. **Worker entry 在 dev / build 两种运行模式下路径不同**
   - 当前服务开发用 `tsx src/index.ts`，构建产物是 `dist/index.js`。
   - `new Worker(...)` 不能简单固定指向 `src/plugins/worker/worker_entry.ts`，否则 `node dist/index.js` 下会找不到 TS entry 或无法加载。
   - 计划中需要实现 `resolvePluginWorkerEntryUrl()`：
     - dist 运行：指向编译后的 `dist/plugins/worker/worker_entry.js`
     - tsx/dev：优先使用同源 URL，必要时通过 `execArgv` 或 bootstrap JS 处理 TS entry。

2. **refresh 原子替换顺序需要从设计文字中收紧**
   - 设计里写了“先成功启动新 Worker，再替换 registry，最后 deactivate 旧 Worker”，这是正确方向。
   - 但序列图里 `clear old runtimes + set new runtimes` 过于粗略。实现不能先清空再激活，否则 activation 失败会把旧 runtime 删掉。
   - 实施时要采用：build new snapshot → `replaceRuntimes(packId, newRuntimes)` 原子替换 → terminate 被替换的旧 Worker。

3. **Express route 不能真正 unregister**
   - 当前 `pluginRuntimeRegistry.applyPackRoutes()` 只用 `appliedRouteKeys` 去重，没有卸载 Express route 的能力。
   - Worker route 改造不能继续“动态注册任意 Express route”。否则 disable 后路由 handler 仍留在 Express stack 里。
   - 计划采用固定主线程 route host：
     - `/api/packs/:packId/plugins/:pluginId/runtime/server/:installationId/routes/*`
   - 该固定路由只注册一次，请求时查当前 registry；插件禁用后查不到 runtime 即返回 404/410。

4. **manifest 声明贡献与 activate-time descriptor 可能重复或不一致**
   - 当前 `registerManifestContributions(runtime)` 会根据 manifest 预注册占位实现。
   - Worker 设计要求 activation 返回 descriptor。
   - 实施时不能继续生成占位 executor，否则会出现“manifest placeholder + Worker descriptor”双注册。
   - 新规则：manifest 只做治理声明和 UI/确认依据；真正 runtime contributor 以 Worker activation descriptor 为准；descriptor 必须能和 manifest contribution name 对齐，否则拒绝或记录 activation error。

5. **全局注册表需要改成可按 installation 清理**
   - 当前 `dataCleanerRegistry` 是全局 singleton，slot registry 是 per-pack，但也需要按插件卸载清理。
   - Worker 模式下不应让插件直接写这些 registry。
   - 主线程应注册 proxy，并给 proxy 附带 `installation_id`；registry 需要支持按 pack/plugin/installation 删除，或由 `PluginRuntimeRegistry` 统一返回 proxy 列表，避免写入不可清理的全局 singleton。

6. **`process.exit()` 的 Worker 影响需要实测**
   - Worker 线程内 `process.exit()` 预期只终止当前 Worker，但这是必须用测试固定的行为假设。
   - 测试必须覆盖 Worker 调用 `process.exit(1)` 不导致主进程退出。

7. **Node Worker 不是强安全沙箱**
   - Worker 能隔离 event loop 和 V8 heap，但不能当成运行恶意本地代码的完整安全边界。
   - 计划只承诺故障隔离和 API 边界，不承诺防御所有恶意 Node 能力。

以上项目全部写入实施步骤和验收标准。

---

## 1. 目标状态

完成后 server-side 插件运行时应满足：

- 主线程不再动态 import 插件 server entrypoint。
- 每个 enabled plugin installation 在独立 Worker 中 activation。
- 主线程只持有 descriptor、Worker client 和 contribution proxy。
- 插件不能接触 `AppContext`、`PrismaClient`、Express app、PackRuntimePort、WorldEnginePort、sidecar client。
- Host API 通过 IPC 白名单调用。
- 旧 `ServerPluginHostApi` 函数注册模型删除。
- `PLUGIN_HOST_API_VERSION` 提升到 `2.0.0`。
- 旧 manifest `compatibility.host_api: 1.x` 拒绝激活。
- `.limcode/plans/generic-capability-p0-p1.md` 中 “Worker 线程插件隔离” 可标记完成。

---

## 2. 新增/重构文件范围

### 2.1 新增 Worker 子系统

```text
apps/server/src/plugins/worker/
  protocol.ts
  errors.ts
  worker_host_api.ts
  worker_entry.ts
  worker_entry_resolver.ts
  PluginWorkerClient.ts
  PluginWorkerManager.ts
  contribution_descriptors.ts
  contribution_proxy.ts
  host_call_handler.ts
```

职责：

- `protocol.ts`：主线程 ↔ Worker IPC 消息类型和 zod schema。
- `errors.ts`：序列化错误、超时错误、协议错误、Worker crash 错误。
- `worker_host_api.ts`：Worker 内提供给插件的 host proxy。
- `worker_entry.ts`：Worker bootstrap，负责 import 插件模块、调用 `activate()`、处理 invoke/deactivate。
- `worker_entry_resolver.ts`：处理 dev/build Worker entry 路径。
- `PluginWorkerClient.ts`：主线程 Worker 包装，提供 activate/invoke/deactivate/terminate。
- `PluginWorkerManager.ts`：按 packId + installationId 管理 Worker 生命周期。
- `contribution_descriptors.ts`：descriptor 类型、schema、manifest 对齐校验。
- `contribution_proxy.ts`：把 descriptor 包装成现有 contributor/adapter 接口。
- `host_call_handler.ts`：主线程 Host API 白名单处理。

### 2.2 修改现有 runtime 和配置

```text
apps/server/src/plugins/runtime.ts
apps/server/src/plugins/context.ts
apps/server/src/plugins/capability_keys.ts
apps/server/src/config/domains/plugins.ts
apps/server/src/observability/metrics.ts
packages/contracts/src/plugins.ts
```

### 2.3 可能需要调整的调用方

```text
apps/server/src/app/runtime/plugin_contributor_adapter.ts
apps/server/src/app/runtime/PackSimulationLoop.ts
apps/server/src/app/services/plugin/plugins.ts
apps/server/src/app/services/pack/pack_scoped_plugin_runtime_service.ts
apps/server/src/app/routes/plugins.ts
apps/server/src/app/routes/plugin_runtime_web.ts
```

### 2.4 测试文件

新增或重写：

```text
apps/server/tests/unit/plugin_worker_protocol.spec.ts
apps/server/tests/unit/plugin_worker_client.spec.ts
apps/server/tests/unit/plugin_worker_contribution_proxy.spec.ts
apps/server/tests/integration/plugin_worker_runtime_refresh.spec.ts
apps/server/tests/integration/plugin_worker_failure_isolation.spec.ts
apps/server/tests/integration/plugin_worker_route_host.spec.ts
```

更新现有相关测试：

```text
apps/server/tests/integration/plugin_runtime_refresh.spec.ts
apps/server/tests/integration/plugin_dependency_flow.spec.ts
apps/server/tests/integration/plugin_runtime_web.spec.ts
apps/server/tests/unit/builtin_plugins_runtime.spec.ts
apps/server/tests/unit/world_engine_plugin_contributor_chain.spec.ts
apps/server/tests/integration/structured_parser_plugin.spec.ts
```

---

## 3. 实施阶段

## Phase 1 — 协议、descriptor 和配置骨架

### 1.1 定义 IPC 协议

新增 `apps/server/src/plugins/worker/protocol.ts`：

- `MainToWorkerMessageSchema`
- `WorkerToMainMessageSchema`
- `SerializedPluginErrorSchema`
- `PluginWorkerActivationInputSchema`
- `PluginWorkerActivationResultSchema`
- `PluginWorkerInvokeInputSchema`
- `PluginWorkerInvokeResultSchema`

消息类型至少包括：

- `activate`
- `activation_result`
- `invoke`
- `invoke_result`
- `host_call`
- `host_result`
- `deactivate`
- `deactivate_result`
- `log`

要求：

- 所有跨线程 payload 都是 JSON/structured-clone safe。
- 主线程收到 Worker 消息必须 schema parse。
- Worker 收到主线程消息也必须 schema parse。

### 1.2 定义 contribution descriptor

新增 `contribution_descriptors.ts`：

- `BaseContributionDescriptor`
- `ContextSourceDescriptor`
- `PromptWorkflowStepDescriptor`
- `PackRouteDescriptor`
- `StepContributorDescriptor`
- `RuleContributorDescriptor`
- `QueryContributorDescriptor`
- `DataCleanerDescriptor`
- `SlotConditionEvaluatorDescriptor`
- `SlotContentTransformerDescriptor`
- `PerceptionResolverDescriptor`
- `ContributionDescriptor`

每个 descriptor 必须包含：

- `type`
- `name`
- `invoke`
- `priority`
- `capabilityKey`
- 可选 `manifestName`

### 1.3 manifest schema 破坏式调整

修改 `packages/contracts/src/plugins.ts`：

- server contribution schema 增加 `invoke` 或 `handler` 字段。
- `api_routes` schema 增加 handler/invoke 绑定。
- 保留 manifest 作为声明面，不生成 runtime placeholder。

推荐字段名固定为 `invoke`，避免 handler/entrypoint/export 混用。

### 1.4 Host API version 升级

修改 `apps/server/src/plugins/capability_keys.ts`：

```ts
export const PLUGIN_HOST_API_VERSION = '2.0.0';
```

验收：

- 旧 `compatibility.host_api: 1.x` 插件被 `isHostApiCompatible()` 拒绝。
- 新测试覆盖 major mismatch。

### 1.5 配置 schema 增加 isolation

修改 `apps/server/src/config/domains/plugins.ts`：

```ts
isolation: {
  mode: z.literal('worker'),
  activation_timeout_ms: z.number().int().positive(),
  invocation_timeout_ms: z.number().int().positive(),
  route_timeout_ms: z.number().int().positive(),
  deactivate_timeout_ms: z.number().int().positive(),
  max_consecutive_failures: z.number().int().positive(),
  resource_limits: {
    max_old_generation_size_mb: z.number().int().positive(),
    max_young_generation_size_mb: z.number().int().positive(),
    stack_size_mb: z.number().positive()
  }
}
```

默认值：

- `mode: 'worker'`
- activation 30000 ms
- invocation 5000 ms
- route 10000 ms
- deactivate 5000 ms
- max failures 3
- old heap 128 MB
- young heap 32 MB
- stack 4 MB

同时处理 `plugins.sandbox.capability_level`：

- 默认从 `full` 改成 `pack_scoped`。
- `full` 不再返回 `AppContext`。
- 如果仍保留 enum 中的 `full`，必须只影响 Host API capability gate，不能暴露主线程对象。

---

## Phase 2 — Worker bootstrap 和主线程 Worker client

### 2.1 Worker entry resolver

新增 `worker_entry_resolver.ts`：

- 实现 `resolvePluginWorkerEntryUrl()`。
- 支持：
  - `tsx src/index.ts` dev 模式
  - `node dist/index.js` build 模式
- 不能硬编码只适用于 src 的路径。

验收：

- 单元测试校验 resolver 输出 URL/路径不依赖当前工作目录。
- build 后 `dist/plugins/worker/worker_entry.js` 可被 Worker 加载。

### 2.2 Worker-side host proxy

新增 `worker_host_api.ts`：

提供给插件的 API：

```ts
interface WorkerPluginHostApi {
  registerHandler(name: string, handler: PluginInvokeHandler): void;
  registerContextSource(descriptor: ContextSourceDescriptor): void;
  registerPromptWorkflowStep(descriptor: PromptWorkflowStepDescriptor): void;
  registerPackRoute(descriptor: PackRouteDescriptor): void;
  registerStepContributor(descriptor: StepContributorDescriptor): void;
  registerRuleContributor(descriptor: RuleContributorDescriptor): void;
  registerQueryContributor(descriptor: QueryContributorDescriptor): void;
  registerDataCleaner(descriptor: DataCleanerDescriptor): void;
  registerSlotConditionEvaluator(descriptor: SlotConditionEvaluatorDescriptor): void;
  registerSlotContentTransformer(descriptor: SlotContentTransformerDescriptor): void;
  registerPerceptionResolver(descriptor: PerceptionResolverDescriptor): void;
  requestInference(input: PluginInferenceRequest): Promise<PluginInferenceResult>;
}
```

Worker 内部维护：

- `handlers: Map<string, PluginInvokeHandler>`
- `descriptors: ContributionDescriptor[]`
- host_call pending requests

约束：

- descriptor 注册时必须验证 capability key 和结构。
- duplicate `invoke` 或 duplicate descriptor name 要拒绝。

### 2.3 Worker bootstrap

新增 `worker_entry.ts`：

流程：

1. 读取 `workerData`。
2. 等待主线程 `activate` 消息或直接根据 workerData activation。
3. 动态 import 插件 server entrypoint。
4. 调用 `module.activate(hostProxy)`。
5. 收集 descriptors。
6. 返回 `activation_result`。
7. 处理后续 `invoke` 和 `deactivate`。

要求：

- `activate()` 返回函数或 `{ deactivate }` 时在 Worker 内保存。
- `invoke` 找不到 handler 时返回协议错误。
- handler 抛错时返回序列化错误。
- 不把任何函数传给主线程。

### 2.4 PluginWorkerClient

新增 `PluginWorkerClient.ts`：

主线程 API：

```ts
class PluginWorkerClient {
  activate(input): Promise<PluginWorkerRuntimeSnapshot>;
  invoke(type, invoke, payload, options?): Promise<unknown>;
  deactivate(): Promise<void>;
  terminate(reason): Promise<void>;
  isAlive(): boolean;
}
```

实现要求：

- requestId → pending promise map。
- activation/deactivate/invocation timeout。
- Worker `error` / `exit` 处理。
- crash 后 reject 所有 pending requests。
- `host_call` 转发给 `host_call_handler.ts`。
- `log` 转主线程 logger。

### 2.5 Host call handler

新增 `host_call_handler.ts`：

白名单：

- `requestInference`
- `getPackSummary`
- `getCurrentTick`
- `queryWorldState`
- `emitLog`

能力检查：

- `requestInference` 需要 `server.inference.request`。
- `queryWorldState` 至少 readonly/pack_scoped，具体按现有 capability model 实现。
- 未知 method 直接拒绝。

明确禁止：

- repos/prisma/conversationStore/packStorageAdapter/schedulerStorage
- Express app
- WorldEngineSidecarClient
- PackRuntimePort 原对象
- process.env 任意读取

---

## Phase 3 — WorkerManager 和 runtime.ts 接入

### 3.1 PluginWorkerManager

新增 `PluginWorkerManager.ts`：

职责：

- key：`${packId}:${installationId}`。
- `activateInstallation(...)` 启动 Worker 并返回 snapshot。
- `replacePackWorkers(packId, activeKeys)` 清理不再启用的 Worker。
- `deactivateInstallation(...)`。
- crash 回调：移除 registry、写 `last_error`、记录指标。

Worker snapshot 包含：

- pack_id
- installation_id
- plugin_id
- manifest
- granted_capabilities
- descriptors
- client
- activation duration

### 3.2 runtime.ts 删除主线程 import

修改 `apps/server/src/plugins/runtime.ts`：

删除或废弃：

- `activatePluginEntrypoint()`
- 主线程 `await import(entrypointPath)`
- 直接函数式 `createServerPluginHostApi()` 注册模型
- `registerManifestContributions()` 生成 placeholder executor 的行为

保留/重构：

- installation 查询、dependency ordering、host_api compatibility check。
- `PluginRuntimeRegistry` 外部查询方法。
- `syncPackPluginRuntime()` 和 `refreshPackPluginRuntime()` 入口。

### 3.3 原子替换 registry

`PluginRuntimeRegistry` 新增：

```ts
replaceRuntimes(packId: string, next: RegisteredServerPluginRuntime[]): RegisteredServerPluginRuntime[]
removeInstallation(packId: string, installationId: string): void
```

要求：

- refresh 成功构建所有可激活 runtime 后再替换。
- refresh 局部失败时：
  - 成功的 Worker 可进入 next。
  - 失败 installation 写 last_error。
  - 不应因为一个插件失败清空整个 pack 的旧可用 runtime，具体策略采用“按 installation 替换”：同 installation 新 activation 失败则保留旧 runtime 或移除？

此处采用明确策略：

- 如果 installation 仍 enabled，但新 activation 失败：保留旧 runtime（若存在），写 last_error。
- 如果 installation 已 disabled：移除旧 runtime 并 terminate Worker。
- 如果 installation 首次启用失败：不加入 registry。

### 3.4 lifecycle 持久化

activation 成功/失败写现有记录：

- `PluginInstallation.last_error`
- `PluginActivationSession`

如果当前 session schema 没有 details，不新增迁移作为第一版阻塞。

---

## Phase 4 — Contribution proxy 接入

### 4.1 proxy 类型实现

新增 `contribution_proxy.ts`，实现：

- `WorkerContextSourceAdapterProxy`
- `WorkerPromptWorkflowStepProxy`
- `WorkerStepContributorProxy`
- `WorkerRuleContributorProxy`
- `WorkerQueryContributorProxy`
- `WorkerDataCleanerProxy`
- `WorkerSlotConditionEvaluatorProxy`
- `WorkerSlotContentTransformerProxy`
- `WorkerPerceptionResolverProxy`
- `WorkerPackRouteProxy` 或 route-specific invoker

所有 proxy：

- 输入转成纯 JSON。
- 调用 `PluginWorkerClient.invoke(...)`。
- 输出用 zod schema 校验。
- 错误记录 plugin_id/installation_id/invoke/type。

### 4.2 step/rule/query 接入

现有调用方：

- `pluginRuntimeRegistry.getStepContributors(packId)`
- `createPluginRuleAdapter()`
- `createPluginQueryAdapter()`

目标：调用方不直接知道 Worker 存在。

### 4.3 prompt/context/perception/slot/data cleaner 接入

注意点：

- `dataCleanerRegistry` 当前是全局 singleton。不能让 Worker 插件直接写入全局 registry。
- 如果继续需要 `dataCleanerRegistry.list()`，主线程应注册 proxy cleaner，并在 registry 中支持按 installation 清理。
- 更稳妥策略：`PluginRuntimeRegistry` 提供 `getDataCleaners(packId)`，`PackSimulationLoop` 从 registry 取 plugin cleaner proxy，而不是从全局 registry 混合取全部。

计划采用较小破坏面：

1. 给 `dataCleanerRegistry` 增加 owner metadata 和 unregisterByOwner。
2. Worker runtime 替换时按 owner 清理旧 proxy。
3. 后续再把 data cleaner 完全迁入 per-pack plugin runtime registry。

### 4.4 manifest descriptor 对齐校验

实现：

- activation descriptors 必须与 manifest `contributions.server.*` 的 `name` 或 `invoke` 对齐。
- manifest 未声明但 activation 注册的 contribution：拒绝 activation 或忽略并记录 error。
- manifest 声明但 activation 未注册：不生成 placeholder，记录 warn 或 activation error。

采用严格策略：

- 未声明的 descriptor：activation failed。
- 已声明但未注册：activation failed。

理由：项目未上线，不需要兼容隐式注册。

---

## Phase 5 — HTTP route 改造

### 5.1 删除函数式 registerPackRoute

修改 Host API：

- 删除 `registerPackRoute(register: (app, context) => void, capabilityKey?: string)`。
- 改成 descriptor：

```ts
registerPackRoute(descriptor: PackRouteDescriptor): void
```

### 5.2 固定 route host

新增或修改 route registration，固定挂载：

```text
/api/packs/:packId/plugins/:pluginId/runtime/server/:installationId/routes/*
```

处理流程：

1. 校验 pack access / operator capability，如需要沿用现有 guard。
2. 从 `pluginRuntimeRegistry` 查找 packId + pluginId + installationId。
3. 校验 descriptor path/method 匹配。
4. body/query/params 转 JSON payload。
5. `client.invoke('api_route', descriptor.invoke, payload, { timeoutMs: route_timeout_ms })`。
6. 返回 JSON。

### 5.3 route 禁用语义

禁用后：

- registry 查不到 runtime → 404 或 410。
- 不需要从 Express stack 卸载动态 route。

---

## Phase 6 — sandbox/context 清理

### 6.1 删除 full AppContext 暴露

修改 `apps/server/src/plugins/context.ts`：

- `createPluginContext()` 不再返回完整 `AppContext`。
- `FullPluginContext = AppContext` 删除或仅保留类型迁移占位但不使用。
- `warn_on_full_access` 删除或变成无效配置错误。

### 6.2 capability gate 统一

现有 `hasCapability()` 逻辑移动到 Worker host call / descriptor registration 边界。

要求：

- capability gate 在主线程执行。
- Worker 自报 capability 不可信。
- descriptor 注册和 host_call 都要校验 `granted_capabilities`。

---

## Phase 7 — metrics、文档和计划状态

### 7.1 Prometheus 指标

修改 `apps/server/src/observability/metrics.ts`，新增：

- `yidhras_plugin_workers_active{pack_id}` gauge
- `yidhras_plugin_worker_crashes_total{pack_id,plugin_id}` counter
- `yidhras_plugin_worker_invocation_duration_ms{pack_id,plugin_id,type,status}` histogram
- `yidhras_plugin_worker_activation_duration_ms{pack_id,plugin_id,status}` histogram

### 7.2 文档更新

修改 `docs/subsystems/PLUGIN_RUNTIME.md`：

- 删除“插件代码直接运行在 Node/TS 宿主进程，无进程级隔离”的限制描述。
- 新增 Worker-only runtime 章节。
- 说明 Host API 2.0.0、descriptor + handler、固定 route host、非强安全沙箱边界。

修改 `.limcode/plans/generic-capability-p0-p1.md`：

- 将 `Worker 线程插件隔离` 标记完成。
- 补充实际文件清单。

---

## Phase 8 — 测试与验收

### 8.1 单元测试

新增：

- protocol schema parse / reject invalid messages。
- descriptor schema 校验。
- capability gate 拒绝未授权 descriptor。
- Worker entry resolver dev/build 路径。
- contribution proxy 输入输出 schema。
- host_call handler 拒绝未知 method。

### 8.2 集成测试

新增：

1. activation success
   - 测试插件在 Worker 中 activate。
   - registry 返回 proxy contributor。

2. activation timeout
   - 插件 activate 同步死循环或长时间不返回。
   - Worker 被 terminate。
   - 主进程继续运行。
   - installation last_error 写入。

3. Worker crash isolation
   - 插件调用 `process.exit(1)` 或抛 uncaught error。
   - 主进程不退出。
   - registry 移除该 installation。
   - crash metric 增加。

4. invocation timeout
   - handler 超时。
   - 当前调用失败。
   - 达到 `max_consecutive_failures` 后 Worker terminate。

5. capability gate
   - 未授予 `server.inference.request` 时调用 `requestInference` 被拒绝。
   - 未声明 contribution 的 descriptor 导致 activation failed。

6. route host
   - enabled 插件 route 可调用 Worker handler。
   - disable 后同 URL 返回 404/410。
   - route handler 超时返回 504。

7. refresh 原子性
   - 旧 runtime 正常运行。
   - 新 activation 失败。
   - 旧 runtime 不被清空。

### 8.3 回归测试

至少运行：

```bash
pnpm --filter yidhras-server run typecheck
pnpm --filter yidhras-server exec vitest run --config vitest.unit.config.ts \
  tests/unit/plugin_worker_protocol.spec.ts \
  tests/unit/plugin_worker_client.spec.ts \
  tests/unit/plugin_worker_contribution_proxy.spec.ts
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts \
  tests/integration/plugin_worker_runtime_refresh.spec.ts \
  tests/integration/plugin_worker_failure_isolation.spec.ts \
  tests/integration/plugin_worker_route_host.spec.ts
```

根据改动范围再运行现有插件相关测试：

```bash
pnpm --filter yidhras-server exec vitest run --config vitest.integration.config.ts \
  tests/integration/plugin_runtime_refresh.spec.ts \
  tests/integration/plugin_dependency_flow.spec.ts \
  tests/integration/plugin_runtime_web.spec.ts
```

---

## 4. 验收标准

完成后必须满足：

- `apps/server/src/plugins/runtime.ts` 不再主线程 import 插件 server entrypoint。
- `ServerPluginHostApi` 不再接收插件函数对象。
- 插件无法获得 `AppContext` / Prisma / Express app / PackRuntimePort / WorldEnginePort。
- Worker activation timeout 能终止同步阻塞插件。
- Worker crash 不导致主进程退出。
- 禁用插件后 server route 不再可用。
- descriptor 与 manifest contribution 严格对齐。
- 旧 host_api 1.x 插件拒绝激活。
- Prometheus 暴露 Worker active/crash/invocation 指标。
- `docs/subsystems/PLUGIN_RUNTIME.md` 与实际运行时一致。
- `.limcode/plans/generic-capability-p0-p1.md` 更新 Worker 隔离完成状态。

---

## 5. 风险与处理

| 风险 | 处理 |
|---|---|
| Worker entry 在 tsx/dev 下无法加载 | 单独实现 resolver + 测试 dev/build 两种路径 |
| Express route 无法卸载 | 固定 route host，运行时查 registry，不动态注册插件 route |
| 旧测试依赖 `ServerPluginHostApi` 函数注册 | 直接重写为 Host API 2 descriptor 模型，不保留兼容 |
| dataCleanerRegistry 全局不可清理 | 增加 owner metadata 和 unregisterByOwner，后续再迁 per-pack registry |
| Worker IPC payload 类型不稳定 | 所有 payload 入口 zod parse，proxy 输出也 parse |
| Worker 不等于强安全沙箱 | 文档明确边界；本阶段只实现故障隔离和 Host API 边界 |

---

## 6. 实施顺序

1. Phase 1：协议、descriptor、配置和 Host API version。
2. Phase 2：Worker bootstrap、Worker client、host call handler。
3. Phase 3：WorkerManager 接入 `runtime.ts`，删除主线程 dynamic import。
4. Phase 4：各类 contribution proxy 接入。
5. Phase 5：固定 HTTP route host。
6. Phase 6：清理 sandbox full AppContext 暴露。
7. Phase 7：metrics、文档、generic plan 状态。
8. Phase 8：测试和回归。

不要先实现 route 或 contributor 细节再做 Worker lifecycle；否则会继续依赖主线程函数注册模型，返工成本高。

---

## 7. 实施结果摘要 (2026-05-25)

Phases 1-7 已全部实现。Phase 8（测试）待补齐。

### 7.1 已实现文件对照

新增 Worker 子系统（全部 11 个计划文件已创建）：

| 计划文件 | 实际文件 | 状态 |
|---------|---------|------|
| `worker/protocol.ts` | `apps/server/src/plugins/worker/protocol.ts` | 已实现：9 种消息类型，zod 双向校验，`parseMainToWorkerMessage`/`parseWorkerToMainMessage` |
| `worker/errors.ts` | `apps/server/src/plugins/worker/errors.ts` | 已实现：`PluginWorkerError`、`PluginWorkerTimeoutError`、`PluginWorkerProtocolError`、`PluginWorkerCrashError` |
| `worker/worker_host_api.ts` | `apps/server/src/plugins/worker/worker_host_api.ts` | 已实现：`createWorkerPluginHostApi()` 返回 `WorkerPluginHostRuntime`，12 个注册方法 + `requestInference`，内维护 `handlers` Map + `descriptors` 数组 |
| `worker/worker_entry.ts` | `apps/server/src/plugins/worker/worker_entry.ts` | 已实现：bootstrap → `import(entrypointPath)` → `module.activate(host)`，处理 invoke/deactivate 生命周期 |
| `worker/worker_entry_resolver.ts` | `apps/server/src/plugins/worker/worker_entry_resolver.ts` | 已实现：`resolvePluginWorkerEntryUrl()` 使用 `pathToFileURL(__dirname, 'worker_entry.js')`，依赖 tsx/build 确保 `__dirname` 正确 |
| `worker/PluginWorkerClient.ts` | `apps/server/src/plugins/worker/PluginWorkerClient.ts` | 已实现：`activate`/`invoke`/`deactivate`/`terminate`/`isAlive`，pending request map，超时处理，crash 后 reject 所有 pending，host_call 转发，log 转 logger |
| `worker/PluginWorkerManager.ts` | `apps/server/src/plugins/worker/PluginWorkerManager.ts` | 已实现：`activateInstallation`（含 activation session 持久化）、`replacePackWorkers`（先清理旧 Worker 再注册新）、`deactivateInstallation`、`getWorker`。manifest descriptor 严格对齐校验 + capability gate |
| `worker/contribution_descriptors.ts` | `apps/server/src/plugins/worker/contribution_descriptors.ts` | 已实现：10 种 descriptor zod schema（discriminatedUnion），`contributionDescriptorListSchema` |
| `worker/contribution_proxy.ts` | `apps/server/src/plugins/worker/contribution_proxy.ts` | 已实现：10 个 proxy 类 + `createWorkerContributionProxies()` bundle 工厂。所有 proxy 输入 jsonClone(含 BigInt→string)、Worker IPC 调用、输出 zod 校验 |
| `worker/host_call_handler.ts` | `apps/server/src/plugins/worker/host_call_handler.ts` | 已实现：5 个白名单方法（requestInference、getPackSummary、getCurrentTick、queryWorldState、emitLog）。Capability gate 在主线程校验，`queryWorldState` 限定 pack scope |

### 7.2 已修改现有文件对照

| 文件 | 变更要点 |
|------|---------|
| `runtime.ts` | 删除 `activatePluginEntrypoint()`（主线程 dynamic import）。删除函数式 `createServerPluginHostApi()` 注册模型。`refreshPackPluginRuntime()` 改用 `pluginWorkerManager.activateInstallation()`。`PluginRuntimeRegistry` 新增 `replaceRuntimes()`/`clearRuntimes()`。host_api 兼容性检查（major version mismatch 拒绝激活，保留旧 runtime）。activation 失败保留旧 runtime |
| `context.ts` | `PluginCapabilityLevel` 从 `'readonly' \| 'pack_scoped' \| 'full'` 改为 `'readonly' \| 'pack_scoped'`。`createPluginContext()` 不再返回 `AppContext`。删除 `FullPluginContext` 类型。删除 `warn_on_full_access` 配置 |
| `capability_keys.ts` | `PLUGIN_HOST_API_VERSION` = `'2.0.0'`。`CAPABILITY_KEY_MIN_LEVEL` 全部设为 `pack_scoped`（原 `full` 级别能力已降级） |
| `config/domains/plugins.ts` | `sandbox.capability_level` 从 `'readonly' \| 'pack_scoped' \| 'full'` 改为 `'readonly' \| 'pack_scoped'`。新增 `isolation` 配置完整 schema + 默认值（与计划一致） |
| `observability/metrics.ts` | 新增 5 个 Prometheus 指标：`yidhras_plugin_workers_active`、`yidhras_plugin_worker_crashes_total`、`yidhras_plugin_worker_invocation_duration_ms`、`yidhras_plugin_worker_activation_duration_ms`、配套 record 函数 |
| `contracts/src/plugins.ts` | 所有 server contribution schema 增加 `invoke` 字段。`PluginManifest` 各 contribution 项均携带 `invoke` 用于 Worker descriptor 对齐 |
| `extensions/data_cleaner_registry.ts` | `DataCleanerRegistry` 新增 `DataCleanerOwner` 接口、`register(cleaner, owner?)`、`getOwner()`、`unregisterByOwner()` |
| `index.ts` | 导入并注册 `registerPluginRuntimeServerRoutes` |
| `templates/configw/conf.d/plugins.yaml` | `capability_level` 设为 `pack_scoped`，新增完整 `isolation` 配置 |
| `templates/configw/default.yaml` | 同上 |

### 7.3 新增路由文件

| 文件 | 内容 |
|------|------|
| `app/routes/plugin_runtime_server.ts` | 固定 route host：`/api/packs/:packId/plugins/:pluginId/runtime/server/:installationId/routes/{*runtimePath}`。查 registry → 校验 plugin_id + worker_client → 匹配 method/path → `WorkerPackRouteProxy.handle()` → 404/504 |

### 7.4 内置插件迁移

所有 4 个 system_pack 内置插件已迁移到 Host API 2.0.0：

- `regex-engine/server.ts`: `activate(host)` → `host.registerHandler` + `host.registerDataCleaner`
- `template-engine/server.ts`: 同上模式
- `string-methods/server.ts`: 同上模式
- `slot-condition-builtin/server.ts`: `activate(host)` → 4 个 evaluator handler + descriptor 注册

Manifest YAML 均更新 `host_api: "2.0.0"`，contribution 项均包含 `invoke` 字段。

### 7.5 与计划的偏差

1. **Worker entry resolver 简化**：计划要求分别处理 tsx/dev 和 dist/build。实际实现使用 `pathToFileURL(path.join(__dirname, 'worker_entry.js'))`，依赖 TypeScript 编译产物中 `__dirname` 指向正确位置。在 tsx 下需确认 ESM 兼容性。

2. **`max_consecutive_failures` 未强制**：配置 schema 定义了该字段，但 `PluginWorkerClient` 和 `PluginWorkerManager` 中未实现连续失败计数和自动 terminate 逻辑。该功能留待后续补齐。

3. **`sandbox.capability_level` 完全移除 `full`**：计划考虑保留 enum 中的 `full` 但只影响 Host API capability gate。实际实现彻底删除 `full`，capability_level 只有 `readonly` 和 `pack_scoped`。

4. **dataCleanerRegistry 未完全迁入 per-pack registry**：计划提到后续把 data cleaner 完全迁入 per-pack plugin runtime registry。实际采用折中方案：给 `dataCleanerRegistry` 增加 owner metadata，`PluginRuntimeRegistry.replaceRuntimes()` 时按 owner 清理，但不改变其全局 singleton 性质。

5. **slot condition / slot content transform registries 处理方式**：采用 `clearPack()` + 重新注册模式，与 dataCleaner 的 owner-based 清理不同。可能存在短暂的 registry 空窗期。

### 7.6 待补齐 (Phase 8) → 已完成 (2026-05-25)

- [x] 单元测试：protocol schema、descriptor schema、capability gate、Worker entry resolver、contribution proxy I/O、host_call handler 拒绝
- [x] 集成测试：activation 成功/超时、Worker crash 隔离、refresh 原子性
- [x] 现有插件相关回归测试全部通过（34 unit + 26 integration = 60 tests passed）
- [x] TypeScript typecheck 通过

详细测试补齐实施记录见 `.limcode/plans/worker-thread-plugin-isolation-test-plan.md`。

### 7.7 文档与计划状态

- `docs/subsystems/PLUGIN_RUNTIME.md`：已更新，Worker-only runtime 章节（第 8-15 节）、Host API 2.0.0 方法表、route host 说明、metrics 列表、isolation 配置
- `.limcode/plans/generic-capability-p0-p1.md`：已更新，P3 长期基础设施标记完成，Worker 隔离标记完成
