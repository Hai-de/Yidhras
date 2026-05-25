# Pack-local Plugin Runtime

Plugins extend what a world-pack can do — adding UI panels, custom routes, new capabilities — but they must be discovered, trusted, and governed before they can run. This document describes how that lifecycle works: from discovery to import confirmation, from enable-with-acknowledgement to runtime manifest loading, and how the server and browser sides cooperate to keep the boundary tight.

The core design principle is that **plugin governance is a kernel-side concern**: discovery records, installation state, activation sessions, and enable acknowledgements all live in the kernel database, not inside the pack's own runtime. This means the host always decides whether a plugin is allowed to run, and the pack never gets to bypass that decision.

Key concepts:

- **PluginArtifact / PluginInstallation / PluginActivationSession / PluginEnableAcknowledgement** — the kernel-side persistence models that track what was discovered, what was imported, what's active, and whether the operator has acknowledged the enable warning
- **PackHostApi** — the read-only contract through which plugins and workflows access world state, owned by the TS host kernel; it is not a migration bridge but a long-term host contract
- **PackRuntimeLookupPort / PackScopeResolver** — the unified scope resolution mechanism that prevents plugin runtime, web routes, and projection logic from each inventing their own lookup
- **pack-local** — the formal boundary: a plugin belongs to exactly one pack, and its lifecycle and visibility are scoped accordingly

本文档集中说明 pack-local plugin 的 runtime、治理语义与前后端承接边界。

## 1. 文档定位

本文件回答：

- pack-local plugin 的 runtime 与治理边界是什么
- CLI / GUI / API 如何指向同一组治理语义
- web runtime manifest、同源资产路由、route host 的角色是什么
- server-side 与 web-side 分别接入了哪些能力

本文件不负责：

- 仓库命令矩阵：看 `../guides/COMMANDS.md`
- 操作步骤：看 `../guides/PLUGIN_OPERATIONS.md`
- 公开 API contract：看 `../specs/API.md`
- 整体系统分层：看 `../ARCH.md`

## 2. 核心范围

插件能力的核心范围是 **pack-local plugin**：

- discovery
- import confirmation
- capability grant
- explicit enable / disable
- activation session
- web runtime manifest
- 同源 web 资产暴露
- pack-local route host

`global` 不作为正式运行范围；它仅保留为领域模型预留位。

## 3. 治理记录与宿主

插件治理记录持久化在 **kernel-side Prisma**，而不是 pack runtime sqlite。

相关记录包括：

- `PluginArtifact`
- `PluginInstallation`
- `PluginActivationSession`
- `PluginEnableAcknowledgement`

这意味着插件治理被视为平台 / kernel 级能力，而不是 world-pack runtime 的内部宿主对象。

## 4. Discovery / Lifecycle / Governance

相关实现主要位于：

- `apps/server/src/plugins/discovery.ts`
- `apps/server/src/plugins/store.ts`
- `apps/server/src/plugins/service.ts`
- `apps/server/src/plugins/runtime.ts`

治理语义：

1. 插件先被发现（discovered）
2. 导入后进入 `pending_confirmation`
3. 先 confirm import，再 enable / disable
4. enable 可能要求 acknowledgement
5. installation state 与 activation session 共同提供治理证据

CLI 与 GUI 复用同一组治理语义：

- 先 confirm import
- confirm 时可提交全部或部分 `granted_capabilities`
- enable acknowledgement 消费服务端下发的 canonical warning text / hash

## 5. enable warning / acknowledgement

显式 enable 受以下约束控制：

- `plugins.enable_warning.enabled`
- `plugins.enable_warning.require_acknowledgement`
- `PLUGIN_ENABLE_WARNING_TEXT`

`/api/packs/:packId/plugins` 会返回 `enable_warning` runtime snapshot，包括：

- `enabled`
- `require_acknowledgement`
- `reminder_text`
- `reminder_text_hash`

设计意图：

- canonical warning 文本只由后端维护
- GUI / CLI 不复制另一份独立文案来源
- acknowledgement 提交时要与 canonical hash 保持一致

## 6. Web runtime

统一的 plugin runtime web surface：

- `GET /api/packs/:packId/plugins/runtime/web`
- `GET /api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`

约束：

