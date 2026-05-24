import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app/context.js';
import {
  buildExperimentalPackRuntimeRegistrySnapshot,
  buildExperimentalSystemHealthSnapshot,
  getExperimentalPackRuntimeStatusSnapshot,
  registerExperimentalPackRuntimeHost
} from '../../src/app/services/runtime/experimental_multi_pack_runtime.js';
import type { PackRuntimeHandle } from '../../src/core/pack_runtime_handle.js';
import { InMemoryPackRuntimeRegistry } from '../../src/core/pack_runtime_registry.js';
import type { RuntimeSpeedSnapshot } from '../../src/core/runtime_speed.js';

const defaultStrategy = {
  kind: 'variable' as const,
  range: { min: 1n, max: 1n },
  loopIntervalMs: 1000
};

const createHandle = (packId: string): PackRuntimeHandle => ({
  pack_id: packId,
  pack_folder_name: packId,
  pack: {
    metadata: {
      id: packId,
      name: packId,
      version: '0.0.1'
    }
  } as never,
  getClockSnapshot: () => ({ current_tick: '0' }),
  getRuntimeSpeedSnapshot: (): RuntimeSpeedSnapshot => ({
    mode: 'variable',
    source: 'world_pack',
    strategy: defaultStrategy,
    effective_step_ticks: '1',
    override_since: null
  }),
  getHealthSnapshot: () => ({ status: 'loaded', message: null })
});

const makeSpeedSnapshot = (overrides: Partial<RuntimeSpeedSnapshot> = {}): RuntimeSpeedSnapshot => ({
  mode: 'variable',
  source: 'world_pack',
  strategy: defaultStrategy,
  effective_step_ticks: '1',
  override_since: null,
  ...overrides
});

