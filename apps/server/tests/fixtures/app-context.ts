import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import type {
  AppContext,
  RuntimeLoopDiagnostics,
  StartupHealth
} from '../../src/app/context.js';
import { createWorldEngineStepCoordinator } from '../../src/app/runtime/world_engine_persistence.js';
import { ChronosEngine } from '../../src/clock/engine.js';
import type { SimulationManager } from '../../src/core/simulation.js';
import { notifications } from '../../src/utils/notifications.js';
import { DEFAULT_E2E_WORLD_PACK } from '../support/config.js';

export interface CreateTestAppContextOptions {
  paused?: boolean;
  runtimeReady?: boolean;
  runtimeLoopDiagnostics?: RuntimeLoopDiagnostics;
  startupHealth?: StartupHealth;
}

export const createDefaultRuntimeLoopDiagnostics = (): RuntimeLoopDiagnostics => ({
  status: 'idle',
  in_flight: false,
  overlap_skipped_count: 0,
  iteration_count: 0,
  last_started_at: null,
  last_finished_at: null,
  last_duration_ms: null,
  last_error_message: null
});

const createDefaultStartupHealth = (): StartupHealth => ({
  level: 'ok',
  checks: {
    db: true,
    world_pack_dir: true,
    world_pack_available: true
  },
  available_world_packs: [DEFAULT_E2E_WORLD_PACK],
  errors: []
});

export const createTestAppContext = (
  prisma: PrismaClient,
  options: CreateTestAppContextOptions = {}
): AppContext => {
  let paused = options.paused ?? false;
  let runtimeReady = options.runtimeReady ?? true;
  let runtimeLoopDiagnostics = options.runtimeLoopDiagnostics ?? createDefaultRuntimeLoopDiagnostics();
  const clock = new ChronosEngine([], 1000n);
  let httpApp: Express | null = null;

  const sim = {
    prisma,
    clock,
    getCurrentTick() {
      return clock.getTicks();
    },
    getAllTimes() {
      return clock.getAllTimes();
    },
    getStepTicks: () => 1n,
    step: async () => {},
    getActivePack: () => null,
    getCurrentRevision: () => clock.getTicks(),
    getRuntimeSpeedSnapshot: () => ({
      mode: 'fixed' as const,
      source: 'default' as const,
      configured_step_ticks: null,
      override_step_ticks: null,
      override_since: null,
      effective_step_ticks: '1'
    }),
    getSqliteRuntimePragmaSnapshot: () => null,
    setRuntimeSpeedOverride: () => {},
    clearRuntimeSpeedOverride: () => {},
    isExperimentalMultiPackRuntimeEnabled: () => false,
    loadExperimentalPackRuntime: async () => ({ handle: null, loaded: false, already_loaded: false }),
    getPackRuntimeHandle: () => null
  } as unknown as SimulationManager;

  return {
    prisma,
    sim,
    clock: sim as unknown as AppContext['clock'],
    activePack: sim as unknown as AppContext['activePack'],
    notifications,
    startupHealth: options.startupHealth ?? createDefaultStartupHealth(),
    getRuntimeReady: () => runtimeReady,
    setRuntimeReady: ready => {
      runtimeReady = ready;
    },
    getPaused: () => paused,
    setPaused: next => {
      paused = next;
    },
    getRuntimeLoopDiagnostics: () => runtimeLoopDiagnostics,
    setRuntimeLoopDiagnostics: next => {
      runtimeLoopDiagnostics = next;
    },
    getSqliteRuntimePragmas: () => null,
    getHttpApp: () => httpApp,
    setHttpApp: app => {
      httpApp = app;
    },
    worldEngineStepCoordinator: createWorldEngineStepCoordinator(),
    packRuntimeLookup: {
      getActivePackId: () => null,
      hasPackRuntime: () => false,
      assertPackScope: (packId: string) => packId.trim(),
      getPackRuntimeSummary: () => null
    },
    packRuntimeObservation: {
      getStatus: () => null,
      listStatuses: () => [],
      getClockSnapshot: () => null,
      getRuntimeSpeedSnapshot: () => null
    },
    packRuntimeControl: {
      load: async () => ({ handle: null as never, loaded: false, already_loaded: false }),
      unload: async () => false
    },
    assertRuntimeReady: () => {}
  };
};
