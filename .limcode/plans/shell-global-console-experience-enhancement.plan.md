## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 评估现有 Shell / runtime / notifications / dock / sidebar 基线与约束，冻结增强范围  `#shell-console-1`
- [x] 设计 Phase S1：TopRuntimeBar 与 notifications / dock 的全局状态与反馈增强  `#shell-console-2`
- [x] 设计 Phase S2：WorkspaceSidebar 上下文层与 shell context 聚合模型  `#shell-console-3`
- [x] 设计 Phase S3：全局操作层（recent targets / quick actions / pinned focus）及后续演进路径  `#shell-console-4`
- [x] 制定分阶段实施顺序、文件改动清单、测试与验收标准，形成可跟踪执行计划  `#shell-console-5`
<!-- LIMCODE_TODO_LIST_END -->

# Shell 全局控制台体验增强执行计划

> 目标：将 `apps/web` 当前的 Shell 从“页面导航壳”升级为“全局状态感知、全局操作入口、全局反馈回看与控制台层”，并确保实施过程具有可持续的进度跟踪能力。

## TODO LIST 使用方式

本计划采用可跟踪执行方式：

- 本文档顶部 TODO 只保留**当前阶段核心任务**
- 每完成一个阶段后，需同步更新：
  - 本计划文档中的 TODO 状态
  - 根目录 `TODO.md`（如影响正式里程碑状态）
  - 必要时 `记录.md` 中的验证结论
- 若实施中需要拆出子任务，应在当前对话 TODO 中继续细分，而不要把正式计划文档膨胀成开发日志

---

# 1. 当前评估

## 1.1 当前 Shell 已有能力

当前 Shell 已具备以下基础：

### 结构层
- `AppShell.vue` 已形成三段式工作台结构：
  - `ActivityRail`
  - `WorkspaceSidebar`
  - `TopRuntimeBar`
  - `BottomDock`
  - 中间主工作区容器

### 全局数据层
- `useOperatorBootstrap()` 已在 `app.vue` 启动
- 已有三条 polling：
  - clock
  - runtime status
  - notifications
- `runtime` store 已维护：
  - tick / calendars
  - world pack
  - health level
  - runtime speed
  - sync/error 状态
- `notifications` store 已维护：
  - remoteItems
  - localItems
  - unreadCount
  - latestItems

### 壳层状态层
- `shell` store 已维护：
  - `activeWorkspaceId`
  - `activeDockTabId`
  - `isDockExpanded`

---

## 1.2 当前 Shell 主要短板

### A. `AppShell` 仍偏“占位壳”
- `WorkspaceSidebar` 中仍以 placeholder 内容为主
- `BottomDock` 的 traces/jobs 区域仍是 placeholder
- Shell 尚未形成统一的“全局操作层”

### B. `TopRuntimeBar` 信息量不足
当前仅显示：
- runtime 状态
- world pack
- 时间刻度
- runtime speed

缺少：
- freshness
- clock/status/notifications 全局同步状态
- 全局 refresh 入口
- dock toggle
- 更明确的 degraded / unavailable explainers

### C. 通知系统尚未形成“通知中心”
当前通知有：
- toast bridge
- store
- dock 简单列表

但还缺：
- level 聚合
- 来源分类
- 更好的时间/状态展示
- 清理动作
- 与 shell/dock 的深度联动

### D. Sidebar 尚未承担“上下文层”职责
当前缺少：
- 当前 source context
- 当前焦点对象
- shell 级快捷操作
- operator 当前关注面摘要

### E. Dock 尚未承担“回看层”职责
当前缺少：
- 最近查看的 job / trace / notifications
- 当前焦点对象回看
- workspace 级最近对象与可恢复上下文

---

# 2. 总体目标

Shell 升级后的职责分成三层：

## 2.1 全局状态层
回答：
- 系统当前是否健康
- 当前是否在同步
- 当前 world pack / tick / runtime speed 是什么
- 是否存在关键通知或错误

## 2.2 全局操作层
回答：
- operator 现在能做什么
- 如何快速刷新、切换、回跳、展开控制面板
- 如何快速回到高价值工作区/对象

