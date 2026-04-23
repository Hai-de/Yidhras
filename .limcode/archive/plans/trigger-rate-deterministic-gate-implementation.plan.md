<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/trigger-rate-deterministic-gate-design.md","contentHash":"sha256:4541d97415bf9abc31d36628d06cce2ad97c0d93baf769f139f2a7432d53c497"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 冻结 TS/Rust 共用的 trigger_rate deterministic sampling contract：canonical seed、FNV-1a 64-bit、sample 映射与 fresh-match only 适用规则  `#tr-plan-p1`
- [x] 升级 TS/Rust 类型与 diagnostics contract：用真实 trigger_rate gate decision evidence 替代 ignored_features.trigger_rate_* 语义  `#tr-plan-p2`
- [x] 在 TS trigger engine 中落地 trigger_rate 概率门，并补 delayed due 不重抽样、reason 分层与快速路径  `#tr-plan-p3`
- [x] 在 Rust memory trigger sidecar 中落地相同 gate 语义，保证 records/diagnostics/reason 与 TS 一致  `#tr-plan-p4`
- [x] 同步 provider、context source、source registry 与上游消费面，移除 trigger_rate_ignored_count 等旧解释层  `#tr-plan-p5`
- [x] 补齐 unit/parity/context tests，覆盖 trigger_rate=0/1/0.5、trigger_rate_blocked、delayed due 不重抽样与 TS/Rust 一致性  `#tr-plan-p6`
- [x] 更新 ARCH、rust-migration review/progress 等文档口径，移除 trigger_rate“已知缺口”描述  `#tr-plan-p7`
<!-- LIMCODE_TODO_LIST_END -->

# Trigger Rate Deterministic Gate 实施计划

## 来源设计

- 源设计文档：`.limcode/design/trigger-rate-deterministic-gate-design.md`
- 本计划严格按该设计执行，不再重新讨论：
  - `trigger_rate` 采用**概率门**，不是分数缩放；
  - 采样必须**严格可重放**；
  - gate 只作用于 **fresh match**；
  - delayed due **不重新抽样**。

---

## 目标

把当前仅作为 ignored diagnostics 存在的 `trigger_rate`，正式实现为：

> **新触发机会的 deterministic admission gate**

并完成以下收口：

1. TS 与 Rust 的 gate 判定一致；
2. `ignored_features.trigger_rate_*` 旧语义退出，改为真实 decision diagnostics；
3. delay / cooldown / retain 状态机不被破坏；
4. parity / unit / context source 测试覆盖新的语义；
5. 文档中不再把 `trigger_rate` 描述为已知未实现缺口。

---

## 范围

### 纳入本次实施

- TS 与 Rust 共用的 deterministic sampling contract
- TS trigger engine 正式接入 `trigger_rate`
- Rust sidecar engine/source 正式接入 `trigger_rate`
- diagnostics / reason 升级
- context source / provider / parity / unit tests 更新
- `docs/ARCH.md`、`.limcode/review/rust-migration-compatibility-debt-assessment.md`、必要的 progress 同步

### 不纳入本次实施

- 更复杂的 rate policy（滑窗、动态衰减、环境自适应概率等）
- fallback/shadow 模式退休
- memory trigger engine 之外的其它 memory/runtime 语义重构
- 公共 HTTP 顶层 contract 扩张

---

## 实施分解

## Phase 1：冻结 TS/Rust 共用 sampling contract

### 目标

先冻结 deterministic gate 的输入、hash 算法和 sample 映射，避免 TS / Rust 各自实现后再返工对齐。

### 实施内容

1. 明确 canonical seed string：
   - `memory_trigger_rate_gate::<pack_id>::<memory_id>::<current_tick>::<previous_trigger_count>`
2. 明确 `previous_trigger_count` 取值：
   - 当前 runtime state 的 `trigger_count`
   - 无 state 时为 `0`
3. 明确 hash 算法：
   - 手写 `FNV-1a 64-bit`
4. 明确 sample 映射：
   - `sample = hash / 2^64`
5. 明确边界规则：
   - `trigger_rate <= 0` -> 必定拒绝
   - `trigger_rate >= 1` -> 必定通过

### 触达文件

- `apps/server/src/memory/blocks/trigger_engine.ts`
- `apps/server/rust/memory_trigger_sidecar/src/engine.rs`
- 如有必要新增 helper 文件：
  - TS: `apps/server/src/memory/blocks/trigger_rate_gate.ts`
  - Rust: `apps/server/rust/memory_trigger_sidecar/src/sampling.rs`

