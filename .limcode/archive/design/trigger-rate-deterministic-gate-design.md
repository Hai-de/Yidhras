# Trigger Rate Deterministic Gate 设计

## 1. 背景

当前 memory trigger engine 的 `trigger_rate` 字段已经进入：

- TS 类型与行为模型：`apps/server/src/memory/blocks/types.ts`
- TS trigger engine：`apps/server/src/memory/blocks/trigger_engine.ts`
- Rust DTO：`apps/server/rust/memory_trigger_sidecar/src/models.rs`
- Rust engine/source：`apps/server/rust/memory_trigger_sidecar/src/engine.rs` / `source.rs`
- 相关单测 / parity 测试

但当前实现并未真正消费该字段，而是把它当作**已知未实现特性**：

- 发现 `trigger_rate != 1`
- 记录 `trigger_rate_present`
- 输出 `trigger_rate_ignored: true`
- 在 diagnostics 中累计 `trigger_rate_present_count`

因此，当前 `trigger_rate` 属于：

> **字段已存在、行为未生效、且缺口被显式标注的真实功能缺口**。

用户已明确给出本轮设计决策：

1. **使用概率门**
2. **严格可重放**
3. 其余设计细节由本设计补齐

---

## 2. 目标

为 memory trigger engine 的 `trigger_rate` 正式赋予可执行语义，并满足以下要求：

1. `trigger_rate` 不再只是 ignored diagnostics，而真正参与激活决策；
2. TS 与 Rust 结果一致；
3. 同一输入在 replay / parity / retry / test 中保持**严格可重放**；
4. 不破坏当前 delay / cooldown / retain 的整体状态机；
5. diagnostics 从“ignored”升级为“真实 gate decision evidence”。

---

## 3. 非目标

本轮不做以下内容：

1. 不改变 memory trigger 的核心 mode 定义（`always` / `keyword` / `logic` / `hybrid`）；
2. 不改 `min_score` 的基本语义；
3. 不引入真正的随机源，不做 runtime non-deterministic sampling；
4. 不扩展 memory trigger 到更复杂的 rate policy（如滑窗 rate limit、多次命中衰减、动态贝叶斯概率）；
5. 不顺手清理所有 fallback / shadow 模式，只处理 `trigger_rate` 本身。

---

## 4. 设计结论

## 4.1 `trigger_rate` 语义

`trigger_rate` 被定义为：

> **新触发机会的准入概率门（admission probability gate）**

也就是说：

- `trigger_rate = 1`：所有满足基础触发条件的候选都准入；
- `trigger_rate = 0`：所有新触发候选都被门控拒绝；
- `0 < trigger_rate < 1`：只有一部分满足基础触发条件的候选会被准入。

这里的“基础触发条件”是：

1. 至少有一个 trigger match；
2. `activation_score >= min_score`。

`trigger_rate` **不是分数缩放器**，而是**在基础触发命中后再应用的概率门**。

---

## 4.2 为什么不用“分数乘权重”

不采用：

- `activation_score *= trigger_rate`

原因：

1. 字段名是 `trigger_rate`，直觉更像“触发通过率”，而不是“分数衰减系数”；
2. 当前 pack/test 中经常出现：
   - `min_score = 3`
   - 三个 trigger 各 1 分
   - `trigger_rate = 0.5`
   如果做分数缩放，就会直接变成 1.5，语义非常反直觉；
3. 使用概率门更容易向作者解释，也更符合“不是每次都触发”的产品语义。

---

## 4.3 严格可重放要求

`trigger_rate` 的判定**不能依赖随机源**，必须通过稳定、确定性的 pseudo-random gate 实现。

即：

- 不能使用 `Math.random()`
- 不能使用 Rust `rand::thread_rng()`
- 不能依赖进程内状态、时间戳、调用顺序漂移

而应：

> 通过固定输入 -> 固定 hash -> 固定 `[0, 1)` sample -> 与 `trigger_rate` 比较

