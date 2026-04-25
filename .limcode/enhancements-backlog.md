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

### 9.1 Vue 组件渲染测试引入（@vue/test-utils）
- 状态：deferred
- 优先级：medium
- 范围：web component tests / @vue/test-utils / happy-dom / jsdom
- 来源：`.limcode/plans/测试链路定向改造计划.plan.md` Phase 3.3 (T12)
- 背景：
  当前 web 端测试均为 `environment: 'node'` 下的 Pinia store / composable 单测，
  尚未覆盖 Vue 组件的实际渲染行为。需要引入 @vue/test-utils + happy-dom/jsdom
  来做关键 UI 组件的渲染测试。
- 后续增强候选：
  - 引入 `@vue/test-utils` + `happy-dom` 作为 web vitest 的 environment
  - 覆盖边缘状态（loading、empty、error）的渲染
  - Props 产生正确渲染
  - 用户交互触发正确的事件
  - 优先覆盖共享基础组件和关键页面组件
- 延期原因：
  需要配置 Nuxt + jsdom 的 test environment 适配；当前阶段优先补齐 server 侧测试盲区与
  Pinia store 测试深度，组件渲染测试适合在整体测试基础设施稳定后独立推进。

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

### 6. Operator-Subject 前端认证与管理界面

- 状态：deferred
- 优先级：medium
- 范围：`apps/web/stores/operator.ts` / `apps/web/pages/login.vue` / `apps/web/composables/useOperatorGuard.ts` / `apps/web/lib/http/client.ts` / `apps/web/pages/admin/`
- 来源：`.limcode/plans/operator-subject-unified-authority.plan.md` P5 阶段
- 背景：
  Operator-Subject 统一权限的后端 API 与中间件链已全面完成（P0–P4），前端认证与管理 UI 尚未实现。包括：
  - **P5-1 前端认证层**：Pinia operator store（login/logout/session/refresh）、登录页面、路由守卫（未登录 redirect /login）、HTTP client Bearer 自动附带
  - **P5-2 Pack 选择界面**：登录后显示已绑定 Pack 列表（调用 `/api/me/bindings`）、pack-scoped session、未绑定时提示申请加入
  - **P5-3 管理界面**：`/admin/operators.vue`（root 可见 Operator 管理）、`/admin/audit.vue`（审计日志查看）
- 延期原因：
  当前阶段聚焦后端权限模型闭环与测试验证；前端界面适合在所有后端 endpoint 稳定、E2E 流程跑通后统一开发，避免前后端联调碎片化。

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
  - delayed retries / scheduled workflows
  - operator-facing durable job diagnostics
  - 更细的 recovery policy 与可观测性
- 延期原因：
  当前主线仍然是先稳定现有 workflow + scheduler contract，再考虑更复杂的 orchestration 能力。

### 6.1 HTTP 端点压力测试（k6/artillery）
- 状态：deferred
- 优先级：medium
- 范围：HTTP load testing / k6 / artillery / stress scenarios
- 来源：`.limcode/plans/测试链路定向改造计划.plan.md` Phase 4.3 (T15)
- 背景：
  当前测试链路已完成 coverage 基线、AI gateway 盲区补齐、benchmark（vitest bench）
  与属性测试（fast-check），但缺少对 HTTP 端点在上限并发/极限负载下的稳定性验证。
  TODO.md 明确要求"制造压力性测试，创造各种极端/边缘的环境和条件，观察稳定性"。
- 后续增强候选：
  - 选用 k6 或 artillery 作为压力测试框架
  - 测试 `/api/health`、`/api/status`、`/api/runtime/scheduler/*` 在高并发下的
    响应时间分布（p50/p95/p99）、错误率和吞吐量
  - 设计递增负载场景（ramp-up → soak → spike）
  - 集成到 CI smoke 管线中作为可选 stage
- 关键约束：
  - 需要启动真实 server 实例（复用 E2E 隔离环境）
  - 压力测试对 CI runner 资源要求较高，建议作为 nightly/on-demand job
  - 需要先确认 k6/artillery 的 Node.js 集成方式与授权模型
- 延期原因：
  需要额外工具链配置与 CI runner 资源评估；当前阶段优先完成 server 端测试覆盖、
  benchmark 基线与属性测试引入，压力测试适合作为后续独立质量工程 milestone。


