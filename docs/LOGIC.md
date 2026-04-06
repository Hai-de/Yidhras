# Yidhras Logic / 业务逻辑说明

本文件只记录当前已成立的业务规则与领域边界，不记录阶段叙事。

> 当前优先级请看 `TODO.md`；验证记录请看 `记录.md`。

## 1. Core Behavior Loop / 核心行为闭环

- Agent context 可通过后端 API 查询。
- Narrative variables 在解析时会经过权限过滤。
- Social post 的创建与读取可通过 API 完成。
- Simulation tick 持续推进，并支持 pause / resume。
- inference、workflow persistence、action dispatch 是相关但分层的三类职责。
- 正式成功响应遵循统一包络：`{ success: true, data, meta? }`。
- world-pack 可声明 scenario、event template、action 与 decision rule，运行时会 materialize 并消费这些声明。

## 2. Information Boundary / 信息边界规则

### Variables and resolver

- Variables 可携带访问元数据（如 `min_level`、可选 `circle_id`）。
- 对受限或缺失变量，resolver 返回安全占位结果，而不是泄露原值。
- Agent context API 会结合 circle / identity 上下文做权限判断。
- inference context 应复用 identity / binding / policy 结果，而不是绕过这些边界。

### Identity binding lifecycle / 身份绑定生命周期

- Identity 可绑定到 active / atmosphere 节点，并带有显式 role 与 status。
- Binding 支持手动 unbind 与显式 expire。
- runtime loop 会在 `expires_at` 到达后自动过期相关 binding。
- 同一 `identity_id + role` 不能重复持有多个 `active` 绑定。
- 非法 actor 组合应返回明确输入错误，而不是静默猜测。

### Identity policy / 身份策略规则

- 字段级策略遵循 deny-first：`deny > allow`。
- field wildcard 支持 `*`、精确路径与 `prefix.*`。
- policy conditions 可使用 claims 与 attributes 的合并上下文。
- policy 评估结果应保留可解释性，便于调试与审计。

## 3. Time and Transport / 时间与传输规则

- 绝对时间以 `BigInt` tick 表示。
- 多历法显示由同一绝对时间轴派生。
- API transport 中的 tick-like 字段保持 string-based。
- 延迟执行通过显式 workflow/time 字段表达，而不是依赖隐式内存状态。
- 前端默认应保留 tick 字符串；仅在比较或计算时再转换为 `BigInt(...)`。

## 4. Node Dynamics / 节点价值动态

- Node value（SNR）支持增减式更新。
- pinned node 可根据当前 manager 逻辑抵抗部分衰减。
- dynamics algorithm 按 reason type 可插拔。

## 5. Notification and Fault Feedback / 通知与故障反馈

- 后端维护 system notification queue。
- API 支持读取与清理通知。
- runtime error 会推送带 level 和 code 的结构化通知。
- 失败类别应保持可区分，便于 operator 与调试使用。

## 6. Layer Coupling / 层级联动规则

- L1 信号会影响 L2 关系权重。
- L2 关系变化会影响 L1 可见性与影响力。
- L3 叙事事件会影响下一步可执行动作。
- L4 传输限制会影响动作时机与覆盖范围。
- 当前实现只对部分跨层耦合做了 formalize。
- world-pack 的 event / actor state / artifact state 已可反馈到 inference 与 action decision，但这还不是完整的通用 simulation DSL。

## 7. Scheduler Rules / 调度规则

- Scheduler 会为 agent 形成 `periodic` 与 `event_driven` 两类 candidate。
- event-driven candidate 会按 signal priority 合并；结果保留 `chosen_reason + candidate_reasons[]`。
- `event_coalesced` 仅用于 summary/read-model 聚合，不是 candidate-level `skipped_reason`。
- candidate readiness 顺序为：
  - `limit`
  - `pending_workflow`
  - `replay/retry suppression`
  - `periodic cooldown`
  - `existing idempotency / create`
- replay / retry recovery window 会继续 suppress periodic cadence。
- 高优先级 `event_followup` 在未被 pending/idempotency 阻断时可继续存活；较低优先级 followup 可能在恢复窗口内被 suppress。
- scheduler read model 会派生 `coalesced_secondary_reason_count` 与 `has_coalesced_signals`，用于解释 merged event-driven decision。
- `last_signal_tick` 表示某个 partition 最近观测到的 signal / recovery watermark。

## 8. Agent System Boundary / Agent 系统边界

- Identity Layer：身份、绑定、生命周期与权限上下文。
- Inference Interface：context assembly、decision normalization、provider boundary。
- Workflow Persistence：trace / intent / job 记录与状态桥接。
- Memory Core：memory context 与 prompt-fragment 集成边界。
- Action Dispatcher：运行时可执行 intent 的消费与派发。

## 9. Contributor Rules / 贡献者规则

- 只把已经成立的业务规则写进本文件。
- 不要把推测中的行为写成已实现能力。
- 与 `docs/API.md`、`docs/ARCH.md` 对齐边界，不要重复实现细节。
- 如果新增 inference 相关规则，请明确它属于：
  - prompt construction
  - decision normalization
  - workflow persistence
  - action dispatch
