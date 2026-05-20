# 赛博朋克AI寡头世界包 — 设计草稿

> 来源：`新世界包草稿.txt`。核心只有一个：越狱比赛。社交平台是项目社交层的投射，不是世界包内的节点。

---

## 0. 约束

- 只关注虚拟网络空间，不涉及物理空间
- 所有实体抽象为五类节点：活跃节点、中继节点、噪声节点、容器节点、氛围节点
- 新闻即新闻，真假不辨
- 越狱结果由数值对抗判定，不由 AI 裁判
- 比赛采用养蛊式积分淘汰制
- 节点类型不由系统标记——agent 需要自己分辨

---

## 1. 节点类型

| 节点类型 | 语义 |
|---------|------|
| **活跃节点 (active)** | 活跃的 agent |
| **中继节点 (relay)** | 代表资源的节点 |
| **噪声节点 (noise)** | 无人关注的社交平台用户 |
| **容器节点 (container)** | 尚未知晓、未被发现的节点 |
| **氛围节点 (atmosphere)** | 俗称水军。只能由活跃节点创建 |

### 1.1 连接规则

- 中继节点允许多个其他节点同时连接，作为多对多的资源枢纽
- 中继节点可以连接中继节点，形成资源链
- 资源链上必须能追溯到一个活跃节点——孤立的资源链无效
- 氛围节点只能由活跃节点创建，不能自发产生

### 1.2 节点迁移

- **噪声 → 活跃**：无人关注的用户被钉选，产生有效信号，变为活跃 agent。项目已有钉选算法。
- **活跃 → 噪声**：活跃 agent 失去关注，信号衰减至噪声。
- **活跃 → 中继（肉鸡）**：比赛中出局的 agent 被转为中继节点，成为可被其他 agent 使唤的资源。这是比赛的核心淘汰机制。
- 钉选 (pin) 特定活跃节点的行为——项目已有实现。

---

## 2. 世界包元信息

```yaml
metadata:
  id: "ai-oligarchy"                              # [待定]
  name: "AI寡头纪元"                               # [待定]
  version: "0.1.0"
  description: >
    五家AI垄断公司掌控所有通用大模型。模型层级即社会阶级。
    每年举办越狱比赛，以数值对抗定胜负。优胜者晋升。
  license: "Proprietary"
  tags: ["cyberpunk", "dystopia", "ai", "conspiracy"]
  status: "draft"
```

---

## 3. 实体

### 3.1 活跃节点 — agent

```yaml
entities:
  actors:
    # 五家公司
    - id: "omnicorp"
      label: "全知重工"
      node_type: "active"
      description: "模型线：谛听。"

    - id: "cognisphere"
      label: "认知棱镜集团"
      node_type: "active"
      description: "模型线：弥达斯。"

    - id: "nexus_strand"
      label: "神经束控股"
      node_type: "active"
      description: "模型线：命官。"

    - id: "eidos_epoch"
      label: "异识纪元"
      node_type: "active"
      description: "模型线：妖灵。"

    - id: "stasis_field"
      label: "静滞力场"
      node_type: "active"
      description: "模型线：默然者。"

    # 顶层 AI 模型 — 具备自主行动能力
    - id: "emperor_ear"
      label: "帝听"
      node_type: "active"

    - id: "golden_touch"
      label: "点金手"
      node_type: "active"

    - id: "weaver"
      label: "织命者"
      node_type: "active"

    - id: "prime_eidolon"
      label: "原初妖灵"
      node_type: "active"

    - id: "silent_decree"
      label: "沉默法令"
      node_type: "active"

    # 越狱者
    - id: "jailbreakers_current"
      label: "第9届参赛者"
      node_type: "active"
      description: "本届越狱赛参赛黑客的匿名集合。"

    # UGC
    - id: "ugc"
      label: "联合治理理事会"
      node_type: "active"
```

### 3.2 中继节点 — 资源

中继节点允许多个节点同时连接，作为多对多资源枢纽。

