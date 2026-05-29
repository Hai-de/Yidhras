import { describe, expect, it, vi } from 'vitest';

import {
  getSchedulerPartitionAssignment,
  isWorkerAllowedToOperateSchedulerPartition,
  listRecentSchedulerOwnershipMigrations,
  listSchedulerPartitionAssignments,
  listSchedulerWorkerRuntimeStates,
  refreshSchedulerWorkerRuntimeLiveness,
  refreshSchedulerWorkerRuntimeState} from '../../../src/app/runtime/scheduler_ownership.js';
import { createMockAppContext } from '../../helpers/mock_context.js';


const createMockAdapter = () => ({
  open: vi.fn(),
  close: vi.fn(),
  destroyPackSchedulerStorage: vi.fn(),
  listOpenPackIds: vi.fn().mockReturnValue([]),
  getPartition: vi.fn().mockReturnValue(null),
  listPartitions: vi.fn().mockReturnValue([]),
  upsertPartition: vi.fn(),
  updatePartitionStatus: vi.fn(),
  deletePartition: vi.fn(),
  getLease: vi.fn().mockReturnValue(null),
  upsertLease: vi.fn(),
  updateLeaseIfClaimable: vi.fn(),
  deleteLeaseByHolder: vi.fn(),
  upsertCursor: vi.fn(),
  getCursor: vi.fn().mockReturnValue(null),
  listMigrations: vi.fn().mockReturnValue([]),
  createMigration: vi.fn(),
  markMigrationInProgress: vi.fn(),
  completeMigration: vi.fn(),
  countMigrationsInProgress: vi.fn().mockReturnValue(0),
  getWorkerState: vi.fn().mockReturnValue(null),
  listWorkerStates: vi.fn().mockReturnValue([]),
  upsertWorkerState: vi.fn(),
  updateWorkerStatus: vi.fn(),
  listRebalanceRecommendations: vi.fn().mockReturnValue([]),
  createRebalanceRecommendation: vi.fn(),
  updateRebalanceRecommendationStatus: vi.fn()
});

const createContextWithAdapter = (adapter?: ReturnType<typeof createMockAdapter>) => {
  const ctx = createMockAppContext();
   
  (ctx as unknown as Record<string, unknown>).schedulerStorage = adapter ?? createMockAdapter();
  return ctx;
};

/* ──────────────────── getSchedulerPartitionAssignment ──────────────────── */

describe('getSchedulerPartitionAssignment', () => {
  it('throws when packId is missing', () => {
    const ctx = createContextWithAdapter();
    expect(() =>
      getSchedulerPartitionAssignment(ctx as never, 'p1', undefined)
    ).toThrow(/packId is required/);
  });

  it('returns null when partition not found', () => {
    const ctx = createContextWithAdapter();
    const result = getSchedulerPartitionAssignment(ctx as never, 'p1', 'pack1');
    expect(result).toBeNull();
  });

  it('returns partition when found', () => {
    const adapter = createMockAdapter();
    const mockAssignment = {
      partition_id: 'p1',
      worker_id: 'w1',
      status: 'assigned',
      version: 1,
      source: 'bootstrap',
      updated_at: 100n
    };
    adapter.getPartition.mockReturnValue(mockAssignment);
    const ctx = createContextWithAdapter(adapter);

    const result = getSchedulerPartitionAssignment(ctx as never, 'p1', 'pack1');
    expect(result).toEqual(mockAssignment);
    expect(adapter.open).toHaveBeenCalledWith('pack1');
    expect(adapter.getPartition).toHaveBeenCalledWith('pack1', 'p1');
  });
});

/* ──────────────────── isWorkerAllowedToOperateSchedulerPartition ──────────────────── */

