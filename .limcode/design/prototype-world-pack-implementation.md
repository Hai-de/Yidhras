# 原型世界包实施方案草案

> 状态: 草案 · 平台基础设施完成 (Phase 0-2 实现)
> 关联: `.limcode/design/spatial-semantics-design.md`、`# 原型世界包.md`
> 评估时间: 2026-05-08 · 最后更新: 2026-05-09
> 最后更新: 2026-05-08

## 1. 已确认决策

| 决策项 | 结论 |
|--------|------|
| 随机宏展开时机 | 仅加载时展开，展开后世界确定 |
| 地点数量 | 10-20 个命名地点 |
| Agent 数量 | 9-15 人 |
| 每日任务生成 | AI 动态生成 |
| 前端可视化 | 不需要 |
| 角色随机种子 | `{{roll 1d999}}` 作为噪声注入 AI prompt 无效，废弃此方式 |

## 2. 原型世界包概要

**题材**：暴风雪山庄 — 封闭环境、固定场景、固定场景连接方式、全 agent 自主驱动。

**验证目标**：
- 空间语义 A 层全链路（离散位置 + 邻接图）
- 新宏语法体系（加载时展开、结构化随机、可重现）
- 信息不对称机制（agent 只知道自己所在位置发生的事）
- 动态世界生成（初次加载时随机确定世界观/角色/黑幕，而非注入噪声）
- 每日任务分发系统（AI 生成 + 私密分发）

## 3. 宏语法重设计

### 3.1 原始语法的局限性

`# 原型世界包.md` 中使用的 `{{roll NdN}}` 和 `{{random:[...]}}` 来自某个角色扮演平台，迁移到 Yidhras 存在以下问题：

**语法层面：**
- `{{roll 2d6}}` 使用位置参数。当前解析器的 `parseMacroExpression` 只提取 `key=value` 对，非键值对单词被静默丢弃。`roll 2d6` 会被解析为 `{name: "roll", args: {}}`，参数完全丢失
- `{{random:[A::B]::[C::D]}}` 的 `::` 分隔符不是任何已知序列化格式，解析脆弱，无法嵌套复杂结构
- 宏名和参数混在同一 token 中（`random:[...]` 整体被视为宏名）
- 无法区分"求值一次冻结"和"每次渲染求值"——对世界包加载场景，前者是必需的

**语义层面：**
- `{{roll 1d999}}` 作为"种子"注入 AI prompt 的用法从根本上无效。AI 不理解一个裸数字对角色多样性的意义，倾向于从其训练分布中生成固定套路的人物组合。**随机性应该决定模拟中的实际状态，而非作为提示词噪声**
- 原始语法假设宏在每次对话轮次中展开（运行时求值），但世界包场景需要加载时一次性展开并物化到数据库中

### 3.2 新宏语法设计

**设计原则：**
1. 全部使用命名参数（`key=value`），兼容当前解析器
2. 加载时展开为具体值，展开后写入 runtime DB，之后不再变化
3. 可重现：世界包可携带 seed 参数，相同 seed 产生相同世界
4. 带类型输出：number / string / string[]，而非一切转字符串

**核心宏：**

```
# 骰子 — 返回 number
{{roll count=2 sides=6}}          → 8 (2d6 求和)
{{roll sides=20}}                 → 17 (1d20, count 默认 1)
{{roll count=8 sides=2}}          → 11 (8d2)

# 随机选取 — 从列表中选
{{pick from=a,b,c}}               → "b" (随机单元素)
{{pick from=a,b,c count=3}}       → ["b","a","c"] (不放回抽取)

# 随机整数/浮点数
{{int min=0 max=99}}              → 42
{{float min=0 max=1}}             → 0.73

# 可重现性
{{seed value=12345}}              → 设定全局种子（不输出），后续所有宏确定性求值
```

**与当前解析器的兼容性：**

解析器将 `{{roll count=2 sides=6}}` 解析为：
```
MacroNode { name: "roll", args: {count: "2", sides: "6"} }
```

宏处理器从 `args` 中解析数值参数，执行随机运算，返回结果字符串。不需要修改词法分析器或解析器。

**`pick` 的数组参数处理：**

`{{pick from=a,b,c}}` 解析为 `args: {from: "a,b,c"}`，处理器内部分割逗号得到数组。当列表元素本身包含逗号时，需要转义机制。对于原型世界包的用途（地点名、角色名、动机描述），逗号冲突概率极低，暂不处理。

