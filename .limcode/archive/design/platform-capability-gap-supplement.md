# 平台通用能力缺口 — 补充草案

> 触发：`.limcode/review/cyberpunk-ai-oligarchy-review.md` 对赛博朋克世界包草稿的评审
> 关联：`.limcode/design/generic-capability-gap-analysis.md`（插件系统/可观测性/测试层面缺口）
> 范围：世界包宪法系统层面的 7 个新缺口，不在已有缺口分析覆盖范围内
>
> 已有缺口分析覆盖的是插件 runtime 接入、sim loop 钩子、可观测性。本补充覆盖的是 entity/rules/authority/variables 运行时能力缺口。

---

## 一、缺口总览

赛博朋克世界包的设计需求暴露了 7 个平台层缺失的通用能力，均位于世界包宪法系统的运行时层面：

| # | 缺口 | 当前状态 | 严重程度 |
|---|------|---------|---------|
| 1 | entity kind 运行时迁移 | 完全不存在 | 阻断 |
| 2 | authority 动态变更（运行时授予/撤销） | delta op 已定义但从未产出 | 阻断 |
| 3 | `capability_resolution` 规则未实现 | schema 已定义，零消费者 | 高 |
| 4 | `projection` 规则未实现 | schema 已定义，零消费者 | 高 |
| 5 | 规则 `when`/`then` 无法引用 pack variables | 模板插值仅覆盖 invocation 字段 | 高 |
| 6 | 群体/集体实体概念缺失 | 无成员关系原语 | 高 |
| 7 | state_transforms 仅支持数值→标签（仅 actor） | 功能存在但受限 | 中 |

---

## 二、逐项分析

### 2.1 entity kind 运行时迁移

**现状**：`WorldStateDeltaOperation` 枚举（`packages/contracts/src/world_engine.ts:168-181`）包含的操作：
- `upsert_world_entity`
- `upsert_entity_state`
- `put_mediator_binding`
- `put_authority_grant`
- `append_rule_execution`
- `set_clock`
- `custom`

没有任何操作可以修改 entity 的 `kind` 字段。entity kind 在物化时写入 `world_entities.entity_kind` 列，之后不可变。

**阻塞场景**：赛博朋克草稿的"肉鸡"机制——比赛中出局的 agent 从 `kind: "actor"` 变为 `kind: "relay"`（资源节点）。当前无法实现。

**两条路径**：

- **(A) 新增 delta operation `change_entity_kind`**
  - 在 `WorldStateDeltaOperation` 枚举中添加 `change_entity_kind`
  - 在 world engine 持久化层实现 kind 变更
  - 需要考虑：authority grant 的有效性（kind 变更后原有 grant 是否自动失效）、mediator binding 的级联影响
  - 工作量大，涉及 materializer、runtime loop、authority resolver 的联动修改

- **(B) 保持 kind 不变，通过 state + authority 变化模拟**
  - 出局的 agent 保持 `kind: "actor"`，但 state 写入 `status: "eliminated"`
  - 原有 authority 被撤销（依赖缺口 2.2），新增可被使唤的 authority
  - entity_type 或 tags 标记为 `relay`
  - 不修改 engine 核心，但要求缺口 2.2（动态 authority）先到位

**推荐**：先走路径 B（state + authority 变化），因为动态 authority（缺口 2.2）是多个场景的共同需求。路径 A 作为长期选项保留。

**实现要点（路径 B）**：
1. 依赖缺口 2.2（动态 authority）先到位
2. 出局的 objective_enforcement rule 产出 `upsert_entity_state`（写入 `status: "eliminated"`）+ `put_authority_grant`（撤销原有 grant，新增 commandeer 相关 grant）
3. `entity_type` 或 `tags` 用于标记节点角色变化

---

### 2.2 authority 动态变更

**现状**：`put_authority_grant` 已在 `WorldStateDeltaOperation` 中定义（`world_engine.ts:173`），但搜索整个 `apps/server/src/`，**没有任何代码产出此操作**。

当前 authority 完全是静态的——在包加载时通过 `materializePackRuntimeCoreModels()` 物化到 `authority_grants` 表，之后只能通过 `upsertPackAuthorityGrant` 做全量 upsert，没有运行时增量授予/撤销。

**阻塞场景**：
- 拼图片段转移：出局者的 authority 需撤销，使唤者需获得新 authority
- 社交圈子准入：agent 加入/退出圈子需要 authority 动态变更
- 肉鸡使唤：commandeer 权限需要在出局事件发生时动态授予
- 比赛阶段推进：报名期 vs 比赛期的 authority 不同

