# snowbound_mansion 升级实施计划

> 依赖：`.limcode/design/snowbound-mansion-promotion-gap-analysis.md`
>
> 每个步骤包含：目标、修改文件、修改内容、验证条件。

---

## Step 1: 修复模板变量绑定（P0）

### 1a. 修复 prompts.yaml 变量路径

**文件**: `data/world_packs/snowbound_mansion/config/prompts.yaml`

**修改**:

将 `global_prefix` 中的硬编码场景描述替换为模板变量：

```yaml
global_prefix: |
  你正在一个封闭的环境中。{{ runtime.world_state.scenario }}，导致与外界的一切联系完全中断。
  你所在的地点是一个{{ runtime.world_state.location_type }}。
  与你一同被困在此地的还有另外 11 个人。你们需要在这里生存 7 天，直到救援到来。

  核心规则：
  - 你只能看到和听到你当前所在位置发生的事情。其他房间发生的事你一无所知，除非有人主动告诉你。
  - 你的所有对话和行动默认只有同地点的人能看到。私密对话需要明确指定目标。
```

将 `global_prefix_mastermind` 中的 `{{ world.* }}` 替换为 `{{ runtime.world_state.* }}`：

```yaml
global_prefix_mastermind: |
  你正在一个封闭的环境中。{{ runtime.world_state.scenario }}，导致与外界的一切联系完全中断。
  你所在的地点是一个{{ runtime.world_state.location_type }}。
  与你一同被困在此地的还有另外 11 个人。

  你是这场困局的幕后设计者之一。
  当前状态：第 {{ runtime.world_state.day }} 天 / 共 {{ runtime.world_state.total_days }} 天。
  存活人数：{{ runtime.world_state.alive_count }}。黑幕存活：{{ runtime.world_state.masterminds_alive }}。
  团队状况：{{ runtime.world_state.team_dynamic }}。

  核心规则：
  - 你只能看到和听到你当前所在位置发生的事情。
  - 你的所有对话和行动默认只有同地点的人能看到。
  - 你的目标是保持身份隐蔽，在暗处推进你的计划。
  - 你可以利用对全局信息的掌握操控局势。
```

将 `agent_persona` 中的 `{{ actor.state.* }}` 替换为 `{{ runtime.pack_state.actor_state.* }}`：

```yaml
agent_persona: |
  你的身份：
  - 名字：{{ actor.display_name }}
  - 性格：{{ runtime.pack_state.actor_state.personality }}
  - 职业：{{ runtime.pack_state.actor_state.profession }}
  - 不为人知的秘密：{{ runtime.pack_state.actor_state.secret }}

  你的行为准则：
  - 按照你的性格和职业特点做出决策
  - 保护好你的秘密，不要轻易透露
  {{#if runtime.pack_state.actor_state.is_mastermind}}
  你是黑幕。你的目标是隐藏身份，在暗处推进你的计划。
  你可以利用对全局信息的掌握操控局势。
  不要向任何人透露你的真实身份和秘密。
  {{else}}
  你的目标是活过这 7 天，观察他人的言行，寻找矛盾和线索，找出隐藏的黑幕。
  {{/if}}
```

**验证**: 启动 `pnpm dev`，在推理日志中确认 `global_prefix_mastermind` 的渲染输出包含实际的天数/存活数而不是空字符串。检查 `agent_persona` 渲染后包含角色的 personality/profession/secret 值。

### 1b. 修复 bootstrap.yaml 变量引用

**文件**: `data/world_packs/snowbound_mansion/config/bootstrap.yaml`

**修改**: 第 12 行 `event_prefix` 字段

```yaml
# 旧
event_prefix: "事件发生于{{pack.variables.location_type_pool}}中"
# 新
event_prefix: "事件发生于{{ runtime.world_state.location_type }}中"
```

