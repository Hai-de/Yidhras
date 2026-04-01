import type { InferenceRequestInput } from '../../inference/types.js';
import type { AppContext } from '../context.js';
import {
  createPendingDecisionJob,
  getDecisionJobByIdempotencyKey,
  listActiveSchedulerAgents,
  listPendingSchedulerActionIntents,
  listPendingSchedulerDecisionJobs,
  listRecentEventFollowupSignals,
  listRecentRecoveryWindowActors,
  listRecentRelationshipFollowupSignals,
  listRecentScheduledDecisionJobs,
  listRecentSnrFollowupSignals
} from '../services/inference_workflow.js';
import { recordSchedulerRunSnapshot } from '../services/scheduler_observability.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  updateSchedulerCursor
} from './scheduler_lease.js';

export const DEFAULT_AGENT_SCHEDULER_COOLDOWN_TICKS = 3n;
export const DEFAULT_AGENT_SCHEDULER_LIMIT = 5;
export const DEFAULT_AGENT_SCHEDULER_EVENT_DELAY_TICKS = 1n;
export const DEFAULT_AGENT_SCHEDULER_MAX_CANDIDATES = 20;

type EventDrivenSchedulerReason = 'event_followup' | 'relationship_change_followup' | 'snr_change_followup';
export type SchedulerReason = 'periodic_tick' | 'bootstrap_seed' | EventDrivenSchedulerReason;
export type SchedulerKind = 'periodic' | 'event_driven';
type SchedulerRecoveryWindowType = 'replay' | 'retry';
export type SchedulerSkipReason =
  | 'pending_workflow'
  | 'periodic_cooldown'
  | 'event_coalesced'
  | 'existing_same_idempotency'
  | 'replay_window_periodic_suppressed'
  | 'replay_window_event_suppressed'
  | 'retry_window_periodic_suppressed'
  | 'retry_window_event_suppressed'
  | 'limit_reached';

interface SchedulerSignalRecord {
  agent_id: string;
  reason: EventDrivenSchedulerReason;
}

interface SchedulerCandidate {
  agent_id: string;
  kind: SchedulerKind;
  primary_reason: SchedulerReason;
  secondary_reasons: SchedulerReason[];
  scheduled_for_tick: bigint;
  priority_score: number;
}

interface SchedulerSignalPolicy {
  priority_score: number;
  delay_ticks: bigint;
  coalesce_window_ticks: bigint;
  suppression_tier: 'high' | 'low';
}

interface SchedulerRecoverySuppressionPolicy {
  suppress_periodic: boolean;
  suppress_event_tiers: Array<SchedulerSignalPolicy['suppression_tier']>;
}

export interface AgentSchedulerCandidateDecisionSnapshot {
  actor_id: string;
  kind: SchedulerKind;
  candidate_reasons: SchedulerReason[];
  chosen_reason: SchedulerReason;
  scheduled_for_tick: bigint;
  priority_score: number;
  skipped_reason: SchedulerSkipReason | null;
  created_job_id: string | null;
}

const PERIODIC_REASON_SET = new Set<SchedulerReason>(['periodic_tick', 'bootstrap_seed']);

const SCHEDULER_SIGNAL_POLICY: Record<EventDrivenSchedulerReason, SchedulerSignalPolicy> = {
  event_followup: {
    priority_score: 30,
    delay_ticks: DEFAULT_AGENT_SCHEDULER_EVENT_DELAY_TICKS,
    coalesce_window_ticks: 2n,
    suppression_tier: 'high'
  },
  relationship_change_followup: {
    priority_score: 20,
    delay_ticks: DEFAULT_AGENT_SCHEDULER_EVENT_DELAY_TICKS,
    coalesce_window_ticks: 2n,
    suppression_tier: 'low'
  },
  snr_change_followup: {
    priority_score: 10,
    delay_ticks: DEFAULT_AGENT_SCHEDULER_EVENT_DELAY_TICKS,
    coalesce_window_ticks: 2n,
    suppression_tier: 'low'
  }
};

const SCHEDULER_RECOVERY_SUPPRESSION_POLICY: Record<
  SchedulerRecoveryWindowType,
  SchedulerRecoverySuppressionPolicy
> = {
  replay: {
    suppress_periodic: true,
    suppress_event_tiers: ['low']
  },
  retry: {
    suppress_periodic: true,
    suppress_event_tiers: ['low']
  }
};

