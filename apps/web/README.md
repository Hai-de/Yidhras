# Yidhras Web

`apps/web` 是 Yidhras 的 Nuxt 4 + Vue 3 + Pinia 前端，定位为操作台型控制界面。

## 范围与结构

- 运行模式：CSR-only（`nuxt.config.ts` 中 `ssr: false`）
- 页面入口：`app.vue` → `layouts/default.vue` → `features/shell/components/AppShell.vue`
- 主要页面：`overview`、`workflow`、`scheduler`、`graph`、`social`、`timeline`、`agents`
- 主要功能目录：
  - `features/overview/*`
  - `features/workflow/*`
  - `features/scheduler/*`
  - `features/graph/*`
  - `features/social/*`
  - `features/timeline/*`
  - `features/agents/*`
  - `features/shell/*`
  - `features/shared/*`
- 共享语义 UI：`components/ui/App*.vue`
- 主题解析与应用：`plugins/theme.ts` + `lib/theme/*`

## 环境要求

- Node.js 18+
- pnpm 10+
- 默认后端地址：`NUXT_PUBLIC_API_BASE`，未设置时回退到 `http://localhost:3001`

## 安装

从仓库根目录执行：

```bash
pnpm install
```

或仅安装当前应用依赖：

```bash
pnpm --filter web install
```

## 本地开发

```bash
pnpm --filter web dev
```

如需覆盖后端地址：

```bash
NUXT_PUBLIC_API_BASE=http://localhost:3001 pnpm --filter web dev
```

## 质量检查

```bash
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web test:unit
pnpm --filter web test:unit:watch
```
## 构建与预览

```bash
pnpm --filter web build
pnpm --filter web preview
```

## 开发约束

- 保持 CSR，不回退到 SSR。
- tick / clock / timeline / workflow 中的 tick-like 值保持 string-first。
- URL 只承载业务定位与来源上下文；store 主要承载 fetch state 与临时 UI state。
- Graph 保持 `ClientOnly + Cytoscape` 渲染路径。
- 通知只用于关键结果与重要失败，不制造轮询噪声。
- 业务页面优先复用 `App*` primitives 与主题 token，不直接依赖第三方组件库的默认视觉。
- 主题来源优先级为：`presentation.theme` > registered world-pack theme > `DEFAULT_APP_THEME`。
- 主题 contract、provider override 与调试方式统一收口到 `docs/THEME.md`。

## 文件锚点

- `app.vue`：bootstrap、通知桥与页面渲染入口
- `layouts/default.vue`：默认布局入口
- `pages/*.vue`：页面路由入口
- `features/shell/*`：壳层骨架、顶部栏、侧栏、底部 dock
- `features/shared/*`：共享展示组件、source context、workspace 级 UI
- `features/overview/*`：overview 聚合页面与摘要卡片
- `features/workflow/*`：workflow 列表、过滤器、详情面板
- `features/scheduler/*`：scheduler 工作区、run/decision/ownership/worker/rebalance 视图
- `features/graph/*`：Graph 页面、toolbar、canvas、inspector、route/store
- `features/social/*`：信息流过滤、列表、详情与跨页跳转
- `features/timeline/*`：时间范围过滤、事件列表与工作流跳转
- `features/agents/*`：agent 概览与 scheduler projection 展示
- `composables/api/*.ts`：按业务聚合的 API client
- `lib/http/client.ts`：统一 API client、envelope 解包与基础错误处理
- `lib/time/*`：tick string-first 工具
- `lib/theme/*`：主题 token、默认主题、merge/resolve/apply/validate/clamp/source
- `plugins/theme.ts`：运行时主题应用入口
- `stores/runtime.ts`、`stores/notifications.ts`、`stores/shell.ts`：全局运行态与壳层状态

## 已知限制

- Graph 的 mesh / tree 仍共用同一 Cytoscape 引擎。
- BottomDock 中 jobs / traces 主要基于 recent targets，而不是完整的专用 read model。
- 部分工作区仍以只读聚合面板为主，可继续扩展更深的 drill-down。
- world-pack 主题来源目前仍是 metadata / registry lookup 组合，不是独立 manifest 或 API contract。
- 进一步的 UI 与 spacing 收口项统一记录在 `docs/ENHANCEMENTS.md`。

## 相关文档

- 根目录 `README.md`：仓库入口与命令导航
- `docs/API.md`：后端接口契约
- `docs/ARCH.md`：架构边界与模块职责
- `docs/LOGIC.md`：业务规则与 tick / workflow 语义
- `docs/THEME.md`：前端主题系统说明
- `docs/ENHANCEMENTS.md`：延后增强项
