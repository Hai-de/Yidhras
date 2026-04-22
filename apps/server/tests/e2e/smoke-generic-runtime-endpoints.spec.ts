import { describe, expect, it } from 'vitest';

import { assertRecord, assertSuccessEnvelopeArrayData, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

const EXAMPLE_PACK_REF = 'example_pack';
const EXAMPLE_PACK_ID = 'world-example-pack';

describe('smoke generic runtime endpoints e2e', () => {
  it('covers runtime and operator smoke endpoints under explicit example_pack', async () => {
    await withIsolatedTestServer(
      {
        defaultPort: 3119,
        activePackRef: EXAMPLE_PACK_REF,
        seededPackRefs: [EXAMPLE_PACK_REF]
      },
      async server => {
        const healthResponse = await requestJson(server.baseUrl, '/api/health');
        expect(healthResponse.status).toBe(200);
        const healthData = assertSuccessEnvelopeData(healthResponse.body, '/api/health');
        expect(healthData.runtime_ready).toBe(true);
        expect(Array.isArray(healthData.available_world_packs)).toBe(true);
        expect(healthData.available_world_packs).toContain(EXAMPLE_PACK_REF);

        const notificationsResponse = await requestJson(server.baseUrl, '/api/system/notifications');
        expect(notificationsResponse.status).toBe(200);
        assertSuccessEnvelopeArrayData(notificationsResponse.body, '/api/system/notifications');

        const clearResponse = await requestJson(server.baseUrl, '/api/system/notifications/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        expect(clearResponse.status).toBe(200);
        const clearData = assertSuccessEnvelopeData(clearResponse.body, '/api/system/notifications/clear');
        expect(clearData.acknowledged).toBe(true);

        const statusResponse = await requestJson(server.baseUrl, '/api/status');
        expect(statusResponse.status).toBe(200);
        const statusData = assertSuccessEnvelopeData(statusResponse.body, '/api/status');
        const worldPack = assertRecord(statusData.world_pack, '/api/status.world_pack');

        expect(statusData.runtime_ready).toBe(true);
        expect(worldPack.id).toBe(EXAMPLE_PACK_ID);

        const runtimeSpeed = assertRecord(statusData.runtime_speed, '/api/status.runtime_speed');
        expect(typeof runtimeSpeed.effective_step_ticks).toBe('string');

        const clockResponse = await requestJson(server.baseUrl, '/api/clock');
        expect(clockResponse.status).toBe(200);
        const clockData = assertSuccessEnvelopeData(clockResponse.body, '/api/clock');
        expect(typeof clockData.absolute_ticks).toBe('string');
        expect(Array.isArray(clockData.calendars)).toBe(true);

        const formattedClockResponse = await requestJson(server.baseUrl, '/api/clock/formatted');
        expect(formattedClockResponse.status).toBe(200);
        const formattedClockData = assertSuccessEnvelopeData(formattedClockResponse.body, '/api/clock/formatted');
        expect(typeof formattedClockData.absolute_ticks).toBe('string');
        expect(Array.isArray(formattedClockData.calendars)).toBe(true);

        const pauseResponse = await requestJson(server.baseUrl, '/api/clock/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause' })
        });
        expect(pauseResponse.status).toBe(200);
        const pauseData = assertSuccessEnvelopeData(pauseResponse.body, 'pause control');
        expect(pauseData.acknowledged).toBe(true);
        expect(pauseData.status).toBe('paused');

        const resumeResponse = await requestJson(server.baseUrl, '/api/clock/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resume' })
        });
        expect(resumeResponse.status).toBe(200);
        const resumeData = assertSuccessEnvelopeData(resumeResponse.body, 'resume control');
        expect(resumeData.acknowledged).toBe(true);
        expect(resumeData.status).toBe('running');

        const overrideResponse = await requestJson(server.baseUrl, '/api/runtime/speed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'override', step_ticks: '2' })
        });
        expect(overrideResponse.status).toBe(200);
        const overrideData = assertSuccessEnvelopeData(overrideResponse.body, 'runtime speed override');
        const overrideRuntimeSpeed = assertRecord(overrideData.runtime_speed, 'runtime speed override payload');
        expect(typeof overrideRuntimeSpeed.override_since).toBe('number');
        expect(overrideRuntimeSpeed.effective_step_ticks).toBe('2');

        const overrideClearResponse = await requestJson(server.baseUrl, '/api/runtime/speed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear' })
        });
        expect(overrideClearResponse.status).toBe(200);
        const overrideClearData = assertSuccessEnvelopeData(overrideClearResponse.body, 'runtime speed clear');
        const clearedRuntimeSpeed = assertRecord(overrideClearData.runtime_speed, 'runtime speed clear payload');
        expect(clearedRuntimeSpeed.override_since).toBeNull();
      }
    );
  });
});
