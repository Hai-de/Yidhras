import { getSchedulerObservabilityConfig } from '../../../config/runtime_config.js';
import { ApiError } from '../../../utils/api_error.js';
import type { AppContext } from '../../context.js';
import type { AgentSchedulerRunResult, SchedulerReason, SchedulerSkipReason } from '../../runtime/agent_scheduler.js';
import { listSchedulerWorkerRuntimeStates } from '../../runtime/scheduler_ownership.js';
import type { SchedulerRebalanceRecommendationRecord } from '../../runtime/scheduler_rebalance.js';
import { listRecentSchedulerRebalanceRecommendations } from '../../runtime/scheduler_rebalance.js';
import {
  buildDecisionCursorWhere,
  buildRunCrossLinkSummary,
  buildRunCursorWhere,
  buildSchedulerDecisionWorkflowLinks,
  buildSchedulerOwnershipSummary,
  encodeSchedulerCursor,
  getFilteredPackIds,
  parseDecisionFilters,
  parseLimit,
  parseOptionalIdFilter,
  parseOwnershipAssignmentFilters,
  parseOwnershipMigrationFilters,
  parseRebalanceRecommendationFilters,
  parseRunFilters,
  parseSummaryJson,
  parseWorkerFilters,
  SCHEDULER_QUERY_INVALID,
  toCandidateDecisionReadModel,
  toOwnershipMigrationReadModel,
  toRebalanceRecommendationReadModel,
  toRunReadModel,
  toWorkerRuntimeReadModel} from './helpers.js';
import type {
  AgentSchedulerProjection,
  ListSchedulerDecisionsInput,
  ListSchedulerDecisionsResult,
  ListSchedulerOwnershipAssignmentsInput,
  ListSchedulerOwnershipMigrationsInput,
  ListSchedulerRebalanceRecommendationsInput,
  ListSchedulerRunsInput,
  ListSchedulerRunsResult,
  ListSchedulerWorkersInput,
  RawSchedulerCandidateDecisionRow,
  RawSchedulerMigrationRow,
  RawSchedulerPartitionRow,
  RawSchedulerRunRow,
  SchedulerCandidateDecisionReadModel,
  SchedulerOperatorProjection,
  SchedulerOwnershipAssignmentsResult,
  SchedulerOwnershipMigrationReadModel,
  SchedulerOwnershipMigrationsResult,
  SchedulerPartitionOwnershipReadModel,
  SchedulerRebalanceRecommendationsResult,
  SchedulerRunReadModel,
  SchedulerSummarySnapshot,
  SchedulerTrendsSnapshot,
  SchedulerWorkersResult} from './types.js';

