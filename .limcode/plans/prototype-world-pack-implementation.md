# 原型世界包实施计划

> 来源: `.limcode/design/prototype-world-pack-implementation.md` · Phase 0-2 平台基础设施已完成
> 状态: 计划
> 创建: 2026-05-09

## 目标

在 `data/world_packs/snowbound_mansion/` 下创建暴风雪山庄原型世界包，端到端验证平台空间基础设施全链路。

配置能做的放 config.yaml，配置做不到的用 pack-local 插件，暴露项目短板。

## 已确认决策

| 决策 | 结论 |
|------|------|
| 实体 label | 占位符（"角色1"…"角色15"），真实名字在 `state.name` 中，宏展开 |
| 配置 vs 插件 | 配置优先，配置承载不了的用 pack-local 插件 |
| 黑幕全知 | 不提供完全全知。走感知管线 + capability 绑定权限，黑幕比普通角色多一些感知但非无限 |
| 信息不对称 | 平台感知管线（sim loop step 6）自动处理，配置只需声明 event 的 `location_id` 和 `visibility` |

## config.yaml 设计

### 空间模型（15 个地点）

```
大厅 ←→ 餐厅 ←→ 厨房 ←→ 储藏室
 ↕              ↕        ↕
图书室 ←→ 娱乐室    洗衣房
 ↕              ↕
走廊(1F) ←→ 楼梯间 ←→ 走廊(2F)
              ↕
        卧室1…卧室8
         ↕
        阳台 ←→ 阁楼
```

连通性：一楼主公共区（大厅/餐厅/厨房/图书室/娱乐室）高度连通；二楼卧室沿走廊排列；地下室和阁楼为孤立端点。

```yaml
spatial:
  model: discrete
  locations:
    - id: lobby
    - id: dining_room
    - id: kitchen
    - id: library
    - id: game_room
    - id: storage
    - id: laundry
    - id: corridor_1f
    - id: stairwell
    - id: corridor_2f
    - id: bedroom_1
    - id: bedroom_2
    - id: bedroom_3
    - id: balcony
    - id: attic
  edges:
    # 一楼
    - {from: lobby, to: dining_room, type: bidirectional, weight: 1}
    - {from: lobby, to: library, type: bidirectional, weight: 1}
    - {from: dining_room, to: kitchen, type: bidirectional, weight: 1}
    - {from: kitchen, to: storage, type: bidirectional, weight: 1}
    - {from: kitchen, to: laundry, type: bidirectional, weight: 1}
    - {from: library, to: game_room, type: bidirectional, weight: 1}
    - {from: library, to: corridor_1f, type: bidirectional, weight: 1}
    - {from: corridor_1f, to: stairwell, type: bidirectional, weight: 1}
    # 二楼
    - {from: stairwell, to: corridor_2f, type: bidirectional, weight: 1}
    - {from: corridor_2f, to: bedroom_1, type: bidirectional, weight: 1}
    - {from: corridor_2f, to: bedroom_2, type: bidirectional, weight: 1}
    - {from: corridor_2f, to: bedroom_3, type: bidirectional, weight: 1}
    - {from: corridor_2f, to: balcony, type: bidirectional, weight: 1}
    - {from: balcony, to: attic, type: bidirectional, weight: 1}
```

### 角色生成（12 个 agent）

每个角色用宏从 trait 池随机选取属性，物化时展开。`entities.domains` 定义 15 个地点 entity，`entities.actors` 定义 12 个角色 entity。

角色 state 结构：
```yaml
state:
  name: "{{pick from=张伟,李娜,王刚,...}}"          # 物化时随机选取
  personality: "{{pick from=偏执多疑,冷静理性,...}}"
  profession: "{{pick from=医生,律师,...}}"
  secret: "{{pick from=隐藏了真实身份,...}}"
  is_mastermind: "{{pick from=false,false,false,false,false,false,true}}"  # 1/7 概率
  alive: true
  initial_location: "{{pick from=lobby,dining_room,library,game_room}}"
```

Trait 池定义在 `variables` 段（20+ 选项每维度），保证组合多样性。

### 身份与权限

每个角色一个 `identity`（`type: agent`），绑定 `subject_entity_id`。

权限分配：
- 所有角色：`move`、`post_message`（公开/私密对话）、`invoke.investigate`（调查）
- 黑幕额外：感知范围扩展（通过 `perception.*` capability，具体机制待插件实现）

### 引导态（bootstrap）

```yaml
bootstrap:
  initial_states:
    - entity_id: __world__
      state_namespace: world
      state_json:
        scenario: "{{pick from=暴风雪,暴雨,浓雾,山洪,雪崩}}导致与外界联系完全中断"
        day: 1
        total_days: 7
```

### 规则

| 规则 | 触发 | 说明 |
|------|------|------|
| move | `invoke.move` + `location.adjacent_to` | 平台已实现 |
| investigate | `invoke.investigate` + `location.in` | 调查同地点线索，返回发现 |
| post_public | `invoke.post_message` | 同地点所有人可见 |
| post_private | `invoke.post_message` + `visibility: private` | 仅指定目标可见 |
| daily_task | 每日 12:00 触发 | 插件实现（见下方） |
| death_check | 每日 07:00 触发 | 插件实现 |

