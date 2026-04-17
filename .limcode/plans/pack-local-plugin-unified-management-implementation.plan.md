<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/pack-local-plugin-unified-management-design.md","contentHash":"sha256:f49681b306e1c1933e2e12f178e18a2970d93ebd0ef498cbdd0b17de9d4694e5"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 补齐插件配置与合同基线：扩展 runtime config/schema、定义 plugin manifest 与持久化模型、明确错误码与审计事件枚举。  `#plugin-phase-1`
- [x] 实现 kernel-side 插件管理主线：artifact / installation / activation / acknowledgement 的存储、服务与生命周期状态机。  `#plugin-phase-2`
- [x] 打通 pack-local 发现与导入确认：扫描 world pack plugins 目录、校验/编译工件、创建 pending_confirmation 安装项并支持升级重确认。  `#plugin-phase-3`
- [x] 实现启用/禁用流程与 trust lecture：覆盖 CLI / API / GUI 所需 acknowledgement 校验、默认提醒配置与审计记录。  `#plugin-phase-4`
- [x] 实现 server-side plugin host：受控注册 context/prompt/intent/projection/pack-local route 扩展点，并接入 active-pack 生命周期。  `#plugin-phase-5`
- [x] 实现 web UI plugin runtime：暴露已启用插件清单与 web contribution manifest，按 pack-local 命名空间动态加载 panel/route 并做错误隔离。  `#plugin-phase-6`
- [x] 补齐 operator/management 界面与只读合同：提供插件列表、详情、确认、启用、禁用、失败状态与 capability 风险展示。  `#plugin-phase-7`
- [x] 完成测试与文档同步：覆盖 unit/integration/web tests，并更新 ARCH/API/WORLD_PACK/progress。  `#plugin-phase-8`
<!-- LIMCODE_TODO_LIST_END -->

<!-- LIMCODE_SOURCE_DESIGN: .limcode/design/pack-local-plugin-unified-management-design.md -->

# Pack-Local 插件统一管理实施计划

## 设计来源

本计划以已确认设计文档为唯一设计输入：

- `.limcode/design/pack-local-plugin-unified-management-design.md`

实施时若发现需要偏离该设计，应先修订设计，再修订本计划，不直接在代码中隐式改义。

---

## 1. 背景

当前工程已经具备若干可复用基础：

- runtime config 已存在 `paths.plugins_dir`，可承载插件编译产物与缓存
- world pack 仍是声明式 contract，不能直接成为任意代码注入口
- server 侧已有 world pack loader / active-pack activation / app route 注册主链
- context provenance 已预留 `plugin` scope 与 `created_by='plugin'`
- web 侧已有 Nuxt CSR runtime、feature/page/store 结构，可作为插件动态装载宿主

本轮要做的不是把 world pack 本体变成可执行脚本，而是把既有“server-side registered extension”能力产品化为：

- **pack-local only** 的插件管理系统
- 允许 **TS/JS** server/web 双侧插件
- **导入需要确认**
- **每次显式启用都要提醒 trust lecture**（除非配置关闭）

---

## 2. 目标

将项目推进到以下可落地状态：

1. world pack 可携带 `plugins/` 目录，独立本地插件也可走同一导入流程
2. 插件统一进入 artifact / installation / activation / acknowledgement 管理模型
3. 当前只支持 `pack_local` 作用域，但内部模型保留未来 `global` 预留位
4. 插件导入必须人工确认，不能因为随 pack 分发就自动启用
5. CLI / GUI / API 的显式启用路径都执行 trust lecture / acknowledgement 校验
6. server-side 插件可通过受控 host API 注册 context/prompt/intent/projection/route 扩展点
7. web UI 插件可按 pack-local 命名空间动态加载面板与路由，不要求重新构建宿主 web
8. 全链路保留审计、故障状态与升级重确认机制

---

## 3. 非目标

本计划不包含：

- global 插件真实安装面
- 插件市场 / registry / 远程拉取信任链
- 强安全沙箱或 OS 级隔离保证
- 任意 DSL / VM
- 完整 npm 依赖求解与下载体系
- 子进程执行 / 原生模块 / 任意 DB 底层句柄开放