## 2.3 全局回看层
回答：
- 最近发生了什么
- 最近看过哪些对象
- 最近哪些 workflow / trace / notifications 值得继续查看
- 当前上下文链路如何恢复

---

# 3. 实施原则 / Guardrails

## 3.1 保持 CSR
- 不因为 shell polish 引入 SSR 语义回退

## 3.2 Shell 只消费统一上下文模型
- 不把每个页面的大量细节状态直接塞进 `AppShell`
- 推荐通过统一聚合层暴露 shell 需要的数据

## 3.3 通知保持“高价值反馈”原则
- 不制造 polling 噪音
- toast 仅提示关键成功/失败
- dock / center 用于回看与管理

## 3.4 URL 仍只保存业务定位与来源语义
- 不把纯临时 UI 状态写满 query

## 3.5 分阶段演进，不一次性重做 shell
- 优先做高价值、低风险增强
- 先补状态与反馈，再补上下文与操作层

---

# 4. 分阶段执行方案

# Phase S1 — Runtime / Notifications / Dock 基础增强

> 目标：让 Shell 真正具备全局状态感知与全局反馈能力。

## 4.1 TopRuntimeBar 增强

### 目标
把顶部状态条升级成控制台顶部栏，而不是单纯的 runtime 展示条。

### 增强项
- 展示 runtime freshness / sync 状态
- 展示 clock sync / status sync / notifications sync 概况
- 展示 notifications 聚合信息：
  - errorCount
  - warningCount
  - unreadCount
- 增加全局动作：
  - refresh all
  - dock toggle
- 更明确的 health level / degraded / unavailable 提示

### 计划涉及文件
- `apps/web/features/shell/components/TopRuntimeBar.vue`
- `apps/web/composables/app/useOperatorBootstrap.ts`
- `apps/web/stores/runtime.ts`
- `apps/web/stores/notifications.ts`
- `apps/web/stores/shell.ts`

### 实施结果（已完成）
- `runtime` store 已新增：
  - `clockFreshnessLabel`
  - `statusFreshnessLabel`
  - `isAnySyncing`
  - `hasDegradedSignals`
- `notifications` store 已新增：
  - `errorCount`
  - `warningCount`
  - `infoCount`
  - `latestError`
  - `latestWarnings`
- `TopRuntimeBar` 已接入：
  - runtime freshness / sync 摘要
  - notifications 聚合摘要
  - `refresh all`
  - `dock toggle`

### 验收结果
- 顶栏可一眼识别当前运行状态与风险
- 顶栏支持全局刷新与 dock 开关
- 不进入具体页面也能读到控制台级全局状态

---

## 4.2 Notifications Dock 升级

### 目标
把当前底部 notifications 区域提升为最小“通知中心”。

### 增强项
- notifications tab 中按 level 更清晰展示
- 显示 code / timestamp / details 摘要
- 增加清理动作：
  - clear local
  - clear all（若适用）
- 可选：为本地通知增加 `source` 字段，供未来跳转使用

### 计划涉及文件
- `apps/web/features/shell/components/BottomDock.vue`
- `apps/web/stores/notifications.ts`
- `apps/web/features/shared/components/AppNotificationsBridge.vue`
- `apps/web/composables/api/useSystemApi.ts`（若接 clear remote）

### 当前状态
- notifications 聚合逻辑已完成 store 侧增强
- notifications dock 仍是“最小通知中心版”，尚未加入 code/detail/clear 动作深化

---

## 4.3 AppShell Dock 与全局状态联动

### 目标
让 shell 顶栏、底栏、通知、runtime 三者形成统一闭环。

### 增强项
- `TopRuntimeBar` 的 refresh all 调用 `useOperatorBootstrap().refreshAll`
- `BottomDock` 与 `shell.isDockExpanded` 联动
- notifications 数量在 dock tab 上有明确反馈

### 计划涉及文件
- `apps/web/features/shell/components/AppShell.vue`
- `apps/web/features/shell/components/TopRuntimeBar.vue`
- `apps/web/features/shell/components/BottomDock.vue`
- `apps/web/stores/shell.ts`

### 实施结果（已完成）
- `BottomDock` 已接入 `shell.isDockExpanded`
- `TopRuntimeBar` 的 dock toggle 已可直接控制底栏显隐
- `notifications.unreadCount` 已在 dock 与顶栏协同展示

