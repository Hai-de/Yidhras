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
