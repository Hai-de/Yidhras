import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';

// ---------------------------------------------------------------------------
// In-memory SchedulerStorageAdapter for integration tests
//
// Stores all data in Maps. Used to replace direct Prisma writes to deleted
// scheduler models (schedulerRun, schedulerLease, etc.) with adapter-based
// data setup that runtime functions can read back.
// ---------------------------------------------------------------------------

interface MemRun {
  id: string;
  worker_id: string;
  partition_id: string;
  lease_holder: string | null;
  lease_expires_at_snapshot: number | null;
  tick: number;
  summary: string;
  started_at: number;
  finished_at: number;
  created_at: number;
}

interface MemDecision {
  id: string;
  scheduler_run_id: string;
  partition_id: string;
  actor_id: string;
  kind: string;
  candidate_reasons: string;
  chosen_reason: string;
  scheduled_for_tick: number;
  priority_score: number;
  skipped_reason: string | null;
  created_job_id: string | null;
  created_at: number;
}

interface MemLease {
  key: string;
  partition_id: string;
  holder: string;
  acquired_at: number;
  expires_at: number;
  updated_at: number;
}

interface MemCursor {
  key: string;
  partition_id: string;
  last_scanned_tick: number;
  last_signal_tick: number;
  updated_at: number;
}

interface MemPartition {
  partition_id: string;
  worker_id: string | null;
  status: string;
  version: number;
  source: string;
  updated_at: number;
}

interface MemMigration {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string;
  status: string;
  reason: string | null;
  details: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface MemWorker {
  worker_id: string;
  status: string;
  last_heartbeat_at: number;
  owned_partition_count: number;
  active_migration_count: number;
  capacity_hint: number | null;
  updated_at: number;
}

interface MemRecommendation {
  id: string;
  partition_id: string;
  from_worker_id: string | null;
  to_worker_id: string | null;
  status: string;
  reason: string;
  score: number | null;
  suppress_reason: string | null;
  details: string | null;
  created_at: number;
  updated_at: number;
  applied_migration_id: string | null;
}

export class MemSchedulerStorage implements SchedulerStorageAdapter {
  private runs = new Map<string, MemRun[]>();
  private decisions = new Map<string, MemDecision[]>();
  private leases = new Map<string, MemLease[]>();
  private cursors = new Map<string, MemCursor[]>();
  private partitions = new Map<string, MemPartition[]>();
  private migrations = new Map<string, MemMigration[]>();
  private workers = new Map<string, MemWorker[]>();
  private recommendations = new Map<string, MemRecommendation[]>();
  private openPacks = new Set<string>();

  // -- Lifecycle --

  open(packId: string): void {
    this.openPacks.add(packId);
  }

  close(packId: string): void {
    this.openPacks.delete(packId);
  }

  destroyPackSchedulerStorage(packId: string): void {
    this.runs.delete(packId);
    this.decisions.delete(packId);
    this.leases.delete(packId);
    this.cursors.delete(packId);
    this.partitions.delete(packId);
    this.migrations.delete(packId);
    this.workers.delete(packId);
    this.recommendations.delete(packId);
  }

  listOpenPackIds(): string[] {
    return Array.from(this.openPacks);
  }

  ensurePack(packId: string): void {
    if (!this.openPacks.has(packId)) {
      this.open(packId);
    }
  }

  // -- Lease --

  upsertLease(packId: string, input: {
    key: string;
    partition_id: string;
    holder: string;
    acquired_at: bigint;
    expires_at: bigint;
    updated_at: bigint;
  }): { key: string; partition_id: string; holder: string; acquired_at: bigint; expires_at: bigint } {
    this.ensurePack(packId);
    if (!this.leases.has(packId)) this.leases.set(packId, []);
    const leases = this.leases.get(packId)!;
    const idx = leases.findIndex(l => l.partition_id === input.partition_id);
    const record: MemLease = {
      key: input.key,
      partition_id: input.partition_id,
      holder: input.holder,
      acquired_at: Number(input.acquired_at),
      expires_at: Number(input.expires_at),
      updated_at: Number(input.updated_at)
    };
    if (idx >= 0) {
      leases[idx] = record;
    } else {
      leases.push(record);
    }
    return input;
  }

