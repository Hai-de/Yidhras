import { describe, expect, it } from 'vitest';

import { assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

describe('startup smoke e2e', () => {
  it('exposes coherent health and status snapshots after isolated runtime preparation', async () => {
    await withIsolatedTestServer({ defaultPort: 3101 }, async server => {
      const healthResponse = await requestJson(server.baseUrl, '/api/health');
      expect([200, 503]).toContain(healthResponse.status);
      const healthData = assertSuccessEnvelopeData(healthResponse.body, '/api/health');
      const healthChecks = assertRecord(healthData.checks, '/api/health.checks');

      expect(typeof healthData.healthy).toBe('boolean');
      expect(['ok', 'degraded', 'fail']).toContain(healthData.level);
      expect(typeof healthData.runtime_ready).toBe('boolean');
      expect(typeof healthChecks.db).toBe('boolean');
      expect(typeof healthChecks.world_pack_dir).toBe('boolean');
      expect(typeof healthChecks.world_pack_available).toBe('boolean');
      expect(Array.isArray(healthData.available_world_packs)).toBe(true);
      expect(Array.isArray(healthData.errors)).toBe(true);

      const statusResponse = await requestJson(server.baseUrl, '/api/status');
      expect(statusResponse.status).toBe(200);
      const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
      const runtimeSpeed = assertRecord(statusData.runtime_speed, '/api/status.runtime_speed');
      const scheduler = assertRecord(statusData.scheduler, '/api/status.scheduler');

      expect(['running', 'paused']).toContain(statusData.status);
      expect(statusData.health_level).toBe(healthData.level);
      expect(typeof statusData.runtime_ready).toBe('boolean');
      expect(runtimeSpeed.mode).toBe('fixed');
      expect(['default', 'world_pack', 'override']).toContain(runtimeSpeed.source);
      expect(typeof runtimeSpeed.effective_step_ticks).toBe('string');
      expect(typeof scheduler.worker_id).toBe('string');
      expect(typeof scheduler.partition_count).toBe('number');
      expect(Array.isArray(scheduler.owned_partition_ids)).toBe(true);
      expect(Array.isArray(statusData.startup_errors)).toBe(true);

      if (healthData.level === 'fail') {
        expect(healthResponse.status).toBe(503);
      } else {
        expect(healthResponse.status).toBe(200);
      }

      if (healthData.level === 'ok') {
        expect(statusData.runtime_ready).toBe(true);
        expect(statusData.world_pack).not.toBeNull();
        expect(runtimeSpeed.source).toBe('world_pack');
        expect(runtimeSpeed.effective_step_ticks).not.toBe('0');
      }
    });
  });
});
