# 千年吸血鬼 World-Pack 草案

## 1. 主题定位

本轮世界主题确定为：**"千年吸血鬼"单人"日记式"角色扮演**。

核心体验：主角是一名吸血鬼，在漫长的生命中用日记记录自己的经历。时间跨度大，身份随时代变迁，记忆会自然衰退。

**在这里的吸血鬼并非世俗意义上的传统吸血鬼，食用人类某个部位的生物都可以被认为是吸血鬼，也就是食人的怪物**

> ...应该以人为食
> ...应该试图在她们赖以生存的人群中伪装自己
> ...曾经是人类，仍在某种意义上保有人类的需求
> ...应该容易受到普通凡人不关心的环境危害的影响，比如阳光
> ...应该几乎是不朽的
> ...多为独行者

## 2. 世界一句话

一名吸血鬼在千年历史中用第一人称记录自己的经历。核心模拟对象是吸血鬼主体、记忆、时间流逝。

## 3. 核心实体草案

第一版不引入地点和空间语义。

```yaml
actors:
  - id: "actor_vampire"
    label: "吸血鬼"
    kind: "actor"
    entity_type: "vampire"
    tags: ["solo", "protagonist", "undead"]

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

institutions:
  - id: "institution_vampiric_curse"
    label: "吸血诅咒"
    kind: "institution"
    entity_type: "supernatural_law"
    tags: ["curse", "objective-rule-source"]
```

## 4. 初始身份草案

```yaml
- id: "identity_vampire_original_self"
  subject_entity_id: "actor_vampire"
  type: "original_self"
  claims:
    mortal_name: "TBD"
    born_era: "TBD"
    turned_era: "TBD"
```

## 5. 核心能力草案

围绕日记与记忆：

```yaml
- key: "perceive.recorded_memory"
  category: "perceive"
  description: "读取日记中已经记录的记忆。"
  default_visibility: "actor_local"

- key: "invoke.write_diary_entry"
  category: "invoke"
  description: "根据当前经历写下一则日记条目，将主观经历固化为可回读的记录。"
  default_visibility: "actor_local"

- key: "invoke.pass_time"
  category: "invoke"
  description: "推进一段不确定长度的时间，触发记忆自然衰退与时代变化。"
  default_visibility: "operator"
```


## 6. 权限与媒介草案

```yaml
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
```


## 7. 客观规则草案

- `invoke.write_diary_entry`：主角根据自身经历写一则日记。内容来自主角当前的主观记忆与状态，固化为可查询的 diary entry。
- `invoke.pass_time`：按不稳定步进区间推进时间。时间流逝带来记忆的自然衰退——未写入日记的记忆可能变得模糊或遗失。时代背景随之变化。

## 8. 初始状态草案

```yaml
initial_states:
  - entity_id: "actor_vampire"
    state_namespace: "runtime"
    state_json:
      current_alias: null
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

开局不声明地点。第一幕生成"变成吸血鬼"的 origin narrative，随后固化为第一批记忆碎片与第一则日记条目。

## 9. 存储草案

- `diary_entries`：日记条目。
- `memory_fragments`：记忆碎片。
- `aliases`：历史身份/伪装。
- `era_markers`：时代节点。

## 10. 时间步进草案

不声明地点与空间语义。时间使用不稳定步进区间，表达叙事之间的长跨度跳跃：

```yaml
initial_tick: 0
min_tick: 0
step:
  strategy: "variable"
  range:
    min: 1
    max: 120