  getLease(packId: string, partitionId: string): { key: string; partition_id: string; holder: string; acquired_at: bigint; expires_at: bigint } | null {
    const leases = this.leases.get(packId) ?? [];
    const lease = leases.find(l => l.partition_id === partitionId);
    if (!lease) return null;
    return {
      key: lease.key,
      partition_id: lease.partition_id,
      holder: lease.holder,
      acquired_at: BigInt(lease.acquired_at),
      expires_at: BigInt(lease.expires_at)
    };
  }

  updateLeaseIfClaimable(packId: string, input: {
    partition_id: string;
    holder: string;
    acquired_at: bigint;
    expires_at: bigint;
    updated_at: bigint;
    key: string;
    now: bigint;
  }): { count: number } {
    const leases = this.leases.get(packId) ?? [];
    const lease = leases.find(l => l.partition_id === input.partition_id);
    if (!lease) { return { count: 0 }; }
    if (lease.holder !== input.holder && lease.expires_at > Number(input.now)) {
      return { count: 0 };
    }
    lease.holder = input.holder;
    lease.acquired_at = Number(input.acquired_at);
    lease.expires_at = Number(input.expires_at);
    lease.updated_at = Number(input.updated_at);
    lease.key = input.key;
    return { count: 1 };
  }

  deleteLeaseByHolder(packId: string, partitionId: string, holder: string): { count: number } {
    const leases = this.leases.get(packId);
    if (!leases) return { count: 0 };
    const idx = leases.findIndex(l => l.partition_id === partitionId && l.holder === holder);
    if (idx < 0) return { count: 0 };
    leases.splice(idx, 1);
    return { count: 1 };
  }

  // -- Cursor --

  upsertCursor(packId: string, input: {
    key: string;
    partition_id: string;
    last_scanned_tick: bigint;
    last_signal_tick: bigint;
    updated_at: bigint;
  }): { key: string; partition_id: string; last_scanned_tick: bigint; last_signal_tick: bigint; updated_at: bigint } {
    this.ensurePack(packId);
    if (!this.cursors.has(packId)) this.cursors.set(packId, []);
    const cursors = this.cursors.get(packId)!;
    const idx = cursors.findIndex(c => c.partition_id === input.partition_id);
    const record: MemCursor = {
      key: input.key,
      partition_id: input.partition_id,
      last_scanned_tick: Number(input.last_scanned_tick),
      last_signal_tick: Number(input.last_signal_tick),
      updated_at: Number(input.updated_at)
    };
    if (idx >= 0) {
      cursors[idx] = record;
    } else {
      cursors.push(record);
    }
    return input;
  }

  getCursor(packId: string, partitionId: string): { key: string; partition_id: string; last_scanned_tick: bigint; last_signal_tick: bigint; updated_at: bigint } | null {
    const cursors = this.cursors.get(packId) ?? [];
    const cursor = cursors.find(c => c.partition_id === partitionId);
    if (!cursor) return null;
    return {
      key: cursor.key,
      partition_id: cursor.partition_id,
      last_scanned_tick: BigInt(cursor.last_scanned_tick),
      last_signal_tick: BigInt(cursor.last_signal_tick),
      updated_at: BigInt(cursor.updated_at)
    };
  }

  // -- Partition Assignment --

  getPartition(packId: string, partitionId: string): { partition_id: string; worker_id: string | null; status: string; version: number; source: string; updated_at: bigint } | null {
    const partitions = this.partitions.get(packId) ?? [];
    const p = partitions.find(part => part.partition_id === partitionId);
    if (!p) return null;
    return { ...p, updated_at: BigInt(p.updated_at) };
  }

  listPartitions(packId: string): Array<{ partition_id: string; worker_id: string | null; status: string; version: number; source: string; updated_at: bigint }> {
    return (this.partitions.get(packId) ?? []).map(p => ({ ...p, updated_at: BigInt(p.updated_at) }));
  }

