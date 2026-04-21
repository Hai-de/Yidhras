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

pub struct AppState {
    pub started_at: Instant,
    pub sessions: HashMap<String, SessionState>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            sessions: HashMap::new(),
        }
    }
}
