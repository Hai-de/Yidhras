# Shell / Pack Frontend 实施计划

> 基于: `.limcode/design/shell-pack-frontend-decomposition-design.md`
> 状态: Phase 1 完成, Phase 2 完成, Phase 3 待触发

---

## Phase 1 — Shell 骨架 + 客户端认证 + Default 路由迁移

目标：Shell 拥有 `/login`、`/packs`、`/packs/:packId/...` 路由结构，现有全部功能在新路径下正常工作。

### 1.1 客户端认证基础设施

- [x] 新建 `apps/web/pages/login.vue`
  - 表单：operator name + password（可选 pack_id，不填则不绑定）
  - 调用 `POST /api/auth/login`，获取 token
  - 成功后跳转 `/packs`
- [x] 新建 `apps/web/stores/auth.ts` — `useAuthStore`
  - `token: string | null`，持久化到 `localStorage`
  - `login(credentials)` / `logout()` / `isAuthenticated` getter
- [x] 修改 `apps/web/lib/http/client.ts`
  - 从 authStore 读取 token，注入 `Authorization: Bearer <token>` header
- [x] 新建 `apps/web/middleware/auth.ts` — Nuxt route middleware
  - 未认证时重定向到 `/login`
  - 应用到所有 `/packs` 开头的路由

### 1.2 Session-Pack 解绑

- [x] 修改 `apps/server/src/app/middleware/operator_auth.ts`
  - session 校验不再强制要求 `pack_id` 匹配当前路由的 pack
  - 或无 token 时仍 `next()`（保持当前匿名访问行为），有 token 时校验 operator 存在即可
- [x] `loginRequestSchema` 的 `pack_id` 保持可选，但不强制校验

### 1.3 Pack 列表 API

- [x] 新建 `apps/server/src/app/routes/packs.ts` — `GET /api/packs`
  - 合并三个数据源：文件系统枚举（`PackCatalogService.listAvailablePacks()`）、运行时状态（`MultiPackRuntimePort.listPacks()`）、包 metadata（`presentation` 字段含 icon/cover_image）
  - 返回 `{ packs: Array<{ id, name, version, status, presentation }> }`
- [x] 在 `apps/server/src/index.ts` 注册 `/api/packs` 路由
- [x] 新建 `apps/web/composables/api/usePackListApi.ts`
- [x] 新建 `apps/web/pages/packs.vue` — 包列表页
  - 展示已发现包的卡片列表（名称、图标、状态指示）
  - 每个卡片点击进入 `/packs/:packId`

### 1.4 路由迁移

将所有现有页面从 `/xxx` 迁移到 `/packs/:packId/xxx`：

- [x] `pages/overview.vue` → `pages/packs/[packId]/overview.vue`
- [x] `pages/scheduler.vue` → `pages/packs/[packId]/scheduler.vue`
- [x] `pages/social.vue` → `pages/packs/[packId]/social.vue`
- [x] `pages/workflow.vue` → `pages/packs/[packId]/workflow.vue`
- [x] `pages/timeline.vue` → `pages/packs/[packId]/timeline.vue`
- [x] `pages/graph.vue` → `pages/packs/[packId]/graph.vue`
- [x] `pages/plugins.vue` → `pages/packs/[packId]/plugins.vue`
- [x] `pages/agents.vue` / `pages/agents/[id].vue` → `pages/packs/[packId]/agents.vue` / `pages/packs/[packId]/agents/[id].vue`

### 1.5 包挂载点页面

- [x] 新建 `pages/packs/[packId].vue` — 包前端挂载入口
  - 读取 `route.params.packId`，获取 pack manifest
  - `frontend.type === "default"`（或缺失）→ 重定向到 `/packs/:packId/overview`
  - `frontend.type === "custom"` → Phase 2 实现
- [x] 新建 `pages/packs/[packId]/index.vue` — 同重定向逻辑

### 1.6 导航与 Shell 组件适配

- [x] 修改 `apps/web/features/shared/navigation.ts`
  - 所有路由路径从 `/overview` 等改为 `/packs/:packId/overview` 等
  - `useOperatorNavigation` 从当前路由参数读取 packId
- [x] 修改 `apps/web/features/shell/components/AppShell.vue`
  - `ActivityRail` 链接加 packId 前缀
  - `workspaceTitleMap` 键值不变，路径从 route 推断
- [x] 修改 `apps/web/features/shell/components/ActivityRail.vue`
  - 导航项 `to` 属性加 packId 前缀

### 1.7 API Composable packId 传递

- [x] 修改所有 API composable（`composables/api/use*.ts`）
  - 从 `useRuntimeStore().worldPack?.id` 改为 `useRoute().params.packId`
  - `buildUrl` 已有 `/:packId/api/...` 支持，无需改动
