# World-Pack 边界收口与 Death Note 文档迁移设计

## 1. 背景与问题

当前仓库在推进 `death_note` 世界包完善过程中，已经出现若干“边界倒置”现象：

1. 项目级文档中对 `death_note` 的叙述比例过高，容易让读者误解为：
   - world-pack 规范是围绕 `death_note` 定义的；
   - `death_note` 是宿主默认世界，而不是一个参考实现。
2. 项目核心代码中已经存在对 `world-death-note` 的直接特判，尤其体现在：
   - `apps/server/src/inference/providers/rule_based.ts`
3. 运行时默认配置中存在把 `death_note` 当作默认运行世界/默认 scaffold 来源的倾向，体现在：
   - `apps/server/src/config/runtime_config.ts`
   - `apps/server/src/init/runtime_scaffold.ts`
4. 一部分本应属于世界包自身的设计说明、语义解释、扩展理由，仍散落在项目级文档中，而没有沉淀回：
   - `data/world_packs/death_note/README.md`
   - `data/world_packs/death_note/CHANGELOG.md`
   - 包内新增专属设计说明文档

这会带来两个问题：

- **项目边界问题**：宿主核心开始“知道并偏爱某个具体世界包”。
- **文档治理问题**：包专属知识没有收口到包目录，降低可移植性与通用性。

---

## 2. 核心原则

本次收口设计遵循以下原则：

### 2.1 宿主只定义框架，不定义具体世界

Yidhras 核心只负责定义 world-pack 的：

- schema / contract
- lifecycle
- runtime boundary
- install / materialize / projection / AI task / storage 等通用机制

它**不应内建任何特定世界观语义**。

### 2.2 `death_note` 是参考包，不是核心默认语义

`death_note` 的定位应明确为：

- 仓库自带的参考 world-pack
- 用于验证 world-pack 框架能力的样例
- 可读、可运行、可扩展的 pack 项目单元

而不是：

- 核心默认世界
- 特殊宿主逻辑的绑定对象
- 文档中的规范中心

### 2.3 包专属内容优先回收到包目录

凡是属于 `death_note` 专属的：

- 世界观说明
- 语义动作说明
- AI/记忆治理取舍
- institutions / domains / storage 的具体语义
- 设计动机与演化记录

应优先放在 `data/world_packs/death_note/` 内部，而不是散落在项目级 `docs/` 中。

### 2.4 允许“示例引用”，不允许“规范中心化”

项目文档可以引用 `death_note` 作为示例，但必须满足：

- 示例仅用于说明通用机制的一种实现；
- 文档主叙事始终保持中性；
- 不把某个包写成宿主默认世界。

---

## 3. 目标

本次设计目标不是继续扩展 `death_note` 内容本身，而是**修正仓库中的职责边界与文档归属**。

完成后应达到：

1. 项目级文档回到“讲框架、讲 contract、讲边界”的位置。
2. `death_note` 专属说明主要收口在 `data/world_packs/death_note/` 内。
3. 项目核心中的 `death_note` 直接特判被识别并分级治理。
4. 默认配置与模板叙事去中心化，避免把 `death_note` 写成核心默认世界。
5. 后续新增世界包时，不会被迫沿用 `death_note` 作为隐式标准。

---

## 4. 非目标

本次设计**不直接承诺**以下事项：

1. 不在本轮设计中完成所有 pack-specific 代码重构。
2. 不在本轮设计中重命名全部测试 fixture。
3. 不要求立即删除仓库中所有 `death_note` 示例引用。
4. 不改动 `death_note` 世界包 contract 的既有内容范围。
5. 不处理前端主题、封面、图标等 presentation 事项。

---

## 5. 当前问题清单

## 5.1 项目级文档问题

### `docs/WORLD_PACK.md`

当前问题：

- 直接使用 `world-death-note` 作为主要示例元数据；
- 把 `death_note.yaml / README / CHANGELOG` 作为模板中心；
- 文案上把 `death_note` 推到“首批规范化参考实现”的中心位置。

风险：

- 新读者会误以为 world-pack 规范与 `death_note` 强绑定。

### `docs/LOGIC.md`

当前问题：

- 存在 `world-death-note` 当前语义循环之类的 pack-specific 叙述。

风险：

- 项目逻辑文档混入具体世界观结论，破坏通用逻辑文档的中立性。

---

## 5.2 核心代码边界问题

### `apps/server/src/inference/providers/rule_based.ts`

当前问题：

- 直接按 `context.world_pack.id === 'world-death-note'` 分支；
- provider metadata 直接暴露 `rule_based_death_note` 等 pack-specific 名称。

风险：

- 核心 provider 逻辑开始对单一世界包产生语义绑定；
- 后续新增 pack 时会诱导继续加 if/else 特判。

### `apps/server/src/config/runtime_config.ts`

