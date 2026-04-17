import { Prisma } from '@prisma/client';

import { getSchedulerAutomaticRebalanceConfig } from '../../config/runtime_config.js';
import type { AppContext } from '../context.js';
import {
  countSchedulerOwnershipMigrationsInProgress,
  createSchedulerOwnershipMigration,
  getSchedulerPartitionAssignment,
  listSchedulerPartitionAssignments,
  listSchedulerWorkerRuntimeStates
} from './scheduler_ownership.js';
import {
  createSchedulerRebalanceRecommendationRecord,
  findOpenSchedulerRebalanceRecommendation,
  getSchedulerRebalanceRecommendationRecordById,
  listPendingSchedulerRebalanceRecommendationsForWorker,
  listRecentSchedulerRebalanceRecommendationRecords,
  updateSchedulerRebalanceRecommendationRecord
} from './scheduler_rebalance_repository.js';

export interface SchedulerRebalanceRecommendationRecord {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string | null;
  status: string;
  reason: string;
  score: number | null;
  suppress_reason: string | null;
  details: unknown;
  created_at: bigint;
  updated_at: bigint;
  applied_migration_id: string | null;
}

export interface EvaluateSchedulerAutomaticRebalanceResult {
  created_recommendations: SchedulerRebalanceRecommendationRecord[];
  created_suppressions: SchedulerRebalanceRecommendationRecord[];
  migration_backlog_count: number;
}

export interface ApplySchedulerAutomaticRebalanceResult {
  applied_recommendation_ids: string[];
  created_migration_ids: string[];
  superseded_recommendation_ids: string[];
}

const findOpenRecommendation = async (
  context: AppContext,
  input: {
    partitionId: string;
    status: 'recommended' | 'suppressed';
    reason: string;
    fromWorkerId: string | null;
    toWorkerId: string | null;
    suppressReason: string | null;
  }
): Promise<SchedulerRebalanceRecommendationRecord | null> => {
  return findOpenSchedulerRebalanceRecommendation(context, {
    partition_id: input.partitionId,
    status: input.status,
    reason: input.reason,
    from_worker_id: input.fromWorkerId,
    to_worker_id: input.toWorkerId,
    suppress_reason: input.suppressReason
  });
};

const createRecommendation = async (
  context: AppContext,
  input: {
    partitionId: string;
    fromWorkerId: string | null;
    toWorkerId: string | null;
    status: 'recommended' | 'suppressed';
    reason: string;
    score?: number | null;
    suppressReason?: string | null;
    details?: Record<string, unknown>;
    now: bigint;
  }
): Promise<SchedulerRebalanceRecommendationRecord> => {
  const existing = await findOpenRecommendation(context, {
    partitionId: input.partitionId,
    status: input.status,
    reason: input.reason,
    fromWorkerId: input.fromWorkerId,
    toWorkerId: input.toWorkerId,
    suppressReason: input.suppressReason ?? null
  });

  if (existing) {
    return existing;
  }

  return createSchedulerRebalanceRecommendationRecord(context, {
    partition_id: input.partitionId,
    from_worker_id: input.fromWorkerId,
    to_worker_id: input.toWorkerId,
    status: input.status,
    reason: input.reason,
    score: input.score ?? null,
    suppress_reason: input.suppressReason ?? null,
    details: input.details ?? {},
    created_at: input.now,
    updated_at: input.now,
    applied_migration_id: null
  });
};

export const listRecentSchedulerRebalanceRecommendations = async (
  context: AppContext,
  limit = 20
): Promise<SchedulerRebalanceRecommendationRecord[]> => {
  return listRecentSchedulerRebalanceRecommendationRecords(context, limit);
};

const markRecommendationStatus = async (
  context: AppContext,
  input: {
    recommendationId: string;
    status: 'applied' | 'superseded';
    now: bigint;
    appliedMigrationId?: string | null;
    extraDetails?: Record<string, unknown>;
  }
): Promise<void> => {
  const existing = await getSchedulerRebalanceRecommendationRecordById(context, input.recommendationId);

  await updateSchedulerRebalanceRecommendationRecord(context, {
    id: input.recommendationId,
    status: input.status,
    updated_at: input.now,
    applied_migration_id: input.appliedMigrationId ?? existing?.applied_migration_id ?? null,
    details: ({
      ...(typeof existing?.details === 'object' && existing?.details !== null && !Array.isArray(existing.details)
        ? (existing.details as Record<string, unknown>)
        : {}),
      ...(input.extraDetails ?? {})
    } satisfies Record<string, unknown>) as Prisma.InputJsonValue
  });
};

