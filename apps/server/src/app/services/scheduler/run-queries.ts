import type { ListRunsInput, SchedulerRunRecord } from '../../../packs/storage/SchedulerStorageAdapter.js';
import type { DataContext } from '../../context.js';
import { buildSchedulerDecisionWorkflowLinks } from './cross-links.js';
import { encodeSchedulerCursor } from './cursor.js';
import { parseRunFilters } from './filter-parsers.js';
import { buildRunCrossLinkSummary, toCandidateDecisionReadModel, toRunReadModel } from './read-models.js';
import type {
  ListSchedulerRunsInput,
  ListSchedulerRunsResult,
  SchedulerRunReadModel} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const buildRunWithCandidates = async (
  context: DataContext,
  packId: string,
  runRecord: SchedulerRunRecord
): Promise<SchedulerRunReadModel> => {
  const adapter = context.schedulerStorage;
  const decisionRecords = adapter?.listDecisionsForRun(packId, runRecord.id) ?? [];

  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(
    context,
    decisionRecords.map(d => ({ id: d.id, created_job_id: d.created_job_id }))
  );

  const candidates = decisionRecords.map(record =>
    toCandidateDecisionReadModel(record, workflowLinks.get(record.id) ?? null)
  );

  return {
    run: toRunReadModel(runRecord, buildRunCrossLinkSummary(candidates)),
    candidates
  };
};

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

export const getLatestSchedulerRunReadModel = async (
  context: DataContext,
  packId: string
): Promise<SchedulerRunReadModel | null> => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return null;
  }

  const runs = adapter.listRuns(packId, { orderBy: 'created_at_desc', take: 1 });
  if (runs.length === 0) {
    return null;
  }

  return buildRunWithCandidates(context, packId, runs[0]!);
};

export const getSchedulerRunReadModelById = async (
  context: DataContext,
  packId: string,
  runId: string
): Promise<SchedulerRunReadModel | null> => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return null;
  }

  const run = adapter.getRunById(packId, runId);
  if (!run) {
    return null;
  }

  return buildRunWithCandidates(context, packId, run);
};

export const listSchedulerRuns = (
  context: DataContext,
  packId: string,
  input: ListSchedulerRunsInput
): ListSchedulerRunsResult => {
  const filters = parseRunFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return emptyRunListResult(filters);
  }

// @ts-expect-error -- EOPT strict mode
  const queryInput: ListRunsInput = {
    tickFrom: filters.from_tick ?? undefined,
    tickTo: filters.to_tick ?? undefined,
    workerId: filters.worker_id ?? undefined,
    partitionId: filters.partition_id ?? undefined,
    cursorCreatedAt: filters.cursor ? BigInt(filters.cursor.created_at) : undefined,
    cursorId: filters.cursor?.id,
    orderBy: 'created_at_desc',
    take: filters.limit + 1
  };

  const records = adapter.listRuns(packId, queryInput);

  const hasNextPage = records.length > filters.limit;
  const pageRecords = records.slice(0, filters.limit);
  const pageItems = pageRecords.map(r => toRunReadModel(r));
  const nextCursor = hasNextPage && pageItems.length > 0
    ? encodeSchedulerCursor({
        created_at: pageItems[pageItems.length - 1]!.created_at,
        id: pageItems[pageItems.length - 1]!.id
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
