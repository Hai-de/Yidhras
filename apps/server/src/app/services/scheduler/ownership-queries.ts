import type { SchedulerOwnershipMigrationRecord } from '../../../packs/storage/SchedulerStorageAdapter.js';
import type { AppContext } from '../../context.js';
import { parseOwnershipAssignmentFilters, parseOwnershipMigrationFilters } from './filter-parsers.js';
import { buildSchedulerOwnershipSummary,parseSummaryJson, toOwnershipMigrationReadModel  } from './read-models.js';
import type {
  ListSchedulerOwnershipAssignmentsInput,
  ListSchedulerOwnershipMigrationsInput,
  SchedulerOwnershipAssignmentsResult,
  SchedulerOwnershipMigrationsResult} from './types.js';

// ---------------------------------------------------------------------------
// Ownership assignments
// ---------------------------------------------------------------------------

export const listSchedulerOwnershipAssignments = (
  context: AppContext,
  packId: string,
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

  const partitions = adapter.listPartitions(packId);
  const migrations = adapter.listMigrations(packId);

  const allPartitions = partitions.filter(p => {
    if (filters.worker_id !== null && p.worker_id !== filters.worker_id) return false;
    if (filters.partition_id !== null && p.partition_id !== filters.partition_id) return false;
    if (filters.status !== null && p.status !== filters.status) return false;
    return true;
  });

  allPartitions.sort((a, b) => a.partition_id < b.partition_id ? -1 : 1);

  migrations.sort((a, b) => {
    const av = a.created_at;
    const bv = b.created_at;
    if (av > bv) return -1;
    if (av < bv) return 1;
    return 0;
  });

  const latestMigrationByPartition = new Map<string, SchedulerOwnershipMigrationRecord>();
  for (const m of migrations) {
    if (!latestMigrationByPartition.has(m.partition_id)) {
      latestMigrationByPartition.set(m.partition_id, m);
    }
  }

  const items = allPartitions.map(assignment => {
    const migration = latestMigrationByPartition.get(assignment.partition_id);
    return {
      partition_id: assignment.partition_id,
      worker_id: assignment.worker_id,
      status: assignment.status,
      version: assignment.version,
      source: assignment.source,
      updated_at: assignment.updated_at.toString(),
      latest_migration: migration
        ? toOwnershipMigrationReadModel({
            id: migration.id,
            partition_id: migration.partition_id,
            from_worker_id: migration.from_worker_id,
            to_worker_id: migration.to_worker_id,
            status: migration.status,
            reason: migration.reason,
            details: migration.details,
            created_at: migration.created_at,
            updated_at: migration.updated_at,
            completed_at: migration.completed_at
          })
        : null
    };
  });

  const summary = buildSchedulerOwnershipSummary(items);

  return {
    items,
    summary: {
      ...summary,
      filters
    }
  };
};

// ---------------------------------------------------------------------------
// Ownership migrations
// ---------------------------------------------------------------------------

export const listSchedulerOwnershipMigrations = (
  context: AppContext,
  packId: string,
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

  const migrations = adapter.listMigrations(packId, filters.limit);

  const filteredMigrations = migrations.filter(m => {
    if (filters.partition_id !== null && m.partition_id !== filters.partition_id) return false;
    if (filters.status !== null && m.status !== filters.status) return false;
    if (filters.worker_id !== null && m.from_worker_id !== filters.worker_id && m.to_worker_id !== filters.worker_id) return false;
    return true;
  });

  const items = filteredMigrations.map(migration =>
    toOwnershipMigrationReadModel({
      id: migration.id,
      partition_id: migration.partition_id,
      from_worker_id: migration.from_worker_id,
      to_worker_id: migration.to_worker_id,
      status: migration.status,
      reason: migration.reason,
      details: migration.details ? parseSummaryJson(migration.details as unknown as string) : null,
      created_at: migration.created_at,
      updated_at: migration.updated_at,
      completed_at: migration.completed_at
    })
  );

  return {
    items,
    summary: {
      returned: items.length,
      limit: filters.limit,
      in_progress_count: filteredMigrations.filter(
        item => item.status === 'requested' || item.status === 'in_progress'
      ).length,
      filters
    }
  };
};
