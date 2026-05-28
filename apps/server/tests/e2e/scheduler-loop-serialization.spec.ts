import { describe, expect, it } from 'vitest';

import { assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { requestJson, sleep } from '../helpers/server.js';
import { E2ETestKit } from '../testkit_e2e.js';

describe('scheduler loop serialization e2e', () => {
  it('keeps the runtime loop serialized while delayed iterations are in flight', async () => {
    const kit = await E2ETestKit.create({
      port: 3112,
      envOverrides: {
        DEV_RUNTIME_RESET_ON_START: '1',
        SIM_LOOP_INTERVAL_MS: '50',
        SIM_LOOP_TEST_DELAY_MS: '250'
      }
    });
    try {
      await kit.startServer();
      await sleep(900);

      const response = await requestJson(kit.baseUrl, '/api/status');
      expect(response.status).toBe(200);

      const data = assertSuccessEnvelopeData(response.body, '/api/status');
      const runtimeLoop = assertRecord(data.runtime_loop, 'runtime_loop');

      expect(typeof runtimeLoop.iteration_count).toBe('number');
      expect((runtimeLoop.iteration_count as number) >= 2).toBe(true);
      expect(runtimeLoop.overlap_skipped_count).toBe(0);
      expect(typeof runtimeLoop.last_duration_ms).toBe('number');
      expect((runtimeLoop.last_duration_ms as number) >= 250).toBe(true);
      expect(['idle', 'scheduled', 'running']).toContain(runtimeLoop.status);
    } finally {
      await kit[Symbol.asyncDispose]();
    }
  });
});
