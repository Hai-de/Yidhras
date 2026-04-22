<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/第二批通用测试与命名技术债审计.md","contentHash":"sha256:501e3fcf9fbc24651bd51302d07f70fc555108aea32c00a24e32c7553eba0034"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 复核 agent-overview、audit-workflow-lineage、workflow-replay 三个中优先级 e2e，明确归类为 generic、mixed 或 scenario  `#phase-e1-medium-e2e-classification`
- [x] 对确认属于 generic 的中优先级 e2e 显式迁移到 example_pack；对 mixed 文件执行拆分  `#phase-e1-medium-e2e-migration`
- [x] 完成中优先级 e2e 迁移/拆分后的逐文件与聚合回归，确认不再依赖 death_note 默认 seed/active 语义  `#phase-e1-medium-e2e-validation`
- [x] 记录保留的 death_note scenario fixture/capability/prompt/asset 清单，并同步验证结果、风险与剩余后续项  `#phase-e2-exception-ledger-and-closeout`
- [x] 扩展扫描 unit/context、memory、world_engine integration 剩余目录中的 world-death-note、death_note、sim.init('death_note') 固定值并分类  `#phase-e2-expanded-naming-debt-audit`
- [x] 将确认属于默认化命名债的剩余硬编码替换为中性测试 pack、fixture metadata 派生值或共享常量  `#phase-e2-expanded-naming-debt-remediation`
<!-- LIMCODE_TODO_LIST_END -->

# 第二批中优先级 e2e 与剩余命名债继续治理计划

## 来源设计

- 设计文档：`.limcode/design/第二批通用测试与命名技术债审计.md`
- 本计划承接已完成的第一轮治理：高优先级 generic e2e 已显式迁移、混合型 smoke/experimental 文件已拆边界、部分 unit/runtime 命名债已处理。
- 本轮目标是把设计里剩余的**两个方向**一起做完：
  1. 中优先级 e2e 的归类与迁移/拆分
  2. 剩余 unit/integration 默认化命名债的扩面治理

---

## 1. 目标

本轮不是重复做第一轮工作，而是清掉仍然悬而未决的两类尾项：

1. 把 `agent-overview`、`audit-workflow-lineage`、`workflow-replay` 三个中优先级 e2e 的语义归类做实。
2. 把剩余目录里仍然把 `death_note` / `world-death-note` 当默认宿主语义的测试继续去默认化。
3. 同时保留真正属于 `death_note` scenario coverage、capability、prompt preset、asset path 的合法命名，不做误伤性去名。

完成后应达到：

- 中优先级 e2e 不再停留在“看起来通用”的模糊状态。
- 能 generic 的测试显式切到 `example_pack`；不能 generic 的测试被明确标记为 mixed 或 scenario。
- 剩余命名债不再主要靠硬编码 `world-death-note` / `death_note` 撑住。
- death_note 的保留范围被记录清楚，后续不再反复误判。

---

## 2. 实施范围

### 2.1 中优先级 e2e

目标文件：

- `apps/server/tests/e2e/agent-overview.spec.ts`
- `apps/server/tests/e2e/audit-workflow-lineage.spec.ts`
- `apps/server/tests/e2e/workflow-replay.spec.ts`

### 2.2 扩面命名债治理目录

优先目录：

- `apps/server/tests/unit/context*`
- `apps/server/tests/unit/memory_*`
- `apps/server/tests/unit/runtime/**`
- `apps/server/tests/integration/world_engine_*`

### 2.3 明确排除范围

- 不改动 death_note 世界包业务内容本身。
- 不机械替换所有 `death_note` 文本。
- 不处理已经明确属于 scenario coverage 的 e2e：
  - `world_pack_projection_endpoints.spec.ts`
  - `trigger-event.spec.ts`
  - `plugin-runtime-startup-gap.spec.ts`
  - `plugin-runtime-web.spec.ts`
  - `experimental-projection-compat.spec.ts`
  - `smoke-death-note-scenario-endpoints.spec.ts`
- 不把 capability / prompt / asset 名称误当作默认化命名债。

---

## 3. 分阶段实施方案

## Phase E1：中优先级 e2e 归类、迁移与拆分

### 3.1 复核三个中优先级 e2e 的真实依赖

目标：

- 明确每个文件到底是 generic、mixed，还是 scenario。

复核标准：

1. 是否依赖默认 seed 中的实体布局或 actor id。
2. 是否依赖 `death_note` 世界状态、文本、projection 或特定 workflow 内容。
3. 是否只是在验证 operator / overview / lineage / replay 的框架合同。
4. 是否只是“借了 death_note 的现成数据”，而不真正依赖其语义。

每个文件必须产出结论：

- **generic**：可直接显式迁移到 `example_pack`
- **mixed**：需要拆分 generic 与 scenario 断言
- **scenario**：继续保留 `death_note`

验收标准：

- 三个文件都获得明确归类与处理策略。

### 3.2 对 generic / mixed 文件执行改造

目标：

- 不再让中优先级文件卡在审计结论层面，而是实际落地。

处理策略：

1. 若文件被判定为 **generic**：
   - 改为显式 `activePackRef: 'example_pack'`
   - 按需补 `seededPackRefs: ['example_pack']`
   - 重写任何依赖 `death_note` 默认 seed 的断言
2. 若文件被判定为 **mixed**：
   - 拆出 generic 文件与 scenario 文件
   - generic 部分切到 `example_pack`
   - scenario 部分显式保留 `death_note`
