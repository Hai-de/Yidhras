## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [ ] 建立 CSR + runtimeConfig + string-first 时间工具与统一 HTTP client 基线  `#phase-1-infra-baseline`
- [ ] 建立默认主题 token、CSS 变量、Tailwind/Naive UI 统一消费链路  `#phase-2-theme-foundation`
- [ ] 重写 app/layout 为 Operator 壳层骨架并接入固定 Operator 身份区  `#phase-3-shell-scaffold`
- [ ] 建立统一轮询/降频/详情按需拉取的数据获取框架与核心 store  `#phase-4-data-fetching`
- [ ] 建立基于 useRoute/useRouteQuery 的业务定位 URL 状态与跳转助手  `#phase-5-route-state`
- [ ] 优先落地 Overview 与 Workflow 页面及其特性目录  `#phase-6-overview-workflow`
- [ ] 以完全内聚方式重构 Graph 特性并迁移旧 L2Graph 到 Cytoscape ClientOnly 架构  `#phase-7-graph-feature`
- [ ] 补齐 Social、Agent、Timeline 页面与跨页 drill-down  `#phase-8-social-agents-timeline`
- [ ] 删除旧三栏遗留文件并补齐 runtime/shell/workflow/graph 核心 store 单测  `#phase-9-cleanup-tests`
<!-- LIMCODE_TODO_LIST_END -->

# 前端目录重构落地清单（按实施顺序）

## 1. 文档目标

本清单用于指导 `apps/web` 从当前的“旧三栏壳 + L2 mock graph + 局部 API 接入”迁移到新的 **Operator 控制台前端结构**。

本清单只解决三类问题：

1. **目录怎么改**
2. **文件按什么顺序迁移**
3. **哪些阶段先做、哪些阶段后做**

本清单不直接实施代码修改，但它应该足够细到可以作为后续连续 PR 的执行蓝本。

---

## 2. 已冻结前置决策

以下决策已作为本轮重构默认约束，不再反复回到“是否要这样做”的讨论：

- 全站关闭 SSR，采用 **CSR**
- 前端所有 tick-like / BigInt 字段采用 **string-first**
- Graph/Cytoscape 显式走 **`ClientOnly` + `onMounted` 初始化**
- Graph 的 `mesh/tree` 第一阶段统一继续用 **Cytoscape**
- URL 只承载 **业务定位状态**，纯临时 UI 状态不进 URL
- 数据获取策略采用 **默认轮询 + visibility 降频 + 详情按需拉取**
- 身份区采用固定 **Operator 壳**，不做真实登录系统产品化
- 响应式写法保留，但当前不考虑移动端产品化
- 本轮只做 **runtime / shell / workflow / graph** 四个核心 Store 单测
- 主题系统只做 **默认 token**，暂不做 world-pack 主题产品化
- API base URL 统一通过 **`runtimeConfig.public.apiBase`** 注入

---

## 3. 目标目录结构（V1）

> 目标：让全局壳层、共享基础设施、业务页面、Graph 子系统都各有明确边界；其中 **Graph 必须完全内聚**。