// ---------------------------------------------------------------------------
// Agent-scoped queries
// ---------------------------------------------------------------------------

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
  context: AppContext,
  actorId: string,
  options?: {
    limit?: number;
    packId?: string;
  }
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

  const packIds = getFilteredPackIds(context, options?.packId);
  const allRawDecisions: Array<{ decision: RawSchedulerCandidateDecisionRow; packId: string }> = [];

  for (const pid of packIds) {
    const rows = adapter.getAgentDecisions(pid, resolvedActorId, limit);
    for (const row of rows) {
      allRawDecisions.push({ decision: row as unknown as RawSchedulerCandidateDecisionRow, packId: pid });
    }
  }

  allRawDecisions.sort((a, b) => b.decision.created_at - a.decision.created_at || (b.decision.id < a.decision.id ? -1 : 1));
  const topDecisions = allRawDecisions.slice(0, limit);

  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(context, topDecisions.map(d => ({ id: d.decision.id, created_job_id: d.decision.created_job_id })));
  const timeline = topDecisions.map(({ decision }) =>
    toCandidateDecisionReadModel({
      id: decision.id,
      scheduler_run_id: decision.scheduler_run_id,
      partition_id: decision.partition_id,
      actor_id: decision.actor_id,
      kind: decision.kind,
      candidate_reasons: parseSummaryJson(decision.candidate_reasons),
      chosen_reason: decision.chosen_reason,
      scheduled_for_tick: BigInt(decision.scheduled_for_tick),
      priority_score: decision.priority_score,
      skipped_reason: decision.skipped_reason,
      created_job_id: decision.created_job_id,
      workflow_link: workflowLinks.get(decision.id) ?? null,
      created_at: BigInt(decision.created_at)
    })
  );

  const runIds = Array.from(new Set(timeline.map(item => item.scheduler_run_id)));
  const runs: Array<{ run_id: string; tick: string; worker_id: string; partition_id: string; created_at: string }> = [];
  for (const runId of runIds) {
    for (const pid of packIds) {
      const rows = adapter.listRuns(pid, { where: { id: runId }, take: 1 });
      if (rows.length > 0) {
        const run = rows[0] as unknown as RawSchedulerRunRow;
        runs.push({
          run_id: run.id,
          tick: BigInt(run.tick).toString(),
          worker_id: run.worker_id,
          partition_id: run.partition_id,
          created_at: BigInt(run.created_at).toString()
        });
        break;
      }
    }
  }

  const reasonCounts = new Map<SchedulerReason, number>();
  const skippedReasonCounts = new Map<SchedulerSkipReason, number>();
  let createdCount = 0;
  let skippedCount = 0;
  let periodicCount = 0;
  let eventDrivenCount = 0;

  for (const item of timeline) {
    const chosenReason = item.chosen_reason as SchedulerReason;
    reasonCounts.set(chosenReason, (reasonCounts.get(chosenReason) ?? 0) + 1);
    if (item.kind === 'periodic') {
      periodicCount += 1;
    }
    if (item.kind === 'event_driven') {
      eventDrivenCount += 1;
    }

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
  context: AppContext,
  actorId: string,
  limit = getSchedulerObservabilityConfig().default_query_limit,
  packId?: string
): SchedulerCandidateDecisionReadModel[] => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return [];
  }

  const packIds = getFilteredPackIds(context, packId);
  const allDecisions: RawSchedulerCandidateDecisionRow[] = [];

  for (const pid of packIds) {
    const rows = adapter.getAgentDecisions(pid, actorId, limit);
    for (const row of rows) {
      allDecisions.push(row as unknown as RawSchedulerCandidateDecisionRow);
    }
  }

  allDecisions.sort((a, b) => b.created_at - a.created_at || (b.id < a.id ? -1 : 1));
  const topDecisions = allDecisions.slice(0, limit);

  return topDecisions.map(decision =>
    toCandidateDecisionReadModel({
      id: decision.id,
      scheduler_run_id: decision.scheduler_run_id,
      partition_id: decision.partition_id,
      actor_id: decision.actor_id,
      kind: decision.kind,
      candidate_reasons: parseSummaryJson(decision.candidate_reasons),
      chosen_reason: decision.chosen_reason,
      scheduled_for_tick: BigInt(decision.scheduled_for_tick),
      priority_score: decision.priority_score,
      skipped_reason: decision.skipped_reason,
      created_job_id: decision.created_job_id,
      created_at: BigInt(decision.created_at)
    })
  );
};

// ---------------------------------------------------------------------------
// Run queries
// ---------------------------------------------------------------------------

export const getLatestSchedulerRunReadModel = async (context: AppContext, packId?: string): Promise<SchedulerRunReadModel | null> => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return null;
  }

  const packIds = getFilteredPackIds(context, packId);
  let bestRun: RawSchedulerRunRow | null = null;
  let bestPackId: string | null = null;

  for (const pid of packIds) {
    const rows = adapter.listRuns(pid, { orderBy: { created_at: 'desc' }, take: 1 });
    if (rows.length > 0) {
      const run = rows[0] as unknown as RawSchedulerRunRow;
      if (!bestRun || run.created_at > bestRun.created_at) {
        bestRun = run;
        bestPackId = pid;
      }
    }
  }

  if (!bestRun || !bestPackId) {
    return null;
  }

  const rawDecisions = adapter.listCandidateDecisions(bestPackId, {
    where: { scheduler_run_id: bestRun.id },
    orderBy: { created_at: 'asc' }
  });
  const decisions = rawDecisions.map(row => row as unknown as RawSchedulerCandidateDecisionRow);

  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(context, decisions.map(d => ({ id: d.id, created_job_id: d.created_job_id })));
  const candidates = decisions.map(decision =>
    toCandidateDecisionReadModel({
      id: decision.id,
      scheduler_run_id: decision.scheduler_run_id,
      partition_id: decision.partition_id,
      actor_id: decision.actor_id,
      kind: decision.kind,
      candidate_reasons: parseSummaryJson(decision.candidate_reasons),
      chosen_reason: decision.chosen_reason,
      scheduled_for_tick: BigInt(decision.scheduled_for_tick),
      priority_score: decision.priority_score,
      skipped_reason: decision.skipped_reason,
      created_job_id: decision.created_job_id,
      workflow_link: workflowLinks.get(decision.id) ?? null,
      created_at: BigInt(decision.created_at)
    })
  );

  return {
    run: toRunReadModel({
      id: bestRun.id,
      worker_id: bestRun.worker_id,
      partition_id: bestRun.partition_id,
      lease_holder: bestRun.lease_holder,
      lease_expires_at_snapshot: bestRun.lease_expires_at_snapshot !== null ? BigInt(bestRun.lease_expires_at_snapshot) : null,
      tick: BigInt(bestRun.tick),
      summary: parseSummaryJson(bestRun.summary),
      started_at: BigInt(bestRun.started_at),
      finished_at: BigInt(bestRun.finished_at),
      created_at: BigInt(bestRun.created_at),
      cross_link_summary: buildRunCrossLinkSummary(candidates)
    }),
    candidates
  };
};

