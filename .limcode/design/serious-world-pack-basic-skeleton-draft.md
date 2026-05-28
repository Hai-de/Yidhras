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

- 创建吸血鬼的**名字**（本名、化名或两者皆有）
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

### 16.3 时间推进 Agent（Time Advancement Agent）

**职责**：分析吸血鬼在两次提示回应之间的叙事时间跨度，输出凡俗时间的推进量，驱动凡俗生物老化与死亡判定。

**为什么需要独立 Agent**：
- 吸血鬼的提示之间可能跨越数日、数年甚至数个世纪
- 单靠提示词难以可靠判定凡俗生物是否已死亡
- 凡俗生物的死亡应由代码（死亡曲线）判定，而非 AI 猜测
- 将"时间估算"与"叙事生成"分离，各司其职

**实体定义**：

```yaml
entities:
  actors:
    - id: "agent_time_keeper"
      label: "时间守护者"
      kind: "actor"
      entity_type: "time_keeper"
      tags: ["system", "background", "time"]
      state:
        core:
          last_checked_tick: 0
```

**触发机制**：事件驱动。当吸血鬼完成日记条目写入（`invoke.write_diary_entry`）后，enforcement rule 发出 `diary_entry_written` 事件。声明式 workflow 在 signal window 内捕获该事件，创建 WorkflowRun 激活时间推进 Agent。

```yaml
workflows:
  mortal_time_advancement:
    trigger:
      type: event
      event_types: ["diary_entry_written"]
    max_ticks: 3
    failure_policy: narrativize
    lock_policy: active_steps
    steps:
      - id: analyze_time_gap
        agent: agent_time_keeper
        inference:
          provider: openai_compatible
          model: qwen-turbo
```

**推理流程**：

1. Agent 通过 context assembly 获取最近的吸血鬼日记条目（经由感知管线已物化为 overlay entry）
2. Agent 的系统提示指示其分析叙事时间跨度：
   ```
   你是一个时间分析器。阅读以下吸血鬼的日记条目，分析两条条目之间的叙事时间跨度。
   输出格式：
   {
     "estimated_mortal_years": <number>,
     "reasoning": "<为什么判断是这个时间跨度>"
   }
   ```
3. Agent 产出推理结果，经 Intent Grounder 映射为 `set_requested_step_ticks` intent
4. Action dispatcher 处理该 intent，调用 `packRuntime.setRequestedStepTicks()`
5. 下一 tick 的 sim loop step 2 消费该值，推进时钟
6. MortalityContributor 在 step 2 中检查所有 `tags: ["mortal"]` 的实体，根据年龄与死亡曲线判定生死

**数据流**：

```
Vampire 写日记 → diary_entry_written 事件
  → Workflow 触发 → Time Agent 推理 → 输出 estimated_mortal_years
  → Intent Grounder → set_requested_step_ticks intent
  → Action Dispatcher → packRuntime.setRequestedStepTicks(ticks)
  → 下一 tick step 2 → getEffectiveStepTicks(ctx, requestedStep)
  → 时钟推进 → MortalityContributor 批量检查
  → 凡俗生物 age += elapsedTicks → 死亡曲线判定 → alive: true/false
```

**死亡曲线参数**（通过 pack variables 配置）：

```yaml
variables:
  mortality_curve:
    max_probability: 0.8    # 年死亡率上限
    midpoint: 60            # P=50% 的年龄中点
    steepness: 0.08         # 曲线陡峭度
```

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
        current_alias: null  # 当前使用的化名
        appearance: {}       # 外观设定存储
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
        - prompt: "设定你的吸血鬼的名字（本名或化名）和外观描述"
          target_state: "character_identity"
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

### 18.10 时间推进系统 — 分层实现
#### 18.10.1 世界包层（插件实现）

以下逻辑属于吸血鬼世界包，通过 **pack-local plugin** 实现。插件文件位于 `<pack-dir>/plugins/mortality/`：

| 文件 | 说明 |
|------|------|
| `plugin.manifest.yaml` | 插件声明：capability 请求、入口、配置 |
| `mortality_contributor.ts` | 插件入口 + StepContributor 实现 |

**插件参考文件**：`.limcode/design/vampire-pack-plugin/`

**插件工作流**：
1. Pack 加载时，宿主扫描 `plugins/` 目录，发现插件
2. 插件激活后通过 `host.registerStepContributor()` 注册
3. 每次 sim loop step 2，宿主调用所有已注册 StepContributor（含本插件）
4. 插件检查 entities 中 `tags: ["mortal"]` 的实体，按死亡曲线判定生死

**关键约束**：
- 时间推进 Agent 的输出（`set_requested_step_ticks`）在 action dispatch (step 5) 被处理，但在下一个 tick 的 world engine step (step 2) 才被消费——存在 1 tick 延迟
- `computeVariableStep` 已将 `requestedStep` clamp 在 `simulation_time.step.range` 内，Agent 无法突破世界包设定的时间边界
- 凡俗实体的 `tags: ["mortal"]` 和 `state.core: { age, alive }` 由世界包 YAML 定义——这些不是框架级概念
- 死亡曲线参数写在插件 manifest 的 `config` 段，可被世界包作者覆盖

## 19. 前端设计草案

基于世界包的叙事特性（千年吸血鬼、日记、时间流逝、记忆衰退），结合UI/UX Pro Max技能分析，制定以下前端设计草案。本文档覆盖完整的前端设计方案，包括布局、组件、状态管理、API交互、可访问性、性能优化等所有设计细节。

