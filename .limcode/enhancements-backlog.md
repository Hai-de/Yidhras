# 增强功能储备

> 本文件记录经评估后确认有价值但当前阶段不适合实施的功能增强。
> 每项标注判定时间和暂缓原因。

---

## 插件 per-operator 配置

- **提出时间**: 2026-04-28
- **暂缓原因**: 当前系统选择 pack 作为插件管理的最小粒度，此设计是刻意的架构决策而非遗漏。per-operator 插件配置会导致同一 pack 内 operator 看到不同的插件行为，与"pack 作为世界状态单元"的核心假设冲突。需要在此之前先澄清"插件的归属权"和 P2P agent 自主行为时的权限传递模型。
- **前置条件**:
  1. 明确插件生命周期中的"所有者"概念（pack vs operator vs agent）
  2. 解决 agent 自主推理时的插件配置来源问题
  3. 评估是否需要比 pack 更细的"租户"抽象
- **替代方案**: 通过 capability 控制 operator 的插件管理权限（已有 `MANAGE_PLUGINS`），无权限的 operator 无法管理插件，但不影响已激活插件的运行时行为

---

## Streaming/SSE 支持（AI 推理流式响应）

- **评估时间**: 2026-05-01（更新于 2026-05-10）
- **当前状态**: 后端 adapter + gateway 流式能力已实现。`openai_compatible.ts`（Chat Completions SSE）和 `anthropic.ts`（Messages SSE with typed events）均支持 `executeStream()`。`ModelGateway.executeStream()` 提供跨 provider 的流式调度（含不支持流式的 adapter 退化到 `execute()` 的 fallback）。SSE endpoint（`POST /api/inference/stream`）待前端接入后启用。
- **暂缓部分**: 前端 SSE 消费和 SSE endpoint 注册仍暂缓，原因不变：
  - **推理由仿真循环异步批量驱动**，非用户交互触发。AI 调用发生在 `job_runner.ts` 的后台 worker 中，没有 HTTP 客户端在等待响应。
  - **前端是只读轮询控制台**，不触发推理。所有推理数据通过 3-30 秒间隔的 fetch 拉取已完成的作业结果，无可展示流式文本的 UI 组件。
  - 工具循环 (`tool_loop_runner.ts`) 不使用流式模式（串行阻塞模型与流式增量解析冲突），仅非 tool 请求使用流式。
- **已实现 vs 未实现**：
  - ✅ adapter 流式接口（`AiProviderAdapter.executeStream`、`AiProviderAdapterChunk`）
  - ✅ OpenAI Chat Completions streaming + Anthropic Messages streaming
  - ✅ Gateway 流式调度（`ModelGateway.executeStream`）+ 不支持流式 adapter 的退化 fallback
  - ❌ OpenAI Responses API streaming（仅 Chat Completions 路径支持）
  - ❌ SSE endpoint 注册（`POST /api/inference/stream`）—— adapter + gateway 已就绪，需前端接入时在 route handler 中串联
  - ❌ 前端 SSE 消费
  - ❌ Tool loop 流式模式

---

## 链式行为（复合行为）

- **评估时间**: 2026-05-21
- **暂缓原因**: 事件驱动的反馈循环（行动→事件→调度器→重新推理→新行动）已覆盖大多数多步场景。链式行为需要同时改动 `DecisionResult`、`ActionIntent`、dispatch pipeline、enforcement engine，涉及面贯穿全栈。当前没有世界包提出明确的事务性多步行为需求。
- **适用场景**:
  1. 复杂仪式/复合交互（如 "拿起物品→验证规则→使用物品"的原子操作）
  2. 需要事务性保证的多步状态变更（全成功或全回滚）
  3. 逻辑上属于同一行为的跨 tick 动作合并
- **前置条件**:
  1. 至少有一个世界包提出无法用事件循环满足的事务性多步行为需求
  2. 明确链式行为的失败回滚语义（某步失败后已执行步骤的状态处理）
  3. 确定链式行为的表现形式（AI 输出序列？pack YAML 定义链模板？还是两者？）
- **替代方案**: 通过 `rules.objective_enforcement` 的 `mutate` 支持多目标状态变更（单次执行多 mutation），在不引入链式概念的前提下覆盖部分复合行为需求

---

## 新增 group/collective entity kind