当前问题：

- 默认 `preferred_pack: death_note`
- bootstrap 目标包目录与模板路径直接指向 `death_note`

风险：

- 宿主运行时默认语义被某个示例包绑定。

### `apps/server/src/init/runtime_scaffold.ts`

当前问题：

- 默认 scaffold 模板资源直接绑定 `death_note` 文件名。

风险：

- 在语义上把“示例模板资源”误表达为“核心默认世界模板”。

---

## 5.3 包内文档承载不足

`data/world_packs/death_note/` 目前虽然已有：

- `config.yaml`
- `README.md`
- `CHANGELOG.md`

但对以下内容的集中表达仍不足：

- 设计目标
- 语义动作链解释
- `ai.tasks` 与 `memory_loop` 的 pack-specific 取舍
- `domains / institutions / storage.pack_collections` 的世界内含义
- 为什么这些修改属于包，不属于宿主核心

---

## 6. 设计方案

本设计拆为三个层次：

- **Layer A：文档边界收口**
- **Layer B：代码边界识别与分级治理**
- **Layer C：模板与默认配置去中心化**

---

## 6.1 Layer A：文档边界收口

### A1. 重写项目级 `docs/WORLD_PACK.md` 的叙事中心

目标：

- 把 `docs/WORLD_PACK.md` 从“围绕 death_note 解释规范”改为“解释 world-pack 通用 contract”。

调整原则：

1. 顶层 schema 示例改为中性示例：
   - 不再默认写 `world-death-note`
   - 改为 `world-example-pack` / `example_world` 等中性名字
2. 模板资源描述改写为：
   - 仓库包含若干示例/模板资源；
   - `death_note` 只是 bundled example 之一
3. 保留对 `death_note` 的引用，但放到：
   - “参考实例”
   - “示例实现”
   - “附录/案例”
   而不是正文规范主轴。
4. 明确写出边界声明：
   - 核心只定义框架；
   - 任何 pack-specific 语义属于对应包。

### A2. 清理 `docs/LOGIC.md` 中的 pack-specific 叙事

目标：

- 让 `docs/LOGIC.md` 回到通用逻辑与运行机制层。

调整原则：

1. 删除或迁出直接描述 `world-death-note` 当前循环状态的段落。
2. 若必须保留案例，则改为：
   - “某个 world-pack 可以形成如下闭环”
   - 或在注脚中引用包内文档。

### A3. 在 `data/world_packs/death_note/` 内增补专属说明文档

新增建议文件：

- `data/world_packs/death_note/DESIGN.md`

建议内容：

1. 包定位
   - 这是参考包，不是宿主内建世界
2. 世界核心张力
   - 规则媒介、侦查对抗、舆论波动、资格传播
3. 语义动作链
   - reflection / dossier / plan / postmortem
4. AI / memory 治理
   - 各 task 的偏好与目的
5. 领域与机构
   - domains / institutions 的建模意图
6. storage collections
   - `target_dossiers`
   - `judgement_plans`
   - `investigation_threads`
7. 与宿主边界
   - 宿主只提供框架能力；
   - 包负责具体语义组织。

### A4. 调整 `README.md` 与 `CHANGELOG.md`

目标：

- 让 `README.md` 负责对外可读说明；
- 让 `CHANGELOG.md` 负责记录演进；
- 让 `DESIGN.md` 承担设计动机与结构解释。

建议分工：

- `README.md`：是什么、怎么玩、有哪些关键特性
- `DESIGN.md`：为什么这样设计、结构如何组织
- `CHANGELOG.md`：版本演进记录

---

## 6.2 Layer B：代码边界识别与分级治理

### B1. 建立 pack-specific 特判清单

按优先级分级：

#### P0：必须治理

- `apps/server/src/inference/providers/rule_based.ts`

原因：

- 这是核心决策路径，不能对某个特定包写死语义分支。

#### P1：应治理

- `apps/server/src/config/runtime_config.ts`
- `apps/server/src/init/runtime_scaffold.ts`

原因：

- 它们影响“项目默认是什么”的叙事。

#### P2：可延后

- 大量测试中的 `death_note` fixture 命名
- 个别以 `world-death-note` 作为默认 pack id 的通用测试

原因：

- 测试中使用示例包不一定违规，但要避免在测试含义上把它当宿主内建世界。

### B2. 对 `rule_based.ts` 的目标状态

目标状态不是“简单换名字”，而是**移除 pack id 直连分支**。

推荐方向：

#### 方案 B2-1：配置驱动

把当前 `death_note` 特有启发式迁移为：

- 基于 `pack.ai` 配置
- 基于 world state / actor state / capability / rules 的通用推断
- 基于 pack metadata 的 declarative hint

优点：

- 不需要核心知道 `death_note`