从而保证：

- replay 不漂移
- parity 测试不漂移
- 同一 tick 重算不漂移
- Rust / TS 对同一输入得出同一结果

---

## 5. Gate 适用时机

## 5.1 只对 fresh match 应用

`trigger_rate` 只在**新触发机会**上应用，不在所有状态重算时重复抽样。

### fresh match 定义

满足以下条件：

1. 当前至少有 trigger match；
2. `activation_score >= min_score`；
3. 当前 runtime state 不处于一个“已获准但尚未兑现”的 delayed pipeline 中。

即：

- 可以理解为“这次是否允许进入 trigger lifecycle”。

---

## 5.2 delayed due 不重新抽样

如果一个 memory 在前一轮已经通过 gate，并进入 delayed：

- 当 `delayed_until_tick <= now` 时
- 不应重新应用 `trigger_rate`
- 应直接进入 `active`

原因：

1. delayed 是已获准 trigger 的兑现阶段；
2. 如果在兑现时重新抽样，会导致“已准入 -> 到期却又被拒绝”的反直觉行为；
3. 会破坏 replay 与状态机可解释性。

---

## 5.3 retained / cooling 继续沿用当前优先级

当前状态优先级：

1. cooling
2. delayed
3. retained
4. inactive / active

本轮不重写整体状态机，只把 `trigger_rate` 插入到“fresh match 是否准入”的判定层。

---

## 6. Deterministic Sampling 设计

## 6.1 输入材料

为了保证**同一触发机会**有稳定 sample，建议采样输入由以下字段拼接得到：

- `pack_id`
- `memory_id`
- `current_tick`
- `previous_trigger_count`

其中：

- `current_tick` 区分不同轮次的机会；
- `previous_trigger_count` 区分同一 memory 后续多次成功触发后的新机会；
- `memory_id` / `pack_id` 提供对象作用域稳定性。

推荐 canonical seed string：

```text
memory_trigger_rate_gate::<pack_id>::<memory_id>::<current_tick>::<previous_trigger_count>
```

其中 `previous_trigger_count` 取当前 `RuntimeState.trigger_count`（若无 state 则为 `0`）。

---

## 6.2 Hash 算法

必须选择：

- TS / Rust 都容易手写
- 平台无关
- 结果稳定
- 不依赖语言 runtime hash

推荐：

> **FNV-1a 64-bit**

理由：

1. 实现简单；
2. 性能足够；
3. TS / Rust 手写一致成本低；
4. 不需要额外依赖。

---

## 6.3 Sample 映射

流程：

1. 对 canonical seed string 做 FNV-1a 64-bit；
2. 得到 `u64` / bigint；
3. 将其映射到 `[0, 1)`：

```text
sample = hash / 2^64
```

TS 中使用 `bigint` 运算，Rust 中使用 `u64` / `f64`。

判定规则：

```text
passed = sample < trigger_rate
```

边界：

- `trigger_rate <= 0` -> 必定不通过
- `trigger_rate >= 1` -> 必定通过

---

## 7. 激活决策新流程

当前逻辑大致是：

1. 计算 matched triggers
2. 计算 activation score
3. 与 min_score 比较
4. 直接进入 resolveStatus

改造后流程：

1. 计算 `matched_triggers`
2. 计算 `activation_score`
3. 计算 `base_match = matched_triggers.length > 0`
4. 计算 `score_passed = activation_score >= min_score`
5. 计算 `is_fresh_trigger_attempt`
6. 若 `is_fresh_trigger_attempt`：
   - 对 `trigger_rate` 应用 deterministic gate
7. 计算 `final_match`
8. 将 `final_match` 送入 `resolveStatus`

### 注意

对于“delay due”情形，需要在 `resolveStatus` 之前明确识别：

- 如果 `previous_state.delayed_until_tick <= now`
- 且本次不是新 trigger attempt
- 则视为可进入 `active`

