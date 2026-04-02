## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 梳理当前壳层布局问题、目标结构与受影响文件范围  `#analyze-shell-rebuild-scope`
- [ ] 定义新的 shell DOM 层次、滚动责任边界与层级规则  `#define-target-shell-architecture`
- [ ] 统一 html/body/#__nuxt 与 shell 内滚动容器的高度/溢出模型  `#normalize-scroll-and-height-model`
- [ ] 收口 dock 覆盖、顶栏可见性、侧栏占位和超宽/缩放场景体验  `#polish-responsive-and-overlay-behavior`
- [ ] 重构 AppShell、TopRuntimeBar、WorkspaceSidebar、BottomDock 的职责与组合方式  `#refactor-shell-component-boundaries`
- [ ] 修复 AppShell 相关组件显式导入与 readonly props 类型不匹配问题  `#resolve-component-typing-and-registration`
- [ ] 验证 overview / agents / graph / workflow 等页面在新壳层下的显示与滚动行为  `#validate-core-routes`
<!-- LIMCODE_TODO_LIST_END -->

# Frontend Shell Layout Rebuild Plan

## 1. 背景与当前问题

当前 `apps/web` 的 Operator 壳层已经具备：
- 左侧活动导航（ActivityRail）
- 工作区侧栏（WorkspaceSidebar）
- 顶部状态栏（TopRuntimeBar）
- 底部 Dock（BottomDock）
- 各工作区页面（overview / workflow / graph / agents / social / timeline）

但经过连续联调后，现有壳层布局暴露出结构性问题，说明继续通过局部 patch（overflow、negative margin、z-index 微调）已经不够，需要一次明确的重构。

### 当前主要症状
1. 滚动责任边界不稳定：有时是 `body` 滚，有时是 `main` 滚。
2. 左侧栏、主内容区、顶栏、底部 Dock 的关系依赖临时样式修补。
3. BottomDock 的覆盖语义不清晰：它既像普通文档流元素，又希望承担全局 overlay 的职责。
4. TopRuntimeBar 在不同版本布局中可能被挤掉、被滚动区吞没或缺少清晰的固定存在感。
5. `AppShell.vue` 体量过大，同时承担布局、导航、recent targets、dock 内容组装等多重职责，导致结构脆弱。
6. 当前存在类型问题：只读数组传入可变 props、dock tab emit 类型不够严格。
7. Nuxt 自动组件解析不稳定，至少 `AppShell` 已被证明需要显式导入，说明壳层组件注册策略也应一并收口。

---

## 2. 重构目标

本轮重构的核心目标不是“继续修某个页面”，而是建立一个稳定的 **Operator Shell Layout Contract**。

### 目标布局原则
1. **视口固定壳层**
   - `html / body / #__nuxt` 不承担业务滚动。
   - 整个应用固定在视口内。

2. **滚动责任唯一化**
   - 主工作区内容滚动只由专门的 scroll area 承担。
   - 左侧活动栏和工作区侧栏默认不跟随主内容滚动。
   - 如侧栏内容过长，侧栏内部自行滚动。

3. **层级规则明确化**
   - TopRuntimeBar 是主工作区顶部固定层。
   - BottomDock 是壳层底部覆盖层，不是普通文档流块。
   - BottomDock 的层级高于主内容，必要时也可压住 WorkspaceSidebar 的底部区域。

4. **结构职责分离**
   - `AppShell` 只负责骨架编排与状态连接。
   - 侧栏面板内容、dock 内容、主内容容器、overlay 行为应尽量拆分。

5. **跨页面一致性**
   - `/overview`、`/agents`、`/graph`、`/workflow` 等都遵守同一壳层约定。

---

## 3. 目标 DOM / 布局架构

建议将壳层重构为如下层次：

```text
ShellViewport
├── ShellBody
│   ├── ActivityRail
│   ├── WorkspaceSidebarColumn
│   │   └── WorkspaceSidebar
│   └── WorkspaceMain
│       ├── TopRuntimeBar
│       └── WorkspaceScrollArea
│           └── <NuxtPage />
└── ShellDockOverlay
    └── BottomDock
```

### 结构解释

#### ShellViewport
- 占满整个视口。
- `overflow: hidden`。
- 作为所有壳层层级的根容器。

