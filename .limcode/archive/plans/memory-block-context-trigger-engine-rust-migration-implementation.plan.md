<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/memory-block-context-trigger-engine-rust-migration-design.md","contentHash":"sha256:813284a39ff09821e5e272fa1ef3805a877ad59e54c1a795fa265071a56aee31"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 搭建 memory_trigger_sidecar crate、stdio JSON-RPC 协议骨架与握手/健康检查  `#plan-memory-trigger-sidecar-scaffold`
- [x] 迁移 Rust DTO、logic DSL、trigger primitives 与语义测试  `#plan-rust-models-and-logic-dsl`
- [x] 实现 Rust source evaluate 内核：evaluation、status、next runtime state、should_materialize、ignored_features 聚合  `#plan-rust-source-kernel`
- [x] 实现 rust_shadow 对跑、diff 观测与 rust_primary fallback 策略  `#plan-shadow-parity-and-fallback`
- [x] 将 context/sources/memory_blocks.ts 改造成 thin shell，并接入 Rust 结果持久化/materialization/diagnostics  `#plan-ts-memory-block-source-integration`
- [x] 新增 TS sidecar client 与 memory_trigger_engine feature flag（ts/rust_shadow/rust_primary）  `#plan-ts-sidecar-client-and-flag`
- [x] 补齐单元/集成测试，完成 parity 验收并切换到 rust_primary  `#plan-validation-and-cutover`
<!-- LIMCODE_TODO_LIST_END -->

# Memory Block / Context Trigger Engine Rust 迁移实施计划

## 来源设计

- 源设计文档：`.limcode/design/memory-block-context-trigger-engine-rust-migration-design.md`
- 本计划严格以前述已确认设计为准，不再重新讨论范围边界。

## 1. 实施目标

本计划用于落地以下已确认方案：

- 新建独立 `memory_trigger_sidecar`
- 迁移 **trigger_engine + memory_blocks source kernel** 到 Rust
- 保留 TS host 对以下职责的 ownership：
  - Prisma / store
  - 权限裁剪后的 evaluation context 组装
  - runtime state 持久化
  - `ContextNode` materialization
  - Context diagnostics 汇总
- `trigger_rate` 当前阶段 **明确忽略并记录**
- `delay_rounds_before_insert` 到期后应进入 **active** 路径
- 通过 `ts -> rust_shadow -> rust_primary` 渐进切换

---

## 2. 实施范围

### 2.1 本轮包含

1. Rust sidecar crate scaffold 与协议层
2. Rust DTO / logic DSL / trigger evaluation / source kernel
3. TS sidecar client 与 feature flag
4. `context/sources/memory_blocks.ts` 薄壳化改造
5. shadow parity、diff 观测、fallback
6. 单元测试、协议测试、集成测试、切主验收

### 2.2 本轮不包含

1. Prisma store Rust 化
2. `buildMemoryEvaluationContext(...)` Rust 化
3. `ContextNode` 结构 Rust 化
4. 完整 Memory Block Runtime Rust ownership 深化
5. `trigger_rate` 随机/概率执行

---

## 3. 实施阶段拆分

## Phase 1：建立 Rust sidecar 基础骨架

### 目标

建立与现有 world/scheduler sidecar 风格一致的第三个独立 sidecar，为后续求值内核迁移提供稳定宿主。

### 计划工作

1. 新建目录：`apps/server/rust/memory_trigger_sidecar/`
2. 初始化 `Cargo.toml`
3. 初始化模块：
   - `main.rs`
   - `protocol.rs`
   - `models.rs`
   - `logic_dsl.rs`
   - `trigger.rs`
   - `engine.rs`
   - `source.rs`
4. 建立 stdio JSON-RPC 主循环
5. 实现最小方法：
   - `memory_trigger.protocol.handshake`
   - `memory_trigger.health.get`
   - `memory_trigger.source.evaluate`（可先 stub）
6. 统一协议版本：`memory_trigger/v1alpha1`

### 交付物

- 可编译运行的 sidecar 二进制
- 可通过 JSON-RPC 返回握手与健康信息
- `source.evaluate` 的基本 request/response 框架

### 验收标准

- sidecar 本地启动成功
- stdio 输入合法 JSON-RPC 请求时返回合法响应
- handshake / health 响应包含协议版本与 transport 信息

---

## Phase 2：迁移 Rust DTO、Logic DSL 与 Trigger Primitives

### 目标

先把 deterministic 基础能力迁入 Rust，确保协议类型、DSL 行为与 trigger 基元具有稳定测试基础。

### 计划工作

1. 在 `models.rs` 中定义 DTO：
   - `MemoryEvaluationContextDto`
   - `MemoryBlockDto`
   - `MemoryBehaviorDto`
   - `MemoryRuntimeStateDto`
   - `MemoryActivationEvaluationDto`
   - `MemoryTriggerSourceEvaluateInput/Result`