这部分建议在 TS / Rust 的 `resolveStatus` 中显式加分支，而不是仅依赖旧逻辑的 `state.delayed_until_tick.is_none()` 判断。

---

## 8. Diagnostics 升级

当前 diagnostics 是：

- `trigger_rate_present`
- `trigger_rate_ignored`
- `trigger_rate_present_count`
- `trigger_rate_ignored: true`

这些字段在正式实现后不再准确。

## 8.1 记录级 diagnostics

建议将每条 record 的 `ignored_features` 替换为：

```ts
trigger_rate: {
  present: boolean;
  value: number | null;
  applied: boolean;
  sample: number | null;
  passed: boolean | null;
}
```

含义：

- `present`：是否配置了非默认 rate（或是否显式存在）
- `value`：配置值
- `applied`：本轮是否真的对 fresh trigger attempt 应用了 gate
- `sample`：deterministic sample
- `passed`：本次 gate 是否通过

### 为什么保留 `applied`

因为：

- delayed due 时不会重新抽样
- cooling/retained/inactive 时也可能不应用
- 这样 operator 才知道“不是没算，而是不该算”

---

## 8.2 汇总 diagnostics

建议 source evaluate diagnostics 增加：

```ts
trigger_rate: {
  present_count: number;
  applied_count: number;
  blocked_count: number;
}
```

这样可以区分：

- 有多少条 candidate 配置了 `trigger_rate`
- 有多少条真正进入 gate
- 有多少条被 gate 拦住

---

## 8.3 `reason` 升级

当前 `reason` 基本只有：

- `no_trigger_match`

建议扩充至少三类：

- `no_trigger_match`
- `below_min_score`
- `trigger_rate_blocked`

这样在 operator / unit test / parity 分析时，可以明确知道失败原因属于哪一层。

---

## 9. TS 侧改动建议

## 9.1 目标文件

- `apps/server/src/memory/blocks/types.ts`
- `apps/server/src/memory/blocks/trigger_engine.ts`
- `apps/server/src/memory/blocks/provider.ts`
- `apps/server/src/context/sources/memory_blocks.ts`
- `apps/server/src/context/source_registry.ts`

## 9.2 主要改造点

### a. `types.ts`

- 删除/替换 `MemoryTriggerIgnoredFeaturesRecord` / `Summary`
- 新增 `MemoryTriggerRateDecisionRecord` / `Summary`
- 保持 transport DTO 语义清晰

### b. `trigger_engine.ts`

新增：

