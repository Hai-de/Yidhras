use crate::engine::query::{
    build_runtime_step_state, find_entity_state, parse_u64_or_default, upsert_entity_state,
};
use crate::models::state::{AppState, SessionState};
use crate::models::step::{
    CommittedTickCacheEntry, PreparedSessionState, PreparedStepArtifacts, PreparedStepSummary,
};
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
        "event_id": format!("world-step-prepared:{token}"),
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
            "record_id": format!("obs:{token}:prepared"),
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
            "record_id": format!("obs:{token}:core-delta-built"),
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
                "appended_rule_execution_id": format!("world-step:{token}")
            }
        }),
        json!({
            "record_id": format!("obs:{token}:prepared-state-summary"),
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

pub fn do_prepare_step(
    session: &mut SessionState,
    pack_id: &str,
    step_ticks: &str,
    reason: &str,
) -> PreparedSessionState {
    let step_ticks_number = step_ticks.parse::<u64>().unwrap_or(1);
    let current_tick_number = session.current_tick.parse::<u64>().unwrap_or(0);
    let next_tick = (current_tick_number + step_ticks_number).to_string();
    let token = format!("prepared:{pack_id}:{next_tick}");
    let current_revision_number =
        parse_u64_or_default(&session.current_revision, current_tick_number);
    let next_revision = (current_revision_number + step_ticks_number).to_string();

    let previous_world_state = find_entity_state(session, "__world__", "world")
        .and_then(|item| item.get("state_json").cloned());
    let next_world_state = build_runtime_step_state(
        previous_world_state.as_ref(),
        &token,
        reason,
        step_ticks,
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
        pack_id,
        "__world__",
        "world",
        &next_revision,
        &next_world_state,
    );
    let rule_execution_record_id = format!("world-step:{token}");
    let emitted_events =
        vec![build_prepared_step_event(pack_id, &token, reason, &next_tick, &next_revision)];
    let next_rule_execution_records = append_rule_execution_record(
        &session.rule_execution_records,
        pack_id,
        &rule_execution_record_id,
        &next_revision,
        &rule_execution_payload,
        &emitted_events,
    );

    let event_count = emitted_events.len();
    let mutated_entity_count = 2;
    let delta_operation_count = 3;
    let observability = build_prepared_step_observability(
        pack_id,
        &token,
        reason,
        step_ticks,
        &session.current_tick,
        &next_tick,
        &session.current_revision,
        &next_revision,
        event_count,
        mutated_entity_count,
        delta_operation_count,
    );
    let summary = PreparedStepSummary { applied_rule_count: 0, event_count, mutated_entity_count };

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

    session.pending_prepared_token = Some(token);
    session.prepared_state = Some(prepared_state.clone());

    prepared_state
}

pub fn do_commit_step(
    session: &mut SessionState,
    _pack_id: &str,
    prepared_token: &str,
    persisted_revision: &str,
) -> Option<PreparedSessionState> {
    let prepared_state = match &session.prepared_state {
        Some(state) if state.token == prepared_token => state.clone(),
        _ => return None,
    };

    session.current_tick = prepared_state.next_tick.clone();
    session.current_revision = persisted_revision.to_string();
    session.world_entities = prepared_state.world_entities.clone();
    session.entity_states = prepared_state.entity_states.clone();
    session.authority_grants = prepared_state.authority_grants.clone();
    session.mediator_bindings = prepared_state.mediator_bindings.clone();
    session.rule_execution_records = prepared_state.rule_execution_records.clone();
    session.pending_prepared_token = None;
    session.prepared_state = None;

    Some(prepared_state)
}

pub fn do_abort_step(session: &mut SessionState) {
    session.pending_prepared_token = None;
    session.prepared_state = None;
}

pub fn check_committed_cache<'a>(
    state: &'a AppState,
    pack_id: &str,
    next_tick: &str,
    _session: &SessionState,
) -> Option<&'a CommittedTickCacheEntry> {
    state.committed_ticks.get(pack_id, next_tick)
}

pub fn cache_committed_tick(
    state: &mut AppState,
    pack_id: String,
    next_tick: String,
    persisted_revision: String,
    prepared_state: &PreparedSessionState,
) {
    state.committed_ticks.insert(
        pack_id,
        next_tick.clone(),
        CommittedTickCacheEntry {
            next_revision: persisted_revision,
            emitted_events: prepared_state.emitted_events.clone(),
            observability: prepared_state.observability.clone(),
            summary: prepared_state.summary.clone(),
            artifacts: prepared_state.artifacts.clone(),
        },
    );
    state.committed_ticks.prune(next_tick.parse::<u64>().unwrap_or(0), 5);
}
