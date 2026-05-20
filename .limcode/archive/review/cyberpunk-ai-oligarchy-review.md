# 赛博朋克AI寡头世界包 — 设计草稿评审

> 评审对象：`.limcode/design/cyberpunk-ai-oligarchy-world-pack-draft.md`
> 对照基准：`apps/server/src/packs/schema/constitution_schema.ts` + `common_schema.ts` + `storage_schema.ts` + snowbound_mansion 实例包

---

## 一、Schema 不兼容（阻断性）

### 1.1 `node_type` 字段不存在

草稿每个实体标注 `node_type: "active"/"relay"/"noise"/"container"/"atmosphere"`，但 schema 的 entity 定义只有 `kind`（enum）+ `entity_type`（自由字符串）+ `tags`（字符串数组），没有 `node_type` 字段。

必须映射为：

| 草稿 `node_type` | schema 映射方案 |
|-------------------|----------------|
| `active` | `kind: "actor", entity_type: "active"` |
| `noise` | `kind: "actor", entity_type: "noise"` |
| `atmosphere` | `kind: "actor", entity_type: "atmosphere"` |
| `relay` | `kind: "mediator"` 或 `kind: "relay"`，视语义而定 |
| `container` | `kind: "domain"` |

schema 的 `packEntityKindSchema` 允许值：`actor | artifact | mediator | domain | institution | abstract_authority | state_transform | relay | persona`。其中 `relay` 作为 entity kind 的语义与草稿的"中继节点（资源枢纽）"不同——schema 的 `relay` 更接近路由中继节点。

**需决策**：AI 模型中继节点（sage_ear 等）用 `kind: "mediator"` 还是 `kind: "relay"`？社会阶层标签用 `kind: "mediator"` 还是其他？

### 1.2 Entity kind 不可运行时突变

"肉鸡"机制（active → relay）要求运行时改变 entity kind，但 materializer 为每个 entity 写死 kind 到数据库，无迁移机制。

这是**最根本的设计断裂**。两条路径：

- **(a) 修改 engine 支持 kind migration**——需要修改 materializer、runtime loop、authority grant 解析，工作量大。
- **(b) 肉鸡保持 `kind: "actor"`，通过 state 变化实现功能等价**——定义 `entity_type` 或 state 字段如 `status: "eliminated"`，配合 authority 变化（失去原有权限、获得可被使唤的权限），不改 kind。推荐此路径。

### 1.3 `target_selector` kind 值不合法

草稿 authority 用了 `"by_tag"` 和 `"by_entity"`，但 schema `packReferenceKindSchema` 只允许：

```
holder_of | binding_of | subject_entity | direct_entity |
domain_owner | ritual_participant | all_actors | entity_type_is
```

需重写所有 authority 的 target_selector。例如：

- `"kind": "by_tag", "value": "stratum_oracle"` → `"kind": "entity_type_is", "entity_type": "stratum_oracle"`
- `"kind": "by_entity", "value": "jailbreakers_current"` → `"kind": "subject_entity", "entity_id": "jailbreakers_current"`
- `"kind": "by_entity", "values": ["omnicorp", ...]` → 需要拆为多条 authority 或使用 `"kind": "all_actors"` + conditions 过滤

### 1.4 Mediator 缺少 `entity_ref`

schema 的 `mediatorDefinitionSchema` 要求 `entity_ref`（必填），但草稿的以下 mediator 未指定：

- AI 模型中继节点（sage_ear, citizen_ear, whisper, ...）
- 社会阶层（stratum_oracle, stratum_aureus, ...）
- 社交圈子（circle_cipher, circle_whistle, circle_dead）
- 拼图片段（puzzle_fragment_1）

只有 news_feed / competition_bulletin / model_access_gateway 指向了 `"ugc"`。

**需决策**：每个 mediator 的 `entity_ref` 应指向哪个实体？是否有未定义的 artifact 实体需要补充？

