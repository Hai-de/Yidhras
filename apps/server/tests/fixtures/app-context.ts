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
import { createNotificationManager } from '../../src/utils/notifications.js';
import { DEFAULT_E2E_WORLD_PACK } from '../support/config.js';

export interface CreateTestAppContextOptions {
  paused?: boolean;
  runtimeReady?: boolean;
  runtimeLoopDiagnostics?: RuntimeLoopDiagnostics;
  startupHealth?: StartupHealth;
  activePackId?: string;
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

const buildMinimalActivePack = (packId: string) => ({
  metadata: { id: packId, name: packId, version: '0.1.0' }
});

export const createTestAppContext = (
  prisma: PrismaClient,
  options: CreateTestAppContextOptions = {}
): AppContext => {
  let paused = options.paused ?? false;
  let runtimeReady = options.runtimeReady ?? true;
  let runtimeLoopDiagnostics = options.runtimeLoopDiagnostics ?? createDefaultRuntimeLoopDiagnostics();
  const clock = new ChronosEngine({ calendarConfigs: [], initialTicks: 1000n });
  let httpApp: Express | null = null;
  const defaultPackId = options.activePackId ?? DEFAULT_E2E_WORLD_PACK;

  // Track experimentally loaded pack IDs so hasPackRuntime can answer correctly.
  const loadedExperimentalPackIds = new Set<string>();

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
    getActivePack: () => buildMinimalActivePack(defaultPackId),
    getCurrentRevision: () => clock.getTicks(),
    applyClockProjection: (snapshot: { current_tick: string }) => {
      clock.setTicks(BigInt(snapshot.current_tick));
    },
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
    notifications: createNotificationManager(),
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
      getActivePackId: () => {
        const pack = sim.getActivePack();
        return pack ? (pack as { metadata: { id: string } }).metadata.id : null;
      },
      hasPackRuntime: (packId: string) =>
        loadedExperimentalPackIds.has(packId.trim()) || sim.getPackRuntimeHandle(packId.trim()) !== null,
      assertPackScope: (packId: string) => packId.trim(),
      getPackRuntimeSummary: () => null
    },
    packRuntimeObservation: {
      getStatus: () => null,
      listStatuses: () => [],
      getClockSnapshot: () => null,
      getRuntimeSpeedSnapshot: () => null
    },
    activePackRuntime: {
      getActivePack() {
        return sim.getActivePack();
      },
      getRuntimeSpeedSnapshot: () => ({
        mode: 'fixed' as const,
        source: 'default' as const,
        configured_step_ticks: null,
        override_step_ticks: null,
        override_since: null,
        effective_step_ticks: '1'
      }),
      getCurrentRevision: () => clock.getTicks(),
      resolvePackVariables: (template: string) => template,
      getStepTicks: () => 1n,
      getCurrentTick: () => clock.getTicks()
    } as unknown as AppContext['activePackRuntime'],
    packRuntimeControl: {
      load: async (packRef: string) => {
        loadedExperimentalPackIds.add(packRef.trim());
        return {
          handle: { pack_id: packRef.trim() } as never,
          loaded: true,
          already_loaded: false
        };
      },
      unload: async (packId: string) => {
        loadedExperimentalPackIds.delete(packId.trim());
        return true;
      }
    },
    assertRuntimeReady: () => {}
  };
};
