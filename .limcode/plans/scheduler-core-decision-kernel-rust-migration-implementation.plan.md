<!-- LIMCODE_SOURCE_ARTIFACT_START -->
{"type":"design","path":".limcode/design/scheduler-core-decision-kernel-rust-migration-design.md","contentHash":"sha256:3b3c9be62f08d67aa1581598f79fca7aef39cb8ffbeab4f5ec95313bd014022a"}
<!-- LIMCODE_SOURCE_ARTIFACT_END -->

## TODO LIST

<!-- LIMCODE_TODO_LIST_START -->
- [x] 抽离 TS Scheduler Decision Kernel 与稳定输入/输出契约  `#plan-scheduler-kernel-1`
- [x] 补齐 TS kernel 单元测试与 fixture 行为基线  `#plan-scheduler-kernel-2`
- [x] 建立 Rust scheduler_decision_sidecar prototype 与 evaluate RPC  `#plan-scheduler-kernel-3`
- [x] 接入 Node sidecar client 与 scheduler kernel port，支持 ts/rust_shadow/rust_primary  `#plan-scheduler-kernel-4`
- [x] 补齐 parity / fallback / observability 集成验证并完成灰度切换准备  `#plan-scheduler-kernel-5`
<!-- LIMCODE_TODO_LIST_END -->

# Scheduler Core Decision Kernel Rust Migration Implementation Plan

## Source Design

- Confirmed design: `.limcode/design/scheduler-core-decision-kernel-rust-migration-design.md`

## 1. 实施目标

按照已确认设计，将当前 `apps/server/src/app/runtime/agent_scheduler.ts` 中混合的 scheduler 决策逻辑与宿主编排逻辑拆开，形成：

1. **TS 纯决策内核**：稳定输入/输出契约，作为行为基线与 fallback 实现；
2. **独立 Rust scheduler_decision_sidecar**：承接同一决策契约；
3. **Node/TS 宿主桥接与运行模式切换**：支持 `ts` / `rust_shadow` / `rust_primary`；
4. **parity、fallback、observability 验证闭环**：确保在不迁移 lease / ownership / DB / runtime loop 的前提下完成安全灰度。

---

## 2. 范围与边界

### 2.1 本计划包含

- 抽离 scheduler pure decision kernel
- 定义 kernel input/output types 与 port
- 新增 TS kernel baseline 实现
- 新增 Rust `scheduler_decision_sidecar`
- 新增 Node sidecar client / port adapter
- 新增 runtime config 切换项
- 调整 `agent_scheduler.ts` 为 host orchestration shell
- 新增 unit / integration / fallback / parity 测试
- 最小化 observability metadata 扩展

### 2.2 本计划不包含

- scheduler lease / ownership / rebalance 的 Rust 化
- cursor / persistence / workflow host 的 Rust 化
- 将 scheduler 合并进 `world_engine_sidecar`
- 大规模重构 scheduler observability schema 主干
- 迁移 Memory Block / Context Trigger Engine

---

## 3. 代码落点规划

### 3.1 TS kernel 与 host 侧

预计新增/修改：

- `apps/server/src/app/runtime/agent_scheduler.ts`
- `apps/server/src/app/runtime/scheduler_decision_kernel.ts`（新增）
- `apps/server/src/app/runtime/scheduler_decision_kernel_port.ts`（新增）
- `apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts`（新增）
- `apps/server/src/config/runtime_config.ts`
- `apps/server/src/config/schema.ts`
- `apps/server/templates/configw/*.yaml`（若已有 scheduler.agent 配置模板则补充）

### 3.2 Rust sidecar

预计新增：

- `apps/server/rust/scheduler_decision_sidecar/Cargo.toml`
- `apps/server/rust/scheduler_decision_sidecar/src/main.rs`
- `apps/server/rust/scheduler_decision_sidecar/src/models.rs`
- `apps/server/rust/scheduler_decision_sidecar/src/protocol.rs`
- `apps/server/rust/scheduler_decision_sidecar/src/kernel.rs`
- `apps/server/rust/scheduler_decision_sidecar/src/policy.rs`

### 3.3 测试

预计新增/修改：

- `apps/server/tests/unit/runtime/scheduler_decision_kernel.spec.ts`
- `apps/server/tests/integration/scheduler_decision_sidecar_parity.spec.ts`
- `apps/server/tests/integration/scheduler_decision_sidecar_failure_fallback.spec.ts`
- 如有 scheduler 现有 e2e / integration 用例，补充断言与 provider 模式覆盖

---

## 4. 分阶段实施

## Phase 1：抽离 TS Scheduler Decision Kernel

### 目标

把当前 `agent_scheduler.ts` 中的纯逻辑抽离成不依赖 `AppContext`、不做 IO 的 TS 内核，作为：

- 正式 kernel contract 的第一实现；
- Rust parity baseline；
- `rust_primary` 的 fallback 实现。

### 任务

1. 新建 `scheduler_decision_kernel_port.ts`
   - 定义：
     - `SchedulerKernelEvaluateInput`
     - `SchedulerKernelEvaluateOutput`
     - `SchedulerDecisionKernelPort`
   - 明确所有 tick / bigint 风格字段统一为 string。

