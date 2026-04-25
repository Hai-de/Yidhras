import { getSchedulerAgentConfig, getSchedulerDecisionKernelConfig, getSchedulerEntityConcurrencyConfig, getSchedulerTickBudgetConfig } from '../../config/runtime_config.js';
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
  listRecentSnrFollowupSignals
} from '../services/inference_workflow.js';
import { recordSchedulerRunSnapshot } from '../services/scheduler_observability.js';
import { listActiveWorkflowActors } from './entity_activity_query.js';
import type {
  AgentSchedulerCandidateDecisionSnapshot,
  AgentSchedulerRunResult,
  EventDrivenSchedulerReason,
  SchedulerKernelCandidateDecision,
  SchedulerKernelEvaluateInput,
  SchedulerKernelJobDraft,
  SchedulerKind,
  SchedulerReason,
  SchedulerRecoverySuppressionPolicy,
  SchedulerRecoveryWindowType,
  SchedulerSignalPolicy,
  SchedulerSkipReason
} from './scheduler_decision_kernel_port.js';
import { createEmptySchedulerRunResult } from './scheduler_decision_kernel_port.js';
import {
  createSchedulerDecisionKernelProvider,
} from './scheduler_decision_kernel_provider.js';
import {
  acquireSchedulerLease,
  getSchedulerCursor,
  updateSchedulerCursor
} from './scheduler_lease.js';
import {
  completeActiveSchedulerOwnershipMigration,
  isWorkerAllowedToOperateSchedulerPartition,
  refreshSchedulerWorkerRuntimeLiveness,
  refreshSchedulerWorkerRuntimeState,
  resolveSchedulerOwnershipSnapshot
} from './scheduler_ownership.js';
import { DEFAULT_SCHEDULER_PARTITION_ID, getSchedulerPartitionCount, resolveSchedulerPartitionId } from './scheduler_partitioning.js';
import { applySchedulerAutomaticRebalanceForWorker, evaluateSchedulerAutomaticRebalance } from './scheduler_rebalance.js';

export type {
  AgentSchedulerCandidateDecisionSnapshot,
  AgentSchedulerRunResult,
  EventDrivenSchedulerReason,
  SchedulerKind,
  SchedulerReason,
  SchedulerRecoveryWindowType,
  SchedulerSkipReason
} from './scheduler_decision_kernel_port.js';

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

interface PartitionSchedulerRunResult extends AgentSchedulerRunResult {
  partition_id: string;
}

const parseTick = (value: string): bigint => BigInt(value);

const getDefaultSchedulerSignalPolicy = (): Record<EventDrivenSchedulerReason, SchedulerSignalPolicy> => {
  const config = getSchedulerAgentConfig().signal_policy;

  return {
    event_followup: {
      priority_score: config.event_followup.priority_score,
      delay_ticks: String(config.event_followup.delay_ticks),
      coalesce_window_ticks: String(config.event_followup.coalesce_window_ticks),
      suppression_tier: config.event_followup.suppression_tier
    },
    relationship_change_followup: {
      priority_score: config.relationship_change_followup.priority_score,
      delay_ticks: String(config.relationship_change_followup.delay_ticks),
      coalesce_window_ticks: String(config.relationship_change_followup.coalesce_window_ticks),
      suppression_tier: config.relationship_change_followup.suppression_tier
    },
    snr_change_followup: {
      priority_score: config.snr_change_followup.priority_score,
      delay_ticks: String(config.snr_change_followup.delay_ticks),
      coalesce_window_ticks: String(config.snr_change_followup.coalesce_window_ticks),
      suppression_tier: config.snr_change_followup.suppression_tier
    },
    overlay_change_followup: {
      priority_score: config.overlay_change_followup.priority_score,
      delay_ticks: String(config.overlay_change_followup.delay_ticks),
      coalesce_window_ticks: String(config.overlay_change_followup.coalesce_window_ticks),
      suppression_tier: config.overlay_change_followup.suppression_tier
    },
    memory_change_followup: {
      priority_score: config.memory_change_followup.priority_score,
      delay_ticks: String(config.memory_change_followup.delay_ticks),
      coalesce_window_ticks: String(config.memory_change_followup.coalesce_window_ticks),
      suppression_tier: config.memory_change_followup.suppression_tier
    }
  };
};

const getDefaultSchedulerRecoverySuppressionPolicy = (): Record<SchedulerRecoveryWindowType, SchedulerRecoverySuppressionPolicy> => {
  const config = getSchedulerAgentConfig().recovery_suppression;

  return {
    replay: {
      suppress_periodic: config.replay.suppress_periodic,
      suppress_event_tiers: [...config.replay.suppress_event_tiers]
    },
    retry: {
      suppress_periodic: config.retry.suppress_periodic,
      suppress_event_tiers: [...config.retry.suppress_event_tiers]
    }
  };
};

const buildSchedulerCandidateKey = (agentId: string, kind: SchedulerKind, reason: SchedulerReason): string => {
  return `${agentId}:${kind}:${reason}`;
};

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

const createEmptyPartitionRunResult = (partitionId: string): PartitionSchedulerRunResult => {
  return createEmptySchedulerRunResult(partitionId);
};