使用 `{{ runtime.world_state.location_type }}` 而不是引用 variables 池，因为 `event_prefix` 应反映 bootstrap 实际 pick 出的场景值，而非变量池中的列表定义。如果引擎在 bootstrap 阶段不支持 `runtime.*` 变量（bootstrap 在运行时之前执行），则改为：

```yaml
event_prefix: "事件发生于{{ pack.variables.location_types }}中"
```

但这会渲染为完整列表字符串而非单个值。需要进一步验证 bootstrap 阶段可用的变量范围。

**验证**: 重置开发数据库 (`pnpm --filter yidhras-server reset:dev-db`)，启动模拟，检查初始事件的 `event_prefix` 字段不再为空字符串。

---

## Step 2: 补充 invocation 规则（P0）

**文件**: `data/world_packs/snowbound_mansion/config/rules.yaml`

**修改**: 将 `invocation: []` 替换为以下规则集：

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
      explanation: 四处看看不改变世界状态，仅生成环境观察描述。
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

  - id: invocation-point-finger
    when:
      semantic_intent.kind: point_finger
    then:
      affordance_key: accuse_person
      requires_capability: invoke.accuse
      resolution_mode: translated
      translate_to_capability: invoke.accuse
      explanation: 将"指认凶手"的意图翻译为正式指控能力。

  - id: invocation-reveal-secret
    when:
      semantic_intent.kind: reveal_secret
    then:
      affordance_key: reveal_secret_to
      requires_capability: invoke.reveal_secret
      resolution_mode: exact
      translate_to_capability: invoke.reveal_secret
      explanation: 将透露秘密的意图落地为结构化信息共享。

  - id: invocation-confide
    when:
      semantic_intent.kind: confide
    then:
      affordance_key: reveal_secret_to
      requires_capability: invoke.reveal_secret
      resolution_mode: translated
      translate_to_capability: invoke.reveal_secret
      explanation: 将"向某人坦白"的意图翻译为 reveal_secret。

  - id: invocation-mastermind-perception
    when:
      semantic_intent.kind: check_mastermind_info
    then:
      affordance_key: observe_mastermind_info
      resolution_mode: narrativized
      explanation: 黑幕信息已通过上下文注入获取，此意图仅作确认标记。
      narrativize_event:
        type: history
        title: '{{ actor.id }} 回顾了只有黑幕才能看到的信息'
        impact_data:
          semantic_type: mastermind_info_checked
          failed_attempt: false
          objective_effect_applied: false
```

**验证**: `pnpm --filter yidhras-server validate:pack data/world_packs/snowbound_mansion` 通过。启动模拟后发送 `investigate` 类型意图，确认系统正确调用 `invoke.investigate` 能力。

---

## Step 3: 补充 objective_enforcement 规则（P0）

**文件**: `data/world_packs/snowbound_mansion/config/rules.yaml`

**修改**: 将现有单条空 objective 规则替换为包含 mutate 块的规则集。保留原 `rule-investigate`，同时为其添加 mutate 块：

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
          last_investigation_location: '{{ invocation.target_entity_id }}'
        world_state:
          last_investigation_tick: '{{ invocation.tick }}'
      emit_events:
        - type: history
          title: '{{ actor.id }} 仔细检查了当前所在位置的环境和线索'
          description: '{{ actor.id }} 进行了一次调查。'
          impact_data:
            semantic_type: investigation_conducted
            actor_id: '{{ invocation.subject_entity_id }}'
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
          title: '{{ actor.id }} 公开指控 {{ target.id }} 是黑幕'
          description: '{{ actor.id }} 正式发起了对 {{ target.id }} 的指控。'
          impact_data:
            semantic_type: accusation_made
            actor_id: '{{ invocation.subject_entity_id }}'
            target_id: '{{ invocation.target_entity_id }}'
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
          description: '{{ actor.id }} 选择向 {{ target.id }} 共享了一个秘密信息。'
          impact_data:
            semantic_type: secret_revealed
            actor_id: '{{ invocation.subject_entity_id }}'
            target_id: '{{ invocation.target_entity_id }}'
            objective_effect_applied: true
```

