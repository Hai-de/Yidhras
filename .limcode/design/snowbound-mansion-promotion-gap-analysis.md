# snowbound_mansion 世界包升级差距分析

> 从世界包开发者视角审视 snowbound_mansion 从原型包升级为正式包所需补齐的内容。
>
> 参照系：`docs/specs/WORLD_PACK.md` 发布规范、`worldPackConstitutionSchema` 完整合约、scaffold 模板默认结构、`world-death-note` 参考实现。

---

## 0. 现状摘要

snowbound_mansion 当前文件清单：

```
snowbound_mansion/
├─ config.yaml                              ← 唯一运行时配置（~560 行）
├─ runtime.sqlite                           ← 运行时产物
├─ runtime.sqlite.storage-plan.json         ← 运行时产物
└─ plugins/
   ├─ snowbound-game-loop/
   │  ├─ plugin.manifest.yaml
   │  └─ server.ts
   └─ snowbound-mastermind/
      ├─ plugin.manifest.yaml
      └─ server.ts
```

无 README.md、无 CHANGELOG.md、无 LICENSE、无 docs/、无 assets/、无 examples/。metadata.status = "prototype"。

---

## 1. 项目化资产缺失

| 缺失项 | 规范要求 | 优先级 | 说明 |
|---------|----------|--------|------|
| `README.md` | 校验器 WARN；WORLD_PACK.md §4 强推 | **P0** | 人类可读的包入口文档。需覆盖世界前提、核心机制、实体/能力/规则概览、已知限制等 10 个章节 |
| `CHANGELOG.md` | WORLD_PACK.md §6.1 推荐 | P1 | 版本变更记录。从 0.1.0 → 1.0.0 需要一份清晰的 changelog |
| `LICENSE` | WORLD_PACK.md §6.2 推荐 | P2 | 若计划开放分发 |
| `docs/setting.md` | scaffold 默认生成 | P1 | 详细世界设定文档：暴风雪山庄的背景故事、建筑历史、NPC 角色设定来源 |
| `docs/rules.md` | WORLD_PACK.md §6.3 推荐 | P1 | 游戏规则详解：阶段流程、胜负条件、能力使用规则 |
| `assets/` | scaffold 默认生成 | P2 | 封面图、图标、地图示意图等展示素材 |
| `examples/overrides.example.yaml` | scaffold 默认生成 | P2 | 覆盖配置示例（如调整角色数量、修改场景类型） |
| `metadata.status` | 需更新 | P0 | 从 `"prototype"` 改为 `"beta"` 或 `"stable"` |
| `metadata.presentation` | schema 支持 | P2 | `cover_image`、`icon`、`theme` 展示元数据 |

---

## 2. config.yaml 结构缺陷

### 2.1 实体层缺失

#### 2.1.1 无 entities.artifacts（物品实体）

当前 0 个 artifact。暴风雪山庄作为封闭悬疑场景，物品是核心叙事驱动力。

**需要补充的物品实体（建议）：**

| artifact_id | 说明 | 状态字段 |
|-------------|------|----------|
| `weapon_knife` | 厨房剁骨刀 | holder_id, location, blood_stained, discovered |
| `weapon_poker` | 壁炉拨火棍 | holder_id, location |
| `key_master` | 主人房钥匙 | holder_id, used |
| `key_storage` | 储藏室暗门钥匙 | holder_id, discovered |
| `flashlight` | 手电筒 | holder_id, battery_level |
| `radio_broken` | 损坏的收音机 | location, repair_progress |
| `anonymous_letter` | 匿名信 | holder_id, read_by[] |
| `medicine_box` | 急救箱 | location, remaining_uses |
| `diary_old` | 泛黄日记本 | location, pages_read |
| `rope` | 绳索 | holder_id, location |

这些物品在现有 domain hidden_details 中已有暗示（厨房刀架、图书室报纸、储藏室暗门、阁楼箱子），但未作为一等实体存在，无法被持有、传递、用于能力触发。

#### 2.1.2 无 entities.mediators（调解器）

