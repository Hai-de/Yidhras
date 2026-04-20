use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::time::Instant;

const PROTOCOL_VERSION: &str = "world_engine/v1alpha1";

#[derive(Debug, Deserialize)]
struct RpcRequest {
    id: Option<Value>,
    method: String,
    params: Option<Value>,
}

#[derive(Debug, Serialize)]
struct RpcError {
    code: i32,
    message: String,
    data: Option<Value>,
}

#[derive(Debug, Serialize)]
struct RpcResponse {
    jsonrpc: &'static str,
    id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Debug, Clone)]
struct PreparedStepSummary {
    applied_rule_count: usize,
    event_count: usize,
    mutated_entity_count: usize,
}

#[derive(Debug, Clone)]
struct PreparedStepArtifacts {
    rule_execution_record: Value,
    next_world_state: Value,
}

#[derive(Debug, Clone)]
struct PreparedSessionState {
    token: String,
    next_tick: String,
    next_revision: String,
    emitted_events: Vec<Value>,
    observability: Vec<Value>,
    summary: PreparedStepSummary,
    world_entities: Vec<Value>,
    entity_states: Vec<Value>,
    authority_grants: Vec<Value>,
    mediator_bindings: Vec<Value>,
    rule_execution_records: Vec<Value>,
    artifacts: PreparedStepArtifacts,
}

#[derive(Debug, Clone)]
struct SessionState {
    mode: String,
    current_tick: String,
    current_revision: String,
    pending_prepared_token: Option<String>,
    world_entities: Vec<Value>,
    entity_states: Vec<Value>,
    authority_grants: Vec<Value>,
    mediator_bindings: Vec<Value>,
    rule_execution_records: Vec<Value>,
    prepared_state: Option<PreparedSessionState>,
}

struct AppState {
    started_at: Instant,
    sessions: HashMap<String, SessionState>,
}

impl AppState {
    fn new() -> Self {
        Self {
            started_at: Instant::now(),
            sessions: HashMap::new(),
        }
    }
}

fn rpc_result(id: Option<Value>, result: Value) -> RpcResponse {
    RpcResponse {
        jsonrpc: "2.0",
        id,
        result: Some(result),
        error: None,
    }
}

fn rpc_error(id: Option<Value>, code: i32, message: &str, data: Option<Value>) -> RpcResponse {
    RpcResponse {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(RpcError {
            code,
            message: message.to_string(),
            data,
        }),
    }
}

fn get_required_string<'a>(params: &'a Value, key: &str) -> Result<&'a str, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("missing required string field: {}", key))
}

fn get_optional_string(params: &Value, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(|value| value.to_string())
}

