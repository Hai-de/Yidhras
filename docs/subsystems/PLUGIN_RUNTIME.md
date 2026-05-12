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

plugin runtime web surface 分为两层：

### Stable active-pack surface

- `GET /api/packs/:packId/plugins/runtime/web`
- `GET /api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`

约束：

- 继续绑定 active pack
- 多包运行时不自动放宽 stable surface 的作用域
- stable surface 的 pack 解析继续受 active-pack guard 控制

### 附加包（experimental）surface

- `GET /api/experimental/runtime/packs/:packId/plugins/runtime/web`
- `GET /api/experimental/runtime/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`

约束：

- 目标 pack 必须已经加载到 runtime registry
- experimental surface 的 pack 解析通过统一 `PackRuntimeLookupPort` / `PackScopeResolver` 校验

web runtime snapshot 由 `apps/server/src/app/services/plugin_runtime_web.ts` 负责提供。

其作用包括：

- 读取 active pack 下已启用插件的 web runtime manifest
- 或在 experimental surface 下读取某个 loaded pack runtime 的已启用插件 manifest
- 将 manifest 中的 `entrypoints.web.dist` 收敛为 canonical 同源 asset route
- 为前端提供 browser-side dynamic import 所需的信息
- 并保持 stable / experimental route namespace 分层

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

在多包运行时下，需要特别区分：

- stable `web_bundle_url`
  - 指向 `/api/packs/:packId/plugins/.../runtime/web/...`
  - 仍只对应 active pack scope
- experimental `web_bundle_url`
  - 指向 `/api/experimental/runtime/packs/:packId/plugins/.../runtime/web/...`
  - 对应 experiment-loaded pack scope

这样做的目的，是避免：

- active-pack stable contract 被静默放宽
- pack A/B 的 web runtime URL 与 asset host 混用

这使插件 web runtime 既能被浏览器加载，又能维持同源与路径边界控制。

## 8. Server-side / Web-side 承接边界

### Server-side 接入的受控扩展点

- context source adapters
- prompt workflow step executors
- pack-local API routes

### Startup lifecycle 接入

- `createApp()` 阶段把 Express app 注入 `AppContext`
- `sim.init(selectedPack)` 后执行 `syncActivePackPluginRuntime(...)`
- registry refresh 与 pack-local route mounting 走统一同步入口
- route 挂载带去重，避免 enable / disable / startup 多次同步时重复注册

多包运行时补充：

- `refreshPackPluginRuntime(context, packId)`
- `syncExperimentalPackPluginRuntime(context, packId)`
- 按 pack-local scope 刷新 experiment-loaded pack 的 plugin runtime registry

### Host 边界约束

plugin runtime 由 **Node/TS host** 承接，而不是进入 Rust world engine：

- plugin host 不直接依赖 Rust / TS world engine internal object
- pack scope resolve 统一通过 `PackRuntimeLookupPort` / `PackScopeResolver`
- pack runtime web surface 与 projection scope 不再各自发明一套 lookup 逻辑
- 后续若引入 Rust world engine，plugin host 应通过 Host API / lookup port 与之交互
- 宿主读面是 `PackHostApi`
  - `getPackSummary(...)`
  - `getCurrentTick(...)`
  - `queryWorldState(...)`
- `PackHostApi` 是 **host-mediated read surface**，不是 sidecar transport 透出；其长期 owner 是 **TS host kernel**，不是 Rust sidecar
- `PackHostApi` 的角色是插件/工作流/路由的 **read plane contract**，而不是 world engine control plane 的缩写接口

这意味着：

- plugin host / workflow host / scheduler 不是 Rust 迁移目标
- 插件侧扩展点继续留在 Node/TS 宿主
- world engine 只替换 pack runtime / world rule execution 内核，而不吞掉 plugin host
- sidecar 具备 Host snapshot hydrate、Rust session/query 与 prepare/commit/abort 闭环，插件层仍只应读取 Host API，而不是依赖 sidecar 内部协议细节
- 插件与 workflow 不应直接持有 `WorldEnginePort`、`WorldEngineSidecarClient`、prepared token 或 raw JSON-RPC transport
- 若未来插件需要更多世界态读能力，应继续加在 Host API 上，而不是让插件直接越过宿主边界
- plugin extension model 视为 **TS-host-only by default**；是否建立 Rust-consumable contributor bridge 属于单独立项问题，而不是默认 roadmap
- 因此，`PackHostApi` 被视为插件系统长期依赖的 host contract 之一

### Web-side 已具备

