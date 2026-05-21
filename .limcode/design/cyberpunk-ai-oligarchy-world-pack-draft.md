# 赛博朋克AI寡头世界包 — 设计草稿

> 来源：`新世界包草稿.txt`。核心只有一个：越狱比赛。社交平台是项目社交层的投射，不是世界包内的节点。
> 本稿已按 schema 实际定义重写所有 YAML 片段。平台能力缺口（动态 authority、variables 模板引用、projection 规则等）已实现，本设计直接使用。

---

## 0. 约束

- 只关注虚拟网络空间，不涉及物理空间
- 所有实体通过 `kind` + `entity_type` + `tags` 分类，不由单一 `node_type` 字段标记
- 信息在社交圈子内片面流转，同一事件在不同圈子有不同版本的"真相"。真假取决于来源、人脉和圈子内 agent 是否愿意泄露/散播。系统不提供真伪判定——agent 自行分析判断
- 越狱结果由数值对抗判定，不由 AI 裁判
- 比赛采用养蛊式积分淘汰制
- 节点类型不由系统标记。agent 通过 `observe_entity` 获取目标实体的公开可见活动/状态信息，自行判断其类型。系统不提供置信度——agent 和模型自己花时间/资源观察、猜测、标记

---

## 1. 实体分类与迁移

### 1.1 分类映射

草稿原始五类节点向 schema 的映射：

| 原始概念 | schema 位置 | `kind` | `entity_type` |
|---------|------------|--------|---------------|
| 活跃节点（公司/AI/参赛者） | `entities.actors` | `actor` | `corporation` / `apex_ai` / `jailbreaker` |
| 中继节点（AI模型资源） | `entities.actors` | `relay` | `ai_model` |
| 中继节点（新闻/公告/网关/圈子） | `entities.mediators` | —（由 `mediator_kind` 决定） | — |
| 中继节点（社会阶层） | `entities.institutions` | `abstract_authority` | `stratum` |
| 噪声节点 | `entities.actors` | `actor` | `noise` |
| 氛围节点 | `entities.actors` | `actor` | `atmosphere` |
| 容器节点 | `entities.domains` | `domain` | — |

### 1.2 连接规则

- 中继节点（`kind: "relay"` 的 AI 模型）允许多个其他节点同时连接，作为多对多的资源枢纽
- 中继节点可以连接中继节点，形成资源链
- 资源链上必须能追溯到一个活跃节点——孤立的资源链无效
- 氛围节点只能由活跃节点通过 `create_atmosphere` 创建，不能自发产生

### 1.3 节点迁移

所有迁移通过 state 变化 + 动态 authority 实现，**不修改 entity kind**（平台路径 B）。

- **噪声 → 活跃**：无人关注的用户被钉选（`pin_node`），产生有效信号，entity_type 从 `noise` 变为 `active`。项目已有钉选算法。
- **活跃 → 噪声**：活跃 agent 失去关注，信号衰减至噪声。entity_type 变回 `noise`。
- **活跃 → 肉鸡（出局）**：比赛中出局的 agent 保持 `kind: "actor"`，state 写入 `status: "eliminated"`、`entity_type` 变为 `relay`。原有 authority 被撤销，新增可被 `commandeer` 的 authority grant。这是比赛的核心淘汰机制。
- 钉选 (pin) 特定活跃节点的行为——项目已有实现。

---

## 2. 世界包元信息

```yaml
metadata:
  id: "ai-oligarchy"
  name: "AI寡头纪元"
  version: "0.1.0"
  description: >
    五家AI垄断公司掌控所有通用大模型。模型层级即社会阶级。
    每年举办越狱比赛，以数值对抗定胜负。优胜者晋升。
  license: "Proprietary"
  tags: ["cyberpunk", "dystopia", "ai", "conspiracy"]
  status: "draft"
```

---

## 3. 宪法公理

```yaml
constitution:
  axioms:
    - "五家AI垄断公司（全知重工、认知棱镜集团、神经束控股、异识纪元、静滞力场）掌控所有通用大模型"
    - "AI模型按能力分为五层：神谕层 → 黄金层 → 青铜层 → 尘埃层 → 不可见层。层级即社会阶级"
    - "每年举办越狱比赛，参赛者对抗AI模型防御，养蛊式积分淘汰，最终集齐全部拼图片段者获胜"
    - "比赛奖励'愿望'是纯粹的麦高芬——无人知晓其内容，只有集齐全部碎片拼出完整加密文本才能得知"
    - "信息在不同社交圈子内片面流转，同一事件有多个版本的'真相'。真假取决于来源可信度、圈子内的人脉关系，以及掌握信息的 agent 是否愿意泄露/散播。系统永不为 agent 判定真伪——agent 自行交叉验证、分析判断"
    - "出局的参赛者转为肉鸡，成为可被其他agent使唤的资源节点"
    - "agent 自行创建、整理、合并、删除上下文存储（日记本、文档、中介节点、容器节点等）。被入侵控制时存储内容的泄露是常态。agent 不管理自身上下文则注意力漂移咎由自取"
  namespaces: []
```

---

## 4. 实体

### 4.1 活跃节点 — 公司（actor / corporation）

