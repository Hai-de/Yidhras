import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createPackHostApi } from '../../../src/app/runtime/world_engine_ports.js';
import { createTestAppContext } from '../../fixtures/app-context.js';

const mockWorldEngine = {
  async queryState(input: {
    protocol_version: string;
    pack_id: string;
    query_name: string;
  }) {
    return {
      protocol_version: input.protocol_version,
      pack_id: input.pack_id,
      query_name: input.query_name,
      items: [],
      total_count: 0
    };
  }
} as unknown as import('../../../src/app/runtime/world_engine_ports.js').WorldEnginePort;

const hostApiShape = (value: unknown): Record<string, unknown> => value as Record<string, unknown>;

describe('PackHostApi host boundary', () => {
  it('exposes only host-mediated world-state read methods', async () => {
    const context = createTestAppContext({} as never);
    context.worldEngine = mockWorldEngine;
    const hostApi = createPackHostApi(context);

    expect(typeof hostApi.getPackSummary).toBe('function');
    expect(typeof hostApi.getCurrentTick).toBe('function');
    expect(typeof hostApi.queryWorldState).toBe('function');
    expect('prepareStep' in hostApiShape(hostApi)).toBe(false);
    expect('commitPreparedStep' in hostApiShape(hostApi)).toBe(false);
    expect('abortPreparedStep' in hostApiShape(hostApi)).toBe(false);
    expect('loadPack' in hostApiShape(hostApi)).toBe(false);
    expect('unloadPack' in hostApiShape(hostApi)).toBe(false);
  });

  it('routes world-state reads through the host-mediated PackHostApi surface', async () => {
    const context = createTestAppContext({} as never);
    context.worldEngine = mockWorldEngine;
    const hostApi = createPackHostApi(context);

    await expect(hostApi.getCurrentTick({ pack_id: 'world-death-note' })).resolves.toBeNull();

    await expect(hostApi.queryWorldState({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-death-note',
      query_name: 'pack_summary',
      selector: {}
    })).resolves.toBeDefined();
  });

  it('reads current tick from host-projected truth when runtimeClockProjection is available', async () => {
    const context = createTestAppContext({} as never);
    const getSnapshot = vi.fn().mockReturnValue({
      pack_id: 'world-death-note',
      current_tick: '4242',
      current_revision: '77',
      calendars: [],
      source: 'host_projection',
      updated_at_ms: 123,
      generation: 9
    });
    context.runtimeClockProjection = {
      getSnapshot,
      applyWorldEngineCommitProjection: vi.fn() as never,
      rebuildFromRuntimeSeed: vi.fn() as never
    } as never;
    context.activePackRuntime = {
      getActivePack: () => ({
        metadata: {
          id: 'world-death-note'
        }
      }),
      getCurrentTick: () => 1000n,
      getCurrentRevision: () => 12n,
      getAllTimes: () => [],
      applyClockProjection: vi.fn(),
      getStepTicks: () => 1n,
      getRuntimeSpeedSnapshot: () => ({ effective_step_ticks: '1' })
    } as never;

    const hostApi = createPackHostApi(context);
    await expect(hostApi.getCurrentTick({ pack_id: 'world-death-note' })).resolves.toBe('4242');
    expect(getSnapshot).toHaveBeenCalledWith('world-death-note');
  });
});
