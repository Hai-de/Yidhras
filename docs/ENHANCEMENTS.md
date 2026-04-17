# Enhancements Backlog

> 用于记录当前不阻塞主干开发、可后续评估的小功能、改善项与增强项。
>
> 这些条目默认不进入当前里程碑；待项目主干稳定、架构边界更清晰后，再按专题逐步实施。
> 本文档记录当前未纳入本轮范围、但后续可继续评估的事项。

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
  当前实现已满足基本可用性，后续可继续优化交互与体验。

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
  属于 UI polish，不影响当前核心功能闭环。

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
  当前 Phase 2 主目标是先完成 theme/layout token 的解析、clamp、runtime source 与页面级基础消费；共享组件内部 spacing 调整可在后续阶段处理。

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

### 7. Notifications Center 与 BottomDock 数据模型深化
- 状态：deferred
- 优先级：medium
- 范围：notifications / shell / bottom dock / recent targets
- 背景：
  当前 shell 已具备 TopRuntimeBar 状态摘要、轻量通知反馈、BottomDock jobs/traces 回看层与 recent targets；如需支持更长期的调试与值班观察，仍可继续扩展。
- 后续增强候选：
  - notifications center 深化（`code` / `details` / clear actions）
  - BottomDock traces / jobs 从 recent-target 回看层升级为更真实的专属 read model
  - recent target 持久化
  - command palette / 快速动作入口
- 延期原因：
  当前已具备基础流程展示能力；这些项主要提升控制台效率与调试体验，不构成当前阻塞。

### 8. Scheduler Workspace 深度诊断与跨工作区联动
- 状态：deferred
- 优先级：medium
- 范围：scheduler workspace / overview / agent / workflow / audit / graph
- 背景：
  当前前端已经具备独立 Scheduler Workspace，并能消费 operator / agent projection、ownership、workers、rebalance 与基础 drill-down，可作为当前阶段的调度观测入口。
- 后续增强候选：
  - 更深的 decision detail 展示
  - worker / actor hot spots
  - ownership history 与更丰富的 worker health 视图
  - rebalance recommendation / suppress reason / apply linkage 的更深 drill-down
  - 更强 cross-linking 到 workflow / audit / graph
- 延期原因：
  当前 workspace 已具备基础调度观测能力；继续下钻主要提升 operator 分析效率。

### 9. 前端测试资产扩充
- 状态：deferred
- 优先级：low
- 范围：web unit tests / feature stores / composables / page adapters
- 背景：
  当前前端已经具备 `runtime / shell / workflow / graph / notifications / scheduler api` 等核心单测基线，可支撑当前阶段的基本回归验证。
- 后续增强候选：
  - feature-level store / composable tests
  - 更细的 scheduler workspace view-model tests
  - 关键工作区页面的组合式回归测试
- 延期原因：
  当前阶段优先保证主要流程稳定运行；测试广度补强适合在后续阶段系统推进。

### 10. Plugin CLI 批量治理增强
- 状态：deferred
- 优先级：medium
- 范围：pack-local plugin CLI / operator automation / governance workflow
- 背景：
  当前 plugin CLI 已具备：
  - `list / show / confirm / enable / disable / rescan / logs / why-not-enable`
  - `--json`
  - `--state`
  - `--capability`
  - interactive / non-interactive acknowledgement 路径
- 后续增强候选：
  - `enable --all` / `disable --all`
  - 更复杂的批量筛选组合
  - 面向脚本治理的批处理操作
  - 更完整的 machine-friendly exit code / summary contract
- 延期原因：
  当前优先级低于 web runtime 真动态化、integration/e2e 补强与 lint 收口；现有 CLI 已能支撑单 installation 治理闭环。

### 11. Plugin CLI Explain / Diagnostics 家族深化
- 状态：deferred
- 优先级：medium
- 范围：plugin governance diagnostics / operator troubleshooting
- 背景：
  当前 CLI 已提供基础诊断命令：
  - `why-not-enable`
  - `logs`
  - `rescan`
  - `show`
- 后续增强候选：
  - `why-not-confirm`
  - `why-not-disable`
  - 更深的 show/detail 视图（最新 activation / latest ack / richer runtime diagnostics）
  - explain family 的更统一输出 contract
- 延期原因：
  当前更需要先把 web runtime、自动化回归与整体质量基线收口；更深 explain 家族可在下一轮 operator tooling 增强时系统设计。

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