本轮优先建立“治理模型正确、运行边界清晰、UI/CLI/API 行为一致”的最小完整主线。

---

## 4. 当前代码锚点

### 4.1 服务端锚点

- `apps/server/src/config/runtime_config.ts`
- `apps/server/src/config/schema.ts`
- `apps/server/src/index.ts`
- `apps/server/src/app/create_app.ts`
- `apps/server/src/app/routes/*.ts`
- `apps/server/src/packs/manifest/loader.ts`
- `apps/server/src/app/services/operator_contracts.ts`
- `apps/server/src/context/types.ts`

### 4.2 前端锚点

- `apps/web/plugins/theme.ts`（宿主内部 plugin 示例，不等于可管理插件）
- `apps/web/pages/*`
- `apps/web/features/*`
- `apps/web/stores/runtime.ts`
- `apps/web/stores/shell.ts`
- `apps/web/stores/notifications.ts`

### 4.3 文档锚点

- `docs/ARCH.md`
- `docs/API.md`
- `docs/WORLD_PACK.md`
- `.limcode/design/pack-local-plugin-unified-management-design.md`

---

## 5. 实施分阶段

## Phase 1：配置、合同与持久化基线

### 目标

先把插件系统的“静态边界”补齐，避免后续实现依赖零散常量或临时 JSON 结构。

### 工作内容

1. 扩展 runtime config schema：
   - 增加 `plugins.enable_warning.enabled`
   - 增加 `plugins.enable_warning.require_acknowledgement`
   - 保持默认值与设计一致
2. 统一插件错误码 / 状态枚举 / 审计事件枚举
3. 定义 plugin manifest 解析合同：
   - `manifest_version`
   - `entrypoints.server/web`
   - `compatibility`
   - `requested_capabilities`
   - `contributions`
4. 定义 kernel-side 持久化模型：
   - `PluginArtifact`
   - `PluginInstallation`
   - `PluginActivationSession`
   - `PluginEnableAcknowledgement`
5. 若现有 Prisma 模型适配不足，补齐 schema 与 migration 规划

### 交付要求

- 配置、类型、持久化、错误码能形成稳定公共基线
- 所有后续服务层只依赖正式 schema / type，而不依赖未约束对象

---

## Phase 2：插件管理器主线服务

### 目标

建立 kernel-side Plugin Manager，承接生命周期状态机与核心编排。

### 工作内容

1. 新建插件管理服务层，负责：
   - artifact upsert
   - installation create/update
   - lifecycle transition 校验
   - compatibility 校验
   - checksum/version/entrypoint 变更检测
2. 实现状态机：
   - `pending_confirmation`
   - `confirmed_disabled`
   - `enabled`
   - `disabled`
   - `upgrade_pending_confirmation`
   - `error`
   - `archived`
3. 明确 discovered/imported/enabled 的区别
4. 增加审计写入入口，覆盖：
   - discovered
   - import_confirmed
   - enable_warning_presented
   - enable_acknowledged
   - enabled/disabled
   - activation_failed
   - upgrade_detected / reconfirmation_required

### 交付要求

- 生命周期转换集中在一个服务层完成
- 路由、CLI、UI 只调用服务，不直接修改插件状态

---

## Phase 3：pack-local 发现、导入与升级重确认

### 目标

打通从 world pack `plugins/` 目录发现工件，到形成待确认安装项的主链。

### 工作内容

1. 在 world pack 装载/扫描路径上增加 pack-local 插件发现逻辑：
   - 扫描 `<pack>/plugins/*/plugin.manifest.yaml`
   - 校验 pack compatibility / yidhras compatibility
2. 建立 artifact checksum 与 source metadata
3. 生成 canonical artifact 记录
4. 创建 `pending_confirmation` installation
5. 对于已有 installation 的工件变更：
   - 若 checksum/version/entrypoint 变化，置为 `upgrade_pending_confirmation`
   - 不静默沿用旧确认结果
6. 明确删除/失踪插件的归档策略

### 交付要求