- 目标 pack 必须已经加载到 runtime registry
- pack 解析通过统一 `PackRuntimeLookupPort` / `PackScopeResolver` 校验
- 所有已加载 pack 对等，无 active pack 限制

web runtime snapshot 由 `apps/server/src/app/services/plugin_runtime_web.ts` 负责提供。

其作用包括：

- 读取任意已加载 pack 下已启用插件的 web runtime manifest
- 将 manifest 中的 `entrypoints.web.dist` 收敛为 canonical 同源 asset route
- 为前端提供 browser-side dynamic import 所需的信息

每个 plugin item 典型会暴露：

- `web_bundle_url`
- `runtime_module`
- `contributions.panels`
- `contributions.routes`

## 7. 同源资产与 route host

插件 web 资产通过 `GET /api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*` 进行暴露，并校验：

- installation 必须 `enabled`
- scope / path 必须合法
- asset path 必须落在允许的 runtime root 内

浏览器侧通过动态 import 加载 `web_bundle_url`，并在 pack-local route host 下挂载路由贡献：

- `/packs/:packId/plugins/:pluginId/*`

所有 pack 的 web runtime URL 统一指向 `/api/packs/:packId/plugins/.../runtime/web/...`。

这使插件 web runtime 既能被浏览器加载，又能维持同源与路径边界控制。

## 8. Worker-only server runtime

Server-side plugins run only inside Node Worker threads. The host no longer imports plugin server entrypoints in the main thread and no longer accepts function-object registration for server routes.

Runtime flow:

1. `refreshPackPluginRuntime(context, packId)` resolves enabled installations and manifests.
2. `PluginWorkerManager.activateInstallation(...)` creates a `PluginWorkerClient` and sends an activation message to `worker_entry.js`.
3. The Worker imports the plugin entrypoint and exposes a restricted Host API 2.0.0 object.
4. The plugin registers handlers plus structured contribution descriptors.
5. The main thread validates returned descriptors against:
   - zod descriptor schemas
   - granted capabilities on the installation
   - manifest contribution declarations
6. The main thread converts descriptors into proxy objects and stores them in `pluginRuntimeRegistry`.

This blocks plugin crashes, synchronous infinite loops, `process.exit()`, CPU exhaustion, and host object leakage from directly taking down the main server process. Node Worker threads provide fault isolation, not a security sandbox; all plugin authority still comes from main-thread capability checks.

Primary implementation files:

- `apps/server/src/plugins/worker/PluginWorkerClient.ts`
- `apps/server/src/plugins/worker/PluginWorkerManager.ts`
- `apps/server/src/plugins/worker/worker_entry.ts`
- `apps/server/src/plugins/worker/worker_host_api.ts`
- `apps/server/src/plugins/worker/protocol.ts`
- `apps/server/src/plugins/worker/contribution_descriptors.ts`
- `apps/server/src/plugins/worker/contribution_proxy.ts`
- `apps/server/src/plugins/runtime.ts`
- `apps/server/src/app/routes/plugin_runtime_server.ts`

## 9. Server-side contribution proxies

Worker contributions are invoked through proxy objects in the main thread:

- context sources
- prompt workflow steps
- pack-local API routes
- step contributors
- rule contributors
- query contributors
- data cleaners
- slot condition evaluators
- slot content transformers
- perception resolvers

Each proxy serializes payloads over Worker IPC and validates Worker output with zod before returning to host subsystems.

`dataCleanerRegistry` tracks owner metadata for Worker-registered cleaners so per-installation cleanup can remove stale entries. Slot condition and slot content transformer registries are refreshed per pack during runtime replacement.

## 10. Server route host

Server-side plugin HTTP routes use one fixed host route:

```text
/api/packs/:packId/plugins/:pluginId/runtime/server/:installationId/routes/{*runtimePath}
```

The route host:

- looks up the runtime with `pluginRuntimeRegistry.getRuntime(packId, installationId)`
- verifies `plugin_id`
- verifies the runtime has a live Worker client
- matches method/path against `api_route` descriptors
- invokes the Worker via `WorkerPackRouteProxy`
- uses `plugins.isolation.route_timeout_ms`
- returns 404 for missing/disabled routes
- returns 504 for route invocation timeout