**加载时展开的执行位置：**

随机宏不在 `PackManifestLoader` 的 YAML 解析阶段展开（此时尚未决定是否加载此包），而是在 `materializePackRuntimeCoreModels` 的物化阶段展开。原因：
- 物化阶段已经确认要加载此包
- 物化阶段有 prisma + storage adapter，可以直接写入展开结果
- 展开结果作为 entity state 写入 runtime DB，后续推理直接读取，不再经过模板引擎

具体流程：
```
config.yaml 加载 → Zod 验证 (宏仍为字符串)
  → materializer 调用 TemplateEngine 展开 bootstrap 中的宏
  → 展开后的具体值写入 entity_states
  → AI 推理时读到的是已确定的状态，而非宏表达式
```

### 3.3 实现要点

**`template_engine/core/types.ts` 新增：**

```typescript
type MacroHandlerFn = (name: string, args: Record<string, string>, scope: RenderScope) => string;

interface RenderScope {
  // 现有字段...
  modifiers: Record<string, ModifierFn>;
  blockHandlers: Record<string, BlockHandlerFn>;
  macroHandlers: Record<string, MacroHandlerFn>;  // 新增
}
```

**`template_engine/defaults.ts` 新增 `BUILTIN_MACRO_HANDLERS`：**

- `roll` — 解析 `count`(默认 1)、`sides`，执行骰子求值，返回和的字符串表示
- `pick` — 解析 `from`（逗号分割）、`count`（默认 1），随机选取
- `int` — 解析 `min`、`max`，返回区间内随机整数
- `float` — 解析 `min`、`max`，返回区间内随机浮点数
- `seed` — 设定 PRNG 种子，返回空字符串（副作用宏）

**PRNG 选型：**
使用 `seedrandom` 或实现 mulberry32/xoshiro128**。全局单例，`seed` 宏设定种子后影响后续所有随机宏。不设定种子时使用 `crypto.randomUUID()` 作为默认种子并记录到世界包元数据中，保证可复现。

## 4. 信息传播模型分析

### 4.1 问题定义

`spatial-semantics-design.md` 第 4.4 节提出"空间事件传播步骤"作为 sim loop 第 6 步，但未定义传播的具体物理含义。`# 原型世界包.md` 中强调"所有信息默认是私有信息，除非有人共享公开"。这两者之间存在设计张力——空间传播是物理性的（声音/目击），还是社会性的（告知/传闻）？

### 4.2 传播层次拆分

```
Layer 1: 直接目击 (Direct Observation)
  - Agent 在位置 L → 感知 L 内所有 public 事件
  - 感知 L 内所有其他 agent 的存在和公开行为
  - 不感知 L 内的 private 事件（即使同处一室）

Layer 2: 物理声音传播 (Acoustic Propagation)
  - 事件有 loudness 属性 (silent | quiet | normal | loud | very_loud)
  - 声音沿位置邻接图衰减传播
  - 每跳衰减一级: very_loud → loud → normal → quiet → silent
  - 衰减到 silent 后不可感知
  - 感知内容降级: 直接目击获得完整信息，跨房间声音只知"有异常响动"

Layer 3: 社会性共享 (Social Sharing)
  - Agent 主动向他人传递信息 (post_message intent)
  - 可以公开（同位置所有人听到）或私密（指定接收者）
  - 这是社会行为，不是空间物理行为
  - 不依赖位置邻接——如果两个人同处一室，私密对话其他人听不到

Layer 4: 发现 (Discovery)
  - Agent 移动到新位置后自动感知该位置的环境状态
  - 尸体、线索、物品等是位置附着状态，移动到该位置即自动感知
```

### 4.3 原型阶段建议

**Phase 0（原型世界包）实现 Layer 1 + Layer 4：**

- 每个事件携带 `location_id` 和 `visibility: public | private`
- Context assembly 根据 agent 当前位置过滤：同位置 + public → 可见。私密事件仅目标可见
- 移动到新位置时，perception 注入该位置的环境状态（尸体、物品等）
- **不做物理声音传播**（Layer 2），减轻初始复杂度
- Layer 3 复用现有 `post_message` intent

