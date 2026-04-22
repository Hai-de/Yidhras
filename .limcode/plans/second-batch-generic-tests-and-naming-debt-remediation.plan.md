<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/第二批通用测试与命名技术债审计.md","contentHash":"sha256:501e3fcf9fbc24651bd51302d07f70fc555108aea32c00a24e32c7553eba0034"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 将第二批高优先级 generic e2e 显式迁移到 activePackRef: 'example_pack'，并按需补 seededPackRefs  `#phase-d1-generic-e2e-explicit-pack`
- [x] 完成第二批 generic e2e 的回归验证，确认不再依赖 death_note 默认 seed/active 语义  `#phase-d1-validation`
- [x] 拆分 smoke-endpoints、experimental-runtime、experimental-plugin-runtime-web 中的 generic 与 death_note scenario 混合职责  `#phase-d2-hybrid-e2e-split`
- [x] 汇总剩余例外项、风险与验证结果，形成后续可继续执行的收尾清单  `#phase-d3-closeout-and-doc-sync`
- [x] 清理 unit/integration 中属于默认化命名债的 world-death-note / death_note 固定值，并保留合法 scenario fixture 命名  `#phase-d3-naming-debt-audit-and-cleanup`
<!-- LIMCODE_TODO_LIST_END -->

# 第二批通用测试与命名技术债实施计划

## 来源设计

- 设计文档：`.limcode/design/第二批通用测试与命名技术债审计.md`
- 本计划严格依据该审计结论制定。
- 本计划承接第一批显式 active-pack 迁移的后续工作，目标是继续压缩测试体系中的 `death_note` 默认化依赖，但不误伤真正的 scenario coverage。

---

## 1. 目标

本轮实施的核心目标不是简单“去掉 death_note 文本”，而是让测试明确表达自己验证的是哪一类语义：

1. **generic framework/runtime/scheduler/operator 测试**：应显式使用通用 active pack，例如 `example_pack`。
2. **death_note scenario 测试**：应继续保留 `death_note`，但以显式 scenario 身份存在。
3. **fixture / 内容语义命名**：若只是场景能力、prompt preset、asset path 或 pack 内容标识，则不应被机械视为技术债。

完成后应达到：

- 第二批 generic e2e 不再依赖 helper 的兼容默认 pack 行为。
- 混合型 e2e 的 generic 断言与 scenario 断言职责分离。
- unit / integration 中真正属于“默认化命名债”的固定值被替换为 fixture metadata 派生或共享测试常量。
- `death_note` 继续作为 reference/scenario pack 被清晰保留，而不是被错误去名。

---

## 2. 实施范围

### 2.1 本轮纳入范围

#### Phase D1：第二批 generic e2e 显式化

高优先级目标文件：

- `apps/server/tests/e2e/smoke-startup.spec.ts`
- `apps/server/tests/e2e/overview-summary.spec.ts`
- `apps/server/tests/e2e/scheduler-runtime-status.spec.ts`
- `apps/server/tests/e2e/scheduler-queries.spec.ts`
- `apps/server/tests/e2e/access-policy-contracts.spec.ts`

中优先级复核对象：

- `apps/server/tests/e2e/agent-overview.spec.ts`
- `apps/server/tests/e2e/audit-workflow-lineage.spec.ts`
- `apps/server/tests/e2e/workflow-replay.spec.ts`

#### Phase D2：混合型 e2e 拆分

- `apps/server/tests/e2e/smoke-endpoints.spec.ts`
- `apps/server/tests/e2e/experimental-runtime.spec.ts`
- `apps/server/tests/e2e/experimental-plugin-runtime-web.spec.ts`

#### Phase D3：unit / integration 命名债治理

优先目录：

- `apps/server/tests/unit/runtime/**`
- `apps/server/tests/unit/context*`
- `apps/server/tests/unit/memory_*`
- `apps/server/tests/integration/world_engine_*`

### 2.2 本轮明确排除范围

