import type { AppContext } from '../context.js';
import {
  getSchedulerOperatorProjection,
  getSchedulerSummarySnapshot,
  listSchedulerOwnershipAssignments,
  listSchedulerWorkers
} from './scheduler_observability.js';

const buildPackScopedPartitionId = (packId: string, partitionId: string): string => {
  return `${packId}::${partitionId}`;
};

const mapScopedPartitions = <T extends { partition_id: string }>(packId: string, items: T[]): T[] => {
  return items.map(item => ({
    ...item,
    partition_id: buildPackScopedPartitionId(packId, item.partition_id)
  }));
};

export const getExperimentalPackSchedulerOwnershipProjection = async (
  context: AppContext,
  packId: string
) => {
  const result = await listSchedulerOwnershipAssignments(context);
  return {
    items: mapScopedPartitions(packId, result.items),
    summary: result.summary
  };
};

export const getExperimentalPackSchedulerWorkersProjection = async (
  context: AppContext,
  _packId: string
) => {
  return listSchedulerWorkers(context);
};

export const getExperimentalPackSchedulerSummaryProjection = async (
  context: AppContext,
  _packId: string,
  input?: { sampleRuns?: number }
) => {
  return getSchedulerSummarySnapshot(context, input);
};

export const getExperimentalPackSchedulerOperatorProjection = async (
  context: AppContext,
  packId: string,
  input?: { sampleRuns?: number; recentLimit?: number }
) => {
  const projection = await getSchedulerOperatorProjection(context, input);
  return {
    ...projection,
    ownership: {
      ...projection.ownership,
      assignments: mapScopedPartitions(packId, projection.ownership.assignments)
    },
    recent_runs: mapScopedPartitions(packId, projection.recent_runs),
    recent_decisions: mapScopedPartitions(packId, projection.recent_decisions),
    highlights: {
      ...projection.highlights,
      latest_partition_id: projection.highlights.latest_partition_id === null
        ? null
        : buildPackScopedPartitionId(packId, projection.highlights.latest_partition_id),
      latest_migration_partition_id: projection.highlights.latest_migration_partition_id === null
        ? null
        : buildPackScopedPartitionId(packId, projection.highlights.latest_migration_partition_id),
      latest_rebalance_partition_id: projection.highlights.latest_rebalance_partition_id === null
        ? null
        : buildPackScopedPartitionId(packId, projection.highlights.latest_rebalance_partition_id)
    }
  };
};