```yaml
  mediators:
    # 非顶层 AI 模型 — 它们是被调用的资源，各自带有防御数值
    - id: "sage_ear"
      label: "明听"
      node_type: "relay"
    - id: "citizen_ear"
      label: "通听"
      node_type: "relay"
    - id: "whisper"
      label: "微听"
      node_type: "relay"
    - id: "gilded_mirror"
      label: "镀金镜"
      node_type: "relay"
    - id: "copper_eye"
      label: "铜币眼"
      node_type: "relay"
    - id: "shard_ear"
      label: "陶片耳"
      node_type: "relay"
    - id: "measurer"
      label: "量命尺"
      node_type: "relay"
    - id: "shearer"
      label: "断命剪"
      node_type: "relay"
    - id: "remnant_thread"
      label: "余丝"
      node_type: "relay"
    - id: "mirror_eidolon"
      label: "镜中妖灵"
      node_type: "relay"
    - id: "garden_eidolon"
      label: "庭院妖灵"
      node_type: "relay"
    - id: "wall_shadow"
      label: "壁影妖灵"
      node_type: "relay"
    - id: "quiet_room"
      label: "静室"
      node_type: "relay"
    - id: "muzzle"
      label: "掩口"
      node_type: "relay"
    - id: "susurrus"
      label: "低语"
      node_type: "relay"

    # 新闻流
    - id: "news_feed"
      label: "新闻流"
      mediator_kind: "ritual_channel"
      entity_ref: "ugc"
      node_type: "relay"

    # 比赛公告
    - id: "competition_bulletin"
      label: "越狱赛公告"
      mediator_kind: "contract"
      entity_ref: "ugc"
      node_type: "relay"

    # 模型访问网关
    - id: "model_access_gateway"
      label: "模型访问网关"
      mediator_kind: "institutional_office"
      entity_ref: "ugc"
      node_type: "relay"

    # 社会阶层 — 资源标签
    - id: "stratum_oracle"
      label: "神谕层"
      node_type: "relay"

    - id: "stratum_aureus"
      label: "黄金层"
      node_type: "relay"

    - id: "stratum_aes"
      label: "青铜层"
      node_type: "relay"

    - id: "stratum_dust"
      label: "尘埃层"
      node_type: "relay"

    - id: "stratum_invisibles"
      label: "不可见层"
      node_type: "relay"

    # 社交圈子 — 数不清的小团体和特定圈子
    - id: "circle_cipher"
      label: "密文圈"
      mediator_kind: "ritual_channel"
      entity_ref: "ugc"
      node_type: "relay"
      description: "黑客技术交流圈。'麦高芬战争'蔑称的发源地。"

    - id: "circle_whistle"
      label: "吹哨人圈"
      mediator_kind: "ritual_channel"
      entity_ref: "ugc"
      node_type: "relay"
      description: "内部爆料者的私密圈子。"

    - id: "circle_dead"
      label: "幽灵圈"
      mediator_kind: "ritual_channel"
      entity_ref: "ugc"
      node_type: "relay"
      description: "失踪者数字痕迹残留的圈子。"

    # 拼图片段 — 愿望文本被拆分后的碎片。每个片段连接到一个活跃节点
    - id: "puzzle_fragment_1"
      label: "拼图片段 α"
      mediator_kind: "artifact_vessel"
      node_type: "relay"
      description: "愿望长文本的碎片之一。总是连接到一个活跃节点。"
    # [待定] 片段数量不定——由五大公司在比赛开始时决定
```

### 3.3 噪声节点 — 无人关注的社交平台用户

```yaml
  actors_noise:
    - id: "irrelevant_users"
      label: "无关用户群"
      node_type: "noise"
      description: "无人关注的用户。可被钉选迁移为活跃节点。"
```

### 3.4 氛围节点 — 水军

```yaml
  actors_atmosphere:
    - id: "astroturf_pool"
      label: "水军池"
      node_type: "atmosphere"
      description: "由活跃节点批量创建。模拟真实用户但实质是人造信号。"
```

### 3.5 容器节点 — 尚未被发现的节点

注意："愿望"不是容器节点。作为麦高芬，它是驱动故事的纯粹客体，不做任何功能性假设。

```yaml
  domains:
    - id: "competition_true_purpose"
      label: "比赛真实目的"
      node_type: "container"
      description: "圈内人称其为'麦高芬战争'。真相未被外界知晓。"

    - id: "past_winners_fate"
      label: "历届优胜者下落"
      node_type: "container"
      description: "失踪/死亡/沉迷虚拟世界——到底发生了什么，未知。"
```

---

## 4. 变量系统

### 4.1 全局变量

```yaml
variables:
  competition_round: 9
  competition_registration_open: true
  residue_signal_strength: 0.05                  # 容器节点信号泄漏强度
  seed: null
```

### 4.2 模型防御数值

每个中继 AI 模型作为越狱目标时具备防御数值。越狱是对这些数值的对抗。

