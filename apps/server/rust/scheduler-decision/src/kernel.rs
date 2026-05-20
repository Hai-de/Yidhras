use std::collections::{HashMap, HashSet};

use crate::models::{
    SchedulerKernelCandidateDecision, SchedulerKernelEvaluateInput, SchedulerKernelEvaluateOutput,
    SchedulerKernelJobDraft, SchedulerKernelRunSummary, SchedulerKind, SchedulerReason,
    SchedulerRecoveryWindowType, SchedulerSkipReason,
};
use crate::policy::{
    is_periodic_reason, recovery_skip_reason, should_suppress_for_recovery_window,
};

#[derive(Debug, Clone)]
struct SchedulerCandidate {
    agent_id: String,
    partition_id: String,
    kind: SchedulerKind,
    primary_reason: SchedulerReason,
    secondary_reasons: Vec<SchedulerReason>,
    scheduled_for_tick: u64,
    priority_score: i64,
}

fn parse_tick(value: &str) -> u64 {
    value.parse::<u64>().unwrap_or(0)
}

fn build_candidate_key(agent_id: &str, kind: &SchedulerKind, reason: &SchedulerReason) -> String {
    format!("{}:{}:{}", agent_id, kind, reason)
}

fn build_periodic_candidates(
    input: &SchedulerKernelEvaluateInput,
    now: u64,
) -> Vec<SchedulerCandidate> {
    input
        .agents
        .iter()
        .map(|agent| SchedulerCandidate {
            agent_id: agent.id.clone(),
            partition_id: agent.partition_id.clone(),
            kind: SchedulerKind::Periodic,
            primary_reason: input.scheduler_reason.clone(),
            secondary_reasons: vec![],
            scheduled_for_tick: now,
            priority_score: 1,
        })
        .collect()
}

fn merge_event_driven_signals(
    input: &SchedulerKernelEvaluateInput,
    now: u64,
) -> Vec<SchedulerCandidate> {
    let mut grouped: HashMap<String, HashSet<crate::models::EventDrivenSchedulerReason>> =
        HashMap::new();
    for signal in &input.recent_signals {
        grouped.entry(signal.agent_id.clone()).or_default().insert(signal.reason.clone());
    }

    let partition_by_agent: HashMap<&str, &str> =
        input.agents.iter().map(|agent| (agent.id.as_str(), agent.partition_id.as_str())).collect();

    let mut candidates = Vec::new();
    for (agent_id, reasons) in grouped {
        let Some(partition_id) = partition_by_agent.get(agent_id.as_str()) else {
            continue;
        };

        let mut deduped: Vec<_> = reasons.into_iter().collect();
        deduped.sort_by(|left, right| {
            let left_priority = input
                .signal_policy
                .get(left)
                .map(|policy| policy.priority_score)
                .unwrap_or_default();
            let right_priority = input
                .signal_policy
                .get(right)
                .map(|policy| policy.priority_score)
                .unwrap_or_default();
            right_priority.cmp(&left_priority)
        });

        let Some(primary_reason) = deduped.first() else {
            continue;
        };
        let secondary_reasons: Vec<SchedulerReason> =
            deduped.iter().skip(1).map(|r| (*r).clone().into()).collect();
        let Some(primary_policy) = input.signal_policy.get(primary_reason) else {
            continue;
        };

        candidates.push(SchedulerCandidate {
            agent_id,
            partition_id: (*partition_id).to_string(),
            kind: SchedulerKind::EventDriven,
            primary_reason: (*primary_reason).clone().into(),
            secondary_reasons,
            scheduled_for_tick: now + parse_tick(&primary_policy.delay_ticks),
            priority_score: primary_policy.priority_score,
        });
    }

    candidates
}

fn sort_candidates(mut candidates: Vec<SchedulerCandidate>) -> Vec<SchedulerCandidate> {
    candidates.sort_by(|left, right| {
        right
            .priority_score
            .cmp(&left.priority_score)
            .then(left.scheduled_for_tick.cmp(&right.scheduled_for_tick))
            .then(left.partition_id.cmp(&right.partition_id))
            .then(left.agent_id.cmp(&right.agent_id))
    });
    candidates
}

fn to_job_draft(candidate: &SchedulerCandidate) -> SchedulerKernelJobDraft {
    SchedulerKernelJobDraft {
        actor_id: candidate.agent_id.clone(),
        partition_id: candidate.partition_id.clone(),
        kind: candidate.kind.clone(),
        primary_reason: candidate.primary_reason.clone(),
        secondary_reasons: candidate.secondary_reasons.clone(),
        scheduled_for_tick: candidate.scheduled_for_tick.to_string(),
        priority_score: candidate.priority_score,
        intent_class: match candidate.kind {
            SchedulerKind::Periodic => "scheduler_periodic".to_string(),
            SchedulerKind::EventDriven => "scheduler_event_followup".to_string(),
        },
        job_source: "scheduler".to_string(),
    }
}

