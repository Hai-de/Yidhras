import type { InferenceRequestInput } from '../../inference/types.js';
import type { AppContext } from '../context.js';
import {
  createPendingDecisionJob,
  getDecisionJobByIdempotencyKey,
  getLatestSchedulerSignalTick,
  listActiveSchedulerAgents,
  listPendingSchedulerActionIntents,
  listPendingSchedulerDecisionJobs,
  listRecentEventFollowupSignals,
  listRecentMemoryBlockFollowupSignals,
  listRecentOverlayFollowupSignals,
  listRecentRecoveryWindowActors,
  listRecentRelationshipFollowupSignals,
  listRecentScheduledDecisionJobs,
  listRecentSnrFollowupSignals} from '../services/inference_workflow.js';
import { recordSchedulerRunSnapshot } from '../services/scheduler_observability.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  renewSchedulerLease,
  updateSchedulerCursor
} from './scheduler_lease.js';
import {
  completeActiveSchedulerOwnershipMigration,
  isWorkerAllowedToOperateSchedulerPartition,
  refreshSchedulerWorkerRuntimeLiveness,
  refreshSchedulerWorkerRuntimeState,
  resolveSchedulerOwnershipSnapshot
} from './scheduler_ownership.js';
import {
  DEFAULT_SCHEDULER_PARTITION_ID,
  getSchedulerPartitionCount,
  resolveSchedulerPartitionId
} from './scheduler_partitioning.js';
import {
  applySchedulerAutomaticRebalanceForWorker,
  evaluateSchedulerAutomaticRebalance
} from './scheduler_rebalance.js';

export const DEFAULT_AGENT_SCHEDULER_COOLDOWN_TICKS = 3n;
export const DEFAULT_AGENT_SCHEDULER_LIMIT = 5;
export const DEFAULT_AGENT_SCHEDULER_EVENT_DELAY_TICKS = 1n;
export const DEFAULT_AGENT_SCHEDULER_MAX_CANDIDATES = 20;

type EventDrivenSchedulerReason = 'event_followup' | 'relationship_change_followup' | 'snr_change_followup' | 'overlay_change_followup' | 'memory_change_followup';
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
  partition_id: string;
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
  partition_id: string;
  kind: SchedulerKind;
  candidate_reasons: SchedulerReason[];
  chosen_reason: SchedulerReason;
  scheduled_for_tick: bigint;
  priority_score: number;
  skipped_reason: SchedulerSkipReason | null;
  created_job_id: string | null;
}

interface SchedulerActorReadinessContext {
  now: bigint;
  cooldownTicks: bigint;
  scannedCount: number;
  maxCandidates: number;
  pendingIntentAgentIds: Set<string>;
  pendingJobKeySet: Set<string>;
  recentScheduledTickByAgent: Map<string, bigint>;
  replayRecoveryActors: Set<string>;
  retryRecoveryActors: Set<string>;
}

