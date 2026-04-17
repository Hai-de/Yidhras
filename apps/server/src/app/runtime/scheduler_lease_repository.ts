import type { AppContext } from '../context.js';

export const upsertSchedulerLeaseRecord = async (
  context: AppContext,
  input: {
    key: string;
    partition_id: string;
    holder: string;
    acquired_at: bigint;
    expires_at: bigint;
    updated_at: bigint;
  }
) => {
  return context.prisma.schedulerLease.upsert({
    where: {
      partition_id: input.partition_id
    },
    update: {},
    create: input
  });
};

export const updateSchedulerLeaseRecordIfClaimable = async (
  context: AppContext,
  input: {
    partition_id: string;
    holder: string;
    acquired_at: bigint;
    expires_at: bigint;
    updated_at: bigint;
    key: string;
    now: bigint;
  }
) => {
  return context.prisma.schedulerLease.updateMany({
    where: {
      partition_id: input.partition_id,
      OR: [{ holder: input.holder }, { expires_at: { lte: input.now } }]
    },
    data: {
      key: input.key,
      holder: input.holder,
      acquired_at: input.acquired_at,
      expires_at: input.expires_at,
      updated_at: input.updated_at
    }
  });
};

export const getSchedulerLeaseRecord = async (
  context: AppContext,
  partitionId: string
) => {
  return context.prisma.schedulerLease.findUnique({
    where: {
      partition_id: partitionId
    }
  });
};

export const deleteSchedulerLeaseRecordByHolder = async (
  context: AppContext,
  input: {
    partition_id: string;
    holder: string;
  }
) => {
  return context.prisma.schedulerLease.deleteMany({
    where: {
      partition_id: input.partition_id,
      holder: input.holder
    }
  });
};

export const upsertSchedulerCursorRecord = async (
  context: AppContext,
  input: {
    key: string;
    partition_id: string;
    last_scanned_tick: bigint;
    last_signal_tick: bigint;
    updated_at: bigint;
  }
) => {
  return context.prisma.schedulerCursor.upsert({
    where: {
      partition_id: input.partition_id
    },
    update: {
      key: input.key,
      last_scanned_tick: input.last_scanned_tick,
      last_signal_tick: input.last_signal_tick,
      updated_at: input.updated_at
    },
    create: input
  });
};

export const getSchedulerCursorRecord = async (
  context: AppContext,
  partitionId: string
) => {
  return context.prisma.schedulerCursor.findUnique({
    where: {
      partition_id: partitionId
    }
  });
};