const buildSchedulerCandidateKey = (agentId: string, kind: SchedulerKind, reason: SchedulerReason): string => {
  return `${agentId}:${kind}:${reason}`;
};

const isPeriodicReason = (reason: SchedulerReason): boolean => {
  return PERIODIC_REASON_SET.has(reason);
};

const isEventDrivenReason = (reason: SchedulerReason): reason is EventDrivenSchedulerReason => {
  return !isPeriodicReason(reason);
};

const getSignalPolicy = (reason: EventDrivenSchedulerReason): SchedulerSignalPolicy => {
  return SCHEDULER_SIGNAL_POLICY[reason];
};

const getRecoverySuppressionPolicy = (
  recoveryWindowType: SchedulerRecoveryWindowType
): SchedulerRecoverySuppressionPolicy => {
  return SCHEDULER_RECOVERY_SUPPRESSION_POLICY[recoveryWindowType];
};

const getRecoverySuppressionSkipReason = (
  recoveryWindowType: SchedulerRecoveryWindowType,
  kind: SchedulerKind
): SchedulerSkipReason => {
  if (recoveryWindowType === 'replay') {
    return kind === 'periodic' ? 'replay_window_periodic_suppressed' : 'replay_window_event_suppressed';
  }

  return kind === 'periodic' ? 'retry_window_periodic_suppressed' : 'retry_window_event_suppressed';
};

const shouldSuppressCandidateForRecoveryWindow = (
  candidate: SchedulerCandidate,
  recoveryWindowType: SchedulerRecoveryWindowType
): boolean => {
  const policy = getRecoverySuppressionPolicy(recoveryWindowType);
  if (candidate.kind === 'periodic') {
    return policy.suppress_periodic;
  }

  if (!isEventDrivenReason(candidate.primary_reason)) {
    return false;
  }

  const signalPolicy = getSignalPolicy(candidate.primary_reason);
  return policy.suppress_event_tiers.includes(signalPolicy.suppression_tier);
};

const buildPeriodicCandidates = (agents: SchedulerAgentRecord[], now: bigint, schedulerReason: SchedulerReason): SchedulerCandidate[] => {
  return agents.map(agent => ({
    agent_id: agent.id,
    kind: 'periodic',
    primary_reason: schedulerReason,
    secondary_reasons: [],
    scheduled_for_tick: now,
    priority_score: 1
  }));
};

const mergeEventDrivenSignals = (signals: SchedulerSignalRecord[], now: bigint): SchedulerCandidate[] => {
  const grouped = new Map<string, SchedulerSignalRecord[]>();
  for (const signal of signals) {
    const existing = grouped.get(signal.agent_id);
    if (existing) {
      existing.push(signal);
    } else {
      grouped.set(signal.agent_id, [signal]);
    }
  }

  const candidates: SchedulerCandidate[] = [];
  for (const [agentId, agentSignals] of grouped.entries()) {
    const dedupedReasons = Array.from(new Set(agentSignals.map(signal => signal.reason)));
    dedupedReasons.sort((left, right) => getSignalPolicy(right).priority_score - getSignalPolicy(left).priority_score);
    const primaryReason = dedupedReasons[0];
    const secondaryReasons = dedupedReasons.slice(1);
    const primaryPolicy = getSignalPolicy(primaryReason);

    candidates.push({
      agent_id: agentId,
      kind: 'event_driven',
      primary_reason: primaryReason,
      secondary_reasons: secondaryReasons,
      scheduled_for_tick: now + primaryPolicy.delay_ticks,
      priority_score: primaryPolicy.priority_score
    });
  }

  return candidates;
};

const sortSchedulerCandidates = (candidates: SchedulerCandidate[]): SchedulerCandidate[] => {
  return [...candidates].sort((left, right) => {
    if (left.priority_score !== right.priority_score) {
      return right.priority_score - left.priority_score;
    }
    if (left.scheduled_for_tick !== right.scheduled_for_tick) {
      return left.scheduled_for_tick < right.scheduled_for_tick ? -1 : 1;
    }
    return left.agent_id.localeCompare(right.agent_id);
  });
};

interface SchedulerAgentRecord {
  id: string;
}

export interface RunAgentSchedulerOptions {
  context: AppContext;
  workerId?: string;
  limit?: number;
  cooldownTicks?: bigint;
  strategy?: 'mock' | 'rule_based';
  schedulerReason?: SchedulerReason;
}

