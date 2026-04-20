import { WORLD_ENGINE_PROTOCOL_VERSION } from '@yidhras/contracts';
import { describe, expect, it } from 'vitest';

import { createPackHostApi } from '../../../src/app/runtime/world_engine_ports.js';
import { createTestAppContext } from '../../fixtures/app-context.js';

describe('PackHostApi host boundary', () => {
  it('exposes only host-mediated world-state read methods', async () => {
    const context = createTestAppContext({} as never);
    const hostApi = createPackHostApi(context);

    expect(typeof hostApi.getPackSummary).toBe('function');
    expect(typeof hostApi.getCurrentTick).toBe('function');
    expect(typeof hostApi.queryWorldState).toBe('function');
    expect('prepareStep' in (hostApi as Record<string, unknown>)).toBe(false);
    expect('commitPreparedStep' in (hostApi as Record<string, unknown>)).toBe(false);
    expect('abortPreparedStep' in (hostApi as Record<string, unknown>)).toBe(false);
    expect('loadPack' in (hostApi as Record<string, unknown>)).toBe(false);
    expect('unloadPack' in (hostApi as Record<string, unknown>)).toBe(false);
  });

  it('routes world-state reads through the host-mediated PackHostApi surface', async () => {
    const context = createTestAppContext({} as never);
    const hostApi = createPackHostApi(context);

    const tick = await hostApi.getCurrentTick({ pack_id: 'world-death-note' });
    expect(tick).toBeNull();

    const result = await hostApi.queryWorldState({
      protocol_version: WORLD_ENGINE_PROTOCOL_VERSION,
      pack_id: 'world-death-note',
      query_name: 'pack_summary',
      selector: {}
    });

    expect(result.protocol_version).toBe(WORLD_ENGINE_PROTOCOL_VERSION);
    expect(result.pack_id).toBe('world-death-note');
    expect(result.query_name).toBe('pack_summary');
  });
});
