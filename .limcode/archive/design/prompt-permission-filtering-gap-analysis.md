# 提示词权限过滤：平台问题 vs 世界包问题

分析基于 `snowbound_mansion` 世界包的提示词组装全链路，区分 Yidhras 平台架构缺陷与该世界包设计失误。

> **状态更新（2026-05-14）：** 全部 10 项 8 已修复（P1-P8 + W1-W2 + W5-W6），仅 W3/W4（atmosphere/world context 的 visibility 语义）因无实际用例延后。

---

## 一、提示词组装全链路

### 1.1 修复前（实施前状态）

```
pack config (config.yaml)
  │
  ├─► prompts.global_prefix ──► InferenceContext.world_prompts
  │     (context_builder.ts:778 — 全量透传，无过滤)
  │
  ├─► entity state (actor.*, world.*)
  │     │
  │     ├─► pack_actor_state_snapshot (per-agent)
  │     └─► pack_world_state_snapshot (全局，全 agent 可见)
  │
  └─► plugins (snowbound-mastermind)
        └─► mastermind_context node (scope: agent)

context nodes ──► policy_engine.ts — evaluateContextPolicies()
                    (仅检查静态 policy_gate === 'deny'，不做动态权限求值)

selected nodes ──► workflow orchestrator
                    │
                    ├─► template_track.ts
                    │     world_context: 硬编码取 world_prompts['global_prefix']
                    │     role_core: default_template，不引用 world_prompts
                    │
                    ├─► node_track.ts
                    │     pack_world_state_snapshot → world_context slot
                    │     (visibility 全为 visible_fixed, policy_gate 全为 allow)
                    │
                    └─► fragment_assembly.ts
                          (permissions: null)

fragment tree ──► permission_filter.ts
                    │
                    └─► prompt_slot_permissions: false → 跳过
```

### 1.2 修复后（当前状态）

```
pack config (config.yaml)
  │
  ├─► prompts.global_prefix ──► world_context slot
  │     (template_key: "global_prefix", permissions: visible: true → 全员可见)
  │
  ├─► prompts.global_prefix_mastermind ──► world_context_mastermind slot
  │     (template_key: "global_prefix_mastermind", permissions: visible_to: ["capability:perceive.mastermind"])
  │
  ├─► prompts.agent_persona ──► role_core slot
  │     (template_key: "agent_persona", permissions: visible: true)
  │     (内含 {{#if actor.state.is_mastermind}} 条件分支)
  │
  └─► entity state
        │
        ├─► pack_actor_state_snapshot (per-agent, 不变)
        └─► pack_world_state_snapshot
              (visibility 由 agent_capabilities 动态决定:
               有 perceive.mastermind → visible
               无 → hidden, policy_gate: deny)

fragment tree ──► permission_filter.ts
                    │
                    └─► prompt_slot_permissions: true
                          capability:<key> token → 匹配 agent_capabilities
```

---

## 二、平台问题与修复

### P1. `prompt_slot_permissions` 默认关闭 — 已修复

**位置：** `features.ts:23` / `default.yaml:198`
**修复：** `false` → `true`

### P2. `world_context` / `system_policy` 权限配置有问题 — 已修复

**修复：**
- `system_policy` — 删除空 allowlist（`read: []`、`visible_to: []` 等），只保留 `visible: true`
- `world_context` — 添加 `permissions.visible: true`

### P3. `pack.prompts` 全量透传，无 per-agent 过滤 API — 已修复

**修复：**
- `PromptSlotConfig` 新增 `template_key` 字段，允许不同槽位取 `world_prompts` 中不同 key
- `template_track.ts` 使用 `config.template_key ?? 'global_prefix'` 解析
- 注册 `world_context_mastermind` 槽位（`template_key: "global_prefix_mastermind"`），由 `capability:perceive.mastermind` 控制可见性
- `role_core` 槽位改为 `template_context: world_prompts` + `template_key: "agent_persona"`，从世界包取 per-agent 模板

### P4. 模板引擎缺少条件渲染 — 已确认无需修复