#### ShellBody
- 横向三列布局。
- 左两列为固定宽度：ActivityRail + WorkspaceSidebar。
- 右侧 `WorkspaceMain` 为弹性列。

#### WorkspaceMain
- 自身不滚动。
- 内部由 `TopRuntimeBar` + `WorkspaceScrollArea` 组成。
- `WorkspaceScrollArea` 是主滚动容器。

#### ShellDockOverlay
- 作为 `ShellViewport` 的直接子节点，而不是 `WorkspaceMain` 的普通子元素。
- 定位在底部，拥有高于 sidebar / main 的层级。
- 可以通过左内边距、宽度计算或 CSS grid 对齐到期望视觉位置。

---

## 4. 组件职责重划分

### 4.1 `AppShell.vue`
重构后职责：
- 连接 store / route / shell context
- 组合骨架组件
- 把数据分别传递给 rail / sidebar / topbar / dock
- 不再承担过多具体展示细节

应避免：
- 在 `AppShell` 内塞入大段侧栏卡片 DOM
- 在 `AppShell` 中用负 margin 硬顶布局
- 让 Dock 内容和骨架结构强耦合

### 4.2 `WorkspaceSidebar.vue`
重构后职责：
- 只负责“侧栏列”的视觉容器
- 接收 header 信息与默认 slot
- 在自身内部处理滚动

### 4.3 `TopRuntimeBar.vue`
重构后职责：
- 独立顶部固定条
- 高度固定或最小高度稳定
- 不依赖页面内容高度

### 4.4 `BottomDock.vue`
重构后职责：
- 明确作为 overlay dock
- 仅处理 dock tabs + dock body + 内部视觉
- 不依赖文档流位置来决定自己是否覆盖 sidebar

### 4.5 可新增的辅助组件（建议）
如果实现过程中 `AppShell` 仍然太重，可以引入：
- `ShellSidebarPanels.vue`：承载 current workspace / source / focus / actions / targets / runtime sync
- `ShellDockContent.vue`：承载 traces / jobs / notifications 三类 dock 内容
- `ShellViewport.vue`（可选）：把壳层根视口与 overlay 逻辑进一步抽离

---

## 5. 关键技术改动点

### 5.1 高度与滚动模型
目标：
- `html, body, #__nuxt` 固定 100% 高度
- `body` 不滚动
- `ShellViewport` 使用 `h-screen` / `overflow-hidden`
- `WorkspaceScrollArea` 使用 `overflow-auto`
- `WorkspaceSidebar` 内部使用自己的 `overflow-y-auto`

### 5.2 Dock Overlay 定位策略
推荐优先选择其中一种稳定实现：

#### 方案 A：absolute/fixed overlay（推荐）
- `ShellDockOverlay` 绝对定位在壳层底部
- 通过 `left` 或 `padding-left` 对齐到 rail + sidebar 之后，或故意向左覆盖 sidebar
- 主内容滚动容器额外预留 dock 高度 padding-bottom

#### 方案 B：CSS grid + overlay row
- 整个 shell 使用 grid
- dock 独立占底部行，并通过 grid layer 覆盖到主内容和 sidebar 上方
- 结构稍复杂，但语义更清晰

当前更建议先落地 **方案 A**，因为实现成本更低，且足以达成“覆盖层”语义。

### 5.3 顶栏固定策略
- TopRuntimeBar 固定放在 `WorkspaceMain` 顶部
- 不参与主内容滚动
- 必须有稳定高度与 `shrink-0`
- 主滚动区高度 = `WorkspaceMain` 减去 topbar 高度 和 dock 预留空间

### 5.4 类型与组件注册修复
当前诊断中已有：
- `activityItems` 是 readonly 数组，不能赋给可变 props
- `dockTabs` 同理
- Dock emit 参数类型过宽

本轮需要同步修复：
- 将 `ActivityRail.vue` props 类型改为 `ReadonlyArray<ActivityRailItem>`
- 将 `BottomDock.vue` props 类型改为 `ReadonlyArray<DockTab>`
- `emit('select', ...)` 与 `DockTabId` 对齐
- 保持壳层关键组件使用显式 import，避免依赖不稳定的自动注册

---

## 6. 受影响文件