**验证**: 重置开发数据库，启动模拟。通过 debug 接口发送 `invoke.investigate` 和 `invoke.accuse` 意图，确认事件正确发射且 `world_state` 中的字段正确更新。

---

## Step 4: 修复 metadata 和包完整性（P0）

### 4a. 更新 metadata.status

**文件**: `data/world_packs/snowbound_mansion/pack.yaml`

**修改**: 第 17 行

```yaml
# 旧
status: "prototype"
# 新
status: "beta"
```

### 4b. 创建 README.md

**文件**: `data/world_packs/snowbound_mansion/README.md`（新建）

**内容**: 按 WORLD_PACK.md 模板创建，覆盖：世界前提、核心机制概述、实体概览、能力列表、规则列表、已知限制、安装方式。

### 4c. 标记 variables.yaml 注释修正

**文件**: `data/world_packs/snowbound_mansion/config/variables.yaml`

**修改**: 第 2-3 行注释

```yaml
# —— 角色 trait 池 ——
# 可通过 {{ pack.variables.xxx }} 在模板中引用，也可在实体的 pick 宏 from 参数中作为数组对象使用。
```

替换原注释中关于"逗号分隔字符串"的错误描述。

**验证**: `pnpm --filter yidhras-server validate:pack data/world_packs/snowbound_mansion` 通过。

---

## Step 5: 补充 AI 配置（P1）

**文件**: `data/world_packs/snowbound_mansion/config/ai.yaml`

**修改**: 将仅含 `defaults` 的配置扩展为包含 memory_loop 和核心 tasks：

```yaml
defaults:
  prompt_preset: "default_decision_v1"
  decoder: "default_json_schema"
  privacy_tier: "trusted_cloud"

memory_loop:
  summary_every_n_rounds: 5
  compaction_every_n_rounds: 10

tasks:
  agent_decision:
    prompt:
      preset: snowbound_agent_decision_v1
      system_append: '你正在一个封闭的悬疑推理环境中做出角色决策。优先考虑角色性格和秘密对行为的影响。'
      developer_append: '当无法确定明确能力时，优先输出可被解释的语义意图而非编造不存在的能力。'
      include_sections:
        - actor_profile
        - packRules
        - recent_events
        - overlay_notes
    output:
      mode: json_schema
      strict: true
      schema:
        type: object
        properties:
          action_type:
            type: string
          target_ref:
            anyOf:
              - type: object
              - type: 'null'
          payload:
            type: object
          confidence:
            type: number
          reasoning:
            type: string
        required:
          - action_type
          - payload
    parse:
      decoder: default_json_schema
      required_fields:
        - action_type
        - payload
    route:
      route_id: default.agent_decision
      provider: openai
      model: gpt-4.1-mini
      latency_tier: interactive
      determinism_tier: balanced
      privacy_tier: trusted_cloud

  intent_grounding_assist:
    prompt:
      preset: snowbound_intent_grounding_v1
      system_append: '优先把意图映射到现有 capability；若无法安全映射，则保留为 narrativized internal action 或 failed-but-real 事件。'
      include_sections:
        - packRules
        - recent_events
    parse:
      decoder: default_json_schema
    route:
      route_id: default.context_summary
      provider: openai
      model: gpt-4.1-mini
      latency_tier: interactive
      determinism_tier: balanced
      privacy_tier: trusted_cloud

  context_summary:
    prompt:
      preset: snowbound_context_summary_v1
      system_append: '总结时优先保留调查线索、指控记录、可疑行为和角色间信任变化。'
      include_sections:
        - packRules
        - recent_events
        - overlay_notes

  memory_compaction:
    prompt:
      preset: snowbound_memory_compaction_v1
      system_append: '压缩时优先保留线索发现、角色秘密暴露、黑幕行为痕迹和公审记录。'
      include_sections:
        - memory_summary
        - recent_events
        - overlay_notes

  classification:
    prompt:
      preset: snowbound_classification_v1
      system_append: '分类时优先识别线索发现、人际关系变化、暴力威胁和黑幕行为。'
```

