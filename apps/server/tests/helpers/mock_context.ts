import type { AppContext, RuntimeLoopDiagnostics, StartupHealth } from '../../src/app/context.js';
import { createWorldEngineStepCoordinator } from '../../src/app/runtime/world_engine_persistence.js';
import type { PackRuntimePort } from '../../src/app/services/pack/pack_runtime_ports.js';
import { ChronosEngine } from '../../src/clock/engine.js';
import { createNotificationManager } from '../../src/utils/notifications.js';
import { wrapPrismaAsRepositories } from './mock_repos.js';
import { type DeepMockProxy, createMockPrisma } from './prisma_mock.js';
import { DEFAULT_E2E_WORLD_PACK } from '../support/config.js';

export interface CreateMockAppContextOptions {
  /** Override specific AppContext properties. DeepMockProxy fields from createMockPrisma() can be passed here. */
  overrides?: Partial<AppContext>;
  /** If true, configures $transaction to passthrough callbacks (interactive transaction pattern). Default false. */
  transactionPassthrough?: boolean;
}

const defaultLoopDiagnostics = (): RuntimeLoopDiagnostics => ({
  status: 'idle',
  in_flight: false,
  overlap_skipped_count: 0,
  iteration_count: 0,
  last_started_at: null,
  last_finished_at: null,
  last_duration_ms: null,
  last_error_message: null
});

const defaultStartupHealth = (): StartupHealth => ({
  level: 'ok',
  checks: { db: true, world_pack_dir: true, world_pack_available: true },
  available_world_packs: [DEFAULT_E2E_WORLD_PACK],
  errors: []
});

const buildPackRuntimeStub = (): PackRuntimePort => {
  const clock = new ChronosEngine({ calendarConfigs: [], initialTicks: 1000n });
  return {
    getPackId: () => DEFAULT_E2E_WORLD_PACK,
    getCurrentTick: () => clock.getTicks(),
    getCurrentRevision: () => clock.getTicks(),
    getPack: () => ({ metadata: { id: DEFAULT_E2E_WORLD_PACK, name: DEFAULT_E2E_WORLD_PACK, version: '0.1.0' } }) as never,
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
    applyClockProjection: (snapshot: { current_tick: string }) => {
      clock.setTicks(BigInt(snapshot.current_tick));
    }
  };
};

/**
 * Creates a minimal AppContext backed by a DeepMockProxy<PrismaClient>.
 * Every prisma model method is automatically a vi.fn().
 *
 * The returned context is suitable for unit-testing services and routes
 * that access context.prisma or context.repos. Use .overrides to
 * replace specific properties (e.g. conversationStore, packStorageAdapter).
 *
 * @example
 * const ctx = createMockAppContext();
 * ctx.prisma.agent.findUnique.mockResolvedValue({ id: 'a1', name: 'Test' });
 * const result = await someService(ctx, 'a1');
 * expect(ctx.prisma.agent.findUnique).toHaveBeenCalledWith({ where: { id: 'a1' } });
 */
