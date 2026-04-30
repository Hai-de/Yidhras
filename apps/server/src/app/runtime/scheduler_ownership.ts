import type { AppContext } from '../context.js';
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

const requireAdapter = (context: AppContext) => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    throw new Error('[scheduler_ownership] SchedulerStorageAdapter is required. Ensure it is injected into AppContext.');
  }
  return adapter;
};

export const getSchedulerPartitionAssignment = (
  context: AppContext,
  partitionId: string,
  packId?: string
): SchedulerPartitionAssignmentRecord | null => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);
  return adapter.getPartition(packId, partitionId);
};

export const isWorkerAllowedToOperateSchedulerPartition = (
  context: AppContext,
  input: {
    partitionId: string;
    workerId: string;
  },
  packId?: string
): boolean => {
  const assignment = getSchedulerPartitionAssignment(context, input.partitionId, packId);
  if (!assignment) {
    return true;
  }

  return assignment.worker_id === input.workerId && ASSIGNED_STATUSES.has(assignment.status);
};

export const listSchedulerPartitionAssignments = (
  context: AppContext,
  packId?: string
): SchedulerPartitionAssignmentRecord[] => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);
  return adapter.listPartitions(packId);
};

export const listRecentSchedulerOwnershipMigrations = (
  context: AppContext,
  limit = 20,
  packId?: string
): SchedulerOwnershipMigrationRecord[] => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);
  return adapter.listMigrations(packId, limit);
};

export const listSchedulerWorkerRuntimeStates = (
  context: AppContext,
  packId?: string
): SchedulerWorkerRuntimeStateRecord[] => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);
  return adapter.listWorkerStates(packId);
};

export const refreshSchedulerWorkerRuntimeState = (
  context: AppContext,
  input: {
    workerId: string;
    ownedPartitionIds: string[];
    capacityHint?: number | null;
    now?: bigint;
  },
  packId?: string
): SchedulerWorkerRuntimeStateRecord => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const now = input.now ?? context.clock.getCurrentTick();
  const activeMigrationCount = adapter.countMigrationsInProgress(packId, input.workerId);

  const existing = adapter.getWorkerState(packId, input.workerId);
  const status = existing?.status === 'stale' || existing?.status === 'suspected_dead'
    ? existing.status
    : 'active';

  return adapter.upsertWorkerState(packId, {
    worker_id: input.workerId,
    status,
    last_heartbeat_at: now,
    owned_partition_count: input.ownedPartitionIds.length,
    active_migration_count: activeMigrationCount,
    capacity_hint: input.capacityHint ?? null,
    updated_at: now
  });
};

export const refreshSchedulerWorkerRuntimeLiveness = (
  context: AppContext,
  now?: bigint,
  packId?: string
): void => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const currentTick = now ?? context.clock.getCurrentTick();
  const staleThreshold = BigInt(process.env.SCHEDULER_WORKER_STALE_TICKS ?? DEFAULT_SCHEDULER_WORKER_STALE_TICKS.toString());
  const deadThreshold = BigInt(process.env.SCHEDULER_WORKER_DEAD_TICKS ?? DEFAULT_SCHEDULER_WORKER_DEAD_TICKS.toString());
  const workerStates = listSchedulerWorkerRuntimeStates(context, packId);

  for (const state of workerStates) {
    const age = currentTick - state.last_heartbeat_at;
    const nextStatus = age >= deadThreshold ? 'suspected_dead' : age >= staleThreshold ? 'stale' : 'active';
    if (nextStatus === state.status) {
      continue;
    }

    adapter.updateWorkerStatus(packId, state.worker_id, nextStatus, currentTick);
  }
};