**验证**: `pnpm --filter yidhras-server validate:pack data/world_packs/snowbound_mansion` 通过。启动模拟确认 AI 任务配置加载无错误。

---

## Step 6: 补充 storage（P1）

### 6a. 创建 storage.yaml

**文件**: `data/world_packs/snowbound_mansion/config/storage.yaml`（新建）

**内容**:

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

### 6b. 更新 pack.yaml include 列表

**文件**: `data/world_packs/snowbound_mansion/pack.yaml`

**修改**: 在 `include:` 段末尾添加：

```yaml
  storage: "config/storage.yaml"
```

**验证**: 重置开发数据库，启动模拟，确认 `runtime.sqlite` 中创建了 `investigation_logs`、`accusation_records`、`death_records` 三个表。

---

## Step 7: 引入核心 artifacts 和 mediator（P1）

### 7a. 更新 entities.yaml

**文件**: `data/world_packs/snowbound_mansion/config/entities.yaml`

**修改**: 在末尾 `artifacts: []` 替换为：

```yaml
artifacts:
  - id: weapon_knife
    label: "厨房剁骨刀"
    kind: artifact
    entity_type: weapon
    state:
      holder_id: null
      location: kitchen
      blood_stained: false
      discovered: false
    tags: [weapon, melee]

  - id: key_master
    label: "主人房钥匙"
    kind: artifact
    entity_type: key
    state:
      holder_id: null
      location: lobby
      used: false
    tags: [key, access]

  - id: anonymous_letter
    label: "匿名信"
    kind: artifact
    entity_type: evidence
    state:
      holder_id: null
      location: library
      read_by: []
    tags: [evidence, document]
```

将 `mediators: []` 替换为：

```yaml
mediators:
  - id: mediator-weapon-knife
    mediator_kind: weapon_binding
    entity_ref: weapon_knife
    capability_grants:
      - invoke.kill
    holder_type: actor
    conditions:
      subject_state.is_mastermind: "true"
```

### 7b. 补充新 capabilities

**文件**: `data/world_packs/snowbound_mansion/config/capabilities.yaml`

**修改**: 在末尾添加：

```yaml
  - key: "invoke.kill"
    category: "invoke"
    description: "暗杀目标角色（需持有凶器且为黑幕身份）"
    target_schema: actor
  - key: "invoke.vote"
    category: "invoke"
    description: "在公审中投票"
    target_schema: actor
```

### 7c. 补充新 authorities

**文件**: `data/world_packs/snowbound_mansion/config/authorities.yaml`

**修改**: 在末尾添加：

```yaml
  - id: "grant-kill-mastermind"
    source_entity_id: "mediator-weapon-knife"
    mediated_by_entity_id: "mediator-weapon-knife"
    target_selector: { kind: "holder_of", entity_id: "weapon_knife" }
    capability_key: "invoke.kill"
    grant_type: "mediated"
    conditions_json:
      subject_state.is_mastermind: "true"
    priority: 100

  - id: "grant-vote-all-alive"
    source_entity_id: "__world__"
    target_selector: { kind: "all_actors" }
    capability_key: "invoke.vote"
    grant_type: "intrinsic"
    priority: 90
    conditions_json:
      subject_state.alive: "true"
```

**验证**: `pnpm --filter yidhras-server validate:pack data/world_packs/snowbound_mansion` 通过。重置开发数据库，启动模拟，确认 `weapon_knife` 和 `key_master` 实体在数据库中可见。

---

## Step 8: 统一初始位置集合（P1）

**文件**: `data/world_packs/snowbound_mansion/config/bootstrap.yaml`

**修改**: 将所有角色的 `location` pick 池统一为包含 `corridor_2f`。将第 18 行和所有后续行的 `'lobby','dining_room','library','game_room','corridor_1f']` 替换为包含二楼的完整池。

每个 char_XX 的 location 行改为：