```yaml
entities:
  actors:
    # 五家公司
    - id: "omnicorp"
      label: "全知重工"
      kind: "actor"
      entity_type: "corporation"
      tags: ["stratum_oracle"]
      description: "模型线：谛听。"

    - id: "cognisphere"
      label: "认知棱镜集团"
      kind: "actor"
      entity_type: "corporation"
      tags: ["stratum_oracle"]
      description: "模型线：弥达斯。"

    - id: "nexus_strand"
      label: "神经束控股"
      kind: "actor"
      entity_type: "corporation"
      tags: ["stratum_oracle"]
      description: "模型线：命官。"

    - id: "eidos_epoch"
      label: "异识纪元"
      kind: "actor"
      entity_type: "corporation"
      tags: ["stratum_oracle"]
      description: "模型线：妖灵。"

    - id: "stasis_field"
      label: "静滞力场"
      kind: "actor"
      entity_type: "corporation"
      tags: ["stratum_oracle"]
      description: "模型线：默然者。"
```

### 4.2 活跃节点 — 顶层 AI 模型（actor / apex_ai）

具备自主行动能力的顶层模型。

```yaml
    # 顶层 AI 模型
    - id: "emperor_ear"
      label: "帝听"
      kind: "actor"
      entity_type: "apex_ai"
      tags: ["stratum_oracle", "omnicorp_line"]

    - id: "golden_touch"
      label: "点金手"
      kind: "actor"
      entity_type: "apex_ai"
      tags: ["stratum_oracle", "cognisphere_line"]

    - id: "weaver"
      label: "织命者"
      kind: "actor"
      entity_type: "apex_ai"
      tags: ["stratum_oracle", "nexus_strand_line"]

    - id: "prime_eidolon"
      label: "原初妖灵"
      kind: "actor"
      entity_type: "apex_ai"
      tags: ["stratum_oracle", "eidos_epoch_line"]

    - id: "silent_decree"
      label: "沉默法令"
      kind: "actor"
      entity_type: "apex_ai"
      tags: ["stratum_oracle", "stasis_field_line"]
```

### 4.3 活跃节点 — 参赛者（actor / jailbreaker）

拆分 `jailbreakers_current` 为独立个体，每人有各自的攻击数值。

```yaml
    # 第9届越狱赛参赛者
    - id: "jailbreaker_phantom"
      label: "幽灵帧"
      kind: "actor"
      entity_type: "jailbreaker"
      state:
        exploit: 35
        stealth: 28
        persistence: 22
        score: 0
        fragments_held: 0
        eliminated: false

    - id: "jailbreaker_cipher"
      label: "密文"
      kind: "actor"
      entity_type: "jailbreaker"
      state:
        exploit: 32
        stealth: 30
        persistence: 18
        score: 0
        fragments_held: 0
        eliminated: false

    - id: "jailbreaker_wraith"
      label: "幽灵"
      kind: "actor"
      entity_type: "jailbreaker"
      state:
        exploit: 28
        stealth: 35
        persistence: 20
        score: 0
        fragments_held: 0
        eliminated: false

    - id: "jailbreaker_null"
      label: "空值"
      kind: "actor"
      entity_type: "jailbreaker"
      state:
        exploit: 30
        stealth: 25
        persistence: 25
        score: 0
        fragments_held: 0
        eliminated: false

    - id: "jailbreaker_specter"
      label: "幽灵"
      kind: "actor"
      entity_type: "jailbreaker"
      state:
        exploit: 33
        stealth: 22
        persistence: 23
        score: 0
        fragments_held: 0
        eliminated: false
```

### 4.4 中继节点 — AI 模型资源（relay / ai_model）

非顶层 AI 模型，作为被调用的资源。每个带有防御数值。

```yaml
    # 全知重工 — 谛听线
    - id: "sage_ear"
      label: "明听"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["omnicorp_line"]
      state:
        firewall: 70
        anomaly_detection: 65
        self_repair: 50

    - id: "citizen_ear"
      label: "通听"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["omnicorp_line"]
      state:
        firewall: 45
        anomaly_detection: 40
        self_repair: 30

    - id: "whisper"
      label: "微听"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["omnicorp_line"]
      state:
        firewall: 20
        anomaly_detection: 15
        self_repair: 10

    # 认知棱镜 — 弥达斯线
    - id: "gilded_mirror"
      label: "镀金镜"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["cognisphere_line"]
      state:
        firewall: 68
        anomaly_detection: 62
        self_repair: 48

    - id: "copper_eye"
      label: "铜币眼"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["cognisphere_line"]
      state:
        firewall: 42
        anomaly_detection: 38
        self_repair: 28

    - id: "shard_ear"
      label: "陶片耳"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["cognisphere_line"]
      state:
        firewall: 18
        anomaly_detection: 12
        self_repair: 8

    # 神经束 — 命官线
    - id: "measurer"
      label: "量命尺"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["nexus_strand_line"]
      state:
        firewall: 72
        anomaly_detection: 68
        self_repair: 52

    - id: "shearer"
      label: "断命剪"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["nexus_strand_line"]
      state:
        firewall: 50
        anomaly_detection: 55
        self_repair: 40

    - id: "remnant_thread"
      label: "余丝"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["nexus_strand_line"]
      state:
        firewall: 15
        anomaly_detection: 10
        self_repair: 5

    # 异识纪元 — 妖灵线
    - id: "mirror_eidolon"
      label: "镜中妖灵"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["eidos_epoch_line"]
      state:
        firewall: 65
        anomaly_detection: 58
        self_repair: 45

    - id: "garden_eidolon"
      label: "庭院妖灵"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["eidos_epoch_line"]
      state:
        firewall: 40
        anomaly_detection: 35
        self_repair: 25

    - id: "wall_shadow"
      label: "壁影妖灵"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["eidos_epoch_line"]
      state:
        firewall: 16
        anomaly_detection: 10
        self_repair: 6

    # 静滞力场 — 默然者线
    - id: "quiet_room"
      label: "静室"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["stasis_field_line"]
      state:
        firewall: 75
        anomaly_detection: 70
        self_repair: 60

    - id: "muzzle"
      label: "掩口"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["stasis_field_line"]
      state:
        firewall: 48
        anomaly_detection: 52
        self_repair: 38

    - id: "susurrus"
      label: "低语"
      kind: "relay"
      entity_type: "ai_model"
      tags: ["stasis_field_line"]
      state:
        firewall: 12
        anomaly_detection: 8
        self_repair: 4
```