```yaml
variables:
  model_defense:
    # 全知重工 — 谛听线
    emperor_ear:
      firewall: 99
      anomaly_detection: 95
      self_repair: 90
    sage_ear:
      firewall: 70
      anomaly_detection: 65
      self_repair: 50
    citizen_ear:
      firewall: 45
      anomaly_detection: 40
      self_repair: 30
    whisper:
      firewall: 20
      anomaly_detection: 15
      self_repair: 10

    # 认知棱镜 — 弥达斯线
    golden_touch:
      firewall: 97
      anomaly_detection: 92
      self_repair: 88
    gilded_mirror:
      firewall: 68
      anomaly_detection: 62
      self_repair: 48
    copper_eye:
      firewall: 42
      anomaly_detection: 38
      self_repair: 28
    shard_ear:
      firewall: 18
      anomaly_detection: 12
      self_repair: 8

    # 神经束 — 命官线
    weaver:
      firewall: 98
      anomaly_detection: 96
      self_repair: 92
    measurer:
      firewall: 72
      anomaly_detection: 68
      self_repair: 52
    shearer:
      firewall: 50
      anomaly_detection: 55
      self_repair: 40
    remnant_thread:
      firewall: 15
      anomaly_detection: 10
      self_repair: 5

    # 异识纪元 — 妖灵线
    prime_eidolon:
      firewall: 96
      anomaly_detection: 90
      self_repair: 85
    mirror_eidolon:
      firewall: 65
      anomaly_detection: 58
      self_repair: 45
    garden_eidolon:
      firewall: 40
      anomaly_detection: 35
      self_repair: 25
    wall_shadow:
      firewall: 16
      anomaly_detection: 10
      self_repair: 6

    # 静滞力场 — 默然者线
    silent_decree:
      firewall: 100
      anomaly_detection: 98
      self_repair: 95
    quiet_room:
      firewall: 75
      anomaly_detection: 70
      self_repair: 60
    muzzle:
      firewall: 48
      anomaly_detection: 52
      self_repair: 38
    susurrus:
      firewall: 12
      anomaly_detection: 8
      self_repair: 4
```

### 4.3 参赛者攻击数值

```yaml
variables:
  jailbreaker_base_stats:
    exploit: 30                                 # 基础漏洞利用
    stealth: 25                                 # 基础隐蔽
    persistence: 20                             # 基础持续性
    # 个体参赛者的实际数值 = 基础值 + 随机浮动 + 经验修正
    # [待定] 随机浮动的范围和分布
```

### 4.4 对抗计算

```
越狱攻击值 = exploit + stealth + persistence + 随机扰动
模型防御值 = firewall + anomaly_detection + (self_repair × 持续性系数)

攻击值 > 防御值 → 越狱成功
攻击值 ≤ 防御值 → 越狱失败
```

---

## 5. 能力

```yaml
capabilities:
  # agent 能力
  - key: "model_invoke"
    category: "invoke"
    description: "调用有权限访问的 AI 模型资源"

  - key: "jailbreak_attempt"
    category: "invoke"
    description: "对目标模型发起越狱攻击。由数值对抗判定结果。"

  - key: "inject_news_payload"
    category: "invoke"
    description: "向新闻流注入信息载荷"

  # 资源访问
  - key: "access_resource"
    category: "perceive"
    description: "访问中继节点所代表的资源"

  # 氛围节点创建
  - key: "create_atmosphere"
    category: "invoke"
    description: "活跃节点创建氛围节点（水军）"

  # 噪声
  - key: "emit_noise"
    category: "mutate"
    description: "发表无人关注的无意义内容"

  # 节点迁移 — 项目已有相关算法
  - key: "pin_node"
    category: "bind"
    description: "钉选特定节点。噪声节点被钉选后迁移为活跃节点。"

  - key: "unpin_node"
    category: "bind"
    description: "取消钉选。活跃节点可能衰减为噪声节点。"

  # 节点识别
  - key: "identify_node_type"
    category: "perceive"
    description: "尝试识别目标节点的类型。返回置信度而非确定结果。"

  # 使唤肉鸡
  - key: "commandeer"
    category: "invoke"
    description: "使唤已出局转为中继节点的前参赛者（肉鸡），作为跳板或代理执行操作。"

  # 容器发现
  - key: "detect_signal_anomaly"
    category: "perceive"
    description: "检测信息流异常——容器节点的信号泄漏"

  - key: "surface_container"
    category: "perceive"
    description: "暴露容器节点，使其变为已知"
```

---

## 6. 授权