export const getSchedulerRunReadModelById = async (
  context: AppContext,
  runId: string,
  packId?: string
): Promise<SchedulerRunReadModel | null> => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return null;
  }

  const packIds = getFilteredPackIds(context, packId);
  for (const pid of packIds) {
    const rows = adapter.listRuns(pid, { where: { id: runId }, take: 1 });
    if (rows.length === 0) {
      continue;
    }

    const schedulerRun = rows[0] as unknown as RawSchedulerRunRow;
    const rawDecisions = adapter.listCandidateDecisions(pid, {
      where: { scheduler_run_id: schedulerRun.id },
      orderBy: { created_at: 'asc' }
    });
    const decisions = rawDecisions.map(row => row as unknown as RawSchedulerCandidateDecisionRow);

    const workflowLinks = await buildSchedulerDecisionWorkflowLinks(context, decisions.map(d => ({ id: d.id, created_job_id: d.created_job_id })));
    const candidates = decisions.map(decision =>
      toCandidateDecisionReadModel({
        id: decision.id,
        scheduler_run_id: decision.scheduler_run_id,
        partition_id: decision.partition_id,
        actor_id: decision.actor_id,
        kind: decision.kind,
        candidate_reasons: parseSummaryJson(decision.candidate_reasons),
        chosen_reason: decision.chosen_reason,
        scheduled_for_tick: BigInt(decision.scheduled_for_tick),
        priority_score: decision.priority_score,
        skipped_reason: decision.skipped_reason,
        created_job_id: decision.created_job_id,
        workflow_link: workflowLinks.get(decision.id) ?? null,
        created_at: BigInt(decision.created_at)
      })
    );

    return {
      run: toRunReadModel({
        id: schedulerRun.id,
        worker_id: schedulerRun.worker_id,
        partition_id: schedulerRun.partition_id,
        lease_holder: schedulerRun.lease_holder,
        lease_expires_at_snapshot: schedulerRun.lease_expires_at_snapshot !== null ? BigInt(schedulerRun.lease_expires_at_snapshot) : null,
        tick: BigInt(schedulerRun.tick),
        summary: parseSummaryJson(schedulerRun.summary),
        started_at: BigInt(schedulerRun.started_at),
        finished_at: BigInt(schedulerRun.finished_at),
        created_at: BigInt(schedulerRun.created_at),
        cross_link_summary: buildRunCrossLinkSummary(candidates)
      }),
      candidates
    };
  }

  return null;
};

const emptyRunListResult = (filters: ReturnType<typeof parseRunFilters>): ListSchedulerRunsResult => ({
  items: [],
  page_info: { has_next_page: false, next_cursor: null },
  summary: {
    returned: 0,
    limit: filters.limit,
    filters: {
      cursor: filters.cursor ? encodeSchedulerCursor(filters.cursor) : null,
      from_tick: filters.from_tick?.toString() ?? null,
      to_tick: filters.to_tick?.toString() ?? null,
      worker_id: filters.worker_id,
      partition_id: filters.partition_id,
      pack_id: filters.pack_id
    }
  }
});