- runtime manifest 读面
- 浏览器侧动态 bundle loader
- plugin runtime store load state
- panel render boundary
- pack-local route host
- `/plugins` 管理页面

### Plugin management GUI 已具备

- installation inventory
- capability grant 勾选式 confirm import
- enable acknowledgement checkbox 与 warning text 展示
- confirm / enable / disable 完整提交流程

## 9. Manifest 贡献声明

插件通过 `plugin.manifest.yaml` 声明其贡献类型。Server 端贡献字段均为结构化对象（非纯字符串列表），位于 `contributions.server` 下：

| 字段 | Schema | 说明 |
|------|--------|------|
| `context_sources` | `{ name, adapterType, priority, config }` | 上下文源声明 |
| `prompt_workflow_steps` | `{ name, stepKind, priority, config }` | 提示词管线步骤声明 |
| `api_routes` | `{ name, path, method, priority }` | HTTP 路由声明 |
| `step_contributors` | `{ name, priority, config }` | 世界引擎步骤贡献声明 |
| `rule_contributors` | `{ name, supportsRuleIds, priority, config }` | 规则贡献声明 |
| `query_contributors` | `{ name, supportsQueryNames, priority, config }` | 查询贡献声明 |
| `data_cleaners` | `{ name, trigger, priority, config }` | 数据清洗声明 |

Manifest 声明提供元数据（name、priority、config），`activate()` 通过 Host API 注册实际 executor。两者通过 `name` 字段关联。`kind` 字段已枚举化（`game_loop | context_provider | rule_engine | perception | ui_panel | tool_provider | other`），未知值直接拒绝加载。

Schema 定义位于 `packages/contracts/src/plugins.ts`。

## 10. 能力键注册表

所有插件能力键统一定义在 `apps/server/src/plugins/capability_keys.ts`：

```typescript
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
```

每个能力键有对应的最低 sandbox 级别要求（`CAPABILITY_KEY_MIN_LEVEL`），`hasCapability()` 同时检查 granted_capabilities 和 sandbox 级别。`readonly` 级别插件即使持有 `server.api_route.register` 键也无法注册路由。

## 11. Server Plugin Host API

插件通过 `activate(host: ServerPluginHostApi)` 入口点注册能力。可用的注册方法：

| 方法 | 能力 key | 说明 |
|------|---------|------|
| `registerContextSource` | `PLUGIN_CAPABILITY_KEY.CONTEXT_SOURCE_REGISTER` | 注册上下文源适配器 |
| `registerPromptWorkflowStep` | `PLUGIN_CAPABILITY_KEY.PROMPT_WORKFLOW_REGISTER` | 注册自定义管线步骤执行器 |
| `registerPackRoute` | `PLUGIN_CAPABILITY_KEY.API_ROUTE_REGISTER` | 注册 pack 级 Express 路由 |
| `registerStepContributor` | `PLUGIN_CAPABILITY_KEY.STEP_CONTRIBUTOR_REGISTER` | 注册世界引擎步骤贡献器 |
| `registerRuleContributor` | `PLUGIN_CAPABILITY_KEY.RULE_CONTRIBUTOR_REGISTER` | 注册世界引擎规则贡献器 |
| `registerQueryContributor` | `PLUGIN_CAPABILITY_KEY.QUERY_CONTRIBUTOR_REGISTER` | 注册世界引擎查询贡献器 |
| `registerDataCleaner` | `PLUGIN_CAPABILITY_KEY.DATA_CLEANER_REGISTER` | 注册数据清洗器（全局单例） |
| `registerSlotConditionEvaluator` | `PLUGIN_CAPABILITY_KEY.SLOT_CONDITION_REGISTER` | 注册插槽条件评估器（per-pack 注册） |
| `registerSlotContentTransformer` | `PLUGIN_CAPABILITY_KEY.SLOT_CONTENT_TRANSFORM_REGISTER` | 注册插槽内容变换器（per-pack 注册） |
| `registerPerceptionResolver` | `PLUGIN_CAPABILITY_KEY.PERCEPTION_RESOLVER_REGISTER` | 注册自定义感知解析器 |
| `requestInference` | `PLUGIN_CAPABILITY_KEY.INFERENCE_REQUEST` | 发起 AI 推理调用，走独立 AiTaskService 实例（独立熔断器），返回 `{ content, usage }` |

`registerSlotConditionEvaluator` 和 `registerSlotContentTransformer` 采用 per-pack 命名空间隔离：同 pack 内 key 冲突抛错，不同 pack 允许同名 key。内置评估器（keyword_match、logic_match、conversation_turn、context_length）以系统包插件形式提供，位于 `builtin/system_pack/plugins/slot-condition-builtin/`。