export interface AgentSchedulerRunResult {
  scanned_count: number;
  eligible_count: number;
  created_count: number;
  skipped_pending_count: number;
  skipped_cooldown_count: number;
  created_periodic_count: number;
  created_event_driven_count: number;
  signals_detected_count: number;
  scheduled_for_future_count: number;
  skipped_existing_idempotency_count: number;
  skipped_by_reason: Record<SchedulerSkipReason, number>;
  scheduler_run_id?: string;
}

const buildSchedulerIdempotencyKey = (
  agentId: string,
  tick: bigint,
  kind: SchedulerKind,
  reason: SchedulerReason
): string => {
  return `sch:${agentId}:${tick.toString()}:${kind}:${reason}`;
};

const buildScheduledInferenceRequestInput = (
  agentId: string,
  tick: bigint,
  scheduledForTick: bigint,
  kind: SchedulerKind,
  reason: SchedulerReason,
  secondaryReasons: SchedulerReason[],
  priorityScore: number,
  strategy: 'mock' | 'rule_based'
): InferenceRequestInput => {
  return {
    agent_id: agentId,
    identity_id: agentId,
    strategy,
    idempotency_key: buildSchedulerIdempotencyKey(agentId, tick, kind, reason),
    attributes: {
      scheduler_source: 'runtime_loop',
      scheduler_kind: kind,
      scheduler_reason: reason,
      scheduler_secondary_reasons: secondaryReasons,
      scheduler_priority_score: priorityScore,
      scheduler_tick: tick.toString(),
      scheduler_scheduled_for_tick: scheduledForTick.toString()
    }
  };
};

const isAgentInCooldown = (now: bigint, lastScheduledTick: bigint | null, cooldownTicks: bigint): boolean => {
  if (lastScheduledTick === null) {
    return false;
  }

  return now - lastScheduledTick < cooldownTicks;
};

const createInitialSkipCounts = (): Record<SchedulerSkipReason, number> => ({
  pending_workflow: 0,
  periodic_cooldown: 0,
  event_coalesced: 0,
  existing_same_idempotency: 0,
  replay_window_periodic_suppressed: 0,
  replay_window_event_suppressed: 0,
  retry_window_periodic_suppressed: 0,
  retry_window_event_suppressed: 0,
  limit_reached: 0
});