Layer 2 留到原型跑通后再评估是否需要。暴风雪山庄的场景中，声音传播（枪响、尖叫）对氛围很重要，但可以先通过 AI 自身的叙事行为模拟（"你听到地下室传来一声闷响"），不依赖系统级传播机制。

**待讨论：** 是否需要在原型中就加入 Layer 2？加入后的效果是系统级的（每个 agent 自动感知到传播到其位置的事件），不加入则需要 AI 自行模拟（agent 生成事件时附带描述"所有人都听到了"）。前者更精确可控，后者更灵活但不可靠。

## 5. AI 工具调用分析

### 5.1 问题

原型世界包中的 agent 需要执行的操作远多于当前 4 种内核 intent（`trigger_event`、`post_message`、`adjust_relationship`、`adjust_snr`）。是否需要引入 AI 工具调用（function calling），让 AI 直接选择调用 `move(to="kitchen")` 等结构化函数？

### 5.2 当前模型 vs 工具调用模型

```
当前模型:
  AI 输出自然语言 → 意图解析器提取 intent → action dispatcher 执行

工具调用模型:
  AI 收到可用工具列表 → AI 返回 tool_call JSON → 直接执行
```

### 5.3 分析

**原型世界包需要的新操作：**

| 操作 | 实现方式 |
|------|----------|
| 公开说话 | `post_message` intent（已有） |
| 私密对话 | `post_message` + 指定 target（已有，需确认 target 字段） |
| 移动到某地 | `move` intent（新增 kernel intent） |
| 搜查/调查 | `invoke.investigate` + enforcement 规则 + capability 授权（包级定义） |
| 使用物品 | `invoke.use_item` + enforcement 规则（包级定义） |
| 攻击/杀害 | `trigger_event` intent（已有，语义匹配） |
| 隐藏证据 | `invoke.conceal` + enforcement 规则（包级定义） |

**不建议在原型阶段引入工具调用的理由：**

1. **项目已有 intent 模型** — `action_dispatcher.ts` 处理 4 种内核 intent，扩展 `move` 遵循同一模式。`investigate`/`use_item` 等通过 `invoke.*` + enforcement 规则走已有 invocation pipeline，不污染 kernel intent 层
2. **enforcement engine 已做鉴权** — `enforceInvocationRequest` 验证 capability、mediator binding。包作者声明 `invoke.investigate` 能力 + 目标执行规则即可，不需要新增 kernel 代码路径
3. **AI 自然语言输出有价值** — 叙事模拟中，AI 说的"我紧张地环顾四周，然后小心翼翼地走向厨房"比裸 `move(to="kitchen")` 提供更丰富的上下文
4. **意图解析的容错性** — 当前 intent grounding 从自然语言中提取结构化 intent。如果解析失败，不影响叙事（AI 仍然说了那句话）。工具调用失败则是硬错误

**只新增一个 kernel intent：`move`**

```typescript
// 新增:
| { type: 'move'; entity_id: string; target: string }
// A 层 target 为 location_id，dispatch 时由 SpatialRuntime.neighbors() 校验邻接合法性
```

`investigate`、`use_item`、`conceal` 等作为包级 `invoke.*` 规则，由原型世界包的 config.yaml 定义 capability + enforcement rule，走已有 invocation 管道。

## 6. 角色生成策略

### 6.1 为什么 `{{roll 1d999}}` 无效

原始素材中使用 `{{roll 1d999}}` 作为"种子"决定角色关系、性格、团队情况。实际效果：
- AI 不理解裸数字的含义
- 倾向于生成训练数据中的固定套路（"必定有一个领袖、一个胆小鬼、一个理性者"）
- 不同种子值的输出高度同质化

**根本原因**：随机性在 AI 外部不起作用。AI 的内部先验压倒外部噪声。

### 6.2 替代方案：结构化随机 + AI 角色扮演

```
加载时:
  1. {{pick}} 从预设 trait 池中为每个角色选取具体属性
     - 性格: {{pick from=偏执,勇敢,狡诈,天真,暴躁,冷漠,多疑,乐观}}
     - 职业: {{pick from=医生,律师,记者,商人,艺术家,工程师,教师,无业}}
     - 秘密: {{pick from=隐藏了真实身份,欠下巨额债务,有犯罪前科,...}}
     - 与其他角色的关系: {{pick from=陌生人,旧识,仇敌,情人,同事,亲属}}
  2. 选取结果写入 entity state
  3. 物化完成，世界确定

运行时 (AI 推理):
  - AI 收到的 context 中包含: "你是张三，35岁，职业为记者，性格偏执多疑。你隐藏了真实身份。"
  - AI 基于具体属性进行角色扮演，而非从裸数字凭空生成
  - 不同 trait 组合自然产生不同行为模式
```