fn build_candidate_reasons(candidate: &SchedulerCandidate) -> Vec<SchedulerReason> {
    std::iter::once(candidate.primary_reason.clone())
        .chain(candidate.secondary_reasons.clone().into_iter())
        .collect()
}

fn build_skip_decision(
    candidate: &SchedulerCandidate,
    skip_reason: SchedulerSkipReason,
) -> SchedulerKernelCandidateDecision {
    SchedulerKernelCandidateDecision {
        actor_id: candidate.agent_id.clone(),
        partition_id: candidate.partition_id.clone(),
        kind: candidate.kind.clone(),
        candidate_reasons: build_candidate_reasons(candidate),
        chosen_reason: candidate.primary_reason.clone(),
        scheduled_for_tick: candidate.scheduled_for_tick.to_string(),
        priority_score: candidate.priority_score,
        skipped_reason: Some(skip_reason),
        should_create_job: false,
    }
}

fn build_accept_decision(candidate: &SchedulerCandidate) -> SchedulerKernelCandidateDecision {
    SchedulerKernelCandidateDecision {
        actor_id: candidate.agent_id.clone(),
        partition_id: candidate.partition_id.clone(),
        kind: candidate.kind.clone(),
        candidate_reasons: build_candidate_reasons(candidate),
        chosen_reason: candidate.primary_reason.clone(),
        scheduled_for_tick: candidate.scheduled_for_tick.to_string(),
        priority_score: candidate.priority_score,
        skipped_reason: None,
        should_create_job: true,
    }
}

fn determine_skip_reason(
    candidate: &SchedulerCandidate,
    now: u64,
    cooldown_ticks: u64,
    input: &SchedulerKernelEvaluateInput,
    pending_intent_agent_ids: &HashSet<String>,
    pending_job_keys: &HashSet<String>,
    active_workflow_actor_ids: &HashSet<String>,
    replay_recovery_actor_ids: &HashSet<String>,
    retry_recovery_actor_ids: &HashSet<String>,
    recent_scheduled_tick_by_agent: &HashMap<String, u64>,
) -> Option<SchedulerSkipReason> {
    if replay_recovery_actor_ids.contains(&candidate.agent_id)
        && should_suppress_for_recovery_window(
            input,
            &candidate.kind,
            &candidate.primary_reason,
            &SchedulerRecoveryWindowType::Replay,
        )
    {
        return Some(recovery_skip_reason(&SchedulerRecoveryWindowType::Replay, &candidate.kind));
    }

    if retry_recovery_actor_ids.contains(&candidate.agent_id)
        && should_suppress_for_recovery_window(
            input,
            &candidate.kind,
            &candidate.primary_reason,
            &SchedulerRecoveryWindowType::Retry,
        )
    {
        return Some(recovery_skip_reason(&SchedulerRecoveryWindowType::Retry, &candidate.kind));
    }

    let pending_key =
        build_candidate_key(&candidate.agent_id, &candidate.kind, &candidate.primary_reason);
    let has_pending_workflow = pending_intent_agent_ids.contains(&candidate.agent_id)
        || pending_job_keys.contains(&pending_key)
        || (input.entity_single_flight_limit <= 1
            && active_workflow_actor_ids.contains(&candidate.agent_id));
    if has_pending_workflow {
        return Some(SchedulerSkipReason::PendingWorkflow);
    }

    let last_scheduled_tick = recent_scheduled_tick_by_agent.get(&candidate.agent_id).copied();
    if is_periodic_reason(&candidate.primary_reason)
        && last_scheduled_tick
            .map(|tick| now.saturating_sub(tick) < cooldown_ticks)
            .unwrap_or(false)
    {
        return Some(SchedulerSkipReason::PeriodicCooldown);
    }

    None
}

