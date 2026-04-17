<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/pack-local-plugin-unified-management-design.md","contentHash":"sha256:f49681b306e1c1933e2e12f178e18a2970d93ebd0ef498cbdd0b17de9d4694e5"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 定义 web 插件浏览器运行时合同与同源 bundle/asset 暴露路径，明确动态 import 与 pack-local route 装载边界。  `#plugin-hardening-phase-1`
- [x] 实现 web runtime 真正动态 import：加载已启用插件 web bundle、注册 panel/route contribution，并补充错误隔离与缓存/失效处理。  `#plugin-hardening-phase-2`
- [x] 补齐 server integration 与 e2e 覆盖，验证 discovery→confirm→enable→runtime refresh、web runtime manifest/bundle、pack-local 路由链路。  `#plugin-hardening-phase-3`
- [x] 执行 workspace 级 lint/import-sort 清理，收口 server/web 相关文件并确保 lint/typecheck/test 基线通过。  `#plugin-hardening-phase-4`
- [x] 更新 README/API/ARCH/WORLD_PACK/ENHANCEMENTS/progress，明确本轮完成项与继续延期的 CLI 增强项。  `#plugin-hardening-phase-5`
<!-- LIMCODE_TODO_LIST_END -->

<!-- LIMCODE_SOURCE_DESIGN: .limcode/design/pack-local-plugin-unified-management-design.md -->

# Pack-Local 插件运行时补完与质量收口计划

## 设计来源

本计划继续以已确认设计文档为唯一设计输入：

- `.limcode/design/pack-local-plugin-unified-management-design.md`

同时以既有实施计划作为已完成基线参考：

- `.limcode/plans/pack-local-plugin-unified-management-implementation.plan.md`

如需偏离已确认设计，应先修订设计，再修订本计划，不直接在实现中隐式改义。

---

## 1. 本轮目标

在既有 pack-local 插件统一治理模型已经落地的前提下，本轮只聚焦三类“收口型工作”：

1. **补完 web bundle 真正动态 import / 路由装载**
2. **补强 integration / e2e 覆盖**
3. **完成 lint import-sort 全量清理**

同时，用户已明确：

- 不把额外 CLI 增强继续塞进本轮实现范围
- 与 CLI 进一步增强相关的后续想法，转存到 `docs/ENHANCEMENTS.md`

因此本计划会把“web runtime 真动态化 + 测试补强 + lint 收口”视为当前唯一交付目标，其余增强一律延期记录。

---

## 2. 当前状态与主要缺口

基于现状分析，可确认以下事实：

### 2.1 Web runtime 仍是 read-model baseline，不是真动态执行

当前链路已有：

- server 端 `GET /api/packs/:packId/plugins/runtime/web`
- web 端 `usePluginRuntimeBootstrap.ts`
- runtime store `apps/web/stores/plugins.ts`
- 展示宿主 `PluginPanelHost.vue`

但当前行为本质上仍是：

- 拉取 runtime manifest snapshot
- 依据 contribution 只做列表/占位展示
- 输出 `web_bundle_url` 字符串
- **没有真正对浏览器 ESM bundle 执行动态 import**
- **没有真正把 pack-local web route 挂到运行时页面装载链路中**

### 2.2 Server 端 web bundle 仍缺 canonical 同源暴露与装载闭环

`apps/server/src/app/services/plugin_runtime_web.ts` 当前只是把 manifest 里的 `entrypoints.web.dist` 原样暴露为 `web_bundle_url`，这意味着仍缺：

- canonical web bundle URL 规范
- 同源静态资源暴露面
- 对 artifact/source path 与浏览器访问路径的安全映射
- route contribution 对应的 web runtime loader 约束

### 2.3 测试覆盖仍偏点状，未形成完整 runtime 闭环回归

当前已有：

- server unit：`plugin_service.spec.ts`
- web unit：`plugin.runtime.store.spec.ts`

但仍缺：

- server integration：discovery → confirm → enable → runtime refresh
- startup/active-pack 下 plugin route 生效链路
- web runtime bootstrap 到动态 bundle 装载链路
- plugin route page 装载/错误隔离行为
- e2e 级 HTTP/前后端闭环验证