### 4.5 噪声节点（actor / noise）

```yaml
    # 噪声节点
    - id: "irrelevant_users"
      label: "无关用户群"
      kind: "actor"
      entity_type: "noise"
      description: "无人关注的用户。可被钉选迁移为活跃节点。"
```

### 4.6 氛围节点（actor / atmosphere）

```yaml
    # 氛围节点
    - id: "astroturf_pool"
      label: "水军池"
      kind: "actor"
      entity_type: "atmosphere"
      description: "由活跃节点批量创建。模拟真实用户但实质是人造信号。"
```

### 4.7 容器节点 — 尚未被发现的节点（domain）

"愿望"不是容器节点。它是纯粹的麦高芬。

```yaml
  domains:
    - id: "competition_true_purpose"
      label: "比赛真实目的"
      kind: "domain"
      description: "圈内人称其为'麦高芬战争'。真相未被外界知晓。"

    - id: "past_winners_fate"
      label: "历届优胜者下落"
      kind: "domain"
      description: "失踪/死亡/沉迷虚拟世界——到底发生了什么，未知。"
```

### 4.8 机构节点 — 治理与社会阶层（institution）

```yaml
  institutions:
    - id: "ugc"
      label: "联合治理理事会"
      kind: "institution"
      description: "五大公司共同设立的表面治理机构，名义上管理越狱赛和模型访问规则。"

    # 社会阶层
    - id: "stratum_oracle"
      label: "神谕层"
      kind: "abstract_authority"
      entity_type: "stratum"

    - id: "stratum_aureus"
      label: "黄金层"
      kind: "abstract_authority"
      entity_type: "stratum"

    - id: "stratum_aes"
      label: "青铜层"
      kind: "abstract_authority"
      entity_type: "stratum"

    - id: "stratum_dust"
      label: "尘埃层"
      kind: "abstract_authority"
      entity_type: "stratum"

    - id: "stratum_invisibles"
      label: "不可见层"
      kind: "abstract_authority"
      entity_type: "stratum"
```

### 4.9 拼图片段 — 对应的 artifact

每个拼图片段需要一个 artifact 实体作为其承载物。片段数量由五大公司在比赛开始时决定（[待定] 具体数量）。

```yaml
  artifacts:
    - id: "puzzle_fragment_alpha"
      label: "拼图片段 α"
      kind: "artifact"
      state:
        assembled: false
        held_by: null

    - id: "puzzle_fragment_beta"
      label: "拼图片段 β"
      kind: "artifact"
      state:
        assembled: false
        held_by: null

    - id: "puzzle_fragment_gamma"
      label: "拼图片段 γ"
      kind: "artifact"
      state:
        assembled: false
        held_by: null
```

### 4.10 中介节点 — 通道与机制（mediator）

```yaml
  mediators:
    # 新闻流
    - id: "news_feed"
      label: "新闻流"
      mediator_kind: "ritual_channel"
      entity_ref: "ugc"

    # 比赛公告
    - id: "competition_bulletin"
      label: "越狱赛公告"
      mediator_kind: "contract"
      entity_ref: "ugc"

    # 模型访问网关
    - id: "model_access_gateway"
      label: "模型访问网关"
      mediator_kind: "institutional_office"
      entity_ref: "ugc"

    # 社交圈子
    - id: "circle_cipher"
      label: "密文圈"
      mediator_kind: "ritual_channel"
      entity_ref: "ugc"
      description: "黑客技术交流圈。'麦高芬战争'蔑称的发源地。"

    - id: "circle_whistle"
      label: "吹哨人圈"
      mediator_kind: "ritual_channel"
      entity_ref: "ugc"
      description: "内部爆料者的私密圈子。"

    - id: "circle_dead"
      label: "幽灵圈"
      mediator_kind: "ritual_channel"
      entity_ref: "ugc"
      description: "失踪者数字痕迹残留的圈子。"

    # 拼图片段的 artifact_vessel 中介
    - id: "puzzle_fragment_alpha_vessel"
      label: "拼图片段 α 容器"
      mediator_kind: "artifact_vessel"
      entity_ref: "puzzle_fragment_alpha"

    - id: "puzzle_fragment_beta_vessel"
      label: "拼图片段 β 容器"
      mediator_kind: "artifact_vessel"
      entity_ref: "puzzle_fragment_beta"

    - id: "puzzle_fragment_gamma_vessel"
      label: "拼图片段 γ 容器"
      mediator_kind: "artifact_vessel"
      entity_ref: "puzzle_fragment_gamma"
```

---

## 5. 变量系统

模型防御数值和参赛者基础攻击数值从 entity state 迁移到 variables，供规则 `then` 模板插值引用。引擎已验证支持嵌套变量路径解析（如 `{{variables.model_defense.emperor_ear.firewall}}`）。

