use crate::engine::step::{
    cache_committed_tick, check_committed_cache, do_abort_step, do_commit_step, do_prepare_step,
};
use crate::models::state::AppState;
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

pub fn handle_step_prepare(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    let step_ticks = match get_required_string(params, "step_ticks") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    let step_ticks_number = step_ticks.parse::<u64>().unwrap_or(1);

    // Check committed cache first (independent borrow)
    {
        let session = match state.sessions.get(&pack_id) {
            Some(s) => s,
            None => {
                return rpc_error(
                    request_id,
                    40401,
                    "PACK_NOT_LOADED",
                    Some(json!({"pack_id": pack_id})),
                )
            }
        };
        let current_tick = session.current_tick.parse::<u64>().unwrap_or(0);
        let next_tick = (current_tick + step_ticks_number).to_string();
        if let Some(cached) = check_committed_cache(state, &pack_id, &next_tick, session) {
            return rpc_result(
                request_id,
                json!({
                    "prepared_token": format!("prepared:{pack_id}:{next_tick}"),
                    "pack_id": pack_id,
                    "base_revision": session.current_revision,
                    "next_revision": cached.next_revision,
                    "next_tick": next_tick,
                    "cached": true,
                    "state_delta": {
                        "operations": [
                            {
                                "op": "upsert_entity_state",
                                "target_ref": "__world__",
                                "namespace": "world",
                                "payload": {
                                    "next": cached.artifacts.next_world_state,
                                    "previous": json!({}),
                                    "reason": "cached_replay"
                                }
                            },
                            {
                                "op": "append_rule_execution",
                                "target_ref": "__world__",
                                "namespace": "rule_execution_records",
                                "payload": {
                                    "next": cached.artifacts.rule_execution_record,
                                    "reason": "cached_replay"
                                }
                            },
                            {
                                "op": "set_clock",
                                "payload": {
                                    "next": {
                                        "previous_tick": session.current_tick,
                                        "next_tick": next_tick,
                                        "previous_revision": session.current_revision,
                                        "next_revision": cached.next_revision
                                    },
                                    "reason": "cached_replay"
                                }
                            }
                        ]
                    }
                }),
            );
        }
    }

    let session = match state.sessions.get_mut(&pack_id) {
        Some(s) => s,
        None => {
            return rpc_error(
                request_id,
                40401,
                "PACK_NOT_LOADED",
                Some(json!({"pack_id": pack_id})),
            )
        }
    };

    if session.pending_prepared_token.is_some() || session.prepared_state.is_some() {
        let current_token = session.pending_prepared_token.clone();
        return rpc_error(
            request_id,
            40901,
            "PREPARED_STEP_CONFLICT",
            Some(json!({"pack_id": pack_id, "prepared_token": current_token})),
        );
    }

    let reason = params.get("reason").and_then(Value::as_str).unwrap_or("runtime_loop");
    let pack_id_clone = pack_id.clone();
    let prepared_state = do_prepare_step(session, &pack_id_clone, &step_ticks, reason);

    let previous_world_state =
        crate::engine::query::find_entity_state(session, "__world__", "world")
            .and_then(|item| item.get("state_json").cloned());

    rpc_result(
        request_id,
        json!({
            "prepared_token": prepared_state.token,
            "pack_id": pack_id,
            "base_revision": session.current_revision,
            "next_revision": prepared_state.next_revision,
            "next_tick": prepared_state.next_tick,
            "state_delta": {
                "operations": [
                    {
                        "op": "upsert_entity_state",
                        "target_ref": "__world__",
                        "namespace": "world",
                        "payload": {
                            "next": prepared_state.artifacts.next_world_state,
                            "previous": previous_world_state.unwrap_or_else(|| json!({})),
                            "reason": reason
                        }
                    },
                    {
                        "op": "append_rule_execution",
                        "target_ref": "__world__",
                        "namespace": "rule_execution_records",
                        "payload": {
                            "next": prepared_state.artifacts.rule_execution_record,
                            "reason": reason
                        }
                    },
                    {
                        "op": "set_clock",
                        "payload": {
                            "next": {
                                "previous_tick": session.current_tick,
                                "next_tick": prepared_state.next_tick,
                                "previous_revision": session.current_revision,
                                "next_revision": prepared_state.next_revision
                            },
                            "reason": reason
                        }
                    }
                ],
                "metadata": {
                    "adapter": "rust_sidecar_session",
                    "reason": reason,
                    "pack_id": pack_id,
                    "base_tick": session.current_tick,
                    "next_tick": prepared_state.next_tick,
                    "base_revision": session.current_revision,
                    "next_revision": prepared_state.next_revision,
                    "mutated_entity_ids": ["__world__"],
                    "mutated_namespace_refs": ["__world__/world", "rule_execution_records"],
                    "delta_operation_count": 3,
                    "mutated_core_collections": ["entity_states", "rule_execution_records"]
                }
            },
            "emitted_events": prepared_state.emitted_events,
            "observability": prepared_state.observability,
            "summary": {
                "applied_rule_count": prepared_state.summary.applied_rule_count,
                "event_count": prepared_state.summary.event_count,
                "mutated_entity_count": prepared_state.summary.mutated_entity_count
            }
        }),
    )
}

