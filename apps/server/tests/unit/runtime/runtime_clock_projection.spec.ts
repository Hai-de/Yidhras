import { describe, expect, it } from 'vitest';

import { createRuntimeClockProjectionService } from '../../../src/app/runtime/runtime_clock_projection.js';

describe('runtime clock projection service', () => {
  it('returns json-safe formatted calendars from host projection reads', () => {
    const projection = createRuntimeClockProjectionService();

    projection.rebuildFromRuntimeSeed({
      pack_id: 'world-test-pack',
      current_tick: '42',
      current_revision: '42',
      calendars: [
        {
          id: 'primary',
          name: 'Primary',
          tick_rate: 1000,
          units: [
            { name: 'tick', ratio: 1 },
            { name: 'cycle', ratio: 10 }
          ]
        }
      ]
    });

    expect(projection.readFormattedClock('world-test-pack')).toEqual({
      absolute_ticks: '42',
      calendars: [{ calendar_id: 'primary', calendar_name: 'Primary', display: '4 cycle 2tick', units: { tick: '2', cycle: '4' } }]
    });
  });
});