2. 新建 `scheduler_decision_kernel.ts`
   - 迁移并重组以下逻辑：
     - periodic candidate build
     - event-driven merge / coalesce
     - candidate sort
     - readiness evaluation
     - skip reason aggregation
     - summary construction
     - job draft generation
   - 移除对 `AppContext`、Prisma、lease、cursor 的直接依赖。

3. 调整 `agent_scheduler.ts`
   - 宿主侧负责：
     - gather host snapshot
     - build kernel input
     - invoke TS kernel
     - create jobs from drafts
     - write observability / cursor
   - 保持外部 API 与返回结构尽量兼容。

4. 明确 host responsibilities 仍保留：
   - `acquireSchedulerLease`
   - `renewSchedulerLease`
   - `isWorkerAllowedToOperateSchedulerPartition`
   - `createPendingDecisionJob`
   - `recordSchedulerRunSnapshot`
   - `updateSchedulerCursor`

### 验收

- `agent_scheduler.ts` 不再直接承载完整 decision algorithm。
- TS kernel 可通过纯输入对象得到结构化输出。
- scheduler 现有测试无行为回归。

### 风险控制

- 避免“一边抽离一边改语义”；第一阶段必须以保行为一致为最高优先级。
- 若现有返回结果中某些 counters 由 host 补充，则先显式区分 kernel summary 与 host-adjusted summary。

---

## Phase 2：建立 TS 行为基线与 fixture 测试

### 目标

把现有 scheduler 行为固化成 fixture / unit baseline，为 Rust parity 提供唯一对照源。

### 任务

1. 新增 `scheduler_decision_kernel.spec.ts`
   - 覆盖：
     - periodic candidate
     - event-driven merge
     - secondary reasons coalescing
     - pending workflow suppression
     - cooldown suppression
     - replay suppression
     - retry suppression
     - candidate ordering
     - max candidates / max created jobs
     - entity activation limit
     - summary counters
     - `scheduler_periodic` / `scheduler_event_followup` job draft intent class

2. 组织 fixture helpers
   - 提供稳定的 input builders
   - 避免测试复制一整份生产配置
   - 统一断言 output normalization

3. 如有必要，补一层 serialization parity helper
   - 确保 string ticks / arrays / summary ordering 可被稳定 snapshot

### 验收

- TS kernel 行为覆盖核心路径。
- 输出结构可做稳定 snapshot / deep equality。
- 对排序和 suppression 行为有明确断言，不依赖隐式顺序。

### 风险控制

- 不要把测试只写成“数量对”；必须覆盖 reason / order / skip reason 级别。
- 明确 fixture 的 canonical config，避免后续 shadow diff 是由测试输入不一致造成。

---

## Phase 3：建立 Rust scheduler_decision_sidecar prototype

### 目标

以独立 crate 形式实现同一 kernel 契约，不侵入现有 `world_engine_sidecar`。

### 任务

1. 新建 Rust crate 目录
   - `apps/server/rust/scheduler_decision_sidecar/`

2. 设计模块
   - `models.rs`：协议输入/输出、枚举、序列化结构
   - `policy.rs`：signal policy / recovery suppression helpers
   - `kernel.rs`：pure evaluate implementation
   - `protocol.rs`：JSON-RPC request/response parsing
   - `main.rs`：stdio loop + method dispatch

3. 实现 RPC
   - `scheduler.health.get`
   - `scheduler.kernel.evaluate`

4. 保证协议边界
   - 输入输出只用 JSON serializable contract
   - 不读库、不持久化、不维护 session
   - 每次 evaluate 为纯调用

5. 对齐 TS 行为
   - 排序稳定性
   - skip reason 计数
   - secondary reasons merge 顺序
   - tick string parse / render

### 验收

- sidecar 可被本地启动并响应 health/evaluate。
- 在基础 fixture 上与 TS kernel 输出结构一致。
- 不需要修改 `world_engine_sidecar`。

### 风险控制

- 必须避免把业务宿主语义写死进 sidecar main loop。
- 所有 tick 型字段协议层仍保持 string，Rust 内部解析后再运算。

---

## Phase 4：Node 侧接入 sidecar client 与 kernel mode

### 目标

把 Rust sidecar 接入 Node host，通过统一 port 支持 `ts` / `rust_shadow` / `rust_primary`。

### 任务

1. 新增 `scheduler_decision_sidecar_client.ts`
   - 负责 sidecar 启动、health check、evaluate RPC、timeout、auto restart
   - 参考现有 world sidecar client 的风格，但保持独立实现

2. 组装 kernel port provider
   - TS provider
   - Rust provider
   - Hybrid/shadow wrapper

3. runtime config 接入
   - 在 runtime config / schema / config template 中新增：
     - `scheduler.agent.decision_kernel.mode`
     - `timeout_ms`
     - `binary_path`
     - `auto_restart`