2. 在 `logic_dsl.rs` 中迁移 TS 对应逻辑：
   - path resolve
   - `and/or/not`
   - `eq/in/gt/lt/contains/exists`
3. 在 `trigger.rs` 中迁移：
   - keyword haystack 构造
   - keyword trigger 评估
   - recent source trigger 评估
   - logic trigger dispatch
4. 明确 `trigger_rate` 处理：
   - 不参与裁决
   - 保留 ignored_features 标记
5. 为上述模块补齐 Rust 单元测试

### 交付物

- Rust 侧完整 DTO 序列化/反序列化模型
- Rust 逻辑表达式求值器
- Rust trigger primitives
- 对应测试集

### 验收标准

- DTO 可稳定解析 TS 发送的数据结构
- DSL 行为在 Rust 测试中可复现 TS 既定语义
- `trigger_rate` 被显式忽略且可被记录

---

## Phase 3：实现 Rust Trigger Engine 与 Source Kernel

### 目标

完成本轮迁移核心：让 Rust 根据 `evaluation_context + candidates` 返回每条 memory block 的 evaluation、next runtime state 和 source result。

### 计划工作

1. 在 `engine.rs` 中实现：
   - activation score 计算
   - matched trigger labels
   - `recent_distance_from_latest_message`
   - status resolve
   - next runtime state derive
2. 明确 status 判定顺序：
   - cooling
   - delayed
   - retained
   - inactive
   - active
3. 强化 delay 语义测试：
   - delay 未到期 -> delayed
   - delay 到期且 matched -> active
4. 在 `source.rs` 中实现：
   - 顺序遍历 candidates
   - per-record evaluate
   - `should_materialize`
   - `materialize_reason`
   - aggregate diagnostics
5. 保证返回顺序与输入顺序一致
6. 补协议级测试与 source kernel 测试

### 交付物

- `memory_trigger.source.evaluate` 的正式 Rust 实现
- `records[] + diagnostics` 输出
- 可覆盖 delay / cooldown / retained / inactive / active 的测试

### 验收标准

- 对同一输入重复执行得到稳定一致结果
- `should_materialize` 仅在 `active/retained` 时为 true
- 聚合 diagnostics 可用于 host diagnostics 汇总

---

## Phase 4：TS Host Sidecar Client 与 Feature Flag 接入

### 目标

建立 TS 到 Rust sidecar 的正式调用面，并为渐进切换做好 runtime 路由控制。

### 计划工作

1. 新增 `apps/server/src/memory/blocks/rust_sidecar_client.ts`
2. 实现 sidecar：
   - 进程启动
   - handshake
   - health
   - request/response 编解码
   - 超时与错误封装
3. 引入 feature flag：
   - `memory_trigger_engine = ts | rust_shadow | rust_primary`
4. 将配置路由到 host runtime config / env override 体系
5. 为 client 层补测试：
   - sidecar 不可达
   - 超时
   - 非法 payload
   - 正常返回

### 交付物

- TS host sidecar client
- 可切换的 feature flag
- client 错误处理与 observability 封装

### 验收标准

- `ts/rust_shadow/rust_primary` 三种模式可被配置识别
- TS host 能成功调用 Rust `source.evaluate`
- sidecar 失败时错误可被明确识别与上报

---

## Phase 5：改造 `context/sources/memory_blocks.ts` 为 Thin Shell

### 目标

将当前 TS 内部 for-loop + trigger/status/source 逻辑替换为 Rust sidecar 调用，同时保留 TS 对 persistence 和 materialization 的控制。

### 计划工作

1. 保留 `buildMemoryEvaluationContext(...)`
2. 保留 `longMemoryBlockStore.listCandidateBlocks(...)`
3. 以 feature flag 分支：
   - `ts`：走旧逻辑
   - `rust_shadow`：旧逻辑为主、Rust 跟跑
   - `rust_primary`：Rust 为主
4. 在 Rust 返回后：
   - 逐条 `updateRuntimeState(...)`
   - 对 `should_materialize=true` 的块调用 `materializeMemoryBlockToContextNode(...)`
5. 组装 `MemoryBlockSourceBuildResult`
6. 将 `ignored_features` 与 source diagnostics 映射到现有 context diagnostics 结构

### 交付物

- 薄壳化后的 `context/sources/memory_blocks.ts`
- Rust 主路径与 TS 兼容路径并存
- diagnostics 映射逻辑

### 验收标准

- 在 `rust_primary` 下，source 能正常返回 nodes + evaluations
- runtime state 正确写回 store
- ContextNode materialization 不回归