- **评估时间**: 2026-05-10
- **触发**: 赛博朋克世界包草稿的 `jailbreakers_current`（第 9 届参赛者匿名集合）需要表达群体概念——个体间有差异（不同 exploit/stealth/persistence 数值），但共享群体身份。
- **暂缓原因**: 当前可通过拆分独立 actor + `entity_type`/`tags` + `entity_type_is` target_selector 实现等价效果，无需修改平台。群体概念的设计空间大（群体 state 共享语义、群体生命周期、群体内通信），需要更多世界包的用例才能定义好。
- **目标设计（路径 A）**:
  1. 定义 `kind: "collective"` 或复用 `kind: "institution"`
  2. 实现 member_of 关系（entity → group）
  3. 支持群体级别的 authority grant（target_selector 可选中 group，自动覆盖所有 member）
  4. 成员可以有独立 state（个体差异），同时共享群体的部分 state
- **待澄清的设计问题**:
  1. 群体 entity 的 kind 值（新增 `collective` vs 复用 `institution`）
  2. 成员关系的存储方式（mediator binding？单独的 member_of 表？）
  3. 群体 authority 的继承语义（成员是否自动继承群体 grant？退出群体的级联撤销？）
  4. 群体解散/成员退出时的级联行为
- **当前 workaround（路径 B）**: 每个参赛者在 `entities.actors` 中单独定义，通过 `entity_type` 或 `tags: ["jailbreaker"]` 标记，authority target_selector 使用 `entity_type_is: "jailbreaker"` 覆盖全体，个体差异通过 per-entity state 表达。
- **来源**: `.limcode/archive/design/platform-capability-gap-supplement.md` §2.6

---

## 行为树 Parallel 节点

- **评估时间**: 2026-05-21
- **暂缓原因**: 无状态求值模型下"并行"的语义不清晰——是真正的并发还是顺序求值后合并结果？需要先确定无状态行为树的并行语义定义，以及与调度器 single-flight 策略的交互方式。首版在加载校验阶段直接拒绝 Parallel 节点。
- **前置条件**:
  1. 明确无状态求值下 Parallel 的语义（顺序求值 + 结果合并策略，还是真正的并发执行）
  2. 定义 `policy: require_all / require_one` 的成功策略
  3. 确定与调度器 cooldown/single-flight 的交互规则（多子节点同时产出多个 action 时如何合并或排队）
- **来源**: `.limcode/design/behavior-tree-design.md` §3.1
- **关联**: 链式行为（Parallel 可能同时产出多个 action，需要与链式行为设施协调）

---

## 行为树跨包子树引用

- **评估时间**: 2026-05-21
- **暂缓原因**: 跨包引用需要先解决包间依赖声明（pack A 引用 pack B 的子树 → pack A 必须声明对 pack B 的依赖）和子树版本化问题（pack B 升级后子树定义变化，pack A 的引用是否受影响）。首版限定同包内 `$ref`。
- **前置条件**:
  1. 包间依赖声明机制（`pack.yaml` 中 `dependencies` 字段）
  2. 子树版本化策略（按树名引用 vs 按版本号引用 vs 快照式引用）
  3. 跨包树名命名空间设计（`other_pack::tree_name` 语法）
- **来源**: `.limcode/design/behavior-tree-design.md` §4.2

---

## 行为树 Cooldown 持久化

- **评估时间**: 2026-05-21
- **暂缓原因**: 重启后几个 tick 内的冷却状态丢失对叙事一致性的影响可忽略。Cooldown 持久化需要引入 pack-local SQLite 写入路径和迁移脚本，增加了实现复杂度但收益有限。先以内存方案验证 cooldown 的实际使用模式。
- **前置条件**:
  1. 收集内存 cooldown 方案在生产环境（或长期运行）中的实际表现数据
  2. 确认重启后冷却丢失确实对叙事产生了不可接受的影响
  3. 确定持久化粒度（每次 Success 都写入 vs 定时批量刷盘）
- **来源**: `.limcode/design/behavior-tree-design.md` §3.2, §6

---

## 行为树子树宏/参数化

