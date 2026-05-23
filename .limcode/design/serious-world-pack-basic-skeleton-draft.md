# 正经 World-Pack 草案：基础内容骨架

## 1. 草案目的

本草案用于回答：在当前 Yidhras 项目中，设计一个可运行、可审阅、可逐步扩展的 world-pack，最基本需要哪些内容骨架。

依据当前代码与文档，world-pack 不是旧式剧情配置包。它的核心是一个由 `pack.yaml` 入口与 `config/*.yaml` 拆分配置组成的世界规则单元，运行时通过 schema 校验后进入物化与治理流程。

当前项目明确不再接受旧字段：

- `scenario`
- `event_templates`
- `actions`
- `decision_rules`

这些内容应迁移到：

- `entities`
- `identities`
- `capabilities`
- `authorities`
- `rules.objective_enforcement`
- `bootstrap.initial_states`

## 2. 项目化文件骨架

一个正经 world-pack 至少应按以下结构组织：

```text
my-world-pack/
  pack.yaml
  config/
    variables.yaml
    prompts.yaml
    ai.yaml
    time_systems.yaml
    simulation_time.yaml
    entities.yaml
    identities.yaml
    capabilities.yaml
    authorities.yaml
    rules.yaml
    storage.yaml
    scheduler.yaml
    bootstrap.yaml
    state_transforms.yaml
    spatial.yaml
  README.md
  CHANGELOG.md
  assets/
  docs/
```

### 2.1 运行时必需入口

- `pack.yaml`：包入口文件，承载 `schema_version`、`metadata`、`include`。
- `config/*.yaml`：被 `include` 引用的各语义节拆分文件。

### 2.2 项目化推荐交付物

- `README.md`：说明世界类型、主题、玩法/模拟目标、使用方式、已知限制。
- `CHANGELOG.md`：记录版本变化与兼容性说明。
- `assets/`：封面、图标、插图等展示资产，按需提供。
- `docs/`：扩展设定、规则说明、作者协作文档，按需提供。

## 3. `pack.yaml` 入口骨架

`pack.yaml` 不应直接塞入完整世界内容，而应作为 metadata 与 include 索引。

```yaml
schema_version: 0

metadata:
  id: "serious-world-pack-draft"
  instance_id: "serious-world-pack-draft-dev"
  name: "正经世界包草案"
  version: "0.1.0"
  description: "用于检验 Yidhras world-pack 边界能力的基础世界包草案。"
  authors:
    - name: "TBD"
      role: "pack designer"
  license: "TBD"
  tags:
    - "draft"
    - "boundary-test"
    - "world-pack"
  status: "draft"
  frontend:
    type: "default"

include:
  variables: "config/variables.yaml"
  prompts: "config/prompts.yaml"
  ai: "config/ai.yaml"
  time_systems: "config/time_systems.yaml"
  simulation_time: "config/simulation_time.yaml"
  entities: "config/entities.yaml"
  identities: "config/identities.yaml"
  capabilities: "config/capabilities.yaml"
  authorities: "config/authorities.yaml"
  rules: "config/rules.yaml"
  storage: "config/storage.yaml"
  scheduler: "config/scheduler.yaml"
  bootstrap: "config/bootstrap.yaml"
  state_transforms: "config/state_transforms.yaml"
  spatial: "config/spatial.yaml"
```

## 4. 基础语义节骨架

### 4.1 `metadata`：发布与实例身份

最少需要：

- `id`：世界包类型标识。
- `instance_id`：运行实例标识，可选；缺省时由目录名提供。
- `name`：显示名称。
- `version`：版本。
- `description`：世界包用途说明。
- `authors`：作者信息。
- `license`：许可证。
- `tags`：检索标签。
- `status`：如 `draft`、`stable`。
- `frontend`：默认前端或自定义前端声明。

当前 schema 中 `metadata.id`、`metadata.name`、`metadata.version` 为必需字段。

### 4.2 `variables`：全局变量与可复现参数

用于放置世界级静态参数、开局参数、种子值、术语表、平衡参数。

建议包含：

```yaml
world_theme: "TBD"
world_tone: "TBD"
seed: "serious-world-pack-draft-seed-001"
default_language: "zh-CN"
core_tensions:
  - "TBD"
```