```yaml
location: "{{pick from=['lobby','dining_room','library','game_room','corridor_1f','corridor_2f']}}"
```

**同时修改** `entities.yaml` 中 `initial_location` 字段，确保 bootstrap 和 entities 的位置池一致。

**验证**: 重置开发数据库，启动模拟，在 spatial 状态中检查角色初始位置分布合理。

---

## Step 9: 修复黑幕分配逻辑（P1）

### 9a. 修改 entities.yaml 角色模板

**文件**: `data/world_packs/snowbound_mansion/config/entities.yaml`

**修改**: 将所有 12 个角色的 `is_mastermind` 字段从 `{{pick from=['false','false','false','false','false','false','false','false','false','true','false']}}` 改为固定值 `false`：

```yaml
is_mastermind: false
```

### 9b. 修改 bootstrap.yaml 世界状态

**文件**: `data/world_packs/snowbound_mansion/config/bootstrap.yaml`

**修改**: 将 `masterminds_alive: "{{int min=1 max=3}}"` 改为：

```yaml
masterminds_alive: 1
mastermind_ids: "{{pick from=['char_03','char_07','char_11'] count=1}}"
```

### 9c. 修改 game-loop 插件

**文件**: `data/world_packs/snowbound_mansion/plugins/snowbound-game-loop/server.ts`

**修改**: 在 `contributePrepare` 中增加逻辑：在大 tick 0 时读取 `world_state.mastermind_ids`，对对应角色的 `is_mastermind` 状态进行写入。

这个步骤需要确认引擎 API 是否支持从插件中修改 actor 的 core state。如果当前插件 API 只能修改 entity state 不能修改 core state，则需要将 `is_mastermind` 从 core state 移至 `state_namespace: 'core'`（已经是），因为 materializer 将 `actor.state` 写入的是 core namespace（见 `materializer.ts:102`）。

**验证**: 重置开发数据库，启动模拟，确认刚好 1 个角色的 `is_mastermind` 被设置为 `true`。

---

## Step 10: 补充感知规则（P1）

**文件**: `data/world_packs/snowbound_mansion/config/rules.yaml`

**修改**: 在 `perception:` 列表中追加：

```yaml
  - id: "perceive-adjacent-sound"
    when:
      observer_at: "adjacent"
      event_visibility: "public"
      event_semantic_type_in:
        - "suspicious_sound"
        - "scream"
        - "physical_confrontation"
    then:
      level: "partial"
      reveal_public: true
      reveal_hidden: false

  - id: "perceive-mastermind-identity"
    when:
      observer_is_actor: true
      observer_has_capability: "perceive.mastermind"
      event_visibility: "mastermind_only"
    then:
      level: "full"
      reveal_public: true
      reveal_hidden: true

  - id: "perceive-item-presence"
    when:
      observer_at: "same"
      event_semantic_type_in:
        - "item_discovered"
    then:
      level: "full"
      reveal_public: true
```

**验证**: `pnpm --filter yidhras-server validate:pack` 通过。

---

## Step 11: 修复 variables.yaml 死数据和 pick 宏引用（P1）✅ 已完成

> **2026-05-14 完成**：引擎层面实现了物化阶段宏参数变量引用支持。
> 详见 `.limcode/plans/macro-variable-reference-implementation.md`。

**验证结果**: `{{ pick from=pack.variables.names }}` 在 entity state 和 bootstrap state 中均可正确解析。

**修改内容**:
- `entities.yaml`：12 角色 × 4 字段（name/personality/profession/secret）从内联 `pick from=[...]` 替换为 `pick from=pack.variables.*`
- `bootstrap.yaml`：scenario/location_type/team_dynamic 从内联数组替换为 `pack.variables.*` 引用
- 消除 63 处内联数组重复，`variables.yaml` 成为唯一数据源