export const listSchedulerRuns = (
  context: AppContext,
  input: ListSchedulerRunsInput
): ListSchedulerRunsResult => {
  const filters = parseRunFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return emptyRunListResult(filters);
  }

  const packIds = getFilteredPackIds(context, filters.pack_id ?? undefined);
  const cursorPredicate = buildRunCursorWhere(filters.cursor);
  const fromTickNum = filters.from_tick !== null ? Number(filters.from_tick) : null;
  const toTickNum = filters.to_tick !== null ? Number(filters.to_tick) : null;

  const allRuns: RawSchedulerRunRow[] = [];
  for (const pid of packIds) {
    const rows = adapter.listRuns(pid, {
      orderBy: { created_at: 'desc' },
      take: filters.limit + 1
    });
    for (const row of rows) {
      const run = row as unknown as RawSchedulerRunRow;
      if (filters.worker_id !== null && run.worker_id !== filters.worker_id) continue;
      if (filters.partition_id !== null && run.partition_id !== filters.partition_id) continue;
      if (fromTickNum !== null && run.tick < fromTickNum) continue;
      if (toTickNum !== null && run.tick > toTickNum) continue;
      if (!cursorPredicate(run)) continue;
      allRuns.push(run);
    }
  }

  allRuns.sort((a, b) => b.created_at - a.created_at || (b.id < a.id ? -1 : 1));
  const totalRuns = allRuns.slice(0, filters.limit + 1);

  const hasNextPage = totalRuns.length > filters.limit;
  const pageItems = totalRuns.slice(0, filters.limit).map(run =>
    toRunReadModel({
      id: run.id,
      worker_id: run.worker_id,
      partition_id: run.partition_id,
      lease_holder: run.lease_holder,
      lease_expires_at_snapshot: run.lease_expires_at_snapshot !== null ? BigInt(run.lease_expires_at_snapshot) : null,
      tick: BigInt(run.tick),
      summary: parseSummaryJson(run.summary),
      started_at: BigInt(run.started_at),
      finished_at: BigInt(run.finished_at),
      created_at: BigInt(run.created_at)
    })
  );
  const nextCursor = hasNextPage && pageItems.length > 0
    ? encodeSchedulerCursor({
        created_at: pageItems[pageItems.length - 1].created_at,
        id: pageItems[pageItems.length - 1].id
      })
    : null;

  return {
    items: pageItems,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: nextCursor
    },
    summary: {
      returned: pageItems.length,
      limit: filters.limit,
      filters: {
        cursor: filters.cursor ? encodeSchedulerCursor(filters.cursor) : null,
        from_tick: filters.from_tick?.toString() ?? null,
        to_tick: filters.to_tick?.toString() ?? null,
        worker_id: filters.worker_id,
        partition_id: filters.partition_id,
        pack_id: filters.pack_id
      }
    }
  };
};

// ---------------------------------------------------------------------------
// Decision queries
// ---------------------------------------------------------------------------

const emptyDecisionListResult = (filters: ReturnType<typeof parseDecisionFilters>): ListSchedulerDecisionsResult => ({
  items: [],
  page_info: { has_next_page: false, next_cursor: null },
  summary: {
    returned: 0,
    limit: filters.limit,
    filters: {
      cursor: filters.cursor ? encodeSchedulerCursor(filters.cursor) : null,
      actor_id: filters.actor_id,
      kind: filters.kind,
      reason: filters.reason,
      skipped_reason: filters.skipped_reason,
      from_tick: filters.from_tick?.toString() ?? null,
      to_tick: filters.to_tick?.toString() ?? null,
      partition_id: filters.partition_id,
      pack_id: filters.pack_id
    }
  }
});