### 19.1 设计系统定义

#### 视觉风格：哥特式日记美学

**风格关键词**：
- 哥特式（Gothic）：深色、神秘、古典
- 日记/手稿质感：羊皮纸纹理、墨水渍迹、手写字体元素
- 时间侵蚀感：磨损边缘、褪色效果、复古滤镜
- 温暖暗色主题：非纯黑，而是深棕色、深紫色、深蓝色

**色彩系统**：
```css
/* 主色调 - 暗色背景系列 */
--vampire-bg-deep: #0a0a0f;     /* 最深背景 */
--vampire-bg-base: #1a1515;     /* 主背景 */
--vampire-bg-elevated: #2a2020; /* 升级背景 */

/* 强调色 - 血与金 */
--vampire-blood: #8b0000;      /* 血色红 */
--vampire-gold: #d4af37;       /* 古金色 */
--vampire-ink: #2d1b69;        /* 墨水紫 */
--vampire-parchment: #f5e6c8;  /* 羊皮纸色 */

/* 状态色 */
--vampire-text-primary: #e8d5b7; /* 主要文字 */
--vampire-text-secondary: #a09080; /* 次要文字 */
--vampire-border: rgba(139, 0, 0, 0.3); /* 血色边框 */
```

**字体方案**：
- 标题字体：Playfair Display（古典衬线，适合哥特主题）
- 正文字体：Inter（现代清晰，适合长文本）
- 日记手写体：Caveat（手写风格，用于日记条目展示）

#### 交互设计原则

1. **时间流动感**：页面切换使用缓慢的淡入淡出（300-500ms），模拟时间流逝
2. **记忆衰退效果**：旧内容逐渐变淡、模糊，新内容清晰明亮
3. **骰子物理感**：投掷动画包含抛物线运动和落地反弹
4. **日记翻页感**：日记阅读器使用类似翻页的交互效果

### 19.2 页面布局方案

#### 断点定义与策略

| 断点 | 范围 | 布局策略 |
|------|------|----------|
| 移动 | <768px | 单栏全宽 + 底部 Tab 导航 + 抽屉式侧菜单 |
| 平板 | 768px–1023px | 可折叠窄侧边栏（48px 图标态 / 240px 展开态）+ 主内容区 |
| 桌面 | ≥1024px | 固定 280px 侧边栏 + 主内容区 |

所有断点共享同一套组件，通过 Tailwind 响应式前缀（`md:` / `lg:`）切换布局，不拆分独立页面。

#### 桌面端布局（≥1024px）
```
┌─────────────────────────────────────────────────────┐
│ [顶部状态栏] 当前时代 | 骰子结果 | 快速操作按钮      │
├─────────────────────┬───────────────────────────────┤
│ [左侧边栏]          │ [主内容区]                      │
│ - 吸血鬼状态面板     │ - 提示展示区                    │
│ - 五种资源概览       │ - 吸血鬼回应区                  │
│ - 日记快速访问       │ - 经历/回忆创建区               │
├─────────────────────┴───────────────────────────────┤
│ [底部操作栏] 骰子投掷 | 切换模式 | 设置                │
└─────────────────────────────────────────────────────┘
```

#### 平板端布局（768px–1023px）

侧边栏默认收起为 **48px 图标栏**，仅显示图标（吸血鬼状态、技艺、资源、日记、角色、印记、回忆、设置）。点击图标展开至 240px 显示完整面板，再次点击或点击遮罩收回。主内容区占满剩余宽度。

```
┌──────┬──────────────────────────────────────────────┐
│ [图标]│ [顶部状态栏] 当前时代 | 骰子结果              │
│  栏   ├──────────────────────────────────────────────┤
│  48px │ [主内容区]                                    │
│      │ - 提示展示区                                   │
│ 吸血鬼│ - 吸血鬼回应区                                 │
│ 技艺  │ - 经历/回忆创建区                              │
│ 资源  ├──────────────────────────────────────────────┤
│ 日记  │ [底部操作栏] 骰子投掷 | 切换模式               │
│ 角色  │                                              │
│ 印记  │                                              │
│ 回忆  │                                              │
│ 设置  │                                              │
└──────┴──────────────────────────────────────────────┘
```

点击任一图标可展开侧边栏面板（240px），展示该功能的完整内容。展开时主内容区缩窄，面板覆盖在主内容区上方（带半透明遮罩），点击遮罩或再次点击图标收回。

#### 移动端布局（<768px）

底部导航采用 **4 Tab + 抽屉菜单** 策略，覆盖全部功能入口：

```
┌──────────────────────────────┐
│ [顶部状态栏] 当前时代 | ☰    │
├──────────────────────────────┤
│ [主内容区]                   │
│ - 提示展示                   │
│ - 吸血鬼回应区               │
├──────────────────────────────┤
│ [底部导航]                   │
│ 🎲骰子 | 📖日记 | 🧠回忆 | ⋯更多 │
└──────────────────────────────┘
```

**底部 Tab 分配**：

| Tab | 图标 | 内容 |
|-----|------|------|
| 骰子 | 🎲 | 主游戏界面：当前提示 + 骰子投掷 + 回应输入 |
| 日记 | 📖 | 日记阅读器（独立视图） |
| 回忆 | 🧠 | 回忆浏览器 + 经历列表（独立视图） |
| 更多 | ⋯ | 点击后弹出**底部抽屉**，包含：技艺、资源、印记、角色、设置、车卡入口 |

