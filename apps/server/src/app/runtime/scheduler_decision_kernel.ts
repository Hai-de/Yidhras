import type {
  AgentSchedulerRunResult,
  EventDrivenSchedulerReason,
  SchedulerDecisionKernelPort,
  SchedulerKernelEvaluateInput,
  SchedulerKernelEvaluateOutput,
  SchedulerKernelJobDraft,
  SchedulerKind,
  SchedulerReason,
  SchedulerRecoveryWindowType,
  SchedulerSkipReason
} from './scheduler_decision_kernel_port.js';

interface SchedulerCandidate {
  agent_id: string;
  partition_id: string;
  kind: SchedulerKind;
  primary_reason: SchedulerReason;
  secondary_reasons: SchedulerReason[];
  scheduled_for_tick: bigint;
  priority_score: number;
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
  activeWorkflowActorIds: Set<string>;
  perTickActivationCounts: Map<string, number>;
  maxEntityActivationsPerTick: number;
  entitySingleFlightLimit: number;
}

interface SchedulerActorReadinessResult {
  skipped_reason: SchedulerSkipReason | null;
  counts_as_scanned: boolean;
  coalesced_secondary_reason_count: number;
}

const PERIODIC_REASON_SET = new Set<SchedulerReason>(['periodic_tick', 'bootstrap_seed']);

const parseTick = (value: string): bigint => BigInt(value);

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

const buildSchedulerCandidateKey = (agentId: string, kind: SchedulerKind, reason: SchedulerReason): string => {
  return `${agentId}:${kind}:${reason}`;
};

const isPeriodicReason = (reason: SchedulerReason): boolean => {
  return PERIODIC_REASON_SET.has(reason);
};

const isEventDrivenReason = (reason: SchedulerReason): reason is EventDrivenSchedulerReason => {
  return !isPeriodicReason(reason);
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
  input: SchedulerKernelEvaluateInput,
  candidate: SchedulerCandidate,
  recoveryWindowType: SchedulerRecoveryWindowType
): boolean => {
  const policy = input.recovery_suppression[recoveryWindowType];
  if (candidate.kind === 'periodic') {
    return policy.suppress_periodic;
  }

  if (!isEventDrivenReason(candidate.primary_reason)) {
    return false;
  }

  const signalPolicy = input.signal_policy[candidate.primary_reason];
  return policy.suppress_event_tiers.includes(signalPolicy.suppression_tier);
};

const buildPeriodicCandidates = (
  input: SchedulerKernelEvaluateInput,
  now: bigint
): SchedulerCandidate[] => {
  return input.agents.map(agent => ({
    agent_id: agent.id,
    partition_id: agent.partition_id,
    kind: 'periodic',
    primary_reason: input.scheduler_reason,
    secondary_reasons: [],
    scheduled_for_tick: now,
    priority_score: 1
  }));
};

const mergeEventDrivenSignals = (
  input: SchedulerKernelEvaluateInput,
  now: bigint
): SchedulerCandidate[] => {
  const grouped = new Map<string, EventDrivenSchedulerReason[]>();
  for (const signal of input.recent_signals) {
    const existing = grouped.get(signal.agent_id);
    if (existing) {
      existing.push(signal.reason);
    } else {
      grouped.set(signal.agent_id, [signal.reason]);
    }
  }

  const partitionByAgentId = new Map(input.agents.map(agent => [agent.id, agent.partition_id] as const));
  const candidates: SchedulerCandidate[] = [];
  for (const [agentId, reasons] of grouped.entries()) {
    const partitionId = partitionByAgentId.get(agentId);
    if (!partitionId) {
      continue;
    }

    const dedupedReasons = Array.from(new Set(reasons));
    dedupedReasons.sort((left, right) => input.signal_policy[right].priority_score - input.signal_policy[left].priority_score);
    const primaryReason = dedupedReasons[0];
    const secondaryReasons = dedupedReasons.slice(1);
    const primaryPolicy = input.signal_policy[primaryReason];

    candidates.push({
      agent_id: agentId,
      partition_id: partitionId,
      kind: 'event_driven',
      primary_reason: primaryReason,
      secondary_reasons: secondaryReasons,
      scheduled_for_tick: now + parseTick(primaryPolicy.delay_ticks),
      priority_score: primaryPolicy.priority_score
    });
  }

  return candidates;
};

const countCoalescedSecondaryReasons = (candidate: SchedulerCandidate): number => {
  return candidate.kind === 'event_driven' ? candidate.secondary_reasons.length : 0;
};

const isAgentInCooldown = (now: bigint, lastScheduledTick: bigint | null, cooldownTicks: bigint): boolean => {
  if (lastScheduledTick === null) {
    return false;
  }

  return now - lastScheduledTick < cooldownTicks;
};