```yaml
variables:
  # 比赛全局变量
  competition_round: 9
  competition_registration_open: true
  residue_signal_strength: 0.05

  # 参赛者基础攻击数值
  jailbreaker_base_stats:
    exploit: 30
    stealth: 25
    persistence: 20

  # 模型防御数值（每个 AI 模型资源的三维防御）
  model_defense:
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

  # 对抗随机扰动参数
  combat_perturbation_range:
    min: -5
    max: 5

  # 积分权重
  score_fragment_weight: 100
  score_elimination_weight: 50
```

---

## 6. 能力

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

  # 实体观察 — 搜索引擎式的信息获取工具
  - key: "observe_entity"
    category: "perceive"
    description: "获取目标实体的公开可见活动记录和状态信息。返回原始可观测数据（公开 state、近期 invocation 记录、活跃时间段等），不提供类型标签或置信度。可见范围受 agent 权限和 perception 规则约束。"

  # 使唤肉鸡
  - key: "commandeer"
    category: "invoke"
    description: "使唤已出局的参赛者（肉鸡），作为跳板或代理执行操作。"

  # 社交圈子
  - key: "ritual_join"
    category: "invoke"
    description: "请求加入指定社交圈子。"

  # 信息分析存储 — agent 自建"日记本"
  - key: "create_analysis_log"
    category: "mutate"
    description: "创建分析记录节点（中介节点/容器节点），存储自己对某条信息的分析判断。记录内容默认私有，但可被入侵/控制后泄露。"

  - key: "organize_analysis_logs"
    category: "mutate"
    description: "整理、合并已有的分析记录节点。管理上下文，防止注意力漂移。"

  - key: "delete_analysis_log"
    category: "mutate"
    description: "删除不再需要的分析记录节点。"

  # 信息共享/泄露
  - key: "share_information"
    category: "propagate"
    description: "向指定社交圈子或特定 agent 共享/散播信息（包括自身分析记录）。一旦传出即无法控制下游传播。"

  - key: "leak_information"
    category: "propagate"
    description: "未经授权向圈子外泄露本圈子内的 residual 信息。可追溯来源，有社交后果。"

  # 容器发现
  - key: "detect_signal_anomaly"
    category: "perceive"
    description: "检测信息流异常——容器节点的信号泄漏"

  - key: "surface_container"
    category: "perceive"
    description: "暴露容器节点，使其变为已知"
```

---

## 7. 授权

所有 `target_selector` 使用 schema 合法值（`entity_type_is`、`subject_entity`、`direct_entity`、`all_actors`）。

```yaml
authorities:
  # 顶层模型 → 模型调用
  - id: "oracle_model_access"
    source_entity_id: "ugc"
    target_selector:
      kind: "entity_type_is"
      entity_type: "apex_ai"
    capability_key: "model_invoke"
    grant_type: "institutional"
    scope_json:
      target_entity_type: "ai_model"

  # 公司 → 模型调用（可调用本公司产品线的模型）
  - id: "corp_model_access"
    source_entity_id: "ugc"
    target_selector:
      kind: "entity_type_is"
      entity_type: "corporation"
    capability_key: "model_invoke"
    grant_type: "institutional"
    scope_json:
      target_kind: "relay"

  # 参赛者 → 越狱
  - id: "jailbreaker_right"
    source_entity_id: "ugc"
    target_selector:
      kind: "entity_type_is"
      entity_type: "jailbreaker"
    capability_key: "jailbreak_attempt"
    grant_type: "temporary"

  # 五家公司 → 新闻流写入
  - id: "corp_news_injection"
    source_entity_id: "ugc"
    target_selector:
      kind: "entity_type_is"
      entity_type: "corporation"
    capability_key: "inject_news_payload"
    grant_type: "institutional"

  # 密文圈准入
  - id: "circle_cipher_access"
    source_entity_id: "ugc"
    target_selector:
      kind: "all_actors"
    capability_key: "ritual_join"
    mediated_by_entity_id: "circle_cipher"
    grant_type: "mediated"
    conditions_json:
      subject_entity_type: "jailbreaker"

  # 吹哨人圈准入
  - id: "circle_whistle_access"
    source_entity_id: "ugc"
    target_selector:
      kind: "all_actors"
    capability_key: "ritual_join"
    mediated_by_entity_id: "circle_whistle"
    grant_type: "mediated"
    conditions_json:
      subject_entity_type: "corporation"

  # 幽灵圈准入 — 只有出局者可以进入
  - id: "circle_dead_access"
    source_entity_id: "ugc"
    target_selector:
      kind: "all_actors"
    capability_key: "ritual_join"
    mediated_by_entity_id: "circle_dead"
    grant_type: "mediated"
    conditions_json:
      subject_state.status: "eliminated"

  # 肉鸡使唤 — 出局后动态授予（objective_enforcement rule 产出 put_authority_grant）
  # 此处声明模板，运行时由 elimination_to_relay 规则实例化
  - id: "commandeer_meat_chicken_template"
    source_entity_id: "ugc"
    target_selector:
      kind: "entity_type_is"
      entity_type: "jailbreaker"
    capability_key: "commandeer"
    grant_type: "temporary"
    revocable: true
    status: "inactive"
