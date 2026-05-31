import type { RuntimeLoopDiagnostics } from '../app/context.js';
import type { createRuntimeReadyGuard, createStartupHealth } from '../app/runtime/startup.js';

export interface CliConfig {
  workerIndex: number;
  port: number;
  schedulerWorkerId: string;
  schedulerPartitionIds: string[];
  simulationLoopIntervalMs: number;
  worldPacksDir: string;
  preferredWorldPack: string;
  startupPolicy: import('../config/runtime_config.js').RuntimeStartupPolicy;
  decisionWorkerId: string;
  actionDispatcherWorkerId: string;
}

export interface RuntimeState {
  startupHealth: ReturnType<typeof createStartupHealth>;
  assertRuntimeReady: ReturnType<typeof createRuntimeReadyGuard>;
  isRuntimeReady: () => boolean;
  setRuntimeReady: (ready: boolean) => void;
  isPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  getRuntimeLoopDiagnostics: () => RuntimeLoopDiagnostics;
  setRuntimeLoopDiagnostics: (next: RuntimeLoopDiagnostics) => void;
}
