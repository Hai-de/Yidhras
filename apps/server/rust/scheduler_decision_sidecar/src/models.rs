use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SchedulerKind {
    Periodic,
    EventDriven,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SchedulerReason {
    PeriodicTick,
    BootstrapSeed,
    EventFollowup,
    RelationshipChangeFollowup,
    SnrChangeFollowup,
    OverlayChangeFollowup,
    MemoryChangeFollowup,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SchedulerSkipReason {
    PendingWorkflow,
    PeriodicCooldown,
    EventCoalesced,
    ExistingSameIdempotency,
    ReplayWindowPeriodicSuppressed,
    ReplayWindowEventSuppressed,
    RetryWindowPeriodicSuppressed,
    RetryWindowEventSuppressed,
    LimitReached,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EventDrivenSchedulerReason {
    EventFollowup,
    RelationshipChangeFollowup,
    SnrChangeFollowup,
    OverlayChangeFollowup,
    MemoryChangeFollowup,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum SchedulerRecoveryWindowType {
    Replay,
    Retry,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerSignalPolicy {
    pub priority_score: i64,
    pub delay_ticks: String,
    pub coalesce_window_ticks: String,
    pub suppression_tier: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerRecoverySuppressionPolicy {
    pub suppress_periodic: bool,
    pub suppress_event_tiers: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerKernelAgentRecord {
    pub id: String,
    pub partition_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerKernelSignalRecord {
    pub agent_id: String,
    pub reason: EventDrivenSchedulerReason,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerKernelCandidateDecision {
    pub actor_id: String,
    pub partition_id: String,
    pub kind: SchedulerKind,
    pub candidate_reasons: Vec<SchedulerReason>,
    pub chosen_reason: SchedulerReason,
    pub scheduled_for_tick: String,
    pub priority_score: i64,
    pub skipped_reason: Option<SchedulerSkipReason>,
    pub should_create_job: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerKernelJobDraft {
    pub actor_id: String,
    pub partition_id: String,
    pub kind: SchedulerKind,
    pub primary_reason: SchedulerReason,
    pub secondary_reasons: Vec<SchedulerReason>,
    pub scheduled_for_tick: String,
    pub priority_score: i64,
    pub intent_class: String,
    pub job_source: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerKernelRunSummary {
    pub scanned_count: i64,
    pub eligible_count: i64,
    pub created_count: i64,
    pub skipped_pending_count: i64,
    pub skipped_cooldown_count: i64,
    pub created_periodic_count: i64,
    pub created_event_driven_count: i64,
    pub signals_detected_count: i64,
    pub scheduled_for_future_count: i64,
    pub skipped_existing_idempotency_count: i64,
    pub skipped_by_reason: HashMap<SchedulerSkipReason, i64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerKernelEvaluateInput {
    pub partition_id: String,
    pub now_tick: String,
    pub scheduler_reason: SchedulerReason,
    pub limit: i64,
    pub cooldown_ticks: String,
    pub max_candidates: i64,
    pub max_created_jobs_per_tick: i64,
    pub max_entity_activations_per_tick: i64,
    pub entity_single_flight_limit: i64,
    pub agents: Vec<SchedulerKernelAgentRecord>,
    pub recent_signals: Vec<SchedulerKernelSignalRecord>,
    pub pending_intent_agent_ids: Vec<String>,
    pub pending_job_keys: Vec<String>,
    pub active_workflow_actor_ids: Vec<String>,
    pub recent_scheduled_tick_by_agent: HashMap<String, String>,
    pub replay_recovery_actor_ids: Vec<String>,
    pub retry_recovery_actor_ids: Vec<String>,
    pub per_tick_activation_counts: HashMap<String, i64>,
    pub signal_policy: HashMap<EventDrivenSchedulerReason, SchedulerSignalPolicy>,
    pub recovery_suppression:
        HashMap<SchedulerRecoveryWindowType, SchedulerRecoverySuppressionPolicy>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SchedulerKernelEvaluateOutput {
    pub candidate_decisions: Vec<SchedulerKernelCandidateDecision>,
    pub job_drafts: Vec<SchedulerKernelJobDraft>,
    pub summary: SchedulerKernelRunSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerHealthSnapshot {
    pub protocol_version: &'static str,
    pub status: &'static str,
    pub transport: &'static str,
    pub uptime_ms: u128,
}