## 插件设计

配置承载不了的逻辑由 pack-local 插件实现。原型需要的插件：

### 插件 1: `snowbound-game-loop`

**职责**：每日任务生成、分发、死亡判定、通关检查。

**注册的扩展点**：
- `registerStepContributor` — 在 sim loop 中注册每日任务检查步骤
- 使用 `PackHostApi` 读取世界状态、创建 event、调整 entity state

**逻辑**：
1. 当前世界 time → 定位到"天"（利用 calendar system）
2. **每日 12:00**：为每个存活非黑幕角色生成当日任务（调用 AI），以 `visibility: private` 事件分发
3. **每日 07:00**：检查前一日任务完成情况 → 未完成者标记 `alive: false`，生成尸体发现事件（`location_id` 为角色最后所在位置）
4. **通关条件**：所有黑幕死亡或被指控 → 封闭解除

**需要暴露的短板**：
- 插件是否有能力触发 AI 推理？当前 `ServerPluginHostApi` 是否有 `requestInference()` 或类似方法？
- 当前插件 API 的 pack 作用域是否足够？

### 插件 2: `snowbound-mastermind`

**职责**：黑幕感知扩展、AI 行为引导。

**注册的扩展点**：
- `registerPerceptionResolver`（如果平台支持）— 覆盖默认感知，黑幕可感知邻接房间的 public 事件

**备选**（如果无法注册自定义 resolver）：在 prompt 中注入全局状态摘要，给黑幕更强的推理上下文。

### 插件能力边界验证

原型世界包同时也是插件体系的压力测试。计划验证：
- `registerStepContributor` 能否在 sim loop 中正常工作
- 插件能否通过 host API 读写 entity state
- 插件能否创建事件（含 `location_id`、`visibility`）
- 插件能否在 pack scope 下调用 AI 推理

## AI 推理配置

每个 agent 决策时收到的上下文由平台自动组装：

1. **spatial_proximity context source**（已实现）→ "你当前在 {location}，邻接地点有 {adjacent}"
2. **perception overlay**（已实现）→ 当前 tick 感知到的事件
3. **actor state** → 从 entity state 读取 `{name, personality, profession, secret, is_mastermind, alive}`

需要配置的 AI 部分：
- `prompts.global_prefix` — 世界观设定文本
- `prompts.agent_persona` — 角色扮演提示（从 state 注入 trait）
- `ai.slots` — slot 配置（决策 slot、对话 slot）
- `ai.defaults` — prompt preset + decoder

## 实施阶段

### Phase 1: 最小可加载 config.yaml

- metadata
- variables（trait 池）
- simulation_time + time_systems
- entities（15 domains + 12 actors）
- spatial（15 locations + edges）
- identities（12 个）
- bootstrap（世界初始状态 + 角色初始位置宏展开）

**验证**：`pnpm validate:pack snowbound_mansion` 通过 → 加载成功 → entity_states 含展开后的 trait

### Phase 2: 能力与规则

- capabilities（move, post_message, invoke.investigate, invoke.accuse）
- authorities（分配给所有角色）
- rules.objective_enforcement（move, investigate, post_message）
- prompts（global_prefix, agent_persona）
- ai 配置（slots, defaults）

**验证**：agent 能发出 move intent → dispatch 成功 → 位置更新

### Phase 3: 插件（game loop + mastermind）

- `plugins/snowbound-game-loop/` — 每日任务 + 死亡 + 通关
- `plugins/snowbound-mastermind/` — 黑幕感知 + AI 引导

**验证**：多 tick 运行 → 每日任务生成 → 角色移动 + 调查 → 感知管线过滤 → 不同 agent 看到不同信息子集

### Phase 4: 端到端

- 完整 7 天模拟周期
- 回归测试（确保新 pack 不破坏现有功能）

## 预期暴露的短板

以下是在实施前即可预见的问题，将在实施过程中记录：

1. **插件的 AI 推理能力** — `ServerPluginHostApi` 是否支持插件触发推理？如果不支持，每日任务生成无法走 AI
2. **插件的 sim loop 集成** — `registerStepContributor` 的调度粒度是否支持"每日 12:00"这种时间条件？
3. **自定义 PerceptionResolver 注册** — 如果平台不支持插件注册 resolver，黑幕的扩展感知只能走 prompt 工程
4. **entity state schema 无约束** — `state_json` 是 schemaless JSON，macros 展开后的值没有类型校验。角色名可能为空、`is_mastermind` 可能是 invalid 值
5. **大规模 agent 推理的 token 成本** — 12 个 agent 每 tick 各自推理，token 消耗巨大
6. **叙事连贯性** — 全 AI 自主驱动的多 agent 叙事在没有 GM（游戏管理员）协调的情况下，可能产生不连贯的剧情