- pack 携带插件不会自动启用
- 插件更新会触发重新确认，而不是悄悄复用旧信任

---

## Phase 4：编译、启用/禁用与 trust lecture

### 目标

把“显式启用”做成真正受治理的动作，而不是简单布尔开关。

### 工作内容

1. 设计 canonical 编译产物目录：
   - `data/plugins/compiled/<installation-id>/...`
   - `manifest.lock.json`
2. 实现优先使用 `dist/`，否则编译 `src/` 的流程
3. 显式 enable 前检查：
   - lifecycle_state 是否允许
   - compatibility 是否仍成立
   - required entrypoint 是否可用
   - acknowledgement 是否满足策略
4. 内置 canonical reminder text，并保证原文不被随意改写
5. CLI 方案：
   - 交互式显示 reminder 并要求确认
   - 非交互式未提供 acknowledgement 参数则报 `PLUGIN_ENABLE_ACK_REQUIRED`
6. API 方案：
   - enable body 显式携带 acknowledgement/token
7. GUI 方案：
   - 前端弹窗确认后调用 enable API
8. 普通重启恢复时不重复弹提醒；提醒仅绑定显式 enable

### 交付要求

- CLI / API / GUI 三个入口行为一致
- 默认启用提醒开启，只有配置显式关闭才能跳过

---

## Phase 5：Server runtime / host API / pack-local route

### 目标

让已启用插件能够以受控方式接入 server 运行时，而不是直接 patch 宿主。

### 工作内容

1. 定义 Server Plugin Host API：
   - `registerContextSource`
   - `registerPromptWorkflowStep`
   - `registerIntentGrounder`
   - `registerPackProjection`
   - `registerPackRoute`
   - 只读 runtime reader / 受控 kernel service accessor
2. 为每个注册动作做 capability gate
3. 接入 active pack 生命周期：
   - active pack 激活时加载对应 enabled pack-local plugins
   - 失活/切换时卸载或隔离注册结果
4. 规范 pack-local API route 命名空间：
   - `/api/packs/:packId/plugins/:pluginId/*`
5. 增加 failure policy：
   - 默认 `fail_open`
   - 可选 `block_pack_activation`
6. 把插件产出的 provenance 接到既有 `plugin` scope / `created_by='plugin'`

### 交付要求

- 插件能力通过 host API 注册，不暴露任意宿主 patch 面
- pack-local route 与当前 active-pack 语义保持一致

---

## Phase 6：Web runtime / manifest / 动态装载

### 目标

让 web UI 插件在不重建宿主 Nuxt 的情况下，以 pack-local 方式动态加载。

### 工作内容

1. 由 server 暴露当前 active pack 的已启用插件清单与 web contribution manifest
2. 提供同源静态资源访问路径，供浏览器加载插件 web bundle
3. 在 web 侧实现 plugin runtime registry：
   - 根据 active pack 获取插件 manifest
   - 按扩展点动态 import web bundle
4. 首期开放扩展点：
   - `operator.pack_overview`
   - `operator.entity_overview`
   - `operator.timeline`
   - pack-local route
   - pack-local action/menu item
5. Web route 命名空间：
   - `/packs/:packId/plugins/:pluginId/*`
6. 每个插件 UI contribution 使用独立 error boundary

### 交付要求

- active pack 不匹配时不渲染插件 UI
- 单个插件 web 崩溃不会拖垮整个 operator 壳层

---

## Phase 7：插件管理界面与 operator 合同

### 目标

提供最小可用的管理读面与操作界面，让“确认/启用/禁用/失败/风险”都可观察。

### 工作内容

1. 服务端增加插件管理 API：
   - list installations by pack
   - get installation detail
   - confirm import
   - enable / disable
   - list activation logs / audit summaries
2. 在 operator / web 壳层增加管理页面或面板：
   - 插件列表
   - 详情抽屉/面板
   - requested vs granted capability 展示
   - trust mode / source / checksum / version 展示
   - enable warning dialog
3. 与现有 runtime store / notifications / shell 结构对齐
4. 补齐 operator handoff contract，避免前后端隐式对齐

### 交付要求