**"更多"抽屉**：
- 从底部滑入，高度约 60% 屏幕
- 网格布局（2列），每格一个功能入口图标 + 标签
- 车卡入口仅在游戏未初始化时显示

#### 车卡向导布局（全屏模态）

**多步骤向导设计**：
```
┌─────────────────────────────────────────────┐
│ [进度条] 1/9 ████████░░░░░░░░░░░░           │
├─────────────────────────────────────────────┤
│ [步骤标题] 设定你的吸血鬼的名字               │
│                                             │
│ [提示说明] 为你的吸血鬼设定一个名字（本名或化名）以及外观描述。这将帮助AI Agent更好地进入角色。│
│                                             │
│ [输入区域] 多行文本输入框                     │
│                                             │
│ [示例参考] 暗淡显示的历史示例                 │
├─────────────────────────────────────────────┤
│ [操作按钮] ← 上一步 | 跳过 | 下一步 →         │
└─────────────────────────────────────────────┘
```

### 19.3 核心组件设计

#### 1. 骰子组件（DiceRoller）

**视觉设计**：
- 3D骰子效果，使用CSS 3D变换
- 血色红（1d10）和深紫色（1d6）配色
- 投掷动画：抛物线轨迹 + 旋转 + 落地反弹
- 结果展示：数字从模糊到清晰的淡入效果

**交互流程**：
1. 点击"投掷骰子"按钮
2. 骰子动画播放（1.5-2秒）
3. 结果数字显示（带轻微脉冲动画）
4. 自动滑动到提示池新位置

**状态管理**：
```typescript
interface DiceState {
  phase: 'idle' | 'rolling' | 'resolving' | 'success' | 'error'
  d10Result: number | null
  d6Result: number | null
  totalResult: number | null
  error: { message: string; canRetry: boolean } | null
  lastServerCommittedResult: { total: number; position: number } | null
}
```

**防重复提交机制**：

| Phase | 按钮状态 | UI 表现 |
|-------|----------|----------|
| `idle` | 可点击 | 默认态 |
| `rolling` | **disabled** + 指针光标 | 3D 骰子动画播放（1.5-2s），此时阻断用户重复点击 |
| `resolving` | **disabled** | 动画结束，等待服务端确认骰子结果并推进提示池 |
| `success` | 可点击（"再次投掷"） | 显示结果数字 + 滑动到新提示位置的动画 |
| `error` | 可点击（"重试"） | 红色错误提示条：「投掷失败：{message}」|

**错误重试规则**：
- 网络超时/500 错误 → 允许**原地重试**（不重新投掷，沿用客户端计算的骰子结果重新提交）
- 服务端拒绝（400/422：如 "当前提示未处理，不允许投掷"）→ 显示具体原因，不允许盲目重试
- `lastServerCommittedResult` 记录最后一次服务端确认的结果。重试时如果发现服务端实际已接受（轮询/重连检查），自动同步而非重复提交

**防抖**：按钮点击后立即进入 `rolling`，网络请求在动画结束后才发出（自然防抖）。

#### 2. 提示展示组件（PromptDisplay）

**布局设计**：
- 卡片式提示展示，带有羊皮纸纹理背景
- 提示内容使用手写风格字体
- 机械要求部分（检验技艺/失去资源等）用血色高亮
- 支持长文本滚动，带褪色边缘效果

**状态指示**：
- 新提示：明亮、清晰
- 已读提示：略微变暗
- 已处理提示：显示完成标记

#### 3. 吸血鬼回应组件（VampireResponse）

**输入模式**：
- **玩家手写模式**：富文本编辑器，支持基本格式
- **Agent生成模式**：显示AI生成内容，支持编辑和确认

**设计特点**：
- 输入框带有墨水渍迹效果
- 字数统计显示
- 自动保存草稿功能
- 响应时长时间标记

#### 4. 角色面板组件（CharacterPanel）

**资源展示设计**：
```
┌─────────────────────────────────────┐
│ [技艺] 剑术 ✓检验 | 伪装 ○未检验   │
├─────────────────────────────────────┤
│ [资源] 黑曜石小刀 | 老旧日记本      │
├─────────────────────────────────────┤
│ [印记] 苍白的皮肤 | 永恒的饥饿      │
├─────────────────────────────────────┤
│ [回忆] 5/5 ████████████████████░░░  │
├─────────────────────────────────────┤
│ [角色] 爱丽丝(凡俗) | 马库斯(不朽)  │
└─────────────────────────────────────┘
```

**交互特性**：
- 点击展开详细信息
- 拖拽重新排序
- 状态切换动画（检验/未检验、存活/死亡）

#### 5. 日记阅读器组件（DiaryReader）

**视觉设计**：
- 仿古书籍界面，带翻页效果
- 日记条目按时间顺序排列
- 手写风格字体展示内容
- 边缘磨损效果

**功能特性**：
- 翻页动画（左右滑动或点击箭头）
- 书签功能
- 搜索日记内容
- 记忆衰退可视化（旧条目逐渐变淡）

#### 6. 回忆浏览器组件（MemoryBrowser）

**布局设计**：
- 网格布局展示回忆卡片
- 每个回忆卡片显示：名称、经历数量、状态（活跃/归档）
- 回忆详情：展开显示经历列表

**状态管理**：
```typescript
interface MemoryState {
  memories: Memory[];
  experiences: Experience[];
  maxMemories: number;
  maxExperiencesPerMemory: number;
}
```

### 19.4 页面路由设计