const aggregatePartitionRunResults = (results: PartitionSchedulerRunResult[]): AgentSchedulerRunResult => {
  const skipCounts = createEmptyPartitionRunResult(DEFAULT_SCHEDULER_PARTITION_ID).skipped_by_reason;
  for (const result of results) {
    for (const reason of Object.keys(skipCounts) as SchedulerSkipReason[]) {
      skipCounts[reason] += result.skipped_by_reason[reason];
    }
  }

  const schedulerRunIds = results
    .map(result => result.scheduler_run_id)
    .filter((value): value is string => typeof value === 'string');
  const partitionIds = results.map(result => result.partition_id);

  return {
    scanned_count: results.reduce((sum, result) => sum + result.scanned_count, 0),
    eligible_count: results.reduce((sum, result) => sum + result.eligible_count, 0),
    created_count: results.reduce((sum, result) => sum + result.created_count, 0),
    skipped_pending_count: results.reduce((sum, result) => sum + result.skipped_pending_count, 0),
    skipped_cooldown_count: results.reduce((sum, result) => sum + result.skipped_cooldown_count, 0),
    created_periodic_count: results.reduce((sum, result) => sum + result.created_periodic_count, 0),
    created_event_driven_count: results.reduce((sum, result) => sum + result.created_event_driven_count, 0),
    signals_detected_count: results.reduce((sum, result) => sum + result.signals_detected_count, 0),
    scheduled_for_future_count: results.reduce((sum, result) => sum + result.scheduled_for_future_count, 0),
    skipped_existing_idempotency_count: results.reduce((sum, result) => sum + result.skipped_existing_idempotency_count, 0),
    skipped_by_reason: skipCounts,
    scheduler_run_id: schedulerRunIds[0],
    scheduler_run_ids: schedulerRunIds,
    partition_ids: partitionIds
  };
};

const toCandidateDecisionSnapshots = (
  decisions: SchedulerKernelEvaluateInput['agents'],
  output: SchedulerKernelCandidateDecision[]
): AgentSchedulerCandidateDecisionSnapshot[] => {
  const allowedActorIds = new Set(decisions.map(agent => agent.id));
  return output
    .filter(decision => allowedActorIds.has(decision.actor_id))
    .map(decision => ({
      actor_id: decision.actor_id,
      partition_id: decision.partition_id,
      kind: decision.kind,
      candidate_reasons: [...decision.candidate_reasons],
      chosen_reason: decision.chosen_reason,
      scheduled_for_tick: parseTick(decision.scheduled_for_tick),
      priority_score: decision.priority_score,
      skipped_reason: decision.skipped_reason,
      created_job_id: null
    }));
};

const findCandidateDecisionSnapshot = (
  snapshots: AgentSchedulerCandidateDecisionSnapshot[],
  draft: SchedulerKernelJobDraft
): AgentSchedulerCandidateDecisionSnapshot | undefined => {
  const scheduledForTick = parseTick(draft.scheduled_for_tick);
  return snapshots.find(snapshot =>
    snapshot.actor_id === draft.actor_id
    && snapshot.partition_id === draft.partition_id
    && snapshot.kind === draft.kind
    && snapshot.chosen_reason === draft.primary_reason
    && snapshot.scheduled_for_tick === scheduledForTick
  );
};