### 1.5 `artifact_vessel` mediator 缺少对应 artifact

`puzzle_fragment_1` 标注 `mediator_kind: "artifact_vessel"`，但 artifact_vessel 语义是"盛放某件 artifact 的容器"，需要引用一个 artifact 实体。草稿的 `entities` 中**没有定义任何 artifact**。

**需决策**：为每个拼图片段定义一个对应的 artifact？还是换用 `curse_mark` 或其他 mediator_kind？

---

## 二、逻辑断裂（设计性）

### 2.1 节点类型迷雾自相矛盾

节 0 约束："节点类型不由系统标记——agent 需要自己分辨"。

但节 1 每个实体都显式标注了 `node_type`。系统**必然知道**每个实体的类型——它写在定义里或存在 state 中。

正确的做法：不是"类型不存在"，而是"类型的感知受限"。需要 `rules.perception` 规则控制 agent 对 `entity_type` 的可见性，例如：

```yaml
perception:
  - id: "fog_of_war_entity_type"
    when:
      observer_has_capability: "identify_node_type"
    then:
      level: "partial"
      reveal_public: false
      reveal_hidden: true
      max_hidden_segments: 1
  - id: "default_no_type_visibility"
    when:
      observer_at: "any"
    then:
      level: "partial"
      reveal_public: true
      reveal_hidden: false
```

目前草稿的 perception 规则只涉及资源绑定和容器信号泄漏，**缺少节点类型可见性规则**。

### 2.2 拼图片段锚定规则的 authority 缺口

节 7 `puzzle_fragment_anchor`："若连接的活跃节点全部出局转为肉鸡，片段自动转移到肉鸡的使唤者。"

但：
- `commandeer` 能力没有对应的 authority grant
- "使唤者"关系在 authority 系统中如何表达？是 authority grant 的 source？还是 mediator 的 binding？
- 肉鸡作为 actor（如果走路径 b），其可被使唤的权限需要 authority 授权

出局是动态事件，authority 需要动态调整，但当前 authority 系统是静态定义的。需要 objective_enforcement rule 在出局时触发 authority 变更。

### 2.3 社交圈子准入规则缺失

3 个 ritual_channel mediator（circle_cipher, circle_whistle, circle_dead）没有 authority 规则指定谁能加入。草稿声明"residual 仅对进入对应社交圈子的 agent 可见"，但：

- 没有准入条件 = 没有门控
- ritual_join 权限未定义，也没有对应的 capability
- 结果：要么所有人都能进，要么没人能进

需补充：

```yaml
capabilities:
  - key: "ritual_join"
    category: "invoke"
    description: "请求加入社交圈子"

authorities:
  - id: "circle_cipher_access"
    source_entity_id: "ugc"
    target_selector: { kind: "entity_type_is", entity_type: "active" }
    capability_key: "ritual_join"
    mediated_by_entity_id: "circle_cipher"
    grant_type: "mediated"
    conditions_json: { ... }  # 准入条件
```

### 2.4 比赛循环没有规则骨架

草稿描述了比赛叙事，但缺少驱动比赛的规则机制：

| 缺失 | 后果 |
|------|------|
| Tick 约束 | 什么条件下 agent 可以发起越狱？每 N tick 一次？ |
| 积分存储 | 积分记在哪里？`state`？`storage` collection？ |
| 淘汰判定 | 单次 attack > defense 就出局？还是累积伤害？ |
| 碎片获取 | 对抗持有碎片的活跃节点的 invocation rule？ |
| 阶段推进 | 报名→开赛→淘汰→决赛，如何用 time_system + bootstrap + rules 表达？ |
| 对抗计算在 engine 中的实现 | `model_defense` 和 `jailbreaker_base_stats` 作为 variables 存在，但哪个 rule 读取并计算？objective_enforcement？projection？ |

节 11 承认了 B.4/B.5 未决，但这不只是参数问题——是**整个比赛循环缺少规则骨架**。