当前 0 个 mediator。在 death-note 中，调解器用于建立「持有物品 → 获得能力」的权限溯源链。

snowbound_mansion 中至少需要：
- 武器类调解器：持有凶器 → 获得 `invoke.kill` 能力
- 钥匙类调解器：持有钥匙 → 获得 `invoke.unlock` 能力（进入特定房间）
- 证据类调解器：持有证据 → 获得 `invoke.present_evidence` 能力（公审时出示）

若不引入调解器，所有能力只能通过 `intrinsic` + `all_actors` 授予，无法实现基于物品持有的动态权限。

#### 2.1.3 无 entities.institutions（机构实体）

对于封闭山庄场景，institutions 是可选的。但可以考虑：
- 「自治委员会」：玩家自发组织的投票/公审机构
- 「生存小组」：负责物资管理的组织

优先级 P2，可在后续版本引入。

---

### 2.2 规则层缺陷

#### 2.2.1 rules.invocation 完全缺失

**这是最严重的结构性缺陷。**

当前状态：声明了 5 个 capabilities + 5 个 authorities，但 **没有任何 invocation 规则** 定义自由文本意图如何映射到这些能力。

death-note 有 18 条 invocation 规则，覆盖三种分辨率模式（精确、翻译、叙述化）。snowbound_mansion 需要为每个 capability 至少定义一条精确落地规则，并为常见的非结构化意图定义翻译规则。

**需要的 invocation 规则（按能力分组）：**

```
move:
  - 精确：move_to_location → move
  - 翻译：go_upstairs / 去二楼 → move (target: corridor_2f)

invoke.investigate:
  - 精确：investigate_location → invoke.investigate
  - 翻译：search_room / 搜查房间 → invoke.investigate
  - 叙述化：look_around / 四处看看 → 生成叙事描述，不改变世界状态

invoke.accuse:
  - 精确：accuse_person → invoke.accuse
  - 翻译：point_finger / 指认凶手 → invoke.accuse

invoke.reveal_secret:
  - 精确：reveal_secret_to → invoke.reveal_secret
  - 翻译：confide_in / 向某人坦白 → invoke.reveal_secret

（新增能力对应的规则见 §2.3）
```

#### 2.2.2 rules.objective_enforcement 几乎为空

当前仅 1 条规则 `rule-investigate`，且 **没有 mutate 块**，不改变任何世界状态，只发射一个无实际影响的交互事件。

对比：death-note 有 12 条 objective_enforcement 规则，每条都包含完整的 mutate 块（改变主体/目标/世界状态）+ 结构化事件发射。

**需要为以下核心场景定义客观执行规则：**

| 规则 | 触发能力 | mutate 效果 | 发射事件 |
|------|----------|-------------|----------|
| `objective-investigate` | invoke.investigate | investigation_count += 1；若满足条件，reveal hidden_details | investigation_conducted |
| `objective-kill` | invoke.kill（新增） | target.alive = false; world.alive_count -= 1 | death_occurred |
| `objective-accuse` | invoke.accuse | 记录指控；若多数同意，进入公审 | accusation_made |
| `objective-vote` | invoke.vote（新增） | 统计投票；达到阈值则处决/释放 | vote_cast / trial_verdict |
| `objective-lock-door` | invoke.lock（新增） | door.locked = true | door_locked |
| `objective-search-person` | invoke.search_person（新增） | 暴露目标持有物品 | person_searched |
| `objective-sabotage` | invoke.sabotage（新增） | 破坏设施状态 | facility_sabotaged |

#### 2.2.3 rules.capability_resolution 缺失

没有动态能力解析规则。所有权限都是静态的 intrinsic 授予。

需要考虑的动态规则：
- 死亡角色失去所有 invoke 能力
- 夜间时段限制移动（如宵禁规则）
- 某些房间需要钥匙才能进入（条件化 move 权限）

#### 2.2.4 rules.projection 缺失

没有投影规则。投影用于将内部世界状态转换为外部可查询的视图。

至少需要：
- 存活角色列表投影
- 各地点当前人员投影
- 调查进度投影