export const createMockAppContext = (options: CreateMockAppContextOptions = {}): AppContext => {
  const prisma = (options.overrides?.prisma as DeepMockProxy<AppContext['prisma']> | undefined)
    ?? createMockPrisma();

  if (options.transactionPassthrough) {
    prisma.$transaction.mockImplementation(
      async (arg: unknown): Promise<unknown> => {
        if (typeof arg === 'function') {
          return (arg as (tx: unknown) => unknown)(prisma);
        }
        return [];
      }
    );
  }

  const packRuntime = buildPackRuntimeStub();
  const loadedPackIds = new Set([DEFAULT_E2E_WORLD_PACK]);
  let paused = false;
  let runtimeReady = true;
  let loopDiagnostics = defaultLoopDiagnostics();

  const base: AppContext = {
    repos: wrapPrismaAsRepositories(prisma as never),
    prisma: prisma as never,
    packRuntime,
    conversationStore: {
      getOrCreate: async () => ({ id: '', owner_agent_id: '', conversation_id: '', entries: [] }),
      getById: async () => null,
      listByAgent: async () => [],
      create: async (params: Record<string, unknown>) => ({
        id: (params as Record<string, string>).conversationId ?? '',
        owner_agent_id: (params as Record<string, string>).ownerAgentId ?? '',
        conversation_id: (params as Record<string, string>).conversationId ?? '',
        entries: []
      }),
      appendEntry: async () => {},
      appendEntriesInTransaction: async () => {},
      modifyEntry: async () => {},
      getEntries: async () => [],
      updateSummary: async () => {},
      archiveEntries: async () => {},
      deleteMemory: async () => {}
    } as AppContext['conversationStore'],
    packStorageAdapter: {
      backend: 'sqlite',
      ping: async () => true,
      destroyPackStorage: async () => {},
      ensureEngineOwnedSchema: async () => {},
      listEngineOwnedRecords: async () => [],
      upsertEngineOwnedRecord: async (_packId: string, _tableName: string, record: unknown) => record as never,
      ensureCollection: async () => {},
      upsertCollectionRecord: async () => null,
      listCollectionRecords: async () => [],
      exportPackData: async () => ({}),
      importPackData: async () => {}
    } as AppContext['packStorageAdapter'],
    notifications: createNotificationManager(),
    startupHealth: defaultStartupHealth(),
    isRuntimeReady: () => runtimeReady,
    setRuntimeReady: (ready: boolean) => { runtimeReady = ready; },
    isPaused: () => paused,
    setPaused: (next: boolean) => { paused = next; },
    getRuntimeLoopDiagnostics: () => loopDiagnostics,
    setRuntimeLoopDiagnostics: (next: RuntimeLoopDiagnostics) => { loopDiagnostics = next; },
    assertRuntimeReady: () => {},
    getPackRuntimeHandle: (packId: string) => {
      if (!loadedPackIds.has(packId)) return null;
      return {
        pack_id: packId,
        pack_folder_name: packId,
        pack: packRuntime.getPack(),
        getClockSnapshot: () => ({ current_tick: packRuntime.getCurrentTick().toString() }),
        getRuntimeSpeedSnapshot: () => packRuntime.getRuntimeSpeedSnapshot(),
        getHealthSnapshot: () => ({ status: 'loaded' as const, message: null })
      };
    },
    listLoadedPackRuntimeIds: () => [...loadedPackIds],
    getPackRuntimeHost: (packId: string) =>
      loadedPackIds.has(packId)
        ? ({
          getCurrentTick: () => packRuntime.getCurrentTick(),
          getCurrentRevision: () => packRuntime.getCurrentRevision(),
          getPack: () => packRuntime.getPack(),
          getRuntimeSpeedSnapshot: () => packRuntime.getRuntimeSpeedSnapshot(),
          getAllTimes: () => packRuntime.getAllTimes(),
          getPackId: () => packId,
          getStepTicks: () => packRuntime.getStepTicks(),
          step: async () => {},
          applyClockProjection: (snapshot: { current_tick: string }) => {}
        } as AppContext['getPackRuntimeHost'] extends (...args: unknown[]) => infer R ? R : never)
        : null,
    worldEngineStepCoordinator: createWorldEngineStepCoordinator(),
    schedulerStorage: undefined,
    packScope: {
      resolveToPackId: () => DEFAULT_E2E_WORLD_PACK,
      resolveAll: () => []
    } as AppContext['packScope'],
    packCatalog: {
      listAvailablePacks: () => [DEFAULT_E2E_WORLD_PACK],
      getPacksDir: () => '/tmp/mock-packs',
      resolveByInstanceId: () => null,
      getLoader: () => ({}) as AppContext['packCatalog']['getLoader'] extends (...args: unknown[]) => infer R ? R : never
    } as AppContext['packCatalog'],
    packRuntimeLookup: {
      hasPackRuntime: (packId: string) => loadedPackIds.has(packId),
      assertPackScope: (packId: string) => packId,
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
        loadedPackIds.add(packRef.trim());
        return { handle: { pack_id: packRef.trim() } as never, loaded: true, already_loaded: false };
      },
      unload: async (packId: string) => {
        loadedPackIds.delete(packId.trim());
        return true;
      }
    },
    getDatabaseHealth: () => null,
    getPluginEnableWarningConfig: () => ({ enabled: false, require_acknowledgement: false }),
    runtimeClockProjection: undefined,
    getSpatialRuntime: () => null
  };

  if (options.overrides) {
    return { ...base, ...options.overrides } as AppContext;
  }

  return base;
};
