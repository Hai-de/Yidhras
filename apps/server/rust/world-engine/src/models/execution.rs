use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RuleExecutionRecord {
    pub id: String,
    pub pack_id: String,
    pub rule_id: String,
    pub subject_entity_id: String,
    pub target_entity_id: String,
    pub execution_status: String,
    pub capability_key: Option<serde_json::Value>,
    pub mediator_id: Option<serde_json::Value>,
    pub payload_json: serde_json::Value,
    pub emitted_events_json: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}
