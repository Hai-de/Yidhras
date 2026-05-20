# Rust Sidecar Refactoring — Implementation Plan

**基线**: 2026-05-21，基于 `.limcode/design/rust-sidecar-refactor-plan.md` 和 `.limcode/review/rust-sidecar-code-review.md`
**原则**: 零向后兼容，不保留旧代码，不保留开发数据，所有 lint 必须通过，所有测试必须通过。

---

## 前置：TS 侧需要同步修改的文件

这些文件引用 sidecar 的目录路径和二进制路径，目录重命名后必须同步更新：

| 文件 | 修改内容 |
|---|---|
| `apps/server/package.json` | `check:rust` / `build:rust` 改为 workspace 命令 |
| `apps/server/src/app/runtime/sidecar/world_engine_sidecar_client.ts:73` | `projectDir: 'rust/world_engine_sidecar'` → `'rust/world-engine'` |
| `apps/server/src/app/runtime/sidecar/scheduler_decision_sidecar_client.ts:41` | `projectDir: 'rust/scheduler_decision_sidecar'` → `'rust/scheduler-decision'` |
| `apps/server/src/memory/blocks/rust_sidecar_client.ts:48` | `projectDir: 'rust/memory_trigger_sidecar'` → `'rust/memory-trigger'` |
| `apps/server/src/config/domains/world_engine.ts:18` | `binary_path` 默认值路径更新 |
| `apps/server/src/config/domains/scheduler.ts:207,252` | `binary_path` 默认值路径更新 |

---

## Task 1: 创建 workspace 基础设施

**依赖**: 无
**验证**: `cargo check --workspace` 通过

### 1.1 创建 workspace `Cargo.toml`

**文件**: `apps/server/rust/Cargo.toml` (新建)

```toml
[workspace]
resolver = "2"
members = [
    "sidecar-common",
    "world-engine",
    "scheduler-decision",
    "memory-trigger",
]

[workspace.package]
version = "0.1.0"
edition = "2021"

[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "2.0"

[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
correctness = "deny"
suspicious = "deny"
complexity = "warn"
perf = "warn"
style = "warn"
pedantic = "warn"
module_name_repetitions = "allow"
must_use_candidate = "allow"
similar_names = "allow"
too_many_lines = "allow"
```

### 1.2 创建 `rustfmt.toml`

**文件**: `apps/server/rust/rustfmt.toml` (新建)

```toml
edition = "2021"
max_width = 100
tab_spaces = 4
use_small_heuristics = "Max"
newline_style = "Unix"
imports_granularity = "Module"
group_imports = "StdExternalCrate"
reorder_imports = true
```

### 1.3 创建 `sidecar-common` crate

**文件**: `apps/server/rust/sidecar-common/Cargo.toml` (新建)
```toml
[package]
name = "sidecar-common"
version.workspace = true
edition.workspace = true

[dependencies]
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
```

**文件**: `apps/server/rust/sidecar-common/src/lib.rs` (新建)
- 导出 `protocol`、`transport`、`types` 模块

**文件**: `apps/server/rust/sidecar-common/src/protocol.rs` (新建)
- 搬入 `RpcRequest`, `RpcResponse`, `RpcError` structs
- `rpc_result()`, `rpc_error()` 构造函数
- `PARSE_ERROR`, `METHOD_NOT_FOUND`, `INVALID_PARAMS`, `INTERNAL_ERROR` 常量
- `RpcError.data` 统一添加 `#[serde(skip_serializing_if = "Option::is_none")]`

**文件**: `apps/server/rust/sidecar-common/src/transport.rs` (新建)
- `SidecarRuntime` struct (started_at + uptime_ms)
- `JsonRpcHandler` trait (protocol_version + handle_request)
- `run_stdio_jsonrpc()` 函数 — 统一的 stdio 主循环

