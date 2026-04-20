import type { AppContext } from '../context.js';
import { createRuntimeKernelService } from '../runtime/runtime_kernel_service.js';
import type {
  SchedulerOperatorProjection,
  SchedulerOwnershipAssignmentsResult,
  SchedulerSummarySnapshot,
  SchedulerWorkersResult
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
  const runtimeKernel = createRuntimeKernelService(context);
  const result = await runtimeKernel.getOwnershipAssignments?.({}) as SchedulerOwnershipAssignmentsResult | undefined;
  return {
    items: mapScopedPartitions(packId, result?.items ?? []),
    summary: result?.summary ?? null
  };
};

export const getExperimentalPackSchedulerWorkersProjection = async (
  context: AppContext,
  _packId: string
) => {
  const runtimeKernel = createRuntimeKernelService(context);
  return (await runtimeKernel.getWorkers?.({}) as SchedulerWorkersResult | undefined) ?? { items: [], summary: null };
};

export const getExperimentalPackSchedulerSummaryProjection = async (
  context: AppContext,
  _packId: string,
  input?: { sampleRuns?: number }
) => {
  const runtimeKernel = createRuntimeKernelService(context);
  return (await runtimeKernel.getSummary?.(input) as SchedulerSummarySnapshot | undefined) ?? null;
};

export const getExperimentalPackSchedulerOperatorProjection = async (
  context: AppContext,
  packId: string,
  input?: { sampleRuns?: number; recentLimit?: number }
) => {
  const runtimeKernel = createRuntimeKernelService(context);
  const projection = await runtimeKernel.getOperatorProjection?.(input) as SchedulerOperatorProjection | undefined;
  return {
    ...projection,
    ownership: {
      ...projection?.ownership,
      assignments: mapScopedPartitions(packId, projection?.ownership?.assignments ?? [])
    },
    recent_runs: mapScopedPartitions(packId, projection?.recent_runs ?? []),
    recent_decisions: mapScopedPartitions(packId, projection?.recent_decisions ?? []),
    highlights: {
      ...projection?.highlights,
      latest_partition_id: projection?.highlights?.latest_partition_id === null || projection?.highlights?.latest_partition_id === undefined
        ? null
        : buildPackScopedPartitionId(packId, projection.highlights.latest_partition_id),
      latest_migration_partition_id: projection?.highlights?.latest_migration_partition_id === null || projection?.highlights?.latest_migration_partition_id === undefined
        ? null
        : buildPackScopedPartitionId(packId, projection.highlights.latest_migration_partition_id),
      latest_rebalance_partition_id: projection?.highlights?.latest_rebalance_partition_id === null || projection?.highlights?.latest_rebalance_partition_id === undefined
        ? null
        : buildPackScopedPartitionId(packId, projection.highlights.latest_rebalance_partition_id)
    }
  };
};
