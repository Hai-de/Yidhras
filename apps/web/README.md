# Yidhras Web

Yidhras 的 Nuxt 4 + Vue 3 + Pinia 前端壳层。
This app is currently being rebuilt into an Operator-first control console rather than a layered demo shell.

## 当前状态 / Current Status

- 全站已显式切换为 **CSR**，避免在控制台型界面上为 SSR 增加额外复杂度。
- 主题系统已建立默认 token、CSS 变量、Tailwind 消费链路，并已完成从 Naive UI 根级主题桥到 Nuxt UI 基础设施的迁移收口。
- `app.vue` 已回归为标准入口，只负责 bootstrap、全局通知桥与 `NuxtLayout` / `NuxtPage`。
- `layouts/default.vue` 已变薄，当前由 `features/shell/components/AppShell.vue` 承担 Operator 壳层骨架。
- `pages/overview` 与 `pages/workflow` 已接入真实后端聚合读模型与工作流观察面板。
- `pages/scheduler` 与 `features/scheduler/*` 已新增独立 Scheduler Workspace，承载 scheduler control tower 级观测与 drill-down。
- Graph 已迁入 `features/graph/*`，当前使用 `GraphToolbar + GraphMeshView/GraphTreeView + GraphInspector` 组织页面。
- `pages/graph.vue` 不再直接承载旧 `L2Graph.vue`；Graph 渲染通过 `ClientOnly + GraphCanvas + Cytoscape` 运行。
- Social、Timeline、Agent 页面已接入基础读模型与跨页 drill-down，正在向更丰富的工作区体验迭代。
- Overview 现已直接消费 `/api/runtime/scheduler/operator`；Agent 页面现已直接消费 `/api/agent/:id/scheduler/projection`。
- Scheduler Workspace 现已接入 ownership / workers / rebalance / recent activity，并提供 run / decision / partition / worker 的基础 drill-down。
- Shell activity rail 与 source-context 现已正式纳入 `scheduler` workspace，recent targets 也会记录 scheduler run / decision / worker / partition 焦点。
- 旧 `stores/clock.ts` / `stores/system.ts` / `utils/api.ts` 已清理出主线，当前主状态入口为 `runtime/shell/notifications` 以及 feature stores。
- 已新增 `vitest` 与核心 store / shell context 单测：`runtime / notifications / shell / workflow / graph / shell context / scheduler api`
- 新一轮 Operator UI polish 已完成第一阶段，当前已有统一页面骨架、来源上下文、Graph focus/root 交互、freshness 与轻量通知反馈。
- Shell 全局控制台体验增强第一轮最小基线已落地：
  - TopRuntimeBar 已具备 runtime freshness、notifications 聚合、refresh all 与 dock toggle
  - Sidebar 已升级为 context-aware shell panel（workspace / source / focus / quick actions / recent targets）
  - BottomDock 的 jobs / traces 已不再是纯 placeholder，而是基于 recent targets 的最小回看层
- Graph 深化与 Timeline / Social 语义映射优化已完成首轮增量：
  - Graph quick roots、search context、inspector grouping / action explainers 已落地
  - Timeline → Social 已支持 intent-first + tick-scoped context
  - Social → Timeline 已改为 timeline slice，而非表达为精确 event 跳转
  - Social / Timeline mapping context banner 已补齐
- Naive UI → Nuxt UI 基础设施迁移已完成当前阶段收口：
  - 通知链路已通过 `composables/ui/useAppToast.ts` 统一抽象，并切换到底层 Nuxt UI `useToast`
  - 根级 `NConfigProvider` / `NMessageProvider` 与 Naive 主题覆盖桥已移除
  - `@nuxt/ui` 已接入 `nuxt.config.ts` 与主样式入口
  - `naive-ui` / `vueuc` / `vooks` / `vite-tsconfig-paths` 相关残留已从依赖与配置中清理
  - `pnpm --filter web typecheck && lint && test:unit` 已恢复通过
- 主题系统 Phase 1 已完成：
  - 默认主题已统一收敛为 `DEFAULT_APP_THEME`
  - 运行时主题入口已从历史 `plugins/naive-ui.ts` 更名为 `plugins/theme.ts`
  - `AppThemeDefinition` 已拆分为 `meta/core/layout/components`
  - `color-scheme` 已改为运行时由 theme meta 驱动，而非静态 CSS 写死
  - `assets/css/tokens.css` 已收敛为最小兜底变量层
- 主题系统 Phase 2 已完成当前阶段收口：
  - 已新增 world pack 主题 override 类型 `WorldPackThemeConfig`
  - 已建立 `resolveThemeWithDiagnostics()` 作为 final theme 解析入口
  - 已具备 merge / validate / fallback / clamp / diagnostics 基线
  - 已接入 world pack source lookup 与 runtime `worldPack` 监听重应用
  - shell rail/sidebar/dock 与主页面容器已开始消费 `layout` token
  - theme resolver 基线单测已补齐