```txt
apps/web/
├─ app.vue
├─ error.vue
├─ nuxt.config.ts
├─ package.json
│
├─ plugins/
│  ├─ naive-ui.ts
│  └─ bootstrap.client.ts
│
├─ layouts/
│  └─ default.vue
│
├─ pages/
│  ├─ index.vue
│  ├─ overview.vue
│  ├─ workflow.vue
│  ├─ social.vue
│  ├─ timeline.vue
│  ├─ graph.vue
│  └─ agents/
│     ├─ index.vue
│     └─ [id].vue
│
├─ features/
│  ├─ shell/
│  │  ├─ components/
│  │  ├─ constants.ts
│  │  ├─ store.ts
│  │  └─ types.ts
│  ├─ shared/
│  │  ├─ components/
│  │  ├─ constants/
│  │  └─ types/
│  ├─ overview/
│  │  ├─ components/
│  │  ├─ composables/
│  │  ├─ adapters.ts
│  │  └─ types.ts
│  ├─ workflow/
│  │  ├─ components/
│  │  ├─ composables/
│  │  ├─ store.ts
│  │  ├─ route.ts
│  │  ├─ adapters.ts
│  │  └─ types.ts
│  ├─ social/
│  │  ├─ components/
│  │  ├─ composables/
│  │  ├─ route.ts
│  │  ├─ adapters.ts
│  │  └─ types.ts
│  ├─ timeline/
│  │  ├─ components/
│  │  ├─ composables/
│  │  ├─ route.ts
│  │  ├─ adapters.ts
│  │  └─ types.ts
│  ├─ agents/
│  │  ├─ components/
│  │  ├─ composables/
│  │  ├─ route.ts
│  │  ├─ adapters.ts
│  │  └─ types.ts
│  └─ graph/
│     ├─ components/
│     ├─ composables/
│     ├─ lib/
│     ├─ store.ts
│     ├─ route.ts
│     ├─ constants.ts
│     ├─ adapters.ts
│     └─ types.ts
│
├─ stores/
│  ├─ runtime.ts
│  ├─ shell.ts
│  └─ notifications.ts
│
├─ composables/
│  ├─ app/
│  │  ├─ useOperatorBootstrap.ts
│  │  ├─ useVisibilityPolling.ts
│  │  └─ useRuntimeControls.ts
│  └─ api/
│     ├─ useSystemApi.ts
│     ├─ useOverviewApi.ts
│     ├─ useWorkflowApi.ts
│     ├─ useSocialApi.ts
│     ├─ useTimelineApi.ts
│     ├─ useAgentApi.ts
│     └─ useGraphApi.ts
│
├─ lib/
│  ├─ http/
│  │  └─ client.ts
│  ├─ theme/
│  │  ├─ default-theme.ts
│  │  ├─ tokens.ts
│  │  ├─ resolver.ts
│  │  └─ apply-css-vars.ts
│  ├─ time/
│  │  ├─ tick.ts
│  │  ├─ compare.ts
│  │  └─ format.ts
│  └─ utils/
│     └─ guards.ts
│
├─ tests/
│  └─ unit/
│     ├─ runtime.store.spec.ts
│     ├─ shell.store.spec.ts
│     ├─ workflow.store.spec.ts
│     └─ graph.store.spec.ts
│
├─ assets/
│  └─ css/
│     ├─ base.css
│     ├─ tokens.css
│     ├─ theme-default.css
│     └─ utilities.css
│
└─ public/
```

---

## 4. 当前文件到目标结构的迁移映射

| 当前文件 | 目标去向 | 迁移说明 |
|---|---|---|
| `apps/web/app.vue` | 保留原位 | 简化为 provider + bootstrap + `NuxtLayout`/`NuxtPage` |
| `apps/web/layouts/default.vue` | 保留原位，但变薄 | 仅包 `features/shell` 的 `AppShell` |
| `apps/web/components/L2Graph.vue` | `features/graph/` | 拆成 `components + lib + route + store`，不再保留 L2 命名 |
| `apps/web/stores/clock.ts` | `stores/runtime.ts` | 时钟状态合并入 runtime store，且改为 string-first |
| `apps/web/stores/system.ts` | `stores/runtime.ts` + `stores/shell.ts` | runtime/status 与 UI shell 状态分离 |
| `apps/web/utils/api.ts` | `lib/http/client.ts` | API client 升级为统一 client；兼容期可保留薄转发 |
| `apps/web/assets/css/main.css` | `assets/css/*` | 拆成 base/token/theme/utilities |
| 旧三栏逻辑 | `features/shell/` | 改为 Operator 顶栏/底栏/活动栏壳层 |

---

## 5. 实施顺序总览

