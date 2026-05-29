import type { RuntimeLoopDiagnostics } from '../context.js';

export interface RuntimeKernelHealthSnapshot {
  runtime_ready: boolean;
  paused: boolean;
  loop_status: RuntimeLoopDiagnostics['status'] | 'unknown';
}

export interface SchedulerOwnershipSnapshot {
  worker_id: string;
  partition_count: number;
  owned_partition_ids: string[];
  assignment_source: 'persisted' | 'bootstrap' | 'fallback';
  migration_in_progress_count: number;
  worker_runtime_status: string;
  last_heartbeat_at: bigint | null;
  automatic_rebalance_enabled: boolean;
}

export interface RuntimeKernelFacade {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  isRunning(): boolean;
  getLoopDiagnostics(): RuntimeLoopDiagnostics;
  getHealthSnapshot(): RuntimeKernelHealthSnapshot;
}

export interface SchedulerControlPort {
  getOwnershipSnapshot(input?: {
    workerId?: string;
    partitionIds?: string[];
  }): Promise<SchedulerOwnershipSnapshot>;
  reconcileBootstrapOwnership(input: {
    schedulerWorkerId: string;
    schedulerPartitionIds?: string[];
  }): Promise<void>;
  triggerRebalance?(): Promise<unknown>;
}
