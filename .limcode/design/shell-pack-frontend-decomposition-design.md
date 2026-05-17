# Shell / Pack Frontend 分层设计

> 触发: 前端交互在不同世界包视角中找不到合适的通用共识，需要让世界包全自定义前端内容
> 关联: `docs/ARCH.md` · `docs/specs/WORLD_PACK.md` · `apps/web/` · `apps/web/features/plugins/`
> 前置: 多包对等重构（per-pack `PackRuntimePort` + `MultiPackLoopHost`）已完成

## 1. 问题陈述

当前 `apps/web` 是一个固定 8 工作区的单一前端。`ActivityRail`、`AppShell`、`resolveWorkspaceIdFromPath`、`useOperatorNavigation` 全部硬编码了导航结构和工作区组合。所有世界包共享相同的页面和交互模式。

不同世界包的交互需求差异是应用级的：政治模拟可能需要权力拓扑全屏视图，空间推理可能需要地图 + 终端界面，叙事模拟可能需要角色焦点 + 关系图谱。Plugin 的 `panels/routes` 机制只能在预定义 slot 中注入组件，无法改变导航结构、页面布局或整体交互模型。

## 2. 设计目标

1. **Shell 只做入口** — 认证、世界包管理（列表/加载/卸载）、包前端挂载
2. **Pack 全自定义前端** — 世界包自行决定前端技术栈、页面结构、导航、交互
3. **Default 保底** — 当前通用前端作为 `default` 类型，不写前端的包零成本使用
4. **不做中间地带** — 不提供 YAML 配置式 UI 组装。要么用 default，要么写完整前端

## 3. 架构总览

```
┌──────────────────────────────────────────────────┐
│  Shell (apps/web)                                │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ /login   │  │ /packs   │  │ /packs/:packId │  │
│  │ 认证     │  │ 包管理   │  │ 包前端挂载点   │  │
│  └──────────┘  └──────────┘  └───────────────┘  │
│                                    │             │
│                          ┌─────────┴─────────┐   │
│                          │ type: "default"    │   │
│                          │ → 内建页面渲染     │   │
│                          │ type: "custom"     │   │
│                          │ → createApp 挂载   │   │
│                          └───────────────────┘   │
└──────────────────────────────────────────────────┘
```

- **`default`**：当前 `apps/web` 的现有页面（overview/social/timeline/graph/plugins/agents 等），作为 Shell 内的 Nuxt pages 运行。包零配置即获得完整界面。
- **`custom`**：包目录下的 `frontend/` 提供独立前端应用，Shell 通过 `createApp` 将其挂载到 `/packs/:packId` 的 DOM 容器中。

## 4. Shell

**职责：**
- 认证：`/login` 页面，token 管理，注入 API 请求
- 包管理：`/packs` 列出可用包，加载/卸载，状态显示
- 包前端挂载：`/packs/:packId` 根据 `frontend.type` 选择挂载策略
- 全局通知通道（toast/notification bridge）

**不再包含：**
- 固定工作区导航
- 包特定页面组件
- 包特定业务逻辑

**Shell 路由：**

| 路径 | 内容 |
|------|------|
| `/login` | 认证页 |
| `/packs` | 包列表、加载/卸载 |
| `/packs/:packId` | 包前端挂载点 |
| `/packs/:packId/[...sub]` | 包前端内部路由（custom 类型） |

## 5. Pack Frontend Manifest

在 `pack.yaml` 的 `metadata` 下新增 `frontend` 字段：

```yaml
metadata:
  id: "snowbound_mansion"
  name: "Snowbound Mansion"
  version: "1.0.0"
  frontend:
    type: "default"   # "default" | "custom"
```

### 5.1 `type: "default"`

使用 Shell 内建的前端页面。包无需任何额外配置。当前所有已有包自动属于此类型（`frontend` 字段缺失时默认为 `default`）。

### 5.2 `type: "custom"`

```yaml
frontend:
  type: "custom"
  entry: "frontend/index.ts"    # 包目录内的入口文件
```

自定义前端是完全独立的 Vue 应用，Shell 通过 `createApp` 将其挂载到 DOM 容器。包前端自行管理路由、状态、布局。

入口文件导出的合约：

```typescript
// frontend/index.ts
import { createApp, type App } from 'vue'
import type { ShellContext } from '@yidhras/contracts'

export function mount(target: HTMLElement, context: ShellContext): App {
  const app = createApp(RootComponent)
  // ... setup router, pinia, etc.
  app.provide('shellContext', context)
  app.mount(target)
  return app
}

export function unmount(app: App): void {
  app.unmount()
}
```

包作者可选择任何前端框架，只要构建产物是 ESM 模块并导出 `mount`/`unmount` 函数。Vue 是推荐选项（可复用 `@yidhras/contracts` 类型），但不是强制。

## 6. Default Pack Frontend