### 7. Experimental multi-pack runtime operator API 强化项
- 状态：deferred
- 优先级：medium
- 范围：experimental runtime registry / operator api / multi-pack runtime ergonomics
- 背景：
  当前 Phase 5C 已经具备 conservative experimental operator/test-only API：
  - runtime pack list
  - per-pack status / clock
  - scheduler summary / ownership / workers / operator
  - explicit load / unload
  并且已经有 feature gate、容量限制与基础错误码。
- 后续增强候选：
  - 更细的 load/unload result contract 与 idempotency summary
  - 更完整的 pack runtime lifecycle state reason / diagnostics
  - per-pack scheduler filter params 与 richer scheduler-specific experimental contracts
  - dedicated operator docs / examples / CLI helpers
- 延期原因：
  当前 experimental API 已足够支撑 operator / test-only 试验；继续强化属于 Phase 5C 的非阻塞增强项，暂不优先于 Phase 5D/5E。

---

### 8. Rust world engine objective execution 后续增强项
- 状态：deferred
- 优先级：medium
- 范围：Rust world engine / sidecar objective rule execution / host-side diagnostics
- 背景：
  当前 Phase 1 的 A 已经把 `objective_enforcement` 作为 Rust-owned 的真实规则执行路径打通，并具备：
  - sidecar-vs-TS parity 基线
  - explicit no-fallback policy regression coverage
  - 结构化 sidecar diagnostics 持久化到 execution record
  但这一轮收尾后，仍有一批不阻塞主闭环、适合后续继续增强的事项。
- 后续增强候选：
  - 将 sidecar diagnostics 从当前计数/匹配摘要扩展到更细的 rule mismatch 分类（如 capability mismatch / mediator mismatch / target.kind mismatch）
  - 为 template rendering 增加更细的 render trace / debug summary，而不只保留聚合计数
  - 把 sidecar 启动方式从开发期 `cargo run` 进一步收敛为更稳定的预编译 binary / cache / CI-ready 启动策略
  - 为 objective execution parity 构建可复用 fixture harness，减少 TS-vs-sidecar 双路径测试中的样板代码
  - 若后续 Phase 1 或下一阶段需要扩大 Rust 覆盖面，再评估是否在 objective_enforcement 之外继续引入下一类 rule family
- 延期原因：
  当前主目标已经是完成 A 的 objective_enforcement parity 与闭环验证；上述事项可以提高可观测性、开发体验与后续扩展性，但不阻塞当前 A 收口。

### 9. Rust sidecar 本地工具链噪音治理
- 状态：deferred
- 优先级：low
- 范围：Rust sidecar local developer ergonomics / cargo environment
- 背景：
  当前单测与本地 sidecar 启动过程中会看到来自本机 cargo 配置的 deprecation warning（如 `~/.cargo/config` 提示迁移到 `config.toml`）。这不影响当前功能正确性，但会污染测试输出与开发体验。
- 后续增强候选：
  - 在开发文档中补充 Rust toolchain 本地环境整理建议
  - 为 CI / local sidecar 启动增加更稳定、可控的 cargo 环境约束
  - 如有必要，为 sidecar 启动增加更安静的输出治理策略
- 延期原因：
  该问题属于本地工具链与体验层治理，不影响当前 objective execution 功能闭环与验证通过。

### 10. Rust world engine sidecar step 真实语义深化
- 状态：deferred
- 优先级：medium
- 范围：Rust world engine / sidecar prepare-commit step / world state transition semantics
- 背景：
  当前 Pack Runtime Core ownership deepening 已进一步完成：
  - richer `state_delta` metadata baseline
  - `WORLD_CORE_DELTA_BUILT / APPLIED / ABORTED / WORLD_PREPARED_STATE_SUMMARY` diagnostics
  - `__world__/world` entity state upsert
  - `rule_execution_records` append
  - Host delta apply layer 对 `upsert_entity_state / append_rule_execution / set_clock` 的正式解释
  并已验证与 Host-managed persistence / runtime loop / failure recovery 兼容；但 step 语义仍主要围绕 world-level clock advance 与 runtime_step tracing，尚未扩展到更丰富的领域对象演化与更深 query-before/after observability。
