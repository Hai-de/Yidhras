import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { resolvePackRuntimeDatabaseLocation } from '../pack_db_locator.js';
import type {
  ListDecisionsInput,
  ListRunsInput,
  SchedulerCandidateDecisionRecord,
  SchedulerCursorRecord,
  SchedulerLeaseRecord,
  SchedulerOwnershipMigrationRecord,
  SchedulerPartitionRecord,
  SchedulerRebalanceRecommendationRecord,
  SchedulerRunRecord,
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
    return input;
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
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
    return { count: result.changes };
  }

  public deleteLeaseByHolder(packId: string, partitionId: string, holder: string): { count: number } {
    const db = this.getDb(packId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
    const result = db.prepare(
      'DELETE FROM scheduler_lease WHERE partition_id = ? AND holder = ?'
    ).run(partitionId, holder) as { changes: number };
    return { count: result.changes };
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
    return input;
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
      const row = db.prepare(
        `SELECT COUNT(*) as cnt FROM scheduler_ownership_migration_log
         WHERE status IN ('requested', 'in_progress') AND to_worker_id = ?`
      ).get(workerId) as { cnt: number } | undefined;
      return row?.cnt ?? 0;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- boundary type assertion
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
    const id = `rec_${input.partition_id}_${Number(input.created_at)}_${crypto.randomUUID().slice(0, 8)}`;
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

  // -- Observability (typed) --

  public getRunById(packId: string, runId: string): SchedulerRunRecord | null {
    const db = this.getDb(packId);
    const row = db.prepare('SELECT * FROM scheduler_run WHERE id = ?').get(runId);
    if (!row) {
      return null;
    }
    return this.toRunRecord(row);
  }

  public listRuns(packId: string, input: ListRunsInput): SchedulerRunRecord[] {
    const db = this.getDb(packId);
    const conditions: string[] = [];
    const params: SqlitePrimitive[] = [];

    if (input.tickFrom !== undefined) {
      conditions.push('tick >= ?');
      params.push(Number(input.tickFrom));
    }
    if (input.tickTo !== undefined) {
      conditions.push('tick <= ?');
      params.push(Number(input.tickTo));
    }
    if (input.workerId !== undefined) {
      conditions.push('worker_id = ?');
      params.push(input.workerId);
    }
    if (input.partitionId !== undefined) {
      conditions.push('partition_id = ?');
      params.push(input.partitionId);
    }
    if (input.cursorCreatedAt !== undefined && input.cursorId !== undefined) {
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(Number(input.cursorCreatedAt), Number(input.cursorCreatedAt), input.cursorId);
    }

    let sql = 'SELECT * FROM scheduler_run';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const orderMap: Record<ListRunsInput['orderBy'], string> = {
      created_at_desc: 'created_at DESC, id DESC',
      created_at_asc: 'created_at ASC, id ASC',
      tick_desc: 'tick DESC, id DESC'
    };
    sql += ' ORDER BY ' + orderMap[input.orderBy];
    sql += ' LIMIT ?';
    params.push(input.take);

    return db.prepare(sql).all(...params).map(row => this.toRunRecord(row));
  }

  public listDecisionsForRun(packId: string, runId: string): SchedulerCandidateDecisionRecord[] {
    const db = this.getDb(packId);
    const rows = db.prepare(
      'SELECT * FROM scheduler_candidate_decision WHERE scheduler_run_id = ? ORDER BY created_at ASC'
    ).all(runId);
    return rows.map(row => this.toCandidateDecisionRecord(row));
  }

  public listCandidateDecisions(packId: string, input: ListDecisionsInput): SchedulerCandidateDecisionRecord[] {
    const db = this.getDb(packId);
    const conditions: string[] = [];
    const params: SqlitePrimitive[] = [];

    if (input.actorId !== undefined) {
      conditions.push('actor_id = ?');
      params.push(input.actorId);
    }
    if (input.kind !== undefined) {
      conditions.push('kind = ?');
      params.push(input.kind);
    }
    if (input.chosenReason !== undefined) {
      conditions.push('chosen_reason = ?');
      params.push(input.chosenReason);
    }
    if (input.skippedReason !== undefined) {
      conditions.push('skipped_reason = ?');
      params.push(input.skippedReason);
    }
    if (input.partitionId !== undefined) {
      conditions.push('partition_id = ?');
      params.push(input.partitionId);
    }
    if (input.tickFrom !== undefined) {
      conditions.push('scheduled_for_tick >= ?');
      params.push(Number(input.tickFrom));
    }
    if (input.tickTo !== undefined) {
      conditions.push('scheduled_for_tick <= ?');
      params.push(Number(input.tickTo));
    }
    if (input.cursorCreatedAt !== undefined && input.cursorId !== undefined) {
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      params.push(Number(input.cursorCreatedAt), Number(input.cursorCreatedAt), input.cursorId);
    }

    let sql = 'SELECT * FROM scheduler_candidate_decision';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += input.orderBy === 'created_at_asc'
      ? ' ORDER BY created_at ASC, id ASC'
      : ' ORDER BY created_at DESC, id DESC';
    sql += ' LIMIT ?';
    params.push(input.take);

    return db.prepare(sql).all(...params).map(row => this.toCandidateDecisionRecord(row));
  }

  public getAgentDecisions(packId: string, actorId: string, limit: number): SchedulerCandidateDecisionRecord[] {
    const db = this.getDb(packId);
    const rows = db.prepare(
      'SELECT * FROM scheduler_candidate_decision WHERE actor_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(actorId, limit);
    return rows.map(row => this.toCandidateDecisionRecord(row));
  }

  public writeRunSnapshot(
    _packId: string,
    input: {
      id: string;
      workerId: string;
      partitionId: string;
      leaseHolder: string | null;
      leaseExpiresAtSnapshot: bigint | null;
      tick: bigint;
      summary: Record<string, unknown>;
      startedAt: bigint;
      finishedAt: bigint;
    }
  ): SchedulerRunRecord {
    const db = this.getDb(_packId);
    const createdAt = input.finishedAt;
    db.prepare(
      `INSERT INTO scheduler_run
       (id, worker_id, partition_id, lease_holder, lease_expires_at_snapshot, tick, summary, started_at, finished_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.workerId,
      input.partitionId,
      input.leaseHolder,
      input.leaseExpiresAtSnapshot !== null ? Number(input.leaseExpiresAtSnapshot) : null,
      Number(input.tick),
      jsonStringify(input.summary),
      Number(input.startedAt),
      Number(input.finishedAt),
      Number(createdAt)
    );
    return {
      id: input.id,
      worker_id: input.workerId,
      partition_id: input.partitionId,
      lease_holder: input.leaseHolder,
      lease_expires_at_snapshot: input.leaseExpiresAtSnapshot,
      tick: input.tick,
      summary: jsonStringify(input.summary),
      started_at: input.startedAt,
      finished_at: input.finishedAt,
      created_at: createdAt
    };
  }

  public writeCandidateDecision(
    _packId: string,
    schedulerRunId: string,
    input: {
      id: string;
      partitionId: string;
      actorId: string;
      kind: string;
      candidateReasons: unknown;
      chosenReason: string;
      scheduledForTick: bigint;
      priorityScore: number;
      skippedReason: string | null;
      createdJobId: string | null;
      createdAt: bigint;
    }
  ): SchedulerCandidateDecisionRecord {
    const db = this.getDb(_packId);
    db.prepare(
      `INSERT INTO scheduler_candidate_decision
       (id, scheduler_run_id, partition_id, actor_id, kind, candidate_reasons, chosen_reason, scheduled_for_tick, priority_score, skipped_reason, created_job_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      schedulerRunId,
      input.partitionId,
      input.actorId,
      input.kind,
      jsonStringify(input.candidateReasons),
      input.chosenReason,
      Number(input.scheduledForTick),
      input.priorityScore,
      input.skippedReason,
      input.createdJobId,
      Number(input.createdAt)
    );
    return {
      id: input.id,
      scheduler_run_id: schedulerRunId,
      partition_id: input.partitionId,
      actor_id: input.actorId,
      kind: input.kind,
      candidate_reasons: jsonStringify(input.candidateReasons),
      chosen_reason: input.chosenReason,
      scheduled_for_tick: input.scheduledForTick,
      priority_score: input.priorityScore,
      skipped_reason: input.skippedReason,
      created_job_id: input.createdJobId,
      created_at: input.createdAt
    };
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
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      key: row['key'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      partition_id: row['partition_id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      holder: row['holder'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      acquired_at: BigInt(row['acquired_at'] as number),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      expires_at: BigInt(row['expires_at'] as number)
    };
  }

  private toCursorRecord(row: Record<string, unknown>): SchedulerCursorRecord {
    return {
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      key: row['key'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      partition_id: row['partition_id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      last_scanned_tick: BigInt(row['last_scanned_tick'] as number),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      last_signal_tick: BigInt(row['last_signal_tick'] as number),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      updated_at: BigInt(row['updated_at'] as number)
    };
  }

  private toPartitionRecord(row: Record<string, unknown>): SchedulerPartitionRecord {
    return {
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      partition_id: row['partition_id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      worker_id: row['worker_id'] as string | null,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      status: row['status'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      version: row['version'] as number,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      source: row['source'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      updated_at: BigInt(row['updated_at'] as number)
    };
  }

  private toMigrationRecord(row: Record<string, unknown>): SchedulerOwnershipMigrationRecord {
    return {
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      id: row['id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      partition_id: row['partition_id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      from_worker_id: row['from_worker_id'] as string | null,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      to_worker_id: row['to_worker_id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      status: row['status'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      reason: row['reason'] as string | null,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      details: jsonParse(row['details'] as string | null),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      created_at: BigInt(row['created_at'] as number),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      updated_at: BigInt(row['updated_at'] as number),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      completed_at: row['completed_at'] !== null ? BigInt(row['completed_at'] as number) : null
    };
  }

  private toWorkerStateRecord(row: Record<string, unknown>): SchedulerWorkerStateRecord {
    return {
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      worker_id: row['worker_id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      status: row['status'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      last_heartbeat_at: BigInt(row['last_heartbeat_at'] as number),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      owned_partition_count: row['owned_partition_count'] as number,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      active_migration_count: row['active_migration_count'] as number,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      capacity_hint: row['capacity_hint'] as number | null,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      updated_at: BigInt(row['updated_at'] as number)
    };
  }

  private toRunRecord(row: Record<string, unknown>): SchedulerRunRecord {
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      id: row['id'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      worker_id: row['worker_id'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      partition_id: row['partition_id'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      lease_holder: (row['lease_holder'] as string | null) ?? null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      lease_expires_at_snapshot: row['lease_expires_at_snapshot'] !== null ? BigInt(row['lease_expires_at_snapshot'] as number) : null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      tick: BigInt(row['tick'] as number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      summary: (row['summary'] as string | null) ?? '{}',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      started_at: BigInt(row['started_at'] as number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      finished_at: BigInt(row['finished_at'] as number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      created_at: BigInt(row['created_at'] as number)
    };
  }

  private toCandidateDecisionRecord(row: Record<string, unknown>): SchedulerCandidateDecisionRecord {
    return {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      id: row['id'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      scheduler_run_id: row['scheduler_run_id'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      partition_id: row['partition_id'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      actor_id: row['actor_id'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      kind: row['kind'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      candidate_reasons: (row['candidate_reasons'] as string | null) ?? '[]',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      chosen_reason: row['chosen_reason'] as string,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      scheduled_for_tick: BigInt(row['scheduled_for_tick'] as number),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      priority_score: row['priority_score'] as number,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      skipped_reason: (row['skipped_reason'] as string | null) ?? null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      created_job_id: (row['created_job_id'] as string | null) ?? null,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      created_at: BigInt(row['created_at'] as number)
    };
  }

  private toRecommendationRecord(row: Record<string, unknown>): SchedulerRebalanceRecommendationRecord {
    return {
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      id: row['id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      partition_id: row['partition_id'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      from_worker_id: row['from_worker_id'] as string | null,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      to_worker_id: row['to_worker_id'] as string | null,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      status: row['status'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      reason: row['reason'] as string,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      score: row['score'] as number | null,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      suppress_reason: row['suppress_reason'] as string | null,
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      details: jsonParse(row['details'] as string | null),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      created_at: BigInt(row['created_at'] as number),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      updated_at: BigInt(row['updated_at'] as number),
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SQLite column type
      applied_migration_id: row['applied_migration_id'] as string | null
    };
  }
}
