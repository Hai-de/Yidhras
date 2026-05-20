# Rust Sidecar Refactoring Plan

**目标**: 用 Rust 设计思维完全重写，零向后兼容，最干净的成果。
**协议约束**: JSON-RPC 2.0 method names、参数 field names、响应结构必须与 TypeScript 主机保持一致。

---

## 1. Workspace 结构

```
apps/server/rust/
├── Cargo.toml                  # workspace root
├── rustfmt.toml
├── .cargo/
│   └── config.toml             # build settings
├── sidecar-common/             # 共享库
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── protocol.rs         # RpcRequest/RpcResponse + 构造函数
│       ├── transport.rs        # stdio JSON-RPC 主循环
│       └── types.rs            # Tick newtype, 共享工具
├── world-engine/               # 世界引擎侧车
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs             # 入口：初始化 + run_stdio_jsonrpc
│       ├── lib.rs
│       ├── handlers/           # 每个 method 一个模块（薄层，参数提取+响应构造）
│       │   ├── mod.rs
│       │   ├── meta.rs         # handshake, health
│       │   ├── pack.rs         # load, unload, status
│       │   ├── query.rs        # state.query 路由
│       │   ├── step.rs         # prepare, commit, abort
│       │   └── objective.rs    # rule.execute_objective
│       ├── engine/             # 纯业务逻辑（无 JSON-RPC 依赖，可单元测试）
│       │   ├── mod.rs
│       │   ├── query.rs        # 各 query_name 的查询执行
│       │   ├── step.rs         # prepare/commit 核心逻辑
│       │   ├── objective.rs    # 规则匹配 + mutation 构建 + 事件构建
│       │   └── template.rs     # {{path}} 模板引擎
│       └── models/
│           ├── mod.rs
│           ├── state.rs        # AppState, SessionState, PreparedState
│           ├── entity.rs       # WorldEntity, EntityState
│           ├── authority.rs    # AuthorityGrant
│           ├── mediator.rs     # MediatorBinding
│           ├── execution.rs    # RuleExecutionRecord
│           ├── objective.rs    # 规则定义、mutation、event 类型
│           └── step.rs         # StepPrepare/Commit/Abort 的输入输出类型
├── scheduler-decision/         # 调度器决策侧车
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── lib.rs
│       ├── models.rs           # 所有 DTO
│       ├── kernel.rs           # evaluate 逻辑（拆分为子函数）
│       ├── policy.rs           # 策略辅助
│       └── conversion.rs       # From 实现（消除重复的 enum 转换）
└── memory-trigger/             # 内存触发侧车
    ├── Cargo.toml
    └── src/
        ├── main.rs
        ├── lib.rs
        ├── models.rs           # 所有 DTO（保持现有结构）
        ├── engine.rs           # 激活评估 + 状态转换
        ├── logic_dsl.rs        # 逻辑表达式 DSL
        ├── trigger.rs          # 触发器评估
        ├── sampling.rs         # FNV-1a 哈希采样
        └── source.rs           # evaluate 入口
```

**Cargo workspace 带来**:
- 共享 `sidecar-common` 消除 ~150 行重复的协议和传输代码
- 统一 `cargo build/test/clippy/fmt` 命令
- 统一的依赖版本管理

---

## 2. 共享库: `sidecar-common`

### 2.1 protocol.rs — 唯一的 JSON-RPC 类型定义

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub id: Option<Value>,
    pub method: String,
    pub params: Option<Value>,
}

#[derive(Debug, Serialize)]
pub struct RpcResponse {
    pub jsonrpc: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

pub fn rpc_result(id: Option<Value>, result: Value) -> RpcResponse {
    RpcResponse { jsonrpc: "2.0", id, result: Some(result), error: None }
}

pub fn rpc_error(id: Option<Value>, code: i32, message: &str, data: Option<Value>) -> RpcResponse {
    RpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(RpcError { code, message: message.to_string(), data }),
    }
}

/// JSON-RPC 标准错误码
pub const PARSE_ERROR: i32 = -32700;
pub const METHOD_NOT_FOUND: i32 = -32601;
pub const INVALID_PARAMS: i32 = -32602;
pub const INTERNAL_ERROR: i32 = -32603;
```

### 2.2 transport.rs — 唯一的 stdio 主循环

```rust
use crate::protocol::{rpc_error, RpcRequest, RpcResponse, PARSE_ERROR};
use serde_json::json;
use std::io::{self, BufRead, Write};
use std::time::Instant;