### 4. Agent scheduler projection 轻量摘要增强
- 状态：deferred
- 优先级：low
- 范围：scheduler observability / agent projection / operator-facing read model
- 背景：
  当前 `GET /api/agent/:id/scheduler/projection` 已经提供 actor summary、timeline、reason breakdown 与 recent run/job linkage，且 `workflow_link` 已补到解释型摘要层；但 projection 摘要层仍保留一批轻量增强候选。
- 后续增强候选：
  - `latest_created_job_status`
  - `latest_created_job_intent_class`
  - `skipped_by_kind`
  - `run summary excerpt`
  - agent-level `latest_audit_summary`
- 延期原因：
  当前已具备基础 cross-link 与解释型摘要；agent-level 聚合摘要增强仍属于次优先级。

### 5. Scheduler operator deeper highlights / breakdowns
- 状态：deferred
- 优先级：low
- 范围：scheduler operator projection / observability
- 背景：
  当前 operator projection 已具备 latest run、summary、trends、recent runs/decisions 以及 highlights，并已补充 skipped/failure/workflow-state 的轻量摘要；但更细的 worker-level / actor-level breakdown 仍未纳入。
- 后续增强候选：
  - worker-level highlights
  - actor-level failure / skip hot spots
  - richer failure-code breakdown
- 延期原因：
  当前优先保持轻量 operator 总览层稳定；更细分的 breakdown 可在前端消费需求明确后再推进。

### 6. Replay Orchestration 与 Durable Job Scheduling 深化
- 状态：deferred
- 优先级：medium
- 范围：workflow runtime / replay / scheduler / durable scheduling
- 背景：
  当前系统已经具备 retry、replay、intent class、replay-aware suppression 与 `scheduled_for_tick` 等基础能力，可支撑当前阶段的工作流闭环。
- 后续增强候选：
  - richer replay orchestration
  - 更 durable 的 job scheduling 语义
  - windowed / not-before / not-after 风格的调度约束
  - 更清晰的 replay-derived scheduling linkage
- 延期原因：
  当前优先保证流程可运行；继续扩展 orchestration 语义会增加实现范围。

### 7. Automatic Rebalance 策略与 Operator-Forced Workflow 语义深化
- 状态：deferred
- 优先级：medium
- 范围：scheduler ownership / rebalance / operator control plane
- 背景：
  当前 scheduler 已经具备 partition ownership、migration、worker runtime state 与 automatic rebalance baseline，也已有相应读接口与前端观察面。
- 后续增强候选：
  - 更丰富的 rebalance guardrails
  - recommendation policy 深化
  - recommendation -> apply linkage 收口
  - 更明确的 operator-forced workflow semantics
- 延期原因：
  这些能力更偏生产级调度治理与人工干预语义；现有基础能力已可满足当前阶段的展示与验证。

### 8. Memory Core 分层读模型与 Retrieval / Aggregation
- 状态：deferred
- 优先级：medium
- 范围：memory core / agent overview / retrieval
- 背景：
  当前已经有 MemoryTrace persistence、recent trace read 与 agent overview memory summary，可支持当前阶段对记忆能力的基本展示。
- 后续增强候选：
  - 更长期 / 分层 memory read model
  - retrieval / aggregation 能力
  - 更适合 prompt / overview 消费的 memory condensation
- 延期原因：
  这些增强更偏行为质量提升与长期演化，不是打通 demo 主流程的必要前提。

### 9. Audit / Review Operator 视图深化
- 状态：deferred
- 优先级：medium
- 范围：audit feed / detail / related-record aggregation / operator observability
- 背景：
  当前统一 audit feed、detail read、基础过滤、cursor、workflow related-record aggregation 与 replay-lineage detail 已经具备，可满足当前阶段的基础观察需求。
- 后续增强候选：
  - 更完整的 operator 视图
  - 更强的跨对象关联观测
  - 与 scheduler / workflow / graph / social 的更顺滑交叉定位
- 延期原因：
  当前已有读面已经能承担 demo 的“可看见、可追踪”需求；进一步增强主要优化定位速度与解释深度。

### 10. Mutation 写路径规范化与 Delta-Capable World Actions
- 状态：deferred
- 优先级：medium
- 范围：mutation semantics / workflow writes / world actions
- 背景：
  当前 `relationship_adjustment` 与 `snr_adjustment` 已经提供 resolved-intent detail shape，足够支撑现阶段工作流结果的最小解释。
