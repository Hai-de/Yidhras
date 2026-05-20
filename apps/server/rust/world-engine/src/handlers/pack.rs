use crate::engine::query::{extract_pack_snapshot, extract_snapshot_clock};
use crate::models::state::{AppState, SessionState};
use serde_json::{json, Value};
use sidecar_common::protocol::{rpc_error, rpc_result, RpcResponse, INVALID_PARAMS};

const PROTOCOL_VERSION: &str = "world_engine/v1alpha1";

fn get_required_string<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("missing required string field: {key}"))
}

fn get_optional_string(params: &Value, key: &str) -> Option<String> {
    params.get(key).and_then(Value::as_str).map(|v| v.to_string())
}

fn clone_array_field(value: Option<&Value>) -> Vec<Value> {
    value.and_then(Value::as_array).cloned().unwrap_or_default()
}

pub fn handle_pack_load(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    let mode = get_optional_string(params, "mode").unwrap_or_else(|| "active".to_string());
    let snapshot = extract_pack_snapshot(params);
    let (current_tick, current_revision) =
        snapshot.map(extract_snapshot_clock).unwrap_or_else(|| ("0".to_string(), "0".to_string()));
    let world_entities =
        snapshot.map(|item| clone_array_field(item.get("world_entities"))).unwrap_or_default();
    let entity_states =
        snapshot.map(|item| clone_array_field(item.get("entity_states"))).unwrap_or_default();
    let authority_grants =
        snapshot.map(|item| clone_array_field(item.get("authority_grants"))).unwrap_or_default();
    let mediator_bindings =
        snapshot.map(|item| clone_array_field(item.get("mediator_bindings"))).unwrap_or_default();
    let rule_execution_records = snapshot
        .map(|item| clone_array_field(item.get("rule_execution_records")))
        .unwrap_or_default();

    let session = state.sessions.entry(pack_id.clone()).or_insert(SessionState {
        mode: mode.clone(),
        current_tick: current_tick.clone(),
        current_revision: current_revision.clone(),
        pending_prepared_token: None,
        world_entities: world_entities.clone(),
        entity_states: entity_states.clone(),
        authority_grants: authority_grants.clone(),
        mediator_bindings: mediator_bindings.clone(),
        rule_execution_records: rule_execution_records.clone(),
        prepared_state: None,
    });
    session.mode = mode.clone();
    session.current_tick = current_tick;
    session.current_revision = current_revision;
    session.world_entities = world_entities;
    session.entity_states = entity_states;
    session.authority_grants = authority_grants;
    session.mediator_bindings = mediator_bindings;
    session.rule_execution_records = rule_execution_records;
    session.pending_prepared_token = None;
    session.prepared_state = None;

    rpc_result(
        request_id,
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "pack_id": pack_id,
            "mode": mode,
            "session_status": "ready",
            "hydrated_from_persistence": snapshot.is_some(),
            "current_tick": session.current_tick,
            "current_revision": session.current_revision
        }),
    )
}

pub fn handle_pack_unload(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    state.sessions.remove(&pack_id);
    rpc_result(
        request_id,
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "acknowledged": true,
            "pack_id": pack_id,
            "message": "unloaded"
        }),
    )
}

pub fn handle_status_get(
    state: &AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    if let Some(session) = state.sessions.get(&pack_id) {
        rpc_result(
            request_id,
            json!({
                "protocol_version": PROTOCOL_VERSION,
                "pack_id": pack_id,
                "mode": session.mode,
                "session_status": "ready",
                "runtime_ready": true,
                "current_tick": session.current_tick,
                "current_revision": session.current_revision,
                "pending_prepared_token": session.pending_prepared_token,
                "message": null
            }),
        )
    } else {
        rpc_result(
            request_id,
            json!({
                "protocol_version": PROTOCOL_VERSION,
                "pack_id": pack_id,
                "mode": "experimental",
                "session_status": "not_loaded",
                "runtime_ready": false,
                "current_tick": null,
                "current_revision": null,
                "pending_prepared_token": null,
                "message": "Pack session is not loaded"
            }),
        )
    }
}