pub struct SidecarRuntime {
    started_at: Instant,
}

impl SidecarRuntime {
    pub fn new() -> Self {
        Self { started_at: Instant::now() }
    }

    pub fn uptime_ms(&self) -> u128 {
        self.started_at.elapsed().as_millis()
    }
}

/// 每个侧车实现此 trait
pub trait JsonRpcHandler {
    fn protocol_version(&self) -> &'static str;
    fn handle_request(
        &mut self,
        runtime: &SidecarRuntime,
        request: RpcRequest,
    ) -> RpcResponse;
}

/// 运行 stdio JSON-RPC 主循环。永不返回（stdin 关闭时正常退出）。
pub fn run_stdio_jsonrpc<H: JsonRpcHandler>(handler: &mut H) {
    let runtime = SidecarRuntime::new();
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(req) => handler.handle_request(&runtime, req),
            Err(e) => rpc_error(
                None,
                PARSE_ERROR,
                "parse error",
                Some(json!({ "message": e.to_string() })),
            ),
        };

        let payload = serde_json::to_string(&response).expect("failed to serialize response");
        writeln!(stdout, "{}", payload).expect("failed to write response");
        stdout.flush().expect("failed to flush stdout");
    }
}
```

### 2.3 types.rs — 共享基础类型

```rust
use serde::{Deserialize, Serialize};
use std::fmt;

/// Tick 类型：全局唯一的时钟 tick，正整数字符串 over JSON，内部 u64。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Tick(u64);

impl Tick {
    pub const ZERO: Tick = Tick(0);

    pub fn parse(s: &str) -> Result<Self, TickParseError> {
        s.parse::<u64>()
            .map(Tick)
            .map_err(|_| TickParseError { raw: s.to_string() })
    }

    pub fn as_u64(self) -> u64 { self.0 }

    pub fn checked_add(self, rhs: u64) -> Option<Self> {
        self.0.checked_add(rhs).map(Tick)
    }

    pub fn saturating_sub(self, rhs: u64) -> u64 {
        self.0.saturating_sub(rhs)
    }

    pub fn to_string(self) -> String {
        self.0.to_string()
    }
}

impl Serialize for Tick {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for Tick {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse::<u64>()
            .map(Tick)
            .map_err(serde::de::Error::custom)
    }
}

impl fmt::Display for Tick {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("invalid tick: {raw}")]
pub struct TickParseError {
    pub raw: String,
}
```

**效果**: 消除 `u64`/`i64`/`i128`/`String` 之间的 tick 类型混乱。所有 tick 解析错误都显式传播或记录。

---

## 3. World Engine 重设计

### 3.1 领域模型（不再使用 `Vec<Value>`）

```rust
// models/entity.rs

/// 世界实体：有类型、可过滤
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WorldEntity {
    pub id: String,
    pub entity_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    // 其他字段通过 serde(flatten) 保留但不单独检查
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

/// 实体状态：entity_id + state_namespace 唯一索引
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct EntityState {
    pub id: String,
    pub pack_id: String,
    pub entity_id: String,
    pub state_namespace: String,
    pub state_json: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}

// models/authority.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AuthorityGrant {
    pub grant_id: String,
    pub source_entity_id: String,
    pub capability_key: String,
    pub mediated_by_entity_id: Option<String>,
    pub status: String,
    pub target_selector_json: serde_json::Value,
    pub scope_json: serde_json::Value,
    pub conditions_json: serde_json::Value,
    pub grant_type: String,
    pub priority: i64,
    pub revocable: bool,
}

// models/mediator.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MediatorBinding {
    pub mediator_id: String,
    pub subject_entity_id: String,
    pub binding_kind: String,
    pub status: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

// models/execution.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RuleExecutionRecord {
    pub id: String,
    pub pack_id: String,
    pub rule_id: String,
    pub subject_entity_id: String,
    pub target_entity_id: String,
    pub execution_status: String,
    pub capability_key: Option<serde_json::Value>,
    pub mediator_id: Option<serde_json::Value>,
    pub payload_json: serde_json::Value,
    pub emitted_events_json: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}
