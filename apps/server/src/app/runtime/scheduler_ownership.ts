import type { AppContext } from '../context.js';
import {
  countSchedulerOwnershipMigrationsInProgress,
  createSchedulerOwnershipMigrationRecord,
  createSchedulerPartitionAssignmentRecord,
  findLatestActiveSchedulerOwnershipMigrationForPartition,
  getSchedulerOwnershipMigrationRecordById,
  getSchedulerPartitionAssignmentRecord,
  getSchedulerWorkerRuntimeStateRecord,
  listSchedulerOwnershipMigrationRecords,
  listSchedulerPartitionAssignmentRecords,
  listSchedulerWorkerRuntimeStateRecords,
  updateSchedulerOwnershipMigrationRecord,
  updateSchedulerPartitionAssignmentRecord,
  updateSchedulerWorkerRuntimeStatus,
  upsertSchedulerWorkerRuntimeStateRecord
} from './scheduler_ownership_repository.js';
import {
  getSchedulerPartitionCount,
  listSchedulerPartitionIds,
  resolveOwnedSchedulerPartitionIds
} from './scheduler_partitioning.js';

export interface SchedulerOwnershipSnapshot {
  worker_id: string;
  partition_count: number;
  owned_partition_ids: string[];
  assignment_source: 'persisted' | 'bootstrap' | 'fallback';
  migration_in_progress_count: number;
  worker_runtime_status: string;
  last_heartbeat_at: bigint | null;
  automatic_rebalance_enabled: boolean;
}

export interface SchedulerPartitionAssignmentRecord {
  partition_id: string;
  worker_id: string | null;
  status: string;
  version: number;
  source: string;
  updated_at: bigint;
}

export interface SchedulerOwnershipMigrationRecord {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string;
  status: string;
  reason: string | null;
  details: unknown;
  created_at: bigint;
  updated_at: bigint;
  completed_at: bigint | null;
}

export interface SchedulerWorkerRuntimeStateRecord {
  worker_id: string;
  status: string;
  last_heartbeat_at: bigint;
  owned_partition_count: number;
  active_migration_count: number;
  capacity_hint: number | null;
  updated_at: bigint;
}

const ASSIGNED_STATUSES = new Set(['assigned', 'migrating']);

const DEFAULT_SCHEDULER_WORKER_STALE_TICKS = 5n;
const DEFAULT_SCHEDULER_WORKER_DEAD_TICKS = 15n;

export const getSchedulerPartitionAssignment = async (
  context: AppContext,
  partitionId: string
): Promise<SchedulerPartitionAssignmentRecord | null> => {
  return getSchedulerPartitionAssignmentRecord(context, partitionId);
};

export const isWorkerAllowedToOperateSchedulerPartition = async (
  context: AppContext,
  input: {
    partitionId: string;
    workerId: string;
  }
): Promise<boolean> => {
  const assignment = await getSchedulerPartitionAssignment(context, input.partitionId);
  if (!assignment) {
    return true;
  }

  return assignment.worker_id === input.workerId && ASSIGNED_STATUSES.has(assignment.status);
};

export const listSchedulerPartitionAssignments = async (
  context: AppContext
): Promise<SchedulerPartitionAssignmentRecord[]> => {
  return listSchedulerPartitionAssignmentRecords(context);
};

export const listRecentSchedulerOwnershipMigrations = async (
  context: AppContext,
  limit = 20
): Promise<SchedulerOwnershipMigrationRecord[]> => {
  return listSchedulerOwnershipMigrationRecords(context, limit);
};

export { countSchedulerOwnershipMigrationsInProgress };

export const listSchedulerWorkerRuntimeStates = async (
  context: AppContext
): Promise<SchedulerWorkerRuntimeStateRecord[]> => {
  return listSchedulerWorkerRuntimeStateRecords(context);
};