export const applySchedulerAutomaticRebalanceForWorker = async (
  context: AppContext,
  input: {
    workerId: string;
    now?: bigint;
    maxApply?: number;
  }
): Promise<ApplySchedulerAutomaticRebalanceResult> => {
  const now = input.now ?? context.sim.getCurrentTick();
  const config = getSchedulerAutomaticRebalanceConfig();
  const maxApply = Math.max(input.maxApply ?? config.max_apply, 1);
  const recommendations = await listPendingSchedulerRebalanceRecommendationsForWorker(context, {
    worker_id: input.workerId,
    max_apply: maxApply
  });

  const appliedRecommendationIds: string[] = [];
  const createdMigrationIds: string[] = [];
  const supersededRecommendationIds: string[] = [];

  for (const recommendation of recommendations) {
    const activeMigration = await context.prisma.schedulerOwnershipMigrationLog.findFirst({
      where: {
        partition_id: recommendation.partition_id,
        status: {
          in: ['requested', 'in_progress']
        }
      },
      orderBy: [{ created_at: 'desc' }]
    });

    if (activeMigration) {
      await markRecommendationStatus(context, {
        recommendationId: recommendation.id,
        status: 'superseded',
        now,
        extraDetails: {
          superseded_reason: 'active_migration_exists',
          active_migration_id: activeMigration.id
        }
      });
      supersededRecommendationIds.push(recommendation.id);
      continue;
    }

    const assignment = await getSchedulerPartitionAssignment(context, recommendation.partition_id);
    if (assignment?.worker_id === recommendation.to_worker_id && assignment.status === 'assigned') {
      await markRecommendationStatus(context, {
        recommendationId: recommendation.id,
        status: 'superseded',
        now,
        extraDetails: {
          superseded_reason: 'assignment_already_applied'
        }
      });
      supersededRecommendationIds.push(recommendation.id);
      continue;
    }

    const migration = await createSchedulerOwnershipMigration(context, {
      partitionId: recommendation.partition_id,
      toWorkerId: recommendation.to_worker_id ?? input.workerId,
      reason: `automatic_rebalance:${recommendation.reason}`,
      requestedByWorkerId: input.workerId
    });
    await markRecommendationStatus(context, {
      recommendationId: recommendation.id,
      status: 'applied',
      now,
      appliedMigrationId: migration.id,
      extraDetails: {
        apply_worker_id: input.workerId
      }
    });
    appliedRecommendationIds.push(recommendation.id);
    createdMigrationIds.push(migration.id);
  }

  return {
    applied_recommendation_ids: appliedRecommendationIds,
    created_migration_ids: createdMigrationIds,
    superseded_recommendation_ids: supersededRecommendationIds
  };
};