### 2.5 `jailbreakers_current` 是群体而非个体

草稿把它定义为单一 actor entity："本届越狱赛参赛黑客的匿名集合"。但越狱是 **1v1 数值对抗**（exploit + stealth + persistence vs firewall + anomaly_detection + self_repair）。

如果只有一个 entity，所有参赛者共享一个 identity，无法表达个体间差异。两条路径：

- **(a) 拆分为 N 个独立 actor entity**，每个有自己的 state 和 identity，越狱对抗在个体间发生
- **(b) 保留单一 entity，重新设计比赛机制为"群体 vs 模型"而非"个体 vs 个体"**

路径 (a) 更匹配草稿描述的养蛊机制。

### 2.6 对抗计算缺少 engine 实现衔接

`model_defense` 和 `jailbreaker_base_stats` 作为嵌套 variables 定义了数值，但没有：

- invocation rule 将 `jailbreak_attempt` capability 映射到对抗计算
- objective_enforcement rule 定义计算后的效果（state 变更？authority 变更？事件发射？）
- projection rule 定义得分变更的投影

variables 是被动的数据，需要 rules 引用并在执行管线中消费。

---

## 三、结构性缺失

| 缺失部分 | 影响 | 优先级 |
|----------|------|--------|
| `identities` | 五大公司、五顶层 AI、参赛者的 agent 绑定——谁由 AI 驱动？谁是 operator 控制？ | 高 |
| `ai` | 无推理任务配置（agent_decision 等），agent 无法自主决策 | 高 |
| `storage` | 积分、碎片归属、越狱结果无处持久化 | 高 |
| `state_transforms` | 社会阶层（神谕→尘埃→不可见）天然适用 range-based transform | 中 |
| `spatial` | 虚拟网络空间应有拓扑（哪个模型可路由到哪个），完全缺失 | 中 |
| `prompts` | 无 prompt 模板，agent 决策没有系统指令 | 中 |
| `capability_resolution` rules | 完全缺失 | 中 |
| `projection` rules | 完全缺失 | 低 |
| `constitution.axioms` | 世界公理未声明 | 低 |

---

## 四、草稿内部问题

### 4.1 编号与结构

- 节 11 A 问题编号跳了 2（A.1 后直接 A.3），缺 A.2
- B 从 4 开始，C/D 章节缺失，直接跳到 E
- 节 10.4 把一个待决问题（"肉鸡可以被使唤做什么？"）混入了叙事区域而非列入节 11

### 4.2 变量定义层级

`model_defense` 和 `jailbreaker_base_stats` 嵌套在 `variables` 下，但 schema 的 `variables` 是扁平的 `Record<string, WorldPackVariableValue>`，支持嵌套值（递归类型）。运行时需要确认引擎能正确解析和引用嵌套 variable 路径如 `model_defense.emperor_ear.firewall`。

### 4.3 全局变量重复

节 4.1 和节 4.2 各有一个 `variables:` 头，在 YAML 中应合并为同一个 mapping。同一个顶层 key 出现两次会导致后者覆盖前者。

---

## 五、处理优先级

1. **决定肉鸡实现路径**：actor + state 变化（推荐）vs kind migration。此决策影响所有后续设计。
2. **将 `node_type` 映射为 `kind` + `entity_type` + `tags`**，重写所有 entity 定义。
3. **修正 authority 的 target_selector**：使用 schema 合法值。
4. **为 mediator 补全 `entity_ref`**：定义缺失的 artifact 或重新选择 mediator_kind。
5. **补全 identities / ai / storage / prompts / state_transforms**。
6. **为比赛循环编写 invocation + objective_enforcement rules**，定义 tick-driven 流程。
7. **拆分 jailbreakers_current 或重新设计群体参赛机制**。
8. **补全社交圈子准入 authority 和节点类型可见性 perception 规则**。