### 2.4 lint/import-sort 需要做 workspace 级收口，而不是局部修补

此前已出现过 server 侧 `simple-import-sort/imports` 问题。本轮要把目标提升为：

- 不只修一个文件
- 而是以 workspace 级命令验证 server/web 相关改动面
- 确保 import-sort、unused import、相关 lint 规则整体通过

---

## 3. 本轮明确范围

## 3.1 In Scope

### A. Web plugin runtime 真动态化

- 设计并落地浏览器侧插件模块合同
- 对已启用插件的 web bundle 执行真正动态 import
- 将 panel contribution 从“只读展示”升级为“真实渲染”
- 实现 pack-local web route 装载页/装载器
- 加入错误隔离与加载失败可观测信息

### B. 测试补强

- server integration tests
- server e2e tests
- web unit/integration tests（至少覆盖动态 bundle 与 route host 主链）
- 若需要，补充测试 fixture / fake plugin bundle / isolated pack 测试资源

### C. lint/import-sort 收口

- server 侧相关文件
- web 侧相关文件
- 以命令验证为准，而非“肉眼觉得差不多”

### D. 文档与延期项整理

- 同步说明本轮真正完成了什么
- 将**不纳入本轮**的 CLI 增强条目写入 `docs/ENHANCEMENTS.md`

## 3.2 Out of Scope

以下内容本轮不做，只记录到 `docs/ENHANCEMENTS.md`：

1. 更进一步的 CLI 批量化/批处理增强
   - 例如 `enable/disable --all`、更复杂批量筛选、更多治理批处理动作
2. 更进一步的 CLI 深化诊断族扩展
   - 例如 `why-not-confirm`、`why-not-disable`、更大范围的 explain 系列命令

这两类能力不阻塞当前“web runtime 真动态化 + 测试 + lint”收口，应明确延期而不是继续扩散范围。

---

## 4. 实施锚点

### 4.1 Web 侧锚点

- `apps/web/composables/app/usePluginRuntimeBootstrap.ts`
- `apps/web/stores/plugins.ts`
- `apps/web/features/plugins/components/PluginPanelHost.vue`
- `apps/web/composables/api/usePluginApi.ts`
- `apps/web/app.vue`
- `apps/web/pages/overview.vue`
- `apps/web/pages/agents/[id].vue`
- `apps/web/pages/timeline.vue`

可能新增：

- `apps/web/features/plugins/runtime/*`
- `apps/web/features/plugins/components/*` 动态 host / error boundary
- `apps/web/pages/packs/[packId]/plugins/[pluginId]/[[...path]].vue` 或等价 route host

### 4.2 Server 侧锚点

- `apps/server/src/app/services/plugin_runtime_web.ts`
- `apps/server/src/app/routes/plugin_runtime_web.ts`
- `apps/server/src/app/create_app.ts`
- `apps/server/src/index.ts`
- `apps/server/src/plugins/runtime.ts`
- `apps/server/src/plugins/discovery.ts`

可能新增：

- plugin web asset route / static serving helper
- runtime refresh 与 asset URL 解析辅助模块

### 4.3 测试锚点

- `apps/server/tests/integration/**`
- `apps/server/tests/e2e/**`
- `apps/server/tests/helpers/**`
- `apps/web/tests/unit/**`

### 4.4 文档锚点

- `README.md`
- `docs/API.md`
- `docs/ARCH.md`
- `docs/WORLD_PACK.md`
- `docs/ENHANCEMENTS.md`
- `.limcode/progress.md`

---

## 5. 分阶段实施

## Phase 1：定义 web 动态运行时合同与同源 bundle 暴露面

### 目标

把当前“只暴露 `web_bundle_url` 字符串”的读模型，升级为可以被浏览器真正消费的稳定合同。

### 工作内容

1. 明确 plugin web module contract：
   - bundle 导出约定
   - panel contribution 装载入口
   - route contribution 装载入口
   - 出错时的 fallback shape
2. 设计 server 端 canonical web bundle URL：
   - 不直接裸透传源 manifest 中的 `dist` 字段
   - 必须转成宿主可控的同源访问路径