4. 调整 `agent_scheduler.ts`
   - 用 port 调用替换直接算法逻辑
   - 在 `rust_shadow` 下：
     - TS 结果为主
     - Rust 结果为辅
     - 执行 diff，不影响 job create 主路径
   - 在 `rust_primary` 下：
     - Rust 结果为主
     - sidecar 失败则回退 TS

5. 保留 host 侧最终 job materialization
   - 生成 idempotency key
   - 构造 request_input
   - 调 `createPendingDecisionJob`
   - 回填 created_job_id / skipped_existing_idempotency

### 验收

- 能通过配置切换三种模式。
- `ts` 模式保持当前默认行为。
- `rust_shadow` 不影响主流程。
- `rust_primary` 失败时能自动 fallback。

### 风险控制

- 不允许在此阶段把 `DecisionJob` 创建逻辑下放到 Rust。
- 不允许 sidecar failure 直接中断整个 runtime loop。

---

## Phase 5：Parity、Fallback、Observability 与灰度准备

### 目标

补齐集成验证与可观测性，确保生产前具备 shadow 观察和 primary 回退能力。

### 任务

1. 新增 parity integration test
   - `scheduler_decision_sidecar_parity.spec.ts`
   - 复用 TS fixture 作为 expected baseline
   - 对比：
     - candidate decisions
     - job drafts
     - summary

2. 新增 failure fallback integration test
   - `scheduler_decision_sidecar_failure_fallback.spec.ts`
   - 覆盖：
     - sidecar 未启动
     - sidecar timeout
     - sidecar 非法响应
     - sidecar 退出/崩溃

3. observability metadata 扩展
   - 在 scheduler run / metadata 中补充：
     - `decision_kernel_provider`
     - `decision_kernel_fallback`
     - `decision_kernel_fallback_reason`
     - `decision_kernel_parity_status`
     - `decision_kernel_parity_diff_count`
   - 尽量先放到现有 JSON metadata 扩展位

4. 灰度运行准备
   - 默认保留 `ts`
   - 准备 `rust_shadow` rollout checklist
   - 确认 `rust_primary` 前置条件：
     - parity diff 在可接受范围内
     - fallback 在集成测试中稳定
     - sidecar restart 策略可工作

### 验收

- parity 与 failure fallback 测试通过。
- shadow 模式下可清晰观测差异。
- primary 模式下 sidecar failure 不阻断 scheduler。

### 风险控制

- 先做 metadata 扩展，不做 schema 大改。
- 若 parity diff 难以解释，优先保守停留在 `rust_shadow`。

---

## 5. 实施顺序建议

建议严格按照下列顺序执行：

1. **先抽 TS kernel**
2. **再补 TS baseline tests**
3. **再写 Rust sidecar prototype**
4. **再接 sidecar client / mode switching**
5. **最后补 parity / fallback / observability integration**

原因：

- 没有 TS kernel，就没有清晰迁移边界；
- 没有 TS baseline，就没有 Rust parity 标准；
- 没有 fallback / observability，就不能安全 rollout。

---

## 6. 关键实现约束

### 6.1 不能破坏 ARCH 既有边界

实现时必须保持：

- scheduler orchestration 仍属 Node/TS host
- workflow persistence 仍属 Node/TS host
- Rust sidecar 只负责 decision kernel

### 6.2 不能并入 world_engine_sidecar

- 不扩展 `apps/server/rust/world_engine_sidecar/src/main.rs` 承担 scheduler kernel
- 新增独立 crate / binary

### 6.3 必须保证 deterministic parity

重点关注：

- tick string 解析
- sort 稳定性
- reason coalescing 顺序
- skip reason 计数
- limit reached 行为
- summary 统计来源

### 6.4 Host 仍是最终 source of truth

Rust sidecar 输出只是：

- decisions
- job drafts
- summary suggestion

真正的：

- idempotency key
- request_input
- job creation
- run snapshot persistence
- cursor update

仍由 host 最终确认。

---

## 7. 计划级验收标准

本计划执行完成后，应满足：

1. 已存在正式 TS scheduler decision kernel，与 host orchestration 分离。
2. 已存在独立 Rust `scheduler_decision_sidecar`，实现 evaluate RPC。
3. Node 侧具备统一 kernel port 与 mode switching。
4. `ts` / `rust_shadow` / `rust_primary` 三种模式都可运行。
5. sidecar 失败可回退到 TS kernel。
6. parity、fallback、observability 测试齐备。
7. 整个迁移未扩大到 lease / ownership / workflow persistence Rust 化。

---

## 8. 里程碑建议

### 里程碑 A
TS kernel 抽离完成，scheduler 行为不变。

### 里程碑 B
TS baseline tests 完成，可作为 Rust parity 标准。

### 里程碑 C
Rust sidecar prototype 完成，可离线 evaluate。

### 里程碑 D
shadow 模式接通并可观测 parity diff。

### 里程碑 E
primary 模式具备 fallback 与 rollout readiness。

---

## 9. 完成后下一步

若本计划完成并稳定运行，下一步再考虑：

- `Memory Block / Context Trigger Engine`

并复用本次形成的通用迁移模式：

- 先抽纯 kernel
- 再立契约
- 再做 Rust sidecar
- 再经 shadow -> primary 灰度切换