用途：

- 被 prompt 模板引用。
- 作为宏展开与世界初始化的稳定输入。
- 避免把可调参数硬编码到规则文本里。

### 4.3 `prompts`：世界提示词与叙事约束

当前 schema 接受 `prompts` 为字符串记录。

建议至少拆出：

```yaml
world_brief: "TBD：世界基本说明。"
agent_decision_frame: "TBD：角色决策时应遵守的世界事实与限制。"
narrative_style: "TBD：叙事投影风格。"
operator_notes: "TBD：给 operator 的观察说明。"
```

注意：prompt 只能表达语义指导，不能替代客观规则。客观结果必须落在 `rules.objective_enforcement`、`authorities`、`capabilities` 等结构里。

### 4.4 `ai`：AI 任务默认行为与覆写

当前 schema 支持：

- `defaults`
- `memory_loop`
- `tasks`
- `slots`

可先保留轻量骨架：

```yaml
defaults:
  privacy_tier: "trusted_cloud"
  prompt_preset: "default"
memory_loop:
  summary_every_n_rounds: 8
  compaction_every_n_rounds: 24
tasks:
  agent_decision:
    route:
      determinism_tier: "balanced"
    output:
      mode: "json_object"
```

### 4.5 `time_systems` 与 `simulation_time`：时间模型

`time_systems` 定义日历/时间单位，`simulation_time` 定义 tick 范围与推进策略。

基础骨架：

```yaml
# config/time_systems.yaml
- id: "main_calendar"
  name: "主时间制"
  is_primary: true
  tick_rate: 1
  units:
    - name: "tick"
      ratio: 1
    - name: "day"
      ratio: 24
```

```yaml
# config/simulation_time.yaml
initial_tick: 0
min_tick: 0
step:
  strategy: "variable"
  range:
    min: 1
    max: 1
```

### 4.6 `entities`：世界实体

当前 schema 将实体分为：

- `actors`
- `artifacts`
- `mediators`
- `domains`
- `institutions`

基础骨架：

```yaml
actors:
  - id: "actor_protagonist"
    label: "主角"
    kind: "actor"
    entity_type: "person"
    tags: ["player-facing"]
    state:
      status: "active"

artifacts:
  - id: "artifact_core_object"
    label: "核心物件"
    kind: "artifact"
    entity_type: "world_object"
    tags: ["core"]

mediators:
  - id: "mediator_core_object"
    entity_ref: "artifact_core_object"
    mediator_kind: "artifact"
    grants:
      - capability_key: "invoke.core_action"
    requires: []
    binding_rules: []
    perception_effects: []
    execution_effects: []
    override_rules: []
    revocation_rules: []

domains:
  - id: "domain_start_area"
    label: "起始区域"
    kind: "domain"
    entity_type: "location"
    tags: ["start"]

institutions:
  - id: "institution_local_order"
    label: "本地秩序"
    kind: "institution"
    entity_type: "governance"
    tags: ["authority"]
```

约束：

- 所有实体组内的 `id` 必须全局唯一。
- `spatial.locations[*].id` 必须引用 `entities.domains` 中存在的 domain。
- mediator 是当前治理模型的一等公民，适合表达神器、契约、头衔、印记、执照等能力媒介。

### 4.7 `identities`：身份声明

用于把实体绑定到世界承认的身份类型。

```yaml
- id: "identity_protagonist_resident"
  subject_entity_id: "actor_protagonist"
  type: "resident"
  claims:
    origin: "domain_start_area"
```

约束：

- `subject_entity_id` 必须引用已存在实体。

### 4.8 `capabilities`：能力目录

能力是当前 world-pack 治理主线的核心表达。

建议按类别命名：

- `perceive.*`
- `invoke.*`
- `mutate.*`
- `bind.*`
- `govern.*`
- `override.*`

基础骨架：

```yaml
- key: "perceive.public_events"
  category: "perceive"
  description: "观察公开事件。"
  default_visibility: "public"

- key: "invoke.core_action"
  category: "invoke"
  description: "触发核心世界动作。"
  default_visibility: "operator"
```

### 4.9 `authorities`：能力授予与来源链

用于声明谁向谁授予何种能力，以及该能力是否通过 mediator 生效。