  createPartition(packId: string, input: {
    partition_id: string;
    worker_id: string | null;
    status: string;
    version: number;
    source: string;
    updated_at: bigint;
  }): { partition_id: string; worker_id: string | null; status: string; version: number; source: string; updated_at: bigint } {
    this.ensurePack(packId);
    if (!this.partitions.has(packId)) this.partitions.set(packId, []);
    const record: MemPartition = {
      partition_id: input.partition_id,
      worker_id: input.worker_id,
      status: input.status,
      version: input.version,
      source: input.source,
      updated_at: Number(input.updated_at)
    };
    this.partitions.get(packId)!.push(record);
    return input;
  }

  updatePartition(packId: string, input: {
    partition_id: string;
    worker_id?: string | null;
    status?: string;
    version?: number;
    source?: string;
    updated_at: bigint;
  }): { partition_id: string; worker_id: string | null; status: string; version: number; source: string; updated_at: bigint } {
    const partitions = this.partitions.get(packId) ?? [];
    const existing = partitions.find(p => p.partition_id === input.partition_id);
    if (!existing) throw new Error(`partition not found: ${input.partition_id}`);
    if (input.worker_id !== undefined) existing.worker_id = input.worker_id;
    if (input.status !== undefined) existing.status = input.status;
    if (input.version !== undefined) existing.version = input.version;
    if (input.source !== undefined) existing.source = input.source;
    existing.updated_at = Number(input.updated_at);
    return { ...existing, updated_at: input.updated_at };
  }

  // -- Ownership Migration --

  listMigrations(packId: string, limit?: number): Array<{
    id: string; partition_id: string; from_worker_id: string | null; to_worker_id: string;
    status: string; reason: string | null; details: unknown;
    created_at: bigint; updated_at: bigint; completed_at: bigint | null;
  }> {
    let items = [...(this.migrations.get(packId) ?? [])];
    items.sort((a, b) => b.created_at - a.created_at);
    if (limit !== undefined) items = items.slice(0, limit);
    return items.map(m => ({
      id: m.id,
      partition_id: m.partition_id,
      from_worker_id: m.from_worker_id,
      to_worker_id: m.to_worker_id,
      status: m.status,
      reason: m.reason,
      details: m.details ? JSON.parse(m.details) : null,
      created_at: BigInt(m.created_at),
      updated_at: BigInt(m.updated_at),
      completed_at: m.completed_at !== null ? BigInt(m.completed_at) : null
    }));
  }

  countMigrationsInProgress(packId: string, workerId?: string): number {
    const migrations = this.migrations.get(packId) ?? [];
    return migrations.filter(m =>
      (m.status === 'requested' || m.status === 'in_progress') &&
      (workerId === undefined || m.to_worker_id === workerId)
    ).length;
  }

  getMigrationById(packId: string, migrationId: string): Record<string, unknown> | null {
    const migration = (this.migrations.get(packId) ?? []).find(m => m.id === migrationId);
    if (!migration) return null;
    return migration as unknown as Record<string, unknown>;
  }

  findLatestActiveMigrationForPartition(packId: string, partitionId: string, toWorkerId: string): Record<string, unknown> | null {
    const migrations = (this.migrations.get(packId) ?? [])
      .filter(m => m.partition_id === partitionId && m.to_worker_id === toWorkerId && (m.status === 'requested' || m.status === 'in_progress'))
      .sort((a, b) => b.created_at - a.created_at);
    return migrations.length > 0 ? migrations[0] as unknown as Record<string, unknown> : null;
  }