describe('isWorkerAllowedToOperateSchedulerPartition', () => {
  it('returns true when no assignment exists', () => {
    const ctx = createContextWithAdapter();
    const result = isWorkerAllowedToOperateSchedulerPartition(
      ctx as never,
      { partitionId: 'p1', workerId: 'w1' },
      'pack1'
    );
    expect(result).toBe(true);
  });

  it('returns true when worker matches and status is assigned', () => {
    const adapter = createMockAdapter();
    adapter.getPartition.mockReturnValue({
      partition_id: 'p1',
      worker_id: 'w1',
      status: 'assigned',
      version: 1,
      source: 'bootstrap',
      updated_at: 100n
    });
    const ctx = createContextWithAdapter(adapter);

    const result = isWorkerAllowedToOperateSchedulerPartition(
      ctx as never,
      { partitionId: 'p1', workerId: 'w1' },
      'pack1'
    );
    expect(result).toBe(true);
  });

  it('returns false when worker does not match', () => {
    const adapter = createMockAdapter();
    adapter.getPartition.mockReturnValue({
      partition_id: 'p1',
      worker_id: 'w2',
      status: 'assigned',
      version: 1,
      source: 'bootstrap',
      updated_at: 100n
    });
    const ctx = createContextWithAdapter(adapter);

    const result = isWorkerAllowedToOperateSchedulerPartition(
      ctx as never,
      { partitionId: 'p1', workerId: 'w1' },
      'pack1'
    );
    expect(result).toBe(false);
  });

  it('returns false when status is not assigned', () => {
    const adapter = createMockAdapter();
    adapter.getPartition.mockReturnValue({
      partition_id: 'p1',
      worker_id: 'w1',
      status: 'released',
      version: 1,
      source: 'bootstrap',
      updated_at: 100n
    });
    const ctx = createContextWithAdapter(adapter);

    const result = isWorkerAllowedToOperateSchedulerPartition(
      ctx as never,
      { partitionId: 'p1', workerId: 'w1' },
      'pack1'
    );
    expect(result).toBe(false);
  });
});

/* ──────────────────── listSchedulerPartitionAssignments ──────────────────── */

describe('listSchedulerPartitionAssignments', () => {
  it('throws when packId is missing', () => {
    const ctx = createContextWithAdapter();
    expect(() =>
      listSchedulerPartitionAssignments(ctx as never, undefined)
    ).toThrow(/packId is required/);
  });

  it('returns list from adapter', () => {
    const adapter = createMockAdapter();
    const mockList = [
      { partition_id: 'p1', worker_id: 'w1', status: 'assigned', version: 1, source: 'bootstrap', updated_at: 100n }
    ];
    adapter.listPartitions.mockReturnValue(mockList);
    const ctx = createContextWithAdapter(adapter);

    const result = listSchedulerPartitionAssignments(ctx as never, 'pack1');
    expect(result).toEqual(mockList);
    expect(adapter.open).toHaveBeenCalledWith('pack1');
  });
});

/* ──────────────────── listRecentSchedulerOwnershipMigrations ──────────────────── */

describe('listRecentSchedulerOwnershipMigrations', () => {
  it('throws when packId is missing', () => {
    const ctx = createContextWithAdapter();
    expect(() =>
      listRecentSchedulerOwnershipMigrations(ctx as never, 20, undefined)
    ).toThrow(/packId is required/);
  });

  it('returns migrations with custom limit', () => {
    const adapter = createMockAdapter();
    adapter.listMigrations.mockReturnValue([]);
    const ctx = createContextWithAdapter(adapter);

    listRecentSchedulerOwnershipMigrations(ctx as never, 50, 'pack1');
    expect(adapter.listMigrations).toHaveBeenCalledWith('pack1', 50);
  });

  it('uses default limit of 20', () => {
    const adapter = createMockAdapter();
    adapter.listMigrations.mockReturnValue([]);
    const ctx = createContextWithAdapter(adapter);

    listRecentSchedulerOwnershipMigrations(ctx as never, undefined, 'pack1');
    expect(adapter.listMigrations).toHaveBeenCalledWith('pack1', 20);
  });
});

/* ──────────────────── listSchedulerWorkerRuntimeStates ──────────────────── */