**关键差异：** 随机性在模拟层（entity state），不在提示词噪声层。AI 的工作是扮演已有属性的角色，不是发明属性。

### 6.3 Trait 池设计

每个 trait 维度需要足够大的选项池（20+ 选项），保证 10-15 人的组合多样性。选项由世界包作者定义在 `config.yaml` 的 variables 段中，宏从中选取。

```yaml
variables:
  personality_traits:
    - 偏执多疑
    - 冷静理性
    - 冲动易怒
    - 胆小怕事
    - 狡诈善骗
    # ... 20+ options
  professions:
    - 医生
    - 律师
    # ... 15+ options
```

### 6.4 待讨论：AI 二次加工

选取完 trait 后，是由宏直接拼出角色描述，还是将 trait 发给 AI 让其生成连贯的角色背景？

- **宏直接拼出**：`"你是{name}，{age}岁，{profession}，性格{personality}。{secret}"`。快速、确定、不消耗 AI token。但角色卡生硬。
- **AI 二次加工**：将 trait 发给 AI，AI 生成连贯的角色背景故事。更自然但有 token 成本，且可能引入 AI 自身的 stereotype。

建议原型先用宏直接拼出（省 token、可复现），如果角色卡质量影响叙事，再引入 AI 加工。

## 7. 前置依赖分析（更新）

### 7.1 依赖图

```
宏系统重设计 + 实现
    │
    ▼
空间 A 层实现
    │
    ├──► SpatialRuntime (邻接图 + BFS + move)
    ├──► EntityState spatial namespace
    ├──► Context assembly 空间源
    ├──► Action dispatch move intent
    └──► Enforcement engine 空间谓词
    │
    ▼
信息可见性扩展 (perception + 位置维度)
    │
    ▼
原型世界包 config.yaml
    │
    ├──► 角色结构化随机生成 (trait 池 + pick 宏)
    ├──► 地点 + 邻接关系定义
    ├──► 每日任务 AI 生成规则
    └──► 黑幕/谋杀机制规则
```

### 7.2 前置项清单

| 编号 | 前置项 | 说明 |
|------|--------|------|
| P0 | 宏处理器基础设施 | `MacroHandlerFn` 类型 + `macroHandlers` 注册表 + 内置宏实现（roll/pick/int/float/seed） |
| P1 | 宏加载时展开 | `materializer.ts` 中调用模板引擎展开 bootstrap 中的宏 |
| P2 | SpatialRuntime（A 层） | 邻接图 + BFS 距离 + location 查询 |
| P3 | EntityState spatial namespace | 实体 `{location: location_id}` 状态约定 |
| P4 | Move intent | 新增 intent 类型 + 邻接合法性检查 |
| P5 | Context assembly 空间源 | 注入"当前所在位置"+"同位置实体"+"邻接地点" |
| P6 | Enforcement 空间谓词 | `location: {in: [...], adjacent_to: ...}` |
| P7 | 事件 spatial_scope | Event 携带 `location_id` + `visibility` |
| P8 | Perception 位置过滤 | 根据 agent 当前位置过滤可见事件/状态 |
| P9 | 原型世界包 config.yaml | 完整的世界包定义 |

## 8. 实施阶段

### Phase 0: 宏系统 (P0 + P1)

**变动文件：**

| 文件 | 变更 |
|------|------|
| `apps/server/src/template_engine/core/types.ts` | 添加 `MacroHandlerFn`、`macroHandlers` 到 `RenderScope` |
| `apps/server/src/template_engine/defaults.ts` | `BUILTIN_MACRO_HANDLERS`：roll、pick、int、float、seed |
| `apps/server/src/template_engine/core/renderer.ts` | `case 'macro'` 调用 `macroHandlers` |
| `apps/server/src/template_engine/frontends/narrative/resolver.ts` | 同上 |
| `apps/server/src/packs/runtime/materializer.ts` | bootstrap 物化前展开模板宏 |