### 核心必改
- `apps/web/features/shell/components/AppShell.vue`
- `apps/web/features/shell/components/TopRuntimeBar.vue`
- `apps/web/features/shell/components/WorkspaceSidebar.vue`
- `apps/web/features/shell/components/BottomDock.vue`
- `apps/web/features/shell/components/ActivityRail.vue`
- `apps/web/assets/css/base.css`
- `apps/web/layouts/default.vue`

### 可能需要调整
- `apps/web/stores/shell.ts`
- `apps/web/features/shell/composables/useShellContext.ts`
- `apps/web/pages/overview.vue`
- `apps/web/pages/agents/index.vue`
- `apps/web/pages/agents/[id].vue`
- `apps/web/pages/graph.vue`
- `apps/web/pages/workflow.vue`

### 测试相关
- `apps/web/tests/unit/shell.context.spec.ts`
- `apps/web/tests/unit/shell.store.spec.ts`
- 如新增结构性约束，可补一个 shell layout 相关测试或快照测试

---

## 7. 实施阶段

### Phase 1：冻结当前目标与约束
- 确认壳层最终视觉语义：
  - 左栏固定
  - 顶栏固定
  - 主内容独立滚动
  - dock 为覆盖层
- 确认 dock 是否覆盖到 ActivityRail，还是只覆盖 WorkspaceSidebar + Main
- 确认小屏时是否暂不处理响应式折叠

### Phase 2：重建壳层 DOM 骨架
- 重构 `AppShell.vue`
- 建立 `ShellViewport / ShellBody / WorkspaceMain / ShellDockOverlay` 的明确结构
- 清理临时负 margin / 临时 z-index 补丁

### Phase 3：统一滚动模型
- 固定 `html/body/#__nuxt`
- 收口 scroll area 到 `WorkspaceScrollArea`
- 为 dock overlay 留出内容底部安全区域

### Phase 4：收口组件职责与类型
- 修 props readonly 类型
- 修 dock emit 类型
- 显式导入壳层关键组件
- 如需要，拆出 `ShellSidebarPanels` / `ShellDockContent`

### Phase 5：跨页面验证
- 验证 overview
- 验证 agents 列表页 / detail 页
- 验证 graph / workflow
- 看是否存在页面本身 `min-h-full` / `overflow-hidden` 抢夺滚动的问题

### Phase 6：体验 polish
- dock blur / border / overlay shadow
- topbar 与主内容分隔
- sidebar 内部滚动条样式
- 超宽屏和高缩放场景检查

---

## 8. 验收标准

### 视觉与交互验收
1. 左侧 ActivityRail 始终固定在视口左侧。
2. WorkspaceSidebar 始终固定在 rail 右侧，不跟随主内容滚动。
3. TopRuntimeBar 在各主要页面都稳定可见。
4. 主内容区滚动时，仅中间工作区内容滚动。
5. BottomDock 作为覆盖层显示，不再表现为普通文档流块。
6. BottomDock 层级高于主内容，且在约定范围内覆盖 Sidebar。
7. 页面在 80%、50%、30% 缩放下仍保持基本结构稳定。

### 工程验收
1. `pnpm --filter web test:unit` 通过。
2. `pnpm --filter web typecheck` 通过或无新增错误。
3. 当前 `AppShell.vue` 的布局逻辑显著简化，减少临时 patch。
4. 不再依赖 Nuxt 自动组件解析来保证壳层核心组件渲染。

---

## 9. 风险与注意事项

1. **Dock overlay 与页面底部可点击区域冲突**
   - 需要给主内容区预留足够的底部 padding，避免内容被 dock 挡住。

2. **Graph / Workflow 页面已有复杂内部滚动容器**
   - 重构后要特别检查是否发生“双滚动条”。

3. **Sidebar 与 Dock 覆盖边界不清**
   - 需要在计划实施前明确“Dock 到底覆盖哪几列”。

4. **壳层组件的自动导入不稳定**
   - 应优先显式 import，而不是继续赌自动注册行为。

5. **当前 AppShell 文件较大**
   - 重构时不要只改 class，应顺手把结构职责一起拆清楚，否则后续仍会回到 patch 状态。

---

## 10. 建议执行策略

建议采用：
- 先出计划并冻结目标
- 再做一次完整结构重构
- 最后统一验证 overview / agents / graph / workflow

不建议继续通过小幅 CSS patch 迭代，因为当前问题已经是结构层面的，而不是单点样式问题。