**文件**: `apps/server/rust/sidecar-common/src/types.rs` (新建)
- `Tick(u64)` newtype + Serialize/Deserialize (字符串 over JSON)
- `Tick::parse()`, `Tick::checked_add()`, `Tick::saturating_sub()`
- `TickParseError` (thiserror)

### 1.4 目录重命名

```bash
cd apps/server/rust
mv world_engine_sidecar world-engine
mv scheduler_decision_sidecar scheduler-decision
mv memory_trigger_sidecar memory-trigger
```

### 1.5 更新每个 crate 的 `Cargo.toml`

在每个 crate 的 `Cargo.toml` 中:
- 添加 `sidecar-common = { path = "../sidecar-common" }` 依赖
- 将 `serde` / `serde_json` 改为 `workspace = true`
- 为 world-engine 添加 `thiserror.workspace = true`
- 确保 `[[bin]]` name 保持原 binary 名称不变 (`world_engine_sidecar` 等)

### 1.6 更新 `package.json` 脚本

```json
"check:rust": "cargo check --manifest-path rust/Cargo.toml --workspace",
"build:rust": "cargo build --manifest-path rust/Cargo.toml --workspace",
```

### 1.7 更新 TS 侧的 projectDir 和 binary_path

按前置表格修改 6 个 TS 文件。

---

## Task 2: 迁移 memory-trigger 侧车

**依赖**: Task 1 完成
**验证**: `cargo test -p memory-trigger` 全部通过，`cargo clippy -p memory-trigger` 无 warning

### 2.1 替换 protocol/transport

- 删除 `memory-trigger/src/protocol.rs`
- `main.rs` 中删除 `mod protocol`，添加 `use sidecar_common::...`
- 实现 `JsonRpcHandler` trait，`handle_request` 不直接接收 `RpcRequest` 参数而是通过 trait 方法
- `SidecarRuntime` 由 common 提供，删除本地的 `AppState` 中的 `started_at` — 改用 runtime 参数

### 2.2 重写 main.rs

```rust
use sidecar_common::transport::{run_stdio_jsonrpc, JsonRpcHandler, SidecarRuntime};
use sidecar_common::protocol::{rpc_result, rpc_error, RpcRequest, RpcResponse, ...};

struct MemoryTriggerHandler;

impl JsonRpcHandler for MemoryTriggerHandler {
    fn protocol_version(&self) -> &'static str {
        "memory_trigger/v1alpha1"
    }

    fn handle_request(&mut self, runtime: &SidecarRuntime, request: RpcRequest) -> RpcResponse {
        // dispatch logic
    }
}

fn main() {
    run_stdio_jsonrpc(&mut MemoryTriggerHandler);
}
```

### 2.3 修复 `logic_dsl.rs`

- `#[allow(dead_code)]` → `#[cfg(test)]` 在 `debug_resolve_memory_logic_path` 上

### 2.4 Tick 类型迁移

- `MemoryRuntimeStateDto` 中的 `last_triggered_tick`, `last_inserted_tick`, `cooldown_until_tick`, `delayed_until_tick`, `retain_until_tick` 从 `Option<String>` 改为 `Option<Tick>`
- `engine.rs` 中的 `parse::<i128>()` 全部替换为 `Tick::parse()`
- `models.rs` 中 `current_tick: String` → `current_tick: Tick`

### 2.5 运行 clippy 和 fmt

```bash
cargo fmt -p memory-trigger
cargo clippy -p memory-trigger -- -D warnings
cargo test -p memory-trigger
```

---

## Task 3: 迁移 scheduler-decision 侧车

**依赖**: Task 1 完成
**验证**: `cargo test -p scheduler-decision` 全部通过，`cargo clippy -p scheduler-decision` 无 warning

### 3.1 替换 protocol/transport

- 同 Task 2.1/2.2 的模式

### 3.2 添加 `conversion.rs`

- `impl From<EventDrivenSchedulerReason> for SchedulerReason`
- 在 `kernel.rs` 和 `policy.rs` 中将所有手动 match 替换为 `.into()`

