use crate::engine::template::{primitive_to_string, render_template_value, RenderStats};
use serde::Serialize;
use serde_json::{json, Value};

const PROTOCOL_VERSION: &str = "world_engine/v1alpha1";

pub struct ExecuteObjectiveInput {
    pub pack_id: String,
    pub invocation: Value,
    pub effective_mediator_id: Option<String>,
    pub objective_rules: Vec<Value>,
    pub world_entities: Vec<Value>,
    pub pack_variables: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExecuteObjectiveOutput {
    pub protocol_version: &'static str,
    pub pack_id: String,
    pub rule_id: String,
    pub capability_key: Option<String>,
    pub mediator_id: Option<String>,
    pub target_entity_id: Option<String>,
    pub mutations: Vec<Value>,
    pub emitted_events: Vec<Value>,
    pub diagnostics: ObjectiveDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectiveDiagnostics {
    pub matched_rule_id: String,
    pub no_match_reason: Option<String>,
    pub evaluated_rule_count: usize,
    pub rendered_template_count: usize,
    pub mutation_count: usize,
    pub emitted_event_count: usize,
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

fn get_target_entity_id(invocation: &Value) -> Option<String> {
    invocation
        .get("payload")
        .and_then(Value::as_object)
        .and_then(|payload| payload.get("target_entity_id"))
        .and_then(Value::as_str)
        .map(|v| v.to_string())
        .or_else(|| {
            invocation
                .get("target_ref")
                .and_then(Value::as_object)
                .and_then(|target_ref| target_ref.get("entity_id"))
                .and_then(Value::as_str)
                .map(|v| v.to_string())
        })
        .or_else(|| {
            invocation
                .get("target_ref")
                .and_then(Value::as_object)
                .and_then(|target_ref| target_ref.get("agent_id"))
                .and_then(Value::as_str)
                .map(|v| v.to_string())
        })
}

fn build_template_context(
    invocation: &Value,
    target_entity_id: Option<&str>,
    artifact_id: Option<&str>,
    effective_mediator_id: Option<&str>,
    pack_variables: Option<&Value>,
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
            "state": { "location": "" }
        },
        "mediator": {
            "id": effective_mediator_id.or(invocation_mediator_id)
        },
        "variables": pack_variables.unwrap_or(&Value::Null)
    })
}