由于采用 `PackFrontendMount` 挂载方案，吸血鬼前端作为独立 Vue 子应用挂载在 `/packs/:packId` 路径下。子应用内部使用 **Hash 路由** 以避免与主应用路由冲突：

```
/packs/:packId                    # Shell 路由，PackFrontendMount 挂载点
  #/                               # 主游戏界面（吸血鬼子应用内部路由）
  #/character-creation             # 车卡向导
  #/diary                          # 日记阅读器
  #/chronicle                      # 编年史（已消费提示历史）
  #/memories                       # 回忆浏览器
  #/characters                     # 角色管理
  #/settings                       # 世界包设置
  #/demise                         # 消亡终局
```

**路由配置**：子应用使用 `createWebHashHistory()` 创建 Vue Router 实例，在 `mount()` 时传入的容器 div 内部渲染。

**注意**：子应用的路由状态完全独立于主应用。当用户从主应用导航离开 `/packs/:packId` 时，`PackFrontendMount` 的 `onBeforeUnmount` 会调用 `unmount()` 销毁整个子应用（包括其路由实例）。

### 19.5 状态管理方案

**Pinia 实例隔离**：作为 `PackFrontendMount` 子应用，吸血鬼前端在 `mount()` 时创建**独立的 Vue App 实例**，包含独立的 Pinia 实例。子应用的 Store 与主应用 `apps/web` 的 Store（如 authStore）完全隔离，不会发生 ID 或命名空间冲突。`shellContext.auth_token` 在挂载时一次性注入，后续认证信息存储在子应用自身的 auth composable 中。

Store 划分如下：
1. **GameStore**：游戏核心状态
   - 当前时代、骰子状态、提示池位置
   - 吸血鬼模式（Agent操控/玩家附身）

2. **CharacterStore**：角色状态
   - 五种资源（技艺、资源、印记、回忆、角色）
   - 日记状态

3. **PromptStore**：提示系统状态
   - 提示池序列、当前位置
   - 已消费提示历史

4. **UIStore**：界面状态
   - 侧边栏展开/收起
   - 当前活动面板
   - 主题设置

### 19.6 与后端交互设计

#### 与现有 Capability-based Action Dispatch 对接

Yidhras 后端采用 **capability-based action dispatch** 模型（`POST /api/packs/:packId/actions`），而非专用 REST 端点。吸血鬼前端的 API 设计必须与现有架构对齐。

**核心通信模型**：所有游戏操作通过 `POST /api/packs/:packId/actions` 发送，请求体包含 `capability_key` 和 `payload`。根据前缀分流：

- `perceive.*` → 同步查询，通过已注册的 `PackQueryHandler` 即时返回数据
- `invoke.*` → 异步入队，创建 `ActionIntent` 由 sim loop 消费处理，返回 `intent_id`

响应通过统一的 `{ success: true, data: {...} }` 信封格式返回。

**认证**：通过 `shellContext.auth_token`（由 `PackFrontendMount` 传递的 `buildShellContext()` 提供）作为 Bearer Token 注入 HTTP 请求头。框架层依次校验：operator 身份 → pack 绑定（L1）→ capability grant（L2）。

**Capability Key 映射**：

| 前端操作 | Capability Key | 路径 | 说明 |
|----------|----------------|------|------|
| 投掷骰子 | `invoke.roll_dice` | invoke | 自定义 capability，内部调用 `roll("1d10")` + `roll("1d6")` 并计算滑动 |
| 获取当前提示 | `perceive.current_prompt` | perceive | 读取提示池当前位置的提示内容 |
| 提交吸血鬼回应 | `invoke.respond_to_prompt` | invoke | 玩家/Agent 回应提示，触发经历创建 |
| 读取角色状态 | `perceive.character_state` | perceive | 读取五种资源、身份等 |
| 写日记 | `invoke.write_diary_entry` | invoke | 已定义（§5），将回忆移入日记 |
| 车卡流程 | `invoke.character_creation` | invoke | 自定义 capability，多步骤引导创建 |

**perceive 查询扩展**：`perceive.*` capability 的查询处理通过 `PackQueryHandler` 接口注册。世界包插件可在激活时调用 `host.registerHandler('perceive.character_state', handler)` 注册自定义查询解析器，由框架层的 `PackQueryHandlerRegistry` 统一管理。

#### 实时更新机制

- 使用 WebSocket 连接实时同步游戏状态（复用主应用的 WebSocket 基础设施）
- 推送提示池更新、骰子结果、状态变化
- 断线重连机制

#### WebSocket 降级体验

**核心判断**：吸血鬼世界包是单人回合制叙事游戏。WebSocket 的唯一用途是推送后台 Agent 推理结果（时间守护者 Agent、提示池管理 Agent）。断线 ≠ 游戏不可用——断线影响的是服务端推送，不影响玩家阅读已有内容和本地编辑。

**连接状态机**：

```
connected ←→ reconnecting → disconnected（永久失败）
                                ↓
                          fallback: polling
```

| 状态 | 触发条件 | 持续时间 |
|------|---------|---------|
| `connected` | WS 握手成功 | 正常运行 |
| `reconnecting` | 连接断开，重试次数 ≤ maxRetries（默认 5） | 指数退避：1s → 2s → 4s → 8s → 16s → 30s（封顶） |
| `disconnected` | 重试次数 > maxRetries 或服务端明确拒绝 | 永久，直到手动重连或页面刷新 |

**断线时 UI 指示**（顶部状态栏内连接指示器，非全屏遮罩）：