---

### 2.3 能力声明不足

当前 5 个 capabilities 远不够覆盖悬疑推理场景的核心交互。

**需要新增的能力声明：**

| capability_key | category | 说明 | 授权模式 |
|----------------|----------|------|----------|
| `invoke.kill` | invoke | 暗杀目标角色 | 仅黑幕 + 条件（夜间 / 无人目击） |
| `invoke.search_person` | invoke | 搜查目标角色身上的物品 | 需同地点 + 目标不反抗或多数决 |
| `invoke.vote` | invoke | 在公审中投票 | 存活角色 |
| `invoke.lock` | invoke | 锁定/解锁门 | 持有钥匙或在门旁 |
| `invoke.sabotage` | invoke | 破坏设施（电源、通讯、门锁） | 仅黑幕 |
| `invoke.form_alliance` | invoke | 与他人结盟，建立信任 | 同地点 |
| `invoke.private_meeting` | invoke | 发起私密对话 | 同地点，限 2-3 人 |
| `invoke.use_item` | invoke | 使用持有的物品 | 持有对应物品 |
| `invoke.pick_up` | invoke | 拾取当前地点的物品 | 物品在同地点 |
| `invoke.give_item` | invoke | 将物品交给同地点的角色 | 持有物品 + 同地点 |
| `perceive.adjacent_sound` | perceive | 感知相邻房间的声音（尖叫、打斗） | 全体 |
| `perceive.item_presence` | perceive | 感知当前地点是否有可拾取物品 | 全体 |

---

### 2.4 AI 配置极简

#### 2.4.1 无 ai.tasks

当前只有 `ai.defaults` 的 3 个字段。death-note 定义了 5 个 AI 任务，各自带有独立的提示预设、解码器、路由和元数据。

**需要定义的 AI 任务：**

| 任务类型 | 用途 | 说明 |
|----------|------|------|
| `agent_decision` | 角色行动决策 | 核心任务。需要专用提示词，指导 AI 在悬疑推理情境中做出符合角色性格的决策 |
| `intent_grounding_assist` | 意图落地辅助 | 将自由文本意图解析为结构化能力调用 |
| `context_summary` | 上下文总结 | 压缩历史对话和事件，保留关键线索信息 |
| `memory_compaction` | 记忆压缩 | 长期记忆的压缩策略，确保推理线索不被丢失 |
| `classification` | 事件分类 | 将模拟中的事件分类为：线索发现、社交互动、暴力事件、调查行为等 |

#### 2.4.2 无 ai.slots

scaffold 模板默认生成 `custom_safety_layer` 插槽。snowbound_mansion 应声明包专属插槽：

| 插槽 | 用途 |
|------|------|
| `world_situation` | 当前世界态势注入（第几天、存活人数、最近事件） |
| `spatial_awareness` | 当前地点描述、周围环境、同地点角色列表 |
| `investigation_progress` | 已知线索汇总、怀疑对象列表 |
| `safety_layer` | 悬疑叙事的安全约束（防止过度暴力描写等） |

#### 2.4.3 无 ai.memory_loop

没有配置 `summary_every_n_rounds` 和 `compaction_every_n_rounds`。悬疑推理高度依赖跨轮次的线索积累，记忆管理策略不可缺。

---

### 2.5 存储缺失

当前无 `storage` 节。运行时虽会自动创建 `runtime.sqlite`，但没有 pack-local 结构化集合。

**需要定义的 pack_collections：**

| collection_key | 用途 | 字段 |
|----------------|------|------|
| `investigation_logs` | 调查记录 | entity_id, location_id, tick, findings, hidden_revealed |
| `accusation_records` | 指控记录 | accuser_id, target_id, tick, evidence_refs, outcome |
| `death_records` | 死亡记录 | victim_id, location_id, tick, cause, discovered_by, discovered_at_tick |
| `item_transfers` | 物品流转 | item_id, from_entity_id, to_entity_id, tick, transfer_type |
| `alliance_bonds` | 联盟关系 | entity_a_id, entity_b_id, formed_at_tick, dissolved_at_tick, trust_level |

