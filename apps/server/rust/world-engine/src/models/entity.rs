use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct WorldEntity {
    pub id: String,
    pub entity_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct EntityState {
    pub id: String,
    pub pack_id: String,
    pub entity_id: String,
    pub state_namespace: String,
    pub state_json: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}