### 验收标准

- TS/Rust 都采用同一 seed 规则与 FNV-1a 64-bit
- sample 边界行为一致

---

## Phase 2：升级类型与 diagnostics contract

### 目标

把 `trigger_rate` 从“ignored feature”语义切换为“真实 gate decision evidence”。

### 实施内容

1. TS 类型替换：
   - 移除/替换 `MemoryTriggerIgnoredFeaturesRecord`
   - 移除/替换 `MemoryTriggerIgnoredFeaturesSummary`
   - 引入 `MemoryTriggerRateDecisionRecord`
   - 引入 `MemoryTriggerRateDecisionSummary`
2. Rust DTO 同步：
   - `models.rs` 对齐 TS 新结构
3. 升级 reason：
   - `no_trigger_match`
   - `below_min_score`
   - `trigger_rate_blocked`
4. source diagnostics 新增：
   - `present_count`
   - `applied_count`
   - `blocked_count`
5. 记录级 evidence 新增：
   - `present`
   - `value`
   - `applied`
   - `sample`
   - `passed`

### 触达文件

- `apps/server/src/memory/blocks/types.ts`
- `apps/server/rust/memory_trigger_sidecar/src/models.rs`
- `apps/server/src/context/sources/memory_blocks.ts`
- `apps/server/src/context/source_registry.ts`

### 验收标准

- 旧 `trigger_rate_ignored*` 不再作为主输出语义
- TS / Rust transport 结构一致

---

## Phase 3：在 TS trigger engine 中落地 gate 语义

### 目标

先完成 TS 主实现，明确 fresh match / delayed due / retained / cooling 的状态机行为。

### 实施内容

1. 在 `evaluateMemoryBlockActivation(...)` 中拆出：
   - `base_match`
   - `score_passed`
   - `is_fresh_trigger_attempt`
   - `trigger_rate_decision`
   - `final_match`
2. 在 `resolveStatus(...)` 中补 delayed due 分支：
   - 已通过 gate 且 delay 到期时直接进 `active`
   - 不重新抽样
3. 统一输出 reason：
   - 没有 trigger 命中 -> `no_trigger_match`
   - 分数不够 -> `below_min_score`
   - 被 gate 拦住 -> `trigger_rate_blocked`
4. 确保 `trigger_rate = 1/0` 有快速路径，减少不必要的 sample 计算。

### 触达文件

- `apps/server/src/memory/blocks/trigger_engine.ts`
- 如拆 helper，则包含新 helper 文件

### 验收标准

- TS 实现符合设计定义
- delayed due 不重新抽样
- `trigger_rate` 真正影响 active/delayed 入口

---

## Phase 4：在 Rust sidecar 中落地相同语义

### 目标

让 Rust sidecar 与 TS 完全对齐，避免 `rust_shadow` / parity diff 漂移。

### 实施内容

1. Rust 中实现相同 FNV-1a 64-bit sampling helper
2. 在 `evaluate_memory_block_activation(...)` 中复制 TS 语义：
   - fresh match 才抽样
   - delayed due 不重抽
   - reason 对齐
3. 在 `source.rs` 中用新 diagnostics 汇总替代 ignored summary
4. 保持 `protocol_version` 与现有 transport contract 稳定

### 触达文件

- `apps/server/rust/memory_trigger_sidecar/src/engine.rs`
- `apps/server/rust/memory_trigger_sidecar/src/source.rs`
- `apps/server/rust/memory_trigger_sidecar/src/models.rs`
- 如新增 helper：`apps/server/rust/memory_trigger_sidecar/src/sampling.rs`

### 验收标准

- Rust 输出与 TS 对齐
- 不再输出 `trigger_rate_ignored: true`

---

## Phase 5：更新 provider / context source / read model 接口

### 目标

让上游消费方不再继续用“ignored count”理解 trigger_rate，而是读取真实 gate 结果。

### 实施内容

1. `provider.ts`：
   - 去除旧 `ignored_features` 硬编码
   - 返回新的 diagnostics 结构
2. `context/sources/memory_blocks.ts`：
   - 停止输出 `trigger_rate_ignored_count`
   - 改为输出新的 summary 结构，或至少输出 `trigger_rate_blocked_count` / `trigger_rate_applied_count`