export const refreshSchedulerWorkerRuntimeState = async (
  context: AppContext,
  input: {
    workerId: string;
    ownedPartitionIds: string[];
    capacityHint?: number | null;
    now?: bigint;
  }
): Promise<SchedulerWorkerRuntimeStateRecord> => {
  const now = input.now ?? context.clock.getCurrentTick();
  const activeMigrationCount = await countSchedulerOwnershipMigrationsInProgress(context, input.workerId);

  return upsertSchedulerWorkerRuntimeStateRecord(context, {
    worker_id: input.workerId,
    status: 'active',
    last_heartbeat_at: now,
    owned_partition_count: input.ownedPartitionIds.length,
    active_migration_count: activeMigrationCount,
    capacity_hint: input.capacityHint ?? null,
    updated_at: now
  });
};

export const refreshSchedulerWorkerRuntimeLiveness = async (
  context: AppContext,
  now?: bigint
): Promise<void> => {
  const currentTick = now ?? context.clock.getCurrentTick();
  const staleThreshold = BigInt(process.env.SCHEDULER_WORKER_STALE_TICKS ?? DEFAULT_SCHEDULER_WORKER_STALE_TICKS.toString());
  const deadThreshold = BigInt(process.env.SCHEDULER_WORKER_DEAD_TICKS ?? DEFAULT_SCHEDULER_WORKER_DEAD_TICKS.toString());
  const workerStates = await listSchedulerWorkerRuntimeStates(context);

  for (const state of workerStates) {
    const age = currentTick - state.last_heartbeat_at;
    const nextStatus = age >= deadThreshold ? 'suspected_dead' : age >= staleThreshold ? 'stale' : 'active';
    if (nextStatus === state.status) {
      continue;
    }

    await updateSchedulerWorkerRuntimeStatus(context, {
      worker_id: state.worker_id,
      status: nextStatus,
      updated_at: currentTick
    });
  }
};

export const reconcileSchedulerBootstrapAssignments = async (
  context: AppContext,
  workerId: string,
  partitionIds?: string[]
): Promise<void> => {
  const now = context.clock.getCurrentTick();
  const partitionCount = getSchedulerPartitionCount();
  const bootstrapPartitionIds = resolveOwnedSchedulerPartitionIds({
    explicitPartitionIds: partitionIds,
    workerId,
    partitionCount
  });
  const allPartitionIds = listSchedulerPartitionIds(partitionCount);
  const bootstrapPartitionIdSet = new Set(bootstrapPartitionIds);

  const existingAssignments = await listSchedulerPartitionAssignmentRecords(context);
  const existingByPartition = new Map(existingAssignments.map(item => [item.partition_id, item]));

  for (const partitionId of allPartitionIds) {
    const existing = existingByPartition.get(partitionId) ?? null;
    const shouldOwn = bootstrapPartitionIdSet.has(partitionId);
    const nextWorkerId = shouldOwn ? workerId : null;
    const nextStatus = shouldOwn ? 'assigned' : 'released';

    if (!existing) {
      await createSchedulerPartitionAssignmentRecord(context, {
        partition_id: partitionId,
        worker_id: nextWorkerId,
        status: nextStatus,
        version: 1,
        source: 'bootstrap',
        updated_at: now
      });
      continue;
    }

    if (existing.source !== 'bootstrap') {
      continue;
    }

    if (existing.worker_id === nextWorkerId && existing.status === nextStatus) {
      continue;
    }

    await updateSchedulerPartitionAssignmentRecord(context, {
      partition_id: partitionId,
      worker_id: nextWorkerId,
      status: nextStatus,
      version: existing.version + 1,
      updated_at: now
    });
  }
};

