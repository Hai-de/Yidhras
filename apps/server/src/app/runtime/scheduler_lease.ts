import { getSchedulerLeaseTicks } from '../../config/runtime_config.js';
import type { AppContext } from '../context.js';
import { buildPackScopedSchedulerCursorKey, buildPackScopedSchedulerLeaseKey, parsePackScopedSchedulerPartitionId } from './multi_pack_scheduler_scope.js';
import {
  deleteSchedulerLeaseRecordByHolder,
  getSchedulerCursorRecord,
  getSchedulerLeaseRecord,
  updateSchedulerLeaseRecordIfClaimable,
  upsertSchedulerCursorRecord,
  upsertSchedulerLeaseRecord
} from './scheduler_lease_repository.js';
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

const normalizePartitionScope = (partitionId: string | undefined): { rawPartitionId: string; storagePartitionId: string; packId: string | null } => {
  const incoming = typeof partitionId === 'string' ? partitionId.trim() : '';

  if (incoming.includes('::')) {
    const parsed = parsePackScopedSchedulerPartitionId(incoming);
    return {
      rawPartitionId: parsed.partition_id,
      storagePartitionId: parsed.scoped_partition_id,
      packId: parsed.pack_id
    };
  }

  const normalized = normalizePartitionId(partitionId);

  if (!normalized.includes('::')) {
    return {
      rawPartitionId: normalized,
      storagePartitionId: normalized,
      packId: null
    };
  }

  return {
    rawPartitionId: normalized,
    storagePartitionId: normalized,
    packId: null
  };
};

export const buildSchedulerLeaseKey = (partitionId = DEFAULT_SCHEDULER_PARTITION_ID): string => {
  const scope = normalizePartitionScope(partitionId);
  return scope.packId
    ? `${SCHEDULER_LEASE_KEY_PREFIX}:${buildPackScopedSchedulerLeaseKey(scope.packId, scope.rawPartitionId)}`
    : `${SCHEDULER_LEASE_KEY_PREFIX}:${scope.storagePartitionId}`;
};

export const buildSchedulerCursorKey = (partitionId = DEFAULT_SCHEDULER_PARTITION_ID): string => {
  const scope = normalizePartitionScope(partitionId);
  return scope.packId
    ? `${SCHEDULER_CURSOR_KEY_PREFIX}:${buildPackScopedSchedulerCursorKey(scope.packId, scope.rawPartitionId)}`
    : `${SCHEDULER_CURSOR_KEY_PREFIX}:${scope.storagePartitionId}`;
};

export const acquireSchedulerLease = async (
  context: AppContext,
  input: {
    workerId: string;
    partitionId?: string;
    now?: bigint;
    leaseTicks?: bigint;
  }
): Promise<SchedulerLeaseAcquireResult> => {
  const partitionScope = normalizePartitionScope(input.partitionId);
  const now = input.now ?? context.sim.getCurrentTick();
  const leaseTicks = input.leaseTicks ?? getSchedulerLeaseTicks();
  const expiresAt = now + leaseTicks;
  const key = buildSchedulerLeaseKey(partitionScope.storagePartitionId);
  const existing = await upsertSchedulerLeaseRecord(context, {
    key,
    partition_id: partitionScope.storagePartitionId,
    holder: input.workerId,
    acquired_at: now,
    expires_at: expiresAt,
    updated_at: now
  });

  if (existing.holder === input.workerId && existing.acquired_at === now && existing.expires_at === expiresAt) {
    return {
      acquired: true,
      holder: input.workerId,
      expires_at: expiresAt,
      partition_id: partitionScope.storagePartitionId,
      key: existing.key
    };
  }

  if (existing.holder !== input.workerId && existing.expires_at > now) {
    return {
      acquired: false,
      holder: existing.holder,
      expires_at: existing.expires_at,
      partition_id: partitionScope.storagePartitionId,
      key: existing.key
    };
  }

  const updatedLease = await updateSchedulerLeaseRecordIfClaimable(context, {
    partition_id: partitionScope.storagePartitionId,
    holder: input.workerId,
    acquired_at: existing.holder === input.workerId ? existing.acquired_at : now,
    expires_at: expiresAt,
    updated_at: now,
    key: existing.key ?? key,
    now
  });

  if (updatedLease.count === 0) {
    const latestLease = await getSchedulerLeaseRecord(context, partitionScope.storagePartitionId);

    if (!latestLease) {
      return {
        acquired: false,
        holder: null,
        expires_at: null,
        partition_id: partitionScope.storagePartitionId,
        key
      };
    }

    return {
      acquired: latestLease.holder === input.workerId,
      holder: latestLease.holder,
      expires_at: latestLease.expires_at,
      partition_id: latestLease.partition_id,
      key: latestLease.key
    };
  }

  return {
    acquired: true,
    holder: input.workerId,
    expires_at: expiresAt,
    partition_id: partitionScope.storagePartitionId,
    key: existing.key
  };
};

export const renewSchedulerLease = async (
  context: AppContext,
  input: {
    workerId: string;
    partitionId?: string;
    now?: bigint;
    leaseTicks?: bigint;
  }
): Promise<SchedulerLeaseAcquireResult> => {
  return acquireSchedulerLease(context, input);
};

export const releaseSchedulerLease = async (
  context: AppContext,
  workerId: string,
  partitionId?: string
): Promise<boolean> => {
  const partitionScope = normalizePartitionScope(partitionId);
  const releaseResult = await deleteSchedulerLeaseRecordByHolder(context, {
    partition_id: partitionScope.storagePartitionId,
    holder: workerId
  });

  if (releaseResult.count === 0) {
    return false;
  }

  return true;
};

export const updateSchedulerCursor = async (
  context: AppContext,
  input: {
    partitionId?: string;
    lastScannedTick: bigint;
    lastSignalTick: bigint;
    now?: bigint;
  }
): Promise<void> => {
  const partitionScope = normalizePartitionScope(input.partitionId);
  const key = buildSchedulerCursorKey(partitionScope.storagePartitionId);
  const now = input.now ?? context.sim.getCurrentTick();
  await upsertSchedulerCursorRecord(context, {
    key,
    partition_id: partitionScope.storagePartitionId,
    last_scanned_tick: input.lastScannedTick,
    last_signal_tick: input.lastSignalTick,
    updated_at: now
  });
};

export const getSchedulerCursor = async (
  context: AppContext,
  partitionId?: string
): Promise<{ partition_id: string; last_scanned_tick: bigint; last_signal_tick: bigint } | null> => {
  const partitionScope = normalizePartitionScope(partitionId);
  const cursor = await getSchedulerCursorRecord(context, partitionScope.storagePartitionId);

  if (!cursor) {
    return null;
  }

  return {
    partition_id: cursor.partition_id,
    last_scanned_tick: cursor.last_scanned_tick,
    last_signal_tick: cursor.last_signal_tick
  };
};
