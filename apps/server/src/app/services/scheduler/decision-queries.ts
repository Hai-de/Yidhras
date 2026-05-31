import type { ListDecisionsInput } from '../../../packs/storage/SchedulerStorageAdapter.js';
import type { DataContext } from '../../context.js';
import { buildSchedulerDecisionWorkflowLinks } from './cross-links.js';
import { encodeSchedulerCursor } from './cursor.js';
import { parseDecisionFilters } from './filter-parsers.js';
import { toCandidateDecisionReadModel } from './read-models.js';
import type {
  ListSchedulerDecisionsInput,
  ListSchedulerDecisionsResult} from './types.js';

const emptyDecisionListResult = (
  filters: ReturnType<typeof parseDecisionFilters>
): ListSchedulerDecisionsResult => ({
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
  context: DataContext,
  packId: string,
  input: ListSchedulerDecisionsInput
): Promise<ListSchedulerDecisionsResult> => {
  const filters = parseDecisionFilters(input);
  const adapter = context.schedulerStorage;
  if (!adapter) {
    return emptyDecisionListResult(filters);
  }

// @ts-expect-error -- EOPT strict mode
  const queryInput: ListDecisionsInput = {
    actorId: filters.actor_id ?? undefined,
    kind: filters.kind ?? undefined,
    chosenReason: filters.reason ?? undefined,
    skippedReason: filters.skipped_reason ?? undefined,
    partitionId: filters.partition_id ?? undefined,
    tickFrom: filters.from_tick ?? undefined,
    tickTo: filters.to_tick ?? undefined,
    cursorCreatedAt: filters.cursor ? BigInt(filters.cursor.created_at) : undefined,
    cursorId: filters.cursor?.id,
    orderBy: 'created_at_desc',
    take: filters.limit + 1
  };

  const records = adapter.listCandidateDecisions(packId, queryInput);

  const hasNextPage = records.length > filters.limit;
  const pageRecords = records.slice(0, filters.limit);

  const workflowLinks = await buildSchedulerDecisionWorkflowLinks(
    context,
    pageRecords.map(d => ({ id: d.id, created_job_id: d.created_job_id }))
  );

  const pageItems = pageRecords.map(record =>
    toCandidateDecisionReadModel(record, workflowLinks.get(record.id) ?? null)
  );

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