pub fn evaluate(input: SchedulerKernelEvaluateInput) -> SchedulerKernelEvaluateOutput {
    let now = parse_tick(&input.now_tick);
    let cooldown_ticks = parse_tick(&input.cooldown_ticks);
    let pending_intent_agent_ids: HashSet<String> =
        input.pending_intent_agent_ids.iter().cloned().collect();
    let pending_job_keys: HashSet<String> = input.pending_job_keys.iter().cloned().collect();
    let mut active_workflow_actor_ids: HashSet<String> =
        input.active_workflow_actor_ids.iter().cloned().collect();
    let replay_recovery_actor_ids: HashSet<String> =
        input.replay_recovery_actor_ids.iter().cloned().collect();
    let retry_recovery_actor_ids: HashSet<String> =
        input.retry_recovery_actor_ids.iter().cloned().collect();
    let recent_scheduled_tick_by_agent: HashMap<String, u64> = input
        .recent_scheduled_tick_by_agent
        .iter()
        .map(|(agent_id, tick)| (agent_id.clone(), parse_tick(tick)))
        .collect();
    let mut per_tick_activation_counts = input.per_tick_activation_counts.clone();

    let periodic_candidates = build_periodic_candidates(&input, now);
    let event_candidates = merge_event_driven_signals(&input, now);
    let candidates =
        sort_candidates(event_candidates.into_iter().chain(periodic_candidates).collect());

    let mut skip_counts: HashMap<SchedulerSkipReason, i64> = HashMap::new();
    let mut candidate_decisions = Vec::new();
    let mut job_drafts = Vec::new();
    let max_created_jobs = input.limit.min(input.max_created_jobs_per_tick);

    let mut scanned_count = 0i64;
    let mut eligible_count = 0i64;
    let mut created_count = 0i64;
    let mut skipped_pending_count = 0i64;
    let mut skipped_cooldown_count = 0i64;
    let mut created_periodic_count = 0i64;
    let mut created_event_driven_count = 0i64;
    let mut scheduled_for_future_count = 0i64;

    for candidate in candidates {
        if created_count >= max_created_jobs {
            *skip_counts.entry(SchedulerSkipReason::LimitReached).or_insert(0) += 1;
            candidate_decisions
                .push(build_skip_decision(&candidate, SchedulerSkipReason::LimitReached));
            continue;
        }

        let activation_count =
            per_tick_activation_counts.get(&candidate.agent_id).copied().unwrap_or(0);
        if scanned_count >= input.max_candidates
            || activation_count >= input.max_entity_activations_per_tick
        {
            *skip_counts.entry(SchedulerSkipReason::LimitReached).or_insert(0) += 1;
            candidate_decisions
                .push(build_skip_decision(&candidate, SchedulerSkipReason::LimitReached));
            continue;
        }

        let coalesced_secondary_reason_count = candidate.secondary_reasons.len() as i64;
        if coalesced_secondary_reason_count > 0 {
            *skip_counts.entry(SchedulerSkipReason::EventCoalesced).or_insert(0) +=
                coalesced_secondary_reason_count;
        }

        scanned_count += 1;

        let skipped_reason = determine_skip_reason(
            &candidate,
            now,
            cooldown_ticks,
            &input,
            &pending_intent_agent_ids,
            &pending_job_keys,
            &active_workflow_actor_ids,
            &replay_recovery_actor_ids,
            &retry_recovery_actor_ids,
            &recent_scheduled_tick_by_agent,
        );

        if let Some(reason) = skipped_reason {
            if reason == SchedulerSkipReason::PendingWorkflow {
                skipped_pending_count += 1;
            }
            if reason == SchedulerSkipReason::PeriodicCooldown {
                skipped_cooldown_count += 1;
            }
            *skip_counts.entry(reason.clone()).or_insert(0) += 1;
            candidate_decisions.push(build_skip_decision(&candidate, reason));
            continue;
        }

        eligible_count += 1;
        created_count += 1;
        active_workflow_actor_ids.insert(candidate.agent_id.clone());
        per_tick_activation_counts
            .entry(candidate.agent_id.clone())
            .and_modify(|count| *count += 1)
            .or_insert(1);

        match candidate.kind {
            SchedulerKind::Periodic => created_periodic_count += 1,
            SchedulerKind::EventDriven => created_event_driven_count += 1,
        }
        if candidate.scheduled_for_tick > now {
            scheduled_for_future_count += 1;
        }

        job_drafts.push(to_job_draft(&candidate));
        candidate_decisions.push(build_accept_decision(&candidate));
    }

    SchedulerKernelEvaluateOutput {
        candidate_decisions,
        job_drafts,
        summary: SchedulerKernelRunSummary {
            scanned_count,
            eligible_count,
            created_count,
            skipped_pending_count,
            skipped_cooldown_count,
            created_periodic_count,
            created_event_driven_count,
            signals_detected_count: input.recent_signals.len() as i64,
            scheduled_for_future_count,
            skipped_existing_idempotency_count: 0,
            skipped_by_reason: skip_counts,
        },
    }
}