**实现路径**：

1. **产出侧**：在 `objective_enforcement` 规则执行管线中，支持 `then` 产出 `put_authority_grant` delta operation。`objective_rule_resolver.ts` 当前只处理 `mutate.subject_state`、`mutate.target_state`、`mutate.world_state`、`emit_events`，需要新增 `mutate.authority` 或等效指令。

2. **消费侧**：world engine 持久化层（`world_engine_persistence.ts`）需要在 `persistPreparedStep` 中处理 `put_authority_grant` 操作——写入或更新 `authority_grants` 表。

3. **撤销语义**：`put_authority_grant` 的 payload 需要支持 `status: "revoked"` 或 `active: false` 来表示撤销。当前 `authorityDefinitionSchema` 已有 `status` 和 `revocable` 字段。

4. **authority resolver 联动**：`domain/authority/resolver.ts` 需要在解析时过滤掉已撤销的 grant——当前 resolver 加载全部 grant 后按 `conditions_json` 匹配，没有过滤 `status` 字段。

**具体变更点**：

```
apps/server/src/domain/rule/objective_rule_resolver.ts:
  - resolveThen() 新增 mutate.authority 处理分支
  - 产出 { op: "put_authority_grant", ... } delta operation

apps/server/src/app/runtime/world_engine_persistence.ts:
  - persistPreparedStep() 处理 put_authority_grant 操作
  - 写入 authority_grants 表

apps/server/src/domain/authority/resolver.ts:
  - 过滤 status != "active" 的 grant（如果 status 字段被使用）
```

---

### 2.3 `capability_resolution` 规则未实现

**现状**：`constitution_schema.ts:481` 定义了 `capability_resolution: z.array(worldRuleDefinitionSchema).default([])`，但代码库中没有任何消费者。这是一条空管道。

**功能定位**：capability_resolution 规则的本意是在 capability 被调用前进行解析——例如：
- 同一个 capability key 在不同条件下解析到不同的 invocation 行为
- capability 的分辨条件（谁、对谁、通过哪个 mediator）
- 能力门控的细化（超出 authority grant 的简单匹配）

**与 invocation rules 的区别**：
- `invocation` rules：将 `semantic_intent` 翻译为具体的 capability/invocation
- `capability_resolution` rules：在 capability 确定后、执行前，解析其具体行为和约束

**实现路径**：

1. 确定消费点：capability resolution 应在 `invocation_dispatcher.ts` 中、capability 被 dispatch 之前执行
2. 实现 resolver：参照 `objective_rule_resolver.ts` 的模式，创建 `capability_resolution_resolver.ts`
3. 匹配逻辑：`when` 条件匹配 `(capability_key, subject_entity, target_entity, mediator_id)`，`then` 产出行为修改（如修改 invocation 参数、附加约束、拒绝执行）

**优先级**：P1。赛博朋克世界包当前可用 invocation rules 替代部分场景，但 capability 级别的细粒度控制在越狱对抗等场景中会需要。

---

### 2.4 `projection` 规则未实现

**现状**：`constitution_schema.ts:484` 定义了 `projection: z.array(worldRuleDefinitionSchema).default([])`，代码库中零消费者。

**功能定位**：projection rules 将世界状态计算为可查询的派生数据。典型场景：
- 比赛积分排名：读取 attack/defense 结果 → 计算积分 → 写入 projection
- 碎片归属统计：读取 puzzle_fragment binding → 汇总 → 写入 projection
- 社会阶层分布：读取 actor state → 按 stratum 分组计数 → 写入 projection

**与 storage projections 的区别**：
- `storage.projections`（`storage_schema.ts`）定义的是持久化投影的 schema（表结构）
- `rules.projection` 定义的是投影的**计算逻辑**（何时触发、如何计算、写入哪个投影）

**实现路径**：

1. 创建 `projection_rule_resolver.ts`：参照 `objective_rule_resolver.ts` 的模式
2. 触发时机：每个 tick 的特定阶段（建议在 step 6 perception pipeline 之后，或作为独立步骤）
3. `when` 条件匹配触发条件（tick 间隔、事件类型），`then` 产出计算指令和写入目标
4. 写入目标对接 `storage.projections` 中定义的投影表

