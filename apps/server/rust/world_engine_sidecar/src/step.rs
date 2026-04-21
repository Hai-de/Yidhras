use crate::models::{AppState, PreparedSessionState, PreparedStepArtifacts, PreparedStepSummary};
use crate::protocol::{
    get_optional_string, get_required_string, rpc_error, rpc_result, RpcResponse,
};
use crate::state::{
    build_runtime_step_state, find_entity_state, parse_u64_or_default, session_or_error_mut,
    upsert_entity_state,
};
use crate::PROTOCOL_VERSION;
use serde_json::{json, Value};

pub fn append_rule_execution_record(
    rule_execution_records: &[Value],
    pack_id: &str,
    record_id: &str,
    next_revision: &str,
    payload_json: &Value,
    emitted_events_json: &[Value],
) -> Vec<Value> {
    let mut next_records = rule_execution_records.to_vec();
    next_records.push(json!({
        "id": record_id,
        "pack_id": pack_id,
        "rule_id": "world_step.advance_clock",
        "capability_key": Value::Null,
        "mediator_id": Value::Null,
        "subject_entity_id": "__world__",
        "target_entity_id": "__world__",
        "execution_status": "applied",
        "payload_json": payload_json,
        "emitted_events_json": emitted_events_json,
        "created_at": next_revision,
        "updated_at": next_revision
    }));
    next_records
}

pub fn build_world_step_execution_record(
    token: &str,
    reason: &str,
    base_tick: &str,
    next_tick: &str,
    base_revision: &str,
    next_revision: &str,
) -> Value {
    json!({
        "prepared_token": token,
        "reason": reason,
        "transition_kind": "clock_advance",
        "base_tick": base_tick,
        "next_tick": next_tick,
        "base_revision": base_revision,
        "next_revision": next_revision
    })
}

pub fn build_prepared_step_event(
    pack_id: &str,
    token: &str,
    reason: &str,
    emitted_at_tick: &str,
    emitted_at_revision: &str,
) -> Value {
    json!({
        "event_id": format!("world-step-prepared:{}", token),
        "pack_id": pack_id,
        "event_type": "world.step.prepared",
        "emitted_at_tick": emitted_at_tick,
        "emitted_at_revision": emitted_at_revision,
        "entity_id": "__world__",
        "refs": {
            "prepared_token": token,
            "reason": reason,
            "entity_id": "__world__"
        },
        "payload": {
            "transition_kind": "clock_advance",
            "reason": reason,
            "affected_entity_ids": ["__world__"]
        }
    })
}

pub fn build_prepared_step_observability(
    pack_id: &str,
    token: &str,
    reason: &str,
    step_ticks: &str,
    base_tick: &str,
    next_tick: &str,
    base_revision: &str,
    next_revision: &str,
    event_count: usize,
    mutated_entity_count: usize,
    delta_operation_count: usize,
) -> Vec<Value> {
    vec![
        json!({
            "record_id": format!("obs:{}:prepared", token),
            "pack_id": pack_id,
            "kind": "diagnostic",
            "level": "info",
            "code": "WORLD_STEP_PREPARED",
            "message": "Prepared world step transition",
            "recorded_at_tick": next_tick,
            "attributes": {
                "prepared_token": token,
                "reason": reason,
                "step_ticks": step_ticks,
                "base_tick": base_tick,
                "next_tick": next_tick,
                "base_revision": base_revision,
                "next_revision": next_revision,
                "transition_kind": "clock_advance",
                "affected_entity_ids": ["__world__"],
                "affected_entity_count": mutated_entity_count,
                "emitted_event_count": event_count
            }
        }),
        json!({
            "record_id": format!("obs:{}:core-delta-built", token),
            "pack_id": pack_id,
            "kind": "diagnostic",
            "level": "info",
            "code": "WORLD_CORE_DELTA_BUILT",
            "message": "Built prepared Pack Runtime Core delta",
            "recorded_at_tick": next_tick,
            "attributes": {
                "prepared_token": token,
                "reason": reason,
                "base_tick": base_tick,
                "next_tick": next_tick,
                "base_revision": base_revision,
                "next_revision": next_revision,
                "delta_operation_count": delta_operation_count,
                "mutated_entity_ids": ["__world__"],
                "mutated_namespace_refs": ["__world__/world", "rule_execution_records"],
                "mutated_core_collections": ["entity_states", "rule_execution_records"],
                "appended_rule_execution_id": format!("world-step:{}", token)
            }
        }),
        json!({
            "record_id": format!("obs:{}:prepared-state-summary", token),
            "pack_id": pack_id,
            "kind": "diagnostic",
            "level": "info",
            "code": "WORLD_PREPARED_STATE_SUMMARY",
            "message": "Prepared state summary for Pack Runtime Core",
            "recorded_at_tick": next_tick,
            "attributes": {
                "prepared_token": token,
                "mutated_entity_count": mutated_entity_count,
                "event_count": event_count,
                "delta_operation_count": delta_operation_count,
                "mutated_entity_ids": ["__world__"],
                "mutated_namespace_refs": ["__world__/world", "rule_execution_records"]
            }
        }),
    ]
}

pub fn build_prepared_step_summary(
    event_count: usize,
    mutated_entity_count: usize,
) -> PreparedStepSummary {
    PreparedStepSummary {
        applied_rule_count: 0,
        event_count,
        mutated_entity_count,
    }
}

pub fn prepared_step_summary_to_json(summary: &PreparedStepSummary) -> Value {
    json!({
        "applied_rule_count": summary.applied_rule_count,
        "event_count": summary.event_count,
        "mutated_entity_count": summary.mutated_entity_count
    })
}