- deterministic hash helper
- `computeTriggerRateSample(...)n- `evaluateTriggerRateGate(...)`

修改：

- `evaluateMemoryBlockActivation(...)`
- `resolveStatus(...)`

### c. `provider.ts`

- 移除 `trigger_rate_ignored` 相关硬编码
- diagnostics 改为真实 gate evidence

### d. `context/sources/memory_blocks.ts`

- 不再输出 `trigger_rate_ignored_count`
- 改为更准确的 `trigger_rate_blocked_count` / `trigger_rate_applied_count` 或至少输出新的 summary 字段

### e. `context/source_registry.ts`

- 同步新的 summary 字段，避免 UI/read model 仍展示“ignored”。

---

## 10. Rust 侧改动建议

## 10.1 目标文件

- `apps/server/rust/memory_trigger_sidecar/src/models.rs`
- `apps/server/rust/memory_trigger_sidecar/src/engine.rs`
- `apps/server/rust/memory_trigger_sidecar/src/source.rs`
- 可能新增 `hash.rs` 或 `sampling.rs`

## 10.2 主要改造点

### a. `models.rs`

- 删除/替换 `MemoryTriggerIgnoredFeaturesRecord` / `Summary`
- 引入 `MemoryTriggerRateDecisionRecord` / `Summary`

### b. `engine.rs`

- 增加 deterministic sampling helper
- 调整 `evaluate_memory_block_activation(...)`
- 调整 `resolve_status(...)`

### c. `source.rs`

- 不再累积 `trigger_rate_ignored`
- 改为累积 `present_count / applied_count / blocked_count`

---

## 11. 测试策略

## 11.1 TS unit tests

重点补：

- `trigger_rate = 1` 必定通过
- `trigger_rate = 0` 必定拒绝
- `0 < trigger_rate < 1` 的 deterministic sample 行为稳定
- `reason = trigger_rate_blocked`
- delayed due 时不重复抽样

目标文件：

- `apps/server/tests/unit/memory_block_trigger_engine.spec.ts`
- `apps/server/tests/unit/memory_trigger_engine_provider.spec.ts`
- `apps/server/tests/unit/context_memory_blocks_source_rust_modes.spec.ts`

---

## 11.2 Rust unit tests

重点补：

- hash/sample helper 稳定性
- `trigger_rate = 0/1/0.5` 的边界
- delayed due 不重抽

目标文件：

- `apps/server/rust/memory_trigger_sidecar/src/engine.rs`
- `apps/server/rust/memory_trigger_sidecar/src/trigger.rs`
- 新 sampling helper 文件的测试

---

## 11.3 Parity tests

已有：

- `apps/server/tests/unit/memory_trigger_sidecar_parity.spec.ts`

必须扩充断言：

- TS / Rust 在 `trigger_rate < 1` 时仍完全一致
- diagnostics / reason / summary 一致

---

## 12. 兼容性与迁移策略

本轮不建议做“完全无兼容改动”。因为现有 diagnostics 中：

- `trigger_rate_ignored`
- `trigger_rate_ignored_count`

一旦 trigger_rate 真生效，这些字段会变成误导。

### 推荐策略

- 直接切到新字段；
- 同步更新 unit/parity/context source 测试；
- 文档同步更新；
- 不再保留 “ignored” 兼容壳。

原因：

1. 当前字段本来就是“缺口临时标记”；
2. 继续兼容会延长假语义寿命；
3. 这不是公共 HTTP 顶层 contract，而是内部 runtime/source diagnostics，改动成本可控。

---

## 13. 文档同步

至少更新：

- `docs/ARCH.md`
  - 将 `trigger_rate` 从“Rust 已知缺口”改成“已支持 deterministic trigger-rate gate”（若实施完成）
- `.limcode/review/rust-migration-compatibility-debt-assessment.md`
  - 去掉“trigger_rate 未实现”的表述
- 必要时 `.limcode/progress.md`
  - 记录从 ignored feature 到正式语义的变化

---

## 14. 风险

## 14.1 TS / Rust 结果不一致

风险最大点在 deterministic sampling。

缓解：

- 采用同一 canonical seed 规则
- 采用手写 FNV-1a 64-bit
- 补 parity 测试

## 14.2 delay 状态机被破坏

如果 delayed due 仍重复抽样，会出现奇怪行为。

缓解：

- 明确“fresh trigger attempt 才抽样”
- 对 delayed due 单独补测试

## 14.3 operator 看不懂为什么没触发

如果只改行为，不改 diagnostics，会让排查变难。

缓解：

- 同步升级 reason 与 diagnostics

---

## 15. 最终设计结论

本轮 `trigger_rate` 的正式语义确定为：

> **新触发机会的 deterministic admission gate**

并满足：

1. **概率门**，不是分数缩放；
2. **严格可重放**，不使用随机源；
3. **只在 fresh match 上应用**；
4. **delayed due 不重新抽样**；
5. **diagnostics 从 ignored 升级为真实 gate evidence**；
6. **TS / Rust parity 必须成立**。

---

## 16. 下一步建议

本设计完成后，下一步应创建正式 implementation plan，按以下顺序实施：

1. 冻结 TS/Rust 共用的 sampling contract
2. 改 types/models
3. 改 TS engine
4. 改 Rust engine/source
5. 补 parity / unit / context tests
6. 同步 ARCH / review / progress