export const resolveSchedulerOwnershipSnapshot = async (
  context: AppContext,
  input: {
    workerId: string;
    bootstrapPartitionIds?: string[];
  }
): Promise<SchedulerOwnershipSnapshot> => {
  const partitionCount = getSchedulerPartitionCount();
  const assignments = await listSchedulerPartitionAssignments(context);
  const activeAssignments = assignments.filter(
    assignment => assignment.worker_id === input.workerId && ASSIGNED_STATUSES.has(assignment.status)
  );

  const hasManagedAssignments = assignments.length > 0;

  const persistedOwnedPartitionIds = activeAssignments.map(assignment => assignment.partition_id);
  const ownedPartitionIds =
    persistedOwnedPartitionIds.length > 0
      ? persistedOwnedPartitionIds
      : resolveOwnedSchedulerPartitionIds({
          explicitPartitionIds: input.bootstrapPartitionIds,
          workerId: input.workerId,
          partitionCount
        });

  const migrationInProgressCount = await countSchedulerOwnershipMigrationsInProgress(context, input.workerId);
  const workerState = await getSchedulerWorkerRuntimeStateRecord(context, input.workerId);

  return {
    worker_id: input.workerId,
    partition_count: partitionCount,
    owned_partition_ids: ownedPartitionIds,
    assignment_source: persistedOwnedPartitionIds.length > 0 ? 'persisted' : hasManagedAssignments ? 'persisted' : 'bootstrap',
    migration_in_progress_count: migrationInProgressCount,
    worker_runtime_status: workerState?.status ?? 'unknown',
    last_heartbeat_at: workerState?.last_heartbeat_at ?? null,
    automatic_rebalance_enabled: true
  };
};

export const createSchedulerOwnershipMigration = async (
  context: AppContext,
  input: {
    partitionId: string;
    toWorkerId: string;
    reason?: string | null;
    requestedByWorkerId?: string | null;
  }
): Promise<SchedulerOwnershipMigrationRecord> => {
  const now = context.clock.getCurrentTick();
  const existingAssignment = await getSchedulerPartitionAssignmentRecord(context, input.partitionId);

  const migration = await createSchedulerOwnershipMigrationRecord(context, {
    partition_id: input.partitionId,
    from_worker_id: existingAssignment?.worker_id ?? null,
    to_worker_id: input.toWorkerId,
    status: 'requested',
    reason: input.reason ?? null,
    details: {
      requested_by_worker_id: input.requestedByWorkerId ?? null
    },
    created_at: now,
    updated_at: now,
    completed_at: null
  });

  if (!existingAssignment) {
    await createSchedulerPartitionAssignmentRecord(context, {
      partition_id: input.partitionId,
      worker_id: input.toWorkerId,
      status: 'migrating',
      version: 1,
      source: 'rebalance',
      updated_at: now
    });
  } else {
    await updateSchedulerPartitionAssignmentRecord(context, {
      partition_id: input.partitionId,
      worker_id: input.toWorkerId,
      status: 'migrating',
      version: existingAssignment.version + 1,
      source: 'rebalance',
      updated_at: now
    });
  }

  return migration;
};

export const markSchedulerOwnershipMigrationInProgress = async (
  context: AppContext,
  migrationId: string
): Promise<void> => {
  const now = context.clock.getCurrentTick();
  await updateSchedulerOwnershipMigrationRecord(context, {
    id: migrationId,
    status: 'in_progress',
    updated_at: now
  });
};

export const completeActiveSchedulerOwnershipMigration = async (
  context: AppContext,
  input: {
    partitionId: string;
    toWorkerId: string;
  }
): Promise<void> => {
  const now = context.clock.getCurrentTick();
  const migration = await findLatestActiveSchedulerOwnershipMigrationForPartition(context, {
    partition_id: input.partitionId,
    to_worker_id: input.toWorkerId
  });

  if (!migration) {
    return;
  }

  await completeSchedulerOwnershipMigration(context, migration.id);
  await updateSchedulerOwnershipMigrationRecord(context, {
    id: migration.id,
    updated_at: now
  });
};

export const completeSchedulerOwnershipMigration = async (
  context: AppContext,
  migrationId: string
): Promise<void> => {
  const now = context.clock.getCurrentTick();
  const migration = await getSchedulerOwnershipMigrationRecordById(context, migrationId);
  if (!migration) {
    return;
  }

  await updateSchedulerOwnershipMigrationRecord(context, {
    id: migrationId,
    status: 'completed',
    updated_at: now,
    completed_at: now
  });

  await updateSchedulerPartitionAssignmentRecord(context, {
    partition_id: migration.partition_id,
    worker_id: migration.to_worker_id,
    status: 'assigned',
    source: 'rebalance',
    updated_at: now
  });
};
