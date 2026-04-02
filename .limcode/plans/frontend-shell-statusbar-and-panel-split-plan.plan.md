## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 梳理“小底栏 + 隐藏大面板 + 设置入口”方向的增量重构范围  `#analyze-statusbar-direction`
- [ ] 将当前 BottomDock 降级为默认隐藏的未来大面板，明确其触发方式与保留用途  `#demote-bottom-dock-to-optional-panel`
- [ ] 定义轻量 StatusBar 的信息层级、布局结构、交互入口与高度约束  `#design-statusbar-contract`
- [ ] 冻结 ActivityRail 底部入口从头像切换为设置入口的交互语义与信息架构  `#freeze-shell-navigation-footer-direction`
- [ ] 在 ActivityRail 中引入设置入口，并为未来设置弹窗/账户信息面板预留容器  `#introduce-settings-entry-and-surface`
- [ ] 调整 AppShell 结构，使 TopRuntimeBar、WorkspaceScrollArea、StatusBar、Optional BottomPanel 分层清晰  `#refactor-shell-layout-for-statusbar`
- [ ] 验证 overview / workflow / graph / agents 页面在新底栏与隐藏大面板语义下的视觉层次和工作流体验  `#validate-visual-hierarchy-and-workflows`
<!-- LIMCODE_TODO_LIST_END -->

# Frontend Shell StatusBar & Optional Panel Increment Plan

## 1. 背景

在当前一轮壳层重构之后，Operator Shell 已经基本建立了：
- 固定 ActivityRail
- 固定 WorkspaceSidebar
- 固定 TopRuntimeBar
- 主内容独立滚动
- 底部 Overlay Dock

但经过页面对照与产品意图澄清后，发现当前底部区域的语义仍然不对：

1. **ActivityRail 左下角的固定头像设计是错误抽象**
   - 这个位置更适合承载设置、偏好或系统入口。
   - 头像/账户信息不应该长期占据一个固定槽位。
   - 头像更适合出现在设置弹窗、账户面板或 profile surface 中。

2. **当前 BottomDock 过高，更像 VS Code 的终端/输出面板，而不是常驻底栏**
   - 这类大面板适合未来承接 jobs / traces / notifications detail / terminal-like console。
   - 但它不适合作为当前默认常驻底部结构。

3. **当前缺少一个真正的轻量状态底栏（StatusBar）**
   - 需要一个类似 VS Code 的低高度常驻底栏，用于展示关键信息、提供快捷入口，而不是展示大量内容。

因此，本次增量重构的目标不是再继续打磨现有高底栏，而是要把底部系统拆成：

- **常驻轻量 StatusBar**
- **默认隐藏的 Optional Bottom Panel（未来大面板）**

---

## 2. 重构目标

### 2.1 ActivityRail 底部职责修正
将当前底部头像槽位替换为：
- 设置入口（gear / preferences / more）
- 未来可扩展为：
  - 设置
  - 用户资料
  - 主题
  - 关于
  - 快捷命令入口

头像信息不再作为固定 UI 元素存在，而是收纳到设置面板或账户 surface 中。

### 2.2 引入真正的轻量 StatusBar
新增一个常驻底栏，具备：
- 更低高度（接近 VS Code status bar）
- 更明确的信息压缩能力
- 快捷打开可选大面板的入口
- 快捷显示 runtime/notifications/sync 等摘要

### 2.3 将当前 BottomDock 降级为未来大面板
保留现有 Dock 的信息组织能力，但语义改为：
- 未来可选大面板
- 默认隐藏
- 只在用户主动打开时显示
- 可承接 jobs / traces / notifications detail / terminal / logs / output / debug 等

### 2.4 明确壳层信息层级
新的壳层信息层级应为：
1. **TopRuntimeBar**：全局高优先级状态与关键操作
2. **Workspace content**：当前业务工作区
3. **StatusBar**：轻量摘要 + 快捷入口
4. **Optional Bottom Panel**：重信息密度的展开区（默认隐藏）

---

## 3. 目标结构

建议新的 shell 结构演进为：

```text
ShellViewport
├── ShellBody
│   ├── ActivityRail
│   ├── WorkspaceSidebar
│   └── WorkspaceMain
│       ├── TopRuntimeBar
│       ├── WorkspaceScrollArea
│       └── StatusBar
└── OptionalBottomPanel (hidden by default)
```

### 结构解释

#### ActivityRail
- 顶部：工作区切换入口
- 底部：设置入口（替代头像）

#### WorkspaceMain
- TopRuntimeBar：主要状态与刷新/主操作
- WorkspaceScrollArea：业务内容滚动区
- StatusBar：轻量常驻底栏

#### OptionalBottomPanel
- 不是常驻底栏
- 是未来大面板
- 默认隐藏
- 打开后浮在内容与底栏上方，或占据底部附加区域

---

## 4. 新的信息架构建议

### 4.1 TopRuntimeBar 放什么
保持高价值、低频但关键的信息：
- runtime readiness
- world pack / time scale
- refresh all
- notifications summary（可保留简版）
- 显示/隐藏大面板的动作入口（若保留）

### 4.2 StatusBar 放什么
StatusBar 应只保留压缩信息与快捷入口，例如：

#### 左侧
- 当前 workspace 简写 / label
- 设置入口提示（可选）
- 当前 source context 简写（可选）