export const listSchedulerDecisions = async (
  context: AppContext,
  input: ListSchedulerDecisionsInput
): Promise<ListSchedulerDecisionsResult> => {
  const filters = parseDecisionFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return emptyDecisionListResult(filters);
  }

  const packIds = getFilteredPackIds(context, filters.pack_id ?? undefined);
  const cursorPredicate = buildDecisionCursorWhere(filters.cursor);
  const fromTickNum = filters.from_tick !== null ? Number(filters.from_tick) : null;
  const toTickNum = filters.to_tick !== null ? Number(filters.to_tick) : null;

  const allDecisions: RawSchedulerCandidateDecisionRow[] = [];
  for (const pid of packIds) {
    const rows = adapter.listCandidateDecisions(pid, {
      orderBy: { created_at: 'desc' },
      take: filters.limit + 1
    });
    for (const row of rows) {
      const decision = row as unknown as RawSchedulerCandidateDecisionRow;
      if (filters.actor_id !== null && decision.actor_id !== filters.actor_id) continue;
      if (filters.kind !== null && decision.kind !== filters.kind) continue;
      if (filters.reason !== null && decision.chosen_reason !== filters.reason) continue;
      if (filters.skipped_reason !== null && decision.skipped_reason !== filters.skipped_reason) continue;
      if (filters.partition_id !== null && decision.partition_id !== filters.partition_id) continue;
      if (fromTickNum !== null && decision.scheduled_for_tick < fromTickNum) continue;
      if (toTickNum !== null && decision.scheduled_for_tick > toTickNum) continue;
      if (!cursorPredicate(decision)) continue;
      allDecisions.push(decision);
    }
  }

  allDecisions.sort((a, b) => b.created_at - a.created_at || (b.id < a.id ? -1 : 1));
  const totalDecisions = allDecisions.slice(0, filters.limit + 1);

  const hasNextPage = totalDecisions.length > filters.limit;
  const pageDecisions = totalDecisions.slice(0, filters.limit);
  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(context, pageDecisions.map(d => ({ id: d.id, created_job_id: d.created_job_id })));
  const pageItems = pageDecisions.map(decision =>
    toCandidateDecisionReadModel({
      id: decision.id,
      scheduler_run_id: decision.scheduler_run_id,
      partition_id: decision.partition_id,
      actor_id: decision.actor_id,
      kind: decision.kind,
      candidate_reasons: parseSummaryJson(decision.candidate_reasons),
      chosen_reason: decision.chosen_reason,
      scheduled_for_tick: BigInt(decision.scheduled_for_tick),
      priority_score: decision.priority_score,
      skipped_reason: decision.skipped_reason,
      created_job_id: decision.created_job_id,
      workflow_link: workflowLinks.get(decision.id) ?? null,
      created_at: BigInt(decision.created_at)
    })
  );
  const nextCursor = hasNextPage && pageItems.length > 0
    ? encodeSchedulerCursor({
        created_at: pageItems[pageItems.length - 1].created_at,
        id: pageItems[pageItems.length - 1].id
      })
    : null;

  return {
    items: pageItems,
    page_info: {
      has_next_page: hasNextPage,
      next_cursor: nextCursor
    },
    summary: {
      returned: pageItems.length,
      limit: filters.limit,
      filters: {
        cursor: filters.cursor ? encodeSchedulerCursor(filters.cursor) : null,
        actor_id: filters.actor_id,
        kind: filters.kind,
        reason: filters.reason,
        skipped_reason: filters.skipped_reason,
        from_tick: filters.from_tick?.toString() ?? null,
        to_tick: filters.to_tick?.toString() ?? null,
        partition_id: filters.partition_id,
        pack_id: filters.pack_id
      }
    }
  };
};

// ---------------------------------------------------------------------------
// Summary / Trends / Operator-projection queries
// ---------------------------------------------------------------------------