### Phase 1: 空间 A 层 (P2-P8)

对应 `spatial-semantics-design.md` Phase 1，限定为原型世界包所需的最小功能集。

### Phase 2: 原型世界包 (P9)

编写 `data/world_packs/snowbound_mansion/config.yaml`，端到端验证。

## 9. 新增潜在问题

1. **PRNG 种子的持久化** — 加载时展开宏后，种子和展开结果都需要记录。如果用户想重现同一个世界（相同角色、相同布局），需要能从种子重建。种子应存储在 world pack runtime 的元数据中。

2. **宏的幂等性** — 如果世界包加载失败后重试，宏是否会重新求值产生不同结果？加载时展开意味着第一次物化时求值，物化结果持久化在 DB 中。重试时需要判断是否已物化过。

3. **`pick` 的不放回抽取状态** — `{{pick from=a,b,c count=3}}` 在一次模板渲染中不放回。但如果分多次调用 `{{pick from=a,b,c}}`（每次只选一个且需不放回），需要宏系统维护抽取状态。原型阶段是否需要跨宏调用的不放回抽取？

4. **AI 生成每日任务的质量和一致性** — AI 生成的每日任务可能不符合游戏平衡（太简单/太难）、前后矛盾、或泄露黑幕信息。是否需要任务模板约束 AI 的输出空间？

5. **黑幕 agent 的"全知"问题** — 黑幕需要知道所有人的位置和状态才能有效运作。但信息不对称机制要求 agent 只能看到当前位置的事。黑幕是否应有特殊的"全知"感知能力？（类似于 B 级片/推理小说中黑幕通过监控摄像头或秘密通道掌握全局）

6. **尸体/线索的空间附着** — 尸体和线索是 entity state 附着在 location 上，还是作为独立 entity？如果是 entity state，那么"尸体在图书馆"意味着图书馆 entity 有一个 state 记录了尸体。移动到图书馆的 agent 就能自动感知。但尸体也可能被移动、隐藏。

7. **多人同地点的 AI 推理并发** — 10-15 个 agent 在同一 tick 内做出决策。如果 5 个人都在餐厅，他们几乎同时说话和行动，AI 推理的顺序如何影响叙事？当前 scheduler 是分区串行的，但同一 tick 内的 agent 决策顺序可能导致不自然的交互。

8. **世界包是否应内置默认的地点/角色定义** — 是完全由随机宏动态生成（每次加载都是不同的暴风雪山庄），还是有一个基础模板（固定的地点布局、固定的角色 archetype 槽位），随机只在细节上变化？前者每次都是新游戏，后者可以迭代打磨体验。

## 10. 建议讨论顺序

1. 确认宏语法设计（第 3 节）— 这是最基础的依赖
2. 确认信息传播模型的 Layer 范围（第 4 节）— 决定 P7/P8 的实现复杂度
3. 确认工具调用不引入（第 5 节）— 确认扩展 intent 的方向
4. 确认角色生成策略（第 6 节）— 决定 trait 池设计和 AI 是否二次加工
5. 逐一讨论第 9 节的 8 个新问题

## 11. 评审结论（2026-05-08）

评审视角：该原型世界包的存在意义是完善项目本身，项目尚未上线，可以接受大范围重构。以下结论从"项目地基能力"角度审视草案各主张，区分"平台应吸纳的通用能力"与"应由包作者自行定义的领域逻辑"。

### 11.1 吸纳为项目地基的 7 项

| 编号 | 主张 | 地基产出 | 理由 |
|------|------|----------|------|
| F1 | 宏处理器基础设施（§3） | `MacroHandlerFn` + `macroHandlers` 注册表 + 5 个内置宏（roll/pick/int/float/seed） | 模板引擎已有 MacroNode 与 renderer 空分支，这是补完已有扩展点而非新增架构。所有世界包都需要"加载时确定随机状态"的能力 |
| F2 | 结构化随机 > 噪声注入（§6） | 设计原则：随机性应决定模拟状态，不是作为提示词噪声 | 与已有 inference pipeline 的变量分层逻辑同构——信息系统在确定性架构上运行，不确定性留给可观察层面 |
| F3 | 事件空间作用域 | Event 增加 `location_id` + `visibility` | A/B/C 三层都需要事件属于某处、对某类观察者可见，这是最小必要扩展 |
| F4 | 感知管线原则 | `PerceptionResolver` 接口 + 默认实现（同地点 full / 其他 none） | 每个事件必须经过感知过滤后才进入 context assembly。管线约束是平台级的，管线内部规则是包级的 |
| F5 | `move` intent | 新增 kernel intent + 邻接合法性检查 | 空间模拟的原子操作，遵循现有 enforcement → dispatch 管道 |
| F6 | 空间上下文源 | context assembly 增加 `spatial_proximity` source | 任何有空间的世界包都需要让 AI 知道"你在哪、旁边有谁" |
| F7 | 空间规则谓词 | enforcement 增加 `location.in` / `location.adjacent_to` | 规则引擎需要空间条件是通用需求 |