```

**使用 `serde(flatten)` 保留额外字段**: `WorldEntity` 和 `MediatorBinding` 可能有 TS 侧添加的额外字段。`#[serde(flatten)]` 捕获它们到 `Map<String, Value>` 中，确保序列化往返不丢数据。

### 3.2 SessionState 重设计

```rust
// models/state.rs
use sidecar_common::types::Tick;

pub struct SessionState {
    pub mode: String,
    pub current_tick: Tick,
    pub current_revision: u64,
    pub pending_prepared_token: Option<String>,
    pub world_entities: Vec<WorldEntity>,
    pub entity_states: Vec<EntityState>,
    pub authority_grants: Vec<AuthorityGrant>,
    pub mediator_bindings: Vec<MediatorBinding>,
    pub rule_execution_records: Vec<RuleExecutionRecord>,
    pub prepared_state: Option<PreparedSessionState>,
}

pub struct AppState {
    pub started_at: Instant,
    pub sessions: HashMap<String, SessionState>,
    pub committed_ticks: CommittedTickCache,  // 独立类型，有自己的方法
}

/// 从 AppState 中分离，消除借用冲突
pub struct CommittedTickCache {
    entries: HashMap<(String, Tick), CommittedTickCacheEntry>,
}

impl CommittedTickCache {
    pub fn new() -> Self { ... }
    pub fn get(&self, pack_id: &str, tick: Tick) -> Option<&CommittedTickCacheEntry> { ... }
    pub fn insert(&mut self, pack_id: String, tick: Tick, entry: CommittedTickCacheEntry) { ... }
    pub fn prune(&mut self, current_tick: Tick, retain_ticks: u64) { ... }
}
```

**关键改进**: `CommittedTickCache` 从 `AppState` 中分离为独立类型。`handle_step_prepare` 中不再需要显式 scope block 来解决借用冲突——先借 cache 检查，再借 sessions 修改。两者是独立的字段借用。

### 3.3 函数分解示例: `handle_execute_objective`

当前 290 行的单体函数分解为:

```rust
// handlers/objective.rs — 薄层，约 30 行
pub fn handle_execute_objective(
    runtime: &SidecarRuntime,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let input = match parse_execute_objective_params(params) {
        Ok(i) => i,
        Err(e) => return rpc_error(request_id, INVALID_PARAMS, &e.to_string(), None),
    };

    match engine::objective::execute(input) {
        Ok(result) => rpc_result(request_id, serde_json::to_value(result).unwrap()),
        Err(ObjectiveError::NoRuleMatched { diagnostics }) => {
            rpc_error(request_id, 50001, "OBJECTIVE_RULE_NOT_FOUND", Some(serde_json::to_value(diagnostics).unwrap()))
        }
    }
}

// engine/objective.rs — 纯逻辑，可测试

#[derive(Debug, Deserialize)]
pub struct ExecuteObjectiveInput {
    pub pack_id: String,
    pub invocation: Invocation,
    pub effective_mediator_id: Option<String>,
    pub objective_rules: Vec<ObjectiveRule>,
    pub world_entities: Vec<WorldEntity>,
    pub pack_variables: Option<serde_json::Value>,
}

#[derive(Debug, thiserror::Error)]
pub enum ObjectiveError {
    #[error("no rule matched")]
    NoRuleMatched { diagnostics: NoMatchDiagnostics },
}

pub fn execute(input: ExecuteObjectiveInput) -> Result<ExecuteObjectiveOutput, ObjectiveError> {
    let template_ctx = build_template_context(&input);
    let target_kind = resolve_target_kind(&input);

    for rule in &input.objective_rules {
        if !rule_matches(&rule, &input, &target_kind) {
            continue;
        }
        return Ok(apply_rule(&rule, &input, &template_ctx));
    }

    Err(ObjectiveError::NoRuleMatched {
        diagnostics: NoMatchDiagnostics {
            evaluated_rule_count: input.objective_rules.len(),
            rendered_template_count: 0,
        },
    })
}

// 每个步骤都是独立的、有类型的函数
fn rule_matches(rule: &ObjectiveRule, input: &ExecuteObjectiveInput, target_kind: &Option<String>) -> bool { ... }
fn apply_rule(rule: &ObjectiveRule, input: &ExecuteObjectiveInput, ctx: &TemplateContext) -> ExecuteObjectiveOutput { ... }
fn build_mutations(rule: &ObjectiveRule, input: &ExecuteObjectiveInput, ctx: &TemplateContext) -> Vec<Mutation> { ... }
fn build_events(rule: &ObjectiveRule, ctx: &TemplateContext, artifact_id: &Option<String>) -> Vec<EmittedEvent> { ... }
```

