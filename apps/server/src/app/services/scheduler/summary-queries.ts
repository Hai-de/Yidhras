import { getSchedulerObservabilityConfig } from '../../../config/runtime_config.js';
import type { SchedulerCandidateDecisionRecord, SchedulerRunRecord } from '../../../packs/storage/SchedulerStorageAdapter.js';
import type { AppContext } from '../../context.js';
import type {
  AgentSchedulerRunResult,
  SchedulerReason,
  SchedulerSkipReason} from '../../runtime/agent_scheduler.js';
import { buildSchedulerDecisionWorkflowLinks } from './cross-links.js';
import { listSchedulerDecisions } from './decision-queries.js';
import { listSchedulerOwnershipAssignments, listSchedulerOwnershipMigrations } from './ownership-queries.js';
import { buildRunCrossLinkSummary, buildSchedulerOwnershipSummary,parseSummaryJson, toCandidateDecisionReadModel, toRunReadModel  } from './read-models.js';
import { listSchedulerRebalanceRecommendations } from './rebalance-queries.js';
import { getLatestSchedulerRunReadModel, listSchedulerRuns } from './run-queries.js';
import type {
  SchedulerOperatorProjection,
  SchedulerPartitionOwnershipReadModel,
  SchedulerSummarySnapshot,
  SchedulerTrendsSnapshot} from './types.js';
import { listSchedulerWorkers } from './worker-queries.js';

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export const getSchedulerSummarySnapshot = async (
  context: AppContext,
  packId: string,
  input?: { sampleRuns?: number }
): Promise<SchedulerSummarySnapshot> => {
  const config = getSchedulerObservabilityConfig().summary;
  const sampleRuns = Math.min(
    Math.max(input?.sampleRuns ?? config.default_sample_runs, 1),
    config.max_sample_runs
  );
  const adapter = context.schedulerStorage;

  let runs: SchedulerRunRecord[] = [];
  let decisions: SchedulerCandidateDecisionRecord[] = [];

  if (adapter) {
    runs = adapter.listRuns(packId, { orderBy: 'created_at_desc', take: sampleRuns });
    decisions = adapter.listCandidateDecisions(packId, { orderBy: 'created_at_desc', take: sampleRuns * 10 });
  }

  const [latestRunReadModel, recentJobs] = await Promise.all([
    getLatestSchedulerRunReadModel(context, packId),
    context.repos.inference.findDecisionJobs({
      where: {
        intent_class: {
          in: ['scheduler_periodic', 'scheduler_event_followup', 'replay_recovery', 'retry_recovery', 'direct_inference']
        }
      },
      select: {
        intent_class: true
      },
      orderBy: [{ created_at: 'desc' }],
      take: sampleRuns * 10
    })
  ]);

  const reasonCounts = new Map<SchedulerReason, number>();
  const skippedReasonCounts = new Map<SchedulerSkipReason, number>();
  const actorCounts = new Map<string, number>();
  const partitionCounts = new Map<string, number>();
  const workerCounts = new Map<string, number>();
  const intentClassCounts = new Map<string, number>();

  for (const decision of decisions) {
    const chosenReason = decision.chosen_reason as SchedulerReason;
    reasonCounts.set(chosenReason, (reasonCounts.get(chosenReason) ?? 0) + 1);
    actorCounts.set(decision.actor_id, (actorCounts.get(decision.actor_id) ?? 0) + 1);
    partitionCounts.set(decision.partition_id, (partitionCounts.get(decision.partition_id) ?? 0) + 1);
    if (decision.skipped_reason) {
      const skippedReason = decision.skipped_reason as SchedulerSkipReason;
      skippedReasonCounts.set(skippedReason, (skippedReasonCounts.get(skippedReason) ?? 0) + 1);
    }
  }

  for (const run of runs) {
    workerCounts.set(run.worker_id, (workerCounts.get(run.worker_id) ?? 0) + 1);
  }

  for (const job of recentJobs) {
    intentClassCounts.set(job.intent_class, (intentClassCounts.get(job.intent_class) ?? 0) + 1);
  }

  const runTotals = runs.reduce(
    (accumulator, run) => {
      const summary = parseSummaryJson(run.summary) as AgentSchedulerRunResult;
      accumulator.sampled_runs += 1;
      accumulator.created_total += summary.created_count;
      accumulator.created_periodic_total += summary.created_periodic_count;
      accumulator.created_event_driven_total += summary.created_event_driven_count;
      accumulator.skipped_pending_total += summary.skipped_pending_count;
      accumulator.skipped_cooldown_total += summary.skipped_cooldown_count;
      accumulator.signals_detected_total += summary.signals_detected_count;
      return accumulator;
    },
    {
      sampled_runs: 0,
      created_total: 0,
      created_periodic_total: 0,
      created_event_driven_total: 0,
      skipped_pending_total: 0,
      skipped_cooldown_total: 0,
      signals_detected_total: 0
    }
  );

  return {
    latest_run: latestRunReadModel?.run ?? null,
    run_totals: runTotals,
    top_reasons: Array.from(reasonCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count })),
    top_skipped_reasons: Array.from(skippedReasonCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([skipped_reason, count]) => ({ skipped_reason, count })),
    top_actors: Array.from(actorCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([actor_id, count]) => ({ actor_id, count })),
    top_partitions: Array.from(partitionCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([partition_id, count]) => ({ partition_id, count })),
    top_workers: Array.from(workerCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([worker_id, count]) => ({ worker_id, count })),
    intent_class_breakdown: Array.from(intentClassCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([intent_class, count]) => ({ intent_class, count }))
  };
};

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export const getSchedulerTrendsSnapshot = (
  context: AppContext,
  packId: string,
  input?: { sampleRuns?: number }
): SchedulerTrendsSnapshot => {
  const config = getSchedulerObservabilityConfig().trends;
  const sampleRuns = Math.min(
    Math.max(input?.sampleRuns ?? config.default_sample_runs, 1),
    config.max_sample_runs
  );
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return { points: [] };
  }

  const runs = adapter.listRuns(packId, { orderBy: 'created_at_desc', take: sampleRuns });

  return {
    points: runs
      .map(run => {
        const summary = parseSummaryJson(run.summary) as AgentSchedulerRunResult;
        return {
          tick: run.tick.toString(),
          run_id: run.id,
          partition_id: run.partition_id,
          worker_id: run.worker_id,
          created_count: summary.created_count,
          created_periodic_count: summary.created_periodic_count,
          created_event_driven_count: summary.created_event_driven_count,
          signals_detected_count: summary.signals_detected_count,
          skipped_by_reason: summary.skipped_by_reason ?? {}
        };
      })
      .reverse()
  };
};

