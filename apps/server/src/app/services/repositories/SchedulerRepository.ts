import type { PrismaClient } from '@prisma/client';

import type { AppContext } from '../../context.js';
import {
  deleteSchedulerLeaseRecordByHolder,
  getSchedulerCursorRecord,
  getSchedulerLeaseRecord,
  updateSchedulerLeaseRecordIfClaimable,
  upsertSchedulerCursorRecord,
  upsertSchedulerLeaseRecord
} from '../../runtime/scheduler_lease_repository.js';
import {
  countSchedulerOwnershipMigrationsInProgress,
  createSchedulerOwnershipMigrationRecord,
  createSchedulerPartitionAssignmentRecord,
  findLatestActiveSchedulerOwnershipMigrationForPartition,
  getSchedulerOwnershipMigrationRecordById,
  getSchedulerPartitionAssignmentRecord,
  getSchedulerWorkerRuntimeStateRecord,
  listSchedulerOwnershipMigrationRecords,
  listSchedulerPartitionAssignmentRecords,
  listSchedulerWorkerRuntimeStateRecords,
  updateSchedulerOwnershipMigrationRecord,
  updateSchedulerPartitionAssignmentRecord,
  updateSchedulerWorkerRuntimeStatus,
  upsertSchedulerWorkerRuntimeStateRecord
} from '../../runtime/scheduler_ownership_repository.js';
import {
  createSchedulerRebalanceRecommendationRecord,
  findOpenSchedulerRebalanceRecommendation,
  getSchedulerRebalanceRecommendationRecordById,
  listPendingSchedulerRebalanceRecommendationsForWorker,
  listRecentSchedulerRebalanceRecommendationRecords,
  updateSchedulerRebalanceRecommendationRecord
} from '../../runtime/scheduler_rebalance_repository.js';

// Return types matching what the existing repo functions produce.
// These are structural subsets that callers depend on.
type LeaseRecord = { key: string; partition_id: string; holder: string; acquired_at: bigint; expires_at: bigint };
type LeaseUpsertResult = LeaseRecord & Record<string, unknown>;
type LeaseUpdateResult = { count: number };
type CursorRecord = { partition_id: string; last_scanned_tick: bigint; last_signal_tick: bigint; key?: string };
type PartitionRecord = { partition_id: string; worker_id: string | null; status: string; version: number; source: string; updated_at: bigint };
type WorkerState = { worker_id: string; status: string; last_heartbeat_at: bigint; owned_partition_count: number; active_migration_count: number; capacity_hint: number | null; updated_at: bigint };
type MigrationRecord = { id: string; partition_id: string; from_worker_id: string | null; to_worker_id: string; status: string; reason: string | null; details: unknown; created_at: bigint; updated_at: bigint; completed_at: bigint | null };
type RecommendationRecord = { id: string; partition_id: string; from_worker_id: string | null; to_worker_id: string | null; status: string; reason: string; score: number | null; suppress_reason: string | null; details: unknown; created_at: bigint; updated_at: bigint; applied_migration_id: string | null };

export interface SchedulerRepository {
  // Lease
  upsertLease(input: { key: string; partition_id: string; holder: string; acquired_at: bigint; expires_at: bigint; updated_at: bigint }): Promise<LeaseUpsertResult>;
  updateLeaseIfClaimable(input: { partition_id: string; holder: string; acquired_at: bigint; expires_at: bigint; updated_at: bigint; key: string; now: bigint }): Promise<LeaseUpdateResult>;
  getLease(partitionId: string): Promise<LeaseRecord | null>;
  deleteLeaseByHolder(partitionId: string, holder: string): Promise<{ count: number }>;

  // Cursor
  upsertCursor(input: { key: string; partition_id: string; last_scanned_tick: bigint; last_signal_tick: bigint; updated_at: bigint }): Promise<CursorRecord>;
  getCursor(partitionId: string): Promise<CursorRecord | null>;

