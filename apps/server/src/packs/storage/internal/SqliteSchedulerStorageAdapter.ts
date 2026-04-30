import { DatabaseSync } from 'node:sqlite';

import { resolvePackRuntimeDatabaseLocation } from '../pack_db_locator.js';
import type {
  SchedulerCursorRecord,
  SchedulerLeaseRecord,
  SchedulerOwnershipMigrationRecord,
  SchedulerPartitionRecord,
  SchedulerRebalanceRecommendationRecord,
  SchedulerStorageAdapter,
  SchedulerWorkerStateRecord
} from '../SchedulerStorageAdapter.js';

// ---------------------------------------------------------------------------
// SQLite helpers
// ---------------------------------------------------------------------------

type SqlitePrimitive = string | number | bigint | null;

const toSqliteParam = (value: unknown): SqlitePrimitive => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return value;
  }
  return JSON.stringify(value);
};

const jsonStringify = (value: unknown): string => {
  return JSON.stringify(value);
};

const jsonParse = (value: string | null | undefined): unknown => {
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const SCHEDULER_DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS scheduler_lease (
    key TEXT PRIMARY KEY,
    partition_id TEXT NOT NULL UNIQUE,
    holder TEXT NOT NULL,
    acquired_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_lease_partition_expires
     ON scheduler_lease (partition_id, expires_at)`,

  `CREATE TABLE IF NOT EXISTS scheduler_cursor (
    key TEXT PRIMARY KEY,
    partition_id TEXT NOT NULL UNIQUE,
    last_scanned_tick INTEGER NOT NULL,
    last_signal_tick INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS scheduler_partition_assignment (
    partition_id TEXT PRIMARY KEY,
    worker_id TEXT,
    status TEXT NOT NULL DEFAULT 'released',
    version INTEGER NOT NULL DEFAULT 1,
    source TEXT NOT NULL DEFAULT 'bootstrap',
    updated_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_partition_assignment_worker
     ON scheduler_partition_assignment (worker_id, updated_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_partition_assignment_status
     ON scheduler_partition_assignment (status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS scheduler_ownership_migration_log (
    id TEXT PRIMARY KEY,
    partition_id TEXT NOT NULL,
    from_worker_id TEXT,
    to_worker_id TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    details TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_ownership_migration_partition
     ON scheduler_ownership_migration_log (partition_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_ownership_migration_to_worker
     ON scheduler_ownership_migration_log (to_worker_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_ownership_migration_status
     ON scheduler_ownership_migration_log (status, created_at)`,

  `CREATE TABLE IF NOT EXISTS scheduler_worker_runtime_state (
    worker_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active',
    last_heartbeat_at INTEGER NOT NULL,
    owned_partition_count INTEGER NOT NULL DEFAULT 0,
    active_migration_count INTEGER NOT NULL DEFAULT 0,
    capacity_hint INTEGER,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_worker_runtime_state_status
     ON scheduler_worker_runtime_state (status, updated_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_worker_runtime_state_heartbeat
     ON scheduler_worker_runtime_state (last_heartbeat_at)`,

  `CREATE TABLE IF NOT EXISTS scheduler_rebalance_recommendation (
    id TEXT PRIMARY KEY,
    partition_id TEXT NOT NULL,
    from_worker_id TEXT,
    to_worker_id TEXT,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    score REAL,
    suppress_reason TEXT,
    details TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    applied_migration_id TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_rebalance_recommendation_status
     ON scheduler_rebalance_recommendation (status, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_rebalance_recommendation_partition
     ON scheduler_rebalance_recommendation (partition_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS scheduler_run (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL,
    partition_id TEXT NOT NULL DEFAULT 'p0',
    lease_holder TEXT,
    lease_expires_at_snapshot INTEGER,
    tick INTEGER NOT NULL,
    summary TEXT NOT NULL DEFAULT '{}',
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_run_tick
     ON scheduler_run (tick, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_run_partition
     ON scheduler_run (partition_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS scheduler_candidate_decision (
    id TEXT PRIMARY KEY,
    scheduler_run_id TEXT NOT NULL,
    partition_id TEXT NOT NULL DEFAULT 'p0',
    actor_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    candidate_reasons TEXT NOT NULL DEFAULT '[]',
    chosen_reason TEXT NOT NULL,
    scheduled_for_tick INTEGER NOT NULL,
    priority_score INTEGER NOT NULL,
    skipped_reason TEXT,
    created_job_id TEXT,
    created_at INTEGER NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_candidate_decision_run
     ON scheduler_candidate_decision (scheduler_run_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_candidate_decision_actor
     ON scheduler_candidate_decision (actor_id, created_at)`,

  `CREATE INDEX IF NOT EXISTS idx_scheduler_candidate_decision_partition
     ON scheduler_candidate_decision (partition_id, created_at)`
];

const DROP_STATEMENTS = [
  'DROP TABLE IF EXISTS scheduler_candidate_decision',
  'DROP TABLE IF EXISTS scheduler_run',
  'DROP TABLE IF EXISTS scheduler_rebalance_recommendation',
  'DROP TABLE IF EXISTS scheduler_worker_runtime_state',
  'DROP TABLE IF EXISTS scheduler_ownership_migration_log',
  'DROP TABLE IF EXISTS scheduler_partition_assignment',
  'DROP TABLE IF EXISTS scheduler_cursor',
  'DROP TABLE IF EXISTS scheduler_lease'
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SqliteSchedulerStorageAdapter implements SchedulerStorageAdapter {
  private readonly connections = new Map<string, DatabaseSync>();

  // -- Lifecycle --

  public open(packId: string): void {
    if (this.connections.has(packId)) {
      return;
    }

    const location = resolvePackRuntimeDatabaseLocation(packId);
    const db = new DatabaseSync(location.runtimeDbPath);

    for (const statement of SCHEDULER_DDL_STATEMENTS) {
      db.prepare(statement).run();
    }

    this.connections.set(packId, db);
  }

  public close(packId: string): void {
    const db = this.connections.get(packId);
    if (!db) {
      return;
    }
    db.close();
    this.connections.delete(packId);
  }

  public listOpenPackIds(): string[] {
    return Array.from(this.connections.keys());
  }

  public destroyPackSchedulerStorage(packId: string): void {
    const db = this.connections.get(packId);
    if (db) {
      for (const statement of DROP_STATEMENTS) {
        db.prepare(statement).run();
      }
    } else {
      const location = resolvePackRuntimeDatabaseLocation(packId);
      const tempDb = new DatabaseSync(location.runtimeDbPath);
      try {
        for (const statement of DROP_STATEMENTS) {
          tempDb.prepare(statement).run();
        }
      } finally {
        tempDb.close();
      }
    }
  }

  // -- Lease --

  public upsertLease(
    packId: string,
    input: {
      key: string;
      partition_id: string;
      holder: string;
      acquired_at: bigint;
      expires_at: bigint;
      updated_at: bigint;
    }
  ): SchedulerLeaseRecord {
    const db = this.getDb(packId);
    const stmt = db.prepare(
      `INSERT INTO scheduler_lease (key, partition_id, holder, acquired_at, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(partition_id) DO UPDATE SET
         key = excluded.key,
         holder = excluded.holder,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`
    );
    stmt.run(
      input.key,
      input.partition_id,
      input.holder,
      Number(input.acquired_at),
      Number(input.expires_at),
      Number(input.updated_at)
    );
    return input as SchedulerLeaseRecord;
  }

  public getLease(packId: string, partitionId: string): SchedulerLeaseRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare('SELECT * FROM scheduler_lease WHERE partition_id = ?').get(partitionId);
    if (!row) {
      return null;
    }
    return this.toLeaseRecord(row);
  }

  public updateLeaseIfClaimable(
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
  ): { count: number } {
    const db = this.getDb(packId);
    const result = db.prepare(
      `UPDATE scheduler_lease
       SET key = ?,
           holder = ?,
           acquired_at = ?,
           expires_at = ?,
           updated_at = ?
       WHERE partition_id = ?
         AND (holder = ? OR expires_at <= ?)`
    ).run(
      input.key,
      input.holder,
      Number(input.acquired_at),
      Number(input.expires_at),
      Number(input.updated_at),
      input.partition_id,
      input.holder,
      Number(input.now)
    ) as { changes: number };
    return { count: Number(result.changes) };
  }

  public deleteLeaseByHolder(packId: string, partitionId: string, holder: string): { count: number } {
    const db = this.getDb(packId);
    const result = db.prepare(
      'DELETE FROM scheduler_lease WHERE partition_id = ? AND holder = ?'
    ).run(partitionId, holder) as { changes: number };
    return { count: Number(result.changes) };
  }

  // -- Cursor --

  public upsertCursor(
    packId: string,
    input: {
      key: string;
      partition_id: string;
      last_scanned_tick: bigint;
      last_signal_tick: bigint;
      updated_at: bigint;
    }
  ): SchedulerCursorRecord {
    const db = this.getDb(packId);
    db.prepare(
      `INSERT INTO scheduler_cursor (key, partition_id, last_scanned_tick, last_signal_tick, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(partition_id) DO UPDATE SET
         key = excluded.key,
         last_scanned_tick = excluded.last_scanned_tick,
         last_signal_tick = excluded.last_signal_tick,
         updated_at = excluded.updated_at`
    ).run(
      input.key,
      input.partition_id,
      Number(input.last_scanned_tick),
      Number(input.last_signal_tick),
      Number(input.updated_at)
    );
    return { ...input };
  }

  public getCursor(packId: string, partitionId: string): SchedulerCursorRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare('SELECT * FROM scheduler_cursor WHERE partition_id = ?').get(partitionId);
    if (!row) {
      return null;
    }
    return this.toCursorRecord(row);
  }

  // -- Partition Assignment --

  public getPartition(packId: string, partitionId: string): SchedulerPartitionRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare('SELECT * FROM scheduler_partition_assignment WHERE partition_id = ?').get(partitionId);
    if (!row) {
      return null;
    }
    return this.toPartitionRecord(row);
  }

  public listPartitions(packId: string): SchedulerPartitionRecord[] {
    const db = this.getDb(packId);
    const rows = db.prepare('SELECT * FROM scheduler_partition_assignment').all();
    return rows.map(row => this.toPartitionRecord(row));
  }

  public createPartition(
    packId: string,
    input: {
      partition_id: string;
      worker_id: string | null;
      status: string;
      version: number;
      source: string;
      updated_at: bigint;
    }
  ): SchedulerPartitionRecord {
    const db = this.getDb(packId);
    db.prepare(
      `INSERT INTO scheduler_partition_assignment (partition_id, worker_id, status, version, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      input.partition_id,
      input.worker_id,
      input.status,
      input.version,
      input.source,
      Number(input.updated_at)
    );
    return input as SchedulerPartitionRecord;
  }

  public updatePartition(
    packId: string,
    input: {
      partition_id: string;
      worker_id?: string | null;
      status?: string;
      version?: number;
      source?: string;
      updated_at: bigint;
    }
  ): SchedulerPartitionRecord {
    const db = this.getDb(packId);
    const existing = this.getPartition(packId, input.partition_id);
    if (!existing) {
      throw new Error(`[SqliteSchedulerStorageAdapter] partition not found: ${input.partition_id}`);
    }

    const workerId = input.worker_id !== undefined ? input.worker_id : existing.worker_id;
    const status = input.status ?? existing.status;
    const version = input.version ?? existing.version;
    const source = input.source ?? existing.source;

    db.prepare(
      `UPDATE scheduler_partition_assignment
       SET worker_id = ?, status = ?, version = ?, source = ?, updated_at = ?
       WHERE partition_id = ?`
    ).run(workerId, status, version, source, Number(input.updated_at), input.partition_id);

    return {
      partition_id: input.partition_id,
      worker_id: workerId,
      status,
      version,
      source,
      updated_at: input.updated_at
    };
  }

  // -- Ownership Migration --

  public listMigrations(packId: string, limit?: number): SchedulerOwnershipMigrationRecord[] {
    const db = this.getDb(packId);
    const sql = limit !== undefined
      ? 'SELECT * FROM scheduler_ownership_migration_log ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM scheduler_ownership_migration_log ORDER BY created_at DESC';
    const rows = limit !== undefined
      ? db.prepare(sql).all(limit)
      : db.prepare(sql).all();
    return rows.map(row => this.toMigrationRecord(row));
  }

  public countMigrationsInProgress(packId: string, workerId?: string): number {
    const db = this.getDb(packId);
    if (workerId !== undefined) {
      const row = db.prepare(
        `SELECT COUNT(*) as cnt FROM scheduler_ownership_migration_log
         WHERE status IN ('requested', 'in_progress') AND to_worker_id = ?`
      ).get(workerId) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    }

    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM scheduler_ownership_migration_log
       WHERE status IN ('requested', 'in_progress')`
    ).get() as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  }

  public getMigrationById(packId: string, migrationId: string): SchedulerOwnershipMigrationRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare('SELECT * FROM scheduler_ownership_migration_log WHERE id = ?').get(migrationId);
    if (!row) {
      return null;
    }
    return this.toMigrationRecord(row);
  }

  public findLatestActiveMigrationForPartition(
    packId: string,
    partitionId: string,
    toWorkerId: string
  ): SchedulerOwnershipMigrationRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare(
      `SELECT * FROM scheduler_ownership_migration_log
       WHERE partition_id = ? AND to_worker_id = ? AND status IN ('requested', 'in_progress')
       ORDER BY created_at DESC LIMIT 1`
    ).get(partitionId, toWorkerId);
    if (!row) {
      return null;
    }
    return this.toMigrationRecord(row);
  }

  public createMigration(
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
  ): SchedulerOwnershipMigrationRecord {
    const db = this.getDb(packId);
    const id = input.partition_id + '_' + Number(input.created_at).toString();
    db.prepare(
      `INSERT INTO scheduler_ownership_migration_log
       (id, partition_id, from_worker_id, to_worker_id, status, reason, details, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.partition_id,
      input.from_worker_id,
      input.to_worker_id,
      input.status,
      input.reason,
      jsonStringify(input.details),
      Number(input.created_at),
      Number(input.updated_at),
      input.completed_at !== null ? Number(input.completed_at) : null
    );
    return {
      id,
      ...input
    };
  }

  public updateMigration(
    packId: string,
    input: {
      id: string;
      status?: string;
      updated_at: bigint;
      completed_at?: bigint | null;
    }
  ): SchedulerOwnershipMigrationRecord {
    const db = this.getDb(packId);
    if (input.status !== undefined && input.completed_at !== undefined) {
      db.prepare(
        `UPDATE scheduler_ownership_migration_log SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?`
      ).run(input.status, input.completed_at !== null ? Number(input.completed_at) : null, Number(input.updated_at), input.id);
    } else if (input.status !== undefined) {
      db.prepare(
        `UPDATE scheduler_ownership_migration_log SET status = ?, updated_at = ? WHERE id = ?`
      ).run(input.status, Number(input.updated_at), input.id);
    } else {
      db.prepare(
        `UPDATE scheduler_ownership_migration_log SET updated_at = ? WHERE id = ?`
      ).run(Number(input.updated_at), input.id);
    }

    const record = this.getMigrationById(packId, input.id);
    if (!record) {
      throw new Error(`[SqliteSchedulerStorageAdapter] migration not found after update: ${input.id}`);
    }
    return record;
  }

  // -- Worker Runtime State --

  public listWorkerStates(packId: string): SchedulerWorkerStateRecord[] {
    const db = this.getDb(packId);
    const rows = db.prepare('SELECT * FROM scheduler_worker_runtime_state').all();
    return rows.map(row => this.toWorkerStateRecord(row));
  }

  public getWorkerState(packId: string, workerId: string): SchedulerWorkerStateRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare('SELECT * FROM scheduler_worker_runtime_state WHERE worker_id = ?').get(workerId);
    if (!row) {
      return null;
    }
    return this.toWorkerStateRecord(row);
  }

  public upsertWorkerState(
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
  ): SchedulerWorkerStateRecord {
    const db = this.getDb(packId);
    db.prepare(
      `INSERT INTO scheduler_worker_runtime_state
       (worker_id, status, last_heartbeat_at, owned_partition_count, active_migration_count, capacity_hint, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(worker_id) DO UPDATE SET
         status = excluded.status,
         last_heartbeat_at = excluded.last_heartbeat_at,
         owned_partition_count = excluded.owned_partition_count,
         active_migration_count = excluded.active_migration_count,
         capacity_hint = excluded.capacity_hint,
         updated_at = excluded.updated_at`
    ).run(
      input.worker_id,
      input.status,
      Number(input.last_heartbeat_at),
      input.owned_partition_count,
      input.active_migration_count,
      input.capacity_hint,
      Number(input.updated_at)
    );
    return { ...input };
  }

  public updateWorkerStatus(
    packId: string,
    workerId: string,
    status: string,
    updatedAt: bigint
  ): SchedulerWorkerStateRecord {
    const db = this.getDb(packId);
    db.prepare(
      'UPDATE scheduler_worker_runtime_state SET status = ?, updated_at = ? WHERE worker_id = ?'
    ).run(status, Number(updatedAt), workerId);

    const record = this.getWorkerState(packId, workerId);
    if (!record) {
      throw new Error(`[SqliteSchedulerStorageAdapter] worker not found after update: ${workerId}`);
    }
    return record;
  }

  // -- Rebalance Recommendation --

  public findOpenRecommendation(
    packId: string,
    input: {
      partition_id: string;
      status: 'recommended' | 'suppressed';
      reason: string;
      from_worker_id: string | null;
      to_worker_id: string | null;
      suppress_reason: string | null;
    }
  ): SchedulerRebalanceRecommendationRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare(
      `SELECT * FROM scheduler_rebalance_recommendation
       WHERE partition_id = ? AND status = ? AND reason = ?
         AND (from_worker_id = ? OR (from_worker_id IS NULL AND ? IS NULL))
         AND (to_worker_id = ? OR (to_worker_id IS NULL AND ? IS NULL))
         AND applied_migration_id IS NULL
       LIMIT 1`
    ).get(
      input.partition_id,
      input.status,
      input.reason,
      input.from_worker_id, input.from_worker_id,
      input.to_worker_id, input.to_worker_id
    );
    if (!row) {
      return null;
    }
    return this.toRecommendationRecord(row);
  }

  public createRecommendation(
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
  ): SchedulerRebalanceRecommendationRecord {
    const db = this.getDb(packId);
    const id = `rec_${input.partition_id}_${Number(input.created_at).toString()}`;
    db.prepare(
      `INSERT INTO scheduler_rebalance_recommendation
       (id, partition_id, from_worker_id, to_worker_id, status, reason, score, suppress_reason, details, created_at, updated_at, applied_migration_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.partition_id,
      input.from_worker_id,
      input.to_worker_id,
      input.status,
      input.reason,
      input.score ?? null,
      input.suppress_reason ?? null,
      input.details ? jsonStringify(input.details) : null,
      Number(input.created_at),
      Number(input.updated_at),
      input.applied_migration_id ?? null
    );
    return {
      id,
      ...input,
      score: input.score ?? null,
      suppress_reason: input.suppress_reason ?? null,
      details: input.details ?? null,
      applied_migration_id: input.applied_migration_id ?? null
    };
  }

  public listRecentRecommendations(packId: string, limit?: number): SchedulerRebalanceRecommendationRecord[] {
    const db = this.getDb(packId);
    const sql = limit !== undefined
      ? 'SELECT * FROM scheduler_rebalance_recommendation ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM scheduler_rebalance_recommendation ORDER BY created_at DESC';
    const rows = limit !== undefined
      ? db.prepare(sql).all(limit)
      : db.prepare(sql).all();
    return rows.map(row => this.toRecommendationRecord(row));
  }

  public getRecommendationById(packId: string, id: string): SchedulerRebalanceRecommendationRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare('SELECT * FROM scheduler_rebalance_recommendation WHERE id = ?').get(id);
    if (!row) {
      return null;
    }
    return this.toRecommendationRecord(row);
  }

  public updateRecommendation(
    packId: string,
    input: {
      id: string;
      status: 'applied' | 'superseded';
      updated_at: bigint;
      applied_migration_id?: string | null;
      details: unknown;
    }
  ): SchedulerRebalanceRecommendationRecord {
    const db = this.getDb(packId);
    db.prepare(
      `UPDATE scheduler_rebalance_recommendation
       SET status = ?, updated_at = ?, applied_migration_id = ?, details = ?
       WHERE id = ?`
    ).run(input.status, Number(input.updated_at), input.applied_migration_id ?? null, jsonStringify(input.details), input.id);

    const record = this.getRecommendationById(packId, input.id);
    if (!record) {
      throw new Error(`[SqliteSchedulerStorageAdapter] recommendation not found after update: ${input.id}`);
    }
    return record;
  }

  public listPendingRecommendationsForWorker(
    packId: string,
    workerId: string,
    maxApply: number
  ): SchedulerRebalanceRecommendationRecord[] {
    const db = this.getDb(packId);
    const rows = db.prepare(
      `SELECT * FROM scheduler_rebalance_recommendation
       WHERE to_worker_id = ? AND status = 'recommended'
       ORDER BY score DESC, created_at ASC
       LIMIT ?`
    ).all(workerId, maxApply);
    return rows.map(row => this.toRecommendationRecord(row));
  }

  // -- Observability --

  public writeDetailedSnapshot(
    _packId: string,
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
  ): Record<string, unknown> {
    const db = this.getDb(_packId);
    db.prepare(
      `INSERT INTO scheduler_run
       (id, worker_id, partition_id, lease_holder, lease_expires_at_snapshot, tick, summary, started_at, finished_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.worker_id,
      input.partition_id,
      input.lease_holder,
      input.lease_expires_at_snapshot !== null ? Number(input.lease_expires_at_snapshot) : null,
      Number(input.tick),
      jsonStringify(input.summary),
      Number(input.started_at),
      Number(input.finished_at),
      Number(input.created_at)
    );
    return input;
  }

  public writeCandidateDecision(
    _packId: string,
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
  ): Record<string, unknown> {
    const db = this.getDb(_packId);
    db.prepare(
      `INSERT INTO scheduler_candidate_decision
       (id, scheduler_run_id, partition_id, actor_id, kind, candidate_reasons, chosen_reason, scheduled_for_tick, priority_score, skipped_reason, created_job_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      schedulerRunId,
      input.partition_id,
      input.actor_id,
      input.kind,
      jsonStringify(input.candidate_reasons),
      input.chosen_reason,
      Number(input.scheduled_for_tick),
      input.priority_score,
      input.skipped_reason,
      input.created_job_id,
      Number(input.created_at)
    );
    return input;
  }

  public listRuns(
    packId: string,
    input: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
      cursor?: Record<string, unknown>;
      skip?: number;
    }
  ): Record<string, unknown>[] {
    const db = this.getDb(packId);
    let sql = 'SELECT * FROM scheduler_run';
    const params: SqlitePrimitive[] = [];
    const conditions: string[] = [];

    if (input.where) {
      for (const [key, value] of Object.entries(input.where)) {
        if (value !== undefined) {
          conditions.push(`${key} = ?`);
          params.push(toSqliteParam(value));
        }
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    if (input.orderBy) {
      const orderClauses = Object.entries(input.orderBy).map(([key, dir]) => `${key} ${String(dir)}`);
      if (orderClauses.length > 0) {
        sql += ' ORDER BY ' + orderClauses.join(', ');
      }
    } else {
      sql += ' ORDER BY created_at DESC';
    }

    if (input.take !== undefined) {
      sql += ' LIMIT ?';
      params.push(input.take);
    }

    if (input.skip !== undefined) {
      sql += ' OFFSET ?';
      params.push(input.skip);
    }

    return db.prepare(sql).all(...params);
  }

  public listCandidateDecisions(
    packId: string,
    input: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
      take?: number;
      cursor?: Record<string, unknown>;
      skip?: number;
    }
  ): Record<string, unknown>[] {
    const db = this.getDb(packId);
    let sql = 'SELECT * FROM scheduler_candidate_decision';
    const params: SqlitePrimitive[] = [];
    const conditions: string[] = [];

    if (input.where) {
      for (const [key, value] of Object.entries(input.where)) {
        if (value !== undefined) {
          conditions.push(`${key} = ?`);
          params.push(toSqliteParam(value));
        }
      }
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    if (input.orderBy) {
      const orderClauses = Object.entries(input.orderBy).map(([key, dir]) => `${key} ${String(dir)}`);
      if (orderClauses.length > 0) {
        sql += ' ORDER BY ' + orderClauses.join(', ');
      }
    } else {
      sql += ' ORDER BY created_at DESC';
    }

    if (input.take !== undefined) {
      sql += ' LIMIT ?';
      params.push(input.take);
    }

    if (input.skip !== undefined) {
      sql += ' OFFSET ?';
      params.push(input.skip);
    }

    return db.prepare(sql).all(...params);
  }

  public getAgentDecisions(packId: string, actorId: string, limit?: number): Record<string, unknown>[] {
    const db = this.getDb(packId);
    const sql = limit !== undefined
      ? 'SELECT * FROM scheduler_candidate_decision WHERE actor_id = ? ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM scheduler_candidate_decision WHERE actor_id = ? ORDER BY created_at DESC';
    return limit !== undefined
      ? db.prepare(sql).all(actorId, limit)
      : db.prepare(sql).all(actorId);
  }

  // -- Private helpers --

  private getDb(packId: string): DatabaseSync {
    const db = this.connections.get(packId);
    if (!db) {
      throw new Error(
        `[SqliteSchedulerStorageAdapter] storage not open for pack "${packId}". Call open(packId) first.`
      );
    }
    return db;
  }

  private toLeaseRecord(row: Record<string, unknown>): SchedulerLeaseRecord {
    return {
      key: row['key'] as string,
      partition_id: row['partition_id'] as string,
      holder: row['holder'] as string,
      acquired_at: BigInt(row['acquired_at'] as number),
      expires_at: BigInt(row['expires_at'] as number)
    };
  }

  private toCursorRecord(row: Record<string, unknown>): SchedulerCursorRecord {
    return {
      key: row['key'] as string,
      partition_id: row['partition_id'] as string,
      last_scanned_tick: BigInt(row['last_scanned_tick'] as number),
      last_signal_tick: BigInt(row['last_signal_tick'] as number),
      updated_at: BigInt(row['updated_at'] as number)
    };
  }

  private toPartitionRecord(row: Record<string, unknown>): SchedulerPartitionRecord {
    return {
      partition_id: row['partition_id'] as string,
      worker_id: row['worker_id'] as string | null,
      status: row['status'] as string,
      version: row['version'] as number,
      source: row['source'] as string,
      updated_at: BigInt(row['updated_at'] as number)
    };
  }

  private toMigrationRecord(row: Record<string, unknown>): SchedulerOwnershipMigrationRecord {
    return {
      id: row['id'] as string,
      partition_id: row['partition_id'] as string,
      from_worker_id: row['from_worker_id'] as string | null,
      to_worker_id: row['to_worker_id'] as string,
      status: row['status'] as string,
      reason: row['reason'] as string | null,
      details: jsonParse(row['details'] as string | null),
      created_at: BigInt(row['created_at'] as number),
      updated_at: BigInt(row['updated_at'] as number),
      completed_at: row['completed_at'] !== null ? BigInt(row['completed_at'] as number) : null
    };
  }

  private toWorkerStateRecord(row: Record<string, unknown>): SchedulerWorkerStateRecord {
    return {
      worker_id: row['worker_id'] as string,
      status: row['status'] as string,
      last_heartbeat_at: BigInt(row['last_heartbeat_at'] as number),
      owned_partition_count: row['owned_partition_count'] as number,
      active_migration_count: row['active_migration_count'] as number,
      capacity_hint: row['capacity_hint'] as number | null,
      updated_at: BigInt(row['updated_at'] as number)
    };
  }

  private toRecommendationRecord(row: Record<string, unknown>): SchedulerRebalanceRecommendationRecord {
    return {
      id: row['id'] as string,
      partition_id: row['partition_id'] as string,
      from_worker_id: row['from_worker_id'] as string | null,
      to_worker_id: row['to_worker_id'] as string | null,
      status: row['status'] as string,
      reason: row['reason'] as string,
      score: row['score'] as number | null,
      suppress_reason: row['suppress_reason'] as string | null,
      details: jsonParse(row['details'] as string | null),
      created_at: BigInt(row['created_at'] as number),
      updated_at: BigInt(row['updated_at'] as number),
      applied_migration_id: row['applied_migration_id'] as string | null
    };
  }
}