pub fn handle_step_prepare(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let step_ticks = match get_required_string(params, "step_ticks") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let step_ticks_number = step_ticks.parse::<u64>().unwrap_or(1);
    let session = match session_or_error_mut(state, request_id.clone(), &pack_id) {
        Ok(session) => session,
        Err(response) => return response,
    };
    if session.pending_prepared_token.is_some() || session.prepared_state.is_some() {
        let current_token = session.pending_prepared_token.clone();
        return rpc_error(
            request_id,
            40901,
            "PREPARED_STEP_CONFLICT",
            Some(json!({ "pack_id": pack_id, "prepared_token": current_token })),
        );
    }

    let current_tick_number = session.current_tick.parse::<u64>().unwrap_or(0);
    let next_tick = (current_tick_number + step_ticks_number).to_string();
    let token = format!("prepared:{}:{}", pack_id, next_tick);
    let current_revision_number =
        parse_u64_or_default(&session.current_revision, current_tick_number);
    let next_revision = (current_revision_number + step_ticks_number).to_string();
    let previous_world_state = find_entity_state(session, "__world__", "world")
        .and_then(|item| item.get("state_json").cloned());
    let reason = params
        .get("reason")
        .and_then(Value::as_str)
        .unwrap_or("runtime_loop");
    let next_world_state = build_runtime_step_state(
        previous_world_state.as_ref(),
        &token,
        reason,
        &step_ticks,
        &session.current_tick,
        &next_tick,
        &session.current_revision,
        &next_revision,
    );
    let rule_execution_payload = build_world_step_execution_record(
        &token,
        reason,
        &session.current_tick,
        &next_tick,
        &session.current_revision,
        &next_revision,
    );
    let next_entity_states = upsert_entity_state(
        &session.entity_states,
        &pack_id,
        "__world__",
        "world",
        &next_revision,
        &next_world_state,
    );
    let rule_execution_record_id = format!("world-step:{}", token);
    let emitted_events = vec![build_prepared_step_event(
        &pack_id,
        &token,
        reason,
        &next_tick,
        &next_revision,
    )];
    let next_rule_execution_records = append_rule_execution_record(
        &session.rule_execution_records,
        &pack_id,
        &rule_execution_record_id,
        &next_revision,
        &rule_execution_payload,
        &emitted_events,
    );
    let observability = build_prepared_step_observability(
        &pack_id,
        &token,
        reason,
        &step_ticks,
        &session.current_tick,
        &next_tick,
        &session.current_revision,
        &next_revision,
        emitted_events.len(),
        2,
        3,
    );
    let summary = build_prepared_step_summary(emitted_events.len(), 2);
    let prepared_state = PreparedSessionState {
        token: token.clone(),
        next_tick: next_tick.clone(),
        next_revision: next_revision.clone(),
        emitted_events: emitted_events.clone(),
        observability: observability.clone(),
        summary: summary.clone(),
        world_entities: session.world_entities.clone(),
        entity_states: next_entity_states,
        authority_grants: session.authority_grants.clone(),
        mediator_bindings: session.mediator_bindings.clone(),
        rule_execution_records: next_rule_execution_records,
        artifacts: PreparedStepArtifacts {
            rule_execution_record: json!({
                "id": rule_execution_record_id,
                "payload_json": rule_execution_payload,
            }),
            next_world_state: next_world_state.clone(),
        },
    };
    session.pending_prepared_token = Some(token.clone());
    session.prepared_state = Some(prepared_state.clone());

    rpc_result(
        request_id,
        json!({
            "prepared_token": token,
            "pack_id": pack_id,
            "base_revision": session.current_revision,
            "next_revision": next_revision,
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
            "emitted_events": emitted_events,
            "observability": observability,
            "summary": prepared_step_summary_to_json(&summary)
        }),
    )
}

pub fn handle_step_commit(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let prepared_token = match get_required_string(params, "prepared_token") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let persisted_revision = match get_required_string(params, "persisted_revision") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let session = match session_or_error_mut(state, request_id.clone(), &pack_id) {
        Ok(session) => session,
        Err(response) => return response,
    };
    let prepared_state = match session.prepared_state.clone() {
        Some(state) if state.token == prepared_token => state,
        _ => {
            return rpc_error(
                request_id,
                40402,
                "PREPARED_STEP_NOT_FOUND",
                Some(json!({ "pack_id": pack_id, "prepared_token": prepared_token })),
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

    session.current_tick = prepared_state.next_tick.clone();
    session.current_revision = persisted_revision.clone();
    session.world_entities = prepared_state.world_entities.clone();
    session.entity_states = prepared_state.entity_states.clone();
    session.authority_grants = prepared_state.authority_grants.clone();
    session.mediator_bindings = prepared_state.mediator_bindings.clone();
    session.rule_execution_records = prepared_state.rule_execution_records.clone();
    session.pending_prepared_token = None;
    session.prepared_state = None;

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
            "summary": prepared_step_summary_to_json(&prepared_state.summary)
        }),
    )
}

pub fn handle_step_abort(
    state: &mut AppState,
    request_id: Option<Value>,
    params: &Value,
) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let prepared_token =
        get_optional_string(params, "prepared_token").unwrap_or_else(|| "unknown".to_string());
    let abort_reason =
        get_optional_string(params, "reason").unwrap_or_else(|| "aborted".to_string());
    if let Ok(session) = session_or_error_mut(state, request_id.clone(), &pack_id) {
        session.pending_prepared_token = None;
        session.prepared_state = None;
    } else {
        return rpc_error(
            request_id,
            40401,
            "PACK_NOT_LOADED",
            Some(json!({ "pack_id": pack_id })),
        );
    }
    rpc_result(
        request_id,
        json!({
            "protocol_version": PROTOCOL_VERSION,
            "abort_observability": [{
                "record_id": format!("obs:{}:aborted", prepared_token),
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