#### 方案 B2-2：参考 provider 下沉为示例实现

如果当前 rule-based provider 的确只服务于 `death_note` 样例，可考虑：

- 核心保留 generic rule-based shell
- `death_note` 相关启发式迁入：
  - 包内 declarative config
  - 或未来 pack-local extension / plugin

优点：

- 明确把 pack 语义从宿主核心移出。

### B3. 配置默认值去中心化

#### `runtime_config.ts`

目标状态：

- `preferred_pack` 不再默认等于 `death_note`
- bootstrap 配置不再默认表现为“启动就该是 death_note”

建议方式：

1. 默认 `preferred_pack` 为空或由环境注入
2. bootstrap 语义分离为：
   - 是否需要示例包初始化
   - 使用哪个模板资源
3. 模板资源可以保留 bundled example，但文案必须说明：
   - 这是示例模板，不是宿主默认世界

#### `runtime_scaffold.ts`

目标状态：

- 从命名与文案上把 `death_note` 定位为 bundled example template
- 后续允许替换为 generic scaffold template 或多模板选择

---

## 6.3 Layer C：模板与默认叙事去中心化

### C1. 引入“generic scaffold / bundled example”术语

文档与代码注释统一改用：

- generic scaffold
- bundled example pack
- reference pack template

避免继续使用：

- 默认 world pack
- 默认死亡笔记模板

### C2. 将示例模板与运行时首选世界解耦

目标：

- 允许仓库带一个参考模板
- 但不让 runtime 默认就等于该模板对应世界

实现语义上应区分：

1. **scaffold source**
2. **bootstrap target**
3. **active preferred pack**

三者不应再默认绑定为同一个 `death_note`。

---

## 7. 建议改动清单

## 7.1 文档文件

### 项目级文档（应修改）

- `docs/WORLD_PACK.md`
- `docs/LOGIC.md`
- 如有必要：`docs/ARCH.md` / `docs/INDEX.md`

### 包内文档（应修改/新增）

- `data/world_packs/death_note/README.md`
- `data/world_packs/death_note/CHANGELOG.md`
- `data/world_packs/death_note/DESIGN.md`（新增）

## 7.2 核心代码（列入后续治理）

- `apps/server/src/inference/providers/rule_based.ts`
- `apps/server/src/config/runtime_config.ts`
- `apps/server/src/init/runtime_scaffold.ts`

## 7.3 测试与命名（后续清理）

- 通用测试中不必要的 `death_note` 语义命名
- 使用 `world-example-pack` 等中性 fixture 的替代机会

---

## 8. 实施顺序建议

### Phase 1：文档先收口

先做：

1. 改 `docs/WORLD_PACK.md`
2. 改 `docs/LOGIC.md`
3. 新增 `data/world_packs/death_note/DESIGN.md`
4. 补 `death_note/README.md` 的定位声明

目标：

- 先把仓库叙事修正过来。

### Phase 2：建立代码治理清单并冻结新增特判

1. 标记 `rule_based.ts` 为 P0
2. 标记 `runtime_config.ts` / `runtime_scaffold.ts` 为 P1
3. 约束后续实现：
   - 不再接受新的 `death_note` 核心硬编码

### Phase 3：逐步去特判

1. 重构 `rule_based.ts`
2. 去除 runtime 默认世界绑定
3. 重写 scaffold 默认语义

---

## 9. 风险与缓解

## 风险 1：文档收口后，读者失去可参考实例

缓解：

- 不删除 `death_note` 示例
- 只是把它从正文中心移到“参考实例”位置
- 同时增强包内 `README/DESIGN`

## 风险 2：去掉核心特判后，现有行为回归

缓解：

- 先只出清单，不立即大改
- 先做文档与边界治理
- 代码去特判单独立计划

## 风险 3：模板去中心化影响现有开发习惯

缓解：

- 保留 bundled example template
- 只修改语义与默认关系，不强制一次性移除资源文件

---

## 10. 完成定义

满足以下条件时，可认为本轮“边界收口设计”达成：

1. 项目级文档不再以 `death_note` 作为规范中心叙事。
2. `death_note` 包内拥有完整的包专属说明文档承载位。
3. 核心代码中的 pack-specific 特判点形成明确治理清单。
4. 团队对以下原则达成一致：
   - 核心定义框架
   - 包定义内容
   - `death_note` 是参考包而不是宿主默认语义

---

## 11. 推荐后续动作

在本设计获确认后，建议下一步只做**文档层实施**，暂不立即改核心逻辑：

1. 修改 `docs/WORLD_PACK.md`
2. 修改 `docs/LOGIC.md`
3. 新增 `data/world_packs/death_note/DESIGN.md`
4. 调整 `death_note/README.md` 的定位表述

完成这一轮后，再单独启动一个“去除 death_note 核心特判”的实现计划。