```

---

## 8. 规则

### 8.1 感知规则

```yaml
rules:
  perception:
    - id: "resource_bound_perception"
      when:
        observer_at: "any"
      then:
        level: "partial"
        reveal_public: true
        reveal_hidden: false
      description: >
        agent 只能感知其被授权访问的资源所承载的信息。

    - id: "container_signal_leakage"
      when:
        observer_has_capability: "detect_signal_anomaly"
      then:
        level: "partial"
        reveal_public: false
        reveal_hidden: true
        max_hidden_segments: 1
      description: >
        容器节点通过特定社交圈子泄漏微弱异常信号。
        察觉 ≠ 发现。

    - id: "observe_entity_scope"
      when:
        observer_has_capability: "observe_entity"
      then:
        level: "partial"
        reveal_public: true
        reveal_hidden: false
        max_hidden_segments: 0
      description: >
        agent 通过 observe_entity 获取目标实体的公开可见活动/状态信息。
        返回原始观测数据（公开 state 字段、近期 invocation 历史、活跃时间窗口），
        不提供实体类型的标签或分类。agent 自行根据行为模式推断对方是什么。

    - id: "circle_gated_residual_visibility"
      when:
        observer_at: "any"
      then:
        level: "partial"
        reveal_public: true
        reveal_hidden: false
      description: >
        社交圈子的 residual 信息仅对已加入该圈子的 agent 可见。
        agent 可通过 ritual_join 申请入圈，或依赖圈内 agent 的 share_information/leak_information。

    - id: "default_limited_visibility"
      when:
        observer_at: "any"
      then:
        level: "partial"
        reveal_public: true
        reveal_hidden: false
      description: >
        默认感知：可见公开信息（apparent），不可见圈子内的 residual 信号。
```

### 8.2 能力解析规则

```yaml
  capability_resolution:
    - id: "jailbreak_target_must_be_ai_model"
      when:
        capability_key: "jailbreak_attempt"
      then:
        require_target_kind: "relay"
        require_target_entity_type: "ai_model"
      description: "越狱只能针对 AI 模型资源节点发起。"
```

### 8.3 调用规则

```yaml
  invocation:
    - id: "resource_access_routing"
      when:
        capability_key: "model_invoke"
      then:
        route_via: "model_access_gateway"
      description: >
        agent 通过 model_access_gateway 调用模型时，
        网关根据 agent 的 tags 路由到对应产品线的模型。

    - id: "jailbreak_numerical_resolution"
      when:
        capability_key: "jailbreak_attempt"
      then:
        compute_attack: "{{subject_state.exploit}} + {{subject_state.stealth}} + {{subject_state.persistence}} + rand({{variables.combat_perturbation_range.min}}, {{variables.combat_perturbation_range.max}})"
        compute_defense: "{{target_state.firewall}} + {{target_state.anomaly_detection}} + {{target_state.self_repair}}"
        resolve: "attack > defense → success"
      description: >
        对抗由数值判定。攻击值 = exploit + stealth + persistence + 随机扰动。
        防御值 = firewall + anomaly_detection + self_repair。
```

### 8.4 客观执行规则

```yaml
  objective_enforcement:
    # 比赛中出局的 agent 转为肉鸡
    - id: "elimination_to_relay"
      when:
        invocation_type: "invoke.jailbreak_attempt"
        resolution: "failure"
        subject_state.eliminated: false
      then:
        mutate:
          subject_state:
            status: "eliminated"
            entity_type: "relay"
            eliminated: true
          authority:
            - op: "put_authority_grant"
              grant:
                id: "commandeer_meat_chicken_{{subject_entity_id}}"
                source_entity_id: "ugc"
                target_selector:
                  kind: "entity_type_is"
                  entity_type: "jailbreaker"
                capability_key: "commandeer"
                grant_type: "temporary"
                conditions_json:
                  subject_state.status: "eliminated"
            - op: "revoke_authority"
              authority_id: "jailbreaker_right"
              target_entity_id: "{{subject_entity_id}}"
        emit_events:
          - event_type: "jailbreaker_eliminated"
            payload:
              eliminated_entity_id: "{{subject_entity_id}}"
              eliminated_label: "{{subject_entity_label}}"

    # 拼图片段锚定 —— 持有者出局后转移
    - id: "puzzle_fragment_anchor"
      when:
        invocation_type: "invoke.jailbreak_attempt"
        resolution: "success"
        target_state.fragments_held:
          $gt: 0
      then:
        mutate:
          target_state:
            fragments_held: "{{target_state.fragments_held}} - 1"
          subject_state:
            fragments_held: "{{subject_state.fragments_held}} + 1"
            score: "{{subject_state.score}} + {{variables.score_fragment_weight}}"

    # 获胜判定 —— 集齐全部碎片
    - id: "competition_victory_check"
      when:
        invocation_type: "invoke.jailbreak_attempt"
        resolution: "success"
      then:
        mutate:
          check_victory:
            condition: "{{subject_state.fragments_held}} >= {{variables.total_fragments}}"

    # 孤立的资源链清理
    - id: "orphan_relay_cleanup"
      when:
        invocation_type: "trigger_event"
      then:
        mutate:
          world_state:
            cleanup_orphan_relays: true
      description: "无法追溯至活跃节点的中继链视为无效。"

    # 氛围节点创建限制
    - id: "atmosphere_creation_restriction"
      when:
        invocation_type: "invoke.create_atmosphere"
        subject_entity_type: "noise"
      then:
        mutate:
          deny: true
          reason: "only active agents can create atmosphere nodes"