export const runAgentScheduler = async ({
  context,
  workerId = 'runtime:local',
  limit = DEFAULT_AGENT_SCHEDULER_LIMIT,
  cooldownTicks = DEFAULT_AGENT_SCHEDULER_COOLDOWN_TICKS,
  strategy = 'rule_based',
  schedulerReason = 'periodic_tick'
}: RunAgentSchedulerOptions): Promise<AgentSchedulerRunResult> => {
  const startedAt = context.sim.clock.getTicks();
  const now = context.sim.clock.getTicks();
  const leaseResult = await acquireSchedulerLease(context, {
    workerId,
    now
  });
  if (!leaseResult.acquired) {
    return {
      scanned_count: 0,
      eligible_count: 0,
      created_count: 0,
      skipped_pending_count: 0,
      skipped_cooldown_count: 0,
      created_periodic_count: 0,
      created_event_driven_count: 0,
      signals_detected_count: 0,
      scheduled_for_future_count: 0,
      skipped_existing_idempotency_count: 0,
      skipped_by_reason: createInitialSkipCounts()
    };
  }
  const agents = await listActiveSchedulerAgents(context, limit);
  const lookbackTicks = cooldownTicks > 0n ? cooldownTicks : 1n;
  const cursor = await getSchedulerCursor(context);
  const signalSinceTick = cursor ? cursor.last_signal_tick : now - lookbackTicks;
  const recentEventSignals = await listRecentEventFollowupSignals(context, signalSinceTick);
  const recentRelationshipSignals = await listRecentRelationshipFollowupSignals(context, signalSinceTick);
  const recentSnrSignals = await listRecentSnrFollowupSignals(context, signalSinceTick);
  const [replayRecoveryActors, retryRecoveryActors] = await Promise.all([
    listRecentRecoveryWindowActors(context, signalSinceTick, ['replay_recovery']),
    listRecentRecoveryWindowActors(context, signalSinceTick, ['retry_recovery'])
  ]);
  const agentIds = agents.map(agent => agent.id);
  const skipCounts = createInitialSkipCounts();
  const candidateDecisions: AgentSchedulerCandidateDecisionSnapshot[] = [];

  if (agentIds.length === 0) {
    const summary: AgentSchedulerRunResult = {
      scanned_count: 0,
      eligible_count: 0,
      created_count: 0,
      skipped_pending_count: 0,
      skipped_cooldown_count: 0,
      created_periodic_count: 0,
      created_event_driven_count: 0,
      signals_detected_count: 0,
      scheduled_for_future_count: 0,
      skipped_existing_idempotency_count: 0,
      skipped_by_reason: skipCounts
    };
    const schedulerRunId = await recordSchedulerRunSnapshot(context, {
      workerId,
      tick: now,
      startedAt,
      finishedAt: context.sim.clock.getTicks(),
      summary,
      candidateDecisions
    });

    return {
      ...summary,
      scheduler_run_id: schedulerRunId
    };
  }

  const allowedAgentIds = new Set(agentIds);
  const recentSignals = [...recentEventSignals, ...recentRelationshipSignals, ...recentSnrSignals].filter(signal =>
    allowedAgentIds.has(signal.agent_id)
  );

  const periodicCandidates = buildPeriodicCandidates(agents, now, schedulerReason);
  const eventDrivenCandidates = mergeEventDrivenSignals(recentSignals, now);
  const candidates = sortSchedulerCandidates([...eventDrivenCandidates, ...periodicCandidates]);

  const [pendingJobAgentIds, pendingIntentAgentIds, recentScheduledTickByAgent] = await Promise.all([
    listPendingSchedulerDecisionJobs(context, agentIds),
    listPendingSchedulerActionIntents(context, agentIds),
    listRecentScheduledDecisionJobs(context, agentIds)
  ]);

  const pendingJobKeySet = new Set(
    Array.from(pendingJobAgentIds).flatMap(agentId => [
      buildSchedulerCandidateKey(agentId, 'periodic', 'periodic_tick'),
      buildSchedulerCandidateKey(agentId, 'event_driven', 'event_followup'),
      buildSchedulerCandidateKey(agentId, 'event_driven', 'relationship_change_followup'),
      buildSchedulerCandidateKey(agentId, 'event_driven', 'snr_change_followup')
    ])
  );

  let scannedCount = 0;
  let eligibleCount = 0;
  let createdCount = 0;
  let skippedPendingCount = 0;
  let skippedCooldownCount = 0;
  let createdPeriodicCount = 0;
  let createdEventDrivenCount = 0;
  let scheduledForFutureCount = 0;
  let skippedExistingIdempotencyCount = 0;

  for (const candidate of candidates) {
    if (scannedCount >= DEFAULT_AGENT_SCHEDULER_MAX_CANDIDATES) {
      skipCounts.limit_reached += 1;
      candidateDecisions.push({
        actor_id: candidate.agent_id,
        kind: candidate.kind,
        candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
        chosen_reason: candidate.primary_reason,
        scheduled_for_tick: candidate.scheduled_for_tick,
        priority_score: candidate.priority_score,
        skipped_reason: 'limit_reached',
        created_job_id: null
      });
      continue;
    }
    scannedCount += 1;

    const pendingKey = buildSchedulerCandidateKey(candidate.agent_id, candidate.kind, candidate.primary_reason);
    const hasPendingWorkflow = pendingIntentAgentIds.has(candidate.agent_id) || pendingJobKeySet.has(pendingKey);
    if (hasPendingWorkflow) {
      skippedPendingCount += 1;
      skipCounts.pending_workflow += 1;
      candidateDecisions.push({
        actor_id: candidate.agent_id,
        kind: candidate.kind,
        candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
        chosen_reason: candidate.primary_reason,
        scheduled_for_tick: candidate.scheduled_for_tick,
        priority_score: candidate.priority_score,
        skipped_reason: 'pending_workflow',
        created_job_id: null
      });
      continue;
    }

    const lastScheduledTick = recentScheduledTickByAgent.get(candidate.agent_id) ?? null;
    if (candidate.kind === 'event_driven' && candidate.secondary_reasons.length > 0) {
      skipCounts.event_coalesced += candidate.secondary_reasons.length;
    }

    let recoverySuppressedReason: SchedulerSkipReason | null = null;
    if (replayRecoveryActors.has(candidate.agent_id) && shouldSuppressCandidateForRecoveryWindow(candidate, 'replay')) {
      recoverySuppressedReason = getRecoverySuppressionSkipReason('replay', candidate.kind);
    } else if (retryRecoveryActors.has(candidate.agent_id) && shouldSuppressCandidateForRecoveryWindow(candidate, 'retry')) {
      recoverySuppressedReason = getRecoverySuppressionSkipReason('retry', candidate.kind);
    }

    if (recoverySuppressedReason !== null) {
      skipCounts[recoverySuppressedReason] += 1;
      candidateDecisions.push({
        actor_id: candidate.agent_id,
        kind: candidate.kind,
        candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
        chosen_reason: candidate.primary_reason,
        scheduled_for_tick: candidate.scheduled_for_tick,
        priority_score: candidate.priority_score,
        skipped_reason: recoverySuppressedReason,
        created_job_id: null
      });
      continue;
    }

    if (isPeriodicReason(candidate.primary_reason) && isAgentInCooldown(now, lastScheduledTick, cooldownTicks)) {
      skippedCooldownCount += 1;
      skipCounts.periodic_cooldown += 1;
      candidateDecisions.push({
        actor_id: candidate.agent_id,
        kind: candidate.kind,
        candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
        chosen_reason: candidate.primary_reason,
        scheduled_for_tick: candidate.scheduled_for_tick,
        priority_score: candidate.priority_score,
        skipped_reason: 'periodic_cooldown',
        created_job_id: null
      });
      continue;
    }

    eligibleCount += 1;

    const requestInput = buildScheduledInferenceRequestInput(
      candidate.agent_id,
      now,
      candidate.scheduled_for_tick,
      candidate.kind,
      candidate.primary_reason,
      candidate.secondary_reasons,
      candidate.priority_score,
      strategy
    );
    const idempotencyKey = requestInput.idempotency_key;
    if (!idempotencyKey) {
      continue;
    }

    const existingJob = await getDecisionJobByIdempotencyKey(context, idempotencyKey);
    if (existingJob) {
      skippedExistingIdempotencyCount += 1;
      skipCounts.existing_same_idempotency += 1;
      candidateDecisions.push({
        actor_id: candidate.agent_id,
        kind: candidate.kind,
        candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
        chosen_reason: candidate.primary_reason,
        scheduled_for_tick: candidate.scheduled_for_tick,
        priority_score: candidate.priority_score,
        skipped_reason: 'existing_same_idempotency',
        created_job_id: existingJob.id
      });
      continue;
    }

    const createdJob = await createPendingDecisionJob(context, {
      idempotency_key: idempotencyKey,
      request_input: requestInput,
      intent_class: candidate.kind === 'periodic' ? 'scheduler_periodic' : 'scheduler_event_followup',
      job_source: 'scheduler',
      scheduled_for_tick: candidate.scheduled_for_tick
    });
    candidateDecisions.push({
      actor_id: candidate.agent_id,
      kind: candidate.kind,
      candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
      chosen_reason: candidate.primary_reason,
      scheduled_for_tick: candidate.scheduled_for_tick,
      priority_score: candidate.priority_score,
      skipped_reason: null,
      created_job_id: createdJob.id
    });
    createdCount += 1;
    if (candidate.kind === 'periodic') {
      createdPeriodicCount += 1;
    } else {
      createdEventDrivenCount += 1;
    }
    if (candidate.scheduled_for_tick > now) {
      scheduledForFutureCount += 1;
    }
  }

  const summary: AgentSchedulerRunResult = {
    scanned_count: scannedCount,
    eligible_count: eligibleCount,
    created_count: createdCount,
    skipped_pending_count: skippedPendingCount,
    skipped_cooldown_count: skippedCooldownCount,
    created_periodic_count: createdPeriodicCount,
    created_event_driven_count: createdEventDrivenCount,
    signals_detected_count: recentSignals.length,
    scheduled_for_future_count: scheduledForFutureCount,
    skipped_existing_idempotency_count: skippedExistingIdempotencyCount,
    skipped_by_reason: skipCounts
  };

  const schedulerRunId = await recordSchedulerRunSnapshot(context, {
    workerId,
    tick: now,
    startedAt,
    finishedAt: context.sim.clock.getTicks(),
    summary,
    candidateDecisions
  });
  await updateSchedulerCursor(context, {
    lastScannedTick: now,
    lastSignalTick: now,
    now
  });

  return {
    ...summary,
    scheduler_run_id: schedulerRunId
  };
};