| 阶段 | 目标 | 预期结果 | 是否允许与旧结构并存 |
|---|---|---|---|
| Phase 1 | 先打基础设施底座 | CSR、apiBase、时间规则、统一 client 到位 | 是 |
| Phase 2 | 建立默认主题系统 | CSS vars / Tailwind / Naive UI 对齐 | 是 |
| Phase 3 | 建立新壳层骨架 | Operator shell 可运行，旧业务可暂挂载 | 是 |
| Phase 4 | 建立统一 data fetching | polling/visibility/详情按需规范落地 | 是 |
| Phase 5 | 建立 route-state 体系 | 业务定位态可进 URL、可分享 | 是 |
| Phase 6 | 优先重写 Overview + Workflow | 新壳层真正承载核心页面 | 是 |
| Phase 7 | Graph 子系统完全内聚化 | 替代旧 L2Graph 与旧层级认知 | 过渡期允许 |
| Phase 8 | 补 Social / Agents / Timeline | 完成主要工作区闭环 | 是 |
| Phase 9 | 删除遗留 + 补核心单测 | 收尾并稳定长期结构 | 否 |

---

# 6. 分阶段实施清单

## Phase 1：基础设施基线

### 目标
先把“后面所有页面都依赖的基础假设”稳定下来，避免一边写页面一边返工基础层。

### 必做项

1. **显式关闭 SSR**
   - 更新 `apps/web/nuxt.config.ts`
   - 设置：`ssr: false`
   - 明确当前前端是 Operator CSR 控制台

2. **接入 `runtimeConfig.public.apiBase`**
   - 在 `nuxt.config.ts` 中声明 `public.apiBase`
   - 本地默认值可指向 `http://localhost:3001`
   - 禁止后续组件层硬编码 API 地址

3. **建立统一 HTTP client**
   - 新建：`lib/http/client.ts`
   - 接管现有 `utils/api.ts` 的 envelope 解包能力
   - 将 base URL、错误处理、headers、body normalize 收口
   - 兼容期：`utils/api.ts` 可保留为薄包装并标注待删除

4. **建立 string-first 时间工具**
   - 新建：`lib/time/tick.ts` / `compare.ts` / `format.ts`
   - 规则：Store / query / public type 一律使用字符串
   - 只允许 helper 内部临时 `BigInt(value)`

5. **建立基础目录骨架**
   - 创建：`features/`、`composables/app/`、`composables/api/`、`lib/theme/`、`lib/time/`

### 完成标志
- `ssr: false` 已生效
- 前端不存在新的硬编码 API 地址
- 新代码默认不再把 tick 存成 `bigint`

### 本阶段不要做的事
- 不急着重写页面
- 不急着做 Graph 重构
- 不急着做复杂视觉

---

## Phase 2：默认主题与 CSS 变量基线

### 目标
先建立唯一视觉真源，让后续 Shell、Workflow、Graph 都能吃同一套 token。

### 必做项

1. **建立默认 token 源**
   - 新建：`lib/theme/default-theme.ts`
   - 作为默认情报台风格的唯一源头

2. **输出全局 CSS Variables**
   - 新建：`assets/css/tokens.css`
   - 变量至少包含：
     - app/panel/elevated 背景
     - border/text 色
     - success/warning/danger/info/accent
     - graph 节点/边色
     - 字体、圆角、边框、网格透明度

3. **拆分 CSS 层**
   - `base.css`：reset / body / 通用版心
   - `tokens.css`：变量定义
   - `theme-default.css`：默认主题投影
   - `utilities.css`：产品级工具类

4. **Tailwind 消费变量**
   - 不再在业务组件中大量硬写颜色
   - 背景/边框/文字类尽量走 CSS vars

5. **Naive UI 同步变量**
   - 新建：`plugins/naive-ui.ts`
   - 通过同一份 token 生成 `themeOverrides`
   - 避免 Tailwind/Naive 颜色体系分裂

### 完成标志
- Shell/Card/Badge/表格/Graph 可以共享同一套 token 命名
- 新增组件不再依赖散落硬编码颜色值

### 本阶段不要做的事
- 不做 world-pack 主题产品化
- 不做主题切换器

---

## Phase 3：Operator 壳层骨架

### 目标
把旧三栏结构换成新的 Operator shell，但允许旧业务内容临时寄生在新壳层中。