describe('InMemoryPackRuntimeRegistry', () => {
  it('registers, lists, and unregisters runtime hosts', () => {
    const registry = new InMemoryPackRuntimeRegistry();
    const host = {
      getHandle: vi.fn(() => createHandle('pack-a'))
    } as never;

    registerExperimentalPackRuntimeHost(registry, 'pack-a', host);

    expect(registry.listLoadedPackIds()).toEqual(['pack-a']);
    expect(registry.getHandle('pack-a')?.pack_id).toBe('pack-a');
    expect(registry.unregister('pack-a')).toBe(true);
    expect(registry.listLoadedPackIds()).toEqual([]);
  });

  it('builds an async control-plane snapshot from registered handles', async () => {
    const registry = new InMemoryPackRuntimeRegistry();
    const hostA = { getHandle: () => createHandle('pack-a') } as never;
    const hostB = {
      getHandle: () => ({
        ...createHandle('pack-b'),
        getClockSnapshot: () => ({ current_tick: '42' }),
        getRuntimeSpeedSnapshot: (): RuntimeSpeedSnapshot => ({
          mode: 'variable',
          source: 'override',
          strategy: { kind: 'variable', range: { min: 1n, max: 2n }, loopIntervalMs: 1000 },
          effective_step_ticks: '2',
          override_since: 123
        }),
        getHealthSnapshot: () => ({ status: 'running' as const, message: 'bootstrapped' })
      })
    } as never;

    registry.register('pack-a', hostA);
    registry.register('pack-b', hostB);

    const context = {
      prisma: {} as never,
      startupHealth: {
        level: 'ok',
        checks: {
          db: true,
          world_pack_dir: true,
          world_pack_available: true
        },
        available_world_packs: ['pack-a', 'pack-b'],
        errors: []
      },
      getRuntimeReady: () => true,
      packRuntimeLookup: {
        hasPackRuntime: (packId: string) => ['pack-a', 'pack-b'].includes(packId),
        assertPackScope: (packId: string) => packId,
        getPackRuntimeSummary: (packId: string) => {
          if (packId === 'pack-a') {
            return {
              pack_id: 'pack-a',
              pack_folder_name: 'pack-a',
              health_status: 'loaded' as const,
              current_tick: '0',
              runtime_ready: true
            };
          }
          if (packId === 'pack-b') {
            return {
              pack_id: 'pack-b',
              pack_folder_name: 'pack-b',
              health_status: 'running' as const,
              current_tick: '42',
              runtime_ready: false
            };
          }
          return null;
        }
      } as never,
      packRuntimeObservation: {
        getStatus: (packId: string) => {
          if (packId === 'pack-a') {
            return {
              pack_id: 'pack-a',
              pack_folder_name: 'pack-a',
              health_status: 'loaded' as const,
              current_tick: '0',
              runtime_speed: makeSpeedSnapshot(),
              startup_level: 'ok' as const,
              runtime_ready: true,
              message: null
            };
          }
          if (packId === 'pack-b') {
            return {
              pack_id: 'pack-b',
              pack_folder_name: 'pack-b',
              health_status: 'running' as const,
              current_tick: '42',
              runtime_speed: makeSpeedSnapshot({
                source: 'override',
                strategy: { kind: 'variable', range: { min: 1n, max: 2n }, loopIntervalMs: 1000 },
                effective_step_ticks: '2',
                override_since: 123
              }),
              startup_level: 'ok' as const,
              runtime_ready: false,
              message: 'bootstrapped'
            };
          }
          return null;
        },
        listStatuses: () => [],
        getClockSnapshot: () => null,
        getRuntimeSpeedSnapshot: (packId: string) => {
          if (packId === 'pack-a') {
            return makeSpeedSnapshot();
          }
          if (packId === 'pack-b') {
            return makeSpeedSnapshot({
              source: 'override',
              strategy: { kind: 'variable', range: { min: 1n, max: 2n }, loopIntervalMs: 1000 },
              effective_step_ticks: '2',
              override_since: 123
            });
          }
          return null;
        }
      } as never,
      listLoadedPackRuntimeIds: () => registry.listLoadedPackIds(),
      packRuntime: { getPack: () => ({ metadata: { id: 'pack-a' } }), getCurrentRevision: () => 1n } as AppContext['packRuntime'],
      isRuntimeReady: () => true,
      isPaused: () => false
    } as unknown as AppContext;

    await expect(buildExperimentalPackRuntimeRegistrySnapshot(context)).resolves.toEqual({
      system_health_level: 'ok',
      runtime_ready: true,
      loaded_pack_ids: ['pack-a', 'pack-b'],
      items: [
        {
          pack_id: 'pack-a',
          mode: 'loaded',
          runtime_ready: true,
          status: 'loaded',
          message: null,
          current_tick: '0',
          runtime_speed: {
            mode: 'variable',
            step_ticks: '1',
            range: { min: '1', max: '1' },
            overridden: false
          },
          scheduler: {
            summary_available: true,
            ownership_available: true,
            workers_available: true,
            operator_available: true
          },
          plugin_runtime: {
            installed_enabled_plugin_count: 0,
            web_surface_available: false
          }
        },
        {
          pack_id: 'pack-b',
          mode: 'loaded',
          runtime_ready: true,
          status: 'running',
          message: 'bootstrapped',
          current_tick: '42',
          runtime_speed: {
            mode: 'variable',
            step_ticks: '2',
            range: { min: '1', max: '2' },
            overridden: true
          },
          scheduler: {
            summary_available: true,
            ownership_available: true,
            workers_available: true,
            operator_available: true
          },
          plugin_runtime: {
            installed_enabled_plugin_count: 0,
            web_surface_available: false
          }
        }
      ],
      startup_errors: []
    });
  });

  it('builds per-pack runtime status and system health snapshots conservatively', async () => {
    const handle = createHandle('pack-a');
    const context = {
      startupHealth: {
        level: 'degraded',
        checks: {
          db: true,
          world_pack_dir: true,
          world_pack_available: true
        },
        available_world_packs: ['pack-a', 'pack-b'],
        errors: ['operator experimental mode']
      },
      getRuntimeReady: () => true,
      prisma: {} as never,
      packRuntimeLookup: {
        hasPackRuntime: (packId: string) => packId === 'pack-a',
        assertPackScope: (packId: string) => packId,
        getPackRuntimeSummary: (packId: string) => (packId === 'pack-a'
          ? {
              pack_id: 'pack-a',
              pack_folder_name: 'pack-a',
              health_status: 'loaded' as const,
              current_tick: '0',
              runtime_ready: true
            }
          : null)
      } as never,
      packRuntimeObservation: {
        getStatus: (packId: string) => (packId === 'pack-a'
          ? {
              pack_id: 'pack-a',
              pack_folder_name: 'pack-a',
              health_status: 'loaded' as const,
              current_tick: '0',
              runtime_speed: makeSpeedSnapshot(),
              startup_level: 'degraded' as const,
              runtime_ready: true,
              message: null
            }
          : null),
        listStatuses: () => [],
        getClockSnapshot: () => null,
        getRuntimeSpeedSnapshot: (packId: string) => (packId === 'pack-a'
          ? makeSpeedSnapshot()
          : null)
      } as never,
      getPackRuntimeHandle: (packId: string) => (packId === 'pack-a' ? handle : null),
      listLoadedPackRuntimeIds: () => ['pack-a'],
      packRuntime: { getPack: () => ({ metadata: { id: 'pack-a' } }), getCurrentRevision: () => 1n } as AppContext['packRuntime'],
      isRuntimeReady: () => true,
      isPaused: () => false
    } as unknown as AppContext;

    expect(buildExperimentalSystemHealthSnapshot(context)).toEqual({
      system_health_level: 'degraded',
      runtime_ready: true,
      available_world_packs: ['pack-a', 'pack-b'],
      startup_errors: ['operator experimental mode']
    });

    await expect(getExperimentalPackRuntimeStatusSnapshot(context, 'pack-a')).resolves.toEqual({
      pack_id: 'pack-a',
      pack_folder_name: 'pack-a',
      health_status: 'loaded',
      current_tick: '0',
      runtime_speed: {
        mode: 'variable',
        source: 'world_pack',
        strategy: defaultStrategy,
        effective_step_ticks: '1',
        override_since: null
      },
      startup_level: 'degraded',
      runtime_ready: true,
      message: null,
      control_plane: {
        pack_id: 'pack-a',
        mode: 'loaded',
        runtime_ready: true,
        status: 'loaded',
        message: null,
        current_tick: '0',
        runtime_speed: {
          mode: 'variable',
          step_ticks: '1',
          range: { min: '1', max: '1' },
          overridden: false
        },
        scheduler: {
          summary_available: true,
          ownership_available: true,
          workers_available: true,
          operator_available: true
        },
        plugin_runtime: {
          installed_enabled_plugin_count: 0,
          web_surface_available: false
        }
      }
    });

    await expect(getExperimentalPackRuntimeStatusSnapshot(context, 'pack-b')).resolves.toBeNull();
  });
});