---

### 2.6 提示词系统问题

#### 2.6.1 模板变量未正确使用

`prompts.global_prefix` 硬编码了 "深山中的独栋别墅" 和 "暴风雪"，但 `variables` 中已定义了 `location_types` 和 `scenarios` 列表，`bootstrap` 中也通过 `{{pick}}` 宏随机选择了具体场景。

提示词应改为使用模板变量引用 bootstrap 后的世界状态：

```yaml
global_prefix: |
  你正在一个封闭的环境中。{{ world.scenario }}。
  你所在的地点是{{ world.location_type }}。
  ...
```

#### 2.6.2 bootstrap 引用错误

`bootstrap.initial_states[0].state_json.event_prefix` 引用了 `{{pack.variables.location_type_pool}}`，但实际变量名为 `location_types`。

#### 2.6.3 缺少决策导向提示词

当前提示词只描述了角色身份和基本规则，缺少：
- 行动选择引导（你可以做什么、不能做什么）
- 推理框架引导（如何分析线索、如何判断可疑行为）
- 社交策略引导（何时应该结盟、何时应该背叛）

---

## 3. 角色系统设计问题

### 3.1 高度同质化

12 个角色使用完全相同的 `{{pick}}` 模板，从相同的池中随机选取 name/personality/profession/secret/is_mastermind/initial_location。

**问题：**
1. **重复风险**：pick 宏对跨实体调用是独立的。char_01 和 char_02 可能抽到相同的名字、相同的职业、相同的秘密。
2. **缺乏叙事结构**：纯随机无法产生有意义的角色关系（仇人、亲属、旧识），而 `variables.team_dynamics` 中描述了这些关系（如 "至少三人是老相识但有旧怨未了"），但角色定义层面没有任何机制支撑。
3. **黑幕分配不可控**：每个角色独立 pick `is_mastermind`，概率约 1/11 ≈ 9%。12 人独立抽取可能产生 0 个或 4+ 个黑幕，与 `world.masterminds_alive` 的 `{{int min=1 max=3}}` 脱节。

### 3.2 建议改进方向

- **分层角色池**：将 12 个角色分为 3-4 个预设组（老相识组、陌生人组、可疑人物组），每组内用 pick 随机化细节
- **关系预置**：在 bootstrap 中定义 2-3 组预设关系（relation entries），如 `char_01 ↔ char_05: old_acquaintance`
- **黑幕数量受控**：不在每个角色上独立 pick，而是在 bootstrap 阶段使用单一 pick 从角色 ID 池中选出 1-2 个黑幕
- **角色模板分化**：至少定义 2-3 种角色模板（普通角色、可疑角色、调查型角色），差异化行为约束

---

## 4. 插件系统问题

### 4.1 导入路径脆弱

两个插件均使用 5 层相对路径引用引擎类型：

```ts
import type { ... } from '../../../../../apps/server/src/...';
```

若包目录层级变化，所有导入立即断裂。应改为引擎提供的 plugin SDK 导入路径（若已有），或使用 `tsconfig.paths` 别名。

### 4.2 plugin.manifest.yaml 中 source 字段与实际文件不匹配

两个清单均声明 `source: "server.js"`，但实际文件是 `server.ts`。加载器是否自动处理 `.ts → .js` 映射需要确认。

### 4.3 game-loop 插件功能不足

当前只实现了日期推进（day counter）。一个完整的暴风雪山庄游戏循环至少需要：

| 阶段 | 触发条件 | 行为 |
|------|----------|------|
| 日出 / 新一天 | tick 达到 day boundary | 唤醒所有角色，发射新一天事件 ← **已实现** |
| 自由活动阶段 | 日出后 | 开放所有 invoke 能力 |
| 调查阶段 | 发现尸体 / 定时触发 | 增强 investigate 能力、开放搜查 |
| 公审阶段 | 达到指控阈值 | 发起投票、限制移动 |
| 夜间阶段 | tick 达到 night boundary | 限制可见性、开放黑幕专属能力 |
| 终局判定 | 第 7 天 / 黑幕全灭 / 平民全灭 | 结算、发射结局事件 |