export const evaluateSchedulerAutomaticRebalance = async (
  context: AppContext,
  input?: {
    now?: bigint;
    maxRecommendations?: number;
    migrationBacklogLimit?: number;
  }
): Promise<EvaluateSchedulerAutomaticRebalanceResult> => {
  const now = input?.now ?? context.sim.getCurrentTick();
  const config = getSchedulerAutomaticRebalanceConfig();
  const maxRecommendations = Math.max(input?.maxRecommendations ?? config.max_recommendations, 1);
  const migrationBacklogLimit = Math.max(
    input?.migrationBacklogLimit ?? config.backlog_limit,
    0
  );

  const [workerStates, assignments, migrationBacklogCount] = await Promise.all([
    listSchedulerWorkerRuntimeStates(context),
    listSchedulerPartitionAssignments(context),
    countSchedulerOwnershipMigrationsInProgress(context)
  ]);

  const createdRecommendations: SchedulerRebalanceRecommendationRecord[] = [];
  const createdSuppressions: SchedulerRebalanceRecommendationRecord[] = [];

  if (migrationBacklogCount > migrationBacklogLimit) {
    const suppression = await createRecommendation(context, {
      partitionId: assignments[0]?.partition_id ?? 'p0',
      fromWorkerId: assignments[0]?.worker_id ?? null,
      toWorkerId: null,
      status: 'suppressed',
      reason: 'automatic_rebalance_suppressed',
      suppressReason: 'migration_backlog_exceeded',
      details: {
        migration_backlog_count: migrationBacklogCount,
        migration_backlog_limit: migrationBacklogLimit
      },
      now
    });
    createdSuppressions.push(suppression);

    return {
      created_recommendations: createdRecommendations,
      created_suppressions: createdSuppressions,
      migration_backlog_count: migrationBacklogCount
    };
  }

  const activeWorkers = workerStates.filter(worker => worker.status === 'active');
  const staleOrDeadWorkers = workerStates.filter(worker => worker.status === 'stale' || worker.status === 'suspected_dead');

  const partitionsByWorker = new Map<string, string[]>();
  for (const assignment of assignments) {
    if (!assignment.worker_id || assignment.status === 'released') {
      continue;
    }
    const existing = partitionsByWorker.get(assignment.worker_id) ?? [];
    existing.push(assignment.partition_id);
    partitionsByWorker.set(assignment.worker_id, existing);
  }

  for (const staleWorker of staleOrDeadWorkers) {
    if (createdRecommendations.length >= maxRecommendations) {
      break;
    }

    const targetWorker = activeWorkers.find(worker => worker.worker_id !== staleWorker.worker_id) ?? null;
    const ownedPartitions = partitionsByWorker.get(staleWorker.worker_id) ?? [];
    const candidatePartitionId = ownedPartitions[0] ?? null;
    if (!targetWorker || !candidatePartitionId) {
      continue;
    }

    const recommendation = await createRecommendation(context, {
      partitionId: candidatePartitionId,
      fromWorkerId: staleWorker.worker_id,
      toWorkerId: targetWorker.worker_id,
      status: 'recommended',
      reason: 'worker_unhealthy',
      score: staleWorker.status === 'suspected_dead' ? 100 : 80,
      details: {
        source_worker_status: staleWorker.status,
        target_worker_status: targetWorker.status
      },
      now
    });
    createdRecommendations.push(recommendation);
  }

  if (createdRecommendations.length < maxRecommendations && activeWorkers.length >= 2) {
    const sortedActiveWorkers = [...activeWorkers].sort(
      (left, right) => right.owned_partition_count - left.owned_partition_count
    );
    const mostLoadedWorker = sortedActiveWorkers[0] ?? null;
    const leastLoadedWorker = sortedActiveWorkers[sortedActiveWorkers.length - 1] ?? null;

    if (
      mostLoadedWorker &&
      leastLoadedWorker &&
      mostLoadedWorker.worker_id !== leastLoadedWorker.worker_id &&
      mostLoadedWorker.owned_partition_count - leastLoadedWorker.owned_partition_count >= 2
    ) {
      const candidatePartitionId = (partitionsByWorker.get(mostLoadedWorker.worker_id) ?? [])[0] ?? null;
      if (candidatePartitionId) {
        const recommendation = await createRecommendation(context, {
          partitionId: candidatePartitionId,
          fromWorkerId: mostLoadedWorker.worker_id,
          toWorkerId: leastLoadedWorker.worker_id,
          status: 'recommended',
          reason: 'partition_skew',
          score: mostLoadedWorker.owned_partition_count - leastLoadedWorker.owned_partition_count,
          details: {
            source_owned_partition_count: mostLoadedWorker.owned_partition_count,
            target_owned_partition_count: leastLoadedWorker.owned_partition_count
          },
          now
        });
        createdRecommendations.push(recommendation);
      }
    }
  }

  if (createdRecommendations.length === 0 && createdSuppressions.length === 0) {
    const suppression = await createRecommendation(context, {
      partitionId: assignments[0]?.partition_id ?? 'p0',
      fromWorkerId: assignments[0]?.worker_id ?? null,
      toWorkerId: null,
      status: 'suppressed',
      reason: 'automatic_rebalance_suppressed',
      suppressReason: 'no_rebalance_opportunity',
      details: {
        active_worker_count: activeWorkers.length,
        stale_or_dead_worker_count: staleOrDeadWorkers.length
      },
      now
    });
    createdSuppressions.push(suppression);
  }

  return {
    created_recommendations: createdRecommendations,
    created_suppressions: createdSuppressions,
    migration_backlog_count: migrationBacklogCount
  };
};