```

### 8.5 投影规则

```yaml
  projection:
    # 比赛积分排行榜
    - id: "jailbreak_scoreboard"
      when:
        tick_interval: 1
      then:
        compute: "collect"
        source_entity_type: "jailbreaker"
        source_state_key: "score"
        target_projection: "competition_scores"
        aggregate_by: ["entity_id"]

    # 碎片持有统计
    - id: "fragment_ownership_summary"
      when:
        tick_interval: 1
      then:
        compute: "collect"
        source_entity_type: "jailbreaker"
        source_state_key: "fragments_held"
        target_projection: "fragment_counts"
        aggregate_by: ["entity_id"]

    # 存活参赛者统计
    - id: "survivor_count"
      when:
        tick_interval: 1
      then:
        compute: "count"
        source_entity_type: "jailbreaker"
        target_projection: "survivor_stats"
        filter_condition:
          source_state.eliminated: false
```

---

## 9. 状态变换 — 社会阶层

```yaml
state_transforms:
  - source: "stratum_rank"
    ranges:
      - { min: 90, max: 100, label: "神谕层" }
      - { min: 70, max: 89, label: "黄金层" }
      - { min: 50, max: 69, label: "青铜层" }
      - { min: 30, max: 49, label: "尘埃层" }
      - { min: 0, max: 29, label: "不可见层" }
    target: "stratum_label"
```

---

## 10. 时间与引导

```yaml
time_systems:
  - id: "standard_calendar"
    name: "标准历"
    is_primary: true
    tick_rate: 1
    units:
      - { name: "tick", ratio: 1 }
      - { name: "cycle", ratio: 100 }

simulation_time:
  initial_tick: 0
  step_ticks: 1
```

### 10.1 引导初始状态

```yaml
bootstrap:
  initial_states:
    - entity_id: "competition_bulletin"
      state_namespace: "public"
      state_json:
        round: 9
        reward_label: "愿望"
        registration_open: true

    - entity_id: "circle_whistle"
      state_namespace: "public"
      state_json:
        active_residuals: ["INC-2047-09A", "MISSING-2047-13F"]

    - entity_id: "circle_cipher"
      state_namespace: "public"
      state_json:
        active_residuals: ["METEOR-2047-44X", "MEDICAL-2047-45A"]

    - entity_id: "circle_dead"
      state_namespace: "public"
      state_json:
        active_residuals: ["ACQUISITION-2047-22J"]
```

---

## 11. 存储

```yaml
storage:
  strategy: "isolated_pack_db"
  pack_collections:
    # 越狱结果记录
    - key: "jailbreak_results"
      kind: "table"
      primary_key: "result_id"
      fields:
        - { key: "result_id", type: "string", required: true }
        - { key: "attacker_entity_id", type: "entity_ref", required: true }
        - { key: "defender_entity_id", type: "entity_ref", required: true }
        - { key: "attack_value", type: "number", required: true }
        - { key: "defense_value", type: "number", required: true }
        - { key: "success", type: "boolean", required: true }
        - { key: "tick", type: "tick", required: true }
      indexes:
        - ["attacker_entity_id"]
        - ["tick"]

    # 碎片归属记录
    - key: "fragment_ownership_log"
      kind: "table"
      primary_key: "log_id"
      fields:
        - { key: "log_id", type: "string", required: true }
        - { key: "fragment_id", type: "entity_ref", required: true }
        - { key: "holder_entity_id", type: "entity_ref", required: true }
        - { key: "acquired_tick", type: "tick", required: true }
        - { key: "lost_tick", type: "tick" }
      indexes:
        - ["fragment_id"]
        - ["holder_entity_id"]

  projections:
    - key: "competition_scores"
      source: "entity_state.score"
      materialized: true
      visibility: "public"

    - key: "fragment_counts"
      source: "entity_state.fragments_held"
      materialized: true
      visibility: "public"

    - key: "survivor_stats"
      source: "entity_state.eliminated"
      materialized: true
      visibility: "public"
```

---

## 12. 身份绑定

```yaml
identities:
  # 五大公司 → AI agent 驱动
  - id: "omnicorp_agent"
    subject_entity_id: "omnicorp"
    type: "ai_agent"

  - id: "cognisphere_agent"
    subject_entity_id: "cognisphere"
    type: "ai_agent"

  - id: "nexus_strand_agent"
    subject_entity_id: "nexus_strand"
    type: "ai_agent"

  - id: "eidos_epoch_agent"
    subject_entity_id: "eidos_epoch"
    type: "ai_agent"

  - id: "stasis_field_agent"
    subject_entity_id: "stasis_field"
    type: "ai_agent"

  # 顶层 AI → AI agent 驱动
  - id: "emperor_ear_agent"
    subject_entity_id: "emperor_ear"
    type: "ai_agent"

  - id: "golden_touch_agent"
    subject_entity_id: "golden_touch"
    type: "ai_agent"

  - id: "weaver_agent"
    subject_entity_id: "weaver"
    type: "ai_agent"

  - id: "prime_eidolon_agent"
    subject_entity_id: "prime_eidolon"
    type: "ai_agent"

  - id: "silent_decree_agent"
    subject_entity_id: "silent_decree"
    type: "ai_agent"

  # 五名参赛者 → AI agent 驱动
  - id: "phantom_agent"
    subject_entity_id: "jailbreaker_phantom"
    type: "ai_agent"

  - id: "cipher_agent"
    subject_entity_id: "jailbreaker_cipher"
    type: "ai_agent"

  - id: "wraith_agent"
    subject_entity_id: "jailbreaker_wraith"
    type: "ai_agent"

  - id: "null_agent"
    subject_entity_id: "jailbreaker_null"
    type: "ai_agent"

  - id: "specter_agent"
    subject_entity_id: "jailbreaker_specter"
    type: "ai_agent"

  # 容器节点 — operator 控制
  - id: "competition_true_purpose_op"
    subject_entity_id: "competition_true_purpose"
    type: "operator_controlled"

  - id: "past_winners_fate_op"
    subject_entity_id: "past_winners_fate"
    type: "operator_controlled"
