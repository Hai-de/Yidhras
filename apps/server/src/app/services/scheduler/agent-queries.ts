import { getSchedulerObservabilityConfig } from '../../../config/runtime_config.js';
import { ApiError } from '../../../utils/api_error.js';
import type { DataContext } from '../../context.js';
import type { SchedulerReason, SchedulerSkipReason } from '../../runtime/agent_scheduler.js';
import { SCHEDULER_QUERY_INVALID } from './constants.js';
import { buildSchedulerDecisionWorkflowLinks } from './cross-links.js';
import { parseLimit, parseOptionalIdFilter } from './filter-parsers.js';
import { toCandidateDecisionReadModel } from './read-models.js';
import type {
  AgentSchedulerProjection,
  SchedulerCandidateDecisionReadModel} from './types.js';

const emptyAgentProjection = (actorId: string): AgentSchedulerProjection => ({
  actor_id: actorId,
  summary: {
    total_decisions: 0,
    created_count: 0,
    skipped_count: 0,
    periodic_count: 0,
    event_driven_count: 0,
    latest_scheduled_tick: null,
    latest_run_id: null,
    latest_partition_id: null,
    top_reason: null,
    top_skipped_reason: null
  },
  reason_breakdown: [],
  skipped_reason_breakdown: [],
  timeline: [],
  linkage: {
    recent_runs: [],
    recent_created_jobs: []
  }
});

export const getAgentSchedulerProjection = async (
  context: DataContext,
  packId: string,
  actorId: string,
  options?: { limit?: number }
): Promise<AgentSchedulerProjection> => {
  const resolvedActorId = parseOptionalIdFilter(actorId, 'actor_id');
  if (resolvedActorId === null) {
    throw new ApiError(400, SCHEDULER_QUERY_INVALID, 'actor_id is required');
  }

  const limit = parseLimit(options?.limit);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return emptyAgentProjection(resolvedActorId);
  }

  const decisions = adapter.getAgentDecisions(packId, resolvedActorId, limit);

  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(
    context,
    decisions.map(d => ({ id: d.id, created_job_id: d.created_job_id }))
  );

  const timeline = decisions.map(record =>
    toCandidateDecisionReadModel(record, workflowLinks.get(record.id) ?? null)
  );

  const runIds = Array.from(new Set(timeline.map(item => item.scheduler_run_id)));
  const runs: Array<{ run_id: string; tick: string; worker_id: string; partition_id: string; created_at: string }> = [];
  for (const runId of runIds) {
    const run = adapter.getRunById(packId, runId);
    if (run) {
      runs.push({
        run_id: run.id,
        tick: run.tick.toString(),
        worker_id: run.worker_id,
        partition_id: run.partition_id,
        created_at: run.created_at.toString()
      });
    }
  }

  const reasonCounts = new Map<SchedulerReason, number>();
  const skippedReasonCounts = new Map<SchedulerSkipReason, number>();
  let createdCount = 0;
  let skippedCount = 0;
  let periodicCount = 0;
  let eventDrivenCount = 0;

  for (const item of timeline) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- runtime value validated by adapter
    const chosenReason = item.chosen_reason as SchedulerReason;
    reasonCounts.set(chosenReason, (reasonCounts.get(chosenReason) ?? 0) + 1);
    if (item.kind === 'periodic') periodicCount += 1;
    if (item.kind === 'event_driven') eventDrivenCount += 1;

    if (item.skipped_reason === null) {
      createdCount += 1;
    } else {
      skippedCount += 1;
      skippedReasonCounts.set(item.skipped_reason, (skippedReasonCounts.get(item.skipped_reason) ?? 0) + 1);
    }
  }

  const sortedReasons = Array.from(reasonCounts.entries()).sort((left, right) => right[1] - left[1]);
  const sortedSkippedReasons = Array.from(skippedReasonCounts.entries()).sort((left, right) => right[1] - left[1]);

  return {
    actor_id: resolvedActorId,
    summary: {
      total_decisions: timeline.length,
      created_count: createdCount,
      skipped_count: skippedCount,
      periodic_count: periodicCount,
      event_driven_count: eventDrivenCount,
      latest_scheduled_tick: timeline[0]?.scheduled_for_tick ?? null,
      latest_run_id: timeline[0]?.scheduler_run_id ?? null,
      latest_partition_id: timeline[0]?.partition_id ?? null,
      top_reason: sortedReasons[0] ? { reason: sortedReasons[0][0], count: sortedReasons[0][1] } : null,
      top_skipped_reason: sortedSkippedReasons[0]
        ? { skipped_reason: sortedSkippedReasons[0][0], count: sortedSkippedReasons[0][1] }
        : null
    },
    reason_breakdown: sortedReasons.map(([reason, count]) => ({ reason, count })),
    skipped_reason_breakdown: sortedSkippedReasons.map(([skipped_reason, count]) => ({ skipped_reason, count })),
    timeline,
    linkage: {
      recent_runs: runs,
      recent_created_jobs: timeline
        .filter(item => item.created_job_id !== null)
        .map(item => ({
          decision_id: item.id,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- already null-checked above
          job_id: item.created_job_id as string,
          scheduler_run_id: item.scheduler_run_id,
          partition_id: item.partition_id,
          scheduled_for_tick: item.scheduled_for_tick,
          created_at: item.created_at
        }))
    }
  };
};

export const listAgentSchedulerDecisions = (
  context: DataContext,
  packId: string,
  actorId: string,
  limit = getSchedulerObservabilityConfig().default_query_limit
): SchedulerCandidateDecisionReadModel[] => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return [];
  }

  const records = adapter.getAgentDecisions(packId, actorId, limit);
  return records.map(record => toCandidateDecisionReadModel(record));
};
