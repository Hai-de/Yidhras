use crate::models::{CommittedTickCacheEntry, PreparedSessionState};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;

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
    pub committed_ticks: CommittedTickCache,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            sessions: HashMap::new(),
            committed_ticks: CommittedTickCache::new(),
        }
    }
}

pub struct CommittedTickCache {
    entries: HashMap<(String, String), CommittedTickCacheEntry>,
}

impl CommittedTickCache {
    pub fn new() -> Self {
        Self { entries: HashMap::new() }
    }

    pub fn get(&self, pack_id: &str, tick: &str) -> Option<&CommittedTickCacheEntry> {
        self.entries.get(&(pack_id.to_string(), tick.to_string()))
    }

    pub fn insert(&mut self, pack_id: String, tick: String, entry: CommittedTickCacheEntry) {
        self.entries.insert((pack_id, tick), entry);
    }

    pub fn prune(&mut self, current_tick: u64, retain_ticks: u64) {
        let cutoff = current_tick.saturating_sub(retain_ticks);
        self.entries
            .retain(|(_pack_id, tick_str), _value| tick_str.parse::<u64>().unwrap_or(0) >= cutoff);
    }
}