- operator 能明确分辨：待确认、已确认禁用、已启用、失败、待重确认
- 风险与责任信息对部署者是显式可见的

---

## Phase 8：测试、文档与进度同步

### 目标

在实现完成后，把这套能力稳定地收口到测试和文档层，而不是只停留在代码里。

### 工作内容

1. Server unit tests：
   - manifest parse/validation
   - lifecycle transitions
   - enable acknowledgement gate
   - upgrade re-confirmation
   - capability gate
2. Server integration tests：
   - pack scan -> pending_confirmation
   - confirm -> enable -> activate server hook
   - enable API ack required
   - pack-local route exposure
3. Web unit/integration tests：
   - plugin manifest loading
   - warning dialog behavior
   - dynamic panel/route injection
   - error boundary isolation
4. 文档同步：
   - `docs/ARCH.md`
   - `docs/API.md`
   - `docs/WORLD_PACK.md`
   - `.limcode/progress.md`
5. 必要时补充示例 pack/plugin skeleton 说明

### 建议验证命令

- `pnpm --filter yidhras-server typecheck`
- `pnpm --filter yidhras-server test:unit`
- `pnpm --filter yidhras-server test:integration`
- `pnpm --filter web typecheck`
- `pnpm --filter web test:unit`

---

## 6. 关键设计决策在实现中的落点

### 6.1 导入与启用分离

必须确保：

- discover/import 只产生待确认项
- confirmation 不等于 enabled
- enabled 前仍需 acknowledgement

### 6.2 pack-local only 先行

虽然领域模型保留 `global` 预留位，但本轮：

- API 不开放 global 安装入口
- UI 不提供 global 作用域选择
- runtime 不实现 cross-pack 插件复用

### 6.3 trusted JS 的现实边界

本轮 capability 的定位是：

- host API gate
- operator 风险展示
- 审计与差异读面

而不是：

- 强隔离沙箱
- 对恶意代码的绝对防护保证

### 6.4 路由命名空间强约束

所有插件对外面必须 pack-local 化：

- server: `/api/packs/:packId/plugins/:pluginId/*`
- web: `/packs/:packId/plugins/:pluginId/*`

这能防止污染 canonical 全局表面。

---

## 7. 风险与控制

### 风险 1：一上来做成“大一统插件平台”

**控制：**

- 严格锁定 pack-local only
- 不把 registry/global/sandbox 一次性并入本轮

### 风险 2：trusted JS 被误解为安全执行沙箱

**控制：**

- 配置、UI、CLI、文档统一写明 trust mode = trusted
- trust lecture 成为显式 enable 流程的一部分

### 风险 3：server 与 web 插件实现出两套平行模型

**控制：**

- artifact / installation / activation / ack 统一在 kernel-side 管理
- server/web 只共享 entrypoint 与 contribution，不拆治理模型

### 风险 4：pack 更新后默默延续旧信任

**控制：**

- checksum/version/entrypoint 任一变化即触发 `upgrade_pending_confirmation`

### 风险 5：插件故障污染宿主主线

**控制：**

- server 默认 `fail_open`
- web 使用 error boundary
- activation diagnostics 与 audit 必须可见

---

## 8. 完成判定

满足以下条件视为本计划完成：

1. pack-local 插件能被扫描并以待确认状态导入
2. 导入确认、启用提醒、显式启用/禁用形成完整状态机
3. CLI / GUI / API 的 enable 行为都遵循同一 trust lecture 规则
4. server-side 插件能通过受控 host API 注册扩展点
5. web 插件能在 pack-local 命名空间动态加载 panel/route
6. 插件升级会触发重新确认
7. 审计面可看到关键生命周期事件
8. 测试与 ARCH/API/WORLD_PACK 文档完成同步

---

## 9. 推荐实施顺序

建议严格按以下顺序推进，避免返工：

1. 配置/合同/持久化
2. 插件管理器状态机
3. pack 扫描与导入确认
4. enable warning / acknowledgement
5. server host runtime
6. web runtime
7. management UI
8. tests + docs

这样可以确保每一层都建立在已稳定的下层合同上，而不是边做 runtime 边返修治理模型。