- **评估时间**: 2026-05-21
- **暂缓原因**: 先通过 `$ref` 观察子树复用的实际模式，确定最常见的参数化需求后再设计。过早抽象可能导致错误的参数模型（如需要的是泛型条件而非参数替换）。
- **前置条件**:
  1. 收集 `$ref` 的实际使用模式（哪些值最常被硬编码在子树中而希望参数化）
  2. 确定参数化粒度（单个值替换 vs 条件模板 vs 完整子树模板）
- **来源**: `.limcode/design/behavior-tree-design.md` §6

---

## 行为树 Running 状态持久化

- **评估时间**: 2026-05-21
- **暂缓原因**: 模拟循环每 tick 重新求值已覆盖绝大多数决策场景。长时行为（跨多 tick 保持 Running 状态）可用事件驱动循环替代——行为树在 tick N 产出"等待条件 X"的 decision，后续 tick 的事件触发重新推理。Running 状态持久化会引入行为树内部状态机，与当前无状态求值模型冲突。
- **前置条件**:
  1. 发现事件驱动循环无法覆盖的长时行为场景
  2. 解决 Running 状态与调度器 cooldown/single-flight 的协调
  3. 设计 Running 状态的持久化与恢复机制
- **来源**: `.limcode/design/behavior-tree-design.md` §2.2, §6

---

## 行为树可视化编辑器

- **评估时间**: 2026-05-21
- **暂缓原因**: 先验证 YAML 定义的人机工程学——包作者是否能通过纯文本高效地编写和调试行为树。可视化编辑器的开发成本高（图形编辑器 + 实时预览 + 决策追踪可视化），应在 YAML 方案的痛点和需求充分暴露后再投入。
- **前置条件**:
  1. 至少 3 个世界包使用行为树 YAML 定义了完整的 NPC 决策逻辑
  2. 包作者反馈 YAML 编辑/调试存在明显的效率瓶颈
  3. 确定可视化编辑器的核心需求（树结构编辑？决策追踪回放？实时 tick 调试？）
- **来源**: `.limcode/design/behavior-tree-design.md` §6

---

## 行为树运行时动态修改

- **评估时间**: 2026-05-21
- **暂缓原因**: 行为树在 pack 加载时编译为不可变 AST，运行时不可变。动态性已通过条件节点的状态检查（`state`、`world_state`、`event_semantic_type` 等）实现——树结构不变，但执行路径随世界状态变化。运行时修改树结构会引入并发安全、持久化、跨 tick 一致性等问题。
- **前置条件**:
  1. 发现条件节点状态检查无法覆盖的动态性需求（如 NPC "学会"了新行为模式）
  2. 解决运行时树修改的并发安全（模拟循环和 API 调用同时修改树）
  3. 确定修改的持久化语义（修改只在内存中 vs 写回 pack.yaml vs 写入新的 snapshot）
- **来源**: `.limcode/design/behavior-tree-design.md` §6

---

## 行为树 Sequence 多 action 链式执行（策略 B）

- **评估时间**: 2026-05-21
- **暂缓原因**: 依赖链式行为基础设施（见本文件"链式行为（复合行为）"条目）。首版限制 Sequence 只能有一个 action 叶子，待链式行为就绪后解除限制并升级为真正的顺序多 action 执行。
- **前置条件**: 与"链式行为（复合行为）"条目相同
- **来源**: `.limcode/design/behavior-tree-design.md` §3.1, §7

---

## 行为树 noop 显式跳过与 default_action 兜底

- **评估时间**: 2026-05-21
- **暂缓原因**: 当前空结果（根节点 Failure → `decision: null`）已表达"本 tick 无事可做"的语义，调度器视为成功的推理周期。`noop`（显式跳过）和 `default_action`（树级兜底动作）解决的是可观测性和配置健壮性问题——让包作者能区分"意外无匹配"和"有意等待"、为"所有条件都不满足"提供安全网。两者均非功能阻塞项。
- **前置条件**:
  1. 收集包作者在实际使用中遇到"不知道该让 NPC 做什么"或"分不清无匹配 vs 有意等待"的频率和场景
  2. 确定 `noop` 是否需要走完整的意图落地管线（触发 invocation rule、写入事件日志），还是作为纯标记
  3. 确定 `default_action` 的覆盖语义（只覆盖根节点 Failure？还是也覆盖树内部 Failure？）
- **来源**: `.limcode/design/behavior-tree-design.md` §2.2, §9.6