---

# Phase S2 — Sidebar 上下文层与 Shell Context 聚合

> 目标：让 Sidebar 成为“当前上下文层”，而不是仅放占位内容。

## 5.1 引入统一 shell context 聚合层

### 目标
避免 Shell 直接耦合各页面内部实现细节。

### 建议新增
- `apps/web/features/shell/composables/useShellContext.ts`

### 输出模型建议
- `workspaceId`
- `workspaceTitle`
- `workspaceSubtitle`
- `sourceSummary`
- `focusEntity`
- `focusMeta`
- `quickActions`

### 实施结果（已完成）
当前 `useShellContext.ts` 已提供：
- `workspaceTitle`
- `workspaceSubtitle`
- `sourceSummary`
- `focusLabel`
- `focusMeta`
- `quickActions`
- `recentTargets`

同时已导出用于测试的纯函数：
- `resolveShellFocusLabel`
- `resolveShellFocusMeta`
- `buildShellQuickActions`

---

## 5.2 WorkspaceSidebar 升级为 Operator Context Sidebar

### 目标
让 Sidebar 持续回答：
- 我现在在哪个工作区
- 我当前看的是谁/什么
- 我是从哪来的
- 我还能马上做什么

### 区块设计建议
#### A. Current Workspace
- 当前 workspace title
- 简短 subtitle

#### B. Source / Context
- 当前 source banner 的简化版摘要
- 例如：opened from overview scheduler run / graph node / social post

#### C. Focus Entity
按 workspace 提炼：
- workflow: 当前 job / trace / intent
- graph: root / selected node
- social: selected post
- timeline: selected event
- agent: current agent id/name

#### D. Quick Actions
- refresh current workspace
- return to source
- open notifications dock
- go to overview

#### E. Recent Targets
- 最近查看 workflow jobs
- 最近 agent
- 最近 graph roots / social posts

### 实施结果（已完成）
`AppShell.vue` 中的 Sidebar slot 已替换为真实内容区块：
- Current Workspace
- Source / Context
- Focus Entity
- Quick Actions
- Recent Targets
- Runtime Sync

Sidebar 已脱离 placeholder 状态，进入“最小上下文侧栏”形态。

---

# Phase S3 — 全局操作层与最近目标 / 快捷动作

> 目标：让 Shell 成为真正的全局操作控制台。

## 6.1 Recent Targets / Focus Memory

### 目标
让用户在多工作区操作时，不轻易丢失上下文。

### 可纳入能力
- 最近查看 workflow jobs
- 最近 agent
- 最近 graph roots / selected nodes
- 最近 notifications 关联对象

### 存储方式建议
先用 `shell` store 本地维护轻量列表，不急于做持久化。

### 实施结果（已完成第一轮基线）
- `shell` store 已新增：
  - `recentTargets`
  - `recordRecentTarget()`
- 当前自动记录来源已覆盖：
  - workflow `job_id`
  - social `post_id`
  - graph `root_id`
  - agent route `:id`
- Sidebar 已展示 `Recent Targets`
- BottomDock 的 `jobs / traces` tab 已开始消费 recent targets，不再是纯 placeholder

---

## 6.2 Quick Actions / Global Commands

### 目标
提供少量高频全局操作入口。

### 第一批建议动作
- refresh all
- return to source
- toggle dock
- clear notifications
- jump to overview

### 实施结果（已完成第一轮基线）
当前已落地：
- `go_overview`
- `return_to_source`
- `open_notifications`
- `refresh all`
- `dock toggle`

其中 `return_to_source` 已在 shell 级别可执行，支持：
- social
- timeline
- graph
- agent
- workflow
- overview

---

# 7. 推荐实施顺序

## Sprint S1-A
### 先做 TopRuntimeBar + runtime/notifications getters
1. 扩展 runtime store getters
2. 扩展 notifications store getters
3. 改 `TopRuntimeBar.vue`
4. 接 `refreshAll` 与 dock toggle

**状态：已完成**

## Sprint S1-B
### 再做 notifications dock 最小通知中心
1. 改 notifications store
2. 改 `BottomDock.vue`
3. 改 `AppShell.vue`
4. 可接 clear 行为

