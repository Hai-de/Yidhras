# Enhancements Backlog

> 用于沉淀当前不阻塞主干开发、但值得后续逐步回收的小功能、改善项与增强项。
>
> 这些条目默认不进入当前主线里程碑；待项目主干稳定、架构边界更清晰后，再按专题逐步实施。

## 使用说明

- 本文档聚焦“非当前开发重点”的增强项，不替代正式设计文档、计划文档或评审文档。
- 条目可以持续追加，但建议保持问题背景、预期收益、延期原因三者完整。
- 若某条增强未来升级为正式工作项，应在 `.limcode/plans/` 或相应设计文档中单独立项，并在本文档中标记为“已转正”。
- 若有内容完成则直接删除不留痕

---

## 一、前端

### 1. Shell / BottomDock 交互增强
- 状态：deferred
- 优先级：low
- 范围：operator shell / workspace layout / bottom dock
- 背景：
  当前 BottomDock 已支持：
  - 仅覆盖主内容区，不遮挡 WorkspaceSidebar
  - 可拖拽调整高度
  - 内容区内部滚动
  - 高度持久化到 store / localStorage
  - 最大高度基于 main / NuxtPage 对应区域动态限制
- 后续增强候选：
  - 按 workspace 分别记忆 dock 高度
  - 双击拖拽手柄恢复默认高度
  - Dock 展开/收起的微动效与更平滑的尺寸过渡
  - Dock tab、StatusBar、TopRuntimeBar 之间的视觉节奏进一步统一
- 延期原因：
  当前实现已满足主干可用性，后续主要属于交互精修与体验打磨。

### 2. Shell 视觉一致性与边界收敛
- 状态：deferred
- 优先级：low
- 范围：ActivityRail / WorkspaceSidebar / StatusBar / Dock
- 背景：
  近期已对 StatusBar、Sidebar、BottomDock 做过多轮容器结构调整，但仍可能存在局部边界线、阴影、hover 节奏、面板层级的一致性优化空间。
- 后续增强候选：
  - 边框连续性统一（1px seam、阴影衔接、面板边缘重叠关系）
  - 底栏与 Dock 的连续感优化
  - 不同 workspace 页面在 shell 容器内的视觉统一验收
- 延期原因：
  属于 UI polish，收益真实但不影响核心功能闭环。

### 3. 复杂页面的可视化布局回归检查
- 状态：deferred
- 优先级：medium
- 范围：overview / workflow / timeline / graph / agents
- 背景：
  Shell 容器结构已从“固定像素补丁”逐步调整为“结构约束驱动”，后续仍建议在关键页面做系统性的布局回归检查。
- 后续增强候选：
  - 建立若干页面级截图基线
  - 检查 Dock 展开、收起、拖拽后各页面的遮挡与滚动行为
  - 记录极端窗口尺寸下的布局表现
- 延期原因：
  当前优先级低于主流程功能开发，但后续适合作为稳定期质量工作的一部分。

### 4. 共享基础组件的 layout token 消费收口
- 状态：deferred
- 优先级：medium
- 范围：shared/components、overview/graph/agents/workflow/timeline/social 中复用面板与 header 类组件
- 背景：
  当前 Phase 2 已让主页面容器、shell rail/sidebar、dock 高度开始消费 `layout` token，但大量共享基础组件内部仍保留 `px-5 py-5`、`gap-4` 等硬编码 spacing。
- 后续增强候选：
  - 将 `WorkspacePageHeader`、`WorkspaceSectionHeader`、`OverviewMetricCard`、`GraphMetricCard`、`AgentSummaryCard` 等复用组件迁移为基于 layout token 的 spacing
  - 统一 cards / list sections / empty states 的 spacing 语义
  - 为后续 Phase 3 semantic primitives 提前降低样式散落程度
- 延期原因：
  当前 Phase 2 主目标是先完成 theme/layout token 的解析、clamp、runtime source 与页面级基础消费；共享组件内部 spacing 收口属于下一轮可控优化，可记录为增强项而非继续拉长当前收口周期。

### 5. 可视化主题编辑器
- 状态：deferred
- 优先级：low
- 范围：theme authoring / provider-owned theming / operator tooling
- 背景：
  当前 provider-owned 主题能力已收敛到 `presentation.theme`，并提供了示例文件用于复制和联调；但主题编写仍然是以手写配置为主。
- 后续增强候选：
  - 提供面向 provider 的可视化主题编辑器
  - 支持 token 分组浏览、实时预览、回退默认值对照
  - 支持调整颜色、radius、layout、surface 等核心语义