---

## Phase 6：Rust Shadow Parity、Diff 观测与 Fallback

### 目标

在不影响线上主结果的前提下完成 Rust/TS 结果对比，为切主提供证据。

### 计划工作

1. 在 `rust_shadow` 模式下：
   - TS 结果为主
   - Rust 并行/跟跑求值
2. 对比字段：
   - `status`
   - `activation_score`
   - `matched_triggers`
   - `recent_distance_from_latest_message`
   - `next_runtime_state`
   - `should_materialize`
3. 在 `context_run.diagnostics['memory-block-runtime']` 中记录：
   - `engine_mode`
   - `ignored_features.trigger_rate_ignored_count`
   - `parity_diff.mismatch_count`
   - `parity_diff.sample_ids`
4. 实现 `rust_primary` fallback 策略：
   - sidecar 启动失败
   - handshake 失败
   - 请求超时
   - 返回不可解析结果
5. 定义 observability 记录点

### 交付物

- rust_shadow parity 比对逻辑
- mismatch diagnostics
- rust_primary fallback 逻辑

### 验收标准

- shadow 模式不影响原主结果
- diff 数据可在 diagnostics 中被清晰查看
- rust_primary 异常时可按策略回退 TS

---

## Phase 7：测试补齐、切主与收尾

### 目标

在测试与 parity 证据充分后，完成 Rust 主路径切换并关闭本轮迁移工作。

### 计划工作

1. 补 Rust 单元测试：
   - keyword
   - recent source
   - logic DSL
   - delay 语义
   - retained/cooling
   - trigger_rate ignored
2. 补协议测试：
   - handshake
   - health
   - evaluate success/failure
3. 补 TS 集成测试：
   - rust_primary 正常流
   - runtime state 写回
   - materialization 正常
   - diagnostics 正常
   - fallback 正常
4. 以样本 world/agent 场景执行 shadow 验收
5. 若 parity 达标，切换到 `rust_primary`
6. 完成文档与进度同步

### 验收门槛

切主前至少满足：

- `status` 一致率 100%
- `should_materialize` 一致率 100%
- `next_runtime_state` 一致率 100%
- `recent_distance_from_latest_message` 一致率 100%

### 收尾输出

- 最终切主结论
- 已知限制（`trigger_rate` ignored）
- 后续深化项明确留待完整 Memory Runtime Rust 化阶段

---

## 4. 关键实现注意事项

### 4.1 必须保持的边界

1. Rust sidecar 不直接访问 Prisma
2. Rust sidecar 不构造未授权 recent sources
3. Rust sidecar 不返回完整 `ContextNode`
4. TS host 继续拥有 materialization 与 diagnostics 汇总

### 4.2 必须保持的行为一致性

1. 输入顺序 = 输出顺序
2. `trigger_rate` 只记录不执行
3. delay 到期后 matched 必须可转 active
4. `active/retained` 才允许 materialize

### 4.3 推荐先后顺序

严格按以下依赖顺序执行：

1. sidecar scaffold
2. DTO + logic DSL + trigger primitives
3. source kernel
4. TS client + flag
5. TS source integration
6. shadow parity + fallback
7. tests + cutover

---

## 5. 风险控制

### 风险 A：source adapter 迁移过度

- 现象：把 Context adapter 本体一起迁入 Rust
- 控制：仅迁 source kernel，TS 继续作为 adapter shell

### 风险 B：delay 语义实现漂移

- 现象：Rust 与 TS/设计对 delay 到期后行为不一致
- 控制：先写语义测试，再实现 engine

### 风险 C：trigger_rate 误被当作概率执行

- 现象：引入非确定性，破坏 replay / diff
- 控制：明确忽略并记录，测试覆盖

### 风险 D：切主过早

- 现象：尚未完成 parity 即切到 rust_primary
- 控制：以 Phase 6/7 的验收门槛为准，不满足不切主

---

## 6. 完成定义

本计划完成时，应满足：

1. 仓库中存在独立 `memory_trigger_sidecar`
2. Rust 可作为 `memory_blocks source kernel` 的正式 owner
3. TS host 仅保留 persistence/materialization/integration
4. 已支持 `ts/rust_shadow/rust_primary` 三种模式
5. 已有 parity 证据与 fallback 保障
6. `trigger_rate` ignored 语义被显式记录
7. delay 到期后 active 语义已在 Rust/TS 集成中得到验证

---

## 7. 执行顺序摘要

1. 搭 sidecar
2. 迁 DTO/DSL/trigger
3. 做 source kernel
4. 接 TS client + flag
5. 改 `memory_blocks.ts`
6. 跑 shadow / diff / fallback
7. 验收后切 `rust_primary`

本计划创建后，等待用户确认并执行。
