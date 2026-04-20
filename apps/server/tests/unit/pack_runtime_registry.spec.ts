import { describe, expect, it, vi } from 'vitest';

import {
  buildExperimentalPackRuntimeRegistrySnapshot,
  buildExperimentalSystemHealthSnapshot,
  getExperimentalPackRuntimeStatusSnapshot,
  registerExperimentalPackRuntimeHost
} from '../../src/app/services/experimental_multi_pack_runtime.js';
import type { AppContext } from '../../src/app/context.js';
import type { PackRuntimeHandle } from '../../src/core/pack_runtime_handle.js';
import { InMemoryPackRuntimeRegistry } from '../../src/core/pack_runtime_registry.js';

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
  getRuntimeSpeedSnapshot: () => ({
    mode: 'fixed',
    source: 'world_pack',
    configured_step_ticks: '1',
    override_step_ticks: null,
    override_since: null,
    effective_step_ticks: '1'
  }),
  getHealthSnapshot: () => ({ status: 'loaded', message: null })
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

  it('builds a snapshot from registered handles', () => {
    const registry = new InMemoryPackRuntimeRegistry();
    const hostA = { getHandle: () => createHandle('pack-a') } as never;
    const hostB = {
      getHandle: () => ({
        ...createHandle('pack-b'),
        getClockSnapshot: () => ({ current_tick: '42' }),
        getRuntimeSpeedSnapshot: () => ({
          mode: 'fixed' as const,
          source: 'override' as const,
          configured_step_ticks: '1',
          override_step_ticks: '2',
          override_since: 123,
          effective_step_ticks: '2'
        }),
        getHealthSnapshot: () => ({ status: 'running' as const, message: 'bootstrapped' })
      })
    } as never;

    registry.register('pack-a', hostA);
    registry.register('pack-b', hostB);

    expect(buildExperimentalPackRuntimeRegistrySnapshot(registry)).toEqual({
      loaded_pack_ids: ['pack-a', 'pack-b'],
      items: [
        {
          pack_id: 'pack-a',
          current_tick: '0',
          runtime_speed: {
            mode: 'fixed',
            source: 'world_pack',
            configured_step_ticks: '1',
            override_step_ticks: null,
            override_since: null,
            effective_step_ticks: '1'
          },
          status: 'loaded',
          message: null
        },
        {
          pack_id: 'pack-b',
          current_tick: '42',
          runtime_speed: {
            mode: 'fixed',
            source: 'override',
            configured_step_ticks: '1',
            override_step_ticks: '2',
            override_since: 123,
            effective_step_ticks: '2'
          },
          status: 'running',
          message: 'bootstrapped'
        }
      ]
    });
  });

  it('builds per-pack runtime status and system health snapshots conservatively', () => {
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
      sim: {
        getPackRuntimeHandle: (packId: string) => (packId === 'pack-a' ? handle : null),
        getActivePack: () => ({ metadata: { id: 'pack-a' } })
      }
    } as unknown as AppContext;

    expect(buildExperimentalSystemHealthSnapshot(context)).toEqual({
      system_health_level: 'degraded',
      runtime_ready: true,
      available_world_packs: ['pack-a', 'pack-b'],
      startup_errors: ['operator experimental mode']
    });

    expect(getExperimentalPackRuntimeStatusSnapshot(context, 'pack-a')).toEqual({
      pack_id: 'pack-a',
      pack_folder_name: 'pack-a',
      health_status: 'loaded',
      current_tick: '0',
      runtime_speed: {
        mode: 'fixed',
        source: 'world_pack',
        configured_step_ticks: '1',
        override_step_ticks: null,
        override_since: null,
        effective_step_ticks: '1'
      },
      startup_level: 'degraded',
      runtime_ready: true,
      message: null
    });

    expect(getExperimentalPackRuntimeStatusSnapshot(context, 'pack-b')).toBeNull();
  });
});