### 必做项

1. **简化 `app.vue`**
   - 只保留：
     - 全局 Provider
     - `useOperatorBootstrap()`
     - `NuxtLayout`
     - `NuxtPage`
   - 禁止继续在 `app.vue` 直接挂具体业务页面内容

2. **把 `layouts/default.vue` 变成薄壳**
   - 默认 layout 只负责引入 `features/shell/components/AppShell.vue`

3. **新建 Shell 组件**
   - `features/shell/components/AppShell.vue`
   - `ActivityRail.vue`
   - `TopRuntimeBar.vue`
   - `BottomDock.vue`
   - `WorkspaceSidebar.vue`
   - `OperatorIdentityBadge.vue`

4. **建立固定 Operator 身份区**
   - 左下角显示固定 Operator
   - 使用默认头像/占位图
   - 不实现 auth/account 菜单产品化

5. **建立页面入口**
   - 新建：
     - `pages/index.vue`
     - `pages/overview.vue`
     - `pages/workflow.vue`
     - `pages/graph.vue`
     - `pages/social.vue`
     - `pages/timeline.vue`
     - `pages/agents/[id].vue`
   - 初期页面可以只放占位块 + 壳层联通

### 完成标志
- 新壳层可运行
- 顶栏/底栏/活动栏结构到位
- 旧内容可以先以占位或临时挂载方式接进新壳

### 本阶段不要做的事
- 不追求页面内容完整
- 不在此阶段重写全部 feature

---

## Phase 4：统一 Data Fetching 与核心 Store

### 目标
避免每个组件自己轮询；把“实时性”和“刷新”提升为统一机制。

### 必做项

1. **建立 app 级数据获取工具**
   - `composables/app/useVisibilityPolling.ts`
   - 支持：
     - 轮询
     - 页面不可见降频
     - 页面重新可见立即刷新
     - 停止/恢复

2. **建立 bootstrap 入口**
   - `useOperatorBootstrap.ts`
   - 负责启动：
     - runtime/status polling
     - clock polling
     - notifications polling

3. **建立核心 Store**
   - `stores/runtime.ts`
   - `stores/shell.ts`
   - `stores/notifications.ts`
   - `features/workflow/store.ts`
   - `features/graph/store.ts`

4. **统一 API composables**
   - `useSystemApi.ts`
   - `useOverviewApi.ts`
   - `useWorkflowApi.ts`
   - `useGraphApi.ts`
   - `useSocialApi.ts`
   - `useAgentApi.ts`
   - `useTimelineApi.ts`

5. **落实默认轮询策略**
   - `/api/clock/formatted`：1s
   - `/api/status`：5s
   - `/api/system/notifications`：5s
   - 页面级资源按页面进入后再启用

### 完成标志
- 新壳层数据不再散落在各组件 `setInterval`
- runtime/status/time/notifications 已由统一机制驱动

### 本阶段不要做的事
- 不做推流实现
- 不在组件里私建轮询器

---

## Phase 5：业务定位态与 Route State

### 目标
让页面过滤、定位、选中能够被 URL 表达，从而支持刷新恢复与协作分享。

### 必做项

1. **建立 route-state composables**
   - `features/workflow/route.ts`
   - `features/social/route.ts`
   - `features/timeline/route.ts`
   - `features/agents/route.ts`
   - `features/graph/route.ts`

2. **统一使用 `useRoute()` + `useRouteQuery()`**
   - 只在 route composable 中使用
   - 叶子组件不直接改 query

3. **落实 canonical route 规则**
   - Workflow：`/workflow?job_id=...`
   - Trace：`/workflow?trace_id=...`
   - Graph：`/graph?root_id=...&view=mesh`
   - Social Post：`/social?post_id=...`
   - Timeline Event：`/timeline?event_id=...`
   - Agent：`/agents/:id`

4. **建立路由跳转助手**
   - 可选：`features/shared/navigation.ts`
   - 统一从 post/job/node/event 跳到目标页面