- 不改动 `death_note` 世界包业务内容本身。
- 不把所有带有 `death_note` 文本的测试都强制改名。
- 不重构 runtime 核心启动语义，只调整测试表达与 fixture 绑定方式。
- 不把已明确属于 scenario coverage 的 e2e 重新拉回 generic 测试。

### 2.3 明确保留的 scenario e2e

以下文件应继续视为显式 `death_note` 场景覆盖，不纳入 generic 去默认化目标：

- `apps/server/tests/e2e/world_pack_projection_endpoints.spec.ts`
- `apps/server/tests/e2e/trigger-event.spec.ts`
- `apps/server/tests/e2e/plugin-runtime-startup-gap.spec.ts`
- `apps/server/tests/e2e/plugin-runtime-web.spec.ts`
- `apps/server/tests/e2e/experimental-projection-compat.spec.ts`
- `apps/server/tests/e2e/experimental-runtime.spec.ts` 中的 experimental runtime 场景分支

---

## 3. 分阶段实施方案

## Phase D1：第二批 generic e2e 显式 active-pack 迁移

### 3.1 建立第二批 generic e2e 的迁移基线

目标：

- 将“当前未显式声明 active pack，但断言本质是通用框架合同”的 e2e 转成显式 generic 模式。

实施要点：

1. 为目标 e2e 统一采用显式：
   - `activePackRef: 'example_pack'`
2. 如测试依赖已安装 pack 列表或 runtime 可见 pack 集合，则按需补：
   - `seededPackRefs: ['example_pack']`
3. 断言中若仅验证结构、状态码、聚合字段、scheduler diagnostics 等 generic 行为：
   - 去除对 `death_note` 默认 seed 的隐式依赖
   - 避免把 `world-death-note` 当作唯一可用 pack 写死
4. 若某个测试实际上依赖当前 seed 的实体布局、timeline 内容或特定 pack projection：
   - 立即从 D1 generic 清单移出
   - 记录到 D2 或保留为 scenario 测试

验收标准：

- 高优先级 5 个 generic e2e 已显式使用 `example_pack`。
- 这些测试不再通过 helper 兼容默认 `death_note` 才能运行。

### 3.2 按优先级逐个迁移高优先级 generic e2e

执行顺序：

1. `smoke-startup.spec.ts`
2. `overview-summary.spec.ts`
3. `scheduler-runtime-status.spec.ts`
4. `scheduler-queries.spec.ts`
5. `access-policy-contracts.spec.ts`

每个文件的统一改造策略：

1. 将 server 启动 helper 改为显式 generic pack 配置。
2. 复核断言：
   - 只保留 runtime、health、status、overview、scheduler、access-policy 等通用合同。
3. 删除或重写任何“因默认 active pack 为 death_note 才成立”的断言。
4. 若涉及 `available_world_packs`：
   - 断言结构、包含关系或与 seed 对齐的值
   - 不再默认写死 `world-death-note`

验收标准：

- 五个目标文件语义保持为 generic framework coverage。
- 每个文件都能清晰看出：测试的是框架，不是 `death_note` 包内容。

### 3.3 复核中优先级候选是否真正 generic

目标：

- 在不盲目改造的前提下，确认中优先级文件是否能进入下一轮 generic 显式化。

复核对象：

- `agent-overview.spec.ts`
- `audit-workflow-lineage.spec.ts`
- `workflow-replay.spec.ts`

复核准则：

1. 是否依赖默认 seed 中的实体布局、世界状态或 actor 身份。
2. 是否依赖 `death_note` 文本、投影结果、route 或 workflow 内容。
3. 是否只是验证 operator / replay / lineage 的通用合同。

输出结果应分成两类：

- 可直接列入下一轮 generic e2e 迁移
- 需要拆分或保留为 scenario / mixed coverage

验收标准：

- 三个中优先级文件都获得明确归类，不再停留在“感觉比较通用”的模糊状态。

---

## Phase D1 验证：generic e2e 回归与去默认化确认

### 3.4 建立 D1 回归矩阵

目标：

