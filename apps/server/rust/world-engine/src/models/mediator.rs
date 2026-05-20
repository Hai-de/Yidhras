use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct MediatorBinding {
    pub mediator_id: String,
    pub subject_entity_id: String,
    pub binding_kind: String,
    pub status: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}