- [x] 修改 `apps/web/stores/runtime.ts`
  - `worldPack` ref 改为从路由参数 + pack 列表 API 获取，而非全局 status 轮询
  - 或拆分为 per-pack 的 runtime 数据获取

### 1.8 主题 Reset 机制

- [x] 修改 `apps/web/lib/theme/apply-css-vars.ts`
  - 新增 `resetToBaseline()` — `removeProperty` 所有 `--yd-*` 变量，恢复基线默认值
- [x] 修改 `apps/web/lib/theme/source.ts`
  - 新增 `clearRegisteredWorldPackThemeConfig(packId: string)` — 清理注册表中指定包条目
- [x] 修改 `apps/web/plugins/theme.ts`
  - 在路由变化（包切换）时调用：`resetToBaseline()` → `applyPackTheme(newPack)`

### 1.9 Schema 更新

- [x] 修改 `packages/contracts/src/world_pack.ts` 或对应的 metadata schema
  - 添加 `frontend` 字段及 Zod schema（`z.object({ type: z.enum(['default', 'custom']), entry: z.string().optional() })`）
  - `frontend` 缺失时默认 `{ type: 'default' }`
- [x] 新建 `packages/contracts/src/shell_context.ts` — `ShellContextSchema`（auth_token, pack_id, api_base_url）
- [x] 新建 `packages/contracts/src/pack_frontend_manifest.ts` — `PackFrontendManifest` 类型

### 1.10 验证

- [x] `pnpm lint && pnpm typecheck` 通过
- [x] `pnpm test` 通过（更新因路由变更失效的测试）
- [x] 手动验证：登录 → 包列表 → 进入 default 包 → 8 工作区正常渲染
- [x] 手动验证：主题在包切换时正确 reset

---

## Phase 2 — Custom 包前端支持

目标：`type: "custom"` 的世界包可加载独立前端应用。

### 2.1 Custom 挂载机制

- [x] 新建 `apps/web/features/shell/components/PackFrontendMount.vue`
  - 接收 `packId` prop
  - 读取 pack manifest 的 `frontend` 配置
  - `type === "custom"` 时，动态 `import(entry)` 获取 `mount`/`unmount` 函数
  - `onMounted`：调用 `mount(containerRef.value, shellContext)`
  - `onUnmounted`：调用 `unmount(app)`
  - 加载状态处理（loading/error 边界）
- [x] 修改 `pages/packs/[packId].vue`，对 custom 类型使用 `PackFrontendMount`

### 2.2 服务端静态资源路由

- [x] 新建 `apps/server/src/app/routes/pack_frontend_assets.ts`
  - `GET /api/packs/:packId/frontend/*` → 映射到 `data/world_packs/<packId>/frontend/dist/*`
  - MIME 类型正确设置（`application/javascript`、`text/css` 等）
  - 安全检查：路径不穿越 pack 目录
- [x] 在 `apps/server/src/index.ts` 注册路由

### 2.3 ShellContext 注入

- [x] 新建 `apps/web/composables/app/useShellContext.ts`
  - `default` 类型：通过 Vue `provide/inject` 获取
  - `custom` 类型：由 `PackFrontendMount` 在调用 `mount()` 时作为参数传递
- [x] Shell 在进入 `/packs/:packId` 时构建 `ShellContext`（从 authStore 读 token，从 route 读 packId，从 config 读 api_base_url）

### 2.4 ShellNavigation API

- [x] 新建 `apps/web/composables/app/useShellNavigation.ts`
  - `switchPack(packId)` — `router.push(`/packs/${packId}`)`
  - `goToPacks()` — `router.push('/packs')`
- [x] 通过 `provide('shellNavigation')` 暴露给 default 包前端
- [x] 通过 `ShellContext` 或独立参数暴露给 custom 包前端（`mount(target, context, navigation)`）

### 2.5 脚手架

- [x] 新建 `apps/server/src/cli/scaffold_pack_frontend.ts` 或扩展现有 scaffold 命令
  - 生成 `frontend/index.ts`（mount/unmount 样板）
  - 生成 `frontend/App.vue`（最小根组件）
  - 生成 `frontend/tsconfig.json`、`frontend/vite.config.ts`
- [x] 创建 minimal custom 包前端示例，验证全链路

### 2.6 验证

- [x] 创建测试用 custom 包前端（minimal Vue app + 路由）
- [x] 验证：进入 custom 包 → 前端加载 → 包内导航 → 切换到 default 包 → custom 前端正确卸载
- [x] 验证：主题在 custom 和 default 包间切换时正确 reset

---

## Phase 3 — 共享包提取（按需）

触发条件：至少两个 custom 包前端出现事实上的代码重复。

