import { isAiGatewayEnabled } from '../../config/runtime_config.js';
import type { RuntimeSpeedSnapshot } from '../../core/runtime_speed.js';
import type { DatabaseHealthSnapshot } from '../../db/sqlite_runtime.js';
import type { SystemMessage } from '../../utils/notifications.js';
import type { AppContext, RuntimeLoopDiagnostics } from '../context.js';
import { createRuntimeKernelService } from '../runtime/runtime_kernel_service.js';
import { readVisibleClockSnapshot } from './app_context_ports.js';

const DEFAULT_RUNTIME_LOOP_DIAGNOSTICS: RuntimeLoopDiagnostics = {
  status: 'idle',
  in_flight: false,
  overlap_skipped_count: 0,
  iteration_count: 0,
  last_started_at: null,
  last_finished_at: null,
  last_duration_ms: null,
  last_error_message: null
};

export interface RuntimeStatusSnapshot {
  status: 'paused' | 'running';
  runtime_ready: boolean;
  runtime_speed: RuntimeSpeedSnapshot;
  runtime_loop: RuntimeLoopDiagnostics;
  database: DatabaseHealthSnapshot | null;
  scheduler: {
    worker_id: string;
    partition_count: number;
    owned_partition_ids: string[];
    assignment_source: 'persisted' | 'bootstrap' | 'fallback';
    migration_in_progress_count: number;
    worker_runtime_status: string;
    last_heartbeat_at: string | null;
    automatic_rebalance_enabled: boolean;
  };
  ai: {
    gateway_enabled: boolean;
  };
  health_level: AppContext['startupHealth']['level'];
  world_pack:
    | {
        id: string;
        name: string;
        version: string;
        description?: string;
        authors?: Array<{ name: string; role?: string; homepage?: string }>;
        license?: string;
        homepage?: string;
        repository?: string;
        tags?: string[];
        compatibility?: { yidhras?: string; schema_version?: string; notes?: string };
      }
    | null;
  world_time: {
    absolute_ticks: string;
    calendars: unknown;
    source: 'host_projection' | 'clock_fallback';
  };
  has_error: boolean;
  startup_errors: string[];
}

export interface StartupHealthSnapshot {
  healthy: boolean;
  level: AppContext['startupHealth']['level'];
  runtime_ready: boolean;
  checks: AppContext['startupHealth']['checks'];
  available_world_packs: string[];
  errors: string[];
}

export interface AcknowledgementSnapshot {
  acknowledged: true;
}

export interface DevRuntimeResetSummary {
  scheduler_candidate_decisions_deleted: number;
  scheduler_runs_deleted: number;
  relationship_adjustment_logs_deleted: number;
  snr_adjustment_logs_deleted: number;
  decision_jobs_deleted: number;
  action_intents_deleted: number;
  inference_traces_deleted: number;
  scheduler_rebalance_recommendations_deleted: number;
  scheduler_ownership_migrations_deleted: number;
  scheduler_worker_runtime_states_deleted: number;
  scheduler_partition_assignments_deleted: number;
  scheduler_cursor_deleted: number;
  scheduler_lease_deleted: number;
}

