import type { AppContext, RuntimeLoopDiagnostics } from '../context.js';
import {
  getSchedulerOperatorProjection,
  getSchedulerSummarySnapshot,
  listSchedulerOwnershipAssignments,
  listSchedulerWorkers
} from '../services/scheduler_observability.js';
import type {
  RuntimeKernelFacade,
  RuntimeKernelHealthSnapshot,
  SchedulerControlPort,
  SchedulerObservationPort
} from './runtime_kernel_ports.js';
import { reconcileSchedulerBootstrapAssignments, resolveSchedulerOwnershipSnapshot } from './scheduler_ownership.js';

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

export interface RuntimeKernelService extends RuntimeKernelFacade, SchedulerObservationPort, SchedulerControlPort {}

export const createRuntimeKernelService = (context: AppContext, _packId?: string): RuntimeKernelService => {
  return {
    start() {
      context.sim.setPaused(false);
    },
    stop() {
      context.sim.setPaused(true);
    },
    isRunning() {
      return context.sim.isPaused() === false;
    },
    getLoopDiagnostics() {
      return context.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS;
    },
    getHealthSnapshot(): RuntimeKernelHealthSnapshot {
      const diagnostics = context.getRuntimeLoopDiagnostics?.() ?? DEFAULT_RUNTIME_LOOP_DIAGNOSTICS;
      return {
        runtime_ready: context.sim.isRuntimeReady(),
        paused: context.sim.isPaused(),
        loop_status: diagnostics.status
      };
    },
    reconcileBootstrapOwnership(input) {
      reconcileSchedulerBootstrapAssignments(context, input.schedulerWorkerId, input.schedulerPartitionIds, _packId);
    },
    getOwnershipSnapshot(input) {
      const workerId = input?.workerId ?? process.env.SCHEDULER_WORKER_ID ?? `scheduler:${process.pid}`;
      return resolveSchedulerOwnershipSnapshot(context, {
        workerId,
        bootstrapPartitionIds: input?.partitionIds
      }, _packId);
    },
    async getOwnershipAssignments(input) {
      return listSchedulerOwnershipAssignments(context, input ?? {});
    },
    getWorkers(input) {
      return listSchedulerWorkers(context, input ?? {});
    },
    async getSummary(input) {
      return getSchedulerSummarySnapshot(context, input);
    },
    async getOperatorProjection(input) {
      return getSchedulerOperatorProjection(context, input);
    }
  };
};