```yaml
- id: "authority_core_object_grants_action"
  source_entity_id: "institution_local_order"
  target_selector:
    kind: "holder_of"
    entity_id: "artifact_core_object"
  capability_key: "invoke.core_action"
  grant_type: "mediated"
  mediated_by_entity_id: "mediator_core_object"
  priority: 10
  status: "active"
  revocable: true
```

基础设计问题：

- 能力来源是谁？
- 能力授予对象是谁？
- 是否必须持有某个 artifact/mediator？
- 是否有 scope、condition、priority、revocation？

### 4.10 `rules`：感知、调用、客观执行、投影

当前 schema 支持：

- `perception`
- `capability_resolution`
- `invocation`
- `objective_enforcement`
- `projection`

基础骨架：

```yaml
perception:
  - id: "perception_public_events_same_area"
    when:
      observer_at: "same"
      event_visibility: "public"
    then:
      level: "full"
      reveal_public: true

capability_resolution: []
invocation: []

objective_enforcement:
  - id: "enforce_core_action"
    when:
      invocation_type: "invoke.core_action"
    then:
      emit_events:
        - event_type: "core_action_triggered"
          visibility: "public"
      mutate_state:
        target_entity_id: "artifact_core_object"
        state_namespace: "runtime"
        patch:
          last_triggered: true

projection:
  - id: "project_core_action_count"
    when:
      on_event_type: "core_action_triggered"
    then:
      compute: "count"
      source_collection: "events"
      target_projection: "core_action_count"
```

注意：`objective_enforcement[*].when.invocation_type` 若用于 capability-key 匹配，应使用 `invoke.` 前缀。当前代码只豁免内核动作：`trigger_event`、`post_message`、`adjust_relationship`、`adjust_snr`。

### 4.11 `storage`：包级运行时存储

当前 storage schema 支持：

- `strategy`
- `runtime_db_file`
- `projection_db_file`
- `engine_owned_collections`
- `pack_collections`
- `projections`
- `install`

基础骨架：

```yaml
strategy: "isolated_pack_db"
runtime_db_file: "runtime.sqlite"
engine_owned_collections: []
pack_collections:
  - key: "core_records"
    kind: "table"
    primary_key: "id"
    fields:
      - key: "id"
        type: "string"
        required: true
      - key: "entity_id"
        type: "string"
        required: true
      - key: "status"
        type: "string"
        required: true
    indexes:
      - ["entity_id"]
projections:
  - key: "core_record_public_view"
    source: "core_records"
    materialized: true
    visibility: "operator"
install:
  compile_on_activate: true
  allow_pack_collections: true
  allow_raw_sql: false
```

约束：

- `allow_raw_sql: true` 当前不被支持。
- `pack_collections[*].primary_key` 必须引用已有字段。
- collection key 不能与 engine-owned collection 冲突。

### 4.12 `scheduler`：调度分区

当前 schema 只定义：

```yaml
partition_count: 1
```

### 4.13 `bootstrap`：初始状态与初始事件

用于取代旧 `scenario` 初始化。

```yaml
initial_states:
  - entity_id: "actor_protagonist"
    state_namespace: "runtime"
    state_json:
      location: "domain_start_area"
      health: 100
      status: "active"

  - entity_id: "artifact_core_object"
    state_namespace: "runtime"
    state_json:
      holder: null
      last_triggered: false

initial_events:
  - event_type: "world_initialized"
    payload:
      start_domain: "domain_start_area"
```

### 4.14 `state_transforms`：状态到标签/派生状态的转换

用于把数值或状态映射成语义标签。

```yaml
- source: "runtime.health"
  target: "health_band"
  ranges:
    - min: 0
      max: 0
      label: "dead"
    - min: 1
      max: 30
      label: "critical"
    - min: 31
      max: 100
      label: "alive"
```

约束：

- 每个 transform 的 `target` 必须唯一。
- 每个 range 的 `min` 必须小于等于 `max`。
- 同一 transform 内 range label 必须唯一。

### 4.15 `spatial`：空间模型

当前 schema 支持离散空间：

```yaml
model: "discrete"
locations:
  - id: "domain_start_area"
edges: []
```

约束：

- `locations[*].id`、`edges[*].from`、`edges[*].to` 必须引用 `entities.domains` 中存在的 domain。