**状态：已完成最小版，后续仍可继续增强 details / clear 行为**

## Sprint S2
### 做 Sidebar context 聚合层
1. 新增 `useShellContext.ts`
2. 改 `WorkspaceSidebar.vue` / `AppShell.vue`
3. 用统一 view model 驱动 Sidebar

**状态：已完成第一轮基线**

## Sprint S3
### 最后做 recent targets / quick actions
1. 扩展 shell store
2. 新增 recent targets 聚合
3. 接入 quick actions UI

**状态：已完成第一轮基线**

---

# 8. 文件改动清单

## 已改动（本轮已落地）
- `apps/web/features/shell/components/TopRuntimeBar.vue`
- `apps/web/features/shell/components/AppShell.vue`
- `apps/web/stores/runtime.ts`
- `apps/web/stores/notifications.ts`
- `apps/web/stores/shell.ts`
- `apps/web/composables/app/useOperatorBootstrap.ts`
- `apps/web/features/shell/composables/useShellContext.ts`
- `apps/web/tests/unit/runtime.store.spec.ts`
- `apps/web/tests/unit/notifications.store.spec.ts`
- `apps/web/tests/unit/shell.store.spec.ts`
- `apps/web/tests/unit/shell.context.spec.ts`

## 后续可继续增强
- `apps/web/features/shell/components/BottomDock.vue`
- `apps/web/features/shared/components/AppNotificationsBridge.vue`
- `apps/web/composables/api/useSystemApi.ts`
- 可选新增：`apps/web/features/shell/composables/useRecentTargets.ts`

---

# 9. 测试与质量门禁

## 已补充测试
- `tests/unit/runtime.store.spec.ts`
- `tests/unit/notifications.store.spec.ts`
- `tests/unit/shell.store.spec.ts`
- `tests/unit/shell.context.spec.ts`

## 固定质量门禁

```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test:unit
```

---

# 10. 风险与控制

## 风险 1：Shell 过度耦合各 feature 页面
### 控制
- 已引入 `useShellContext` 统一抽象层
- Shell 优先消费聚合 view model，而不是直接散读 feature composables

## 风险 2：通知系统膨胀成杂乱事件桶
### 控制
- 当前仅完成 level 聚合与最小 dock 消费
- 尚未引入复杂事件总线，后续继续保持渐进增强

## 风险 3：一次性做太多导致注意力漂移
### 控制
- 本轮已按 S1 → S2 → S3 最小步方式推进
- 当前可先进入质量收口，再决定是否继续增强 dock / command palette

## 风险 4：Shell UI 增强影响当前页面可用性
### 控制
- 本轮未大改具体业务页面主逻辑
- 增强主要集中在 shell/runtime/notification/store 层

---

# 11. 完成定义

当以下条件同时满足时，可认为 Shell 全局控制台体验增强第一轮完成：

1. `TopRuntimeBar` 具备全局 runtime / notifications 状态感知与基础动作能力
2. `BottomDock` 的 notifications 已形成最小通知中心体验
3. `WorkspaceSidebar` 已从 placeholder 升级为上下文侧栏
4. Shell 具备最小的全局 refresh / dock toggle / source-aware quick actions
5. `recentTargets` 已形成最小回看层，并被 Sidebar / Dock 复用
6. 不破坏现有工作区页面功能与 scheduler/operator drill-down 语义
7. `typecheck / lint / test:unit` 通过

---

# 12. 本轮结论

Shell 全局控制台体验增强第一轮已完成最小可用基线，当前已完成：

- 全局状态层：TopRuntimeBar + runtime/notifications 聚合
- 上下文层：ShellContext + Sidebar context 区块
- 操作层：refresh / dock toggle / return to source / open notifications / go overview
- 回看层：recent targets + BottomDock jobs/traces 最小真实内容
- 测试层：runtime / notifications / shell / shell context 单测补齐

下一步如继续增强，建议优先考虑：

1. 继续深化 `BottomDock` 的 jobs / traces 数据模型，而不是 placeholder-like recent targets
2. 增强 notifications center（code/details/clear actions）
3. 评估是否引入 `useRecentTargets.ts` 或 command palette