**核心挑战**：`then` 中的计算表达式如何定义？`worldRuleDefinitionSchema` 的 `then` 是自由格式 `Record<string, WorldPackValue>`。有三种选择：
- **(a) 受限 DSL**：定义有限的计算操作（sum、count、max、min）和聚合维度
- **(b) 模板化数值表达式**：`then` 中写 `"{{subject_state.score}} + {{target_state.bonus}}"` 由引擎解析
- **(c) 包本地 SQL**：允许 projection rule 引用 pack runtime.sqlite 的 SQL 查询

推荐路径 (a) 作为起点，因为 constrained DSL 可静态验证且安全。

**优先级**：P1。赛博朋克世界包的积分系统、排名、碎片统计都依赖 projection。

---

### 2.5 规则 `when`/`then` 无法引用 pack variables

**现状**：`objective_rule_resolver.ts` 的 `buildObjectiveTemplateContext()` 只提供以下模板变量：
- `invocation.*`（subject_entity_id、target_entity_id、capability_key 等）
- `actor.*`（id、name）
- `target.*`（id、entity_id）
- `artifact.*`（id、label、state.location）
- `mediator.*`（id）

**不包含** `variables.*`（pack 级变量）。`renderStringTemplate` 无法解析 `{{variables.model_defense.emperor_ear.firewall}}` 这样的引用。

**阻塞场景**：赛博朋克草稿定义了大量变量（`model_defense.*`、`jailbreaker_base_stats.*`），对抗计算需要读取这些值，但 objective_enforcement rule 的 `then` 无法引用它们。

**实现路径**：

1. 在 `buildObjectiveTemplateContext()` 中添加 `variables` 到模板上下文：
   ```
   const packVariables = packRuntime?.variables ?? {};
   return { ...base, variables: packVariables };
   ```

2. `renderStringTemplate` 已支持点号路径遍历（`{{variables.model_defense.emperor_ear.firewall}}` → `99`），因为 `WorldPackVariableValue` 支持嵌套。需验证路径解析在嵌套 object 下的行为。

3. 不仅仅是模板插值——`when` 条件匹配也需要能引用 variables。当前 `when` 匹配是静态的 key-value 相等比较，不支持"when variables.competition_round > 5"。这需要：
   - 扩展 `when` 匹配逻辑支持比较运算符
   - 或保持 `when` 为简单匹配，将变量引用限制在 `then` 的模板插值中

**推荐**：先实现 `then` 的 variables 模板插值（改动小），`when` 的比较运算符作为后续迭代。

**变更文件**：
```
apps/server/src/domain/rule/objective_rule_resolver.ts:
  - buildObjectiveTemplateContext() 添加 variables
  - 确保 packRuntime 可访问（需要传入或从上下文获取）
```

---

### 2.6 群体/集体实体概念

**现状**：实体被组织为 5 个扁平数组（`actors`、`artifacts`、`mediators`、`domains`、`institutions`）。不存在：
- 成员关系原语（member_of、belongs_to）
- 群体级别的状态共享
- 群体级别的 authority 授予（一个 grant 覆盖群体的所有成员）

**阻塞场景**：赛博朋克草稿的 `jailbreakers_current` 是"第 9 届参赛者匿名集合"——它是一个群体，但需要表达个体间的差异（不同的 exploit/stealth/persistence 数值、不同的对抗结果）。

**两条路径**：

- **(A) 新增 group/collective entity kind**
  - 定义 `kind: "collective"` 或复用 `kind: "institution"`
  - 实现 member_of 关系（entity → group）
  - 支持群体级别的 authority grant（target_selector 可选中 group，自动覆盖所有 member）
  - 成员可以有独立 state（个体差异），同时共享群体的部分 state

- **(B) 拆分为独立 actor，不引入新概念**
  - 每个参赛者在 `entities.actors` 中单独定义
  - 通过 `entity_type` 或 `tags: ["jailbreaker"]` 标记为参赛者
  - authority target_selector 使用 `entity_type_is: "jailbreaker"` 覆盖全体
  - 个体差异通过 per-entity state 表达

**推荐**：先走路径 B（拆分独立 actor），因为：
- 不需要修改平台
- `entity_type_is` target_selector 已支持按类型批量授权
- 个体 state 天然支持差异
- 路径 A 的群体概念设计空间大（群体 state 共享语义？群体生命周期？群体内通信？），需要更充分的用例才能定义好

**路径 A 作为长期选项**，当有足够多的世界包需要群体概念时再设计。届时需要考虑：
- 群体 entity 的 kind 值（新增 `collective` vs 复用 `institution`）
- 成员关系的存储（mediator binding？单独的 member_of 表？）
- 群体 authority 的继承语义
- 群体解散/成员退出时的级联行为

---

### 2.7 state_transforms 能力受限

