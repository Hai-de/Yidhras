# snowbound_mansion 世界包升级差距分析与修复方案

> 参照系：`docs/specs/WORLD_PACK.md` 发布规范、`worldPackConstitutionSchema` 完整合约、scaffold 模板默认结构、`world-death-note` 参考实现。
>
> 本文档记录 snowbound_mansion 从原型包升级为正式包所需补齐的内容，每个问题附修复方案。

---

## 1. 现状摘要

snowbound_mansion 当前文件清单：

```
snowbound_mansion/
├─ pack.yaml                                ← 入口清单（schema_version + metadata + include）
├─ config/
│  ├─ variables.yaml                        ← 变量池（当前为死数据，未被实体引用）
│  ├─ prompts.yaml                          ← 提示词模板（6 个模板变量绑定断裂）
│  ├─ time_systems.yaml                     ← 时间系统定义（game_clock）
│  ├─ simulation_time.yaml                  ← 模拟时钟参数
│  ├─ entities.yaml                         ← 实体层（15 地点 + 12 同质化角色，0 artifact/mediator）
│  ├─ identities.yaml                       ← 身份映射（12 个 agent）
│  ├─ capabilities.yaml                     ← 能力声明（5 个，远不足）
│  ├─ authorities.yaml                      ← 权限授予（5 个 intrinsic all_actors）
│  ├─ rules.yaml                            ← 规则（5 感知 + 0 invocation + 1 空 objective）
│  ├─ bootstrap.yaml                        ← 初始世界状态 + 空间初始位置（含变量引用错误）
│  ├─ spatial.yaml                           ← 空间拓扑（15 节点 + 15 条边）
│  └─ ai.yaml                               ← AI 配置（仅 defaults）
├─ runtime.sqlite                           ← 运行时产物
├─ runtime.sqlite.storage-plan.json         ← 运行时产物
└─ plugins/
   ├─ snowbound-game-loop/
   │  ├─ plugin.manifest.yaml               ← source: "server.js" 但文件是 server.ts
   │  └─ server.ts
   └─ snowbound-mastermind/
      ├─ plugin.manifest.yaml               ← source: "server.js" 但文件是 server.ts
      └─ server.ts
```

缺失：README.md、CHANGELOG.md、LICENSE、docs/、assets/、examples/、storage.yaml。metadata.status = "prototype"。

---

## 2. P0 — 运行时功能断裂

### 2.1 模板变量绑定断裂

**问题**：`prompts.yaml` 中 `global_prefix_mastermind` 和 `agent_persona` 使用的 9 个模板变量在运行时解析为空字符串。

模板引擎层顺序为 `system → app → pack → runtime → actor → request`（`context_builder.ts:631`）。不存在 `world` 层。`actor` 层只有 `identity_id`/`display_name`/`role` 等，没有 `state` 子键。

受影响变量：

| prompts.yaml 中的写法 | 解析结果 | 正确路径 |
|-----------------------|---------|----------|
| `{{ world.day }}` | 空字符串 | `{{ runtime.world_state.day }}` |
| `{{ world.total_days }}` | 空字符串 | `{{ runtime.world_state.total_days }}` |
| `{{ world.alive_count }}` | 空字符串 | `{{ runtime.world_state.alive_count }}` |
| `{{ world.masterminds_alive }}` | 空字符串 | `{{ runtime.world_state.masterminds_alive }}` |
| `{{ world.team_dynamic }}` | 空字符串 | `{{ runtime.world_state.team_dynamic }}` |
| `{{ actor.state.personality }}` | 空字符串 | `{{ runtime.pack_state.actor_state.personality }}` |
| `{{ actor.state.profession }}` | 空字符串 | `{{ runtime.pack_state.actor_state.profession }}` |
| `{{ actor.state.secret }}` | 空字符串 | `{{ runtime.pack_state.actor_state.secret }}` |
| `{{ actor.state.is_mastermind }}` | 空字符串 | `{{ runtime.pack_state.actor_state.is_mastermind }}` |

