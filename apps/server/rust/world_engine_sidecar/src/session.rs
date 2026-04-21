use crate::models::AppState;
use crate::protocol::{
    get_optional_string, get_required_string, rpc_error, rpc_result, RpcResponse,
};
use crate::state::{
    apply_limit, build_pack_summary, clone_array_field, extract_pack_snapshot,
    extract_snapshot_clock, filter_by_selector_fields, find_entity_state, get_limit,
    get_selector_id_set, get_selector_string, session_or_error,
};
use crate::PROTOCOL_VERSION;
use serde_json::{json, Value};

use crate::models::SessionState;

pub fn handle_pack_load(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let mode = get_optional_string(params, "mode").unwrap_or_else(|| "active".to_string());
    let snapshot = extract_pack_snapshot(params);
    let (current_tick, current_revision) = snapshot
        .map(extract_snapshot_clock)
        .unwrap_or_else(|| ("0".to_string(), "0".to_string()));
    let world_entities = snapshot
        .map(|item| clone_array_field(item.get("world_entities")))
        .unwrap_or_default();
    let entity_states = snapshot
        .map(|item| clone_array_field(item.get("entity_states")))
        .unwrap_or_default();
    let authority_grants = snapshot
        .map(|item| clone_array_field(item.get("authority_grants")))
        .unwrap_or_default();
    let mediator_bindings = snapshot
        .map(|item| clone_array_field(item.get("mediator_bindings")))
        .unwrap_or_default();
    let rule_execution_records = snapshot
        .map(|item| clone_array_field(item.get("rule_execution_records")))
        .unwrap_or_default();
    let session = state
        .sessions
        .entry(pack_id.clone())
        .or_insert(SessionState {
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
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
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
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
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

pub fn handle_state_query(
    state: &AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let query_name = match get_required_string(params, "query_name") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let session = match session_or_error(state, request_id.clone(), &pack_id) {
        Ok(session) => session,
        Err(response) => return response,
    };

    let selector = params.get("selector").unwrap_or(&Value::Null);
    let limit = get_limit(params);

    let data = match query_name.as_str() {
        "pack_summary" => {
            json!({
                "summary": build_pack_summary(session, &pack_id)
            })
        }
        "world_entities" => {
            let mut items = session.world_entities.clone();
            if let Some(id_set) = get_selector_id_set(selector) {
                items.retain(|item| {
                    item.get("id")
                        .and_then(Value::as_str)
                        .map(|id| id_set.contains(id))
                        .unwrap_or(false)
                });
            }
            items = filter_by_selector_fields(items, selector, &["entity_kind", "entity_type"]);
            apply_limit(&mut items, limit);
            json!({
                "items": items,
                "total_count": items.len()
            })
        }
        "entity_state" => {
            let entity_id = match get_selector_string(params, "entity_id") {
                Some(value) => value,
                None => {
                    return rpc_error(
                        request_id,
                        -32602,
                        "INVALID_QUERY",
                        Some(json!({ "pack_id": pack_id, "reason": "entity_id is required" })),
                    )
                }
            };
            let state_namespace = match get_selector_string(params, "state_namespace") {
                Some(value) => value,
                None => {
                    return rpc_error(
                        request_id,
                        -32602,
                        "INVALID_QUERY",
                        Some(
                            json!({ "pack_id": pack_id, "reason": "state_namespace is required" }),
                        ),
                    )
                }
            };
            let state = find_entity_state(session, &entity_id, &state_namespace)
                .and_then(|item| item.get("state_json").cloned())
                .unwrap_or(Value::Null);
            json!({
                "entity_id": entity_id,
                "state_namespace": state_namespace,
                "state": state
            })
        }
        "authority_grants" => {
            let mut items = filter_by_selector_fields(
                session.authority_grants.clone(),
                selector,
                &[
                    "source_entity_id",
                    "capability_key",
                    "mediated_by_entity_id",
                    "status",
                ],
            );
            apply_limit(&mut items, limit);
            json!({
                "items": items,
                "total_count": items.len()
            })
        }
        "mediator_bindings" => {
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
        "rule_execution_summary" => {
            let mut items = filter_by_selector_fields(
                session.rule_execution_records.clone(),
                selector,
                &[
                    "rule_id",
                    "subject_entity_id",
                    "target_entity_id",
                    "execution_status",
                ],
            );
            apply_limit(&mut items, limit);
            json!({
                "items": items,
                "total_count": items.len()
            })
        }
        _ => {
            return rpc_error(
                request_id,
                -32602,
                "INVALID_QUERY",
                Some(json!({ "pack_id": pack_id, "query_name": query_name })),
            )
        }
    };

    rpc_result(
        request_id,
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "pack_id": pack_id,
            "query_name": query_name,
            "current_tick": session.current_tick,
            "current_revision": session.current_revision,
            "data": data,
            "next_cursor": null,
            "warnings": []
        }),
    )
}