describe('listSchedulerWorkerRuntimeStates', () => {
  it('throws when packId is missing', () => {
    const ctx = createContextWithAdapter();
    expect(() =>
      listSchedulerWorkerRuntimeStates(ctx as never, undefined)
    ).toThrow(/packId is required/);
  });

  it('returns worker states from adapter', () => {
    const adapter = createMockAdapter();
    const mockStates = [
      { worker_id: 'w1', status: 'active', last_heartbeat_at: 100n, owned_partition_count: 2, active_migration_count: 0, capacity_hint: null, updated_at: 100n }
    ];
    adapter.listWorkerStates.mockReturnValue(mockStates);
    const ctx = createContextWithAdapter(adapter);

    const result = listSchedulerWorkerRuntimeStates(ctx as never, 'pack1');
    expect(result).toEqual(mockStates);
  });
});

/* ──────────────────── refreshSchedulerWorkerRuntimeState ──────────────────── */

describe('refreshSchedulerWorkerRuntimeState', () => {
  it('throws when packId is missing', () => {
    const ctx = createContextWithAdapter();
    expect(() =>
      refreshSchedulerWorkerRuntimeState(ctx as never, { workerId: 'w1', ownedPartitionIds: [] }, undefined)
    ).toThrow(/packId is required/);
  });

  it('upserts worker state with active status when no existing state', () => {
    const adapter = createMockAdapter();
    adapter.getWorkerState.mockReturnValue(null);
    adapter.countMigrationsInProgress.mockReturnValue(0);
    const mockResult = { worker_id: 'w1', status: 'active' };
    adapter.upsertWorkerState.mockReturnValue(mockResult);
    const ctx = createContextWithAdapter(adapter);

    const result = refreshSchedulerWorkerRuntimeState(
      ctx as never,
      { workerId: 'w1', ownedPartitionIds: ['p1', 'p2'], now: 500n },
      'pack1'
    );

    expect(result).toEqual(mockResult);
    expect(adapter.upsertWorkerState).toHaveBeenCalledWith('pack1', expect.objectContaining({
      worker_id: 'w1',
      status: 'active',
      owned_partition_count: 2,
      last_heartbeat_at: 500n
    }));
  });

  it('preserves stale status from existing state', () => {
    const adapter = createMockAdapter();
    adapter.getWorkerState.mockReturnValue({ worker_id: 'w1', status: 'stale' });
    adapter.countMigrationsInProgress.mockReturnValue(1);
    adapter.upsertWorkerState.mockReturnValue({ worker_id: 'w1', status: 'stale' });
    const ctx = createContextWithAdapter(adapter);

    refreshSchedulerWorkerRuntimeState(
      ctx as never,
      { workerId: 'w1', ownedPartitionIds: ['p1'], now: 500n, capacityHint: 10 },
      'pack1'
    );

    expect(adapter.upsertWorkerState).toHaveBeenCalledWith('pack1', expect.objectContaining({
      status: 'stale',
      active_migration_count: 1,
      capacity_hint: 10
    }));
  });

  it('preserves suspected_dead status', () => {
    const adapter = createMockAdapter();
    adapter.getWorkerState.mockReturnValue({ worker_id: 'w1', status: 'suspected_dead' });
    adapter.countMigrationsInProgress.mockReturnValue(0);
    adapter.upsertWorkerState.mockReturnValue({ worker_id: 'w1', status: 'suspected_dead' });
    const ctx = createContextWithAdapter(adapter);

    refreshSchedulerWorkerRuntimeState(
      ctx as never,
      { workerId: 'w1', ownedPartitionIds: [], now: 500n },
      'pack1'
    );

    expect(adapter.upsertWorkerState).toHaveBeenCalledWith('pack1', expect.objectContaining({
      status: 'suspected_dead'
    }));
  });
});

/* ──────────────────── refreshSchedulerWorkerRuntimeLiveness ──────────────────── */