**影响**：黑幕信息优势机制完全失效；角色身份与行为准则注入全部丢失。

**注意**：`{{ runtime.pack_state.actor_state.* }}` 在每次推理请求中只注入当前 actor 的状态，而非全局角色列表。这意味着 `agent_persona` 中每个角色获取自身属性是可行的，但不能通过此路径获取其他角色的属性。

**修复**：将 `prompts.yaml` 中所有 `{{ world.* }}` 改写为 `{{ runtime.world_state.* }}`，将 `{{ actor.state.* }}` 改写为 `{{ runtime.pack_state.actor_state.* }}`。

### 2.2 bootstrap event_prefix 变量引用错误

**问题**：`bootstrap.yaml:12` 写 `{{pack.variables.location_type_pool}}`，但 `variables.yaml` 中的键名是 `location_types`（非 `location_type_pool`）。模板解析时返回空字符串。

**修复**：改为 `{{ pack.variables.location_types }}`。更好的方案是直接引用 bootstrap 同文件内的世界状态值：改为 `{{ world_state.location_type }}`，因为 `event_prefix` 应该反映实际生成的场景（而非变量池定义）。

### 2.3 rules.invocation 完全缺失

**问题**：声明了 5 个 capabilities + 5 个 authorities，但没有任何 invocation 规则。AI 生成的意图无法落地为能力调用。

**修复**：为每个现有能力补充精确落地规则，并为常见非结构化意图补充翻译和叙述化规则。最小可运行集：

```yaml
invocation:
  - id: invocation-move
    when:
      semantic_intent.kind: move
    then:
      affordance_key: move_to_location
      requires_capability: move
      resolution_mode: exact
      translate_to_capability: move
      explanation: 将移动意图落地为空间转移。
  - id: invocation-investigate
    when:
      semantic_intent.kind: investigate
    then:
      affordance_key: investigate_location
      requires_capability: invoke.investigate
      resolution_mode: exact
      translate_to_capability: invoke.investigate
      explanation: 将调查意图落地为结构化调查行为。
  - id: invocation-look-around
    when:
      semantic_intent.kind: look_around
    then:
      affordance_key: observe_environment
      resolution_mode: narrativized
      explanation: 四处看看不改变世界状态，仅生成环境描述。
      narrativize_event:
        type: observation
        title: '{{ actor.id }} 四处观察了当前环境'
        impact_data:
          semantic_type: environment_observation
          failed_attempt: false
          objective_effect_applied: false
  - id: invocation-accuse
    when:
      semantic_intent.kind: accuse
    then:
      affordance_key: accuse_person
      requires_capability: invoke.accuse
      resolution_mode: exact
      translate_to_capability: invoke.accuse
      explanation: 将指控意图落地为正式公审指控。
  - id: invocation-reveal-secret
    when:
      semantic_intent.kind: reveal_secret
    then:
      affordance_key: reveal_secret_to
      requires_capability: invoke.reveal_secret
      resolution_mode: exact
      translate_to_capability: invoke.reveal_secret
  - id: invocation-mastermind-perception
    when:
      semantic_intent.kind: check_mastermind_info
    then:
      affordance_key: observe_mastermind_info
      resolution_mode: narrativized
      explanation: 黑幕信息通过上下文注入获取，此意图只作为确认标记。
      narrativize_event:
        type: history
        title: '{{ actor.id }} 回顾了只有黑幕才能看到的信息'
        impact_data:
          semantic_type: mastermind_info_checked
          objective_effect_applied: false
```

### 2.4 rules.objective_enforcement 几乎为空

**问题**：唯一规则 `rule-investigate` 无 mutate 块，不改变任何世界状态。

**修复**：至少补充 3 条核心规则（investigate、accuse、reveal_secret），每条包含完整的 mutate 块和事件发射。参照 world-death-note 的 `objective-execute-death-note` 模式：