  // PartitionAssignment
  getPartition(partitionId: string): Promise<PartitionRecord | null>;
  listPartitions(): Promise<PartitionRecord[]>;
  createPartition(input: { partition_id: string; worker_id: string | null; status: string; version: number; source: string; updated_at: bigint }): Promise<PartitionRecord>;
  updatePartition(input: { partition_id: string; worker_id?: string | null; status?: string; version?: number; source?: string; updated_at: bigint }): Promise<PartitionRecord>;

  // OwnershipMigration
  listMigrations(limit?: number): Promise<MigrationRecord[]>;
  countMigrationsInProgress(workerId?: string): Promise<number>;
  getMigrationById(migrationId: string): Promise<MigrationRecord | null>;
  findLatestActiveMigrationForPartition(partitionId: string, toWorkerId: string): Promise<MigrationRecord | null>;
  createMigration(input: { partition_id: string; from_worker_id: string | null; to_worker_id: string; status: string; reason: string | null; details: Record<string, unknown>; created_at: bigint; updated_at: bigint; completed_at: bigint | null }): Promise<MigrationRecord>;
  updateMigration(input: { id: string; status?: string; updated_at: bigint; completed_at?: bigint | null }): Promise<MigrationRecord>;

  // WorkerRuntimeState
  listWorkerStates(): Promise<WorkerState[]>;
  getWorkerState(workerId: string): Promise<WorkerState | null>;
  upsertWorkerState(input: { worker_id: string; status: string; last_heartbeat_at: bigint; owned_partition_count: number; active_migration_count: number; capacity_hint: number | null; updated_at: bigint }): Promise<WorkerState>;
  updateWorkerStatus(workerId: string, status: string, updatedAt: bigint): Promise<WorkerState>;

  // RebalanceRecommendation
  findOpenRecommendation(input: { partition_id: string; status: 'recommended' | 'suppressed'; reason: string; from_worker_id: string | null; to_worker_id: string | null; suppress_reason: string | null }): Promise<RecommendationRecord | null>;
  createRecommendation(input: { partition_id: string; from_worker_id: string | null; to_worker_id: string | null; status: string; reason: string; score?: number | null; suppress_reason?: string | null; details?: Record<string, unknown>; created_at: bigint; updated_at: bigint; applied_migration_id?: string | null }): Promise<RecommendationRecord>;
  listRecentRecommendations(limit?: number): Promise<RecommendationRecord[]>;
  getRecommendationById(id: string): Promise<RecommendationRecord | null>;
  updateRecommendation(input: { id: string; status: 'applied' | 'superseded'; updated_at: bigint; applied_migration_id?: string | null; details: unknown }): Promise<RecommendationRecord>;
  listPendingRecommendationsForWorker(workerId: string, maxApply: number): Promise<RecommendationRecord[]>;

  // SchedulerRun / CandidateDecision
  createSchedulerRun(input: Record<string, unknown>): Promise<unknown>;
  findSchedulerRunById(id: string): Promise<unknown>;
  findLatestSchedulerRun(): Promise<unknown>;
  listSchedulerRuns(input: Record<string, unknown>): Promise<unknown>;
  listCandidateDecisions(input: Record<string, unknown>): Promise<unknown>;
  getAgentDecisions(actorId: string, limit?: number): Promise<unknown>;
  findDecisionJobsByIds(ids: string[]): Promise<unknown>;
  getPrisma(): PrismaClient;
}

