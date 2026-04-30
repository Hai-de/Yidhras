/**
 * SchedulerStorageAdapter — per-pack scheduler data isolation.
 *
 * Each method accepts `packId` as its first parameter. Implementations store
 * scheduler lease / cursor / ownership / rebalance / observability data in
 * per-pack storage (e.g. the pack's runtime.sqlite).
 *
 * This interface mirrors SchedulerRepository but is pack-scoped.
 */
export interface SchedulerLeaseRecord {
  key: string;
  partition_id: string;
  holder: string;
  acquired_at: bigint;
  expires_at: bigint;
}

export interface SchedulerCursorRecord {
  key: string;
  partition_id: string;
  last_scanned_tick: bigint;
  last_signal_tick: bigint;
  updated_at: bigint;
}

export interface SchedulerPartitionRecord {
  partition_id: string;
  worker_id: string | null;
  status: string;
  version: number;
  source: string;
  updated_at: bigint;
}

export interface SchedulerWorkerStateRecord {
  worker_id: string;
  status: string;
  last_heartbeat_at: bigint;
  owned_partition_count: number;
  active_migration_count: number;
  capacity_hint: number | null;
  updated_at: bigint;
}

export interface SchedulerOwnershipMigrationRecord {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string;
  status: string;
  reason: string | null;
  details: unknown;
  created_at: bigint;
  updated_at: bigint;
  completed_at: bigint | null;
}

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

export interface SchedulerStorageAdapter {
  // -- Lifecycle --

  /** Open the scheduler storage for a pack. Creates tables via CREATE TABLE IF NOT EXISTS on first call. */
  open(packId: string): void;

  /** Close the database connection for a pack. */
  close(packId: string): void;

  /** Drop all scheduler tables from the pack's runtime database. */
  destroyPackSchedulerStorage(packId: string): void;

  /** Return the set of pack IDs that currently have an open scheduler storage connection. */
  listOpenPackIds(): string[];

  // -- Lease --

  upsertLease(
    packId: string,
    input: {
      key: string;
      partition_id: string;
      holder: string;
      acquired_at: bigint;
      expires_at: bigint;
      updated_at: bigint;
    }
  ): SchedulerLeaseRecord;

  getLease(packId: string, partitionId: string): SchedulerLeaseRecord | null;

  updateLeaseIfClaimable(
    packId: string,
    input: {
      partition_id: string;
      holder: string;
      acquired_at: bigint;
      expires_at: bigint;
      updated_at: bigint;
      key: string;
      now: bigint;
    }
  ): { count: number };

  deleteLeaseByHolder(packId: string, partitionId: string, holder: string): { count: number };

  // -- Cursor --

  upsertCursor(
    packId: string,
    input: {
      key: string;
      partition_id: string;
      last_scanned_tick: bigint;
      last_signal_tick: bigint;
      updated_at: bigint;
    }
  ): SchedulerCursorRecord;

  getCursor(packId: string, partitionId: string): SchedulerCursorRecord | null;

  // -- Partition Assignment --

  getPartition(packId: string, partitionId: string): SchedulerPartitionRecord | null;

  listPartitions(packId: string): SchedulerPartitionRecord[];

  createPartition(
    packId: string,
    input: {
      partition_id: string;
      worker_id: string | null;
      status: string;
      version: number;
      source: string;
      updated_at: bigint;
    }
  ): SchedulerPartitionRecord;

  updatePartition(
    packId: string,
    input: {
      partition_id: string;
      worker_id?: string | null;
      status?: string;
      version?: number;
      source?: string;
      updated_at: bigint;
    }
  ): SchedulerPartitionRecord;

  // -- Ownership Migration --

  listMigrations(packId: string, limit?: number): SchedulerOwnershipMigrationRecord[];

  countMigrationsInProgress(packId: string, workerId?: string): number;

  getMigrationById(packId: string, migrationId: string): SchedulerOwnershipMigrationRecord | null;

  findLatestActiveMigrationForPartition(
    packId: string,
    partitionId: string,
    toWorkerId: string
  ): SchedulerOwnershipMigrationRecord | null;

  createMigration(
    packId: string,
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
  ): SchedulerOwnershipMigrationRecord;

  updateMigration(
    packId: string,
    input: {
      id: string;
      status?: string;
      updated_at: bigint;
      completed_at?: bigint | null;
    }
  ): SchedulerOwnershipMigrationRecord;

  // -- Worker Runtime State --

  listWorkerStates(packId: string): SchedulerWorkerStateRecord[];

  getWorkerState(packId: string, workerId: string): SchedulerWorkerStateRecord | null;

  upsertWorkerState(
    packId: string,
    input: {
      worker_id: string;
      status: string;
      last_heartbeat_at: bigint;
      owned_partition_count: number;
      active_migration_count: number;
      capacity_hint: number | null;
      updated_at: bigint;
    }
  ): SchedulerWorkerStateRecord;

  updateWorkerStatus(
    packId: string,
    workerId: string,
    status: string,
    updatedAt: bigint
  ): SchedulerWorkerStateRecord;

  // -- Rebalance Recommendation --

  findOpenRecommendation(
    packId: string,
    input: {
      partition_id: string;
      status: 'recommended' | 'suppressed';
      reason: string;
      from_worker_id: string | null;
      to_worker_id: string | null;
      suppress_reason: string | null;
    }
  ): SchedulerRebalanceRecommendationRecord | null;

  createRecommendation(
    packId: string,
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
  ): SchedulerRebalanceRecommendationRecord;

  listRecentRecommendations(packId: string, limit?: number): SchedulerRebalanceRecommendationRecord[];

  getRecommendationById(packId: string, id: string): SchedulerRebalanceRecommendationRecord | null;

  updateRecommendation(
    packId: string,
    input: {
      id: string;
      status: 'applied' | 'superseded';
      updated_at: bigint;
      applied_migration_id?: string | null;
      details: unknown;
    }
  ): SchedulerRebalanceRecommendationRecord;

  listPendingRecommendationsForWorker(
    packId: string,
    workerId: string,
    maxApply: number
  ): SchedulerRebalanceRecommendationRecord[];

  // -- Observability --

  writeDetailedSnapshot(
    packId: string,
    input: {
      id: string;
      worker_id: string;
      partition_id: string;
      lease_holder: string | null;
      lease_expires_at_snapshot: bigint | null;
      tick: bigint;
      summary: Record<string, unknown>;
      started_at: bigint;
      finished_at: bigint;
      created_at: bigint;
    }
  ): Record<string, unknown>;

  writeCandidateDecision(
    packId: string,
    schedulerRunId: string,
    input: {
      id: string;
      partition_id: string;
      actor_id: string;
      kind: string;
      candidate_reasons: unknown;
      chosen_reason: string;
      scheduled_for_tick: bigint;
      priority_score: number;
      skipped_reason: string | null;
      created_job_id: string | null;
      created_at: bigint;
    }
  ): Record<string, unknown>;

  listRuns(
    packId: string,
    input: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
      cursor?: Record<string, unknown>;
      skip?: number;
    }
  ): Record<string, unknown>[];

  listCandidateDecisions(
    packId: string,
    input: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
      cursor?: Record<string, unknown>;
      skip?: number;
    }
  ): Record<string, unknown>[];

  getAgentDecisions(packId: string, actorId: string, limit?: number): Record<string, unknown>[];
}