fn clone_array_field(value: Option<&Value>) -> Vec<Value> {
    value
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn extract_pack_snapshot(params: &Value) -> Option<&serde_json::Map<String, Value>> {
    params
        .get("hydrate")
        .and_then(Value::as_object)
        .and_then(|hydrate| hydrate.get("snapshot"))
        .and_then(Value::as_object)
}

fn extract_snapshot_clock(snapshot: &serde_json::Map<String, Value>) -> (String, String) {
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

fn build_pack_summary(session: &SessionState, pack_id: &str) -> Value {
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

fn find_entity_state(session: &SessionState, entity_id: &str, state_namespace: &str) -> Option<Value> {
    session
        .entity_states
        .iter()
        .find(|item| {
            item.get("entity_id").and_then(Value::as_str) == Some(entity_id)
                && item.get("state_namespace").and_then(Value::as_str) == Some(state_namespace)
        })
        .cloned()
}

fn find_entity_state_index(entity_states: &[Value], entity_id: &str, state_namespace: &str) -> Option<usize> {
    entity_states.iter().position(|item| {
        item.get("entity_id").and_then(Value::as_str) == Some(entity_id)
            && item.get("state_namespace").and_then(Value::as_str) == Some(state_namespace)
    })
}

fn build_runtime_step_state(
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

fn upsert_entity_state(
    entity_states: &[Value],
    pack_id: &str,
    entity_id: &str,
    state_namespace: &str,
    next_revision: &str,
    state_json: &Value,
) -> Vec<Value> {
    let mut next_entity_states = entity_states.to_vec();

    if let Some(index) = find_entity_state_index(entity_states, entity_id, state_namespace) {
        if let Some(existing) = next_entity_states.get_mut(index).and_then(Value::as_object_mut) {
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

fn parse_u64_or_default(value: &str, default: u64) -> u64 {
    value.parse::<u64>().unwrap_or(default)
}

fn append_rule_execution_record(
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

fn build_world_step_execution_record(
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

fn build_prepared_step_event(
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

fn build_prepared_step_observability(
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
        })
    ]
}

fn build_prepared_step_summary(event_count: usize, mutated_entity_count: usize) -> PreparedStepSummary {
    PreparedStepSummary {
        applied_rule_count: 0,
        event_count,
        mutated_entity_count,
    }
}

fn prepared_step_summary_to_json(summary: &PreparedStepSummary) -> Value {
    json!({
        "applied_rule_count": summary.applied_rule_count,
        "event_count": summary.event_count,
        "mutated_entity_count": summary.mutated_entity_count
    })
}

fn get_selector_string(params: &Value, key: &str) -> Option<String> {
    params
        .get("selector")
        .and_then(Value::as_object)
        .and_then(|selector| selector.get(key))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn session_or_error<'a>(state: &'a AppState, request_id: Option<Value>, pack_id: &str) -> Result<&'a SessionState, RpcResponse> {
    state.sessions.get(pack_id).ok_or_else(|| {
        rpc_error(
            request_id,
            40401,
            "PACK_NOT_LOADED",
            Some(json!({ "pack_id": pack_id })),
        )
    })
}

fn session_or_error_mut<'a>(state: &'a mut AppState, request_id: Option<Value>, pack_id: &str) -> Result<&'a mut SessionState, RpcResponse> {
    state.sessions.get_mut(pack_id).ok_or_else(|| {
        rpc_error(
            request_id,
            40401,
            "PACK_NOT_LOADED",
            Some(json!({ "pack_id": pack_id })),
        )
    })
}

fn get_target_entity_id(invocation: &Value) -> Option<String> {
    invocation
        .get("payload")
        .and_then(Value::as_object)
        .and_then(|payload| payload.get("target_entity_id"))
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .or_else(|| {
            invocation
                .get("target_ref")
                .and_then(Value::as_object)
                .and_then(|target_ref| target_ref.get("entity_id"))
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        })
        .or_else(|| {
            invocation
                .get("target_ref")
                .and_then(Value::as_object)
                .and_then(|target_ref| target_ref.get("agent_id"))
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        })
}

fn primitive_to_string(value: &Value) -> Option<String> {
    match value {
        Value::String(inner) => Some(inner.clone()),
        Value::Number(inner) => Some(inner.to_string()),
        Value::Bool(inner) => Some(inner.to_string()),
        _ => None,
    }
}

fn resolve_template_path_value(context: &Value, path: &str) -> Option<Value> {
    let mut current = context;

    for part in path.split('.') {
        let object = current.as_object()?;
        current = object.get(part)?;
    }

    Some(current.clone())
}

fn render_string_template(template: &str, context: &Value) -> String {
    let mut output = String::new();
    let mut remainder = template;

    loop {
        let Some(start) = remainder.find("{{") else {
            output.push_str(remainder);
            break;
        };

        output.push_str(&remainder[..start]);
        let after_start = &remainder[start + 2..];
        let Some(end) = after_start.find("}}") else {
            output.push_str(&remainder[start..]);
            break;
        };

        let path = after_start[..end].trim();
        let rendered = resolve_template_path_value(context, path)
            .and_then(|value| primitive_to_string(&value))
            .unwrap_or_default();
        output.push_str(&rendered);
        remainder = &after_start[end + 2..];
    }

    output
}

fn render_template_value(value: &Value, context: &Value) -> Value {
    match value {
        Value::String(inner) => {
            if inner.contains("{{") && inner.contains("}}") {
                Value::String(render_string_template(inner, context))
            } else {
                Value::String(inner.clone())
            }
        }
        Value::Array(items) => Value::Array(items.iter().map(|item| render_template_value(item, context)).collect()),
        Value::Object(map) => Value::Object(
            map.iter()
                .map(|(key, item)| (key.clone(), render_template_value(item, context)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn resolve_target_kind_condition(when: &serde_json::Map<String, Value>) -> Option<String> {
    when.get("target.kind")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            when.get("target")
                .and_then(Value::as_object)
                .and_then(|target| target.get("kind"))
                .and_then(Value::as_str)
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        })
}

fn build_template_context(
    invocation: &Value,
    target_entity_id: Option<&str>,
    artifact_id: Option<&str>,
    effective_mediator_id: Option<&str>,
) -> Value {
    let subject_entity_id = invocation.get("subject_entity_id").and_then(Value::as_str);
    let invocation_mediator_id = invocation.get("mediator_id").and_then(Value::as_str);

    json!({
        "subject_entity_id": subject_entity_id,
        "target_entity_id": target_entity_id,
        "artifact_id": artifact_id,
        "mediator_id": effective_mediator_id.or(invocation_mediator_id),
        "invocation": {
            "subject_entity_id": subject_entity_id,
            "target_entity_id": target_entity_id,
            "artifact_id": artifact_id,
            "mediator_id": effective_mediator_id.or(invocation_mediator_id),
            "invocation_type": invocation.get("invocation_type").and_then(Value::as_str),
            "capability_key": invocation.get("capability_key").and_then(Value::as_str),
            "pack_id": invocation.get("pack_id").and_then(Value::as_str)
        },
        "actor": {
            "id": subject_entity_id,
            "name": subject_entity_id
        },
        "target": {
            "id": target_entity_id,
            "entity_id": target_entity_id
        },
        "artifact": {
            "id": artifact_id,
            "label": artifact_id.unwrap_or(""),
            "state": {
                "location": ""
            }
        },
        "mediator": {
            "id": effective_mediator_id.or(invocation_mediator_id)
        }
    })
}

fn diagnostics_for_error(reason: &str, evaluated_rule_count: usize, rendered_template_count: usize) -> Value {
    json!({
        "matched_rule_id": Value::Null,
        "no_match_reason": reason,
        "evaluated_rule_count": evaluated_rule_count,
        "rendered_template_count": rendered_template_count,
        "mutation_count": 0,
        "emitted_event_count": 0
    })
}


fn handle_execute_objective(request: RpcRequest, params: Value) -> RpcResponse {
    let pack_id = match get_required_string(&params, "pack_id") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request.id, -32602, &message, None),
    };
    let invocation = params.get("invocation").cloned().unwrap_or_else(|| json!({}));
    let invocation_type = invocation
        .get("invocation_type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let capability_key = invocation
        .get("capability_key")
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let effective_mediator_id = params
        .get("effective_mediator_id")
        .and_then(Value::as_str)
        .map(|value| value.to_string())
        .or_else(|| invocation.get("mediator_id").and_then(Value::as_str).map(|value| value.to_string()));
    let artifact_id = invocation
        .get("payload")
        .and_then(Value::as_object)
        .and_then(|payload| payload.get("artifact_id"))
        .and_then(Value::as_str)
        .map(|value| value.to_string());
    let target_entity_id = get_target_entity_id(&invocation);
    let target_state_entity_id = target_entity_id.clone().or_else(|| artifact_id.clone());
    let target_kind = target_entity_id.as_ref().and_then(|target_id| {
        params
            .get("world_entities")
            .and_then(Value::as_array)
            .and_then(|entities| {
                entities.iter().find_map(|entity| {
                    let entity_id = entity.get("id").and_then(Value::as_str)?;
                    if entity_id == target_id {
                        entity.get("entity_kind").and_then(Value::as_str).map(|value| value.to_string())
                    } else {
                        None
                    }
                })
            })
    });
    let template_context = build_template_context(
        &invocation,
        target_entity_id.as_deref(),
        artifact_id.as_deref(),
        effective_mediator_id.as_deref(),
    );

    let mut rendered_template_count: usize = 0;
    let rules = params
        .get("objective_rules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for rule in &rules {
        let rule_id = rule
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let when = rule.get("when").and_then(Value::as_object).cloned().unwrap_or_default();

        if let Some(expected_invocation_type) = when.get("invocation_type").and_then(Value::as_str) {
            if expected_invocation_type != invocation_type {
                continue;
            }
        }
        if let Some(expected_capability) = when.get("capability").and_then(Value::as_str) {
            if capability_key.as_deref() != Some(expected_capability) {
                continue;
            }
        }
        if let Some(expected_mediator) = when.get("mediator").and_then(Value::as_str) {
            if effective_mediator_id.as_deref() != Some(expected_mediator) {
                continue;
            }
        }

        let target_kind_condition = resolve_target_kind_condition(&when);
        if let Some(expected_target_kind) = target_kind_condition.as_deref() {
            if target_kind.as_deref() != Some(expected_target_kind) {
                continue;
            }
        }

        let then = rule.get("then").and_then(Value::as_object).cloned().unwrap_or_default();
        let mutate = then.get("mutate").and_then(Value::as_object).cloned().unwrap_or_default();
        let mut mutations: Vec<Value> = Vec::new();

        if let Some(subject_state) = mutate.get("subject_state").and_then(Value::as_object) {
            if let Some(subject_entity_id) = invocation.get("subject_entity_id").and_then(Value::as_str) {
                rendered_template_count += subject_state.len();
                let state_patch = render_template_value(&Value::Object(subject_state.clone()), &template_context);
                mutations.push(json!({
                    "entity_id": subject_entity_id,
                    "state_namespace": "core",
                    "state_patch": state_patch
                }));
            }
        }

        if let Some(target_state) = mutate.get("target_state").and_then(Value::as_object) {
            if let Some(target_id) = target_state_entity_id.as_deref() {
                rendered_template_count += target_state.len();
                let state_patch = render_template_value(&Value::Object(target_state.clone()), &template_context);
                mutations.push(json!({
                    "entity_id": target_id,
                    "state_namespace": "core",
                    "state_patch": state_patch
                }));
            }
        }

        if let Some(world_state) = mutate.get("world_state").and_then(Value::as_object) {
            rendered_template_count += world_state.len();
            let state_patch = render_template_value(&Value::Object(world_state.clone()), &template_context);
            mutations.push(json!({
                "entity_id": "__world__",
                "state_namespace": "world",
                "state_patch": state_patch
            }));
        }

        let emitted_events = then
            .get("emit_events")
            .and_then(Value::as_array)
            .map(|events| {
                events
                    .iter()
                    .filter_map(|event| {
                        let event_object = event.as_object()?;
                        rendered_template_count += event_object.len();
                        let rendered_type = event_object
                            .get("type")
                            .map(|value| render_template_value(value, &template_context))
                            .and_then(|value| primitive_to_string(&value))
                            .unwrap_or_else(|| "history".to_string());
                        let rendered_title = event_object
                            .get("title")
                            .map(|value| render_template_value(value, &template_context))
                            .and_then(|value| primitive_to_string(&value))
                            .unwrap_or_default()
                            .trim()
                            .to_string();
                        let rendered_description = event_object
                            .get("description")
                            .map(|value| render_template_value(value, &template_context))
                            .and_then(|value| primitive_to_string(&value))
                            .unwrap_or_default()
                            .trim()
                            .to_string();

                        if rendered_title.is_empty() || rendered_description.is_empty() {
                            return None;
                        }

                        let rendered_impact_data = event_object
                            .get("impact_data")
                            .map(|value| render_template_value(value, &template_context));
                        let rendered_artifact_id = event_object
                            .get("artifact_id")
                            .map(|value| render_template_value(value, &template_context))
                            .and_then(|value| primitive_to_string(&value))
                            .or_else(|| artifact_id.clone());

                        Some(json!({
                            "type": rendered_type,
                            "title": rendered_title,
                            "description": rendered_description,
                            "impact_data": rendered_impact_data
                                .and_then(|value| value.as_object().cloned().map(Value::Object))
                                .unwrap_or(Value::Null),
                            "artifact_id": rendered_artifact_id
                        }))
                    })
                    .collect::<Vec<Value>>()
            })
            .unwrap_or_default();

        return rpc_result(
            request.id,
            json!({
                "protocol_version": PROTOCOL_VERSION,
                "pack_id": pack_id,
                "rule_id": rule_id,
                "capability_key": capability_key,
                "mediator_id": effective_mediator_id,
                "target_entity_id": target_entity_id,
                "bridge_mode": "objective_rule",
                "mutations": mutations,
                "emitted_events": emitted_events,
                "diagnostics": {
                    "matched_rule_id": rule_id,
                    "no_match_reason": null,
                    "evaluated_rule_count": rules.len(),
                    "rendered_template_count": rendered_template_count,
                    "mutation_count": mutations.len(),
                    "emitted_event_count": emitted_events.len()
                }
            }),
        );
    }

    rpc_error(
        request.id,
        50001,
        "OBJECTIVE_RULE_NOT_FOUND",
        Some(json!({
            "pack_id": pack_id,
            "invocation_type": invocation_type,
            "capability_key": capability_key,
            "effective_mediator_id": effective_mediator_id,
            "target_entity_id": target_entity_id,
            "diagnostics": diagnostics_for_error("no_rule_matched", rules.len(), rendered_template_count)
        })),
    )
}

fn handle_request(state: &mut AppState, request: RpcRequest) -> RpcResponse {
    let params = request.params.clone().unwrap_or_else(|| json!({}));

    match request.method.as_str() {
        "world.protocol.handshake" => rpc_result(
            request.id,
            json!({
                "protocol_version": PROTOCOL_VERSION,
                "accepted": true,
                "transport": "stdio_jsonrpc",
                "engine_instance_id": "rust-sidecar-stub",
                "supported_methods": [
                    "world.protocol.handshake",
                    "world.health.get",
                    "world.pack.load",
                    "world.pack.unload",
                    "world.state.query",
                    "world.rule.execute_objective",
                    "world.status.get",
                    "world.step.prepare",
                    "world.step.commit",
                    "world.step.abort"
                ],
                "engine_capabilities": ["stub", "stdio_jsonrpc", "objective_rule_execution"]
            }),
        ),
        "world.health.get" => {
            let loaded_pack_ids: Vec<String> = state.sessions.keys().cloned().collect();
            rpc_result(
                request.id,
                json!({
                    "protocol_version": PROTOCOL_VERSION,
                    "transport": "stdio_jsonrpc",
                    "engine_status": "ready",
                    "engine_instance_id": "rust-sidecar-stub",
                    "uptime_ms": state.started_at.elapsed().as_millis() as u64,
                    "loaded_pack_ids": loaded_pack_ids,
                    "tainted_pack_ids": [],
                    "last_error_code": null,
                    "message": "Rust sidecar stub"
                }),
            )
        }
        "world.pack.load" => {
            let pack_id = match get_required_string(&params, "pack_id") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let mode = get_optional_string(&params, "mode").unwrap_or_else(|| "active".to_string());
            let snapshot = extract_pack_snapshot(&params);
            let (current_tick, current_revision) = snapshot
                .map(extract_snapshot_clock)
                .unwrap_or_else(|| ("0".to_string(), "0".to_string()));
            let world_entities = snapshot.map(|item| clone_array_field(item.get("world_entities"))).unwrap_or_default();
            let entity_states = snapshot.map(|item| clone_array_field(item.get("entity_states"))).unwrap_or_default();
            let authority_grants = snapshot.map(|item| clone_array_field(item.get("authority_grants"))).unwrap_or_default();
            let mediator_bindings = snapshot.map(|item| clone_array_field(item.get("mediator_bindings"))).unwrap_or_default();
            let rule_execution_records = snapshot.map(|item| clone_array_field(item.get("rule_execution_records"))).unwrap_or_default();
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
                request.id,
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
        "world.pack.unload" => {
            let pack_id = match get_required_string(&params, "pack_id") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            state.sessions.remove(&pack_id);
            rpc_result(
                request.id,
                json!({
                    "protocol_version": PROTOCOL_VERSION,
                    "acknowledged": true,
                    "pack_id": pack_id,
                    "message": "unloaded"
                }),
            )
        }
        "world.status.get" => {
            let pack_id = match get_required_string(&params, "pack_id") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            if let Some(session) = state.sessions.get(&pack_id) {
                rpc_result(
                    request.id,
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
                    request.id,
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
        "world.state.query" => {
            let pack_id = match get_required_string(&params, "pack_id") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let query_name = match get_required_string(&params, "query_name") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let session = match session_or_error(&state, request.id.clone(), &pack_id) {
                Ok(session) => session,
                Err(response) => return response,
            };

            let data = match query_name.as_str() {
                "pack_summary" => {
                    json!({
                        "summary": build_pack_summary(session, &pack_id)
                    })
                }
                "world_entities" => {
                    json!({
                        "items": session.world_entities,
                        "total_count": session.world_entities.len()
                    })
                }
                "entity_state" => {
                    let entity_id = match get_selector_string(&params, "entity_id") {
                        Some(value) => value,
                        None => return rpc_error(request.id, -32602, "INVALID_QUERY", Some(json!({ "pack_id": pack_id, "reason": "entity_id is required" }))),
                    };
                    let state_namespace = match get_selector_string(&params, "state_namespace") {
                        Some(value) => value,
                        None => return rpc_error(request.id, -32602, "INVALID_QUERY", Some(json!({ "pack_id": pack_id, "reason": "state_namespace is required" }))),
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
                    json!({
                        "items": session.authority_grants,
                        "total_count": session.authority_grants.len()
                    })
                }
                "mediator_bindings" => {
                    json!({
                        "items": session.mediator_bindings,
                        "total_count": session.mediator_bindings.len()
                    })
                }
                "rule_execution_summary" => {
                    json!({
                        "items": session.rule_execution_records,
                        "total_count": session.rule_execution_records.len()
                    })
                }
                _ => return rpc_error(request.id, -32602, "INVALID_QUERY", Some(json!({ "pack_id": pack_id, "query_name": query_name }))),
            };

            rpc_result(
                request.id,
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
        "world.rule.execute_objective" => handle_execute_objective(request, params),
        "world.step.prepare" => {
            let pack_id = match get_required_string(&params, "pack_id") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let step_ticks = match get_required_string(&params, "step_ticks") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let step_ticks_number = step_ticks.parse::<u64>().unwrap_or(1);
            let session = match session_or_error_mut(state, request.id.clone(), &pack_id) {
                Ok(session) => session,
                Err(response) => return response,
            };
            if session.pending_prepared_token.is_some() || session.prepared_state.is_some() {
                let current_token = session.pending_prepared_token.clone();
                return rpc_error(
                    request.id,
                    40901,
                    "PREPARED_STEP_CONFLICT",
                    Some(json!({ "pack_id": pack_id, "prepared_token": current_token })),
                );
            }

            let current_tick_number = session.current_tick.parse::<u64>().unwrap_or(0);
            let next_tick = (current_tick_number + step_ticks_number).to_string();
            let token = format!("prepared:{}:{}", pack_id, next_tick);
            let current_revision_number = parse_u64_or_default(&session.current_revision, current_tick_number);
            let next_revision = (current_revision_number + step_ticks_number).to_string();
            let previous_world_state = find_entity_state(session, "__world__", "world")
                .and_then(|item| item.get("state_json").cloned());
            let reason = params.get("reason").and_then(Value::as_str).unwrap_or("runtime_loop");
            let next_world_state = build_runtime_step_state(
                previous_world_state.as_ref(),
                &token,
                params.get("reason").and_then(Value::as_str).unwrap_or("runtime_loop"),
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
                request.id,
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
        "world.step.commit" => {
            let pack_id = match get_required_string(&params, "pack_id") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let prepared_token = match get_required_string(&params, "prepared_token") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let persisted_revision = match get_required_string(&params, "persisted_revision") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let session = match session_or_error_mut(state, request.id.clone(), &pack_id) {
                Ok(session) => session,
                Err(response) => return response,
            };
            let prepared_state = match session.prepared_state.clone() {
                Some(state) if state.token == prepared_token => state,
                _ => return rpc_error(request.id, 40402, "PREPARED_STEP_NOT_FOUND", Some(json!({ "pack_id": pack_id, "prepared_token": prepared_token }))),
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
                request.id,
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
        "world.step.abort" => {
            let pack_id = match get_required_string(&params, "pack_id") {
                Ok(value) => value.to_string(),
                Err(message) => return rpc_error(request.id, -32602, &message, None),
            };
            let prepared_token = get_optional_string(&params, "prepared_token").unwrap_or_else(|| "unknown".to_string());
            let abort_reason = get_optional_string(&params, "reason").unwrap_or_else(|| "aborted".to_string());
            if let Ok(session) = session_or_error_mut(state, request.id.clone(), &pack_id) {
                session.pending_prepared_token = None;
                session.prepared_state = None;
            } else {
                return rpc_error(
                    request.id,
                    40401,
                    "PACK_NOT_LOADED",
                    Some(json!({ "pack_id": pack_id })),
                );
            }
            rpc_result(
                request.id,
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
        _ => rpc_error(
            request.id,
            -32601,
            "method not found",
            Some(json!({ "method": request.method })),
        ),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut state = AppState::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(value) => value,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<RpcRequest>(&line) {
            Ok(request) => handle_request(&mut state, request),
            Err(error) => rpc_error(None, -32700, "parse error", Some(json!({ "message": error.to_string() }))),
        };

        let payload = serde_json::to_string(&response).expect("response serialization");
        writeln!(stdout, "{}", payload).expect("write response");
        stdout.flush().expect("flush response");
    }
}
