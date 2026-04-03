import type { AppContext } from '../context.js';
import {
  DEFAULT_SCHEDULER_PARTITION_ID,
  isSchedulerPartitionId
} from './scheduler_partitioning.js';

export const SCHEDULER_LEASE_KEY_PREFIX = 'agent_scheduler_main';
export const SCHEDULER_CURSOR_KEY_PREFIX = 'agent_scheduler_cursor';
export const SCHEDULER_LEASE_KEY = `${SCHEDULER_LEASE_KEY_PREFIX}:${DEFAULT_SCHEDULER_PARTITION_ID}`;
export const SCHEDULER_CURSOR_KEY = `${SCHEDULER_CURSOR_KEY_PREFIX}:${DEFAULT_SCHEDULER_PARTITION_ID}`;
export const DEFAULT_SCHEDULER_LEASE_TICKS = 5n;

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
  return `${SCHEDULER_LEASE_KEY_PREFIX}:${normalizePartitionId(partitionId)}`;
};

export const buildSchedulerCursorKey = (partitionId = DEFAULT_SCHEDULER_PARTITION_ID): string => {
  return `${SCHEDULER_CURSOR_KEY_PREFIX}:${normalizePartitionId(partitionId)}`;
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
  const partitionId = normalizePartitionId(input.partitionId);
  const now = input.now ?? context.sim.clock.getTicks();
  const leaseTicks = input.leaseTicks ?? DEFAULT_SCHEDULER_LEASE_TICKS;
  const expiresAt = now + leaseTicks;
  const key = buildSchedulerLeaseKey(partitionId);
  const existing = await context.prisma.schedulerLease.findUnique({
    where: {
      partition_id: partitionId
    }
  });

  if (!existing) {
    await context.prisma.schedulerLease.create({
      data: {
        key,
        partition_id: partitionId,
        holder: input.workerId,
        acquired_at: now,
        expires_at: expiresAt,
        updated_at: now
      }
    });
    return {
      acquired: true,
      holder: input.workerId,
      expires_at: expiresAt,
      partition_id: partitionId,
      key
    };
  }

  if (existing.holder === input.workerId || existing.expires_at <= now) {
    await context.prisma.schedulerLease.update({
      where: {
        partition_id: partitionId
      },
      data: {
        key: existing.key ?? key,
        holder: input.workerId,
        acquired_at: existing.holder === input.workerId ? existing.acquired_at : now,
        expires_at: expiresAt,
        updated_at: now
      }
    });
    return {
      acquired: true,
      holder: input.workerId,
      expires_at: expiresAt,
      partition_id: partitionId,
      key: existing.key
    };
  }

  return {
    acquired: false,
    holder: existing.holder,
    expires_at: existing.expires_at,
    partition_id: partitionId,
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
  const normalizedPartitionId = normalizePartitionId(partitionId);
  const existing = await context.prisma.schedulerLease.findUnique({
    where: {
      partition_id: normalizedPartitionId
    }
  });

  if (!existing || existing.holder !== workerId) {
    return false;
  }

  await context.prisma.schedulerLease.delete({
    where: {
      partition_id: normalizedPartitionId
    }
  });

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
  const partitionId = normalizePartitionId(input.partitionId);
  const key = buildSchedulerCursorKey(partitionId);
  const now = input.now ?? context.sim.clock.getTicks();
  await context.prisma.schedulerCursor.upsert({
    where: {
      partition_id: partitionId
    },
    update: {
      key,
      last_scanned_tick: input.lastScannedTick,
      last_signal_tick: input.lastSignalTick,
      updated_at: now
    },
    create: {
      key,
      partition_id: partitionId,
      last_scanned_tick: input.lastScannedTick,
      last_signal_tick: input.lastSignalTick,
      updated_at: now
    }
  });
};

export const getSchedulerCursor = async (
  context: AppContext,
  partitionId?: string
): Promise<{ partition_id: string; last_scanned_tick: bigint; last_signal_tick: bigint } | null> => {
  const normalizedPartitionId = normalizePartitionId(partitionId);
  const cursor = await context.prisma.schedulerCursor.findUnique({
    where: {
      partition_id: normalizedPartitionId
    }
  });

  if (!cursor) {
    return null;
  }

  return {
    partition_id: cursor.partition_id,
    last_scanned_tick: cursor.last_scanned_tick,
    last_signal_tick: cursor.last_signal_tick
  };
};