```

tick 解释为叙事间隔单位，不必对应具体时间单位。一次步进可以是几天、几年甚至几十年。

## 11. 最小可运行草案范围

1. 一个前台 actor：`actor_vampire`。
2. 一个 institution：`institution_vampiric_curse`。
3. 一个 artifact：`artifact_diary`。
4. 一个 mediator 绑定日记 artifact。
5. 一个 `invoke.write_diary_entry` capability。
6. 一个 mediated authority grant。
7. 一个 bootstrap initial event：`origin_story_requested`。

## 12. 骰子机制草案

游戏使用两颗骰子：
- **1d10**：十面骰
- **1d6**：六面骰

**骰子规则**：投掷 1d10 和 1d6，计算 `1d10 - 1d6`：
- 结果为正数 → 从当前所在位置**向前**移动该数值
- 结果为负数 → 从当前所在位置**向后**移动该数值

骰子结果决定吸血鬼在提示池中的滑动方向和距离，如同一个滑动的节点。

## 13. 五种核心资源

### 13.1 技艺 (Skills)

能力和特质。例如：剑术、轻松闲聊、不用眨眼弄走眼睛里的沙子。

- 如果一项技艺关联的是一段早已遗忘的回忆，使用起来需要进行**技艺检验**。
- **已检验**的技艺代表吸血鬼已经做过的事情。
- **未检验**的技艺代表吸血鬼能够做到但尚未证实的事情。

### 13.2 资源 (Resources)

对吸血鬼有用的资产、组织或珍视之物。范围从小到一把黑曜石小刀，大到一支军队。

- 吸血鬼需要根据提示的语境创造出相符的资源。
- 这些资源不需要令人兴奋，也不是最有用。
- 当提示需要吸血鬼失去一种资源时，需要**标记失去**，但不应该删除——因为这个资源可能会失而复得。

### 13.3 替代规则

- 如果提示要求检验一项技艺，但吸血鬼没有对应的技艺 → **失去一种资源**。
- 如果提示要求失去一种资源，但没有可用资源 → **检验一项技艺**。
- 选择替代方案标明吸血鬼的处境非常糟糕。
- **只有技艺和资源可以互相替代**，不能选择失去角色、回忆或印记去替代技艺/资源。
- 如果必须要失去一项技艺或一种资源，而吸血鬼两者皆无 → 吸血鬼要**描述自己的消亡**。

### 13.4 角色 (Characters)

与吸血鬼有关的生物。

- 每个角色应当有名字，并用不完整的句子来描述。
- 每当吸血鬼在回应中与某个角色互动，都要添加角色的描述。
- 角色分为两类：
  - **凡俗生物**：会随着时间流逝而死亡。
  - **不朽生物**：基本不受时间影响。

### 13.5 印记 (Marks)

非人特征，代表吸血鬼有别于凡人的特征。这些印记会陪伴吸血鬼一生。

- 某些提示可能会添加或移除印记。
- 印记如何发挥作用取决于吸血鬼如何主动描述，不由系统强制判定。

### 13.6 回忆 (Memories)

回忆是随着时间推移经历的一系列相关经历。

- **经历**：回应提示的一句描述。几乎每条提示都会创造一段新的经历，这些经历最终会彼此结合形成回忆。
- 吸血鬼在开始的时候最多可以拥有 **5 段回忆**，每段回忆最多包含 **3 段经历**。
- 经历应当是一句可以唤起往昔的描述，说明发生之事和该事件对吸血鬼的意义。
- 吸血鬼能记住的东西是有限制的——回忆的空间是有限的，旧的回忆会随着推进而被遗忘，为新的回忆腾出空间。

**回忆的机械规则**：
- **经历 → 回忆**：系统按机械计数判定，每当累积 **3 段经历**即自动结合为 **1 段回忆**，不消耗 Agent 资源。
- **回忆满时**：由**玩家**选择遗忘哪一段回忆，而非系统自动淘汰。

### 13.7 日记

吸血鬼可以创建一本日记（或找到其他能保留记忆的东西），将记忆移入其中永久保存。

- 日记是一种**特殊资源**，会被添加到资源列表中。
- 默认情况下，日记最多可以容纳 **4 段回忆**。
- 吸血鬼同一时间只能拥有 **一本日记**，且其中至少要有一段回忆。
- 放入日记的回忆会从吸血鬼的头脑中**消失**。
- 一旦将回忆转移到日记中，就**不能**为该回忆添加新的经历。
- 只有阅读日记时才能回想起其中的回忆。
- 日记作为一种实际存在的资源，一旦丢失，里面容纳的回忆也会丢失，除非失而复得。

## 14. 提示系统

### 14.1 什么是提示

提示是一种推进故事发展的手段，往往非常简单明了。吸血鬼需要自己根据随机到的提示来叙述做了什么、感觉怎么样，这些提示可能会创建/改变/失去吸血鬼特征。

### 14.2 提示风格示例

- "新的法律和社会习俗让你更难藏身于人群之中，你几乎被捕，险些丧命的过程是怎么样的？检验一项技艺，创造一项技艺，创造一个为你提供帮助的罪犯凡俗生物。"
- "当太阳升起时，你被困在外面，多在一个你未曾预料的地方。一个孩子发现了你并与你成为朋友/创建一个凡人儿童角色并记录一次人性化的经历"
- "因为对鲜血的渴望，你杀死了身边的某个人。杀死一个凡俗生物，如果没有可用角色，那就创造一个凡俗生物再杀死。获得技艺：嗜血。"
- "某个凡俗生物开始侍奉你。那是怎么样的人？为何被你吸引？创造一个新的凡俗生物。"
- "某个值得信赖的凡俗生物以令人震惊的方式背叛了你。失去一种资源，这个人为什么要这么做？你为什么选择宽恕？"
- "某个凡俗生物为了救你牺牲了自己。检验一项技艺，获得一项与爱或信任相关的技艺。"
- "同一个家族的几代人为你服务。这条血脉从任何活着的凡人角色开始，或者从死去的凡人角色的后代开始。她们为自己的服务指定了哪些奇怪的仪式？失去一项资源并创建一个仆从家族资源"
- "你被某个与你相仿的生物认了出来。创造一个不朽生物，失去一种资源，并获得一项技艺。你会为此失去什么？"
- "夜晚的星辰如风车轮转，季节的变换如白驹过隙，你就像一台自动机器，对岁月的流逝毫无察觉。一个世纪过去了。划掉一段回忆，划掉所有凡俗生物。"
- "岁月侵蚀了你的日记，从日记中最早的记忆开始，划掉三个名词。如果你没有日记，就对中年时期中的前三个名词进行同样的操作"
- "你与一个古老的敌人角色因共同的过去而建立联系，在其中找到了比当前世界更易理解的东西。勾选一项技能，你们成为朋友。分享一项资源。并获得对方与你方向的一项资源"

### 14.3 回应提示的规则

- 吸血鬼回应提示时要**自然**，而非生硬。
- 如果现有特质或过往关联能与当前提示构成关联，那么可以设法融入回应。
- 不必回应提示中的所有问题。
- 在吸血鬼讲述故事的时候，往往要将数条提示结合起来考虑。提示之间的时间跨越没有限制，因此可以将其结合起来构成持续数日或数十年的故事线。
- 由于这是单人游戏，不需要优秀的文笔，也不需要穿插真实的历史故事，也可以天马行空创造平行宇宙——内容的多少不重要。

## 15. 车卡（故事开始前的准备工作）

在故事正式开始前，需要完成以下角色创建步骤：

- 创建一段成为吸血鬼**前**的经历
- 创建三个**凡人角色**，用简单的句子概括
- 创建三个符合角色的**技艺**
- 创建三个符合角色的**资源**
- 创建三段**经历**，分别录入不同的回忆中
- 创建一个**不朽者角色**，用简单的句子概括
- 创建一个**印记**
- 创建一段**变为吸血鬼**的相关经历

## 16. 独立前端与后台 Agent 分工

这个世界包需要**独立前端**，后台需要 agent 来分工处理各种任务。

### 16.1 吸血鬼的角色定位

吸血鬼可以是以下两种模式之一：
- **Agent 操控**：由 AI Agent 扮演吸血鬼，根据提示自动生成叙事回应。
- **玩家附身**：玩家直接手写吸血鬼的回应，Agent 退居辅助角色。

两者可在同一会话中随时切换。

**行为树**：当 Agent 操控吸血鬼时，引入行为树来组织决策流程，降低 Agent 的注意力成本和流程判断成本。行为树负责处理"收到提示 → 检查状态 → 选择回应方向"的结构化分支，避免 Agent 每次都需要从头推理。

具体行为树结构待设计。

### 16.2 提示池管理 Agent

**职责**：管理提示池序列的生命周期。

**提示池序列**：
- 提示池是一个有序的提示序列，每个位置存放一条类似 §14.2 风格的提示。
- 吸血鬼当前所在位置由骰子结果决定滑动方向和距离。
- 已经历过的提示会被**移出**提示池。

**工作流程**：
1. Agent **定期**向提示池序列添加新提示（风格参照 §14.2 示例）。
2. 每次吸血鬼投掷骰子后，根据 `1d10 - 1d6` 的结果在提示池中滑动到新位置。
3. 已使用的提示从池中移除。
4. Agent 检测到空位后，根据特定提示词生成新提示填充缺失位置。

**配置**（通过配置文件变量控制）：
- **提示池容量**：默认 `100`
- **补充触发阈值**：当已有 `45` 条提示被消费后，触发 Agent 补充新提示至池满

两值均通过配置文件设置，可在运行时调整。

**滑动节点示意**：
```
提示池: [P1, P2, P3, P4, P5, P6, P7, P8, ...]
                  ↑ 当前位置