### 4.4 mastermind 插件功能有限

当前只注入一段静态文本上下文。没有：
- 黑幕行动窗口管理
- 暗杀执行逻辑
- 黑幕间协调机制（多黑幕场景）

---

## 5. 叙事机制缺失

### 5.1 胜负条件未定义

config.yaml 中提到 "在这里生存 7 天" 但没有任何规则定义：
- 什么算"存活"？alive = true？
- 7 天到了怎么办？自动终止？
- 黑幕全部被识别/处决 → 平民胜利？
- 平民死亡到什么程度 → 黑幕胜利？
- 平局条件？

### 5.2 环境事件系统缺失

封闭环境悬疑的核心叙事张力来自「不可控的环境事件」推动情节。当前没有任何环境事件机制。

**建议的环境事件模板：**

| 事件类型 | 触发方式 | 效果 |
|----------|----------|------|
| 停电 | 随机 / 黑幕触发 | 所有房间可见度降为 0，持手电筒者不受影响 |
| 发现尸体 | 角色进入有尸体的房间 | 自动触发调查阶段 |
| 暴风雪加剧 | 定时（第 3/5 天） | 某些区域不可进入（如阳台、阁楼） |
| 神秘声响 | 随机 | 相邻房间角色触发 perceive.adjacent_sound |
| 食物短缺 | 第 4 天起 | 增加角色焦虑状态，影响决策 |
| 密道发现 | investigate 储藏室 | 解锁新地点（地下室） |

### 5.3 社交关系机制缺失

当前没有信任/怀疑/联盟的数值化系统。角色间的关系完全依赖 AI 的自由发挥，缺乏结构化追踪。

---

## 6. 感知规则补充需求

现有 5 条感知规则覆盖了基本的同地点感知。但缺少：

| 需求 | 说明 |
|------|------|
| 相邻房间声音传播 | 尖叫、枪声、打斗声应传播到相邻房间（level: partial，只知道有声音，不知道具体内容） |
| 死亡事件全局感知 | 发现尸体后，消息通过 NPC 传播扩散到全局 |
| 黑幕间互相识别 | 黑幕应能感知其他黑幕的身份（perceive.mastermind 已有，但 perception 规则未体现） |
| 物品存在感知 | 进入房间时应感知到可拾取物品（当前只有 hidden_details 但无结构化物品感知） |

---

## 7. 优先级路线图建议

### Phase 1: 结构补全（P0）— 使包能通过完整校验
- [ ] 补充 README.md（按 WORLD_PACK.md §5 模板）
- [ ] 补充 CHANGELOG.md
- [ ] 修复 metadata.status → "beta"
- [ ] 修复 bootstrap 中 event_prefix 的变量引用错误
- [ ] 修复 prompts 中硬编码文本 → 使用模板变量
- [ ] 补充 rules.invocation（至少 5 条精确落地规则）
- [ ] 补充 rules.objective_enforcement（至少 investigate + kill + accuse）
- [ ] 补充 ai.tasks（至少 agent_decision）
- [ ] 补充 ai.memory_loop 配置

### Phase 2: 实体/能力扩充（P1）— 使包具有完整的悬疑推理玩法
- [ ] 引入 entities.artifacts（凶器、钥匙、证据等核心物品）
- [ ] 引入 entities.mediators（物品 → 能力的权限溯源）
- [ ] 扩充 capabilities（kill, search_person, vote, lock, sabotage 等）
- [ ] 扩充 authorities（条件化权限：黑幕专属、夜间限定、物品持有等）
- [ ] 补充 storage.pack_collections（调查记录、死亡记录、物品流转等）
- [ ] 补充 ai.slots（world_situation, spatial_awareness, investigation_progress）
- [ ] 补充 rules.capability_resolution（死亡失能、夜间限制等）
- [ ] 补充 perception 规则（声音传播、物品感知）