```html
<!-- 顶部状态栏最右侧，骰子结果左侧 -->
<div class="connection-indicator">
  <!-- connected: 不显示（健康状态不占视觉资源） -->

  <!-- reconnecting: 脉冲琥珀点 + 文案 -->
  <span v-if="status === 'reconnecting'">
    <span class="pulse-dot amber" /> 重新连接中…
  </span>

  <!-- disconnected: 红点 + 重连按钮 -->
  <span v-else-if="status === 'disconnected'">
    <span class="pulse-dot red" /> 连接已断开
    <button @click="manualReconnect">重试</button>
  </span>
</div>
```

断线瞬间额外弹出非阻断 toast（5 秒后自动消失）：「与服务器的连接已断开，部分内容可能无法使用。」

**断线期间操作可用性**：

| 操作 | connected | reconnecting | disconnected |
|------|-----------|-------------|-------------|
| 阅读已有内容（日记、回忆、角色状态） | ✅ | ✅ 本地缓存 | ✅ 本地缓存 |
| 玩家手写回应 | ✅ 同步 | ⚠️ 排队暂存 | ⚠️ 排队暂存 |
| 投掷骰子 | ✅ | ❌ 禁用 | ❌ 禁用 |
| Agent 操控模式生成回应 | ✅ | ❌ 自动切回玩家模式 | ❌ 自动切回玩家模式 |
| 写日记 | ✅ | ⚠️ 排队暂存 | ⚠️ 排队暂存 |
| 后台 Agent 推送结果 | ✅ | ❌ 延迟 | ❌ 延迟 |

**排队暂存机制**：断线期间的写入操作（回应提示、写日记）保存在本地 `pendingActions` 队列，重连后按顺序 replay。UI 上对应操作按钮旁显示「暂存中」标记。

**重连后状态合并 — 全量快照覆盖**（不用增量 patch）：

理由：单人游戏，pending 队列是唯一的"分叉"来源，数据量小；全量快照实现简单，无 patch 冲突处理复杂性。

```
重连成功
  → perceive.full_state_snapshot（GET 最新完整状态）
  → 用服务端快照覆盖 Pinia stores
  → 检查 pendingActions 队列
      → 有排队操作？→ 逐条 replay（按原始顺序 POST /api/actions）
      → replay 失败？→ 标记为 conflict，弹窗让玩家选择「重试」或「丢弃」
  → 清除 pending 队列，状态恢复完成
```

**永久断线 fallback — HTTP 轮询**：

进入 `disconnected` 状态且手动重连仍失败时，提供降级选项：

- 切换为 HTTP 长轮询（每 10 秒 `perceive.full_state_snapshot`）
- 状态栏显示：「⚠ 低速模式（轮询中）」
- 轮询期间所有写入仍走排队暂存，轮询成功时 flush
- 轮询连续失败 3 次 → 停止轮询，提示「无法连接服务器，请检查网络后刷新页面」

**`useVampireConnection` composable**：

```typescript
interface ConnectionState {
  status: Ref<'connected' | 'reconnecting' | 'disconnected'>
  pendingActions: Ref<PendingAction[]>       // 断线期间排队的操作
  flushPending: () => Promise<void>          // 重连后 replay 排队操作
  manualReconnect: () => Promise<void>       // 手动重连
  lastSyncTime: Ref<Date | null>            // 最后成功同步时间
  isPolling: Ref<boolean>                   // 是否在轮询降级模式
}
```

#### 音效开关 UI

音效控件放置在设置页面（`#/settings`）内，不在主游戏界面占独立控件。原因：哥特式日记游戏的核心氛围是安静的沉浸感，音效是可选增强而非必需品，主界面应减少视觉噪声。

设置页内提供：

- 主音效开关（全局 on/off）
- 音量滑块（0–100%）
- 分类音量：骰子声、翻页声、环境音效各自独立滑块

设置持久化到 `localStorage`（key: `vampire_audio_{packId}`），不在后端存储。UIStore 中新增 `audioSettings` 字段，播放音频前统一读取。

#### 富文本编辑器选型

**选择 Tiptap**（基于 ProseMirror）。

| 候选 | 优势 | 劣势 |
|------|------|------|
| **Tiptap** ✅ | Vue 3 原生支持；headless 架构（UI 完全自定义，便于套哥特皮肤）；Markdown 快捷键；插件体系成熟 | 体积较大（~80KB gzip） |
| Quill | 轻量、成熟 | Vue 3 集成需 wrapper；UI 不易深度定制；Delta 格式转换额外成本 |
| 纯 textarea | 零依赖 | 无富文本能力（无法加粗、斜体、分隔线） |

日记式长文本场景需要的能力：Markdown 快捷输入（`**` → 加粗、`---` → 分隔线）、自动换行、字数统计、自动保存。Tiptap 的 `StarterKit` + 自定义 `CharacterCount` extension 即可覆盖，哥特式 UI 通过 headless 架构完全自控。

**依赖声明**：`@tiptap/vue-3`、`@tiptap/starter-kit`、`@tiptap/extension-character-count` 声明在子应用的 `package.json` 中，不混入主应用 `apps/web` 的依赖。

#### 提示消费历史回溯

消费过的提示**不直接删除**，而是标记 `consumed: true` 并从滑动序列中移除，同时保留在独立的 **编年史（Chronicle）** 存储中。

**新增路由**：`#/chronicle`

**Chronicle 组件**：按时间倒序展示已消费提示 + 玩家回应摘要。每条记录包含：
- 提示内容
- 回应时的骰子结果
- 对应的经历/回忆 ID 关联（可点击跳转到 MemoryBrowser）
- 关联的日记条目（可跳转到 DiaryReader）

