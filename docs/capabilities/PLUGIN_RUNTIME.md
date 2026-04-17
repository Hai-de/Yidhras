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

当前 web runtime snapshot 由：

- `apps/server/src/app/services/plugin_runtime_web.ts`

负责提供。

其作用包括：

- 读取 active pack 下已启用插件的 web runtime manifest
- 将 manifest 中的 `entrypoints.web.dist` 收敛为 canonical 同源 asset route
- 为前端提供 browser-side dynamic import 所需的信息

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

## 10. 相关文档

- 操作步骤：`../guides/PLUGIN_OPERATIONS.md`
- 命令入口：`../guides/COMMANDS.md`
- API 契约：`../API.md`
- 架构边界：`../ARCH.md`
- 相关设计资产：`.limcode/design/pack-local-plugin-unified-management-design.md`