加上空间设计文档中已确认的基础设施：

| 编号 | 主张 | 说明 |
|------|------|------|
| F8 | PRNG seed 可复现 | 物化流程携带种子，相同种子产生相同世界 |
| F9 | Constitution schema `spatial` 可选段 | 不声明 spatial 的世界包行为完全不变（零影响保证） |
| F10 | EntityState `spatial` namespace | 约定 `{location: location_id}` 存储实体空间状态 |
| F11 | Sim loop 第 6 步空间事件传播 | 感知管线在 tick 级别的事件过滤 |

### 11.2 重构为通用接口的主张

| 草案主张 | 重构方向 | 理由 |
|-----------|----------|------|
| 传播层次 Layer 1-4（§4） | → `PerceptionResolver` 插槽 | 四层传播是暴风雪山庄特有的信息模型。不同世界包对"信息怎么传播"有完全不同的答案：声音沿房间传播、社交网络沿关系传播、太空信号沿光速衰减、抽象空间沿维度梯度扩散。平台只保证管线约束（事件必经感知过滤），内部规则由包作者声明或实现 |
| 声学衰减传播（Layer 2） | → pack 级 `PerceptionResolver` 实现 | 领域特化，不是平台级能力 |

`PerceptionResolver` 接口设计：

```typescript
interface PerceptionResolver {
  resolve(event: Event, observerState: EntityState, ctx: PackRuntimeContext): PerceptionResult;
}

type PerceptionResult =
  | { level: 'full' }
  | { level: 'partial', description: string }
  | { level: 'none' };
```

包级声明式配置示例：

```yaml
perception:
  type: spatial_proximity  # 或 social_network, custom:plugin_id
  rules:
    - match: { visibility: public }
      same_location: full
      adjacent: { level: partial, template: "你隐约听到{source}传来{event_summary}" }
      distant: none
    - match: { visibility: private }
      only_target: full
      others: none
```

### 11.3 不纳入项目地基的主张

| 草案主张 | 排除理由 |
|-----------|----------|
| `investigate` / `use_item` intent | 包作者可通过 `invoke.investigate` / `invoke.use_item` + enforcement 规则实现，无需提升为 kernel intent |
| Trait 池设计（§6） | 内容是包作者的业务，平台只提供 `pick` 宏作为选择工具 |
| 黑幕全知特权 | 特定包规则，用 authority grant + capability 实现 |
| AI 二次角色加工 | 推理层配置选项，不是平台基础设施 |
| 前端可视化（原型阶段） | 原型不需要，后续按需 |
| 每日任务 AI 生成系统 | 包级叙事规则，不是平台基础设施 |

### 11.4 对草案第 9 节潜在问题的立场

| 问题 | 立场 |
|------|------|
| PRNG 种子持久化 | F8 已覆盖。种子存储在 world pack runtime 元数据中，重试时检测已物化则跳过宏展开 |
| 宏幂等性 | 物化结果持久化在 DB 中，重试检测物化记录后跳过 |
| `pick` 不放回抽取状态 | 原型阶段不实现跨宏调用的不放回抽取。单次 `pick count=N` 满足需求 |
| AI 生成每日任务质量 | 包作者的设计空间，平台不约束 |
| 黑幕全知 | 包级 authority + capability 设计 |
| 尸体/线索的空间附着 | 作为 entity state 附着在 location entity 上，复用已有 entity 体系 |
| 多人同地点推理并发 | 沿用 sim loop 的串行分区保证 |
| 世界包基础模板 vs 完全随机 | 包作者的选择，平台两都支持 |