## 5. 世界设计内容骨架

除了 schema 文件，还需要先回答以下设计问题。

### 5.1 世界一句话

- 这个世界是什么类型？
- 它模拟什么冲突？
- 它和普通聊天/剧情文本的边界在哪里？

模板：

```text
这是一个关于【TBD】的世界。核心模拟对象是【TBD】，主要张力来自【TBD】，不可被 prompt 随意改写的客观规则是【TBD】。
```

### 5.2 核心实体清单

至少列出：

- 主要 actor
- 关键 artifact
- 关键 mediator
- 起始 domain
- 基础 institution

### 5.3 核心能力清单

至少定义：

- 谁能观察什么？
- 谁能触发什么？
- 谁能改变什么状态？
- 谁能授予/撤销什么能力？
- 哪些能力必须通过媒介获得？

### 5.4 客观规则清单

至少定义：

- 触发条件
- 需要的 capability
- mediator 是否参与
- 成功结果
- 失败/无权限结果
- 事件记录
- 状态变更

### 5.5 感知与投影清单

至少定义：

- actor 能看到哪些公开事实？
- operator 能看到哪些治理链路？
- 哪些 hidden state 不应直接暴露？
- 哪些 aggregate/projection 需要展示？

### 5.6 开局状态

至少定义：

- 初始地点
- 初始持有关系
- 初始身份
- 初始资源/健康/状态
- 初始事件

## 6. 主题落地草案：千年吸血鬼

### 6.1 主题定位

本轮世界主题确定为：**“千年吸血鬼”单人“日记式”TRPG 角色扮演**。

这里的重点不是复刻某个桌游流程，而是把“长期时间跨度、身份变迁、记忆损耗、日记记录、孤独生存、超自然规则、前台/后台 agent 分工”拆成 Yidhras world-pack 可以声明、物化、执行、观测的结构。

该主题正好适合作为边界测试，因为它同时触及：

- 单 actor 长生命周期模拟。
- 大跨度时间推进，尤其是不稳定步进区间带来的叙事跳跃。
- 单人体验下的前台 agent 与后台活跃 agent 分工。
- 个人记忆与日记文本之间的差异。
- 主观叙事与客观规则分离。
- 身份、别名、社会位置随时代变化。
- 超自然能力与代价的 capability / authority 表达。
- 日记作为 artifact / mediator / storage projection 的混合对象。

### 6.2 世界一句话

这是一个关于【一名不死吸血鬼在千年历史中用日记维持自我连续性】的世界。核心模拟对象是【吸血鬼主体、记忆、日记、饥渴、身份伪装、后台世界压力与叙事时间跳跃】，主要张力来自【不死生命与有限记忆之间的冲突】，不可被 prompt 随意改写的客观规则是【吸血鬼的状态代价、记忆遗失、日记记录、身份暴露风险、后台 agent 推动的世界压力与不稳定时间步进】。

### 6.3 不按桌游原样复刻的边界

本项目设计之初不是为了桌面角色扮演，因此本 world-pack 不应把桌游流程硬塞成一套外部规则书复刻。

本草案只抽取适合当前项目测试的结构：

- “日记式”作为 narrative projection 与 pack storage 的输出形态。
- “单人角色扮演”作为前台吸血鬼 agent 的高主观性推演场景。
- “后台活跃 agent”作为非玩家视角的压力源、历史噪声、猎人/教会/血族势力/时代变化代理。
- “千年”作为不稳定步进区间、time_systems 与 state_transforms 的压力源。
- “吸血鬼”作为能力、限制、mediator、authority 与 objective_enforcement 的测试对象。

暂不追求：

- 完整复刻任何具体桌游的回合、骰表、事件表或角色卡。
- 把所有随机表做成硬编码内容。
- 让 prompt 决定客观状态变化。

### 6.4 核心实体草案

第一版不引入地点和空间语义。核心实体只表达前台吸血鬼、日记媒介、诅咒规则源，以及少量后台活跃 agent。故事开始只需要叙述“如何变成吸血鬼”，不需要声明起始地点。