### 完成标志
- 业务定位态可复制分享
- 刷新后仍可恢复当前定位上下文

### 本阶段不要做的事
- 不把 dock 打开状态、hover 状态写进 URL

---

## Phase 6：优先落地 Overview + Workflow

### 目标
优先把最能体现“前端终于跟上后端”的两个页面做起来。

### 必做项

1. **Overview 页面**
   - 目录：`features/overview/`
   - 消费：`/api/overview/summary`
   - 首批模块建议：
     - Runtime summary
     - World time
     - Recent events
     - Failed jobs
     - Notifications
     - Quick entries

2. **Workflow 页面**
   - 目录：`features/workflow/`
   - 消费：
     - `/api/inference/jobs`
     - `/api/inference/jobs/:id`
     - `/api/inference/jobs/:id/workflow`
     - `/api/inference/traces/:id`
     - `/api/inference/traces/:id/intent`
   - 首批模块建议：
     - Jobs list/table
     - Filters bar
     - Workflow status badge
     - Job detail drawer/panel
     - Trace detail
     - Intent detail
     - Workflow snapshot
     - Retry action

3. **将底部 Dock 与 Workflow 联动**
   - Dock 中的最近 jobs / traces / notifications 能跳转到 Workflow 页面定位

### 完成标志
- Operator 控制台已有可用首页与工作流观察页
- 后端最成熟能力得到真实承接

### 本阶段不要做的事
- 不追求把所有 Workflow debug 细节一次做满

---

## Phase 7：Graph 子系统完全内聚化

### 目标
把现有 `L2Graph.vue` 彻底升级为面向 Graph V2 的完整子系统，并消除旧 L2 命名与旧认知。

### 必做项

1. **建立 `features/graph/` 完整边界**
   - `components/`
   - `composables/`
   - `lib/`
   - `store.ts`
   - `route.ts`
   - `types.ts`
   - `constants.ts`
   - `adapters.ts`

2. **拆解旧 `L2Graph.vue`**
   - 渲染容器 -> `GraphCanvas.vue`
   - mesh view -> `GraphMeshView.vue`
   - tree view -> `GraphTreeView.vue`
   - 过滤/搜索 -> `GraphToolbar.vue` / `GraphSearchFloating.vue`
   - inspector -> `GraphInspector.vue`

3. **Graph lib 层**
   - Cytoscape init
   - style builder
   - layout builder
   - normalize graph view payload
   - selection / focus / neighborhood helpers

4. **显式 `ClientOnly`**
   - 所有 Cytoscape 容器必须包在 `ClientOnly` 中
   - 初始化逻辑只在 `onMounted`

5. **接入 Graph V2 接口**
   - `/api/graph/view`
   - 支持：
     - `view`
     - `root_id`
     - `depth`
     - `kinds`
     - `include_inactive`
     - `include_unresolved`
     - `search`

6. **tree 仍继续用 Cytoscape**
   - 先通过布局/样式切换实现树形语义
   - 暂不引入第二套图形 renderer

### 完成标志
- 旧 `L2Graph.vue` 不再承担核心角色
- Graph 成为独立 feature，而不是“剩下来的一个组件”

### 本阶段不要做的事
- 不做第二套 Graph renderer
- 不做 world-pack 图渲染规则产品化

---

## Phase 8：补齐 Social / Agents / Timeline

### 目标
形成从 Overview / Workflow / Graph 到内容与实体页的工作流闭环。

### 必做项

1. **Social 页面**
   - 目录：`features/social/`
   - 使用 `/api/social/feed`
   - 支持：
     - 过滤器
     - 帖子展开
     - 从帖子跳 Agent / Workflow / Timeline

2. **Agent 页面**
   - 目录：`features/agents/`
   - 使用 `/api/agent/:id/overview`
   - 模块建议：
     - 基础信息
     - 关系摘要
     - 最近行为
     - memory summary
     - recent workflows / inference

3. **Timeline 页面**
   - 目录：`features/timeline/`
   - 初期先做：
     - 事件列表
     - 时间范围过滤
     - 事件定位
   - 事件聚类/事件链可放到后续增强