interface SchedulerActorReadinessResult {
  skipped_reason: SchedulerSkipReason | null;
  counts_as_scanned: boolean;
  coalesced_secondary_reason_count: number;
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
  },
  overlay_change_followup: {
    priority_score: 8,
    delay_ticks: DEFAULT_AGENT_SCHEDULER_EVENT_DELAY_TICKS,
    coalesce_window_ticks: 2n,
    suppression_tier: 'low'
  },
  memory_change_followup: {
    priority_score: 9,
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

const buildPeriodicCandidates = (
  agents: SchedulerAgentRecord[],
  now: bigint,
  schedulerReason: SchedulerReason
): SchedulerCandidate[] => {
  return agents.map(agent => ({
    agent_id: agent.id,
    partition_id: agent.partition_id,
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
      partition_id: resolveSchedulerPartitionId(agentId),
      kind: 'event_driven',
      primary_reason: primaryReason,
      secondary_reasons: secondaryReasons,
      scheduled_for_tick: now + primaryPolicy.delay_ticks,
      priority_score: primaryPolicy.priority_score
    });
  }

  return candidates;
};

const getCandidateDecisionReasons = (candidate: SchedulerCandidate): SchedulerReason[] => {
  return [candidate.primary_reason, ...candidate.secondary_reasons];
};

const buildCandidateDecisionSnapshot = (
  candidate: SchedulerCandidate,
  partitionId: string,
  input: {
    skippedReason: SchedulerSkipReason | null;
    createdJobId: string | null;
  }
): AgentSchedulerCandidateDecisionSnapshot => ({
  actor_id: candidate.agent_id,
  partition_id: partitionId,
  kind: candidate.kind,
  candidate_reasons: getCandidateDecisionReasons(candidate),
  chosen_reason: candidate.primary_reason,
  scheduled_for_tick: candidate.scheduled_for_tick,
  priority_score: candidate.priority_score,
  skipped_reason: input.skippedReason,
  created_job_id: input.createdJobId
});

const countCoalescedSecondaryReasons = (candidate: SchedulerCandidate): number => {
  return candidate.kind === 'event_driven' ? candidate.secondary_reasons.length : 0;
};

const evaluateSchedulerActorReadiness = (
  candidate: SchedulerCandidate,
  input: SchedulerActorReadinessContext
): SchedulerActorReadinessResult => {
  if (input.scannedCount >= input.maxCandidates) {
    return {
      skipped_reason: 'limit_reached',
      counts_as_scanned: false,
      coalesced_secondary_reason_count: 0
    };
  }

  const pendingKey = buildSchedulerCandidateKey(candidate.agent_id, candidate.kind, candidate.primary_reason);
  const hasPendingWorkflow = input.pendingIntentAgentIds.has(candidate.agent_id) || input.pendingJobKeySet.has(pendingKey);
  if (hasPendingWorkflow) {
    return {
      skipped_reason: 'pending_workflow',
      counts_as_scanned: true,
      coalesced_secondary_reason_count: 0
    };
  }

  const coalescedSecondaryReasonCount = countCoalescedSecondaryReasons(candidate);
  if (input.replayRecoveryActors.has(candidate.agent_id) && shouldSuppressCandidateForRecoveryWindow(candidate, 'replay')) {
    return {
      skipped_reason: getRecoverySuppressionSkipReason('replay', candidate.kind),
      counts_as_scanned: true,
      coalesced_secondary_reason_count: coalescedSecondaryReasonCount
    };
  }

  if (input.retryRecoveryActors.has(candidate.agent_id) && shouldSuppressCandidateForRecoveryWindow(candidate, 'retry')) {
    return {
      skipped_reason: getRecoverySuppressionSkipReason('retry', candidate.kind),
      counts_as_scanned: true,
      coalesced_secondary_reason_count: coalescedSecondaryReasonCount
    };
  }

  const lastScheduledTick = input.recentScheduledTickByAgent.get(candidate.agent_id) ?? null;
  if (isPeriodicReason(candidate.primary_reason) && isAgentInCooldown(input.now, lastScheduledTick, input.cooldownTicks)) {
    return {
      skipped_reason: 'periodic_cooldown',
      counts_as_scanned: true,
      coalesced_secondary_reason_count: coalescedSecondaryReasonCount
    };
  }

  return {
    skipped_reason: null,
    counts_as_scanned: true,
    coalesced_secondary_reason_count: coalescedSecondaryReasonCount
  };
};

const sortSchedulerCandidates = (candidates: SchedulerCandidate[]): SchedulerCandidate[] => {
  return [...candidates].sort((left, right) => {
    if (left.priority_score !== right.priority_score) {
      return right.priority_score - left.priority_score;
    }
    if (left.scheduled_for_tick !== right.scheduled_for_tick) {
      return left.scheduled_for_tick < right.scheduled_for_tick ? -1 : 1;
    }
    if (left.partition_id !== right.partition_id) {
      return left.partition_id.localeCompare(right.partition_id);
    }
    return left.agent_id.localeCompare(right.agent_id);
  });
};

interface SchedulerAgentRecord {
  id: string;
  partition_id: string;
}

export interface RunAgentSchedulerOptions {
  context: AppContext;
  workerId?: string;
  partitionIds?: string[];
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
  scheduler_run_ids?: string[];
  partition_ids?: string[];
}

interface PartitionSchedulerRunResult extends Omit<AgentSchedulerRunResult, 'scheduler_run_ids' | 'partition_ids'> {
  partition_id: string;
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
  strategy: 'mock' | 'rule_based',
  partitionId: string
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
      scheduler_scheduled_for_tick: scheduledForTick.toString(),
      scheduler_partition_id: partitionId
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

const createEmptyPartitionRunResult = (partitionId: string): PartitionSchedulerRunResult => ({
  partition_id: partitionId,
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
});

const aggregatePartitionRunResults = (results: PartitionSchedulerRunResult[]): AgentSchedulerRunResult => {
  const skipCounts = createInitialSkipCounts();
  for (const result of results) {
    for (const [reason, count] of Object.entries(result.skipped_by_reason) as Array<[SchedulerSkipReason, number]>) {
      skipCounts[reason] += count;
    }
  }

  const schedulerRunIds = results
    .map(result => result.scheduler_run_id)
    .filter((value): value is string => typeof value === 'string');

  const partitionIds = results.map(result => result.partition_id);

  return {
    scanned_count: results.reduce((sum, item) => sum + item.scanned_count, 0),
    eligible_count: results.reduce((sum, item) => sum + item.eligible_count, 0),
    created_count: results.reduce((sum, item) => sum + item.created_count, 0),
    skipped_pending_count: results.reduce((sum, item) => sum + item.skipped_pending_count, 0),
    skipped_cooldown_count: results.reduce((sum, item) => sum + item.skipped_cooldown_count, 0),
    created_periodic_count: results.reduce((sum, item) => sum + item.created_periodic_count, 0),
    created_event_driven_count: results.reduce((sum, item) => sum + item.created_event_driven_count, 0),
    signals_detected_count: results.reduce((sum, item) => sum + item.signals_detected_count, 0),
    scheduled_for_future_count: results.reduce((sum, item) => sum + item.scheduled_for_future_count, 0),
    skipped_existing_idempotency_count: results.reduce((sum, item) => sum + item.skipped_existing_idempotency_count, 0),
    skipped_by_reason: skipCounts,
    scheduler_run_id: schedulerRunIds[0],
    scheduler_run_ids: schedulerRunIds,
    partition_ids: partitionIds
  };
};

const runAgentSchedulerForPartition = async ({
  context,
  workerId,
  partitionId,
  limit,
  cooldownTicks,
  strategy,
  schedulerReason,
  now,
  startedAt
}: {
  context: AppContext;
  workerId: string;
  partitionId: string;
  limit: number;
  cooldownTicks: bigint;
  strategy: 'mock' | 'rule_based';
  schedulerReason: SchedulerReason;
  now: bigint;
  startedAt: bigint;
}): Promise<PartitionSchedulerRunResult> => {
  const leaseResult = await acquireSchedulerLease(context, {
    workerId,
    partitionId,
    now
  });
  if (!leaseResult.acquired) {
    return createEmptyPartitionRunResult(partitionId);
  }

  if (!(await isWorkerAllowedToOperateSchedulerPartition(context, { partitionId, workerId }))) {
    return createEmptyPartitionRunResult(partitionId);
  }

  await completeActiveSchedulerOwnershipMigration(context, { partitionId, toWorkerId: workerId });

  const cursor = await getSchedulerCursor(context, partitionId);
  const lookbackTicks = cooldownTicks > 0n ? cooldownTicks : 1n;
  const signalSinceTick = cursor ? cursor.last_signal_tick : now - lookbackTicks;
  const [allAgents, recentEventSignals, recentRelationshipSignals, recentSnrSignals, recentOverlaySignals, recentMemorySignals, replayRecoveryActorTicks, retryRecoveryActorTicks] =
    await Promise.all([
      listActiveSchedulerAgents(context, limit * Math.max(getSchedulerPartitionCount(), 1)),
      listRecentEventFollowupSignals(context, signalSinceTick, now),
      listRecentRelationshipFollowupSignals(context, signalSinceTick, now),
      listRecentSnrFollowupSignals(context, signalSinceTick, now),
      listRecentOverlayFollowupSignals(context, signalSinceTick, now),
      listRecentMemoryBlockFollowupSignals(context, signalSinceTick, now),
      listRecentRecoveryWindowActors(context, signalSinceTick, ['replay_recovery'], now),
      listRecentRecoveryWindowActors(context, signalSinceTick, ['retry_recovery'], now)
    ]);

  const agents: SchedulerAgentRecord[] = allAgents
    .map(agent => ({ id: agent.id, partition_id: resolveSchedulerPartitionId(agent.id) }))
    .filter(agent => agent.partition_id === partitionId)
    .slice(0, limit);

  const agentIds = agents.map(agent => agent.id);
  const skipCounts = createInitialSkipCounts();
  const candidateDecisions: AgentSchedulerCandidateDecisionSnapshot[] = [];

  if (agentIds.length === 0) {
    const summary = createEmptyPartitionRunResult(partitionId);
    const schedulerRunId = await recordSchedulerRunSnapshot(context, {
      workerId,
      partitionId,
      leaseHolder: workerId,
      leaseExpiresAtSnapshot: leaseResult.expires_at,
      tick: now,
      startedAt,
      finishedAt: context.sim.getCurrentTick(),
      summary,
      candidateDecisions
    });

    await updateSchedulerCursor(context, {
      partitionId,
      lastScannedTick: now,
      lastSignalTick: signalSinceTick,
      now
    });

    return {
      ...summary,
      scheduler_run_id: schedulerRunId
    };
  }

  const allowedAgentIds = new Set(agentIds);
  const recentSignals = [...recentEventSignals, ...recentRelationshipSignals, ...recentSnrSignals, ...recentOverlaySignals, ...recentMemorySignals].filter(signal =>
    allowedAgentIds.has(signal.agent_id)
  );

  const periodicCandidates = buildPeriodicCandidates(agents, now, schedulerReason);
  const eventDrivenCandidates = mergeEventDrivenSignals(recentSignals, now).filter(
    candidate => candidate.partition_id === partitionId && allowedAgentIds.has(candidate.agent_id)
  );
  const replayRecoveryActors = new Set(
    Array.from(replayRecoveryActorTicks.entries())
      .filter(([actorId]) => allowedAgentIds.has(actorId))
      .map(([actorId]) => actorId)
  );
  const retryRecoveryActors = new Set(
    Array.from(retryRecoveryActorTicks.entries())
      .filter(([actorId]) => allowedAgentIds.has(actorId))
      .map(([actorId]) => actorId)
  );
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
      buildSchedulerCandidateKey(agentId, 'event_driven', 'snr_change_followup'),
      buildSchedulerCandidateKey(agentId, 'event_driven', 'overlay_change_followup'),
      buildSchedulerCandidateKey(agentId, 'event_driven', 'memory_change_followup')
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
    if (!(await isWorkerAllowedToOperateSchedulerPartition(context, { partitionId, workerId }))) {
      break;
    }

    await completeActiveSchedulerOwnershipMigration(context, { partitionId, toWorkerId: workerId });

    const renewedLease = await renewSchedulerLease(context, {
      workerId,
      partitionId,
      now: context.sim.getCurrentTick()
    });
    if (!renewedLease.acquired) {
      break;
    }

    const readiness = evaluateSchedulerActorReadiness(candidate, {
      now,
      cooldownTicks,
      scannedCount,
      maxCandidates: DEFAULT_AGENT_SCHEDULER_MAX_CANDIDATES,
      pendingIntentAgentIds,
      pendingJobKeySet,
      recentScheduledTickByAgent,
      replayRecoveryActors,
      retryRecoveryActors
    });

    if (readiness.coalesced_secondary_reason_count > 0) {
      skipCounts.event_coalesced += readiness.coalesced_secondary_reason_count;
    }

    if (!readiness.counts_as_scanned) {
      skipCounts.limit_reached += 1;
      candidateDecisions.push(buildCandidateDecisionSnapshot(candidate, partitionId, {
        skippedReason: 'limit_reached',
        createdJobId: null
      }));
      continue;
    }

    scannedCount += 1;

    if (readiness.skipped_reason !== null) {
      if (readiness.skipped_reason === 'pending_workflow') {
        skippedPendingCount += 1;
      }
      if (readiness.skipped_reason === 'periodic_cooldown') {
        skippedCooldownCount += 1;
      }

      skipCounts[readiness.skipped_reason] += 1;
      candidateDecisions.push(buildCandidateDecisionSnapshot(candidate, partitionId, {
        skippedReason: readiness.skipped_reason,
        createdJobId: null
      }));
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
      strategy,
      partitionId
    );
    const idempotencyKey = requestInput.idempotency_key;
    if (!idempotencyKey) {
      continue;
    }

    const existingJob = await getDecisionJobByIdempotencyKey(context, idempotencyKey);
    if (existingJob) {
      skippedExistingIdempotencyCount += 1;
      skipCounts.existing_same_idempotency += 1;
      candidateDecisions.push(buildCandidateDecisionSnapshot(candidate, partitionId, {
        skippedReason: 'existing_same_idempotency',
        createdJobId: existingJob.id
      }));
      continue;
    }

    const createdJob = await createPendingDecisionJob(context, {
      idempotency_key: idempotencyKey,
      request_input: requestInput,
      intent_class: candidate.kind === 'periodic' ? 'scheduler_periodic' : 'scheduler_event_followup',
      job_source: 'scheduler',
      scheduled_for_tick: candidate.scheduled_for_tick
    });
    candidateDecisions.push(buildCandidateDecisionSnapshot(candidate, partitionId, {
      skippedReason: null,
      createdJobId: createdJob.id
    }));
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

  const summary: PartitionSchedulerRunResult = {
    partition_id: partitionId,
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
    partitionId,
    leaseHolder: workerId,
    leaseExpiresAtSnapshot: leaseResult.expires_at,
    tick: now,
    startedAt,
    finishedAt: context.sim.getCurrentTick(),
    summary,
    candidateDecisions
  });
  const observedSignalTickCandidates = [
    ...recentSignals.map(signal => signal.created_at),
    ...Array.from(replayRecoveryActorTicks.entries()).filter(([actorId]) => allowedAgentIds.has(actorId)).map(([_actorId, tick]) => tick),
    ...Array.from(retryRecoveryActorTicks.entries()).filter(([actorId]) => allowedAgentIds.has(actorId)).map(([_actorId, tick]) => tick)
  ];
  const observedSignalTick = observedSignalTickCandidates.length > 0
    ? observedSignalTickCandidates.reduce<bigint | null>((latest, tick) => (latest === null || tick > latest ? tick : latest), null)
    : await getLatestSchedulerSignalTick(context, signalSinceTick, now);

  await updateSchedulerCursor(context, {
    partitionId,
    lastScannedTick: now,
    lastSignalTick: observedSignalTick ?? signalSinceTick,
    now
  });

  return {
    ...summary,
    scheduler_run_id: schedulerRunId
  };
};

export const runAgentScheduler = async ({
  context,
  workerId = 'runtime:local',
  partitionIds,
  limit = DEFAULT_AGENT_SCHEDULER_LIMIT,
  cooldownTicks = DEFAULT_AGENT_SCHEDULER_COOLDOWN_TICKS,
  strategy = 'rule_based',
  schedulerReason = 'periodic_tick'
}: RunAgentSchedulerOptions): Promise<AgentSchedulerRunResult> => {
  const startedAt = context.sim.getCurrentTick();
  const now = context.sim.getCurrentTick();
  await refreshSchedulerWorkerRuntimeLiveness(context, now);

  const initialOwnershipSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
    workerId,
    bootstrapPartitionIds: partitionIds
  });
  const initialOwnedPartitionIds = initialOwnershipSnapshot.owned_partition_ids;

  await refreshSchedulerWorkerRuntimeState(context, {
    workerId,
    ownedPartitionIds: initialOwnedPartitionIds,
    now
  });

  await evaluateSchedulerAutomaticRebalance(context, { now });
  await applySchedulerAutomaticRebalanceForWorker(context, { workerId, now });

  const ownershipSnapshot = await resolveSchedulerOwnershipSnapshot(context, {
    workerId,
    bootstrapPartitionIds: partitionIds
  });
  const ownedPartitionIds = ownershipSnapshot.owned_partition_ids;

  if (ownedPartitionIds.length === 0) {
    return {
      ...createEmptyPartitionRunResult(DEFAULT_SCHEDULER_PARTITION_ID),
      partition_ids: [],
      scheduler_run_ids: []
    };
  }
  const partitionResults = await Promise.all(
    ownedPartitionIds.map(partitionId =>
      runAgentSchedulerForPartition({
        context,
        workerId,
        partitionId,
        limit,
        cooldownTicks,
        strategy,
        schedulerReason,
        now,
        startedAt
      })
    )
  );

  return aggregatePartitionRunResults(partitionResults);
};