export const getSchedulerSummarySnapshot = async (
  context: AppContext,
  input?: { sampleRuns?: number; packId?: string }
): Promise<SchedulerSummarySnapshot> => {
  const config = getSchedulerObservabilityConfig().summary;
  const sampleRuns = Math.min(
    Math.max(input?.sampleRuns ?? config.default_sample_runs, 1),
    config.max_sample_runs
  );
  const adapter = context.schedulerStorage;
  const packIds = getFilteredPackIds(context, input?.packId);

  let allRuns: RawSchedulerRunRow[] = [];
  let allDecisions: RawSchedulerCandidateDecisionRow[] = [];

  if (adapter) {
    for (const pid of packIds) {
      const runs = adapter.listRuns(pid, { orderBy: { created_at: 'desc' }, take: sampleRuns });
      allRuns.push(...runs.map(row => row as unknown as RawSchedulerRunRow));

      const decisions = adapter.listCandidateDecisions(pid, { orderBy: { created_at: 'desc' }, take: sampleRuns * 10 });
      allDecisions.push(...decisions.map(row => row as unknown as RawSchedulerCandidateDecisionRow));
    }
    allRuns.sort((a, b) => {
      const av = a.created_at;
      const bv = b.created_at;
      if (typeof av === 'bigint' && typeof bv === 'bigint') {
        return av > bv ? -1 : av < bv ? 1 : 0;
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return bv - av;
      }
      return 0;
    });
    allRuns = allRuns.slice(0, sampleRuns);
    allDecisions.sort((a, b) => {
      const av = a.created_at;
      const bv = b.created_at;
      if (typeof av === 'bigint' && typeof bv === 'bigint') {
        return av > bv ? -1 : av < bv ? 1 : 0;
      }
      if (typeof av === 'number' && typeof bv === 'number') {
        return bv - av;
      }
      return 0;
    });
    allDecisions = allDecisions.slice(0, sampleRuns * 10);
  }

  const [latestRunReadModel, recentJobs] = await Promise.all([
    getLatestSchedulerRunReadModel(context),
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

  for (const decision of allDecisions) {
    const chosenReason = decision.chosen_reason as SchedulerReason;
    reasonCounts.set(chosenReason, (reasonCounts.get(chosenReason) ?? 0) + 1);
    actorCounts.set(decision.actor_id, (actorCounts.get(decision.actor_id) ?? 0) + 1);
    partitionCounts.set(decision.partition_id, (partitionCounts.get(decision.partition_id) ?? 0) + 1);
    if (decision.skipped_reason) {
      const skippedReason = decision.skipped_reason as SchedulerSkipReason;
      skippedReasonCounts.set(skippedReason, (skippedReasonCounts.get(skippedReason) ?? 0) + 1);
    }
  }

  for (const run of allRuns) {
    workerCounts.set(run.worker_id, (workerCounts.get(run.worker_id) ?? 0) + 1);
  }

  for (const job of recentJobs) {
    intentClassCounts.set(job.intent_class, (intentClassCounts.get(job.intent_class) ?? 0) + 1);
  }

  const runTotals = allRuns.reduce(
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

export const getSchedulerTrendsSnapshot = (
  context: AppContext,
  input?: { sampleRuns?: number; packId?: string }
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

  const packIds = getFilteredPackIds(context, input?.packId);
  let allRuns: RawSchedulerRunRow[] = [];

  for (const pid of packIds) {
    const rows = adapter.listRuns(pid, { orderBy: { created_at: 'desc' }, take: sampleRuns });
    allRuns.push(...rows.map(row => row as unknown as RawSchedulerRunRow));
  }

  allRuns.sort((a, b) => b.created_at - a.created_at);
  allRuns = allRuns.slice(0, sampleRuns);

  return {
    points: allRuns
      .map(run => {
        const summary = parseSummaryJson(run.summary) as AgentSchedulerRunResult;
        return {
          tick: BigInt(run.tick).toString(),
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
// Ownership queries
// ---------------------------------------------------------------------------

export const listSchedulerOwnershipAssignments = (
  context: AppContext,
  input: ListSchedulerOwnershipAssignmentsInput = {}
): SchedulerOwnershipAssignmentsResult => {
  const filters = parseOwnershipAssignmentFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return {
      items: [],
      summary: {
        ...buildSchedulerOwnershipSummary([]),
        filters
      }
    };
  }

  const packIds = getFilteredPackIds(context, filters.pack_id ?? undefined);
  const allPartitions: RawSchedulerPartitionRow[] = [];
  const allMigrations: RawSchedulerMigrationRow[] = [];

  for (const pid of packIds) {
    const partitions = adapter.listPartitions(pid);
    for (const p of partitions) {
      const partition = p as unknown as RawSchedulerPartitionRow;
      if (filters.worker_id !== null && partition.worker_id !== filters.worker_id) continue;
      if (filters.partition_id !== null && partition.partition_id !== filters.partition_id) continue;
      if (filters.status !== null && partition.status !== filters.status) continue;
      allPartitions.push(partition);
    }

    const migrations = adapter.listMigrations(pid);
    for (const m of migrations) {
      allMigrations.push(m as unknown as RawSchedulerMigrationRow);
    }
  }

  allPartitions.sort((a, b) => a.partition_id < b.partition_id ? -1 : 1);

  allMigrations.sort((a, b) => b.created_at - a.created_at);
  const latestMigrationByPartition = new Map<string, RawSchedulerMigrationRow>();
  for (const m of allMigrations) {
    if (!latestMigrationByPartition.has(m.partition_id)) {
      latestMigrationByPartition.set(m.partition_id, m);
    }
  }

  const items = allPartitions.map(assignment => ({
    partition_id: assignment.partition_id,
    worker_id: assignment.worker_id,
    status: assignment.status,
    version: assignment.version,
    source: assignment.source,
    updated_at: BigInt(assignment.updated_at).toString(),
    latest_migration: latestMigrationByPartition.get(assignment.partition_id)
      ? toOwnershipMigrationReadModel({
          id: latestMigrationByPartition.get(assignment.partition_id)!.id,
          partition_id: latestMigrationByPartition.get(assignment.partition_id)!.partition_id,
          from_worker_id: latestMigrationByPartition.get(assignment.partition_id)!.from_worker_id,
          to_worker_id: latestMigrationByPartition.get(assignment.partition_id)!.to_worker_id,
          status: latestMigrationByPartition.get(assignment.partition_id)!.status,
          reason: latestMigrationByPartition.get(assignment.partition_id)!.reason,
          details: latestMigrationByPartition.get(assignment.partition_id)!.details,
          created_at: BigInt(latestMigrationByPartition.get(assignment.partition_id)!.created_at),
          updated_at: BigInt(latestMigrationByPartition.get(assignment.partition_id)!.updated_at),
          completed_at: latestMigrationByPartition.get(assignment.partition_id)!.completed_at !== null
            ? BigInt(latestMigrationByPartition.get(assignment.partition_id)!.completed_at!)
            : null
        })
      : null
  }));
  const summary = buildSchedulerOwnershipSummary(items);

  return {
    items,
    summary: {
      ...summary,
      filters
    }
  };
};

export const listSchedulerOwnershipMigrations = (
  context: AppContext,
  input: ListSchedulerOwnershipMigrationsInput = {}
): SchedulerOwnershipMigrationsResult => {
  const filters = parseOwnershipMigrationFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return {
      items: [],
      summary: { returned: 0, limit: filters.limit, in_progress_count: 0, filters }
    };
  }

  const packIds = getFilteredPackIds(context, filters.pack_id ?? undefined);
  let allMigrations: RawSchedulerMigrationRow[] = [];

  for (const pid of packIds) {
    const migrations = adapter.listMigrations(pid);
    for (const m of migrations) {
      const migration = m as unknown as RawSchedulerMigrationRow;
      if (filters.partition_id !== null && migration.partition_id !== filters.partition_id) continue;
      if (filters.status !== null && migration.status !== filters.status) continue;
      if (filters.worker_id !== null && migration.from_worker_id !== filters.worker_id && migration.to_worker_id !== filters.worker_id) continue;
      allMigrations.push(migration);
    }
  }

  allMigrations.sort((a, b) => b.created_at - a.created_at);
  allMigrations = allMigrations.slice(0, filters.limit);

  const items = allMigrations.map(migration =>
    toOwnershipMigrationReadModel({
      id: migration.id,
      partition_id: migration.partition_id,
      from_worker_id: migration.from_worker_id,
      to_worker_id: migration.to_worker_id,
      status: migration.status,
      reason: migration.reason,
      details: migration.details ? parseSummaryJson(migration.details) : null,
      created_at: BigInt(migration.created_at),
      updated_at: BigInt(migration.updated_at),
      completed_at: migration.completed_at !== null ? BigInt(migration.completed_at) : null
    })
  );

  return {
    items,
    summary: {
      returned: items.length,
      limit: filters.limit,
      in_progress_count: allMigrations.filter(item => item.status === 'requested' || item.status === 'in_progress').length,
      filters
    }
  };
};

// ---------------------------------------------------------------------------
// Worker queries
// ---------------------------------------------------------------------------

export const listSchedulerWorkers = (
  context: AppContext,
  input: ListSchedulerWorkersInput = {}
): SchedulerWorkersResult => {
  const filters = parseWorkerFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return {
      items: [],
      summary: { returned: 0, active_count: 0, stale_count: 0, suspected_dead_count: 0, filters }
    };
  }

  const packIds = getFilteredPackIds(context, filters.pack_id ?? undefined);
  const allWorkers: ReturnType<typeof listSchedulerWorkerRuntimeStates> = [];

  for (const pid of packIds) {
    try {
      const workers = listSchedulerWorkerRuntimeStates(context, pid);
      allWorkers.push(...workers);
    } catch {
      // packId is required by underlying function — skip packs without scheduler storage
    }
  }

  const filteredWorkers = allWorkers.filter(
    worker =>
      (filters.worker_id === null || worker.worker_id === filters.worker_id) &&
      (filters.status === null || worker.status === filters.status)
  );
  const items = filteredWorkers.map(toWorkerRuntimeReadModel);

  return {
    items,
    summary: {
      returned: items.length,
      active_count: items.filter(item => item.status === 'active').length,
      stale_count: items.filter(item => item.status === 'stale').length,
      suspected_dead_count: items.filter(item => item.status === 'suspected_dead').length,
      filters
    }
  };
};

// ---------------------------------------------------------------------------
// Rebalance queries
// ---------------------------------------------------------------------------

export const listSchedulerRebalanceRecommendations = (
  context: AppContext,
  input: ListSchedulerRebalanceRecommendationsInput = {}
): SchedulerRebalanceRecommendationsResult => {
  const filters = parseRebalanceRecommendationFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return {
      items: [],
      summary: { returned: 0, limit: filters.limit, status_breakdown: [], suppress_reason_breakdown: [], filters }
    };
  }

  const packIds = getFilteredPackIds(context, filters.pack_id ?? undefined);
  const allRecommendations: SchedulerRebalanceRecommendationRecord[] = [];

  for (const pid of packIds) {
    try {
      const recommendations = listRecentSchedulerRebalanceRecommendations(context, filters.limit, pid);
      allRecommendations.push(...recommendations);
    } catch {
      // packId is required — skip packs without scheduler storage
    }
  }

  const filteredRecommendations = allRecommendations.filter(
    (item) =>
      (filters.partition_id === null || item.partition_id === filters.partition_id) &&
      (filters.status === null || item.status === filters.status) &&
      (filters.suppress_reason === null || item.suppress_reason === filters.suppress_reason) &&
      (filters.worker_id === null || item.from_worker_id === filters.worker_id || item.to_worker_id === filters.worker_id)
  );
  const items = filteredRecommendations.map(toRebalanceRecommendationReadModel);

  const statusCounts = new Map<string, number>();
  const suppressCounts = new Map<string, number>();
  for (const item of items) {
    statusCounts.set(item.status, (statusCounts.get(item.status) ?? 0) + 1);
    if (item.suppress_reason) {
      suppressCounts.set(item.suppress_reason, (suppressCounts.get(item.suppress_reason) ?? 0) + 1);
    }
  }

  return {
    items,
    summary: {
      returned: items.length,
      limit: filters.limit,
      status_breakdown: Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count })),
      suppress_reason_breakdown: Array.from(suppressCounts.entries()).map(([suppress_reason, count]) => ({ suppress_reason, count })),
      filters
    }
  };
};

// ---------------------------------------------------------------------------
// Operator projection (composite)
// ---------------------------------------------------------------------------

export const getSchedulerOperatorProjection = async (
  context: AppContext,
  input?: { sampleRuns?: number; recentLimit?: number; packId?: string }
): Promise<SchedulerOperatorProjection> => {
  const config = getSchedulerObservabilityConfig().operator_projection;
  const sampleRuns = Math.min(
    Math.max(input?.sampleRuns ?? config.default_sample_runs, 1),
    config.max_sample_runs
  );
  const recentLimit = Math.min(Math.max(input?.recentLimit ?? config.default_recent_limit, 1), config.max_recent_limit);
  const packId = input?.packId;

  const ownershipAssignments = listSchedulerOwnershipAssignments(context, packId ? { pack_id: packId } : {});
  const ownershipMigrations = listSchedulerOwnershipMigrations(context, { limit: recentLimit, ...(packId ? { pack_id: packId } : {}) });
  const workers = listSchedulerWorkers(context, packId ? { pack_id: packId } : {});
  const rebalanceRecommendations = listSchedulerRebalanceRecommendations(context, { limit: recentLimit, ...(packId ? { pack_id: packId } : {}) });

  const [latestRun, summary, trends, recentRunsResult, recentDecisionsResult] = await Promise.all([
    getLatestSchedulerRunReadModel(context, packId),
    getSchedulerSummarySnapshot(context, { sampleRuns, packId }),
    Promise.resolve(getSchedulerTrendsSnapshot(context, { sampleRuns, packId })),
    Promise.resolve(listSchedulerRuns(context, { limit: recentLimit, ...(packId ? { pack_id: packId } : {}) })),
    listSchedulerDecisions(context, { limit: recentLimit, ...(packId ? { pack_id: packId } : {}) })
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

  const latestStaleWorkerId: string | null = workers.items.find(item => item.status === 'stale' || item.status === 'suspected_dead')?.worker_id ?? null;

  const ownershipItems: SchedulerPartitionOwnershipReadModel[] = ownershipAssignments.items;

  const migrationItems: SchedulerOwnershipMigrationReadModel[] = ownershipMigrations.items;
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
      recent_migrations: migrationItems,
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