```yaml
actors:
  - id: "actor_vampire"
    label: "千年吸血鬼"
    kind: "actor"
    entity_type: "vampire"
    tags: ["solo", "protagonist", "undead"]
    state:
      role: "foreground"

  - id: "actor_hunter_pressure"
    label: "猎人压力"
    kind: "actor"
    entity_type: "background_agent"
    tags: ["background", "hunter", "pressure"]
    state:
      role: "background"
      function: "追踪、审判、制造暴露风险"

  - id: "actor_mortal_world"
    label: "凡人世界"
    kind: "actor"
    entity_type: "background_agent"
    tags: ["background", "society", "history"]
    state:
      role: "background"
      function: "推动时代变迁、社会秩序与身份压力"

  - id: "actor_vampiric_whisper"
    label: "血中低语"
    kind: "actor"
    entity_type: "background_agent"
    tags: ["background", "curse", "temptation"]
    state:
      role: "background"
      function: "诱发饥渴、梦境、记忆扭曲与诅咒冲动"

artifacts:
  - id: "artifact_diary"
    label: "吸血鬼日记"
    kind: "artifact"
    entity_type: "diary"
    tags: ["memory", "record", "mediator"]

mediators:
  - id: "mediator_diary_memory"
    entity_ref: "artifact_diary"
    mediator_kind: "artifact"
    grants:
      - capability_key: "invoke.write_diary_entry"
      - capability_key: "perceive.recorded_memory"
    requires: []
    binding_rules: []
    perception_effects: []
    execution_effects: []
    override_rules: []
    revocation_rules: []

institutions:
  - id: "institution_vampiric_curse"
    label: "吸血诅咒"
    kind: "institution"
    entity_type: "supernatural_law"
    tags: ["curse", "objective-rule-source"]
```

前台/后台分工：

- `actor_vampire` 是前台 agent，承载玩家/主角视角、日记主观叙述与可直接决策的行动。
- `actor_hunter_pressure`、`actor_mortal_world`、`actor_vampiric_whisper` 是后台活跃 agent，不作为多人角色扮演对象，而是作为世界压力、历史变化、诱惑、追猎和叙事扰动的来源。
- 后台 agent 的输出应进入事件、状态变化、风险变化或 prompt context；不能绕过 objective rules 直接改写前台状态。

### 6.5 初始身份草案

```yaml
- id: "identity_vampire_original_self"
  subject_entity_id: "actor_vampire"
  type: "original_self"
  claims:
    mortal_name: "TBD"
    born_era: "TBD"
    turned_era: "TBD"
```

后续可通过 pack storage 或 bootstrap state 表达历史别名，但第一版不需要一次性铺开所有时代身份。

### 6.6 核心能力草案

第一版能力目录建议围绕日记、记忆、不稳定时间跳跃、吸血、伪装与后台压力建立。

```yaml
- key: "perceive.recorded_memory"
  category: "perceive"
  description: "读取日记中已经记录的记忆。"
  default_visibility: "actor_local"

- key: "invoke.write_diary_entry"
  category: "invoke"
  description: "写下一则日记条目，将主观经历固化为可回读记录。"
  default_visibility: "actor_local"

- key: "invoke.feed"
  category: "invoke"
  description: "进行一次吸血行为，缓解饥渴并引入暴露或道德代价。"
  default_visibility: "operator"

- key: "invoke.change_identity"
  category: "invoke"
  description: "抛弃旧身份并建立新的社会伪装。"
  default_visibility: "operator"

- key: "invoke.pass_decades"
  category: "invoke"
  description: "按不稳定步进区间推进一个较长历史阶段，触发记忆衰退、关系消散与时代变化。"
  default_visibility: "operator"

- key: "invoke.background_pressure_tick"
  category: "invoke"
  description: "由后台活跃 agent 推动一次压力变化，例如追猎逼近、时代更替、诅咒低语增强。"
  default_visibility: "operator"
```

### 6.7 权限与媒介草案

第一版可以用两个来源表达世界治理：

1. `institution_vampiric_curse`：吸血鬼能力与代价的客观来源。
2. `mediator_diary_memory`：日记作为记忆读取与写入能力的媒介。
3. 后台 agent：只能通过已声明 capability 和 objective rules 影响风险、事件与上下文，不能直接作为玩家可控角色。

