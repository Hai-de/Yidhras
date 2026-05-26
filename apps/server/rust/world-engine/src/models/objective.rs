use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct Invocation {
    pub invocation_type: String,
    #[serde(default)]
    pub capability_key: Option<String>,
    #[serde(default)]
    pub subject_entity_id: Option<String>,
    #[serde(default)]
    pub target_entity_id: Option<String>,
    #[serde(default)]
    pub target_ref: Option<Value>,
    #[serde(default)]
    pub payload: Option<Value>,
    #[serde(default)]
    pub mediator_id: Option<String>,
    #[serde(default)]
    pub actor_ref: Option<Value>,
    #[serde(default)]
    pub pack_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ObjectiveRule {
    pub id: String,
    pub when: Value,
    pub then: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Mutation {
    EntityState {
        entity_id: String,
        state_namespace: String,
        state_patch: Value,
    },
    AuthorityGrant {
        grant_id: String,
        source_entity_id: String,
        target_selector_json: Value,
        capability_key: String,
        grant_type: String,
        mediated_by_entity_id: Option<String>,
        scope_json: Value,
        conditions_json: Value,
        priority: i64,
        status: String,
        revocable: bool,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct EmittedEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impact_data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ExecuteObjectiveInput {
    pub pack_id: String,
    pub invocation: Value,
    pub effective_mediator_id: Option<String>,
    pub objective_rules: Vec<ObjectiveRule>,
    pub world_entities: Vec<Value>,
    #[serde(default)]
    pub pack_variables: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ExecuteObjectiveOutput {
    pub protocol_version: &'static str,
    pub pack_id: String,
    pub rule_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mediator_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_entity_id: Option<String>,
    pub mutations: Vec<Mutation>,
    pub emitted_events: Vec<EmittedEvent>,
    pub diagnostics: ObjectiveDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ObjectiveDiagnostics {
    pub matched_rule_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub no_match_reason: Option<String>,
    pub evaluated_rule_count: usize,
    pub rendered_template_count: usize,
    pub mutation_count: usize,
    pub emitted_event_count: usize,
}