```yaml
objective_enforcement:
  - id: objective-investigate
    when:
      capability: invoke.investigate
      invocation_type: invoke.investigate
    then:
      mutate:
        subject_state:
          investigation_count: '{{ subject_state.investigation_count + 1 }}'
        world_state:
          last_investigation_tick: '{{ invocation.tick }}'
      emit_events:
        - type: history
          title: '{{ actor.id }} 进行了调查'
          impact_data:
            semantic_type: investigation_conducted
            objective_effect_applied: true
  - id: objective-accuse
    when:
      capability: invoke.accuse
      invocation_type: invoke.accuse
      target.kind: actor
    then:
      mutate:
        subject_state:
          has_accused: true
          accused_target_id: '{{ invocation.target_entity_id }}'
        world_state:
          accusation_count: '{{ world_state.accusation_count + 1 }}'
      emit_events:
        - type: history
          title: '{{ actor.id }} 公开指控 {{ target.id }}'
          impact_data:
            semantic_type: accusation_made
            objective_effect_applied: true
  - id: objective-reveal-secret
    when:
      capability: invoke.reveal_secret
      invocation_type: invoke.reveal_secret
      target.kind: actor
    then:
      mutate:
        target_state:
          knows_secret_of: '{{ invocation.subject_entity_id }}'
      emit_events:
        - type: history
          title: '{{ actor.id }} 向 {{ target.id }} 透露了秘密'
          impact_data:
            semantic_type: secret_revealed
            objective_effect_applied: true
```

---

## 3. P0 — 包完整性缺失

### 3.1 无 README.md

**修复**：创建 `README.md`，按 WORLD_PACK.md 模板覆盖：世界前提、核心机制、实体/能力/规则概览、已知限制、安装方式。

### 3.2 metadata.status 仍为 "prototype"

**修复**：`pack.yaml` 中将 `metadata.status` 从 `"prototype"` 改为 `"beta"`。

---

## 4. P1 — 规则与 AI 管道缺失

### 4.1 实体层缺失

**artifacts**：0 个。悬疑推理场景的物品是核心叙事驱动力。现有 domain `hidden_details` 暗示了物品存在但未一等实体化。

最少需要 3 个核心物品以验证 mediator 链路：

| artifact_id | 说明 | 核心状态字段 |
|-------------|------|------------|
| `weapon_knife` | 厨房剁骨刀 | holder_id, location, blood_stained |
| `key_master` | 主人房钥匙 | holder_id, used |
| `anonymous_letter` | 匿名信 | holder_id, read_by |

**mediators**：0 个。需要至少 1 个 mediator 验证「持有物品 → 获得能力」链路：

| mediator_id | mediator_kind | 触发能力 |
|-------------|--------------|---------|
| `mediator-weapon-knife` | `weapon_binding` | 持有 `weapon_knife` → 获得 `invoke.kill` |

### 4.2 capabilities 不足

当前 5 个（move, invoke.investigate, invoke.accuse, invoke.reveal_secret, perceive.mastermind）不足以支撑悬疑推理的核心交互。

最小扩充集（P1 必需）：

| capability_key | category | 说明 |
|----------------|----------|------|
| `invoke.kill` | invoke | 暗杀（需 mediator 授权） |
| `invoke.vote` | invoke | 公审投票 |

### 4.3 authorities 全部 intrinsic all_actors

所有 5 个权限都是 `intrinsic` + `all_actors`，无法实现条件化授权。需要：

- `invoke.kill` 通过 mediator 授权（持有凶器时才获得）
- `invoke.vote` 条件化（只有 alive 角色可投票）
- 夜间/发现尸体场景下阶段性开放/关闭能力（通过 capability_resolution 规则或插件实现）

### 4.4 AI 配置极简

`ai.yaml` 仅有 `defaults`（3 字段）。需要补充：