### 3.3 修复 `build_candidate_key`

- 为 `SchedulerKind` 和 `SchedulerReason` 实现 `Display`
- `format!("{}:{:?}:{:?}", ...)` → `format!("{}:{}:{}", ...)`

### 3.4 修复 `is_event_driven_reason`

- `!is_periodic_reason(reason)` → exhaustive match

### 3.5 去重改用 HashSet

- `merge_event_driven_signals` 中的 `Vec::contains` 去重 → `HashSet::insert`

### 3.6 分解 `evaluate` 函数

- 提取 `EvaluationContext` struct，实现 `from_input()`
- 提取 `process_candidates()`, `determine_skip_reason()` 函数
- 提取 `build_limit_skip_decision()` 消除重复的 LimitReached 处理

### 3.7 消除 `create_initial_skip_counts` + `or_insert(0)` 冗余

- 移除 `create_initial_skip_counts()` 中的预填充，保留 `or_insert(0)` 的惰性初始化
- 或反过来：保留预填充，移除所有 `or_insert(0)`

### 3.8 修复 `scanned_count` 递增时机 bug

- 将 `scanned_count += 1` 移到 limit 检查之前，确保计数准确

### 3.9 编写测试

- `kernel.rs` 的 `process_candidates` 测试：每种 skip reason 至少一个 case
- `policy.rs` 的 `should_suppress_for_recovery_window` 测试
- `conversion.rs` 的 From 往返测试

### 3.10 运行 clippy 和 fmt

---

## Task 4: 迁移 world-engine 侧车（最大工作量）

**依赖**: Task 1 完成
**验证**: `cargo test -p world-engine` 全部通过，`cargo clippy -p world-engine` 无 warning

### 4.1 创建目录结构

```bash
mkdir -p apps/server/rust/world-engine/src/{handlers,engine,models}
```

### 4.2 定义领域模型 (`models/`)

#### 4.2.1 `models/entity.rs`
- `WorldEntity { id, entity_kind, entity_type, #[serde(flatten)] extra }`
- `EntityState { id, pack_id, entity_id, state_namespace, state_json, created_at, updated_at }`

#### 4.2.2 `models/authority.rs`
- `AuthorityGrant` 所有字段显式列出（基于 TS 协议中的 authority grant 结构）

#### 4.2.3 `models/mediator.rs`
- `MediatorBinding { mediator_id, subject_entity_id, binding_kind, status, #[serde(flatten)] extra }`

#### 4.2.4 `models/execution.rs`
- `RuleExecutionRecord` 所有字段显式列出

#### 4.2.5 `models/objective.rs`
- `Invocation` struct (invocation_type, capability_key, subject_entity_id, target_ref, payload, mediator_id, actor_ref, pack_id, ...)
- `ObjectiveRule { id, when: RuleCondition, then: RuleAction }`
- `Mutation` enum (EntityState, AuthorityGrant, WorldState)
- `EmittedEvent` struct
- `ExecuteObjectiveInput`, `ExecuteObjectiveOutput`
- `NoMatchDiagnostics`

#### 4.2.6 `models/step.rs`
- `PreparedStepSummary`, `PreparedStepArtifacts`, `PreparedSessionState`
- Step 相关输入输出类型

#### 4.2.7 `models/state.rs`
- `SessionState` — 所有字段使用带类型的 struct 而非 `Vec<Value>`
- `CommittedTickCache` — 独立 struct，有自己的 `get()` / `insert()` / `prune()` 方法
- `CommittedTickCacheEntry`
- `AppState { sessions, committed_ticks }`

#### 4.2.8 `models/mod.rs`
- 重导出所有子模块

### 4.3 重写 engine 层 (`engine/`)

#### 4.3.1 `engine/template.rs`
- 搬入当前 `template.rs`，添加修复：
  - `RenderStats` 精确计数 `{{...}}` 替换次数（不用 key 数量）
  - `needs_template()` 快速路径
  - 添加测试：嵌套路径、缺失上下文、特殊字符、空模板