**UI 形态**：垂直时间线布局。

```
┌──────────────────────────────────────────────────────┐
│  📜  编年史                                           │
├──────────────────────────────────────────────────────┤
│  Tick 87 ─── 「你被某个与你相仿的生物认了出来…」     │
│              🎲 +3 | 创造不朽角色：马库斯             │
│              → 关联回忆：「黑暗年代」                  │
│                                                      │
│  Tick 74 ─── 「新的法律和社会习俗让你更难藏身…」     │
│              🎲 -2 | 检验技艺：伪装                   │
│              → 关联日记条目：第 3 则                  │
│                                                      │
│  Tick 51 ─── 「夜晚的星辰如风车轮转…」               │
│              🎲 +8 | 划掉回忆：「初拥之夜」           │
│              ⚠️ 无关联（回忆已被遗忘）                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**编年史存储**：`prompt_pool` 表中 `consumed: true` 的记录即为编年史数据源，无需额外存储表。前端通过 `perceive.chronicle` capability 查询（`consumed=true` + `ORDER BY consumed_at DESC`）。

### 19.7 交互反馈设计

#### 时间流逝视觉反馈

时间推进由提示内容触发（如"一个世纪过去"），而非独立的 `invoke.pass_time` 按钮操作。因此"时间流逝"的视觉反馈嵌入在**提示展示**和**提示回应流程**中，而非独立界面。

**时间事件分级与视觉表现**：

| 时间跨度级别 | 判定条件 | 视觉表现 |
|-------------|----------|----------|
| 小跨度（数日–数月） | 提示中无明确时间词 | 无特殊视觉，正常提示流程 |
| 中跨度（数年–数十年） | 提示包含"几年后""多年过去"等 | 提示卡片增加 `--vampire-ink` 色左竖条标记，下方显示「⏳ 时间流逝」标签 |
| 大跨度（一个世纪+） | 提示包含"一个世纪""百年过去"等 | **全屏过渡动画**：2-3秒的羊皮纸卷轴展开效果 + 日历页快速翻动 |

**大跨度时间过渡流程**（完整动画序列，约 3-5 秒）：

```
[1] 全屏遮罩淡入（深棕半透明），中央显示时间跨度文字
       e.g. "一百零三年后……"
[2] 旧内容区域渐隐（opacity 0 → 1，带模糊滤镜，模拟记忆褪色）
[3] 角色面板动态更新：
       - 标记死亡的凡俗角色：名字加删除线 + 灰化 + 💀 图标
       - 记忆衰退：受影响的回忆卡片增加半透明遮罩 + 褪色效果
[4] 遮罩淡出，新提示卡片从中央展开
```

**角色批量死亡展示**：在角色面板 `CharacterPanel` 中，死亡角色不立即消失，而是保持可见但灰化，带 `alive: false` 标记。鼠标悬停可查看死亡年代。仅在玩家主动执行"清除已故角色"操作时才从列表移除。

#### 替代规则触发时的反馈设计

替代规则（§13.3）是核心机械循环，必须有清晰的因果反馈链。新增**事件通知栈**（EventToastStack）组件：

**组件位置**：主内容区右上角，从上往下堆叠，每条通知 5 秒后自动淡出。

**通知类型**：

| 触发场景 | 通知样式 | 示例文案 |
|----------|----------|----------|
| 无对应技艺 → 失去资源 | 🟡 黄色左边框 + ⚠️ 图标 | 「你没有掌握“剑术”，不得不付出代价：失去了**黑曜石小刀**。」|
| 无可用资源 → 检验技艺 | 🟠 橙色左边框 + ⚠️ 图标 | 「你没有任何可失去的资源，只好强行检验：**伪装**（未检验 → 已检验）。」|
| 技艺资源双空 → 消亡 | 🔴 红色左边框 + 💀 图标，**不可自动关闭** | 「技艺与资源双双枯竭……你的吸血鬼生涯走到了尽头。点击此处描述你的消亡。」|
| 获得新技艺 | 🟢 绿色左边框 + ✨ 图标 | 「新技艺习得：**嗜血**」|
| 角色死亡 | ⚫ 灰色左边框 + 🕯️ 图标 | 「**爱丽丝**（凡俗）已不在人世。」|

**消亡通知的特殊处理**：点击后跳转到终局 UI。

#### "描述消亡"终局 UI

**页面路由**：`#/demise`（Hash 路由）

**布局设计**：

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│              🩸  吸血鬼的终章  🩸                    │
│                                                     │
│  [回顾区]                                            │
│  ├── 旅程统计：存活时长、经历回忆数、日记条目数       │
│  ├── 时间轴：主要事件的简要时间线                    │
│  └── 关键角色：曾经遇见的角色列表（存活/已故标记）    │
│                                                     │
│  ─────────────────────────────────────────────────   │
│                                                     │
│  [消亡叙事区]                                        │
│  ├── 提示说明："请描述你的吸血鬼如何迎来终结"        │
│  ├── 富文本编辑器（与 VampireResponse 同款）          │
│  └── 提交按钮："记录终章"                           │
│                                                     │
│  ─────────────────────────────────────────────────   │
│                                                     │
│  [提交后]                                            │
│  ├── 消亡叙事以最终日记条目样式展示                  │
│  ├── "开始新的千年"按钮 → 重置游戏（回到车卡）       │
│  └── "返回主页"按钮 → `/packs/:packId`              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**旅程统计数据来源**：从 `GameStore` 和 `CharacterStore` 聚合。无需新 API，纯前端计算。

