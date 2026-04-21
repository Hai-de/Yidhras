use crate::models::{AppState, SessionState};
use crate::protocol::{rpc_error, RpcResponse};
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn clone_array_field(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

pub fn extract_pack_snapshot(params: &Value) -> Option<&serde_json::Map<String, Value>> {
    params
        .get("hydrate")
        .and_then(Value::as_object)
        .and_then(|hydrate| hydrate.get("snapshot"))
        .and_then(Value::as_object)
}

pub fn extract_snapshot_clock(snapshot: &serde_json::Map<String, Value>) -> (String, String) {
    let current_tick = snapshot
        .get("clock")
        .and_then(Value::as_object)
        .and_then(|clock| clock.get("current_tick"))
        .and_then(Value::as_str)
        .unwrap_or("0")
        .to_string();
    let current_revision = snapshot
        .get("clock")
        .and_then(Value::as_object)
        .and_then(|clock| clock.get("current_revision"))
        .and_then(Value::as_str)
        .unwrap_or(current_tick.as_str())
        .to_string();
    (current_tick, current_revision)
}

pub fn build_pack_summary(session: &SessionState, pack_id: &str) -> Value {
    json!({
        "pack_id": pack_id,
        "transport": "rust-sidecar-session",
        "mode": session.mode,
        "current_tick": session.current_tick,
        "current_revision": session.current_revision,
        "world_entity_count": session.world_entities.len(),
        "entity_state_count": session.entity_states.len(),
        "authority_grant_count": session.authority_grants.len(),
        "mediator_binding_count": session.mediator_bindings.len(),
        "rule_execution_record_count": session.rule_execution_records.len(),
    })
}

pub fn find_entity_state(
    session: &SessionState,
    entity_id: &str,
    state_namespace: &str,
) -> Option<Value> {
    session
        .entity_states
        .iter()
        .find(|item| {
            item.get("entity_id").and_then(Value::as_str) == Some(entity_id)
                && item.get("state_namespace").and_then(Value::as_str) == Some(state_namespace)
        })
        .cloned()
}

pub fn find_entity_state_index(
    entity_states: &[Value],
    entity_id: &str,
    state_namespace: &str,
) -> Option<usize> {
    entity_states.iter().position(|item| {
        item.get("entity_id").and_then(Value::as_str) == Some(entity_id)
            && item.get("state_namespace").and_then(Value::as_str) == Some(state_namespace)
    })
}

pub fn build_runtime_step_state(
    previous_state: Option<&Value>,
    token: &str,
    reason: &str,
    step_ticks: &str,
    base_tick: &str,
    next_tick: &str,
    base_revision: &str,
    next_revision: &str,
) -> Value {
    let mut next_state = previous_state
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    next_state.insert(
        "runtime_step".to_string(),
        json!({
            "prepared_token": token,
            "reason": reason,
            "step_ticks": step_ticks,
            "base_tick": base_tick,
            "next_tick": next_tick,
            "base_revision": base_revision,
            "next_revision": next_revision,
            "transition_kind": "clock_advance",
            "session_owner": "rust_sidecar"
        }),
    );
    Value::Object(next_state)
}

pub fn upsert_entity_state(
    entity_states: &[Value],
    pack_id: &str,
    entity_id: &str,
    state_namespace: &str,
    next_revision: &str,
    state_json: &Value,
) -> Vec<Value> {
    let mut next_entity_states = entity_states.to_vec();

    if let Some(index) = find_entity_state_index(entity_states, entity_id, state_namespace) {
        if let Some(existing) = next_entity_states
            .get_mut(index)
            .and_then(Value::as_object_mut)
        {
            existing.insert("state_json".to_string(), state_json.clone());
            existing.insert(
                "updated_at".to_string(),
                Value::String(next_revision.to_string()),
            );
        }
        return next_entity_states;
    }

    next_entity_states.push(json!({
        "id": format!("runtime-state:{}:{}", entity_id, state_namespace),
        "pack_id": pack_id,
        "entity_id": entity_id,
        "state_namespace": state_namespace,
        "state_json": state_json,
        "created_at": next_revision,
        "updated_at": next_revision
    }));
    next_entity_states
}

pub fn parse_u64_or_default(value: &str, default: u64) -> u64 {
    value.parse::<u64>().unwrap_or(default)
}

pub fn get_selector_string(params: &Value, key: &str) -> Option<String> {
    params
        .get("selector")
        .and_then(Value::as_object)
        .and_then(|selector| selector.get(key))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn get_limit(params: &Value) -> Option<usize> {
    params.get("limit").and_then(Value::as_u64).and_then(|n| {
        if n > 0 {
            Some(n as usize)
        } else {
            None
        }
    })
}

pub fn get_selector_id_set(selector: &Value) -> Option<HashSet<String>> {
    let ids = selector.get("ids")?.as_array()?;
    let set: HashSet<String> = ids
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.is_empty())
        .collect();
    if set.is_empty() {
        None
    } else {
        Some(set)
    }
}

pub fn matches_selector_field(item: &Value, selector: &Value, key: &str) -> bool {
    let expected = selector.get(key).and_then(Value::as_str);
    match expected {
        Some(expected_val) if !expected_val.is_empty() => {
            item.get(key).and_then(Value::as_str) == Some(expected_val)
        }
        _ => true,
    }
}

pub fn filter_by_selector_fields(items: Vec<Value>, selector: &Value, keys: &[&str]) -> Vec<Value> {
    items
        .into_iter()
        .filter(|item| {
            keys.iter()
                .all(|key| matches_selector_field(item, selector, key))
        })
        .collect()
}

pub fn apply_limit(items: &mut Vec<Value>, limit: Option<usize>) {
    if let Some(lim) = limit {
        items.truncate(lim);
    }
}

pub fn session_or_error<'a>(
    state: &'a AppState,
    request_id: Option<Value>,
    pack_id: &str,
) -> Result<&'a SessionState, RpcResponse> {
    state.sessions.get(pack_id).ok_or_else(|| {
        rpc_error(
            request_id,
            40401,
            "PACK_NOT_LOADED",
            Some(json!({ "pack_id": pack_id })),
        )
    })
}

pub fn session_or_error_mut<'a>(
    state: &'a mut AppState,
    request_id: Option<Value>,
    pack_id: &str,
) -> Result<&'a mut SessionState, RpcResponse> {
    state.sessions.get_mut(pack_id).ok_or_else(|| {
        rpc_error(
            request_id,
            40401,
            "PACK_NOT_LOADED",
            Some(json!({ "pack_id": pack_id })),
        )
    })
}
