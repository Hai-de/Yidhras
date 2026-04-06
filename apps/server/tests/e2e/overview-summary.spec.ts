import { describe, expect, it } from 'vitest';

import { assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

describe('overview summary e2e', () => {
  it('returns runtime, world time and audit aggregates for the operator summary page', async () => {
    await withIsolatedTestServer({ defaultPort: 3104 }, async server => {
      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      expect(statusData.runtime_ready).toBe(true);

      const overviewResponse = await requestJson(server.baseUrl, '/api/overview/summary');
      expect(overviewResponse.status).toBe(200);
      const overview = assertSuccessEnvelopeData(overviewResponse.body, 'overview summary response');

      const runtime = assertRecord(overview.runtime, 'overview.runtime');
      expect(typeof runtime.status).toBe('string');
      expect(typeof runtime.runtime_ready).toBe('boolean');

      const worldTime = assertRecord(overview.world_time, 'overview.world_time');
      expect(typeof worldTime.tick).toBe('string');
      expect(Array.isArray(worldTime.calendars)).toBe(true);

      expect(typeof overview.active_agent_count).toBe('number');
      expect(Array.isArray(overview.recent_events)).toBe(true);
      expect(Array.isArray(overview.latest_posts)).toBe(true);
      expect(Array.isArray(overview.latest_propagation)).toBe(true);
      expect(Array.isArray(overview.failed_jobs)).toBe(true);
      expect(Array.isArray(overview.dropped_intents)).toBe(true);
      expect(Array.isArray(overview.notifications)).toBe(true);
    });
  });
});
