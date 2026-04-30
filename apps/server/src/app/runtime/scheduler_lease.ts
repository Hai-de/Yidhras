import { getSchedulerLeaseTicks } from '../../config/runtime_config.js';
import type { AppContext } from '../context.js';
import {
  DEFAULT_SCHEDULER_PARTITION_ID,
  isSchedulerPartitionId
} from './scheduler_partitioning.js';

export const SCHEDULER_LEASE_KEY_PREFIX = 'agent_scheduler_main';
export const SCHEDULER_CURSOR_KEY_PREFIX = 'agent_scheduler_cursor';
export const SCHEDULER_LEASE_KEY = `${SCHEDULER_LEASE_KEY_PREFIX}:${DEFAULT_SCHEDULER_PARTITION_ID}`;
export const SCHEDULER_CURSOR_KEY = `${SCHEDULER_CURSOR_KEY_PREFIX}:${DEFAULT_SCHEDULER_PARTITION_ID}`;

export interface SchedulerLeaseAcquireResult {
  acquired: boolean;
  holder: string | null;
  expires_at: bigint | null;
  partition_id: string;
  key: string;
}

const normalizePartitionId = (partitionId: string | undefined): string => {
  if (typeof partitionId !== 'string' || partitionId.trim().length === 0) {
    return DEFAULT_SCHEDULER_PARTITION_ID;
  }

  const normalized = partitionId.trim();
  if (!isSchedulerPartitionId(normalized)) {
    throw new Error(`scheduler partition id is invalid: ${partitionId}`);
  }

  return normalized;
};

export const buildSchedulerLeaseKey = (partitionId = DEFAULT_SCHEDULER_PARTITION_ID): string => {
  const id = normalizePartitionId(partitionId);
  return `${SCHEDULER_LEASE_KEY_PREFIX}:${id}`;
};

export const buildSchedulerCursorKey = (partitionId = DEFAULT_SCHEDULER_PARTITION_ID): string => {
  const id = normalizePartitionId(partitionId);
  return `${SCHEDULER_CURSOR_KEY_PREFIX}:${id}`;
};

const requireAdapter = (context: AppContext) => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    throw new Error('[scheduler_lease] SchedulerStorageAdapter is required. Ensure it is injected into AppContext.');
  }
  return adapter;
};

export const acquireSchedulerLease = (
  context: AppContext,
  input: {
    workerId: string;
    partitionId?: string;
    now?: bigint;
    leaseTicks?: bigint;
  },
  packId?: string
): SchedulerLeaseAcquireResult => {
  if (!packId) {
    throw new Error('[scheduler_lease] packId is required for acquireSchedulerLease');
  }

  const adapter = requireAdapter(context);
  adapter.open(packId);

  const partitionId = normalizePartitionId(input.partitionId);
  const now = input.now ?? context.clock.getCurrentTick();
  const leaseTicks = input.leaseTicks ?? getSchedulerLeaseTicks();
  const expiresAt = now + leaseTicks;
  const key = buildSchedulerLeaseKey(partitionId);

  const existing = adapter.getLease(packId, partitionId);

  // No existing lease — create one
  if (!existing) {
    adapter.upsertLease(packId, {
      key,
      partition_id: partitionId,
      holder: input.workerId,
      acquired_at: now,
      expires_at: expiresAt,
      updated_at: now
    });

    return {
      acquired: true,
      holder: input.workerId,
      expires_at: expiresAt,
      partition_id: partitionId,
      key
    };
  }

  // Same worker already holds the lease — extend it
  if (existing.holder === input.workerId) {
    adapter.upsertLease(packId, {
      key: existing.key,
      partition_id: partitionId,
      holder: input.workerId,
      acquired_at: existing.acquired_at,
      expires_at: expiresAt,
      updated_at: now
    });

    return {
      acquired: true,
      holder: input.workerId,
      expires_at: expiresAt,
      partition_id: partitionId,
      key: existing.key
    };
  }

  // Held by another worker and not expired
  if (existing.expires_at > now) {
    return {
      acquired: false,
      holder: existing.holder,
      expires_at: existing.expires_at,
      partition_id: partitionId,
      key: existing.key
    };
  }

  // Expired — try to claim
  const result = adapter.updateLeaseIfClaimable(packId, {
    partition_id: partitionId,
    holder: input.workerId,
    acquired_at: now,
    expires_at: expiresAt,
    updated_at: now,
    key,
    now
  });

  if (result.count === 0) {
    const latest = adapter.getLease(packId, partitionId);
    if (!latest) {
      return {
        acquired: false,
        holder: null,
        expires_at: null,
        partition_id: partitionId,
        key
      };
    }

    return {
      acquired: latest.holder === input.workerId,
      holder: latest.holder,
      expires_at: latest.expires_at,
      partition_id: latest.partition_id,
      key: latest.key
    };
  }

  return {
    acquired: true,
    holder: input.workerId,
    expires_at: expiresAt,
    partition_id: partitionId,
    key
  };
};

export const renewSchedulerLease = (
  context: AppContext,
  input: {
    workerId: string;
    partitionId?: string;
    now?: bigint;
    leaseTicks?: bigint;
  },
  packId?: string
): SchedulerLeaseAcquireResult => {
  return acquireSchedulerLease(context, input, packId);
};

export const releaseSchedulerLease = (
  context: AppContext,
  workerId: string,
  partitionId?: string,
  packId?: string
): boolean => {
  if (!packId) {
    throw new Error('[scheduler_lease] packId is required for releaseSchedulerLease');
  }

  const adapter = requireAdapter(context);
  adapter.open(packId);

  const id = normalizePartitionId(partitionId);
  const result = adapter.deleteLeaseByHolder(packId, id, workerId);

  return result.count > 0;
};

export const updateSchedulerCursor = (
  context: AppContext,
  input: {
    partitionId?: string;
    lastScannedTick: bigint;
    lastSignalTick: bigint;
    now?: bigint;
  },
  packId?: string
): void => {
  if (!packId) {
    throw new Error('[scheduler_lease] packId is required for updateSchedulerCursor');
  }

  const adapter = requireAdapter(context);
  adapter.open(packId);

  const id = normalizePartitionId(input.partitionId);
  const key = buildSchedulerCursorKey(id);
  const now = input.now ?? context.clock.getCurrentTick();

  adapter.upsertCursor(packId, {
    key,
    partition_id: id,
    last_scanned_tick: input.lastScannedTick,
    last_signal_tick: input.lastSignalTick,
    updated_at: now
  });
};

export const getSchedulerCursor = (
  context: AppContext,
  partitionId?: string,
  packId?: string
): { partition_id: string; last_scanned_tick: bigint; last_signal_tick: bigint } | null => {
  if (!packId) {
    throw new Error('[scheduler_lease] packId is required for getSchedulerCursor');
  }

  const adapter = requireAdapter(context);
  adapter.open(packId);

  const id = normalizePartitionId(partitionId);
  const cursor = adapter.getCursor(packId, id);

  if (!cursor) {
    return null;
  }

  return {
    partition_id: cursor.partition_id,
    last_scanned_tick: cursor.last_scanned_tick,
    last_signal_tick: cursor.last_signal_tick
  };
};

