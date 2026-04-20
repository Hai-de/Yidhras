import { describe, expect, it } from 'vitest';

import { assertErrorEnvelope, assertRecord, assertSuccessEnvelopeData } from '../helpers/envelopes.js';
import { withIsolatedTestServer } from '../helpers/runtime.js';
import { requestJson } from '../helpers/server.js';

const ACTIVE_PACK_ROUTE_NAME = 'world-death-note';
const NON_ACTIVE_PACK_ROUTE_NAME = 'death_note';

describe('experimental projection compatibility e2e', () => {
  it('preserves stable active-pack projection guards while exposing experimental pack-local projection reads', async () => {
    await withIsolatedTestServer(
      {
        defaultPort: 3118,
        envOverrides: {
          EXPERIMENTAL_MULTI_PACK_RUNTIME_ENABLED: 'true',
          EXPERIMENTAL_MULTI_PACK_RUNTIME_OPERATOR_API_ENABLED: 'true'
        }
      },
      async server => {
        const stableOverviewResponse = await requestJson(server.baseUrl, `/api/packs/${NON_ACTIVE_PACK_ROUTE_NAME}/overview`);
        expect(stableOverviewResponse.status).toBe(409);
        assertErrorEnvelope(stableOverviewResponse.body, 'PACK_ROUTE_ACTIVE_PACK_MISMATCH', 'stable mismatched overview under experimental mode');

        const stableTimelineResponse = await requestJson(server.baseUrl, `/api/packs/${NON_ACTIVE_PACK_ROUTE_NAME}/projections/timeline`);
        expect(stableTimelineResponse.status).toBe(409);
        assertErrorEnvelope(stableTimelineResponse.body, 'PACK_ROUTE_ACTIVE_PACK_MISMATCH', 'stable mismatched timeline under experimental mode');

        const loadResponse = await requestJson(server.baseUrl, `/api/experimental/runtime/packs/${NON_ACTIVE_PACK_ROUTE_NAME}/load`, {
          method: 'POST'
        });
        expect(loadResponse.status).toBe(200);
        const loadData = assertSuccessEnvelopeData(loadResponse.body, 'experimental projection compatibility load');
        const loadedPack = assertRecord(loadData.pack, 'experimental projection compatibility loaded pack');
        expect(loadedPack.pack_id).toBe(ACTIVE_PACK_ROUTE_NAME);

        const experimentalOverviewResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${ACTIVE_PACK_ROUTE_NAME}/overview`);
        expect(experimentalOverviewResponse.status).toBe(200);
        const experimentalOverviewData = assertSuccessEnvelopeData(experimentalOverviewResponse.body, 'experimental overview projection read');
        expect(experimentalOverviewData.pack_id).toBe(ACTIVE_PACK_ROUTE_NAME);

        const experimentalTimelineResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${ACTIVE_PACK_ROUTE_NAME}/projections/timeline`);
        expect(experimentalTimelineResponse.status).toBe(200);
        const experimentalTimelineData = assertSuccessEnvelopeData(experimentalTimelineResponse.body, 'experimental timeline projection read');
        const experimentalTimelinePack = assertRecord(experimentalTimelineData.pack, 'experimental timeline pack');
        expect(experimentalTimelinePack.id).toBe(ACTIVE_PACK_ROUTE_NAME);

        const experimentalEntityProjectionResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${ACTIVE_PACK_ROUTE_NAME}/projections/entities`);
        expect(experimentalEntityProjectionResponse.status).toBe(200);
        const experimentalEntityProjectionData = assertSuccessEnvelopeData(experimentalEntityProjectionResponse.body, 'experimental entity projection read');
        expect(Array.isArray(experimentalEntityProjectionData.entities)).toBe(true);

        const experimentalEntityOverviewResponse = await requestJson(server.baseUrl, `/api/experimental/packs/${ACTIVE_PACK_ROUTE_NAME}/entities/agent-001/overview`);
        expect(experimentalEntityOverviewResponse.status).toBe(200);
        const experimentalEntityOverviewData = assertSuccessEnvelopeData(experimentalEntityOverviewResponse.body, 'experimental entity overview read');
        expect(experimentalEntityOverviewData.pack_id).toBe(ACTIVE_PACK_ROUTE_NAME);
        const packProjection = assertRecord(experimentalEntityOverviewData.pack_projection, 'experimental entity overview pack projection');
        expect('entity' in packProjection).toBe(true);
      }
    );
  });
});