**终局后的游戏状态**：游戏进入 `ended` 状态，GameStore 的 `gamePhase: 'ended'` 锁定所有操作按钮（骰子、回应区），只保留终局页和"重新开始"入口。

#### 日记容量满 / 回忆满的选择交互

**回忆满（5/5）时 — 「遗忘抉择」模式**：

当累积经历达到上限（第 5 段回忆已满且新经历待创建）时：

1. 主内容区切换为「遗忘抉择」模式（遮罩覆盖游戏主界面）
2. 展示 5 张回忆卡片（网格布局），每张卡片显示：回忆名称、经历数量、首段经历摘要
3. 卡片可点击展开查看全部经历内容
4. 玩家**必须点选**要遗忘的一段 → 选中卡片高亮 + 边框脉冲动画（血色红）
5. 确认按钮「遗忘此段回忆」→ 回忆被移除，新经历创建流程继续
6. **不允许跳过**（§13.6 明确规定满时必须遗忘才能腾出空间）

**视觉设计**：

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️  回忆已满 — 选择遗忘一段                              │
│  你的记忆空间已满。为了容纳新的经历，必须遗忘一段旧回忆。│
├─────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│ │ 初拥之夜 │ │ 爱丽丝  │ │ 黑暗年代 │ │ 马库斯  │ │ 新世界  │ │
│ │ 3 段经历 │ │ 3 段经历 │ │ 2 段经历 │ │ 3 段经历 │ │ 1 段经历 │ │
│ │  [选择]  │ │  [选择]  │ │  [选择]  │ │  [选择]  │ │  [选择]  │ │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ │
│                                                             │
│           [ 遗忘选中的回忆 ]                                 │
└─────────────────────────────────────────────────────────┘
```

**日记满（4/4）时 — 容量告警 + 引导管理**：

1. CharacterPanel 的日记容量条显示 `4/4` 并变为血色（`--vampire-blood`）
2. 尝试存入新回忆时弹出确认对话框：
   ```
   日记已满（4/4），必须先遗忘日记中的一段回忆。
   是否打开日记阅读器选择？
   [取消]  [打开日记]
   ```
3. 跳转到 DiaryReader 的「管理模式」：每条回忆旁出现「移出」按钮
4. 移出后回忆回到活跃回忆列表（§13.6 机制：放入日记的回忆从头脑中消失 → 移出则反向恢复）
5. 移出操作需要确认：「将「XXX」从日记中移出？移出后该回忆将重新占用活跃回忆槽位。」

**日记容量管理与回忆满的关系**：日记满（4/4）不等于回忆满（5/5）。日记中的回忆是从活跃回忆列表中移出的，两者独立计数。因此日记满时只需管理日记内槽位，不触发「遗忘抉择」模式。

#### 车卡向导断点续填

车卡有 9 步。采用 **localStorage 自动暂存 + 后端一次性提交** 的双层策略：

| 层级 | 机制 |
|------|------|
| **暂存层**（localStorage） | 每步输入完成后 debounce（500ms）自动保存到 `vampire_cc_draft_{packId}` key，格式：`{ packVersion, currentStep, formData: {...} }`。重新打开向导时检测到草稿 → 弹窗「检测到未完成的车卡记录，是否继续？」 |
| **持久层**（后端） | 车卡最后一步「提交」时，一次性将全部数据通过 `invoke.character_creation` capability 写入后端实体状态。提交成功后清除 localStorage 草稿 |
| **版本校验** | localStorage 草稿附带 `packVersion` 字段。如果世界包版本更新导致数据结构变化，提示「世界包已更新，需要重新开始车卡」并清除草稿 |

**为什么不用后端逐步保存**：车卡是开局前置流程，此时 pack 的实体状态尚未初始化完成（吸血鬼 actor、资源、角色等都依赖车卡结果来创建）。在 `character_creation` capability 执行之前，后端没有合法的写入目标。

**恢复交互流程**：

```
打开车卡页面
  → 检测 localStorage 草稿
  → 有草稿？
      ├─ 版本匹配 → 弹窗「检测到未完成的车卡（第 N 步），是否继续？」
      │   ├─ 继续 → 跳转到对应步骤，恢复表单数据
      │   └─ 重新开始 → 清除草稿，从第 1 步开始
      └─ 版本不匹配 → 提示并清除草稿，从第 1 步开始
```


### 19.8 组件状态管理设计

#### 组件 loading / empty / error 状态覆盖

六个核心组件（DiceRoller、PromptDisplay、VampireResponse、CharacterPanel、DiaryReader、MemoryBrowser）均需覆盖 loading / empty / error 三态。采用**统一 composable + 专用骨架屏组件**策略，而非逐个手写：

**统一组合式函数 `useVampireAsync`**：

```typescript
// composables/useVampireAsync.ts
interface VampireAsyncState<T> {
  data: Ref<T | null>
  status: Ref<'idle' | 'loading' | 'loaded' | 'empty' | 'error'>
  error: Ref<Error | null>
  retry: () => Promise<void>
}