3. 定义 asset exposure 规则：
   - pack-local only
   - 仅允许访问已启用 installation 的 web entrypoint / 关联静态资源
   - URL 必须带上 pack/plugin/installation 约束信息
4. 设计前端 runtime registry：
   - 按 `installation_id` / `plugin_id` 缓存加载结果
   - 处理重复加载、pack 切换、失效刷新
5. 保持 active-pack 约束：
   - pack 不匹配时不装载 UI

### 交付要求

- web bundle 可以通过宿主受控 URL 被浏览器安全地动态 import
- panel/route 的运行时合同明确，不靠隐式猜测

---

## Phase 2：实现 panel 与 pack-local route 的真正动态装载

### 目标

把现有 `PluginPanelHost.vue` 从“列出 manifest 信息”升级为“真实渲染插件 UI”，并新增 route host。

### 工作内容

1. 实现动态 panel host：
   - bootstrap 获取 runtime snapshot 后
   - 对启用插件的 web bundle 动态 import
   - 从 bundle 提取面板注册项
   - 按 target 真实渲染对应插件组件
2. 为每个插件 panel 增加错误隔离：
   - 单插件加载失败不拖垮宿主页面
   - 错误信息保留到 store / diagnostics
3. 实现 pack-local route host：
   - 新增 canonical route page
   - 依据 `/packs/:packId/plugins/:pluginId/*` 匹配 runtime snapshot
   - 动态 import 对应 bundle 并渲染 route component
4. 处理路由边界：
   - packId/pluginId 不匹配
   - bundle 缺失
   - route contribution 未声明
   - route component 加载失败
5. 处理运行时状态：
   - loading
   - loaded
   - failed
   - stale/refreshing

### 交付要求

- panel contribution 变成真实组件渲染
- pack-local route 可以真实进入插件页面
- 错误隔离与空态表现清晰

---

## Phase 3：补齐 integration / e2e / web runtime 回归测试

### 目标

让当前 pack-local 插件主链具备足够回归保护，尤其覆盖 web runtime 真动态化之后的新风险面。

### 工作内容

1. Server integration tests：
   - pack scan → pending_confirmation
   - confirm → enable → runtime refresh
   - 启用后 web runtime snapshot 返回 canonical bundle URL
   - pack-local route / runtime refresh 在 active-pack 下可用
2. Server e2e tests：
   - 启动服务后获取 plugin runtime web snapshot
   - 访问 plugin web asset 路由
   - 验证错误路径/未启用路径/pack 不匹配路径
3. Web unit/integration tests：
   - runtime store 记录 bundle load state
   - panel host 动态 import 成功/失败路径
   - route host 动态装载
   - error boundary/fallback UI
4. 必要时增加测试资源：
   - fake plugin bundle
   - fake runtime manifest snapshot
   - isolated pack fixture
5. 以测试层确认真实行为，而不是只看手工联调

### 交付要求

- 关键运行时路径都有自动化回归
- web 动态装载不是“只能手点验证”的黑箱

---

## Phase 4：workspace 级 lint/import-sort 收口

### 目标

把本轮涉及的 server/web 改动面全部收口到可持续维护状态。

### 工作内容

1. 运行并修复：
   - `pnpm --filter yidhras-server lint`
   - `pnpm --filter web lint`
   - 如有必要，执行 workspace 级 lint
2. 重点清理：
   - `simple-import-sort/imports`
   - unused imports
   - 新增 runtime/test helper 带来的风格偏差
3. 保证修复是结构性整理，不引入逻辑改动
4. 对新增测试文件与动态 loader 文件同样执行 lint 收口

### 交付要求

- import-sort 不是局部通过，而是本轮改动面全通过
- 不把 lint debt 留给下一轮再清

---

## Phase 5：文档与 ENHANCEMENTS 延期整理

### 目标

把本轮完成内容和延期内容边界写清楚，避免后续继续混淆范围。

### 工作内容

1. 更新 `README.md`：
   - plugin runtime 使用方式
   - 测试/验证命令
2. 更新 `docs/API.md`：
   - 若新增 plugin web asset route，需要补 API 说明
3. 更新 `docs/ARCH.md`：
   - 说明 web runtime 动态 import 与 route host 架构