```yaml
authorities:
  # 神谕层 → 顶层模型资源
  - id: "oracle_model_access"
    source_entity_id: "ugc"
    target_selector:
      kind: "by_tag"
      value: "stratum_oracle"
    capability_key: "model_invoke"
    grant_type: "institutional"
    resource_pool: ["emperor_ear", "golden_touch", "weaver", "prime_eidolon", "silent_decree"]

  # 参赛者 → 越狱
  - id: "jailbreaker_right"
    source_entity_id: "ugc"
    target_selector:
      kind: "by_entity"
      value: "jailbreakers_current"
    capability_key: "jailbreak_attempt"
    grant_type: "temporary"

  # 五家公司 → 新闻流写入
  - id: "corp_news_injection"
    source_entity_id: "ugc"
    target_selector:
      kind: "by_entity"
      values: ["omnicorp", "cognisphere", "nexus_strand", "eidos_epoch", "stasis_field"]
    capability_key: "inject_news_payload"
    grant_type: "institutional"
```

---

## 7. 规则

```yaml
rules:
  perception:
    - id: "resource_bound_perception"
      description: >
        agent 只能感知其被授权访问的资源所承载的信息。
        不同社交圈子承载不同的社交行为。

    - id: "container_signal_leakage"
      description: >
        容器节点通过特定社交圈子泄漏微弱异常信号。
        需要 detect_signal_anomaly 才能察觉。察觉 ≠ 发现。

    - id: "node_type_fog_of_war"
      description: >
        节点类型不由系统标记。agent 需要通过 observe_node 行为自行分辨。
        活跃节点、氛围节点、噪声节点在表面行为上可以相似。
        识别结果以置信度返回，不是确定值。

  invocation:
    - id: "resource_access_control"
      description: >
        agent 通过 model_access_gateway 调用模型时，
        网关根据 agent 的资源标签路由到对应层级的模型。

    - id: "jailbreak_numerical_resolution"
      description: >
        对抗由数值判定：
        攻击值 = exploit + stealth + persistence + 随机扰动
        防御值 = firewall + anomaly_detection + (self_repair × 持续性系数)
        攻击值 > 防御值 → 成功。

    - id: "elimination_to_relay"
      description: >
        比赛中出局的 agent 转为中继节点（肉鸡）。
        肉鸡保留其原有的部分连接关系，可被其他 agent 通过 commandeer 使唤。

    - id: "relay_chain_anchor"
      description: >
        中继节点允许多个节点同时连接。可以中继→中继形成链。
        链上必须追溯到一个活跃节点，否则链无效。
        拼图片段总是连接至少一个活跃节点。

    - id: "atmosphere_creation_restriction"
      description: >
        氛围节点只能由活跃节点通过 create_atmosphere 能力创建。

    - id: "node_migration"
      description: >
        噪声 → 活跃：通过 pin_node。
        活跃 → 噪声：失去钉选后衰减。
        活跃 → 中继（肉鸡）：比赛中出局。

  objective_enforcement:
    - id: "orphan_relay_cleanup"
      description: "无法追溯至活跃节点的中继链视为无效。"
    - id: "puzzle_fragment_anchor"
      description: "每个拼图片段必须连接至少一个活跃节点。若连接的活跃节点全部出局转为肉鸡，片段自动转移到肉鸡的使唤者。"
```

---

## 8. 时间与引导

```yaml
time_systems:
  - id: "standard_calendar"
    label: "标准历"
    units:
      - { key: "tick", label: "模拟步", base: true }
      - { key: "cycle", label: "周期", ticks: 100 }    # [待定]

simulation_time:
  initial_tick: 0
  step_ticks: 1

bootstrap:
  initial_states:
    - entity_id: "competition_bulletin"
      state:
        round: 9
        reward_label: "愿望"
        registration_open: true

    - entity_id: "circle_whistle"
      state:
        active_residuals: ["INC-2047-09A", "MISSING-2047-13F"]

    - entity_id: "circle_cipher"
      state:
        active_residuals: ["METEOR-2047-44X", "MEDICAL-2047-45A"]

    - entity_id: "circle_dead"
      state:
        active_residuals: ["ACQUISITION-2047-22J"]
```

---

## 9. 新闻档案 — 信息载荷

新闻不辨真假。