```yaml
memory_loop:
  summary_every_n_rounds: 5
  compaction_every_n_rounds: 10
tasks:
  agent_decision:
    prompt:
      preset: snowbound_agent_decision_v1
      include_sections:
        - actor_profile
        - pack_rules
        - recent_events
        - overlay_notes
    parse:
      decoder: default_json_schema
    route:
      route_id: default.agent_decision
      provider: openai
      model: gpt-4.1-mini
  intent_grounding_assist:
    prompt:
      preset: snowbound_intent_grounding_v1
      include_sections:
        - packRules
        - recent_events
    parse:
      decoder: default_json_schema
    route:
      route_id: default.context_summary
      provider: openai
      model: gpt-4.1-mini
  context_summary:
    prompt:
      preset: snowbound_context_summary_v1
      include_sections:
        - packRules
        - recent_events
        - overlay_notes
  memory_compaction:
    prompt:
      preset: snowbound_memory_compaction_v1
      include_sections:
        - memory_summary
        - recent_events
  classification:
    prompt:
      preset: snowbound_classification_v1
```

### 4.5 storage 缺失

`pack.yaml` 的 `include` 中无 `storage` 条目。

修复：创建 `config/storage.yaml` 并在 `pack.yaml` 的 `include` 中添加 `storage: "config/storage.yaml"`。最小集合参照 world-death-note 模式：

```yaml
strategy: isolated_pack_db
runtime_db_file: runtime.sqlite
pack_collections:
  - key: investigation_logs
    kind: table
    primary_key: id
    fields:
      - key: id
        type: string
        required: true
      - key: investigator_id
        type: entity_ref
        required: true
      - key: location_id
        type: entity_ref
      - key: tick
        type: string
      - key: findings
        type: json
      - key: hidden_revealed
        type: boolean
    indexes:
      - - investigator_id
      - - location_id
  - key: accusation_records
    kind: table
    primary_key: id
    fields:
      - key: id
        type: string
        required: true
      - key: accuser_id
        type: entity_ref
        required: true
      - key: target_id
        type: entity_ref
        required: true
      - key: tick
        type: string
      - key: evidence_refs
        type: json
      - key: outcome
        type: string
    indexes:
      - - accuser_id
      - - target_id
  - key: death_records
    kind: table
    primary_key: id
    fields:
      - key: id
        type: string
        required: true
      - key: victim_id
        type: entity_ref
        required: true
      - key: location_id
        type: entity_ref
      - key: tick
        type: string
        required: true
      - key: cause
        type: string
      - key: discovered_by
        type: entity_ref
      - key: discovered_at_tick
        type: string
    indexes:
      - - victim_id
      - - tick
install:
  compile_on_activate: true
  allow_pack_collections: true
  allow_raw_sql: false
```

---

## 5. P1 — 提示词与变量系统

### 5.1 提示词硬编码

`global_prefix` 硬编码了"暴风雪"和"深山中的独栋别墅"，但 `bootstrap.yaml` 会随机选择场景和地点类型。

**修复**：将 `prompts.yaml` 中的硬编码场景文本替换为模板变量引用。`global_prefix` 改为：

```yaml
global_prefix: |
  你正在一个封闭的环境中。{{ runtime.world_state.scenario }}，导致与外界的一切联系完全中断。
  你所在的地点是一个{{ runtime.world_state.location_type }}。
  与你一同被困在此地的还有另外 11 个人。你们需要在这里生存 7 天，直到救援到来。

  核心规则：
  - 你只能看到和听到你当前所在位置发生的事情。其他房间发生的事你一无所知，除非有人主动告诉你。
  - 你的所有对话和行动默认只有同地点的人能看到。私密对话需要明确指定目标。
```

`global_prefix_mastermind` 和 `agent_persona` 中的 `{{ world.* }}` 和 `{{ actor.state.* }}` 改为 `{{ runtime.world_state.* }}` 和 `{{ runtime.pack_state.actor_state.* }}`。

### 5.2 variables.yaml 为死数据

`entities.yaml` 中 12 个角色的 `{{pick from=[...]}}` 全部使用内联数组，与 `variables.yaml` 的 YAML 列表无引用关系。`bootstrap.yaml` 中 scenario/location_type/team_dynamic 同样内联。

