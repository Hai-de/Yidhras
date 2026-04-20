# Pack-local Plugin Runtime

本文档集中说明 pack-local plugin 的 runtime、治理语义与前后端承接边界。

## 1. 文档定位

本文件回答：

- pack-local plugin 的 runtime 与治理边界是什么
- CLI / GUI / API 如何指向同一组治理语义
- web runtime manifest、同源资产路由、route host 的角色是什么
- server-side 与 web-side 当前分别接入了哪些能力

本文件不负责：

- 仓库命令矩阵：看 `docs/guides/COMMANDS.md`
- 操作步骤：看 `docs/guides/PLUGIN_OPERATIONS.md`
- 公开 API contract：看 `docs/API.md`
- 整体系统分层：看 `docs/ARCH.md`

## 2. 核心范围

当前插件能力的核心范围，是 **pack-local plugin**：

- discovery
- import confirmation
- capability grant
- explicit enable / disable
- activation session
- web runtime manifest
- 同源 web 资产暴露
- pack-local route host

当前不把 `global` 作为正式运行范围；它仅保留为领域模型预留位。

## 3. 治理记录与宿主

插件治理记录持久化在 **kernel-side Prisma**，而不是 pack runtime sqlite。

当前相关记录包括：

- `PluginArtifact`
- `PluginInstallation`
- `PluginActivationSession`
- `PluginEnableAcknowledgement`

这意味着插件治理被视为平台 / kernel 级能力，而不是 world pack runtime 的内部宿主对象。

## 4. Discovery / Lifecycle / Governance

相关实现主要位于：

- `apps/server/src/plugins/discovery.ts`
- `apps/server/src/plugins/store.ts`
- `apps/server/src/plugins/service.ts`
- `apps/server/src/plugins/runtime.ts`

当前治理语义：

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

当前 `/api/packs/:packId/plugins` 会返回 `enable_warning` runtime snapshot，包括：

- `enabled`
- `require_acknowledgement`
- `reminder_text`
- `reminder_text_hash`

设计意图：

- canonical warning 文本只由后端维护
- GUI / CLI 不复制另一份独立文案来源
- acknowledgement 提交时要与当前 canonical hash 保持一致

## 6. Web runtime

当前 plugin runtime web surface 分为两层：

### Stable active-pack surface

- `GET /api/packs/:packId/plugins/runtime/web`
- `GET /api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`

约束：

- 继续绑定当前 active pack
- 不因 experimental multi-pack runtime 打开而自动放宽作用域
- stable surface 的 pack 解析继续受 active-pack guard 控制

### Experimental pack-local surface

- `GET /api/experimental/runtime/packs/:packId/plugins/runtime/web`
- `GET /api/experimental/runtime/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`

约束：

- 仅在 `features.experimental.multi_pack_runtime.enabled=true`
- 且 `features.experimental.multi_pack_runtime.operator_api_enabled=true` 时可用
- 目标 pack 必须已经进入 experimental runtime registry
- experimental surface 的 pack 解析通过统一 `PackRuntimeLookupPort` / `PackScopeResolver` 校验

当前 web runtime snapshot 由：

- `apps/server/src/app/services/plugin_runtime_web.ts`

负责提供。

其作用包括：

- 读取 active pack 下已启用插件的 web runtime manifest
- 或在 experimental surface 下读取某个 loaded pack runtime 的已启用插件 manifest
- 将 manifest 中的 `entrypoints.web.dist` 收敛为 canonical 同源 asset route
- 为前端提供 browser-side dynamic import 所需的信息
- 并保持 stable / experimental route namespace 分层

当前每个 plugin item 典型会暴露：

- `web_bundle_url`
- `runtime_module`
- `contributions.panels`
- `contributions.routes`

## 7. 同源资产与 route host

当前插件 web 资产通过：

- `GET /api/packs/:packId/plugins/:pluginId/runtime/web/:installationId/*`

进行暴露，并校验：

- installation 必须 `enabled`
- scope / path 必须合法
- asset path 必须落在允许的 runtime root 内

浏览器侧当前通过动态 import 加载 `web_bundle_url`，并在 pack-local route host 下挂载路由贡献：

- `/packs/:packId/plugins/:pluginId/*`

在 experimental multi-pack runtime 下，需要特别区分：

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

### Server-side 当前已接入的受控扩展点

- context source adapters
- prompt workflow step executors
- pack-local API routes

### Startup lifecycle 当前已接入

- `createApp()` 阶段把 Express app 注入 `AppContext`
- `sim.init(selectedPack)` 后执行 `syncActivePackPluginRuntime(...)`
- registry refresh 与 pack-local route mounting 走统一同步入口
- route 挂载带去重，避免 enable / disable / startup 多次同步时重复注册

当前 experimental multi-pack runtime 补充了：

- `refreshPackPluginRuntime(context, packId)`
- `syncExperimentalPackPluginRuntime(context, packId)`
- 按 pack-local scope 刷新 experiment-loaded pack 的 plugin runtime registry

### Host 边界当前约束

当前 plugin runtime 继续由 **Node/TS host** 承接，而不是进入 Rust world engine：

- plugin host 不直接依赖 Rust / TS world engine internal object
- pack scope resolve 统一通过 `PackRuntimeLookupPort` / `PackScopeResolver`
- pack runtime web surface 与 projection scope 不再各自发明一套 lookup 逻辑
- 后续若引入 Rust world engine，plugin host 应通过 Host API / lookup port 与之交互

这意味着：

- plugin host / workflow host / scheduler 不是第一阶段 Rust 迁移目标
- 插件侧扩展点继续留在 Node/TS 宿主
- world engine 只替换 pack runtime / world rule execution 内核，而不吞掉 plugin host

### Web-side 当前已具备

- runtime manifest 读面
- 浏览器侧动态 bundle loader
- plugin runtime store load state
- panel render boundary
- pack-local route host
- `/plugins` 管理页面

### Plugin management GUI 当前已具备

- installation inventory
- capability grant 勾选式 confirm import
- enable acknowledgement checkbox 与 warning text 展示
- confirm / enable / disable 完整提交流程

## 9. 当前边界与限制

当前仍存在的边界：

- GUI 测试主要仍以 composable / unit 为主，页面级交互测试还可继续补强
- plugin runtime module contract 校验仍偏轻量
- sandbox / isolation 能力仍不算强
- 当前范围仍以 `pack_local` 为正式边界
- experimental multi-pack plugin runtime 仍是 operator / test-only
- 当前不会把 stable active-pack plugin runtime surface 直接升级为任意 loaded pack 可读
- server-side pack route registration 仍以保守兼容为主，而不是完整平台化插件容器
- 更深的 multi-pack operator ergonomics 已记录在 `docs/ENHANCEMENTS.md`

## 10. 相关文档

- 操作步骤：`../guides/PLUGIN_OPERATIONS.md`
- 命令入口：`../guides/COMMANDS.md`
- API 契约：`../API.md`
- 架构边界：`../ARCH.md`
- 相关设计资产：`.limcode/design/pack-local-plugin-unified-management-design.md`
