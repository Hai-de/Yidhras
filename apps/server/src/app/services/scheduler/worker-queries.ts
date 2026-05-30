import { captureError } from '../../../utils/capture_error.js';
import type { AppContext } from '../../context.js';
import { listSchedulerWorkerRuntimeStates } from '../../runtime/scheduler_ownership.js';
import { parseWorkerFilters } from './filter-parsers.js';
import { toWorkerRuntimeReadModel } from './read-models.js';
import type {
  ListSchedulerWorkersInput,
  SchedulerWorkersResult} from './types.js';

export const listSchedulerWorkers = (
  context: AppContext,
  packId: string,
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

  let allWorkers: ReturnType<typeof listSchedulerWorkerRuntimeStates> = [];
  try {
    allWorkers = listSchedulerWorkerRuntimeStates(context, packId);
  } catch (err: unknown) {
    captureError(err, { module: 'scheduler-worker-queries', message: 'Failed to list scheduler workers — returning empty list' });
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
