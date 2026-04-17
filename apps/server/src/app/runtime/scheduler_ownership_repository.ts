import { Prisma } from '@prisma/client';

import type { AppContext } from '../context.js';

export const getSchedulerPartitionAssignmentRecord = async (
  context: AppContext,
  partitionId: string
) => {
  return context.prisma.schedulerPartitionAssignment.findUnique({
    where: {
      partition_id: partitionId
    }
  });
};

export const listSchedulerPartitionAssignmentRecords = async (context: AppContext) => {
  return context.prisma.schedulerPartitionAssignment.findMany({
    orderBy: [{ partition_id: 'asc' }]
  });
};

export const createSchedulerPartitionAssignmentRecord = async (
  context: AppContext,
  input: {
    partition_id: string;
    worker_id: string | null;
    status: string;
    version: number;
    source: string;
    updated_at: bigint;
  }
) => {
  return context.prisma.schedulerPartitionAssignment.create({
    data: input
  });
};

export const updateSchedulerPartitionAssignmentRecord = async (
  context: AppContext,
  input: {
    partition_id: string;
    worker_id?: string | null;
    status?: string;
    version?: number;
    source?: string;
    updated_at: bigint;
  }
) => {
  return context.prisma.schedulerPartitionAssignment.update({
    where: {
      partition_id: input.partition_id
    },
    data: {
      ...(input.worker_id !== undefined ? { worker_id: input.worker_id } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.version !== undefined ? { version: input.version } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      updated_at: input.updated_at
    }
  });
};

export const listSchedulerOwnershipMigrationRecords = async (
  context: AppContext,
  limit = 20
) => {
  return context.prisma.schedulerOwnershipMigrationLog.findMany({
    orderBy: [{ created_at: 'desc' }],
    take: limit
  });
};

export const countSchedulerOwnershipMigrationsInProgress = async (
  context: AppContext,
  workerId?: string
): Promise<number> => {
  return context.prisma.schedulerOwnershipMigrationLog.count({
    where: {
      status: {
        in: ['requested', 'in_progress']
      },
      ...(typeof workerId === 'string' ? { to_worker_id: workerId } : {})
    }
  });
};

export const getSchedulerOwnershipMigrationRecordById = async (
  context: AppContext,
  migrationId: string
) => {
  return context.prisma.schedulerOwnershipMigrationLog.findUnique({
    where: {
      id: migrationId
    }
  });
};

export const findLatestActiveSchedulerOwnershipMigrationForPartition = async (
  context: AppContext,
  input: {
    partition_id: string;
    to_worker_id: string;
  }
) => {
  return context.prisma.schedulerOwnershipMigrationLog.findFirst({
    where: {
      partition_id: input.partition_id,
      to_worker_id: input.to_worker_id,
      status: {
        in: ['requested', 'in_progress']
      }
    },
    orderBy: [{ created_at: 'desc' }]
  });
};

export const createSchedulerOwnershipMigrationRecord = async (
  context: AppContext,
  input: {
    partition_id: string;
    from_worker_id: string | null;
    to_worker_id: string;
    status: string;
    reason: string | null;
    details: Record<string, unknown>;
    created_at: bigint;
    updated_at: bigint;
    completed_at: bigint | null;
  }
) => {
  return context.prisma.schedulerOwnershipMigrationLog.create({
    data: {
      ...input,
      details: input.details as Prisma.InputJsonValue
    }
  });
};

export const updateSchedulerOwnershipMigrationRecord = async (
  context: AppContext,
  input: {
    id: string;
    status?: string;
    updated_at: bigint;
    completed_at?: bigint | null;
  }
) => {
  return context.prisma.schedulerOwnershipMigrationLog.update({
    where: {
      id: input.id
    },
    data: {
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.completed_at !== undefined ? { completed_at: input.completed_at } : {}),
      updated_at: input.updated_at
    }
  });
};

export const listSchedulerWorkerRuntimeStateRecords = async (context: AppContext) => {
  return context.prisma.schedulerWorkerRuntimeState.findMany({
    orderBy: [{ worker_id: 'asc' }]
  });
};

export const getSchedulerWorkerRuntimeStateRecord = async (
  context: AppContext,
  workerId: string
) => {
  return context.prisma.schedulerWorkerRuntimeState.findUnique({
    where: {
      worker_id: workerId
    }
  });
};

export const upsertSchedulerWorkerRuntimeStateRecord = async (
  context: AppContext,
  input: {
    worker_id: string;
    status: string;
    last_heartbeat_at: bigint;
    owned_partition_count: number;
    active_migration_count: number;
    capacity_hint: number | null;
    updated_at: bigint;
  }
) => {
  return context.prisma.schedulerWorkerRuntimeState.upsert({
    where: {
      worker_id: input.worker_id
    },
    create: input,
    update: {
      status: input.status,
      last_heartbeat_at: input.last_heartbeat_at,
      owned_partition_count: input.owned_partition_count,
      active_migration_count: input.active_migration_count,
      capacity_hint: input.capacity_hint,
      updated_at: input.updated_at
    }
  });
};

export const updateSchedulerWorkerRuntimeStatus = async (
  context: AppContext,
  input: {
    worker_id: string;
    status: string;
    updated_at: bigint;
  }
) => {
  return context.prisma.schedulerWorkerRuntimeState.update({
    where: {
      worker_id: input.worker_id
    },
    data: {
      status: input.status,
      updated_at: input.updated_at
    }
  });
};
