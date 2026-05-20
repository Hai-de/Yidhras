use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AuthorityGrant {
    pub grant_id: String,
    pub source_entity_id: String,
    pub capability_key: String,
    #[serde(default)]
    pub mediated_by_entity_id: Option<String>,
    pub status: String,
    pub target_selector_json: serde_json::Value,
    pub scope_json: serde_json::Value,
    pub conditions_json: serde_json::Value,
    pub grant_type: String,
    pub priority: i64,
    pub revocable: bool,
}
