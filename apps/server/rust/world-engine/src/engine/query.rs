use crate::models::state::SessionState;
use serde_json::{json, Value};
use std::collections::HashSet;

pub fn query_pack_summary(session: &SessionState, pack_id: &str) -> Value {
    json!({
        "summary": {
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
        }
    })
}

pub fn query_world_entities(
    session: &SessionState,
    selector: &Value,
    limit: Option<usize>,
) -> Value {
    let mut items = session.world_entities.clone();
    if let Some(id_set) = get_selector_id_set(selector) {
        items.retain(|item| {
            item.get("id").and_then(Value::as_str).map(|id| id_set.contains(id)).unwrap_or(false)
        });
    }
    items = filter_by_selector_fields(items, selector, &["entity_kind", "entity_type"]);
    apply_limit(&mut items, limit);
    json!({
        "items": items,
        "total_count": items.len()
    })
}

pub fn query_entity_state(session: &SessionState, entity_id: &str, state_namespace: &str) -> Value {
    let state = find_entity_state(session, entity_id, state_namespace)
        .and_then(|item| item.get("state_json").cloned())
        .unwrap_or(Value::Null);
    json!({
        "entity_id": entity_id,
        "state_namespace": state_namespace,
        "state": state
    })
}

pub fn query_authority_grants(
    session: &SessionState,
    selector: &Value,
    limit: Option<usize>,
) -> Value {
    let mut items = filter_by_selector_fields(
        session.authority_grants.clone(),
        selector,
        &["source_entity_id", "capability_key", "mediated_by_entity_id", "status"],
    );
    apply_limit(&mut items, limit);
    json!({
        "items": items,
        "total_count": items.len()
    })
}

pub fn query_mediator_bindings(
    session: &SessionState,
    selector: &Value,
    limit: Option<usize>,
) -> Value {
    let mut items = filter_by_selector_fields(
        session.mediator_bindings.clone(),
        selector,
        &["mediator_id", "subject_entity_id", "binding_kind", "status"],
    );
    apply_limit(&mut items, limit);
    json!({
        "items": items,
        "total_count": items.len()
    })
}

pub fn query_rule_execution_summary(
    session: &SessionState,
    selector: &Value,
    limit: Option<usize>,
) -> Value {
    let mut items = filter_by_selector_fields(
        session.rule_execution_records.clone(),
        selector,
        &["rule_id", "subject_entity_id", "target_entity_id", "execution_status"],
    );
    apply_limit(&mut items, limit);
    json!({
        "items": items,
        "total_count": items.len()
    })
}

// Helpers

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

pub fn upsert_entity_state(
    entity_states: &[Value],
    pack_id: &str,
    entity_id: &str,
    state_namespace: &str,
    next_revision: &str,
    state_json: &Value,
) -> Vec<Value> {
    let mut next = entity_states.to_vec();

    if let Some(index) = find_entity_state_index(entity_states, entity_id, state_namespace) {
        if let Some(existing) = next.get_mut(index).and_then(Value::as_object_mut) {
            existing.insert("state_json".to_string(), state_json.clone());
            existing.insert("updated_at".to_string(), Value::String(next_revision.to_string()));
        }
        return next;
    }

    next.push(json!({
        "id": format!("runtime-state:{}:{}", entity_id, state_namespace),
        "pack_id": pack_id,
        "entity_id": entity_id,
        "state_namespace": state_namespace,
        "state_json": state_json,
        "created_at": next_revision,
        "updated_at": next_revision
    }));
    next
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
    let mut next_state = previous_state.and_then(Value::as_object).cloned().unwrap_or_default();
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

pub fn parse_u64_or_default(value: &str, default: u64) -> u64 {
    value.parse::<u64>().unwrap_or(default)
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
        .filter(|item| keys.iter().all(|key| matches_selector_field(item, selector, key)))
        .collect()
}

pub fn apply_limit(items: &mut Vec<Value>, limit: Option<usize>) {
    if let Some(lim) = limit {
        items.truncate(lim);
    }
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
