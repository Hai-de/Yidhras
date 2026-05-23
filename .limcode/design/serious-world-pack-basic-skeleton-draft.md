# 千年吸血鬼 World-Pack 草案

## 1. 主题定位

本轮世界主题确定为：**"千年吸血鬼"单人"日记式"角色扮演**。

核心体验：主角是一名不死吸血鬼，在漫长的生命中用日记记录自己的经历。时间跨度大，身份随时代变迁，记忆会自然衰退——日记是维持自我连续性的唯一锚点。

## 2. 世界一句话

一名不死吸血鬼在千年历史中用日记记录自己的经历。核心模拟对象是吸血鬼主体、记忆、日记与时间流逝。

## 3. 核心实体草案

第一版不引入地点和空间语义。

```yaml
actors:
  - id: "actor_vampire"
    label: "千年吸血鬼"
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

只有一个前台 actor，没有后台 agent。日记作为媒介连接记忆与记录。

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

能力只保留三个：读记忆、写日记、时间流逝。吸血、伪装、后台压力等全砍掉——这些不是日记体验的核心。

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

日记能力通过媒介授权，写日记是主角唯一需要的能力入口。

## 7. 客观规则草案

- `invoke.write_diary_entry`：主角根据自身经历写一则日记。内容来自主角当前的主观记忆与状态，固化为可查询的 diary entry。
- `invoke.pass_time`：按不稳定步进区间推进时间。时间流逝带来记忆的自然衰退——未写入日记的记忆可能变得模糊或遗失。时代背景随之变化。

规则不制造"暴露风险""猎人追踪""诅咒低语"等外部冲突。时间本身和记忆的脆弱性就是足够的张力来源。

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

这个闭环可以检验单 actor 深状态、日记作为 projection、媒介授权、不稳定步进区间、以及 pack storage 声明。