- 后续增强候选：
  - 更广的写路径规范化
  - future delta-capable world actions
  - 更统一的 mutation result / intent projection 约定
- 延期原因：
  这些属于下一层领域写模型演进；在当前阶段优先落地会扩大实现范围。

### 11. AiInvocationRecord 的 operator / debug 视图接入
- 状态：deferred
- 优先级：medium
- 范围：workflow detail / trace detail / operator workspace / debug read model
- 背景：
  当前服务端已经具备 `AiInvocationRecord` 持久化与只读查询接口：
  - `GET /api/inference/ai-invocations`
  - `GET /api/inference/ai-invocations/:id`
  - 并且 `InferenceTrace.trace_metadata.ai_invocation_id` 已可回链到具体 invocation 证据。
  但这些能力目前主要停留在后端 observability surface，尚未深度接入 operator / workflow / trace 视图。
- 后续增强候选：
  - workflow detail 中直接展示关联的 provider/model/route/attempts
  - trace detail 中增加 ai invocation drill-down 与回跳
  - operator workspace 中增加 AI 调用热点、失败热点与 fallback 热点观察面
  - 基于 `audit_level` 的 request/response 证据展示分级
- 延期原因：
  当前后端最小读面已经足够支撑调试与验收，是否继续下钻应等待前端消费需求与 operator 视图形态更明确后再推进。

### 12. AI Invocation 的 summary / analytics 聚合接口深化
- 状态：deferred
- 优先级：medium
- 范围：AI observability aggregation / operator analytics / read-model API
- 背景：
  当前 `AiInvocationRecord` 已具备列表与详情读取，但仍以 item-level query 为主，聚合分析能力尚未形成正式接口。
- 后续增强候选：
  - 增加更细过滤：`task_id` / `finish_reason` / `fallback_used` / `audit_level`
  - provider/model/task_type 维度的窗口统计
  - success / fail / blocked / timeout 趋势摘要
  - usage / token / latency / estimated cost 聚合
  - 供 operator/workspace 直接消费的 summary endpoint，而不是完全由前端二次聚合
- 延期原因：
  当前最小列表/详情查询已满足本轮目标；进一步聚合会扩大 operator observability 与 API 设计范围，适合在后续专门立项时推进。


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

## 四、内容与数据包

### 1. World-Pack Schema Contract 与 Validation Checklist
- 状态：deferred
- 优先级：medium
- 范围：world-pack contract / validation / docs
- 背景：
  当前项目已经有可运行的 world-pack baseline 与 configw/bootstrap 链路，可支持当前阶段的启动和展示。
- 后续增强候选：
  - formalize world-pack schema contract
  - validation checklist
  - 作者侧约束与错误说明文档
- 延期原因：
  当前阶段继续复用现有 pack baseline 更直接；正式契约化更适合在内容体系更稳定后推进。

### 2. Pack-Level Metadata / Registry / Docs Tooling
- 状态：deferred
- 优先级：low
- 范围：content packaging / registry / docs tooling
- 背景：
  当前 world-pack 使用方式仍以项目内置模板和本地运行数据目录为主，尚未进入需要多 pack 资产治理的阶段。
- 后续增强候选：
  - pack-level metadata
  - registry
  - docs tooling / discoverability tooling
- 延期原因：
  这些项对资产规模化管理有价值，但不影响当前阶段的单 pack 运行闭环。

### 3. Provider-Owned Presentation / Theme / Data Authoring 示例与校验路径
- 状态：deferred
- 优先级：low
- 范围：provider workflow / theme authoring / data authoring / validation
- 背景：
  当前 provider-owned 主题入口、示例 theme 与基础 runtime 解析链路已经存在，但内容作者工作流仍然是最小形态。
- 后续增强候选：
  - 更完整的 presentation / theme / data authoring 示例
  - provider authoring validation path
  - 面向内容作者的操作说明与校验反馈
- 延期原因：
  当前优先保证已有 pack 的运行链路稳定，而不是一次性补齐全部内容生产工具链。

---

## 状态约定

- `deferred`：明确记录，但当前不进入本轮开发。
- `planned`：已确认未来会处理，但尚未进入正式计划文档。
- `in_progress`：已进入实际实现阶段。
- `promoted`：已升级为正式设计/计划项，由其他文档承接。