即当前 `apps/web` 的现有 pages + features，保留在 `apps/web/pages/` 中。不做提取、不做独立构建、不做 `@yidhras/web-kit` 包。

当 `frontend.type` 为 `default` 时，Shell 直接渲染 Nuxt 页面路由。行为与当前完全一致——只是路由前缀从 `/overview` 等变为 `/packs/:packId/overview`。

后续如果多个 custom 包前端出现事实上的代码重复，再按实际需求提取共享包。不在第一个 custom 前端出现前做预先抽象。

## 7. ShellContext 协议

Shell 与包前端之间的最小接口合约：

```typescript
// packages/contracts/src/shell_context.ts

export const ShellContextSchema = z.object({
  auth_token: z.string(),
  pack_id: z.string(),
  api_base_url: z.string()
})

export type ShellContext = z.infer<typeof ShellContextSchema>
```

- `default` 类型：Shell 通过 `provide('shellContext', context)` 注入，composable 通过 `inject` 获取
- `custom` 类型：Shell 调用 `mount(target, context)` 时作为参数传入

`shell_capabilities`、`plugin_runtime`、`theme_baseline` 等字段在出现具体需求时再加。不在需求出现前设计字段。

## 8. Plugin 与 Pack Frontend 的关系

Plugin 和 Pack Frontend 是两级不同的扩展：

| | Plugin | Pack Frontend |
|------|--------|---------------|
| 量级 | 组件级（panels/routes slot 注入） | 应用级（整页替换） |
| 加载合约 | `PluginWebManifestSnapshot` | `mount(target, context)` |
| 渲染方式 | `<component :is="render" />` | `createApp` 挂载到 DOM |
| 服务端贡献 | step_contributor / context_source / api_route | 无 |

- Plugin 的服务端贡献不受包前端类型影响，始终在宿主进程中运行
- `default` 包前端保留 `PluginPanelHost` 机制
- `custom` 包前端自行决定是否使用 Plugin 的 web 贡献，以及如何渲染

两者在服务端 asset serving 层面可复用同一静态文件路由。

## 9. Auth 与会话

**当前状态：** 前端无客户端认证基础设施（无登录页、无 token 管理、HTTP client 不注入 auth header）。服务端 `operatorAuthMiddleware` 允许匿名访问。

**方案：**

1. Shell 新增 `/login` 页面，调用 `POST /api/auth/login`，获取 token
2. Token 存入 `localStorage`，HTTP client 注入 `Authorization: Bearer <token>` header
3. Session 不绑定 pack。operator 登录后可访问所有已加载的包
4. 服务端：`loginRequestSchema` 的 `pack_id` 改为可选且不强制校验，或新增不绑定 pack 的 session 类型
5. `ShellContext.auth_token` 由 Shell 注入，包前端不感知 token 存储细节

不做 per-pack 认证、不做 switch-pack endpoint、不做 token 刷新（token 过期后重新登录）。后续按需增强。

## 10. 导航协调

| 导航类型 | Shell | Pack Frontend |
|---------|-------|---------------|
| `/login` | 认证 | — |
| `/packs` | 包列表/管理 | — |
| `/packs/:packId/**` | — | 包内全部路由 |
| 跨包切换 | 提供 `switchPack(packId)` | 调用 Shell API |
| 返回包列表 | 提供 `goToPacks()` | 调用 Shell API |

Shell 通过 `provide('shellNavigation')` 向包前端暴露：

```typescript
interface ShellNavigation {
  switchPack(packId: string): Promise<void>
  goToPacks(): Promise<void>
}
```

## 11. 主题

包切换时的主题处理：

1. Shell 维护 `--yd-*` CSS 变量基线值
2. 包 manifest 的 `metadata.presentation.theme` 覆盖基线值
3. 切换包时：`resetToBaseline()` → 移除所有 `--yd-*` 变量 → `applyPackTheme(newPack)`
4. 清理旧包的 `WORLD_PACK_THEME_REGISTRY` 注册

需要新增两个导出：
- `resetToBaseline()` — `removeProperty` 所有 `--yd-*` 变量，恢复基线
- `clearRegisteredWorldPackThemeConfig(packId)` — 清理注册表中的旧包条目

`custom` 类型包前端可以完全自定义 CSS，不受 `--yd-*` 变量体系约束。

## 12. 构建与加载

### Default 类型

无需独立构建。Shell 内 Nuxt pages 直接渲染。

### Custom 类型

```
包目录/
  pack.yaml           # frontend: { type: "custom", entry: "frontend/index.ts" }
  frontend/
    index.ts          # 导出 mount(target, context)
    App.vue           # 根组件
    ...
```

- 包作者在本地构建：`pnpm build` → 产出 `frontend/dist/` 下的 ESM bundle
- 构建产物随包分发
- 服务器通过静态路由 serving 包目录下的 `frontend/dist/`：
  `/api/packs/:packId/frontend/*` → `data/world_packs/<pack>/frontend/dist/*`