export class PrismaSchedulerRepository implements SchedulerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private ctx(): AppContext {
    return { prisma: this.prisma } as AppContext;
  }

  async upsertLease(input: { key: string; partition_id: string; holder: string; acquired_at: bigint; expires_at: bigint; updated_at: bigint }): Promise<LeaseUpsertResult> {
    return upsertSchedulerLeaseRecord(this.ctx(), input) as Promise<LeaseUpsertResult>;
  }

  async updateLeaseIfClaimable(input: { partition_id: string; holder: string; acquired_at: bigint; expires_at: bigint; updated_at: bigint; key: string; now: bigint }): Promise<LeaseUpdateResult> {
    return updateSchedulerLeaseRecordIfClaimable(this.ctx(), input) as Promise<LeaseUpdateResult>;
  }

  async getLease(partitionId: string): Promise<LeaseRecord | null> {
    return getSchedulerLeaseRecord(this.ctx(), partitionId) as Promise<LeaseRecord | null>;
  }

  async deleteLeaseByHolder(partitionId: string, holder: string): Promise<{ count: number }> {
    return deleteSchedulerLeaseRecordByHolder(this.ctx(), { partition_id: partitionId, holder }) as Promise<{ count: number }>;
  }

  async upsertCursor(input: { key: string; partition_id: string; last_scanned_tick: bigint; last_signal_tick: bigint; updated_at: bigint }): Promise<CursorRecord> {
    return upsertSchedulerCursorRecord(this.ctx(), input) as Promise<CursorRecord>;
  }

  async getCursor(partitionId: string): Promise<CursorRecord | null> {
    return getSchedulerCursorRecord(this.ctx(), partitionId) as Promise<CursorRecord | null>;
  }

  async getPartition(partitionId: string): Promise<PartitionRecord | null> {
    return getSchedulerPartitionAssignmentRecord(this.ctx(), partitionId) as Promise<PartitionRecord | null>;
  }

  async listPartitions(): Promise<PartitionRecord[]> {
    return listSchedulerPartitionAssignmentRecords(this.ctx()) as Promise<PartitionRecord[]>;
  }

  async createPartition(input: { partition_id: string; worker_id: string | null; status: string; version: number; source: string; updated_at: bigint }): Promise<PartitionRecord> {
    return createSchedulerPartitionAssignmentRecord(this.ctx(), input) as Promise<PartitionRecord>;
  }

  async updatePartition(input: { partition_id: string; worker_id?: string | null; status?: string; version?: number; source?: string; updated_at: bigint }): Promise<PartitionRecord> {
    return updateSchedulerPartitionAssignmentRecord(this.ctx(), input) as Promise<PartitionRecord>;
  }

  async listMigrations(limit?: number): Promise<MigrationRecord[]> {
    return listSchedulerOwnershipMigrationRecords(this.ctx(), limit) as Promise<MigrationRecord[]>;
  }

  async countMigrationsInProgress(workerId?: string): Promise<number> {
    return countSchedulerOwnershipMigrationsInProgress(this.ctx(), workerId);
  }

  async getMigrationById(migrationId: string): Promise<MigrationRecord | null> {
    return getSchedulerOwnershipMigrationRecordById(this.ctx(), migrationId) as Promise<MigrationRecord | null>;
  }

  async findLatestActiveMigrationForPartition(partitionId: string, toWorkerId: string): Promise<MigrationRecord | null> {
    return findLatestActiveSchedulerOwnershipMigrationForPartition(this.ctx(), { partition_id: partitionId, to_worker_id: toWorkerId }) as Promise<MigrationRecord | null>;
  }

  async createMigration(input: { partition_id: string; from_worker_id: string | null; to_worker_id: string; status: string; reason: string | null; details: Record<string, unknown>; created_at: bigint; updated_at: bigint; completed_at: bigint | null }): Promise<MigrationRecord> {
    return createSchedulerOwnershipMigrationRecord(this.ctx(), input) as Promise<MigrationRecord>;
  }

  async updateMigration(input: { id: string; status?: string; updated_at: bigint; completed_at?: bigint | null }): Promise<MigrationRecord> {
    return updateSchedulerOwnershipMigrationRecord(this.ctx(), input) as Promise<MigrationRecord>;
  }

  async listWorkerStates(): Promise<WorkerState[]> {
    return listSchedulerWorkerRuntimeStateRecords(this.ctx()) as Promise<WorkerState[]>;
  }

  async getWorkerState(workerId: string): Promise<WorkerState | null> {
    return getSchedulerWorkerRuntimeStateRecord(this.ctx(), workerId) as Promise<WorkerState | null>;
  }

  async upsertWorkerState(input: { worker_id: string; status: string; last_heartbeat_at: bigint; owned_partition_count: number; active_migration_count: number; capacity_hint: number | null; updated_at: bigint }): Promise<WorkerState> {
    return upsertSchedulerWorkerRuntimeStateRecord(this.ctx(), input) as Promise<WorkerState>;
  }

  async updateWorkerStatus(workerId: string, status: string, updatedAt: bigint): Promise<WorkerState> {
    return updateSchedulerWorkerRuntimeStatus(this.ctx(), { worker_id: workerId, status, updated_at: updatedAt }) as Promise<WorkerState>;
  }

  async findOpenRecommendation(input: { partition_id: string; status: 'recommended' | 'suppressed'; reason: string; from_worker_id: string | null; to_worker_id: string | null; suppress_reason: string | null }): Promise<RecommendationRecord | null> {
    return findOpenSchedulerRebalanceRecommendation(this.ctx(), input) as Promise<RecommendationRecord | null>;
  }

  async createRecommendation(input: { partition_id: string; from_worker_id: string | null; to_worker_id: string | null; status: string; reason: string; score?: number | null; suppress_reason?: string | null; details?: Record<string, unknown>; created_at: bigint; updated_at: bigint; applied_migration_id?: string | null }): Promise<RecommendationRecord> {
    return createSchedulerRebalanceRecommendationRecord(this.ctx(), input) as Promise<RecommendationRecord>;
  }

  async listRecentRecommendations(limit?: number): Promise<RecommendationRecord[]> {
    return listRecentSchedulerRebalanceRecommendationRecords(this.ctx(), limit) as Promise<RecommendationRecord[]>;
  }

  async getRecommendationById(id: string): Promise<RecommendationRecord | null> {
    return getSchedulerRebalanceRecommendationRecordById(this.ctx(), id) as Promise<RecommendationRecord | null>;
  }

  async updateRecommendation(input: { id: string; status: 'applied' | 'superseded'; updated_at: bigint; applied_migration_id?: string | null; details: unknown }): Promise<RecommendationRecord> {
    return updateSchedulerRebalanceRecommendationRecord(this.ctx(), input as { id: string; status: 'applied' | 'superseded'; updated_at: bigint; applied_migration_id?: string | null; details: import('@prisma/client').Prisma.InputJsonValue }) as Promise<RecommendationRecord>;
  }

  async listPendingRecommendationsForWorker(workerId: string, maxApply: number): Promise<RecommendationRecord[]> {
    return listPendingSchedulerRebalanceRecommendationsForWorker(this.ctx(), { worker_id: workerId, max_apply: maxApply }) as Promise<RecommendationRecord[]>;
  }

  async createSchedulerRun(input: Record<string, unknown>): Promise<unknown> {
    return this.prisma.schedulerRun.create({ data: input as never });
  }

  async findSchedulerRunById(id: string): Promise<unknown> {
    return this.prisma.schedulerRun.findUnique({ where: { id } });
  }

  async findLatestSchedulerRun(): Promise<unknown> {
    return this.prisma.schedulerRun.findFirst({
      include: { candidate_decisions: { orderBy: { created_at: 'asc' as never } } },
      orderBy: { created_at: 'desc' }
    });
  }

  async listSchedulerRuns(input: Record<string, unknown>): Promise<unknown> {
    const { where, orderBy, take, cursor, skip } = input as {
      where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number; cursor?: Record<string, unknown>; skip?: number;
    };
    return this.prisma.schedulerRun.findMany({ where: where as never, orderBy: orderBy as never, take, cursor: cursor as never, skip });
  }

  async listCandidateDecisions(input: Record<string, unknown>): Promise<unknown> {
    const { where, orderBy, take, cursor, skip } = input as {
      where?: Record<string, unknown>; orderBy?: Record<string, unknown>; take?: number; cursor?: Record<string, unknown>; skip?: number;
    };
    return this.prisma.schedulerCandidateDecision.findMany({ where: where as never, orderBy: orderBy as never, take, cursor: cursor as never, skip });
  }

  async getAgentDecisions(actorId: string, limit?: number): Promise<unknown> {
    return this.prisma.schedulerCandidateDecision.findMany({ where: { actor_id: actorId }, orderBy: { created_at: 'desc' }, take: limit ?? 20 });
  }

  async findDecisionJobsByIds(ids: string[]): Promise<unknown> {
    return this.prisma.decisionJob.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, intent_class: true, created_at: true, completed_at: true } });
  }

  getPrisma(): PrismaClient { return this.prisma; }
}