describe('refreshSchedulerWorkerRuntimeLiveness', () => {
  it('throws when packId is missing', () => {
    const ctx = createContextWithAdapter();
    expect(() =>
      refreshSchedulerWorkerRuntimeLiveness(ctx as never, 100n, undefined)
    ).toThrow(/packId is required/);
  });

  it('skips update when status unchanged', () => {
    const adapter = createMockAdapter();
    // Default stale=5, dead=15. Age=2 < stale → stays active
    adapter.listWorkerStates.mockReturnValue([
      { worker_id: 'w1', status: 'active', last_heartbeat_at: 98n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: null, updated_at: 98n }
    ]);
    const ctx = createContextWithAdapter(adapter);

    refreshSchedulerWorkerRuntimeLiveness(ctx as never, 100n, 'pack1');
    // Age = 100 - 98 = 2, which is below stale threshold (5)
    expect(adapter.updateWorkerStatus).not.toHaveBeenCalled();
  });

  it('marks worker stale when age exceeds stale threshold', () => {
    const adapter = createMockAdapter();
    // Default stale=5. Age=8 >= stale but < dead(15)
    adapter.listWorkerStates.mockReturnValue([
      { worker_id: 'w1', status: 'active', last_heartbeat_at: 92n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: null, updated_at: 92n }
    ]);
    const ctx = createContextWithAdapter(adapter);

    refreshSchedulerWorkerRuntimeLiveness(ctx as never, 100n, 'pack1');
    // Age = 100 - 92 = 8, which >= stale(5) but < dead(15)
    expect(adapter.updateWorkerStatus).toHaveBeenCalledWith('pack1', 'w1', 'stale', 100n);
  });

  it('marks worker suspected_dead when age exceeds dead threshold', () => {
    const adapter = createMockAdapter();
    // Default dead=15. Age=20 >= dead
    adapter.listWorkerStates.mockReturnValue([
      { worker_id: 'w1', status: 'active', last_heartbeat_at: 80n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: null, updated_at: 80n }
    ]);
    const ctx = createContextWithAdapter(adapter);

    refreshSchedulerWorkerRuntimeLiveness(ctx as never, 100n, 'pack1');
    // Age = 100 - 80 = 20, which >= dead(15)
    expect(adapter.updateWorkerStatus).toHaveBeenCalledWith('pack1', 'w1', 'suspected_dead', 100n);
  });

  it('recovers stale worker back to active', () => {
    const adapter = createMockAdapter();
    // Current status stale, but new heartbeat makes age=2 < stale
    adapter.listWorkerStates.mockReturnValue([
      { worker_id: 'w1', status: 'stale', last_heartbeat_at: 98n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: null, updated_at: 98n }
    ]);
    const ctx = createContextWithAdapter(adapter);

    refreshSchedulerWorkerRuntimeLiveness(ctx as never, 100n, 'pack1');
    // Age = 100 - 98 = 2, below stale threshold → active
    expect(adapter.updateWorkerStatus).toHaveBeenCalledWith('pack1', 'w1', 'active', 100n);
  });

  it('handles multiple workers', () => {
    const adapter = createMockAdapter();
    adapter.listWorkerStates.mockReturnValue([
      { worker_id: 'w1', status: 'active', last_heartbeat_at: 98n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: null, updated_at: 98n },
      { worker_id: 'w2', status: 'active', last_heartbeat_at: 92n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: null, updated_at: 92n },
      { worker_id: 'w3', status: 'active', last_heartbeat_at: 80n, owned_partition_count: 1, active_migration_count: 0, capacity_hint: null, updated_at: 80n }
    ]);
    const ctx = createContextWithAdapter(adapter);

    refreshSchedulerWorkerRuntimeLiveness(ctx as never, 100n, 'pack1');

    // w1: age=2 → active (no change, skipped)
    // w2: age=8 → stale (8>=5, 8<15)
    // w3: age=20 → suspected_dead (20>=15)
    expect(adapter.updateWorkerStatus).toHaveBeenCalledTimes(2);
    expect(adapter.updateWorkerStatus).toHaveBeenCalledWith('pack1', 'w2', 'stale', 100n);
    expect(adapter.updateWorkerStatus).toHaveBeenCalledWith('pack1', 'w3', 'suspected_dead', 100n);
  });
});

/* ──────────────────── requireAdapter ──────────────────── */

describe('requireAdapter', () => {
  it('throws when schedulerStorage is not injected', () => {
    const ctx = createMockAppContext(); // no schedulerStorage
    expect(() =>
      getSchedulerPartitionAssignment(ctx as never, 'p1', 'pack1')
    ).toThrow(/SchedulerStorageAdapter is required/);
  });
});
