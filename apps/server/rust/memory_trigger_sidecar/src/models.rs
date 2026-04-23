use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryBlockKindDto {
    Fact,
    Reflection,
    Plan,
    Dossier,
    Rule,
    Hypothesis,
    Reminder,
    Summary,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryBlockStatusDto {
    Active,
    Deleted,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryBlockSourceKindDto {
    Trace,
    Intent,
    Job,
    Post,
    Event,
    Manual,
    Overlay,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct MemoryBlockSourceRefDto {
    #[serde(default)]
    pub source_kind: Option<MemoryBlockSourceKindDto>,
    #[serde(default)]
    pub source_id: Option<String>,
    #[serde(default)]
    pub source_message_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryBlockDto {
    pub id: String,
    pub owner_agent_id: String,
    #[serde(default)]
    pub pack_id: Option<String>,
    pub kind: MemoryBlockKindDto,
    pub status: MemoryBlockStatusDto,
    #[serde(default)]
    pub title: Option<String>,
    pub content_text: String,
    #[serde(default)]
    pub content_structured: Option<Map<String, Value>>,
    pub tags: Vec<String>,
    pub keywords: Vec<String>,
    #[serde(default)]
    pub source_ref: Option<MemoryBlockSourceRefDto>,
    pub importance: f64,
    pub salience: f64,
    #[serde(default)]
    pub confidence: Option<f64>,
    pub created_at_tick: String,
    pub updated_at_tick: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct MemoryMutationPolicyDto {
    pub allow_insert: bool,
    pub allow_rewrite: bool,
    pub allow_delete: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryPlacementSlotDto {
    SystemPolicy,
    RoleCore,
    WorldContext,
    MemoryShortTerm,
    MemoryLongTerm,
    MemorySummary,
    PostProcess,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryPlacementAnchorKindDto {
    SlotStart,
    SlotEnd,
    Source,
    Tag,
    FragmentId,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct MemoryPlacementAnchorDto {
    pub kind: MemoryPlacementAnchorKindDto,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryPlacementModeDto {
    Prepend,
    Append,
    BeforeAnchor,
    AfterAnchor,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct MemoryPlacementRuleDto {
    pub slot: MemoryPlacementSlotDto,
    #[serde(default)]
    pub anchor: Option<MemoryPlacementAnchorDto>,
    pub mode: MemoryPlacementModeDto,
    pub depth: i64,
    pub order: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryActivationModeDto {
    Always,
    Keyword,
    Logic,
    Hybrid,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKeywordFieldDto {
    ContentText,
    ContentStructured,
    RecentTraceReasoning,
    RecentEventText,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKeywordMatchModeDto {
    Any,
    All,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum MemoryLogicExprDto {
    And { items: Vec<MemoryLogicExprDto> },
    Or { items: Vec<MemoryLogicExprDto> },
    Not { item: Box<MemoryLogicExprDto> },
    Eq { path: String, value: Value },
    In { path: String, values: Vec<Value> },
    Gt { path: String, value: f64 },
    Lt { path: String, value: f64 },
    Contains { path: String, value: String },
    Exists { path: String },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryRecentSourceDto {
    Trace,
    Intent,
    Event,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryRecentSourceMatchOpDto {
    Eq,
    In,
    Contains,
    Exists,
    Gt,
    Lt,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryRecentSourceTriggerMatchDto {
    pub field: String,
    pub op: MemoryRecentSourceMatchOpDto,
    #[serde(default)]
    pub value: Option<Value>,
    #[serde(default)]
    pub values: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MemoryTriggerDto {
    Keyword {
        r#match: MemoryKeywordMatchModeDto,
        keywords: Vec<String>,
        #[serde(default)]
        case_sensitive: Option<bool>,
        #[serde(default)]
        fields: Option<Vec<MemoryKeywordFieldDto>>,
        #[serde(default)]
        score: Option<f64>,
    },
    Logic {
        expr: MemoryLogicExprDto,
        #[serde(default)]
        score: Option<f64>,
    },
    RecentSource {
        source: MemoryRecentSourceDto,
        r#match: MemoryRecentSourceTriggerMatchDto,
        #[serde(default)]
        score: Option<f64>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryActivationRuleDto {
    pub mode: MemoryActivationModeDto,
    pub trigger_rate: f64,
    pub min_score: f64,
    pub triggers: Vec<MemoryTriggerDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct MemoryRetentionRuleDto {
    pub retain_rounds_after_trigger: i64,
    pub cooldown_rounds_after_insert: i64,
    pub delay_rounds_before_insert: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryBehaviorDto {
    pub mutation: MemoryMutationPolicyDto,
    pub placement: MemoryPlacementRuleDto,
    pub activation: MemoryActivationRuleDto,
    pub retention: MemoryRetentionRuleDto,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryRuntimeStateDto {
    pub memory_id: String,
    pub trigger_count: i64,
    #[serde(default)]
    pub last_triggered_tick: Option<String>,
    #[serde(default)]
    pub last_inserted_tick: Option<String>,
    #[serde(default)]
    pub cooldown_until_tick: Option<String>,
    #[serde(default)]
    pub delayed_until_tick: Option<String>,
    #[serde(default)]
    pub retain_until_tick: Option<String>,
    pub currently_active: bool,
    #[serde(default)]
    pub last_activation_score: Option<f64>,
    #[serde(default)]
    pub recent_distance_from_latest_message: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryBlockRecordDto {
    pub block: MemoryBlockDto,
    pub behavior: MemoryBehaviorDto,
    #[serde(default)]
    pub state: Option<MemoryRuntimeStateDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryRecentSourceRecordKindDto {
    Trace,
    Intent,
    Event,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryRecentSourceRecordDto {
    pub id: String,
    pub kind: MemoryRecentSourceRecordKindDto,
    pub payload: Map<String, Value>,
    pub occurred_at_tick: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryPackStateDto {
    #[serde(default)]
    pub actor_state: Option<Map<String, Value>>,
    #[serde(default)]
    pub world_state: Option<Map<String, Value>>,
    #[serde(default)]
    pub latest_event: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryRecentSourcesDto {
    #[serde(default)]
    pub trace: Option<Vec<MemoryRecentSourceRecordDto>>,
    #[serde(default)]
    pub intent: Option<Vec<MemoryRecentSourceRecordDto>>,
    #[serde(default)]
    pub event: Option<Vec<MemoryRecentSourceRecordDto>>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryEvaluationContextDto {
    pub actor_ref: Value,
    #[serde(default)]
    pub resolved_agent_id: Option<String>,
    #[serde(default)]
    pub pack_id: Option<String>,
    pub current_tick: String,
    #[serde(default)]
    pub attributes: Option<Map<String, Value>>,
    #[serde(default)]
    pub pack_state: Option<MemoryPackStateDto>,
    #[serde(default)]
    pub recent: Option<MemoryRecentSourcesDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MemoryActivationStatusDto {
    Inactive,
    Delayed,
    Active,
    Retained,
    Cooling,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryActivationEvaluationDto {
    pub memory_id: String,
    pub status: MemoryActivationStatusDto,
    pub trigger_diagnostics: MemoryBlockTriggerDiagnosticsDto,
    pub activation_score: f64,
    pub matched_triggers: Vec<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub recent_distance_from_latest_message: Option<i64>,
}


#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryTriggerRateDecisionRecord {
    pub present: bool,
    #[serde(default)]
    pub value: Option<f64>,
    pub applied: bool,
    #[serde(default)]
    pub sample: Option<f64>,
    #[serde(default)]
    pub passed: Option<bool>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryBlockTriggerDiagnosticsDto {
    pub trigger_rate: MemoryTriggerRateDecisionRecord,
    pub base_match: bool,
    pub score_passed: bool,
    pub fresh_trigger_attempt: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryTriggerSourceRecordResult {
    pub memory_id: String,
    pub evaluation: MemoryActivationEvaluationDto,
    pub next_runtime_state: MemoryRuntimeStateDto,
    pub should_materialize: bool,
    #[serde(default)]
    pub materialize_reason: Option<MemoryActivationStatusDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_rate: Option<MemoryTriggerRateDecisionRecord>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct MemoryTriggerRateDecisionSummary {
    pub present_count: usize,
    pub applied_count: usize,
    pub blocked_count: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct MemoryTriggerSourceDiagnostics {
    pub candidate_count: usize,
    pub materialized_count: usize,
    pub status_counts: HashMap<String, usize>,
    pub trigger_rate: MemoryTriggerRateDecisionSummary,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryTriggerSourceEvaluateInput {
    pub protocol_version: String,
    #[serde(default)]
    pub request_id: Option<String>,
    pub evaluation_context: MemoryEvaluationContextDto,
    pub candidates: Vec<MemoryBlockRecordDto>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct MemoryTriggerSourceEvaluateOutput {
    pub protocol_version: &'static str,
    pub records: Vec<MemoryTriggerSourceRecordResult>,
    pub diagnostics: MemoryTriggerSourceDiagnostics,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoryTriggerHealthSnapshot {
    pub protocol_version: &'static str,
    pub status: &'static str,
    pub transport: &'static str,
    pub uptime_ms: u128,
}