4. 更新 `docs/WORLD_PACK.md`：
   - 说明 plugin web bundle / route 的期望布局与运行约束
5. 更新 `docs/ENHANCEMENTS.md`：
   - 追加并延期记录“CLI 批量化增强”
   - 追加并延期记录“CLI 更深 explain/diagnostics 家族增强”
6. 同步 `.limcode/progress.md` 与相关计划状态

### 交付要求

- 当前做什么、不做什么，文档边界清楚
- 用户点名延期的两类 CLI 增强被正式收纳到 backlog

---

## 6. 关键实施决策

### 6.1 不再把 `web_bundle_url` 当作“仅供展示的 manifest 字段”

本轮之后它应成为：

- 浏览器可消费
- 宿主可控
- 具备 pack-local 作用域约束
- 可被测试验证

的正式运行时入口。

### 6.2 Route host 必须遵守 pack-local 命名空间

web route 仍必须收敛在：

- `/packs/:packId/plugins/:pluginId/*`

不开放全局页面污染面。

### 6.3 测试要覆盖动态 import 失败场景

不能只测 happy path，还要覆盖：

- bundle 缺失
- export 不符合合同
- route 不存在
- panel target 不匹配
- pack 已切换 / snapshot 失效

### 6.4 延期项必须显式写进 ENHANCEMENTS

本轮不继续展开的 CLI 增强，不能只靠对话记忆，必须收口到：

- `docs/ENHANCEMENTS.md`

---

## 7. 风险与控制

### 风险 1：前端动态 import 污染宿主运行时

**控制：**

- 仅允许从 canonical runtime snapshot 给出的同源 URL 动态加载
- 每个插件独立错误隔离
- 明确 bundle contract，禁止模糊导出

### 风险 2：route host 做成“伪动态”，仍然只是展示层

**控制：**

- 将“真实渲染 route component”列为明确验收项
- 用 web 测试与 e2e 证明不是占位页

### 风险 3：测试补强过程中暴露现有 runtime 生命周期问题

**控制：**

- 允许测试驱动发现现有启动/refresh 缺口
- 如发现阻塞缺陷，应在本计划范围内修正，而不是绕过测试

### 风险 4：lint 清理扩大改动面

**控制：**

- 优先按 import-sort / unused import 做最小语义清理
- 以验证命令为准，避免顺手大改 unrelated 代码

---

## 8. 验收标准

完成以下条件，视为本计划完成：

1. plugin web bundle 能通过宿主提供的 canonical URL 被浏览器动态 import
2. `PluginPanelHost` 能真实渲染插件导出的 panel component，而非仅显示 manifest 信息
3. `/packs/:packId/plugins/:pluginId/*` pack-local route 能真实加载对应插件 route component
4. panel/route 的错误隔离与失败 fallback 可见
5. integration / e2e / web runtime 测试覆盖到关键主链与关键失败路径
6. server/web 相关 lint 与 import-sort 收口完成
7. `docs/ENHANCEMENTS.md` 已记录本轮延期的两类 CLI 增强项
8. 相关文档、计划与进度状态完成同步

---

## 9. 建议验证命令

### Server

- `pnpm --filter yidhras-server typecheck`
- `pnpm --filter yidhras-server lint`
- `pnpm --filter yidhras-server test:integration`
- `pnpm --filter yidhras-server test:e2e`

### Web

- `pnpm --filter web typecheck`
- `pnpm --filter web lint`
- `pnpm --filter web test:unit`

### 定向验证

- plugin runtime web snapshot 相关测试
- plugin dynamic panel host 相关测试
- plugin route host 相关测试
- plugin web asset / canonical bundle URL 相关 e2e

---

## 10. 推荐实施顺序

建议按以下顺序推进：

1. 先定 canonical web bundle/route runtime contract
2. 再做 panel 与 route 的真实动态装载
3. 然后补 integration/e2e/web tests
4. 最后做 lint 全量清理与文档/ENHANCEMENTS 收口

原因是：

- 若先写测试而合同未定，容易反复返修
- 若先做 lint 再做 runtime，大概率还要二次整理
- 应先稳定运行时合同，再做质量收口