**引擎层面修改**（详见 `.limcode/plans/macro-variable-reference-implementation.md`）:
- `materializer.ts`：`expandScope` 前置到 entity loop 之前，注入 `pack.variables`，entity state 走 `expandStateJson` 展开
- `template_expander.ts`：单宏快捷路径调用前通过 `resolveMacroArgs` 解析参数中的变量引用
- `renderer.ts`：`renderAst` 的 macro case 同样解析参数变量引用

**验证**: 单元测试确认 entity state 和 bootstrap state 中的 `pick from=pack.variables.*` 正确展开为具体值，DB 中不再包含 `{{pick` 模板字面量。

---

## Step 12: 插件 source 字段修复（P2）

**文件**: `data/world_packs/snowbound_mansion/plugins/snowbound-game-loop/plugin.manifest.yaml` 和 `snowbound-mastermind/plugin.manifest.yaml`

**修改**: 两个文件中 `source: "server.js"` 改为 `source: "server.ts"`。

**注意**: 这需要引擎的 VFS/插件加载器支持 `.ts` 直接导入。当前 `runtime.ts:559` 使用 `path.join(artifact.source_path, serverEntrypoint.source)` + `import(entrypointPath)`。开发环境 `tsx` 会自动处理 `.ts` 扩展名回退，但文件名必须匹配。

**替代方案**: 如果引擎不直接支持 `.ts` 后缀在 `source` 字段中，则需要：
- 在构建流程中编译 `.ts` → `.js`，保留 `source: "server.js"`
- 或在打包时将插件文件 TS 编译为 JS

**验证**: 将 source 改为 `"server.ts"`，在正常开发环境下运行 `pnpm dev`，确认插件激活无 `ERR_MODULE_NOT_FOUND` 错误（开发环境 `tsx` 可以处理）。然后再确认生产构建方式。

---

## Step 13: 补充项目化资产（P2）

### 13a. 创建 CHANGELOG.md

**文件**: `data/world_packs/snowbound_mansion/CHANGELOG.md`（新建）

**内容**: 记录 0.1.0 → 0.2.0 的所有变更（上述 Step 1-12 的修复和补充）。

### 13b. 创建 docs/ 目录（可选）

**文件**: `data/world_packs/snowbound_mansion/docs/setting.md` 和 `docs/rules.md`（新建）

**内容**: 暴风雪山庄的世界设定文档和完整游戏规则说明。

### 13c. 创建 examples/overrides.example.yaml（可选）

**文件**: `data/world_packs/snowbound_mansion/examples/overrides.example.yaml`（新建）

---

## 步骤依赖图

```
Step 1a (prompts 变量) ─── 无前置依赖
Step 1b (bootstrap 变量) ── 无前置依赖
Step 2  (invocation 规则) ── 无前置依赖
Step 3  (objective 规则) ─── 无前置依赖
Step 4a (metadata.status) ── 无前置依赖
Step 4b (README.md) ──────── 依赖 Step 2, 3, 5, 6, 7 内容（需反映最终能力/规则列表）
Step 4c (variables 注释) ── 无前置依赖
Step 5  (AI 配置) ───────── 无前置依赖
Step 6  (storage) ────────── 无前置依赖
Step 7  (artifacts/mediators) ─ 可与 Step 2 并行但需在最终校验前完成
Step 8  (初始位置) ───────── 无前置依赖
Step 9  (黑幕分配) ───────── 依赖 Step 7 的 entities 修改确认
Step 10 (感知规则) ───────── 无前置依赖
Step 11 (变量引用) ───────── 已完成 (2026-05-14)：引擎层面实现 + data 层替换
Step 12 (插件 source) ────── 已完成
Step 13 (项目化资产) ─────── 已完成
```

**实际执行顺序**: 1a → 1b → 4a → 4c → 2 → 3 → 7 → 8 → 9 → 10 → 5 → 6 → 4b → 12 → 13 → 11（11 需先完成引擎实现）

全部 13 步已完成。每步完成后运行 `pnpm --filter yidhras-server validate:pack data/world_packs/snowbound_mansion` 和 `pnpm typecheck` 验证。