  createMigration(packId: string, input: {
    partition_id: string;
    from_worker_id: string | null;
    to_worker_id: string;
    status: string;
    reason: string | null;
    details: Record<string, unknown>;
    created_at: bigint;
    updated_at: bigint;
    completed_at: bigint | null;
  }): { id: string; partition_id: string; from_worker_id: string | null; to_worker_id: string; status: string; reason: string | null; details: unknown; created_at: bigint; updated_at: bigint; completed_at: bigint | null } {
    this.ensurePack(packId);
    if (!this.migrations.has(packId)) this.migrations.set(packId, []);
    const id = `${input.partition_id}_${Number(input.created_at).toString()}`;
    const record: MemMigration = {
      id,
      partition_id: input.partition_id,
      from_worker_id: input.from_worker_id,
      to_worker_id: input.to_worker_id,
      status: input.status,
      reason: input.reason,
      details: JSON.stringify(input.details),
      created_at: Number(input.created_at),
      updated_at: Number(input.updated_at),
      completed_at: input.completed_at !== null ? Number(input.completed_at) : null
    };
    this.migrations.get(packId)!.push(record);
    return { ...input, id };
  }

  updateMigration(packId: string, input: {
    id: string;
    status?: string;
    updated_at: bigint;
    completed_at?: bigint | null;
  }): { id: string; partition_id: string; from_worker_id: string | null; to_worker_id: string; status: string; reason: string | null; details: unknown; created_at: bigint; updated_at: bigint; completed_at: bigint | null } {
    const migrations = this.migrations.get(packId) ?? [];
    const m = migrations.find(mig => mig.id === input.id);
    if (!m) throw new Error(`migration not found: ${input.id}`);
    if (input.status !== undefined) m.status = input.status;
    if (input.completed_at !== undefined) m.completed_at = input.completed_at !== null ? Number(input.completed_at) : null;
    m.updated_at = Number(input.updated_at);
    return {
      id: m.id,
      partition_id: m.partition_id,
      from_worker_id: m.from_worker_id,
      to_worker_id: m.to_worker_id,
      status: m.status,
      reason: m.reason,
      details: m.details ? JSON.parse(m.details) : null,
      created_at: BigInt(m.created_at),
      updated_at: BigInt(m.updated_at),
      completed_at: m.completed_at !== null ? BigInt(m.completed_at) : null
    };
  }

  // -- Worker Runtime State --

  listWorkerStates(packId: string): Array<{
    worker_id: string; status: string; last_heartbeat_at: bigint;
    owned_partition_count: number; active_migration_count: number;
    capacity_hint: number | null; updated_at: bigint;
  }> {
    return (this.workers.get(packId) ?? []).map(w => ({
      ...w,
      last_heartbeat_at: BigInt(w.last_heartbeat_at),
      updated_at: BigInt(w.updated_at)
    }));
  }

  getWorkerState(packId: string, workerId: string): Record<string, unknown> | null {
    const w = (this.workers.get(packId) ?? []).find(ws => ws.worker_id === workerId);
    if (!w) return null;
    return w as unknown as Record<string, unknown>;
  }

  upsertWorkerState(packId: string, input: {
    worker_id: string;
    status: string;
    last_heartbeat_at: bigint;
    owned_partition_count: number;
    active_migration_count: number;
    capacity_hint: number | null;
    updated_at: bigint;
  }): { worker_id: string; status: string; last_heartbeat_at: bigint; owned_partition_count: number; active_migration_count: number; capacity_hint: number | null; updated_at: bigint } {
    this.ensurePack(packId);
    if (!this.workers.has(packId)) this.workers.set(packId, []);
    const workers = this.workers.get(packId)!;
    const idx = workers.findIndex(w => w.worker_id === input.worker_id);
    const record: MemWorker = {
      worker_id: input.worker_id,
      status: input.status,
      last_heartbeat_at: Number(input.last_heartbeat_at),
      owned_partition_count: input.owned_partition_count,
      active_migration_count: input.active_migration_count,
      capacity_hint: input.capacity_hint,
      updated_at: Number(input.updated_at)
    };
    if (idx >= 0) {
      workers[idx] = record;
    } else {
      workers.push(record);
    }
    return input;
  }