- 后续增强候选：
  - 让 `prepareStep` 进一步产出超出 `__world__/world` + `rule_execution_records` 的更多 Pack Runtime Core mutation（如 authority / mediator / world entity 变更）
  - 为 `emitted_events` 增加更贴近真实世界推进结果的领域事件映射，而不只保留 step lifecycle event
  - 为 `observability` 增加更细的 query-before/after summary、delta size、受影响 state namespace 与 Host apply attribution 诊断
  - 视需要评估 commit/abort response contract 是否要正式吸收当前 Host/sidecar observability 扩展字段
- 延期原因：
  当前 Pack Runtime Core ownership deepening 已完成第一轮 ownership / delta / apply / observability 收口；上述增强项属于下一轮继续打磨 engine semantics 厚度的候选，不阻塞本阶段关闭。

### 11. Rust world engine 下一类 rule family 提名与迁移评估
- 状态：deferred
- 优先级：medium
- 范围：Rust world engine roadmap / rule family sequencing
- 背景：
  当前 `objective_enforcement` 已在 Phase 1A 收口，Pack Runtime Core ownership deepening 也已完成第一轮 delta/apply/observability 收口。是否继续扩大 Rust 覆盖面，下一步仍应从“提名哪一类真实 rule family 最值得迁移”开始，而不是无边界扩张。
- 后续增强候选：
  - 评估 active-pack 真实业务中下一类最值得 Rust 化的 rule family
  - 为候选 rule family 建立 TS-vs-sidecar parity fixture 与边界审计
  - 先以 bounded continuation step 方式单独立项，而不是并入既有 Pack Runtime Core 收尾阶段
- 延期原因：
  该决策属于下一阶段路线选择，不应混入当前 Pack Runtime Core 收尾与已完成结论。


### 12. Prompt 系统延后增强项

以下事项已完成需求对齐与接口预留，待后续 Phase 单独实现。

#### 12.1 HuggingFace tokenizers WASM 适配器

- 状态：deferred
- 优先级：medium
- 范围：`inference/tokenizers/` / `prompt_tokenizer.ts`
- 背景：
  当前已通过 `PromptTokenizer` 接口 + `TiktokenTokenizerAdapter` 实现了精确 token 计数。
  `PromptTokenizer` 接口预留了扩展点，后续可新增 HuggingFace WASM adapter 覆盖非 OpenAI 模型（LLaMA、Mistral、Qwen 等）。
- 实现方案：
  - 实现 `HuggingFaceTokenizerAdapter implements PromptTokenizer`
  - 通过 `@huggingface/tokenizers` WASM 加载对应模型的 `tokenizer.json`
  - 按 `AiModelRegistryEntry.tokenizer` 字段选择 adapter（tiktoken vs WASM）
  - WASM 异步加载需单例缓存避免重复初始化
- 关键约束：
  - WASM binary ~2MB，首次加载有延迟；需预加载或 lazy init
  - 不同模型 tokenizer.json 不同，需按 model 缓存实例
- 延期原因：
  当前项目内置默认仅 OpenAI 模型，tiktoken 已覆盖核心需求。

#### 12.2 Rust sidecar 宏展开 / token 计数

- 状态：deferred
- 优先级：low
- 范围：`narrative/resolver.ts` / Rust sidecar / JSON-RPC
- 背景：
  当前宏展开（`{{ }}`、`#if`、`#each`、`default()`）在 TS 中执行，性能可接受。
  若未来出现超长模板（> 4KB）或高并发场景，可将展开 + token 计数移入 Rust sidecar。
- 实现方案：
  - 定义 JSON-RPC 契约：`{ template, variable_context } → { rendered, diagnostics }`
  - Rust 侧从零实现模板 parser（自定义 DSL）
  - 设置阈值：短模板 TS 处理，长模板（> 4KB）调 Rust
- 关键约束：
  - sidecar IPC 开销可能在短模板场景超过计算收益
  - 当前已有 3 个 Rust sidecar，增加第 4 个需评估运维复杂度
- 延期原因：
  TS 性能当前足够；Rust parser 开发周期长。

#### 12.3 SectionDraft 合并到 PromptTree