**修复**：将 `entities.yaml` 和 `bootstrap.yaml` 中的内联列表替换为 `{{pack.variables.*}}` 引用。例如：

```yaml
name: "{{pick from=pack.variables.names}}"
personality: "{{pick from=pack.variables.personalities}}"
```

**注意**：`pick` 宏的 `from` 参数同时支持 JSON 数组字符串和实际数组对象（见 `defaults.ts:127-138`）。`{{pack.variables.names}}` 在模板解析后产生一个数组对象，可以直接作为 `from` 参数使用。但需要确认宏处理器在实体化阶段是否能正确接收模板层解析后的数组引用——如果引擎对 `from` 做了字符串分割而非类型检查，则需要保留内联形式。这是实现计划中需要验证的一个点。

如果 `{{ pack.variables.names }}` 路径可行，则消除了 12×5 = 60 处内联重复 + 3 处 bootstrap 重复，使 `variables.yaml` 成为唯一数据源。

### 5.3 bootstrap 与 entities 初始位置集合不一致

`bootstrap.yaml` 中角色初始位置池不含 `corridor_2f`，但 `entities.yaml` 中各角色的 `initial_location` 含 `corridor_2f`。

**修复**：统一为相同的位置池。由于 bootstrap 的空间初始化覆盖 entities 的 `initial_location`，最安全的做法是在 `bootstrap.yaml` 的位置池中也加入 `corridor_2f`（如果允许角色在二楼开始）或从 `entities.yaml` 的 `initial_location` 中移除 `corridor_2f`（如果一楼起始是设计意图）。

---

## 6. P1 — 角色系统

### 6.1 高度同质化

12 个角色使用相同 `{{pick}}` 模板，存在三个问题：

1. **重复风险**：`pick` 宏对每个调用独立随机（`defaults.ts:127` 用 `fisherYatesShuffle` + `slice`），不同角色可能抽到相同名字/职业/秘密。
2. **黑幕分配不可控**：每个角色独立 `pick from=['false',..., 'true',...]`，概率约 9%/角色。12 人中 0 个黑幕的概率 ≈ 31.8%，4+ 个黑幕的概率 ≈ 6.1%，与 `world.masterminds_alive` 的 `{{int min=1 max=3}}` 矛盾。
3. **缺乏叙事结构**：`variables.team_dynamics` 描述了角色关系（如"至少三人是老相识"），但角色层面没有机制支撑。

**修复**：

- 黑幕分配：将 12 个角色的 `is_mastermind` 固定为 `false`，改为在 `bootstrap.yaml` 的 world state 中用 `{{pick from=['char_03','char_07','char_11'] count=2}}` 一次性选出 1-2 个黑幕角色 ID，然后在 game-loop 插件中将对应角色的 `is_mastermind` 设置为 `true`。
- 角色模板分化：至少定义 2-3 组差异化角色（黑幕角色、调查型角色、普通角色），用不同的 personality 池和 secret 池。
- 关系预置：在 bootstrap 中定义 2-3 组预设关系条目。

---

## 7. P2 — 插件系统

### 7.1 source 字段与实际文件不匹配

两个插件的 `plugin.manifest.yaml` 均声明 `source: "server.js"`，实际文件为 `server.ts`。

加载链路：`runtime.ts:559` 拼接路径后做 `import(entrypointPath)`。开发环境 `tsx` 会回退到 `.ts`，生产环境 `node dist/index.js` 会抛出 `ERR_MODULE_NOT_FOUND`。

当前两个插件只使用了 `import type`，运行时被擦除不会导致导入失败。但如果将来添加 value import（如 `import { someFunction } from '...'`），生产环境将崩溃。

**修复**：将 `plugin.manifest.yaml` 中的 `source: "server.js"` 改为 `source: "server.ts"`，或在打包流程中编译 `.ts` 为 `.js`。

### 7.2 导入路径脆弱

两个插件使用 5 层相对路径：`'../../../../../apps/server/src/...'`。