### 3.4 查询引擎重构

当前 `handle_state_query` 是一个大 match。重构为:

```rust
// engine/query.rs

pub trait Query {
    type Output: Serialize;
    fn execute(&self, session: &SessionState) -> Self::Output;
}

pub struct PackSummaryQuery;
pub struct WorldEntitiesQuery { pub selector: Selector, pub limit: Option<usize> }
pub struct EntityStateQuery { pub entity_id: String, pub state_namespace: String }
pub struct AuthorityGrantsQuery { pub selector: Selector, pub limit: Option<usize> }
pub struct MediatorBindingsQuery { pub selector: Selector, pub limit: Option<usize> }
pub struct RuleExecutionSummaryQuery { pub selector: Selector, pub limit: Option<usize> }

impl Query for WorldEntitiesQuery {
    type Output = QueryResult<WorldEntity>;
    fn execute(&self, session: &SessionState) -> Self::Output {
        let items = filter_world_entities(&session.world_entities, &self.selector);
        let total = items.len();
        let items = apply_limit(items, self.limit);
        QueryResult { items, total_count: total }
    }
}
```

### 3.5 模板引擎修复

```rust
// engine/template.rs

/// 模板渲染的统计信息
pub struct RenderStats {
    pub substitutions: usize,  // 实际 {{...}} 替换次数
}

pub fn render_value(value: &Value, context: &Value) -> (Value, RenderStats) {
    match value {
        Value::String(s) if s.contains("{{") && s.contains("}}") => {
            let (rendered, count) = render_string_template(s, context);
            (Value::String(rendered), RenderStats { substitutions: count })
        }
        Value::Array(items) => {
            let (items, stats) = items.iter()
                .map(|v| render_value(v, context))
                .fold((Vec::new(), RenderStats { substitutions: 0 }), |(mut acc_v, mut acc_s), (v, s)| {
                    acc_v.push(v);
                    acc_s.substitutions += s.substitutions;
                    (acc_v, acc_s)
                });
            (Value::Array(items), stats)
        }
        Value::Object(map) => {
            let (map, stats) = map.iter()
                .map(|(k, v)| render_value(v, context).map(|(v, s)| ((k.clone(), v), s)))
                .fold(...);
            (Value::Object(map), stats)
        }
        _ => (value.clone(), RenderStats { substitutions: 0 }),
    }
}

// 快速路径：不包含 {{ 的值直接跳过递归
pub fn render_value(value: &Value, context: &Value) -> (Value, RenderStats) {
    if !needs_template(value) {
        return (value.clone(), RenderStats { substitutions: 0 });
    }
    render_value_impl(value, context)
}

fn needs_template(value: &Value) -> bool {
    match value {
        Value::String(s) => s.contains("{{") && s.contains("}}"),
        Value::Array(_) | Value::Object(_) => true,
        _ => false,
    }
}
```

**修复的 bug**: `rendered_template_count` 之前用 JSON 对象的 key 数量替代模板替换次数。现在 `RenderStats::substitutions` 精确计数 `{{...}}` 的解析和替换次数。

---

## 4. Scheduler Decision 重设计

### 4.1 消除 enum 转换重复

```rust
// conversion.rs

impl From<EventDrivenSchedulerReason> for SchedulerReason {
    fn from(reason: EventDrivenSchedulerReason) -> Self {
        match reason {
            EventDrivenSchedulerReason::EventFollowup => SchedulerReason::EventFollowup,
            EventDrivenSchedulerReason::RelationshipChangeFollowup => SchedulerReason::RelationshipChangeFollowup,
            EventDrivenSchedulerReason::SnrChangeFollowup => SchedulerReason::SnrChangeFollowup,
            EventDrivenSchedulerReason::OverlayChangeFollowup => SchedulerReason::OverlayChangeFollowup,
            EventDrivenSchedulerReason::MemoryChangeFollowup => SchedulerReason::MemoryChangeFollowup,
        }
    }
}
```

