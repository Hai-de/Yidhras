import type { PrismaClient } from '@prisma/client';
import type { Express } from 'express';

import type {
  AppContext,
  RuntimeLoopDiagnostics,
  StartupHealth
} from '../../src/app/context.js';
import type { ConversationStore } from '../../src/conversation/store.js';
import { createWorldEngineStepCoordinator } from '../../src/app/runtime/world_engine_persistence.js';
import { ChronosEngine } from '../../src/clock/engine.js';
import type { PackRuntimeHost } from '../../src/core/pack_runtime_host.js';
import type { RuntimeClockProjectionSnapshot } from '../../src/app/runtime/runtime_clock_projection.js';
import type { PackStorageAdapter } from '../../src/packs/storage/PackStorageAdapter.js';
import type { SchedulerStorageAdapter } from '../../src/packs/storage/SchedulerStorageAdapter.js';
import type { PackRuntimePort } from '../../src/app/services/pack/pack_runtime_ports.js';
import type { WorldPack } from '../../src/packs/manifest/loader.js';
import { createNotificationManager } from '../../src/utils/notifications.js';
import { wrapPrismaAsRepositories } from '../helpers/mock_repos.js';
import { DEFAULT_E2E_WORLD_PACK } from '../support/config.js';

export interface CreateTestAppContextOptions {
  paused?: boolean;
  runtimeReady?: boolean;
  runtimeLoopDiagnostics?: RuntimeLoopDiagnostics;
  startupHealth?: StartupHealth;
  schedulerStorage?: SchedulerStorageAdapter;
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

const buildMinimalPack = (packId: string) => ({
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
  const defaultPackId = DEFAULT_E2E_WORLD_PACK;

  const packStore = new Map<string, ReturnType<typeof buildMinimalPack>>();
  packStore.set(defaultPackId, buildMinimalPack(defaultPackId));

  const loadedPackIds = new Set<string>();
  loadedPackIds.add(defaultPackId);

  const packRuntime: PackRuntimePort = {
    getPackId: () => defaultPackId,
    getCurrentTick: () => clock.getTicks(),
    getCurrentRevision: () => clock.getTicks(),
    getPack: () => packStore.get(defaultPackId) as WorldPack,
    resolvePackVariables: (template: string) => template,
    getStepTicks: () => 1n,
    getRuntimeSpeedSnapshot: () => ({
      mode: 'variable' as const,
      source: 'default' as const,
      strategy: { kind: 'variable' as const, range: { min: 1n, max: 1n }, loopIntervalMs: 1000 },
      effective_step_ticks: '1',
      override_since: null
    }),
    setRuntimeSpeedOverride: () => {},
    clearRuntimeSpeedOverride: () => {},
    getAllTimes: () => clock.getAllTimes(),
    step: async () => {},
    getPackSlotDeclarations: () => null,
    applyClockProjection: (snapshot: RuntimeClockProjectionSnapshot) => {
      clock.setTicks(BigInt(snapshot.current_tick));
    }
  };

  const conversationStore: ConversationStore = {
    getOrCreate: async () => ({
      id: '',
      owner_agent_id: '',
      conversation_id: '',
      entries: []
    }),
    getById: async () => null,
    listByAgent: async () => [],
    create: async params => ({
      id: params.conversationId,
      owner_agent_id: params.ownerAgentId,
      conversation_id: params.conversationId,
      display_name: params.displayName,
      entries: [],
      metadata: params.metadata ?? undefined
    }),
    appendEntry: async () => {},
    appendEntriesInTransaction: async () => {},
    modifyEntry: async () => {},
    getEntries: async () => [],
    updateSummary: async () => {},
    archiveEntries: async () => {},
    deleteMemory: async () => {}
  };

  return {
    repos: wrapPrismaAsRepositories(prisma),
    prisma,
    conversationStore,
    packRuntime,
    notifications: createNotificationManager(),
    startupHealth: options.startupHealth ?? createDefaultStartupHealth(),
    isRuntimeReady: () => runtimeReady,
    setRuntimeReady: ready => {
      runtimeReady = ready;
    },
    isPaused: () => paused,
    setPaused: next => {
      paused = next;
    },
    getRuntimeLoopDiagnostics: () => runtimeLoopDiagnostics,
    setRuntimeLoopDiagnostics: next => {
      runtimeLoopDiagnostics = next;
    },
    getHttpApp: () => httpApp,
    setHttpApp: app => {
      httpApp = app;
    },
    worldEngineStepCoordinator: createWorldEngineStepCoordinator(),
    packRuntimeLookup: {
      hasPackRuntime: (packId: string) => loadedPackIds.has(packId.trim()),
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
      load: async (packRef: string) => {
        const packId = packRef.trim();
        packStore.set(packId, buildMinimalPack(packId));
        loadedPackIds.add(packId);
        return {
          handle: { pack_id: packId } as never,
          loaded: true,
          already_loaded: false
        };
      },
      unload: async (packId: string) => {
        loadedPackIds.delete(packId.trim());
        return true;
      }
    },
    assertRuntimeReady: () => {},
    getPackRuntimeHandle: (packId: string) => {
      const pack = packStore.get(packId);
      if (!pack) return null;
      return {
        pack_id: packId,
        pack_folder_name: packId,
        pack,
        getClockSnapshot: () => ({ current_tick: packRuntime.getCurrentTick().toString() }),
        getRuntimeSpeedSnapshot: () => packRuntime.getRuntimeSpeedSnapshot(),
        getHealthSnapshot: () => ({ status: 'loaded' as const, message: null })
      };
    },
    getPackRuntimeHost: (packId: string) =>
      ({
        getCurrentTick: () => packRuntime.getCurrentTick(),
        getCurrentRevision: () => packRuntime.getCurrentRevision(),
        getPack: () => packRuntime.getPack(),
        getRuntimeSpeedSnapshot: () => packRuntime.getRuntimeSpeedSnapshot(),
        getAllTimes: () => packRuntime.getAllTimes(),
        getPackId: () => packId,
        getStepTicks: () => packRuntime.getStepTicks(),
        step: async () => {},
        applyClockProjection: (snapshot: { current_tick: string }) => {
          clock.setTicks(BigInt(snapshot.current_tick));
        }
      }) as unknown as PackRuntimeHost,
    packStorageAdapter: {
      backend: 'sqlite',
      ping: async () => true,
      destroyPackStorage: async () => {},
      ensureEngineOwnedSchema: async () => {},
      listEngineOwnedRecords: async () => [],
      upsertEngineOwnedRecord: async (packId: string, tableName: string, record: unknown) => record as never,
      ensureCollection: async () => {},
      upsertCollectionRecord: async () => null,
      listCollectionRecords: async () => [],
      exportPackData: async () => ({}),
      importPackData: async () => {}
    } as PackStorageAdapter,
    schedulerStorage: options.schedulerStorage ?? {
      open: () => {},
      close: () => {},
      destroyPackSchedulerStorage: () => {},
      listOpenPackIds: () => [],
      upsertLease: () => ({ key: '', partition_id: '', holder: '', acquired_at: 0n, expires_at: 0n }),
      getLease: () => null,
      updateLeaseIfClaimable: () => ({ count: 0 }),
      deleteLeaseByHolder: () => ({ count: 0 }),
      upsertCursor: () => ({ key: '', partition_id: '', last_scanned_tick: 0n, last_signal_tick: 0n, updated_at: 0n }),
      getCursor: () => null,
      getPartition: () => null,
      listPartitions: () => [],
      createPartition: (packId: string, input: Record<string, unknown>) => input as never,
      updatePartition: (packId: string, input: Record<string, unknown>) => input as never,
      listMigrations: () => [],
      countMigrationsInProgress: () => 0,
      getMigrationById: () => null,
      findLatestActiveMigrationForPartition: () => null,
      createMigration: (packId: string, input: Record<string, unknown>) => ({ id: 'mock_migration', ...input }) as never,
      updateMigration: (packId: string, input: Record<string, unknown>) => input as never,
      listWorkerStates: () => [],
      getWorkerState: () => null,
      upsertWorkerState: (packId: string, input: Record<string, unknown>) => input as never,
      updateWorkerStatus: (packId: string, workerId: string, status: string, updatedAt: bigint) => ({ worker_id: workerId, status, updated_at: updatedAt }) as never,
      findOpenRecommendation: () => null,
      createRecommendation: (packId: string, input: Record<string, unknown>) => ({ id: 'mock_rec', ...input }) as never,
      listRecentRecommendations: () => [],
      getRecommendationById: () => null,
      updateRecommendation: (packId: string, input: Record<string, unknown>) => input as never,
      listPendingRecommendationsForWorker: () => [],
      writeDetailedSnapshot: (packId: string, input: Record<string, unknown>) => input,
      writeCandidateDecision: (packId: string, schedulerRunId: string, input: Record<string, unknown>) => input,
      listRuns: () => [],
      listCandidateDecisions: () => [],
      getAgentDecisions: () => []
    } as SchedulerStorageAdapter
  };
};