**实际情况：** 核心模板引擎（`template_engine/core/`）和叙事前端（`frontends/narrative/`）的 lexer/parser/renderer 均已有完整的 `{{#if}}` / `{{else}}` / `{{/if}}` 支持：
- `defaults.ts:18-22` — 默认 syntax 注册了 `if` / `each` / `with` 关键字
- `defaults.ts:176-186` — 内置 `if` block handler（truthy 检查 + else 分支）
- `parser.ts:471-548` — 完整的 block 解析（嵌套 + else + 关闭关键字匹配）
- `renderer.ts:97-114` — block 节点渲染（查找 handler → 调用 → 递归渲染子节点）
- `frontends/narrative/blocks.ts:53-63` — 叙事 `if` handler（通过 narrative variable context 解析变量）
- `frontends/narrative/resolver.ts:133-151` — block 节点在叙事 AST 渲染中的 case 分支

`snowbound_mansion` 的 `agent_persona` 已使用 `{{#if actor.state.is_mastermind}}...{{else}}...{{/if}}`。

### P5. 能力系统与提示词可见性脱钩 — 已修复

**修复：**
- `InferenceContext` 新增 `agent_capabilities: string[]`，由 `context_builder.ts` 通过 `resolveAuthorityForSubject()` 填充
- `prompt_permissions.ts` 新增 `capability:<key>` token 支持：`expandCapabilityTokens()` 将 `capability:perceive.mastermind` 匹配到 agent 实际拥有的 capability keys
- `world_context_mastermind` 槽位使用 `visible_to: ["capability:perceive.mastermind"]`
- Authority 系统已支持 `all_actors` + `conditions_json: { subject_state.is_mastermind: "true" }` 条件批量授权（`resolver.ts:34-57`）

### P6. `policy_gate` 未动态填充 — 已修复（通过替代路径）

**实际情况：** 未直接修改 `policy_engine.ts` 中的 `policy_gate` 求值逻辑。而是通过两层机制绕过此问题：
1. Context node 层面：`runtime_state.ts` 中 `pack_world_state_snapshot` 的 visibility 在节点构建时根据 `agent_capabilities` 动态设置（`read_access: 'hidden'` / `policy_gate: 'deny'`），无需 `policy_engine` 做二次求值
2. Slot 层面：`world_context_mastermind` 通过 `permission_filter` 的 `capability:<key>` 检查控制

### P7. Fragment assembly 丢弃 context node visibility — 确认设计

**决议：** slot config 为权威入口，context node visibility 为补充。`permissions: null` 行为正确——fragment 级权限回退到 slot config，而 slot config 由平台统一管理。P6 的 context node 动态 visibility 在 fragment assembly 之前的 policy engine 阶段已生效（被 denied 的 node 不会进入 fragment assembly）。

### P8. `HOST_AGENT_TOKEN` 语义 — 已确认

世界包叙事视角。`capability:<key>` 作为补充方案保留。

---

## 三、世界包问题与修复

### W1. `global_prefix` 包含全体角色元信息 — 已修复

**修复：** 拆分为两个 prompt key：
- `global_prefix` — 仅公共信息（环境描述 + 基础规则），全员可见
- `global_prefix_mastermind` — 黑幕特权视角（全局状态 + 黑幕目标），仅 `capability:perceive.mastermind` 持有者可见

### W2. `agent_persona` 模板是死代码 — 已修复

**修复：** `role_core` 槽位改为 `template_context: world_prompts` + `template_key: "agent_persona"`。snowbound 的 `prompts.agent_persona` 现在被正确渲染。

### W3. `pack_world_state_snapshot` 泄露全局状态 — 已修复

**修复：** `runtime_state.ts` 中该节点的 visibility 由 `agent_capabilities` 动态决定。无 `perceive.mastermind` capability 的 agent 的 context node 被标记为 `read_access: 'hidden'` + `policy_gate: 'deny'`，在 policy engine 阶段被过滤。

### W4. 缺乏信息分层架构 — 已修复

**当前分层：**

| 层级 | 内容 | 可见范围 | 实现方式 |
|---|---|---|---|
| 公共 | 环境描述 + 基础规则 | 全员 | `global_prefix` → `world_context` slot（`visible: true`） |
| 角色 | 身份、性格、职业、秘密、行为准则 | 仅该 agent | `agent_persona` → `role_core` slot（per-agent variable context） |
| 特权 | 黑幕全局状态、团队动态 | `perceive.mastermind` 持有者 | `global_prefix_mastermind` → `world_context_mastermind` slot（`visible_to: ["capability:perceive.mastermind"]`）+ `pack_world_state_snapshot` context node（动态 visibility） |
| 感知 | 当前位置描述、同地点角色言行 | 同地点 agent | `spatial_proximity` context source（已有，未改动） |