### Phase 3: 叙事机制（P1-P2）— 使包产生有意义的叙事弧线
- [ ] 定义胜负条件和终局判定规则
- [ ] 实现游戏阶段循环（自由活动 → 调查 → 公审 → 夜间）
- [ ] 引入环境事件系统（停电、暴风雪加剧、食物短缺等）
- [ ] 改进角色生成：分层角色池、预置关系、受控黑幕分配
- [ ] 补充 invocation 规则的翻译和叙述化模式

### Phase 4: 打磨与文档（P2）
- [ ] 补充 docs/setting.md（详细世界设定）
- [ ] 补充 docs/rules.md（完整游戏规则）
- [ ] 补充 examples/overrides.example.yaml
- [ ] 补充 assets/（地图示意图、封面）
- [ ] 补充 LICENSE
- [ ] 引入 entities.institutions（可选）
- [ ] 优化插件导入路径
- [ ] 确认 plugin manifest source 字段与实际文件的对齐
- [ ] rules.projection 投影规则（存活列表、地点人员等）

---

## 8. 与 world-death-note 的结构对比矩阵

| 维度 | snowbound_mansion | world-death-note | 差距 |
|------|-------------------|------------------|------|
| README.md | 无 | 有（4KB） | 需补 |
| CHANGELOG.md | 无 | 有 | 需补 |
| entities.actors | 12 个（纯随机模板） | 3 个（精心设计） | 质量差距 |
| entities.artifacts | 0 | 1（death note） | 需补 |
| entities.mediators | 0 | 1 | 需补 |
| entities.institutions | 0 | 3 | 可选 |
| entities.domains | 15 | 3 | snowbound 更丰富 |
| capabilities | 5 | 11 | 需扩充 |
| authorities | 5 | 11 | 需扩充 |
| rules.perception | 5 条 | 0 条 | snowbound 更丰富 |
| rules.invocation | 0 条 | 18 条 | **严重缺失** |
| rules.objective_enforcement | 1 条（无 mutate） | 12 条（完整 mutate） | **严重缺失** |
| rules.capability_resolution | 0 | 0 | 双方均缺 |
| rules.projection | 0 | 0 | 双方均缺 |
| ai.tasks | 0 | 5 | 需补 |
| ai.slots | 0 | 0 | 双方均缺 |
| ai.memory_loop | 无 | 有 | 需补 |
| storage.pack_collections | 0 | 3 | 需补 |
| spatial | 15 地点 + 18 条边 | 无 | snowbound 更丰富 |
| plugins | 2 个 TS 插件 | 0 | snowbound 更丰富 |
| prompts 模板化 | 部分硬编码 | 模板变量引用 | 需修复 |
| 角色关系系统 | 无 | 无 | 双方均缺 |
| 环境事件系统 | 无 | dynamics_config | 需补 |
| 胜负条件 | 无 | 无（隐含在规则中） | 需补 |

---

## 9. 总结

snowbound_mansion 作为原型包已经验证了空间语义、宏系统、信息不对称和多 agent 自主叙事的核心管线。其空间模型（15 地点 + 18 边 + 5 条感知规则）和插件体系（game-loop + mastermind）是 death-note 所不具备的能力。

但要成为正式的世界包，最大的差距集中在三个方面：

1. **意图到世界状态的完整管道**：缺少 invocation 规则 + objective_enforcement 的 mutate 块，导致角色的能力声明和权限授予形同虚设——AI 可以"说"它要做什么，但系统无法将意图转化为世界状态变更。
2. **一等实体不足**：没有 artifacts 和 mediators，导致物品交互和基于物品的动态权限无法实现，这对悬疑推理场景是致命的。
3. **AI 推理引导不足**：没有 ai.tasks、ai.slots、ai.memory_loop，导致 AI 在做角色决策时缺乏场景专用的引导和记忆管理。

建议按 §7 的四阶段路线图推进，Phase 1 目标是使包通过完整校验并具备最小可运行的规则管道，Phase 2 目标是补齐实体和能力层使悬疑推理玩法完整。