```yaml
- id: "authority_curse_allows_feeding"
  source_entity_id: "institution_vampiric_curse"
  target_selector:
    kind: "direct_entity"
    entity_id: "actor_vampire"
  capability_key: "invoke.feed"
  grant_type: "intrinsic"
  priority: 100
  status: "active"
  revocable: false

- id: "authority_diary_records_memory"
  source_entity_id: "institution_vampiric_curse"
  target_selector:
    kind: "holder_of"
    entity_id: "artifact_diary"
  capability_key: "invoke.write_diary_entry"
  grant_type: "mediated"
  mediated_by_entity_id: "mediator_diary_memory"
  priority: 50
  status: "active"
  revocable: true

- id: "authority_background_pressure"
  source_entity_id: "institution_vampiric_curse"
  target_selector:
    kind: "entity_type_is"
    entity_type: "background_agent"
  capability_key: "invoke.background_pressure_tick"
  grant_type: "intrinsic"
  priority: 25
  status: "active"
  revocable: false
```

### 6.8 客观规则草案

第一版 objective enforcement 不需要复杂事件表，只需要能验证“prompt 不能随意改写状态”。

建议最小规则：

- `invoke.write_diary_entry`：追加一条 diary entry，并把某段当前经历固化为 recorded memory。
- `invoke.feed`：降低 hunger，但增加 exposure_risk 或 guilt。
- `invoke.change_identity`：设置 current_alias，旧 alias 进入历史记录。
- `invoke.pass_decades`：按 `simulation_time.step.range` 的不稳定步进区间推进时间，增加 memory_decay，并可能把未写入日记的 active memory 转为 faded。
- `invoke.background_pressure_tick`：让后台 agent 生成一次世界压力变化，并通过规则转化为 exposure_risk、hunger、memory_decay、dream、rumor 或 hunter_trace 等状态/事件。

这些规则的具体 `then` 结构先保持草案级描述，后续生成实际 pack 时再按当前 enforcement engine 支持的字段写成 YAML。

### 6.9 初始状态草案

```yaml
initial_states:
  - entity_id: "actor_vampire"
    state_namespace: "runtime"
    state_json:
      hunger: 50
      exposure_risk: 0
      memory_decay: 0
      current_alias: null
      origin_story_status: "pending"
      active_memories: []
      faded_memories: []

  - entity_id: "artifact_diary"
    state_namespace: "runtime"
    state_json:
      holder: "actor_vampire"
      entry_count: 0
      last_entry_tick: null

initial_events:
  - event_type: "origin_story_requested"
    payload:
      prompt: "叙述主角如何变成吸血鬼。"
```

开局不声明地点。第一幕只要求系统生成或接收“变成吸血鬼”的 origin narrative，并在后续规则中把它固化为第一批 `memory_fragments` 与第一则 `diary_entries`。

后台 agent 的初始状态可以保持轻量：

```yaml
initial_states:
  - entity_id: "actor_hunter_pressure"
    state_namespace: "runtime"
    state_json:
      pressure: 0
      last_signal: null

  - entity_id: "actor_mortal_world"
    state_namespace: "runtime"
    state_json:
      era_pressure: 0
      dominant_order: "TBD"

  - entity_id: "actor_vampiric_whisper"
    state_namespace: "runtime"
    state_json:
      intensity: 1
      last_dream: null
```

### 6.10 存储草案

这个主题非常适合测试 pack-owned storage。第一版建议至少声明：

- `diary_entries`：日记条目。
- `memory_fragments`：记忆碎片。
- `aliases`：历史身份/伪装。
- `era_markers`：时代节点。
- `background_pressure_events`：后台 agent 产生的压力事件。

第一版不需要把所有字段做满，但应保证日记文本不是只存在 prompt 输出里，而是有可查询、可投影、可审阅的结构化记录。

### 6.11 时间步进草案

本主题明确移除地点与空间语义，第一版不声明 `spatial`，也不需要 `entities.domains`。

时间第一版应突出“一个个叙事之间移动”的长寿命跳跃。项目支持不稳定步进区间，正好适合用 `simulation_time.step.range` 表达每次叙事之间跨度不固定：

```yaml
initial_tick: 0
min_tick: 0
step:
  strategy: "variable"
  range:
    min: 1
    max: 120
```