所有 7 处重复的转换都替换为 `.into()` 或 `SchedulerReason::from(reason)`。

### 4.2 `is_event_driven_reason` 修复

当前: `!is_periodic_reason(reason)` — 新 variant 被静默当作 event-driven。

修复为显式匹配:
```rust
pub fn is_event_driven_reason(reason: &SchedulerReason) -> bool {
    matches!(
        reason,
        SchedulerReason::EventFollowup
            | SchedulerReason::RelationshipChangeFollowup
            | SchedulerReason::SnrChangeFollowup
            | SchedulerReason::OverlayChangeFollowup
            | SchedulerReason::MemoryChangeFollowup
    )
}
```

### 4.3 候选键构造修复

当前: `format!("{}:{:?}:{:?}", ...)` 使用 Debug 格式。

修复: 为 `SchedulerKind` 和 `SchedulerReason` 实现 `Display`:
```rust
impl fmt::Display for SchedulerKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SchedulerKind::Periodic => write!(f, "periodic"),
            SchedulerKind::EventDriven => write!(f, "event_driven"),
        }
    }
}

impl fmt::Display for SchedulerReason { ... }

fn build_candidate_key(agent_id: &str, kind: SchedulerKind, reason: &SchedulerReason) -> String {
    format!("{}:{}:{}", agent_id, kind, reason)
}
```

### 4.4 `evaluate` 函数分解

```rust
// kernel.rs

pub fn evaluate(input: SchedulerKernelEvaluateInput) -> SchedulerKernelEvaluateOutput {
    let now = input.now_tick;
    let ctx = EvaluationContext::from_input(input, now);

    let periodic = build_periodic_candidates(&ctx);
    let event = merge_event_driven_signals(&ctx);
    let candidates = sort_candidates(periodic.into_iter().chain(event).collect());

    process_candidates(candidates, ctx)
}

struct EvaluationContext {
    now: Tick,
    cooldown_ticks: u64,
    max_per_tick: i64,
    max_candidates: i64,
    entity_single_flight_limit: i64,
    per_tick_activation_counts: HashMap<String, i64>,
    pending_intent_agent_ids: HashSet<String>,
    pending_job_keys: HashSet<String>,
    active_workflow_actor_ids: HashSet<String>,
    replay_recovery_actor_ids: HashSet<String>,
    retry_recovery_actor_ids: HashSet<String>,
    recent_scheduled_tick_by_agent: HashMap<String, Tick>,
    signal_policy: HashMap<EventDrivenSchedulerReason, SchedulerSignalPolicy>,
    recovery_suppression: HashMap<SchedulerRecoveryWindowType, SchedulerRecoverySuppressionPolicy>,
}

fn process_candidates(
    candidates: Vec<SchedulerCandidate>,
    mut ctx: EvaluationContext,
) -> SchedulerKernelEvaluateOutput { ... }

fn determine_skip_reason(
    candidate: &SchedulerCandidate,
    ctx: &EvaluationContext,
) -> Option<SchedulerSkipReason> { ... }
```

### 4.5 `merge_event_driven_signals` 去重修复

当前: 用 `Vec::contains` 去重，O(n²)。

修复: 用 `HashSet`:
```rust
fn merge_event_driven_signals(ctx: &EvaluationContext) -> Vec<SchedulerCandidate> {
    let mut grouped: HashMap<&str, HashSet<EventDrivenSchedulerReason>> = HashMap::new();
    for signal in &ctx.recent_signals {
        grouped.entry(signal.agent_id.as_str())
            .or_default()
            .insert(signal.reason.clone());
    }
    // ...
}
```

---

## 5. Memory Trigger 重设计

该侧车质量最好，改动最小:

### 5.1 `engine.rs` 状态转换修复

