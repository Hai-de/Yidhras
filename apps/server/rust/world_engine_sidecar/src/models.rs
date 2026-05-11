use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone)]
pub struct PreparedStepSummary {
    pub applied_rule_count: usize,
    pub event_count: usize,
    pub mutated_entity_count: usize,
}

#[derive(Debug, Clone)]
pub struct PreparedStepArtifacts {
    pub rule_execution_record: Value,
    pub next_world_state: Value,
}

#[derive(Debug, Clone)]
pub struct PreparedSessionState {
    pub token: String,
    pub next_tick: String,
    pub next_revision: String,
    pub emitted_events: Vec<Value>,
    pub observability: Vec<Value>,
    pub summary: PreparedStepSummary,
    pub world_entities: Vec<Value>,
    pub entity_states: Vec<Value>,
    pub authority_grants: Vec<Value>,
    pub mediator_bindings: Vec<Value>,
    pub rule_execution_records: Vec<Value>,
    pub artifacts: PreparedStepArtifacts,
}

#[derive(Debug, Clone)]
pub struct SessionState {
    pub mode: String,
    pub current_tick: String,
    pub current_revision: String,
    pub pending_prepared_token: Option<String>,
    pub world_entities: Vec<Value>,
    pub entity_states: Vec<Value>,
    pub authority_grants: Vec<Value>,
    pub mediator_bindings: Vec<Value>,
    pub rule_execution_records: Vec<Value>,
    pub prepared_state: Option<PreparedSessionState>,
}

#[derive(Debug, Clone)]
pub struct CommittedTickCacheEntry {
    pub next_revision: String,
    pub emitted_events: Vec<Value>,
    pub observability: Vec<Value>,
    pub summary: PreparedStepSummary,
    pub artifacts: PreparedStepArtifacts,
}

pub struct AppState {
    pub started_at: Instant,
    pub sessions: HashMap<String, SessionState>,
    /// Multi-worker idempotency: caches committed (pack_id, tick) results.
    /// When a second worker calls prepare for the same (pack_id, tick),
    /// the cached result is returned without re-executing mutations.
    pub committed_ticks: HashMap<(String, String), CommittedTickCacheEntry>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            sessions: HashMap::new(),
            committed_ticks: HashMap::new(),
        }
    }

    /// Clean committed_ticks entries older than `retain_ticks` from the given tick.
    pub fn prune_committed_ticks(&mut self, current_tick: u64, retain_ticks: u64) {
        let cutoff = if current_tick > retain_ticks { current_tick - retain_ticks } else { 0 };
        self.committed_ticks.retain(|(_pack_id, tick_str), _value| {
            tick_str.parse::<u64>().unwrap_or(0) >= cutoff
        });
    }
}