  updateWorkerStatus(packId: string, workerId: string, status: string, updatedAt: bigint): { worker_id: string; status: string; last_heartbeat_at: bigint; owned_partition_count: number; active_migration_count: number; capacity_hint: number | null; updated_at: bigint } {
    const workers = this.workers.get(packId) ?? [];
    const w = workers.find(ws => ws.worker_id === workerId);
    if (!w) throw new Error(`worker not found: ${workerId}`);
    w.status = status;
    w.updated_at = Number(updatedAt);
    return {
      worker_id: w.worker_id,
      status: w.status,
      last_heartbeat_at: BigInt(w.last_heartbeat_at),
      owned_partition_count: w.owned_partition_count,
      active_migration_count: w.active_migration_count,
      capacity_hint: w.capacity_hint,
      updated_at: updatedAt
    };
  }

  // -- Rebalance Recommendation --

  findOpenRecommendation(packId: string, input: {
    partition_id: string;
    status: 'recommended' | 'suppressed';
    reason: string;
    from_worker_id: string | null;
    to_worker_id: string | null;
    suppress_reason: string | null;
  }): Record<string, unknown> | null {
    const recs = this.recommendations.get(packId) ?? [];
    const match = recs.find(r =>
      r.partition_id === input.partition_id &&
      r.status === input.status &&
      r.reason === input.reason &&
      (input.from_worker_id === null ? r.from_worker_id === null : r.from_worker_id === input.from_worker_id) &&
      (input.to_worker_id === null ? r.to_worker_id === null : r.to_worker_id === input.to_worker_id) &&
      r.applied_migration_id === null
    );
    return match ? match as unknown as Record<string, unknown> : null;
  }

  createRecommendation(packId: string, input: {
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
  }): { id: string; partition_id: string; from_worker_id: string | null; to_worker_id: string | null; status: string; reason: string; score: number | null; suppress_reason: string | null; details: unknown; created_at: bigint; updated_at: bigint; applied_migration_id: string | null } {
    this.ensurePack(packId);
    if (!this.recommendations.has(packId)) this.recommendations.set(packId, []);
    const id = `rec_${input.partition_id}_${Number(input.created_at).toString()}`;
    const record: MemRecommendation = {
      id,
      partition_id: input.partition_id,
      from_worker_id: input.from_worker_id,
      to_worker_id: input.to_worker_id,
      status: input.status,
      reason: input.reason,
      score: input.score ?? null,
      suppress_reason: input.suppress_reason ?? null,
      details: input.details ? JSON.stringify(input.details) : null,
      created_at: Number(input.created_at),
      updated_at: Number(input.updated_at),
      applied_migration_id: input.applied_migration_id ?? null
    };
    this.recommendations.get(packId)!.push(record);
    return { ...input, id, score: input.score ?? null, suppress_reason: input.suppress_reason ?? null, details: input.details ?? null, applied_migration_id: input.applied_migration_id ?? null };
  }

  listRecentRecommendations(packId: string, limit?: number): Array<{
    id: string; partition_id: string; from_worker_id: string | null; to_worker_id: string | null;
    status: string; reason: string; score: number | null; suppress_reason: string | null;
    details: unknown; created_at: bigint; updated_at: bigint; applied_migration_id: string | null;
  }> {
    let items = [...(this.recommendations.get(packId) ?? [])];
    items.sort((a, b) => b.created_at - a.created_at);
    if (limit !== undefined) items = items.slice(0, limit);
    return items.map(r => ({
      id: r.id,
      partition_id: r.partition_id,
      from_worker_id: r.from_worker_id,
      to_worker_id: r.to_worker_id,
      status: r.status,
      reason: r.reason,
      score: r.score,
      suppress_reason: r.suppress_reason,
      details: r.details ? JSON.parse(r.details) : null,
      created_at: BigInt(r.created_at),
      updated_at: BigInt(r.updated_at),
      applied_migration_id: r.applied_migration_id
    }));
  }

  getRecommendationById(packId: string, id: string): Record<string, unknown> | null {
    const r = (this.recommendations.get(packId) ?? []).find(rec => rec.id === id);
    return r ? r as unknown as Record<string, unknown> : null;
  }