**修复**：等待引擎提供 plugin SDK 导出路径后替换。如果引擎已经有 `@yidhras/plugin-sdk` 或类似的包导出，应优先使用。短期可维持现状但加注释标记。

### 7.3 game-loop 插件功能不足

当前只实现了日推进。完整游戏循环需要：自由活动阶段、调查阶段、公审阶段、夜间阶段、终局判定。

**修复**：分步实现。P1 阶段至少补充夜间/白天的能力开放/关闭逻辑和终局判定事件。完整游戏阶段循环为 P2。

---

## 8. P2 — 项目化资产与文档

| 缺失项 | 修复 |
|--------|------|
| `CHANGELOG.md` | 创建，记录从 prototype 到 beta 的所有变更 |
| `LICENSE` | 如计划开放分发，添加 |
| `docs/setting.md` | 详细世界设定：暴风雪山庄背景故事、建筑历史 |
| `docs/rules.md` | 游戏规则详解：阶段流程、胜负条件、能力使用规则 |
| `examples/overrides.example.yaml` | 覆盖配置示例 |
| `assets/` | 封面图、地图示意图 |
| `metadata.presentation` | 填充 cover_image/icon/theme |

---

## 9. 对比矩阵（校正版）

| 维度 | snowbound_mansion | world-death-note | 差距 |
|------|-------------------|------------------|------|
| README.md | 无 | 有 | 需补 |
| CHANGELOG.md | 无 | 有 | 需补 |
| entities.actors | 12 个（同质化模板） | 3 个（精心设计） | 质量差距 |
| entities.artifacts | 0 | 1 | 需补 |
| entities.mediators | 0 | 1 | 需补 |
| entities.domains | 15 | 3 | snowbound 更丰富 |
| capabilities | 5 | 11 | 需扩充 |
| authorities | 5（全部 intrinsic） | 11（含 mediated + conditional） | 需扩充 |
| rules.perception | 5 条 | 0 条 | snowbound 更丰富 |
| rules.invocation | 0 条 | 21 条 | **严重缺失** |
| rules.objective_enforcement | 1 条（无 mutate） | 11 条（完整 mutate） | **严重缺失** |
| rules.capability_resolution | 0 | 0 | 双方均缺 |
| rules.projection | 0 | 0 | 双方均缺 |
| ai.tasks | 0 | 5 | 需补 |
| ai.memory_loop | 无 | 有 | 需补 |
| storage.pack_collections | 0 | 3 | 需补 |
| spatial | 15 地点 + 15 边 | 无 | snowbound 更丰富 |
| plugins | 2 个（仅 type import） | 0 | snowbound 更丰富 |
| prompts 模板变量 | 9 个断裂变量 | 正确引用 | **P0 需修** |
| variables.yaml | 死数据（内联 pick） | 被 `{{ pack.variables.* }}` 引用 | 需修 |
| 模板变量路径 | 使用不存在的 `{{ world.* }}` | 未使用跨层引用 | **P0 需修** |

---

## 10. 总结

snowbound_mansion 的空间模型和插件体系已经验证了核心管线。升级为正式包的三大核心差距：

1. **模板变量管道断裂**（P0）：`prompts.yaml` 中 `{{ world.* }}` 和 `{{ actor.state.* }}` 全部解析为空，导致黑幕信息优势和角色身份注入完全失效。修复路径明确：改用 `{{ runtime.world_state.* }}` 和 `{{ runtime.pack_state.actor_state.* }}`。

2. **意图→状态管道缺失**（P0）：0 条 invocation 规则 + 唯一 objective 规则无 mutate 块，意味着能力声明形同虚设。需要补充最小 5 条 invocation 规则 + 3 条 objective 规则。

3. **一等实体和动态权限不足**（P1）：没有 artifacts 和 mediators，所有能力只能 intrinsic all_actors 授权，无法实现基于物品的条件化权限。需要至少 3 个 artifacts + 1 个 mediator + 2 个新能力 + 对应 authorities 验证链路。