骰子: 1d10(7) - 1d6(2) = +5 → 向前滑动 5 位
                  → [P1, P2, P3, P4, P5, P6, P7, P8, ...]
                                      ↑ 新位置
已过 P3, P4 被移出，Agent 补充新提示到池尾。
```

具体架构和分工细节待讨论。

## 17. 游戏循环与结束条件

这是一个**纯粹的无尽日记游戏**——没有胜利条件，没有终局目标。

唯一明确的终点是吸血鬼在技艺与资源双双枯竭时**描述自己的消亡**（见 §13.3 替代规则）。除此之外，循环永续：骰子滑动 → 提示触发 → 吸血鬼回应 → 产生经历 → 结合回忆 → 骰子再次滑动。

简单足矣。

## 18. 实现映射与缺口分析

以下将设计逐项映射到 Yidhras 现有架构，标注可实现路径与项目缺失。

### 18.1 实体映射

#### 吸血鬼 — `entity_kind: actor`

项目原生支持。吸血鬼的五种资源全部存储在 `entity_state` 的 `state_json` 中：

```yaml
entities:
  - id: "actor_vampire"
    entity_kind: "actor"
    label: "吸血鬼"
    tags: ["protagonist", "undead", "solo"]
    state:
      runtime:
        skills: []        # 技艺列表: {name, tested, linked_memory_id?}
        resources: []     # 资源列表: {name, description, lost}
        marks: []         # 印记列表: {name, description}
        memories: []      # 回忆列表: {id, name, experiences: [], archived_to_diary: false}
        mortal_name: null
        born_era: null
        turned_era: null