- 确认第二批 generic e2e 在显式 `example_pack` 模式下稳定通过。

建议验证：

1. 针对迁移后的 5 个高优先级文件逐个运行。
2. 如条件允许，再执行聚合回归，确认 helper 兼容模式未被误破坏。
3. 重点观察：
   - `runtime_ready`
   - `available_world_packs`
   - runtime speed / diagnostics
   - scheduler query filter / pagination / error handling
   - access-policy contract 输入校验

排障原则：

- 先排查测试是否仍残留默认 `death_note` 假设。
- 再排查 helper 的 seeded / active 配置是否与断言语义一致。
- 不用“额外把 death_note seed 回来”掩盖 generic 测试语义问题。

验收标准：

- D1 迁移后的 generic e2e 在显式 generic pack 模式下通过。
- 不依赖兼容默认 `['death_note']` 才能稳定运行。

---

## Phase D2：混合型 e2e 拆分

### 3.5 拆分同时承担 generic 与 scenario 职责的 e2e

目标：

- 避免一个测试文件同时验证通用框架行为与 `death_note` pack 场景行为。

优先拆分对象：

1. `smoke-endpoints.spec.ts`
2. `experimental-runtime.spec.ts`
3. `experimental-plugin-runtime-web.spec.ts`

拆分原则：

1. **generic 部分**：
   - 迁移到显式 `example_pack`
   - 仅覆盖与 pack 内容无关的 endpoint、feature flag、operator contract 或 runtime gate
2. **scenario 部分**：
   - 显式保留 `death_note`
   - 文件名、常量名、路由与断言都明确体现它是在验证 scenario pack 行为
3. **不要只做局部常量替换**：
   - 若职责本身混合，必须拆测试结构，而不是简单把某个字符串抽常量

针对各文件的重点：

- `smoke-endpoints.spec.ts`
  - 将通用 smoke endpoint 与 `/api/packs/world-death-note/projections/timeline` 的 pack projection 行为拆开。
- `experimental-runtime.spec.ts`
  - 将“feature 默认禁用”这类 generic operator 行为与“启用后显式 load death_note”场景行为拆开。
- `experimental-plugin-runtime-web.spec.ts`
  - 将 experimental runtime registry / operator API 合同与具体 `death_note` load 行为拆开，必要时保留后者为 scenario 测试。

验收标准：

- 每个拆分后的文件职责单一、命名清晰。
- generic 与 scenario 覆盖边界可从测试名和 helper 参数直接读出。

---

## Phase D3：unit / integration 默认化命名债治理

### 3.6 识别“应治理”与“不应误伤”的命名模式

应治理的模式：

1. `available_world_packs: ['world-death-note']`
2. `pack_id: 'world-death-note'`
3. `sim.init('death_note')`
4. `pack_ref: 'death_note'`

治理条件：

- 测试目的是 generic framework / pack-aware 行为验证
- 固定值只是默认化命名惯性，而非场景内容本身

不应误伤的模式：

1. `invoke.execute_death_note`、`invoke.claim_death_note`
2. `death_note_*_v1` prompt preset
3. `death_note.README.md` 等 asset path
4. 其他明确属于 pack 内容语义、capability 命名或场景 fixture 的标识

验收标准：

- 在进入代码改造前，先完成“哪些要改、哪些不能动”的分类基线。

### 3.7 用 fixture metadata / 共享常量 替代默认化硬编码

目标：

- 将 generic 测试中的 pack 标识改为可维护、可解释的测试数据来源。

建议动作：

1. 对仅验证数组结构或状态聚合的测试：
   - 从 fixture metadata 派生可用 pack id / pack route name
2. 对 pack-aware framework 行为测试：
   - 引入共享测试常量或统一 fixture builder
3. 对 world-engine integration 中的 `sim.init('death_note')`：
   - 先判断是否真依赖 `death_note` 内容结构
   - 若否，迁到 `example_pack` 或更中性的 fixture pack
   - 若是，则显式标注为 scenario integration

