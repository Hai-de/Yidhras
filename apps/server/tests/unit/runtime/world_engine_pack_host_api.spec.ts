import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';
import { describe, expect, it } from 'vitest';

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

    await expect(hostApi.getCurrentTick({ pack_id: 'world-death-note' })).rejects.toThrow('activePackRuntime is required for world engine host operations');

    await expect(hostApi.queryWorldState({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-death-note',
      query_name: 'pack_summary',
      selector: {}
    })).rejects.toThrow('activePackRuntime is required for world engine host operations');
  });
});