```

**状态**：可直接实现。

#### 凡俗/不朽角色 — `entity_kind: actor`

角色作为独立 actor 实体存在，通过 tag 区分生死属性：

```yaml
entities:
  - id: "actor_mortal_alice"
    entity_kind: "actor"
    label: "爱丽丝"
    tags: ["mortal", "servant"]
    state:
      runtime:
        description: "一个红发的乡村少女，因好奇而接近吸血鬼。"
        alive: true
```

凡俗生物在"一个世纪过去"类提示触发时批量标记 `alive: false`。

**状态**：可直接实现。

#### 日记 — `entity_kind: artifact`

已草案化。`artifact_diary` 作为特殊资源同时出现在：
- `entities` 中作为 artifact
- 吸血鬼 `state_json.resources` 中标记为 `kind: diary`

日记的回忆容量和当前存储的回忆 ID 列表存储在 artifact state 中：

```yaml
state:
  runtime:
    holder: "actor_vampire"
    memory_ids: []       # 最多 4 段回忆的 ID
    lost: false
```

**状态**：可直接实现。

#### 吸血诅咒 — `entity_kind: institution`

已草案化。作为客观规则来源实体，不需要额外状态。

**状态**：可直接实现。

### 18.2 技艺检验与替代规则 — Pack Rules

替代规则（§13.3）可通过 pack constitution 中的 `rules` 实现：

```yaml
rules:
  - id: "rule_skill_substitution"
    description: "无对应技艺时失去资源替代"
    condition:
      type: "prompt_requires_skill_test"
      params:
        skill_name: "{{prompt.skill_name}}"
    action:
      type: "check_and_substitute"
      params:
        primary: "find_skill"
        fallback: "lose_resource"
        
  - id: "rule_resource_substitution"
    description: "无可用资源时检验技艺替代"
    condition:
      type: "prompt_requires_resource_loss"
    action:
      type: "check_and_substitute"
      params:
        primary: "find_resource"
        fallback: "test_skill"

  - id: "rule_demise"
    description: "技艺资源双空 → 消亡"
    condition:
      type: "both_depleted"
    action:
      type: "narrate_demise"