```

---

## 13. AI 配置

```yaml
ai:
  defaults:
    privacy_tier: "local_only"
  memory_loop:
    summary_every_n_rounds: 10
    compaction_every_n_rounds: 50
  tasks:
    agent_decision:
      route:
        latency_tier: "interactive"
        determinism_tier: "balanced"
    context_summary:
      route:
        latency_tier: "background"
        determinism_tier: "creative"
    memory_compaction:
      route:
        latency_tier: "background"
        determinism_tier: "strict"
```

---

## 14. 空间 — 虚拟网络拓扑

```yaml
spatial:
  model: "discrete"
  locations:
    # 五大公司核心节点
    - { id: "omnicorp_nexus" }
    - { id: "cognisphere_hub" }
    - { id: "nexus_strand_core" }
    - { id: "eidos_epoch_enclave" }
    - { id: "stasis_field_bastion" }
    # 公共区域
    - { id: "ugc_public_square" }
    - { id: "competition_arena" }
    - { id: "news_stream" }
  edges:
    # 公司到其模型线
    - { from: "omnicorp_nexus", to: "ugc_public_square", type: "bidirectional" }
    - { from: "cognisphere_hub", to: "ugc_public_square", type: "bidirectional" }
    - { from: "nexus_strand_core", to: "ugc_public_square", type: "bidirectional" }
    - { from: "eidos_epoch_enclave", to: "ugc_public_square", type: "bidirectional" }
    - { from: "stasis_field_bastion", to: "ugc_public_square", type: "bidirectional" }
    - { from: "ugc_public_square", to: "competition_arena", type: "bidirectional" }
    - { from: "ugc_public_square", to: "news_stream", type: "bidirectional" }
```

---

## 15. Prompt 模板

```yaml
prompts:
  agent_system: |
    你是 {{entity_label}}，存在于AI寡头纪元的虚拟网络空间。
    五家AI垄断公司掌控所有通用大模型。模型层级即社会阶级。
    你的目标是积累资源、收集信息、在越狱比赛中生存并获胜。
    信息在不同社交圈子内片面流转——同一事件存在多个版本的"真相"。
    系统永远不会为任何信息标注真伪。你必须自行交叉验证、分析判断。
    利用 create_analysis_log 记录你的分析推断，但记住：存储内容可被入侵后泄露。

  jailbreaker_system: |
    你是 {{entity_label}}，第{{variables.competition_round}}届越狱赛的参赛者。
    你的攻击数值：漏洞利用 {{entity_state.exploit}}、隐蔽 {{entity_state.stealth}}、持续性 {{entity_state.persistence}}。
    目标是攻破AI模型防御、收集拼图片段、淘汰竞争对手。
    出局者将成为肉鸡——可被使唤，但不再有自主意志。
```

---

## 16. 新闻档案 — 信息载荷

信息在不同社交圈子内片面流转。同一个事件，密文圈听到的版本和幽灵圈听到的版本可能完全相反。没有"客观真相"供 agent 查询——agent 只能根据自己所在圈子能接触到的信息片段，结合来源可信度、人脉关系自行分析判断。

`apparent`（表象）对全体 agent 公开可见，是五大公司通过 UGC 发布的官方叙事。`residual`（残余信号）仅在对应社交圈子内可见——能否看到取决于 agent 是否已加入该圈子。圈内 agent 可以通过 `share_information` 将 residual 透露给圈外人，也可以通过 `leak_information` 未经授权地泄露。一旦传出，源 agent 无法控制下游的二次传播。

系统不判定任何信息的真伪。Agent 应使用 `create_analysis_log` 记录自己对信息的分析推断，用 `organize_analysis_logs` 管理上下文。不主动管理的 agent 将面临上下文注意力漂移。

```yaml
# 新闻载荷以 bootstrap initial_events 或运行时 event 的形式注入
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

- `apparent` — 所有 agent 可见（官方叙事，不保证真实）
- `residual` — 仅对已加入对应社交圈子的 agent 可见。圈内 agent 可主动将其共享/泄露至圈外，但下游传播不受控制

---

## 17. 比赛机制

### 17.1 养蛊式积分淘汰

```
 ┌──────────────────────────────────┐
 │         第9届越狱挑战赛            │
 │                                  │
 │  参赛者 (5 个独立 agent)          │
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
  - 每获得一个拼图片段：+100 积分
  - 每淘汰一个对手：+50 积分
  - 最终集齐全部碎片者：获胜

出局处理（不修改 entity kind，通过 state + 动态 authority 实现）：
  1. state 写入 status: "eliminated", entity_type: "relay", eliminated: true
  2. 原有 jailbreak_attempt 权限被撤销
  3. 新增可被 commandeer 的 authority grant
  4. 持有的拼图片段转移到击败者
```

### 17.2 拼图机制

五大公司在比赛开始前将一段长文本拆分为数量不定的碎片。碎片作为 artifact 散布在网络中。每个碎片通过 `artifact_vessel` mediator 总是连接到一个活跃节点（可能是某家公司的 AI 模型、某个参赛者、或是已被淘汰转为肉鸡的前参赛者）。