**现状**：`state_transform_evaluator.ts` 的功能范围：
- 源值必须是数字（非数字静默跳过）
- 目标只能是 actor 实体
- 输出只是离散标签（范围 label 写入 target key）
- 无组合变换、无代数运算、无字符串/序数范围

**阻塞场景**：赛博朋克世界包的社会阶层迁移（神谕层 → 黄金层 → 青铜层 → 尘埃层 → 不可见层）天然适合 state_transforms。当前能力足够覆盖这个场景（数字 rank 值 → 标签映射），但如果有更复杂的需求则不够。

**当前能力对赛博朋克世界包的适配**：
- 如果阶层由数字 rank 表示（如 `rank: 95`），state_transforms 可以将 `(min:90, max:100) → "神谕层"` 写入 `stratum_label` 字段
- 各层的权限差异可以通过 authority `conditions_json` 匹配 `subject_state.stratum_label` 来实现

**扩展方向**（非当前阻塞，记录供后续参考）：
1. 非数字源值：序数字符串（`"low"` < `"medium"` < `"high"`）
2. 非 actor 目标：mediator、domain 的 state 变换
3. 组合变换：多个 source 值参与一个 label 的计算
4. 变换钩子：变换前后触发 invocation 或 event

**优先级**：P2。当前能力足够覆盖赛博朋克世界包的阶层系统。

---

## 三、实施优先级与依赖关系

```
缺口 2.2 (动态 authority) ← 阻塞 ← 缺口 2.1 (kind 迁移, 路径 B)
     ↓
缺口 2.5 (variables 引用) + 缺口 2.4 (projection rules)
     ↓
缺口 2.3 (capability_resolution)
     ↓
缺口 2.6 (群体实体, 路径 A) + 缺口 2.7 (state_transforms 扩展)
```

### P0 — 赛博朋克世界包阻断项

| 优先级 | 缺口 | 理由 |
|--------|------|------|
| P0-1 | 2.2 动态 authority | 碎片转移、出局权限变更、社交圈准入、commandeer 全部依赖此能力 |
| P0-2 | 2.5 variables 在规则中引用 | 对抗计算必须读取 `model_defense` 和 `jailbreaker_base_stats` |
| P0-3 | 2.4 projection 规则 | 积分计算、排名、碎片统计无处落地 |

### P1 — 赛博朋克世界包需要但可 workaround

| 优先级 | 缺口 | workaround |
|--------|------|-----------|
| P1-1 | 2.1 entity kind 迁移 | 路径 B：state 变化 + 动态 authority 模拟 |
| P1-2 | 2.3 capability_resolution 规则 | 用 invocation rules 替代部分场景 |

### P2 — 非阻塞

| 优先级 | 缺口 | 说明 |
|--------|------|------|
| P2-1 | 2.6 群体实体（路径 A） | 拆分独立 actor 可 workaround |
| P2-2 | 2.7 state_transforms 扩展 | 当前能力已覆盖赛博朋克阶层系统 |

---

## 四、与已有缺口分析的关系

已有 `generic-capability-gap-analysis.md` 覆盖：
- 插件贡献类型接入（StepContributor、RuleContributor 等）
- Sim loop 生命周期钩子
- Action dispatch 扩展性
- Manifest 类型系统
- 权限系统（插件沙箱层面）
- 可观测性
- 测试基础设施
- 插件生命周期/隔离/版本管理
- 多包交互

本补充覆盖的是**另一层面**：世界包宪法系统的运行时能力（entity、rules、authority、variables）。两组缺口正交——即使插件系统全部完善，上述 7 个缺口仍然存在。

唯一交叉点：2.2（动态 authority）的实现涉及 `objective_rule_resolver.ts` 的修改，该文件同时是已有分析中 RuleContributor 的消费端。两者不冲突，但需要注意合并时的执行顺序。

---

## 五、实施顺序建议

第一轮（P0）：
1. 2.5 variables 在规则中引用 — 改动最小，为后续铺路
2. 2.2 动态 authority — 核心变更，涉及 objective_rule_resolver + persistence + authority resolver
3. 2.4 projection 规则 — 新建 resolver，对接 storage projections

第二轮（P1）：
4. 2.1 entity kind 迁移（路径 B）— 依赖 2.2 到位后通过 state + authority 组合实现
5. 2.3 capability_resolution 规则 — 新建 resolver

第三轮（P2）：
6. 2.6 群体实体（路径 A）— 需要更多用例支撑设计
7. 2.7 state_transforms 扩展 — 按需扩展