4. **补齐跨页 drill-down**
   - 从 Social Post -> Agent / Workflow / Timeline
   - 从 Graph node -> Agent / Workflow
   - 从 Timeline Event -> Workflow / Social / Agent

### 完成标志
- 主要工作区已形成闭环
- 跨页定位与回溯链路可用

### 本阶段不要做的事
- 不在第一版强上过度复杂的多列保存布局管理
- 不强推 Timeline 高级聚类算法

---

## Phase 9：清理遗留与补核心单测

### 目标
在新结构基本可用后，删除旧时代遗留，避免“新旧双系统长期并存”。

### 必做项

1. **删除/下线旧文件**
   - `components/L2Graph.vue`
   - `stores/clock.ts`
   - `stores/system.ts`
   - `utils/api.ts`（若已彻底迁出）
   - 旧三栏类逻辑

2. **清理旧命名与说明**
   - 删除 L1/L2/L3/L4 作为主导航的旧表述
   - 在 README / Web README 中更新新结构说明

3. **补核心 Store 单测**
   - `runtime.store.spec.ts`
   - `shell.store.spec.ts`
   - `workflow.store.spec.ts`
   - `graph.store.spec.ts`

4. **进行手工验收**
   - 顶栏 runtime/time/speed 是否稳定
   - Dock 是否可联动到 Workflow/Notifications
   - Workflow 详情是否可定位/刷新
   - Graph 是否支持 root/filter/view 切换
   - URL 刷新恢复是否符合预期

### 完成标志
- 旧三栏壳层与旧 API/Store 遗留基本退出主线
- 新目录成为唯一长期维护结构

---

# 7. 推荐 PR 拆分方式

为避免“大爆炸式重构”，建议至少拆为以下 PR 批次：

1. **PR-1：CSR + apiBase + unified client + time helpers**
2. **PR-2：theme token + CSS vars + Naive/Tailwind sync**
3. **PR-3：new shell scaffold + page skeleton**
4. **PR-4：polling framework + runtime/shell/notifications stores**
5. **PR-5：route-state composables + navigation helpers**
6. **PR-6：overview + workflow first delivery**
7. **PR-7：graph feature migration**
8. **PR-8：social + agents + timeline**
9. **PR-9：legacy cleanup + core store tests**

---

# 8. 风险控制与回退策略

## 风险 1：新壳层先搭好，但页面内容空心
- **控制方式**：新壳层阶段允许旧页面/旧组件临时挂载，不要求一步到位

## 风险 2：Graph 重构过重，拖慢整体进度
- **控制方式**：先 Overview + Workflow，再 Graph；Graph 单独成批次

## 风险 3：主题系统和组件库颜色分裂
- **控制方式**：坚持 token 单一真源，禁止后续散落硬编码颜色

## 风险 4：轮询在组件层失控
- **控制方式**：所有轮询统一经 `useVisibilityPolling`，review 时禁止私建 interval

## 风险 5：URL 状态混入纯 UI 临时态
- **控制方式**：业务定位态 only；临时态一律停留在 feature store / local state

---

# 9. 最终验收边界

当以下条件同时满足时，可认为本轮目录重构落地完成：

- `apps/web` 已明确运行在 CSR 下
- API base URL、主题 token、统一 client、时间 string-first 规则稳定
- 新 Operator shell 已替代旧三栏壳层
- Overview / Workflow / Graph / Social / Agent / Timeline 页面结构成型
- Graph feature 已完全内聚，旧 `L2Graph.vue` 退出主线
- Route-state 与 drill-down 规则落地
- runtime / shell / workflow / graph 核心 Store 单测已补齐
- 旧 `clock.ts` / `system.ts` / `utils/api.ts` 等遗留已迁出或清理

---

# 10. 一句话执行原则

> 先稳住基线，再搭壳层；先交付 Overview/Workflow，再攻 Graph；新结构可以短期包旧内容，但不允许新旧双系统长期并存。