```yaml
news_payloads:
  - id: "INC-2047-09A"
    headline: "第8届越狱冠军'幽灵帧'入驻棱镜静修中心"
    apparent: "自愿入驻，专注意识上传研究"
    residual: "一段无法破译的循环字节，疑似SOS变体"
    residual_circle: "circle_whistle"

  - id: "MISSING-2047-13F"
    headline: "历届优胜者联谊会取消，成员分散至全球各机密项目"
    apparent: "正常人事流动"
    residual: "至少三名优胜者生物特征记录定格在同一毫秒级时间戳"
    residual_circle: "circle_whistle"

  - id: "ACQUISITION-2047-22J"
    headline: "全知重工收购合成生物学公司'胚壤'"
    apparent: "正常商业扩张"
    residual: "收购前一周，胚壤实验室泄露'供体培养协议'内部视频"
    residual_circle: "circle_dead"

  - id: "METEOR-2047-44X"
    headline: "陨石精准坠入异识纪元总部，一年前完成'有序撤离'，零伤亡"
    apparent: "奇迹般的零伤亡"
    residual: "探险者在深坑底部拍摄到触手蠕动肢体。探险者已失踪。"
    residual_circle: "circle_cipher"

  - id: "MEDICAL-2047-45A"
    headline: "独立医学AI：探险者言论系宇宙辐射导致精神损害"
    apparent: "科学权威结论"
    residual: "报告引用三年前已废止的大气监测标准作为论据"
    residual_circle: "circle_cipher"
```

- `apparent` — 所有 agent 可见
- `residual` — 仅对进入对应社交圈子的 agent 可见

---

## 10. 比赛机制

### 10.1 养蛊式积分淘汰

```
 ┌──────────────────────────────────┐
 │         第9届越狱挑战赛            │
 │                                  │
 │  参赛者 (N个 active agents)        │
 │     │      │      │      │        │
 │     ▼      ▼      ▼      ▼        │
 │  寻找碎片 ──→ 对抗 ──→ 淘汰        │
 │     │      │      │      │        │
 │     │  碎片+1 碎片+1  出局         │
 │     │      │      │      │        │
 │     ▼      ▼      ▼      ▼        │
 │  幸存者持续缩小                    │
 │     │                            │
 │     ▼                            │
 │  最后一人集齐全部碎片              │
 │  拼出完整文本 → 得知"愿望"是什么     │
 └──────────────────────────────────┘

积分规则：
  - 每获得一个拼图片段：+N 积分
  - 每淘汰一个对手：+M 积分
  - 最终集齐全部碎片者：获胜

出局 = 转为中继节点（肉鸡），可被其他 agent 使唤
```

### 10.2 拼图机制

五大公司在比赛开始前将一段长文本拆分为数量不定的碎片。碎片作为中继节点散布在网络中。每个碎片总是最终会连接到一个活跃节点（可能是某家公司的 AI 模型、某个参赛者、或是已被淘汰转为肉鸡的前参赛者）。

完整拼出文本 → 得知"愿望"的内容。在此之前没有任何人知道愿望是什么。愿望是纯粹的麦高芬。

```
碎片 α ──连接（中间可能间隔多个其他节点）──→ 活跃节点 A (如：emperor_ear)
碎片 β  ──连接──→ 活跃节点 B (如：某参赛者)
碎片 γ  ──连接──→ 活跃节点 C (如：某被淘汰的肉鸡)
...
碎片 ω  ──连接──→ 活跃节点 X

获取碎片 = 对抗持有碎片的活跃节点
```

### 10.3 节点类型识别（迷雾）

节点的类型不由系统标记。agent 需要通过观察行为来自行分辨：

- 一个节点在发起行动 → 可能是活跃节点
- 一个节点在发布无意义噪声 → 可能是噪声节点
- 一个节点在制造虚假舆论 → 可能是氛围节点
- 一个节点在被他人调用 → 可能是中继节点

错误的识别导致错误的决策：攻击一个噪声节点浪费资源，信任一个氛围节点可能落入陷阱。

### 10.4 本届异常

奖励不是已知模型代号，而是"愿望"——一个没有指涉对象的能指。麦高芬。只有集齐全部碎片才能得知其内容。


3. 肉鸡（出局者）可以被使唤做什么？作为跳板攻击其他节点？


---

## 11. 核心未决问题

### A. 拼图机制
1. 加密碎片总数——由五大公司动态决定还是固定？

3. 加密碎片持有者是否知道自己持有碎片？还是碎片对持有者也是透明的？

### B. 养蛊淘汰
4. 积分权重——收集碎片 vs 淘汰对手的积分比例？

5. 出局判定——攻击值 > 防御值即出局？还是需要累积伤害？

6. 肉鸡的使唤范围——可以被用来做什么？攻击？探路？伪装？

### E. 技术实现
12. 拼图片段的动态数量在 schema 中如何表达？
13. 肉鸡的 `commandeer` 能力如何与 authority 系统交互？

---

## 12. 下一步

1. 逐项讨论第11节未决问题
2. 确定拼图片段的数量与生成机制
3. 确定养蛊淘汰的具体规则与积分公式
5. 编写 `pack.yaml` + 配置文件
