use crate::protocol::{get_required_string, rpc_error, rpc_result, RpcResponse};
use crate::template::{primitive_to_string, render_template_value};
use crate::PROTOCOL_VERSION;
use serde_json::{json, Value};

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

fn diagnostics_for_error(
    reason: &str,
    evaluated_rule_count: usize,
    rendered_template_count: usize,
) -> Value {
    json!({
        "matched_rule_id": Value::Null,
        "no_match_reason": reason,
        "evaluated_rule_count": evaluated_rule_count,
        "rendered_template_count": rendered_template_count,
        "mutation_count": 0,
        "emitted_event_count": 0
    })
}

pub fn handle_execute_objective(request_id: Option<Value>, params: &Value) -> RpcResponse {
    let pack_id = match get_required_string(params, "pack_id") {
        Ok(value) => value.to_string(),
        Err(message) => return rpc_error(request_id, -32602, &message, None),
    };
    let invocation = params
        .get("invocation")
        .cloned()
        .unwrap_or_else(|| json!({}));
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
        .or_else(|| {
            invocation
                .get("mediator_id")
                .and_then(Value::as_str)
                .map(|value| value.to_string())
        });
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
                        entity
                            .get("entity_kind")
                            .and_then(Value::as_str)
                            .map(|value| value.to_string())
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
        let when = rule
            .get("when")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        if let Some(expected_invocation_type) = when.get("invocation_type").and_then(Value::as_str)
        {
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

        let then = rule
            .get("then")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mutate = then
            .get("mutate")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let mut mutations: Vec<Value> = Vec::new();

        if let Some(subject_state) = mutate.get("subject_state").and_then(Value::as_object) {
            if let Some(subject_entity_id) =
                invocation.get("subject_entity_id").and_then(Value::as_str)
            {
                rendered_template_count += subject_state.len();
                let state_patch =
                    render_template_value(&Value::Object(subject_state.clone()), &template_context);
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
                let state_patch =
                    render_template_value(&Value::Object(target_state.clone()), &template_context);
                mutations.push(json!({
                    "entity_id": target_id,
                    "state_namespace": "core",
                    "state_patch": state_patch
                }));
            }
        }

        if let Some(world_state) = mutate.get("world_state").and_then(Value::as_object) {
            rendered_template_count += world_state.len();
            let state_patch =
                render_template_value(&Value::Object(world_state.clone()), &template_context);
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
            request_id,
            json!({
                "protocol_version": PROTOCOL_VERSION,
                "pack_id": pack_id,
                "rule_id": rule_id,
                "capability_key": capability_key,
                "mediator_id": effective_mediator_id,
                "target_entity_id": target_entity_id,
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
        request_id,
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
