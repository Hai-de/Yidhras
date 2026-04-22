<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/world-pack-boundary-convergence-and-death-note-doc-migration-design.md","contentHash":"sha256:87dedf2624250e6f171559b3391a7c201513a201080e43ce30ca69ccf2ee8792"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 清理项目逻辑文档中的 death_note 专属叙事并改为通用机制表述  `#phase-1-logic-doc-cleanup`
- [x] 在 death_note 包目录内补齐 DESIGN/README/CHANGELOG 的职责分工与说明  `#phase-1-pack-docs-consolidation`
- [x] 重写项目级 world-pack 文档叙事中心，去除 death_note 规范中心化表达  `#phase-1-project-doc-recenter`
- [x] 形成 death_note 核心特判与默认绑定点的分级治理清单  `#phase-2-boundary-audit`
- [x] 校验文档边界一致性并确认不引入新的包级特判叙事  `#validation-and-crosscheck`
<!-- LIMCODE_TODO_LIST_END -->

# World-Pack 边界收口与 Death Note 文档迁移实施计划

## 来源设计

- 设计文档：`.limcode/design/world-pack-boundary-convergence-and-death-note-doc-migration-design.md`
- 本计划严格以该设计为依据。
- 本轮实施范围限定为：**文档层收口 + 边界治理清单整理**。
- 本轮明确不直接执行：`rule_based.ts` 去特判重构、`runtime_config.ts` 默认值重构、`runtime_scaffold.ts` 模板机制重构。

---

## 1. 目标

把仓库当前围绕 `death_note` 的叙事中心重新拉回到“宿主定义框架、世界包定义内容”的正确边界上，并把属于 `death_note` 包本身的说明尽量迁回包目录内部承载。

完成后应达到：

1. 项目级文档不再把 `death_note` 当作 world-pack 规范中心。
2. `death_note` 包目录内具备完整的包专属说明承载位。
3. 核心代码中的 `death_note` 特判与默认绑定形成明确治理清单。
4. 后续进入代码治理阶段时，可以在不重复讨论文档边界的前提下推进实现。

---

## 2. 实施范围

## 本轮纳入范围

- `docs/WORLD_PACK.md`
- `docs/LOGIC.md`
- `data/world_packs/death_note/README.md`
- `data/world_packs/death_note/CHANGELOG.md`
- 新增：`data/world_packs/death_note/DESIGN.md`
- 形成针对以下核心文件的治理清单与后续建议：
  - `apps/server/src/inference/providers/rule_based.ts`
  - `apps/server/src/config/runtime_config.ts`
  - `apps/server/src/init/runtime_scaffold.ts`

## 本轮排除范围

- 不直接修改 `rule_based.ts` 的行为逻辑
- 不直接修改 runtime 默认 pack 绑定逻辑
- 不批量重命名测试中的 `death_note` fixture
- 不继续扩展 `death_note` 世界包 contract
- 不处理 presentation / UI / 插件可视化议题

---

## 3. 分阶段任务

## Phase 1：项目级文档去中心化

### 3.1 重写 `docs/WORLD_PACK.md`

目标：

- 让 `WORLD_PACK.md` 回到通用 contract 文档定位。

具体动作：

1. 将正文中的主示例元数据改为中性示例：
   - 例如 `world-example-pack` / `example_world`
   - 避免继续默认使用 `world-death-note`
2. 将模板资源说明从“death_note 模板”改写为：
   - bundled example template
   - reference pack template
   - generic scaffold / example pack 的区分
3. 保留 `death_note` 的引用，但只放在：
   - 示例实现
   - 参考实例
   - 附录或案例说明
4. 在文档显著位置加入边界声明：
   - 核心定义框架
   - 包定义语义与内容
   - 具体世界包不应被宿主核心特殊对待

验收标准：

- 阅读 `WORLD_PACK.md` 时，不会再产生“death_note 就是标准 pack”的误解。
- `death_note` 仍可作为示例存在，但不再占据规范主叙事。

### 3.2 清理 `docs/LOGIC.md`

目标：

- 去掉项目逻辑文档中的 pack-specific 当前态结论。

具体动作：

1. 找出 `world-death-note` 当前语义闭环之类的描述。
2. 改写为通用逻辑表达：
   - “某类 world-pack 可以形成如下闭环”
   - 或仅描述宿主支持的通用机制
3. 如确需保留案例，则改为引用包内文档，而不是在 `LOGIC.md` 正文展开。

