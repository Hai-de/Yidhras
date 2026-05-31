import type { RuntimeLoopDiagnostics } from '../../app/context.js';
import { resolveOwnedSchedulerPartitionIds } from '../../app/runtime/scheduler_partitioning.js';
import { createRuntimeReadyGuard, createStartupHealth } from '../../app/runtime/startup.js';
import {
  getAppPort,
  getPreferredWorldPack,
  getSimulationLoopIntervalMs,
  getStartupPolicy,
  getWorldPacksDir,
  type RuntimeStartupPolicy
} from '../../config/runtime_config.js';
import type { CliConfig, RuntimeState } from '../token_interfaces.js';
export type { CliConfig, RuntimeState };
import { TOKENS } from '../tokens.js';

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

export const cliConfigProvider = {
  provide: TOKENS.cliConfig,
  useFactory: (): CliConfig => {
    const parseCliInt = (key: string): string | undefined => {
      const arg = process.argv.find(a => a.startsWith(`--${key}=`));
      if (!arg) return undefined;
      const value = arg.slice(key.length + 3);
      if (!/^\d+$/.test(value)) return undefined;
      return value;
    };
    const cliWorkerIndex = parseCliInt('worker-index');
    const cliWorkerTotal = parseCliInt('worker-total');
    if (cliWorkerIndex !== undefined) process.env['SCHEDULER_WORKER_INDEX'] = cliWorkerIndex;
    if (cliWorkerTotal !== undefined) process.env['SCHEDULER_WORKER_TOTAL'] = cliWorkerTotal;

    const workerIndex = parseInt(process.env['SCHEDULER_WORKER_INDEX'] ?? '0', 10) || 0;
    const schedulerWorkerId = process.env['SCHEDULER_WORKER_ID'] ?? `scheduler:${process.pid}:${Date.now()}`;

    return {
      workerIndex,
      port: getAppPort() + workerIndex,
      schedulerWorkerId,
      schedulerPartitionIds: resolveOwnedSchedulerPartitionIds({ workerId: schedulerWorkerId }),
      simulationLoopIntervalMs: getSimulationLoopIntervalMs(),
      worldPacksDir: getWorldPacksDir(),
      preferredWorldPack: getPreferredWorldPack(),
      startupPolicy: getStartupPolicy(),
      decisionWorkerId: `decision:${process.pid}:${Date.now()}`,
      actionDispatcherWorkerId: `dispatcher:${process.pid}:${Date.now()}`
    };
  }
} as const satisfies import('../provider.js').ServiceProvider;

export const runtimeStateProvider = {
  provide: TOKENS.runtimeState,
  useFactory: (): RuntimeState => {
    let runtimeReady = false;
    const startupHealth = createStartupHealth();
    let runtimeLoopDiagnostics: RuntimeLoopDiagnostics = { ...DEFAULT_RUNTIME_LOOP_DIAGNOSTICS };

    return {
      startupHealth,
      assertRuntimeReady: createRuntimeReadyGuard({
        getRuntimeReady: () => runtimeReady,
        startupHealth
      }),
      isRuntimeReady: () => runtimeReady,
      setRuntimeReady: (ready: boolean) => { runtimeReady = ready; },
      isPaused: () => false,
      setPaused: () => {},
      getRuntimeLoopDiagnostics: () => runtimeLoopDiagnostics,
      setRuntimeLoopDiagnostics: (next: RuntimeLoopDiagnostics) => {
        runtimeLoopDiagnostics = next;
      }
    };
  }
} as const satisfies import('../provider.js').ServiceProvider;