### W5. `authorities` 不完整 — 已修复

**新增 authority grants：**
- `grant-move-all` — `move` → 所有 actor
- `grant-accuse-all` — `invoke.accuse` → 所有 actor
- `grant-reveal-secret-all` — `invoke.reveal_secret` → 所有 actor
- `grant-mastermind-perception` — `perceive.mastermind` → `is_mastermind: true` 的 actor（条件授权）

### W6. 位置描述全知视角 — ✅ 已修复（统一感知层，2026-05-14）

~~需要 location 描述拆分为 `public_description` + `hidden_details`，依赖 agent 的调查历史动态注入。超出本次提示词权限过滤范围，留待后续。~~

→ 已通过统一感知层完整实施（Tier 3），超出原始修复预期：
- `rules.perception` 类型化 schema 驱动事件感知 + 环境感知
- `PerceptionRuleEngine` 统一求值器，内置默认规则集
- `investigationCount` 替代二值 `hasInvestigated`，支持渐进揭示
- `hiddenDetails: string | string[] | null` 支持分段隐藏信息
- 详见 `.limcode/design/perception-pipeline-location-integration.md`

---

## 四、设计决策：双槽位 + `{{#if}}` 的防御深度

### 为什么 `global_prefix` 不用单一模板 `{{#if}}`？

技术上完全可行——`{{#if actor.state.is_mastermind}}` 在模板层面即可实现条件分支。选择双槽位而非单模板的原因是防御深度：

| 故障模式 | 单模板 `{{#if}}` | 双槽位 + `capability:` |
|---|---|---|
| 包作者漏写 `{{#if}}` | 特权内容全员泄露 | slot 权限拦截，不泄露 |
| 条件表达式写错（如 `is_mastermind` typo） | 静默失败，全员看到或全员看不到 | slot 权限独立于表达式，不受影响 |
| `actor.state.*` 变量未注入 | 条件评估失败，双分支行为不确定 | slot 权限走 capability，与变量注入无关 |
| 权限管线故障（feature flag 关闭） | 无保护 | 无保护（同） |

**当前分层策略：**
- **模板层 `{{#if}}`**：在 `agent_persona` 中使用，区分"黑幕目标"和"平民目标"这类必须 per-agent 区分的内容。模板层的灵活性适合"同一身份模板、不同角色目标"的场景。
- **Slot 层 capability**：在 `global_prefix` vs `global_prefix_mastermind` 中使用。slot 权限提供独立于模板的兜底保障，适合"这条信息一旦泄露就摧毁叙事"级别的敏感内容。
- **Context node 层 visibility**：在 `pack_world_state_snapshot` 中使用。系统注入的数据无法走模板，必须走 visibility/capability 路径。

---

## 五、Agent 行动调度对信息不对称的影响

### 5.1 调度模型

Agent 在一个 6 步串行循环中运行（`PackSimulationLoop.ts:247`）：

| 步骤 | 并行度 | 说明 |
|---|---|---|
| 1. 过期绑定清理 | 串行 | — |
| 2. 世界引擎推进 | 串行 | 1 tick |
| 3. Agent 调度 | 4 分区并行，分区内串行 | Rust 侧车排序候选 |
| 4. 推理执行 | 并发 2 | LLM 调用 |
| 5. Action 派发 | 并发 1（严格串行） | 逐个执行 action |
| 6. 感知管线 | 串行 | 生成空间 overlay |

**Step 3 排序规则**（`kernel.rs:156-166`）：
```
priority_score DESC → scheduled_for_tick ASC → partition_id ASC → agent_id ASC
```

事件驱动（`event_followup`）priority 30，碾压周期性（`periodic_tick`）priority 1。
关键约束：`entity_single_flight_limit: 1` — 每个 agent 同一时刻只能有一个活跃 workflow。

### 5.2 对信息不对称的直接影响

**a) 串行派发形成天然信息不对称窗口。** Step 5 严格串行。Agent A 的 action 派发完毕后 Agent B 才开始处理。B 可通过 Step 6 感知管线看到 A 的事件，但 A 看不到 B 的即时反应。