- [ ] 识别重复的 composable / 组件 / store / 类型
- [ ] 创建 `packages/web-kit/`，提取共享代码
- [ ] 更新已有 custom 包前端引用 `@yidhras/web-kit`

Phase 3 不做预先设计，具体内容在触发时确定。

---

## 文件变更清单

### Phase 1

| 文件 | 操作 |
|------|------|
| `apps/web/pages/login.vue` | 新建 |
| `apps/web/stores/auth.ts` | 新建 |
| `apps/web/middleware/auth.ts` | 新建 |
| `apps/web/pages/packs.vue` | 新建 |
| `apps/web/pages/packs/[packId].vue` | 新建 |
| `apps/web/pages/packs/[packId]/index.vue` | 新建 |
| `apps/web/pages/packs/[packId]/overview.vue` | 迁移自 `pages/overview.vue` |
| `apps/web/pages/packs/[packId]/scheduler.vue` | 迁移自 `pages/scheduler.vue` |
| `apps/web/pages/packs/[packId]/social.vue` | 迁移自 `pages/social.vue` |
| `apps/web/pages/packs/[packId]/workflow.vue` | 迁移自 `pages/workflow.vue` |
| `apps/web/pages/packs/[packId]/timeline.vue` | 迁移自 `pages/timeline.vue` |
| `apps/web/pages/packs/[packId]/graph.vue` | 迁移自 `pages/graph.vue` |
| `apps/web/pages/packs/[packId]/plugins.vue` | 迁移自 `pages/plugins.vue` |
| `apps/web/pages/packs/[packId]/agents.vue` | 迁移自 `pages/agents.vue` |
| `apps/web/pages/packs/[packId]/agents/[id].vue` | 迁移自 `pages/agents/[id].vue` |
| `apps/web/composables/api/usePackListApi.ts` | 新建 |
| `apps/server/src/app/routes/packs.ts` | 新建 |
| `packages/contracts/src/shell_context.ts` | 新建 |
| `packages/contracts/src/pack_frontend_manifest.ts` | 新建 |
| `apps/web/lib/http/client.ts` | 修改 — 注入 auth header |
| `apps/web/features/shared/navigation.ts` | 修改 — 路由路径加 packId 前缀 |
| `apps/web/features/shell/components/AppShell.vue` | 修改 — 适配新路由 |
| `apps/web/features/shell/components/ActivityRail.vue` | 修改 — 导航链接加 packId |
| `apps/web/composables/api/use*.ts` | 修改 — packId 从 route 读取 |
| `apps/web/stores/runtime.ts` | 修改 — worldPack 来源改为路由 |
| `apps/web/lib/theme/apply-css-vars.ts` | 修改 — 新增 resetToBaseline |
| `apps/web/lib/theme/source.ts` | 修改 — 新增 clearRegistered |
| `apps/web/plugins/theme.ts` | 修改 — 包切换时 reset+apply |
| `apps/server/src/app/middleware/operator_auth.ts` | 修改 — session 解绑 pack |
| `apps/server/src/index.ts` | 修改 — 注册 /api/packs 路由 |
| `packages/contracts/src/index.ts` | 修改 — 导出新 schema |
| `packages/contracts/src/world_pack.ts` | 修改 — metadata 加 frontend schema |

### Phase 2

| 文件 | 操作 |
|------|------|
| `apps/web/features/shell/components/PackFrontendMount.vue` | 新建 |
| `apps/web/composables/app/useShellContext.ts` | 新建 |
| `apps/web/composables/app/useShellNavigation.ts` | 新建 |
| `apps/server/src/app/routes/pack_frontend_assets.ts` | 新建 |
| `apps/server/src/cli/scaffold_pack_frontend.ts` | 新建 |
| `apps/web/pages/packs/[packId].vue` | 修改 — custom 类型挂载逻辑 |
| `apps/server/src/index.ts` | 修改 — 注册 assets 路由 |

---

## 风险与验证点

| 风险 | 验证时点 | 验证方式 |
|------|---------|---------|
| Nuxt 路由迁移后页面渲染正确 | Phase 1.4 完成后 | 手动遍历 8 工作区 |
| Auth guard 不影响匿名访问（当前行为） | Phase 1.1 完成后 | 无 token 时仍可访问 API |
| 主题在包切换时无残留 | Phase 1.8 完成后 | 切换两个不同 theme 的包，检查 CSS 变量 |
| API composable packId 传递正确 | Phase 1.7 完成后 | 各工作区数据正常加载 |
| Custom 前端 createApp 不与 Shell 冲突 | Phase 2.1 前 | PoC：独立 Vue app 挂载到 Nuxt 页面内的 DOM 容器 |
| Custom 前端静态资源路径安全 | Phase 2.2 完成后 | 测试路径穿越攻击 `../../../etc/passwd` |
