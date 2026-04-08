import type { PrismaClient } from '@prisma/client';

import type { AppContext, RuntimeLoopDiagnostics, StartupHealth } from '../../src/app/context.js';
import { ChronosEngine } from '../../src/clock/engine.js';
import type { SimulationManager } from '../../src/core/simulation.js';
import { DEFAULT_E2E_WORLD_PACK } from '../support/config.js';
import { notifications } from '../../src/utils/notifications.js';

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
    clearRuntimeSpeedOverride: () => {}
  } as unknown as SimulationManager;

  return {
    prisma,
    sim,
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
    assertRuntimeReady: () => {}
  };
};
