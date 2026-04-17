import { Prisma } from '@prisma/client';

import type { AppContext } from '../context.js';

export const findOpenSchedulerRebalanceRecommendation = async (
  context: AppContext,
  input: {
    partition_id: string;
    status: 'recommended' | 'suppressed';
    reason: string;
    from_worker_id: string | null;
    to_worker_id: string | null;
    suppress_reason: string | null;
  }
) => {
  return context.prisma.schedulerRebalanceRecommendation.findFirst({
    where: {
      partition_id: input.partition_id,
      status: input.status,
      reason: input.reason,
      from_worker_id: input.from_worker_id,
      to_worker_id: input.to_worker_id,
      suppress_reason: input.suppress_reason,
      applied_migration_id: null
    },
    orderBy: [{ created_at: 'desc' }]
  });
};

export const createSchedulerRebalanceRecommendationRecord = async (
  context: AppContext,
  input: {
    partition_id: string;
    from_worker_id: string | null;
    to_worker_id: string | null;
    status: string;
    reason: string;
    score?: number | null;
    suppress_reason?: string | null;
    details?: Record<string, unknown>;
    created_at: bigint;
    updated_at: bigint;
    applied_migration_id?: string | null;
  }
) => {
  return context.prisma.schedulerRebalanceRecommendation.create({
    data: {
      partition_id: input.partition_id,
      from_worker_id: input.from_worker_id,
      to_worker_id: input.to_worker_id,
      status: input.status,
      reason: input.reason,
      score: input.score ?? null,
      suppress_reason: input.suppress_reason ?? null,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
      created_at: input.created_at,
      updated_at: input.updated_at,
      applied_migration_id: input.applied_migration_id ?? null
    }
  });
};

export const listRecentSchedulerRebalanceRecommendationRecords = async (
  context: AppContext,
  limit = 20
) => {
  return context.prisma.schedulerRebalanceRecommendation.findMany({
    orderBy: [{ created_at: 'desc' }],
    take: limit
  });
};

export const getSchedulerRebalanceRecommendationRecordById = async (
  context: AppContext,
  recommendationId: string
) => {
  return context.prisma.schedulerRebalanceRecommendation.findUnique({
    where: {
      id: recommendationId
    }
  });
};

export const updateSchedulerRebalanceRecommendationRecord = async (
  context: AppContext,
  input: {
    id: string;
    status: 'applied' | 'superseded';
    updated_at: bigint;
    applied_migration_id?: string | null;
    details: Prisma.InputJsonValue;
  }
) => {
  return context.prisma.schedulerRebalanceRecommendation.update({
    where: {
      id: input.id
    },
    data: {
      status: input.status,
      updated_at: input.updated_at,
      applied_migration_id: input.applied_migration_id ?? null,
      details: input.details
    }
  });
};

export const listPendingSchedulerRebalanceRecommendationsForWorker = async (
  context: AppContext,
  input: {
    worker_id: string;
    max_apply: number;
  }
) => {
  return context.prisma.schedulerRebalanceRecommendation.findMany({
    where: {
      status: 'recommended',
      to_worker_id: input.worker_id,
      applied_migration_id: null
    },
    orderBy: [{ score: 'desc' }, { created_at: 'asc' }],
    take: input.max_apply
  });
};