  updateRecommendation(packId: string, input: {
    id: string;
    status: 'applied' | 'superseded';
    updated_at: bigint;
    applied_migration_id?: string | null;
    details: unknown;
  }): Record<string, unknown> {
    const recs = this.recommendations.get(packId) ?? [];
    const r = recs.find(rec => rec.id === input.id);
    if (!r) throw new Error(`recommendation not found: ${input.id}`);
    r.status = input.status;
    r.updated_at = Number(input.updated_at);
    if (input.applied_migration_id !== undefined) r.applied_migration_id = input.applied_migration_id;
    r.details = typeof input.details === 'string' ? input.details : JSON.stringify(input.details);
    return r as unknown as Record<string, unknown>;
  }

  listPendingRecommendationsForWorker(packId: string, workerId: string, maxApply: number): Array<Record<string, unknown>> {
    const items = (this.recommendations.get(packId) ?? [])
      .filter(r => r.to_worker_id === workerId && r.status === 'recommended')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.created_at - b.created_at)
      .slice(0, maxApply);
    return items as unknown as Array<Record<string, unknown>>;
  }

  // -- Observability read methods --

  writeDetailedSnapshot(packId: string, input: Record<string, unknown>): Record<string, unknown> {
    this.ensurePack(packId);
    if (!this.runs.has(packId)) this.runs.set(packId, []);
    const summary = typeof input.summary === 'object' && input.summary !== null
      ? JSON.stringify(input.summary)
      : String(input.summary ?? '{}');
    this.runs.get(packId)!.push({ ...input, summary } as unknown as MemRun);
    return input;
  }

  writeCandidateDecision(packId: string, _schedulerRunId: string, input: Record<string, unknown>): Record<string, unknown> {
    this.ensurePack(packId);
    if (!this.decisions.has(packId)) this.decisions.set(packId, []);
    const candidateReasons = Array.isArray(input.candidate_reasons)
      ? JSON.stringify(input.candidate_reasons)
      : String(input.candidate_reasons ?? '[]');
    this.decisions.get(packId)!.push({ ...input, candidate_reasons: candidateReasons } as unknown as MemDecision);
    return input;
  }

  listRuns(packId: string, input: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    take?: number;
    cursor?: Record<string, unknown>;
    skip?: number;
  }): Array<Record<string, unknown>> {
    let items = [...(this.runs.get(packId) ?? [])].map(r => ({ ...r }));
    if (input.where) {
      for (const [key, value] of Object.entries(input.where)) {
        items = items.filter(item => (item as Record<string, unknown>)[key] === value);
      }
    }
    if (input.orderBy) {
      for (const [key, dir] of Object.entries(input.orderBy)) {
        items.sort((a, b) => {
          const av = (a as Record<string, unknown>)[key] as number;
          const bv = (b as Record<string, unknown>)[key] as number;
          return dir === 'desc' ? bv - av : av - bv;
        });
      }
    } else {
      items.sort((a, b) => b.created_at - a.created_at);
    }
    if (input.take !== undefined) items = items.slice(0, input.take);
    return items as Array<Record<string, unknown>>;
  }

  listCandidateDecisions(packId: string, input: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown>;
    take?: number;
    cursor?: Record<string, unknown>;
    skip?: number;
  }): Array<Record<string, unknown>> {
    let items = [...(this.decisions.get(packId) ?? [])].map(d => ({ ...d }));
    if (input.where) {
      for (const [key, value] of Object.entries(input.where)) {
        items = items.filter(item => (item as Record<string, unknown>)[key] === value);
      }
    }
    if (input.orderBy) {
      for (const [key, dir] of Object.entries(input.orderBy)) {
        items.sort((a, b) => {
          const av = (a as Record<string, unknown>)[key] as number;
          const bv = (b as Record<string, unknown>)[key] as number;
          return dir === 'asc' ? av - bv : bv - av;
        });
      }
    }
    return items as Array<Record<string, unknown>>;
  }

  getAgentDecisions(packId: string, actorId: string, limit?: number): Array<Record<string, unknown>> {
    let items = (this.decisions.get(packId) ?? []).filter(d => d.actor_id === actorId);
    items.sort((a, b) => b.created_at - a.created_at);
    if (limit !== undefined) items = items.slice(0, limit);
    return items as Array<Record<string, unknown>>;
  }
}