const buildSchedulerKernelInput = (input: {
  partitionId: string;
  now: bigint;
  schedulerReason: SchedulerReason;
  limit: number;
  cooldownTicks: bigint;
  agents: SchedulerAgentRecord[];
  recentSignals: Array<{ agent_id: string; reason: EventDrivenSchedulerReason; created_at: bigint }>;
  pendingIntentAgentIds: Set<string>;
  pendingJobKeySet: Set<string>;
  activeWorkflowActorIds: Set<string>;
  recentScheduledTickByAgent: Map<string, bigint>;
  replayRecoveryActors: Set<string>;
  retryRecoveryActors: Set<string>;
  perTickActivationCounts?: Map<string, number>;
  maxCandidates: number;
  maxCreatedJobsPerTick: number;
  maxEntityActivationsPerTick: number;
  entitySingleFlightLimit: number;
}): SchedulerKernelEvaluateInput => ({
  partition_id: input.partitionId,
  now_tick: input.now.toString(),
  scheduler_reason: input.schedulerReason,
  limit: input.limit,
  cooldown_ticks: input.cooldownTicks.toString(),
  max_candidates: input.maxCandidates,
  max_created_jobs_per_tick: input.maxCreatedJobsPerTick,
  max_entity_activations_per_tick: input.maxEntityActivationsPerTick,
  entity_single_flight_limit: input.entitySingleFlightLimit,
  agents: input.agents,
  recent_signals: input.recentSignals.map(signal => ({
    agent_id: signal.agent_id,
    reason: signal.reason,
    created_at: signal.created_at.toString()
  })),
  pending_intent_agent_ids: Array.from(input.pendingIntentAgentIds),
  pending_job_keys: Array.from(input.pendingJobKeySet),
  active_workflow_actor_ids: Array.from(input.activeWorkflowActorIds),
  recent_scheduled_tick_by_agent: Object.fromEntries(
    Array.from(input.recentScheduledTickByAgent.entries()).map(([agentId, tick]) => [agentId, tick.toString()])
  ),
  replay_recovery_actor_ids: Array.from(input.replayRecoveryActors),
  retry_recovery_actor_ids: Array.from(input.retryRecoveryActors),
  per_tick_activation_counts: Object.fromEntries(input.perTickActivationCounts ?? []),
  signal_policy: getDefaultSchedulerSignalPolicy(),
  recovery_suppression: getDefaultSchedulerRecoverySuppressionPolicy()
});

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
  const recentSignals = [
    ...recentEventSignals,
    ...recentRelationshipSignals,
    ...recentSnrSignals,
    ...recentOverlaySignals,
    ...recentMemorySignals
  ].filter(signal => allowedAgentIds.has(signal.agent_id));

  const [pendingJobAgentIds, pendingIntentAgentIds, recentScheduledTickByAgent, activeWorkflowActorIds] = await Promise.all([
    listPendingSchedulerDecisionJobs(context, agentIds),
    listPendingSchedulerActionIntents(context, agentIds),
    listRecentScheduledDecisionJobs(context, agentIds),
    listActiveWorkflowActors(context, agentIds)
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

  const entityConcurrencyConfig = getSchedulerEntityConcurrencyConfig();
  const tickBudgetConfig = getSchedulerTickBudgetConfig();
  const entitySingleFlightLimit = entityConcurrencyConfig.default_max_active_workflows_per_entity;
  const maxEntityActivationsPerTick = entityConcurrencyConfig.max_entity_activations_per_tick;
  const maxCreatedJobsForPartition = Math.min(limit, tickBudgetConfig.max_created_jobs_per_tick);
  const effectiveMaxCandidates = Math.min(getSchedulerAgentConfig().max_candidates, tickBudgetConfig.max_created_jobs_per_tick);

  const kernelConfig = getSchedulerDecisionKernelConfig();
  const schedulerKernel = createSchedulerDecisionKernelProvider({
    timeoutMs: kernelConfig.timeout_ms,
    binaryPath: kernelConfig.binary_path,
    autoRestart: kernelConfig.auto_restart
  });
  const kernelInput = buildSchedulerKernelInput({
    partitionId,
    now,
    schedulerReason,
    limit,
    cooldownTicks,
    agents,
    recentSignals,
    pendingIntentAgentIds,
    pendingJobKeySet,
    activeWorkflowActorIds,
    recentScheduledTickByAgent,
    replayRecoveryActors,
    retryRecoveryActors,
    perTickActivationCounts: new Map<string, number>(),
    maxCandidates: effectiveMaxCandidates,
    maxCreatedJobsPerTick: maxCreatedJobsForPartition,
    maxEntityActivationsPerTick,
    entitySingleFlightLimit
  });
  const { output: kernelOutput } = await schedulerKernel.evaluateWithMetadata(kernelInput);
  candidateDecisions.push(...toCandidateDecisionSnapshots(agents, kernelOutput.candidate_decisions));
  const summary: PartitionSchedulerRunResult = {
    partition_id: partitionId,
    ...kernelOutput.summary
  };

  for (const draft of kernelOutput.job_drafts) {
    const decisionSnapshot = findCandidateDecisionSnapshot(candidateDecisions, draft);
    const requestInput = buildScheduledInferenceRequestInput(
      draft.actor_id,
      now,
      parseTick(draft.scheduled_for_tick),
      draft.kind,
      draft.primary_reason,
      draft.secondary_reasons,
      draft.priority_score,
      strategy,
      draft.partition_id
    );
    const idempotencyKey = requestInput.idempotency_key;
    if (!idempotencyKey) {
      continue;
    }

    const existingJob = await getDecisionJobByIdempotencyKey(context, idempotencyKey);
    if (existingJob) {
      summary.created_count -= 1;
      summary.skipped_existing_idempotency_count += 1;
      summary.skipped_by_reason.existing_same_idempotency += 1;
      if (draft.kind === 'periodic') {
        summary.created_periodic_count -= 1;
      } else {
        summary.created_event_driven_count -= 1;
      }
      if (parseTick(draft.scheduled_for_tick) > now) {
        summary.scheduled_for_future_count -= 1;
      }
      if (decisionSnapshot) {
        decisionSnapshot.skipped_reason = 'existing_same_idempotency';
        decisionSnapshot.created_job_id = existingJob.id;
      }
      continue;
    }

    const createdJob = await createPendingDecisionJob(context, {
      idempotency_key: idempotencyKey,
      request_input: requestInput,
      intent_class: draft.intent_class,
      job_source: draft.job_source,
      scheduled_for_tick: parseTick(draft.scheduled_for_tick)
    });
    if (decisionSnapshot) {
      decisionSnapshot.created_job_id = createdJob.id;
    }
  }

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
  limit = getSchedulerAgentConfig().limit,
  cooldownTicks = BigInt(getSchedulerAgentConfig().cooldown_ticks),
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