pub fn handle_step_commit(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    let prepared_token = match get_required_string(params, "prepared_token") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    let persisted_revision = match get_required_string(params, "persisted_revision") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };

    let session = match state.sessions.get_mut(&pack_id) {
        Some(s) => s,
        None => {
            return rpc_error(
                request_id,
                40401,
                "PACK_NOT_LOADED",
                Some(json!({"pack_id": pack_id})),
            )
        }
    };

    let prepared_state =
        match do_commit_step(session, &pack_id, &prepared_token, &persisted_revision) {
            Some(ps) => ps,
            None => {
                return rpc_error(
                    request_id,
                    40402,
                    "PREPARED_STEP_NOT_FOUND",
                    Some(json!({"pack_id": pack_id, "prepared_token": prepared_token})),
                )
            }
        };

    let commit_observability = json!({
        "record_id": format!("obs:{}:committed", prepared_state.token),
        "pack_id": pack_id,
        "kind": "diagnostic",
        "level": "info",
        "code": "WORLD_STEP_COMMITTED",
        "message": "Committed world step transition",
        "recorded_at_tick": prepared_state.next_tick,
        "attributes": {
            "prepared_token": prepared_state.token,
            "committed_revision": persisted_revision,
            "committed_tick": prepared_state.next_tick,
            "mutated_entity_count": prepared_state.summary.mutated_entity_count,
            "emitted_event_count": prepared_state.summary.event_count
        }
    });

    cache_committed_tick(
        state,
        pack_id.clone(),
        prepared_state.next_tick.clone(),
        persisted_revision.clone(),
        &prepared_state,
    );

    rpc_result(
        request_id,
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "pack_id": pack_id,
            "prepared_token": prepared_token,
            "committed_revision": persisted_revision,
            "committed_tick": prepared_state.next_tick,
            "emitted_events": prepared_state.emitted_events,
            "observability": prepared_state.observability,
            "commit_observability": [commit_observability],
            "summary": {
                "applied_rule_count": prepared_state.summary.applied_rule_count,
                "event_count": prepared_state.summary.event_count,
                "mutated_entity_count": prepared_state.summary.mutated_entity_count
            }
        }),
    )
}

pub fn handle_step_abort(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(v) => v.to_string(),
        Err(msg) => return rpc_error(request_id, INVALID_PARAMS, &msg, None),
    };
    let prepared_token =
        get_optional_string(params, "prepared_token").unwrap_or_else(|| "unknown".to_string());
    let abort_reason =
        get_optional_string(params, "reason").unwrap_or_else(|| "aborted".to_string());

    let session = match state.sessions.get_mut(&pack_id) {
        Some(s) => s,
        None => {
            return rpc_error(
                request_id,
                40401,
                "PACK_NOT_LOADED",
                Some(json!({"pack_id": pack_id})),
            )
        }
    };
    do_abort_step(session);

    rpc_result(
        request_id,
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "abort_observability": [{
                "record_id": format!("obs:{prepared_token}:aborted"),
                "pack_id": pack_id,
                "kind": "diagnostic",
                "level": "warning",
                "code": "WORLD_STEP_ABORTED",
                "message": "Aborted world step transition",
                "attributes": {
                    "prepared_token": prepared_token,
                    "reason": abort_reason,
                    "transition_kind": "clock_advance",
                    "affected_entity_ids": ["__world__"],
                    "affected_entity_count": 1
                }
            }],
            "acknowledged": true,
            "pack_id": pack_id,
            "message": "aborted"
        }),
    )
}