- 主题系统 Phase 3 已开始：
  - 已新增第一批 semantic primitives：`AppButton`、`AppPanel`、`AppAlert`、`AppInput`、`AppSelect`、`AppBadge`、`AppTabs`
  - 页头 refresh actions、部分页面容器 panel、`SocialFiltersBar`、`TimelineRangeBar`、`WorkflowFiltersBar`、`GraphToolbar`、`WorkspaceStatusBanner`、agent tabs、`SocialPostList`、`SocialPostDetail`、`TimelineEventList`、`TimelineEventDetail`、`WorkflowStatusBadge`、`WorkflowDetailPanel` 等高收益区域已开始切换到 primitives
  - 当前明确约束：**Nuxt UI 只作为基础组件/基础设施层使用，不作为业务层的重依赖，也不接管整站视觉风格**
- 平台默认黑色主题当前以 **类 VSCode workbench** 为目标持续打磨：
  - 官方默认主题负责平台自身 dark console / workbench 风格
  - world-pack 提供者拥有自己的主题主导权，不要求跟随平台默认视觉
  - 平台只维护默认主题、稳定 token contract、runtime resolve/apply 与少量 fallback / diagnostics
  - semantic primitives / shell / Nuxt UI bridge 只应消费语义 token，不应写死平台默认审美
- provider-owned 自定义能力现已收敛到单一推荐入口：
  - runtime world metadata 只使用 `presentation.theme` 作为 provider-owned 主题入口
  - 解析优先级为 **`presentation.theme` > 平台 registry 注册主题 > 平台默认主题**
  - 平台继续只负责 merge / validate / clamp / diagnostics，不替 provider 改写视觉风格
  - 开发期可通过 `document.documentElement.dataset.themeSource*` 与 console `[theme] active source` 观察当前主题来源

## Provider Theme Authoring / Provider 主题编写建议

推荐 provider 使用以下 runtime payload 结构：

```ts
const worldPack = {
  id: 'pack-example',
  name: 'Pack Example',
  version: '1.0.0',
  presentation: {
    theme: {
      meta: {
        id: 'pack-example-theme',
        name: 'Pack Example Theme',
        colorScheme: 'dark'
      },
      core: {
        colors: {
          bg: {
            app: '#0f1115',
            panel: '#171a21',
            elevated: '#1d2330',
            overlay: 'rgba(7, 10, 14, 0.78)'
          },
          state: {
            accent: '#c084fc'
          }
        },
        radius: {
          sm: '2px',
          md: '6px',
          lg: '10px'
        }
      },
      layout: {
        shell: {
          sidebarWidth: '344px'
        }
      }
    }
  }
}
```

建议规则：

- **只使用 `presentation.theme`** 作为稳定 provider-owned 主题入口。
- provider 只需要提供自己关心的部分字段，平台会在缺失字段上回退到默认主题。
- 平台只校验合法性、做安全 clamp 与 diagnostics，不会把 provider 主题强制修正成平台默认风格。
- 可直接参考并复制：`apps/web/lib/theme/provider-theme.example.ts`

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

## 后续 UI / 交互增强 Guardrails

后续继续增强 `apps/web` 时，默认遵循：

- 保持 **CSR**，不为 polish 回退到 SSR 语义。
- tick / clock / timeline / workflow 中的 tick-like 值继续保持 **string-first**。
- URL 只存业务定位状态与来源上下文，不写入纯临时 UI 状态。
- Graph 继续保持 **`ClientOnly + Cytoscape`**。
- 通知只用于关键结果与重要失败，不制造 polling 噪声。
- Nuxt UI 当前只作为基础设施层（toast / overlay / primitives 候选），不反向重写既有 Operator 自定义壳层。
- Phase 3 中继续坚持：
  - 业务层优先依赖 `App*` semantic primitives
  - Nuxt UI 只作为基础组件层能力候选，不向业务页面直接暴露重依赖 API
  - 产品风格仍由 yd token / theme system 主导，而不是由第三方组件库默认视觉主导
  - 平台默认类 VSCode 黑色主题只代表官方主题，不代表 world-pack provider 的强制设计规范
  - provider 主题只要满足最小 token contract、合法性校验与安全 clamp，即可自由自定义视觉语言
- 主题系统后续按 `Phase 1 -> Phase 2 -> Phase 3` 推进：
  - 先稳定平台默认主题、theme plugin 与 CSS variable 基础设施
  - 再接入 world pack theme override、validate、fallback、clamp
  - 最后引入 semantic primitives 与 Nuxt UI bridge