这里的 tick 可先解释为“叙事间隔单位”，不必等同于天、年或具体历法单位。一次步进可以是一次夜晚、几年、几十年甚至一个时代片段；具体跨度由规则、prompt context 和状态共同解释。

### 6.12 本主题最适合检验的项目边界

“千年吸血鬼”主题能直接检验以下边界：

- world-pack 是否能表达单 actor 深状态，而不是只表达多 agent 社交。
- runtime 是否能承载长期记忆、遗忘、投影与存储分离。
- 日记文本是否能作为 projection，而不是替代 objective state。
- capability / authority 是否能表达“诅咒赋权”和“日记媒介”。
- 后台活跃 agent 是否能作为世界压力源参与推演，而不把体验变成多人角色扮演。
- 不稳定步进区间是否能支撑日记式叙事在片段之间跳跃。
- bootstrap 是否足以替代旧 `scenario`。
- state_transforms 是否能把 `hunger`、`memory_decay`、`exposure_risk` 转成可读状态段。
- operator 是否能观察规则链路，而 actor 只看到日记与主观记忆。

### 6.13 本主题第一版明确移除的内容

- 地点。
- 地图。
- 空间移动。
- `spatial` 配置。
- `entities.domains`。
- 起始墓地、城堡、城市等 location/domain 实体。

这些内容不是当前主题第一版的边界测试重点。第一版故事开始只需要完成一件事：叙述并固化“如何变成吸血鬼”。

### 6.14 前台/后台 agent 设计边界

由于这是单人主题，agent 分工不是“多个玩家角色”，而是：

| 类型 | 作用 | 是否前台可控 | 是否可直接改写客观状态 |
|------|------|--------------|--------------------------|
| 前台 agent：`actor_vampire` | 主角、日记书写者、行动主体 | 是 | 否，仍需经 capability / objective rules |
| 后台 agent：猎人压力 | 追猎、风险、暴露压力 | 否 | 否，只能产生 pressure event / intent |
| 后台 agent：凡人世界 | 时代变化、社会秩序、身份压力 | 否 | 否，只能产生 era event / context |
| 后台 agent：血中低语 | 诅咒冲动、梦境、记忆扰动 | 否 | 否，只能产生 temptation / dream / decay pressure |

后台 agent 的价值在于测试项目是否能支持“单人前台体验 + 多个后台活跃系统”的模拟结构。

它们不应抢夺主角叙事视角，也不应绕过世界规则直接决定主角命运。

## 7. 最小可运行草案范围

为了从简单开始，第一版不应追求完整大世界。按当前主题修订后，最小闭环不再包含地点、domain 或 spatial：

1. 一个前台 actor：`actor_vampire`。
2. 至少一个后台活跃 actor：如 `actor_hunter_pressure`、`actor_mortal_world` 或 `actor_vampiric_whisper`。
3. 一个 institution：`institution_vampiric_curse`。
4. 一个 artifact：`artifact_diary`。
5. 一个 mediator 绑定日记 artifact。
6. 一个 `invoke.write_diary_entry` capability。
7. 一个 `invoke.background_pressure_tick` capability。
8. 一个 mediated authority grant。
9. 一个 objective enforcement rule。
10. 一个 bootstrap initial event：`origin_story_requested`。

这个闭环可以检验：

- include 拆分加载。
- metadata / instance_id 行为。
- entity materialization。
- identity 引用校验。
- capability 与 authority 声明。
- mediator 参与能力授予。
- `invoke.*` 客观规则执行入口。
- bootstrap 初始事件与初始状态初始化。
- 不声明 spatial / domains 时，pack 是否仍能成立。
- isolated pack storage 声明。

## 8. 当前草案不做的内容

第一版草案暂不设计：

- 自定义前端 `frontend.type: custom`。
- 复杂多日历时间系统。
- 大规模 actor 群体。
- 完整经济系统。
- 任意脚本或 raw SQL。
- 旧式 `scenario/actions/decision_rules/event_templates` 兼容。

## 9. 下一步

下一步可以基于本骨架选择一个具体世界主题，然后生成真正的 `pack.yaml` 与 `config/*.yaml` 初版文件。第一版主题应足够小，以便暴露边界能力，而不是被内容规模掩盖 schema 与 runtime 问题。