```

**缺口**：现有规则引擎的 condition/action 类型（`entity_state`、`authority_grant`）不足以表达"检查吸血鬼是否有对应技艺"这种领域逻辑。需要：
- 新增自定义 condition 类型：`skill_exists`、`resource_available`、`both_depleted`
- 新增自定义 action 类型：`lose_resource`、`test_skill`、`narrate_demise`
- 或通过**插件 RuleContributor** 注册自定义规则处理器

### 18.3 骰子 — 模板宏

项目模板引擎已内置 `{{roll}}` 宏。1d10 和 1d6 可直接使用：

```yaml
# 在 prompt 模板或行为树中使用
{{roll "1d10"}}  # 十面骰
{{roll "1d6"}}   # 六面骰
```

骰子结果的减法与滑动逻辑需要在应用层实现（见 §18.5）。

**状态**：骰子投掷可直接实现；导航逻辑需自定义。

### 18.4 回忆系统 — 自定义存储

回忆系统（§13.6）与项目现有的 `MemoryBlock` 系统**语义不同**：

| | 项目 MemoryBlock | 吸血鬼回忆 |
|---|---|---|
| 用途 | AI Agent 上下文记忆 | 叙事日记内容 |
| 结构 | 向量嵌入 + 摘要 | 经历列表 + 回忆容器 |
| 触发 | 自动压缩/衰减 | 机械计数 3→1 |
| 操作 | Agent 查询 | 玩家选择遗忘 |

**建议**：不复用 `MemoryBlock`，直接在 pack-local 存储中新建表：

```
pack_vampire_experiences:
  - id, vampire_id, memory_id, content, created_at

pack_vampire_memories:
  - id, vampire_id, name, experience_count, archived_to_diary, created_at
```

**缺口**：需新建两张 pack-local 自定义表及对应 repository。需扩展 `PackStorageAdapter` 或通过插件 `DataCleaner` 注册。

### 18.5 提示池 — 全新子系统

提示池（§14、§16.2）在项目中**无对应物**，需要从零构建：

| 组件 | 实现路径 |
|---|---|
| 提示池序列存储 | pack-local 新表 `pack_prompt_pool`：`{position, content, consumed}` |
| 池容量/补充阈值 | pack `variables` 配置：`prompt_pool_capacity: 100`、`prompt_replenish_threshold: 45` |
| 骰子滑动导航 | 自定义逻辑：读取当前位置 + 骰子结果 → 计算新位置 → 标记已过提示为 consumed |
| Agent 定期补充 | 插件注册的定时任务或行为树节点：检测 `consumed_count >= threshold` → 调用 AI 生成新提示 → 追加到池尾 |

**缺口**：
- 无现有提示池存储模型 — 需新建 pack-local 表和 repository
- 无"定期触发 Agent"的调度机制 — 可复用现有 scheduler 分区模型，或由仿真循环步骤触发
- Agent 生成提示的 prompt 模板需单独设计

### 18.6 提示池管理 Agent — AI Task

Agent 生成新提示时使用的 system prompt 模板：

```
你是一个吸血鬼叙事游戏的提示生成器。
根据以下风格示例，生成 {count} 条新的游戏提示：

[§14.2 风格示例作为 few-shot]

要求：
- 每条提示需包含至少一个机械操作（检验技艺/失去资源/创建角色/获得印记/划掉回忆等）
- 提示之间保持主题多样性
- 使用简洁直白的语言
```

通过 `AiTaskService` 调用，结果解析后写入提示池表。

**状态**：AI 调用链可直接实现；结果的解析和写入需自定义逻辑。

### 18.7 行为树 — 现有支持

项目已有行为树提供者（`inference/providers/behavior_tree/`），pack constitution 支持声明式行为树定义：

```yaml
behavior_trees:
  - id: "bt_vampire_response"
    root:
      type: "sequence"
      children:
        - type: "check_prompt_type"      # 解析提示的机械要求
        - type: "check_state"            # 检查技艺/资源可用性
        - type: "apply_substitution"     # 必要时执行替代规则
        - type: "generate_narrative"     # 生成叙事回应
        - type: "update_state"           # 应用机械结果（失去资源、获得技艺等）
        - type: "record_experience"      # 将回应记录为一段经历
```

**缺口**：行为树的具体节点类型（`check_prompt_type`、`apply_substitution` 等）需作为自定义节点实现并在行为树提供者中注册。

### 18.8 车卡流程 — 前端 + Bootstrap

车卡（§15）分为两部分：

**Bootstrap 事件链**（后端）：通过 pack constitution 的 `bootstrap.initial_events` 定义车卡阶段的提示序列，引导玩家/Agent 逐步完成创建：

```yaml
bootstrap:
  initial_events:
    - event_type: "character_creation"
      steps:
        - prompt: "创建一段成为吸血鬼前的经历"
          target_state: "pre_vampire_experience"
        - prompt: "创建三个凡人角色"
          target_state: "mortal_characters"
        - prompt: "创建三个技艺"
          target_state: "skills"
        # ... 依次类推