#### 4.3.2 `engine/query.rs`
- 将当前 `handle_state_query` 中的 6 个 query 分支拆为独立函数：
  - `query_pack_summary(session, pack_id) -> Value`
  - `query_world_entities(session, selector, limit) -> QueryResult<WorldEntity>`
  - `query_entity_state(session, entity_id, state_namespace) -> Option<Value>`
  - `query_authority_grants(session, selector, limit) -> QueryResult<AuthorityGrant>`
  - `query_mediator_bindings(session, selector, limit) -> QueryResult<MediatorBinding>`
  - `query_rule_execution_summary(session, selector, limit) -> QueryResult<RuleExecutionRecord>`
- 提取 `Selector` struct 和 `QueryResult<T>` 泛型
- 过滤器函数基于 struct 字段而非 `Value::get()` 字符串

#### 4.3.3 `engine/step.rs`
- `prepare_step(session, params) -> Result<PreparedSessionState, StepError>` — 纯逻辑，不含 JSON-RPC
- `commit_step(session, token, persisted_revision) -> Result<CommitResult, StepError>`
- `abort_step(session, token) -> Result<(), StepError>`
- 修复 magic numbers：`delta_operation_count` 从实际 operations 数量推导
- 消除 `clone()` 滥用：使用 `&mut SessionState` 直接修改

#### 4.3.4 `engine/objective.rs`
- `execute(input: ExecuteObjectiveInput) -> Result<ExecuteObjectiveOutput, ObjectiveError>`
- `rule_matches()` — 独立的规则条件判断
- `apply_rule()` — mutation + event 构建
- `build_mutations()` — 返回 `Vec<Mutation>`
- `build_events()` — 返回 `Vec<EmittedEvent>`
- `build_template_context()` — 模板上下文构建
- `resolve_target_kind()` — 目标实体类型解析
- `resolve_target_entity_id()` — 目标实体 ID 解析（从 invocation.payload.target_entity_id 或 target_ref 中提取）

#### 4.3.5 `engine/mod.rs`
- 重导出

### 4.4 重写 handlers 层 (`handlers/`)

每个 handler 文件 ≤ 50 行，只做参数提取 + 调用 engine + 构造响应。

#### 4.4.1 `handlers/meta.rs`
- `handle_handshake(request_id) -> RpcResponse`
- `handle_health(runtime, state, request_id) -> RpcResponse`

#### 4.4.2 `handlers/pack.rs`
- `handle_pack_load(state, request_id, params) -> RpcResponse`
  - 从 params 反序列化 snapshot，直接构造 `SessionState`
  - 不再使用 `or_insert` + 立即覆盖的模式
- `handle_pack_unload(state, request_id, params) -> RpcResponse`
- `handle_status_get(state, request_id, params) -> RpcResponse`

#### 4.4.3 `handlers/query.rs`
- `handle_state_query(state, request_id, params) -> RpcResponse`
  - 解析 query_name，调用对应的 engine 函数
  - 构造统一格式的响应

#### 4.4.4 `handlers/step.rs`
- `handle_step_prepare(state, request_id, params) -> RpcResponse`
  - 先检查 `committed_ticks`（独立借用，无 scope hack）
  - 再获取 `sessions` 可变借用
- `handle_step_commit(state, request_id, params) -> RpcResponse`
- `handle_step_abort(state, request_id, params) -> RpcResponse`

#### 4.4.5 `handlers/objective.rs`
- `handle_execute_objective(request_id, params) -> RpcResponse`
  - 反序列化 params → `ExecuteObjectiveInput`
  - 调用 `engine::objective::execute()`
  - 映射 `ObjectiveError` → RPC error

#### 4.4.6 `handlers/mod.rs`
- 重导出所有 handler

### 4.5 重写 `lib.rs` 和 `main.rs`