验收标准：

- `LOGIC.md` 不再承担某个具体包的世界说明职责。

---

## Phase 2：death_note 包内文档补齐与职责重分配

### 3.3 新增 `data/world_packs/death_note/DESIGN.md`

目标：

- 把 `death_note` 的设计动机、结构说明、语义取舍收口到包内。

建议内容结构：

1. 包定位
   - 参考包 / 框架验证样例
   - 非宿主默认世界
2. 世界主题与核心张力
3. 语义动作链
   - reflection
   - dossier
   - plan
   - postmortem
4. AI / memory 设计
5. domains / institutions 的建模意图
6. storage collections 的语义用途
7. 与宿主核心的边界关系

验收标准：

- 设计原因和包语义不再需要依赖项目级文档来理解。

### 3.4 调整 `README.md` 与 `CHANGELOG.md`

目标：

- 把包内文档分工明确化。

具体动作：

1. `README.md`：
   - 明确标注该包是参考 world-pack
   - 描述“是什么、包含什么、适合用来做什么”
2. `CHANGELOG.md`：
   - 保持版本演化记录
   - 不承担大篇幅设计解释
3. 通过 `README.md` 链接到 `DESIGN.md`
   - 避免重复拷贝大量设计内容

验收标准：

- 包目录本身就能解释该包的定位、结构与演进。

---

## Phase 3：形成边界治理清单

### 3.5 建立核心代码治理清单

目标：

- 不立即改核心逻辑，但明确列出后续去特判实施对象。

具体动作：

1. 标记 P0：
   - `apps/server/src/inference/providers/rule_based.ts`
2. 标记 P1：
   - `apps/server/src/config/runtime_config.ts`
   - `apps/server/src/init/runtime_scaffold.ts`
3. 为每个文件补充：
   - 当前问题
   - 为什么越界
   - 后续应朝什么方向改
4. 将清单沉淀到适当文档中：
   - 可写入包内 `DESIGN.md` 的边界说明节
   - 或项目级 review / plan 补充说明

验收标准：

- 团队能够明确区分：
  - 哪些是本轮只改文档
  - 哪些是下一轮必须进入代码治理的内容

---

## 4. 验证要求

本轮不依赖复杂运行时测试，但需要完成以下验证：

1. 文档一致性检查
   - `docs/` 与 `data/world_packs/death_note/` 中表述不互相冲突
2. 边界声明检查
   - 项目级文档是否回到通用框架视角
   - 包内文档是否承接 pack-specific 内容
3. 交叉引用检查
   - `README.md`、`DESIGN.md`、`CHANGELOG.md` 的链接与职责分工是否清晰
4. 如修改到代码注释或配置文案，确保不引入 lint / typecheck 无关问题

---

## 5. 风险与缓解

## 风险 1：去中心化后文档失去具体性

缓解：

- 不删 `death_note` 示例
- 只是将其从主叙事移到参考实例位置
- 同时增强包内文档可读性

## 风险 2：包内文档与项目级文档重复

缓解：

- 项目级文档只讲框架
- 包内文档只讲 pack-specific 设计与语义
- 使用链接代替重复复制

## 风险 3：边界治理清单写了但未落实

缓解：

- 本计划把“形成治理清单”本身作为交付物
- 下一轮单独立计划推进代码去特判

---

## 6. 完成定义

本计划完成时应满足：

1. `docs/WORLD_PACK.md` 已去除 death_note 规范中心化叙事。
2. `docs/LOGIC.md` 已移除或改写 death_note 当前态专属表述。
3. `data/world_packs/death_note/DESIGN.md` 已建立并承接包专属设计说明。
4. `death_note/README.md` 已明确该包的参考定位与边界。
5. 核心代码中的 `death_note` 特判/默认绑定已形成明确分级治理清单。

---

## 7. 建议执行顺序

1. 改 `docs/WORLD_PACK.md`
2. 改 `docs/LOGIC.md`
3. 新增 `data/world_packs/death_note/DESIGN.md`
4. 调整 `data/world_packs/death_note/README.md`
5. 视需要微调 `CHANGELOG.md`
6. 汇总 P0 / P1 边界治理清单
7. 做文档交叉检查并收尾

---

## 8. 执行备注

- 本计划创建后不直接实施代码修改。
- 等待用户确认并执行该计划后，再进入文档与边界治理实施阶段。