```

**前端 UI**：独立前端中的车卡向导页面，逐步展示提示、收集输入、写入实体状态。

**缺口**：
- 现有 bootstrap 仅有单个 `initial_event`，无多步骤向导模式 — 需扩展
- 前端车卡 UI 需全新构建

### 18.9 时间步进 — Calendars + Tick

项目支持自定义历法（`calendars` 配置）和不稳定步进区间（`step.strategy: variable`），与 §10 草案一致。

"一个世纪过去"类提示触发时，需执行批量操作：
- 所有 `mortal` 角色标记 `alive: false`
- 删除/归档旧回忆

可通过 pack rule 的 action 实现：

```yaml
rules:
  - id: "rule_century_passage"
    condition:
      type: "prompt_tag"
      params:
        tag: "century_passage"
    action:
      type: "entity_state"
      params:
        query: "entity_kind=actor AND tag=mortal"
        update:
          state_json:
            alive: false
```

**状态**：时间步进本身可实现；批量条件更新依赖规则引擎能力，可能需要扩展。

### 18.10 前端 — 独立前端 vs 插件 Web Runtime

项目提供两种前端集成方式：

| 方式 | 路径 | 适用场景 |
|---|---|---|
| 插件 Web Runtime | `/packs/:packId/plugins/:pluginId/*` | 嵌入 Yidhras 主 Web 应用内 |
| 完全独立前端 | 新建 `apps/vampire` 或外部项目 | 独立部署，通过 API 与 server 通信 |

本世界包需求：
- 骰子投掷 UI
- 提示展示 + 吸血鬼回应输入区（玩家手写或 Agent 生成）
- 角色面板（五种资源展示、回忆浏览器、日记阅读器）
- 车卡向导

**建议**：先在主 Web 应用内通过 pack 自定义页面实现，后续根据需要拆分为独立应用。

**缺口**：
- 上述所有前端页面均需从零构建
- 骰子投掷动画/交互需自定义组件

### 18.11 缺口汇总

通用基础设施缺口已抽取至 `.limcode/plans/generic-world-pack-infrastructure-gaps.md`，此处仅列出本世界包特有的缺口。

| 缺口 | 严重程度 | 说明 |
|---|---|---|
| 提示池存储与逻辑 | **阻塞** | pack-local 自定义表（依赖通用缺口 1：插件存储访问，已完成）+ 导航逻辑 |
| 回忆系统自定义存储 | **阻塞** | pack-local 自定义表（依赖通用缺口 1：插件存储访问，已完成）|
| 技艺/资源替代规则 | **阻塞** | ~~依赖通用缺口 4（RuleContributor 接入执行引擎）~~ 已完成 |
| 行为树自定义节点 | **高** | ~~依赖通用缺口 5（行为树节点扩展）~~ 已完成 |
| 车卡多步骤流程 | **高** | ~~依赖通用缺口 3（Bootstrap initial_events 物化）~~ 已完成 |
| 提示池 Agent 定期触发 | **高** | ~~依赖通用缺口 6（PackLoopHooks 插件接入）~~ 已完成 |
| 前端全部页面 | **高** | 纯前端工作，不依赖后端缺口 |
| 印记与提示的交互逻辑 | **中** | 可暂用纯文本描述 |
| "标记失去但不删除"的软删除模式 | **低** | entity_state JSON 直接支持 |

### 18.12 建议实施顺序

1. **扩展 pack constitution schema** — 新增 entity state 字段定义（skills、resources、marks、memories）
2. **构建回忆系统存储** — pack-local 自定义表 + repository
3. **构建提示池存储** — pack-local 表 + 基本 CRUD
4. **实现骰子导航逻辑** — 应用层计算 + 提示池消费标记
5. **扩展规则引擎** — 注册自定义 condition/action 处理器（可通过插件 RuleContributor）
6. **设计行为树** — 吸血鬼回应流程的节点定义
7. **实现提示池 Agent** — AI Task 调用 + 定时触发
8. **构建前端** — 车卡 → 主游戏界面 → 角色面板 → 日记阅读器