- 所有增量改动在合并前仍需通过：

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test:unit
```

## 构建与预览 / Build & Preview

```bash
pnpm --filter web build
pnpm --filter web preview
```

## 当前文件锚点 / Current File Map

- `app.vue`: bootstrap、全局通知桥与页面渲染入口
- `layouts/default.vue`: 默认布局入口，当前只包裹 `AppShell`
- `features/shell/components/AppShell.vue`: Operator 壳层骨架（活动栏 / 顶栏 / 底栏）
- `features/overview/*`: Overview 聚合页面、列表卡片与 summary polling
- `features/scheduler/*`: Scheduler Workspace、route state、run/decision/ownership/worker/rebalance 视图与 adapters
- `features/workflow/*`: Workflow 过滤器、jobs table、detail panel、retry 与页面 composable
- `features/graph/*`: Graph V2 页面、route/store、toolbar、canvas、inspector 与 Cytoscape 内聚实现
- `features/social/*`: 社交信息流过滤、列表、详情与工作流/角色跳转
- `features/timeline/*`: 时间范围过滤、事件列表与工作流跳转
- `features/agents/*`: Agent 概览摘要与 scheduler projection detail
- `components/ui/*`: semantic primitives，当前已落地 `AppButton`、`AppPanel`、`AppAlert`、`AppInput`、`AppSelect`、`AppBadge`、`AppTabs`
- `composables/api/useSchedulerApi.ts`: scheduler observability / operator / agent projection API client
- `composables/ui/useAppToast.ts`: 前端统一 toast/notification 抽象，当前底层接入 Nuxt UI
- `features/shared/*`: workspace 共享 UI、freshness helper、source context、全局通知桥接
- `composables/api/*.ts`: 按业务聚合的前端 API 入口
- `lib/http/client.ts`: 统一 API client、envelope 解包与基础错误处理
- `lib/time/*`: tick string-first 工具与比较/格式化逻辑
- `lib/theme/*`: 主题 token、默认主题、merge/resolve/apply/clamp/validate/source 基础设施
- `plugins/theme.ts`: 运行时主题解析与 CSS variable 应用入口
- `stores/runtime.ts`: runtime / clock 聚合状态
- `stores/notifications.ts`: 远端通知 + 本地 UI 反馈通知
- `stores/shell.ts`: 壳层工作区与 dock 状态 / recent targets
- `tests/unit/*.spec.ts`: 核心 store / shell context / scheduler api 单测
- `tests/unit/theme.resolver.spec.ts`: theme merge/validate/clamp/source lookup 单测
- `tailwind.config.ts`: 主题变量到 Tailwind 的消费映射

## 已知限制 / Known Limitations

- Graph 仍使用 Cytoscape 单引擎同时承载 mesh/tree，两种视图的视觉差异仍是第一版基线。
- Social、Timeline、Agent 页面目前是“基础工作区版”，尚未做更高级的聚类、多列配置、抽屉化 inspector 等增强。
- Timeline ↔ Social 当前虽然已从宽松跳转收紧为 intent/tick/context 优先，但仍依赖现有读模型；若后端未来提供更强 mapping contract，仍可继续增强。
- Shell 的 jobs / traces / notifications 虽已形成最小控制台层，但 jobs / traces 当前仍主要基于 recent targets，而非更完整的任务/trace 专属 read model。
- Scheduler Workspace 当前是 Phase 4B baseline：已完成独立入口、projection 消费与基础 drill-down，但更深的 decision detail / richer worker hot spots / actor hot spots 仍属后续增强。
- Nuxt UI 迁移当前主要覆盖通知与根级基础设施层；若后续引入更多 Nuxt UI 组件，仍需保持与现有 token / Tailwind 体系的一致性约束。
- world-pack 主题覆盖当前已完成平台级解析基线，但 world pack source 仍是 registry/lookup 形态，尚未完全产品化为 manifest/API contract。
- 共享基础组件内部的 spacing token 收口已被记录到 `docs/ENHANCEMENTS.md`，将在后续增强阶段继续处理。
- Phase 3 当前仍处于 early stage：已建立 primitive 层并完成第一批高收益迁移，但 Nuxt UI bridge 仍会保持轻依赖，不会转向由第三方库主导整站 UI。

## 相关文档 / Related Docs

- 根目录 `README.md`: 项目整体状态与文档索引
- 根目录 `TODO.md`: 里程碑与当前 M3 状态
- `docs/API.md`: 后端接口契约
- `docs/ARCH.md`: 架构边界与 contract/validation 原则
- `docs/LOGIC.md`: 业务逻辑说明与 BigInt transport 规则
- `docs/ENHANCEMENTS.md`: 当前暂缓处理但值得后续回收的增强项清单
- `docs/THEME.md`: 前端主题 contract、默认主题规则、provider-owned theme 与主题开发手册
