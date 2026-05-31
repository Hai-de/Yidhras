import { captureError } from '../../../utils/capture_error.js';
import type { DataContext } from '../../context.js';
import type { SchedulerRebalanceRecommendationRecord } from '../../runtime/scheduler_rebalance.js';
import { listRecentSchedulerRebalanceRecommendations } from '../../runtime/scheduler_rebalance.js';
import { parseRebalanceRecommendationFilters } from './filter-parsers.js';
import { toRebalanceRecommendationReadModel } from './read-models.js';
import type {
  ListSchedulerRebalanceRecommendationsInput,
  SchedulerRebalanceRecommendationsResult} from './types.js';

export const listSchedulerRebalanceRecommendations = (
  context: DataContext,
  packId: string,
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

  let allRecommendations: SchedulerRebalanceRecommendationRecord[] = [];
  try {
    allRecommendations = listRecentSchedulerRebalanceRecommendations(context, filters.limit, packId);
  } catch (err: unknown) {
    captureError(err, { module: 'scheduler-rebalance-queries', message: 'Failed to list rebalance recommendations — returning empty list' });
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