- Shell 通过动态 `import()` 加载入口模块，调用 `mount(target, context)`

开发模式下，Shell 可直接引用源码（Vite dev server 处理编译），避免构建步骤。具体通过 `pack.yaml` 的 `frontend.dev_entry` 或环境变量切换。

### Shell 挂载流程

```
PackFrontendMount.vue
  1. 读取 route.params.packId
  2. 获取 pack manifest（API 或 store）
  3. 如果 frontend.type === "default" → <NuxtPage /> 渲染内建页面
  4. 如果 frontend.type === "custom":
     a. 动态 import(pack.frontend.entry)
     b. 获取 mount/unmount 函数
     c. onMounted: mount(containerRef.value, shellContext)
     d. onUnmounted: unmount(app)
```

## 13. 实施阶段

### Phase 1 — Shell 骨架 + 客户端认证

1. 新增 `/login` 页面，HTTP client 注入 auth header
2. Token 存储（localStorage），服务端 session 不绑定 pack
3. 新增 `/packs` 页面（包列表 API：`GET /api/packs`）
4. `/packs/:packId` 挂载点 — 当前只处理 `default` 类型
5. 现有页面路由从 `/overview` 等迁移到 `/packs/:packId/overview`
6. 主题 reset 能力（`resetToBaseline` + `clearRegisteredWorldPackThemeConfig`）
7. API composable 改为从路由参数获取 packId（`useRoute().params.packId`）
8. `metadataSchema` 添加 `frontend` 字段

交付标准：现有全部功能在 `/packs/:packId/...` 路径下正常工作。

### Phase 2 — Custom 包前端支持

1. `PackFrontendMount` 实现 custom 类型挂载逻辑
2. 服务端包前端静态资源路由（`/api/packs/:packId/frontend/*`）
3. `PackFrontendManifest` 合约定义（`contracts` 包）
4. ShellContext 注入机制
5. ShellNavigation API（`switchPack` / `goToPacks`）
6. 创建一个 minimal custom 包前端验证全链路

### Phase 3 — 提取共享包（按需）

当至少两个 custom 包前端出现事实上的代码重复时，提取 `@yidhras/web-kit`。在此之前不做。

## 14. 风险

| 风险 | 缓解 |
|------|------|
| Nuxt 4 内 `createApp` 挂载独立 Vue app | Phase 2 前 PoC 验证 Pinia/Router 实例隔离 |
| Custom 包前端构建门槛 | 提供脚手架工具（`pnpm scaffold:pack-frontend`）和 minimal 示例 |
| CSS 污染（custom 前端全局样式影响 Shell） | 约定 custom 前端使用 scoped CSS 或 CSS Modules |
| 包前端依赖版本与 Shell 冲突 | 包前端自打包依赖，不与 Shell 共享 node_modules |

## 15. 开放问题

### O1: Pack 列表 API

`GET /api/packs` — 需合并文件系统枚举、运行时状态、包 metadata（含 `presentation` 字段）。现有端点不可直接复用（`/api/health` 只返回文件夹名，`PackCatalogService` 只返回 ID 列表）。

### O2: Custom 前端构建管线

包作者本地构建产物随包分发（简单），还是宿主在加载时 Vite 编译（灵活但增加宿主复杂度）？倾向前者，开发时可提供 `pnpm dev:pack-frontend` 辅助。

### O3: CSS 隔离策略

不做 Shadow DOM。约定 custom 前端使用 scoped CSS 或 CSS Modules。Shell 的 `--yd-*` 变量体系对 custom 前端是可选参考，不做强制。

### O4: Custom 前端框架自由

`mount(target, context)` 合约不限制框架。但 `@yidhras/contracts` 类型是 TypeScript，跨框架消费需要手动维护类型定义。首期只保证 Vue 3 的一等支持，其他框架由包作者自行适配。

## 16. 与现有草案的关键差异

| | 旧草案 | 新草案 |
|------|--------|--------|
| 前端类型 | `default / configured / custom` | `default / custom` |
| 共享组件库 | `@yidhras/web-kit` 预先提取 | Phase 3 按需提取 |
| 迁移阶段 | Phase 0-3，Phase 0 行为不变 | Phase 1-3，无行为不变约束 |
| URL 兼容 | 保留旧路径重定向 | 不保留，直接切到 `/packs/:packId/...` |
| Session-pack 绑定 | 保留绑定，新增 switch-pack endpoint | 解除绑定 |
| ShellContext | 7 个字段 + capabilities 枚举 | 3 个字段，按需扩展 |
| 主题配置 | `frontend.theme_overrides` 双入口 | 单一入口：`metadata.presentation.theme` |
| E2E 测试 | Phase 0 前补充 | Phase 1 后补充 |