#### 中间
- 可留空，或显示轻量 hint
- 比如当前 focus、filter mode、selection hint

#### 右侧
- notifications count
- sync status
- tick / clock freshness
- 打开大面板的入口（Jobs / Traces / Notifications / Console）

### 4.3 Optional Bottom Panel 放什么
当前 `BottomDock` 里的内容适合迁移为：
- jobs panel
- traces panel
- notifications detail panel
- 未来 terminal / logs / output / debug panel

也就是说，这一层的内容组织逻辑可以基本保留，但默认不应展开。

---

## 5. 关键交互决策

### 5.1 设置入口
需要先冻结设置入口的最小语义：
- 先做一个按钮即可（gear icon / text label）
- 点击后先打开一个轻量菜单/占位弹层
- 弹层中未来可承接：
  - 头像
  - 账户信息
  - 主题
  - 偏好设置
  - 关于 / 版本信息

### 5.2 大面板默认状态
建议：
- 默认隐藏
- 用户显式点击 StatusBar 中的入口时才展开
- 展开后可保留 tabs（TR / JB / NT）
- 若未来确定不需要，可直接隐藏整套面板而不影响主布局

### 5.3 StatusBar 的交互密度
StatusBar 要避免再次长成“迷你 Dock”。
因此应约束：
- 固定较低高度
- 摘要优先
- 不承载多行内容
- 不直接承载大型卡片/列表

---

## 6. 组件与文件调整建议

### 核心新增组件（建议）
- `apps/web/features/shell/components/StatusBar.vue`
- `apps/web/features/shell/components/ShellSettingsTrigger.vue`（可选）
- `apps/web/features/shell/components/ShellSettingsMenu.vue`（可选，占位即可）

### 核心修改组件
- `apps/web/features/shell/components/AppShell.vue`
- `apps/web/features/shell/components/ActivityRail.vue`
- `apps/web/features/shell/components/BottomDock.vue`
- `apps/web/features/shell/components/TopRuntimeBar.vue`
- `apps/web/stores/shell.ts`

### 可能涉及的共享逻辑
- `apps/web/features/shell/composables/useShellContext.ts`
- `apps/web/stores/notifications.ts`
- `apps/web/stores/runtime.ts`

---

## 7. 实施阶段

### Phase 1：冻结方向
- 确认 ActivityRail 底部不再显示头像
- 确认设置入口最低可用交互
- 确认当前高底栏改为默认隐藏的大面板
- 确认 StatusBar 的最低信息集合

### Phase 2：引入 StatusBar
- 新建 `StatusBar.vue`
- 放入 `WorkspaceMain` 底部
- 调整 `WorkspaceScrollArea` 高度与底部留白策略
- 保证 StatusBar 常驻但低高度

### Phase 3：降级 BottomDock 为 Optional Bottom Panel
- 让当前大底栏默认隐藏
- 从“常驻 UI”改为“按需展开面板”
- 与 StatusBar 建立触发关系

### Phase 4：替换 ActivityRail 底部入口
- 移除固定头像位
- 换成 settings 入口
- 先实现最小占位弹层或菜单
- 为后续 profile/settings surface 预留扩展接口

### Phase 5：视觉收口
- StatusBar 高度、边框、对比度
- 大面板打开/关闭动效（可选）
- 侧栏与底栏的层次关系
- overview / workflow / agents / graph 页面截图验证

---

## 8. 验收标准

### 视觉与产品语义验收
1. ActivityRail 左下角不再显示固定头像。
2. ActivityRail 底部改为设置入口，符合系统级入口语义。
3. StatusBar 成为常驻底部轻量栏，高度显著低于当前 Dock。
4. 当前高底栏不再作为默认常驻结构存在。
5. 可选大面板仅在用户主动触发时展开。
6. Top bar / main content / status bar / optional panel 的层级清晰，不互相抢占语义。

### 工程验收
1. `AppShell` 结构进一步简化，信息层级更清晰。
2. `pnpm --filter web test:unit` 继续通过。
3. 不引入新的滚动容器混乱。
4. 新增组件职责单一，不再让底栏同时承担“状态栏 + 终端区”两种角色。

---

## 9. 风险与注意事项

1. **StatusBar 与 TopRuntimeBar 信息重复**
   - 需要严格控制哪些信息留在顶部、哪些信息压缩到底部。

2. **大面板默认隐藏后，现有 Dock 内容入口可能丢失**
   - 必须确保 StatusBar 中保留最小入口。

3. **设置入口只做按钮但无落地 surface 会显得悬空**
   - 建议至少做一个占位菜单或 popover，不要只摆一个无行为按钮。

4. **若继续在 AppShell 里堆积底栏逻辑，会再次变重**
   - 建议本轮顺手拆出新组件，避免 AppShell 回到“大模板大逻辑”状态。

---

## 10. 建议执行策略

建议采用：
1. 先冻结语义（状态栏 vs 大面板 vs 设置入口）
2. 先引入 StatusBar
3. 再把 BottomDock 降级为默认隐藏
4. 最后替换 ActivityRail 底部入口并收口视觉

这个顺序比直接删除旧 Dock 更稳，因为可以保留现有 jobs/traces/notifications 组织逻辑，先完成职责切换，再决定未来是否继续扩展为终端/输出面板。