### 11.4 registerPerceptionResolver

注册自定义感知解析器，替换 sim loop step 6（感知管线）的默认 `spatial_proximity` 解析器。解析器接口：

```typescript
interface PerceptionResolver {
  resolve(
    event: ResolvePerceptionInput,
    observerEntityId: string,
    spatialRuntime: SpatialRuntime
  ): Promise<PerceptionResult>;
}
```

管线每 tick 查询 `pluginRuntimeRegistry.getPerceptionResolvers(packId)`，若存在已注册解析器则使用第一个，否则回退默认实现。适用于声学衰减传播、社交网络传播、光速延迟等非标准感知模型。

### 11.5 requestInference

发起 AI 推理调用。独立于 agent 推理管线：
- 使用独立的 `AiTaskService` 实例，拥有独立熔断器和 rate limiter
- 需要 capability `server.inference.request`
- 调用方通过 `AppInfrastructure.requestPluginInference` 注入执行器

```typescript
interface PluginInferenceRequest {
  purpose: string;        // 推理用途标识，用于 observability
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

interface PluginInferenceResult {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}
```

### 11.1 deactivate() 生命周期钩子

`activate()` 可返回清理函数或包含 `deactivate` 方法的对象：

```typescript
type PluginActivateResult = void | (() => void | Promise<void>) | {
  deactivate?: () => void | Promise<void>;
};
```

`clearRuntimes()` 在清空注册表前调用每个插件的 `deactivate()`，deactivate 失败不阻塞清空。这遵循 JS 生态惯例（React useEffect、Node.js server.close）。

### 11.2 超时保护

`activate()` 和 `requestInference()` 均受超时保护，防止插件阻塞宿主进程：

- `activate()` — 30s 超时
- `requestInference()` — 60s 超时

超时后抛出错误并写入 `PluginInstallation.last_error`，不阻塞 sim loop 或其他插件。

### 11.3 Host API 版本管理

`ServerPluginHostApi` 接口受版本号管理（`PLUGIN_HOST_API_VERSION = '1.0.0'`）。插件 manifest 通过 `compatibility.host_api` 声明所需版本。`refreshPackPluginRuntime` 在激活前检查兼容性：同大版本 + server >= required 视为兼容，不兼容则拒绝激活并写入 `last_error`。

规则：新增可选参数/方法 → minor bump（兼容）；修改或删除现有方法 → major bump（不兼容）。

---

## 12. 边界与限制

存在的边界：

- GUI 测试主要仍以 composable / unit 为主，页面级交互测试还可继续补强
- plugin runtime module contract 校验仍偏轻量
- 插件代码直接运行在 Node/TS 宿主进程，无进程级隔离；`PluginRenderBoundary.vue` 与 `activatePluginEntrypoint` 的 try/catch 提供错误边界，但无限循环/`process.exit()` 等进程级破坏无防护
- 超时保护：`activate()` 30s、`requestInference()` 60s（`runtime.ts` 中 `withTimeout`），超时中断并记录 `last_error`
- 资源限制运行时 enforce：
  - `maxManifestSizeBytes`（默认 1 MB）与 `maxManifestDepth`（默认 20）在 `discovery.ts` 的 `loadManifestFromCandidate` 中校验，超限抛 `ApiError` 并被收集到 `failures` 数组
  - `maxRoutes`（默认 16）与 `maxContextSources`（默认 32）在 `runtime.ts` 的 `createServerPluginHostApi` 中校验，超限 silent skip + warn
  - 各上限通过 `plugins.sandbox.*` 在运行时配置中可调
- CSP（Content Security Policy）配置：
  - Express 侧：`create_app.ts` 中 helmet CSP 指令包含 `script-src 'self' 'unsafe-inline'`、`connect-src 'self'`、`object-src 'none'` 等
  - Nuxt SPA 侧：`apps/web/plugins/csp.ts` 通过 `<meta http-equiv>` 注入辅助 CSP 层，`connect-src` 动态读取 `runtimeConfig.public.apiBase`
- 范围以 `pack_local` 为正式边界
- 多包运行时 plugin runtime 通过 operator API 访问
- 不会把 stable active-pack plugin runtime surface 直接升级为任意 loaded pack 可读
- server-side pack route registration 仍以保守兼容为主，而不是完整平台化插件容器

## 13. 相关文档

- 操作步骤：`../guides/PLUGIN_OPERATIONS.md`
- 命令入口：`../guides/COMMANDS.md`
- API 契约：`../API.md`
- 架构边界：`../ARCH.md`