```rust
// 当前代码在 Active 分支中有冗余赋值
// 重构为清晰的转换函数

fn apply_active_transition(
    previous: &MemoryRuntimeStateDto,
    behavior: &MemoryBehaviorDto,
    current_tick: Tick,
) -> ActiveTransition {
    ActiveTransition {
        trigger_count: previous.trigger_count + 1,
        last_triggered_tick: Some(current_tick),
        last_inserted_tick: Some(current_tick),
        delayed_until_tick: compute_delayed_until(behavior, current_tick),
        retain_until_tick: compute_retain_until(behavior, current_tick),
        cooldown_until_tick: compute_cooldown_until(behavior, current_tick),
    }
}
```

### 5.2 tick 类型统一

`parse::<i128>()` 全部替换为 `Tick::parse()`。`trigger_count` 保持 `i64`(它是计数，不是 tick)。

### 5.3 `debug_resolve_memory_logic_path` 修复

`#[allow(dead_code)]` → `#[cfg(test)]`。

---

## 6. 错误处理策略

引入 `thiserror`，所有可恢复错误使用类型化错误:

```rust
// sidecar-common/src/error.rs
#[derive(Debug, thiserror::Error)]
pub enum SidecarError {
    #[error("pack not loaded: {pack_id}")]
    PackNotLoaded { pack_id: String },

    #[error("prepared step conflict: token {token:?}")]
    PreparedStepConflict { pack_id: String, token: Option<String> },

    #[error("prepared step not found: expected {expected}, got {got:?}")]
    PreparedStepNotFound { pack_id: String, expected: String, got: Option<String> },

    #[error("invalid tick: {raw}")]
    InvalidTick { raw: String },

    #[error("missing required field: {field}")]
    MissingField { field: String },
}

impl SidecarError {
    pub fn rpc_code(&self) -> i32 {
        match self {
            SidecarError::PackNotLoaded { .. } => 40401,
            SidecarError::PreparedStepConflict { .. } => 40901,
            SidecarError::PreparedStepNotFound { .. } => 40402,
            SidecarError::InvalidTick { .. } => -32602,
            SidecarError::MissingField { .. } => -32602,
        }
    }

    pub fn rpc_message(&self) -> String {
        // 映射到现有协议字符串
        match self {
            SidecarError::PackNotLoaded { .. } => "PACK_NOT_LOADED".to_string(),
            SidecarError::PreparedStepConflict { .. } => "PREPARED_STEP_CONFLICT".to_string(),
            SidecarError::PreparedStepNotFound { .. } => "PREPARED_STEP_NOT_FOUND".to_string(),
            SidecarError::InvalidTick { .. } => self.to_string(),
            SidecarError::MissingField { .. } => self.to_string(),
        }
    }
}
```

**不再有** `unwrap_or(0)` 静默吞掉解析错误。Tick 解析失败显式返回错误。

---

## 7. 测试策略

### 7.1 每层独立测试

| 层 | 测试内容 | 工具 |
|---|---|---|
| `sidecar-common` | transport, protocol | 单元测试 |
| `models/` | serde 往返序列化 | 单元测试 + insta snapshots |
| `engine/` | 纯业务逻辑 | 单元测试（无 I/O 依赖） |
| `handlers/` | 参数解析 + 错误映射 | 单元测试（构造 JSON params 输入） |
| 集成 | 完整 JSON-RPC 往返 | 集成测试（启动进程，发送 JSON，验证响应） |

### 7.2 测试覆盖目标

- world-engine `engine/` 模块: 100% 函数覆盖
- world-engine `handlers/` 模块: 所有错误路径
- scheduler-decision `kernel.rs`: 所有 skip reason 路径
- memory-trigger: 保持现有覆盖 + 新增模板引擎测试
- `template.rs`: 边界情况（嵌套 {{}}、缺失上下文、特殊字符）

### 7.3 测试辅助

```rust
// 测试中常用的 JSON params 构造
#[cfg(test)]
fn make_params(fields: &[(&str, Value)]) -> Value {
    json!(fields.iter().cloned().collect::<serde_json::Map<_, _>>())
}
```

---

## 8. 工具链配置

### 8.1 rustfmt.toml (workspace 根)

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

### 8.2 Cargo.toml [lints] (workspace 根)