Plugins do not receive the Express app and cannot register arbitrary main-thread middleware.

## 11. Host API 2.0.0

Server plugins implement:

```ts
export function activate(host: ServerPluginHostApi): void | (() => void | Promise<void>) | {
  deactivate?: () => void | Promise<void>;
}
```

Available registration methods are descriptor-only:

| 方法 | 能力 key | 说明 |
|------|---------|------|
| `registerHandler` | n/a | Worker-local handler registration |
| `registerContextSource` | `server.context_source.register` | 注册上下文源 descriptor |
| `registerPromptWorkflowStep` | `server.prompt_workflow.register` | 注册提示词工作流步骤 descriptor |
| `registerPackRoute` | `server.api_route.register` | 注册 pack-local API route descriptor |
| `registerStepContributor` | `server.step_contributor.register` | 注册世界引擎 step contributor descriptor |
| `registerRuleContributor` | `server.rule_contributor.register` | 注册 rule contributor descriptor |
| `registerQueryContributor` | `server.query_contributor.register` | 注册 query contributor descriptor |
| `registerDataCleaner` | `server.data_cleaner.register` | 注册 data cleaner descriptor |
| `registerSlotConditionEvaluator` | `server.slot_condition.register` | 注册 slot condition descriptor |
| `registerSlotContentTransformer` | `server.slot_content_transform.register` | 注册 slot transform descriptor |
| `registerPerceptionResolver` | `server.perception_resolver.register` | 注册 perception resolver descriptor |
| `requestInference` | `server.inference.request` | 通过 host_call 请求 AI 推理 |

`PLUGIN_HOST_API_VERSION` 当前为 `2.0.0`。不兼容 host API version 会拒绝激活并写入 installation `last_error`。

## 12. Capability and manifest alignment

Main-thread checks are authoritative:

- descriptor registration checks installation `granted_capabilities`
- `requestInference` host call checks `server.inference.request`
- `queryWorldState` host call is scoped to the active pack id
- Worker-reported capabilities are not trusted

Activation fails if:

- Worker descriptor has no matching manifest contribution
- manifest contribution has no matching Worker descriptor
- descriptor requires an ungranted capability

Matching uses contribution type plus `invoke` handler name.

## 13. Worker isolation configuration

Runtime configuration:

```yaml
plugins:
  sandbox:
    capability_level: "pack_scoped" # readonly | pack_scoped
    max_manifest_size_bytes: 1048576
    max_manifest_depth: 20
    max_routes: 16
    max_context_sources: 32
  isolation:
    mode: "worker"
    activation_timeout_ms: 30000
    invocation_timeout_ms: 5000
    route_timeout_ms: 10000
    deactivate_timeout_ms: 5000
    max_consecutive_failures: 3
    resource_limits:
      max_old_generation_size_mb: 128
      max_young_generation_size_mb: 32
      stack_size_mb: 4
```

`plugins.isolation.mode` is always `worker`. There is no in-process fallback.

`plugins.sandbox.capability_level` no longer supports `full`; `createPluginContext()` never returns full `AppContext`, and `warn_on_full_access` has been removed.

## 14. Metrics

Prometheus metrics exposed through `/metrics` include:

- `yidhras_plugins_active`
- `yidhras_plugin_workers_active`
- `yidhras_plugin_worker_crashes_total`
- `yidhras_plugin_worker_invocation_duration_ms`
- `yidhras_plugin_worker_activation_duration_ms`

Worker metrics are recorded in:

- `apps/server/src/observability/metrics.ts`
- `apps/server/src/plugins/worker/PluginWorkerClient.ts`
- `apps/server/src/plugins/worker/PluginWorkerManager.ts`
- `apps/server/src/plugins/runtime.ts`

## 15. Boundaries and remaining work

Current boundaries:

- Node Worker thread isolation is fault isolation, not a complete security sandbox.
- Web runtime assets still rely on browser-side render boundaries.
- Test coverage for Worker protocol, proxy validation, timeout/crash isolation, and route host behavior is tracked in the Worker isolation test phase.

Related documentation:

- Operations: `../guides/PLUGIN_OPERATIONS.md`
- Commands: `../guides/COMMANDS.md`
- API contract: `../specs/API.md`
- Architecture: `../ARCH.md`