3. `context/source_registry.ts`：
   - 同步新的 summary contract
   - 避免 operator/read model 仍展示“ignored”

### 触达文件

- `apps/server/src/memory/blocks/provider.ts`
- `apps/server/src/context/sources/memory_blocks.ts`
- `apps/server/src/context/source_registry.ts`

### 验收标准

- 上游上下文组装面不再以 ignored 语义暴露 trigger_rate
- diagnostics 能解释“为什么这次没触发”

---

## Phase 6：测试矩阵与 parity 验证

### 目标

用测试保护 `trigger_rate` 语义，避免 TS/Rust 漂移。

### 需要补/改的测试

#### TS unit

- `apps/server/tests/unit/memory_block_trigger_engine.spec.ts`
  - `trigger_rate = 1` -> 必定通过
  - `trigger_rate = 0` -> 必定拒绝
  - `trigger_rate = 0.5` -> deterministic sample 稳定
  - `trigger_rate_blocked` reason 正确
  - delayed due 不重抽

- `apps/server/tests/unit/memory_trigger_engine_provider.spec.ts`
  - 更新旧 `ignored_features` 断言
  - 改为新 gate diagnostics 断言

- `apps/server/tests/unit/context_memory_blocks_source_rust_modes.spec.ts`
  - 不再断言 `trigger_rate_ignored_count`
  - 改断言新的 summary 字段

#### Rust unit

- `apps/server/rust/memory_trigger_sidecar/src/engine.rs`
- `apps/server/rust/memory_trigger_sidecar/src/trigger.rs`
- 若新增 sampling helper，则补 helper unit tests

#### Parity

- `apps/server/tests/unit/memory_trigger_sidecar_parity.spec.ts`
  - 增加 `trigger_rate < 1` 的 parity case
  - 断言 records / diagnostics / reason 全量一致

### 验收标准

- TS unit / Rust unit / parity 全部通过
- 不再出现因 trigger_rate 引发的 shadow diff 漂移

---

## Phase 7：文档与过程资产同步

### 目标

让仓库事实源反映 trigger_rate 已正式落地，而不是继续保留“已知缺口”描述。

### 实施内容

1. 更新 `docs/ARCH.md`
   - Memory trigger 行的“`trigger_rate` 尚属 Rust 已知缺口”改为已支持 deterministic gate 的现实表述
2. 更新 `.limcode/review/rust-migration-compatibility-debt-assessment.md`
   - 去掉 `trigger_rate` 未实现结论
3. 视实施情况更新 `.limcode/progress.md`
   - 记录 trigger_rate 从 ignored feature 到正式 gate 的收口

### 验收标准

- 稳定文档与评审不再把 trigger_rate 写成未实现
- progress 与真实代码状态一致

---

## 风险与注意事项

1. **TS / Rust sample 规则不一致**
   - 风险：parity 全面漂移
   - 控制：先冻结 canonical seed + FNV-1a 合同，再编码
2. **delay 状态机被误改**
   - 风险：已获准 delayed 的 memory 到期后再次被 gate 拦住
   - 控制：专门补 delayed due 测试
3. **diagnostics 改完后上游消费断裂**
   - 风险：context source / registry / tests 全面失配
   - 控制：Phase 2 完成后立即同步 provider / source / registry
4. **范围膨胀到 memory 引擎整体重构**
   - 风险：计划失焦
   - 控制：只围绕 trigger_rate、reason、diagnostics 和状态机必要分支实施

---

## 里程碑建议

### M1：sampling contract 冻结
- TS/Rust seed/hash/sample 规则固定

### M2：TS/Rust 语义落地
- trigger_rate 在 TS / Rust 中正式生效

### M3：diagnostics 与消费面收口
- provider / context source / registry 不再输出 ignored 语义

### M4：测试与文档关闭
- parity / unit 通过
- ARCH / review / progress 同步完成

---

## 完成判据

本计划执行完成后，应满足：

1. `trigger_rate` 在 TS 与 Rust 中都真实生效；
2. 判定语义为概率门，而不是分数缩放；
3. 采样严格可重放；
4. delayed due 不重新抽样；
5. `ignored_features.trigger_rate_*` 旧语义退出；
6. parity / unit / context source 测试全部收口；
7. 文档不再把 `trigger_rate` 描述为已知缺口。