```rust
// main.rs
use sidecar_common::transport::run_stdio_jsonrpc;
use world_engine::WorldEngineHandler;

fn main() {
    run_stdio_jsonrpc(&mut WorldEngineHandler::new());
}
```

```rust
// lib.rs
pub mod handlers;
pub mod engine;
pub mod models;

use sidecar_common::transport::{JsonRpcHandler, SidecarRuntime};
use sidecar_common::protocol::{...};
use models::state::AppState;

pub struct WorldEngineHandler {
    state: AppState,
}

impl WorldEngineHandler {
    pub fn new() -> Self {
        Self { state: AppState::new() }
    }
}

impl JsonRpcHandler for WorldEngineHandler {
    fn protocol_version(&self) -> &'static str {
        "world_engine/v1alpha1"
    }

    fn handle_request(&mut self, runtime: &SidecarRuntime, request: RpcRequest) -> RpcResponse {
        // 分发到各 handler
    }
}
```

### 4.6 编写测试

- `engine/template.rs`: 8+ test cases（基本插值、嵌套路径、缺失字段、空模板、多个 {{}}、特殊字符）
- `engine/query.rs`: 每种 query 至少 1 个 test（构造 session，执行查询，验证结果）
- `engine/step.rs`: prepare + commit 正常路径，prepare conflict，commit 找不到 prepared state，abort
- `engine/objective.rs`: rule_matches 各种条件组合，no match error，mutation 构建，event 构建
- `models/`: serde 往返测试（JSON → struct → JSON 不丢数据）
- `handlers/`: 错误路径测试（无效 params、缺少必需字段）

### 4.7 运行 clippy 和 fmt

---

## Task 5: 清理旧文件

**依赖**: Task 2-4 完成
**验证**: `git status` 确认无残留

### 5.1 删除旧源文件

- `world-engine/src/` 下的旧 `main.rs`, `models.rs`, `protocol.rs`, `objective.rs`, `session.rs`, `state.rs`, `step.rs`, `template.rs`（如果仍有残留）
- `memory-trigger/src/protocol.rs`（已移除）
- `scheduler-decision/src/protocol.rs`（已移除）

### 5.2 删除旧的 `target/` 目录

```bash
rm -rf apps/server/rust/world-engine/target
rm -rf apps/server/rust/scheduler-decision/target
rm -rf apps/server/rust/memory-trigger/target
```

---

## Task 6: 全局验证

**依赖**: Task 1-5 完成
**验证**: 所有检查通过

### 6.1 Rust 侧

```bash
cd apps/server/rust
cargo fmt --all -- --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
cargo build --workspace
```

### 6.2 TypeScript 侧

```bash
pnpm install
pnpm typecheck
pnpm test:unit
pnpm test:integration
```

### 6.3 端到端验证

```bash
pnpm dev
# 手动验证:
# 1. 世界引擎侧车启动、握手、加载 pack
# 2. 调度器决策侧车执行 evaluate
# 3. 内存触发侧车执行 source.evaluate
# 4. 世界引擎 step.prepare → step.commit 完整流程
# 5. world.rule.execute_objective 规则匹配
```

---

## Task 依赖图

```
Task 1 (workspace + common)
 ├── Task 2 (memory-trigger)
 ├── Task 3 (scheduler-decision)
 └── Task 4 (world-engine)
      └── Task 5 (cleanup)
           └── Task 6 (verification)
```

Task 2/3/4 可并行执行（互相独立），但 Task 1 必须先完成。

## 估算

| Task | 工作量 |
|---|---|
| Task 1: 基础设施 | 2-3h |
| Task 2: memory-trigger | 1-2h |
| Task 3: scheduler-decision | 2-3h |
| Task 4: world-engine | 6-8h |
| Task 5: 清理 | 0.5h |
| Task 6: 验证 + 修 bug | 2-3h |
| **总计** | **14-20h** |