- 延期原因：
  当前主目标是先稳定单一主题 contract 与 runtime 解析链路；等主题系统和 provider 接入模式进一步成熟后，再考虑引入可视化编辑能力。

### 6. 主题导入 / 导出机制
- 状态：deferred
- 优先级：low
- 范围：theme portability / provider workflow / tooling
- 背景：
  目前 provider 主题以 `presentation.theme` payload 与示例文件为主，尚未建立更完整的主题移植、共享与分发机制。
- 后续增强候选：
  - 主题 JSON / YAML 导入导出
  - 主题 schema 版本标记与迁移策略
  - provider theme preset 打包、共享、对比与回滚支持
- 延期原因：
  当前项目尚未进入需要主题资产大规模流转的阶段；建议等后续有成熟的可视化主题编辑器和更稳定的 theme schema 后，再统一设计导入导出机制。

---

## 二、后端

### 1. 可观测性与调试辅助增强
- 状态：deferred
- 优先级：medium
- 范围：scheduler / workflow / runtime / API diagnostics
- 背景：
  随着调度器、工作流拆分、回放抑制等机制逐步复杂化，未来对调试视角、结构化日志、聚合诊断信息的需求会继续上升。
- 后续增强候选：
  - 更细粒度的调度决策日志与原因分类
  - 更易于前端展示的诊断聚合接口
  - 面向异常场景的运行态调试快照
- 延期原因：
  当前主干更关注能力正确性与接口闭环，增强型诊断能力可在稳定阶段补齐。

### 2. 后端配置与运行参数治理
- 状态：deferred
- 优先级：low
- 范围：runtime / scheduler / feature flags
- 背景：
  随着调度与观测能力增加，运行时参数、实验开关、阈值配置可能逐步增多，后续需要统一梳理。
- 后续增强候选：
  - 配置分层与默认值收口
  - 面向开发/测试/生产环境的参数约束说明
  - 配置变更对行为影响的文档化说明
- 延期原因：
  当前尚未形成配置爆炸，暂不需要过早抽象。

### 3. 后端测试基线与回归资产补强
- 状态：deferred
- 优先级：medium
- 范围：service / scheduler / contracts
- 背景：
  主干逐渐稳定后，需要更系统地补强回归测试基线，以降低后续重构成本。
- 后续增强候选：
  - 核心调度路径的场景化测试矩阵
  - replay-aware 相关逻辑的边界用例补齐
  - 关键接口的契约与异常路径回归
- 延期原因：
  当前阶段更适合先保证主链路可跑、再逐步扩充测试资产。

---

## 三、前后端联动

### 1. Shell 与后端诊断能力的联动深化
- 状态：deferred
- 优先级：medium
- 范围：frontend shell + backend observability
- 背景：
  当前前端 shell 已承载较多运行态信息展示职责，但许多交互仍偏“静态呈现”或“轻量跳转”，后续可以继续深化与后端诊断接口的联动。
- 后续增强候选：
  - Dock / workspace 面板直接消费更细粒度诊断流
  - 状态条与诊断状态之间建立更明确的映射关系
  - 前端 drill-down 与后端问题定位上下文自动串联
- 延期原因：
  需要等待前后端主干接口更加稳定，否则容易频繁返工。

### 2. 调试链路中的上下文透传与回跳增强
- 状态：deferred
- 优先级：low
- 范围：source context / route linking / debug navigation
- 背景：
  当前已经有 source context、recent targets、跨 workspace 跳转等基础能力，后续仍可增强上下文保真度。
- 后续增强候选：
  - 更精细的来源链记录
  - 前端视图与后端对象 ID、trace、job 的联动跳转规范
  - 页面刷新后上下文恢复一致性增强
- 延期原因：
  当前能力已足够支撑主链路使用，进一步增强主要提升调试效率。

### 3. 主干成熟后的增强项回收机制
- 状态：planned
- 优先级：medium
- 范围：process / docs / implementation planning
- 背景：
  当前增强项被刻意延后是合理的，但后续需要一个明确机制来避免文档长期沉积无人处理。
- 建议机制：
  - 每个阶段性里程碑结束后，统一回顾本文档
  - 从三大块中各挑 1~2 项进入正式计划
  - 一旦转正，补充对应设计/计划/评审文档并在此处标记状态
- 延期原因：
  当前先建立收纳池与分类方法，后续再制度化执行。

---

## 状态约定

- `deferred`：明确记录，但当前不进入主线开发。
- `planned`：已确认未来会处理，但尚未进入正式计划文档。
- `in_progress`：已进入实际实现阶段。
- `promoted`：已升级为正式设计/计划项，由其他文档承接。