const evaluateSchedulerActorReadiness = (
  input: SchedulerKernelEvaluateInput,
  candidate: SchedulerCandidate,
  readinessInput: SchedulerActorReadinessContext
): SchedulerActorReadinessResult => {
  if (readinessInput.scannedCount >= readinessInput.maxCandidates) {
    return {
      skipped_reason: 'limit_reached',
      counts_as_scanned: false,
      coalesced_secondary_reason_count: 0
    };
  }

  const activationCount = readinessInput.perTickActivationCounts.get(candidate.agent_id) ?? 0;
  if (activationCount >= readinessInput.maxEntityActivationsPerTick) {
    return {
      skipped_reason: 'limit_reached',
      counts_as_scanned: false,
      coalesced_secondary_reason_count: countCoalescedSecondaryReasons(candidate)
    };
  }

  const coalescedSecondaryReasonCount = countCoalescedSecondaryReasons(candidate);
  if (
    readinessInput.replayRecoveryActors.has(candidate.agent_id)
    && shouldSuppressCandidateForRecoveryWindow(input, candidate, 'replay')
  ) {
    return {
      skipped_reason: getRecoverySuppressionSkipReason('replay', candidate.kind),
      counts_as_scanned: true,
      coalesced_secondary_reason_count: coalescedSecondaryReasonCount
    };
  }

  if (
    readinessInput.retryRecoveryActors.has(candidate.agent_id)
    && shouldSuppressCandidateForRecoveryWindow(input, candidate, 'retry')
  ) {
    return {
      skipped_reason: getRecoverySuppressionSkipReason('retry', candidate.kind),
      counts_as_scanned: true,
      coalesced_secondary_reason_count: coalescedSecondaryReasonCount
    };
  }

  const pendingKey = buildSchedulerCandidateKey(candidate.agent_id, candidate.kind, candidate.primary_reason);
  const hasPendingWorkflow = readinessInput.pendingIntentAgentIds.has(candidate.agent_id)
    || readinessInput.pendingJobKeySet.has(pendingKey)
    || (readinessInput.entitySingleFlightLimit <= 1 && readinessInput.activeWorkflowActorIds.has(candidate.agent_id));
  if (hasPendingWorkflow) {
    return {
      skipped_reason: 'pending_workflow',
      counts_as_scanned: true,
      coalesced_secondary_reason_count: 0
    };
  }

  const lastScheduledTick = readinessInput.recentScheduledTickByAgent.get(candidate.agent_id) ?? null;
  if (isPeriodicReason(candidate.primary_reason) && isAgentInCooldown(readinessInput.now, lastScheduledTick, readinessInput.cooldownTicks)) {
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

const toJobDraft = (candidate: SchedulerCandidate): SchedulerKernelJobDraft => ({
  actor_id: candidate.agent_id,
  partition_id: candidate.partition_id,
  kind: candidate.kind,
  primary_reason: candidate.primary_reason,
  secondary_reasons: [...candidate.secondary_reasons],
  scheduled_for_tick: candidate.scheduled_for_tick.toString(),
  priority_score: candidate.priority_score,
  intent_class: candidate.kind === 'periodic' ? 'scheduler_periodic' : 'scheduler_event_followup',
  job_source: 'scheduler'
});

/**
 * @deprecated TS fallback for the scheduler decision kernel.
 * Provided solely as a safety net when the Rust sidecar fails.
 * Not maintained for feature development — will be removed in a future release.
 * Do NOT add new features or behavioral changes to this function.
 */
export const evaluateSchedulerDecisionKernel = (
  input: SchedulerKernelEvaluateInput
): SchedulerKernelEvaluateOutput => {
  const now = parseTick(input.now_tick);
  const cooldownTicks = parseTick(input.cooldown_ticks);
  const pendingIntentAgentIds = new Set(input.pending_intent_agent_ids);
  const pendingJobKeySet = new Set(input.pending_job_keys);
  const activeWorkflowActorIds = new Set(input.active_workflow_actor_ids);
  const replayRecoveryActors = new Set(input.replay_recovery_actor_ids);
  const retryRecoveryActors = new Set(input.retry_recovery_actor_ids);
  const recentScheduledTickByAgent = new Map(
    Object.entries(input.recent_scheduled_tick_by_agent).map(([agentId, tick]) => [agentId, parseTick(tick)] as const)
  );
  const perTickActivationCounts = new Map(Object.entries(input.per_tick_activation_counts));

  const periodicCandidates = buildPeriodicCandidates(input, now);
  const eventDrivenCandidates = mergeEventDrivenSignals(input, now);
  const candidates = sortSchedulerCandidates([...eventDrivenCandidates, ...periodicCandidates]);

  const skipCounts = createInitialSkipCounts();
  const candidateDecisions: SchedulerKernelEvaluateOutput['candidate_decisions'] = [];
  const jobDrafts: SchedulerKernelJobDraft[] = [];
  const maxCreatedJobs = Math.min(input.limit, input.max_created_jobs_per_tick);

  let scannedCount = 0;
  let eligibleCount = 0;
  let createdCount = 0;
  let skippedPendingCount = 0;
  let skippedCooldownCount = 0;
  let createdPeriodicCount = 0;
  let createdEventDrivenCount = 0;
  let scheduledForFutureCount = 0;

  for (const candidate of candidates) {
    if (createdCount >= maxCreatedJobs) {
      skipCounts.limit_reached += 1;
      candidateDecisions.push({
        actor_id: candidate.agent_id,
        partition_id: candidate.partition_id,
        kind: candidate.kind,
        candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
        chosen_reason: candidate.primary_reason,
        scheduled_for_tick: candidate.scheduled_for_tick.toString(),
        priority_score: candidate.priority_score,
        skipped_reason: 'limit_reached',
        should_create_job: false
      });
      continue;
    }

    const readiness = evaluateSchedulerActorReadiness(input, candidate, {
      now,
      cooldownTicks,
      scannedCount,
      maxCandidates: Math.min(input.max_candidates, input.max_created_jobs_per_tick),
      pendingIntentAgentIds,
      pendingJobKeySet,
      recentScheduledTickByAgent,
      replayRecoveryActors,
      retryRecoveryActors,
      activeWorkflowActorIds,
      perTickActivationCounts,
      maxEntityActivationsPerTick: input.max_entity_activations_per_tick,
      entitySingleFlightLimit: input.entity_single_flight_limit
    });

    if (readiness.coalesced_secondary_reason_count > 0) {
      skipCounts.event_coalesced += readiness.coalesced_secondary_reason_count;
    }

    if (!readiness.counts_as_scanned) {
      skipCounts.limit_reached += 1;
      candidateDecisions.push({
        actor_id: candidate.agent_id,
        partition_id: candidate.partition_id,
        kind: candidate.kind,
        candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
        chosen_reason: candidate.primary_reason,
        scheduled_for_tick: candidate.scheduled_for_tick.toString(),
        priority_score: candidate.priority_score,
        skipped_reason: 'limit_reached',
        should_create_job: false
      });
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
      candidateDecisions.push({
        actor_id: candidate.agent_id,
        partition_id: candidate.partition_id,
        kind: candidate.kind,
        candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
        chosen_reason: candidate.primary_reason,
        scheduled_for_tick: candidate.scheduled_for_tick.toString(),
        priority_score: candidate.priority_score,
        skipped_reason: readiness.skipped_reason,
        should_create_job: false
      });
      continue;
    }

    eligibleCount += 1;
    createdCount += 1;
    activeWorkflowActorIds.add(candidate.agent_id);
    perTickActivationCounts.set(candidate.agent_id, (perTickActivationCounts.get(candidate.agent_id) ?? 0) + 1);

    if (candidate.kind === 'periodic') {
      createdPeriodicCount += 1;
    } else {
      createdEventDrivenCount += 1;
    }
    if (candidate.scheduled_for_tick > now) {
      scheduledForFutureCount += 1;
    }

    jobDrafts.push(toJobDraft(candidate));
    candidateDecisions.push({
      actor_id: candidate.agent_id,
      partition_id: candidate.partition_id,
      kind: candidate.kind,
      candidate_reasons: [candidate.primary_reason, ...candidate.secondary_reasons],
      chosen_reason: candidate.primary_reason,
      scheduled_for_tick: candidate.scheduled_for_tick.toString(),
      priority_score: candidate.priority_score,
      skipped_reason: null,
      should_create_job: true
    });
  }

  return {
    candidate_decisions: candidateDecisions,
    job_drafts: jobDrafts,
    summary: {
      scanned_count: scannedCount,
      eligible_count: eligibleCount,
      created_count: createdCount,
      skipped_pending_count: skippedPendingCount,
      skipped_cooldown_count: skippedCooldownCount,
      created_periodic_count: createdPeriodicCount,
      created_event_driven_count: createdEventDrivenCount,
      signals_detected_count: input.recent_signals.length,
      scheduled_for_future_count: scheduledForFutureCount,
      skipped_existing_idempotency_count: 0,
      skipped_by_reason: skipCounts
    }
  };
};

/**
 * @deprecated TS fallback for the scheduler decision kernel.
 * Provided solely as a safety net when the Rust sidecar fails.
 * Not maintained for feature development — will be removed in a future release.
 */
export const createTsSchedulerDecisionKernel = (): SchedulerDecisionKernelPort => ({
  async evaluate(input) {
    return evaluateSchedulerDecisionKernel(input);
  }
});

export const createEmptySchedulerRunResult = (partitionId: string): AgentSchedulerRunResult & { partition_id: string } => ({
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