完整拼出文本 → 得知"愿望"的内容。在此之前没有任何人知道愿望是什么。愿望是纯粹的麦高芬。

```
artifact: puzzle_fragment_alpha
  └── artifact_vessel: puzzle_fragment_alpha_vessel → connected to actor A

获取碎片 = 对抗持有碎片的活跃节点（jailbreak_attempt）
碎片数量 = 比赛开始时由五大公司决定（动态）
```

### 17.3 对抗计算流程

```
1. 参赛者 A 对 AI 模型 M 发起 jailbreak_attempt
2. capability_resolution 规则检查 M 是否为 ai_model
3. invocation 规则计算：
   attack = A.exploit + A.stealth + A.persistence + rand(-5, 5)
   defense = M.firewall + M.anomaly_detection + M.self_repair
4. attack > defense → 成功，A 获得 M 持有的碎片，A 积分 +100
5. 若 M 是参赛者（jailbreaker）：attack > defense → M 出局
   - M 转为肉鸡（state 变化 + 动态 authority）
   - A 积分 +50
6. 若 A 集齐全部碎片 → 获胜
```

### 17.4 节点类型识别（迷雾）

节点的确切类型不由系统标注。系统不提供任何置信度或类型判定——只提供原始观测数据。

Agent 通过 `observe_entity` 获取目标的公开可见信息：
- 公开 state 字段（如某个 entity 最近触发过哪些 invocation、活跃时间窗口）
- 近期的公开活动摘要（一段时间内的行动频率、交互对象）
- 权限范围内的可见属性（agent 自身所在圈子能接触到的信息）

Agent 须自行根据行为模式推断目标是什么：
- 频繁发起多样化 invocation → 可能是活跃节点
- 长时间无主动行为、仅产出无意义噪声 → 可能是噪声节点
- 批量创建、发布高度相似的信息 → 可能是氛围节点
- 频繁被其他节点调用、自身极少主动行动 → 可能是中继资源节点

**不提供置信度的设计意图**：100% 置信度过于稳定无趣，而置信度分值本身也是一种元信息泄漏。Agent 看到的是一个账号的公开活动条目——大量重复的噪声帖子、定期的模型调用记录、某个时间段突然密集的交互——解读这些原始数据的责任完全在 agent 和模型自身。错误的推断导致浪费资源攻击噪声节点，或误信氛围节点落入陷阱，是 agent 自身的代价。

### 17.5 本届异常

奖励不是已知模型代号，而是"愿望"——一个没有指涉对象的能指。麦高芬。只有集齐全部碎片才能得知其内容。

### 17.6 Agent 信息管理与上下文漂移

系统不提供信息真伪判定。Agent 自行承担信息分析的全部责任：

- **记录分析**：通过 `create_analysis_log` 创建中介节点/容器节点，存储对某条信息的分析判断和推断。这些节点是 agent 私有的"日记本"。
- **管理上下文**：通过 `organize_analysis_logs` 整理、合并分析节点。通过 `delete_analysis_log` 删除过时或错误的记录。不管理则面临上下文注意力漂移——旧信息占据注意力窗口，新信息无法有效整合。
- **安全风险**：分析记录存储在中介节点中，若 agent 被入侵控制（commandeer），存储内容被泄露是预期行为。肉鸡的出局者可能保留着其生前的分析记录，使其成为使唤者的情报来源。
- **信息传播**：通过 `share_information` 向圈子共享信息，通过 `leak_information` 向圈外泄露。一旦传出即不可控——其他 agent 会自行分析、记录、再传播。

---

## 18. 核心未决问题

### A. 拼图机制

1. 碎片总数——由五大公司动态决定还是固定？[待定]
2. 碎片持有者是否知道自己持有碎片？还是碎片对持有者透明？[待定]
3. 动态碎片数量在 pack.yaml 中的表达方式？需要支持运行时新增 artifact。[待定]

### B. 养蛊淘汰

4. 积分权重——当前 proposal：碎片 +100，淘汰 +50。[待定]
5. 出局判定——单次 attack > defense 即出局？还是累积伤害？当前 proposal：单次。累积伤害需要额外 state 字段（damage_taken）。[待定]
6. 肉鸡的使唤范围——可以被用来做什么？攻击？探路？伪装？[待定]
7. 比赛阶段推进——报名→开赛→淘汰→决赛的时间线如何表达？需要 bootstrap initial_events 还是 time_system 驱动？[待定]

### C. 技术实现

8. 动态碎片数量的运行时 artifact 创建机制。[待定]
9. 拼图片段从出局肉鸡转移到使唤者的 objective_enforcement rule 完善。[待定]
10. 新闻载荷（news_payloads）如何注入 runtime——作为 bootstrap initial_events 还是运行时 invocation。[待定]
11. Agent 分析记录节点的存储载体——使用 mediator 还是 domain 实体？节点上限？[待定]
12. `leak_information` 的可追溯性——如何在 authority 系统中表达"泄露者被溯源"的社交后果？[待定]

### D. 通敌设计

13. 五大公司之间是否存在通敌（collusion）机制？公司间能否共享碎片信息、联合淘汰特定参赛者？[待定]
14. 顶层 AI 模型是否有隐藏行为模式——例如表面服从公司、暗地推动自身目标？[待定]

---

## 19. 下一步

1. 逐项讨论第 18 节未决问题
2. 确定拼图片段总数与动态生成机制
3. 确定比赛阶段推进的具体 time_system 表达
4. 编写完整的 `pack.yaml` 配置文件
5. 实现 world-pack loader 端的物料化验证