// ---------------------------------------------------------------------------
// Operator projection
// ---------------------------------------------------------------------------

export const getSchedulerOperatorProjection = async (
  context: AppContext,
  packId: string,
  input?: { sampleRuns?: number; recentLimit?: number }
): Promise<SchedulerOperatorProjection> => {
  const config = getSchedulerObservabilityConfig().operator_projection;
  const sampleRuns = Math.min(
    Math.max(input?.sampleRuns ?? config.default_sample_runs, 1),
    config.max_sample_runs
  );
  const recentLimit = Math.min(
    Math.max(input?.recentLimit ?? config.default_recent_limit, 1),
    config.max_recent_limit
  );

  const ownershipAssignments = listSchedulerOwnershipAssignments(context, packId, {});
  const ownershipMigrations = listSchedulerOwnershipMigrations(context, packId, { limit: recentLimit });
  const workers = listSchedulerWorkers(context, packId, {});
  const rebalanceRecommendations = listSchedulerRebalanceRecommendations(context, packId, { limit: recentLimit });

  const [latestRun, summary, trends, recentRunsResult, recentDecisionsResult] = await Promise.all([
    getLatestSchedulerRunReadModel(context, packId),
    getSchedulerSummarySnapshot(context, packId, { sampleRuns }),
    Promise.resolve(getSchedulerTrendsSnapshot(context, packId, { sampleRuns })),
    Promise.resolve(listSchedulerRuns(context, packId, { limit: recentLimit })),
    listSchedulerDecisions(context, packId, { limit: recentLimit })
  ]);

  const latestCandidates = latestRun?.candidates ?? [];
  const latestMigration = ownershipMigrations.items[0] ?? null;
  const latestRebalance = rebalanceRecommendations.items[0] ?? null;
  const latestCreatedWorkflowCount = latestCandidates.filter(candidate => candidate.workflow_link !== null).length;
  const latestSkippedCount = latestCandidates.filter(candidate => candidate.skipped_reason !== null).length;
  const latestTopIntentType = latestRun?.run.cross_link_summary?.linked_intent_type_breakdown[0]?.intent_type ?? null;
  const latestTopWorkflowState = latestRun?.run.cross_link_summary?.workflow_state_breakdown[0]?.workflow_state ?? null;
  const latestTopSkippedReason = summary.top_skipped_reasons[0]?.skipped_reason ?? null;
  const latestTopFailureCode = latestCandidates.find(candidate => candidate.workflow_link?.failure_code)?.workflow_link?.failure_code ?? null;
  const latestFailedWorkflowCount = latestCandidates.filter(candidate => candidate.workflow_link?.workflow_state === 'failed').length;
  const latestPendingWorkflowCount = latestCandidates.filter(candidate => candidate.workflow_link?.workflow_state === 'pending').length;
  const latestCompletedWorkflowCount = latestCandidates.filter(candidate => candidate.workflow_link?.workflow_state === 'completed').length;
  const latestTopActor = summary.top_actors[0]?.actor_id ?? null;

  const topOwnerWorkerId: string | null = ownershipAssignments.summary.top_workers[0]?.worker_id ?? null;
  const latestStaleWorkerId: string | null = workers.items.find(
    item => item.status === 'stale' || item.status === 'suspected_dead'
  )?.worker_id ?? null;

  const ownershipItems: SchedulerPartitionOwnershipReadModel[] = ownershipAssignments.items;
  const migrationInProgressCount: number = ownershipMigrations.summary.in_progress_count;
  const latestMigrationPartitionId: string | null = latestMigration?.partition_id ?? null;
  const latestMigrationToWorkerId: string | null = latestMigration?.to_worker_id ?? null;

  return {
    latest_run: latestRun,
    summary,
    trends,
    recent_runs: recentRunsResult.items,
    recent_decisions: recentDecisionsResult.items,
    ownership: {
      assignments: ownershipItems,
      recent_migrations: ownershipMigrations.items,
      summary: buildSchedulerOwnershipSummary(ownershipItems)
    },
    workers: {
      items: workers.items,
      summary: workers.summary
    },
    rebalance: {
      recommendations: rebalanceRecommendations.items,
      summary: rebalanceRecommendations.summary
    },
    highlights: {
      latest_partition_id: latestRun?.run.partition_id ?? null,
      latest_created_workflow_count: latestCreatedWorkflowCount,
      latest_skipped_count: latestSkippedCount,
      latest_top_reason: summary.top_reasons[0]?.reason ?? null,
      latest_top_intent_type: latestTopIntentType,
      latest_top_workflow_state: latestTopWorkflowState,
      latest_top_skipped_reason: latestTopSkippedReason,
      latest_top_failure_code: latestTopFailureCode,
      latest_failed_workflow_count: latestFailedWorkflowCount,
      latest_pending_workflow_count: latestPendingWorkflowCount,
      latest_completed_workflow_count: latestCompletedWorkflowCount,
      latest_top_actor: latestTopActor,
      migration_in_progress_count: migrationInProgressCount,
      latest_migration_partition_id: latestMigrationPartitionId,
      latest_migration_to_worker_id: latestMigrationToWorkerId,
      top_owner_worker_id: topOwnerWorkerId,
      latest_rebalance_status: latestRebalance?.status ?? null,
      latest_rebalance_partition_id: latestRebalance?.partition_id ?? null,
      latest_rebalance_suppress_reason: latestRebalance?.suppress_reason ?? null,
      latest_stale_worker_id: latestStaleWorkerId
    }
  };
};