export const reconcileSchedulerBootstrapAssignments = (
  context: AppContext,
  workerId: string,
  partitionIds?: string[],
  packId?: string
): void => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const now = context.clock.getCurrentTick();
  const partitionCount = getSchedulerPartitionCount();
  const bootstrapPartitionIds = resolveOwnedSchedulerPartitionIds({
    explicitPartitionIds: partitionIds,
    workerId,
    partitionCount
  });
  const allPartitionIds = listSchedulerPartitionIds(partitionCount);
  const bootstrapPartitionIdSet = new Set(bootstrapPartitionIds);

  const existingAssignments = adapter.listPartitions(packId);
  const existingByPartition = new Map(existingAssignments.map(item => [item.partition_id, item]));

  for (const partitionId of allPartitionIds) {
    const existing = existingByPartition.get(partitionId) ?? null;
    const shouldOwn = bootstrapPartitionIdSet.has(partitionId);
    const nextWorkerId = shouldOwn ? workerId : null;
    const nextStatus = shouldOwn ? 'assigned' : 'released';

    if (!existing) {
      adapter.createPartition(packId, {
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

    adapter.updatePartition(packId, {
      partition_id: partitionId,
      worker_id: nextWorkerId,
      status: nextStatus,
      version: existing.version + 1,
      updated_at: now
    });
  }
};

export const resolveSchedulerOwnershipSnapshot = (
  context: AppContext,
  input: {
    workerId: string;
    bootstrapPartitionIds?: string[];
  },
  packId?: string
): SchedulerOwnershipSnapshot => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const partitionCount = getSchedulerPartitionCount();
  const assignments = listSchedulerPartitionAssignments(context, packId);
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

  const migrationInProgressCount = adapter.countMigrationsInProgress(packId, input.workerId);
  const workerState = adapter.getWorkerState(packId, input.workerId);

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

export const createSchedulerOwnershipMigration = (
  context: AppContext,
  input: {
    partitionId: string;
    toWorkerId: string;
    reason?: string | null;
    requestedByWorkerId?: string | null;
  },
  packId?: string
): SchedulerOwnershipMigrationRecord => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const now = context.clock.getCurrentTick();
  const existingAssignment = adapter.getPartition(packId, input.partitionId);

  const migration = adapter.createMigration(packId, {
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
    adapter.createPartition(packId, {
      partition_id: input.partitionId,
      worker_id: input.toWorkerId,
      status: 'migrating',
      version: 1,
      source: 'rebalance',
      updated_at: now
    });
  } else {
    adapter.updatePartition(packId, {
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

export const markSchedulerOwnershipMigrationInProgress = (
  context: AppContext,
  migrationId: string,
  packId?: string
): void => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const now = context.clock.getCurrentTick();
  adapter.updateMigration(packId, {
    id: migrationId,
    status: 'in_progress',
    updated_at: now
  });
};

export const completeActiveSchedulerOwnershipMigration = (
  context: AppContext,
  input: {
    partitionId: string;
    toWorkerId: string;
  },
  packId?: string
): void => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const now = context.clock.getCurrentTick();
  const migration = adapter.findLatestActiveMigrationForPartition(
    packId,
    input.partitionId,
    input.toWorkerId
  );

  if (!migration) {
    return;
  }

  completeSchedulerOwnershipMigration(context, migration.id, packId);
  adapter.updateMigration(packId, {
    id: migration.id,
    updated_at: now
  });
};

export const completeSchedulerOwnershipMigration = (
  context: AppContext,
  migrationId: string,
  packId?: string
): void => {
  if (!packId) {
    throw new Error('[scheduler_ownership] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const now = context.clock.getCurrentTick();
  const migration = adapter.getMigrationById(packId, migrationId);
  if (!migration) {
    return;
  }

  adapter.updateMigration(packId, {
    id: migrationId,
    status: 'completed',
    updated_at: now,
    completed_at: now
  });

  adapter.updatePartition(packId, {
    partition_id: migration.partition_id,
    worker_id: migration.to_worker_id,
    status: 'assigned',
    source: 'rebalance',
    updated_at: now
  });
};