**b) 无打断/抢话机制。** 全代码库搜索 `interrupt`、`interject`、`interleave` 零结果。A 在 tick N 发消息 → B 最快 tick N+1 被调度 → tick N+1 派发响应。跨至少一个完整 tick 循环。

**c) 调度 priority 是隐式信息特权。** 高 priority agent 更早调度/执行/派发，决定"谁先说"。agent 自身不知道自己在队列中的 priority。

### 5.3 实现打断/抢话的架构需求

至少需要以下之一：
1. **同 tick action 互斥检查：** Step 5 派发时检查 `interjection` intent → 暂停 → 插入响应
2. **实时对话管道：** 不依赖 tick 循环的同步通信
3. **反应窗口：** A 派发后短窗口内允许 B 提交反制 action，优先派发

---

## 六、设计问题确认清单（全部已确认）

| 问题 | 结论 |
|---|---|
| Q1. `pack_world_state_snapshot` 公共字段 | 全部字段需权限/能力控制 |
| Q2. `agent_persona` 渲染路径 | `template_context: world_prompts` + `template_key: agent_persona` |
| Q3. `system_policy: read: []` | 占位符，已改为 `visible: true` |
| Q4. 权限权威来源 | slot config 为权威入口，context node visibility 为补充 |
| Q5. `host_agent` token | 世界包叙事视角 |
| Q6. Authority `target_selector` | 支持 `all_actors` + `conditions_json: { subject_state.<field>: <value> }` |
| Q7. 条件渲染位置 | `template_engine/core`（核心引擎）— 已确认基础设施完整 |
| Q8. `prompt_permissions` 测试 | 存在 6 个测试，feature flag 开启后正常执行 |
| Q9. 多 pack 运行时 | 当前无 agent 跨 pack 存在，非问题 |

---

## 七、优先级总结

| 优先级 | 编号 | 类型 | 问题 | 状态 |
|---|---|---|---|---|
| **P0** | P1 | 平台 | `prompt_slot_permissions` 默认关闭 | ✅ 已修复 |
| **P0** | P3 | 平台 | `pack.prompts` 无 per-agent 过滤 API | ✅ 已修复 |
| **P1** | P2 | 平台 | `system_policy` 空 allowlist | ✅ 已修复 |
| **P1** | P4 | 平台 | 模板引擎无条件渲染 | ✅ 已确认基础设施完整 |
| **P1** | P5 | 平台 | 能力系统与提示词脱钩 | ✅ 已修复 |
| **P1** | W3 | 世界包 | `pack_world_state_snapshot` 全量泄露 | ✅ 已修复 |
| **P1** | W4 | 世界包 | 缺乏显式信息分层 | ✅ 已修复 |
| **P2** | P6 | 平台 | `policy_gate` 未动态填充 | ✅ 已修复（替代路径） |
| **P2** | P7 | 平台 | Fragment 丢弃 context node visibility | ✅ 确认设计无问题 |
| **P2** | P8 | 平台 | `host_agent` 语义 | ✅ 已确认 |
| **P2** | W1 | 世界包 | `global_prefix` 元信息泄露 | ✅ 已修复 |
| **P3** | W2 | 世界包 | `agent_persona` 死代码 | ✅ 已修复 |
| **P3** | W5 | 世界包 | `authorities` 不完整 | ✅ 已修复 |
| **P3** | W6 | 世界包 | 位置描述全知视角 | ✅ 已修复（统一感知层） |

---

## 八、相关文档

- 实施计划：`.limcode/plans/prompt-permission-filtering-implementation.md`
- Authority 实现：`apps/server/src/domain/authority/resolver.ts`
- Agent 调度：`apps/server/src/app/runtime/agent_scheduler.ts`、`apps/server/rust/scheduler_decision_sidecar/src/kernel.rs`
- 提示词权限管线：`apps/server/src/inference/prompt_permissions.ts`、`apps/server/src/context/workflow/executors/permission_filter.ts`
- 模板引擎：`apps/server/src/template_engine/core/`、`apps/server/src/template_engine/frontends/narrative/`
- 现有测试：`apps/server/tests/unit/prompt_permissions.spec.ts`