验收标准：

- 被治理的测试不再把 `death_note` 当作默认宿主语义的一部分。
- fixture 来源更清晰，后续替换 pack 时不需要全局搜硬编码。

### 3.8 为例外项建立保留清单

目标：

- 防止后续继续去名时再次误删合法 scenario 语义。

建议输出：

1. 保留为 scenario fixture 的目录/文件清单
2. 必须保留 `death_note` 命名的 capability / prompt / asset 清单
3. 对无法立即治理的混合项给出原因与后续动作

验收标准：

- 后续维护者能快速判断某个 `death_note` 命名是债务还是合法场景表达。

---

## 4. 验证要求

本轮至少完成以下验证：

1. **D1 generic e2e 验证**
   - 高优先级 5 个文件逐个回归
   - 确认显式 `example_pack` 配置下通过
2. **D2 拆分后验证**
   - generic 子测试与 scenario 子测试分别通过
   - 文件职责与命名边界清晰
3. **D3 命名债验证**
   - unit / integration 改造后不破坏原有语义
   - generic 测试不再依赖 `world-death-note` 固定值
   - scenario fixture 命名未被误伤
4. **全局一致性验证**
   - helper 的 active/seeded pack 语义与测试断言一致
   - 无新增“表面通用、实则依赖 death_note 内容”的隐式假设

---

## 5. 风险与缓解

### 风险 1：把 scenario fixture 误治理成 generic 常量

影响：

- 破坏 `death_note` reference pack 覆盖面。

缓解：

- 先按审计结论区分 generic / mixed / scenario。
- 任何 capability、prompt preset、asset path 命名都先判断是否属于内容语义。

### 风险 2：generic 测试继续停留在兼容默认模式

影响：

- 后续移除 `DEFAULT_SEEDED_PACK_REFS = ['death_note']` 成本继续升高。

缓解：

- D1 迁移必须以显式 `example_pack` 为完成标准。
- 不接受“为了通过测试再顺手 seed 一个 death_note”式回退。

### 风险 3：混合型文件只抽常量不拆职责

影响：

- 后续维护者仍无法判断失败是 generic runtime 问题还是 scenario pack 问题。

缓解：

- D2 必须以职责拆分为主，不以简单字符串替换冒充完成。

### 风险 4：unit / integration 治理范围过大导致回归面失控

影响：

- 命名债清理扩散为大范围 fixture 重写。

缓解：

- 先聚焦优先目录。
- 优先处理“明显是默认化命名债”的固定值。
- 对真实场景依赖保留例外清单。

---

## 6. 完成定义

本计划完成时应满足：

1. 第二批高优先级 generic e2e 已显式使用 `activePackRef: 'example_pack'`。
2. 这些 generic e2e 已通过回归，且不依赖默认 `death_note` seed/active 行为。
3. 三个混合型 e2e 已完成职责拆分，generic 与 scenario 覆盖边界清晰。
4. unit / integration 中一批明确属于默认化命名债的硬编码已被 fixture metadata、共享常量或更中性的 pack fixture 替代。
5. 合法的 `death_note` scenario fixture、capability、prompt preset、asset 命名已被明确保留，不再被误判为技术债。
6. 剩余例外项、风险与后续清单已被记录，便于继续执行下一轮治理。

---

## 7. 建议执行顺序

1. 先完成 D1 的 5 个高优先级 generic e2e 显式化。
2. 对 D1 做逐文件与聚合回归，确认 generic 去默认化成立。
3. 再处理 D2 的 3 个混合型 e2e 拆分。
4. 最后进入 D3，治理 unit / integration 的默认化命名债并沉淀例外清单。
5. 收尾同步剩余风险、验证结果与下一轮候选文件归类。

---

## 8. 执行备注

- 本计划创建后不直接修改代码。
- 等待用户确认并执行该计划后，再进入具体实施。
- 若实施过程中发现某个目标文件实际依赖 `death_note` 内容结构，应优先调整归类，而不是强行维持 generic 目标。