const parseBooleanEnv = (value: string | undefined): boolean => {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

export const listSystemNotifications = (context: AppContext): SystemMessage[] => {
  return context.notifications.getMessages();
};

export const clearSystemNotifications = (context: AppContext): AcknowledgementSnapshot => {
  context.notifications.clear();
  return { acknowledged: true };
};

export const ensureSchedulerBootstrapOwnership = async (
  context: AppContext,
  options: {
    schedulerWorkerId: string;
    schedulerPartitionIds?: string[];
  }
): Promise<void> => {
  const runtimeKernel = createRuntimeKernelService(context);
  await runtimeKernel.reconcileBootstrapOwnership({
    schedulerWorkerId: options.schedulerWorkerId,
    schedulerPartitionIds: options.schedulerPartitionIds
  });
};

export const resetDevelopmentRuntimeState = async (context: AppContext): Promise<DevRuntimeResetSummary | null> => {
  const appEnv = (process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development').trim().toLowerCase();
  const enabled = parseBooleanEnv(process.env.DEV_RUNTIME_RESET_ON_START ?? '1');
  if (appEnv !== 'development' || !enabled) {
    return null;
  }

  return context.repos.inference.getPrisma().$transaction(async tx => {
    const schedulerCandidateDecisions = await tx.schedulerCandidateDecision.deleteMany();
    const schedulerRuns = await tx.schedulerRun.deleteMany();
    const relationshipAdjustmentLogs = await tx.relationshipAdjustmentLog.deleteMany();
    const snrAdjustmentLogs = await tx.sNRAdjustmentLog.deleteMany();
    const decisionJobs = await tx.decisionJob.deleteMany();
    const actionIntents = await tx.actionIntent.deleteMany();
    const inferenceTraces = await tx.inferenceTrace.deleteMany();
    const schedulerRebalanceRecommendations = await tx.schedulerRebalanceRecommendation.deleteMany();
    const schedulerOwnershipMigrations = await tx.schedulerOwnershipMigrationLog.deleteMany();
    const schedulerWorkerRuntimeStates = await tx.schedulerWorkerRuntimeState.deleteMany();
    const schedulerPartitionAssignments = await tx.schedulerPartitionAssignment.deleteMany();
    const schedulerCursor = await tx.schedulerCursor.deleteMany();
    const schedulerLease = await tx.schedulerLease.deleteMany();

    return {
      scheduler_candidate_decisions_deleted: schedulerCandidateDecisions.count,
      scheduler_runs_deleted: schedulerRuns.count,
      relationship_adjustment_logs_deleted: relationshipAdjustmentLogs.count,
      snr_adjustment_logs_deleted: snrAdjustmentLogs.count,
      decision_jobs_deleted: decisionJobs.count,
      action_intents_deleted: actionIntents.count,
      inference_traces_deleted: inferenceTraces.count,
      scheduler_rebalance_recommendations_deleted: schedulerRebalanceRecommendations.count,
      scheduler_ownership_migrations_deleted: schedulerOwnershipMigrations.count,
      scheduler_worker_runtime_states_deleted: schedulerWorkerRuntimeStates.count,
      scheduler_partition_assignments_deleted: schedulerPartitionAssignments.count,
      scheduler_cursor_deleted: schedulerCursor.count,
      scheduler_lease_deleted: schedulerLease.count
    } satisfies DevRuntimeResetSummary;
  });
};

export const getRuntimeStatusSnapshot = async (
  context: AppContext,
  options?: {
    schedulerWorkerId?: string;
    schedulerPartitionIds?: string[];
  }
): Promise<RuntimeStatusSnapshot> => {
  const pack = context.activePack.getActivePack();
  const schedulerWorkerId = options?.schedulerWorkerId ?? process.env.SCHEDULER_WORKER_ID ?? `scheduler:${process.pid}`;
  const visibleClock = readVisibleClockSnapshot(context);
  const runtimeKernel = createRuntimeKernelService(context);
  const ownershipSnapshot = await runtimeKernel.getOwnershipSnapshot({
    workerId: schedulerWorkerId,
    partitionIds: options?.schedulerPartitionIds
  });
  const runtimeLoop = runtimeKernel.getLoopDiagnostics() ?? context.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS;

  return {
    status: context.getPaused() ? 'paused' : 'running',
    runtime_ready: context.getRuntimeReady(),
    runtime_speed: context.activePackRuntime!.getRuntimeSpeedSnapshot(),
    runtime_loop: runtimeLoop,
    database: context.getDatabaseHealth?.() ?? null,
    scheduler: {
      worker_id: ownershipSnapshot.worker_id,
      partition_count: ownershipSnapshot.partition_count,
      owned_partition_ids: ownershipSnapshot.owned_partition_ids,
      assignment_source: ownershipSnapshot.assignment_source,
      migration_in_progress_count: ownershipSnapshot.migration_in_progress_count,
      worker_runtime_status: ownershipSnapshot.worker_runtime_status,
      last_heartbeat_at: ownershipSnapshot.last_heartbeat_at?.toString() ?? null,
      automatic_rebalance_enabled: ownershipSnapshot.automatic_rebalance_enabled
    },
    ai: {
      gateway_enabled: isAiGatewayEnabled()
    },
    health_level: context.startupHealth.level,
    world_pack: pack
      ? {
          id: pack.metadata.id,
          name: pack.metadata.name,
          version: pack.metadata.version,
          ...(pack.metadata.description ? { description: pack.metadata.description } : {}),
          ...(pack.metadata.authors ? { authors: pack.metadata.authors } : {}),
          ...(pack.metadata.license ? { license: pack.metadata.license } : {}),
          ...(pack.metadata.homepage ? { homepage: pack.metadata.homepage } : {}),
          ...(pack.metadata.repository ? { repository: pack.metadata.repository } : {}),
          ...(pack.metadata.tags ? { tags: pack.metadata.tags } : {}),
          ...(pack.metadata.compatibility ? { compatibility: pack.metadata.compatibility } : {})
        }
      : null,

    world_time: visibleClock,

    has_error: context.notifications.getMessages().some(message => message.level === 'error'),
    startup_errors: context.startupHealth.errors
  };
};

export const getStartupHealthSnapshot = (
  context: AppContext
): { statusCode: number; body: StartupHealthSnapshot } => {
  const statusCode = context.startupHealth.level === 'fail' ? 503 : 200;

  return {
    statusCode,
    body: {
      healthy: context.startupHealth.level !== 'fail',
      level: context.startupHealth.level,
      runtime_ready: context.getRuntimeReady(),
      checks: context.startupHealth.checks,
      available_world_packs: context.startupHealth.available_world_packs,
      errors: context.startupHealth.errors
    }
  };
};
