# Yidhras Web

Yidhras 的 Nuxt 4 + Vue 3 + Pinia 前端壳层。
This app is currently being rebuilt into an Operator-first control console rather than a layered demo shell.

## 当前状态 / Current Status

- 全站已显式切换为 **CSR**，避免在控制台型界面上为 SSR 增加额外复杂度。
- 主题系统已建立默认 token、CSS 变量、Tailwind 消费链路与 Naive UI 同步链路。
- `app.vue` 已回归为标准入口，只负责 Provider、bootstrap 和 `NuxtLayout` / `NuxtPage`。
- `layouts/default.vue` 已变薄，当前由 `features/shell/components/AppShell.vue` 承担 Operator 壳层骨架。
- `pages/overview` 与 `pages/workflow` 已接入真实后端聚合读模型与工作流观察面板。
- Graph 已迁入 `features/graph/*`，当前使用 `GraphToolbar + GraphMeshView/GraphTreeView + GraphInspector` 组织页面。
- `pages/graph.vue` 不再直接承载旧 `L2Graph.vue`；Graph 渲染通过 `ClientOnly + GraphCanvas + Cytoscape` 运行。
- Social、Timeline、Agent 页面已接入基础读模型与跨页 drill-down，正在向更丰富的工作区体验迭代。
- 旧 `stores/clock.ts` / `stores/system.ts` / `utils/api.ts` 已清理出主线，当前主状态入口为 `runtime/shell/notifications` 以及 feature stores。
- 已新增 `vitest` 与四个核心 store 单测：`runtime / shell / workflow / graph`。

## 环境要求 / Requirements

- Node.js 18+
- pnpm 10+
- 默认后端地址来自 `NUXT_PUBLIC_API_BASE`，未设置时回退到 `http://localhost:3001`

## 安装 / Install

从仓库根目录执行：

```bash
pnpm install
```

或仅安装当前应用依赖：

```bash
pnpm --filter web install
```

## 本地开发 / Development

从仓库根目录执行：

```bash
pnpm --filter web dev
```

默认开发地址通常为 `http://localhost:3000`。

如需覆盖后端 API 地址：

```bash
NUXT_PUBLIC_API_BASE=http://localhost:3001 pnpm --filter web dev
```

## 质量检查 / Quality Checks

```bash
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test:unit
```

## 构建与预览 / Build & Preview

```bash
pnpm --filter web build
pnpm --filter web preview
```

## 当前文件锚点 / Current File Map

- `app.vue`: Provider、基础 bootstrap 与页面渲染入口
- `layouts/default.vue`: 默认布局入口，当前只包裹 `AppShell`
- `features/shell/components/AppShell.vue`: Operator 壳层骨架（活动栏 / 顶栏 / 底栏）
- `features/overview/*`: Overview 聚合页面、列表卡片与 summary polling
- `features/workflow/*`: Workflow 过滤器、jobs table、detail panel 与页面 composable
- `features/graph/*`: Graph V2 页面、route/store、toolbar、canvas、inspector 与 Cytoscape 内聚实现
- `features/social/*`: 社交信息流过滤、列表、详情与工作流/角色跳转
- `features/timeline/*`: 时间范围过滤、事件列表与工作流跳转
- `features/agents/*`: Agent 概览摘要与 tab-based detail scaffold
- `composables/api/*.ts`: 按业务聚合的前端 API 入口
- `lib/http/client.ts`: 统一 API client、envelope 解包与基础错误处理
- `lib/theme/*`: 默认主题 token、Naive overrides、CSS variable 投影
- `lib/time/*`: tick string-first 工具与比较/格式化逻辑
- `stores/runtime.ts`: runtime / clock 聚合状态
- `stores/notifications.ts`: 通知队列状态
- `stores/shell.ts`: 壳层工作区与 dock 状态
- `tests/unit/*.spec.ts`: 核心 store 单测
- `tailwind.config.ts`: 主题变量到 Tailwind 的消费映射

## 已知限制 / Known Limitations

- Graph 仍使用 Cytoscape 单引擎同时承载 mesh/tree，两种视图的视觉差异仍是第一版基线。
- Social、Timeline、Agent 页面目前是“基础工作区版”，尚未做更高级的聚类、多列配置、抽屉化 inspector 等增强。
- `nuxt typecheck` 当前仍会输出一个来自 `vue-router/volar/sfc-route-blocks` 的外部依赖 warning，但命令最终可成功通过。
- world-pack 主题覆盖暂未产品化，当前只提供默认 token 体系。

## 相关文档 / Related Docs

- 根目录 `README.md`: 项目整体状态与文档索引
- 根目录 `TODO.md`: 里程碑与当前 M3 状态
- `docs/API.md`: 后端接口契约
- `docs/ARCH.md`: 架构边界与 contract/validation 原则
- `docs/LOGIC.md`: 业务逻辑说明与 BigInt transport 规则
- `.limcode/plans/frontend-directory-refactor-rollout.plan.md`: 当前前端重构执行计划