function useVampireAsync<T>(fetcher: () => Promise<T>, options?: {
  isEmpty?: (data: T) => boolean  // 自定义空判断
  autoRetry?: boolean             // 自动重试
}): VampireAsyncState<T>
```

composable 返回 `status` 响应式值，组件根据 status 切换展示。`isEmpty` 回调用于区分 `'loaded'` 和 `'empty'`（如 `memories.length === 0` → `'empty'`）。

**Loading 状态 — `<VampireSkeleton>` 骨架屏组件**：

```html
<!-- 统一骨架屏，variant 匹配各组件真实布局尺寸 -->
<VampireSkeleton variant="prompt" />     <!-- 卡片式骨架，匹配 PromptDisplay 尺寸 -->
<VampireSkeleton variant="editor" />     <!-- 长文本区域骨架，匹配 VampireResponse -->
<VampireSkeleton variant="panel" />      <!-- 多行列表骨架，匹配 CharacterPanel -->
<VampireSkeleton variant="diary" />      <!-- 翻页书籍骨架，匹配 DiaryReader -->
<VampireSkeleton variant="memory-grid" /> <!-- 网格卡片骨架，匹配 MemoryBrowser -->
<VampireSkeleton variant="dice" />       <!-- 方块骨架，匹配 DiceRoller -->
```

骨架屏使用羊皮纸色（`--vampire-parchment`）的闪烁动画，与哥特主题视觉一致。**关键约束**：骨架屏必须匹配各组件的真实布局尺寸，避免加载完成后页面跳动，破坏哥特式的"沉稳"视觉节奏。

**Empty 状态**：

各组件内联 `v-if="status === 'empty'"` 分支，展示上下文相关空状态：

| 组件 | 空状态展示 |
|------|------------|
| DiceRoller | 「尚未投掷骰子」+ 引导按钮「开始你的旅程」 |
| PromptDisplay | 「提示池加载中…」或「当前位置无提示」（根据区分） |
| VampireResponse | 「等待提示触发…」 |
| CharacterPanel | 各资源分区分别显示「暂无技艺」「暂无资源」「暂无印记」「暂无回忆」「暂无角色」 |
| DiaryReader | 「日记空空如也，开始写第一则吧」+ 写日记入口按钮 |
| MemoryBrowser | 「尚未积累任何回忆」+ 引导文案 |

**Error 状态 — `<VampireErrorBanner>` 全局组件**：

```html
<VampireErrorBanner
  :error="error"
  :retry="retry"
  dismissible
/>
```

血色边框（`--vampire-blood`）+ 错误信息 + 重试按钮。由 `useVampireAsync` 统一管理 `error` / `retry()` 状态。非阻断式（不覆盖全屏），显示在对应组件区域顶部。

**组件使用示例**（以 DiaryReader 为例）：

```vue
<template>
  <VampireSkeleton v-if="status === 'loading'" variant="diary" />
  <VampireErrorBanner v-else-if="status === 'error'" :error="error" :retry="retry" />
  <div v-else-if="status === 'empty'" class="diary-empty">
    <p class="text-vampire-text-secondary">日记空空如也</p>
    <button @click="startWriting">开始写第一则</button>
  </div>
  <DiaryBook v-else :entries="data" />
</template>

<script setup>
const { data, status, error, retry } = useVampireAsync(
  () => actionClient.invoke('perceive.diary_entries', {}),
  { isEmpty: (d) => d.entries.length === 0 }
)
</script>
```



### 19.9 可访问性设计

#### WCAG AA标准遵守

1. **色彩对比度**：所有文字与背景对比度≥4.5:1
2. **键盘导航**：完整键盘操作支持
3. **屏幕阅读器**：ARIA标签和语义化HTML
4. **动画控制**：支持减少动画选项

#### 语言支持

- 中文（简体/繁体）
- 英文
- 日文
- 通过i18n系统实现

### 19.10 性能优化策略

1. **代码分割**：按路由懒加载组件
2. **图片优化**：WebP格式，响应式图片
3. **字体加载**：font-display: swap
4. **缓存策略**：静态资源缓存，API响应缓存
5. **虚拟滚动**：日记条目等长列表使用虚拟滚动

### 19.11 实现路径建议

#### 阶段一：基础框架（1-2周）
1. 搭建Nuxt项目结构
2. 集成Tailwind CSS和Nuxt UI
3. 创建基础布局组件
4. 实现状态管理基础

#### 阶段二：核心组件（2-3周）
1. 骰子组件开发
2. 提示展示组件
3. 吸血鬼回应组件
4. 角色面板组件

#### 阶段三：高级功能（2-3周）
1. 日记阅读器
2. 回忆浏览器
3. 车卡向导
4. 实时同步功能

#### 阶段四：优化完善（1-2周）
1. 可访问性优化
2. 性能优化
3. 多语言支持
4. 测试和调试

### 19.12 技术风险评估

| 风险项 | 影响程度 | 缓解措施 |
|--------|----------|----------|
| 3D骰子动画性能 | 中 | 使用CSS 3D变换，避免JavaScript动画 |
| 大量日记条目渲染 | 高 | 虚拟滚动，分页加载 |
| 实时同步稳定性 | 高 | WebSocket重连机制，本地状态持久化 |
| 多语言内容布局 | 中 | 使用i18n，响应式设计 |
| 哥特式主题可读性 | 中 | 严格遵守WCAG对比度标准 |

### 19.13 设计资源需求

1. **图标**：Lucide图标库（哥特式风格适配）
2. **字体**：Google Fonts（Playfair Display、Inter、Caveat）
3. **纹理**：羊皮纸、墨水渍迹、磨损边缘素材
4. **动画**：骰子物理动画、翻页效果、时间流逝效果
5. **音效**：骰子投掷声、翻页声、环境音效（可选）