3. 若文件被判定为 **scenario**：
   - 不强行 generic 化
   - 补齐命名与 helper 参数，明确它是 scenario coverage

验收标准：

- 每个处理后的文件职责单一，helper 参数与断言语义一致。

### 3.3 完成中优先级 e2e 回归

目标：

- 确认中优先级治理后没有残留默认 active-pack 假设。

验证要求：

1. 逐文件运行被修改的中优先级 e2e。
2. 如发生失败，优先判断是：
   - 断言仍然依赖 `death_note` 内容
   - helper seeded/active 配置不匹配
   - 文件本质上应归为 scenario 而非 generic
3. 完成后对相关第二批 generic + split 文件做一轮聚合回归，避免新改造把前一轮结果打碎。

验收标准：

- 被迁移/拆分的中优先级 e2e 在新归类下稳定通过。

---

## Phase E2：剩余命名债扩面治理

### 3.4 建立剩余硬编码分类表

目标：

- 不盲目全局替换，而是先分类。

重点识别模式：

1. `available_world_packs: ['world-death-note']`
2. `pack_id: 'world-death-note'`
3. `sim.init('death_note')`
4. `pack_ref: 'death_note'`

分类结果必须分成：

- **默认化命名债**：应治理
- **scenario fixture**：保留
- **内容语义命名**：保留
- **暂缓项**：记录原因

验收标准：

- 至少覆盖优先目录中的剩余命名点，并有清晰分类依据。

### 3.5 治理确认属于默认化命名债的剩余项

目标：

- 把“明明是 generic 测试，却写死 death_note”的剩余点继续压缩。

优先治理策略：

1. 对数组结构/状态聚合类测试：
   - 用 fixture metadata 派生值替代 `world-death-note`
2. 对 pack-aware framework 行为测试：
   - 抽共享测试常量或中性测试 pack id
3. 对 world engine integration 中的 `sim.init('death_note')`：
   - 先判断是否真的依赖 death_note 内容结构
   - 若否，迁到 `example_pack` 或中性 fixture pack
   - 若是，明确标注为 scenario integration
4. 对只剩 route name / pack id 表达层硬编码的文件：
   - 统一为可读的共享常量，而不是散落字符串

验收标准：

- 一批剩余默认化命名债被实际替换，不只是做审计备注。

### 3.6 建立例外清单并同步收尾

目标：

- 给后续维护留边界，不再反复审同一个问题。

需要沉淀的结果：

1. 保留的 scenario fixture 文件/目录清单
2. 必须保留的 capability / prompt / asset 命名清单
3. 暂未治理项与原因
4. 已完成验证矩阵与可能的非阻塞问题

验收标准：

- 后续继续治理时，可直接基于该清单扩展，而不需要重新审题。

---

## 4. 验证要求

本轮至少完成以下验证：

1. **中优先级 e2e 验证**
   - 三个目标文件的归类结果可解释
   - 被修改的文件逐个回归通过
2. **扩面命名债验证**
   - unit / integration 中被治理的测试保持原语义通过
   - generic 测试不再依赖 `world-death-note` / `death_note` 作为默认宿主语义
3. **聚合验证**
   - 第二批已完成的 generic/split e2e 不被本轮破坏
4. **边界验证**
   - 合法 scenario fixture 与内容命名未被误伤

---

## 5. 风险与缓解

### 风险 1：中优先级 e2e 被误判为 generic

影响：

- 迁移后会出现隐蔽失败，或为了通过回归又偷偷把 `death_note` seed 回来。

缓解：

- 先归类再改造。
- 一旦发现依赖内容结构，立即转为 mixed 或 scenario。

### 风险 2：命名债扩面变成大面积 fixture 重写

影响：

- 回归成本暴涨，收益变差。

缓解：

- 优先处理最明确的默认化命名债。
- 对真正场景依赖保留例外清单。

### 风险 3：去名误伤合法 death_note 语义

影响：

- 破坏 reference/scenario coverage，降低测试解释性。

缓解：

- capability、prompt preset、asset path 一律先按内容语义审查。
- 不对 scenario 文件做机械全局替换。

### 风险 4：测试并发或 sqlite 锁问题干扰判断

影响：

- 容易把测试基础设施问题误判为 pack 命名/归类问题。

缓解：

- 对可疑失败做单文件复验。
- 区分语义失败与测试基础设施噪音。

---

## 6. 完成定义

本计划完成时应满足：

1. `agent-overview`、`audit-workflow-lineage`、`workflow-replay` 三个中优先级 e2e 已获得明确归类，并完成相应迁移/拆分/保留处理。
2. 被改造的中优先级 e2e 已通过回归，且不再依赖默认 `death_note` seed/active 语义。
3. 剩余优先目录中的一批默认化命名债已被替换为中性 pack id、共享常量或 fixture metadata 派生值。
4. 合法的 `death_note` scenario fixture、capability、prompt、asset 命名已被明确列入保留清单。
5. 后续剩余项、风险与验证结果已同步记录，可继续扩面执行。

---

## 7. 建议执行顺序

1. 先归类三个中优先级 e2e。
2. 处理能 generic 化或需拆分的文件。
3. 跑中优先级 e2e 回归。
4. 再扩面处理 unit/integration 剩余命名债。
5. 最后汇总例外项、验证结果与后续清单。

---

## 8. 执行备注

- 本计划创建后不直接修改代码。
- 等待确认后再实施。
- 如果用户确认“两个方案都做”，实施时不要拆成两个独立项目推进，而是按本计划统一收口。
