import { describe, expect, it } from 'vitest';

import { assertRecord, assertStringArrayField, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

describe('experimental runtime operator API e2e', () => {
  it('keeps experimental runtime operator API disabled by default', async () => {
    await withIsolatedTestServer({ defaultPort: 3111 }, async server => {
      const response = await requestJson(server.baseUrl, '/api/experimental/runtime/packs');
      expect(response.status).toBe(404);
      const errorEnvelope = assertRecord(response.body, 'experimental runtime disabled envelope');
      expect(errorEnvelope.success).toBe(false);
      const error = assertRecord(errorEnvelope.error, 'experimental runtime disabled error');
      expect(error.code).toBe('EXPERIMENTAL_MULTI_PACK_RUNTIME_DISABLED');
    });
  });

  it('exposes experimental runtime registry and per-pack status only when explicitly enabled', async () => {
    await withIsolatedTestServer(
      {
        defaultPort: 3112,
        envOverrides: {
          EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED: 'true',
          EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED: 'true'
        }
      },
      async server => {
        const systemHealthResponse = await requestJson(server.baseUrl, '/api/experimental/runtime/system/health');
        expect(systemHealthResponse.status).toBe(200);
        const systemHealth = assertSuccessEnvelopeData(systemHealthResponse.body, 'experimental system health');
        expect(typeof systemHealth.system_health_level).toBe('string');
        expect(typeof systemHealth.runtime_ready).toBe('boolean');
        expect(Array.isArray(systemHealth.available_world_packs)).toBe(true);
        expect(Array.isArray(systemHealth.startup_errors)).toBe(true);

        const packsResponse = await requestJson(server.baseUrl, '/api/experimental/runtime/packs');
        expect(packsResponse.status).toBe(200);
        const packsData = assertSuccessEnvelopeData(packsResponse.body, 'experimental runtime packs');

        const loadResponse = await requestJson(server.baseUrl, '/api/experimental/runtime/packs/death_note/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        expect(loadResponse.status).toBe(200);
        const loadData = assertSuccessEnvelopeData(loadResponse.body, 'experimental runtime load');
        expect(loadData.acknowledged).toBe(true);
        expect(typeof loadData.loaded).toBe('boolean');
        expect(typeof loadData.already_loaded).toBe('boolean');
        const loadedPack = assertRecord(loadData.pack, 'experimental runtime load pack');
        expect(typeof loadedPack.pack_id).toBe('string');

        const loadMissingResponse = await requestJson(server.baseUrl, '/api/experimental/runtime/packs/not-found-pack/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        expect(loadMissingResponse.status).toBe(404);
        const loadMissingEnvelope = assertRecord(loadMissingResponse.body, 'missing experimental runtime load envelope');
        const loadMissingError = assertRecord(loadMissingEnvelope.error, 'missing experimental runtime load error');
        expect(loadMissingError.code).toBe('EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND');

        const unloadActiveResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/world-death-note/unload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        expect(unloadActiveResponse.status).toBe(409);
        const unloadActiveEnvelope = assertRecord(unloadActiveResponse.body, 'active experimental runtime unload envelope');
        const unloadActiveError = assertRecord(unloadActiveEnvelope.error, 'active experimental runtime unload error');
        expect(unloadActiveError.code).toBe('EXPERIMENTAL_PACK_RUNTIME_ACTIVE_UNLOAD_FORBIDDEN');

        const loadedPackIds = assertStringArrayField(packsData, 'loaded_pack_ids', 'experimental runtime packs');
        expect(Array.isArray(packsData.items)).toBe(true);
        expect(loadedPackIds.length).toBeGreaterThan(0);

        const firstPackId = loadedPackIds[0];

        const statusResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/${String(firstPackId)}/status`);
        expect(statusResponse.status).toBe(200);
        const statusData = assertSuccessEnvelopeData(statusResponse.body, 'experimental pack runtime status');
        expect(statusData.pack_id).toBe(firstPackId);
        expect(typeof statusData.pack_folder_name).toBe('string');
        expect(typeof statusData.current_tick).toBe('string');
        const runtimeSpeed = assertRecord(statusData.runtime_speed, 'experimental runtime speed');
        expect(typeof runtimeSpeed.effective_step_ticks).toBe('string');

        const clockResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/${String(firstPackId)}/clock`);
        expect(clockResponse.status).toBe(200);
        const clockData = assertSuccessEnvelopeData(clockResponse.body, 'experimental pack clock');
        expect(clockData.pack_id).toBe(firstPackId);
        const clock = assertRecord(clockData.clock, 'experimental clock payload');
        expect(typeof clock.current_tick).toBe('string');

        const schedulerSummaryResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/${String(firstPackId)}/scheduler/summary`);
        expect(schedulerSummaryResponse.status).toBe(200);
        const schedulerSummaryData = assertSuccessEnvelopeData(schedulerSummaryResponse.body, 'experimental scheduler summary');
        const runTotals = assertRecord(schedulerSummaryData.run_totals, 'experimental scheduler summary run totals');
        expect(typeof runTotals.sampled_runs).toBe('number');

        const schedulerOwnershipResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/${String(firstPackId)}/scheduler/ownership`);
        expect(schedulerOwnershipResponse.status).toBe(200);
        const schedulerOwnershipData = assertSuccessEnvelopeData(schedulerOwnershipResponse.body, 'experimental scheduler ownership');
        expect(Array.isArray(schedulerOwnershipData.items)).toBe(true);

        const schedulerWorkersResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/${String(firstPackId)}/scheduler/workers`);
        expect(schedulerWorkersResponse.status).toBe(200);
        const schedulerWorkersData = assertSuccessEnvelopeData(schedulerWorkersResponse.body, 'experimental scheduler workers');
        expect(Array.isArray(schedulerWorkersData.items)).toBe(true);

        const schedulerOperatorResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/${String(firstPackId)}/scheduler/operator`);
        expect(schedulerOperatorResponse.status).toBe(200);
        const schedulerOperatorData = assertSuccessEnvelopeData(schedulerOperatorResponse.body, 'experimental scheduler operator');
        expect(Array.isArray(schedulerOperatorData.recent_runs)).toBe(true);
        expect(Array.isArray(assertRecord(schedulerOperatorData.ownership, 'experimental scheduler operator ownership').assignments)).toBe(true);

        const experimentalOverviewResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${String(firstPackId)}/overview`);
        expect(experimentalOverviewResponse.status).toBe(200);
        const experimentalOverviewData = assertSuccessEnvelopeData(experimentalOverviewResponse.body, 'experimental pack overview');
        expect(experimentalOverviewData.pack_id).toBe(firstPackId);

        const experimentalTimelineResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${String(firstPackId)}/projections/timeline`);
        expect(experimentalTimelineResponse.status).toBe(200);
        const experimentalTimelineData = assertSuccessEnvelopeData(experimentalTimelineResponse.body, 'experimental pack timeline');
        expect(Array.isArray(experimentalTimelineData.timeline)).toBe(true);

        const experimentalEntityProjectionResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${String(firstPackId)}/projections/entities`);
        expect(experimentalEntityProjectionResponse.status).toBe(200);
        const experimentalEntityProjectionData = assertSuccessEnvelopeData(experimentalEntityProjectionResponse.body, 'experimental pack entity projection');
        const experimentalEntityPack = assertRecord(experimentalEntityProjectionData.pack, 'experimental pack entity projection pack');
        expect(experimentalEntityPack.id).toBe(firstPackId);
        expect(Array.isArray(experimentalEntityProjectionData.entities)).toBe(true);

        const experimentalEntityOverviewResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${String(firstPackId)}/entities/agent-001/overview`);
        expect(experimentalEntityOverviewResponse.status).toBe(200);
        const experimentalEntityOverviewData = assertSuccessEnvelopeData(experimentalEntityOverviewResponse.body, 'experimental pack agent overview');
        expect(experimentalEntityOverviewData.pack_id).toBe(firstPackId);
        const experimentalAgentPackProjection = assertRecord(experimentalEntityOverviewData.pack_projection, 'experimental pack agent overview projection');
        expect('entity' in experimentalAgentPackProjection).toBe(true);

        const experimentalPluginsResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${String(firstPackId)}/plugins`);
        expect(experimentalPluginsResponse.status).toBe(200);
        const experimentalPluginsData = assertSuccessEnvelopeData(experimentalPluginsResponse.body, 'experimental pack plugins');
        expect(experimentalPluginsData.pack_id).toBe(firstPackId);
        expect(Array.isArray(experimentalPluginsData.items)).toBe(true);

        const missingPackResponse = await requestJson(server.baseUrl, '/api/experimental/runtime/packs/not-found-pack/status');
        expect(missingPackResponse.status).toBe(404);
        const missingPackEnvelope = assertRecord(missingPackResponse.body, 'missing experimental pack envelope');
        const missingPackError = assertRecord(missingPackEnvelope.error, 'missing experimental pack error');
        expect(missingPackError.code).toBe('EXPERIMENTAL_PACK_RUNTIME_NOT_FOUND');
      }
    );
  });
});