pub fn execute(input: ExecuteObjectiveInput) -> ExecuteObjectiveOutput {
    let invocation_type = input
        .invocation
        .get("invocation_type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let capability_key =
        input.invocation.get("capability_key").and_then(Value::as_str).map(|v| v.to_string());
    let effective_mediator_id = input.effective_mediator_id.clone().or_else(|| {
        input.invocation.get("mediator_id").and_then(Value::as_str).map(|v| v.to_string())
    });
    let artifact_id = input
        .invocation
        .get("payload")
        .and_then(Value::as_object)
        .and_then(|payload| payload.get("artifact_id"))
        .and_then(Value::as_str)
        .map(|v| v.to_string());
    let target_entity_id = get_target_entity_id(&input.invocation);
    let target_state_entity_id = target_entity_id.clone().or_else(|| artifact_id.clone());
    let target_kind = target_entity_id.as_ref().and_then(|target_id| {
        input.world_entities.iter().find_map(|entity| {
            let entity_id = entity.get("id").and_then(Value::as_str)?;
            if entity_id == target_id {
                entity.get("entity_kind").and_then(Value::as_str).map(|v| v.to_string())
            } else {
                None
            }
        })
    });
    let pack_variables =
        input.pack_variables.as_ref().and_then(|v| if v.is_null() { None } else { Some(v) });
    let template_context = build_template_context(
        &input.invocation,
        target_entity_id.as_deref(),
        artifact_id.as_deref(),
        effective_mediator_id.as_deref(),
        pack_variables,
    );

    let rules = input.objective_rules;

    for rule in &rules {
        let rule_id = rule.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
        let when = rule.get("when").and_then(Value::as_object).cloned().unwrap_or_default();

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

        let (mutations, events, rendered_template_count) = apply_rule(
            rule,
            &template_context,
            &input.invocation,
            &target_state_entity_id,
            &artifact_id,
        );

        let mutation_count = mutations.len();
        let emitted_event_count = events.len();

        return ExecuteObjectiveOutput {
            protocol_version: PROTOCOL_VERSION,
            pack_id: input.pack_id,
            rule_id: rule_id.clone(),
            capability_key,
            mediator_id: effective_mediator_id,
            target_entity_id,
            mutations,
            emitted_events: events,
            diagnostics: ObjectiveDiagnostics {
                matched_rule_id: rule_id,
                no_match_reason: None,
                evaluated_rule_count: rules.len(),
                rendered_template_count,
                mutation_count,
                emitted_event_count,
            },
        };
    }

    ExecuteObjectiveOutput {
        protocol_version: PROTOCOL_VERSION,
        pack_id: input.pack_id,
        rule_id: "__no_match__".to_string(),
        capability_key,
        mediator_id: effective_mediator_id,
        target_entity_id,
        mutations: vec![],
        emitted_events: vec![],
        diagnostics: ObjectiveDiagnostics {
            matched_rule_id: "__no_match__".to_string(),
            no_match_reason: Some("no matching objective rule".to_string()),
            evaluated_rule_count: rules.len(),
            rendered_template_count: 0,
            mutation_count: 0,
            emitted_event_count: 0,
        },
    }
}

fn apply_rule(
    rule: &Value,
    template_context: &Value,
    invocation: &Value,
    target_state_entity_id: &Option<String>,
    artifact_id: &Option<String>,
) -> (Vec<Value>, Vec<Value>, usize) {
    let then = rule.get("then").and_then(Value::as_object).cloned().unwrap_or_default();
    let mutate = then.get("mutate").and_then(Value::as_object).cloned().unwrap_or_default();

    let mut rendered_template_count: usize = 0;
    let mut mutations: Vec<Value> = Vec::new();

    // subject_state mutation
    if let Some(subject_state) = mutate.get("subject_state").and_then(Value::as_object) {
        if let Some(subject_entity_id) = invocation.get("subject_entity_id").and_then(Value::as_str)
        {
            let (state_patch, stats) =
                render_template_value(&Value::Object(subject_state.clone()), template_context);
            rendered_template_count += stats.substitutions;
            mutations.push(json!({
                "kind": "entity_state",
                "entity_id": subject_entity_id,
                "state_namespace": "core",
                "state_patch": state_patch
            }));
        }
    }

    // target_state mutation
    if let Some(target_state) = mutate.get("target_state").and_then(Value::as_object) {
        if let Some(target_id) = target_state_entity_id.as_deref() {
            let (state_patch, stats) =
                render_template_value(&Value::Object(target_state.clone()), template_context);
            rendered_template_count += stats.substitutions;
            mutations.push(json!({
                "kind": "entity_state",
                "entity_id": target_id,
                "state_namespace": "core",
                "state_patch": state_patch
            }));
        }
    }

    // world_state mutation
    if let Some(world_state) = mutate.get("world_state").and_then(Value::as_object) {
        let (state_patch, stats) =
            render_template_value(&Value::Object(world_state.clone()), template_context);
        rendered_template_count += stats.substitutions;
        mutations.push(json!({
            "kind": "entity_state",
            "entity_id": "__world__",
            "state_namespace": "world",
            "state_patch": state_patch
        }));
    }

    // authority mutation
    if let Some(authority) = mutate.get("authority").and_then(Value::as_object) {
        let (rendered, stats) =
            render_template_value(&Value::Object(authority.clone()), template_context);
        rendered_template_count += stats.substitutions;

        if let Some(rendered_obj) = rendered.as_object() {
            let get_str = |key: &str| -> String {
                rendered_obj
                    .get(key)
                    .and_then(Value::as_str)
                    .map(|v| v.to_string())
                    .unwrap_or_default()
            };
            let get_str_nullable = |key: &str| -> Option<String> {
                rendered_obj.get(key).and_then(Value::as_str).map(|v| v.to_string())
            };
            let get_record = |key: &str| -> Value {
                rendered_obj
                    .get(key)
                    .and_then(|v| v.as_object().map(|m| Value::Object(m.clone())))
                    .unwrap_or(Value::Null)
            };

            mutations.push(json!({
                "kind": "authority_grant",
                "grant_id": get_str("grant_id"),
                "source_entity_id": get_str("source_entity_id"),
                "target_selector_json": get_record("target_selector_json"),
                "capability_key": get_str("capability_key"),
                "grant_type": if get_str("grant_type").is_empty() { "mediated".to_string() } else { get_str("grant_type") },
                "mediated_by_entity_id": get_str_nullable("mediated_by_entity_id"),
                "scope_json": get_record("scope_json"),
                "conditions_json": get_record("conditions_json"),
                "priority": rendered_obj.get("priority").and_then(Value::as_i64).unwrap_or(0),
                "status": if get_str("status").is_empty() { "active".to_string() } else { get_str("status") },
                "revocable": rendered_obj.get("revocable").and_then(Value::as_bool).unwrap_or(false)
            }));
        }
    }

    // emitted events
    let emitted_events = then
        .get("emit_events")
        .and_then(Value::as_array)
        .map(|events| {
            events
                .iter()
                .filter_map(|event| {
                    let event_object = event.as_object()?;
                    let (rendered_type, type_stats) = event_object
                        .get("type")
                        .map(|value| render_template_value(value, template_context))
                        .unwrap_or((
                            Value::String("history".to_string()),
                            RenderStats { substitutions: 0 },
                        ));
                    let (rendered_title, title_stats) = event_object
                        .get("title")
                        .map(|value| render_template_value(value, template_context))
                        .unwrap_or((
                            Value::String(String::new()),
                            RenderStats { substitutions: 0 },
                        ));
                    let (rendered_description, desc_stats) = event_object
                        .get("description")
                        .map(|value| render_template_value(value, template_context))
                        .unwrap_or((
                            Value::String(String::new()),
                            RenderStats { substitutions: 0 },
                        ));

                    rendered_template_count += type_stats.substitutions
                        + title_stats.substitutions
                        + desc_stats.substitutions;

                    let rendered_type = primitive_to_string(&rendered_type)
                        .unwrap_or_else(|| "history".to_string());
                    let rendered_title =
                        primitive_to_string(&rendered_title).unwrap_or_default().trim().to_string();
                    let rendered_description = primitive_to_string(&rendered_description)
                        .unwrap_or_default()
                        .trim()
                        .to_string();

                    if rendered_title.is_empty() || rendered_description.is_empty() {
                        return None;
                    }

                    let (rendered_impact_data, _) = event_object
                        .get("impact_data")
                        .map(|value| render_template_value(value, template_context))
                        .unwrap_or((Value::Null, RenderStats { substitutions: 0 }));
                    let rendered_artifact_id = event_object
                        .get("artifact_id")
                        .map(|value| render_template_value(value, template_context))
                        .and_then(|(v, _)| primitive_to_string(&v))
                        .or_else(|| artifact_id.clone());

                    Some(json!({
                        "type": rendered_type,
                        "title": rendered_title,
                        "description": rendered_description,
                        "impact_data": rendered_impact_data
                            .as_object()
                            .cloned()
                            .map(Value::Object)
                            .unwrap_or(Value::Null),
                        "artifact_id": rendered_artifact_id
                    }))
                })
                .collect::<Vec<Value>>()
        })
        .unwrap_or_default();

    (mutations, emitted_events, rendered_template_count)
}
