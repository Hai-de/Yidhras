import { randomUUID } from 'node:crypto';

import type { AppContext } from '../../context.js';
import type { AgentSchedulerCandidateDecisionSnapshot, AgentSchedulerRunResult } from '../../runtime/agent_scheduler.js';
import { DEFAULT_SCHEDULER_PARTITION_ID } from '../../runtime/scheduler_partitioning.js';

export const writeDetailedSnapshot = (
  packId: string,
  context: AppContext,
  input: {
    workerId: string;
    partitionId?: string;
    leaseHolder?: string | null;
    leaseExpiresAtSnapshot?: bigint | null;
    tick: bigint;
    startedAt: bigint;
    finishedAt: bigint;
    summary: AgentSchedulerRunResult;
    candidateDecisions: AgentSchedulerCandidateDecisionSnapshot[];
  }
): string => {
  const runId = randomUUID();
  const partitionId = input.partitionId ?? DEFAULT_SCHEDULER_PARTITION_ID;
  const adapter = context.schedulerStorage;

  if (adapter) {
    adapter.open(packId);
    adapter.writeDetailedSnapshot(packId, {
      id: runId,
      worker_id: input.workerId,
      partition_id: partitionId,
      lease_holder: input.leaseHolder ?? input.workerId,
      lease_expires_at_snapshot: input.leaseExpiresAtSnapshot ?? null,
      tick: input.tick,
      summary: input.summary as unknown as Record<string, unknown>,
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      created_at: input.finishedAt
    });

    for (const candidate of input.candidateDecisions) {
      adapter.writeCandidateDecision(packId, runId, {
        id: randomUUID(),
        partition_id: candidate.partition_id ?? partitionId,
        actor_id: candidate.actor_id,
        kind: candidate.kind,
        candidate_reasons: candidate.candidate_reasons,
        chosen_reason: candidate.chosen_reason,
        scheduled_for_tick: candidate.scheduled_for_tick,
        priority_score: candidate.priority_score,
        skipped_reason: candidate.skipped_reason,
        created_job_id: candidate.created_job_id,
        created_at: input.finishedAt
      });
    }
  }

  return runId;
};

export const emitAggregatedMetrics = (
  _packId: string,
  _summary: AgentSchedulerRunResult
): void => {
  // Phase 3 stub: aggregated metrics emission point.
};

export const recordSchedulerRunSnapshot = (
  context: AppContext,
  input: {
    workerId: string;
    partitionId?: string;
    leaseHolder?: string | null;
    leaseExpiresAtSnapshot?: bigint | null;
    tick: bigint;
    startedAt: bigint;
    finishedAt: bigint;
    summary: AgentSchedulerRunResult;
    candidateDecisions: AgentSchedulerCandidateDecisionSnapshot[];
  },
  packId?: string
): string => {
  if (packId) {
    const runId = writeDetailedSnapshot(packId, context, input);
    emitAggregatedMetrics(packId, input.summary);
    return runId;
  }

  return randomUUID();
};