```toml
[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
# 开启所有 lint 组
correctness = "deny"
suspicious = "deny"
complexity = "warn"
perf = "warn"
style = "warn"
pedantic = "warn"

# 允许太吵的 lint
module_name_repetitions = "allow"
must_use_candidate = "allow"
similar_names = "allow"
too_many_lines = "allow"  # 大 match 语句（如 handler 分发）是合理的
```

### 8.3 CI 集成

```bash
# 建议在 package.json 中添加:
# "check:rust": "cargo check --workspace",
# "lint:rust": "cargo clippy --workspace -- -D warnings",
# "fmt:rust": "cargo fmt --all -- --check",
# "test:rust": "cargo test --workspace",
# "build:rust": "cargo build --release --workspace"
```

---

## 9. 实现顺序

### Phase 1: 基础设施（1-2 天）

1. 创建 workspace `Cargo.toml`，移动现有 crate 到新目录结构
2. 创建 `sidecar-common` crate，实现 `protocol.rs`、`transport.rs`、`types.rs`
3. 配置 `rustfmt.toml` 和 `[lints]`
4. 运行 `cargo fmt`、`cargo clippy`，修复所有 lint 错误

### Phase 2: Memory Trigger 迁移（0.5 天）

1. 切换到 `sidecar-common` 的 protocol 和 transport
2. 修复 `engine.rs` 中的冗余赋值
3. 修复 `debug_resolve_memory_logic_path` 的 `dead_code` → `cfg(test)`
4. tick 类型统一为 `Tick`
5. 运行现有测试确保不退化

### Phase 3: Scheduler Decision 迁移（0.5 天）

1. 切换到 `sidecar-common`
2. 添加 `conversion.rs`（From 实现）
3. 修复候选键构造（Display 替代 Debug）
4. `is_event_driven_reason` 改为显式匹配
5. `merge_event_driven_signals` 去重用 HashSet
6. 分解 `evaluate` 函数
7. 编写测试

### Phase 4: World Engine 迁移（2-3 天）

1. 定义领域模型 structs（WorldEntity 等）
2. 重写 `AppState`/`SessionState`，分离 `CommittedTickCache`
3. 重写 `engine/query.rs` — Query trait + 各查询类型
4. 重写 `engine/step.rs` — 纯逻辑
5. 重写 `engine/objective.rs` — 规则匹配、mutation 构建、事件构建
6. 修复 `engine/template.rs` — 正确的渲染计数
7. 重写 `handlers/` — 薄参数提取 + 调用 engine
8. 重写 `main.rs` — 使用 `run_stdio_jsonrpc`
9. 编写所有测试

### Phase 5: 验证（0.5 天）

1. 运行完整测试套件: `cargo test --workspace`
2. 运行 clippy: `cargo clippy --workspace -- -D warnings`
3. 运行 fmt 检查: `cargo fmt --all -- --check`
4. TypeScript 端集成测试: `pnpm test:unit` + `pnpm test:integration`
5. 手动端到端验证: `pnpm dev` 并触发涉及侧车的操作

---

## 10. 命名约定

| 项目 | 命名 |
|---|---|
| crate 名 | `sidecar-common`, `world-engine`, `scheduler-decision`, `memory-trigger` |
| binary 名 (main.rs 中) | `world_engine_sidecar`, `scheduler_decision_sidecar`, `memory_trigger_sidecar` |
| 目录名 | `world-engine/`, `scheduler-decision/`, `memory-trigger/` |
| 类型后缀 | 不再使用 `Dto` 后缀 — Rust 类型不需要标记自己是 DTO。直接用 `WorldEntity`, `MemoryBlock` 等 |

---

## 11. 不做的优化（避免过度工程）

- **不用 async/await**: 三个侧车都是单线程、请求-响应模式。async 增加复杂度但零收益。
- **不用 trait 抽象查询过滤**: 6 个 query name 各写一个函数足够。引入 `Query` trait 只是为了组织代码和测试边界，不是为了多态。
- **不用 serde 的 `#[serde(borrow)]`**: 没有性能问题需要零拷贝反序列化。
- **不用自定义内存分配器**: std 分配器完全够用。
- **模板引擎不添加 filter/pipe 语法**: 保持 `{{path.to.value}}` 语法不变。TS 侧依赖这个语法。
