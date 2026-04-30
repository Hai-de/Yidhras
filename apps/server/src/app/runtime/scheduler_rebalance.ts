import { getSchedulerAutomaticRebalanceConfig } from '../../config/runtime_config.js';
import type { AppContext } from '../context.js';
import {
  createSchedulerOwnershipMigration,
  getSchedulerPartitionAssignment,
  listSchedulerPartitionAssignments,
  listSchedulerWorkerRuntimeStates
} from './scheduler_ownership.js';

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

const requireAdapter = (context: AppContext) => {
  const adapter = context.schedulerStorage;
  if (!adapter) {
    throw new Error('[scheduler_rebalance] SchedulerStorageAdapter is required.');
  }
  return adapter;
};

const findOpenRecommendation = (
  context: AppContext,
  packId: string,
  input: {
    partitionId: string;
    status: 'recommended' | 'suppressed';
    reason: string;
    fromWorkerId: string | null;
    toWorkerId: string | null;
    suppressReason: string | null;
  }
): SchedulerRebalanceRecommendationRecord | null => {
  const adapter = requireAdapter(context);
  return adapter.findOpenRecommendation(packId, {
    partition_id: input.partitionId,
    status: input.status,
    reason: input.reason,
    from_worker_id: input.fromWorkerId,
    to_worker_id: input.toWorkerId,
    suppress_reason: input.suppressReason
  });
};

const createRecommendation = (
  context: AppContext,
  packId: string,
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
): SchedulerRebalanceRecommendationRecord => {
  const adapter = requireAdapter(context);

  const existing = findOpenRecommendation(context, packId, {
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

  return adapter.createRecommendation(packId, {
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

export const listRecentSchedulerRebalanceRecommendations = (
  context: AppContext,
  limit = 20,
  packId?: string
): SchedulerRebalanceRecommendationRecord[] => {
  if (!packId) {
    throw new Error('[scheduler_rebalance] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);
  return adapter.listRecentRecommendations(packId, limit);
};

const markRecommendationStatus = (
  context: AppContext,
  packId: string,
  input: {
    recommendationId: string;
    status: 'applied' | 'superseded';
    now: bigint;
    appliedMigrationId?: string | null;
    extraDetails?: Record<string, unknown>;
  }
): void => {
  const adapter = requireAdapter(context);
  const existing = adapter.getRecommendationById(packId, input.recommendationId);

  const mergedDetails: Record<string, unknown> = {
    ...(typeof existing?.details === 'object' && existing?.details !== null && !Array.isArray(existing.details)
      ? (existing.details as Record<string, unknown>)
      : {}),
    ...(input.extraDetails ?? {})
  };

  adapter.updateRecommendation(packId, {
    id: input.recommendationId,
    status: input.status,
    updated_at: input.now,
    applied_migration_id: input.appliedMigrationId ?? (existing?.applied_migration_id ?? null),
    details: mergedDetails
  });
};

export const applySchedulerAutomaticRebalanceForWorker = (
  context: AppContext,
  input: {
    workerId: string;
    now?: bigint;
    maxApply?: number;
  },
  packId?: string
): ApplySchedulerAutomaticRebalanceResult => {
  if (!packId) {
    throw new Error('[scheduler_rebalance] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const now = input.now ?? context.clock.getCurrentTick();
  const config = getSchedulerAutomaticRebalanceConfig();
  const maxApply = Math.max(input.maxApply ?? config.max_apply, 1);
  const recommendations = adapter.listPendingRecommendationsForWorker(
    packId,
    input.workerId,
    maxApply
  );

  const appliedRecommendationIds: string[] = [];
  const createdMigrationIds: string[] = [];
  const supersededRecommendationIds: string[] = [];

  for (const recommendation of recommendations) {
    const activeMigration = adapter.findLatestActiveMigrationForPartition(
      packId,
      recommendation.partition_id,
      input.workerId
    );

    if (activeMigration) {
      markRecommendationStatus(context, packId, {
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

    const assignment = getSchedulerPartitionAssignment(context, recommendation.partition_id, packId);
    if (assignment?.worker_id === recommendation.to_worker_id && assignment.status === 'assigned') {
      markRecommendationStatus(context, packId, {
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

    const migration = createSchedulerOwnershipMigration(context, {
      partitionId: recommendation.partition_id,
      toWorkerId: recommendation.to_worker_id ?? input.workerId,
      reason: `automatic_rebalance:${recommendation.reason}`,
      requestedByWorkerId: input.workerId
    }, packId);
    markRecommendationStatus(context, packId, {
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

export const evaluateSchedulerAutomaticRebalance = (
  context: AppContext,
  input?: {
    now?: bigint;
    maxRecommendations?: number;
    migrationBacklogLimit?: number;
  },
  packId?: string
): EvaluateSchedulerAutomaticRebalanceResult => {
  if (!packId) {
    throw new Error('[scheduler_rebalance] packId is required');
  }
  const adapter = requireAdapter(context);
  adapter.open(packId);

  const now = input?.now ?? context.clock.getCurrentTick();
  const config = getSchedulerAutomaticRebalanceConfig();
  const maxRecommendations = Math.max(input?.maxRecommendations ?? config.max_recommendations, 1);
  const migrationBacklogLimit = Math.max(
    input?.migrationBacklogLimit ?? config.backlog_limit,
    0
  );

  const workerStates = listSchedulerWorkerRuntimeStates(context, packId);
  const assignments = listSchedulerPartitionAssignments(context, packId);
  const migrationBacklogCount = adapter.countMigrationsInProgress(packId);

  const createdRecommendations: SchedulerRebalanceRecommendationRecord[] = [];
  const createdSuppressions: SchedulerRebalanceRecommendationRecord[] = [];

  if (migrationBacklogCount > migrationBacklogLimit) {
    const suppression = createRecommendation(context, packId, {
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

    const recommendation = createRecommendation(context, packId, {
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
        const recommendation = createRecommendation(context, packId, {
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
    const suppression = createRecommendation(context, packId, {
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