- 状态：deferred
- 优先级：medium
- 范围：`context/workflow/section_drafts.ts` / `prompt_fragment_v2.ts` / `prompt_tree.ts`
- 背景：
  `PromptSectionDraft` 和 `PromptTree` 是两套独立数据结构，在 `fragment_assembly` step 中互相转换。
  合并后可直接在树节点上做 section 级别的 task-aware scoring，消除 O(n) 转换开销。
- 实现方案：
  - Phase A：`PromptFragmentV2` 新增 `section_id` / `section_type` 字段
  - Phase B：task-aware draft policy（standard/evidence_first/memory_focused）改为树遍历 + 节点标记
  - Phase C：移除 `SectionDraft` 中间层（591 行代码）
- 关键约束：
  - `PromptSectionDraftType`（9 种）和 `PromptFragmentSlot`（9 种）是正交概念
  - 迁移需保证 scoring 等价位 → 先写等价性测试
  - 影响面大，回归风险高 → 先加字段兼容，不删旧代码
- 延期原因：
  需要 Phase 1-4 全部稳定后再推进，避免在变动期引入更多复杂度。

#### 12.4 ProcessingTrace 树形化

- 状态：deferred
- 优先级：medium
- 范围：`inference/types.ts`（`PromptProcessingTrace`）/ `prompt_tree.ts`
- 背景：
  当前 `PromptProcessingTrace.fragments` 是扁平数组。树形化后可在 trace 中反映
  `permission_denied`、嵌套 Fragment 等 V2 信息，提升调试体验。
- 实现方案：
  - `fragments` 数组元素新增 `children?: FragmentTrace[]`（递归）
  - 新增 `permission_denied` / `denied_reason` 字段
  - 保持扁平 trace + 新增可选 `tree_snapshot` 字段（向下兼容）
  - step_traces 改为 diff-based：只记录 `added/removed/modified fragment_ids`
- 关键约束：
  - ProcessingTrace 被序列化到 Prisma JSON 字段 → 树结构增加深度
  - 下游消费者（InferenceTrace / operator 面板）可能依赖扁平结构
- 延期原因：
  依赖 SectionDraft 合并后稳定的树结构。

#### 12.5 Plugin 运行时注入 slot 权限

- 状态：deferred
- 优先级：low
- 范围：`plugins/` / `prompt_permissions.ts` / YAML slot 配置
- 背景：
  当前权限完全由 YAML 配置声明（`permissions.read/write/adjust/visible`）。
  Plugin 无法在运行时声明"我可以往 slot X 注入内容"。
- 实现方案：
  - Plugin manifest 中声明 `prompt_permissions: [{ slot, operations: ['write'] }]`
  - Plugin runtime 注入 fragment 时校验：对比插件声明 vs slot 的 `write` allowlist
  - 不在白名单 → 拒绝 + audit log
  - 权限冲突解决：YAML 优先（`write: []` 可覆盖插件的 write 声明）
  - 权限缓存（slot_id + plugin_id → allow/deny），仅在插件安装/卸载时刷新
- 关键约束：
  - 插件可声明 `write: [*]` 注入任意 slot → 需 operator 审批 + 签名校验
  - 权限校验每推理增加开销 → 缓存缓解
- 延期原因：
  依赖插件生态成熟度；当前 YAML 声明已覆盖核心场景，Plugin API 尚未达到需要 slot 级权限控制的规模。

---

## 三、文档与流程

### 1. 文档之间的导航与索引增强
- 状态：deferred
- 优先级：low
- 范围：design / plans / docs index / capability docs
- 背景：
  文档数量逐渐增加后，未来可能需要更清晰的导航、交叉引用与分层索引。
- 后续增强候选：
  - 核心文档之间的推荐阅读顺序
  - capability 与实现计划的交叉链接
  - 面向新贡献者的阅读入口整理
- 延期原因：
  当前文档体系仍可用，等规模进一步扩大后再统一整理更合适。

### 2. Phase 闭环完成后的归档与总结模板
- 状态：deferred
- 优先级：low
- 范围：review / progress / milestone log
- 背景：
  当前已有 progress 与 review 机制，但后续如果阶段性工作持续增多，可能需要更标准化的“完成总结模板”。
- 后续增强候选：
  - 阶段完成总结模板
  - review finding 跟踪模板
  - progress milestone 归档模板
- 延期原因：
  当前仍处于快速推进阶段，先保持轻量记录方式更灵活。
